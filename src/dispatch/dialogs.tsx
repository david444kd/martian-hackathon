// Mission control's dialogs: register a crew (where it landed) and create / edit a work plan.
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { ZoneLeafletMap } from "../components/ZoneLeafletMap";
import { DOT, pin } from "../components/mapPins";
import { useCreateCrew, useCreatePlan, useUpdatePlan } from "../lib/queries";
import { STATUSES, type Crew, type NewPlan, type PlanPatch, type PlanStatus, type WorkPlan } from "../lib/types";
import { crewHome, elevationAt, inZone, useHeightmap, useZones, type Heightmap, type Zone } from "../lib/zones";
import { distanceM, fmtKm, fmtLL } from "../lib/geo";


export function NewCrewDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Crew) => void }) {
  const { t } = useTranslation();
  const zones = useZones();
  const [name, setName] = useState(""), [ship, setShip] = useState("");
  const [zoneId, setZoneId] = useState("jezero");
  const [spot, setSpot] = useState<[number, number] | null>(null);
  const zone = zones.data?.find((z) => z.id === zoneId), hm = useHeightmap(zone);
  const landing = spot ?? (zone ? [zone.base.lat, zone.base.lon] as [number, number] : null);
  const create = useCreateCrew();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !landing) return;
    create.mutate({ name: name.trim(), ship: ship.trim(), zone: zoneId, lat: landing[0], lon: landing[1] }, {
      onSuccess: (c) => {
        toast.success(t("dialogs.crew_registered_toast", { name: c.name }));
        setName(""); setShip(""); setSpot(null);
        onOpenChange(false);
        onCreated(c);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <form onSubmit={submit} className="grid gap-5 md:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("dialogs.new_crew_title")}</DialogTitle>
              <DialogDescription>{t("dialogs.new_crew_desc")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="crew-name">{t("dialogs.crew_name_label")}</FieldLabel>
                <Input id="crew-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("dialogs.crew_name_placeholder")} required autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="crew-ship">{t("dialogs.ship_label")}</FieldLabel>
                <Input id="crew-ship" value={ship} onChange={(e) => setShip(e.target.value)} placeholder={t("dialogs.ship_placeholder")} />
              </Field>
              <Field>
                <FieldLabel>{t("dialogs.landing_zone_label")}</FieldLabel>
                <Select value={zoneId} onValueChange={(v) => { setZoneId(v); setSpot(null); }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {zones.data?.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {landing ? t("dialogs.landing_point_desc", { coords: fmtLL(landing[0], landing[1]) }) : t("dialogs.click_map_landing")}
                </FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={create.isPending || !name.trim() || !landing}>{t("dialogs.register_crew_btn")}</Button>
            </DialogFooter>
          </div>
          <PickMap zone={zone} hm={hm.data} onPick={(lat, lon) => setSpot([lat, lon])}>
            {landing && <Marker position={landing} icon={pin(`${DOT} bg-landing`, "", 18)}><Tooltip direction="top" offset={[0, -10]} permanent>{t("dialogs.landing_marker")}</Tooltip></Marker>}
          </PickMap>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** two timestamps naming the same moment (the database writes them as "+00:00", the browser as "Z") */
const sameTime = (a: string | null, b: string | null) => (a && b ? Date.parse(a) === Date.parse(b) : a === b);

/** create (plan = null) or edit a crew's work plan; the target is picked on the crew's zone map */
export function PlanDialog({ crew, plan, open, onOpenChange }: { crew: Crew; plan: WorkPlan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const zones = useZones();
  const zoneId = plan?.zone ?? crew.zone;
  const zone = zones.data?.find((z) => z.id === zoneId), hm = useHeightmap(zone);
  const home = crewHome(crew, zone);
  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [status, setStatus] = useState<PlanStatus>(plan?.status ?? "assigned");
  const [when, setWhen] = useState(toLocalInput(plan?.scheduled_at ?? null));
  const [target, setTarget] = useState<[number, number] | null>(plan ? [plan.target_lat, plan.target_lon] : null);
  const create = useCreatePlan(), update = useUpdatePlan();
  const busy = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target || !title.trim()) return;
    const row: NewPlan = {
      crew_id: crew.id, title: title.trim(), description: description.trim(), zone: zoneId, status,
      target_lat: target[0], target_lon: target[1], scheduled_at: when ? new Date(when).toISOString() : null,
    };
    const done = () => { toast.success(plan ? t("dialogs.plan_updated_toast") : t("dialogs.plan_created_toast")); onOpenChange(false); };
    if (!plan) { create.mutate(row, { onSuccess: done }); return; }
    // only what was changed here: a field the ship or the helmet changed meanwhile (the status at the
    // end of an EVA, say) is not put back to what this dialog showed when it opened
    const patch: PlanPatch = {};
    const same = (k: keyof NewPlan) => k === "scheduled_at" ? sameTime(row.scheduled_at, plan.scheduled_at) : row[k] === plan[k];
    for (const k of Object.keys(row) as (keyof NewPlan)[]) if (!same(k)) Object.assign(patch, { [k]: row[k] });
    // a moved target makes the crew's route useless: clear it so the ship makes a new one; an EVA
    // under way on that route is stopped (the helmet would be left with nothing to follow)
    const moved = plan.target_lat !== row.target_lat || plan.target_lon !== row.target_lon;
    if (moved) Object.assign(patch, { route: null, progress_m: null }, plan.status === "in_progress" && !patch.status ? { status: "assigned" } : {});
    if (!Object.keys(patch).length) { onOpenChange(false); return; }
    update.mutate({ id: plan.id, patch }, { onSuccess: done });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <form onSubmit={submit} className="grid gap-5 md:grid-cols-[360px_1fr]">
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{plan ? t("dialogs.edit_plan_title") : t("dialogs.new_plan_title", { name: crew.name })}</DialogTitle>
              <DialogDescription>{t("dialogs.plan_map_hint", { zone: zone?.name ?? zoneId })}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="plan-title">{t("dialogs.plan_title_label")}</FieldLabel>
                <Input id="plan-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("dialogs.plan_title_placeholder")} required autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="plan-tasks">{t("dialogs.plan_tasks_label")}</FieldLabel>
                <Textarea id="plan-tasks" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("dialogs.plan_tasks_placeholder")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>{t("dialogs.status_label")}</FieldLabel>
                  <Select value={status} onValueChange={(v) => setStatus(v as PlanStatus)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {/* an EVA is started from the ship console (it sets the start time and ends any other EVA of the crew) */}
                      {STATUSES.filter((s) => s !== "in_progress" || plan?.status === "in_progress").map((s) => <SelectItem key={s} value={s}>{s === "in_progress" ? t("status.eva_active") : t(`status.${s}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-when">{t("dialogs.scheduled_label")}</FieldLabel>
                  <Input id="plan-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </div>
              <FieldDescription>
                {target && hm.data
                  ? t("dialogs.target_summary", {
                      coords: fmtLL(target[0], target[1]),
                      elev: Math.round(elevationAt(hm.data, target[0], target[1])),
                      dist: home ? fmtKm(distanceM(home[0], home[1], target[0], target[1])) : ""
                    })
                  : <span className="text-primary">{t("dialogs.click_map_target")}</span>}
                {plan?.route && <><br />{t("dialogs.move_target_warning")}</>}
              </FieldDescription>
            </FieldGroup>
            <DialogFooter className="mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={busy || !target || !title.trim()}>{plan ? t("dialogs.save_changes_btn") : t("dialogs.create_plan_btn")}</Button>
            </DialogFooter>
          </div>
          <PickMap zone={zone} hm={hm.data} onPick={(lat, lon) => setTarget([lat, lon])}>
            {plan?.route && <Polyline positions={plan.route.points.map(([a, b]) => [a, b] as [number, number])} pathOptions={{ color: "#ffb347", weight: 3, opacity: 0.6, dashArray: "6 8" }} />}
            {home && <Marker position={home} icon={pin(`${DOT} bg-landing`, "", 16)}><Tooltip direction="top" offset={[0, -8]}>{t("dialogs.landing_site_marker")}</Tooltip></Marker>}
            {target && <Marker position={target} icon={pin(`${DOT} bg-target`, "", 20)}><Tooltip direction="top" offset={[0, -10]} permanent>{t("dialogs.target_marker")}</Tooltip></Marker>}
          </PickMap>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** the zone map in a dialog: as tall as the dialog allows; clicks outside the zone are ignored */
function PickMap({ zone, hm, onPick, children }: { zone: Zone | undefined; hm: Heightmap | undefined; onPick: (lat: number, lon: number) => void; children: ReactNode }) {
  const { t } = useTranslation();
  if (!zone) return <div className="grid h-[70vh] min-h-[420px] place-items-center rounded-xl border text-sm text-muted-foreground">{t("ship.loading_map")}</div>;
  return (
    <ZoneLeafletMap zone={zone} hm={hm} className="h-[70vh] min-h-[420px] rounded-xl border"
      onPick={(lat, lon) => { if (inZone(zone, lat, lon)) onPick(lat, lon); }}>
      {children}
    </ZoneLeafletMap>
  );
}
