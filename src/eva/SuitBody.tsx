// The suit you are wearing, seen from inside it. Built in code (no downloaded model), in the manner of
// a NASA EMU / xEMU: white woven outer fabric, pressurised gloves with jointed fingers, blue-grey
// silicone fingertips and palms, anodised wrist disconnect rings, a cuff display on the left forearm
// and a mission patch on the right, the hard upper torso with its chest display-and-control module,
// legs and boots (look down), and the backpack and helmet that only show in your shadow.
//  - on a screen the forearms are fixed to the view (lower corners) and sway as you walk;
//  - in VR each glove sits on its controller.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { EvaRuntime } from "./runtime";
import { fabric, foil, patch, rubber } from "./textures";

interface Mats { fabric: THREE.Material; pad: THREE.Material; rubber: THREE.Material; ring: THREE.Material; red: THREE.Material; dark: THREE.Material; foil: THREE.Material; ghost: THREE.Material }

function materials(): Mats {
  const f = fabric([3, 3]), f2 = fabric([1.5, 1.5]), r = rubber(), g = foil([1, 1]);
  return {
    fabric: new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.94, metalness: 0 }),
    pad: new THREE.MeshStandardMaterial({ map: f2.map, normalMap: f2.normalMap, normalScale: new THREE.Vector2(1, 1), roughness: 0.9, color: "#e3ded2" }),
    rubber: new THREE.MeshStandardMaterial({ map: r.map, normalMap: r.normalMap, roughness: 0.7, metalness: 0 }),
    ring: new THREE.MeshStandardMaterial({ color: "#c2c7cc", roughness: 0.22, metalness: 1 }),
    red: new THREE.MeshStandardMaterial({ color: "#a8281f", roughness: 0.32, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: "#23292d", roughness: 0.55, metalness: 0.4 }),
    foil: new THREE.MeshStandardMaterial({ map: g.map, normalMap: g.normalMap, roughness: 0.35, metalness: 0.9 }),
    // casts a shadow, is never drawn (the helmet and backpack around your head)
    ghost: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
  };
}

const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
/** a capsule lying along Z, from z = 0 to z = -len (rounded ends beyond) */
const bone = (r: number, len: number, m: THREE.Material) => { const o = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 12), m); o.rotation.x = Math.PI / 2; o.position.z = -len / 2; return o; };

/** one finger: three phalanges, each bent by `curl`, bellows at the joints, a silicone tip */
function finger(m: Mats, len: number, r: number, curl: [number, number, number]) {
  const root = new THREE.Group();
  let parent: THREE.Object3D = root;
  const L = [len * 0.42, len * 0.32, len * 0.26];
  for (let k = 0; k < 3; k++) {
    const j = new THREE.Group(); j.rotation.x = -curl[k]; parent.add(j);
    j.add(bone(r * (1 - k * 0.07), L[k], k === 2 ? m.rubber : m.fabric));
    const joint = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, r * 0.24, 6, 16), m.pad); j.add(joint);
    const next = new THREE.Group(); next.position.z = -L[k]; j.add(next); parent = next;
  }
  return root;
}

/** a gloved hand: wrist at the origin, fingers towards -Z, back of the hand +Y; `inner` = the thumb's side (+1: +X) */
function hand(m: Mats, inner: 1 | -1) {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.094, 0.036, 0.1, 4, 0.016), m.fabric, 0, 0, -0.058));
  g.add(mesh(new RoundedBoxGeometry(0.084, 0.014, 0.088, 3, 0.006), m.rubber, 0, -0.015, -0.058));   // palm
  g.add(mesh(new RoundedBoxGeometry(0.068, 0.014, 0.058, 3, 0.007), m.pad, 0, 0.019, -0.05));         // quilted back
  const lens = [0.076, 0.086, 0.08, 0.062], rad = [0.0128, 0.0132, 0.0126, 0.0112];
  for (let f = 0; f < 4; f++) {
    const x = inner * (0.034 - f * 0.0225);                                   // index next to the thumb
    g.add(mesh(new THREE.SphereGeometry(rad[f] * 1.22, 12, 10), m.pad, x, 0.006, -0.105)); // knuckle
    const fg = finger(m, lens[f], rad[f], [0.3 + f * 0.07, 0.5 + f * 0.06, 0.32]);
    fg.position.set(x, 0, -0.106); fg.rotation.y = inner * (0.07 - f * 0.05);  // slightly spread
    g.add(fg);
  }
  // thumb: a pad at its base, two phalanges, opposed
  const th = new THREE.Group();
  th.position.set(inner * 0.044, -0.006, -0.03); th.rotation.set(-0.28, -inner * 0.95, inner * 0.35, "YXZ");
  const pad = mesh(new THREE.SphereGeometry(0.02, 14, 10), m.fabric, 0, 0, -0.004); pad.scale.set(1, 0.85, 1.5); th.add(pad);
  const t1 = new THREE.Group(); t1.position.z = -0.022; t1.rotation.x = -0.18; th.add(t1);
  t1.add(bone(0.0145, 0.03, m.fabric));
  const t2 = new THREE.Group(); t2.position.z = -0.032; t2.rotation.x = -0.4; t1.add(t2);
  t2.add(bone(0.0135, 0.026, m.rubber));
  t2.add(new THREE.Mesh(new THREE.TorusGeometry(0.0142, 0.0034, 6, 16), m.pad));
  g.add(th);
  return g;
}

const tube = (rFar: number, rNear: number, len: number, m: THREE.Material, z: number, seg = 28) => {
  // along Z: radius rFar at z (the wrist side), rNear at z + len (towards the elbow)
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rNear, rFar, len, seg, 4, true), m);
  o.rotation.x = Math.PI / 2; o.position.z = z + len / 2;
  return o;
};

/** hand + wrist disconnect + forearm sleeve of length `len` (towards +Z) */
function arm(m: Mats, inner: 1 | -1, len: number, extra?: THREE.Object3D) {
  const g = new THREE.Group();
  const h = hand(m, inner); h.scale.set(1.06, 1.06, 1.06); g.add(h);
  g.add(tube(0.045, 0.053, 0.06, m.fabric, 0.004));                    // gauntlet
  for (const z of [0.022, 0.044]) { const strap = new THREE.Mesh(new THREE.TorusGeometry(0.0495 + (z - 0.022) * 0.13, 0.0035, 6, 28), m.pad); strap.position.z = z; g.add(strap); }
  g.add(tube(0.057, 0.057, 0.014, m.red, 0.064, 36));                  // glove-side ring
  g.add(tube(0.0605, 0.0605, 0.016, m.ring, 0.078, 36));               // suit-side ring
  for (const z of [0.064, 0.078, 0.094]) { const lip = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.003, 6, 36), m.ring); lip.position.z = z; g.add(lip); }
  g.add(mesh(new THREE.BoxGeometry(0.02, 0.01, 0.022), m.red, 0, 0.062, 0.079));  // lock tab
  g.add(tube(0.058, 0.082, len, m.fabric, 0.094));                     // sleeve
  for (let k = 1; k <= 5; k++) {                                       // soft restraint folds
    const t = k / 6, r = 0.058 + t * 0.024;
    const fold = new THREE.Mesh(new THREE.TorusGeometry(r + 0.001, 0.0045 + (k % 2) * 0.002, 6, 28), m.fabric);
    fold.position.z = 0.094 + len * t; fold.rotation.x = (k % 2 ? 0.06 : -0.05); g.add(fold);
  }
  if (extra) g.add(extra);
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

/** a small canvas screen */
function display(w: number, h: number, px: number) {
  const canvas = document.createElement("canvas");
  canvas.width = px; canvas.height = Math.round((px * h) / w);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  return { canvas, tex, mesh: m };
}

/** the cuff display strapped on the left forearm */
function cuff(m: Mats, screen: THREE.Mesh) {
  const g = new THREE.Group();
  g.position.set(0, 0.072, 0.2); g.rotation.x = 0.07;
  g.add(mesh(new RoundedBoxGeometry(0.086, 0.014, 0.058, 3, 0.005), m.dark));
  screen.rotation.x = -Math.PI / 2; screen.position.y = 0.0075; g.add(screen);
  for (const z of [-0.022, 0.022]) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.004, 6, 28), m.dark); s.position.set(0, -0.072, z); s.scale.set(1, 1, 2.2); g.add(s); }
  return g;
}

/** the mission patch sewn on the right sleeve */
function sleevePatch() {
  const p = new THREE.Mesh(new THREE.CircleGeometry(0.032, 28), new THREE.MeshStandardMaterial({ map: patch(), roughness: 0.9 }));
  p.rotation.x = -Math.PI / 2 + 0.06; p.position.set(0, 0.0735, 0.24);
  return p;
}

/** point an arm: wrist at `at`, fingers towards `to`, rolled about its own axis */
function aim(g: THREE.Object3D, at: THREE.Vector3, to: THREE.Vector3, roll: number) {
  g.position.copy(at);
  g.lookAt(at.clone().multiplyScalar(2).sub(to)); // an Object3D's +Z looks at the target: aim -Z instead
  g.rotateZ(roll);
}

type Read = () => { o2: number; min: number; pulse: number; status: string };

export function Suit({ rt, o2 }: { rt: EvaRuntime; o2: Read }) {
  const { camera, gl, scene } = useThree();
  const m = useMemo(materials, []);
  useEffect(() => () => Object.values(m).forEach((x) => (x as THREE.Material).dispose()), [m]);
  const wrist = useMemo(() => display(0.074, 0.046, 256), []);
  const wristXr = useMemo(() => display(0.074, 0.046, 256), []);
  const chest = useMemo(() => display(0.17, 0.075, 512), []);

  const parts = useMemo(() => {
    // --- on a screen: forearms fixed to the view
    const left = arm(m, 1, 0.5, cuff(m, wrist.mesh)), right = arm(m, -1, 0.5, sleevePatch());
    const rest = {
      l: { at: new THREE.Vector3(-0.22, -0.235, -0.46), to: new THREE.Vector3(-0.1, -0.1, -0.9), roll: 0.35 },
      r: { at: new THREE.Vector3(0.23, -0.245, -0.46), to: new THREE.Vector3(0.11, -0.11, -0.9), roll: -0.35 },
    };
    const screenArms = new THREE.Group(); screenArms.add(left, right);
    // --- VR: a glove with a short sleeve on each controller
    const xrL = arm(m, 1, 0.24, cuff(m, wristXr.mesh)), xrR = arm(m, -1, 0.24, sleevePatch());

    // --- the body, in the world under your head
    const body = new THREE.Group();
    const torso = mesh(new RoundedBoxGeometry(0.5, 0.52, 0.34, 5, 0.09), m.fabric, 0, 1.2, 0.05); body.add(torso);
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.022, 10, 40), m.ring); neck.rotation.x = Math.PI / 2 - 0.22; neck.position.set(0, 1.475, 0.02); body.add(neck);
    for (const s of [-1, 1]) body.add(mesh(new THREE.SphereGeometry(0.115, 18, 14), m.fabric, s * 0.27, 1.38, 0.05));       // shoulders
    // chest display and control module
    const dcm = new THREE.Group(); dcm.position.set(0, 1.22, -0.16);
    dcm.add(mesh(new RoundedBoxGeometry(0.3, 0.2, 0.12, 4, 0.02), m.pad));
    chest.mesh.rotation.x = -Math.PI / 2 + 0.35; chest.mesh.position.set(0, 0.104, -0.012); dcm.add(chest.mesh);
    dcm.add(mesh(new RoundedBoxGeometry(0.2, 0.012, 0.1, 2, 0.004), m.dark, 0, 0.1, -0.012));
    const knob = (x: number, c: string) => { const k = mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.026, 18), new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.3 }), x, 0.11, 0.038); dcm.add(k); };
    knob(-0.11, "#b8322a"); knob(0.11, "#3a78c2"); knob(-0.06, "#d8d2c4"); knob(0.06, "#d8d2c4");
    for (const s of [-1, 1]) { const hose = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 8, 20, Math.PI), m.dark); hose.position.set(s * 0.16, -0.04, 0.02); hose.rotation.set(0, Math.PI / 2, 0); dcm.add(hose); }
    body.add(dcm);
    body.add(mesh(new RoundedBoxGeometry(0.34, 0.1, 0.22, 3, 0.03), m.foil, 0, 0.93, 0.04));                              // waist bearing cover
    const waist = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 8, 36), m.ring); waist.rotation.x = Math.PI / 2; waist.position.set(0, 0.96, 0.05); waist.scale.set(1, 0.8, 1); body.add(waist);
    // legs: hip → knee → boot, swung while walking
    const leg = (s: 1 | -1) => {
      const hip = new THREE.Group(); hip.position.set(s * 0.115, 0.92, 0.04);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.34, 6, 16), m.fabric); thigh.position.y = -0.2; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
      knee.add(mesh(new THREE.SphereGeometry(0.088, 14, 12), m.pad));
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.078, 0.3, 6, 16), m.fabric); shin.position.y = -0.2; knee.add(shin);
      const ankle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 8, 28), m.ring); ankle.rotation.x = Math.PI / 2; ankle.position.y = -0.37; knee.add(ankle);
      knee.add(mesh(new RoundedBoxGeometry(0.135, 0.11, 0.31, 4, 0.04), m.pad, 0, -0.445, -0.05));                         // boot
      knee.add(mesh(new RoundedBoxGeometry(0.14, 0.03, 0.32, 2, 0.012), m.dark, 0, -0.492, -0.05));                        // sole
      return { hip, knee };
    };
    const legL = leg(-1), legR = leg(1);
    body.add(legL.hip, legR.hip);
    // shadow-only: helmet, backpack, upper arms
    body.add(mesh(new THREE.SphereGeometry(0.19, 16, 12), m.ghost, 0, 1.66, 0.02));
    body.add(mesh(new RoundedBoxGeometry(0.52, 0.8, 0.24, 2, 0.05), m.ghost, 0, 1.28, 0.32));
    for (const s of [-1, 1]) { const ua = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 4, 10), m.ghost); ua.position.set(s * 0.33, 1.1, -0.02); ua.rotation.set(0.25, 0, s * 0.12); body.add(ua); }
    body.traverse((o) => { o.castShadow = true; o.receiveShadow = false; });
    return { screenArms, left, right, rest, xrL, xrR, body, legL, legR };
  }, [m, wrist, wristXr, chest]);

  const controllers = useMemo(() => [gl.xr.getController(0), gl.xr.getController(1)], [gl]);
  useEffect(() => {
    camera.add(parts.screenArms);
    scene.add(parts.body);
    const attach = (c: THREE.Object3D) => (e: { data?: XRInputSource }) => {
      const g = e.data?.handedness === "left" ? parts.xrL : parts.xrR;
      g.rotation.set(-0.55, 0, 0); g.position.set(0, -0.02, 0.07);
      c.add(g);
    };
    const handlers = controllers.map((c) => { const h = attach(c); c.addEventListener("connected", h); return h; });
    return () => {
      camera.remove(parts.screenArms); scene.remove(parts.body);
      controllers.forEach((c, i) => { c.removeEventListener("connected", handlers[i]); c.remove(parts.xrL, parts.xrR); });
    };
  }, [camera, scene, parts, controllers]);

  const s = useRef({ t: 1, phase: 0, amp: 0, yaw: 0, first: true });
  const v = useMemo(() => ({ p: new THREE.Vector3(), f: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() }), []);
  useFrame((_, dt) => {
    const xr = gl.xr.isPresenting, st = s.current, walking = rt.pose.moving && rt.pose.speed < 4;
    st.amp += ((walking ? 1 : 0) - st.amp) * Math.min(1, dt * 5);
    st.phase += dt * Math.min(2.2, Math.max(0.6, rt.pose.speed)) * 4.6 * (rt.pose.moving ? 1 : 0);
    const sw = Math.sin(st.phase) * st.amp, cw = Math.cos(st.phase) * st.amp, breathe = Math.sin(performance.now() / 1700) * 0.004;

    // forearms on a screen: opposite swing, a slow breathing drift
    parts.screenArms.visible = !xr;
    if (!xr) {
      const { l, r } = parts.rest;
      aim(parts.left, v.a.copy(l.at).add(v.b.set(0, sw * 0.014 + breathe, cw * 0.03)), v.b.copy(l.to).add(v.p.set(0, sw * 0.02, 0)), l.roll);
      aim(parts.right, v.a.copy(r.at).add(v.b.set(0, -sw * 0.014 + breathe, -cw * 0.03)), v.b.copy(r.to).add(v.p.set(0, -sw * 0.02, 0)), r.roll);
    }

    // the body under the head, turning with it lazily
    const cam = xr ? gl.xr.getCamera() : camera;
    cam.getWorldPosition(v.p); cam.getWorldDirection(v.f);
    const yaw = Math.atan2(-v.f.x, -v.f.z);
    if (st.first) { st.yaw = yaw; st.first = false; }
    let d = yaw - st.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    st.yaw += d * Math.min(1, dt * (Math.abs(d) > 0.6 || rt.pose.moving ? 6 : 1.5));
    parts.body.position.set(v.p.x + Math.sin(st.yaw) * 0.09, rt.pose.y, v.p.z + Math.cos(st.yaw) * 0.09);
    parts.body.rotation.set(0, st.yaw, 0);
    // gait
    parts.legL.hip.rotation.x = sw * 0.5; parts.legR.hip.rotation.x = -sw * 0.5;
    parts.legL.knee.rotation.x = -Math.max(0, -cw) * 0.7 * st.amp; parts.legR.knee.rotation.x = -Math.max(0, cw) * 0.7 * st.amp;

    // displays, 4 times a second
    st.t += dt;
    if (st.t < 0.25) return;
    st.t = 0;
    const r = o2();
    drawCuff(wrist.canvas, r, rt); wrist.tex.needsUpdate = true;
    if (xr) { drawCuff(wristXr.canvas, r, rt); wristXr.tex.needsUpdate = true; }
    drawChest(chest.canvas, r, rt); chest.tex.needsUpdate = true;
  });
  return null;
}

function drawCuff(c: HTMLCanvasElement, r: ReturnType<Read>, rt: EvaRuntime) {
  const x = c.getContext("2d")!, W = c.width, H = c.height;
  x.fillStyle = "#061014"; x.fillRect(0, 0, W, H);
  const col = r.status === "NOMINAL" ? "#7be08a" : r.status === "CAUTION" ? "#fbbf24" : "#ef4444";
  x.fillStyle = col; x.fillRect(0, 0, W, 8);
  x.font = "600 20px system-ui"; x.fillText(r.status, 12, 34);
  x.fillStyle = "#e9f4f0"; x.font = "700 62px system-ui"; x.fillText(`${r.o2.toFixed(0)}%`, 12, 98);
  x.font = "600 22px system-ui"; x.fillStyle = "#9fe3ff"; x.fillText("O₂", 150, 76);
  x.fillStyle = "#cfe0da"; x.font = "20px system-ui";
  x.fillText(`${Math.floor(r.min / 60)}h${String(Math.round(r.min % 60)).padStart(2, "0")}`, 150, 100);
  x.fillText(`♥ ${r.pulse.toFixed(0)}   ${Math.round(rt.pose.heading).toString().padStart(3, "0")}°`, 12, 140);
}

function drawChest(c: HTMLCanvasElement, r: ReturnType<Read>, rt: EvaRuntime) {
  const x = c.getContext("2d")!, W = c.width, H = c.height;
  x.fillStyle = "#081216"; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#3d4d52"; x.lineWidth = 6; x.strokeRect(3, 3, W - 6, H - 6);
  x.fillStyle = "#9fe3ff"; x.font = "600 30px monospace";
  x.fillText(`O2 ${r.o2.toFixed(1).padStart(5, " ")}%   PRESS 29.6`, 22, 52);
  x.fillText(`HR ${r.pulse.toFixed(0).padStart(3, " ")}     HDG ${Math.round(rt.pose.heading).toString().padStart(3, "0")}`, 22, 100);
  x.fillStyle = r.status === "NOMINAL" ? "#7be08a" : "#fbbf24";
  x.fillText(`SUIT ${r.status}  ${rt.autopilot ? "AUTO" : ""}`, 22, 148);
  x.fillStyle = "#e9f4f0"; x.font = "22px monospace"; x.fillText("DCM · FAN ON · H2O 82%", 22, 200);
}
