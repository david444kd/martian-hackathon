// Where the outpost's solid parts stand, relative to the crew's landing point — plain numbers, no
// three.js, so the mission logic can bend the guidance line round them (the ship's planner works on
// the 20 m terrain grid and knows nothing of the base, which is authored dressing: Structures.tsx).
import type { P2 } from "./frame";
import type { Closed } from "./runtime";

/** the habitat's centre, m north (-z) of the landing point: you start a few steps from the foot of the airlock ladder */
export const HAB_OFFSET = -12.5;
export const ROVER = { x: -8, z: 12, yaw: 0.55 };

/** the outpost's footprints as circles, in the local frame, for a landing point at `home` */
export function outpostSolids(home: P2): Closed[] {
  const H = { x: home.x, z: home.z + HAB_OFFSET };
  return [
    { x: H.x, z: H.z, r: 5 },                                              // habitat
    { x: H.x - 15, z: H.z, r: 3.4 }, { x: H.x - 19.5, z: H.z, r: 3.4 },      // lab module
    { x: H.x - 9, z: H.z, r: 1.6 },                                         // tunnel
    { x: H.x + ROVER.x, z: H.z + ROVER.z, r: 3.6 },                          // rover
    { x: H.x + 24, z: H.z, r: 9.5 },                                        // solar farm
    { x: H.x + 9, z: H.z - 13, r: 1.6 },                                    // mast
    { x: H.x - 17, z: H.z - 6, r: 2.6 },                                    // tanks
    { x: H.x + 9, z: H.z + 9, r: 2.2 },                                     // cargo
  ];
}

/**
 * A walking line led round solid things. The route comes from a planner on the 20 m terrain grid that
 * knows nothing of the base, so it may cross a building, or the habitat–tunnel–lab row, which together
 * are a wall ~30 m long. Wherever the line runs within `margin` of a footprint, that stretch is
 * replaced by a detour found with A* on a 1 m grid round the obstacles (8 directions, clear of every
 * footprint by `margin`), then straightened where the way is clear. Elsewhere the line is unchanged.
 */
export function clearOf(pts: P2[], solids: Closed[], margin = 1.8): P2[] {
  if (!solids.length || pts.length < 2) return pts;
  const blocked = (p: P2, extra = 0) => solids.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r + margin + extra);
  // a start or an end that falls on a building moves out of it first (to the side it already lies on)
  const outOf = (p: P2): P2 => {
    let q = p;
    for (let pass = 0; pass < 4 && blocked(q); pass++) for (const c of solids) {
      const d = Math.hypot(q.x - c.x, q.z - c.z), r = c.r + margin + 0.3;
      if (d < r) q = d > 0.01 ? { x: c.x + ((q.x - c.x) / d) * r, z: c.z + ((q.z - c.z) / d) * r } : { x: c.x + r, z: c.z };
    }
    return q;
  };
  pts = [outOf(pts[0]), ...pts.slice(1, -1), outOf(pts[pts.length - 1])];
  // the line in 1 m steps, so a crossing between two far-apart route points is seen
  const dense: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let k = 1; k <= n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  if (!dense.some((p) => blocked(p))) return pts;
  const out: P2[] = [];
  let i = 0;
  while (i < dense.length) {
    if (!blocked(dense[i])) { out.push(dense[i]); i++; continue; }
    // a blocked run: from the last free point before it to the first free point after it
    let j = i;
    while (j < dense.length && blocked(dense[j])) j++;
    const from = out.length ? out[out.length - 1] : dense[i], to = j < dense.length ? dense[j] : null;
    // the run starts or ends inside a footprint (a start or target on the base itself): leave it
    const path = to && !blocked(from) ? detour(from, to, solids, margin) : null;
    if (path) out.push(...path.slice(1, -1));
    else for (let k = i; k < j; k++) out.push(dense[k]);
    i = j;
  }
  return simplify(out, (a, b) => clearSeg(a, b, blocked));
}

/** is the straight walk from a to b clear of every footprint */
function clearSeg(a: P2, b: P2, blocked: (p: P2, extra?: number) => boolean) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
  for (let k = 0; k <= n; k++) if (blocked({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n }, -0.05)) return false;
  return true;
}

/** keep a point only where the line has to turn: from each kept point, the farthest one reachable straight */
function simplify(pts: P2[], clear: (a: P2, b: P2) => boolean): P2[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 400);
    while (j > i + 1 && !clear(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** A* on a 1 m grid between two free points, round the footprints; null if there is no way within the box */
function detour(from: P2, to: P2, solids: Closed[], margin: number): P2[] | null {
  const near = solids.filter((c) => Math.hypot(c.x - (from.x + to.x) / 2, c.z - (from.z + to.z) / 2) < Math.hypot(to.x - from.x, to.z - from.z) / 2 + c.r + 40);
  const pad = 30 + Math.max(0, ...near.map((c) => c.r + margin));
  const x0 = Math.min(from.x, to.x, ...near.map((c) => c.x - c.r)) - pad, z0 = Math.min(from.z, to.z, ...near.map((c) => c.z - c.r)) - pad;
  const x1 = Math.max(from.x, to.x, ...near.map((c) => c.x + c.r)) + pad, z1 = Math.max(from.z, to.z, ...near.map((c) => c.z + c.r)) + pad;
  const W = Math.ceil(x1 - x0) + 1, H = Math.ceil(z1 - z0) + 1;
  if (W * H > 400_000) return null;
  const free = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + i, z = z0 + j;
    free[j * W + i] = near.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r + margin) ? 1 : 0;
  }
  const cell = (p: P2) => Math.round(p.z - z0) * W + Math.round(p.x - x0);
  const s = cell(from), g = cell(to);
  free[s] = 1; free[g] = 1;
  const gx = g % W, gz = (g / W) | 0;
  const cost = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
  const heap: [number, number][] = [];
  const push = (id: number, f: number) => {
    heap.push([f, id]);
    let k = heap.length - 1;
    while (k > 0) { const q = (k - 1) >> 1; if (heap[q][0] <= heap[k][0]) break; [heap[q], heap[k]] = [heap[k], heap[q]]; k = q; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; }
    }
    return top[1];
  };
  cost[s] = 0; push(s, 0);
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const id = pop();
    if (done[id]) continue;
    done[id] = 1;
    if (id === g) break;
    const x = id % W, z = (id / W) | 0;
    for (const [dx, dz, w] of D) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const n = nz * W + nx;
      if (!free[n] || done[n]) continue;
      if (dx && dz && (!free[z * W + nx] || !free[nz * W + x])) continue; // no cutting a corner
      const c = cost[id] + w;
      if (c < cost[n]) { cost[n] = c; prev[n] = id; push(n, c + Math.hypot(nx - gx, nz - gz)); }
    }
  }
  if (!done[g]) return null;
  const path: P2[] = [];
  for (let id = g; id !== -1; id = prev[id]) path.push({ x: x0 + (id % W), z: z0 + ((id / W) | 0) });
  path.reverse();
  path[0] = from; path[path.length - 1] = to;
  return path;
}
