// 2D drawing shared by the screen HUD and the in-headset HUD (xrHud.ts): the navigation map (shaded
// relief of the zone around you: route, anomalies, base, target, you and where you look), north up
// as a rounded square on screen, round and heading up in the visor.
import { reliefCanvas } from "../lib/relief";
import type { Heightmap } from "../lib/zones";
import { LEVEL_COLOR } from "../components/levels";
import { compass, fmtKm } from "../lib/geo";
import { toLocal, type P2 } from "./frame";
import { drawAnomaly } from "../lib/stormSprite";
import type { EvaRuntime } from "./runtime";
import type { EvaView } from "./useEva";

export const ROUTE_OUT = "#ffc46b", ROUTE_BACK = "#5fd8ff";
/** N / NE / … in the current language (the same list as the rest of the app) */
export { compass };

export interface MapStyle {
  /** a round map (the visor HUD) instead of a rounded square */
  round?: boolean;
  /** turn the map with the astronaut, the way they face up (round maps only) */
  headingUp?: boolean;
}

/** the map: `span` metres across, centred on the astronaut */
export function drawMap(ctx: CanvasRenderingContext2D, hm: Heightmap, v: EvaView, rt: EvaRuntime, home: P2, x: number, y: number, size: number, span = 1600, style: MapStyle = {}) {
  const z = hm.zone, me = { x: rt.pose.x, z: rt.pose.z }, k = size / span;
  const S = (p: P2): [number, number] => [x + size / 2 + (p.x - me.x) * k, y + size / 2 + (p.z - me.z) * k];
  const round = !!style.round, turn = round && !!style.headingUp;
  const hd = (rt.pose.heading * Math.PI) / 180, mx = x + size / 2, my = y + size / 2;
  ctx.save();
  ctx.beginPath();
  if (round) ctx.arc(mx, my, size / 2, 0, Math.PI * 2); else ctx.roundRect(x, y, size, size, size * 0.06);
  ctx.clip();
  // relief: one canvas pixel per 20 m cell
  const relief = reliefCanvas(hm.h, z.width, z.height, z.dx, z.dy, z.min, z.max);
  const cx = me.x / z.dx + z.width / 2, cy = me.z / z.dy + z.height / 2, w = span / z.dx, h = span / z.dy;
  ctx.fillStyle = "#1b120d"; ctx.fillRect(x, y, size, size);
  // heading up: everything on the ground turns about the astronaut
  ctx.save();
  if (turn) { ctx.translate(mx, my); ctx.rotate(-hd); ctx.translate(-mx, -my); }
  ctx.globalAlpha = 0.9;
  ctx.drawImage(relief, cx - w / 2, cy - h / 2, w, h, x, y, size, size);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(8,12,16,0.25)"; ctx.fillRect(x, y, size, size);
  // anomalies: the same GPU picture as on the globe and the ship's and mission control's maps
  const t = performance.now() / 1000;
  const off: { ang: number; d: number; e: (typeof v.hazards)[number] }[] = [];
  for (const e of v.hazards) {
    const c = toLocal(hm, e.lat!, e.lon!), [px, py] = S(c), rp = e.radius_m! * k;
    drawAnomaly(ctx, px, py, rp, t, { id: e.id, kind: e.kind, level: e.level, active: true });
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
  ctx.restore();
  // you, with a view cone
  const cxm = mx, cym = my, r = size * 0.16, look = turn ? -Math.PI / 2 : hd - Math.PI / 2;
  const g = ctx.createRadialGradient(cxm, cym, 0, cxm, cym, r);
  g.addColorStop(0, "rgba(120,220,255,0.45)"); g.addColorStop(1, "rgba(120,220,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(cxm, cym); ctx.arc(cxm, cym, r, look - 0.45, look + 0.45); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#7fe0ff"; ctx.strokeStyle = "#04131b"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cxm, cym, size / 40, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // north and scale
  ctx.fillStyle = "#e7e2d6"; ctx.font = `600 ${Math.round(size / 13)}px system-ui, sans-serif`; ctx.textAlign = "center";
  if (turn) {
    const na = -Math.PI / 2 - hd, nr = size * 0.41;
    ctx.textBaseline = "middle"; ctx.fillText(compass(0), mx + Math.cos(na) * nr, my + Math.sin(na) * nr); ctx.textBaseline = "alphabetic";
  } else ctx.fillText(compass(0), x + size / 2, y + size / 11);
  ctx.font = `${Math.round(size / 17)}px system-ui, sans-serif`;
  if (round) {
    ctx.fillText(`${fmtKm(span / 4)}`, mx, y + size * 0.84);
    ctx.fillRect(mx - size / 8, y + size * 0.86, size / 4, 2);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(`${fmtKm(span / 4)}`, x + size * 0.06, y + size * 0.93);
    ctx.fillRect(x + size * 0.06, y + size * 0.95, size / 4, 2);
  }
  ctx.textAlign = "left";
  // anomalies beyond the map's edge: an arrow towards each, with its distance
  for (const o of off) {
    const ang = turn ? o.ang - hd : o.ang;
    const R = size * 0.4, ax = x + size / 2 + Math.cos(ang) * R, ay = y + size / 2 + Math.sin(ang) * R, col = LEVEL_COLOR[o.e.level];
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
    ctx.fillStyle = col; ctx.strokeStyle = "#1a0d06"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(size * 0.06, 0); ctx.lineTo(-size * 0.025, size * 0.035); ctx.lineTo(-size * 0.025, -size * 0.035); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.font = `600 ${Math.round(size / 17)}px system-ui, sans-serif`; ctx.textAlign = "center";
    const lx = x + size / 2 + Math.cos(ang) * (R - size * 0.09), ly = y + size / 2 + Math.sin(ang) * (R - size * 0.09) + size / 50;
    ctx.fillStyle = "rgba(10,14,18,0.75)"; const w = ctx.measureText(fmtKm(Math.max(0, o.d))).width + 8;
    ctx.fillRect(lx - w / 2, ly - size / 17, w, size / 13);
    ctx.fillStyle = col; ctx.fillText(fmtKm(Math.max(0, o.d)), lx, ly);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(200,230,225,0.35)"; ctx.lineWidth = 2;
  ctx.beginPath();
  if (round) ctx.arc(mx, my, size / 2, 0, Math.PI * 2); else ctx.roundRect(x, y, size, size, size * 0.06);
  ctx.stroke();
  if (round) {
    // bearing ticks round the rim, every 30°, turning with the map
    for (let d = 0; d < 360; d += 30) {
      const a = (d * Math.PI) / 180 - Math.PI / 2 - (turn ? hd : 0), r0 = size / 2, r1 = size / 2 - (d % 90 === 0 ? 12 : 7);
      ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0); ctx.lineTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1); ctx.stroke();
    }
  }
}
