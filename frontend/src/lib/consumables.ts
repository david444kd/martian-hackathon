// What a walk on Mars costs the suit. SIMULATED for the demonstration: a simple model built on
// published figures from real EVAs, not suit hardware data and not a medical or safety calculation.
//
// What the numbers rest on (docs/SOURCES.md has the references):
//  - Apollo lunar-surface EVAs, measured: riding the rover 442–633 Btu/h (near rest in a suit);
//    walking on the level at 0.9 m/s 1112–1185 Btu/h; the same pace carrying a heavy package up a
//    5 % slope 2300 Btu/h, among the highest of any EVA; mission averages 750–1118 Btu/h against a
//    life-support design point of 1200 Btu/h.
//  - NASA's Mark III suit tests (121 kg suit): below 4 km/h the suit's weight hardly changes the cost
//    of walking and its pressure does not: most of the cost is working the suit itself.
//  - Walking with a load: the Pandolf equation's terms for speed and grade, per kilogram carried,
//    and its terrain factor for loose ground.
// What is different on Mars and is put in here: gravity 0.38 g (a suited astronaut weighs about
// 2.9 times what an Apollo moonwalker did, so everything that is weight — climbing above all — costs
// that much more), loose regolith underfoot, the cold (a little heat leaks away, heaters draw power),
// dust (the fan works harder). What is assumed, not measured: the suit's mass, its endurance, the
// tools carried, and that the Earth-based load equation carries over at Mars weight.
//
// The astronaut is on foot, so the metabolic rate is worked out for every stretch of the walk from its
// slope and the pace a suited walker keeps on it (lib/pathfind.ts), and oxygen, cooling water and
// power are drawn accordingly. Tiredness is what limits a walk before the tanks do: it builds with
// every stretch walked, fast on a climb (a level kilometre takes about a third of what the astronaut
// has, a kilometre up a 10 % slope more than all of it), slows the pace, makes every further step
// dearer, and only eases at a standstill. How fast it builds is the owner's judgement of a person
// walking in a heavy suit, not a published figure. Consumables go by the metre walked (plus what standing costs
// by the clock), so the demo's fast walking shows them going down. The ship's planner uses the same
// numbers to say what a route will use before the EVA starts (components/RouteProfile.tsx).
import { speed } from "./pathfind";
import type { RoutePoint } from "./types";

const W_PER_BTU_H = 0.29307;
/** the astronaut and what is carried, kg (assumed; the suit is the Mark III test configuration) */
export const MASS = { body: 80, suit: 121, tools: 15 };
const G_MARS = 0.379;
/** what all of it weighs on Mars, in kilograms-force as the load equation takes it */
const WEIGHT = (MASS.body + MASS.suit + MASS.tools) * G_MARS;
/** loose regolith: between a gravel road (1.2) and loose sand (2.1) in the load equation's terrain factors */
const TERRAIN = 1.5;
/** metabolic rate at rest in the suit, W (Apollo, riding the rover: 442–633 Btu/h) */
const REST_W = 155;
/** working the suit's joints while walking, W per m/s (what is left of Apollo's 1112–1185 Btu/h at 0.9 m/s after rest and weight) */
const SUIT_W_PER_MS = 142;
/** the life support is sized for this average metabolic rate over its endurance (1000 Btu/h; Apollo's design point was 1200) */
export const DESIGN_W = 1000 * W_PER_BTU_H;
/** hours one full suit lasts at the design rate (oxygen, cooling water) and at its electrical design load (power) */
export const SUIT = { o2Hours: 8, powerHours: 9, waterHours: 8 };
/** electronics, fan and pump, W; and the heat they add to what the cooling water must carry away */
const ELEC_W = 80, EQUIP_HEAT_W = 100;

export interface Use { o2: number; power: number; water: number } // % of a full suit
/** what the walk is done in: dust 0..1, air temperature °C, how tired 0..1 */
export interface Conditions { storm?: number; tempC?: number; fatigue?: number }

/**
 * The energy cost of walking down a slope relative to level ground: the polynomial fitted to measured
 * walking costs by Minetti et al. (J Appl Physiol 93, 2002) divided by its level value — a gentle
 * descent is cheaper, a steep one costs more again. Used only for going down; climbing is the load equation's.
 */
function descent(slope: number) {
  const i = Math.max(-0.45, Math.min(0, slope));
  return (280.5 * i ** 5 - 58.7 * i ** 4 - 76.8 * i ** 3 + 51.9 * i ** 2 + 19.6 * i + 2.5) / 2.5;
}

/** metabolic rate, W, walking at `v` m/s on a slope (rise / run), on Mars, in the suit */
export function walkPower(v: number, slope: number, c: Conditions = {}) {
  if (v <= 0) return REST_W;
  const grade = Math.max(0, Math.min(0.45, slope)) * 100;
  // moving the suit and the weight along, then lifting the weight up the slope
  const along = (SUIT_W_PER_MS * v + TERRAIN * WEIGHT * 1.5 * v * v) * descent(slope);
  const climb = TERRAIN * WEIGHT * 0.35 * v * grade;
  return REST_W + (along + climb) * (1 + (c.fatigue ?? 0) * 0.5) * (1 + (c.storm ?? 0) * 0.15);
}

/** how hard that is for the body, 0 (rest) .. 1 (all it has): for pulse, breathing and the suit's status */
export const strain = (watts: number) => Math.max(0, Math.min(1, (watts - REST_W) / 450));

/** a tired walker is slower: the pace falls to 65 % when exhausted */
export const paceOf = (fatigue: number) => 1 - 0.35 * Math.max(0, Math.min(1, fatigue));
/** minutes of standing still, on the mission's clock, that take exhaustion down to half */
export const REST_STOP_MIN = 15;

/**
 * Tiredness after walking for `seconds` at `watts`. It grows with how far above rest the body is
 * working, faster than in proportion: a level kilometre at the suited pace adds ~0.3, a kilometre up
 * a 10 % slope ~1.1 (i.e. it cannot be done without stopping), a gentle descent ~0.1.
 */
export function tire(fatigue: number, watts: number, seconds: number) {
  const hard = Math.max(0, (watts - REST_W) / (DESIGN_W - REST_W));
  return Math.max(0, Math.min(1, fatigue + 1.95e-4 * Math.pow(hard, 1.5) * seconds));
}
/** tiredness after standing still for `seconds`; `fullIn`: seconds that take it from 1 to 0 */
export const recover = (fatigue: number, seconds: number, fullIn = REST_STOP_MIN * 120) => Math.max(0, fatigue - seconds / fullIn);

/** what `seconds` at a metabolic rate of `watts` draw from the suit */
function draw(watts: number, seconds: number, c: Conditions): Use {
  const cold = Math.max(0, -(c.tempC ?? -60));
  // the cooling water carries off the body's heat and the equipment's, less what leaks to the cold air through the suit
  const heat = Math.max(60, watts + EQUIP_HEAT_W - Math.min(60, Math.max(0, cold - 20) * 0.8));
  // power: electronics, a fan and pump that work harder with the load and in dust, glove and boot heaters in deep cold
  const elec = (ELEC_W + (watts - REST_W) * 0.03 + Math.min(40, Math.max(0, cold - 30) * 0.6)) * (1 + (c.storm ?? 0) * 0.5);
  return {
    o2: (watts * seconds * 100) / (DESIGN_W * SUIT.o2Hours * 3600),
    water: (heat * seconds * 100) / ((DESIGN_W + EQUIP_HEAT_W) * SUIT.waterHours * 3600),
    power: (elec * seconds * 100) / (ELEC_W * SUIT.powerHours * 3600),
  };
}

/** walking `len` metres with a rise of `dh` metres at the suited pace for that slope: what it uses, the rate and the time it takes */
export function legUse(len: number, dh: number, c: Conditions = {}): Use & { watts: number; seconds: number } {
  if (len <= 0) return { o2: 0, power: 0, water: 0, watts: REST_W, seconds: 0 };
  const s = Math.max(-0.45, Math.min(0.45, dh / len)), v = speed(s) * paceOf(c.fatigue ?? 0), watts = walkPower(v, s, c), seconds = len / v;
  return { ...draw(watts, seconds, c), watts, seconds };
}

/** `seconds` without walking: standing (work 0) up to working at the site about as hard as an Apollo geology stop (work 1 ≈ 1000 Btu/h) */
export function idleUse(seconds: number, work = 0, c: Conditions = {}): Use {
  return draw(REST_W + (DESIGN_W - REST_W) * work, seconds, c);
}

export const addUse = (a: Use, b: Use): Use => ({ o2: a.o2 + b.o2, power: a.power + b.power, water: a.water + b.water });
export const worst = (u: Use) => Math.max(u.o2, u.power, u.water);

/**
 * What walking a route uses, from `fromM` metres along it to its end (`along`: metres to each point);
 * `reverse`: walking it the other way (the way back along the same line). Tiredness carries along the
 * walk from `c.fatigue`; when it runs out the walker stops for REST_STOP_MIN minutes (counted in `rests`,
 * their time and consumables included). The result also gives how hard the walking was and how tired it leaves you.
 */
export function routeUse(points: RoutePoint[], along: number[], fromM = 0, reverse = false, c: Conditions = {}) {
  let use: Use = { o2: 0, power: 0, water: 0 }, fatigue = c.fatigue ?? 0, joules = 0, seconds = 0, peak = REST_W, rests = 0, walking = 0;
  const n = points.length;
  for (let k = 1; k < n; k++) {
    const i = reverse ? n - k : k; // the same stretches, taken from the far end when walking back
    if (along[i] <= fromM) continue;
    const a0 = Math.max(along[i - 1], fromM), len = along[i] - a0, full = along[i] - along[i - 1] || 1;
    const dh = (points[i][2] - points[i - 1][2]) * (len / full);
    const leg = legUse(len, reverse ? -dh : dh, { ...c, fatigue });
    use = addUse(use, leg); joules += leg.watts * leg.seconds; seconds += leg.seconds; walking += leg.seconds; peak = Math.max(peak, leg.watts);
    fatigue = tire(fatigue, leg.watts, leg.seconds);
    if (fatigue >= 1 && k < n - 1) { rests++; use = addUse(use, idleUse(REST_STOP_MIN * 60, 0, c)); seconds += REST_STOP_MIN * 60; fatigue = 0.5; }
  }
  return { ...use, fatigue, seconds, rests, peak, mean: walking > 0 ? joules / walking : REST_W };
}

/** minutes of work at the design rate a consumable at `pct` still gives */
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
