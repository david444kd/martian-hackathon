// Data access: the browser talks straight to Supabase (tables from supabase/schema.sql, open to
// everyone - no auth for the hackathon). Keys come from .env.local.
import { createClient } from "@supabase/supabase-js";
import type { Crew, NewCrew, NewPlan, PlanPatch, WorkPlan } from "./types";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** set when the keys are missing: the app shows this instead of failing on every request */
export const configError = !URL || !KEY
  ? "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local and restart the dev server."
  : null;

interface Db {
  listCrews(): Promise<Crew[]>;
  createCrew(c: NewCrew): Promise<Crew>;
  deleteCrew(id: string): Promise<void>;
  listPlans(crewId?: string): Promise<WorkPlan[]>;
  createPlan(p: NewPlan): Promise<WorkPlan>;
  updatePlan(id: string, patch: PlanPatch): Promise<WorkPlan>;
  deletePlan(id: string): Promise<void>;
}

function supabaseDb(url: string, key: string): Db {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const ok = <T,>({ data, error }: { data: T | null; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data as T;
  };
  return {
    listCrews: async () => ok(await sb.from("crews").select("*").order("created_at")),
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
  };
}

// without keys every call fails with the explanation (the app also shows it in a banner)
export const db: Db = configError
  ? new Proxy({} as Db, { get: () => () => Promise.reject(new Error(configError!)) })
  : supabaseDb(URL!, KEY!);
