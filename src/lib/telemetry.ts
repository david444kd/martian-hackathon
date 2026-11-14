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

function joinChannel() {
  if (!sb) return;
  channelUsers++;
  if (channel) return;
  channel = sb.channel("eva-live", { config: { broadcast: { self: false, ack: false } } });
  // broadcast only: a postgres_changes listener on a table that may not exist yet would fail the channel
  channel.on("broadcast", { event: "pose" }, ({ payload }) => ingest(payload as EvaTelemetry));
  channel.subscribe();
}
function leaveChannel() {
  channelUsers--;
  if (channelUsers <= 0 && channel && sb) { void sb.removeChannel(channel); channel = null; channelUsers = 0; }
}

async function loadTable() {
  if (!sb || tableOk === false) return;
  const { data, error } = await sb.from("eva_telemetry").select("*");
  if (error) { tableOk = false; return; }
  tableOk = true;
  (data as EvaTelemetry[]).forEach(ingest);
}

/** helmet side: send one report (broadcast + upsert) */
export async function publishTelemetry(t: EvaTelemetry) {
  ingest(t); // our own page sees it too
  if (!sb) return;
  if (!channel) joinChannel();
  void channel?.send({ type: "broadcast", event: "pose", payload: t });
  if (tableOk === false) return;
  const { error } = await sb.from("eva_telemetry").upsert(t, { onConflict: "crew_id" });
  if (error) {
    // table not created yet (PGRST205 / 404) or no permission: keep broadcasting only
    if (tableOk !== true) { tableOk = false; console.info("eva_telemetry table unavailable, position goes over broadcast only:", error.message); }
  } else tableOk = true;
}

/** is the eva_telemetry table in the database (null: not known yet) */
export const telemetryTable = () => tableOk;

/** live telemetry of one crew (or every crew), with a breadcrumb trail since this page opened */
export function useTelemetry(): Map<string, Entry>;
export function useTelemetry(crewId: string | undefined): Entry | undefined;
export function useTelemetry(crewId?: string) {
  useEffect(() => {
    joinChannel();
    void loadTable();
    const poll = setInterval(() => void loadTable(), 10_000); // catch up if a broadcast was missed
    return () => { clearInterval(poll); leaveChannel(); };
  }, []);
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
  return arguments.length ? (crewId ? store.get(crewId) : undefined) : store;
}

export const isFresh = (t: EvaTelemetry | undefined, now = Date.now()) => !!t && now - Date.parse(t.updated_at) < STALE_MS;
