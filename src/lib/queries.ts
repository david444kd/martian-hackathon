// TanStack Query hooks over the two tables. Every page polls, so what the dispatcher changes shows
// up on the ship and in the helmet within a few seconds.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "./db";
import type { EventPatch, NewCrew, NewEvent, NewPlan, PlanPatch } from "./types";

const POLL_MS = 3000;

const keys = {
  crews: ["crews"] as const,
  plans: (crewId?: string) => ["plans", crewId ?? "all"] as const,
  events: ["events"] as const,
};

export const useCrews = () =>
  useQuery({ queryKey: keys.crews, queryFn: db.listCrews, refetchInterval: POLL_MS });

export const usePlans = (crewId?: string) =>
  useQuery({ queryKey: keys.plans(crewId), queryFn: () => db.listPlans(crewId), refetchInterval: POLL_MS });

/** anomalies, forecasts and messages: every app polls the same list */
export const useEvents = () =>
  useQuery({ queryKey: keys.events, queryFn: db.listEvents, refetchInterval: POLL_MS });

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["crews"] }),
    qc.invalidateQueries({ queryKey: ["plans"] }),
    qc.invalidateQueries({ queryKey: keys.events }),
  ]);
}

export function useCreateCrew() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (c: NewCrew) => db.createCrew(c), onSuccess: refresh });
}
export function useDeleteCrew() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => db.deleteCrew(id), onSuccess: refresh });
}
export function useCreatePlan() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (p: NewPlan) => db.createPlan(p), onSuccess: refresh });
}
export function useUpdatePlan() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: PlanPatch }) => db.updatePlan(id, patch), onSuccess: refresh });
}
export function useDeletePlan() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => db.deletePlan(id), onSuccess: refresh });
}

export function useCreateEvent() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (e: NewEvent) => db.createEvent(e), onSuccess: refresh });
}
export function useUpdateEvent() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: EventPatch }) => db.updateEvent(id, patch), onSuccess: refresh });
}
export function useDeleteEvent() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => db.deleteEvent(id), onSuccess: refresh });
}

/** the ship starts an EVA: this plan becomes the crew's active one (any other active plan goes back to assigned) */
export function useStartEva() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (plan: { id: string; crew_id: string }) => {
      const others = (await db.listPlans(plan.crew_id)).filter((p) => p.status === "in_progress" && p.id !== plan.id);
      await Promise.all(others.map((p) => db.updatePlan(p.id, { status: "assigned" })));
      return db.updatePlan(plan.id, { status: "in_progress", started_at: new Date().toISOString(), progress_m: 0 });
    },
    onSuccess: refresh,
  });
}

/** helmet telemetry: no refetch storm, the pages poll anyway */
export function useReportProgress() {
  return useMutation({ mutationFn: ({ id, progress_m }: { id: string; progress_m: number }) => db.updatePlan(id, { progress_m }) });
}

export const activePlan = <T extends { status: string; started_at: string | null }>(plans: T[] | undefined) =>
  plans?.filter((p) => p.status === "in_progress").sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
