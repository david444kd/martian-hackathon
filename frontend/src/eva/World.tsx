// Things on the surface around the astronaut, beyond the measured ground (Ground.tsx) and the air
// (atmo.tsx, Storm.tsx): scattered rocks near your boots, the route's ground markers and the target
// beacon. The rocks are authored visual dressing placed on the measured ground: not surveyed objects.
import { onSlope } from "./seat";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Heightmap } from "../lib/zones";
import { air } from "./atmo";
import { groundY, pointAlong, type P2, type Polyline } from "./frame";
import { Q } from "./quality";
import type { EvaRuntime } from "./runtime";
import { boulder } from "./textures";

const JITTER = new THREE.Quaternion(), JE = new THREE.Euler();

// ------------------------------------------------------------------------------------------------
// rocks: deterministic per 5 m cell, laid out again round the astronaut every 16 m they walk. Pebbles
// are only drawn close by, stones further, boulders furthest: what a headset can see of each.
const CELL = 5, MAX_SMALL = 420, MAX_BIG = 260;

function hash(x: number, z: number, k: number) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(k, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/**
 * An angular rock: a lumpy ball with a few flat faces broken off it (wind-cut basalt), flattened where
 * it sits in the regolith, dark on its sides and underneath, dusted orange on top.
 */
function rockGeometry(seed: number, detail: number) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("normal");
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3(), n = new THREE.Vector3();
  const cuts = Array.from({ length: 2 + (seed % 3) }, (_, k) => ({
    n: new THREE.Vector3(hash(seed, k, 1) - 0.5, hash(seed, k, 2) * 0.9 - 0.25, hash(seed, k, 3) - 0.5).normalize(),
    d: 0.62 + hash(seed, k, 4) * 0.3,
  }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // the same push for vertices at the same place (the ball is not indexed): no cracks
    const k = 0.74 + hash(Math.round(v.x * 2), Math.round(v.z * 2) + seed * 7, Math.round(v.y * 2)) * 0.4
      + hash(Math.round(v.x * 8), Math.round(v.z * 8), Math.round(v.y * 8) + seed) * 0.08;
    v.multiplyScalar(k);
    for (const c of cuts) { const over = v.dot(c.n) - c.d; if (over > 0) v.addScaledVector(c.n, -over); }
    v.y = v.y > 0 ? v.y * 0.8 : v.y * 0.35;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g = mergeVertices(g, 1e-3);
  g.computeVertexNormals();
  const pos = g.attributes.position, nor = g.attributes.normal, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    const dust = THREE.MathUtils.smoothstep(n.y, 0.25, 0.85) * (0.7 + hash(i, seed, 9) * 0.3);
    const shade = 0.5 + 0.5 * THREE.MathUtils.smoothstep(pos.getY(i), -0.2, 0.35);  // darker towards the ground
    c.setRGB((0.3 + dust * 0.24) * shade, (0.265 + dust * 0.14) * shade, (0.25 + dust * 0.07) * shade, THREE.SRGBColorSpace);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export function Rocks({ hm, rt, route }: { hm: Heightmap; rt: EvaRuntime; route: Polyline | null }) {
  // 0-2: pebbles and stones (80 triangles each); 3-4: boulders (320)
  const geos = useMemo(() => [rockGeometry(1, 1), rockGeometry(2, 1), rockGeometry(3, 1), rockGeometry(4, 2), rockGeometry(5, 2)], []);
  const mat = useMemo(() => {
    const t = boulder();
    return new THREE.MeshLambertMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true });
  }, []);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const last = useRef({ cx: NaN, cz: NaN, route: null as Polyline | null, solid: null as unknown });
  const o = useMemo(() => new THREE.Object3D(), []), c = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => { geos.forEach((g) => g.dispose()); mat.dispose(); }, [geos, mat]);

  useFrame(() => {
    const cx = Math.round(rt.pose.x / 16), cz = Math.round(rt.pose.z / 16);
    if (cx === last.current.cx && cz === last.current.cz && route === last.current.route && rt.solid === last.current.solid) return;
    last.current = { cx, cz, route, solid: rt.solid };
    const counts = [0, 0, 0, 0, 0], [rPebble, rStone, rBoulder] = Q.rocks;
    const x0 = Math.floor((rt.pose.x - rBoulder) / CELL), x1 = Math.floor((rt.pose.x + rBoulder) / CELL);
    const z0 = Math.floor((rt.pose.z - rBoulder) / CELL), z1 = Math.floor((rt.pose.z + rBoulder) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = Math.floor(hash(i, j, 1) * 4.2);
      for (let r = 0; r < k; r++) {
        const big = hash(i, j, 30 + r) > 0.93;
        const size = big ? 0.32 + hash(i, j, 40 + r) * 0.5 : 0.035 + hash(i, j, 40 + r) ** 2.4 * 0.27;
        const x = (i + hash(i, j, 10 + r)) * CELL, z = (j + hash(i, j, 20 + r)) * CELL;
        const d = Math.hypot(x - rt.pose.x, z - rt.pose.z);
        if (d > (big ? rBoulder : size > 0.11 ? rStone : rPebble)) continue;
        if (rt.solid.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + 1.5)) continue; // not inside buildings or buttes
        // keep the walking line clear of the bigger stones
        if (route && size > 0.2) {
          let near = false;
          for (let q = 0; q < route.pts.length - 1 && !near; q++) near = segDist(route.pts[q], route.pts[q + 1], { x, z }) < 2.5;
          if (near) continue;
        }
        const v = big ? 3 + Math.floor(hash(i, j, 50 + r) * 2) : Math.floor(hash(i, j, 50 + r) * 3), m = refs.current[v];
        if (!m || counts[v] >= (big ? MAX_BIG : MAX_SMALL)) continue;
        // stood on the slope where it lies (the ground's normal over the rock's own size), bedded in a little
        o.position.set(x, groundY(hm, x, z) - size * 0.14, z);
        onSlope(hm, x, z, hash(i, j, 70 + r) * Math.PI * 2, Math.max(0.5, size), o.quaternion);
        o.quaternion.multiply(JITTER.setFromEuler(JE.set((hash(i, j, 60 + r) - 0.5) * 0.3, 0, (hash(i, j, 80 + r) - 0.5) * 0.3)));
        o.scale.set(size * (0.8 + hash(i, j, 90 + r) * 0.7), size * (0.7 + hash(i, j, 93 + r) * 0.5), size * (0.8 + hash(i, j, 95 + r) * 0.5));
        o.updateMatrix();
        m.setMatrixAt(counts[v], o.matrix);
        const shade = 0.78 + hash(i, j, 99 + r) * 0.4, warm = hash(i, j, 97 + r) * 0.07;
        m.setColorAt(counts[v], c.setRGB(shade * (1 + warm), shade, shade * (1 - warm)));
        counts[v]++;
      }
    }
    refs.current.forEach((m, v) => {
      if (!m) return;
      m.count = counts[v];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    air.shadowDirty = true;
  });

  return <>{geos.map((g, v) => <instancedMesh key={v} ref={(m) => { refs.current[v] = m; }} args={[g, mat, v < 3 ? MAX_SMALL : MAX_BIG]} frustumCulled={false} castShadow receiveShadow />)}</>;
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
      onSlope(hm, p.x, p.z, Math.atan2(-dir.x, -dir.z), 0.6, o.quaternion);
      o.scale.setScalar(1);
      o.updateMatrix(); a.setMatrixAt(n++, o.matrix);
    }
    a.count = n; a.instanceMatrix.needsUpdate = true; a.computeBoundingSphere();
    let k = 0;
    for (let m = Math.floor(rt.progress) + 1.5; m <= Math.min(line.length, rt.progress + 75) && k < 80; m += 1) {
      if (Math.abs(((m % 3) + 3) % 3) < 0.6) continue; // leave room for the chevrons
      const { p, dir } = pointAlong(line, m);
      o.position.set(p.x, groundY(hm, p.x, p.z) + 0.05, p.z);
      onSlope(hm, p.x, p.z, Math.atan2(-dir.x, -dir.z), 0.6, o.quaternion);
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
  const slope = useMemo(() => onSlope(hm, at.x, at.z, 0, 3), [hm, at.x, at.z]);
  const top = useRef<THREE.MeshBasicMaterial>(null), halo = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const on = (clock.elapsedTime % 1.6) < 0.25;
    if (top.current) top.current.opacity = on ? 1 : 0.35;
    if (halo.current) halo.current.scale.setScalar(1 + ((clock.elapsedTime * 0.6) % 1) * 3);
  });
  return (
    <group position={[at.x, y, at.z]}>
      <mesh position={[0, height / 2, 0]}><cylinderGeometry args={[0.04, 0.06, height, 8]} /><meshStandardMaterial color="#cfc7b8" roughness={0.5} metalness={0.4} /></mesh>
      <mesh position={[0, height + 0.15, 0]}><sphereGeometry args={[0.16, 12, 8]} /><meshBasicMaterial ref={top} color={color} transparent /></mesh>
      {/* the pulse ring lies on the slope (and draws over the ground where the slope curves) */}
      <group quaternion={slope}>
        <mesh ref={halo} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
          <ringGeometry args={[1.4, 1.6, 48]} /><meshBasicMaterial color={color} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
        </mesh>
      </group>
      {/* a tall faint light column so it can be found from far away */}
      <mesh position={[0, 60, 0]}><cylinderGeometry args={[0.35, 0.35, 120, 8, 1, true]} /><meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}
