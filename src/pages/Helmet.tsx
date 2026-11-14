// EVA HELMET: shows the crew's active work plan (the one the ship started) by itself; no input
// needed beyond entering VR once. The walk along the route is simulated (the helmet has no real
// positioning) and reported back as telemetry, so the ship and mission control see the astronaut move.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import type * as THREE from "three";
import { Glasses, HardHat, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { activePlan, useCrews, usePlans, useReportProgress } from "../lib/queries";
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
  const plan = activePlan(plans.data)?.route ? activePlan(plans.data)! : null;
  const progress = useSimulatedWalk(plan?.id ?? null, plan?.route?.generated_at ?? null, plan?.progress_m ?? 0,
    plan?.route?.distance_m ?? 0, plan?.route?.duration_min ?? 0);

  const [session, setSession] = useState<XRSession | null>(null);
  const [vrOk, setVrOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(() => { (navigator.xr?.isSessionSupported("immersive-vr") ?? Promise.resolve(false)).then(setVrOk, () => setVrOk(false)); }, []);

  async function enterVr() {
    const gl = glRef.current;
    if (!gl || !navigator.xr) return;
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
          <Scene hm={hm.data} home={home} plan={plan} progress={progress} onGl={onGl} onXr={setSession} />
        </Suspense>
      )}

      {/* status strip (screens only; in the headset the same is on the in-world panel) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent p-4">
        <Brand product="EVA Helmet" icon={<HardHat />} />
        <div className="w-80 max-w-[60%] rounded-xl border bg-card/80 p-3 text-sm backdrop-blur-md">
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
 * Metres walked along the active route: picks up from the last reported progress and advances at the
 * route's walking pace × SPEED; reports back every few seconds. Restarts when the plan or its route changes.
 */
function useSimulatedWalk(planId: string | null, stamp: string | null, reported: number, distance: number, durationMin: number) {
  const [m, setM] = useState(0);
  const report = useReportProgress();
  const sim = useRef<{ key: string; p0: number; t0: number } | null>(null);
  const key = `${planId}|${stamp}`;
  const pace = durationMin > 0 ? distance / (durationMin * 60) : 0; // m/s
  const startAt = useMemo(() => reported, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!planId) { sim.current = null; return; }
    sim.current = { key, p0: Math.min(startAt, distance), t0: performance.now() };
    const pos = () => (sim.current ? Math.min(distance, sim.current.p0 + ((performance.now() - sim.current.t0) / 1000) * pace * SPEED) : 0);
    const tick = setInterval(() => setM(pos()), 200);
    let lastSent = -1;
    const send = setInterval(() => {
      const p = Math.round(pos());
      if (p !== lastSent) { lastSent = p; report.mutate({ id: planId, progress_m: p }); }
    }, REPORT_MS);
    return () => { clearInterval(tick); clearInterval(send); };
  }, [key, planId, distance, pace, startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return planId ? m : 0;
}
