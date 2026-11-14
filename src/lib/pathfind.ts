// A walking route that goes around steep ground instead of straight over it (a TypeScript port of
// martian-map's pathfind.py). The heightmap is searched with A*: each step costs the time it takes
// to walk it in a suit (Tobler's hiking function, slowed for the suit), steps steeper than
// AVOID_DEG cost PENALTY times more, steeper than BLOCK_DEG are not allowed. The grid path is then
// straightened wherever a direct line is no slower and no steeper.
import { heightAt, toLL, toPx, type Zone } from "./zones";
import type { RoutePoint } from "./types";

export const AVOID_DEG = 15;
export const BLOCK_DEG = 25;
const PENALTY = 6;
const SUIT_FACTOR = 0.35;
const TAN_AVOID = Math.tan((AVOID_DEG * Math.PI) / 180);
const TAN_BLOCK = Math.tan((BLOCK_DEG * Math.PI) / 180);
const MAX_SPEED = (6 * SUIT_FACTOR) / 3.6; // m/s, the best case (gentle downhill)

/** suited walking speed in m/s for a signed slope (rise / run) */
export const speed = (s: number) => (6 * Math.exp(-3.5 * Math.abs(s + 0.05)) * SUIT_FACTOR) / 3.6;

function stepCost(dist: number, dh: number) {
  const s = dh / dist, a = Math.abs(s);
  if (a > TAN_BLOCK) return Infinity;
  const t = dist / speed(s);
  return a > TAN_AVOID ? t * PENALTY : t;
}

export interface PathResult {
  points: RoutePoint[];
  distance_m: number;
  duration_min: number;
  ascent_m: number;
  descent_m: number;
  max_slope_deg: number;
}

export function findPath(zone: Zone, h: Float32Array, from: [number, number], to: [number, number]): PathResult | null {
  const W = zone.width, H = zone.height, dx = zone.dx, dy = zone.dy;
  const cell = (ll: [number, number]) => {
    const [x, y] = toPx(zone, ll[0], ll[1]);
    return Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));
  };
  const s = cell(from), g = cell(to);
  const gx = g % W, gy = (g / W) | 0;

  // --- A* on the 8-connected grid ---
  const N = W * H;
  const cost = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const diag = Math.hypot(dx, dy);
  const NB: [number, number, number][] = [
    [1, 0, dx], [-1, 0, dx], [0, 1, dy], [0, -1, dy], [1, 1, diag], [1, -1, diag], [-1, 1, diag], [-1, -1, diag],
  ];
  const heur = (i: number) => Math.hypot(((i % W) - gx) * dx, (((i / W) | 0) - gy) * dy) / MAX_SPEED;
  const heap = new MinHeap();
  cost[s] = 0;
  heap.push(s, heur(s));
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === g) break;
    const x = i % W, y = (i / W) | 0, hi = h[i];
    for (const [ox, oy, d] of NB) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (done[j]) continue;
      const c = cost[i] + stepCost(d, h[j] - hi);
      if (c < cost[j]) {
        cost[j] = c;
        prev[j] = i;
        heap.push(j, c + heur(j));
      }
    }
  }
  if (!done[g]) return null;

  const cells: number[] = [];
  for (let i = g; i !== -1; i = prev[i]) cells.push(i);
  cells.reverse();
  // exact endpoints instead of cell centres
  const pts: [number, number][] = cells.map((i) => [(i % W) + 0.5, ((i / W) | 0) + 0.5]);
  pts[0] = toPx(zone, from[0], from[1]);
  pts[pts.length - 1] = toPx(zone, to[0], to[1]);

  // --- straighten ---
  const hAt = (x: number, y: number) => heightAt(h, W, H, x, y);
  const segment = (a: [number, number], b: [number, number]) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    const sx = (b[0] - a[0]) / n, sy = (b[1] - a[1]) / n, len = Math.hypot(sx * dx, sy * dy);
    let t = 0, maxTan = 0, h0 = hAt(a[0], a[1]);
    for (let k = 1; k <= n; k++) {
      const h1 = hAt(a[0] + sx * k, a[1] + sy * k);
      if (len > 0) {
        t += stepCost(len, h1 - h0);
        maxTan = Math.max(maxTan, Math.abs(h1 - h0) / len);
      }
      h0 = h1;
    }
    return { t, maxTan };
  };
  const along: number[] = [0], stepTan: number[] = [0];
  for (let k = 1; k < pts.length; k++) {
    const sg = segment(pts[k - 1], pts[k]);
    along.push(along[k - 1] + sg.t);
    stepTan.push(sg.maxTan);
  }
  const keep: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1;) {
    let best = i + 1, pathTan = stepTan[i + 1], misses = 0;
    for (let j = i + 2; j < pts.length && j - i <= 400 && misses < 40; j++) {
      pathTan = Math.max(pathTan, stepTan[j]);
      const sg = segment(pts[i], pts[j]);
      if (sg.t <= (along[j] - along[i]) * 1.02 + 1 && sg.maxTan <= Math.max(pathTan, TAN_AVOID)) { best = j; misses = 0; }
      else misses++;
    }
    keep.push(pts[best]);
    i = best;
  }

  // --- walk the straightened line at 1 px for the numbers, keep a point every ~2 px (~40 m) ---
  const out: RoutePoint[] = [];
  let dist = 0, time = 0, up = 0, down = 0, maxTan = 0;
  const emit = (x: number, y: number, e: number) => { const [lat, lon] = toLL(zone, x, y); out.push([lat, lon, Math.round(e * 10) / 10]); };
  let e0 = hAt(keep[0][0], keep[0][1]);
  emit(keep[0][0], keep[0][1], e0);
  let sinceEmit = 0;
  for (let k = 1; k < keep.length; k++) {
    const a = keep[k - 1], b = keep[k];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    const sx = (b[0] - a[0]) / n, sy = (b[1] - a[1]) / n, len = Math.hypot(sx * dx, sy * dy);
    for (let q = 1; q <= n; q++) {
      const x = a[0] + sx * q, y = a[1] + sy * q, e1 = hAt(x, y), dh = e1 - e0;
      if (len > 0) {
        dist += len;
        time += len / speed(dh / len);
        maxTan = Math.max(maxTan, Math.abs(dh) / len);
      }
      if (dh > 0) up += dh; else down -= dh;
      e0 = e1;
      sinceEmit += len;
      if (q === n || sinceEmit >= 40) { emit(x, y, e1); sinceEmit = 0; }
    }
  }
  return {
    points: out,
    distance_m: Math.round(dist),
    duration_min: Math.round(time / 6) / 10,
    ascent_m: Math.round(up),
    descent_m: Math.round(down),
    max_slope_deg: Math.round((Math.atan(maxTan) * 1800) / Math.PI) / 10,
  };
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p]; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys, top = ids[0];
    const id = ids.pop()!, key = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        ids[i] = ids[c]; keys[i] = keys[c]; i = c;
      }
      ids[i] = id; keys[i] = key;
    }
    return top;
  }
}
