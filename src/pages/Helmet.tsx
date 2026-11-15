// EVA HELMET: the astronaut's view, on a screen or in a Meta Quest. You stand on the crew's zone
// (measured terrain, 1:1) inside a suit: walk freely, follow the route the ship sent (projected on
// the ground), and get the calls and warnings from mission control and the ship with sound and voice.
// Every 2.5 s the helmet reports where you are (position, heading, speed, suit values) so mission
// control and the ship see you move. When a hazard (a dust storm, a rockfall, a solar particle event)
// reaches your route, the EVA is aborted: alarm, RETURN TO BASE, and a new route back to the base.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
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
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SIM_ROUTE, simulatedDust, simulatedStormAt, simulatedTarget, SIMULATED_DUST, SIMULATED_HUD, withSimulatedAlerts, XR_PREVIEW } from "../eva/xrPreview";
import { generateRoute } from "../lib/routing";
import type { Route } from "../lib/types";
import { QUEST } from "../eva/quality";

const EvaScene = lazy(() => import("../eva/EvaScene").then((m) => ({ default: m.EvaScene })));

const LAST_CREW = "mars-ops.helmet.crew";
/** autopilot pace over a suited walk (?speed=1 is real walking pace) */
const SPEED = Number(new URLSearchParams(location.search).get("speed")) || 8;

export function HelmetPicker() {
  const { t } = useTranslation();
  const last = load<string | null>(LAST_CREW, null);
  const crews = useCrews();
  if (last && crews.data?.some((c) => c.id === last)) return <Navigate to={`/helmet/${last}`} replace />;
  return <CrewPicker base="/helmet" product={t("helmet.brand")} icon={<HardHat />} question={t("picker.helmetQuestion")} />;
}

export function Helmet() {
  const { t } = useTranslation();
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
  // development only: the runtime on window, so the pose can be set in tests without a rendered scene
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __eva?: EvaRuntime }).__eva = rt; }, [rt]);
  const audio = useMemo(() => new SuitAudio(), []);
  const suit = useMemo(() => new SuitModel(crewId ?? "none"), [crewId]);
  useEffect(() => () => audio.dispose(), [audio]);
  useEffect(() => { if (import.meta.env.DEV) Object.assign(window, { __evaAudio: audio, __evaRt: rt }); }, [audio, rt]); // sound levels and the astronaut's pose from the console
  const [muted, setMuted] = useState(false);
  const [begun, setBegun] = useState(false);

  // ?simroute=<m>: a route to look at the guidance with, when the ship has sent none (eva/xrPreview.ts)
  const [previewRoute, setPreviewRoute] = useState<Route | null>(null);
  useEffect(() => {
    if (!SIM_ROUTE || !hm.data || !home) return;
    let off = false;
    const target = simulatedTarget(hm.data, home);
    generateRoute(hm.data, home, target).then((r) => {
      if (!off) setPreviewRoute({ ...r, start: { lat: home[0], lon: home[1], name: "preview" }, target: { lat: target[0], lon: target[1] }, generated_at: new Date().toISOString(), mode: "out" });
    }).catch(() => {});
    return () => { off = true; };
  }, [hm.data, home]);
  const live = useEva({ crew, zone, hm: hm.data, home, plan, evs, now, rt, audio, suit, previewRoute });
  // ?simhud=…: sample alerts on this display only (eva/xrPreview.ts)
  const v = SIMULATED_HUD && live && hm.data && home ? withSimulatedAlerts(live, hm.data, home) : live;
  const viewRef = useRef<EvaView | null>(null);
  viewRef.current = v;

  // the HiRISE close-up follows you in ~150 m steps
  const anchor = useMemo<[number, number] | null>(() => {
    if (!v) return home;
    const q = 0.0015;
    return [Math.round(v.at[0] / q) * q, Math.round(v.at[1] / q) * q];
  }, [v ? Math.round(v.at[0] / 0.0015) : 0, v ? Math.round(v.at[1] / 0.0015) : 0, home]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?simstorm / ?simdevil: dust drawn in this view only, to look at the effect (eva/xrPreview.ts)
  const sim = useMemo(() => (SIMULATED_DUST && hm.data && home ? simulatedDust(hm.data, home) : []), [hm.data, home]);
  const sceneHazards = useMemo(() => (sim.length ? [...(v?.hazards ?? []), ...sim] : v?.hazards ?? []), [sim, v?.hazards]);
  const sceneStorm = sim.length && hm.data ? Math.max(v?.storm ?? 0, simulatedStormAt(hm.data, sim, rt.pose)) : v?.storm ?? 0;

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
      // a steady 72 Hz is easier on a standalone headset than a 90 Hz it cannot hold
      const rates = (s as XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?: (r: number) => Promise<void> });
      if (QUEST && rates.supportedFrameRates && Array.from(rates.supportedFrameRates).includes(72)) void rates.updateTargetFrameRate?.(72).catch(() => {});
      await gl.xr.setSession(s);
      setErr(null);
    } catch (e) { setErr(e instanceof DOMException && e.name === "NotAllowedError" ? t("helmet.vr_declined") : e instanceof Error ? e.message : String(e)); }
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
            storm={sceneStorm} windDeg={250 + Math.sin(now / 60000) * 30} lmst={v?.cond?.time.lmst ?? 12} anchor={anchor} hazards={sceneHazards} onGl={onGl} />
        </Suspense>
      )}

      {v && hm.data && homeL && !rt.presenting && !XR_PREVIEW && (
        <EvaHud v={v} rt={rt} hm={hm.data} home={homeL} crewName={crew?.name ?? ""} vrOk={vrOk} muted={muted}
          onMute={() => { const m = !muted; setMuted(m); audio.setMuted(m); audio.start(); }} onEnterVr={enterVr} />
      )}

      {!begun && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="absolute top-4 right-4"><LanguageSwitcher /></div>
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary"><HardHat className="size-7" /></div>
            <div className="text-xs font-semibold tracking-[0.25em] text-muted-foreground uppercase">{t("helmet.brand")} · {crew?.name ?? "…"}</div>
            <h1 className="mt-2 font-heading text-3xl font-semibold">{plan ? plan.title : t("helmet.suit_check_complete")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {plan ? t("helmet.intro_with_plan") : t("helmet.intro_no_plan")}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button size="lg" className="h-12 rounded-xl px-6" disabled={!v} onClick={begin}><Play /> {t("helmet.begin_on_screen")}</Button>
              {vrOk && <Button size="lg" variant="outline" className="h-12 rounded-xl px-6" disabled={!v} onClick={enterVr}><Glasses /> {t("helmet.enter_vr")}</Button>}
            </div>
            {!v && <p className="mt-3 text-xs text-muted-foreground">{t("helmet.loading_surface")}</p>}
            <p className="mt-4 text-xs text-muted-foreground">{t("helmet.sound_note")}</p>
            {err && <div className="mt-3"><ErrorNote error={t("helmet.cant_start_vr", { err })} /></div>}
            <div className="mt-3"><ErrorNote error={plans.error ?? crewQ.error} /></div>
          </div>
        </div>
      )}
      {begun && err && <div className="absolute bottom-24 left-1/2 z-20 w-[min(420px,90%)] -translate-x-1/2"><ErrorNote error={t("helmet.cant_start_vr", { err })} /></div>}
    </div>
  );
}
