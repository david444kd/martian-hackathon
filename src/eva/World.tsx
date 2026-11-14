// The surface around the astronaut, beyond the zone's measured terrain and photo (astro/Scene.tsx):
// the sky dome, sunlight, scattered rocks near your boots, the base habitat, the route's ground
// markers, the target beacon and airborne dust in a storm. Rocks, the habitat and the dust are
// authored visual dressing placed on the measured ground: not surveyed objects or weather data.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { groundY, pointAlong, type P2, type Polyline } from "./frame";
import type { EvaRuntime } from "./runtime";

// ------------------------------------------------------------------------------------------------
// sky: butterscotch near the horizon, darker and browner overhead; a storm turns it all to murk
const HORIZON = new THREE.Color("#d9a27a"), ZENITH = new THREE.Color("#8a5d48");
const STORM_H = new THREE.Color("#7a5236"), STORM_Z = new THREE.Color("#4a3123");

export function skyColors(storm: number) {
  return { horizon: HORIZON.clone().lerp(STORM_H, storm), zenith: ZENITH.clone().lerp(STORM_Z, storm) };
}

export function Sky({ storm, sunDir }: { storm: number; sunDir: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { horizon: { value: HORIZON.clone() }, zenith: { value: ZENITH.clone() }, sun: { value: new THREE.Vector3(0, 1, 0) }, storm: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sun; uniform float storm; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0., 1.);
        vec3 c = mix(horizon, zenith, pow(h, .55));
        float s = max(dot(normalize(vDir), normalize(sun)), 0.);
        // Mars' sunsets are blue around the Sun: a pale bluish-white glow, dimmed by dust
        c += (vec3(.85,.9,1.) * pow(s, 900.) * 2.2 + vec3(.55,.62,.75) * pow(s, 24.) * .35) * (1. - storm * .85);
        c = mix(c, horizon * .9, clamp(-vDir.y * 4., 0., 1.));
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ camera }) => {
    const { horizon, zenith } = skyColors(storm);
    mat.uniforms.horizon.value.copy(horizon); mat.uniforms.zenith.value.copy(zenith);
    mat.uniforms.sun.value.copy(sunDir); mat.uniforms.storm.value = storm;
    camera.getWorldPosition(ref.current!.position);
  });
  return <mesh ref={ref} material={mat} renderOrder={-10} frustumCulled={false}><sphereGeometry args={[30000, 48, 24]} /></mesh>;
}

// ------------------------------------------------------------------------------------------------
// rocks: deterministic per 6 m cell, regenerated around the astronaut as they walk
const CELL = 5, RADIUS = 80, MAX_ROCKS = 1800;

function hash(x: number, z: number, k: number) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(k, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function rockGeometry(seed: number) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // same displacement for vertices at the same place (the geometry is non-indexed): no cracks
    const n = 0.78 + hash(Math.round(v.x * 4), Math.round(v.z * 4) + seed * 7, Math.round(v.y * 4)) * 0.38
      + hash(Math.round(v.x * 9), Math.round(v.z * 9), Math.round(v.y * 9) + seed) * 0.1;
    v.multiplyScalar(n);
    v.y = v.y > 0 ? v.y * 0.78 : v.y * 0.4; // a bit flattened, sitting in the regolith
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function Rocks({ hm, rt, route }: { hm: Heightmap; rt: EvaRuntime; route: Polyline | null }) {
  const geos = useMemo(() => [0, 1, 2].map(rockGeometry), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8b5d40", roughness: 0.96, metalness: 0, flatShading: true }), []);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const last = useRef({ cx: NaN, cz: NaN, route: null as Polyline | null });
  const o = useMemo(() => new THREE.Object3D(), []), c = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => { geos.forEach((g) => g.dispose()); mat.dispose(); }, [geos, mat]);

  useFrame(() => {
    const cx = Math.round(rt.pose.x / 16), cz = Math.round(rt.pose.z / 16);
    if (cx === last.current.cx && cz === last.current.cz && route === last.current.route) return;
    last.current = { cx, cz, route };
    const counts = [0, 0, 0];
    const x0 = Math.floor((rt.pose.x - RADIUS) / CELL), x1 = Math.floor((rt.pose.x + RADIUS) / CELL);
    const z0 = Math.floor((rt.pose.z - RADIUS) / CELL), z1 = Math.floor((rt.pose.z + RADIUS) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = Math.floor(hash(i, j, 1) * 4.2);
      for (let r = 0; r < k; r++) {
        const x = (i + hash(i, j, 10 + r)) * CELL, z = (j + hash(i, j, 20 + r)) * CELL;
        if (Math.hypot(x - rt.pose.x, z - rt.pose.z) > RADIUS) continue;
        if (rt.solid.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.5)) continue; // not inside buildings or buttes
        const big = hash(i, j, 30 + r) > 0.965;
        const size = big ? 0.35 + hash(i, j, 40 + r) * 0.45 : 0.04 + hash(i, j, 40 + r) ** 2.4 * 0.3;
        // keep the walking line clear of the bigger stones
        if (route && size > 0.2) {
          let near = false;
          for (let q = 0; q < route.pts.length - 1 && !near; q++) near = segDist(route.pts[q], route.pts[q + 1], { x, z }) < 2.5;
          if (near) continue;
        }
        const v = Math.floor(hash(i, j, 50 + r) * 3), m = refs.current[v];
        if (!m || counts[v] >= MAX_ROCKS) continue;
        o.position.set(x, groundY(hm, x, z) - size * 0.12, z);
        o.rotation.set((hash(i, j, 60 + r) - 0.5) * 0.5, hash(i, j, 70 + r) * Math.PI * 2, (hash(i, j, 80 + r) - 0.5) * 0.5);
        o.scale.set(size * (0.8 + hash(i, j, 90 + r) * 0.6), size, size * (0.8 + hash(i, j, 95 + r) * 0.5));
        o.updateMatrix();
        m.setMatrixAt(counts[v], o.matrix);
        const shade = 0.72 + hash(i, j, 99 + r) * 0.45;
        m.setColorAt(counts[v], c.setRGB(shade, shade * 0.97, shade * 0.93));
        counts[v]++;
      }
    }
    refs.current.forEach((m, v) => {
      if (!m) return;
      m.count = counts[v];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    });
  });

  return <>{geos.map((g, v) => <instancedMesh key={v} ref={(m) => { refs.current[v] = m; }} args={[g, mat, MAX_ROCKS]} frustumCulled={false} castShadow receiveShadow />)}</>;
}

function segDist(a: P2, b: P2, p: P2) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

// ------------------------------------------------------------------------------------------------
// the route on the ground: chevrons every 3 m and a dashed line for the next ~70 m, fading out near
// your boots and in the distance (projected guidance, like a helmet display: no marks on the ground)
function chevron() {
  const s = new THREE.Shape();
  s.moveTo(-0.32, -0.2); s.lineTo(0, 0.16); s.lineTo(0.32, -0.2); s.lineTo(0.25, -0.26); s.lineTo(0, 0.04); s.lineTo(-0.25, -0.26); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

function fadeMaterial(color: string, opacity: number, viewer: THREE.Vector3) {
  const m = new THREE.MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  m.customProgramCacheKey = () => "eva-guide-fade";
  m.onBeforeCompile = (sh) => {
    sh.uniforms.viewer = { value: viewer };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vW;").replace("#include <begin_vertex>",
      "#include <begin_vertex>\nvec4 wp = vec4(position,1.);\n#ifdef USE_INSTANCING\nwp = instanceMatrix * wp;\n#endif\nvW = (modelMatrix * wp).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 viewer;\nvarying vec3 vW;").replace("#include <alphatest_fragment>",
      "float gd = distance(vW.xz, viewer.xz);\ndiffuseColor.a *= smoothstep(1.2, 3.5, gd) * (1. - smoothstep(45., 75., gd));\n#include <alphatest_fragment>");
  };
  return m;
}

/** the whole route as a thin line over the ground, for orientation far away; gone near your boots */
export function RouteTube({ geo, color }: { geo: THREE.BufferGeometry; color: string }) {
  const viewer = useMemo(() => new THREE.Vector3(), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.viewer = { value: viewer };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vW;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvW = (modelMatrix * vec4(position,1.)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 viewer;\nvarying vec3 vW;").replace("#include <alphatest_fragment>",
        "diffuseColor.a *= smoothstep(40., 90., distance(vW.xz, viewer.xz));\n#include <alphatest_fragment>");
    };
    m.customProgramCacheKey = () => "eva-route-tube";
    return m;
  }, [color, viewer]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ camera }) => { camera.getWorldPosition(viewer); });
  return <mesh geometry={geo} material={mat} />;
}

export function GroundGuide({ hm, rt, line, color }: { hm: Heightmap; rt: EvaRuntime; line: Polyline | null; color: string }) {
  const arrows = useRef<THREE.InstancedMesh>(null), dashes = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(chevron, []);
  const viewer = useMemo(() => new THREE.Vector3(), []);
  const mats = useMemo(() => ({ arrow: fadeMaterial(color, 0.92, viewer), dash: fadeMaterial(color, 0.55, viewer) }), [color, viewer]);
  useEffect(() => () => { mats.arrow.dispose(); mats.dash.dispose(); }, [mats]);
  useEffect(() => () => geo.dispose(), [geo]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const last = useRef("");
  useFrame(({ camera }) => {
    camera.getWorldPosition(viewer);
    const a = arrows.current, d = dashes.current;
    if (!a || !d) return;
    if (!line || line.pts.length < 2) { a.count = 0; d.count = 0; return; }
    const key = `${line.length}-${Math.round(rt.progress)}`;
    if (key === last.current) return;
    last.current = key;
    const from = Math.floor(rt.progress / 3) * 3;
    let n = 0;
    for (let m = from + 3; m <= Math.min(line.length, rt.progress + 75) && n < 40; m += 3) {
      const { p, dir } = pointAlong(line, m);
      o.position.set(p.x, groundY(hm, p.x, p.z) + 0.06, p.z);
      o.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
      o.scale.setScalar(1);
      o.updateMatrix(); a.setMatrixAt(n++, o.matrix);
    }
    a.count = n; a.instanceMatrix.needsUpdate = true; a.computeBoundingSphere();
    let k = 0;
    for (let m = Math.floor(rt.progress) + 1.5; m <= Math.min(line.length, rt.progress + 75) && k < 80; m += 1) {
      if (Math.abs(((m % 3) + 3) % 3) < 0.6) continue; // leave room for the chevrons
      const { p, dir } = pointAlong(line, m);
      o.position.set(p.x, groundY(hm, p.x, p.z) + 0.05, p.z);
      o.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
      o.updateMatrix(); d.setMatrixAt(k++, o.matrix);
    }
    d.count = k; d.instanceMatrix.needsUpdate = true; d.computeBoundingSphere();
  });
  return (
    <>
      <instancedMesh ref={arrows} args={[geo, mats.arrow, 40]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={dashes} args={[undefined, mats.dash, 80]} frustumCulled={false} renderOrder={3}>
        <boxGeometry args={[0.05, 0.01, 0.45]} />
      </instancedMesh>
    </>
  );
}

// ------------------------------------------------------------------------------------------------
/** a slim beacon mast with a blinking top over the route's end (target, or the base when returning) */
export function Beacon({ hm, at, color, height = 4 }: { hm: Heightmap; at: P2; color: string; height?: number }) {
  const y = groundY(hm, at.x, at.z);
  const top = useRef<THREE.MeshBasicMaterial>(null), halo = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const on = (clock.elapsedTime % 1.6) < 0.25;
    if (top.current) top.current.opacity = on ? 1 : 0.35;
    if (halo.current) halo.current.scale.setScalar(1 + ((clock.elapsedTime * 0.6) % 1) * 6);
  });
  return (
    <group position={[at.x, y, at.z]}>
      <mesh position={[0, height / 2, 0]}><cylinderGeometry args={[0.04, 0.06, height, 8]} /><meshStandardMaterial color="#cfc7b8" roughness={0.5} metalness={0.4} /></mesh>
      <mesh position={[0, height + 0.15, 0]}><sphereGeometry args={[0.16, 12, 8]} /><meshBasicMaterial ref={top} color={color} transparent /></mesh>
      <mesh ref={halo} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.4, 1.6, 48]} /><meshBasicMaterial color={color} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* a tall faint light column so it can be found from far away */}
      <mesh position={[0, 60, 0]}><cylinderGeometry args={[0.35, 0.35, 120, 8, 1, true]} /><meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------
/** airborne dust drifting past the visor; `storm` 0..1 */
export function Dust({ storm, windDeg }: { storm: number; windDeg: number }) {
  const N = 2600, BOX = 46, H = 16;
  const ref = useRef<THREE.Points>(null);
  const { geo, mat } = useMemo(() => {
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * BOX; pos[i * 3 + 1] = Math.random() * H; pos[i * 3 + 2] = (Math.random() - 0.5) * BOX; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: "#c89a72", size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    return { geo, mat };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const camPos = useMemo(() => new THREE.Vector3(), []);
  const { gl } = useThree();
  useFrame(({ camera, clock }, dt) => {
    const pts = ref.current;
    if (!pts) return;
    mat.opacity = Math.min(0.85, storm * 0.95);
    pts.visible = storm > 0.02;
    if (!pts.visible) return;
    (gl.xr.isPresenting ? gl.xr.getCamera() : camera).getWorldPosition(camPos);
    const p = geo.attributes.position as THREE.BufferAttribute, a = p.array as Float32Array;
    const w = (windDeg * Math.PI) / 180, speed = 4 + storm * 14, gust = 1 + Math.sin(clock.elapsedTime * 0.9) * 0.35;
    const vx = Math.sin(w) * speed * gust * dt, vz = -Math.cos(w) * speed * gust * dt;
    for (let i = 0; i < N; i++) {
      a[i * 3] += vx + (Math.random() - 0.5) * 0.05; a[i * 3 + 2] += vz + (Math.random() - 0.5) * 0.05;
      a[i * 3 + 1] += Math.sin(clock.elapsedTime * 2 + i) * 0.01 - 0.004;
      // wrap around the viewer
      const rx = a[i * 3] - camPos.x, rz = a[i * 3 + 2] - camPos.z;
      if (rx > BOX / 2) a[i * 3] -= BOX; else if (rx < -BOX / 2) a[i * 3] += BOX;
      if (rz > BOX / 2) a[i * 3 + 2] -= BOX; else if (rz < -BOX / 2) a[i * 3 + 2] += BOX;
      const ry = a[i * 3 + 1] - (camPos.y - 2);
      if (ry < 0) a[i * 3 + 1] += H; else if (ry > H) a[i * 3 + 1] -= H;
    }
    p.needsUpdate = true;
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={50} />;
}

// ------------------------------------------------------------------------------------------------
/**
 * A dust storm (or a dust devil) seen from outside: a towering wall of dust over its area, churning
 * and drifting round, ragged at the top, with flashes inside. Inside it the fog and the Dust particles
 * take over. A picture of the anomaly's area from the `events` row, not a simulation of the air.
 */
export function StormWall({ hm, at, radius, devil, level }: { hm: Heightmap; at: P2; radius: number; devil: boolean; level: string }) {
  const height = devil ? Math.min(900, radius * 4) : Math.min(1400, 500 + radius * 0.5);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { t: { value: 0 }, tint: { value: new THREE.Color(level === "critical" ? "#8a4a2c" : "#a8744c") }, devil: { value: devil ? 1 : 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; uniform float t; uniform float devil;
      void main(){ vUv = uv; vec3 p = position;
        // the wall leans and bulges as it turns
        float a = atan(p.z, p.x), k = 1. + .06 * sin(a * 3. + t * .3 + p.y * .004) + devil * .25 * sin(p.y * .02 - t * 2.);
        p.xz *= k * mix(1., .55 + .45 * uv.y, devil);
        vP = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vP; uniform float t; uniform vec3 tint; uniform float devil;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += noise(p)*a; p = p*2.03 + 7.; a *= .5; } return s; }
      void main(){
        float sp = mix(.02, .25, devil);
        vec2 q = vec2(vUv.x * mix(14., 5., devil) + t * sp, vUv.y * 3. - t * .03);
        float n = fbm(q + fbm(q * 1.7 - t * .02) * 1.3);
        float top = smoothstep(1., .35 + n * .45, vUv.y);        // ragged top
        float foot = smoothstep(0., .04, vUv.y);
        float body = .5 + n * .6;
        vec3 c = mix(tint * .55, tint * 1.5 + vec3(.12, .09, .05), n);
        c += vec3(1., .9, .7) * step(.985, hash(vec2(floor(t * 3.), floor(vUv.x * 24.)))) * smoothstep(.5, .1, vUv.y) * .5; // a flash low in the wall
        gl_FragColor = vec4(c, clamp(body * top * foot, 0., 1.) * mix(.86, .7, devil));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), [devil, level]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => { mat.uniforms.t.value = clock.elapsedTime; });
  const y = groundY(hm, at.x, at.z);
  return (
    <group position={[at.x, y - 20, at.z]}>
      <mesh material={mat} position={[0, height / 2, 0]} renderOrder={6}>
        <cylinderGeometry args={[radius, radius, height, 96, 24, true]} />
      </mesh>
      {/* a second, larger and fainter veil: depth */}
      <mesh material={mat} position={[0, height * 0.42, 0]} rotation={[0, 1.3, 0]} scale={[1.12, 0.84, 1.12]} renderOrder={5}>
        <cylinderGeometry args={[radius, radius, height, 64, 12, true]} />
      </mesh>
    </group>
  );
}
