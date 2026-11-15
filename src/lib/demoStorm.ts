// Demo control: raise a dust storm for a crew with one tap (the phone page /demo and the small button
// on the ship console's map), and clear the storms again to reset the demo. The storm is an ordinary
// `events` row, so every app sees it the usual way: the globe and maps draw it, the helmet sounds the
// alarm and routes back to base. Placement is chosen so the demo shows that chain:
//   EVA under way  → just ahead of the astronaut on the rest of the route (not over them);
//   route planned  → over the middle of the route;
//   otherwise      → about a kilometre from the landing site.
// A simulated event for demonstrations: not a weather observation or a forecast.
import { useTranslation } from "react-i18next";
import { useCreateEvent, useUpdateEvent } from "./queries";
import { distanceM } from "./geo";
import { alongs, pointAt } from "../astro/checkpoints";
import { crewHome, toLL, toPx, type Zone } from "./zones";
import { EVENT_KINDS, type Crew, type MarsEvent, type NewEvent, type WorkPlan } from "./types";
import { isActive } from "./mars";

const AHEAD_M = 450;      // centre of the storm this far ahead of the astronaut along the route
const RADIUS_M = 420;
const MIN_CLEAR_M = 60;   // keep the astronaut at least this far outside the edge
const DURATION_MIN = 20;

/** where the demo storm goes and how big it is */
export function placeDemoStorm(crew: Crew, zone: Zone, plan: WorkPlan | null | undefined, at: [number, number] | null): { center: [number, number]; radius: number } {
  const route = plan?.route;
  if (route && route.points.length > 1 && route.mode !== "return") {
    const along = alongs(route), total = along[along.length - 1];
    if (plan.status === "in_progress") {
      const progress = plan.progress_m ?? 0;
      const center = pointAt(route, along, Math.min(progress + AHEAD_M, Math.max(progress, total - 60)));
      let radius = RADIUS_M;
      if (at) {
        const d = distanceM(at[0], at[1], center[0], center[1]);
        radius = Math.max(200, Math.min(RADIUS_M, d - MIN_CLEAR_M));
      }
      return { center: clampToZone(zone, center), radius };
    }
    return { center: clampToZone(zone, pointAt(route, along, total / 2)), radius: RADIUS_M };
  }
  const home = crewHome(crew, zone) ?? [zone.base.lat, zone.base.lon];
  const a = Math.random() * Math.PI * 2;
  const [hx, hy] = toPx(zone, home[0], home[1]), d = 1000 / zone.dx;
  return { center: clampToZone(zone, toLL(zone, hx + Math.cos(a) * d, hy + Math.sin(a) * d)), radius: 600 };
}

function clampToZone(zone: Zone, [lat, lon]: [number, number]): [number, number] {
  const [x, y] = toPx(zone, lat, lon);
  return toLL(zone, Math.min(zone.width - 20, Math.max(20, x)), Math.min(zone.height - 20, Math.max(20, y)));
}

/** active storms in the zone (what "clear" ends) */
export const zoneStorms = (evs: MarsEvent[], zoneId: string, now: number) =>
  evs.filter((e) => e.zone === zoneId && (e.kind === "dust_storm" || e.kind === "dust_devil") && isActive(e, now));

export function useDemoStorm() {
  const { t } = useTranslation();
  const create = useCreateEvent(), update = useUpdateEvent();

  /** raise the storm now, critical, for 20 minutes */
  const raise = (crew: Crew, zone: Zone, plan: WorkPlan | null | undefined, at: [number, number] | null, opts?: { onSuccess?: () => void }) => {
    const { center, radius } = placeDemoStorm(crew, zone, plan, at);
    const now = Date.now();
    const row: NewEvent = {
      kind: "dust_storm", level: "critical", source: "dispatch",
      zone: zone.id, crew_id: null,
      lat: center[0], lon: center[1], radius_m: Math.round(radius),
      starts_at: new Date(now).toISOString(),
      ends_at: new Date(now + DURATION_MIN * 60_000).toISOString(),
      title: "", // shown with the usual localised "Dust storm" label, like any other storm
      text: t("event_kinds.dust_storm.text", { defaultValue: EVENT_KINDS.dust_storm.text }),
    };
    create.mutate(row, { onSuccess: () => opts?.onSuccess?.() });
  };

  /** end every active storm in the zone now */
  const clear = async (storms: MarsEvent[]) => {
    const at = new Date().toISOString();
    await Promise.all(storms.map((e) => update.mutateAsync({ id: e.id, patch: { ends_at: at } })));
  };

  return { raise, clear, raising: create.isPending, clearing: update.isPending, error: create.error ?? update.error };
}
