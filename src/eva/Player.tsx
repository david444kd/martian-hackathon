// First-person locomotion on the zone's measured terrain, 1 unit = 1 m. One rig holds the camera
// (and in VR the controllers); the rig stands on the ground under the astronaut's head.
//  Screen: click the view, drag to look, W/A/S/D or arrows to walk, Q/E turn, Shift fast travel,
//          F autopilot along the route, Enter acknowledge.
//  Quest:  left stick walk (where you look), left grip fast travel, right stick 30° snap turn,
//          right trigger teleport (aim at the ground, up to 20 m), A acknowledge, X autopilot, B exit VR.
// Steps steeper than 30° and steps into a closed (critical) area are refused; leaving one is allowed.
// The headset's own guardian / boundary stays in charge of the real room.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { bearingOf, groundY, inside, pointAlong, slopeDeg, type P2 } from "./frame";
import type { EvaRuntime } from "./runtime";
import i18n from "../i18n";
import { wind } from "./wind";

export const EYE = 1.68;
const WALK = 1.3;      // m/s, a suited walk on Mars
const FAST = 7;        // fast travel multiplier (demo convenience)
const MAX_STEP_DEG = 30;
const TELEPORT_M = 20;

export function Player({ hm, rt }: { hm: Heightmap; rt: EvaRuntime }) {
  const { gl, camera: cam, scene } = useThree();
  const camera = cam as THREE.PerspectiveCamera;
  const rig = useMemo(() => new THREE.Group(), []);
  const keys = useRef(new Set<string>());
  const nav = useRef({ yaw: 0, pitch: -0.08, drag: false, snap: false, a: false, x: false, b: false, bob: 0, recenter: true, last: { x: 0, z: 0 }, speed: 0 });
  const v = useMemo(() => ({ head: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), fwd: new THREE.Vector3(), o: new THREE.Vector3(), d: new THREE.Vector3(), before: new THREE.Vector3(), after: new THREE.Vector3() }), []);
  const controllers = useMemo(() => [gl.xr.getController(0), gl.xr.getController(1)], [gl]);
  const ring = useRef<THREE.Mesh>(null);
  const aim = useRef<P2 | null>(null);

  useEffect(() => {
    scene.add(rig);
    rig.add(camera);
    camera.position.set(0, EYE, 0);
    camera.near = 0.05; camera.far = 40000; camera.updateProjectionMatrix();
    const disposables: { dispose(): void }[] = [];
    controllers.forEach((c) => {
      rig.add(c);
      // the glove on each controller comes from Suit.tsx; here only the pointing ray
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]);
      const lm = new THREE.LineBasicMaterial({ color: "#9fe3ff", transparent: true, opacity: 0.45 });
      c.add(new THREE.Line(lg, lm));
      disposables.push(lg, lm);
      c.addEventListener("connected", (e: { data?: XRInputSource }) => { c.userData.hand = e.data?.handedness; });
    });

    const start = () => { keys.current.clear(); nav.current.recenter = true; rt.presenting = true; rt.notify(); };
    const end = () => {
      keys.current.clear(); rt.presenting = false;
      rig.rotation.set(0, 0, 0);
      camera.position.set(0, EYE, 0);
      rig.position.set(rt.pose.x, groundY(hm, rt.pose.x, rt.pose.z), rt.pose.z);
      nav.current.yaw = (-rt.pose.heading * Math.PI) / 180;
      rt.notify();
    };
    gl.xr.addEventListener("sessionstart", start);
    gl.xr.addEventListener("sessionend", end);

    const canvas = gl.domElement;
    canvas.tabIndex = 0;
    const down = (e: PointerEvent) => { if (e.button !== 0) return; canvas.focus(); nav.current.drag = true; canvas.setPointerCapture(e.pointerId); };
    const up = () => { nav.current.drag = false; };
    const move = (e: PointerEvent) => {
      if (!nav.current.drag || gl.xr.isPresenting) return;
      nav.current.yaw -= e.movementX * 0.0032;
      nav.current.pitch = THREE.MathUtils.clamp(nav.current.pitch - e.movementY * 0.0032, -1.25, 1.25);
    };
    const stop = () => { keys.current.clear(); nav.current.drag = false; };
    const typing = () => { const el = document.activeElement; return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement; };
    const keydown = (e: KeyboardEvent) => {
      if (typing() || e.ctrlKey || e.altKey || e.metaKey) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
        e.preventDefault(); keys.current.add(e.code);
      }
      if (e.code === "KeyF" && !e.repeat) { rt.autopilot = !rt.autopilot; rt.notify(); }
      if (e.code === "Enter" && !e.repeat) { rt.ackPressed++; }
    };
    const keyup = (e: KeyboardEvent) => keys.current.delete(e.code);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("lostpointercapture", up);
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    document.addEventListener("visibilitychange", stop);

    const teleport = (e: { target: unknown }) => {
      const c = e.target as THREE.Object3D;
      if (!gl.xr.isPresenting || c.userData.hand !== "right" || !aim.current) return;
      const p = aim.current;
      rig.updateMatrixWorld(true); gl.xr.updateCamera(camera);
      gl.xr.getCamera().matrixWorld.decompose(v.head, v.q, v.s);
      rig.position.x += p.x - v.head.x; rig.position.z += p.z - v.head.z;
      rig.position.y = groundY(hm, p.x, p.z);
      aim.current = null;
    };
    controllers.forEach((c) => c.addEventListener("selectend", teleport));

    return () => {
      controllers.forEach((c) => { c.removeEventListener("selectend", teleport); rig.remove(c); c.clear(); });
      disposables.forEach((d) => d.dispose());
      gl.xr.removeEventListener("sessionstart", start);
      gl.xr.removeEventListener("sessionend", end);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("lostpointercapture", up);
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      document.removeEventListener("visibilitychange", stop);
      scene.add(camera); scene.remove(rig);
    };
  }, [camera, controllers, gl, hm, rig, rt, scene, v]);

  /** one step from p by (dx, dz), checked against the terrain and closed areas, in ≤2 m pieces */
  const stepFrom = (p: P2, dx: number, dz: number): { p: P2; blocked: string } => {
    const len = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(len / 2));
    let cur = p;
    for (let k = 0; k < n; k++) {
      const next = { x: cur.x + dx / n, z: cur.z + dz / n };
      if (!inside(hm, next.x, next.z)) return { p: cur, blocked: i18n.t("evahud.blocked_edge") };
      const run = Math.hypot(next.x - cur.x, next.z - cur.z);
      const rise = groundY(hm, next.x, next.z) - groundY(hm, cur.x, cur.z);
      if (run > 0.01 && Math.abs(rise / run) > Math.tan((MAX_STEP_DEG * Math.PI) / 180) && slopeDeg(hm, next.x, next.z) > MAX_STEP_DEG)
        return { p: cur, blocked: i18n.t("evahud.blocked_steep") };
      for (const c of rt.solid) {
        const d0 = Math.hypot(cur.x - c.x, cur.z - c.z), d1 = Math.hypot(next.x - c.x, next.z - c.z);
        if (d1 < c.r && d1 < d0) return { p: cur, blocked: "" };
      }
      for (const c of rt.closed) {
        const d0 = Math.hypot(cur.x - c.x, cur.z - c.z), d1 = Math.hypot(next.x - c.x, next.z - c.z);
        if (d1 < c.r && d1 < d0) return { p: cur, blocked: i18n.t("evahud.blocked_closed") };
      }
      cur = next;
    }
    return { p: cur, blocked: "" };
  };

  useFrame((_, delta) => {
    const n = nav.current, dt = Math.min(delta, 0.1), pose = rt.pose;
    if (ring.current) ring.current.visible = false;

    // a requested placement (spawn)
    if (rt.teleportTo) {
      const t = rt.teleportTo;
      rt.teleportTo = null;
      if (t.heading != null) n.yaw = (-t.heading * Math.PI) / 180;
      rig.rotation.set(0, 0, 0);
      rig.position.set(t.x, groundY(hm, t.x, t.z), t.z);
      pose.x = t.x; pose.z = t.z; n.last = { x: t.x, z: t.z };
      n.recenter = true;
    }

    let forward = rt.input.forward, right = rt.input.right, fast = rt.input.fast, heading = 0;
    let p: P2 = { x: rig.position.x, z: rig.position.z };
    const xr = gl.xr.isPresenting;

    if (xr) {
      const frame = gl.xr.getFrame(), space = gl.xr.getReferenceSpace();
      if (!frame || !space || !frame.getViewerPose(space)) return;
      rig.updateMatrixWorld(true); gl.xr.updateCamera(camera);
      gl.xr.getCamera().matrixWorld.decompose(v.head, v.q, v.s);
      if (n.recenter) {
        // put the head (not the rig origin) where the astronaut stands, facing their heading
        v.fwd.set(0, 0, -1).applyQuaternion(v.q);
        rig.rotation.y += (-pose.heading * Math.PI) / 180 - Math.atan2(-v.fwd.x, -v.fwd.z);
        rig.updateMatrixWorld(true); gl.xr.updateCamera(camera);
        gl.xr.getCamera().matrixWorld.decompose(v.head, v.q, v.s);
        rig.position.x += pose.x - v.head.x; rig.position.z += pose.z - v.head.z;
        rig.position.y = groundY(hm, pose.x, pose.z);
        n.recenter = false;
        rig.updateMatrixWorld(true); gl.xr.updateCamera(camera);
        gl.xr.getCamera().matrixWorld.decompose(v.head, v.q, v.s);
      }
      p = { x: v.head.x, z: v.head.z };
      v.fwd.set(0, 0, -1).applyQuaternion(v.q);
      const yaw = Math.atan2(-v.fwd.x, -v.fwd.z);
      heading = yaw;
      const session = gl.xr.getSession()!;
      let turn = 0, a = false, x = false, b = false;
      if (session.visibilityState === "visible") {
        for (const src of session.inputSources) {
          const gp = src.gamepad;
          if (!gp || gp.mapping !== "xr-standard") continue;
          const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] ?? 0, ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] ?? 0;
          if (src.handedness === "left") { forward = -ay; right = ax; fast = fast || !!gp.buttons[1]?.pressed; x = !!gp.buttons[4]?.pressed; }
          if (src.handedness === "right") { turn = ax; a = !!gp.buttons[4]?.pressed; b = !!gp.buttons[5]?.pressed; }
        }
      }
      if (Math.abs(turn) > 0.65 && !n.snap) {
        v.before.copy(v.head);
        rig.rotation.y -= Math.sign(turn) * (Math.PI / 6);
        rig.updateMatrixWorld(true); gl.xr.updateCamera(camera);
        gl.xr.getCamera().matrixWorld.decompose(v.after, v.q, v.s);
        rig.position.x += v.before.x - v.after.x; rig.position.z += v.before.z - v.after.z;
        n.snap = true;
      }
      if (Math.abs(turn) < 0.25) n.snap = false;
      if (a && !n.a) rt.ackPressed++;
      if (x && !n.x) { rt.autopilot = !rt.autopilot; rt.notify(); }
      if (b && !n.b) void session.end();
      n.a = a; n.x = x; n.b = b;
      if (Math.abs(forward) < 0.18) forward = 0;
      if (Math.abs(right) < 0.18) right = 0;

      // teleport aim from the right controller
      aim.current = null;
      const rc = controllers.find((c) => c.userData.hand === "right" && c.visible);
      if (rc && ring.current) {
        rc.updateWorldMatrix(true, false);
        v.o.setFromMatrixPosition(rc.matrixWorld);
        v.d.set(0, 0, -1).transformDirection(rc.matrixWorld);
        for (let t = 0.3; t <= TELEPORT_M + 2; t += 0.25) {
          const px = v.o.x + v.d.x * t, py = v.o.y + v.d.y * t, pz = v.o.z + v.d.z * t;
          if (py <= groundY(hm, px, pz)) {
            const cand = { x: px, z: pz };
            const check = stepFrom(p, cand.x - p.x, cand.z - p.z);
            if (Math.hypot(cand.x - p.x, cand.z - p.z) <= TELEPORT_M && !check.blocked) {
              aim.current = cand;
              ring.current.position.set(px, groundY(hm, px, pz) + 0.05, pz);
              ring.current.visible = true;
            }
            break;
          }
        }
      }
    } else {
      const k = keys.current;
      forward += (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
      right += (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
      fast = fast || k.has("ShiftLeft") || k.has("ShiftRight");
      n.yaw -= (rt.input.turn + (k.has("ArrowRight") || k.has("KeyE") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyQ") ? 1 : 0)) * dt * 1.4;
      heading = n.yaw;
    }

    // autopilot: walk along the route when nothing is pressed
    let auto: P2 | null = null;
    if (rt.autopilot && rt.line && forward === 0 && right === 0) {
      const end = rt.line.pts[rt.line.pts.length - 1];
      if (Math.hypot(end.x - p.x, end.z - p.z) > 3) {
        const tgt = pointAlong(rt.line, rt.progress + 8).p;
        const dx = tgt.x - p.x, dz = tgt.z - p.z, l = Math.hypot(dx, dz) || 1;
        auto = { x: dx / l, z: dz / l };
        if (!xr) {
          const want = Math.atan2(-auto.x, -auto.z);
          let d = want - n.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
          n.yaw += d * Math.min(1, dt * 2.5); heading = n.yaw;
        }
      } else { rt.autopilot = false; rt.notify(); }
    }

    let dx = 0, dz = 0;
    if (auto) {
      const s = WALK * rt.autoSpeed * dt;
      dx = auto.x * s; dz = auto.z * s;
    } else if (forward || right) {
      const len = Math.max(1, Math.hypot(forward, right)), s = (WALK * (fast ? FAST : 1) * dt) / len;
      dx = (-Math.sin(heading) * forward + Math.cos(heading) * right) * s;
      dz = (-Math.cos(heading) * forward - Math.sin(heading) * right) * s;
    }
    let blocked = "";
    if (dx || dz) {
      const r = stepFrom(p, dx, dz);
      rig.position.x += r.p.x - p.x; rig.position.z += r.p.z - p.z;
      p = r.p; blocked = r.blocked;
      if (blocked && rt.autopilot) { rt.autopilot = false; rt.notify(); }
    }
    const gy = groundY(hm, p.x, p.z);
    rig.position.y = gy;

    // the screen view: look, and a slow low-gravity gait sway while walking
    const moved = Math.hypot(p.x - n.last.x, p.z - n.last.z);
    const inst = dt > 0 ? moved / dt : 0;
    n.speed += (inst - n.speed) * Math.min(1, dt * 4);
    n.last = { x: p.x, z: p.z };
    if (!xr) {
      if (n.speed > 0.2 && n.speed < 4) n.bob += dt * Math.min(2.2, n.speed) * 4.6; else n.bob *= 0.9;
      const amp = n.speed > 0.2 && n.speed < 4 ? 1 : 0;
      camera.position.set(Math.sin(n.bob * 0.5) * 0.018 * amp, EYE + Math.abs(Math.sin(n.bob)) * 0.03 * amp, 0);
      // on a screen the wind buffets the view in a squall (never in the headset: the head is the user's own)
      const buffet = wind.storm ** 3 * (0.25 + wind.gust + wind.squall), bt = performance.now() / 1000;
      camera.rotation.set(n.pitch + Math.sin(bt * 23 + 1) * 0.0035 * buffet, n.yaw + Math.sin(bt * 17) * 0.003 * buffet, Math.sin(n.bob * 0.5) * 0.004 * amp + Math.sin(bt * 31) * 0.005 * buffet, "YXZ");
    }

    pose.x = p.x; pose.z = p.z; pose.y = gy;
    pose.heading = bearingOf(-Math.sin(heading), -Math.cos(heading));
    pose.speed = n.speed < 0.03 ? 0 : n.speed;
    pose.moving = n.speed > 0.15;
    pose.slope = slopeDeg(hm, p.x, p.z);
    pose.blocked = blocked;
  });

  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={40}>
      <ringGeometry args={[0.38, 0.5, 40]} />
      <meshBasicMaterial color="#9fe3ff" transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
    </mesh>
  );
}
