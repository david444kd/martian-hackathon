// The suit's life-support readouts. SIMULATED for the demo: a simple model driven by how far the
// astronaut walks and over what slope (lib/consumables.ts: oxygen, power and cooling water are spent
// by the metre, more uphill, less on a gentle descent), the outside conditions (dust, radiation) and
// alarms. A full suit at the start of each EVA; topped up again at the airlock. These are not
// measurements of a person or of real suit hardware.
import { load, save } from "../lib/storage";
import { addUse, effort, idleUse, legUse, minutesLeft, type Use } from "../lib/consumables";

export interface SuitState {
  o2Pct: number;        // primary O2 tank
  pulse: number;        // bpm
  resp: number;         // breaths / min
  co2: number;          // mmHg in the helmet
  kpa: number;          // suit pressure
  batteryPct: number;
  waterPct: number;     // cooling (feed)water
  doseUSv: number;      // accumulated this EVA
  exertion: number;     // 0..1
  status: "NOMINAL" | "CAUTION" | "WARNING";
  remainingMin: number; // O2 time left at the current rate
  batteryMin: number;   // battery time left at the current rate
  waterMin: number;     // cooling water time left at the current rate
  /** the least of the three expected to be left on reaching the airlock, % (negative: not enough) */
  reservePct: number;
}

const NOMINAL_KPA = 29.6;
const KEY = (crew: string) => `mars-ops.suit.${crew}`;

export class SuitModel {
  s: SuitState;
  private crew: string;
  private saved = 0;
  constructor(crew: string) {
    this.crew = crew;
    const prev = load<Partial<SuitState> | null>(KEY(crew), null);
    this.s = {
      o2Pct: prev?.o2Pct ?? 100, pulse: 74, resp: 13, co2: 1.6, kpa: NOMINAL_KPA,
      batteryPct: prev?.batteryPct ?? 100, waterPct: prev?.waterPct ?? 100, doseUSv: prev?.doseUSv ?? 0, exertion: 0, status: "NOMINAL",
      remainingMin: 0, batteryMin: 0, waterMin: 0, reservePct: 100,
    };
    this.times();
  }
  /** a new EVA: fresh consumables */
  reset() {
    this.s = { ...this.s, o2Pct: 100, batteryPct: 100, waterPct: 100, doseUSv: 0, reservePct: 100 };
    this.times();
    save(KEY(this.crew), { o2Pct: 100, batteryPct: 100, waterPct: 100, doseUSv: 0 });
  }
  private times() {
    const s = this.s, m = minutesLeft({ o2: s.o2Pct, power: s.batteryPct, water: s.waterPct });
    s.remainingMin = m.o2; s.batteryMin = m.power; s.waterMin = m.water;
  }
  /** at the airlock: the umbilical tops the suit up, ~1.5 % a second */
  recharge(dt: number) {
    const s = this.s, up = (v: number) => Math.min(100, v + dt * 1.5);
    s.o2Pct = up(s.o2Pct); s.batteryPct = up(s.batteryPct); s.waterPct = up(s.waterPct);
    this.times();
  }
  /**
   * advance by dt seconds in which the astronaut walked `moved` metres over the ground and rose
   * `rise` metres (negative: went down). dose: µSv/h outside, alarm: an unacknowledged warning
   * (stress), storm: 0..1 dust load, need: what the way back to the airlock is expected to use.
   */
  step(dt: number, moved: number, rise: number, doseRate: number, alarm: number, storm: number, need: Use | null = null) {
    const s = this.s;
    const slope = moved > 0.05 ? rise / moved : 0;
    // how hard the body is working: a steady walk on the level is ~0.45, a real climb is flat out
    const work = Math.min(1, (moved > 0.05 ? Math.max(0.15, 0.45 * Math.pow(effort(slope), 0.7)) : 0) + storm * 0.25);
    s.exertion += (work - s.exertion) * Math.min(1, dt / 6);
    const target = 72 + s.exertion * 46 + alarm * 14 + storm * 6;
    s.pulse += (target - s.pulse) * Math.min(1, dt / 9);
    s.resp += (12 + s.exertion * 12 + alarm * 4 - s.resp) * Math.min(1, dt / 7);
    s.co2 += (1.4 + s.exertion * 2.6 + storm * 0.6 + (Math.random() - 0.5) * 0.15 - s.co2) * Math.min(1, dt / 15);
    s.kpa = NOMINAL_KPA + Math.sin(performance.now() / 9000) * 0.04;
    // spent by the metre walked (more uphill, less downhill), plus the little that standing costs by the clock
    const used = addUse(legUse(moved, rise, storm), idleUse(dt, 0, storm));
    s.o2Pct = Math.max(0, s.o2Pct - used.o2);
    s.batteryPct = Math.max(0, s.batteryPct - used.power);
    s.waterPct = Math.max(0, s.waterPct - used.water);
    s.doseUSv += (doseRate * dt) / 3600;
    this.times();
    if (need) s.reservePct = Math.min(s.o2Pct - need.o2, s.batteryPct - need.power, s.waterPct - need.water);
    const low = Math.min(s.o2Pct, s.batteryPct, s.waterPct);
    s.status = low < 15 || s.reservePct < 10 || s.co2 > 7.5 || doseRate > 300 ? "WARNING" : low < 30 || s.reservePct < 25 || s.co2 > 6 || doseRate > 80 || storm > 0.5 ? "CAUTION" : "NOMINAL";
    this.saved += dt;
    if (this.saved > 5) { this.saved = 0; save(KEY(this.crew), { o2Pct: s.o2Pct, batteryPct: s.batteryPct, waterPct: s.waterPct, doseUSv: s.doseUSv }); }
  }
}
