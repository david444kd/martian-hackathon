// The helmet's view (three.js via react-three-fiber, WebXR for Meta Quest 2). Nothing to click:
// you stand on the surface 1:1 at your last checkpoint, facing the next one; the route is a glowing
// line on the ground with beacons ahead; a relief mini-map floats below your gaze and a status
// panel just under eye level. Everything follows the active work plan and your progress.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import type { Route, WorkPlan } from "../lib/types";
import { labelTexture, localOf, patchGeometry, terrainGeometry } from "./geometry";
import { useCloseup } from "./closeup";
import { closeupMaterial, detailTexture } from "./detail";
import { alongs, checkpointAt, checkpoints, legBearing, pointAt, type Checkpoint } from "./checkpoints";
import { compass, fmtDur, fmtKm } from "../lib/geo";

const ROUTE = new THREE.Color("#ffb347");
const SKY = "#c9946a";
const MINI_SIZE = 0.42; // m, the mini-map's width
const LITE = new URLSearchParams(location.search).has("lite");

interface SceneProps {
  hm: Heightmap;
  home: [number, number];
  plan: WorkPlan | null;   // the active work plan (null: standby)
  progress: number;        // metres walked along its route
  onGl: (gl: THREE.WebGLRenderer) => void;
  onXr: (s: XRSession | null) => void;
}

export function Scene(props: SceneProps) {
  return (
    <Canvas
      camera={{ fov: 70, near: 0.02, far: 40000, position: [0, 1.7, 0] }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.xr.enabled = true;
        gl.xr.setReferenceSpaceType("local-floor");
        // sharpness: three's default foveation (1) renders the edges of the view at low resolution;
        // ?lite in the address goes back to the cheaper settings if the headset drops frames
        gl.xr.setFoveation(LITE ? 1 : 0);
        gl.xr.setFramebufferScaleFactor(LITE ? 1 : 1.2);
        props.onGl(gl);
      }}>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 1500, 9000]} />
      <World {...props} />
    </Canvas>
  );
}

function World({ hm, home, plan, progress, onXr }: SceneProps) {
  const route = plan?.route ?? null;
  const cps = useMemo(() => (route ? checkpoints(route) : []), [route]);
  const along = useMemo(() => (route ? alongs(route) : []), [route]);
  const step = route ? checkpointAt(cps, progress) : 0;
  const M = useSurfaceMatrix(hm, home, route, cps, step);
  const geo = useMemo(() => terrainGeometry(hm, LITE ? 2 : 1), [hm]);
  const t = useMemo(() => placement(M), [M]);
  const gl = useThree((s) => s.gl);
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    const xr = gl.xr;
    const start = () => { setPresenting(true); onXr(xr.getSession()); };
    const end = () => { setPresenting(false); onXr(null); };
    xr.addEventListener("sessionstart", start);
    xr.addEventListener("sessionend", end);
    return () => { xr.removeEventListener("sessionstart", start); xr.removeEventListener("sessionend", end); };
  }, [gl, onXr]);

  const you = route ? pointAt(route, along, progress) : home;
  const here: [number, number] = route ? [route.points[cps[step].i][0], route.points[cps[step].i][1]] : home;

  return (
    <>
      <Terrain hm={hm} geo={geo} t={t} offset />
      <Closeup hm={hm} at={here} t={t} />
      {route && <RouteLine hm={hm} route={route} M={M} />}
      {route && <Beacons hm={hm} route={route} cps={cps} M={M} step={step} />}
      <FollowGaze distance={0.8} drop={0.33} tilt={0.95}>
        <MiniMap hm={hm} route={route} you={you} home={home} />
      </FollowGaze>
      {presenting && (
        <FollowGaze distance={1.2} drop={0.17} tilt={0}>
          <Hud plan={plan} cps={cps} step={step} progress={progress} />
        </FollowGaze>
      )}
      {!presenting && <LookAround step={step} />}
    </>
  );
}

type Placement = { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };

/** a transform as position / rotation / scale props */
function placement(M: THREE.Matrix4): Placement {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  M.decompose(p, q, s);
  return { p, q, s };
}

/** the zone's terrain with its orbital photo (plain Mars colour for the moment it loads) */
function Terrain({ hm, geo, t, offset = false }: { hm: Heightmap; geo: THREE.BufferGeometry; t: Placement; offset?: boolean }) {
  const fallback = (
    <mesh geometry={geo} position={t.p} quaternion={t.q} scale={t.s}>
      <meshBasicMaterial color="#a8724a" />
    </mesh>
  );
  return <Suspense fallback={fallback}><PhotoTerrain hm={hm} geo={geo} t={t} offset={offset} /></Suspense>;
}

function PhotoTerrain({ hm, geo, t, offset }: { hm: Heightmap; geo: THREE.BufferGeometry; t: Placement; offset: boolean }) {
  const gl = useThree((s) => s.gl);
  const map = useTexture(`/zones/${hm.zone.id}-photo.jpg`, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy(); // keeps the ground sharp towards the horizon
  });
  return (
    <mesh geometry={geo} position={t.p} quaternion={t.q} scale={t.s}>
      {/* pushed back a little so the close-up (same vertices) wins the depth test */}
      <meshBasicMaterial map={map} polygonOffset={offset} polygonOffsetFactor={1} polygonOffsetUnits={2} />
    </mesh>
  );
}

/** the HiRISE close-up around where you stand, laid on the same terrain */
function Closeup({ hm, at, t }: { hm: Heightmap; at: [number, number]; t: Placement }) {
  const gl = useThree((s) => s.gl);
  const c = useCloseup(hm.zone.id, at[0], at[1]);
  const geo = useMemo(() => (c ? patchGeometry(hm, c.bounds) : null), [hm, c]);
  useEffect(() => () => geo?.dispose(), [geo]);
  const mat = useMemo(() => (c ? closeupMaterial(c, detailTexture(), gl.capabilities.getMaxAnisotropy()) : null), [c, gl]);
  useEffect(() => () => mat?.dispose(), [mat]);
  if (!c || !geo || !mat) return null;
  return <mesh geometry={geo} material={mat} position={t.p} quaternion={t.q} scale={t.s} renderOrder={1} />;
}

/** the terrain frame placed so you stand at checkpoint `step`, facing the next one (or north on standby) */
function useSurfaceMatrix(hm: Heightmap, home: [number, number], route: Route | null, cps: Checkpoint[], step: number) {
  return useMemo(() => {
    if (!route) {
      const c = localOf(hm, home[0], home[1]);
      return new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
    }
    const here = route.points[cps[step].i], next = cps[Math.min(step + 1, cps.length - 1)];
    const c = localOf(hm, here[0], here[1]);
    const atEnd = next.i === cps[step].i;
    const towards = atEnd ? route.points[Math.max(0, cps[step].i - 1)] : route.points[next.i];
    let v = localOf(hm, towards[0], towards[1]).sub(c);
    if (atEnd) v = v.negate(); // at the target: keep facing the way you came in
    const a = Math.atan2(v.x, -v.z);
    return new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }, [hm, home, route, cps, step]);
}

function RouteLine({ hm, route, M }: { hm: Heightmap; route: Route; M: THREE.Matrix4 }) {
  const geo = useMemo(() => tube(hm, route, M, 0.25, 0.15), [hm, route, M]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <>
      <mesh geometry={geo}><meshBasicMaterial color={ROUTE} /></mesh>
      {/* the parts hidden behind hills, faintly */}
      <mesh geometry={geo} renderOrder={10}><meshBasicMaterial color={ROUTE} transparent opacity={0.25} depthTest={false} /></mesh>
    </>
  );
}

function tube(hm: Heightmap, route: Route, M: THREE.Matrix4, lift: number, radius: number) {
  const pts = route.points.map(([lat, lon]) => localOf(hm, lat, lon, lift).applyMatrix4(M));
  if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0, 0.001, 0)));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  return new THREE.TubeGeometry(curve, Math.min(2000, pts.length * 3), radius, 6, false);
}

/** the next three checkpoints and the target, as poles with a label that stays readable at any distance */
function Beacons({ hm, route, cps, M, step }: { hm: Heightmap; route: Route; cps: Checkpoint[]; M: THREE.Matrix4; step: number }) {
  const items = useMemo(() => cps.flatMap((cp, k) => {
    if (k <= step || (k > step + 3 && k !== cps.length - 1)) return [];
    const [lat, lon] = route.points[cp.i];
    const target = cp.label === "TARGET", color = target ? "#7be08a" : k === step + 1 ? "#ffffff" : "#ffb347";
    return [{ key: `${cp.i}-${k}`, base: localOf(hm, lat, lon).applyMatrix4(M), color, target, ...labelTexture(cp.label, color) }];
  }), [hm, route, cps, M, step]);
  useEffect(() => () => items.forEach((b) => b.texture.dispose()), [items]);
  return (
    <>
      {items.map((b) => {
        const h = b.target ? 48 : 30;
        return (
          <group key={b.key} position={b.base}>
            <mesh position={[0, h / 2, 0]}>
              <cylinderGeometry args={[0.35, 0.35, h, 8]} />
              <meshBasicMaterial color={b.color} transparent opacity={0.8} />
            </mesh>
            <sprite position={[0, h, 0]} renderOrder={20} scale={[0.045 * b.aspect, 0.045, 1]}>
              <spriteMaterial map={b.texture} sizeAttenuation={false} depthTest={false} />
            </sprite>
          </group>
        );
      })}
    </>
  );
}

/** keeps its children in front of you (turning with your head, not tilting), `drop` m below eye level, top tilted `tilt` rad towards you */
function FollowGaze({ distance, drop, tilt, children }: { distance: number; drop: number; tilt: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl), camera = useThree((s) => s.camera);
  const tmp = useRef({ fwd: new THREE.Vector3(), eye: new THREE.Vector3(), want: new THREE.Vector3(), yaw: 0, first: true });
  useFrame(() => {
    const g = ref.current, s = tmp.current;
    if (!g) return;
    const cam = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    cam.getWorldDirection(s.fwd);
    s.fwd.y = 0;
    if (s.fwd.lengthSq() < 1e-6) s.fwd.set(0, 0, -1);
    s.fwd.normalize();
    s.eye.setFromMatrixPosition(cam.matrixWorld);
    s.want.copy(s.eye).addScaledVector(s.fwd, distance);
    s.want.y -= drop;
    const yaw = Math.atan2(-s.fwd.x, -s.fwd.z);
    if (s.first) { g.position.copy(s.want); s.yaw = yaw; s.first = false; }
    else {
      g.position.lerp(s.want, 0.08);
      let d = yaw - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yaw += d * 0.08;
    }
    g.rotation.set(0, s.yaw, 0, "YXZ");
    g.rotateX(tilt);
  });
  return <group ref={ref}>{children}</group>;
}

function MiniMap({ hm, route, you, home }: { hm: Heightmap; route: Route | null; you: [number, number]; home: [number, number] }) {
  const z = hm.zone;
  const s = MINI_SIZE / (z.width * z.dx);
  // local terrain frame → mini-map: centred, scaled, heights exaggerated ×2
  const M = useMemo(() => new THREE.Matrix4().makeScale(s, s * 2, s), [s]); // terrain sits on the board
  const geo = useMemo(() => terrainGeometry(hm, 4), [hm]);
  const t = useMemo(() => placement(M), [M]);
  const line = useMemo(() => (route ? tube(hm, route, M, 8, 0.0025) : null), [hm, route, M]);
  useEffect(() => () => line?.dispose(), [line]);
  const youAt = localOf(hm, you[0], you[1]).applyMatrix4(M);
  const target = route ? localOf(hm, route.target.lat, route.target.lon).applyMatrix4(M) : null;
  const homeAt = localOf(hm, home[0], home[1]).applyMatrix4(M);
  const pulse = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (pulse.current) pulse.current.scale.setScalar(1 + ((clock.elapsedTime * 1.2) % 1) * 2.5); });

  return (
    <group>
      <mesh position={[0, -0.006, 0]}>
        <boxGeometry args={[MINI_SIZE + 0.03, 0.008, MINI_SIZE + 0.03]} />
        <meshBasicMaterial color="#1a1410" transparent opacity={0.85} />
      </mesh>
      <Terrain hm={hm} geo={geo} t={t} />
      {line && <mesh geometry={line}><meshBasicMaterial color={ROUTE} /></mesh>}
      <mesh position={homeAt.clone().add(new THREE.Vector3(0, 0.006, 0))}>
        <sphereGeometry args={[0.004, 12, 8]} />
        <meshBasicMaterial color="#5ec4d6" />
      </mesh>
      {target && (
        <mesh position={target.clone().add(new THREE.Vector3(0, 0.012, 0))}>
          <cylinderGeometry args={[0.002, 0.002, 0.024, 8]} />
          <meshBasicMaterial color="#7be08a" />
        </mesh>
      )}
      <group position={youAt.clone().add(new THREE.Vector3(0, 0.004, 0))}>
        <mesh><sphereGeometry args={[0.0065, 16, 10]} /><meshBasicMaterial color="#4fd1ff" /></mesh>
        <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.007, 0.009, 24]} />
          <meshBasicMaterial color="#4fd1ff" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
  }
  return out.length > maxLines ? [...out.slice(0, maxLines - 1), `${out[maxLines - 1]}…`] : out;
}

/** the status panel under eye level, drawn on a canvas texture */
function Hud({ plan, cps, step, progress }: { plan: WorkPlan | null; cps: Checkpoint[]; step: number; progress: number }) {
  const { texture, canvas } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 400;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, canvas };
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const route = plan?.route ?? null;
  const tick = Math.round(progress / 10); // redraw every 10 m, not every frame

  useEffect(() => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 1024, 400);
    ctx.fillStyle = "rgba(8,10,14,0.74)";
    ctx.beginPath(); ctx.roundRect(4, 4, 1016, 392, 28); ctx.fill();
    ctx.strokeStyle = route ? "#ffb347" : "#9aa4b2"; ctx.lineWidth = 4; ctx.stroke();
    ctx.font = "600 30px system-ui, sans-serif"; ctx.fillStyle = "#9aa4b2";
    ctx.fillText(route ? "EVA · ACTIVE WORK PLAN" : "EVA HELMET", 36, 58);
    if (!plan || !route) {
      ctx.fillStyle = "#fff"; ctx.font = "bold 60px system-ui, sans-serif";
      ctx.fillText("Standby", 36, 150);
      ctx.font = "38px system-ui, sans-serif"; ctx.fillStyle = "#e6e6e6";
      ctx.fillText("Waiting for the ship to start an EVA.", 36, 220);
      ctx.fillText("Your route appears here on its own.", 36, 275);
    } else {
      const bearing = legBearing(route, cps, step), total = route.distance_m || 1;
      const left = Math.max(0, total - progress), arrived = left < 1;
      ctx.fillStyle = "#ffb347"; ctx.font = "bold 44px system-ui, sans-serif";
      ctx.fillText(plan.title.slice(0, 40), 36, 112);
      ctx.fillStyle = "#fff"; ctx.font = "bold 50px system-ui, sans-serif";
      if (arrived) {
        ctx.fillText("Target reached", 36, 180);
        ctx.font = "34px system-ui, sans-serif"; ctx.fillStyle = "#e6e6e6";
        wrap(ctx, plan.description || "Carry out the work plan.", 950, 3).forEach((l, i) => ctx.fillText(l, 36, 235 + i * 44));
      } else {
        const next = cps[step + 1], toNext = Math.max(0, next.along - progress);
        ctx.fillText(`${next.label === "TARGET" ? "Target" : `Checkpoint ${next.label}`} in ${fmtKm(toNext)}`, 36, 180);
        ctx.font = "38px system-ui, sans-serif"; ctx.fillStyle = "#e6e6e6";
        ctx.fillText(`Heading ${Math.round(bearing)}° ${compass(bearing)}`, 36, 240);
        ctx.fillText(`To target ${fmtKm(left)} · ~${fmtDur(route.duration_min * (left / total))}`, 36, 292);
      }
      // progress bar
      ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(36, 340, 952, 14);
      ctx.fillStyle = "#4fd1ff"; ctx.fillRect(36, 340, 952 * Math.min(1, progress / total), 14);
    }
    texture.needsUpdate = true;
  }, [canvas, texture, plan, route, cps, step, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <mesh renderOrder={30}>
      <planeGeometry args={[0.56, 0.22]} />
      <meshBasicMaterial map={texture} transparent depthTest={false} />
    </mesh>
  );
}

/** on a screen: drag to look around from where you stand */
function LookAround({ step }: { step: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => { camera.position.set(0, 1.7, 0); }, [camera, step]);
  // orbit a point 1 cm ahead, reversed so dragging feels like turning your head
  return <OrbitControls key={step} target={[0, 1.7, -0.01]} enableZoom={false} enablePan={false} rotateSpeed={-0.35} />;
}
