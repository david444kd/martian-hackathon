// The air of the EVA scene: one set of uniforms (sun, sky colours, haze, wind, storm) that the sky,
// the ground, the storm and the dust all read, updated once a frame, so they always agree; plus the
// sky dome and the lights. Dust in the air comes from the zone's dust opacity and the storm events
// (useEva `storm`, 0..1) — a picture of them, not a measurement of the air.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Q } from "./quality";
import { wind } from "./wind";
import type { EvaRuntime } from "./runtime";

// ------------------------------------------------------------------------------------------------
// tileable noise baked into small textures (no per-pixel procedural noise on the headset's GPU)
function hash2(x: number, y: number, s = 0) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, p: number, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let u = x - ix, v = y - iy;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  const w = (a: number, b: number) => hash2(((a % p) + p) % p, ((b % p) + p) % p, s);
  return (w(ix, iy) * (1 - u) + w(ix + 1, iy) * u) * (1 - v) + (w(ix, iy + 1) * (1 - u) + w(ix + 1, iy + 1) * u) * v;
}
function fbm(u: number, v: number, base: number, oct: number, seed = 0, billow = false) {
  let s = 0, a = 0.5, f = base, n = 0;
  for (let o = 0; o < oct; o++) {
    const k = vnoise(u * f, v * f, f, seed + o * 17);
    s += (billow ? Math.abs(2 * k - 1) : k) * a; n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}
const sat = (v: number) => Math.min(1, Math.max(0, v));

function dataTexture(N: number, data: Uint8Array) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

let cloud: THREE.DataTexture | null = null;
/**
 * Dust-cloud noise, 256², tiles. R: billows (round lobes with creases between them, like the face of
 * a dust front); G: soft drifting noise; B, A: the slope of R (for lighting the billows).
 */
export function cloudTexture() {
  if (cloud) return cloud;
  const N = 256, R = new Float32Array(N * N), data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const warp = fbm(u, v, 3, 3, 40) - 0.5;
    R[y * N + x] = sat(fbm(u + warp * 0.06, v - warp * 0.06, 4, 5, 0, true) * 2.1 - 0.02);
    data[(y * N + x) * 4 + 1] = fbm(u, v, 4, 5, 90) * 255;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, l = R[y * N + ((x + N - 1) % N)], r = R[y * N + ((x + 1) % N)], d = R[((y + N - 1) % N) * N + x], up = R[((y + 1) % N) * N + x];
    data[i * 4] = R[i] * 255;
    data[i * 4 + 2] = sat(0.5 + (r - l) * 6) * 255;
    data[i * 4 + 3] = sat(0.5 + (up - d) * 6) * 255;
  }
  cloud = dataTexture(N, data);
  return cloud;
}

let regolith: THREE.DataTexture | null = null;
/**
 * The ground up close, 512², tiles: R, G = the surface normal's lean (east, south), B = how light the
 * surface is (0.5 = as the photo), from a height field of sand grain, soft lumps, faint ripples and
 * half-buried pebbles. The ground shader lights it with the scene's sun, so the relief follows the time of day.
 * Authored texture, not imagery.
 */
export function regolithTexture() {
  if (regolith) return regolith;
  const N = 512, H = new Float32Array(N * N), A = new Float32Array(N * N), G = 22;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = y * N + x;
    const lumps = fbm(u, v, 6, 4, 3), grain = fbm(u, v, 96, 2, 7);
    // faint wind ripples, only in the sandier patches
    const sandy = sat((fbm(u, v, 3, 3, 15) - 0.52) * 5);
    const ripple = Math.sin((u * 34 + v * 9 + lumps * 3 + fbm(u, v, 5, 2, 11) * 4) * Math.PI * 2) * 0.5 + 0.5;
    let h = lumps * 1.5 + grain * 0.22 + ripple * 0.06 * sandy;
    let alb = 0.5 + (fbm(u, v, 5, 4, 21) - 0.5) * 0.3 + (grain - 0.5) * 0.14;
    // pebbles: at most one per cell, darker than the dust (basalt), sitting proud of the sand
    const cx = Math.floor(u * G), cy = Math.floor(v * G);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy, wx = ((gx % G) + G) % G, wy = ((gy % G) + G) % G;
      if (hash2(wx, wy, 5) > 0.5) continue;
      const px = gx + 0.2 + hash2(wx, wy, 6) * 0.6, py = gy + 0.2 + hash2(wx, wy, 7) * 0.6;
      const r = 0.07 + hash2(wx, wy, 8) ** 2.2 * 0.32, e = 0.6 + hash2(wx, wy, 9) * 0.4, an = hash2(wx, wy, 10) * Math.PI;
      const dx = u * G - px, dy = v * G - py, ca = Math.cos(an), sa = Math.sin(an);
      const d2 = ((dx * ca + dy * sa) / r) ** 2 + ((-dx * sa + dy * ca) / (r * e)) ** 2;
      if (d2 >= 2.2) continue;
      if (d2 >= 1) { alb *= 0.7 + 0.3 * sat((d2 - 1) / 1.2); continue; } // the stone shades the sand at its foot
      const dome = Math.sqrt(1 - d2);
      h = Math.max(h, lumps * 1.5 + dome * r * 4.4);
      alb = alb + (0.43 + hash2(wx, wy, 12) * 0.14 - alb) * sat(dome * 3);
    }
    H[i] = h; A[i] = alb;
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, l = H[y * N + ((x + N - 1) % N)], r = H[y * N + ((x + 1) % N)], n = H[((y + N - 1) % N) * N + x], s = H[((y + 1) % N) * N + x];
    // hollows collect shade: a little ambient occlusion from the height itself
    const ao = sat(1 + (H[i] - (l + r + n + s) / 4) * 4);
    data[i * 4] = sat(0.5 + (l - r) * 1.6) * 255;
    data[i * 4 + 1] = sat(0.5 + (n - s) * 1.6) * 255;
    data[i * 4 + 2] = sat(A[i] * (0.8 + 0.2 * ao)) * 255;
    data[i * 4 + 3] = 255;
  }
  regolith = dataTexture(N, data);
  return regolith;
}

// ------------------------------------------------------------------------------------------------
/** shared by every material of the scene that shows the air; written by <Atmosphere> each frame */
export const ATMO = {
  uTime: { value: 0 },
  uSun: { value: new THREE.Vector3(0.4, 0.7, -0.3).normalize() },
  uHorizon: { value: new THREE.Color("#d9a27a") },
  uZenith: { value: new THREE.Color("#8a5d48") },
  uSunGlow: { value: new THREE.Color(1, 0.9, 0.8) },
  /** how bright the Sun's disc and its blue aureole are (dust dims them to a pale spot) */
  uSunDisc: { value: 1 },
  /** haze: fog = 1 - exp(-(density · distance)²), the same law as the scene's FogExp2 */
  uFogDensity: { value: 1.6e-4 },
  /** dust around the astronaut 0..1, eased */
  uStorm: { value: 0 },
  /** unit direction the dust travels in (x east, y south) and how far it has drifted, m */
  uWind: { value: new THREE.Vector2(1, 0) },
  uDrift: { value: 0 },
  /** the colour of sunlit airborne dust, and what a shadow leaves of the ground's light */
  uDust: { value: new THREE.Color("#c99468") },
  uShadow: { value: new THREE.Color(0.5, 0.46, 0.48) },
  /** the head (between the eyes in VR), so both eyes see the same dust */
  uEye: { value: new THREE.Vector3() },
  uCloud: { value: null as THREE.Texture | null },
  /** how much of the daylight reaches the ground through the dust (the ground is a photograph: it is not lit by the lamps) */
  uLight: { value: 1 },
  /** how hard it is blowing right now 0..1 (gusts, and squalls inside a storm) */
  uGust: { value: 0 },
  /** dust settled on the visor 0..1: builds up inside a storm, clears slowly after */
  uFilm: { value: 0 },
  /** the helmet lamps: where they are, where they point, how bright (0 in daylight; on in thick dust) */
  uLampPos: { value: new THREE.Vector3() },
  uLampDir: { value: new THREE.Vector3(0, -0.2, -1) },
  uLamp: { value: 0 },
  /** dust that has settled on the suit 0..1: gathers in a storm and stays for minutes after */
  uSuitDust: { value: 0 },
  /** up to two dust-storm areas (x, z, radius, 1): the ground before their walls is veiled with dust */
  uFronts: { value: [new THREE.Vector4(), new THREE.Vector4()] },
};
/** light levels for <Lights>, and the request to redraw the (otherwise still) shadow map */
export const air = { sun: 1, sky: 1, storm: 0, shadowDirty: true };

/** GLSL: the sky's colour in a direction and the haze's colour along a view ray (linear) */
export const ATMO_GLSL = /* glsl */ `
uniform vec3 uSun, uHorizon, uZenith, uSunGlow;
uniform float uSunDisc, uFogDensity, uStorm;
vec3 atmoSky(vec3 d) {
  vec3 c = mix(uHorizon, uZenith, pow(max(d.y, 0.0), 0.5));
  float s = max(dot(d, uSun), 0.0), s2 = s * s, s8 = s2 * s2 * s2 * s2;
  // dust scatters sunlight forward: a wide warm glow, and close round the Sun the cool aureole of Mars
  c += uSunGlow * (s8 * 0.17 + s8 * s8 * s8 * 0.22);
  c += vec3(0.6, 0.72, 0.98) * (uSunDisc * (pow(s, 260.0) * 0.22 + pow(s, 2200.0) * 0.6));
  return c;
}
vec3 atmoFog(vec3 v) { return atmoSky(normalize(vec3(v.x, 0.03, v.z))); }
float atmoFogAmount(float dist) { float k = uFogDensity * dist; return 1.0 - exp(-k * k); }
float atmoDither(vec2 p) { return (fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5) / 160.0; }
`;

const DAY_H = new THREE.Color("#d9a27a"), DAY_Z = new THREE.Color("#8a5d48"), LOW_H = new THREE.Color("#c08f72"), LOW_Z = new THREE.Color("#5d4a4a");
const STORM_H = new THREE.Color("#7c4f30"), STORM_Z = new THREE.Color("#3a2216");
const DUST_DAY = new THREE.Color("#cf9a6c"), DUST_STORM = new THREE.Color("#a66f45");
const FOG_CLEAR = 1.6e-4, FOG_STORM = 0.04;

/** keeps ATMO, the fog and the background in step with the Sun, the wind and the dust */
export function Atmosphere({ storm, windDeg, sun }: { storm: number; windDeg: number; sun: THREE.Vector3 }) {
  const scene = useThree((s) => s.scene), gl = useThree((s) => s.gl), camera = useThree((s) => s.camera);
  const fog = useMemo(() => new THREE.FogExp2("#d9a27a", FOG_CLEAR), []);
  const bg = useMemo(() => new THREE.Color("#d9a27a"), []);
  const st = useRef({ k: -1 });
  useEffect(() => {
    scene.fog = fog; scene.background = bg;
    ATMO.uCloud.value = cloudTexture();
    return () => { scene.fog = null; scene.background = null; };
  }, [scene, fog, bg]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1), s = st.current;
    s.k = s.k < 0 ? storm : s.k + (storm - s.k) * Math.min(1, dt * 0.9);
    const k = s.k, ks = Math.pow(k, 1.5), kf = k * k * k;
    ATMO.uTime.value += dt;
    const t = ATMO.uTime.value;
    ATMO.uStorm.value = k; air.storm = k;
    ATMO.uSun.value.copy(sun);
    // the sky: tan by day, greyer with the Sun low, dark ochre in a storm
    const low = 1 - THREE.MathUtils.smoothstep(sun.y, 0.12, 0.5);
    ATMO.uHorizon.value.copy(DAY_H).lerp(LOW_H, low * 0.8).lerp(STORM_H, ks);
    ATMO.uZenith.value.copy(DAY_Z).lerp(LOW_Z, low * 0.7).lerp(STORM_Z, ks);
    ATMO.uSunGlow.value.setRGB(1, 0.86 - low * 0.1, 0.7 - low * 0.12).multiplyScalar((0.75 + low * 0.5) * (1 - ks * 0.6));
    ATMO.uSunDisc.value = 1 - ks * 0.9;
    ATMO.uDust.value.copy(DUST_DAY).lerp(DUST_STORM, ks);
    // gusts come and go; inside a storm a squall passes every so often and for a few seconds the
    // dust closes in to a couple of dozen metres and the light goes
    const surge = (period: number, phase: number) => { const p = ((t + phase) / period) % 1; return THREE.MathUtils.smoothstep(p, 0, 0.09) * (1 - THREE.MathUtils.smoothstep(p, 0.15, 0.33)); };
    const squall = Math.max(surge(19, 6), surge(31, 17) * 0.85) * kf;
    const gust = THREE.MathUtils.clamp((0.5 + 0.3 * Math.sin(t * 0.63) + 0.2 * Math.sin(t * 1.7 + 1.3)) * 0.55 + squall * 0.75, 0, 1);
    wind.storm = k; wind.gust = gust; wind.squall = squall;
    ATMO.uGust.value = gust;
    ATMO.uFilm.value = THREE.MathUtils.clamp(ATMO.uFilm.value + dt * (k > 0.75 ? 0.03 + squall * 0.08 : -0.02), 0, 1);
    // dust rubbing on dust charges it: now and then it lets go as a small spark (heard as a crackle)
    if (Math.random() < dt * kf * (0.04 + gust * 0.1 + squall * 0.9)) { wind.zaps++; wind.zapAt = performance.now(); }
    ATMO.uFogDensity.value = FOG_CLEAR * Math.pow(FOG_STORM / FOG_CLEAR, kf) * (1 + kf * (gust * 0.5 - 0.15) + squall * 1.7);
    fog.density = ATMO.uFogDensity.value;
    const w = (windDeg * Math.PI) / 180, speed = 2.5 + k * 11 + kf * gust * 12;
    ATMO.uWind.value.set(Math.sin(w), -Math.cos(w));
    ATMO.uDrift.value += speed * dt;
    // shadows soften as the dust hides the Sun
    const sh = 0.52 * (1 - ks * 0.92);
    ATMO.uShadow.value.setRGB(1 - sh, 1 - sh * 1.08, 1 - sh * 1.04);
    const dark = 1 - squall * 0.5;
    air.sun = (1 - ks * 0.82) * dark; air.sky = (1 - ks * 0.4) * dark;
    ATMO.uLight.value = (1 - ks * 0.6) * dark;
    ATMO.uHorizon.value.multiplyScalar(1 - squall * 0.3); ATMO.uZenith.value.multiplyScalar(1 - squall * 0.45);
    fog.color.copy(ATMO.uHorizon.value); bg.copy(ATMO.uHorizon.value);
    scene.environmentIntensity = 0.85 * (1 - ks * 0.55);
    const head = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    head.getWorldPosition(ATMO.uEye.value);
    // the helmet lamps come on when thick dust takes the daylight (the scene keeps its Sun above the
    // horizon at any hour so it stays readable, so there is no dusk for them to answer to)
    const want = THREE.MathUtils.smoothstep(ks, 0.3, 0.7);
    ATMO.uLamp.value += (want - ATMO.uLamp.value) * Math.min(1, dt * 1.2);
    ATMO.uLampDir.value.set(0, -0.22, -1).normalize().transformDirection(head.matrixWorld);
    ATMO.uLampPos.value.copy(ATMO.uEye.value).y += 0.14;
    ATMO.uSuitDust.value = THREE.MathUtils.clamp(ATMO.uSuitDust.value + dt * (k > 0.55 ? 0.02 * k + squall * 0.03 : -0.002), 0, 1);
  }, -2);
  return null;
}

// ------------------------------------------------------------------------------------------------
/** the sky dome: always round the eye and behind everything, whatever the camera's far plane */
export function Sky() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: ATMO.uSun, uHorizon: ATMO.uHorizon, uZenith: ATMO.uZenith, uSunGlow: ATMO.uSunGlow, uSunDisc: ATMO.uSunDisc, uFogDensity: ATMO.uFogDensity, uStorm: ATMO.uStorm, uTime: ATMO.uTime, uWind: ATMO.uWind, uDrift: ATMO.uDrift, uCloud: ATMO.uCloud },
    vertexShader: /* glsl */ `varying vec3 vDir;
      void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `${ATMO_GLSL}
      uniform sampler2D uCloud; uniform float uTime, uDrift; uniform vec2 uWind; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = atmoSky(d);
        // high dust is never quite even: faint streaks by day, a low churning ceiling in a storm
        vec2 p = d.xz / (abs(d.y) + 0.22);
        float ks = uStorm * sqrt(uStorm);
        float hi = texture2D(uCloud, p * 0.21 + uWind * (uTime * 0.0012)).g;
        float lo = texture2D(uCloud, p * 0.55 - uWind * (uDrift * 0.004)).r;
        c *= 1.0 + (hi - 0.5) * 0.14 * (1.0 - ks) + (lo - 0.45) * 0.34 * ks * smoothstep(0.0, 0.3, d.y);
        // the Sun: a small disc (it is 2/3 the size it is from Earth), a pale spot through the dust
        float a = length(cross(d, uSun));
        float disc = (1.0 - smoothstep(0.0030, 0.0040, a)) * step(0.0, dot(d, uSun));
        c += vec3(1.0, 0.97, 0.9) * disc * (0.35 + uSunDisc * 6.0);
        // under the horizon (seen only past the edge of the zone): the haze
        c = mix(c, atmoFog(d) * 0.94, smoothstep(0.0, -0.05, d.y));
        gl_FragColor = linearToOutputTexel(vec4(c, 1.0));
        gl_FragColor.rgb += atmoDither(gl_FragCoord.xy);
      }`,
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  // drawn after the solid scene, so only the pixels the ground and the base leave are shaded
  return <mesh material={mat} renderOrder={900} frustumCulled={false}><icosahedronGeometry args={[1, 4]} /></mesh>;
}

// ------------------------------------------------------------------------------------------------
/**
 * Sunlight and skylight. The shadow box follows the astronaut (stepped, so the shadows do not swim);
 * the shadow map is redrawn only when something in it changed or every few frames on a headset.
 */
export function Lights({ rt, dir }: { rt: EvaRuntime; dir: THREE.Vector3 }) {
  const sunRef = useRef<THREE.DirectionalLight>(null), hemi = useRef<THREE.HemisphereLight>(null);
  const scene = useThree((s) => s.scene), gl = useThree((s) => s.gl);
  const last = useRef({ x: NaN, z: NaN, n: 0, dir: new THREE.Vector3() });
  useEffect(() => {
    const l = sunRef.current!;
    scene.add(l.target);
    gl.shadowMap.autoUpdate = false; air.shadowDirty = true;
    return () => { scene.remove(l.target); gl.shadowMap.autoUpdate = true; };
  }, [scene, gl]);
  useFrame(() => {
    const l = sunRef.current, s = last.current;
    if (!l) return;
    l.intensity = 2.4 * air.sun;
    if (hemi.current) hemi.current.intensity = 0.75 * air.sky;
    const x = Math.round(rt.pose.x / 2) * 2, z = Math.round(rt.pose.z / 2) * 2;
    if (x !== s.x || z !== s.z || !s.dir.equals(dir)) { s.x = x; s.z = z; s.dir.copy(dir); air.shadowDirty = true; }
    l.target.position.set(x, rt.pose.y, z);
    l.position.set(x + dir.x * 260, rt.pose.y + dir.y * 260, z + dir.z * 260);
    if (!Q.shadows) return;
    if (air.shadowDirty || ++s.n >= Q.shadowEvery) { gl.shadowMap.needsUpdate = true; air.shadowDirty = false; s.n = 0; }
  });
  const b = Q.shadowBox;
  return (
    <>
      <hemisphereLight ref={hemi} args={["#f1c9a4", "#5b3a26", 0.75]} />
      <directionalLight ref={sunRef} intensity={2.4} color="#fff1df" castShadow={Q.shadows}
        shadow-mapSize={[Q.shadowSize, Q.shadowSize]} shadow-bias={-0.0004} shadow-normalBias={0.06}
        shadow-camera-left={-b} shadow-camera-right={b} shadow-camera-top={b} shadow-camera-bottom={-b} shadow-camera-near={20} shadow-camera-far={700} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------
/**
 * The helmet lamps for everything that is lit the ordinary way (rocks, the base, the gloves): one warm
 * spotlight on the head, no shadows, at zero in daylight. The ground and the dust in the air take the
 * same beam from the uniforms above (Ground.tsx, Storm.tsx).
 */
export function HelmetLamp() {
  const camera = useThree((s) => s.camera);
  const lamp = useMemo(() => {
    // the light's origin sits a few metres behind the head (it casts no shadows, so this cannot be seen):
    // from the helmet itself the gloves, half a metre away, would burn out white against ground lit at four
    const l = new THREE.SpotLight("#fff4e4", 0, 40, 0.3, 0.7, 1);
    l.position.set(0, 0.75, 3.2); l.target.position.set(0, -0.85, -4);
    return l;
  }, []);
  useEffect(() => {
    camera.add(lamp, lamp.target);
    return () => { camera.remove(lamp, lamp.target); lamp.dispose(); };
  }, [camera, lamp]);
  useFrame(() => { lamp.intensity = ATMO.uLamp.value * 4.2; });
  return null;
}
