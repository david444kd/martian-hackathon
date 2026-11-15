// The helmet head-up display, as if written on the visor glass: the centre of view stays clear and the
// information sits round the edge of the visor in a few small blocks —
//   top:          heading tape (with a mark where each hazard lies), and under it the alerts: the most
//                 important one framed with what to know about it (where a hazard is, the text of a call
//                 from the ship), the rest as short lines;
//   below centre: the way to the route — only while you are looking away from it or have left it;
//   left / right: suit (consumables, the LIMITING one's time, CO₂, pressure, heart rate, EVA time) and
//                 navigation (target or airlock, bearing, ETA, base, time margin, link to the ship);
//   bottom:       a small heading-up map (left) and the outside conditions (right).
// Each block draws itself in its own small box (HUD_PARTS). On a screen (EvaHud) the boxes are pinned to
// the edges of the visor; in the headset (EvaScene) each is a small patch on a sphere round the eyes,
// facing them, at the angles below — a display only, nothing to press.
// Kept sparse the way helmet displays for EVA are proposed (NASA xEMU/xINFO, NASA SUITS): one phosphor
// colour, amber only for CAUTION, red only for WARNING. Suit/body values are SIMULATED (suit.ts), marked SIM.
import { compass, fmtKm } from "../lib/geo";
import type { Heightmap } from "../lib/zones";
import { drawMap, ROUTE_BACK, ROUTE_OUT } from "./draw";
import { bearingOf, toLocal, type P2 } from "./frame";
import type { Alert } from "../lib/hazards";
import type { Level, MarsEvent } from "../lib/types";
import type { EvaRuntime } from "./runtime";
import type { EvaView } from "./useEva";
import i18n from "../i18n";

const HUD = "rgba(170,248,222,0.95)";        // phosphor green-cyan
const DIM = "rgba(170,248,222,0.62)";
const FAINT = "rgba(170,248,222,0.3)";
const CAUTION = "#ffc24a", WARNING = "#ff6a5c", GOOD = "#9af0ad";
const EDGE = "rgba(0,10,8,0.5)";
const MONO = "ui-monospace, 'Roboto Mono', 'SF Mono', Menlo, Consolas, monospace";

const tr = (key: string, opts: Record<string, unknown> = {}) => i18n.t(key, opts) as string;
const h = (key: string, opts?: Record<string, unknown>) => tr(`evahud.hud_${key}`, opts);

/** text with a faint dark edge so it holds on bright ground */
function txt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = HUD, align: CanvasTextAlign = "left", weight = 500) {
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.textAlign = align;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = EDGE;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function stroke(ctx: CanvasRenderingContext2D, color = HUD, width = 1.5) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = EDGE; ctx.lineWidth = width + 2; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

const hm = (min: number) => (Number.isFinite(min) && min >= 0 ? `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, "0")}` : "--:--");
const deg3 = (d: number) => String(Math.round(((d % 360) + 360) % 360) % 360).padStart(3, "0");
const pctColor = (p: number) => (p < 15 ? WARNING : p < 30 ? CAUTION : HUD);
const routeColorOf = (v: EvaView) => (v.mode === "return" || v.mode === "complete" ? ROUTE_BACK : ROUTE_OUT);

export interface HudData { hm: Heightmap; v: EvaView; rt: EvaRuntime; home: P2; t: number }

export interface HudPart {
  id: "tape" | "message" | "steer" | "suit" | "nav" | "map" | "env";
  /** the block's own box, px at scale 1 */
  w: number; h: number;
  /** headset: where the block sits, degrees from straight ahead (yaw + right, pitch + down) and its roll */
  yaw: number; pitch: number; roll: number;
  /** screen: anchor in the view (fractions of width/height) and which point of the box sits there */
  sx: number; sy: number; ax: number; ay: number;
  draw: (ctx: CanvasRenderingContext2D, d: HudData) => void;
}

/** the blocks round the visor edge */
export const HUD_PARTS: HudPart[] = [
  { id: "tape", w: 400, h: 92, yaw: 0, pitch: -25, roll: 0, sx: 0.5, sy: 0.035, ax: 0.5, ay: 0, draw: headingTape },
  // the alerts: the first line sits ~16.5° above the line of sight, the rest grows down to ~9° and no wider than ±17°
  { id: "message", w: 640, h: 162, yaw: 0, pitch: -13.4, roll: 0, sx: 0.5, sy: 0.145, ax: 0.5, ay: 0, draw: alertsBlock },
  // the way back to the route: ~10° below the line of sight, ±18° wide, empty unless it is needed
  { id: "steer", w: 600, h: 72, yaw: 0, pitch: 10.5, roll: 0, sx: 0.5, sy: 0.66, ax: 0.5, ay: 0, draw: steerCue },
  { id: "suit", w: 200, h: 258, yaw: -31, pitch: -3, roll: 2.5, sx: 0.075, sy: 0.46, ax: 0, ay: 0.5, draw: suitBlock },
  { id: "nav", w: 214, h: 236, yaw: 31, pitch: -3, roll: -2.5, sx: 0.925, sy: 0.46, ax: 1, ay: 0.5, draw: navBlock },
  // the map: nearer the centre than the lens edge (blurry on Quest) and bigger, ~11° across; clear of the steer cue and the suit block
  { id: "map", w: 240, h: 240, yaw: -20, pitch: 16, roll: 3, sx: 0.12, sy: 0.93, ax: 0, ay: 1, draw: mapBlock },
  { id: "env", w: 330, h: 54, yaw: 25, pitch: 23, roll: -5, sx: 0.88, sy: 0.93, ax: 1, ay: 1, draw: envBlock },
];

/** a narrow compass tape: ticks every 10°, labels every 30°, carets for the route and the base */
function headingTape(ctx: CanvasRenderingContext2D, { v, rt, hm: hmap }: HudData) {
  const hd = rt.pose.heading, CX = 200, y = 18, half = 190, px = 4.2; // ±45°
  const routeColor = routeColorOf(v);
  ctx.save();
  ctx.beginPath(); ctx.rect(CX - half, y - 4, half * 2, 40); ctx.clip();
  for (let d = Math.ceil((hd - 50) / 10) * 10; d <= hd + 50; d += 10) {
    const x = CX + (d - hd) * px, n = ((d % 360) + 360) % 360, major = n % 30 === 0;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (major ? 10 : 5)); stroke(ctx, major ? DIM : FAINT, 1.5);
    if (major) txt(ctx, n % 90 === 0 ? compass(n) : String(n / 10), x, y + 28, 15, n % 90 === 0 ? HUD : DIM, "center");
  }
  ctx.restore();
  const caret = (b: number | null | undefined, color: string, square: boolean) => {
    if (b == null) return;
    let d = b - hd; d = ((d + 540) % 360) - 180;
    const x = CX + Math.max(-half, Math.min(half, d * px));
    ctx.beginPath();
    if (square) ctx.rect(x - 4, y - 12, 8, 8);
    else { ctx.moveTo(x, y - 3); ctx.lineTo(x - 6, y - 13); ctx.lineTo(x + 6, y - 13); ctx.closePath(); }
    stroke(ctx, color, 1.5);
  };
  caret(v.bearingBase, "#e9f2ef", true);
  caret(v.guide?.bearing, routeColor, false);
  // where the nearest hazards lie: a diamond on the tape, pinned to its end with an arrow when off it
  const here = rt.pose;
  v.hazards.filter((e) => e.level !== "info").map((e) => ({ e, ...offsetTo(hmap, here, e) })).filter((q) => q.edge > 0)
    .sort((a, b) => a.edge - b.edge).slice(0, 2).forEach((q) => {
      let d = q.brg - hd; d = ((d + 540) % 360) - 180;
      const off = Math.abs(d * px) > half, x = CX + Math.max(-half, Math.min(half, d * px)), c = q.e.level === "critical" ? WARNING : CAUTION;
      ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x + 5, y - 8); ctx.lineTo(x, y - 2); ctx.lineTo(x - 5, y - 8); ctx.closePath();
      ctx.fillStyle = c; ctx.fill(); stroke(ctx, c, 1);
      if (off) txt(ctx, d > 0 ? "▸" : "◂", x + (d > 0 ? 9 : -9), y - 3, 13, c, d > 0 ? "left" : "right");
    });
  ctx.beginPath(); ctx.moveTo(CX, y + 34); ctx.lineTo(CX - 5, y + 41); ctx.lineTo(CX + 5, y + 41); ctx.closePath(); stroke(ctx, HUD, 1.5);
  // the heading, and which way and how far to turn toward the route when it is off to the side
  txt(ctx, deg3(hd), CX, y + 62, 17, HUD, "center");
  if (v.guide) {
    let d = v.guide.bearing - hd; d = ((d + 540) % 360) - 180;
    if (Math.abs(d) >= 8) txt(ctx, d > 0 ? `${Math.round(d)}° ▸` : `◂ ${Math.round(-d)}°`, CX + (d > 0 ? 48 : -48), y + 62, 15, routeColor, d > 0 ? "left" : "right");
  }
}

/** from the astronaut to an anomaly's area: compass bearing to its centre and metres to its edge (≤ 0: inside it) */
function offsetTo(hmap: Heightmap, here: { x: number; z: number }, e: MarsEvent) {
  const c = toLocal(hmap, e.lat!, e.lon!), dx = c.x - here.x, dz = c.z - here.z;
  return { brg: bearingOf(dx, dz), edge: Math.hypot(dx, dz) - (e.radius_m ?? 0) };
}

const levelColor = (l: Level) => (l === "critical" ? WARNING : l === "warning" ? CAUTION : HUD);
const firstSentence = (s: string) => (s || "").split(/(?<=[.!?…])\s/)[0].trim();

/** `s` cut to `max` px with an ellipsis (the font must be set) */
function fit(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  let n = s.length;
  while (n > 1 && ctx.measureText(`${s.slice(0, n).trimEnd()}…`).width > max) n--;
  return `${s.slice(0, n).trimEnd()}…`;
}

/** `s` broken into at most `lines` lines of `max` px, the last one cut with an ellipsis */
function wrap(ctx: CanvasRenderingContext2D, s: string, max: number, lines: number) {
  const out: string[] = [];
  let line = "";
  for (const word of s.replace(/\s+/g, " ").trim().split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  if (out.length > lines) { out.length = lines; out[lines - 1] = fit(ctx, `${out[lines - 1]} …`, max); }
  return out.map((l) => fit(ctx, l, max));
}

// when each alert was first shown here (s): a new one draws the eye for a moment, a call's text folds away after a while
const firstSeen = new Map<string, number>();
function ageOf(key: string) {
  const now = performance.now() / 1000;
  if (!firstSeen.has(key)) { if (firstSeen.size > 80) firstSeen.clear(); firstSeen.set(key, now); }
  return now - firstSeen.get(key)!;
}

interface Entry { key: string; level: Level; title: string; detail: string[]; steady?: boolean; alert?: Alert }

/**
 * The alerts, in the style of a crew alerting list: the most important one on top in a thin frame
 * (red WARNING, amber CAUTION, plain for advisories and calls) with one to three lines of what the
 * astronaut needs — where the hazard is, the text of the call — and under it the others as short
 * lines. Nothing wider than ±17° or lower than ~9° above the line of sight; nothing to press.
 * Order: a recall, then the alert being announced (useEva `top`), a notice from the suit or the ship,
 * the remaining alerts, the suit's own remarks (a refused step, an arrival).
 */
function alertsBlock(ctx: CanvasRenderingContext2D, d: HudData) {
  const { v, rt, t, hm: hmap } = d, CX = 320, MAXW = 560;
  const tag = (l: Level) => (l === "critical" ? h("warning") : l === "warning" ? h("caution") : h("advisory"));
  // which way to look for an anomaly, and how far its edge is
  const where = (e: MarsEvent) => {
    if (e.lat == null || e.lon == null) return null;
    const o = offsetTo(hmap, rt.pose, e);
    if (o.edge <= 0) return tr("hazards.in_it").replace(/[.!]$/, "").toUpperCase();
    let rel = o.brg - rt.pose.heading; rel = ((rel + 540) % 360) - 180;
    const arrow = Math.abs(rel) < 12 ? "▲" : Math.abs(rel) > 150 ? "▼" : rel > 0 ? "▸" : "◂";
    return `${arrow} ${deg3(o.brg)}°  ${fmtKm(o.edge)}`;
  };
  const fromAlert = (a: Alert): Entry => {
    const e = a.event;
    if (e.kind === "message") {
      const who = e.source === "ship" ? h("ship") : tr("hazards.from_dispatch").toUpperCase();
      const mins = Math.floor((Date.now() - Date.parse(e.starts_at)) / 60_000);
      return { key: `${a.id}:${a.level}`, level: a.level, alert: a, detail: [e.text],
        title: `${h("comm")} · ${who}${e.title ? ` · ${e.title.toUpperCase()}` : ""}${mins >= 1 && mins < 600 ? ` · ${mins} ${h("min")}` : ""}` };
    }
    const w = where(e), said = firstSentence(a.text).replace(/[.!]$/, "").toUpperCase();
    // on the route: how far along it (from the alert's own text), then which way; elsewhere: which way and how far
    const detail = a.scope === "route" && w && e.lat != null ? [`${said}  ${w.replace(/\s+\S+\s\S+$/, "")}`] : w ? [w] : said ? [said] : [];
    return { key: `${a.id}:${a.level}`, level: a.level, alert: a, title: `${tag(a.level)}  ${a.title.toUpperCase()}`, detail };
  };

  const list: Entry[] = [];
  if (v.recall.state === "failed") list.push({ key: "recall-failed", level: "critical", title: `${h("warning")}  ${tr("evahud.hold_position")}`, detail: [tr("evahud.no_return_contact_ship").toUpperCase()] });
  else if (v.recall.state === "computing") list.push({ key: "recall-computing", level: "critical", title: `${h("warning")}  ${(v.recall.reason || tr("evahud.recall")).toUpperCase()}`, detail: [tr("evahud.preparing_return").toUpperCase()] });
  else if (v.mode === "return") list.push({ key: "recall", level: "critical", title: `${h("warning")}  ${tr("evahud.return_to_base_upper")}  ${fmtKm(v.left)}`, detail: [(v.recall.reason || v.route?.reason || "").toUpperCase()].filter(Boolean) });
  if (v.top) list.push(fromAlert(v.top));
  if (v.notice) {
    const n = v.notice, who = n.from === "ship" ? `${h("comm")} · ${h("ship")}` : tag(n.level);
    list.push({ key: `notice:${n.at}`, level: n.level, title: `${who}  ${n.text.replace(/[.!]$/, "").toUpperCase()}`, detail: [] });
  }
  for (const a of v.alerts) if (a.id !== v.top?.id) list.push(fromAlert(a));
  if (rt.pose.blocked) list.push({ key: "blocked", level: "warning", title: rt.pose.blocked.toUpperCase(), detail: [], steady: true });
  else if (v.mode === "complete") list.push({ key: "complete", level: "info", title: tr("evahud.airlock_complete").toUpperCase(), detail: [], steady: true });
  else if (v.arrived && v.mode === "out") list.push({ key: "arrived", level: "info", title: tr("evahud.target_reached").toUpperCase(), detail: [], steady: true });
  if (!list.length) return;

  // ---- the first: framed, with its details
  const first = list[0], c = first.steady && first.level === "info" ? GOOD : levelColor(first.level), age = ageOf(first.key);
  let y = 30;
  ctx.font = `600 18px ${MONO}`;
  const title = fit(ctx, first.title, MAXW), tw = ctx.measureText(title).width;
  // the frame flashes while the alert is new, keeps blinking for a WARNING, and is steady otherwise
  const lit = first.steady ? false : age < 1.6 ? Math.sin(age * Math.PI * 4) > -0.2 : first.level !== "critical" || Math.sin(t * 5) >= 0;
  if (lit) { ctx.beginPath(); ctx.rect(CX - tw / 2 - 16, y - 24, tw + 32, 34); stroke(ctx, c, first.level === "info" ? 1 : 1.5); }
  txt(ctx, title, CX, y, 18, c, "center", 600);
  y += 28;
  if (first.alert?.event.kind === "message") {
    // the call itself: readable for a while, then folded to one dim line (it has been read out too)
    ctx.font = `500 17px ${MONO}`;
    const open = age < 25;
    for (const l of wrap(ctx, first.detail[0] ?? "", 520, open ? 3 : 1)) { txt(ctx, l, CX, y, 17, open ? HUD : DIM, "center"); y += 22; }
  } else for (const l of first.detail) {
    ctx.font = `500 15px ${MONO}`;
    txt(ctx, fit(ctx, l, MAXW), CX, y, 15, first.level === "info" ? DIM : c, "center"); y += 22;
  }
  // ---- the others: one short line each, as many as fit
  y += 2;
  const rest = list.slice(1), room = Math.max(0, Math.floor((158 - y) / 20) + 1);
  const shown = rest.slice(0, rest.length > room ? Math.max(0, room - 1) : room);
  ctx.font = `500 15px ${MONO}`;
  for (const e of shown) {
    const fresh = ageOf(e.key) < 8 && !e.steady;
    const mark = e.level === "info" ? "·" : "▲", detail = e.alert && e.alert.event.kind !== "message" ? e.detail[0] : "";
    const line = fit(ctx, `${mark} ${e.title.replace(/^\S+\s{2}/, "")}${detail && detail.length < 22 ? `  ${detail}` : ""}`, MAXW - 40);
    txt(ctx, line, CX, y, 15, e.level === "info" ? (fresh ? HUD : DIM) : levelColor(e.level), "center");
    y += 20;
  }
  if (rest.length > shown.length) txt(ctx, `+${rest.length - shown.length} ${h("more")}`, CX, y, 14, DIM, "center");
}

/**
 * Finding the route again. Nothing is drawn while you face the way the route goes and are on it.
 * Look away by more than 20° and chevrons appear at the side to turn to, running towards it, with how
 * far round it is; leave the route by more than 15 m and they point back to the nearest part of it
 * with the distance (amber beyond 40 m). Facing the route from off it: a mark straight ahead and the distance.
 */
function steerCue(ctx: CanvasRenderingContext2D, { v, rt, t }: HudData) {
  if (!v.guide || (v.mode !== "out" && v.mode !== "return") || v.arrived) return;
  let rel = v.guide.bearing - rt.pose.heading; rel = ((rel + 540) % 360) - 180;
  const off = v.offRoute > 15, away = Math.abs(rel) > 20;
  if (!off && !away) return;
  const c = v.offRoute > 40 ? CAUTION : routeColorOf(v), CX = 300, y = 36;
  const dist = off ? `  ${h("xtk")} ${Math.round(v.offRoute)} m` : "";
  if (!away) {
    // on the right heading, off the line: straight on
    ctx.beginPath(); ctx.moveTo(CX - 14, y - 6); ctx.lineTo(CX, y - 24); ctx.lineTo(CX + 14, y - 6); stroke(ctx, c, 3);
    txt(ctx, dist.trim(), CX, y + 18, 20, c, "center", 600);
    return;
  }
  const dir = rel > 0 ? 1 : -1, behind = Math.abs(rel) > 120, x0 = CX + dir * 284;
  // three chevrons at the edge to turn towards, lighting up one after another outwards (four when it is behind you)
  const n = behind ? 4 : 3, lit = Math.floor(t * 4) % (n + 1);
  for (let k = 0; k < n; k++) {
    const x = x0 - dir * (n - 1 - k) * 22;
    ctx.globalAlpha = k === lit ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(x - dir * 14, y - 20); ctx.lineTo(x, y); ctx.lineTo(x - dir * 14, y + 20); stroke(ctx, c, 3.2);
  }
  ctx.globalAlpha = 1;
  txt(ctx, `${Math.round(Math.abs(rel))}°${dist}`, x0 - dir * (n * 22 + 18), y + 7, 21, c, dir > 0 ? "right" : "left", 600);
}

/** suit status, consumables, the limiting one, CO₂, pressure, heart rate, EVA time */
function suitBlock(ctx: CanvasRenderingContext2D, { v }: HudData) {
  const s = v.suit, x = 10, w = 180;
  let y = 24;
  const statusColor = s.status === "WARNING" ? WARNING : s.status === "CAUTION" ? CAUTION : DIM;
  txt(ctx, `${h("suit")} ${tr(`evahud.status_${s.status.toLowerCase()}`)}`, x, y, 15, statusColor, "left", 600);
  txt(ctx, h("sim"), x + w, y, 13, FAINT, "right");
  for (const [label, pct] of [[h("o2"), s.o2Pct], [h("pwr"), s.batteryPct], [h("h2o"), s.waterPct]] as [string, number][]) {
    y += 28;
    const c = pctColor(pct);
    txt(ctx, label, x, y, 17, c === HUD ? DIM : c);
    txt(ctx, `${pct.toFixed(0)}%`, x + w, y, 19, c, "right", 600);
    ctx.fillStyle = FAINT; ctx.fillRect(x + 58, y - 6, 62, 2);
    ctx.fillStyle = c; ctx.fillRect(x + 58, y - 6, 62 * Math.max(0, Math.min(1, pct / 100)), 2);
  }
  const lim = ([[h("o2"), s.remainingMin], [h("pwr"), s.batteryMin], [h("h2o"), s.waterMin]] as [string, number][]).reduce((a, b) => (b[1] < a[1] ? b : a));
  y += 32;
  txt(ctx, `${h("limit")} ${lim[0]}`, x, y, 15, DIM);
  txt(ctx, hm(lim[1]), x + w, y, 19, lim[1] < 30 ? WARNING : lim[1] < 60 ? CAUTION : HUD, "right", 600);
  y += 26;
  txt(ctx, `${h("co2")} ${s.co2.toFixed(1)}  ${h("press")} ${s.kpa.toFixed(1)}`, x, y, 15, s.co2 > 6 ? CAUTION : DIM);
  y += 22;
  const started = v.plan?.started_at ? Date.parse(v.plan.started_at) : NaN;
  const eva = (v.mode === "out" || v.mode === "return") && Number.isFinite(started) ? hm((Date.now() - started) / 60_000) : "--:--";
  txt(ctx, `${h("hr")} ${s.pulse.toFixed(0)}  ${h("met")} ${eva}`, x, y, 15, DIM);
  // how tired: a hairline gauge that fills as the walk takes it out of you (amber when a rest is due, red when spent)
  y += 22;
  const f = s.fatigue, fc = f >= 0.95 ? WARNING : f >= 0.7 ? CAUTION : DIM;
  txt(ctx, h("ftg"), x, y, 15, fc);
  ctx.fillStyle = FAINT; ctx.fillRect(x + 58, y - 6, 62, 2);
  ctx.fillStyle = fc === DIM ? HUD : fc; ctx.fillRect(x + 58, y - 6, 62 * Math.max(0, Math.min(1, f)), 2);
  txt(ctx, `${Math.round(f * 100)}%`, x + w, y, 15, fc, "right", 600);
}

/** the link, where to walk, the way home and the margin */
function navBlock(ctx: CanvasRenderingContext2D, { v, rt }: HudData) {
  const x = 204, w = 180;
  let y = 24;
  const back = v.mode === "return";
  const mode = `${back ? h("mode_return") : v.mode === "out" ? h("nav") : v.mode === "complete" ? h("mode_complete") : h("mode_standby")}${rt.autopilot ? ` · ${h("autopilot")}` : ""}`;
  txt(ctx, mode, x, y, 15, back ? WARNING : DIM, "right", 600);
  // link to the ship: a dot before the title, green while reports are going out
  const ago = v.link.lastSent ? (Date.now() - v.link.lastSent) / 1000 : Infinity;
  const lw = ctx.measureText(mode).width;
  ctx.beginPath(); ctx.arc(x - lw - 10, y - 5, 4, 0, Math.PI * 2); ctx.fillStyle = ago < 6 ? GOOD : CAUTION; ctx.fill();
  if (v.route && (v.mode === "out" || back)) {
    y += 28;
    txt(ctx, back ? h("airlock") : h("tgt"), x - w, y, 17, back ? ROUTE_BACK : ROUTE_OUT);
    txt(ctx, fmtKm(v.left), x, y, 19, HUD, "right", 600);
    y += 24;
    txt(ctx, `${v.guide ? `${deg3(v.guide.bearing)}°` : "---"}  ${Math.max(0, Math.round(v.etaMin))} ${h("min")}`, x, y, 17, DIM, "right");
    // the relief still ahead: metres to climb and to descend, and the slope of the next stretch
    y += 22;
    const sl = Math.round(v.slopeAhead);
    txt(ctx, `▲${Math.round(v.climbLeft)} ▼${Math.round(v.descentLeft)} m  ${sl > 0 ? "↗" : sl < 0 ? "↘" : "→"}${Math.abs(sl)}°`, x, y, 15, sl >= 8 ? CAUTION : DIM, "right");
    if (v.offRoute > 15) { y += 22; txt(ctx, `${h("xtk")} ${Math.round(v.offRoute)} m`, x, y, 15, v.offRoute > 40 ? CAUTION : DIM, "right"); }
  }
  y += 32;
  txt(ctx, h("base"), x - w, y, 17, DIM);
  txt(ctx, `${fmtKm(v.toBase)} ${deg3(v.bearingBase)}°`, x, y, 17, HUD, "right");
  // what the suit is expected to have left at the airlock (the least of oxygen, power and water)
  const reserve = v.suit.reservePct;
  y += 26;
  txt(ctx, h("margin"), x - w, y, 15, DIM);
  txt(ctx, `${Math.round(reserve)}%`, x, y, 19, reserve < 10 ? WARNING : reserve < 25 ? CAUTION : HUD, "right", 600);
}

// the map is drawn off to the side first, then laid on the visor slightly see-through
let mapCanvas: HTMLCanvasElement | null = null;
function mapBlock(ctx: CanvasRenderingContext2D, { hm: hmap, v, rt, home }: HudData) {
  const size = 232, px = 464;
  mapCanvas ??= document.createElement("canvas");
  if (mapCanvas.width !== px) { mapCanvas.width = px; mapCanvas.height = px; }
  const m = mapCanvas.getContext("2d")!;
  m.clearRect(0, 0, px, px);
  drawMap(m, hmap, v, rt, home, 0, 0, px, 1600, { round: true, headingUp: true });
  ctx.globalAlpha = 0.86;
  ctx.drawImage(mapCanvas, 4, 4, size, size);
  ctx.globalAlpha = 1;
}

/** outside: two quiet lines */
function envBlock(ctx: CanvasRenderingContext2D, { v }: HudData) {
  if (!v.cond) return;
  const x = 326, dusty = v.storm > 0.4 || v.cond.tau > 2;
  txt(ctx, `${v.cond.tempC}°C  ${v.cond.windMs} m/s  τ${v.cond.tau.toFixed(1)}`, x, 20, 17, dusty ? CAUTION : DIM, "right");
  txt(ctx, `${v.cond.doseUSvH} µSv/h  ${h("dose")} ${v.suit.doseUSv.toFixed(0)} µSv`, x, 44, 17, v.cond.doseUSvH > 80 ? CAUTION : DIM, "right");
}

/** one block into its own canvas at `scale` (the headset patches) */
export function drawHudPart(ctx: CanvasRenderingContext2D, part: HudPart, d: HudData, scale: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.textBaseline = "alphabetic";
  part.draw(ctx, d);
}

/**
 * every block on one canvas covering the screen view (`w` × `h` CSS px, `k` device px per CSS px),
 * pinned round the edge of the visor; blocks grow a little on large screens
 */
export function drawHudScreen(ctx: CanvasRenderingContext2D, d: HudData, w: number, ht: number, k: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const s = Math.max(0.8, Math.min(1.5, ht / 860));
  for (const p of HUD_PARTS) {
    const x = p.sx * w - p.ax * p.w * s, y = p.sy * ht - p.ay * p.h * s;
    ctx.setTransform(k * s, 0, 0, k * s, k * x, k * y);
    ctx.textBaseline = "alphabetic";
    p.draw(ctx, d);
  }
}
