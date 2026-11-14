// Raise an event: a message to one crew or all, an anomaly over an area of a zone (dust storm, dust
// devil, rockfall) or a planet-wide solar particle event. Starting later makes it a forecast. Mission
// control can raise anything; the ship raises messages and marks hazards in its own zone.
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Circle, Marker, Tooltip } from "react-leaflet";
import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ZoneLeafletMap } from "./ZoneLeafletMap";
import { DOT, pin } from "./mapPins";
import { ErrorNote } from "./common";
import { LEVEL_COLOR } from "./levels";
import { useCreateEvent } from "../lib/queries";
import { EVENT_KINDS, LEVELS, type Crew, type EventKind, type Level, type NewEvent } from "../lib/types";
import { crewHome, inZone, toLL, toPx, useHeightmap, useZones } from "../lib/zones";
import { fmtKm } from "../lib/geo";

export function EventDialog({ open, onOpenChange, crews, source, crew }: {
  open: boolean; onOpenChange: (o: boolean) => void; crews: Crew[];
  source: NewEvent["source"];
  /** raised by this crew's ship: messages go to it, areas are in its zone */
  crew?: Crew;
}) {
  const { t } = useTranslation();
  const zones = useZones();
  const kinds = (Object.keys(EVENT_KINDS) as EventKind[]).filter((k) => !crew || k !== "solar_storm");
  const [kind, setKind] = useState<EventKind>(crew ? "message" : "dust_storm");
  const meta = EVENT_KINDS[kind];
  const [level, setLevel] = useState<Level>(meta.level);
  const [to, setTo] = useState<string>(crew?.id ?? "all");
  const [zoneId, setZoneId] = useState(crew?.zone ?? crews[0]?.zone ?? "jezero");
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState(meta.radius);
  const [startIn, setStartIn] = useState(0);
  const [duration, setDuration] = useState(120);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const zone = zones.data?.find((z) => z.id === zoneId), hm = useHeightmap(zone);
  const create = useCreateEvent();
  const zoneCrews = crews.filter((c) => c.zone === zoneId);

  const pickKind = (k: EventKind) => { setKind(k); setLevel(EVENT_KINDS[k].level); setRadius(EVENT_KINDS[k].radius); };

  /** a plausible anomaly near a crew in the zone, for demos */
  function randomize() {
    if (!zone) return;
    const areaKinds = kinds.filter((k) => EVENT_KINDS[k].area);
    const k = areaKinds[Math.floor(Math.random() * areaKinds.length)];
    pickKind(k);
    const c = zoneCrews[Math.floor(Math.random() * zoneCrews.length)];
    const home = (c && crewHome(c, zone)) ?? [zone.base.lat, zone.base.lon];
    const [hx, hy] = toPx(zone, home[0], home[1]);
    const a = Math.random() * Math.PI * 2, d = (800 + Math.random() * 1800) / zone.dx;
    const x = Math.min(zone.width - 20, Math.max(20, hx + Math.cos(a) * d)), y = Math.min(zone.height - 20, Math.max(20, hy + Math.sin(a) * d));
    setCenter(toLL(zone, x, y));
    setRadius(Math.round(EVENT_KINDS[k].radius * (0.7 + Math.random() * 0.6) / 50) * 50);
    setStartIn(Math.random() < 0.5 ? 0 : Math.round(Math.random() * 6) * 30);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (meta.area && !center) return;
    if (kind === "message" && !text.trim()) return;
    const starts = Date.now() + startIn * 60_000;
    const target = kind === "message" && to !== "all" ? crews.find((c) => c.id === to) : undefined;
    const defaultText = t(`event_kinds.${kind}.text`, { defaultValue: meta.text });
    const row: NewEvent = {
      kind, level, source,
      zone: meta.area ? zoneId : target?.zone ?? null,
      crew_id: kind === "message" && to !== "all" ? to : null,
      lat: meta.area ? center![0] : null,
      lon: meta.area ? center![1] : null,
      radius_m: meta.area ? radius : null,
      starts_at: new Date(starts).toISOString(),
      ends_at: duration > 0 ? new Date(starts + duration * 60_000).toISOString() : null,
      title: title.trim(),
      text: text.trim() || defaultText,
    };
    create.mutate(row, {
      onSuccess: () => {
        const kindLabel = t(`event_kinds.${kind}.label`, { defaultValue: meta.label });
        toast.success(kind === "message" ? t("dialogs.message_sent_toast") : startIn ? t("dialogs.forecast_raised_toast", { label: kindLabel }) : t("dialogs.event_raised_toast", { label: kindLabel }));
        setCenter(null); setTitle(""); setText(""); setStartIn(0);
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(meta.area ? "sm:max-w-6xl" : "sm:max-w-lg")}>
        <form onSubmit={submit} className={cn("grid gap-5", meta.area && "md:grid-cols-[340px_1fr]")}>
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{crew ? t("dialogs.alert_hazard_title") : t("dialogs.new_event_title")}</DialogTitle>
              <DialogDescription>
                {crew ? t("dialogs.event_desc_ship") : t("dialogs.event_desc_dispatch")}
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <div className="grid grid-cols-[1fr_130px] gap-3">
                <Field>
                  <FieldLabel>{t("dialogs.type_label")}</FieldLabel>
                  <Select value={kind} onValueChange={(v) => pickKind(v as EventKind)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{kinds.map((k) => <SelectItem key={k} value={k}>{t(`event_kinds.${k}.label`, { defaultValue: EVENT_KINDS[k].label })}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>{t("dialogs.level_label")}</FieldLabel>
                  <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => <SelectItem key={l} value={l}><span className="size-2 rounded-full" style={{ background: LEVEL_COLOR[l] }} />{t(`levels.${l}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {kind === "message" && !crew && (
                <Field>
                  <FieldLabel>{t("dialogs.to_label")}</FieldLabel>
                  <Select value={to} onValueChange={setTo}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("dialogs.all_crews_option")}</SelectItem>
                      {crews.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {meta.area && !crew && (
                <Field>
                  <FieldLabel>{t("dialogs.zone_label")}</FieldLabel>
                  <Select value={zoneId} onValueChange={(v) => { setZoneId(v); setCenter(null); }}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{zones.data?.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
              {meta.area && (
                <Field>
                  <FieldLabel htmlFor="ev-radius">{t("dialogs.radius_label", { dist: fmtKm(radius) })}</FieldLabel>
                  <input id="ev-radius" type="range" min={100} max={4000} step={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="accent-primary" />
                  <FieldDescription>{center ? t("dialogs.click_map_move_center") : <span className="text-primary">{t("dialogs.click_map_place_center")}</span>}</FieldDescription>
                </Field>
              )}

              {kind === "message" && (
                <Field>
                  <FieldLabel htmlFor="ev-title">{t("dialogs.subject_label")}</FieldLabel>
                  <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("dialogs.subject_placeholder")} />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="ev-text">{kind === "message" ? t("dialogs.message_label") : t("dialogs.note_label")}</FieldLabel>
                <Textarea id="ev-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t(`event_kinds.${kind}.text`, { defaultValue: meta.text || t("dialogs.message_placeholder") })} required={kind === "message"} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="ev-start">{t("dialogs.starts_in_label")}</FieldLabel>
                  <Input id="ev-start" type="number" min={0} step={10} value={startIn} onChange={(e) => setStartIn(Math.max(0, Number(e.target.value)))} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ev-dur">{t("dialogs.lasts_label")}</FieldLabel>
                  <Input id="ev-dur" type="number" min={0} step={10} value={duration} onChange={(e) => setDuration(Math.max(0, Number(e.target.value)))} />
                </Field>
              </div>
              <FieldDescription>{startIn > 0 ? t("dialogs.starts_later_desc") : t("dialogs.starts_now_desc")} {duration === 0 && t("dialogs.no_end_desc")}</FieldDescription>
            </FieldGroup>
            <ErrorNote error={create.error} />
            <DialogFooter className="mt-auto">
              {meta.area && <Button type="button" variant="ghost" className="mr-auto" onClick={randomize}><Dices /> {t("dialogs.random_btn")}</Button>}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={create.isPending || (meta.area && !center) || (kind === "message" && !text.trim())}>
                {kind === "message" ? t("dialogs.send_btn") : startIn > 0 ? t("dialogs.forecast_btn") : t("dialogs.raise_btn")}
              </Button>
            </DialogFooter>
          </div>

          {meta.area && (zone ? (
            <ZoneLeafletMap zone={zone} hm={hm.data} className="h-[70vh] min-h-[420px] rounded-xl border"
              onPick={(lat, lon) => { if (inZone(zone, lat, lon)) setCenter([lat, lon]); }}>
              {zoneCrews.map((c) => {
                const h = crewHome(c, zone);
                return h && <Marker key={c.id} position={h} icon={pin(`${DOT} bg-landing`, "", 14)}><Tooltip direction="top" offset={[0, -8]} permanent>{c.name}</Tooltip></Marker>;
              })}
              {center && <Circle center={center} radius={radius} pathOptions={{ color: LEVEL_COLOR[level], fillColor: LEVEL_COLOR[level], fillOpacity: 0.25, weight: 2 }} />}
            </ZoneLeafletMap>
          ) : <div className="grid h-[70vh] place-items-center text-sm text-muted-foreground">{t("ship.loading_map")}</div>)}
        </form>
      </DialogContent>
    </Dialog>
  );
}
