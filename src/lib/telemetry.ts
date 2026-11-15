// Live astronaut position: the helmet reports where its astronaut is every ~2.5 s; mission control
// and the ship show it. Two paths, so it works even before the eva_telemetry table exists:
//  - a Supabase Realtime broadcast on channel "eva-live" (instant, nothing stored);
//  - an upsert into eva_telemetry (supabase/eva_telemetry.sql): the last known position for pages
//    opened later. If the table is missing the helmet notices once and only broadcasts.
import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { sb } from "./db";
import type { EvaTelemetry } from "./types";

/** a report older than this is "signal lost" */
export const STALE_MS = 20_000;
const TRAIL_MAX = 400;

type Entry = { t: EvaTelemetry; trail: [number, number][] };
const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
let tableOk: boolean | null = null; // null: not tried yet
let channel: RealtimeChannel | null = null;
let channelUsers = 0;
let poll: ReturnType<typeof setInterval> | null = null;
let loading = false;
/** catch up from the table this often in case a broadcast was missed (one poll per page, not per map) */
const POLL_MS = 10_000;

function emit() { version++; listeners.forEach((l) => l()); }

function ingest(t: EvaTelemetry) {
  if (!t?.crew_id || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) return;
  const prev = store.get(t.crew_id);
  if (prev && Date.parse(prev.t.updated_at) > Date.parse(t.updated_at)) return; // older than what we have
  const trail = prev && prev.t.plan_id === t.plan_id ? prev.trail : [];
  const last = trail[trail.length - 1];
  const next: [number, number][] = !last || last[0] !== t.lat || last[1] !== t.lon ? [...trail, [t.lat, t.lon]] : trail;
  store.set(t.crew_id, { t, trail: next.slice(-TRAIL_MAX) });
  emit();
}

/** a page that shows positions joins once per component; the channel and the poll are shared */
function join() {
  if (!sb) return;
  channelUsers++;
  if (channelUsers === 1) { void loadTable(); poll = setInterval(() => void loadTable(), POLL_MS); }
  joinChannel();
}
function leave() {
  if (!sb) return;
  channelUsers = Math.max(0, channelUsers - 1);
  if (channelUsers > 0) return;
  if (poll) { clearInterval(poll); poll = null; }
  if (channel) { void sb.removeChannel(channel); channel = null; }
}

function joinChannel() {
  if (!sb || channel) return;
  channel = sb.channel("eva-live", { config: { broadcast: { self: false, ack: false } } });
  // broadcast only: a postgres_changes listener on a table that may not exist yet would fail the channel
  channel.on("broadcast", { event: "pose" }, ({ payload }) => ingest(payload as EvaTelemetry));
  channel.subscribe();
}
/** the table is not there (not created yet) or this key may not use it: stop trying, broadcast only */
const tableMissing = (e: { code?: string }) => e.code === "PGRST205" || e.code === "42P01" || e.code === "42501";

async function loadTable() {
  if (!sb || tableOk === false || loading) return;
  loading = true;
  try {
    const { data, error } = await sb.from("eva_telemetry").select("*");
    if (error) { if (tableMissing(error)) tableOk = false; return; } // anything else (network): try again next poll
    tableOk = true;
    (data as EvaTelemetry[]).forEach(ingest);
  } finally { loading = false; }
}

/** helmet side: send one report (broadcast + upsert) */
export async function publishTelemetry(t: EvaTelemetry) {
  ingest(t); // our own page sees it too
  if (!sb) return;
  joinChannel(); // the helmet keeps it for as long as the page is open
  void channel?.send({ type: "broadcast", event: "pose", payload: t });
  if (tableOk === false) return;
  const { error } = await sb.from("eva_telemetry").upsert(t, { onConflict: "crew_id" });
  if (!error) { tableOk = true; return; }
  if (tableMissing(error)) {
    tableOk = false;
    console.info("eva_telemetry table unavailable, position goes over broadcast only:", error.message);
  } else if (error.code === "23503" && t.plan_id) {
    // the plan was deleted a moment ago (foreign key): keep the position, without the plan
    await sb.from("eva_telemetry").upsert({ ...t, plan_id: null }, { onConflict: "crew_id" });
  } // a network error: the next report (2.5 s) tries again
}

/** is the eva_telemetry table in the database (null: not known yet) */
export const telemetryTable = () => tableOk;

/** live telemetry of one crew (or every crew), with a breadcrumb trail since this page opened */
export function useTelemetry(): Map<string, Entry>;
export function useTelemetry(crewId: string | undefined): Entry | undefined;
export function useTelemetry(crewId?: string) {
  useEffect(() => { join(); return leave; }, []);
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
  return arguments.length ? (crewId ? store.get(crewId) : undefined) : store;
}

export const isFresh = (t: EvaTelemetry | undefined, now = Date.now()) => !!t && now - Date.parse(t.updated_at) < STALE_MS;
