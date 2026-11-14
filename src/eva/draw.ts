// 2D drawing shared by the screen HUD and the in-headset HUD: the navigation map (shaded relief of
// the zone around you, north up: route, anomalies, base, target, you and where you look) and the
// whole head-locked visor display for VR, on a canvas texture.
import { reliefCanvas } from "../lib/relief";
import type { Heightmap } from "../lib/zones";
import { LEVEL_COLOR } from "../components/levels";
import { compass, fmtDur, fmtKm } from "../lib/geo";
import { toLocal, type P2 } from "./frame";
import { drawStorm, seedOf } from "../lib/stormArt";
import type { EvaRuntime } from "./runtime";
import type { EvaView } from "./useEva";
import i18n from "../i18n";

/** translation for canvas text (no React here; `t` is the time in drawXrHud) */
const tr = (key: string, opts: Record<string, unknown> = {}) => i18n.t(key, opts) as string;
const status = (s: string) => tr(`evahud.status_${s.toLowerCase()}`);

export const ROUTE_OUT = "#ffc46b", ROUTE_BACK = "#5fd8ff";
/** N / NE / … in the current language (the same list as the rest of the app) */
export { compass };

/** the map: `span` metres across, centred on the astronaut */
export function drawMap(ctx: CanvasRenderingContext2D, hm: Heightmap, v: EvaView, rt: EvaRuntime, home: P2, x: number, y: number, size: number, span = 1600) {
  const z = hm.zone, me = { x: rt.pose.x, z: rt.pose.z }, k = size / span;
  const S = (p: P2): [number, number] => [x + size / 2 + (p.x - me.x) * k, y + size / 2 + (p.z - me.z) * k];
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, size, size, size * 0.06); ctx.clip();
  // relief: one canvas pixel per 20 m cell
  const relief = reliefCanvas(hm.h, z.width, z.height, z.dx, z.dy, z.min, z.max);
  const cx = me.x / z.dx + z.width / 2, cy = me.z / z.dy + z.height / 2, w = span / z.dx, h = span / z.dy;
  ctx.fillStyle = "#1b120d"; ctx.fillRect(x, y, size, size);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(relief, cx - w / 2, cy - h / 2, w, h, x, y, size, size);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(8,12,16,0.25)"; ctx.fillRect(x, y, size, size);
  // anomalies: the same live picture as on the ship's and mission control's maps
  const t = performance.now() / 1000;
  const off: { ang: number; d: number; e: (typeof v.hazards)[number] }[] = [];
  for (const e of v.hazards) {
    const c = toLocal(hm, e.lat!, e.lon!), [px, py] = S(c), rp = e.radius_m! * k;
    drawStorm(ctx, px, py, rp, t, { kind: e.kind, level: e.level, active: true, seed: seedOf(e.id) });
    const d = Math.hypot(c.x - me.x, c.z - me.z) - e.radius_m!;
    if (Math.hypot(px - (x + size / 2), py - (y + size / 2)) - rp > size * 0.46) off.push({ ang: Math.atan2(c.z - me.z, c.x - me.x), d, e });
  }
  // route: walked part faint, the rest bright
  if (v.line && v.line.pts.length > 1) {
    const color = v.mode === "return" || v.mode === "complete" ? ROUTE_BACK : ROUTE_OUT;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = size / 55;
    ctx.beginPath(); v.line.pts.forEach((p, i) => (i ? ctx.lineTo(...S(p)) : ctx.moveTo(...S(p)))); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = size / 110;
    ctx.beginPath(); v.line.pts.forEach((p, i) => (i ? ctx.lineTo(...S(p)) : ctx.moveTo(...S(p)))); ctx.stroke();
    const end = v.line.pts[v.line.pts.length - 1], [ex, ey] = S(end);
    ctx.fillStyle = v.mode === "out" ? "#7be08a" : ROUTE_BACK;
    ctx.beginPath(); ctx.arc(ex, ey, size / 45, 0, Math.PI * 2); ctx.fill();
  }
  // base
  const [bx, by] = S(home);
  ctx.fillStyle = "#e9f2ef"; ctx.strokeStyle = "#0b1218"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.rect(bx - size / 55, by - size / 55, size / 27.5, size / 27.5); ctx.fill(); ctx.stroke();
  // you, with a view cone
  const hd = (rt.pose.heading * Math.PI) / 180, cxm = x + size / 2, cym = y + size / 2, r = size * 0.16;
  const g = ctx.createRadialGradient(cxm, cym, 0, cxm, cym, r);
  g.addColorStop(0, "rgba(120,220,255,0.45)"); g.addColorStop(1, "rgba(120,220,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(cxm, cym); ctx.arc(cxm, cym, r, hd - Math.PI / 2 - 0.45, hd - Math.PI / 2 + 0.45); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#7fe0ff"; ctx.strokeStyle = "#04131b"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cxm, cym, size / 40, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // north and scale
  ctx.fillStyle = "#e7e2d6"; ctx.font = `600 ${Math.round(size / 13)}px system-ui, sans-serif`; ctx.textAlign = "center";
  ctx.fillText(compass(0), x + size / 2, y + size / 11);
  ctx.textAlign = "left"; ctx.font = `${Math.round(size / 17)}px system-ui, sans-serif`;
  ctx.fillText(`${fmtKm(span / 4)}`, x + size * 0.06, y + size * 0.93);
  ctx.fillRect(x + size * 0.06, y + size * 0.95, size / 4, 2);
  // anomalies beyond the map's edge: an arrow towards each, with its distance
  for (const o of off) {
    const R = size * 0.4, ax = x + size / 2 + Math.cos(o.ang) * R, ay = y + size / 2 + Math.sin(o.ang) * R, col = LEVEL_COLOR[o.e.level];
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(o.ang);
    ctx.fillStyle = col; ctx.strokeStyle = "#1a0d06"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(size * 0.06, 0); ctx.lineTo(-size * 0.025, size * 0.035); ctx.lineTo(-size * 0.025, -size * 0.035); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.font = `600 ${Math.round(size / 17)}px system-ui, sans-serif`; ctx.textAlign = "center";
    const lx = x + size / 2 + Math.cos(o.ang) * (R - size * 0.09), ly = y + size / 2 + Math.sin(o.ang) * (R - size * 0.09) + size / 50;
    ctx.fillStyle = "rgba(10,14,18,0.75)"; const w = ctx.measureText(fmtKm(Math.max(0, o.d))).width + 8;
    ctx.fillRect(lx - w / 2, ly - size / 17, w, size / 13);
    ctx.fillStyle = col; ctx.fillText(fmtKm(Math.max(0, o.d)), lx, ly);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(200,230,225,0.35)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, size, size, size * 0.06); ctx.stroke();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out.length > maxLines ? [...out.slice(0, maxLines - 1), `${out[maxLines - 1]}…`] : out;
}

const panel = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, edge?: string) => {
  ctx.fillStyle = "rgba(10,22,28,0.72)";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.fill();
  if (edge) { ctx.fillStyle = edge; ctx.fillRect(x, y + 12, 4, h - 24); }
};

/** the head-locked visor display in VR, 1536 × 864 */
export function drawXrHud(ctx: CanvasRenderingContext2D, hm: Heightmap, v: EvaView, rt: EvaRuntime, home: P2, t: number) {
  const W = 1536, H = 864, s = v.suit;
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const warn = v.mode === "return" || v.top?.level === "critical";
  // visor rim tint when something is wrong
  if (warn && Math.sin(t * 5) > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, "rgba(255,40,30,0)"); g.addColorStop(1, "rgba(255,40,30,0.28)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // suit (top left)
  panel(ctx, 40, 40, 360, 200, s.status === "NOMINAL" ? "#7be08a" : s.status === "CAUTION" ? "#fbbf24" : "#ef4444");
  ctx.fillStyle = "#9fb7b0"; ctx.font = "600 22px system-ui, sans-serif"; ctx.fillText(`${tr("evahud.suit_upper")} · ${status(s.status)}`, 64, 78);
  ctx.fillStyle = s.o2Pct < 30 ? "#ffb4a8" : "#e9f4f0"; ctx.font = "600 52px system-ui, sans-serif"; ctx.fillText(`O₂ ${s.o2Pct.toFixed(0)}%`, 64, 138);
  ctx.font = "24px system-ui, sans-serif"; ctx.fillStyle = "#cfe0da";
  ctx.fillText(`${tr("evahud.time_left", { time: fmtDur(s.remainingMin) })} · ${s.kpa.toFixed(1)} kPa`, 64, 176);
  ctx.fillText(`${tr("evahud.pulse")} ${s.pulse.toFixed(0)} · CO₂ ${s.co2.toFixed(1)} mmHg`, 64, 212);
  // navigation (top right)
  panel(ctx, W - 440, 40, 400, 200, v.mode === "return" ? ROUTE_BACK : ROUTE_OUT);
  ctx.fillStyle = "#9fb7b0"; ctx.font = "600 22px system-ui, sans-serif";
  ctx.fillText(v.mode === "return" ? tr("evahud.return_to_base_upper") : v.mode === "out" ? tr("evahud.outbound_upper") + " · " + (v.plan?.title ?? "").slice(0, 18) : v.mode === "complete" ? tr("evahud.at_base_upper") : tr("evahud.standby_upper"), W - 416, 78);
  ctx.fillStyle = "#f2efe6"; ctx.font = "600 46px system-ui, sans-serif";
  if (v.guide) ctx.fillText(`${fmtKm(v.left)}  ${Math.round(v.guide.bearing)}° ${compass(v.guide.bearing)}`, W - 416, 136);
  else ctx.fillText(v.mode === "standby" ? tr("evahud.no_active_eva") : v.arrived ? tr("evahud.arrived") : "—", W - 416, 136);
  ctx.font = "24px system-ui, sans-serif"; ctx.fillStyle = "#cfe0da";
  if (v.route) ctx.fillText(`~${fmtDur(v.etaMin)} · ${tr("evahud.off_route_m", { m: Math.round(v.offRoute) })}`, W - 416, 176);
  ctx.fillText(`${tr("evahud.base")} ${fmtKm(v.toBase)} ${compass(v.bearingBase)}${rt.autopilot ? ` · ${tr("evahud.autopilot_upper")}` : ""}`, W - 416, 212);
  // heading tape (top centre)
  ctx.fillStyle = "rgba(10,22,28,0.55)"; ctx.beginPath(); ctx.roundRect(W / 2 - 230, 40, 460, 64, 16); ctx.fill();
  const hd = rt.pose.heading;
  ctx.save(); ctx.beginPath(); ctx.rect(W / 2 - 220, 40, 440, 64); ctx.clip();
  for (let d = -60; d <= 60; d += 5) {
    const deg = Math.round(hd / 5) * 5 + d, px = W / 2 + (deg - hd) * 3.6;
    ctx.fillStyle = "#d9e6e1";
    ctx.fillRect(px, 40, 2, deg % 15 === 0 ? 18 : 9);
    if (deg % 45 === 0) { ctx.font = "600 22px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(compass(((deg % 360) + 360) % 360), px, 92); }
  }
  const mark = (b: number | null | undefined, c: string) => {
    if (b == null) return;
    let d = b - hd; d = ((d + 540) % 360) - 180;
    const px = W / 2 + Math.max(-215, Math.min(215, d * 3.6));
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(px, 62); ctx.lineTo(px - 9, 76); ctx.lineTo(px + 9, 76); ctx.fill();
  };
  mark(v.bearingBase, "#e9f2ef"); mark(v.guide?.bearing, v.mode === "return" ? ROUTE_BACK : ROUTE_OUT);
  ctx.restore();
  ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "600 20px system-ui, sans-serif"; ctx.fillText(`${Math.round(hd).toString().padStart(3, "0")}°`, W / 2, 130);
  ctx.textAlign = "left";
  // map (bottom left)
  panel(ctx, 40, H - 330, 290, 290);
  drawMap(ctx, hm, v, rt, home, 52, H - 318, 266);
  // conditions (bottom right)
  if (v.cond) {
    panel(ctx, W - 440, H - 150, 400, 110);
    ctx.font = "24px system-ui, sans-serif"; ctx.fillStyle = v.storm > 0.4 ? "#ffcf8a" : "#cfe0da";
    ctx.fillText(`${v.cond.tempC} °C · ${tr("evahud.wind")} ${v.cond.windMs} m/s · τ ${v.cond.tau.toFixed(1)}`, W - 416, H - 104);
    ctx.fillStyle = v.cond.doseUSvH > 80 ? "#ffb4a8" : "#cfe0da";
    ctx.fillText(`${v.cond.doseUSvH} µSv/h · ${tr("evahud.dose")} ${s.doseUSv.toFixed(0)} µSv`, W - 416, H - 66);
  }
  // alert / call (lower centre)
  const a = v.top;
  if (v.mode === "return" || v.recall.state === "failed") {
    const failed = v.recall.state === "failed";
    panel(ctx, W / 2 - 380, H - 300, 760, 170, "#ef4444");
    ctx.fillStyle = "#ff8f84"; ctx.font = "700 44px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(failed ? tr("evahud.hold_position") : `⚠ ${tr("evahud.return_to_base_upper")}`, W / 2, H - 238);
    ctx.font = "26px system-ui, sans-serif"; ctx.fillStyle = "#f3e9e6";
    ctx.fillText(failed ? tr("evahud.no_return_contact_ship") : `${v.recall.reason || v.route?.reason || tr("evahud.recall")} · ${tr("evahud.follow_blue")}`, W / 2, H - 194);
    ctx.fillText(failed ? "" : tr("evahud.to_airlock", { dist: fmtKm(v.left) }), W / 2, H - 156);
    ctx.textAlign = "left";
  } else if (a) {
    const c = LEVEL_COLOR[a.level];
    panel(ctx, W / 2 - 380, H - 300, 760, 170, c);
    ctx.fillStyle = c; ctx.font = "600 34px system-ui, sans-serif";
    ctx.fillText(`${a.level === "info" ? "◉" : "⚠"} ${a.title}`.slice(0, 46), W / 2 - 350, H - 248);
    ctx.fillStyle = "#eef0ea"; ctx.font = "24px system-ui, sans-serif";
    wrap(ctx, a.text, 700, 2).forEach((l, i) => ctx.fillText(l, W / 2 - 350, H - 210 + i * 32));
    ctx.fillStyle = "#a9c6bd"; ctx.font = "20px system-ui, sans-serif"; ctx.fillText(tr("evahud.xr_ack"), W / 2 - 350, H - 148);
  } else if (v.mode === "complete") {
    panel(ctx, W / 2 - 300, H - 280, 600, 120, "#7be08a");
    ctx.fillStyle = "#c9f5d3"; ctx.font = "600 40px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(tr("evahud.airlock_complete"), W / 2, H - 208); ctx.textAlign = "left";
  } else if (v.arrived && v.mode === "out") {
    panel(ctx, W / 2 - 300, H - 280, 600, 120, "#7be08a");
    ctx.fillStyle = "#c9f5d3"; ctx.font = "600 40px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(tr("evahud.target_reached"), W / 2, H - 222);
    ctx.font = "24px system-ui, sans-serif"; ctx.fillStyle = "#e6efe9"; ctx.fillText((v.plan?.description || tr("evahud.carry_out_plan")).slice(0, 60), W / 2, H - 186); ctx.textAlign = "left";
  }
  if (rt.pose.blocked) {
    ctx.fillStyle = "rgba(60,20,10,0.8)"; ctx.beginPath(); ctx.roundRect(W / 2 - 260, 150, 520, 50, 14); ctx.fill();
    ctx.fillStyle = "#ffcf8a"; ctx.font = "600 24px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(rt.pose.blocked, W / 2, 184); ctx.textAlign = "left";
  }
  // controls hint
  ctx.fillStyle = "rgba(220,235,230,0.55)"; ctx.font = "18px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(tr("evahud.xr_controls"), W / 2, H - 30);
  ctx.textAlign = "left";
}
