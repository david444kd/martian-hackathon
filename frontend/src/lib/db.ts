// Data access: the browser talks straight to Supabase (tables from supabase/schema.sql, open to
// everyone - no auth for the hackathon). Keys come from .env.local.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Crew, EventPatch, MarsEvent, NewCrew, NewEvent, NewPlan, PlanPatch, PlanStatus, Route, WorkPlan } from "./types";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** set when the keys are missing: the app shows this instead of failing on every request */
export const configError = !URL || !KEY
  ? "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local and restart the dev server."
  : null;

interface Db {
  listCrews(): Promise<Crew[]>;
  getCrew(id: string): Promise<Crew | null>;
  createCrew(c: NewCrew): Promise<Crew>;
  deleteCrew(id: string): Promise<void>;
  listPlans(crewId?: string): Promise<WorkPlan[]>;
  createPlan(p: NewPlan): Promise<WorkPlan>;
  updatePlan(id: string, patch: PlanPatch): Promise<WorkPlan>;
  deletePlan(id: string): Promise<void>;
  /** helmet: progress along the route, only if the plan still has that route and is still active */
  reportProgress(id: string, routeStamp: string, progress_m: number): Promise<void>;
  /**
   * Replace a plan's route (progress back to 0), only if the plan still has the route the caller saw
   * (`seen` = its generated_at, null = no route) and, with `active`, is still on an EVA. Otherwise
   * someone else changed it first: throws RouteChangedError and nothing is written.
   */
  replaceRoute(id: string, seen: string | null, route: Route, opts?: { active?: boolean }): Promise<WorkPlan>;
  /** helmet: end the EVA at the airlock, only if the plan is still active on the route the helmet walked (false: it was not) */
  finishEva(id: string, routeStamp: string, status: Extract<PlanStatus, "done" | "assigned">): Promise<boolean>;
  listEvents(): Promise<MarsEvent[]>;
  createEvent(e: NewEvent): Promise<MarsEvent>;
  updateEvent(id: string, patch: EventPatch): Promise<MarsEvent>;
  deleteEvent(id: string): Promise<void>;
}

/** a conditional write found the plan already changed by someone else (another app, another tab) */
export class RouteChangedError extends Error {
  constructor() { super("route_changed"); this.name = "RouteChangedError"; }
}

/** events that ended more than this long ago are no longer fetched */
const EVENT_HISTORY_MS = 6 * 3600_000;

/** the client itself (null without keys): lib/realtime.ts subscribes to table changes through it */
export const sb: SupabaseClient | null = configError ? null : createClient(URL!, KEY!, { auth: { persistSession: false } });

function supabaseDb(sb: SupabaseClient): Db {
  const ok = <T,>({ data, error }: { data: T | null; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data as T;
  };
  return {
    listCrews: async () => ok(await sb.from("crews").select("*").order("created_at")),
    getCrew: async (id) => ok(await sb.from("crews").select("*").eq("id", id).maybeSingle()),
    createCrew: async (c) => ok(await sb.from("crews").insert(c).select().single()),
    deleteCrew: async (id) => { ok(await sb.from("crews").delete().eq("id", id)); },
    listPlans: async (crewId) => {
      let q = sb.from("work_plans").select("*").order("scheduled_at", { ascending: true, nullsFirst: false }).order("created_at");
      if (crewId) q = q.eq("crew_id", crewId);
      return ok(await q);
    },
    createPlan: async (p) => ok(await sb.from("work_plans").insert(p).select().single()),
    updatePlan: async (id, patch) => ok(await sb.from("work_plans").update(patch).eq("id", id).select().single()),
    deletePlan: async (id) => { ok(await sb.from("work_plans").delete().eq("id", id)); },
    reportProgress: async (id, stamp, progress_m) => {
      ok(await sb.from("work_plans").update({ progress_m }).eq("id", id).eq("status", "in_progress").eq("route->>generated_at", stamp));
    },
    replaceRoute: async (id, seen, route, opts) => {
      let q = sb.from("work_plans").update({ route, progress_m: 0 }).eq("id", id);
      q = seen ? q.eq("route->>generated_at", seen) : q.is("route", null);
      if (opts?.active) q = q.eq("status", "in_progress");
      const row = ok(await q.select().maybeSingle()) as WorkPlan | null;
      if (!row) throw new RouteChangedError();
      return row;
    },
    finishEva: async (id, stamp, status) => {
      const rows = ok(await sb.from("work_plans").update({ status }).eq("id", id).eq("status", "in_progress").eq("route->>generated_at", stamp).select("id"));
      return rows.length > 0;
    },
    listEvents: async () => {
      const since = new Date(Date.now() - EVENT_HISTORY_MS).toISOString();
      return ok(await sb.from("events").select("*").or(`ends_at.is.null,ends_at.gt.${since}`).order("starts_at"));
    },
    createEvent: async (e) => ok(await sb.from("events").insert(e).select().single()),
    updateEvent: async (id, patch) => ok(await sb.from("events").update(patch).eq("id", id).select().single()),
    deleteEvent: async (id) => { ok(await sb.from("events").delete().eq("id", id)); },
  };
}

// without keys every call fails with the explanation (the app also shows it in a banner)
export const db: Db = configError
  ? new Proxy({} as Db, { get: () => () => Promise.reject(new Error(configError!)) })
  : supabaseDb(sb!);
