// Things built and placed on the surface, all authored visual dressing on the measured ground:
//  - the crew's outpost by its landing point: a lander habitat on a gold-foil descent stage with its
//    airlock facing the landing point (where you start), a lab module joined by a tunnel, gas tanks,
//    a solar farm, a comms mast with a dish, a weather station, cargo, a painted landing pad with
//    lights, and a six-wheeled pressurised rover with suitports;
//  - a science work site at the route's target: an instrument tripod, a drill, sample flags, a cache;
//  - layered sedimentary buttes (like those below Mount Sharp) around the zone, with talus.
// Textures are drawn in code (textures.ts). None of these are surveyed objects. The bigger ones are
// solid: the astronaut walks around them. Each is built from many small parts and then welded into one
// mesh per material (merge.tsx), so a whole outpost costs a headset a couple of dozen draw calls.
import { memo, useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Heightmap } from "../lib/zones";
import { groundY, slopeDeg, type P2, type Polyline } from "./frame";
import type { Closed } from "./runtime";
import { ATMO } from "./atmo";
import { Merged } from "./merge";
import { Q } from "./quality";
import { boulder, foil, hull, label, patch, solar, strata, tyre } from "./textures";

import { HAB_OFFSET, outpostSolids, ROVER } from "./layout";
import { drapedDisc, groundRange, seat } from "./seat";

function makeMats() {
  const h = hull([4, 1]), h2 = hull([2, 1]), f = foil([6, 2]), f1 = foil([2, 2]), sp = solar([1, 1]), ty = tyre();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  ty.map.repeat.set(6, 1); ty.normalMap.repeat.set(6, 1);
  return {
    hull: std({ map: h.map, normalMap: h.normalMap, roughnessMap: h.roughnessMap, roughness: 1, metalness: 0.1 }),
    hull2: std({ map: h2.map, normalMap: h2.normalMap, roughnessMap: h2.roughnessMap, roughness: 1, metalness: 0.1 }),
    white: std({ color: "#e6e1d6", roughness: 0.6, metalness: 0.05 }),
    foil: std({ map: f.map, normalMap: f.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.4, metalness: 0.9 }),
    foil1: std({ map: f1.map, normalMap: f1.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.38, metalness: 0.9 }),
    metal: std({ color: "#aeb2b5", roughness: 0.32, metalness: 1 }),
    steel: std({ color: "#6d7275", roughness: 0.5, metalness: 0.9 }),
    dark: std({ color: "#22272a", roughness: 0.6, metalness: 0.4 }),
    solar: std({ map: sp.map, normalMap: sp.normalMap, roughnessMap: sp.roughnessMap, roughness: 1, metalness: 0.7 }),
    glass: std({ color: "#0b161d", roughness: 0.04, metalness: 1, envMapIntensity: 1.6 }),
    lit: std({ color: "#1a1410", roughness: 0.15, metalness: 0.6, emissive: "#ffc98a", emissiveIntensity: 1.1 }),   // a window with the lights on inside
    orange: std({ color: "#d86f24", roughness: 0.55, metalness: 0.1 }),
    tyre: std({ map: ty.map, normalMap: ty.normalMap, normalScale: new THREE.Vector2(2, 2), roughness: 0.95, metalness: 0 }),
    hatch: std({ color: "#c9c5bb", roughness: 0.5, metalness: 0.35 }),
    yellow: std({ color: "#d9a514", roughness: 0.6, metalness: 0.1 }),
    lamp: new THREE.MeshBasicMaterial({ color: "#fff0cf" }),
    green: new THREE.MeshBasicMaterial({ color: "#6cff9a" }),
    red: new THREE.MeshBasicMaterial({ color: "#ff5a4a" }),
  };
}
type Mats = ReturnType<typeof makeMats>;
function useMats() {
  const m = useMemo(makeMats, []);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return m;
}

/** a light: a small bright bead (welded in with the rest) and a soft glow round it (Halos) */
interface Light { p: [number, number, number]; color: "lamp" | "green" | "red"; size: number; glow: number; blink?: boolean }
const LIGHT: Record<Light["color"], string> = { lamp: "#fff0cf", green: "#6cff9a", red: "#ff4a3a" };

/**
 * The glow of every light of an object in one draw call: a quad per light, facing the eye. Faint in
 * daylight; in dusty air the glows swell and carry further than the things they are fixed to, the way
 * lamps show through fog.
 */
function Halos({ lights }: { lights: Light[] }) {
  const mesh = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = new Float32Array(lights.length * 3), col = new Float32Array(lights.length * 3), info = new Float32Array(lights.length * 2), c = new THREE.Color();
    lights.forEach((l, i) => { at.set(l.p, i * 3); c.set(LIGHT[l.color]).toArray(col, i * 3); info[i * 2] = l.glow; info[i * 2 + 1] = l.blink ? 1 : 0; });
    g.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 3));
    g.setAttribute("aCol", new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute("aInfo", new THREE.InstancedBufferAttribute(info, 2));
    g.instanceCount = lights.length;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uStorm: ATMO.uStorm, uTime: ATMO.uTime, uFogDensity: ATMO.uFogDensity, uSun: ATMO.uSun },
      vertexShader: /* glsl */ `attribute vec3 aAt, aCol; attribute vec2 aInfo; uniform float uStorm, uTime, uFogDensity; uniform vec3 uSun;
        varying vec2 vQ; varying vec3 vC;
        void main(){
          vec4 mv = modelViewMatrix * vec4(aAt, 1.0);
          float dusk = max(uStorm * sqrt(uStorm), 1.0 - smoothstep(0.1, 0.4, uSun.y)), d = length(mv.xyz);
          float on = aInfo.y > 0.5 ? step(fract(uTime / 1.4), 0.5) : 1.0;
          mv.xy += position.xy * aInfo.x * (1.0 + dusk * 1.5);
          float k = uFogDensity * d * 0.4;
          vC = aCol * on * (0.05 + 0.95 * dusk) * exp(-k * k); vQ = position.xy * 2.0;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying vec2 vQ; varying vec3 vC;
        void main(){ float a = max(1.0 - length(vQ), 0.0); gl_FragColor = vec4(vC, a * a * a); }`,
    });
    const o = new THREE.Mesh(g, m);
    o.frustumCulled = false; o.renderOrder = 45;
    return o;
  }, [lights]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }, [mesh]);
  return <primitive object={mesh} />;
}

const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 4, r);

/**
 * The floor of a structure on legs or cradles: the HIGHEST ground under its footprint, so nothing of it
 * cuts into an uphill slope; its legs, cradles and skirts reach down to the ground wherever it is lower.
 */
const floorY = (hm: Heightmap, x: number, z: number, r: number) => groundRange(hm, x, z, r).hi;

/** a strut between two points */
function Strut({ a, b, r = 0.05, material }: { a: [number, number, number]; b: [number, number, number]; r?: number; material: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    return { pos: A.clone().add(B).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), len: d.length() };
  }, [a, b]);
  return <mesh position={pos} quaternion={quat} material={material}><cylinderGeometry args={[r, r, len, 8]} /></mesh>;
}

// ------------------------------------------------------------------------------------------------
export const Outpost = memo(function Outpost({ hm, home, onSolid }: { hm: Heightmap; home: P2; onSolid: (s: Closed[]) => void }) {
  const m = useMats();
  const H = { x: home.x, z: home.z + HAB_OFFSET };
  const y = floorY(hm, H.x, H.z, 5.8);
  // the lab module, the tanks and the rover sit on their own ground (heights relative to the habitat's floor)
  const LAB = { x: -17.2, r: 5.2 };
  const labY = floorY(hm, H.x + LAB.x, H.z, LAB.r) - y + 2.45;        // the module's axis
  const tank = groundRange(hm, H.x - 17, H.z - 6, 2.7), tankY = tank.hi - y, tankDrop = tank.hi - tank.lo;
  const rover = seat(hm, H.x + ROVER.x, H.z + ROVER.z, ROVER.yaw, 2.5, 1.65, 0.04);
  const cargo = seat(hm, H.x + 9.8, H.z + 9.3, 0.4, 1.9, 0.75, 0.04);
  /** ground height at an offset from the habitat, relative to its floor */
  const g = (dx: number, dz: number) => groundY(hm, H.x + dx, H.z + dz) - y;
  useEffect(() => { onSolid(outpostSolids(home)); }, [H.x, H.z]); // eslint-disable-line react-hooks/exhaustive-deps

  // every light of the outpost: airlock status and floods, the mast beacon, the pad's edge, the path, the rover's headlights
  const lights = useMemo<Light[]>(() => {
    const lamp = (lx: number, lz: number): [number, number, number] => {
      const v = new THREE.Vector3(lx, 1.55, lz).applyQuaternion(rover.q);
      return [ROVER.x + v.x, rover.y - y + v.y, ROVER.z + v.z];
    };
    return [
      { p: [0, 4.95, 5.47], color: "green", size: 0.06, glow: 0.7 },
      { p: [-1.3, 4.3, 5.47], color: "lamp", size: 0.055, glow: 1 }, { p: [1.3, 4.3, 5.47], color: "lamp", size: 0.055, glow: 1 },
      { p: [9, g(9, -13) + 15.2, -13], color: "red", size: 0.1, glow: 2.4, blink: true },
      ...Array.from({ length: 12 }, (_, k): Light => {
        const a = (k * Math.PI) / 6, px = Math.cos(a) * 10, pz = -36 + Math.sin(a) * 10;
        return { p: [px, g(px, pz) + 0.25, pz], color: k % 3 ? "lamp" : "green", size: 0.06, glow: 0.8 };
      }),
      ...[10.5, 13, 15.5].flatMap((z) => [-1.7, 1.7].map((x): Light => ({ p: [x, g(x, z) + 0.63, z], color: "lamp", size: 0.04, glow: 0.5 }))),
      ...[-0.75, 0.75].map((z): Light => ({ p: lamp(2.43, z), color: "lamp", size: 0.07, glow: 1.1 })),
    ];
  }, [hm, H.x, H.z]); // eslint-disable-line react-hooks/exhaustive-deps
  const dish = useMemo(() => new THREE.LatheGeometry(Array.from({ length: 12 }, (_, i) => new THREE.Vector2((i / 11) * 1.5, ((i / 11) ** 2) * 0.55)), 36), []);
  const padTex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const x = c.getContext("2d")!;
    x.fillStyle = "#3a3632"; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${150 + Math.random() * 60},${95 + Math.random() * 30},${60 + Math.random() * 20},${Math.random() * 0.22})`; x.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 5, 2 + Math.random() * 5); }
    x.strokeStyle = "#e9e2d0"; x.lineWidth = 14; x.beginPath(); x.arc(256, 256, 200, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = "#d86f24"; x.lineWidth = 10; x.beginPath(); x.arc(256, 256, 232, 0, Math.PI * 2); x.stroke();
    x.fillStyle = "#e9e2d0"; x.fillRect(196, 150, 26, 212); x.fillRect(290, 150, 26, 212); x.fillRect(196, 243, 120, 26);
    for (let k = 0; k < 8; k++) { x.save(); x.translate(256, 256); x.rotate((k * Math.PI) / 4); x.fillStyle = "#d86f24"; x.fillRect(-6, -246, 12, 26); x.restore(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => { dish.dispose(); padTex.dispose(); }, [dish, padTex]);
  const north = hm.zone.base.lat >= 0 ? 1 : -1; // panels tilt towards the equator
  const padGeo = useMemo(() => drapedDisc(hm, H.x, H.z - 36, y, 10, 0.06), [hm, H.x, H.z, y]);
  useEffect(() => () => padGeo.dispose(), [padGeo]);

  return (
    <group position={[H.x, y, H.z]}>
      <Merged deps={[hm, H.x, H.z]}>
        {lights.map((l, k) => <mesh key={`l${k}`} material={m[l.color]} position={l.p}><sphereGeometry args={[l.size, 8, 6]} /></mesh>)}
        {/* ---- descent stage: gold foil octagon on four legs */}
        <mesh material={m.foil} position={[0, 1.55, 0]}><cylinderGeometry args={[4.1, 3.7, 1.3, 8]} /></mesh>
        <mesh material={m.dark} position={[0, 0.72, 0]}><coneGeometry args={[1.1, 0.9, 20, 1, true]} /></mesh>
        {[0, 1, 2, 3].map((k) => {
          const a = (k * Math.PI) / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a), fy = g(c * 5.6, s * 5.6);
          return (
            <group key={k}>
              <Strut a={[c * 3.7, 1.9, s * 3.7]} b={[c * 5.6, fy + 0.12, s * 5.6]} r={0.09} material={m.metal} />
              <Strut a={[c * 3.4, 1.0, s * 3.4]} b={[c * 5.4, fy + 0.2, s * 5.4]} r={0.05} material={m.steel} />
              <Strut a={[Math.cos(a + 0.5) * 3.9, 1.3, Math.sin(a + 0.5) * 3.9]} b={[c * 5.4, fy + 0.3, s * 5.4]} r={0.04} material={m.steel} />
              <Strut a={[Math.cos(a - 0.5) * 3.9, 1.3, Math.sin(a - 0.5) * 3.9]} b={[c * 5.4, fy + 0.3, s * 5.4]} r={0.04} material={m.steel} />
              <mesh material={m.foil1} position={[c * 5.6, fy + 0.06, s * 5.6]}><cylinderGeometry args={[0.55, 0.65, 0.12, 20]} /></mesh>
            </group>
          );
        })}
        {/* ---- pressure vessel */}
        <mesh material={m.hull} position={[0, 3.85, 0]}><cylinderGeometry args={[3.35, 3.35, 3.3, 48]} /></mesh>
        <mesh material={m.metal} position={[0, 2.22, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[3.4, 0.09, 8, 48]} /></mesh>
        <mesh material={m.metal} position={[0, 5.5, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[3.38, 0.08, 8, 48]} /></mesh>
        <mesh material={m.hull2} position={[0, 5.5, 0]} scale={[1, 0.55, 1]}><sphereGeometry args={[3.35, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        {/* portholes: lit from inside */}
        {Array.from({ length: 7 }, (_, k) => {
          const a = Math.PI / 2 + ((k + 1) * Math.PI * 2) / 8, c = Math.cos(a), s = Math.sin(a);
          return (
            <group key={k} position={[c * 3.36, 4.3, s * 3.36]} rotation={[0, -a + Math.PI / 2, 0]}>
              <mesh material={k % 3 === 1 ? m.glass : m.lit} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.34, 0.34, 0.05, 24]} /></mesh>
              <mesh material={m.metal}><torusGeometry args={[0.36, 0.045, 8, 28]} /></mesh>
            </group>
          );
        })}
        {/* top: docking port, radiators, antennas */}
        <mesh material={m.metal} position={[0, 7.45, 0]}><cylinderGeometry args={[0.8, 0.95, 0.5, 24]} /></mesh>
        <mesh material={m.dark} position={[0, 7.72, 0]}><cylinderGeometry args={[0.6, 0.6, 0.06, 24]} /></mesh>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 3.45, 4.2, -1.2]} rotation={[0, s * 0.5, 0]}>
            <mesh material={m.white}><boxGeometry args={[0.06, 2.6, 1.8]} /></mesh>
            {[-0.9, -0.3, 0.3, 0.9].map((v) => <mesh key={v} material={m.metal} position={[0, v, 0]}><boxGeometry args={[0.09, 0.03, 1.84]} /></mesh>)}
          </group>
        ))}
        <Strut a={[1.6, 6.9, -1]} b={[1.9, 9.2, -1.2]} r={0.025} material={m.metal} />
        <Strut a={[-1.4, 6.9, 1]} b={[-1.4, 8.4, 1]} r={0.02} material={m.metal} />
        {/* lettering and the mission patch */}
        <mesh position={[2.42, 4.45, 2.42]} rotation={[0, Math.PI / 4, 0]}><planeGeometry args={[2.4, 0.6]} /><meshStandardMaterial map={label("ARES · HAB 1", { color: "#1f2c36" })} transparent roughness={0.8} polygonOffset polygonOffsetFactor={-4} /></mesh>
        <mesh position={[-2.42, 4.4, 2.42]} rotation={[0, -Math.PI / 4, 0]}><circleGeometry args={[0.55, 32]} /><meshStandardMaterial map={patch()} roughness={0.8} polygonOffset polygonOffsetFactor={-4} /></mesh>

        {/* ---- airlock towards the landing point (south): hatch, porch, ladder, handrails */}
        <mesh material={m.hull2} geometry={useMemo(() => rbox(2.3, 2.5, 2.4, 0.3), [])} position={[0, 3.45, 4.2]} />
        <mesh material={m.orange} position={[0, 4.6, 5.405]}><boxGeometry args={[1.9, 0.14, 0.02]} /></mesh>
        {/* the outer hatch: a frame, the door set into it, a window, the locking wheel with its spokes, hinges, hazard edging */}
        <mesh material={m.dark} geometry={useMemo(() => rbox(1.34, 2.04, 0.06, 0.2), [])} position={[0, 3.35, 5.39]} />
        <mesh material={m.hatch} geometry={useMemo(() => rbox(1.12, 1.82, 0.09, 0.18), [])} position={[0, 3.35, 5.41]} />
        <mesh material={m.metal} position={[0, 3.9, 5.46]}><torusGeometry args={[0.2, 0.035, 8, 28]} /></mesh>
        <mesh material={m.lit} position={[0, 3.9, 5.458]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.185, 0.185, 0.02, 24]} /></mesh>
        <mesh material={m.steel} position={[0, 3.12, 5.5]}><torusGeometry args={[0.21, 0.022, 8, 28]} /></mesh>
        {[0, 1, 2].map((k) => <mesh key={k} material={m.steel} position={[0, 3.12, 5.495]} rotation={[0, 0, (k * Math.PI) / 3]}><boxGeometry args={[0.42, 0.025, 0.02]} /></mesh>)}
        <mesh material={m.metal} position={[0, 3.12, 5.48]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.05, 0.06, 0.07, 14]} /></mesh>
        {[2.75, 3.95].map((h) => <mesh key={h} material={m.steel} position={[-0.6, h, 5.455]}><boxGeometry args={[0.1, 0.22, 0.05]} /></mesh>)}
        <mesh material={m.yellow} position={[0, 2.5, 5.462]}><boxGeometry args={[0.9, 0.06, 0.012]} /></mesh>
        <mesh position={[0, 2.68, 5.462]}><planeGeometry args={[0.7, 0.14]} /><meshStandardMaterial map={label("EVA HATCH", { color: "#2a2f33" })} transparent roughness={0.8} polygonOffset polygonOffsetFactor={-4} /></mesh>
        <mesh material={m.steel} position={[0, 2.3, 6.2]}><boxGeometry args={[2.2, 0.07, 1.6]} /></mesh>
        {[-1.05, 1.05].map((x) => (
          <group key={x}>
            <Strut a={[x, 2.3, 5.5]} b={[x, 3.3, 5.5]} r={0.025} material={m.metal} />
            <Strut a={[x, 2.3, 6.95]} b={[x, 3.3, 6.95]} r={0.025} material={m.metal} />
            <Strut a={[x, 3.3, 5.5]} b={[x, 3.3, 6.95]} r={0.025} material={m.metal} />
            <Strut a={[x * 0.5, 2.3, 7]} b={[x * 0.5, g(x * 0.5, 9.4) + 0.05, 9.4]} r={0.035} material={m.metal} />
            <Strut a={[x, 2.3, 6.95]} b={[x, g(x, 7) + 0.02, 7]} r={0.04} material={m.steel} />
          </group>
        ))}
        {Array.from({ length: 7 }, (_, k) => {
          const t = (k + 0.5) / 7, gy = g(0, 9.4) + 0.05;
          return <mesh key={k} material={m.steel} position={[0, 2.3 + (gy - 2.3) * t, 7 + 2.4 * t]}><boxGeometry args={[1.05, 0.04, 0.24]} /></mesh>;
        })}

        {/* ---- lab module on cradles, joined by a tunnel */}
        <group position={[LAB.x, labY, 0]}>
          <mesh material={m.hull} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[2.35, 2.35, 9, 40]} /></mesh>
          {[-1, 1].map((s) => <mesh key={s} material={m.hull2} position={[s * 4.5, 0, 0]} scale={[0.42, 1, 1]}><sphereGeometry args={[2.35, 32, 20]} /></mesh>)}
          {[-4.5, -1.5, 1.5, 4.5].map((x) => <mesh key={x} material={m.metal} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[2.37, 0.06, 8, 40]} /></mesh>)}
          {[-3, 0, 3].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              {(() => { const top = -2.15, foot = Math.min(g(LAB.x + x, -1.6), g(LAB.x + x, 1.6)) - labY - 0.25; return <mesh material={m.steel} position={[0, (top + foot) / 2, 0]}><boxGeometry args={[0.35, top - foot, 3.8]} /></mesh>; })()}
              <mesh material={m.lit} position={[0, 0.85, 2.21]} rotation={[-0.37, 0, 0]}><boxGeometry args={[1.1, 0.5, 0.05]} /></mesh>
              <mesh material={m.glass} position={[0, 0.85, -2.21]} rotation={[0.37, 0, 0]}><boxGeometry args={[1.1, 0.5, 0.05]} /></mesh>
            </group>
          ))}
          <mesh position={[0, -0.2, 2.36]}><planeGeometry args={[2, 0.5]} /><meshStandardMaterial map={label("LAB 2", { color: "#1f2c36" })} transparent roughness={0.8} polygonOffset polygonOffsetFactor={-4} /></mesh>
          <mesh material={m.solar} position={[0, 2.5, 0]}><boxGeometry args={[7, 0.05, 2.4]} /></mesh>
          <mesh material={m.metal} position={[0, 2.44, 0]}><boxGeometry args={[7.1, 0.06, 2.5]} /></mesh>
        </group>
        <Strut a={[-5.5, 3.1, 0]} b={[-12.9, labY + 0.5, 0]} r={1.05} material={m.foil1} />
        {[-6.2, -8.2, -10.2, -12.2].map((x) => {
          // a ring round the sloping tunnel: facing along it (+X turned up or down by the slope)
          const ty = 3.1 + ((x + 5.5) / -7.4) * (labY + 0.5 - 3.1), tilt = Math.atan2(-(labY + 0.5 - 3.1), 7.4);
          return <mesh key={x} material={m.metal} position={[x, ty, 0]} rotation={[0, Math.PI / 2, tilt, "ZYX"]}><torusGeometry args={[1.1, 0.07, 8, 28]} /></mesh>;
        })}
        {[-7.5, -11].map((x) => { const ty = 3.1 + ((x + 5.5) / -7.4) * (labY + 0.5 - 3.1); return <Strut key={x} a={[x, ty - 1, 0]} b={[x, g(x, 0) - 0.2, 0]} r={0.08} material={m.steel} />; })}

        {/* ---- gas tanks behind the lab: gold-wrapped spheres on a rack */}
        <group position={[-17, tankY, -6]}>
          {[-1.8, 0, 1.8].map((x, k) => (
            <group key={x} position={[x, 1.15, 0]}>
              <mesh material={k === 1 ? m.white : m.foil1}><sphereGeometry args={[0.85, 28, 20]} /></mesh>
              <mesh material={m.metal} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.86, 0.035, 8, 28]} /></mesh>
              <mesh material={m.steel} position={[0, -0.35 - (0.85 + tankDrop) / 2, 0]}><cylinderGeometry args={[0.5, 0.62, 0.85 + tankDrop, 12, 1, true]} /></mesh>
              <mesh material={m.metal} position={[0, 0.92, 0]}><cylinderGeometry args={[0.07, 0.07, 0.25, 10]} /></mesh>
            </group>
          ))}
          <Strut a={[-1.8, 2.15, 0]} b={[1.8, 2.15, 0]} r={0.035} material={m.metal} />
          <Strut a={[1.8, 2.15, 0]} b={[2.6, 2.15, 4.5]} r={0.035} material={m.metal} />
        </group>

        {/* ---- solar farm: 3 × 4 tilted arrays on frames, a cable run to the habitat */}
        {Array.from({ length: 12 }, (_, i) => {
          const cx = 18 + (i % 4) * 4.4, cz = -6.5 + Math.floor(i / 4) * 6, gy = g(cx, cz);
          return (
            <group key={i} position={[cx, gy, cz]}>
              {([[-1.4, 0.5, 2.25], [1.4, 0.5, 2.25], [-1.4, -0.9, 1.05], [1.4, -0.9, 1.05]] as const).map(([px, pz, top]) => (
                <Strut key={`${px}${pz}`} a={[px, g(cx + px, cz + pz * north) - gy - 0.15, pz * north]} b={[px, top, pz * north]} r={0.045} material={m.metal} />
              ))}
              <group position={[0, 1.7, -0.2 * north]} rotation={[north * 0.7, 0, 0]}>
                <mesh material={m.solar}><boxGeometry args={[3.9, 0.04, 2.4]} /></mesh>
                <mesh material={m.metal} position={[0, -0.04, 0]}><boxGeometry args={[4, 0.05, 2.5]} /></mesh>
              </group>
            </group>
          );
        })}
        <Strut a={[16, g(16, 0) + 0.04, 0]} b={[4.5, g(4.5, 0) + 0.04, 0]} r={0.04} material={m.dark} />

        {/* ---- comms mast: guyed, a dish towards the sky, a red beacon */}
        <group position={[9, g(9, -13), -13]}>
          <mesh material={m.metal} position={[0, 7.5, 0]}><cylinderGeometry args={[0.07, 0.2, 15, 10]} /></mesh>
          {[0, 1, 2].map((k) => { const gx = Math.cos((k * 2 * Math.PI) / 3) * 6, gz = Math.sin((k * 2 * Math.PI) / 3) * 6; return <Strut key={k} a={[0, 11, 0]} b={[gx, g(9 + gx, -13 + gz) - g(9, -13) + 0.05, gz]} r={0.012} material={m.steel} />; })}
          {[4, 8, 12].map((h) => <mesh key={h} material={m.steel} position={[0, h, 0]}><boxGeometry args={[0.7, 0.05, 0.05]} /></mesh>)}
          <group position={[0.2, 12.6, 0.5]} rotation={[0.95, 0.3, 0]}>
            <mesh material={m.white} geometry={dish} />
            <Strut a={[0, 0.55, 0]} b={[0, 1.25, 0]} r={0.03} material={m.metal} />
            <mesh material={m.foil1} position={[0, 1.3, 0]}><cylinderGeometry args={[0.1, 0.14, 0.2, 12]} /></mesh>
          </group>
          <mesh material={m.dark} position={[0, 0.5 + Math.max(0, g(9, -12.4) - g(9, -13)) - 0.3, 0.6]}><boxGeometry args={[0.8, 1.6, 0.6]} /></mesh>
        </group>

        {/* ---- weather station: mast, wind cups, a small panel */}
        <group position={[13, g(13, 10), 10]}>
          <mesh material={m.metal} position={[0, 1.6, 0]}><cylinderGeometry args={[0.03, 0.04, 3.2, 8]} /></mesh>
          <mesh material={m.white} position={[0, 2.2, 0]}><boxGeometry args={[0.3, 0.4, 0.3]} /></mesh>
          <Strut a={[-0.5, 3.1, 0]} b={[0.5, 3.1, 0]} r={0.012} material={m.metal} />
          {[-0.5, 0.5].map((x) => <mesh key={x} material={m.white} position={[x, 3.1, 0]}><sphereGeometry args={[0.07, 10, 8]} /></mesh>)}
          <mesh material={m.solar} position={[0, 1.2, 0.25]} rotation={[north * 0.7, 0, 0]}><boxGeometry args={[0.7, 0.03, 0.5]} /></mesh>
        </group>

        {/* ---- cargo: crates and a foil-wrapped container */}
        <group position={[9, cargo.y - y, 9]} rotation={cargo.r}>
          <mesh material={m.white} geometry={useMemo(() => rbox(1.6, 1, 1.1, 0.08), [])} position={[0, 0.5, 0]} />
          <mesh material={m.foil1} geometry={useMemo(() => rbox(1.2, 0.8, 1, 0.08), [])} position={[0.1, 1.4, 0]} />
          <mesh material={m.orange} position={[0, 0.5, 0.56]}><boxGeometry args={[1.5, 0.12, 0.02]} /></mesh>
          <mesh material={m.white} geometry={useMemo(() => rbox(1, 0.9, 1, 0.08), [])} position={[1.7, 0.45, 0.3]} />
          <mesh material={m.dark} position={[1.7, 0.92, 0.3]}><boxGeometry args={[0.6, 0.05, 0.2]} /></mesh>
        </group>

        {/* ---- landing pad, north of the outpost */}
        <mesh position={[0, 0, -36]} geometry={padGeo}><meshStandardMaterial map={padTex} roughness={0.95} /></mesh>

        <Rover m={m} at={[ROVER.x, rover.y - y, ROVER.z]} rotation={rover.r} />

        {/* ---- a flag by the airlock */}
        <group position={[3.6, g(3.6, 8), 8]}>
          <mesh material={m.metal} position={[0, 1.5, 0]}><cylinderGeometry args={[0.022, 0.028, 3, 8]} /></mesh>
          <Strut a={[0, 2.95, 0]} b={[0.95, 2.95, 0]} r={0.012} material={m.metal} />
          <mesh position={[0.48, 2.62, 0]}><planeGeometry args={[0.92, 0.62, 8, 4]} /><meshStandardMaterial map={label("ARES", { color: "#f2efe6", bg: "#27508f", w: 256, h: 172 })} side={THREE.DoubleSide} roughness={0.9} /></mesh>
        </group>
        {[10.5, 13, 15.5].map((z) => [-1.7, 1.7].map((x) => (
          <mesh key={`${x}${z}`} material={m.metal} position={[x, g(x, z) + 0.3, z]}><cylinderGeometry args={[0.02, 0.03, 0.6, 6]} /></mesh>
        )))}
      </Merged>
      <Halos lights={lights} />
    </group>
  );
});

/** a six-wheeled pressurised rover: rocker suspension, a windshield, roof radiator, two suitports at the back */
function Rover({ m, at, rotation }: { m: Mats; at: [number, number, number]; rotation: [number, number, number, "YXZ"] }) {
  const cabin = useMemo(() => rbox(3.5, 1.75, 2.35, 0.4), []), nose = useMemo(() => rbox(1.3, 1.25, 2.2, 0.35), []), chassis = useMemo(() => rbox(5.2, 0.34, 2, 0.1), []);
  useEffect(() => () => { cabin.dispose(); nose.dispose(); chassis.dispose(); }, [cabin, nose, chassis]);
  return (
    <group position={at} rotation={rotation}>
      {[-1.9, 0, 1.9].map((x) => [-1.4, 1.4].map((z) => (
        <group key={`${x}${z}`} position={[x, 0.62, z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={m.tyre}><cylinderGeometry args={[0.62, 0.62, 0.5, 32, 1, true]} /></mesh>
          <mesh material={m.dark}><cylinderGeometry args={[0.5, 0.5, 0.46, 24]} /></mesh>
          <mesh material={m.metal} position={[0, Math.sign(z) * 0.24, 0]}><cylinderGeometry args={[0.3, 0.34, 0.06, 20]} /></mesh>
          <mesh material={m.steel} position={[0, Math.sign(z) * 0.28, 0]}><cylinderGeometry args={[0.1, 0.1, 0.06, 10]} /></mesh>
        </group>
      )))}
      {[-1.12, 1.12].map((z) => (
        <group key={z}>
          <Strut a={[-1.9, 0.62, z]} b={[-0.6, 1.15, z]} r={0.07} material={m.steel} />
          <Strut a={[0, 0.62, z]} b={[-0.6, 1.15, z]} r={0.07} material={m.steel} />
          <Strut a={[-0.6, 1.15, z]} b={[1.9, 0.62, z]} r={0.07} material={m.steel} />
        </group>
      ))}
      <mesh material={m.dark} geometry={chassis} position={[0, 1.15, 0]} />
      <mesh material={m.hull2} geometry={cabin} position={[-0.5, 2.15, 0]} />
      <mesh material={m.hull2} geometry={nose} position={[1.75, 1.9, 0]} />
      {/* windshield and side windows */}
      <mesh material={m.glass} position={[2.05, 2.25, 0]} rotation={[0, 0, -0.42]}><boxGeometry args={[0.08, 0.9, 1.9]} /></mesh>
      <mesh material={m.metal} position={[2.03, 2.25, 0]} rotation={[0, 0, -0.42]}><boxGeometry args={[0.05, 1, 2]} /></mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh material={m.glass} position={[1.5, 2.3, s * 1.115]}><boxGeometry args={[0.8, 0.5, 0.05]} /></mesh>
          <mesh material={m.lit} position={[-0.3, 2.45, s * 1.185]}><boxGeometry args={[1.5, 0.42, 0.04]} /></mesh>
          <mesh material={m.orange} position={[-0.5, 1.55, s * 1.185]}><boxGeometry args={[3, 0.1, 0.03]} /></mesh>
        </group>
      ))}
      {/* suitports at the back */}
      {[-0.55, 0.55].map((z) => (
        <group key={z} position={[-2.27, 2.15, z]} rotation={[0, Math.PI / 2, 0]}>
          <mesh material={m.metal}><torusGeometry args={[0.4, 0.06, 10, 28]} /></mesh>
          <mesh material={m.dark} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.38, 0.38, 0.04, 28]} /></mesh>
        </group>
      ))}
      <mesh material={m.steel} position={[-2.75, 1.25, 0]}><boxGeometry args={[0.9, 0.06, 1.8]} /></mesh>
      {/* roof: radiator, antenna, mast camera */}
      <mesh material={m.white} position={[-0.6, 3.07, 0]}><boxGeometry args={[2.6, 0.05, 1.8]} /></mesh>
      <mesh material={m.solar} position={[-0.6, 3.1, 0]}><boxGeometry args={[2.4, 0.03, 1.6]} /></mesh>
      <Strut a={[0.9, 3.05, 0.7]} b={[0.9, 4.1, 0.7]} r={0.03} material={m.metal} />
      <mesh material={m.dark} position={[0.9, 4.2, 0.7]}><boxGeometry args={[0.3, 0.2, 0.4]} /></mesh>
      <Strut a={[-1.9, 3.05, -0.8]} b={[-1.9, 4.4, -0.8]} r={0.015} material={m.metal} />
      <mesh position={[-0.5, 1.95, 1.19]}><planeGeometry args={[1.5, 0.36]} /><meshStandardMaterial map={label("ROVER 1", { color: "#1f2c36" })} transparent roughness={0.8} polygonOffset polygonOffsetFactor={-4} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------
/** the work site at the route's target */
export const ScienceSite = memo(function ScienceSite({ hm, at }: { hm: Heightmap; at: P2 }) {
  const m = useMats();
  const y = groundY(hm, at.x, at.z);
  const g = (dx: number, dz: number) => groundY(hm, at.x + dx, at.z + dz) - y;
  const flags = useMemo(() => Array.from({ length: 7 }, (_, k) => ({ x: Math.cos(k * 1.1) * (3 + k * 0.8), z: Math.sin(k * 1.1) * (3 + k * 0.8) })), []);
  const box = useMemo(() => rbox(0.8, 0.45, 0.55, 0.05), []);
  const cache = useMemo(() => seat(hm, at.x - 2.2, at.z + 1.6, 0.5, 0.42, 0.3, 0.03), [hm, at.x, at.z]);
  useEffect(() => () => box.dispose(), [box]);
  return (
    <group position={[at.x, y, at.z]}>
      <Merged deps={[hm, at.x, at.z]}>
        {/* instrument tripod: a spectrometer head with a lens and a small panel */}
        <group position={[2, g(2, -1), -1]}>
          {[0, 1, 2].map((k) => { const fx = Math.cos((k * 2 * Math.PI) / 3) * 0.6, fz = Math.sin((k * 2 * Math.PI) / 3) * 0.6; return <Strut key={k} a={[0, 1.45, 0]} b={[fx, g(2 + fx, -1 + fz) - g(2, -1) - 0.04, fz]} r={0.018} material={m.metal} />; })}
          <mesh material={m.white} position={[0, 1.55, 0]}><boxGeometry args={[0.42, 0.26, 0.32]} /></mesh>
          <mesh material={m.glass} position={[0, 1.55, 0.17]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.09, 0.09, 0.05, 20]} /></mesh>
          <mesh material={m.foil1} position={[0, 1.55, -0.17]}><boxGeometry args={[0.36, 0.2, 0.03]} /></mesh>
          <mesh material={m.solar} position={[0, 1.78, 0]} rotation={[-0.5, 0, 0]}><boxGeometry args={[0.55, 0.02, 0.38]} /></mesh>
        </group>
        {/* core drill on a frame */}
        <group position={[-1.5, g(-1.5, -2), -2]}>
          {[-0.3, 0.3].map((x) => <Strut key={x} a={[x, g(-1.5 + x, -2) - g(-1.5, -2) - 0.05, 0]} b={[x, 1.6, 0]} r={0.025} material={m.metal} />)}
          <mesh material={m.steel} position={[0, 1.6, 0]}><boxGeometry args={[0.75, 0.06, 0.1]} /></mesh>
          <mesh material={m.orange} position={[0, 1.2, 0]}><boxGeometry args={[0.32, 0.4, 0.26]} /></mesh>
          <mesh material={m.steel} position={[0, 0.5, 0]}><cylinderGeometry args={[0.03, 0.03, 1, 10]} /></mesh>
          <mesh material={m.dark} position={[0, 0.03, 0]}><cylinderGeometry args={[0.2, 0.24, 0.06, 16]} /></mesh>
        </group>
        {/* sample flags */}
        {flags.map((f, k) => (
          <group key={k} position={[f.x, g(f.x, f.z), f.z]}>
            <mesh material={m.metal} position={[0, 0.32, 0]}><cylinderGeometry args={[0.008, 0.008, 0.64, 5]} /></mesh>
            <mesh position={[0.09, 0.57, 0]}><planeGeometry args={[0.18, 0.12]} /><meshStandardMaterial color={k % 2 ? "#e2732a" : "#f2e9c8"} side={THREE.DoubleSide} roughness={0.9} /></mesh>
          </group>
        ))}
        {/* sample cache */}
        <group position={[-2.2, cache.y - y, 1.6]} rotation={cache.r}>
          <mesh material={m.white} geometry={box} position={[0, 0.225, 0]} />
          <mesh material={m.orange} position={[0, 0.455, 0]}><boxGeometry args={[0.82, 0.03, 0.57]} /></mesh>
          {[-0.2, 0, 0.2].map((x) => <mesh key={x} material={m.metal} position={[x, 0.5, 0]}><cylinderGeometry args={[0.035, 0.035, 0.12, 10]} /></mesh>)}
        </group>
      </Merged>
    </group>
  );
});

// ------------------------------------------------------------------------------------------------
// layered buttes: stacked irregular slabs of bedded sandstone, each a little smaller, a dark caprock on top
function hash(a: number, b: number) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function slab(seed: number, r: number, h: number) {
  const s = new THREE.Shape(), N = 36;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, j = i % N;
    const k = 0.74 + hash(seed, j >> 1) * 0.22 + hash(seed + 7, j) * 0.1 + Math.sin(a * 3 + seed) * 0.07 + Math.sin(a * 7 + seed * 1.3) * 0.03;
    const x = Math.cos(a) * r * k, z = Math.sin(a) * r * k * 0.82;
    if (i === 0) s.moveTo(x, z); else s.lineTo(x, z);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSize: Math.min(0.7, h * 0.3), bevelThickness: Math.min(0.5, h * 0.22), bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  return g;
}

interface Butte { id: number; x: number; z: number; r: number; layers: { y: number; h: number; r: number; seed: number; c: number; dx: number; dz: number }[]; yaw: number; y: number }

const GRID = 300, SPAN = 3000, SHOW_M = Q.buttes;

/** every butte of the zone near the outpost, on a fixed grid (so they never move when the route changes) */
function allButtes(hm: Heightmap, home: P2): Butte[] {
  const out: Butte[] = [];
  const n = Math.ceil(SPAN / GRID);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const seed = (i + 100) * 1000 + (j + 100);
    if (hash(seed, 0) > 0.32) continue;
    const p = { x: home.x + (i + hash(seed, 5)) * GRID, z: home.z + (j + hash(seed, 6)) * GRID };
    const r = 7 + hash(seed, 1) * 17;
    if (Math.hypot(p.x - home.x, p.z - home.z) < 90 + r || slopeDeg(hm, p.x, p.z) > 11) continue;
    const hw = (hm.zone.width * hm.zone.dx) / 2 - 100, hh = (hm.zone.height * hm.zone.dy) / 2 - 100;
    if (Math.abs(p.x) > hw || Math.abs(p.z) > hh) continue;
    const count = 4 + Math.floor(hash(seed, 2) * 4);
    let yy = -1.5, rr = r;
    const layers = [];
    for (let k = 0; k < count; k++) {
      const h = 0.9 + hash(seed, 10 + k) * 2.8;
      layers.push({ y: yy, h, r: rr, seed: seed * 31 + k, c: k === count - 1 ? 3 : Math.floor(hash(seed, 20 + k) * 3), dx: (hash(seed, 30 + k) - 0.5) * 1.2, dz: (hash(seed, 40 + k) - 0.5) * 1.2 });
      yy += h; rr *= 0.8 + hash(seed, 50 + k) * 0.17;
    }
    const y = Math.min(groundY(hm, p.x, p.z), groundY(hm, p.x + r * 0.6, p.z), groundY(hm, p.x - r * 0.6, p.z), groundY(hm, p.x, p.z + r * 0.5), groundY(hm, p.x, p.z - r * 0.5));
    out.push({ id: seed, x: p.x, z: p.z, r, layers, yaw: hash(seed, 3) * Math.PI * 2, y });
  }
  return out;
}

const segDist = (a: P2, b: P2, p: P2) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
};

export function Buttes({ hm, home, line, rt, onSolid }: { hm: Heightmap; home: P2; line: Polyline | null; rt: { pose: { x: number; z: number } }; onSolid: (s: Closed[]) => void }) {
  const all = useMemo(() => allButtes(hm, home), [hm, home]);
  // which ones: near the astronaut (re-checked every ~100 m) and not across the current route
  const [center, setCenter] = useState<P2>(() => ({ x: rt.pose.x, z: rt.pose.z }));
  useFrame(() => { if (Math.hypot(rt.pose.x - center.x, rt.pose.z - center.z) > 100) setCenter({ x: rt.pose.x, z: rt.pose.z }); });
  const list = useMemo(() => all.filter((b) => {
    if (Math.hypot(b.x - center.x, b.z - center.z) > SHOW_M) return false;
    if (line) for (let i = 0; i < line.pts.length - 1; i++) if (segDist(line.pts[i], line.pts[i + 1], b) < b.r + 15) return false;
    return true;
  }), [all, center, line]);
  useEffect(() => { onSolid(list.map((b) => ({ x: b.x, z: b.z, r: b.r * 0.95 }))); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  // three bedding patterns and a darker caprock; the extruded sides are mapped in metres
  const mats = useMemo(() => [0, 1, 2, 3].map((k) => {
    const t = strata(k, [0.07, 0.22]);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.96, metalness: 0, color: k === 3 ? "#9a8f84" : ["#ffffff", "#f6ece2", "#fff3e8"][k] });
  }), []);
  // fallen blocks: plain rock (the bedding texture would wrap round them in rings)
  const talusMat = useMemo(() => { const t = boulder(); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, color: "#b9977a", roughness: 1, metalness: 0 }); }, []);
  useEffect(() => () => talusMat.dispose(), [talusMat]);
  const cache = useMemo(() => new Map<number, THREE.BufferGeometry[]>(), []);
  const geo = (b: Butte) => { let g = cache.get(b.id); if (!g) { g = b.layers.map((l) => slab(l.seed, l.r, l.h)); cache.set(b.id, g); } return g; };
  useEffect(() => () => { cache.forEach((gs) => gs.forEach((g) => g.dispose())); mats.forEach((m) => m.dispose()); }, [cache, mats]);
  const talus = useMemo(() => { const g = new THREE.DodecahedronGeometry(1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.8 + hash(Math.round(p.getX(i) * 7), Math.round(p.getY(i) * 7 + p.getZ(i) * 13)) * 0.4; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } g.computeVertexNormals(); return g; }, []);
  useEffect(() => () => talus.dispose(), [talus]);

  return (
    <>
      {list.map((b) => {
        const gs = geo(b);
        return (
          <group key={b.id} position={[b.x, b.y, b.z]} rotation={[0, b.yaw, 0]}>
           <Merged deps={[b.id]}>
            {b.layers.map((l, k) => <mesh key={k} geometry={gs[k]} material={mats[l.c]} position={[l.dx, l.y, l.dz]} castShadow receiveShadow />)}
            {/* fallen blocks at the foot */}
            {Array.from({ length: 6 }, (_, k) => {
              const a = hash(b.id, k + 200) * Math.PI * 2, d = b.r * (0.92 + hash(b.id, k + 300) * 0.4), s = 0.5 + hash(b.id, k + 400) * 1.5;
              const lx = Math.cos(a) * d, lz = Math.sin(a) * d * 0.82, cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
              const gy = groundY(hm, b.x + lx * cy + lz * sy, b.z - lx * sy + lz * cy) - b.y;
              return <mesh key={`t${k}`} geometry={talus} material={talusMat} position={[lx, gy + s * 0.25 - 0.3, lz]} rotation={[k, a, k * 0.5]} scale={[s, s * 0.7, s * 1.1]} castShadow receiveShadow />;
            })}
           </Merged>
          </group>
        );
      })}
    </>
  );
}
