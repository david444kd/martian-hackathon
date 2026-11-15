// The small things that make you feel you are standing there rather than looking at it:
//  - your boot prints stay in the regolith behind you, and each step lifts a little dust that hangs
//    and settles slowly (low gravity, thin air);
//  - the controllers tick with each step, thump when a squall hits, and buzz at a refused step or an
//    alert (rt.buzz), so the suit is felt as well as seen.
// All authored presentation: nothing here is measured, stored or sent.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { ATMO } from "./atmo";
import { groundY } from "./frame";
import { QUEST } from "./quality";
import type { EvaRuntime } from "./runtime";
import { wind } from "./wind";
import { ears } from "./ears";

const PRINTS = QUEST ? 140 : 260, PUFFS = 28, STRIDE = 0.62;

/** a boot sole pressed into dust: tread bars across it, darker where it is deepest */
function printTexture() {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const x = c.getContext("2d")!;
  const sole = (y0: number, y1: number, w: number) => { x.beginPath(); x.roundRect(32 - w / 2, y0, w, y1 - y0, w * 0.45); };
  x.filter = "blur(2.5px)";
  x.fillStyle = "rgba(255,255,255,0.75)"; sole(8, 78, 40); x.fill(); sole(84, 122, 34); x.fill();
  x.filter = "none";
  x.globalCompositeOperation = "destination-out";
  for (let y = 14; y < 120; y += 9) { x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(10, y, 44, 3); }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function Presence({ hm, rt }: { hm: Heightmap; rt: EvaRuntime }) {
  const gl = useThree((s) => s.gl);
  const { prints, puffs, birth, at } = useMemo(() => {
    const tex = printTexture();
    const prints = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.15, 0.36).rotateX(-Math.PI / 2),
      // pressed regolith is darker than the dust lying loose on top
      new THREE.MeshBasicMaterial({ map: tex, color: "#2a170d", transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      PRINTS);
    prints.count = 0; prints.frustumCulled = false; prints.renderOrder = 2;
    // dust puffs: a quad each, facing the eye, growing and thinning with age
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 3), 3), birth = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS).fill(-100), 1);
    g.setAttribute("aAt", at); g.setAttribute("aBirth", birth);
    g.instanceCount = PUFFS;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: ATMO.uTime, uDust: ATMO.uDust, uLight: ATMO.uLight, uCloud: ATMO.uCloud, uWind: ATMO.uWind, uGust: ATMO.uGust },
      vertexShader: /* glsl */ `attribute vec3 aAt; attribute float aBirth; uniform float uTime, uGust; uniform vec2 uWind; varying vec2 vQ; varying float vA; varying vec2 vUv;
        void main(){
          float age = uTime - aBirth, k = clamp(age / 2.2, 0.0, 1.0);
          // lifted a hand's height, then drifting off on what wind there is while it thins
          vec3 c = aAt + vec3(uWind.x, 0.0, uWind.y) * (age * (0.15 + uGust * 1.5)) + vec3(0.0, 0.05 + 0.22 * sqrt(k), 0.0);
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * (0.22 + 0.55 * k);
          vA = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, k) * step(age, 2.2);
          vQ = position.xy * 2.0; vUv = position.xy * 0.35 + aBirth * 0.37;
          gl_Position = vA > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D uCloud; uniform vec3 uDust; uniform float uLight; varying vec2 vQ; varying float vA; varying vec2 vUv;
        void main(){
          float n = texture2D(uCloud, vUv).g;
          float a = (1.0 - smoothstep(0.15, 1.0, length(vQ))) * smoothstep(0.2, 0.7, n) * vA * 0.5;
          gl_FragColor = vec4(uDust * 1.1 * uLight, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const puffs = new THREE.Mesh(g, m);
    puffs.frustumCulled = false; puffs.renderOrder = 48;
    return { prints, puffs, birth, at };
  }, []);
  useEffect(() => () => {
    prints.geometry.dispose(); (prints.material as THREE.MeshBasicMaterial).map?.dispose(); (prints.material as THREE.Material).dispose();
    puffs.geometry.dispose(); (puffs.material as THREE.Material).dispose();
  }, [prints, puffs]);

  const s = useRef({ x: NaN, z: NaN, walked: 0, n: 0, left: true, puff: 0, lastPuff: 0, squall: false, zaps: 0, buzz: 0, blocked: false });
  const o = useMemo(() => new THREE.Object3D(), []), up = useMemo(() => new THREE.Vector3(0, 1, 0), []), nrm = useMemo(() => new THREE.Vector3(), []), q = useMemo(() => new THREE.Quaternion(), []);

  /** a pulse on the controllers (both, or one hand) */
  const pulse = (strength: number, ms: number, hand?: "left" | "right") => {
    const session = gl.xr.getSession();
    if (!session) return;
    for (const src of session.inputSources) {
      if (hand && src.handedness !== hand) continue;
      const act = (src.gamepad as (Gamepad & { hapticActuators?: { pulse?: (v: number, ms: number) => Promise<boolean> }[] }) | undefined)?.hapticActuators?.[0];
      void act?.pulse?.(Math.min(1, strength), ms)?.catch?.(() => {});
    }
  };

  useFrame(() => {
    const st = s.current, p = rt.pose;
    if (!rt.placed) return;
    ears.live = true; ears.x = p.x; ears.z = p.z; ears.heading = p.heading;
    if (Number.isNaN(st.x)) { st.x = p.x; st.z = p.z; }
    const dx = p.x - st.x, dz = p.z - st.z, d = Math.hypot(dx, dz);
    if (d > 3) { st.x = p.x; st.z = p.z; st.walked = 0; }          // a jump, not steps
    else if (d > 0.02) {
      st.walked += d;
      const dir = Math.atan2(dx, dz);
      while (st.walked >= STRIDE) {
        st.walked -= STRIDE;
        // the foot comes down a little behind where the head is now, to one side
        const back = st.walked, side = st.left ? -0.11 : 0.11;
        const fx = p.x - Math.sin(dir) * back + Math.cos(dir) * side, fz = p.z - Math.cos(dir) * back - Math.sin(dir) * side, fy = groundY(hm, fx, fz);
        nrm.set(groundY(hm, fx - 0.3, fz) - groundY(hm, fx + 0.3, fz), 0.6, groundY(hm, fx, fz - 0.3) - groundY(hm, fx, fz + 0.3)).normalize();
        o.position.set(fx, fy + 0.012, fz);
        o.quaternion.setFromUnitVectors(up, nrm).multiply(q.setFromAxisAngle(up, dir + Math.PI + (st.left ? 0.1 : -0.1)));
        o.updateMatrix();
        prints.setMatrixAt(st.n % PRINTS, o.matrix);
        st.n++; st.left = !st.left;
        prints.count = Math.min(st.n, PRINTS);
        prints.instanceMatrix.needsUpdate = true;
        const t = ATMO.uTime.value;
        if (t - st.lastPuff > 0.22) {
          st.lastPuff = t;
          at.setXYZ(st.puff, fx, fy, fz); birth.setX(st.puff, t); at.needsUpdate = true; birth.needsUpdate = true;
          st.puff = (st.puff + 1) % PUFFS;
          if (p.speed < 3) pulse(0.1, 22, st.left ? "right" : "left");   // a footfall, felt in the hand on that side
        }
      }
      st.x = p.x; st.z = p.z;
    }
    // the suit is felt: a squall arriving, static letting go, a step refused, an alert
    if (wind.squall > 0.45 && !st.squall) { st.squall = true; pulse(0.7, 260); } else if (wind.squall < 0.15) st.squall = false;
    if (wind.zaps !== st.zaps) { st.zaps = wind.zaps; pulse(0.35, 35); }
    if (!!p.blocked !== st.blocked) { st.blocked = !!p.blocked; if (st.blocked) pulse(0.45, 70); }
    if (rt.buzz !== st.buzz) { st.buzz = rt.buzz; pulse(0.55, 140); }
  });
  return <><primitive object={prints} /><primitive object={puffs} /></>;
}
