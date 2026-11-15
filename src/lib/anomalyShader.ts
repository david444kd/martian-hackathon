// The anomaly shaders (dust storm, dust devil, rockfall), shared by the globe (dispatch/Anomaly.tsx:
// spherical caps at several altitudes) and the zone maps (components/StormLayer.tsx: flat quads in
// one WebGL canvas per map). See dispatch/Anomaly.tsx for what each kind looks like and why.
import * as THREE from "three";
import type { EventKind, Level } from "./types";
import { LOW_END, NOISE_GLSL, noiseTexture } from "./globeFx";

let capGeo: THREE.BufferGeometry | null = null;
/** a unit disc in the tangent plane (xy ∈ [-1,1]), bent onto the sphere in the vertex shader */
export function capGeometry() {
  if (capGeo) return capGeo;
  const rings = 10, segs = 40, pos: number[] = [], idx: number[] = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2, d = r / rings;
    pos.push(Math.cos(a) * d, Math.sin(a) * d, 0);
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, c, b, b, c, d);
  }
  capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  capGeo.setIndex(idx);
  capGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1); // the vertex shader moves it onto the planet
  return capGeo;
}

const VERT = /* glsl */ `
uniform float uSize;     // disc radius in tangent-plane units
uniform float uAlt;      // shell radius (planet = 1)
varying vec2 vP;         // position in the disc, [-1,1]
varying vec3 vN;         // world normal of the shell at this point
void main() {
  vP = position.xy;
#ifdef FLAT
  // a flat map: the disc is a quad scaled to the anomaly's radius in pixels, "up" faces the viewer
  vN = vec3(0.0, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
#else
  vec3 local = normalize(vec3(position.xy * uSize, 1.0)) * uAlt;
  vN = normalize(mat3(modelMatrix) * local);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(local, 1.0);
#endif
}`;

// KIND: 0 dust storm, 1 dust devil, 2 rockfall.  LAYER: 0 ground, 1 body / plume, 2 high streamers.
const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime, uSeed, uActive, uHot;
uniform vec3 uSun;       // sun direction, world
uniform vec2 uSunLocal;  // sun direction projected into the disc plane
uniform vec3 uRing;      // level colour of the boundary
varying vec2 vP;
varying vec3 vN;
${NOISE_GLSL}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h1(float x) { return fract(sin(x * 127.1 + uSeed * 0.013) * 43758.5453); }
vec2 SEED() { return vec2(uSeed * 0.731, uSeed * 0.379); }

// the dashed boundary ring, turning slowly
float boundary(float r) {
  float ang = atan(vP.y, vP.x) + uTime * 0.12;
  float dash = step(0.45, fract(ang * 36.0 / 6.2831853));
  return (1.0 - smoothstep(0.0, 0.018, abs(r - 0.965))) * dash;
}

#if KIND == 0
// ---- dust storm: an arced front advancing along D, a veil of dust thinning behind it ----
// storm frame: x along the drift direction (forward), y across it
vec2 stormFrame(vec2 p) { float a = uSeed * 0.0631; vec2 D = vec2(cos(a), sin(a)); return vec2(dot(p, D), dot(p, vec2(-D.y, D.x))); }
// position of the front along x for a given y: bowed forward, lobes travelling along it, breathing
float frontAt(float y) {
  float lobes = (n2(vec2(y * 3.2 + uSeed, uTime * 0.04)).x - 0.5) * 0.22
              + (n2(vec2(y * 10.0 - uTime * 0.15, uSeed * 0.7)).y - 0.5) * 0.07;
  return 0.4 + 0.05 * sin(uTime * 0.07 + uSeed) - 0.8 * y * y + lobes;
}
float wingMask(float y, float n) { return 1.0 - smoothstep(0.55, 0.92, abs(y) + n * 0.12); }
// the towering band right behind the front (0..1), geometry only: cheap enough for the shadow
float towerMask(vec2 st, float s) {
  return smoothstep(-0.012, 0.018, s) * (1.0 - smoothstep(0.08, 0.3, s)) * wingMask(st.y, 0.0);
}
// dust coordinates carried forward with the storm
vec2 carried(vec2 st) { return st - vec2(uTime * 0.018, 0.0); }
#endif

#if KIND == 1
// ---- dust devil: a small vortex wandering over the area, a dark track behind it ----
vec2 devilAt(float t) {
  return vec2(sin(t * 0.11 + uSeed) * 0.42 + sin(t * 0.041 + uSeed * 0.3) * 0.18,
              sin(t * 0.083 + uSeed * 1.7) * 0.38 + cos(t * 0.029) * 0.12);
}
float segDist(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
#endif

#if KIND == 2
// the slide in its own frame: x runs downslope
vec2 slideCoord(vec2 p) { return rot(uSeed * 0.0631) * p; }
float fanMask(vec2 s) {
  float width = 0.12 + 0.55 * clamp(s.x + 0.35, 0.0, 1.2);          // widens downslope
  float lobes = n2(vec2(s.y * 7.0, uSeed)).x * 0.25;
  return (1.0 - smoothstep(width * 0.75, width, abs(s.y))) * smoothstep(-0.45, -0.3, s.x) * (1.0 - smoothstep(0.55 + lobes, 0.8 + lobes, s.x));
}
#endif

void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float lambert = max(dot(normalize(vN), uSun), 0.0);
  float light = 0.8 + 0.35 * lambert;   // matches the globe's strong ambient fill
  float A = mix(0.4, 1.0, uActive);
  float ring = boundary(r);

#if KIND == 0 && LAYER == 0
  // ground: the dust veil hiding the surface, the front's shadow thrown away from the sun, boundary
  vec2 st = stormFrame(vP);
  float s = frontAt(st.y) - st.x;
  float n = n2(carried(st) * 3.0 + SEED()).x;
  float veil = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.35, 1.2, s + (n - 0.5) * 0.6)) * wingMask(st.y, n) * (1.0 - smoothstep(0.82, 1.0, r));
  vec2 sh = stormFrame(vP + uSunLocal * 0.07);                      // towering front: a long shadow
  float shadow = towerMask(sh, frontAt(sh.y) - sh.x);
  vec3 col = mix(vec3(0.62, 0.45, 0.32), vec3(0.05, 0.03, 0.02), shadow);
  // zone maps: the ring is the real boundary, so the whole area inside it is hazy with suspended
  // dust, not only behind the front (a pale veil that flattens the ground's contrast)
#ifdef FLAT
  float fill = (1.0 - smoothstep(0.86, 0.96, r)) * (0.24 + 0.1 * n);
#else
  float fill = 0.0;
#endif
  float main = max(veil * (0.45 + 0.15 * n), shadow * 0.6);
  col = mix(vec3(0.86, 0.75, 0.62), col, smoothstep(0.0, 0.3, main));
  float alpha = max(main, fill) * A;
  col = mix(col * light, uRing, ring);
  gl_FragColor = vec4(col, max(alpha, ring * mix(0.5, 0.9, uActive)));

#elif KIND == 0 && LAYER == 1
  // body: turbid dust behind the front, billowing near it, stretched into streaks further back
  vec2 st = stormFrame(vP);
  float s = frontAt(st.y) - st.x;
  if (s < -0.03 || s > 1.6) discard;
  vec2 u = carried(st);
  vec2 w = fbm2(u * 1.6 + SEED() + vec2(0.0, uTime * 0.012)) - 0.5;
  float near = 1.0 - smoothstep(0.0, 0.35, s);
  float bill = fbm2(u * 5.5 + w * 1.1 + SEED().yx).x;
  float streak = fbm2(vec2(u.x * 1.4, u.y * 7.0) + w * 0.9 + SEED()).y;
  float shape = smoothstep(-0.01, 0.03, s) * (1.0 - smoothstep(0.35, 1.2, s + w.x * 0.9)) * wingMask(st.y, w.y) * (1.0 - smoothstep(0.85, 1.0, r));
  float d = clamp(mix(smoothstep(0.3, 0.75, streak), smoothstep(0.25, 0.65, bill) * 1.15, near) * shape, 0.0, 1.0);
  if (d < 0.02) discard;
  // relief toward the sun from one more billow sample
  float bl = fbm2((u + uSunLocal * 0.03) * 5.5 + w * 1.1 + SEED().yx).x;
  float relief = clamp(0.9 + (bill - bl) * 3.0 * near, 0.6, 1.3);
  vec3 lit = uHot > 0.5 ? vec3(0.86, 0.60, 0.44) : vec3(0.90, 0.74, 0.56);
  vec3 dim = uHot > 0.5 ? vec3(0.50, 0.27, 0.17) : vec3(0.56, 0.39, 0.26);
  vec3 col = mix(dim, lit, smoothstep(0.1, 0.9, d)) * relief * light;
  if (uActive < 0.5) col = mix(col, vec3(dot(col, vec3(0.33))), 0.45);
  gl_FragColor = vec4(col, smoothstep(0.02, 0.6, d) * 0.88 * A);

#elif KIND == 0
  // the front: a towering wall of boiling, sunlit billows, new plumes rising ahead of it, lightning
  vec2 st = stormFrame(vP);
  float s = frontAt(st.y) - st.x;
  if (s < -0.12 || s > 0.3) discard;
  vec2 u = carried(st);
  vec2 w = fbm2(u * 3.0 + SEED() + vec2(uTime * 0.03, -uTime * 0.02)) - 0.5;   // boiling
  float bill = fbm2(u * 9.0 + w * 1.4 + SEED().yx).x;
  float tower = towerMask(st, s + (bill - 0.5) * 0.05);
  float d = smoothstep(0.2, 0.55, bill * 0.6 + tower * 0.75) * tower;
  // plumes of freshly lifted dust ahead of the front, drifting into it and growing
  float cy = st.y * 13.0, ci = floor(cy), ph = fract(uTime * 0.11 + h1(ci));
  float px = frontAt((ci + 0.5) / 13.0) + 0.015 + (1.0 - ph) * 0.07;
  float rad = 0.014 + ph * 0.04;
  vec2 pd = vec2(st.x - px, (fract(cy) - 0.5) / 13.0) / rad;
  float plume = exp(-dot(pd, pd) * 2.5) * (0.6 + 0.6 * n2(pd * 2.0 + ci + uTime * 0.3).x)
              * sin(ph * 3.14159) * step(0.35, h1(ci + 9.0)) * wingMask(st.y, 0.0);
  d = max(d, plume * 0.75);
  if (d < 0.02) discard;
  float bl = fbm2((u + uSunLocal * 0.02) * 9.0 + w * 1.4 + SEED().yx).x;
  float relief = clamp(0.95 + (bill - bl) * 4.0, 0.55, 1.45);
  // the face of the wall is bright when it faces the sun, in shade otherwise
  float a = uSeed * 0.0631;
  float face = 0.85 + 0.3 * dot(vec2(cos(a), sin(a)), uSunLocal) * (1.0 - smoothstep(0.0, 0.05, s));
  vec3 col = (uHot > 0.5 ? vec3(0.95, 0.68, 0.50) : vec3(0.97, 0.82, 0.63)) * relief * face * light;
  // electrostatic discharge inside the wall, now and then, while active
  if (uActive > 0.5) {
    float slot = floor(uTime * 1.6), fp = fract(uTime * 1.6);
    if (h1(slot) < 0.25 && fp < 0.3) {
      float fy = (h1(slot + 3.1) - 0.5) * 1.0;
      vec2 at = vec2(frontAt(fy) - 0.06, fy);
      float f = exp(-dot(st - at, st - at) * 220.0) * (1.0 - fp / 0.3) * (0.6 + 0.4 * step(0.5, fract(fp * 20.0)));
      col += vec3(1.0, 0.95, 0.85) * f * 2.2;
      d = max(d, f * 0.8);
    }
  }
  if (uActive < 0.5) col = mix(col, vec3(dot(col, vec3(0.33))), 0.45);
  gl_FragColor = vec4(col, clamp(d, 0.0, 1.0) * 0.95 * A);

#elif KIND == 1 && LAYER == 0
  // dust devil ground: the dark track it has left, fading with age, and its long thin shadow
  float track = 0.0;
  vec2 prev = devilAt(uTime);
  for (int k = 1; k <= 12; k++) {
    vec2 q = devilAt(uTime - float(k) * 3.0);
    float age = float(k) / 12.0;
    track = max(track, (1.0 - smoothstep(0.02, 0.045 + age * 0.02, segDist(vP, prev, q))) * (1.0 - age * 0.85));
    prev = q;
  }
  vec2 c = devilAt(uTime);
  float sd = segDist(vP, c, c - uSunLocal * 0.42);
  float along = clamp(dot(vP - c, -uSunLocal) / 0.42, 0.0, 1.0);
  float shadow = (1.0 - smoothstep(0.012, 0.03 + along * 0.03, sd)) * uActive;
  // a dusty skirt where the vortex lifts dust off the ground
  float skirt = exp(-dot(vP - c, vP - c) * 60.0) * uActive;
  vec3 col = mix(vec3(0.10, 0.06, 0.04), vec3(0.02, 0.01, 0.01), shadow);
  col = mix(col, vec3(0.80, 0.62, 0.45), skirt * (1.0 - shadow));
  float alpha = max(max(track * 0.7, shadow * 0.8), skirt * 0.6) * A;
  col = mix(col * light, uRing, ring);
  alpha = max(alpha, ring * mix(0.5, 0.9, uActive));
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);

#elif KIND == 1
  // the vortex: fast spiral arms of dust around a bright core, a skirt of dust at its foot
  vec2 c = devilAt(uTime);
  vec2 q = (vP - c) / 0.26;
  float rr = length(q);
  if (rr > 1.0) discard;
  float ang = atan(q.y, q.x);
  float arms = 0.5 + 0.5 * sin(ang * 3.0 + log(rr + 0.02) * 6.0 - uTime * 9.0);
  float tex = n2(vec2(ang * 3.0 - uTime * 4.0, rr * 6.0 + uSeed)).x;
  float d = (arms * 0.6 + tex * 0.5) * (1.0 - smoothstep(0.3, 1.0, rr)) + (1.0 - smoothstep(0.0, 0.3, rr)) * 0.9;
  d *= uActive * 0.85 + 0.15;
  if (d < 0.03) discard;
  vec3 col = mix(vec3(0.6, 0.43, 0.3), vec3(0.98, 0.86, 0.7), smoothstep(0.3, 1.0, d)) * light;
  gl_FragColor = vec4(col, clamp(d, 0.0, 1.0) * 0.9 * A);

#elif LAYER == 0
  // rockfall ground: pale scar at the head, dark lobed debris fan, boulders with sun and shadow
  vec2 s = slideCoord(vP);
  vec2 sunS = slideCoord(uSunLocal);
  float fan = fanMask(s);
  vec2 g = fbm2(vec2(s.x * 3.0, s.y * 11.0) + SEED());           // streaks running downslope
  float scar = (1.0 - smoothstep(0.08, 0.2, length((s - vec2(-0.4, 0.0)) * vec2(1.0, 1.8))));
  vec3 col = vec3(0.17, 0.10, 0.07) * (0.6 + 0.8 * g.x);
  float alpha = fan * (0.7 + 0.3 * g.y);
  col = mix(col, vec3(0.86, 0.70, 0.55), scar);
  alpha = max(alpha, scar * 0.9);
  // boulders: one per grid cell at most, larger near the toe; the ones in the moving set slide
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float grid = 9.0 + fl * 6.0;
    vec2 sp = s * grid;
    if (layer == 1) sp.x -= uTime * 0.6 * uActive;                 // still-moving debris
    vec2 c = floor(sp);
    vec4 rnd = cell4(c + fl * 41.0 + SEED());
    vec2 ctr = c + 0.2 + rnd.xy * 0.6;
    float rad = 0.16 + rnd.z * 0.2;
    vec2 cs = ctr / grid;
    if (rnd.w > 0.72 - 0.2 * clamp(cs.x, 0.0, 1.0) && fanMask(cs) > 0.5) {   // more blocks toward the toe
      vec2 dv = sp - ctr;
      float dist = length(dv);
      float shade = clamp(0.6 + dot(normalize(dv + 1e-4), sunS) * 0.6, 0.2, 1.2);
      float rock = 1.0 - smoothstep(rad * 0.8, rad, dist);
      float shd = (1.0 - smoothstep(rad * 0.8, rad * 1.2, length(dv + sunS * rad * 0.9))) * (1.0 - rock);
      col = mix(col, vec3(0.03, 0.02, 0.01), shd * 0.8);
      col = mix(col, vec3(0.55, 0.40, 0.30) * shade, rock);
      alpha = max(alpha, max(rock, shd * 0.8));
    }
  }
  col *= light;
  col = mix(col, uRing, ring);
  gl_FragColor = vec4(col, max(alpha * A, ring * mix(0.5, 0.9, uActive)));

#else
  // rockfall plume: thin dust settling and drifting from the toe while active
  vec2 s = slideCoord(vP);
  vec2 w = fbm2(s * 2.5 + SEED() + vec2(-uTime * 0.05, 0.0));
  float plume = fbm2(s * 5.0 + w * 1.4 - vec2(uTime * 0.08, 0.0)).x;
  float m = 1.0 - smoothstep(0.15, 0.6, length((s - vec2(0.25, 0.0)) * vec2(0.8, 1.4)));
  float d = smoothstep(0.35, 0.8, plume) * m;
  if (d < 0.01) discard;
  gl_FragColor = vec4(vec3(0.84, 0.68, 0.52) * light, d * 0.55 * uActive);
#endif
}`;

const LEVEL_RGB: Record<Level, string> = { info: "#38bdf8", warning: "#fbbf24", critical: "#ef4444" };

export interface AnomalyLook {
  kind: EventKind;
  seed: number;
  level: Level;
  active: boolean;
  /** sun direction (world, or toward the viewer-ish for a flat map) and its projection in the disc plane */
  sun: THREE.Vector3;
  sunLocal: THREE.Vector2;
  /** the clock uniform to animate with */
  time: { value: number };
  /** flat map (quad in pixels) instead of a cap on the globe */
  flat?: boolean;
  /** globe only: disc radius in sphere units */
  size?: number;
}

/** the anomaly's layers, bottom first: ground, then body/plume, then high streamers (storm) */
export function anomalyMaterials(l: AnomalyLook): THREE.ShaderMaterial[] {
  const K = l.kind === "dust_devil" ? 1 : l.kind === "rockfall" ? 2 : 0;
  const shells = K === 0 ? [{ layer: 0, alt: 1.0012, scale: 1 }, { layer: 1, alt: 1.004, scale: 1 }, { layer: 2, alt: 1.009, scale: 1 }]
    : K === 1 ? [{ layer: 0, alt: 1.0012, scale: 1 }, { layer: 1, alt: 1.004, scale: 1 }]
    : [{ layer: 0, alt: 1.0015, scale: 1 }, ...(l.active ? [{ layer: 1, alt: 1.004, scale: 1 }] : [])];
  return shells.map(({ layer, alt, scale }) => new THREE.ShaderMaterial({
    defines: { KIND: K, LAYER: layer, OCT: LOW_END ? 3 : 4, ...(l.flat ? { FLAT: 1 } : {}) },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: !l.flat,
    uniforms: {
      uNoise: { value: noiseTexture() },
      uTime: l.time,
      uSeed: { value: l.seed % 997 },
      uActive: { value: l.active ? 1 : 0 },
      uHot: { value: l.level === "critical" ? 1 : 0 },
      uSun: { value: l.sun },
      uSunLocal: { value: l.sunLocal },
      uRing: { value: new THREE.Color(LEVEL_RGB[l.level]) },
      uSize: { value: (l.size ?? 0.1) * scale },
      uAlt: { value: alt },
    },
  }));
}
