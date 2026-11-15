// Mission control's list of everything raised: anomalies active now, forecasts, messages and whether
// the crew confirmed them. End an active one, cancel a forecast.
import { CheckCheck, Clock, Radio, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LevelIcon } from "../components/alerts";
import { LEVEL_CLASS } from "../components/levels";
import { useDeleteEvent, useUpdateEvent } from "../lib/queries";
import { eventLabel, isActive } from "../lib/mars";
import { fmtDur } from "../lib/geo";
import type { Crew, MarsEvent } from "../lib/types";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { timeStyle: "short" });

export function EventsPanel({ events, crews, now, className }: { events: MarsEvent[]; crews: Crew[]; now: number; className?: string }) {
  const end = useUpdateEvent(), del = useDeleteEvent();
  const live = events.filter((e) => isActive(e, now) || Date.parse(e.starts_at) > now);
  const active = live.filter((e) => isActive(e, now)), later = live.filter((e) => !isActive(e, now));
  const who = (e: MarsEvent) => (e.kind === "message" ? (e.crew_id ? `to ${crews.find((c) => c.id === e.crew_id)?.name ?? "a crew"}` : "to all crews") : e.zone ?? "all of Mars");

  const row = (e: MarsEvent) => (
    <div key={e.id} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs", LEVEL_CLASS[e.level], !isActive(e, now) && "opacity-70")}>
      <LevelIcon level={e.level} className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{e.kind === "message" ? (e.title || "Message") : eventLabel(e)} <span className="font-normal opacity-75">· {who(e)}</span></div>
        {e.kind === "message" && <div className="line-clamp-2 text-[11px] opacity-85">{e.text}</div>}
        <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-70">
          {isActive(e, now)
            ? <><Radio className="size-3" /> {e.ends_at ? `until ${clock(e.ends_at)}` : "until ended"}</>
            : <><Clock className="size-3" /> in {fmtDur((Date.parse(e.starts_at) - now) / 60_000)}</>}
          {e.source === "ship" && " · from a ship"}
          {e.kind === "message" && e.crew_id && (e.acked_at ? <span className="ml-1 flex items-center gap-0.5 text-emerald-300"><CheckCheck className="size-3" />confirmed</span> : <span className="ml-1">· not confirmed</span>)}
        </div>
      </div>
      {isActive(e, now)
        ? <Button size="icon-xs" variant="ghost" aria-label="End" title="End now" onClick={() => end.mutate({ id: e.id, patch: { ends_at: new Date().toISOString() } }, { onSuccess: () => toast(`${eventLabel(e)} ended`) })}><Square /></Button>
        : <Button size="icon-xs" variant="ghost" aria-label="Cancel" title="Cancel" onClick={() => del.mutate(e.id)}><Trash2 /></Button>}
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {live.length === 0 && <p className="px-1 text-xs text-muted-foreground">All quiet: no anomalies, forecasts or messages.</p>}
      {active.map(row)}
      {later.length > 0 && <div className="px-1 pt-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Forecast</div>}
      {later.map(row)}
    </div>
  );
}
