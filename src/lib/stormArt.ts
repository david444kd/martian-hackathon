// How an anomaly looks on every 2D map (mission control, the ship, the helmet's map, the globe):
// a dust storm is a churning, rotating cloud of dust with spiral streaks and the odd electrostatic
// flash; a dust devil a tight bright vortex; a rockfall a hatched field of debris. Drawn on a canvas
// from the time alone (no state), so every map shows the same picture. The thin dashed ring is the
// anomaly's real boundary (centre + radius from the `events` row); the cloud is an illustration.
import type { EventKind, Level } from "./types";

const LEVEL: Record<Level, string> = { info: "56,189,248", warning: "251,191,36", critical: "239,68,68" };

function h(a: number, b = 0) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export interface StormLook { kind: EventKind; level: Level; active: boolean; seed: number }

/** hash an id into a seed, so each anomaly has its own shape */
export const seedOf = (id: string) => { let s = 7; for (let i = 0; i < id.length; i++) s = (Math.imul(s, 31) + id.charCodeAt(i)) | 0; return Math.abs(s) % 100000; };

/** draw the anomaly centred at (cx, cy) with radius r pixels, at time t seconds */
export function drawStorm(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, look: StormLook) {
  if (r < 1.5) return;
  const { kind, level, active, seed } = look;
  ctx.save();
  ctx.translate(cx, cy);
  if (kind === "rockfall") rockfall(ctx, r, t, level, active, seed);
  else dust(ctx, r, t, kind === "dust_devil", level, active, seed);
  // the real boundary: a thin dashed ring turning slowly
  ctx.rotate(t * 0.12);
  ctx.setLineDash([Math.max(3, r * 0.12), Math.max(2, r * 0.08)]);
  ctx.lineWidth = Math.max(1, Math.min(2.5, r * 0.03));
  ctx.strokeStyle = `rgba(${LEVEL[level]},${active ? 0.9 : 0.55})`;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function dust(ctx: CanvasRenderingContext2D, r: number, t: number, devil: boolean, level: Level, active: boolean, seed: number) {
  const A = active ? 1 : 0.35, spin = devil ? 1.6 : 0.42, R = r * (devil ? 1.05 : 1.12);
  const hot = level === "critical";
  // the body: lumpy lobes of dust drifting around the centre
  const lobes = devil ? 5 : 11;
  for (let i = 0; i < lobes; i++) {
    const a = h(seed, i) * Math.PI * 2 + t * spin * (0.35 + h(seed, i + 40) * 0.5), d = R * (devil ? 0.25 : 0.2 + h(seed, i + 80) * 0.5);
    const x = Math.cos(a) * d, y = Math.sin(a) * d, rr = R * (devil ? 0.55 : 0.45 + h(seed, i + 120) * 0.25) * (1 + Math.sin(t * 0.7 + i) * 0.06);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    const dark = i % 3 === 0;
    const c = dark ? (hot ? "128,62,38" : "134,86,52") : hot ? "206,128,82" : "208,156,104";
    g.addColorStop(0, `rgba(${c},${0.34 * A})`); g.addColorStop(0.55, `rgba(${c},${0.2 * A})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }
  // a dense core
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.75);
  core.addColorStop(0, `rgba(${hot ? "150,74,44" : "166,112,70"},${0.5 * A})`); core.addColorStop(1, "rgba(160,104,64,0)");
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, R * 0.75, 0, Math.PI * 2); ctx.fill();
  // streaks of dust swept round in a spiral: faster and tighter near the centre
  const n = Math.round(Math.min(devil ? 46 : 150, 30 + r * 1.6));
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const rho = 0.08 + Math.pow(h(seed + 3, i), 0.8) * 0.95;
    const w = spin * (0.5 + 0.9 / (0.25 + rho)) * (0.7 + h(seed + 5, i) * 0.6);
    const a0 = h(seed + 9, i) * Math.PI * 2 + t * w, len = (devil ? 0.9 : 0.35 + h(seed + 11, i) * 0.55) / (0.4 + rho);
    const life = (t * (0.12 + h(seed + 13, i) * 0.2) + h(seed + 17, i)) % 1, fade = Math.sin(life * Math.PI);
    const light = h(seed + 19, i) > 0.4;
    ctx.strokeStyle = light ? `rgba(248,222,184,${(0.16 + fade * 0.4) * A})` : `rgba(96,54,30,${(0.14 + fade * 0.3) * A})`;
    ctx.lineWidth = Math.max(0.6, r * (0.006 + h(seed + 23, i) * 0.014));
    ctx.beginPath();
    const steps = 6;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (len * k) / steps, rr = R * rho * (1 - (k / steps) * 0.1 * (devil ? 2.5 : 1)); // drawn inwards
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // electrostatic discharge inside a storm, now and then
  if (active && !devil && r > 14) {
    const slot = Math.floor(t * 1.8), ph = (t * 1.8) % 1;
    if (h(seed + 31, slot) < 0.22 && ph < 0.35) {
      const a = h(seed + 37, slot) * Math.PI * 2, d = R * (0.15 + h(seed + 41, slot) * 0.45);
      let x = Math.cos(a) * d, y = Math.sin(a) * d;
      ctx.strokeStyle = `rgba(255,244,220,${0.9 * (1 - ph / 0.35)})`; ctx.lineWidth = Math.max(1, r * 0.012);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (h(seed + 43, slot * 7 + k) - 0.5) * r * 0.22; y += (h(seed + 47, slot * 7 + k) - 0.3) * r * 0.16; ctx.lineTo(x, y); }
      ctx.stroke();
      const fl = ctx.createRadialGradient(x, y, 0, x, y, r * 0.5);
      fl.addColorStop(0, `rgba(255,236,200,${0.28 * (1 - ph / 0.35)})`); fl.addColorStop(1, "rgba(255,236,200,0)");
      ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function rockfall(ctx: CanvasRenderingContext2D, r: number, t: number, level: Level, active: boolean, seed: number) {
  const A = active ? 1 : 0.4;
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  g.addColorStop(0, `rgba(${LEVEL[level]},${0.3 * A})`); g.addColorStop(1, `rgba(${LEVEL[level]},${0.12 * A})`);
  ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
  // hazard hatching
  ctx.strokeStyle = `rgba(${LEVEL[level]},${0.35 * A})`; ctx.lineWidth = Math.max(1, r * 0.03);
  const step = Math.max(6, r * 0.22), off = (t * 6) % step;
  for (let x = -r * 2 + off; x < r * 2; x += step) { ctx.beginPath(); ctx.moveTo(x, -r); ctx.lineTo(x + r, r); ctx.stroke(); }
  // debris
  for (let i = 0; i < Math.min(40, 8 + r * 0.5); i++) {
    const a = h(seed, i) * Math.PI * 2, d = Math.sqrt(h(seed + 1, i)) * r * 0.9, s = r * (0.025 + h(seed + 2, i) * 0.06);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    ctx.fillStyle = `rgba(${70 + h(seed + 3, i) * 50},${44 + h(seed + 4, i) * 24},${32},${0.85 * A})`;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) { const b = (k / 5) * Math.PI * 2 + h(seed + 5, i), q = s * (0.7 + h(seed + 6, i * 5 + k) * 0.6); if (k === 0) ctx.moveTo(x + Math.cos(b) * q, y + Math.sin(b) * q); else ctx.lineTo(x + Math.cos(b) * q, y + Math.sin(b) * q); }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
