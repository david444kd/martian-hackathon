// Mission control's dialogs: register a crew (where it landed) and create / edit a work plan.
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { ZoneLeafletMap } from "../components/ZoneLeafletMap";
import { DOT, pin } from "../components/mapPins";
import { ErrorNote } from "../components/common";
import { useCreateCrew, useCreatePlan, useUpdatePlan } from "../lib/queries";
import { STATUSES, STATUS_LABEL, type Crew, type NewPlan, type PlanStatus, type WorkPlan } from "../lib/types";
import { crewHome, elevationAt, inZone, useHeightmap, useZones, type Heightmap, type Zone } from "../lib/zones";
import { distanceM, fmtKm, fmtLL } from "../lib/geo";


export function NewCrewDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Crew) => void }) {
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
        toast.success(`${c.name} registered`);
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
              <DialogTitle>New crew</DialogTitle>
              <DialogDescription>Register a crew on the surface and where it landed.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="crew-name">Crew</FieldLabel>
                <Input id="crew-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ares-2" required autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="crew-ship">Ship</FieldLabel>
                <Input id="crew-ship" value={ship} onChange={(e) => setShip(e.target.value)} placeholder="Odyssey" />
              </Field>
              <Field>
                <FieldLabel>Landing zone</FieldLabel>
                <Select value={zoneId} onValueChange={(v) => { setZoneId(v); setSpot(null); }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {zones.data?.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {landing ? <>Landing point {fmtLL(landing[0], landing[1])}. Click the map to move it.</> : "Click the map to set the landing point."}
                </FieldDescription>
              </Field>
            </FieldGroup>
            <ErrorNote error={create.error} />
            <DialogFooter className="mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending || !name.trim() || !landing}>Register crew</Button>
            </DialogFooter>
          </div>
          <PickMap zone={zone} hm={hm.data} onPick={(lat, lon) => setSpot([lat, lon])}>
            {landing && <Marker position={landing} icon={pin(`${DOT} bg-landing`, "", 18)}><Tooltip direction="top" offset={[0, -10]} permanent>Landing</Tooltip></Marker>}
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

/** create (plan = null) or edit a crew's work plan; the target is picked on the crew's zone map */
export function PlanDialog({ crew, plan, open, onOpenChange }: { crew: Crew; plan: WorkPlan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
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
    const done = () => { toast.success(plan ? "Work plan updated" : "Work plan sent to the crew"); onOpenChange(false); };
    if (!plan) { create.mutate(row, { onSuccess: done }); return; }
    // a moved target makes the crew's route useless: clear it so the ship makes a new one
    const moved = plan.target_lat !== row.target_lat || plan.target_lon !== row.target_lon;
    update.mutate({ id: plan.id, patch: moved ? { ...row, route: null, progress_m: null } : row }, { onSuccess: done });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <form onSubmit={submit} className="grid gap-5 md:grid-cols-[360px_1fr]">
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{plan ? "Edit work plan" : `New work plan · ${crew.name}`}</DialogTitle>
              <DialogDescription>{zone?.name ?? zoneId}. Click the map to set the target.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="plan-title">Title</FieldLabel>
                <Input id="plan-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sample the delta front" required autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="plan-tasks">Tasks</FieldLabel>
                <Textarea id="plan-tasks" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the EVA team does at the target" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select value={status} onValueChange={(v) => setStatus(v as PlanStatus)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "in_progress" ? "EVA active" : STATUS_LABEL[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-when">Scheduled</FieldLabel>
                  <Input id="plan-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </div>
              <FieldDescription>
                {target && hm.data
                  ? <>Target {fmtLL(target[0], target[1])} · {Math.round(elevationAt(hm.data, target[0], target[1]))} m{home && <> · {fmtKm(distanceM(home[0], home[1], target[0], target[1]))} from the landing site</>}</>
                  : <span className="text-primary">Click the map to set the target.</span>}
                {plan?.route && <><br />Moving the target clears the ship's current route.</>}
              </FieldDescription>
            </FieldGroup>
            <ErrorNote error={create.error ?? update.error} />
            <DialogFooter className="mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !target || !title.trim()}>{plan ? "Save changes" : "Create plan"}</Button>
            </DialogFooter>
          </div>
          <PickMap zone={zone} hm={hm.data} onPick={(lat, lon) => setTarget([lat, lon])}>
            {plan?.route && <Polyline positions={plan.route.points.map(([a, b]) => [a, b] as [number, number])} pathOptions={{ color: "#ffb347", weight: 3, opacity: 0.6, dashArray: "6 8" }} />}
            {home && <Marker position={home} icon={pin(`${DOT} bg-landing`, "", 16)}><Tooltip direction="top" offset={[0, -8]}>Landing site</Tooltip></Marker>}
            {target && <Marker position={target} icon={pin(`${DOT} bg-target`, "", 20)}><Tooltip direction="top" offset={[0, -10]} permanent>Target</Tooltip></Marker>}
          </PickMap>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** the zone map in a dialog: as tall as the dialog allows; clicks outside the zone are ignored */
function PickMap({ zone, hm, onPick, children }: { zone: Zone | undefined; hm: Heightmap | undefined; onPick: (lat: number, lon: number) => void; children: ReactNode }) {
  if (!zone) return <div className="grid h-[70vh] min-h-[420px] place-items-center rounded-xl border text-sm text-muted-foreground">Loading map…</div>;
  return (
    <ZoneLeafletMap zone={zone} hm={hm} className="h-[70vh] min-h-[420px] rounded-xl border"
      onPick={(lat, lon) => { if (inZone(zone, lat, lon)) onPick(lat, lon); }}>
      {children}
    </ZoneLeafletMap>
  );
}
