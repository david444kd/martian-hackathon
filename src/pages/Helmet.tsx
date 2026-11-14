// EVA HELMET: shows the crew's active work plan (the one the ship started) by itself; no input
// needed beyond entering VR once. The walk along the route is simulated (the helmet has no real
// positioning) and reported back as telemetry, so the ship and mission control see the astronaut move.
// Alerts (anomalies, forecasts, messages) appear at eye level and are read out loud: hands-free.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import type * as THREE from "three";
import { Glasses, HardHat, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { activePlan, useCrews, useEvents, usePlans, useReportProgress } from "../lib/queries";
import type { WorkPlan } from "../lib/types";
import { areaHazards, crewAlerts, type Alert } from "../lib/hazards";
import { conditions, fmtLmst, useNow } from "../lib/mars";
import { astronautAt } from "../astro/checkpoints";
import { AlertList } from "../components/alerts";
import { crewHome, useHeightmap, useZone } from "../lib/zones";
import { fmtDur, fmtKm } from "../lib/geo";
import { Brand, CrewPicker, ErrorNote } from "../components/common";
import { load, save } from "../lib/storage";

const Scene = lazy(() => import("../astro/Scene").then((m) => ({ default: m.Scene })));

const LAST_CREW = "mars-ops.helmet.crew";
/** how much faster than real walking the simulated EVA goes (?speed=1 for real time) */
const SPEED = Number(new URLSearchParams(location.search).get("speed")) || 30;
const REPORT_MS = 3000;

export function HelmetPicker() {
  const last = load<string | null>(LAST_CREW, null);
  const crews = useCrews();
  if (last && crews.data?.some((c) => c.id === last)) return <Navigate to={`/helmet/${last}`} replace />;
  return <CrewPicker base="/helmet" product="EVA Helmet" icon={<HardHat />} question="Whose helmet is this?" />;
}

export function Helmet() {
  const { crewId } = useParams();
  useEffect(() => { if (crewId) save(LAST_CREW, crewId); }, [crewId]);
  const crews = useCrews(), plans = usePlans(crewId);
  const crew = crews.data?.find((c) => c.id === crewId);
  const zone = useZone(crew?.zone), hm = useHeightmap(zone);
  const home = crew ? crewHome(crew, zone) : null;
  const active = activePlan(plans.data), plan = active?.route ? active : null; // an EVA with a route to follow
  const progress = useSimulatedWalk(plan);

  const events = useEvents(), now = useNow(5000);
  const evs = useMemo(() => events.data ?? [], [events.data]);
  const at = plan ? astronautAt({ ...plan, progress_m: progress }) : home;
  const alerts = crew ? crewAlerts(crew, zone, plan, evs, now, at) : [];
  const cond = zone ? conditions(zone, now, evs) : null;
  const hazards = useMemo(() => (zone ? areaHazards(evs, zone.id, now) : []), [evs, zone, now]);
  const speak = useAlertVoice(alerts);

  const [session, setSession] = useState<XRSession | null>(null);
  const [vrOk, setVrOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(() => { (navigator.xr?.isSessionSupported("immersive-vr") ?? Promise.resolve(false)).then(setVrOk, () => setVrOk(false)); }, []);

  async function enterVr() {
    const gl = glRef.current;
    if (!gl || !navigator.xr) return;
    speak.unlock();
    try {
      const s = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor"] });
      await gl.xr.setSession(s);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  const onGl = useCallback((gl: THREE.WebGLRenderer) => { glRef.current = gl; }, []);

  if (crews.isSuccess && !crew) return <HelmetPicker />;
  const route = plan?.route;
  const left = route ? Math.max(0, route.distance_m - progress) : 0;

  return (
    <div className="relative h-full bg-black">
      {hm.data && home && (
        <Suspense fallback={null}>
          <Scene hm={hm.data} home={home} plan={plan} progress={progress} cond={cond} alerts={alerts} hazards={hazards} onGl={onGl} onXr={setSession} />
        </Suspense>
      )}

      {/* status strip (screens only; in the headset the same is on the in-world panel) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent p-4">
        <Brand product="EVA Helmet" icon={<HardHat />} />
        <div className="flex w-80 max-w-[60%] flex-col gap-2">
        <div className="rounded-xl border bg-card/80 p-3 text-sm backdrop-blur-md">
          {plan && route ? (
            <>
              <div className="flex items-center gap-1.5 text-xs font-medium text-live"><span className="size-1.5 animate-pulse rounded-full bg-live" /> EVA active · {crew?.name}</div>
              <div className="mt-0.5 truncate font-semibold">{plan.title}</div>
              <Progress value={(progress / (route.distance_m || 1)) * 100} className="mt-2 h-1.5 [&>div]:bg-live" />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{left < 1 ? "At the target" : `${fmtKm(left)} to go · ~${fmtDur(route.duration_min * (left / (route.distance_m || 1)))}`}</span>
                <span>sim ×{SPEED}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Radio className="size-3.5" /> Standby · {crew?.name ?? "…"}</div>
              <div className="mt-0.5 text-sm">Waiting for the ship to start an EVA.</div>
            </>
          )}
          {cond && (
            <div className="mt-2 border-t pt-2 text-xs text-muted-foreground tabular-nums">
              {cond.tempC} °C · wind {cond.windMs} m/s · dust τ {cond.tau.toFixed(1)} · {cond.doseUSvH} µSv/h · LMST {fmtLmst(cond.time.lmst)}
            </div>
          )}
        </div>
        <AlertList alerts={alerts} max={3} className="backdrop-blur-md" />
        </div>
      </div>

      {!session && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/80 to-transparent p-8 pt-16">
          {vrOk && (
            <Button size="lg" className="h-16 rounded-2xl px-10 text-lg shadow-2xl" onClick={enterVr}>
              <Glasses className="size-6" /> Enter VR
            </Button>
          )}
          {vrOk === false && <p className="max-w-md text-center text-sm text-white/60">Preview on a screen: drag to look around. In the Meta Quest browser this page shows “Enter VR”; after that everything runs by itself.</p>}
          {err && <div className="w-full max-w-md"><ErrorNote error={`Couldn't start VR: ${err}`} /></div>}
          <ErrorNote error={plans.error} />
        </div>
      )}
    </div>
  );
}

/**
 * New warnings and critical alerts are announced: a tone, then the alert read out (speech synthesis),
 * since in the headset nothing can be clicked. Browsers only allow sound after a user gesture, so
 * `unlock` is called from the Enter VR button.
 */
function useAlertVoice(alerts: Alert[]) {
  const heard = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    const loud = alerts.filter((a) => a.level !== "info");
    const key = (a: Alert) => `${a.id}:${a.level}:${a.title}`;
    if (!heard.current) { heard.current = new Set(loud.map(key)); return; } // don't announce what was already there on load
    const fresh = loud.filter((a) => !heard.current!.has(key(a)));
    fresh.forEach((a) => heard.current!.add(key(a)));
    if (!fresh.length) return;
    const ctx = audio.current;
    if (ctx && ctx.state === "running") {
      const critical = fresh.some((a) => a.level === "critical");
      [0, 0.22, ...(critical ? [0.44] : [])].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = critical ? 880 : 660;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    }
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(fresh.map((a) => `${a.level === "critical" ? "Warning. " : ""}${a.title}. ${a.text}`).join(" "));
      u.lang = "en-US"; u.rate = 1.05;
      window.speechSynthesis.speak(u);
    }
  }, [alerts]);
  return {
    unlock() {
      try { audio.current ??= new AudioContext(); void audio.current.resume(); } catch { /* no audio: the panel still shows */ }
    },
  };
}

/**
 * Metres walked along the plan's route: picks up from the last reported progress and advances at the
 * route's walking pace × SPEED, reporting back every few seconds. Restarts only when the plan or its
 * route changes (not on every poll, which brings back our own reports).
 */
function useSimulatedWalk(plan: WorkPlan | null) {
  const [m, setM] = useState(0);
  const { mutate: report } = useReportProgress();
  const id = plan?.id, stamp = plan?.route?.generated_at;

  useEffect(() => {
    const route = plan?.route;
    if (!plan || !route) return;
    const p0 = Math.min(plan.progress_m ?? 0, route.distance_m), t0 = performance.now();
    const pace = route.duration_min > 0 ? route.distance_m / (route.duration_min * 60) : 0; // m/s
    const pos = () => Math.min(route.distance_m, p0 + ((performance.now() - t0) / 1000) * pace * SPEED);
    const tick = setInterval(() => setM(pos()), 200);
    let sent = -1;
    const send = setInterval(() => {
      const p = Math.round(pos());
      if (p !== sent) { sent = p; report({ id: plan.id, progress_m: p }); }
    }, REPORT_MS);
    return () => { clearInterval(tick); clearInterval(send); };
  }, [id, stamp]); // eslint-disable-line react-hooks/exhaustive-deps -- see above

  return plan ? m : 0;
}
