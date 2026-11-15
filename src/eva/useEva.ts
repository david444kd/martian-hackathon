// The EVA's mission logic, everything that is not drawing: where the astronaut starts, how far along
// the route they are, the alerts (with alarm, radio tones and voice), the automatic recall to base
// when a hazard reaches the route, and the telemetry sent every 2.5 s to mission control and the ship.
import { useEffect, useMemo, useRef, useState } from "react";
import { wind } from "./wind";
import { clearOf, HAB_OFFSET, outpostSolids } from "./layout";
import { ears } from "./ears";
import { DRY_RUN } from "./xrPreview";
import { addUse, legUse, paceOf, routeUse, slopeDegOf, type Use } from "../lib/consumables";
import type { Crew, Level, MarsEvent, Route, WorkPlan } from "../lib/types";
import { isReturn } from "../lib/types";
import type { Heightmap, Zone } from "../lib/zones";
import { areaHazards, avoidList, crewAlerts, routeHit, type Alert } from "../lib/hazards";
import { alongs } from "../astro/checkpoints";
import { distanceM } from "../lib/geo";
import { conditions, eventLabel, isActive, touchesZone, type Conditions } from "../lib/mars";
import { db } from "../lib/db";
import { useUpdateEvent, useUpdatePlan } from "../lib/queries";
import { publishTelemetry, telemetryTable, useTelemetry } from "../lib/telemetry";
import { returnRoute } from "../lib/recall";
import { generateRoute } from "../lib/routing";
import { areoid, bearingOf, dist2, pointAlong, polyline, project, toLatLon, toLocal, type P2, type Polyline } from "./frame";
import type { EvaRuntime } from "./runtime";
import type { SuitAudio } from "./audio";
import { SuitModel } from "./suit";
import i18n from "../i18n";

export const REPORT_MS = 2500;
/** a hazard this close to the astronaut (beyond its edge) triggers the recall even off the route */
const RECALL_NEAR_M = 400;
/** arrival radius at the target / the base */
const ARRIVE_M = 15;
const OFF_ROUTE_M = 40;
/** off the route by more than this for REROUTE_AFTER_MS: a new route from where the astronaut is */
const REROUTE_M = 60;
const REROUTE_AFTER_MS = 4000;
const REROUTE_GAP_MS = 20_000;

export type Mode = "standby" | "out" | "return" | "complete";
export type RecallState = { state: "idle" | "computing" | "sent" | "failed"; reason: string; error?: string };

export interface EvaView {
  mode: Mode;
  plan: WorkPlan | null;
  route: Route | null;
  line: Polyline | null;
  progress: number;
  offRoute: number;
  left: number;            // m of route still to walk
  etaMin: number;
  guide: { bearing: number; dist: number } | null;   // where to walk now (a point ~25 m ahead on the route)
  toEnd: number | null;    // straight-line m to the route's end (target, or base when returning)
  toBase: number;
  bearingBase: number;
  bearingEnd: number | null;
  at: [number, number];
  elev: number;
  alerts: Alert[];
  top: Alert | null;       // the most important not yet acknowledged
  recall: RecallState;
  storm: number;           // 0..1: dust around the astronaut
  cond: Conditions | null;
  arrived: boolean;
  link: { lastSent: number; table: boolean | null };
  suit: SuitModel["s"];
  hazards: MarsEvent[];    // area anomalies active in the zone
  rerouting: boolean;      // off the route: a new one is being made
  /** a short notice for the display, for a dozen seconds: a new route from the ship, a reroute, a failed one */
  notice: Notice | null;
  /** still to climb and to descend on the rest of the route, m, and the slope of the next stretch, degrees (+ uphill) */
  climbLeft: number;
  descentLeft: number;
  slopeAhead: number;
}
export interface Notice { text: string; level: Level; from: "ship" | "suit"; at: number }
const NOTICE_MS = 12_000;

interface Args {
  crew: Crew | undefined; zone: Zone | undefined; hm: Heightmap | undefined; home: [number, number] | null;
  plan: WorkPlan | null; evs: MarsEvent[]; now: number; rt: EvaRuntime; audio: SuitAudio; suit: SuitModel;
  /** a route to look at the navigation with, when there is no plan: kept in this helmet, nothing is written (xrPreview ?simroute) */
  previewRoute?: Route | null;
}

export function useEva({ crew, zone, hm, home, plan, evs, now, rt, audio, suit, previewRoute = null }: Args): EvaApi | null {
  // with no EVA running, a hazard reaching the astronaut still sends them home: a route kept only in this helmet
  const [localRoute, setLocalRoute] = useState<Route | null>(null);
  const route = plan?.route ?? localRoute ?? previewRoute;
  const stamp = route?.generated_at;
  const tele = useTelemetry(crew?.id);
  const realPlan = useUpdatePlan(), realEvent = useUpdateEvent();
  // ?dry: every write this helmet would make is dropped (xrPreview.ts)
  const dropped = useMemo(() => ({ mutate: () => {}, mutateAsync: async () => undefined as never }), []);
  const updatePlan = DRY_RUN ? (dropped as unknown as typeof realPlan) : realPlan, updateEvent = DRY_RUN ? (dropped as unknown as typeof realEvent) : realEvent;

  // the route in the local frame
  // the route in the local frame, bent round the outpost's buildings where it runs through them
  const line = useMemo(() => (hm && route ? polyline(clearOf(route.points.map(([la, lo]) => toLocal(hm, la, lo)), home ? outpostSolids(toLocal(hm, home[0], home[1])) : [])) : null), [hm, route, home]);
  const geoAlong = useMemo(() => (route ? alongs(route) : []), [route]);
  // metres climbed and descended up to each route point (the DTM heights the planner stored with the route)
  const relief = useMemo(() => {
    const up = [0], down = [0];
    if (route) for (let i = 1; i < route.points.length; i++) {
      const dh = route.points[i][2] - route.points[i - 1][2];
      up.push(up[i - 1] + Math.max(0, dh)); down.push(down[i - 1] + Math.max(0, -dh));
    }
    return { up, down };
  }, [route]);
  useEffect(() => { rt.line = line; }, [rt, line]);

  // ---- spawn once: where the last report says, else on the route at the reported progress, else at base
  useEffect(() => {
    if (!hm || !home || rt.placed || !crew) return;
    let p: P2, heading: number | undefined;
    const t = tele?.t;
    const atBase = new URLSearchParams(location.search).get("spawn") === "base"; // ?spawn=base: start at the airlock
    if (atBase) { p = toLocal(hm, home[0], home[1]); heading = 20; } // facing the airlock
    else if (t && (!plan || t.plan_id === plan.id) && Date.now() - Date.parse(t.updated_at) < 6 * 3600_000) {
      p = toLocal(hm, t.lat, t.lon); heading = t.heading_deg ?? undefined;
    } else if (line && plan) {
      const at = pointAlong(line, plan.progress_m ?? 0);
      p = at.p; heading = bearingOf(at.dir.x, at.dir.z);
    } else p = toLocal(hm, home[0], home[1]);
    if (heading == null && line) { const d = pointAlong(line, 0).dir; heading = bearingOf(d.x, d.z); }
    rt.teleportTo = { ...p, heading };
    rt.placed = true;
  }, [hm, home, crew, plan, line, tele, rt]);

  // a fresh EVA (a newly started plan) gets fresh consumables
  const startedAt = plan?.started_at;
  const lastStart = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastStart.current !== undefined && startedAt && startedAt !== lastStart.current) suit.reset();
    lastStart.current = startedAt ?? null;
  }, [startedAt, suit]);

  // ---- sample the pose a few times a second
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 250); return () => clearInterval(id); }, []);

  const [acked, setAcked] = useState<Set<string>>(() => new Set());
  const [recall, setRecall] = useState<RecallState>({ state: "idle", reason: "" });
  const [rerouting, setRerouting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const note = (text: string, level: Level, from: Notice["from"]) => setNotice({ text, level, from, at: Date.now() });
  const tried = useRef(new Set<string>());
  const reachedTarget = useRef(false);
  const lastSent = useRef(0);

  const view = useMemo((): EvaView | null => {
    if (!hm || !zone || !crew || !home || !rt.placed) return null;
    const p = rt.pose, here = { x: p.x, z: p.z };
    const at = toLatLon(hm, p.x, p.z);
    const pr = line ? project(line, here) : null;
    const progress = pr ? pr.along : 0;
    const left = line ? Math.max(0, line.length - progress) : 0;
    const homeL = toLocal(hm, home[0], home[1]);
    const end = line ? line.pts[line.pts.length - 1] : null;
    const toEnd = end ? dist2(here, end) : null;
    const ret = isReturn(route);
    const arrived = !!line && (toEnd ?? Infinity) < ARRIVE_M;
    let guide: EvaView["guide"] = null;
    if (line && !arrived) {
      // aim at a point 25 m further along the route than where we are, or back onto it when far off
      const ahead = pointAlong(line, progress + Math.max(25, Math.min(80, (pr?.off ?? 0) * 0.5))).p;
      const g = pr && pr.off > OFF_ROUTE_M ? pr.at : ahead;
      guide = { bearing: bearingOf(g.x - here.x, g.z - here.z), dist: dist2(here, g) };
    }
    const hazards = areaHazards(evs, zone.id, now);
    const planNow = plan ? { ...plan, progress_m: progress } : null;
    const alerts = crewAlerts(crew, zone, planNow, evs, now, at);
    const top = alerts.find((a) => !acked.has(alertKey(a)) && a.level !== "info") ?? alerts.find((a) => !acked.has(alertKey(a)) && a.event.kind === "message") ?? null;
    const storm = stormAt(hm, hazards, here, conditions(zone, now, evs).tau);
    const mode: Mode = !route ? "standby" : ret ? (arrived ? "complete" : "return") : "out";
    const pace = route && route.distance_m > 0 ? route.duration_min / route.distance_m : 0;
    // the relief still ahead on the route
    let climbLeft = 0, descentLeft = 0, slopeAhead = 0;
    if (route && route.points.length > 1) {
      const n = route.points.length;
      let i = 1;
      while (i < n - 1 && geoAlong[i] <= progress) i++;
      const seg = geoAlong[i] - geoAlong[i - 1] || 1, f = Math.min(1, Math.max(0, (progress - geoAlong[i - 1]) / seg)), dh = route.points[i][2] - route.points[i - 1][2];
      climbLeft = relief.up[n - 1] - relief.up[i] + Math.max(0, dh) * (1 - f);
      descentLeft = relief.down[n - 1] - relief.down[i] + Math.max(0, -dh) * (1 - f);
      slopeAhead = slopeDegOf(seg, dh);
    }
    return {
      mode, plan, route, line, progress, offRoute: pr?.off ?? 0, left, etaMin: left * pace, guide,
      toEnd, toBase: dist2(here, homeL), bearingBase: bearingOf(homeL.x - here.x, homeL.z - here.z),
      bearingEnd: end ? bearingOf(end.x - here.x, end.z - here.z) : null,
      at, elev: areoid(hm, p.x, p.z), alerts, top, recall, storm, cond: conditions(zone, now, evs), arrived,
      link: { lastSent: lastSent.current, table: telemetryTable() }, suit: { ...suit.s }, hazards, rerouting,
      notice: notice && Date.now() - notice.at < NOTICE_MS ? notice : null, climbLeft, descentLeft, slopeAhead,
    };
  }, [tick, hm, zone, crew, home, line, route, plan, evs, now, acked, recall, rt, suit, notice, geoAlong, relief]); // eslint-disable-line react-hooks/exhaustive-deps

  // what can be heard from where: the end of the route while walking to it, and the habitat
  const beaconKey = view && view.line && !view.arrived && (view.mode === "out" || view.mode === "return") ? view.line : null;
  useEffect(() => {
    ears.beacon = beaconKey ? beaconKey.pts[beaconKey.pts.length - 1] : null;
    if (hm && home) { const h = toLocal(hm, home[0], home[1]); ears.base = { x: h.x, z: h.z + HAB_OFFSET }; }
    return () => { ears.beacon = null; };
  }, [beaconKey, hm, home]);

  // closed areas for the Player (critical anomalies: may be left, not entered)
  useEffect(() => {
    if (!hm || !view) return;
    rt.closed = view.hazards.filter((e) => e.level === "critical").map((e) => ({ ...toLocal(hm, e.lat!, e.lon!), r: e.radius_m! }));
    rt.progress = view.progress;
  }, [hm, view, rt]);

  // ---- suit model, 2 Hz
  const viewRef = useRef(view);
  viewRef.current = view;
  const geoRef = useRef(geoAlong);
  geoRef.current = geoAlong;
  useEffect(() => {
    let last = performance.now(), lastY = rt.pose.y, lastPos = { x: rt.pose.x, z: rt.pose.z }, was = rt.placed, low = 0, charging = false, tired = 0;
    /** what the way back to the airlock is expected to use from here */
    const wayBack = (v: EvaView): Use => {
      const r = v.route, along = geoRef.current;
      const env = { storm: v.storm, tempC: v.cond?.tempC, fatigue: suit.s.fatigue };
      if (!r || along.length !== r.points.length) return legUse(v.toBase * 1.3, 0, env);
      if (v.mode === "return" || v.mode === "complete") return routeUse(r.points, along, v.progress, false, env);
      // outbound: the rest of the way out, then the same line back, as tired as the way out leaves you
      const out = v.arrived ? null : routeUse(r.points, along, v.progress, false, env);
      const back = routeUse(r.points, along, 0, true, { ...env, fatigue: out ? out.fatigue : env.fatigue });
      return out ? addUse(out, back) : back;
    };
    const id = setInterval(() => {
      const v = viewRef.current, t = performance.now(), dt = (t - last) / 1000;
      last = t;
      let moved = Math.hypot(rt.pose.x - lastPos.x, rt.pose.z - lastPos.z), rise = rt.pose.y - lastY;
      if (!was || moved > 40) { moved = 0; rise = 0; } // being placed at the start is not a walk
      was = rt.placed; lastY = rt.pose.y; lastPos = { x: rt.pose.x, z: rt.pose.z };
      const alarm = v?.top && v.top.level !== "info" ? 1 : v?.mode === "return" ? 0.6 : 0;
      // at the airlock with no walk under way: the suit is topped up
      const s = suit.s, home = !!v && v.toBase < 15 && (v.mode === "standby" || v.mode === "complete");
      if (home && Math.min(s.o2Pct, s.batteryPct, s.waterPct) < 99.5) {
        suit.recharge(dt);
        if (!charging) { charging = true; note(i18n.t("evahud.hud_recharging"), "info", "suit"); }
      } else charging = false;
      suit.step(dt, moved, rise, v?.cond?.doseUSvH ?? 25, alarm, v?.storm ?? 0, v ? wayBack(v) : null, v?.cond?.tempC ?? -60);
      // not enough left for the way back: say so once as it gets low, once more when it is nearly gone
      const level = home || !v ? 0 : s.reservePct < 10 ? 2 : s.reservePct < 25 ? 1 : 0;
      if (level > low) {
        note(i18n.t("evahud.hud_reserve_low", { pct: Math.round(s.reservePct) }), level === 2 ? "critical" : "warning", "suit");
        audio.alarm(level === 2 ? "critical" : "warning");
      }
      low = level;
      // tiredness: the pace drops with it; a notice when a rest is due, and when there is nothing left the autopilot stops to rest
      rt.pace = paceOf(s.fatigue);
      const weary = s.fatigue >= 0.98 ? 2 : s.fatigue >= 0.7 ? 1 : s.fatigue < 0.55 ? 0 : Math.min(tired, 1);
      if (weary > tired) {
        note(weary === 2 ? i18n.t("evahud.hud_exhausted") : i18n.t("evahud.hud_tired", { pct: Math.round(s.fatigue * 100) }), weary === 2 ? "critical" : "warning", "suit");
        audio.alarm(weary === 2 ? "critical" : "warning");
        rt.buzz++;
        if (weary === 2 && rt.autopilot) { rt.autopilot = false; rt.notify(); }
      }
      tired = weary;
      audio.update(suit.s.resp, suit.s.exertion, rt.pose.moving, rt.pose.speed, wind.storm, suit.s.pulse);
    }, 500);
    return () => clearInterval(id);
  }, [rt, suit, audio]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- announcements: a tone by level, radio tones for calls, then the text read out
  const heard = useRef<Set<string> | null>(null);
  const alerts = view?.alerts;
  useEffect(() => {
    if (!alerts) return;
    const loud = alerts.filter((a) => a.level !== "info" || a.event.kind === "message");
    if (!heard.current) { heard.current = new Set(loud.map(alertKey)); return; } // already there on load: shown, not announced
    const fresh = loud.filter((a) => !heard.current!.has(alertKey(a)));
    fresh.forEach((a) => heard.current!.add(alertKey(a)));
    if (!fresh.length) return;
    const worst = fresh.some((a) => a.level === "critical") ? "critical" : fresh.some((a) => a.level === "warning") ? "warning" : "info";
    const call = fresh.some((a) => a.event.kind === "message");
    rt.buzz++;
    if (call) audio.radio();
    audio.alarm(worst);
    setTimeout(() => {
      const one = fresh.length === 1 && fresh[0].event.kind !== "message" ? fresh[0] : null;
      if (one) audio.line(calloutKey(one), callout(one), worst === "critical");
      else audio.say(fresh.slice(0, 2).map(callout).join(" "), worst === "critical");
    }, call ? 700 : 1300);
  }, [alerts, audio]);

  // the alert tone comes back for an unacknowledged critical alert (every 12 s, up to 3 times)
  const topKey = view?.top ? alertKey(view.top) : null, topLevel = view?.top?.level;
  useEffect(() => {
    if (!topKey || topLevel !== "critical") return;
    let n = 0;
    const id = setInterval(() => { if (++n > 3) clearInterval(id); else audio.alarm("critical"); }, 12_000);
    return () => clearInterval(id);
  }, [topKey, topLevel, audio]);

  // ---- automatic recall: a hazard on the rest of the route or close to the astronaut
  const recallTrigger = useMemo(() => {
    if (!view || !plan || !route || plan.status !== "in_progress" || isReturn(route) || !zone) return null;
    return recallCause(evs, zone.id, now, route, geoAlong, view.progress, view.at);
  }, [view?.progress, view?.at[0], view?.at[1], plan, route, evs, now, zone, geoAlong]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recallTrigger || !plan || !hm || !home || !zone || !view) return;
    const key = `${plan.id}:${stamp}:${recallTrigger.id}`;
    if (tried.current.has(key)) return;
    tried.current.add(key);
    const reason = eventLabel(recallTrigger);
    setRecall({ state: "computing", reason });
    audio.alarm("critical");
    setTimeout(() => audio.line(`abort-${recallTrigger.kind}`, say("abort_ahead", { hazard: short(recallTrigger) }), true), 1900);
    const avoid = avoidList(areaHazards(evs, zone.id, now, now + 6 * 3600_000));
    returnRoute(hm, view.at, home, avoid, reason)
      .then((r) => updatePlan.mutateAsync({ id: plan.id, patch: { route: r, progress_m: 0 } }).then(() => r))
      .then((r) => {
        setRecall({ state: "sent", reason });
        setTimeout(() => audio.line("route-home", say("route_home", { dist: spokenDist(r.distance_m) })), 600);
      })
      .catch((e: unknown) => {
        setRecall({ state: "failed", reason, error: e instanceof Error ? e.message : String(e) });
        audio.alarm("critical");
        audio.line("no-way", say("no_way"), true);
      });
  }, [recallTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // a manual recall from the ship (a return route arrives that we didn't make): announce it
  const lastStamp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastStamp.current !== undefined && stamp && stamp !== lastStamp.current) {
      if (isReturn(route)) {
        if (recall.state !== "sent" && recall.state !== "computing") {
          setRecall({ state: "sent", reason: route?.reason ?? i18n.t("evahud.recall") });
          audio.radio(); audio.alarm("critical");
          setTimeout(() => audio.line("recall-ship", say("recall_ship"), true), 800);
        }
      } else {
        setRecall({ state: "idle", reason: "" });
        audio.radio();
        note(say("new_route"), "info", "ship");
        setTimeout(() => audio.line("new-route", say("new_route")), 700);
      }
    }
    if (!isReturn(route) && recall.state === "sent") setRecall({ state: "idle", reason: "" });
    lastStamp.current = stamp;
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- no EVA running (standby): a storm or rockfall reaching the astronaut raises the same alarm and
  // gives a way back to base, shown in this helmet only (there is no plan to store it in)
  useEffect(() => {
    if (plan) { if (localRoute) setLocalRoute(null); return; }
    const v = viewRef.current;
    if (!v || localRoute || !hm || !zone || !home || v.toBase < 40) return;
    const near = areaHazards(evs, zone.id, now).find((e) => e.level !== "info" && distanceM(v.at[0], v.at[1], e.lat!, e.lon!) <= e.radius_m! + RECALL_NEAR_M);
    if (!near || tried.current.has(`standby:${near.id}`)) return;
    tried.current.add(`standby:${near.id}`);
    const reason = eventLabel(near);
    setRecall({ state: "computing", reason });
    audio.alarm("critical");
    setTimeout(() => audio.line(`abort-${near.kind}`, say("abort_near", { hazard: short(near) }), true), 1900);
    returnRoute(hm, v.at, home, avoidList(areaHazards(evs, zone.id, now, now + 6 * 3600_000)), reason)
      .then((r) => { setRecall({ state: "sent", reason }); setLocalRoute(r); })
      .catch((e: unknown) => setRecall({ state: "failed", reason, error: e instanceof Error ? e.message : String(e) }));
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- arrival
  const arrived = view?.arrived ?? false, mode = view?.mode;
  useEffect(() => {
    if (arrived && !plan && mode === "complete") {
      audio.alarm("info");
      audio.line("airlock", say("airlock"));
      const id = setTimeout(() => { setLocalRoute(null); setRecall({ state: "idle", reason: "" }); }, 8000);
      return () => clearTimeout(id);
    }
    if (!arrived || !plan) return;
    if (mode === "out" && !reachedTarget.current) {
      reachedTarget.current = true;
      audio.alarm("info");
      audio.line("on-target", say("on_target"));
    }
    if (mode === "complete" && plan.status === "in_progress") {
      audio.alarm("info");
      audio.line("airlock", say("airlock"));
      // recalled before reaching the target: the plan goes back to the ship to be done again
      updatePlan.mutate({ id: plan.id, patch: { status: reachedTarget.current ? "done" : "assigned" } });
    }
  }, [arrived, mode, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reachedTarget.current = false; }, [plan?.id]);

  // ---- off the route: after a few seconds well away from it, a new route from here to the same end
  // (the target, or the base when returning), around the anomalies. Ship and mission control get it too.
  // Only after the astronaut has been on this route: a route that starts somewhere else (the ship chose
  // the start point) just guides them to its line first, it is not replaced.
  const offSince = useRef<number | null>(null), lastReroute = useRef(0), onLine = useRef<string | undefined>(undefined);
  useEffect(() => {
    const v = viewRef.current;
    if (v && stamp && v.offRoute < OFF_ROUTE_M) onLine.current = stamp;
    if (!v || !plan || !route || !hm || !zone || !home || plan.status !== "in_progress" || v.arrived || rerouting || onLine.current !== stamp
      || recall.state === "computing" || (v.mode !== "out" && v.mode !== "return")) { offSince.current = null; return; }
    if (v.offRoute < REROUTE_M) { offSince.current = null; return; }
    const t = Date.now();
    offSince.current ??= t;
    if (t - offSince.current < REROUTE_AFTER_MS || t - lastReroute.current < REROUTE_GAP_MS) return;
    lastReroute.current = t; offSince.current = null;
    setRerouting(true);
    note(say("off_route"), "warning", "suit");
    audio.line("off-route", say("off_route"));
    const avoid = avoidList(areaHazards(evs, zone.id, now, now + 6 * 3600_000));
    const back = isReturn(route);
    const make = back
      ? returnRoute(hm, v.at, home, avoid, route.reason ?? i18n.t("evahud.recall"))
      : generateRoute(hm, v.at, [plan.target_lat, plan.target_lon], avoid).then((r): Route => ({
        ...r, start: { lat: v.at[0], lon: v.at[1], name: i18n.t("evahud.rerouted_off_route") }, target: { lat: plan.target_lat, lon: plan.target_lon },
        generated_at: new Date().toISOString(), mode: route.mode,
      }));
    make
      .then((r) => updatePlan.mutateAsync({ id: plan.id, patch: { route: r, progress_m: 0 } }))
      .then(() => { if (back) { note(say("route_home_updated"), "info", "suit"); audio.line("route-home-updated", say("route_home_updated")); } })
      .catch(() => { note(say("no_reroute"), "warning", "suit"); audio.line("no-reroute", say("no_reroute")); })
      .finally(() => setRerouting(false));
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- telemetry every 2.5 s: the live position for mission control and the ship, and the progress
  useEffect(() => {
    if (!crew || !hm) return;
    let lastProgress = -1;
    const id = setInterval(() => {
      const v = viewRef.current;
      if (!v || !rt.placed || DRY_RUN) return;
      const p = rt.pose;
      lastSent.current = Date.now();
      void publishTelemetry({
        crew_id: crew.id, plan_id: v.plan?.id ?? null, lat: v.at[0], lon: v.at[1], elev_m: Math.round(v.elev * 10) / 10,
        heading_deg: Math.round(p.heading), speed_ms: Math.round(p.speed * 100) / 100,
        progress_m: v.route ? Math.round(v.progress) : null, off_route_m: v.route ? Math.round(v.offRoute) : null,
        mode: v.mode, o2_pct: round1(suit.s.o2Pct), pulse_bpm: Math.round(suit.s.pulse), co2_mmhg: round1(suit.s.co2),
        suit_kpa: round1(suit.s.kpa), dose_usv: round1(suit.s.doseUSv), updated_at: new Date().toISOString(),
      });
      if (v.plan && v.route && v.plan.status === "in_progress") {
        const m = Math.round(v.progress);
        if (Math.abs(m - lastProgress) >= 1) { lastProgress = m; db.reportProgress(v.plan.id, v.route.generated_at, m).catch(() => {}); }
      }
    }, REPORT_MS);
    return () => clearInterval(id);
  }, [crew, hm, rt, suit]);

  // ---- acknowledge (button, Enter, controller A)
  const ack = (a: Alert | null) => {
    if (!a) return;
    setAcked((s) => new Set(s).add(alertKey(a)));
    if (a.ackable && !a.event.acked_at) updateEvent.mutate({ id: a.id, patch: { acked_at: new Date().toISOString() } });
  };
  const ackRef = useRef(ack);
  ackRef.current = ack;
  const lastAck = useRef(0);
  useEffect(() => {
    if (rt.ackPressed !== lastAck.current) { lastAck.current = rt.ackPressed; ackRef.current(viewRef.current?.top ?? null); }
  }, [tick, rt]);

  return view ? Object.assign(view, { ack: () => ack(view.top) }) : null;
}

const alertKey = (a: Alert) => `${a.id}:${a.level}:${a.title}`;

// Voice lines: short, like real radio calls, not read-out paragraphs (the full text stays on the HUD).
// Spoken in the interface language (English by default); the texts are in the `voice` locale section.
const say = (key: string, opts: Record<string, unknown> = {}) => i18n.t(`voice.${key}`, opts) as string;
const SPOKEN = ["dust_storm", "dust_devil", "rockfall", "solar_storm"];
const short = (e: MarsEvent) => say(SPOKEN.includes(e.kind) ? `hazard_${e.kind}` : "hazard_other");
const spokenDist = (m: number) => {
  const km = (m / 1000).toFixed(1);
  return m < 1000 ? say("dist_m", { m: Math.round(m / 10) * 10 }) : say("dist_km", { km: i18n.language === "en" ? km : km.replace(".", ",") });
};
/** the recording name for a hazard callout: public/voice/alert-<kind>-<forecast|route|planet|zone>[-critical].mp3 */
function calloutKey(a: Alert) {
  const e = a.event, where = a.scope === "forecast" ? "forecast" : a.scope === "route" ? "route" : !e.lat ? "planet" : "zone";
  return `alert-${e.kind}-${where}${a.level === "critical" && where !== "zone" && where !== "forecast" ? "-critical" : ""}`;
}
function callout(a: Alert): string {
  const e = a.event;
  if (e.kind === "message") {
    const first = (e.text || e.title).split(/(?<=[.!?])\s/)[0].slice(0, 90);
    return say("message", { from: say(e.source === "ship" ? "from_ship" : "from_control"), text: first });
  }
  if (a.scope === "forecast") return say("forecast", { hazard: short(e).toLowerCase() });
  if (a.scope === "route") return say(a.level === "critical" ? "on_route_critical" : "on_route", { hazard: short(e) });
  if (!e.lat) return say(a.level === "critical" ? "planet_critical" : "planet", { hazard: short(e) });
  return say("near", { hazard: short(e) });
}
const round1 = (v: number) => Math.round(v * 10) / 10;

/** the hazard that makes the astronaut turn back, if any (critical first) */
function recallCause(evs: MarsEvent[], zoneId: string, now: number, route: Route, along: number[], progress: number, at: [number, number]): MarsEvent | null {
  const areas = areaHazards(evs, zoneId, now)
    .filter((e) => e.level !== "info" && (e.kind === "dust_storm" || e.kind === "dust_devil" || e.kind === "rockfall"))
    .filter((e) => routeHit(route, along, e, progress) != null || distanceM(at[0], at[1], e.lat!, e.lon!) <= e.radius_m! + RECALL_NEAR_M);
  const solar = evs.filter((e) => e.kind === "solar_storm" && e.level === "critical" && touchesZone(e, zoneId) && isActive(e, now));
  const all = [...solar, ...areas].sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
  return all[0] ?? null;
}

/** how much dust is in the air where the astronaut stands, 0..1 */
function stormAt(hm: Heightmap, hazards: MarsEvent[], here: P2, tau: number) {
  let s = Math.max(0, Math.min(1, (tau - 1) / 3)) * 0.6;
  for (const e of hazards) {
    if (e.kind !== "dust_storm" && e.kind !== "dust_devil") continue;
    const c = toLocal(hm, e.lat!, e.lon!), d = dist2(here, c), r = e.radius_m!;
    const k = e.kind === "dust_devil" ? 0.7 : 1;
    const v = d <= r ? 1 : d <= r + 1500 ? 1 - (d - r) / 1500 : 0;
    s = Math.max(s, v * k * (e.kind === "dust_storm" ? 1 : 0.8));
  }
  return s;
}

export type EvaApi = EvaView & { ack: () => void };
