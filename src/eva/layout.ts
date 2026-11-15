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
 * A walking line bent round solid things: wherever it passes within `margin` of a footprint its
 * points are moved out to that distance, on the side the line already leans to. Elsewhere unchanged.
 */
export function clearOf(pts: P2[], solids: Closed[], margin = 1.8): P2[] {
  if (!solids.length || pts.length < 2) return pts;
  const reach = (c: Closed) => c.r + margin;
  const out: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), l2 = len * len || 1;
    // only the stretches that come near a footprint get the extra points the bend needs
    const near = solids.some((c) => { const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2)); return Math.hypot(c.x - (a.x + dx * t), c.z - (a.z + dz * t)) < reach(c) + 1; });
    if (near) for (let k = 1, n = Math.ceil(len / 1.2); k < n; k++) out.push({ x: a.x + (dx * k) / n, z: a.z + (dz * k) / n });
    out.push(b);
  }
  let moved = false;
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < out.length; i++) for (const c of solids) {
    const p = out[i], d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d >= reach(c)) continue;
    const ux = d > 0.01 ? (p.x - c.x) / d : 1, uz = d > 0.01 ? (p.z - c.z) / d : 0;
    out[i] = { x: c.x + ux * reach(c), z: c.z + uz * reach(c) };
    moved = true;
  }
  return moved ? out : pts;
}
