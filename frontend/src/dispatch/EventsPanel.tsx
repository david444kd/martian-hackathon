// Mission control's list of everything raised: anomalies active now, forecasts, messages and whether
// the crew confirmed them. End an active one, cancel a forecast.
import { CheckCheck, Clock, Radio, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LevelIcon } from "../components/alerts";
import { LEVEL_CLASS } from "../components/levels";
import { useDeleteEvent, useUpdateEvent } from "../lib/queries";
import { eventLabel, isActive } from "../lib/mars";
import { fmtDur } from "../lib/geo";
import type { Crew, MarsEvent } from "../lib/types";

export function EventsPanel({ events, crews, now, className }: { events: MarsEvent[]; crews: Crew[]; now: number; className?: string }) {
  const { t, i18n } = useTranslation();
  const timeLoc = i18n.language === "kk" ? "kk-KZ" : i18n.language === "ru" ? "ru-RU" : "en-US";
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(timeLoc, { timeStyle: "short" });

  const end = useUpdateEvent(), del = useDeleteEvent();
  const live = events.filter((e) => isActive(e, now) || Date.parse(e.starts_at) > now);
  const active = live.filter((e) => isActive(e, now)), later = live.filter((e) => !isActive(e, now));
  const who = (e: MarsEvent) => (e.kind === "message" ? (e.crew_id ? t("events_panel.to_crew", { name: crews.find((c) => c.id === e.crew_id)?.name ?? t("events_panel.to_all") }) : t("events_panel.to_all")) : e.zone ?? t("events_panel.all_mars"));

  const row = (e: MarsEvent) => (
    <div key={e.id} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs", LEVEL_CLASS[e.level], !isActive(e, now) && "opacity-70")}>
      <LevelIcon level={e.level} className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{e.kind === "message" ? (e.title || t("events_panel.message_fallback")) : eventLabel(e)} <span className="font-normal opacity-75">· {who(e)}</span></div>
        {e.kind === "message" && <div className="line-clamp-2 text-[11px] opacity-85">{e.text}</div>}
        <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-70">
          {isActive(e, now)
            ? <><Radio className="size-3" /> {e.ends_at ? t("events_panel.until_time", { time: clock(e.ends_at) }) : t("events_panel.until_ended")}</>
            : <><Clock className="size-3" /> {t("events_panel.in_time", { time: fmtDur((Date.parse(e.starts_at) - now) / 60_000) })}</>}
          {e.source === "ship" && ` ${t("events_panel.from_ship")}`}
          {e.kind === "message" && e.crew_id && (e.acked_at ? <span className="ml-1 flex items-center gap-0.5 text-emerald-300"><CheckCheck className="size-3" />{t("events_panel.confirmed")}</span> : <span className="ml-1">{t("events_panel.not_confirmed")}</span>)}
        </div>
      </div>
      {isActive(e, now)
        ? <Button size="icon-xs" variant="ghost" aria-label={t("events_panel.end_now")} title={t("events_panel.end_now")} onClick={() => end.mutate({ id: e.id, patch: { ends_at: new Date().toISOString() } }, { onSuccess: () => toast(t("events_panel.ended_toast", { label: eventLabel(e) })) })}><Square /></Button>
        : <Button size="icon-xs" variant="ghost" aria-label={t("events_panel.cancel")} title={t("events_panel.cancel")} onClick={() => del.mutate(e.id)}><Trash2 /></Button>}
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {live.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t("events_panel.all_quiet")}</p>}
      {active.map(row)}
      {later.length > 0 && <div className="px-1 pt-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{t("events_panel.forecast_heading")}</div>}
      {later.map(row)}
    </div>
  );
}
