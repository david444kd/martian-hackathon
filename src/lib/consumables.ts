// What a walk costs the suit. SIMULATED for the demonstration: a simple model, not suit hardware data
// and not a medical or safety calculation.
// Consumables are spent by the metre walked, not by the clock, so the demo's fast walking shows them
// going down: on level ground a full suit lasts SUIT.*Hours of steady suited walking (pathfind's
// suited pace); a slope scales the oxygen and cooling water by the energy cost of walking it
// (uphill costs more, a gentle downhill less, a steep descent more again), and power by the time
// the slope takes. The ship's planner uses the same numbers to say what a route will use before the
// EVA starts; the helmet uses them as the astronaut walks (eva/suit.ts).
import { speed } from "./pathfind";
import type { RoutePoint } from "./types";

/** hours of steady walking on level ground one full suit lasts */
export const SUIT = { o2Hours: 8, powerHours: 9, waterHours: 8.5 };

export interface Use { o2: number; power: number; water: number } // % of a full suit

const LEVEL_S_PER_M = 1 / speed(0);
const PER_S = { o2: 100 / (SUIT.o2Hours * 3600), power: 100 / (SUIT.powerHours * 3600), water: 100 / (SUIT.waterHours * 3600) };
/** standing still, by the clock: the body at rest and the suit's own systems, as fractions of the walking rates */
const REST = { o2: 0.45, power: 0.8, water: 0.35 };

/**
 * The energy cost of walking on a slope (rise / run) relative to level ground: the polynomial fitted
 * to measured walking costs from -45 % to +45 % grade by Minetti et al. (J Appl Physiol 93, 2002),
 * divided by its level value. About 2× at +10 %, 3× at +20 %, 0.45× at -10 %, back to 1× near -32 %.
 * Measured on Earth without a suit: used here only for the shape of the curve.
 */
export function effort(slope: number) {
  const i = Math.max(-0.45, Math.min(0.45, slope));
  return (280.5 * i ** 5 - 58.7 * i ** 4 - 76.8 * i ** 3 + 51.9 * i ** 2 + 19.6 * i + 2.5) / 2.5;
}

/** what walking `len` metres with a rise of `dh` metres uses; `storm` 0..1 adds the load of thick dust */
export function legUse(len: number, dh: number, storm = 0): Use {
  if (len <= 0) return { o2: 0, power: 0, water: 0 };
  const s = dh / len, e = effort(s), level = len * LEVEL_S_PER_M, time = len / speed(Math.max(-0.45, Math.min(0.45, s)));
  return {
    o2: level * PER_S.o2 * e * (1 + storm * 0.15),
    water: level * PER_S.water * e,
    power: time * PER_S.power * (0.8 + 0.2 * e) * (1 + storm * 0.5),
  };
}

/** what `seconds` without walking use (standing, or working at the site: `work` 0 rest .. 1 as hard as walking) */
export function idleUse(seconds: number, work = 0, storm = 0): Use {
  const k = (r: number) => r + (1 - r) * work;
  return { o2: seconds * PER_S.o2 * k(REST.o2), power: seconds * PER_S.power * k(REST.power) * (1 + storm * 0.5), water: seconds * PER_S.water * k(REST.water) };
}

export const addUse = (a: Use, b: Use): Use => ({ o2: a.o2 + b.o2, power: a.power + b.power, water: a.water + b.water });
export const worst = (u: Use) => Math.max(u.o2, u.power, u.water);

/**
 * What walking a route uses, from `fromM` metres along it to its end (`along`: metres to each point);
 * `reverse`: walking it the other way (the way back along the same line).
 */
export function routeUse(points: RoutePoint[], along: number[], fromM = 0, reverse = false): Use {
  let out: Use = { o2: 0, power: 0, water: 0 };
  for (let i = 1; i < points.length; i++) {
    if (along[i] <= fromM) continue;
    const a0 = Math.max(along[i - 1], fromM), len = along[i] - a0, full = along[i] - along[i - 1] || 1;
    const dh = (points[i][2] - points[i - 1][2]) * (len / full);
    out = addUse(out, legUse(len, reverse ? -dh : dh));
  }
  return out;
}

/** minutes of level walking a consumable at `pct` still gives */
export const minutesLeft = (pct: Use): Use => ({ o2: (pct.o2 / 100) * SUIT.o2Hours * 60, power: (pct.power / 100) * SUIT.powerHours * 60, water: (pct.water / 100) * SUIT.waterHours * 60 });

// ---- slope classes, shared by the planner's map line and its elevation profile
export interface SlopeClass { key: "steep_down" | "down" | "level" | "up" | "steep_up"; color: string; min: number }
/** signed slope in degrees along the direction of travel → class; a blue ↔ red scale with a neutral middle */
export const SLOPE_CLASSES: SlopeClass[] = [
  { key: "steep_down", color: "#3f78e0", min: -Infinity },
  { key: "down", color: "#9bbcf2", min: -8 },
  { key: "level", color: "#e9e6df", min: -2.5 },
  { key: "up", color: "#f4a48c", min: 2.5 },
  { key: "steep_up", color: "#e0412f", min: 8 },
];
export const slopeDegOf = (len: number, dh: number) => (len > 0 ? (Math.atan(dh / len) * 180) / Math.PI : 0);
export function slopeClass(deg: number) {
  let c = SLOPE_CLASSES[0];
  for (const k of SLOPE_CLASSES) if (deg >= k.min) c = k;
  return c;
}
