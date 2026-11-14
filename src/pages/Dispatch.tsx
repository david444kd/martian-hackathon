// MISSION CONTROL: the Mars globe with every crew on the surface; pick a crew to see and manage its
// work plans in the side panel; "New crew" registers one.
import { lazy, Suspense, useMemo, useState } from "react";
import { Marker, Polyline } from "react-leaflet";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Activity, ExternalLink, Globe2, MapPin, Pencil, Plus, Ship, Trash2, Users, X } from "lucide-react";
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
import { activePlan, useCrews, useDeleteCrew, useDeletePlan, usePlans } from "../lib/queries";
import type { Crew, WorkPlan } from "../lib/types";
import { crewHome, useHeightmap, useZone, useZones } from "../lib/zones";
import { fmtDate, fmtKm, fmtLL } from "../lib/geo";
import { Brand, ErrorNote, EvaCard, RouteStats, StatusBadge } from "../components/common";
import { ZoneLeafletMap } from "../components/ZoneLeafletMap";
import { DOT, LIVE_PIN, pin } from "../components/mapPins";
import { NewCrewDialog, PlanDialog } from "../dispatch/dialogs";
import { astronautAt } from "../astro/checkpoints";

const Globe = lazy(() => import("../dispatch/Globe").then((m) => ({ default: m.Globe })));

export function Dispatch() {
  const crews = useCrews(), plans = usePlans(), zones = useZones();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("crew");
  const select = (id: string | null) => setParams(id ? { crew: id } : {});
  const [adding, setAdding] = useState(false);

  const dots = useMemo(() => (crews.data ?? []).flatMap((c) => {
    const home = crewHome(c, zones.data?.find((z) => z.id === c.zone));
    if (!home) return [];
    return [{ id: c.id, name: c.name, lat: home[0], lon: home[1], active: !!activePlan(plans.data?.filter((p) => p.crew_id === c.id)) }];
  }), [crews.data, plans.data, zones.data]);
  const selected = crews.data?.find((c) => c.id === selectedId);
  const activeCount = dots.filter((d) => d.active).length;

  return (
    <div className="relative h-full overflow-hidden bg-[#07060a]">
      <div className="absolute inset-0">
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">Loading globe…</div>}>
          <Globe crews={dots} selected={selectedId} onSelect={select} />
        </Suspense>
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent p-4">
        <div className="pointer-events-auto"><Brand product="Mission Control" icon={<Globe2 />} /></div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Badge variant="outline" className="hidden h-8 gap-1.5 bg-background/60 px-3 backdrop-blur sm:flex"><Users /> {dots.length} crews</Badge>
          <Badge variant="outline" className="hidden h-8 gap-1.5 bg-background/60 px-3 text-live backdrop-blur sm:flex"><Activity /> {activeCount} EVA active</Badge>
          <Button size="lg" onClick={() => setAdding(true)}><Plus /> New crew</Button>
        </div>
      </header>

      {(crews.error || plans.error) && (
        <div className="absolute top-20 left-1/2 w-[min(520px,90%)] -translate-x-1/2"><ErrorNote error={crews.error ?? plans.error} /></div>
      )}

      {selected
        ? <CrewPanel key={selected.id} crew={selected} plans={plans.data?.filter((p) => p.crew_id === selected.id) ?? []} onClose={() => select(null)} />
        : (
          <div className="absolute bottom-4 left-4 w-72 max-w-[calc(100%-2rem)] rounded-xl border bg-card/80 p-2 backdrop-blur-md">
            <div className="px-2 py-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">Crews on Mars</div>
            {dots.length === 0 && <p className="px-2 pb-2 text-sm text-muted-foreground">None yet: add the first crew.</p>}
            {dots.map((d) => (
              <button key={d.id} type="button" onClick={() => select(d.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span className={cn("size-2 rounded-full", d.active ? "animate-pulse bg-live" : "bg-route")} />
                <span className="font-medium">{d.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{crews.data?.find((c) => c.id === d.id)?.zone}</span>
              </button>
            ))}
          </div>
        )}

      <div className="pointer-events-none absolute right-4 bottom-4 hidden text-xs text-white/50 sm:block">Drag to turn · scroll to zoom · click a crew</div>
      <NewCrewDialog open={adding} onOpenChange={setAdding} onCreated={(c) => select(c.id)} />
    </div>
  );
}

function CrewPanel({ crew, plans, onClose }: { crew: Crew; plans: WorkPlan[]; onClose: () => void }) {
  const zone = useZone(crew.zone), home = crewHome(crew, zone);
  const active = activePlan(plans);
  const [editing, setEditing] = useState<WorkPlan | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(active?.id ?? null);
  const del = useDeleteCrew();

  return (
    <aside className="absolute top-20 bottom-4 left-4 flex w-[400px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border bg-card/90 shadow-2xl backdrop-blur-md duration-200 animate-in fade-in slide-in-from-left-4">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-xl font-semibold">{crew.name}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Ship className="size-3.5" />{crew.ship || "—"}</span>
            <span className="flex items-center gap-1"><MapPin className="size-3.5" />{zone?.name ?? crew.zone}{home && ` · ${fmtLL(home[0], home[1])}`}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
      </div>

      {active?.route && <EvaCard plan={active} className="mx-4 mb-2" />}

      <div className="flex items-center justify-between px-4 pt-2 pb-2">
        <div className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Work plans · {plans.length}</div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus /> Add plan</Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-4 pb-4">
          {plans.length === 0 && (
            <Empty className="border border-dashed p-6">
              <EmptyHeader>
                <EmptyTitle>No work plans</EmptyTitle>
                <EmptyDescription>Add a plan: the crew's ship sees it within seconds.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {plans.map((p) => (
            <PlanItem key={p.id} plan={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onEdit={() => setEditing(p)} />
          ))}
        </div>
      </ScrollArea>

      <Separator />
      <div className="flex items-center gap-1 p-2">
        <Button variant="ghost" size="sm" asChild><a href={`/ship/${crew.id}`} target="_blank" rel="noreferrer"><ExternalLink /> Ship console</a></Button>
        <Button variant="ghost" size="sm" asChild><a href={`/helmet/${crew.id}`} target="_blank" rel="noreferrer"><ExternalLink /> Helmet</a></Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive"><Trash2 /> Delete</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {crew.name}?</AlertDialogTitle>
              <AlertDialogDescription>The crew and all {plans.length} of its work plans are removed for everyone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => del.mutate(crew.id, { onSuccess: () => { toast(`${crew.name} deleted`); onClose(); } })}>Delete crew</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {editing && <PlanDialog key={editing === "new" ? "new" : editing.id} crew={crew} plan={editing === "new" ? null : editing} open onOpenChange={(o) => !o && setEditing(null)} />}
    </aside>
  );
}

function PlanItem({ plan, open, onToggle, onEdit }: { plan: WorkPlan; open: boolean; onToggle: () => void; onEdit: () => void }) {
  const del = useDeletePlan();
  return (
    <div className={cn("rounded-xl border bg-background/40 transition-colors", open && "border-primary/40 bg-background/70")}>
      <div className="flex items-start gap-2 p-3">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="truncate font-medium">{plan.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <StatusBadge status={plan.status} />
            <span>{plan.scheduled_at ? fmtDate(plan.scheduled_at) : "unscheduled"}</span>
            <span>· {plan.route ? fmtKm(plan.route.distance_m) : "no route yet"}</span>
          </div>
        </button>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit"><Pencil /></Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Delete" className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{plan.title}”?</AlertDialogTitle>
              <AlertDialogDescription>The crew loses this work plan and its route.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => del.mutate(plan.id, { onSuccess: () => toast("Work plan deleted") })}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {open && <PlanDetails plan={plan} />}
    </div>
  );
}

function PlanDetails({ plan }: { plan: WorkPlan }) {
  const zone = useZone(plan.zone), hm = useHeightmap(zone);
  const you = astronautAt(plan);
  return (
    <div className="flex flex-col gap-3 border-t px-3 pt-3 pb-3">
      {plan.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{plan.description}</p>}
      {zone && (
        <ZoneLeafletMap zone={zone} hm={hm.data} className="aspect-square rounded-xl border">
          {plan.route && <Polyline positions={plan.route.points.map(([a, b]) => [a, b] as [number, number])} pathOptions={{ color: "#ffb347", weight: 3 }} />}
          {plan.route && <Marker position={[plan.route.start.lat, plan.route.start.lon]} icon={pin(`${DOT} bg-landing`, "", 12)} />}
          <Marker position={[plan.target_lat, plan.target_lon]} icon={pin(`${DOT} bg-target`, "", 16)} />
          {you && <Marker position={you} icon={pin(LIVE_PIN, "", 14)} zIndexOffset={1000} />}
        </ZoneLeafletMap>
      )}
      {plan.route ? <RouteStats route={plan.route} /> : <p className="text-xs text-muted-foreground">The ship hasn't made a route yet.</p>}
    </div>
  );
}
