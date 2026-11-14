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
