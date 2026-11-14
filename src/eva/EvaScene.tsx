// The EVA view: three.js through react-three-fiber, WebXR for Meta Quest. You stand on the crew's
// zone at 1:1 scale (measured 20 m DTM with the zone photo, HiRISE close-up around you), walk on it
// freely, and see the route projected on the ground, the base, the anomalies and dust in a storm.
// In VR the suit display is head-locked to the visor (XrHud); on a screen the HTML HUD covers it.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { Closeup, HazardColumns, Terrain, placement, tube } from "../astro/Scene";
import { patchGeometry, terrainGeometry } from "../astro/geometry";
import type { Route } from "../lib/types";
import { Player } from "./Player";
import { Beacon, Dust, GroundGuide, Rocks, RouteTube, Sky, skyColors, StormWall } from "./World";
import { Buttes, Outpost, ScienceSite } from "./Structures";
import { Suit } from "./SuitBody";
import type { Closed } from "./runtime";
import { drawXrHud, ROUTE_BACK, ROUTE_OUT } from "./draw";
import { toLatLon, toLocal, type P2 } from "./frame";
import type { EvaRuntime } from "./runtime";
import type { EvaView } from "./useEva";

const LITE = new URLSearchParams(location.search).has("lite");
const IDENTITY_M = new THREE.Matrix4();
const IDENTITY = placement(IDENTITY_M);

interface Props {
  hm: Heightmap;
  home: [number, number];
  rt: EvaRuntime;
  view: RefObject<EvaView | null>;
  route: Route | null;
  mode: EvaView["mode"];
  storm: number;
  windDeg: number;
  lmst: number;
  anchor: [number, number];   // where the HiRISE close-up is centred (moves in steps as you walk)
  hazards: EvaView["hazards"];
  onGl: (gl: THREE.WebGLRenderer) => void;
}

export function EvaScene(props: Props) {
  const { horizon } = skyColors(props.storm);
  return (
    <Canvas
      camera={{ fov: 72, near: 0.05, far: 40000, position: [0, 1.68, 0] }}
      gl={{ antialias: true }}
      shadows={LITE ? false : "soft"}
      onCreated={({ gl }) => {
        gl.xr.enabled = true;
        gl.xr.setReferenceSpaceType("local-floor");
        gl.xr.setFoveation(LITE ? 1 : 0.3);
        gl.xr.setFramebufferScaleFactor(LITE ? 1 : 1.15);
        props.onGl(gl);
      }}>
      <color attach="background" args={[horizon]} />
      <fog attach="fog" args={[horizon, 1400 * (1 - props.storm * 0.997), 9000 * (1 - props.storm * 0.985)]} />
      <Surface {...props} />
    </Canvas>
  );
}

function sunDirection(lmst: number) {
  // the Sun crosses the sky from east (06:00) to west (18:00); kept above the horizon so the scene stays readable
  const a = ((lmst - 6) / 12) * Math.PI, el = Math.max(0.16, Math.sin(Math.min(Math.max(a, 0.05), Math.PI - 0.05)) * 1.05);
  return new THREE.Vector3(Math.cos(a), Math.sin(el), -0.35).normalize();
}

function Surface({ hm, home, rt, view, route, mode, storm, windDeg, lmst, anchor, hazards }: Props) {
  const geo = useMemo(() => terrainGeometry(hm, LITE ? 2 : 1), [hm]);
  useEffect(() => () => geo.dispose(), [geo]);
  const sun = useMemo(() => sunDirection(lmst), [Math.round(lmst * 4)]); // eslint-disable-line react-hooks/exhaustive-deps
  const homeL = useMemo(() => toLocal(hm, home[0], home[1]), [hm, home]);
  // solid things the astronaut walks around: the outpost and the buttes
  const solids = useRef<{ base: Closed[]; buttes: Closed[] }>({ base: [], buttes: [] });
  const setBase = useCallback((b: Closed[]) => { solids.current.base = b; rt.solid = [...b, ...solids.current.buttes]; }, [rt]);
  const setButtes = useCallback((b: Closed[]) => { solids.current.buttes = b; rt.solid = [...solids.current.base, ...b]; }, [rt]);
  const suitRead = useCallback(() => {
    const s = view.current?.suit;
    return { o2: s?.o2Pct ?? 100, min: s?.remainingMin ?? 480, pulse: s?.pulse ?? 72, status: s?.status ?? "NOMINAL" };
  }, [view]);
  const line = rt.line;
  const back = mode === "return" || mode === "complete";
  const color = back ? ROUTE_BACK : ROUTE_OUT;
  const tubeGeo = useMemo(() => (route ? tube(hm, route, new THREE.Matrix4(), 0.35, 0.07) : null), [hm, route]);
  useEffect(() => () => tubeGeo?.dispose(), [tubeGeo]);
  const end = useMemo<P2 | null>(() => (route ? toLocal(hm, route.target.lat, route.target.lon) : null), [hm, route]);
  const light = 1 - storm * 0.6;
  const solidHazards = useMemo(() => hazards.filter((e) => e.kind !== "dust_storm" && e.kind !== "dust_devil"), [hazards]);

  return (
    <>
      <Sky storm={storm} sunDir={sun} />
      <Environment storm={storm} sun={sun} />
      <hemisphereLight args={["#f1c9a4", "#5b3a26", 0.75 * light]} />
      <SunLight rt={rt} dir={sun} intensity={2.4 * light} />
      {!LITE && <ShadowGround hm={hm} rt={rt} strength={0.5 * (1 - storm * 0.8)} />}
      <Terrain hm={hm} geo={geo} t={IDENTITY} offset />
      <Closeup hm={hm} at={anchor} t={IDENTITY} />
      <Rocks hm={hm} rt={rt} route={line} />
      <Outpost hm={hm} home={homeL} onSolid={setBase} />
      <Buttes hm={hm} home={homeL} line={line} rt={rt} onSolid={setButtes} />
      {end && !back && <ScienceSite hm={hm} at={end} />}
      {tubeGeo && <RouteTube geo={tubeGeo} color={color} />}
      <GroundGuide hm={hm} rt={rt} line={line} color={color} />
      {end && !back && <Beacon hm={hm} at={end} color="#7be08a" />}
      {back && <Beacon hm={hm} at={homeL} color={ROUTE_BACK} height={9} />}
      <HazardColumns hm={hm} hazards={solidHazards} M={IDENTITY_M} />
      {hazards.filter((e) => e.kind === "dust_storm" || e.kind === "dust_devil").map((e) => (
        <StormWall key={e.id} hm={hm} at={toLocal(hm, e.lat!, e.lon!)} radius={e.radius_m!} devil={e.kind === "dust_devil"} level={e.level} />
      ))}
      <Dust storm={storm} windDeg={windDeg} />
      <Player hm={hm} rt={rt} />
      <Suit rt={rt} o2={suitRead} />
      <XrHud hm={hm} rt={rt} view={view} home={homeL} />
    </>
  );
}

/** sunlight whose shadow box follows the astronaut (±70 m), stepped in 2 m so the shadows do not swim */
function SunLight({ rt, dir, intensity }: { rt: EvaRuntime; dir: THREE.Vector3; intensity: number }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  useEffect(() => { const l = ref.current!; scene.add(l.target); return () => { scene.remove(l.target); }; }, [scene]);
  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    const x = Math.round(rt.pose.x / 2) * 2, z = Math.round(rt.pose.z / 2) * 2;
    l.target.position.set(x, rt.pose.y, z);
    l.position.set(x + dir.x * 260, rt.pose.y + dir.y * 260, z + dir.z * 260);
  });
  return (
    <directionalLight ref={ref} intensity={intensity} color="#fff1df" castShadow={!LITE}
      shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.05}
      shadow-camera-left={-70} shadow-camera-right={70} shadow-camera-top={70} shadow-camera-bottom={-70} shadow-camera-near={20} shadow-camera-far={700} />
  );
}

/**
 * The terrain is an unlit photo, so it cannot take shadows itself: this lays the same triangles
 * (the DTM cells around the astronaut) over it with a material that draws only the shadows.
 */
function ShadowGround({ hm, rt, strength }: { hm: Heightmap; rt: EvaRuntime; strength: number }) {
  const [c, setC] = useState<P2>(() => ({ x: rt.pose.x, z: rt.pose.z }));
  useFrame(() => { if (Math.hypot(rt.pose.x - c.x, rt.pose.z - c.z) > 50) setC({ x: rt.pose.x, z: rt.pose.z }); });
  const geo = useMemo(() => {
    const [n, w] = toLatLon(hm, c.x - 150, c.z - 150), [s, e] = toLatLon(hm, c.x + 150, c.z + 150);
    return patchGeometry(hm, { north: n, south: s, west: w, east: e });
  }, [hm, c]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} receiveShadow renderOrder={2}>
      <shadowMaterial transparent opacity={strength} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} color="#1a0d06" />
    </mesh>
  );
}

/** what the metal, glass and gold foil reflect: the Martian sky and ground, baked once into an environment map */
function Environment({ storm, sun }: { storm: number; sun: THREE.Vector3 }) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  const key = Math.round(storm * 3);
  useEffect(() => {
    const { horizon, zenith } = skyColors(key / 3);
    const pm = new THREE.PMREMGenerator(gl), env = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { horizon: { value: horizon }, zenith: { value: zenith }, ground: { value: new THREE.Color("#8a5a3c") }, sun: { value: sun.clone() } },
      vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
      fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 ground; uniform vec3 sun; varying vec3 vD;
        void main(){ vec3 d = normalize(vD);
          vec3 c = d.y > 0. ? mix(horizon, zenith, pow(d.y, .5)) : mix(horizon * .8, ground * .55, clamp(-d.y * 3., 0., 1.));
          c += vec3(1.,.95,.85) * pow(max(dot(d, normalize(sun)), 0.), 200.) * 14.;
          gl_FragColor = vec4(c, 1.); }`,
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
    env.add(ball);
    const target = pm.fromScene(env, 0.03);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.85;
    return () => { scene.environment = null; target.dispose(); pm.dispose(); mat.dispose(); ball.geometry.dispose(); };
  }, [gl, scene, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * The suit display in VR: a canvas texture on a plane 2 m in front of the eyes, a child of the camera
 * so it stays fixed in the visor; plus the helmet's upper and lower rim. Hidden on a screen.
 */
function XrHud({ hm, rt, view, home }: { hm: Heightmap; rt: EvaRuntime; view: RefObject<EvaView | null>; home: P2 }) {
  const camera = useThree((s) => s.camera), gl = useThree((s) => s.gl);
  const parts = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1536; canvas.height = 864;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const hud = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.63), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    hud.position.set(0, -0.02, -2); hud.renderOrder = 1000;
    // the helmet shell around the visor: a dark frame with an oval opening, plus a thin lit gasket
    const rimMat = new THREE.MeshBasicMaterial({ color: "#0d171c", transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false });
    const gasketMat = new THREE.MeshBasicMaterial({ color: "#8fa3a8", transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, fog: false });
    const frame = new THREE.Shape();
    frame.moveTo(-3, -2.4); frame.lineTo(3, -2.4); frame.lineTo(3, 2.4); frame.lineTo(-3, 2.4); frame.closePath();
    const hole = new THREE.Path(); hole.absellipse(0, 0.05, 1.42, 1.0, 0, Math.PI * 2, false, 0);
    frame.holes.push(hole);
    const gasket = new THREE.Shape(); gasket.absellipse(0, 0.05, 1.45, 1.03, 0, Math.PI * 2, false, 0);
    const gHole = new THREE.Path(); gHole.absellipse(0, 0.05, 1.42, 1.0, 0, Math.PI * 2, false, 0); gasket.holes.push(gHole);
    const rims = [new THREE.Mesh(new THREE.ShapeGeometry(frame, 64), rimMat), new THREE.Mesh(new THREE.ShapeGeometry(gasket, 64), gasketMat)];
    rims.forEach((m) => { m.position.z = -1.5; m.renderOrder = 1001; });
    const group = new THREE.Group();
    group.add(hud, ...rims);
    group.visible = false;
    return { canvas, tex, group, hud, rims, rimMat, gasketMat };
  }, []);
  useEffect(() => {
    camera.add(parts.group);
    return () => {
      camera.remove(parts.group);
      parts.tex.dispose(); parts.rimMat.dispose(); parts.gasketMat.dispose();
      (parts.hud.material as THREE.Material).dispose(); parts.hud.geometry.dispose();
      parts.rims.forEach((r) => r.geometry.dispose());
    };
  }, [camera, parts]);
  const ctx = useMemo(() => parts.canvas.getContext("2d")!, [parts]);
  const acc = useMemo(() => ({ t: 0 }), []);
  useFrame(({ clock }, dt) => {
    parts.group.visible = gl.xr.isPresenting;
    if (!gl.xr.isPresenting) return;
    acc.t += dt;
    if (acc.t < 0.15) return;
    acc.t = 0;
    const v = view.current;
    if (!v) return;
    drawXrHud(ctx, hm, v, rt, home, clock.elapsedTime);
    parts.tex.needsUpdate = true;
  });
  return null;
}
