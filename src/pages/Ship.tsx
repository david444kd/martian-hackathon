// SHIP CONSOLE: the crew's zone on a full-screen map, its work plans in a fixed sidebar. The crew
// makes a safe walking route for a plan (around slopes and anomalies), checks the safety window,
// sends it to the helmet and starts / ends the EVA; alerts and surface conditions sit on top.
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { CircleMarker, Marker, Polyline, Tooltip, ZoomControl } from "react-leaflet";
import { useTranslation } from "react-i18next";
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
import { RouteBudget, RouteProfile, SlopeLegend, slopeRuns } from "../components/RouteProfile";
import { areaHazards, avoidList, crewAlerts, evaCheck, outlook, routeHit, type Avoid } from "../lib/hazards";
import { conditions, eventLabel, useNow } from "../lib/mars";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { DemoStormButton } from "../components/DemoStormButton";

/** anomalies that matter for a route made now: active or starting within this many hours */
const AVOID_AHEAD_H = 6;

export function ShipPicker() {
  const { t } = useTranslation();
  return <CrewPicker base="/ship" product={t("ship.brand")} icon={<ShipIcon />} question={t("picker.shipQuestion")} />;
}

type Start = { lat: number; lon: number; name: string };

export function Ship() {
  const { t } = useTranslation();
  const { crewId } = useParams();
  const crewQ = useCrew(crewId), plans = usePlans(crewId);
  const crew = crewQ.data ?? undefined;
  const zone = useZone(crew?.zone), hm = useHeightmap(zone);
  const [selId, setSelId] = useState<string | null>(null);
  const [starts, setStarts] = useState<Record<string, Start>>({});
  const [drafts, setDrafts] = useState<Record<string, PathResult>>({});
  const [probe, setProbe] = useState<[number, number] | null>(null); // the point of the route under the pointer on the elevation profile
  const active = activePlan(plans.data);
  const sel = plans.data?.find((p) => p.id === selId) ?? null;
  const home = crew ? crewHome(crew, zone) : null;
  const startOf = (p: WorkPlan): Start | null =>
    starts[p.id] ?? p.route?.start ?? (home ? { lat: home[0], lon: home[1], name: t("ship.landing_site_point") } : null);

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
          <div className="flex items-center justify-between">
            <Brand product={t("ship.brand")} icon={<ShipIcon />} />
            <LanguageSwitcher />
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <h1 className="truncate font-heading text-xl font-semibold">{crew?.ship || crew?.name || "…"}</h1>
            <span className="shrink-0 text-xs text-muted-foreground">{crew?.name} · {zone?.name}</span>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-3 pb-3">
            <AlertList alerts={alerts} onAck={(a) => ack.mutate({ id: a.id, patch: { acked_at: new Date().toISOString() } }, { onSuccess: () => toast(t("alerts.confirmed_toast")) })} />
            {cond && zone && <ConditionsGrid c={cond} zone={zone} />}
            <Button size="sm" variant="outline" disabled={!crew} onClick={() => setRaising(true)}><Megaphone /> {t("ship.alert_hazard_btn")}</Button>
            <ErrorNote error={events.error} />
          </div>
          {active?.route && <ActiveEva plan={active} hm={hm.data} env={env} astro={astro} home={home} />}
          <Separator />
          <div className="px-4 pt-3 pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">{t("ship.plans_heading")}</div>
          <ErrorNote error={plans.error} />
          <div className="flex flex-col gap-2 px-3 pb-4">
            {plans.data?.length === 0 && (
              <Empty className="border border-dashed p-6">
                <EmptyHeader>
                  <EmptyTitle>{t("ship.no_plans_title")}</EmptyTitle>
                  <EmptyDescription>{t("ship.no_plans_desc")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {plans.data?.map((p, i) => (
              <PlanCard key={p.id} n={i + 1} plan={p} selected={p.id === selId} hm={hm.data} zone={zone} env={env} start={startOf(p)}
                draft={drafts[p.id] ?? null} onProbe={setProbe} tempC={cond?.tempC}
                onSelect={() => setSelId(p.id === selId ? null : p.id)}
                onDraft={(d) => setDrafts((all) => { const next = { ...all }; if (d) next[p.id] = d; else delete next[p.id]; return next; })} />
            ))}
          </div>
        </ScrollArea>
        <Separator />
        <a href={`/helmet/${crewId}`} target="_blank" rel="noreferrer" className="p-3 text-center text-xs text-muted-foreground hover:text-foreground">{t("ship.open_helmet")}</a>
      </aside>

      <main className="relative isolate min-w-0 flex-1 max-md:hidden">
        {zone && hm.data && crew ? (
          <ShipMap zone={zone} hm={hm.data} crew={crew} home={home} plans={plans.data ?? []} sel={sel} active={active} env={env} astro={astro}
            start={sel ? startOf(sel) : null} draft={sel ? drafts[sel.id] ?? null : null} probe={probe}
            onPick={(lat, lon) => {
              if (!sel || !inZone(zone, lat, lon)) return;
              setStarts((s) => ({ ...s, [sel.id]: { lat, lon, name: t("ship.chosen_point") } }));
              setDrafts((d) => { const next = { ...d }; delete next[sel.id]; return next; });
            }}
            onSelect={setSelId} />
        ) : <div className="grid h-full place-items-center text-sm text-muted-foreground">{t("ship.loading_map")}</div>}
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
  const { t } = useTranslation();
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
        ? await returnRoute(hm, here, home!, env.avoid, plan.route?.reason ?? t("evahud.recall"))
        : { ...(await generateRoute(hm, here, [plan.target_lat, plan.target_lon], env.avoid)), start: { lat: here[0], lon: here[1], name: t("ship.rerouted_here") }, target: { lat: plan.target_lat, lon: plan.target_lon }, generated_at: new Date().toISOString() };
      await update.mutateAsync({ id: plan.id, patch: { route, progress_m: 0 } });
      toast.success(t("eva.new_route_sent_toast"));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  /** abort the EVA: a route back to base from where the astronaut is; the helmet raises the alarm */
  async function recall() {
    const here = astro.at;
    if (!hm || !here || !home) return;
    setBusy(true); setErr(null);
    try {
      const route = await returnRoute(hm, here, home, env.avoid, t("evahud.recall_from_ship"));
      await update.mutateAsync({ id: plan.id, patch: { route, progress_m: 0 } });
      toast.success(t("ship.recall_sent_toast"));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <EvaCard plan={plan} astro={astro} className="mx-3 mb-3">
      {blocking.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-500/50 bg-red-500/15 p-2 text-xs text-red-200">
          <b>{blocking.map(eventLabel).join(", ")}</b> {t("eva.blocking_ahead")}
          <Button size="sm" variant="destructive" className="mt-2 w-full" disabled={busy || !hm} onClick={reroute}>
            {busy ? <Loader2 className="animate-spin" /> : <Waypoints />} {t("eva.reroute_btn")}
          </Button>
        </div>
      )}
      <ErrorNote error={err} />
      {!back && (
        <Button size="sm" variant="destructive" className="mt-3 w-full" disabled={busy || !hm || !astro.at || !home} onClick={recall}>
          {busy ? <Loader2 className="animate-spin" /> : <House />} {t("ship.recall_btn")}
        </Button>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" disabled={update.isPending} onClick={() => set("done", t("eva.complete_toast"))}><CheckCircle2 /> {t("eva.complete_btn")}</Button>
        <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => set("assigned", t("eva.stop_toast"))}><Square /> {t("eva.stop_btn")}</Button>
      </div>
    </EvaCard>
  );
}

function PlanCard({ n, plan, selected, hm, zone, env, start, draft, onSelect, onDraft, onProbe, tempC }: {
  n: number; plan: WorkPlan; selected: boolean; hm: Heightmap | undefined; zone: Zone | undefined; env: Env; start: Start | null;
  draft: PathResult | null; onSelect: () => void; onDraft: (d: PathResult | null) => void; onProbe: (at: [number, number] | null) => void; tempC?: number;
}) {
  const { t } = useTranslation();
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
      { onSuccess: () => { onDraft(null); toast.success(t("eva.route_sent_toast")); } });
  }

  return (
    <div className={cn("rounded-xl border bg-card/60 transition-colors", selected && "border-primary/50 bg-card")}>
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-3 p-3 text-left">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", selected ? "bg-primary text-primary-foreground" : "bg-muted")}>{n}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{plan.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <StatusBadge status={plan.status} />
            {saved ? <span>{fmtKm(saved.distance_m)}</span> : <span>{t("ship.no_route")}</span>}
            {plan.scheduled_at && <span>· {fmtDate(plan.scheduled_at)}</span>}
          </span>
        </span>
      </button>

      {selected && (
        <div className="flex flex-col gap-3 border-t px-3 pt-3 pb-3 text-sm">
          {plan.description && <p className="whitespace-pre-line text-muted-foreground">{plan.description}</p>}
          <div className="grid gap-1 text-xs">
            <div className="flex items-center gap-1.5"><Crosshair className="size-3.5 text-landing" /> {t("ship.start_point", { name: start?.name })} <span className="text-muted-foreground">{start && fmtLL(start.lat, start.lon)}</span></div>
            <div className="flex items-center gap-1.5"><Flag className="size-3.5 text-target" /> {t("ship.target_point")} <span className="text-muted-foreground">{fmtLL(plan.target_lat, plan.target_lon)}</span></div>
            <div className="text-muted-foreground">{t("ship.click_map_start")}</div>
            {env.avoid.length > 0 && <div className="text-amber-300">{t("ship.route_avoids", { count: env.avoid.length, hours: AVOID_AHEAD_H })}</div>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={draft ? "outline" : "default"} disabled={busy || !hm || !start} onClick={make}>
              {busy ? <Loader2 className="animate-spin" /> : <RouteIcon />}{saved || draft ? t("ship.make_new_route") : t("ship.make_route")}
            </Button>
            {draft && <Button size="sm" disabled={update.isPending} onClick={send}><Send /> {t("ship.send_to_helmet")}</Button>}
            {draft && <Button size="icon-sm" variant="ghost" onClick={() => onDraft(null)} aria-label={t("common.discard")}><X /></Button>}
          </div>
          <ErrorNote error={err ?? update.error ?? startEva.error} />

          {draft && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-live">{t("ship.new_route_unsent")}</div>
              <RouteStats route={draft} />
              <RouteProfile route={draft} onHover={onProbe} />
              <RouteBudget route={draft} tempC={tempC} />
            </div>
          )}
          {saved && !draft && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-muted-foreground">{t("ship.in_helmet_since", { date: fmtDate(saved.generated_at) })}</div>
              {stale && <div className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary">{recalled ? t("ship.eva_recalled_warning", { reason: saved.reason ?? t("ship.hazard_reason") }) : t("ship.target_moved_warning")}</div>}
              {crossed.length > 0 && <div className="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs text-red-200">{t("ship.anomalies_crossed_warning", { crossed: crossed.map(eventLabel).join(", ") })}</div>}
              <RouteStats route={saved} />
              <RouteProfile route={saved} onHover={onProbe} progress={plan.status === "in_progress" ? plan.progress_m : null} />
              {!isReturn(saved) && <RouteBudget route={saved} tempC={tempC} />}
            </div>
          )}

          {check && <EvaCheckView check={check} />}
          {look && zone && <OutlookBar zone={zone} slots={look.slots} next={look.next} title={t("eva.window_24h")} />}
          {plan.status !== "in_progress" && plan.status !== "done" && (
            <Button variant={check?.level === "critical" ? "destructive" : "default"} disabled={!saved || stale || !!draft || startEva.isPending}
              onClick={() => startEva.mutate(plan, { onSuccess: () => toast.success(t("eva.eva_started_toast")) })}>
              <Play /> {check?.level === "critical" ? t("eva.start_eva_anyway") : t("eva.start_eva")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
/** a route line coloured by the slope along the way (blue down, pale level, red up), on a dark casing so it holds on the photo */
function SlopeLine({ points, dashed, opacity = 1 }: { points: PathResult["points"]; dashed?: boolean; opacity?: number }) {
  const runs = useMemo(() => slopeRuns(points, alongs({ points } as Route)), [points]);
  const ll = (i: number) => [points[i][0], points[i][1]] as [number, number];
  return (
    <>
      <Polyline positions={points.map((_, i) => ll(i))} pathOptions={{ color: "#17110d", weight: 8, opacity: 0.55 * opacity, lineCap: "round", interactive: false }} />
      {runs.map((r, k) => (
        <Polyline key={`${k}-${r.key}-${r.from}-${r.to}`} positions={Array.from({ length: r.to - r.from + 1 }, (_, i) => ll(r.from + i))}
          pathOptions={{ color: r.color, weight: 4, opacity, lineCap: "butt", dashArray: dashed ? "9 6" : undefined, interactive: false }} />
      ))}
    </>
  );
}

function ShipMap({ zone, hm, crew, home, plans, sel, active, env, astro, start, draft, probe, onPick, onSelect }: {
  zone: Zone; hm: Heightmap; crew: Crew; home: [number, number] | null; plans: WorkPlan[]; sel: WorkPlan | null; active: WorkPlan | undefined; env: Env; astro: AstronautView;
  start: Start | null; draft: PathResult | null; probe: [number, number] | null; onPick: (lat: number, lon: number) => void; onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <ZoneLeafletMap key={crew.id} zone={zone} hm={hm} onPick={onPick} className="size-full">
        <HazardAreas events={env.evs} zoneId={zone.id} now={env.now} />
        {home && (
          <Marker position={home} icon={pin(`${DOT} bg-landing`, "", 16)}>
            <Tooltip direction="top" offset={[0, -8]}>{t("ship.landing_site_tooltip", { name: crew.ship || crew.name })}</Tooltip>
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
        {/* the plan being worked on: its route coloured by slope (a return route keeps its own blue); a new, unsent one dashed */}
        {sel?.route && (isReturn(sel.route)
          ? <Polyline positions={sel.route.points.map(([a, b]) => [a, b] as [number, number])} pathOptions={{ color: "#5fd8ff", weight: 5, opacity: draft ? 0.35 : 0.95, dashArray: "10 6" }} />
          : <SlopeLine points={sel.route.points} opacity={draft ? 0.3 : 1} dashed={sel.route.target.lat !== sel.target_lat} />)}
        {draft && <SlopeLine points={draft.points} dashed />}
        {probe && sel && <CircleMarker center={probe} radius={6} pathOptions={{ color: "#17110d", weight: 2, fillColor: "#ffffff", fillOpacity: 1, interactive: false }} />}
        {sel && start && (
          <Marker position={[start.lat, start.lon]} icon={pin(`${DOT} bg-white`, "", 14)}>
            <Tooltip direction="top" offset={[0, -8]}>{t("ship.start_tooltip", { name: start.name })}</Tooltip>
          </Marker>
        )}
        <AstronautLayer a={astro} label={crew.name} />
        <ZoomControl position="bottomright" />
      </ZoneLeafletMap>

      <DemoStormButton className="absolute top-3 right-3 z-[500]" crew={crew} zone={zone} plan={active ?? sel} at={astro.at} events={env.evs} now={env.now} />
      <div className="pointer-events-none absolute top-3 left-1/2 z-[500] -translate-x-1/2 rounded-full border bg-card/85 px-4 py-1.5 text-xs backdrop-blur">
        {sel ? t("ship.planning_title", { title: sel.title }) : t("ship.pick_plan_hint")}
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-[500] flex flex-col gap-1 rounded-xl border bg-card/85 p-3 text-xs backdrop-blur">
        <Legend cls="bg-landing" label={t("ship.landing_site_legend")} />
        <Legend cls="bg-route" label={t("ship.plan_target_legend")} />
        <Legend cls="bg-live" label={t("ship.astronaut_live_legend")} />
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 bg-live/70" />{t("ship.route_in_helmet_legend")}</div>
        <div className="flex flex-col gap-0.5"><span>{t("eva.slope_legend")}</span><SlopeLegend className="text-foreground/80" /></div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-sky-400" />{t("ship.return_to_base_legend")}</div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dotted border-live" />{t("ship.walked_live_legend")}</div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-live" />{t("ship.new_route_unsent_legend")}</div>
        <div className="flex items-center gap-2"><span className="size-2.5 rounded-full border-2 border-amber-400 bg-amber-400/30" />{t("ship.anomaly_legend")}</div>
      </div>
    </>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <div className="flex items-center gap-2"><span className={cn("size-2.5 rounded-full", cls)} />{label}</div>;
}
