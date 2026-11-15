// The EVA view: three.js through react-three-fiber, WebXR for Meta Quest. You stand on the crew's
// zone at 1:1 scale (measured 20 m DTM with the zone photo, HiRISE close-up around you), walk on it
// freely, and see the route projected on the ground, the base, the anomalies and dust in a storm.
// In VR the suit display is head-locked to the visor (XrHud); on a screen the HTML HUD covers it.
// Built to a headset's budget (quality.ts): the ground is one pass with levels of detail (Ground.tsx),
// the base, buttes and suit are welded into a few meshes (merge.tsx), dust is computed on the GPU
// (Storm.tsx), and the shadow map is redrawn only when needed (atmo.tsx).
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { HazardColumns, tube } from "../astro/Scene";
import type { Route } from "../lib/types";
import { Player } from "./Player";
import { Beacon, GroundGuide, Rocks, RouteTube } from "./World";
import { ATMO, Atmosphere, Lights, Sky } from "./atmo";
import { Ground } from "./Ground";
import { DustDevil, StormFront, VisorGrit, WindDust } from "./Storm";
import { wind } from "./wind";
import { Buttes, Outpost, ScienceSite } from "./Structures";
import { Suit } from "./SuitBody";
import type { Closed } from "./runtime";
import { ROUTE_BACK, ROUTE_OUT } from "./draw";
import { drawHudPart, HUD_PARTS } from "./xrHud";
import { QUEST2_FOV_Y, XR_PREVIEW } from "./xrPreview";
import { Q } from "./quality";
import { toLocal, type P2 } from "./frame";
import type { EvaRuntime } from "./runtime";
import type { EvaView } from "./useEva";

/** the visor HUD blocks are drawn this much larger in the headset than on a screen (text ≈0.8–1.2°) */
const XR_HUD_SCALE = 1.3;
/** the HUD patches sit on a sphere this far from the eyes, at the Quest 2 panel's ~21 px per degree */
const HUD_R = 2, HUD_PX_PER_DEG = 21;
/** how often each HUD block is redrawn, s (one block per frame at most: a canvas upload is not free) */
const HUD_EVERY: Record<string, number> = { tape: 0.1, map: 0.2, message: 0.15, nav: 0.3, suit: 0.5, env: 1 };

const IDENTITY_M = new THREE.Matrix4();

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
  return (
    <Canvas
      camera={{ fov: XR_PREVIEW ? QUEST2_FOV_Y : 72, near: 0.05, far: 16000, position: [0, 1.68, 0] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      shadows={Q.shadows ? "percentage" : false}
      onCreated={({ gl }) => {
        gl.xr.enabled = true;
        gl.xr.setReferenceSpaceType("local-floor");
        gl.xr.setFoveation(Q.foveation);
        gl.xr.setFramebufferScaleFactor(Q.fbScale);
        if (import.meta.env.DEV) (window as unknown as { __evaGl: THREE.WebGLRenderer }).__evaGl = gl; // draw-call / triangle counts from the console
        props.onGl(gl);
      }}>
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
  const solidHazards = useMemo(() => hazards.filter((e) => e.kind !== "dust_storm" && e.kind !== "dust_devil"), [hazards]);
  const dusty = useMemo(() => hazards.filter((e) => e.kind === "dust_storm" || e.kind === "dust_devil").map((e) => ({ e, at: toLocal(hm, e.lat!, e.lon!) })), [hm, hazards]);
  // the ground shader veils the ground before the two nearest storm fronts
  useEffect(() => {
    const fronts = dusty.filter((d) => d.e.kind === "dust_storm").sort((a, b) => Math.hypot(a.at.x - rt.pose.x, a.at.z - rt.pose.z) - a.e.radius_m! - (Math.hypot(b.at.x - rt.pose.x, b.at.z - rt.pose.z) - b.e.radius_m!));
    ATMO.uFronts.value.forEach((v, i) => { const f = fronts[i]; if (f) v.set(f.at.x, f.at.z, f.e.radius_m!, 1); else v.set(0, 0, 0, 0); });
    return () => ATMO.uFronts.value.forEach((v) => v.set(0, 0, 0, 0));
  }, [dusty, rt]);

  return (
    <>
      <Atmosphere storm={storm} windDeg={windDeg} sun={sun} />
      <Sky />
      <Environment sun={sun} />
      <Lights rt={rt} dir={sun} />
      <Ground hm={hm} rt={rt} anchor={anchor} />
      <Rocks hm={hm} rt={rt} route={line} />
      <Outpost hm={hm} home={homeL} onSolid={setBase} />
      <Buttes hm={hm} home={homeL} line={line} rt={rt} onSolid={setButtes} />
      {end && !back && <ScienceSite hm={hm} at={end} />}
      {tubeGeo && <RouteTube geo={tubeGeo} color={color} />}
      <GroundGuide hm={hm} rt={rt} line={line} color={color} />
      {end && !back && <Beacon hm={hm} at={end} color="#7be08a" />}
      {back && <Beacon hm={hm} at={homeL} color={ROUTE_BACK} height={9} />}
      <HazardColumns hm={hm} hazards={solidHazards} M={IDENTITY_M} />
      {dusty.map(({ e, at }) => e.kind === "dust_devil"
        ? <DustDevil key={e.id} hm={hm} at={at} radius={e.radius_m!} rt={rt} />
        : <StormFront key={e.id} hm={hm} at={at} radius={e.radius_m!} level={e.level} rt={rt} />)}
      <WindDust />
      <VisorGrit />
      <Player hm={hm} rt={rt} />
      <Suit rt={rt} o2={suitRead} />
      <XrHud hm={hm} rt={rt} view={view} home={homeL} />
      <Governor />
    </>
  );
}

/** what the metal, glass and gold foil reflect: the Martian sky and ground, baked once into an environment map (dimmed by the dust in atmo.tsx) */
function Environment({ sun }: { sun: THREE.Vector3 }) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl), env = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { horizon: { value: new THREE.Color("#d9a27a") }, zenith: { value: new THREE.Color("#8a5d48") }, ground: { value: new THREE.Color("#8a5a3c") }, sun: { value: sun.clone() } },
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
    return () => { scene.environment = null; target.dispose(); pm.dispose(); mat.dispose(); ball.geometry.dispose(); };
  }, [gl, scene, sun]);
  return null;
}

/**
 * Holds the frame rate in the headset: if frames are being dropped, the outer part of each eye's view
 * is drawn coarser (fixed foveation), step by step. It never asks for more than the device can do.
 */
function Governor() {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  useEffect(() => { if (import.meta.env.DEV) Object.assign(window, { __evaScene: scene, __evaWind: wind }); }, [scene]);
  const s = useRef({ t: 0, n: 0, slow: 0 });
  useFrame((_, dt) => {
    const st = s.current;
    st.t += dt; st.n++;
    if (st.t < 2) return;
    const fps = st.n / st.t;
    st.t = 0; st.n = 0;
    if (import.meta.env.DEV) (window as unknown as { __evaFps: number }).__evaFps = Math.round(fps);
    if (!gl.xr.isPresenting) { st.slow = 0; return; }
    const target = (gl.xr.getSession() as (XRSession & { frameRate?: number }) | null)?.frameRate ?? 72;
    st.slow = fps < target * 0.9 ? st.slow + 1 : 0;
    const f = gl.xr.getFoveation() ?? 1;
    if (st.slow >= 2 && f < 1) { gl.xr.setFoveation(Math.min(1, f + 0.2)); st.slow = 0; }
  });
  return null;
}

/**
 * The suit display in VR: the HUD blocks as small patches round the edge of the visor, 2 m from the eyes,
 * children of the camera so they stay fixed in the helmet; plus the soft vignette of the helmet edge.
 * Hidden on a screen (shown with ?xrview=1).
 */
function XrHud({ hm, rt, view, home }: { hm: Heightmap; rt: EvaRuntime; view: RefObject<EvaView | null>; home: P2 }) {
  const camera = useThree((s) => s.camera), gl = useThree((s) => s.gl);
  const parts = useMemo(() => {
    const group = new THREE.Group();
    // the display blocks (xrHud.ts HUD_PARTS): each a small patch on a sphere round the eyes, facing
    // them, at its own angle round the edge of the visor — like writing on the glass, the centre clear
    const patches = HUD_PARTS.map((part) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(part.w * XR_HUD_SCALE); canvas.height = Math.ceil(part.h * XR_HUD_SCALE);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      const deg = THREE.MathUtils.degToRad;
      const wM = 2 * HUD_R * Math.tan(deg(canvas.width / HUD_PX_PER_DEG) / 2), hM = 2 * HUD_R * Math.tan(deg(canvas.height / HUD_PX_PER_DEG) / 2);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
      const yaw = deg(part.yaw), pitch = deg(part.pitch);
      mesh.position.set(HUD_R * Math.sin(yaw) * Math.cos(pitch), -HUD_R * Math.sin(pitch), -HUD_R * Math.cos(yaw) * Math.cos(pitch));
      mesh.rotation.order = "YXZ"; mesh.rotation.set(-pitch, -yaw, deg(part.roll));
      mesh.renderOrder = 1000;
      group.add(mesh);
      return { part, canvas, ctx: canvas.getContext("2d")!, tex, mesh };
    });
    // the helmet around the visor: a soft vignette at the very edge of the field of view (a large
    // bubble visor shows its frame mostly in the corners), with a faint gasket line; nothing hard
    const vig = document.createElement("canvas"); vig.width = vig.height = 512;
    const vg = vig.getContext("2d")!, gr = vg.createRadialGradient(256, 256, 0, 256, 256, 256);
    gr.addColorStop(0, "rgba(10,18,22,0)"); gr.addColorStop(0.8, "rgba(10,18,22,0)");
    gr.addColorStop(0.83, "rgba(150,165,160,0.10)"); gr.addColorStop(0.86, "rgba(10,18,22,0.08)");
    gr.addColorStop(0.95, "rgba(10,18,22,0.5)"); gr.addColorStop(1, "rgba(8,14,18,0.78)");
    vg.fillStyle = gr; vg.fillRect(0, 0, 512, 512); // past the radius the last colour carries on into the corners
    const vigTex = new THREE.CanvasTexture(vig); vigTex.colorSpace = THREE.SRGBColorSpace;
    // the same plane carries the dust that settles on the glass in a storm (thickest towards the rim)
    const rimMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, fog: false,
      uniforms: { uVig: { value: vigTex }, uCloud: ATMO.uCloud, uFilm: ATMO.uFilm, uDust: ATMO.uDust },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `uniform sampler2D uVig, uCloud; uniform float uFilm; uniform vec3 uDust; varying vec2 vUv;
        void main(){
          vec4 v = texture2D(uVig, vUv);
          float film = 0.0;
          if (uFilm > 0.002) {
            float n = texture2D(uCloud, vUv * vec2(2.5, 2.2)).g * 0.6 + texture2D(uCloud, vUv * 8.0 + 0.3).g * 0.4;
            film = uFilm * smoothstep(0.32, 0.66, n) * (0.16 + 0.84 * smoothstep(0.12, 0.52, length(vUv - 0.5))) * 0.4;
          }
          float a = v.a + film * (1.0 - v.a);
          gl_FragColor = linearToOutputTexel(vec4((v.rgb * v.a + uDust * 0.85 * film * (1.0 - v.a)) / max(a, 0.0001), a)); }`,
    });
    // 4.2 × 3.6 m at 1.5 m: clear out to ~47° sideways and ~43° up/down, darker only past that
    const rim = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.6), rimMat);
    rim.position.set(0, 0.02, -1.5); rim.renderOrder = 997; // under the display: dust on the glass does not hide the readouts
    group.add(rim);
    group.visible = false;
    return { group, patches, rim, rimMat, vigTex, flick: { v: 1 } };
  }, []);
  useEffect(() => {
    camera.add(parts.group);
    return () => {
      camera.remove(parts.group);
      parts.patches.forEach((p) => { p.tex.dispose(); (p.mesh.material as THREE.Material).dispose(); p.mesh.geometry.dispose(); });
      parts.vigTex.dispose(); parts.rimMat.dispose(); parts.rim.geometry.dispose();
    };
  }, [camera, parts]);
  const due = useMemo(() => HUD_PARTS.map(() => 0), []);
  useFrame(({ clock }, dt) => {
    const shown = gl.xr.isPresenting || XR_PREVIEW;
    parts.group.visible = shown;
    if (!shown) return;
    // a static discharge in the dust: the display flickers for an instant
    const flick = performance.now() - wind.zapAt < 130 ? 0.5 + Math.random() * 0.4 : 1;
    if (flick !== parts.flick.v) { parts.flick.v = flick; for (const p of parts.patches) (p.mesh.material as THREE.MeshBasicMaterial).opacity = flick; }
    const v = view.current;
    if (!v) return;
    // redraw the one block that is most overdue
    let pick = -1, most = 0;
    for (let i = 0; i < due.length; i++) { due[i] += dt; const over = due[i] / (HUD_EVERY[HUD_PARTS[i].id] ?? 0.3); if (over >= 1 && over > most) { most = over; pick = i; } }
    if (pick < 0) return;
    due[pick] = 0;
    const p = parts.patches[pick];
    drawHudPart(p.ctx, p.part, { hm, v, rt, home, t: clock.elapsedTime }, XR_HUD_SCALE);
    p.tex.needsUpdate = true;
  });
  return null;
}
