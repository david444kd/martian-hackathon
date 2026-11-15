// Developer preview of the headset view on a desktop: open /helmet/:crewId?xrview=1 in a window shaped
// like one Quest 2 eye (e.g. 916 × 960). The camera gets a Quest 2 per-eye field of view (~93° vertical),
// the VR layer (visor rim and the HUD plane 2 m ahead) is shown, the screen HUD hidden, and the VR gloves
// sit where controllers are typically held. Angular sizes match the headset; lens distortion, real hand
// poses, stereo and the device's frame rate do not. Not a substitute for a test on the device.
import type { Heightmap } from "../lib/zones";
import type { MarsEvent } from "../lib/types";
import { toLatLon, toLocal, type P2 } from "./frame";
import type { Alert } from "../lib/hazards";
import type { EvaView } from "./useEva";
import i18n from "../i18n";

export const XR_PREVIEW = typeof location !== "undefined" && new URLSearchParams(location.search).has("xrview");
/** Quest 2 per-eye vertical field of view, degrees (approximate) */
export const QUEST2_FOV_Y = 93;

// Looking at the dust effects without writing an event to the shared database:
//   ?simstorm=<m>  a dust-storm front whose near edge is that far north of the base (negative: the base is inside it)
//   ?simdevil=<m>  a dust devil that far north-east of the base
// Seen in this browser's 3D view only: nothing is stored or sent, nobody is alerted or recalled, the
// maps and the suit display do not show it. Not an anomaly, not a weather observation.

const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const SIM_STORM = q.has("simstorm") ? Number(q.get("simstorm")) || 0 : null, SIM_DEVIL = Number(q.get("simdevil")) || 0;
export const SIMULATED_DUST = SIM_STORM != null || SIM_DEVIL > 0;

export function simulatedDust(hm: Heightmap, home: [number, number]): MarsEvent[] {
  const h = toLocal(hm, home[0], home[1]), out: MarsEvent[] = [];
  const ev = (id: string, kind: MarsEvent["kind"], x: number, z: number, radius_m: number): MarsEvent => {
    const [lat, lon] = toLatLon(hm, x, z);
    return { id, kind, level: "warning", zone: hm.zone.id, crew_id: null, lat, lon, radius_m, starts_at: "", ends_at: null, title: "preview", text: "", source: "system", acked_at: null, created_at: "" };
  };
  if (SIM_STORM != null) out.push(ev("sim-storm", "dust_storm", h.x, h.z - SIM_STORM - 600, 600));
  if (SIM_DEVIL > 0) out.push(ev("sim-devil", "dust_devil", h.x + SIM_DEVIL * 0.7, h.z - SIM_DEVIL * 0.7, 120));
  return out;
}

/** the dust those previews put round a point, 0..1 (the same falloff as the real events, useEva stormAt) */
export function simulatedStormAt(hm: Heightmap, sim: MarsEvent[], here: P2) {
  let s = 0;
  for (const e of sim) {
    const c = toLocal(hm, e.lat!, e.lon!), d = Math.hypot(here.x - c.x, here.z - c.z), r = e.radius_m!;
    s = Math.max(s, (d <= r ? 1 : d <= r + 1500 ? 1 - (d - r) / 1500 : 0) * (e.kind === "dust_storm" ? 1 : 0.56));
  }
  return s;
}

// Looking at the alerts on the visor without writing an event:
//   ?simhud=message   a call from the ship with its text
//   ?simhud=hazard    a dust storm on the route (WARNING), a dust devil in the zone, a forecast
//   ?simhud=recall    the recall while the way back is being worked out
//   ?simhud=many      a call, four hazards and a notice at once
// Drawn on this browser's display only: no sound, no recall, nothing stored or sent.
const SIM_HUD = q.get("simhud");
export const SIMULATED_HUD = !!SIM_HUD;

export function withSimulatedAlerts<T extends EvaView>(v: T, hm: Heightmap, home: [number, number]): T {
  if (!SIM_HUD) return v;
  const h = toLocal(hm, home[0], home[1]), ru = i18n.language === "ru";
  const ev = (id: string, kind: MarsEvent["kind"], level: MarsEvent["level"], dx: number, dz: number, radius_m: number | null, title: string, text: string, source: MarsEvent["source"] = "system"): MarsEvent => {
    const [lat, lon] = radius_m == null ? [null, null] : toLatLon(hm, h.x + dx, h.z + dz);
    return { id, kind, level, zone: hm.zone.id, crew_id: null, lat, lon, radius_m, starts_at: new Date(Date.now() - 95_000).toISOString(), ends_at: null, title, text, source, acked_at: null, created_at: "" };
  };
  const label = (k: string) => i18n.t(`event_kinds.${k}.label`, { defaultValue: k }) as string;
  const storm = ev("simhud-storm", "dust_storm", "critical", 300, -900, 400, "", ru ? "Региональная пыльная буря: видимость менее 1 км." : "Regional dust storm: visibility under 1 km.");
  const devil = ev("simhud-devil", "dust_devil", "warning", -700, 250, 150, "", "");
  const solar = ev("simhud-solar", "solar_storm", "warning", 0, 0, null, "", ru ? "Радиация выше нормы. Сократите выход." : "Radiation above normal. Keep the EVA short.");
  const rock = ev("simhud-rock", "rockfall", "info", 900, 900, 200, "", "");
  const msg = ev("simhud-msg", "message", "info", 0, 0, null, ru ? "Отбор проб" : "Sampling", ru
    ? "Возьмите два керна у подножия уступа, к северу от точки. Фото обнажения до и после. Возвращайтесь до 15:40 по местному времени."
    : "Take two cores at the foot of the scarp, north of the point. Photograph the outcrop before and after. Be back by 15:40 local time.", "ship");
  const alerts: Record<string, Alert> = {
    storm: { id: storm.id, level: "critical", title: i18n.t("hazards.on_route_title", { label: label("dust_storm") }), text: `${i18n.t("hazards.ahead", { dist: "350 m" })} ${storm.text}`, event: storm, ackable: false, scope: "route" },
    devil: { id: devil.id, level: "warning", title: i18n.t("hazards.in_zone_title", { label: label("dust_devil") }), text: "", event: devil, ackable: false, scope: "zone" },
    solar: { id: solar.id, level: "warning", title: label("solar_storm"), text: solar.text, event: solar, ackable: false, scope: "zone" },
    rock: { id: rock.id, level: "info", title: i18n.t("hazards.forecast_in", { label: label("rockfall"), time: "2 h" }), text: "", event: rock, ackable: false, scope: "forecast" },
    msg: { id: msg.id, level: "info", title: `${i18n.t("hazards.from_ship")}: ${msg.title}`, text: msg.text, event: msg, ackable: true, scope: "message" },
  };
  const pick = SIM_HUD === "message" ? [alerts.msg] : SIM_HUD === "many" ? [alerts.storm, alerts.devil, alerts.solar, alerts.msg, alerts.rock] : SIM_HUD === "recall" ? [alerts.storm] : [alerts.storm, alerts.devil, alerts.rock];
  return {
    ...v, alerts: [...pick, ...v.alerts], top: pick[0], hazards: [...v.hazards, ...pick.map((a) => a.event).filter((e) => e.lat != null)],
    recall: SIM_HUD === "recall" ? { state: "computing", reason: label("dust_storm") } : v.recall,
    notice: SIM_HUD === "many" ? { text: i18n.t("voice.new_route") as string, level: "info", from: "ship", at: 0 } : v.notice,
  };
}
