// MISSION CONTROL: the Mars globe with every crew on the surface and every anomaly; pick a crew to
// see its alerts, surface conditions and work plans in the side panel; "New crew" registers one,
// "New event" raises an anomaly, a forecast or a message that the ships and helmets see at once.
import { lazy, Suspense, useMemo, useState } from "react";
import { Marker, Polyline } from "react-leaflet";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Activity, ExternalLink, Globe2, MapPin, Megaphone, Pencil, Plus, Radiation, Ship, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { activePlan, useCrews, useDeleteCrew, useDeletePlan, useEvents, usePlans } from "../lib/queries";
import { LEVEL_RANK, isReturn, type Crew, type Level, type MarsEvent, type WorkPlan } from "../lib/types";
import { crewHome, useHeightmap, useZone, useZones } from "../lib/zones";
import { fmtDate, fmtKm, fmtLL } from "../lib/geo";
import { Brand, ErrorNote, EvaCard, RouteStats, StatusBadge } from "../components/common";
import { ZoneLeafletMap } from "../components/ZoneLeafletMap";
import { DOT, pin } from "../components/mapPins";
import { AstronautLayer } from "../components/AstronautLayer";
import { useAstronaut } from "../lib/astronaut";
import { isFresh, useTelemetry } from "../lib/telemetry";
import { NewCrewDialog, PlanDialog } from "../dispatch/dialogs";
import { astronautAt } from "../astro/checkpoints";
import { AlertList, ConditionsGrid, HazardAreas, OutlookBar } from "../components/alerts";
import { EventDialog } from "../components/EventDialog";
import { EventsPanel } from "../dispatch/EventsPanel";
import { RecallButton } from "../dispatch/RecallButton";
import { LEVEL_COLOR } from "../components/levels";
import { crewAlerts, hasArea, outlook } from "../lib/hazards";
import { conditions, eventLabel, isActive, useNow } from "../lib/mars";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { LayerSwitcher } from "../components/LayerSwitcher";
import { GLOBE_BASES, GLOBE_OVERLAYS, loadChoice, saveChoice, type LayerChoice } from "../lib/marsLayers";

const Globe = lazy(() => import("../dispatch/Globe").then((m) => ({ default: m.Globe })));

export function Dispatch() {
  const { t } = useTranslation();
  const crews = useCrews(), plans = usePlans(), zones = useZones();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("crew");
  const select = (id: string | null) => setParams(id ? { crew: id } : {});
  const [adding, setAdding] = useState(false);
  const [raising, setRaising] = useState(false);
  const [layers, setLayers] = useState<LayerChoice>(() => loadChoice("globe", { base: "viking", overlays: [] }, GLOBE_BASES, GLOBE_OVERLAYS));
  const [layerStatus, setLayerStatus] = useState({ busy: false, error: false });
  const chooseLayers = (c: LayerChoice) => { setLayers(c); saveChoice("globe", c); };
  const events = useEvents(), now = useNow();
  const evs = useMemo(() => events.data ?? [], [events.data]);
  const tele = useTelemetry();

  const dots = useMemo(() => (crews.data ?? []).flatMap((c) => {
    const zone = zones.data?.find((z) => z.id === c.zone), home = crewHome(c, zone);
    if (!home) return [];
    const active = activePlan(plans.data?.filter((p) => p.crew_id === c.id));
    const t = tele.get(c.id)?.t, live = isFresh(t, now) && t ? ([t.lat, t.lon] as [number, number]) : null;
    const top = crewAlerts(c, zone, active, evs, now, live ?? astronautAt(active))[0];
    const alert: Level | null = top && top.level !== "info" ? top.level : null;
    return [{ id: c.id, name: c.name, lat: home[0], lon: home[1], active: !!active, alert }];
  }), [crews.data, plans.data, zones.data, evs, now, tele]);
  const hazards = useMemo(() => evs.filter((e) => hasArea(e) && (isActive(e, now) || Date.parse(e.starts_at) - now < 12 * 3600_000) && (!e.ends_at || Date.parse(e.ends_at) > now))
    .map((e) => ({ id: e.id, kind: e.kind, lat: e.lat!, lon: e.lon!, level: e.level, label: eventLabel(e), active: isActive(e, now) })), [evs, now, t]);
  const solar = evs.filter((e) => e.kind === "solar_storm" && isActive(e, now)).sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0];
  const selected = crews.data?.find((c) => c.id === selectedId);
  const activeCount = dots.filter((d) => d.active).length;
  const liveEvents = evs.filter((e) => isActive(e, now) || Date.parse(e.starts_at) > now).length;

  return (
    <div className="relative h-full overflow-hidden bg-[#07060a]">
      <div className="absolute inset-0">
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">{t("dispatch.loading_globe")}</div>}>
          <Globe crews={dots} hazards={hazards} solar={solar?.level ?? null} selected={selectedId} onSelect={select} layers={layers} onLayerStatus={setLayerStatus} />
        </Suspense>
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent p-4">
        <div className="pointer-events-auto"><Brand product={t("dispatch.brand")} icon={<Globe2 />} /></div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Badge variant="outline" className="hidden h-8 gap-1.5 bg-background/60 px-3 backdrop-blur sm:flex"><Users /> {t("dispatch.crews_count", { count: dots.length })}</Badge>
          <Badge variant="outline" className="hidden h-8 gap-1.5 bg-background/60 px-3 text-live backdrop-blur sm:flex"><Activity /> {t("dispatch.eva_active_count", { count: activeCount })}</Badge>
          {solar && <Badge variant="outline" className="h-8 animate-pulse gap-1.5 border-red-500/60 bg-red-500/20 px-3 text-red-200 backdrop-blur"><Radiation /> {t("event_kinds.solar_storm.label")}</Badge>}
          <Button size="lg" variant="outline" className="bg-background/60 backdrop-blur" onClick={() => setRaising(true)}><Megaphone /> {t("dispatch.new_event")}</Button>
          <Button size="lg" onClick={() => setAdding(true)}><Plus /> {t("dispatch.new_crew")}</Button>
          <LanguageSwitcher />
        </div>
      </header>

      {(crews.error || plans.error || events.error) && (
        <div className="absolute top-20 left-1/2 w-[min(520px,90%)] -translate-x-1/2"><ErrorNote error={crews.error ?? plans.error ?? events.error} /></div>
      )}

      <div className="absolute top-20 right-4 hidden max-h-[calc(100%-8rem)] w-80 flex-col overflow-hidden rounded-xl border bg-card/80 backdrop-blur-md lg:flex">
        <div className="flex items-center justify-between px-3 pt-2.5 pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
          <span>{t("dispatch.space_weather_alerts", { count: liveEvents })}</span>
        </div>
        <EventsPanel events={evs} crews={crews.data ?? []} now={now} className="overflow-y-auto px-2 pb-2" />
      </div>

      {selected
        ? <CrewPanel key={selected.id} crew={selected} plans={plans.data?.filter((p) => p.crew_id === selected.id) ?? []} evs={evs} now={now} onClose={() => select(null)} />
        : (
          <div className="absolute bottom-4 left-4 w-72 max-w-[calc(100%-2rem)] rounded-xl border bg-card/80 p-2 backdrop-blur-md">
            <div className="px-2 py-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">{t("dispatch.crews_on_mars")}</div>
            {dots.length === 0 && <p className="px-2 pb-2 text-sm text-muted-foreground">{t("dispatch.no_crews_yet")}</p>}
            {dots.map((d) => (
              <button key={d.id} type="button" onClick={() => select(d.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span className={cn("size-2 rounded-full", d.active ? "animate-pulse bg-live" : "bg-route")} />
                <span className="font-medium">{d.name}</span>
                {d.alert && <span className="size-2 animate-pulse rounded-full" style={{ background: LEVEL_COLOR[d.alert] }} title={t("dispatch.has_alerts")} />}
                <span className="ml-auto text-xs text-muted-foreground">{crews.data?.find((c) => c.id === d.id)?.zone}</span>
              </button>
            ))}
          </div>
        )}

      <div className="absolute right-4 bottom-4 flex items-center gap-3">
        <span className="pointer-events-none hidden text-xs text-white/50 sm:block">{t("dispatch.globe_hint")}</span>
        <LayerSwitcher up alignRight bases={GLOBE_BASES} overlays={GLOBE_OVERLAYS} value={layers} onChange={chooseLayers}
          busy={layerStatus.busy} error={layerStatus.error} />
      </div>
      <NewCrewDialog open={adding} onOpenChange={setAdding} onCreated={(c) => select(c.id)} />
      {raising && <EventDialog open onOpenChange={setRaising} crews={crews.data ?? []} source="dispatch" />}
    </div>
  );
}

function CrewPanel({ crew, plans, evs, now, onClose }: { crew: Crew; plans: WorkPlan[]; evs: MarsEvent[]; now: number; onClose: () => void }) {
  const { t } = useTranslation();
  const zone = useZone(crew.zone), home = crewHome(crew, zone);
  const active = activePlan(plans);
  const astro = useAstronaut(crew.id, active);
  const alerts = crewAlerts(crew, zone, active, evs, now, astro.at);
  const cond = zone ? conditions(zone, now, evs) : null;
  const look = useMemo(() => (zone ? outlook(zone, active?.route ?? null, evs, now) : null), [zone, active?.route, evs, now]);
  const [editing, setEditing] = useState<WorkPlan | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(active?.id ?? null);
  const del = useDeleteCrew();

  return (
    <aside className="absolute top-20 bottom-4 left-4 flex w-[400px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border bg-card/90 shadow-2xl backdrop-blur-md duration-200 animate-in fade-in slide-in-from-left-4">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-xl font-semibold">{crew.name}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Ship className="size-3.5" />{crew.ship || t("common.none")}</span>
            <span className="flex items-center gap-1"><MapPin className="size-3.5" />{zone?.name ?? crew.zone}{home && ` · ${fmtLL(home[0], home[1])}`}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("common.close")}><X /></Button>
      </div>

      {active?.route && <EvaCard plan={active} astro={astro} className="mx-4 mb-2"><RecallButton crew={crew} plan={active} astro={astro} evs={evs} now={now} className="mt-2" /></EvaCard>}
      {!active && astro.live && astro.t && (
        <div className="mx-4 mb-2 rounded-xl border border-live/30 bg-live/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="text-live">{t("dispatch.helmet_live")}</span> · {t("dispatch.on_surface_no_eva")} · {fmtLL(astro.t.lat, astro.t.lon)}
          <RecallButton crew={crew} plan={null} astro={astro} evs={evs} now={now} className="mt-2" />
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-4 pb-3">
          <AlertList alerts={alerts} />
          {cond && zone && <ConditionsGrid c={cond} zone={zone} />}
          {look && zone && <OutlookBar zone={zone} slots={look.slots} />}
        </div>
        <div className="flex items-center justify-between px-4 pt-1 pb-2">
          <div className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{t("dispatch.work_plans_count", { count: plans.length })}</div>
          <Button size="sm" onClick={() => setEditing("new")}><Plus /> {t("dispatch.add_plan")}</Button>
        </div>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {plans.length === 0 && (
            <Empty className="border border-dashed p-6">
              <EmptyHeader>
                <EmptyTitle>{t("dispatch.no_work_plans")}</EmptyTitle>
                <EmptyDescription>{t("dispatch.no_work_plans_desc")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {plans.map((p) => (
            <PlanItem key={p.id} plan={p} evs={evs} now={now} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onEdit={() => setEditing(p)} crewId={crew.id} active={active?.id === p.id} />
          ))}
        </div>
      </ScrollArea>

      <Separator />
      <div className="flex items-center gap-1 p-2">
        <Button variant="ghost" size="sm" asChild><a href={`/ship/${crew.id}`} target="_blank" rel="noreferrer"><ExternalLink /> {t("dispatch.ship_console")}</a></Button>
        <Button variant="ghost" size="sm" asChild><a href={`/helmet/${crew.id}`} target="_blank" rel="noreferrer"><ExternalLink /> {t("dispatch.helmet")}</a></Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive"><Trash2 /> {t("common.delete")}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("dispatch.delete_crew_title", { name: crew.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t("dispatch.delete_crew_desc", { count: plans.length })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => del.mutate(crew.id, { onSuccess: () => { toast(t("dispatch.crew_deleted_toast", { name: crew.name })); onClose(); } })}>{t("dispatch.delete_crew_btn")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {editing && <PlanDialog key={editing === "new" ? "new" : editing.id} crew={crew} plan={editing === "new" ? null : editing} open onOpenChange={(o) => !o && setEditing(null)} />}
    </aside>
  );
}

function PlanItem({ plan, evs, now, open, onToggle, onEdit, crewId, active }: { plan: WorkPlan; evs: MarsEvent[]; now: number; open: boolean; onToggle: () => void; onEdit: () => void; crewId: string; active: boolean }) {
  const { t } = useTranslation();
  const del = useDeletePlan();
  return (
    <div className={cn("rounded-xl border bg-background/40 transition-colors", open && "border-primary/40 bg-background/70")}>
      <div className="flex items-start gap-2 p-3">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="truncate font-medium">{plan.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <StatusBadge status={plan.status} />
            <span>{plan.scheduled_at ? fmtDate(plan.scheduled_at) : t("dispatch.unscheduled")}</span>
            <span>· {plan.route ? fmtKm(plan.route.distance_m) : t("dispatch.no_route_yet")}</span>
          </div>
        </button>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t("common.edit")}><Pencil /></Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.delete")} className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("dispatch.delete_plan_title", { title: plan.title })}</AlertDialogTitle>
              <AlertDialogDescription>{t("dispatch.delete_plan_desc")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => del.mutate(plan.id, { onSuccess: () => toast(t("dispatch.plan_deleted_toast")) })}>{t("dispatch.delete_plan_btn")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {open && <PlanDetails plan={plan} evs={evs} now={now} crewId={crewId} active={active} />}
    </div>
  );
}

function PlanDetails({ plan, evs, now, crewId, active }: { plan: WorkPlan; evs: MarsEvent[]; now: number; crewId: string; active: boolean }) {
  const { t } = useTranslation();
  const zone = useZone(plan.zone), hm = useHeightmap(zone);
  const astro = useAstronaut(crewId, active ? plan : null);
  return (
    <div className="flex flex-col gap-3 border-t px-3 pt-3 pb-3">
      {plan.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{plan.description}</p>}
      {zone && (
        <ZoneLeafletMap zone={zone} hm={hm.data} className="aspect-square rounded-xl border">
          <HazardAreas events={evs} zoneId={zone.id} now={now} />
          {plan.route && <Polyline positions={plan.route.points.map(([a, b]) => [a, b] as [number, number])} pathOptions={isReturn(plan.route) ? { color: "#5fd8ff", weight: 4, dashArray: "10 6" } : { color: "#ffb347", weight: 3 }} />}
          {plan.route && <Marker position={[plan.route.start.lat, plan.route.start.lon]} icon={pin(`${DOT} bg-landing`, "", 12)} />}
          <Marker position={[plan.target_lat, plan.target_lon]} icon={pin(`${DOT} bg-target`, "", 16)} />
          {active && <AstronautLayer a={astro} permanent={false} />}
        </ZoneLeafletMap>
      )}
      {plan.route ? <RouteStats route={plan.route} /> : <p className="text-xs text-muted-foreground">{t("dispatch.no_route_ship_desc")}</p>}
    </div>
  );
}
