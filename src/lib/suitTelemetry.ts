import type { Conditions } from "./mars";

/** Clearly simulated suit readouts for the demo, derived from the app's shared Mars conditions. */
export interface SuitTelemetry {
  pulseBpm: number;
  oxygenReservePct: number;
  suitLoadPct: number;
}

export function suitTelemetry(input: {
  startedAt: string | null;
  now: number;
  conditions: Conditions | null;
  dustStorm: boolean;
}): SuitTelemetry {
  const tau = input.conditions?.tau ?? 0.5;
  const wind = input.conditions?.windMs ?? 0;
  const dustLoad = clamp((tau - 0.5) / 3.5, 0, 1);
  const windLoad = clamp(wind / 40, 0, 1);
  const load = clamp(dustLoad * 0.58 + windLoad * 0.22 + (input.dustStorm ? 0.2 : 0), 0, 1);
  const started = input.startedAt ? Date.parse(input.startedAt) : Number.NaN;
  const elapsedMinutes = Math.max(0, (input.now - (Number.isFinite(started) ? started : input.now)) / 60_000);

  return {
    pulseBpm: Math.round(72 + load * 46),
    oxygenReservePct: clamp(100 - elapsedMinutes * (0.08 + load * 0.16), 0, 100),
    suitLoadPct: Math.round(load * 100),
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
