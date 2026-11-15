// What the events mean for a crew: its alerts, whether an anomaly lies across its route, whether an
// EVA is safe to start now and when the next safe window opens. All derived on each client from the
// same `events` rows and the same clock, so nothing extra is written and the three apps agree.
import { alongs } from "../astro/checkpoints";
import { distanceM, fmtDur, fmtKm } from "./geo";
import { conditions, doseOver, eventLabel, fmtLmst, isActive, touchesZone } from "./mars";
import { EVENT_KINDS, LEVEL_RANK, type Crew, type Level, type MarsEvent, type Route, type WorkPlan } from "./types";
import type { Zone } from "./zones";

/** minutes at the target, on top of walking there and back */
export const WORK_MIN = 60;
/** the dose one EVA may add, mSv */
export const DOSE_LIMIT = 1;
/** how far ahead alerts announce what is coming */
const FORECAST_MS = 12 * 3600_000;
/** keep this far outside an anomaly's edge, m */
const MARGIN = 60;

export const hasArea = (e: MarsEvent) => EVENT_KINDS[e.kind].area && e.lat != null && e.lon != null && e.radius_m != null;
const overlaps = (e: MarsEvent, t0: number, t1: number) => Date.parse(e.starts_at) < t1 && (!e.ends_at || Date.parse(e.ends_at) > t0);
const startsIn = (e: MarsEvent, t: number) => fmtDur(Math.max(0, Date.parse(e.starts_at) - t) / 60_000);

/** anomalies with an area in this zone that matter at some point in [t0, t1] */
export const areaHazards = (events: MarsEvent[], zoneId: string, t0: number, t1 = t0 + 1) =>
  events.filter((e) => hasArea(e) && e.zone === zoneId && overlaps(e, t0, t1));

export interface Avoid { lat: number; lon: number; radius_m: number; block: boolean }

/** for the route search: critical areas are closed, warnings cost a lot more to cross */
export const avoidList = (events: MarsEvent[]): Avoid[] =>
  events.filter((e) => e.level !== "info").map((e) => ({ lat: e.lat!, lon: e.lon!, radius_m: e.radius_m! + MARGIN, block: e.level === "critical" }));

/** metres along the route where it first comes within the anomaly's area (from `fromM` on), or null */
export function routeHit(route: Route, along: number[], e: MarsEvent, fromM = 0): number | null {
  if (!hasArea(e)) return null;
  for (let i = 0; i < route.points.length; i++) {
    if (along[i] < fromM) continue;
    const [lat, lon] = route.points[i];
    if (distanceM(lat, lon, e.lat!, e.lon!) <= e.radius_m! + MARGIN) return along[i];
  }
  return null;
}

export interface Alert {
  id: string;
  level: Level;
  title: string;
  text: string;
  event: MarsEvent;
  /** a message to this crew: the ship confirms it */
  ackable: boolean;
}

/** everything a crew should know about now: messages, anomalies around it, what is coming */
export function crewAlerts(crew: Crew, zone: Zone | undefined, plan: WorkPlan | null | undefined, events: MarsEvent[], now: number, at?: [number, number] | null): Alert[] {
  const out: Alert[] = [];
  const route = plan?.status === "in_progress" ? plan.route : null;
  const along = route ? alongs(route) : [];
  for (const e of events) {
    if (e.kind === "message") {
      if ((e.crew_id && e.crew_id !== crew.id) || e.acked_at || !isActive(e, now)) continue;
      const from = e.source === "ship" ? "Ship" : "Mission control";
      out.push({ id: e.id, level: e.level, title: `${from}${e.title ? `: ${e.title}` : ""}`, text: e.text, event: e, ackable: !!e.crew_id });
      continue;
    }
    if (!touchesZone(e, crew.zone)) continue;
    const label = eventLabel(e);
    if (!isActive(e, now)) {
      const t0 = Date.parse(e.starts_at);
      if (t0 > now && t0 - now < FORECAST_MS) {
        const soon = t0 - now < 2 * 3600_000 && e.level === "critical";
        out.push({ id: e.id, level: soon ? "warning" : "info", title: `Forecast: ${label} in ${startsIn(e, now)}`, text: e.text, event: e, ackable: false });
      }
      continue;
    }
    if (!hasArea(e)) { out.push({ id: e.id, level: e.level, title: label, text: e.text, event: e, ackable: false }); continue; }
    const hit = route ? routeHit(route, along, e, plan?.progress_m ?? 0) : null;
    if (hit != null) {
      const ahead = Math.max(0, hit - (plan?.progress_m ?? 0));
      out.push({ id: e.id, level: e.level === "info" ? "warning" : "critical", title: `${label} on the route`, text: `${ahead < 30 ? "You are in it" : `${fmtKm(ahead)} ahead`}. ${e.text}`, event: e, ackable: false });
    } else {
      const ref = at ?? (zone ? [zone.base.lat, zone.base.lon] as [number, number] : null);
      const away = ref ? Math.max(0, distanceM(ref[0], ref[1], e.lat!, e.lon!) - e.radius_m!) : null;
      out.push({ id: e.id, level: e.level === "critical" ? "warning" : e.level, title: `${label} in the zone`, text: `${away != null ? `${fmtKm(away)} from you. ` : ""}${e.text}`, event: e, ackable: false });
    }
  }
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.event.starts_at.localeCompare(b.event.starts_at));
}

export interface Issue { level: Level; text: string }
export interface EvaCheck { start: number; end: number; needMin: number; doseMSv: number; issues: Issue[]; level: Level | "ok" }

/** is it safe to walk this route out, work, and walk back, starting at `start` */
export function evaCheck(zone: Zone, route: Route, events: MarsEvent[], start: number, along = alongs(route)): EvaCheck {
  const needMin = Math.round(route.duration_min * 2 + WORK_MIN);
  const end = start + needMin * 60_000;
  const issues: Issue[] = [];
  for (const e of events) {
    if (!touchesZone(e, zone.id) || !overlaps(e, start, end)) continue;
    const when = isActive(e, start) ? "now" : `in ${startsIn(e, start)}`;
    if (hasArea(e)) {
      if (routeHit(route, along, e) == null) continue;
      issues.push({ level: e.level === "info" ? "warning" : e.level, text: `${eventLabel(e)} over the route (${when})` });
    } else issues.push({ level: e.level, text: `${eventLabel(e)} (${when})` });
  }
  const c0 = conditions(zone, start, events), c1 = conditions(zone, end, events);
  if (!c0.daylight || !c1.daylight || needMin > 12 * 60) {
    issues.push({ level: "warning", text: `Not all in daylight: LMST ${fmtLmst(c0.time.lmst)} to ${fmtLmst(c1.time.lmst)}` });
  }
  const doseMSv = doseOver(zone, start, end, events);
  if (doseMSv > DOSE_LIMIT) issues.push({ level: "critical", text: `Expected dose ${doseMSv.toFixed(2)} mSv, over the ${DOSE_LIMIT} mSv EVA limit` });
  else if (doseMSv > DOSE_LIMIT / 2) issues.push({ level: "warning", text: `Expected dose ${doseMSv.toFixed(2)} mSv, over half the EVA limit` });
  issues.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const level = issues.length ? issues[0].level : "ok";
  return { start, end, needMin, doseMSv, issues, level };
}

export type Slot = { t: number; level: Level | "ok" | "night" };

/**
 * The next `hours` in `stepMin` slots, each coloured by what is going on then (night, an anomaly over
 * the route or in the zone, a solar event); with a route, also the first start time from which the
 * whole EVA fits with no warnings.
 */
export function outlook(zone: Zone, route: Route | null, events: MarsEvent[], from: number, hours = 24, stepMin = 15) {
  const along = route ? alongs(route) : [];
  const slots: Slot[] = [];
  let next: number | null = null;
  for (let t = from; t < from + hours * 3600_000; t += stepMin * 60_000) {
    let level: Slot["level"] = conditions(zone, t, events).daylight ? "ok" : "night";
    for (const e of events) {
      if (!touchesZone(e, zone.id) || !isActive(e, t)) continue;
      const l: Level = hasArea(e) ? (route ? (routeHit(route, along, e) != null ? e.level : "info") : "info") : e.level;
      if (l !== "info" && (level === "ok" || level === "night" || LEVEL_RANK[l] > LEVEL_RANK[level])) level = l;
    }
    slots.push({ t, level });
    if (route && next == null && level === "ok" && evaCheck(zone, route, events, t, along).level === "ok") next = t;
  }
  return { slots, next };
}
