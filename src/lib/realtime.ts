// Supabase Realtime: one channel per page listening to every change in the three tables (they are in
// the supabase_realtime publication). A change refetches only that table's queries, so the apps
// update within a moment of each other with no polling. While the channel is down, lib/queries.ts
// falls back to polling every few seconds; on (re)connect everything is refetched once to catch up.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sb } from "./db";

let live = false;

/** is the realtime channel connected right now */
export const isLive = () => live;

const TABLES = { crews: ["crews"], work_plans: ["plans"], events: ["events"] } as const;

/** mount once at the top of the app */
export function RealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!sb) return;
    const channel = sb.channel("mars-ops");
    for (const [table, queryKey] of Object.entries(TABLES)) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => void qc.invalidateQueries({ queryKey }));
    }
    let dropped = false;
    channel.subscribe((status) => {
      live = status === "SUBSCRIBED"; // CHANNEL_ERROR, TIMED_OUT, CLOSED: polling takes over
      if (!live) dropped = true;
      else if (dropped) void qc.invalidateQueries(); // back after a drop: catch up on what was missed
    });
    return () => { live = false; void sb!.removeChannel(channel); };
  }, [qc]);
  return null;
}
