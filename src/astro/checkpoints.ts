// Checkpoints along a route (no three.js here, so the plain pages stay light).
import { distanceM, bearingDeg } from "../lib/geo";
import type { Route } from "../lib/types";

export interface Checkpoint {
  i: number;        // index into route.points
  along: number;    // metres from the start
  label: string;
}

/** a checkpoint every ~spacing metres along the route, plus start and target */
export function checkpoints(route: Route, spacing = 250): Checkpoint[] {
  const p = route.points, out: Checkpoint[] = [{ i: 0, along: 0, label: "START" }];
  let along = 0, last = 0;
  for (let i = 1; i < p.length; i++) {
    along += distanceM(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
    if (i === p.length - 1) out.push({ i, along, label: "TARGET" });
    else if (along - last >= spacing && route.distance_m - along > spacing / 2) {
      out.push({ i, along, label: String(out.length) });
      last = along;
    }
  }
  if (out.length === 1) out.push({ i: 0, along: 0, label: "TARGET" });
  return out;
}

export function legInfo(route: Route, cps: Checkpoint[], k: number) {
  const total = cps[cps.length - 1].along || 1, here = cps[k], next = cps[Math.min(k + 1, cps.length - 1)];
  const a = route.points[here.i], b = route.points[next.i];
  return {
    nextDist: next.along - here.along,
    bearing: bearingDeg(a[0], a[1], b[0], b[1]),
    remaining: total - here.along,
    remainingMin: route.duration_min * ((total - here.along) / total),
    atEnd: k === cps.length - 1,
  };
}

/** metres from the start to each route point */
export function alongs(route: Route): number[] {
  const p = route.points, out = [0];
  for (let i = 1; i < p.length; i++) out.push(out[i - 1] + distanceM(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
  return out;
}

/** the position m metres along the route */
export function pointAt(route: Route, along: number[], m: number): [number, number] {
  const p = route.points;
  if (m <= 0 || p.length < 2) return [p[0][0], p[0][1]];
  if (m >= along[along.length - 1]) return [p[p.length - 1][0], p[p.length - 1][1]];
  let i = 1;
  while (along[i] < m) i++;
  const t = (m - along[i - 1]) / (along[i] - along[i - 1] || 1);
  return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
}

/** the last checkpoint at or behind m metres */
export function checkpointAt(cps: Checkpoint[], m: number) {
  let k = 0;
  while (k + 1 < cps.length && cps[k + 1].along <= m + 0.5) k++;
  return k;
}
