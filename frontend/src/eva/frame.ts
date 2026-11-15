// The EVA's world frame is the zone's local terrain frame (astro/geometry.ts), in metres:
// X east, Y up (height above the zone's lowest point), Z south, origin at the zone centre.
// The astronaut walks freely in it; lat/lon come from the zone's georeference.
import { toLL, toPx, type Heightmap } from "../lib/zones";

export interface P2 { x: number; z: number }

/** local frame → pixel coordinates of the heightmap (cell centres at .5) */
const px = (hm: Heightmap, x: number, z: number): [number, number] => [x / hm.zone.dx + hm.zone.width / 2, z / hm.zone.dy + hm.zone.height / 2];

export function toLocal(hm: Heightmap, lat: number, lon: number): P2 {
  const z = hm.zone, [x, y] = toPx(z, lat, lon);
  return { x: (x - z.width / 2) * z.dx, z: (y - z.height / 2) * z.dy };
}

export function toLatLon(hm: Heightmap, x: number, z: number): [number, number] {
  const [a, b] = px(hm, x, z);
  return toLL(hm.zone, a, b);
}

/**
 * Ground height at (x, z), interpolated over the same triangles the terrain mesh draws
 * (astro/geometry.ts: vertices at cell centres, each quad split along its b–c diagonal), so the
 * eye, the rocks and the ground markers sit exactly on the rendered surface.
 */
export function groundY(hm: Heightmap, x: number, z: number): number {
  const { width: W, height: H, min } = hm.zone, h = hm.h;
  const [fx, fy] = px(hm, x, z);
  const gx = Math.min(Math.max(fx - 0.5, 0), W - 1.0001), gy = Math.min(Math.max(fy - 0.5, 0), H - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j;
  const a = h[j * W + i], b = h[j * W + i + 1], c = h[(j + 1) * W + i], d = h[(j + 1) * W + i + 1];
  const e = u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  return e - min;
}

/** elevation above the areoid (the DTM's own datum), m */
export const areoid = (hm: Heightmap, x: number, z: number) => groundY(hm, x, z) + hm.zone.min;

/** steepness of the ground at (x, z), degrees */
export function slopeDeg(hm: Heightmap, x: number, z: number) {
  const s = 4;
  const gx = (groundY(hm, x + s, z) - groundY(hm, x - s, z)) / (2 * s), gz = (groundY(hm, x, z + s) - groundY(hm, x, z - s)) / (2 * s);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}

/** is (x, z) inside the zone, `margin` m from its edge */
export function inside(hm: Heightmap, x: number, z: number, margin = 40) {
  const hw = (hm.zone.width * hm.zone.dx) / 2 - margin, hh = (hm.zone.height * hm.zone.dy) / 2 - margin;
  return Math.abs(x) <= hw && Math.abs(z) <= hh;
}

/** compass bearing of a direction in the local frame (0 = north = -Z, 90 = east = +X) */
export const bearingOf = (dx: number, dz: number) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;

export const dist2 = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);

export interface Polyline { pts: P2[]; along: number[]; length: number }

export function polyline(pts: P2[]): Polyline {
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + dist2(pts[i - 1], pts[i]));
  return { pts, along, length: along[along.length - 1] ?? 0 };
}

/** the nearest point of the polyline to p: metres along it, distance off it, segment index */
export function project(line: Polyline, p: P2) {
  let best = { along: 0, off: Infinity, seg: 0, at: line.pts[0] ?? p };
  for (let i = 0; i < line.pts.length - 1; i++) {
    const a = line.pts[i], b = line.pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    const q = { x: a.x + dx * t, z: a.z + dz * t }, off = dist2(p, q);
    if (off < best.off) best = { along: line.along[i] + Math.sqrt(l2) * t, off, seg: i, at: q };
  }
  if (line.pts.length === 1) best = { along: 0, off: dist2(p, line.pts[0]), seg: 0, at: line.pts[0] };
  return best;
}

/** the point m metres along the polyline, and the direction of travel there */
export function pointAlong(line: Polyline, m: number): { p: P2; dir: P2 } {
  const n = line.pts.length;
  if (n < 2) return { p: line.pts[0] ?? { x: 0, z: 0 }, dir: { x: 0, z: -1 } };
  const mm = Math.max(0, Math.min(line.length, m));
  let i = 1;
  while (i < n - 1 && line.along[i] < mm) i++;
  const a = line.pts[i - 1], b = line.pts[i], l = line.along[i] - line.along[i - 1] || 1, t = (mm - line.along[i - 1]) / l;
  return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dir: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
}
