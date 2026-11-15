// Where a crew's astronaut is, for the maps of mission control and the ship: the helmet's live
// report when it is fresh, otherwise the point at the reported progress along the active route.
import { astronautAt } from "../astro/checkpoints";
import { isFresh, useTelemetry } from "./telemetry";
import type { EvaTelemetry, WorkPlan } from "./types";

export interface AstronautView {
  at: [number, number] | null;
  t: EvaTelemetry | null;       // the last report (may be stale)
  live: boolean;                // a report within the last 20 s
  trail: [number, number][];    // positions since this page opened, for the current plan
}

export function useAstronaut(crewId: string | undefined, plan: WorkPlan | null | undefined): AstronautView {
  const e = useTelemetry(crewId);
  const live = isFresh(e?.t);
  const fallback = astronautAt(plan ?? null);
  if (e && live) return { at: [e.t.lat, e.t.lon], t: e.t, live, trail: e.trail };
  return { at: fallback, t: e?.t ?? null, live: false, trail: e?.trail ?? [] };
}
