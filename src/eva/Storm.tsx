// Dust in the EVA scene, drawn from the `events` rows and the zone's dust opacity:
//  - StormFront: a dust storm seen from outside — a towering wall of billowing dust over the event's
//    area, like the leading edge of a regional storm (a haboob): sunlit on the Sun's side, brown in
//    its own shade, dense and dark at the foot, ragged at the top, slowly rolling;
//  - DustDevil: a narrow, hollow, leaning vortex wandering inside its event's area, with a skirt of
//    lifted dust at its foot;
//  - WindDust: what you are in when the dust reaches you — streaks of sand flying past on the wind and
//    large soft billows drifting through, on top of the haze and the dimmed sky (atmo.tsx) and the
//    sand streaming over the ground (Ground.tsx).
// All of it is computed on the GPU from the shared atmosphere uniforms: no per-frame buffers.
// A picture of the anomaly's area and of dusty air, not a simulation or a weather observation.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { ATMO, ATMO_GLSL, air } from "./atmo";
import { groundY, type P2 } from "./frame";
import { Q } from "./quality";
import type { EvaRuntime } from "./runtime";

/** an open tube standing on the terrain: radius r(t), height `height`, its foot following the ground */
function column(hm: Heightmap, at: P2, height: number, seg: number, rows: number, radius: (t: number, a: number) => number, sink: number) {
  const n = seg + 1, pos = new Float32Array(n * (rows + 1) * 3), nor = new Float32Array(n * (rows + 1) * 3), uv = new Float32Array(n * (rows + 1) * 2);
  const y0 = groundY(hm, at.x, at.z);
  for (let i = 0; i < n; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const r0 = radius(0, a), foot = groundY(hm, at.x + c * r0, at.z + s * r0) - y0 - sink;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows, r = radius(t, a), v = j * n + i;
      pos[v * 3] = c * r; pos[v * 3 + 1] = foot + (height - foot) * t; pos[v * 3 + 2] = s * r;
      nor[v * 3] = c; nor[v * 3 + 1] = 0; nor[v * 3 + 2] = s;
      uv[v * 2] = i / seg; uv[v * 2 + 1] = t;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const atmoUniforms = () => ({ uLampPos: ATMO.uLampPos, uLampDir: ATMO.uLampDir, uLamp: ATMO.uLamp, uGust: ATMO.uGust, uSun: ATMO.uSun, uHorizon: ATMO.uHorizon, uZenith: ATMO.uZenith, uSunGlow: ATMO.uSunGlow, uSunDisc: ATMO.uSunDisc, uFogDensity: ATMO.uFogDensity, uStorm: ATMO.uStorm, uTime: ATMO.uTime, uCloud: ATMO.uCloud, uEye: ATMO.uEye, uWind: ATMO.uWind, uDrift: ATMO.uDrift, uDust: ATMO.uDust });

// ------------------------------------------------------------------------------------------------
export function StormFront({ hm, at, radius, level, rt }: { hm: Heightmap; at: P2; radius: number; level: string; rt: EvaRuntime }) {
  const height = Math.min(1500, 420 + radius * 0.7);
  const geo = useMemo(() => column(hm, at, height, Q.wallSeg, 10, (t, a) => {
    // the face bulges forward above the foot and leans back towards the top; its outline is uneven
    const lobe = 1 + 0.035 * Math.sin(a * 5 + radius) + 0.02 * Math.sin(a * 11 + 1.7);
    return radius * lobe * (1 + 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.12 * t * t);
  }, 12), [hm, at.x, at.z, radius, height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => {
    const around = Math.max(2, Math.round((2 * Math.PI * radius) / 900));
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.FrontSide, fog: false,
      defines: { LAYERS: Q.wallLayers },
      uniforms: {
        ...atmoUniforms(),
        uTile: { value: new THREE.Vector2(around, (height / ((2 * Math.PI * radius) / around)) * 1.15) },
        uLit: { value: new THREE.Color(level === "critical" ? "#c48a5c" : "#d0a077") },
        uShade: { value: new THREE.Color(level === "critical" ? "#4a2a1a" : "#5e3b27") },
        uFade: { value: 1 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `${ATMO_GLSL}
        uniform sampler2D uCloud; uniform float uTime, uFade; uniform vec2 uTile; uniform vec3 uLit, uShade, uDust;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 to = vW - cameraPosition; float dist = length(to); vec3 V = to / dist;
          // billows at three sizes, the big ones rolling slowly upward and round, the small ones faster
          vec2 p = vUv * uTile; float t = uTime;
          vec4 a = texture2D(uCloud, p + vec2(t * 0.0016, -t * 0.0038));
          vec4 b = texture2D(uCloud, p * 2.6 + vec2(-t * 0.003, -t * 0.011) + (a.ba - 0.5) * 0.08);
          float n = a.r * 0.62 + b.r * 0.38; vec2 g = (a.ba - 0.5) * 0.62 + (b.ba - 0.5) * 0.38;
          #if LAYERS > 2
          vec4 c = texture2D(uCloud, p * 6.3 + vec2(t * 0.006, -t * 0.027) + (b.ba - 0.5) * 0.05);
          n = n * 0.82 + c.r * 0.18; g = g * 0.82 + (c.ba - 0.5) * 0.18;
          #endif
          // each billow is a bump on the wall: light it from the Sun, and from the sky above
          vec3 T = vec3(-vN.z, 0.0, vN.x);
          vec3 N = normalize(vN - (T * g.x + vec3(0.0, 1.0, 0.0) * g.y) * 2.6);
          float sun = dot(N, uSun) * 0.5 + 0.5, sky = N.y * 0.5 + 0.5;
          float h = vUv.y;
          vec3 col = mix(uShade, uLit, sun * sun) * (0.82 + sky * 0.3);
          col *= mix(0.74, 1.0, smoothstep(0.08, 0.6, n));         // the creases between billows are in shade
          col *= mix(0.62, 1.06, smoothstep(0.0, 0.45, h));        // the foot is dense and dark
          col = mix(col, uDust * 0.9, 0.22);                      // dust in front of the wall veils it
          // dust is thick low down and thins upward into a ragged top
          float top = 1.0 - smoothstep(0.42, 1.0, h + (0.5 - n) * 0.6);
          float body = smoothstep(0.08, 0.5, n + (1.0 - h) * 0.75);
          float rim = smoothstep(0.02, 0.42, abs(dot(V, vN)));    // soft where the wall curves away
          float al = body * top * rim * smoothstep(0.0, 0.03, h) * uFade;
          // light from behind makes the thin top glow
          col += uSunGlow * pow(max(dot(V, uSun), 0.0), 6.0) * (1.0 - body * top) * 0.25;
          gl_FragColor = vec4(col, al * 0.97);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(atmoFog(V), 1.0)).rgb, atmoFogAmount(dist) * 0.85);
        }`,
    });
  }, [radius, height, level]);
  useEffect(() => () => mat.dispose(), [mat]);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    // from inside there is no wall to see: the haze and the flying dust take over
    const d = Math.hypot(rt.pose.x - at.x, rt.pose.z - at.z) - radius;
    mat.uniforms.uFade.value = THREE.MathUtils.smoothstep(d, 4, 40);
    if (mesh.current) mesh.current.visible = d > 4;
  });
  return <mesh ref={mesh} geometry={geo} material={mat} position={[at.x, groundY(hm, at.x, at.z), at.z]} renderOrder={6} />;
}

// ------------------------------------------------------------------------------------------------
export function DustDevil({ hm, at, radius, rt }: { hm: Heightmap; at: P2; radius: number; rt: EvaRuntime }) {
  const r0 = THREE.MathUtils.clamp(radius * 0.07, 2.5, 14), height = THREE.MathUtils.clamp(radius * 3.2, 120, 700);
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, QSEG, 24, true);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, fog: false,
    uniforms: { ...atmoUniforms(), uSize: { value: new THREE.Vector2(r0, height) }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `uniform vec2 uSize, uWind; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vUv = uv; float h = uv.y;
        // narrow at the ground with a flared skirt, widening and leaning downwind as it rises, swaying
        float ang = atan(position.z, position.x);
        float r = uSize.x * (0.55 + 0.75 * pow(h, 0.7) + 1.6 * exp(-h * 22.0)) * (1.0 + 0.16 * sin(ang * 3.0 + h * 26.0 - uTime * 2.3) + 0.1 * sin(ang * 5.0 - h * 41.0 + uTime * 1.6));
        vec3 p = vec3(position.x * r, h * uSize.y, position.z * r);
        vec2 lean = uWind * (h * h * uSize.y * 0.22) + vec2(sin(uTime * 0.6 + h * 5.0), cos(uTime * 0.47 + h * 4.0)) * (uSize.x * 0.5 * h);
        p.xz += lean;
        vN = normalize(vec3(position.x, 0.0, position.z));
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `${ATMO_GLSL}
      uniform sampler2D uCloud; uniform float uTime, uFade; uniform vec3 uDust;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 to = vW - cameraPosition; float dist = length(to); vec3 V = to / dist;
        float h = vUv.y, t = uTime;
        // dust winding up the column: fast round, slower upward
        float a = texture2D(uCloud, vec2(vUv.x * 3.0 - t * 0.33 + h * 2.0, h * 3.0 - t * 0.12)).r;
        float b = texture2D(uCloud, vec2(vUv.x * 7.0 - t * 0.55 + h * 5.0, h * 9.0 - t * 0.3)).g;
        float n = a * 0.75 + b * 0.5;
        float facing = abs(dot(V, vN));
        // a hollow tube of dust: more of it along the line of sight near the limbs
        float tube = mix(1.0, 0.5, smoothstep(0.25, 1.0, facing)) * smoothstep(0.0, 0.16, facing);
        float al = smoothstep(0.34, 0.9, n + (1.0 - h) * 0.3) * tube * (1.0 - smoothstep(0.45, 1.0, h)) * smoothstep(0.0, 0.015, h);
        float sun = dot(vN, uSun) * 0.5 + 0.5;
        vec3 col = uDust * mix(0.5, 1.05, sun) * (0.62 + n * 0.55);
        gl_FragColor = vec4(col, al * (0.34 + 0.4 * (1.0 - h) * (1.0 - h)) * uFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(atmoFog(V), 1.0)).rgb, atmoFogAmount(dist) * 0.8);
      }`,
  }), [r0, height]);
  useEffect(() => () => mat.dispose(), [mat]);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    // it wanders inside its area
    const t = ATMO.uTime.value, w = Math.max(0, radius - r0 * 3) * 0.45;
    const x = at.x + Math.sin(t * 0.031 + radius) * w, z = at.z + Math.cos(t * 0.023 + radius * 0.7) * w;
    m.position.set(x, groundY(hm, x, z) - 0.5, z);
    mat.uniforms.uFade.value = THREE.MathUtils.smoothstep(Math.hypot(rt.pose.x - x, rt.pose.z - z), r0 * 1.5, r0 * 4);
  });
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />;
}
const QSEG = Q.wallSeg >> 1;

// ------------------------------------------------------------------------------------------------
/** sand streaks on the wind and drifting billows of dust round the astronaut; nothing is drawn in clear air */
export function WindDust() {
  const { streaks, sheets } = useMemo(() => {
    const quad = (n: number) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const seed = new Float32Array(n * 4);
      let s = 987654321;
      for (let i = 0; i < seed.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; seed[i] = s / 4294967296; }
      g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
      g.instanceCount = n;
      return g;
    };
    const common = { transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide } as const;
    // --- grains: each a short ribbon along the wind, in a box that travels with the head
    const streakMat = new THREE.ShaderMaterial({
      ...common, uniforms: atmoUniforms(),
      vertexShader: /* glsl */ `attribute vec4 aSeed; uniform vec3 uEye, uLampPos, uLampDir; uniform vec2 uWind; uniform float uDrift, uStorm, uTime, uGust, uLamp;
        varying vec2 vQ; varying float vA; varying float vBig; varying float vLit;
        const vec3 BOX = vec3(30.0, 9.0, 30.0);
        void main(){
          vec3 wind = normalize(vec3(uWind.x, 0.0, uWind.y));
          float pace = 0.55 + aSeed.w * 0.9;
          vec3 home = vec3(aSeed.x, aSeed.y * aSeed.y, aSeed.z) * BOX + wind * (uDrift * pace);
          home.y += sin(uTime * (1.0 + aSeed.w * 2.0) + aSeed.x * 40.0) * 0.25 - uTime * 0.05 * aSeed.z;
          vec3 c = uEye + mod(home - uEye + BOX * vec3(0.5, 0.22, 0.5), BOX) - BOX * vec3(0.5, 0.22, 0.5);
          vec3 rel = c - uEye; float d = length(rel);
          // longer and brighter in a stronger wind; a gust tips them up and down a little
          vec3 along = normalize(wind + vec3(0.0, (aSeed.y - 0.5) * 0.35 + sin(uTime * 0.7 + aSeed.z * 9.0) * 0.08, 0.0));
          vec3 side = normalize(cross(along, rel));
          // one in twelve is a bigger grain or a clump of them: darker, and it comes at you
          vBig = step(0.917, aSeed.x) * uStorm;
          float len = (0.05 + uStorm * 0.3) * pace * (1.0 + uGust * 1.3), wid = (0.006 + aSeed.x * 0.014 + d * 0.0012) * (1.0 + vBig * 2.2);
          vec3 p = c + along * (position.x * len) + side * (position.y * wid);
          vQ = position.xy * 2.0;
          vA = smoothstep(0.35, 1.6, d) * (1.0 - smoothstep(10.0, 15.0, d)) * step(aSeed.w, 0.15 + uStorm * 0.85) * (0.75 + uGust * 0.7);
          // grains crossing the lamps' beam flare up
          vec3 fromLamp = c - uLampPos; float ld = length(fromLamp);
          vLit = uLamp * smoothstep(0.86, 0.95, dot(fromLamp / ld, uLampDir)) * 1.6 / (1.0 + ld * ld * 0.2) * (1.0 - vBig);
          if (vA <= 0.0) p = c;                                  // nothing to draw: no pixels
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uDust; uniform float uStorm; varying vec2 vQ; varying float vA; varying float vBig; varying float vLit;
        void main(){
          float a = (1.0 - vQ.y * vQ.y) * (1.0 - vQ.x * vQ.x) * vA * (0.16 + uStorm * 0.32) * (1.0 + vBig) * (1.0 + vLit * 0.8);
          gl_FragColor = vec4(uDust * mix(1.25, 0.5, vBig) + vec3(1.0, 0.9, 0.76) * vLit, min(a, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    // --- billows: big soft sheets of denser dust blowing through, facing the head
    const sheetMat = new THREE.ShaderMaterial({
      ...common, uniforms: atmoUniforms(),
      vertexShader: /* glsl */ `attribute vec4 aSeed; uniform vec3 uEye; uniform vec2 uWind; uniform float uDrift, uStorm, uTime, uGust;
        varying vec2 vQ; varying vec2 vUv; varying float vA; varying vec3 vV;
        const vec3 BOX = vec3(70.0, 10.0, 70.0);
        void main(){
          vec3 wind = vec3(uWind.x, 0.0, uWind.y);
          vec3 home = aSeed.xyz * BOX + wind * (uDrift * (0.45 + aSeed.w * 0.35));
          vec3 c = uEye + mod(home - uEye + BOX * vec3(0.5, 0.3, 0.5), BOX) - BOX * vec3(0.5, 0.3, 0.5);
          vec3 rel = c - uEye; float d = length(rel);
          vec3 fwd = rel / max(d, 0.001), right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd)), up = cross(fwd, right);
          vec2 size = vec2(15.0 + aSeed.w * 12.0, 7.0 + aSeed.x * 5.0);
          vec3 p = c + right * (position.x * size.x) + up * (position.y * size.y);
          vQ = position.xy * 2.0; vUv = position.xy * vec2(0.6, 0.3) + aSeed.zw * 7.0 + vec2(uTime * 0.01, 0.0);
          // never right in the face (it would flash by), gone before the haze hides it anyway
          vA = smoothstep(5.0, 13.0, d) * (1.0 - smoothstep(24.0, 34.0, d)) * uStorm * uStorm * (0.6 + uGust * 0.9);
          if (vA <= 0.002) p = c;
          vV = normalize(p - uEye);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `${ATMO_GLSL}
        uniform sampler2D uCloud; uniform vec3 uDust; varying vec2 vQ; varying vec2 vUv; varying float vA; varying vec3 vV;
        void main(){
          float n = texture2D(uCloud, vUv).g;
          float soft = (1.0 - smoothstep(0.2, 1.0, length(vQ))) * smoothstep(0.25, 0.7, n);
          // lit dust towards the Sun, the haze's own colour elsewhere
          vec3 col = mix(uHorizon * 0.9, uDust * 1.15, 0.35 + 0.5 * pow(max(dot(vV, uSun), 0.0), 3.0));
          gl_FragColor = linearToOutputTexel(vec4(col, soft * vA * 0.5));
        }`,
    });
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => { const o = new THREE.Mesh(g, m); o.frustumCulled = false; o.renderOrder = order; o.visible = false; return o; };
    return { streaks: mk(quad(Q.streaks), streakMat, 52), sheets: mk(quad(Q.sheets), sheetMat, 51) };
  }, []);
  useEffect(() => () => { for (const o of [streaks, sheets]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }, [streaks, sheets]);
  useFrame(() => { streaks.visible = air.storm > 0.04; sheets.visible = air.storm > 0.3; });
  return <><primitive object={sheets} /><primitive object={streaks} /></>;
}

// ------------------------------------------------------------------------------------------------
/**
 * Sand hitting the visor: grains flash as short pale scratches on the glass in front of the eyes and
 * are gone in a tenth of a second — a few a second in a storm, a hail of them in a squall. Fixed to
 * the head, half a metre out; placed and timed in the shader.
 */
export function VisorGrit() {
  const camera = useThree((s) => s.camera);
  const mesh = useMemo(() => {
    const n = Q.streaks > 600 ? 64 : 40, g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(n * 4);
    let s = 24681357;
    for (let i = 0; i < seed.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; seed[i] = s / 4294967296; }
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: ATMO.uTime, uStorm: ATMO.uStorm, uGust: ATMO.uGust, uDust: ATMO.uDust },
      vertexShader: /* glsl */ `attribute vec4 aSeed; uniform float uTime, uStorm, uGust; varying vec2 vQ; varying float vA;
        void main(){
          float every = 0.45 + aSeed.w * 1.1, ph = uTime / every + aSeed.z * 7.0, cyc = mod(floor(ph), 251.0), age = fract(ph) * every;
          // a new place on the glass each time
          vec2 r = fract(sin(vec2(cyc * 12.9898 + aSeed.x * 78.233, cyc * 39.346 + aSeed.y * 11.135)) * 43758.5453);
          float yaw = (r.x - 0.5) * 1.75, pitch = (r.y - 0.5) * 1.5;
          vec3 c = vec3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)) * 0.55;
          float ang = r.y * 6.2832; vec2 dir = vec2(cos(ang), sin(ang));
          float size = 0.0035 + aSeed.x * 0.006;
          // more of them the harder it blows; none outside thick dust
          vA = (1.0 - smoothstep(0.0, 0.11, age)) * uStorm * uStorm * uStorm * step(aSeed.z, 0.12 + uGust * 1.1);
          vec3 p = c + vec3(dir, 0.0) * (position.x * size * (2.0 + aSeed.y * 4.0)) + vec3(-dir.y, dir.x, 0.0) * (position.y * size);
          if (vA <= 0.003) p = c;
          vQ = position.xy * 2.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uDust; varying vec2 vQ; varying float vA;
        void main(){
          float a = (1.0 - vQ.y * vQ.y) * (1.0 - abs(vQ.x)) * vA * 0.75;
          gl_FragColor = linearToOutputTexel(vec4(uDust * 1.7 + 0.12, a)); }`,
    });
    const o = new THREE.Mesh(g, m);
    o.frustumCulled = false; o.renderOrder = 998; o.visible = false;
    return o;
  }, []);
  useEffect(() => {
    camera.add(mesh);
    return () => { camera.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); };
  }, [camera, mesh]);
  useFrame(() => { mesh.visible = air.storm > 0.55; });
  return null;
}
