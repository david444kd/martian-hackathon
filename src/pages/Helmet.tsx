// EVA HELMET: the astronaut's view, on a screen or in a Meta Quest. You stand on the crew's zone
// (measured terrain, 1:1) inside a suit: walk freely, follow the route the ship sent (projected on
// the ground), and get the calls and warnings from mission control and the ship with sound and voice.
// Every 2.5 s the helmet reports where you are (position, heading, speed, suit values) so mission
// control and the ship see you move. When a hazard (a dust storm, a rockfall, a solar particle event)
// reaches your route, the EVA is aborted: alarm, RETURN TO BASE, and a new route back to the base.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import type * as THREE from "three";
import { Glasses, HardHat, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activePlan, useCrew, useCrews, useEvents, usePlans } from "../lib/queries";
import { crewHome, useHeightmap, useZone } from "../lib/zones";
import { useNow } from "../lib/mars";
import { CrewPicker, ErrorNote } from "../components/common";
import { load, save } from "../lib/storage";
import { EvaRuntime } from "../eva/runtime";
import { SuitAudio } from "../eva/audio";
import { SuitModel } from "../eva/suit";
import { useEva, type EvaView } from "../eva/useEva";
import { EvaHud } from "../eva/EvaHud";
import { toLocal } from "../eva/frame";

const EvaScene = lazy(() => import("../eva/EvaScene").then((m) => ({ default: m.EvaScene })));

const LAST_CREW = "mars-ops.helmet.crew";
/** autopilot pace over a suited walk (?speed=1 is real walking pace) */
const SPEED = Number(new URLSearchParams(location.search).get("speed")) || 8;

export function HelmetPicker() {
  const last = load<string | null>(LAST_CREW, null);
  const crews = useCrews();
  if (last && crews.data?.some((c) => c.id === last)) return <Navigate to={`/helmet/${last}`} replace />;
  return <CrewPicker base="/helmet" product="EVA Helmet" icon={<HardHat />} question="Whose helmet is this?" />;
}

export function Helmet() {
  const { crewId } = useParams();
  useEffect(() => { if (crewId) save(LAST_CREW, crewId); }, [crewId]);
  const crewQ = useCrew(crewId), plans = usePlans(crewId);
  const crew = crewQ.data ?? undefined;
  const zone = useZone(crew?.zone), hm = useHeightmap(zone);
  const home = useMemo(() => (crew ? crewHome(crew, zone) : null), [crew, zone]);
  const active = activePlan(plans.data), plan = active?.route ? active : null;
  const events = useEvents(), now = useNow(1000);
  const evs = useMemo(() => events.data ?? [], [events.data]);

  const rt = useMemo(() => { const r = new EvaRuntime(); r.autoSpeed = SPEED; return r; }, []);
  const audio = useMemo(() => new SuitAudio(), []);
  const suit = useMemo(() => new SuitModel(crewId ?? "none"), [crewId]);
  useEffect(() => () => audio.dispose(), [audio]);
  const [muted, setMuted] = useState(false);
  const [begun, setBegun] = useState(false);

  const v = useEva({ crew, zone, hm: hm.data, home, plan, evs, now, rt, audio, suit });
  const viewRef = useRef<EvaView | null>(null);
  viewRef.current = v;

  // the HiRISE close-up follows you in ~150 m steps
  const anchor = useMemo<[number, number] | null>(() => {
    if (!v) return home;
    const q = 0.0015;
    return [Math.round(v.at[0] / q) * q, Math.round(v.at[1] / q) * q];
  }, [v ? Math.round(v.at[0] / 0.0015) : 0, v ? Math.round(v.at[1] / 0.0015) : 0, home]); // eslint-disable-line react-hooks/exhaustive-deps

  // VR
  const [vrOk, setVrOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(() => { (navigator.xr?.isSessionSupported("immersive-vr") ?? Promise.resolve(false)).then(setVrOk, () => setVrOk(false)); }, []);
  const onGl = useCallback((gl: THREE.WebGLRenderer) => { glRef.current = gl; }, []);
  async function enterVr() {
    const gl = glRef.current;
    audio.start(); setBegun(true);
    if (!gl || !navigator.xr) return;
    try {
      const s = await navigator.xr.requestSession("immersive-vr", { requiredFeatures: ["local-floor"], optionalFeatures: ["bounded-floor"] });
      await gl.xr.setSession(s);
      setErr(null);
    } catch (e) { setErr(e instanceof DOMException && e.name === "NotAllowedError" ? "VR permission was declined. Allow immersive VR and try again." : e instanceof Error ? e.message : String(e)); }
  }
  function begin() { audio.start(); setBegun(true); glRef.current?.domElement.focus(); }

  // re-render on presenting changes (the HUD hides in VR)
  const [, force] = useState(0);
  useEffect(() => rt.subscribe(() => force((n) => n + 1)), [rt]);

  if (crewQ.isSuccess && !crew) return <HelmetPicker />;
  const homeL = hm.data && home ? toLocal(hm.data, home[0], home[1]) : null;

  return (
    <div className="relative h-full overflow-hidden bg-black">
      {hm.data && home && anchor && (
        <Suspense fallback={null}>
          <EvaScene hm={hm.data} home={home} rt={rt} view={viewRef} route={v?.route ?? plan?.route ?? null} mode={v?.mode ?? "standby"}
            storm={v?.storm ?? 0} windDeg={250 + Math.sin(now / 60000) * 30} lmst={v?.cond?.time.lmst ?? 12} anchor={anchor} hazards={v?.hazards ?? []} onGl={onGl} />
        </Suspense>
      )}

      {v && hm.data && homeL && !rt.presenting && (
        <EvaHud v={v} rt={rt} hm={hm.data} home={homeL} crewName={crew?.name ?? ""} vrOk={vrOk} muted={muted}
          onMute={() => { const m = !muted; setMuted(m); audio.setMuted(m); audio.start(); }} onEnterVr={enterVr} />
      )}

      {!begun && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary"><HardHat className="size-7" /></div>
            <div className="text-xs font-semibold tracking-[0.25em] text-muted-foreground uppercase">EVA Helmet · {crew?.name ?? "…"}</div>
            <h1 className="mt-2 font-heading text-3xl font-semibold">{plan ? plan.title : "Suit check complete"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {plan ? "The ship has started your EVA. Follow the markers on the ground; mission control sees where you are." : "No EVA started yet. You can walk around the base; the route appears when the ship starts the EVA."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button size="lg" className="h-12 rounded-xl px-6" disabled={!v} onClick={begin}><Play /> Begin on this screen</Button>
              {vrOk && <Button size="lg" variant="outline" className="h-12 rounded-xl px-6" disabled={!v} onClick={enterVr}><Glasses /> Enter VR</Button>}
            </div>
            {!v && <p className="mt-3 text-xs text-muted-foreground">Loading the surface…</p>}
            <p className="mt-4 text-xs text-muted-foreground">Sound: life support, breathing, radio and alarms. Suit readouts are simulated.</p>
            {err && <div className="mt-3"><ErrorNote error={`Couldn't start VR: ${err}`} /></div>}
            <div className="mt-3"><ErrorNote error={plans.error ?? crewQ.error} /></div>
          </div>
        </div>
      )}
      {begun && err && <div className="absolute bottom-24 left-1/2 z-20 w-[min(420px,90%)] -translate-x-1/2"><ErrorNote error={`Couldn't start VR: ${err}`} /></div>}
    </div>
  );
}
