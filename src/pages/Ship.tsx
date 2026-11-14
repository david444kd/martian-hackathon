// SHIP CONSOLE: the crew's zone on a full-screen map, its work plans in a fixed sidebar. The crew
// makes a safe walking route for a plan (around slopes and anomalies), checks the safety window,
// sends it to the helmet and starts / ends the EVA; alerts and surface conditions sit on top.
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Marker, Polyline, Tooltip, ZoomControl } from "react-leaflet";
import { ZoneLeafletMap } from "../components/ZoneLeafletMap";
import { DOT, pin } from "../components/mapPins";
import { AstronautLayer } from "../components/AstronautLayer";
import { useAstronaut, type AstronautView } from "../lib/astronaut";
import { returnRoute } from "../lib/recall";
import { CheckCircle2, Crosshair, Flag, House, Loader2, Megaphone, Play, Route as RouteIcon, Send, Ship as ShipIcon, Square, Waypoints, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { activePlan, useCrew, useEvents, usePlans, useStartEva, useUpdateEvent, useUpdatePlan } from "../lib/queries";
import { isReturn, type Crew, type MarsEvent, type Route, type WorkPlan } from "../lib/types";
import { crewHome, inZone, useHeightmap, useZone, type Heightmap, type Zone } from "../lib/zones";
import { generateRoute } from "../lib/routing";
import type { PathResult } from "../lib/pathfind";
import { fmtDate, fmtKm, fmtLL } from "../lib/geo";
import { alongs } from "../astro/checkpoints";
import { Brand, CrewPicker, ErrorNote, EvaCard, RouteStats, StatusBadge } from "../components/common";
import { AlertList, ConditionsGrid, EvaCheckView, HazardAreas, OutlookBar } from "../components/alerts";
import { EventDialog } from "../components/EventDialog";
import { areaHazards, avoidList, crewAlerts, evaCheck, outlook, routeHit, type Avoid } from "../lib/hazards";
import { conditions, eventLabel, useNow } from "../lib/mars";

/** anomalies that matter for a route made now: active or starting within this many hours */
const AVOID_AHEAD_H = 6;

export function ShipPicker() {
  return <CrewPicker base="/ship" product="Ship Console" icon={<ShipIcon />} question="Which crew is this ship?" />;
}

type Start = { lat: number; lon: number; name: string };

export function Ship() {
  const { crewId } = useParams();
  const crewQ = useCrew(crewId), plans = usePlans(crewId);
  const crew = crewQ.data ?? undefined;
  const zone = useZone(crew?.zone), hm = useHeightmap(zone);
  const [selId, setSelId] = useState<string | null>(null);
  const [starts, setStarts] = useState<Record<string, Start>>({});
  const [drafts, setDrafts] = useState<Record<string, PathResult>>({});
  const active = activePlan(plans.data);
  const sel = plans.data?.find((p) => p.id === selId) ?? null;
  const home = crew ? crewHome(crew, zone) : null;
  const startOf = (p: WorkPlan): Start | null =>
    starts[p.id] ?? p.route?.start ?? (home ? { lat: home[0], lon: home[1], name: "Landing site" } : null);

  const events = useEvents(), now = useNow();
  const evs = useMemo(() => events.data ?? [], [events.data]);
  const ack = useUpdateEvent();
  const [raising, setRaising] = useState(false);
  const astro = useAstronaut(crewId, active);
  const alerts = crew ? crewAlerts(crew, zone, active, evs, now, astro.at) : [];
  const cond = zone ? conditions(zone, now, evs) : null;
  const avoid = zone ? avoidList(areaHazards(evs, zone.id, now, now + AVOID_AHEAD_H * 3600_000)) : [];
  const env: Env = { evs, now, avoid };

  if (crewQ.isSuccess && !crew) return <ShipPicker />;

  return (
    <div className="flex h-full">
      <aside className="flex w-[380px] shrink-0 flex-col border-r bg-sidebar max-md:w-full max-md:max-w-[340px]">
        <div className="p-4 pb-3">
          <Brand product="Ship Console" icon={<ShipIcon />} />
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <h1 className="truncate font-heading text-xl font-semibold">{crew?.ship || crew?.name || "…"}</h1>
            <span className="shrink-0 text-xs text-muted-foreground">{crew?.name} · {zone?.name}</span>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-3 pb-3">
            <AlertList alerts={alerts} onAck={(a) => ack.mutate({ id: a.id, patch: { acked_at: new Date().toISOString() } }, { onSuccess: () => toast("Confirmed to mission control") })} />
            {cond && zone && <ConditionsGrid c={cond} zone={zone} />}
            <Button size="sm" variant="outline" disabled={!crew} onClick={() => setRaising(true)}><Megaphone /> Alert the helmet / mark a hazard</Button>
            <ErrorNote error={events.error} />
          </div>
          {active?.route && <ActiveEva plan={active} hm={hm.data} env={env} astro={astro} home={home} />}
          <Separator />
          <div className="px-4 pt-3 pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">Work plans from mission control</div>
          <ErrorNote error={plans.error} />
          <div className="flex flex-col gap-2 px-3 pb-4">
            {plans.data?.length === 0 && (
              <Empty className="border border-dashed p-6">
                <EmptyHeader>
                  <EmptyTitle>No work plans yet</EmptyTitle>
                  <EmptyDescription>Mission control assigns them; they appear here automatically.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {plans.data?.map((p, i) => (
              <PlanCard key={p.id} n={i + 1} plan={p} selected={p.id === selId} hm={hm.data} zone={zone} env={env} start={startOf(p)}
                draft={drafts[p.id] ?? null}
                onSelect={() => setSelId(p.id === selId ? null : p.id)}
                onDraft={(d) => setDrafts((all) => { const next = { ...all }; if (d) next[p.id] = d; else delete next[p.id]; return next; })} />
            ))}
          </div>
        </ScrollArea>
        <Separator />
        <a href={`/helmet/${crewId}`} target="_blank" rel="noreferrer" className="p-3 text-center text-xs text-muted-foreground hover:text-foreground">Open the helmet view ↗</a>
      </aside>

      <main className="relative isolate min-w-0 flex-1 max-md:hidden">
        {zone && hm.data && crew ? (
          <ShipMap zone={zone} hm={hm.data} crew={crew} home={home} plans={plans.data ?? []} sel={sel} active={active} env={env} astro={astro}
            start={sel ? startOf(sel) : null} draft={sel ? drafts[sel.id] ?? null : null}
            onPick={(lat, lon) => {
              if (!sel || !inZone(zone, lat, lon)) return;
              setStarts((s) => ({ ...s, [sel.id]: { lat, lon, name: "Chosen point" } }));
              setDrafts((d) => { const next = { ...d }; delete next[sel.id]; return next; });
            }}
            onSelect={setSelId} />
        ) : <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading map…</div>}
      </main>
      {crew && raising && <EventDialog open onOpenChange={setRaising} crews={[crew]} crew={crew} source="ship" />}
    </div>
  );
}

/** the events as of now, and the areas a route made now has to avoid */
type Env = { evs: MarsEvent[]; now: number; avoid: Avoid[] };

/** anomalies lying across the rest of an active EVA's route */
function onRoute(plan: WorkPlan, zoneId: string, env: Env) {
  if (!plan.route) return [];
  const along = alongs(plan.route);
  return areaHazards(env.evs, zoneId, env.now).filter((e) => e.level !== "info" && routeHit(plan.route!, along, e, plan.progress_m ?? 0) != null);
}

function ActiveEva({ plan, hm, env, astro, home }: { plan: WorkPlan; hm: Heightmap | undefined; env: Env; astro: AstronautView; home: [number, number] | null }) {
  const update = useUpdatePlan();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const set = (status: "done" | "assigned", msg: string) => update.mutate({ id: plan.id, patch: { status } }, { onSuccess: () => toast.success(msg) });
  const blocking = onRoute(plan, plan.zone, env);

  const back = isReturn(plan.route);
  /** a new route from where the astronaut is now, around the anomalies (back to base when returning); the helmet switches to it */
  async function reroute() {
    const here = astro.at;
    if (!hm || !here || (back && !home)) return;
    setBusy(true); setErr(null);
    try {
      const route: Route = back
        ? await returnRoute(hm, here, home!, env.avoid, plan.route?.reason ?? "Recall")
        : { ...(await generateRoute(hm, here, [plan.target_lat, plan.target_lon], env.avoid)), start: { lat: here[0], lon: here[1], name: "Rerouted here" }, target: { lat: plan.target_lat, lon: plan.target_lon }, generated_at: new Date().toISOString() };
      await update.mutateAsync({ id: plan.id, patch: { route, progress_m: 0 } });
      toast.success("New route sent to the helmet");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  /** abort the EVA: a route back to base from where the astronaut is; the helmet raises the alarm */
  async function recall() {
    const here = astro.at;
    if (!hm || !here || !home) return;
    setBusy(true); setErr(null);
    try {
      const route = await returnRoute(hm, here, home, env.avoid, "Recalled by the ship");
      await update.mutateAsync({ id: plan.id, patch: { route, progress_m: 0 } });
      toast.success("Recall sent: the astronaut is returning to base");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <EvaCard plan={plan} astro={astro} className="mx-3 mb-3">
      {blocking.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-500/50 bg-red-500/15 p-2 text-xs text-red-200">
          <b>{blocking.map(eventLabel).join(", ")}</b> across the route ahead.
          <Button size="sm" variant="destructive" className="mt-2 w-full" disabled={busy || !hm} onClick={reroute}>
            {busy ? <Loader2 className="animate-spin" /> : <Waypoints />} Reroute around it
          </Button>
        </div>
      )}
      <ErrorNote error={err} />
      {!back && (
        <Button size="sm" variant="destructive" className="mt-3 w-full" disabled={busy || !hm || !astro.at || !home} onClick={recall}>
          {busy ? <Loader2 className="animate-spin" /> : <House />} Recall to base
        </Button>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" disabled={update.isPending} onClick={() => set("done", "EVA complete")}><CheckCircle2 /> Complete</Button>
        <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => set("assigned", "EVA stopped")}><Square /> Stop</Button>
      </div>
    </EvaCard>
  );
}

function PlanCard({ n, plan, selected, hm, zone, env, start, draft, onSelect, onDraft }: {
  n: number; plan: WorkPlan; selected: boolean; hm: Heightmap | undefined; zone: Zone | undefined; env: Env; start: Start | null;
  draft: PathResult | null; onSelect: () => void; onDraft: (d: PathResult | null) => void;
}) {
  const update = useUpdatePlan(), startEva = useStartEva();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const saved = plan.route;
  // a return route on a plan that is no longer active: the EVA was recalled, the plan needs a new route
  const recalled = !!saved && isReturn(saved) && plan.status !== "in_progress";
  const stale = recalled || (!!saved && !isReturn(saved) && (saved.target.lat !== plan.target_lat || saved.target.lon !== plan.target_lon));
  const pending = selected && !!saved && !stale && plan.status !== "in_progress" && plan.status !== "done";
  const { evs, now } = env;
  const check = useMemo(() => (pending && zone && saved ? evaCheck(zone, saved, evs, now) : null), [pending, zone, saved, evs, now]);
  const look = useMemo(() => (pending && zone && saved ? outlook(zone, saved, evs, now) : null), [pending, zone, saved, evs, now]);
  const crossed = selected && zone && saved && !stale ? onRoute({ ...plan, progress_m: 0, status: "in_progress" }, zone.id, env) : [];

  async function make() {
    if (!hm || !start) return;
    setBusy(true); setErr(null);
    try { onDraft(await generateRoute(hm, [start.lat, start.lon], [plan.target_lat, plan.target_lon], env.avoid)); }
    catch (e) { setErr(e); }
    finally { setBusy(false); }
  }
  function send() {
    if (!draft || !start) return;
    const route: Route = { ...draft, start, target: { lat: plan.target_lat, lon: plan.target_lon }, generated_at: new Date().toISOString() };
    update.mutate({ id: plan.id, patch: { route, progress_m: plan.status === "in_progress" ? 0 : plan.progress_m } },
      { onSuccess: () => { onDraft(null); toast.success("Route sent to the helmet"); } });
  }

  return (
    <div className={cn("rounded-xl border bg-card/60 transition-colors", selected && "border-primary/50 bg-card")}>
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-3 p-3 text-left">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", selected ? "bg-primary text-primary-foreground" : "bg-muted")}>{n}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{plan.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <StatusBadge status={plan.status} />
            {saved ? <span>{fmtKm(saved.distance_m)}</span> : <span>no route</span>}
            {plan.scheduled_at && <span>· {fmtDate(plan.scheduled_at)}</span>}
          </span>
        </span>
      </button>

      {selected && (
        <div className="flex flex-col gap-3 border-t px-3 pt-3 pb-3 text-sm">
          {plan.description && <p className="whitespace-pre-line text-muted-foreground">{plan.description}</p>}
          <div className="grid gap-1 text-xs">
            <div className="flex items-center gap-1.5"><Crosshair className="size-3.5 text-landing" /> Start: <b>{start?.name}</b> <span className="text-muted-foreground">{start && fmtLL(start.lat, start.lon)}</span></div>
            <div className="flex items-center gap-1.5"><Flag className="size-3.5 text-target" /> Target: <span className="text-muted-foreground">{fmtLL(plan.target_lat, plan.target_lon)}</span></div>
            <div className="text-muted-foreground">Click the map to start the walk somewhere else.</div>
            {env.avoid.length > 0 && <div className="text-amber-300">The route goes around {env.avoid.length} anomal{env.avoid.length === 1 ? "y" : "ies"} (now or within {AVOID_AHEAD_H} h).</div>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={draft ? "outline" : "default"} disabled={busy || !hm || !start} onClick={make}>
              {busy ? <Loader2 className="animate-spin" /> : <RouteIcon />}{saved || draft ? "Make a new route" : "Make route"}
            </Button>
            {draft && <Button size="sm" disabled={update.isPending} onClick={send}><Send /> Send to helmet</Button>}
            {draft && <Button size="icon-sm" variant="ghost" onClick={() => onDraft(null)} aria-label="Discard"><X /></Button>}
          </div>
          <ErrorNote error={err ?? update.error ?? startEva.error} />

          {draft && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-live">New route · not sent yet</div>
              <RouteStats route={draft} />
            </div>
          )}
          {saved && !draft && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-muted-foreground">In the helmet since {fmtDate(saved.generated_at)}</div>
              {stale && <div className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary">{recalled ? `The EVA was recalled (${saved.reason ?? "hazard"}): make a new route.` : "Mission control moved the target: make a new route."}</div>}
              {crossed.length > 0 && <div className="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs text-red-200">{crossed.map(eventLabel).join(", ")} now across this route: make a new route.</div>}
              <RouteStats route={saved} />
            </div>
          )}

          {check && <EvaCheckView check={check} />}
          {look && zone && <OutlookBar zone={zone} slots={look.slots} next={look.next} title="EVA window · next 24 h" />}
          {plan.status !== "in_progress" && plan.status !== "done" && (
            <Button variant={check?.level === "critical" ? "destructive" : "default"} disabled={!saved || stale || !!draft || startEva.isPending}
              onClick={() => startEva.mutate(plan, { onSuccess: () => toast.success("EVA started: the helmet shows this route") })}>
              <Play /> {check?.level === "critical" ? "Start EVA anyway" : "Start EVA"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
function ShipMap({ zone, hm, crew, home, plans, sel, active, env, astro, start, draft, onPick, onSelect }: {
  zone: Zone; hm: Heightmap; crew: Crew; home: [number, number] | null; plans: WorkPlan[]; sel: WorkPlan | null; active: WorkPlan | undefined; env: Env; astro: AstronautView;
  start: Start | null; draft: PathResult | null; onPick: (lat: number, lon: number) => void; onSelect: (id: string) => void;
}) {
  return (
    <>
      <ZoneLeafletMap key={crew.id} zone={zone} hm={hm} onPick={onPick} className="size-full">
        <HazardAreas events={env.evs} zoneId={zone.id} now={env.now} />
        {home && (
          <Marker position={home} icon={pin(`${DOT} bg-landing`, "", 16)}>
            <Tooltip direction="top" offset={[0, -8]}>Landing site · {crew.ship || crew.name}</Tooltip>
          </Marker>
        )}

        {plans.map((p, i) => (
          <Marker key={p.id} position={[p.target_lat, p.target_lon]} zIndexOffset={p.id === sel?.id ? 500 : 0}
            icon={pin(cn(DOT, p.id === sel?.id ? "bg-target ring-4 ring-target/40" : p.status === "done" ? "bg-muted-foreground" : "bg-route"), String(i + 1), p.id === sel?.id ? 22 : 18)}
            eventHandlers={{ click: () => onSelect(p.id) }}>
            <Tooltip direction="top" offset={[0, -10]}>{p.title}</Tooltip>
          </Marker>
        ))}

        {active?.route && active.id !== sel?.id && (
          <Polyline positions={active.route.points.map(([a, b]) => [a, b] as [number, number])} pathOptions={isReturn(active.route) ? { color: "#5fd8ff", weight: 5, opacity: 0.95, dashArray: "10 6" } : { color: "#4fd1ff", weight: 3, opacity: 0.6 }} />
        )}
        {sel?.route && (
          <Polyline positions={sel.route.points.map(([a, b]) => [a, b] as [number, number])}
            pathOptions={isReturn(sel.route) ? { color: "#5fd8ff", weight: 5, opacity: draft ? 0.35 : 0.95, dashArray: "10 6" } : { color: "#ffb347", weight: 4, opacity: draft ? 0.35 : 1, dashArray: sel.route.target.lat !== sel.target_lat ? "6 8" : undefined }} />
        )}
        {draft && <Polyline positions={draft.points.map(([a, b]) => [a, b] as [number, number])} pathOptions={{ color: "#4fd1ff", weight: 4, dashArray: "8 6" }} />}
        {sel && start && (
          <Marker position={[start.lat, start.lon]} icon={pin(`${DOT} bg-white`, "", 14)}>
            <Tooltip direction="top" offset={[0, -8]}>Start · {start.name}</Tooltip>
          </Marker>
        )}
        <AstronautLayer a={astro} label={crew.name} />
        <ZoomControl position="bottomright" />
      </ZoneLeafletMap>

      <div className="pointer-events-none absolute top-3 left-1/2 z-[500] -translate-x-1/2 rounded-full border bg-card/85 px-4 py-1.5 text-xs backdrop-blur">
        {sel ? <>Planning <b>{sel.title}</b> · click the map to set the start</> : "Pick a work plan on the left or a numbered target on the map"}
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-[500] flex flex-col gap-1 rounded-xl border bg-card/85 p-3 text-xs backdrop-blur">
        <Legend cls="bg-landing" label="Landing site" />
        <Legend cls="bg-route" label="Work plan target" />
        <Legend cls="bg-live" label="Astronaut (live)" />
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 bg-route" />Route in the helmet</div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-sky-400" />Return to base</div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dotted border-live" />Walked (live)</div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-live" />New route, not sent</div>
        <div className="flex items-center gap-2"><span className="size-2.5 rounded-full border-2 border-amber-400 bg-amber-400/30" />Anomaly (dashed: forecast)</div>
      </div>
    </>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <div className="flex items-center gap-2"><span className={cn("size-2.5 rounded-full", cls)} />{label}</div>;
}
