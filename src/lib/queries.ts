// TanStack Query hooks over the three tables. Changes arrive through Supabase Realtime
// (lib/realtime.ts), which refetches just the table that changed; polling is only the fallback:
// slow while the realtime channel is up, every few seconds while it is not.
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { db } from "./db";
import { isLive } from "./realtime";
import type { EventPatch, NewCrew, NewEvent, NewPlan, PlanPatch, Route, WorkPlan } from "./types";

const refetchInterval = () => (isLive() ? 60_000 : 3_000);

const keys = {
  crews: ["crews"] as const,
  crew: (id?: string) => ["crews", id] as const,
  plans: (crewId?: string) => ["plans", crewId ?? "all"] as const,
  events: ["events"] as const,
};

export const useCrews = () =>
  useQuery({ queryKey: keys.crews, queryFn: db.listCrews, refetchInterval });

/** one crew (the ship and the helmet need only their own); data is null if it doesn't exist */
export const useCrew = (id?: string) =>
  useQuery({ queryKey: keys.crew(id), queryFn: () => db.getCrew(id!), enabled: !!id, refetchInterval });

export const usePlans = (crewId?: string) =>
  useQuery({ queryKey: keys.plans(crewId), queryFn: () => db.listPlans(crewId), refetchInterval });

/** anomalies, forecasts and messages: every app watches the same list */
export const useEvents = () =>
  useQuery({ queryKey: keys.events, queryFn: db.listEvents, refetchInterval });

/** after a write, refetch just the tables it touched at once (realtime would too, a moment later) */
function useRefresh(...tables: QueryKey[]) {
  const qc = useQueryClient();
  return () => Promise.all(tables.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useCreateCrew() {
  const refresh = useRefresh(keys.crews);
  return useMutation({ mutationFn: (c: NewCrew) => db.createCrew(c), onSuccess: refresh });
}
/** deleting a crew also deletes its plans and messages (on delete cascade) */
export function useDeleteCrew() {
  const refresh = useRefresh(keys.crews, ["plans"], keys.events);
  return useMutation({ mutationFn: (id: string) => db.deleteCrew(id), onSuccess: refresh });
}
export function useCreatePlan() {
  const refresh = useRefresh(["plans"]);
  return useMutation({ mutationFn: (p: NewPlan) => db.createPlan(p), onSuccess: refresh });
}
export function useUpdatePlan() {
  const refresh = useRefresh(["plans"]);
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: PlanPatch }) => db.updatePlan(id, patch), onSuccess: refresh });
}
export function useDeletePlan() {
  const refresh = useRefresh(["plans"]);
  return useMutation({ mutationFn: (id: string) => db.deletePlan(id), onSuccess: refresh });
}

export function useCreateEvent() {
  const refresh = useRefresh(keys.events);
  return useMutation({ mutationFn: (e: NewEvent) => db.createEvent(e), onSuccess: refresh });
}
export function useUpdateEvent() {
  const refresh = useRefresh(keys.events);
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: EventPatch }) => db.updateEvent(id, patch), onSuccess: refresh });
}
export function useDeleteEvent() {
  const refresh = useRefresh(keys.events);
  return useMutation({ mutationFn: (id: string) => db.deleteEvent(id), onSuccess: refresh });
}

/** the ship starts an EVA: this plan becomes the crew's active one (any other active plan goes back to assigned) */
export function useStartEva() {
  const qc = useQueryClient();
  const refresh = useRefresh(["plans"]);
  return useMutation({
    mutationFn: async (plan: { id: string; crew_id: string }) => {
      const plans = qc.getQueryData<WorkPlan[]>(keys.plans(plan.crew_id)) ?? await db.listPlans(plan.crew_id);
      const others = plans.filter((p) => p.status === "in_progress" && p.id !== plan.id);
      await Promise.all(others.map((p) => db.updatePlan(p.id, { status: "assigned" })));
      return db.updatePlan(plan.id, { status: "in_progress", started_at: new Date().toISOString(), progress_m: 0 });
    },
    onSuccess: refresh,
  });
}

/** a new route for a plan, written only if nobody replaced the route in the meantime (db.replaceRoute) */
export function useReplaceRoute() {
  const refresh = useRefresh(["plans"]);
  return useMutation({
    mutationFn: ({ id, seen, route, active }: { id: string; seen: string | null; route: Route; active?: boolean }) => db.replaceRoute(id, seen, route, { active }),
    // refetch on failure too: the route that won is the one to show
    onSettled: refresh,
  });
}

export const activePlan = <T extends { status: string; started_at: string | null }>(plans: T[] | undefined) =>
  plans?.filter((p) => p.status === "in_progress").sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
