// Rows of the two Supabase tables (supabase/schema.sql) and the route the ship stores in a plan.

export type PlanStatus = "draft" | "assigned" | "in_progress" | "done";
export const STATUSES: PlanStatus[] = ["draft", "assigned", "in_progress", "done"];
export const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_progress: "In progress",
  done: "Done",
};

export interface Crew {
  id: string;
  name: string;
  ship: string;
  zone: string;        // operation zone it landed in
  lat: number | null;  // landing point (null: the zone's base)
  lon: number | null;
  created_at: string;
}

/** [lat, lon, elevation m] */
export type RoutePoint = [number, number, number];

export interface Route {
  start: { lat: number; lon: number; name: string };
  target: { lat: number; lon: number }; // the plan's target when the route was made
  points: RoutePoint[];                 // every ~40 m along the walk, start and target included
  distance_m: number;
  duration_min: number;                 // suited walking time
  ascent_m: number;
  descent_m: number;
  max_slope_deg: number;
  generated_at: string;
}

export interface WorkPlan {
  id: string;
  crew_id: string;
  title: string;
  description: string;
  zone: string;
  target_lat: number;
  target_lon: number;
  status: PlanStatus;
  scheduled_at: string | null;
  route: Route | null;
  started_at: string | null;  // when the ship started the EVA
  progress_m: number | null;  // helmet telemetry: metres walked along the route
  created_at: string;
  updated_at: string;
}

export type NewCrew = Pick<Crew, "name" | "ship" | "zone" | "lat" | "lon">;
export type NewPlan = Pick<WorkPlan, "crew_id" | "title" | "description" | "zone" | "target_lat" | "target_lon" | "status" | "scheduled_at">;
export type PlanPatch = Partial<Omit<WorkPlan, "id" | "created_at" | "updated_at">>;

// ------------------------------------------------------------------------------------------------
// The third table, `events`: everything that happens around the crews and has to be seen by all three
// apps at once. Anomalies (a dust storm over part of a zone, a solar particle event planet-wide) and
// messages (mission control or the ship to a crew). One with starts_at in the future is a forecast.

export type EventKind = "dust_storm" | "dust_devil" | "rockfall" | "solar_storm" | "message";
export type Level = "info" | "warning" | "critical";
export const LEVELS: Level[] = ["info", "warning", "critical"];
export const LEVEL_RANK: Record<Level, number> = { info: 0, warning: 1, critical: 2 };

export interface MarsEvent {
  id: string;
  kind: EventKind;
  level: Level;
  zone: string | null;      // operation zone (null: the whole planet)
  crew_id: string | null;   // a message's addressee (null: everyone)
  lat: number | null;       // an anomaly's area: centre and radius
  lon: number | null;
  radius_m: number | null;
  starts_at: string;
  ends_at: string | null;   // null: until someone ends it
  title: string;
  text: string;
  source: "dispatch" | "ship" | "system";
  acked_at: string | null;  // a message to a crew: when the ship confirmed it
  created_at: string;
}

export type NewEvent = Omit<MarsEvent, "id" | "created_at" | "acked_at">;
export type EventPatch = Partial<Pick<MarsEvent, "ends_at" | "acked_at" | "level" | "text">>;

/** what each kind is: label, whether it covers an area, its usual size and severity */
export const EVENT_KINDS: Record<EventKind, { label: string; area: boolean; radius: number; level: Level; text: string }> = {
  dust_storm: { label: "Dust storm", area: true, radius: 1800, level: "warning", text: "Regional dust storm: visibility under 1 km, gusts to 25 m/s. Keep clear of the area." },
  dust_devil: { label: "Dust devil", area: true, radius: 300, level: "warning", text: "Dust devil track: avoid the area until it passes." },
  rockfall: { label: "Rockfall / unstable ground", area: true, radius: 400, level: "critical", text: "Fresh rockfall and loose ground: the area is closed." },
  solar_storm: { label: "Solar particle event", area: false, radius: 0, level: "critical", text: "Solar particle event: surface radiation many times above normal. Get to shelter." },
  message: { label: "Message", area: false, radius: 0, level: "info", text: "" },
};
