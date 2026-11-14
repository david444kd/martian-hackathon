// The suit's life-support readouts. SIMULATED for the demo: a simple model driven by how hard the
// astronaut is walking (speed, uphill), the outside conditions (dust, radiation) and alarms. These
// are not measurements of a person or of real suit hardware.
import { load, save } from "../lib/storage";

export interface SuitState {
  o2Pct: number;        // primary O2 tank
  pulse: number;        // bpm
  resp: number;         // breaths / min
  co2: number;          // mmHg in the helmet
  kpa: number;          // suit pressure
  batteryPct: number;
  doseUSv: number;      // accumulated this EVA
  exertion: number;     // 0..1
  status: "NOMINAL" | "CAUTION" | "WARNING";
  remainingMin: number; // O2 time left at the current rate
}

const NOMINAL_KPA = 29.6;
const O2_HOURS = 8;                     // a full tank at rest
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
      batteryPct: prev?.batteryPct ?? 100, doseUSv: prev?.doseUSv ?? 0, exertion: 0, status: "NOMINAL", remainingMin: O2_HOURS * 60,
    };
  }
  /** a new EVA: fresh consumables */
  reset() {
    this.s = { ...this.s, o2Pct: 100, batteryPct: 100, doseUSv: 0 };
    save(KEY(this.crew), { o2Pct: 100, batteryPct: 100, doseUSv: 0 });
  }
  /**
   * advance by dt seconds. speed m/s over the ground, climb: rise per metre walked (+ uphill),
   * dose: µSv/h outside, alarm: an unacknowledged warning (stress), storm: 0..1 dust load.
   */
  step(dt: number, speed: number, climb: number, doseRate: number, alarm: number, storm: number) {
    const s = this.s;
    const walk = Math.min(1, speed / 1.4), up = Math.max(0, Math.min(1, climb * 6));
    const work = Math.min(1, walk * 0.7 + up * 0.5 + storm * 0.25 + (speed > 2 ? 0.2 : 0));
    s.exertion += (work - s.exertion) * Math.min(1, dt / 6);
    const target = 72 + s.exertion * 46 + alarm * 14 + storm * 6;
    s.pulse += (target - s.pulse) * Math.min(1, dt / 9);
    s.resp += (12 + s.exertion * 12 + alarm * 4 - s.resp) * Math.min(1, dt / 7);
    s.co2 += (1.4 + s.exertion * 2.6 + storm * 0.6 + (Math.random() - 0.5) * 0.15 - s.co2) * Math.min(1, dt / 15);
    s.kpa = NOMINAL_KPA + Math.sin(performance.now() / 9000) * 0.04;
    const rate = (100 / (O2_HOURS * 3600)) * (1 + s.exertion * 1.4); // % per second
    s.o2Pct = Math.max(0, s.o2Pct - rate * dt);
    s.batteryPct = Math.max(0, s.batteryPct - (100 / (9 * 3600)) * (1 + storm * 0.5) * dt);
    s.doseUSv += (doseRate * dt) / 3600;
    s.remainingMin = s.o2Pct / rate / 60;
    s.status = s.o2Pct < 15 || s.co2 > 7.5 || doseRate > 300 ? "WARNING" : s.o2Pct < 30 || s.co2 > 6 || doseRate > 80 || storm > 0.5 ? "CAUTION" : "NOMINAL";
    this.saved += dt;
    if (this.saved > 5) { this.saved = 0; save(KEY(this.crew), { o2Pct: s.o2Pct, batteryPct: s.batteryPct, doseUSv: s.doseUSv }); }
  }
}
