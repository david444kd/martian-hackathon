// Mission control's board of expeditions: one card per crew with what the helmet last reported —
// where the astronaut is, how far from base, oxygen (with a bar), pulse, CO2, dose, the route left —
// and a "Recall to base" button: during an EVA it makes a route back to base from where the astronaut
// is (as the ship's button does) and the helmet raises the alarm; with no EVA running it sends an
// urgent "return to base" call to that crew. Suit values are simulated (eva/suit.ts).
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Activity, Gauge, House, Loader2, MapPin, Radiation, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activePlan, useCreateEvent, useUpdatePlan } from "../lib/queries";
import { isReturn, type Crew, type Level, type MarsEvent, type WorkPlan } from "../lib/types";
import { crewHome, useHeightmap, useZone } from "../lib/zones";
import { distanceM, fmtKm, fmtLL } from "../lib/geo";
import { useAstronaut, type AstronautView } from "../lib/astronaut";
import { areaHazards, avoidList, crewAlerts } from "../lib/hazards";
import { returnRoute } from "../lib/recall";
import { LEVEL_COLOR } from "../components/levels";

type Status = "out" | "return" | "base" | "field" | "lost" | "offline";

const STATUS_CLASS: Record<Status, string> = {
  out: "bg-live/15 text-live", return: "bg-red-500/20 text-red-200", base: "bg-emerald-500/15 text-emerald-200",
  field: "bg-amber-400/15 text-amber-200", lost: "bg-amber-500/20 text-amber-200", offline: "bg-muted text-muted-foreground",
};

/** the board: every crew, with live helmet data and a recall button */
export function ExpeditionBoard({ crews, plans, evs, now, onSelect, className }: {
  crews: Crew[]; plans: WorkPlan[]; evs: MarsEvent[]; now: number; onSelect: (id: string) => void; className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border bg-card/85 backdrop-blur-md", className)}>
      <div className="flex items-center justify-between px-3 pt-2.5 pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        <span>{t("expeditions.title", { count: crews.length })}</span>
        <span className="normal-case tracking-normal text-[10px]">{t("expeditions.simulated")}</span>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {crews.length === 0 && <p className="px-2 pb-2 text-sm text-muted-foreground">{t("dispatch.no_crews_yet")}</p>}
        {crews.map((c) => (
          <ExpeditionCard key={c.id} crew={c} plans={plans.filter((p) => p.crew_id === c.id)} evs={evs} now={now} onSelect={() => onSelect(c.id)} />
        ))}
      </div>
    </div>
  );
}

function ExpeditionCard({ crew, plans, evs, now, onSelect }: { crew: Crew; plans: WorkPlan[]; evs: MarsEvent[]; now: number; onSelect: () => void }) {
  const { t } = useTranslation();
  const zone = useZone(crew.zone), home = crewHome(crew, zone);
  const active = activePlan(plans) ?? null;
  const astro = useAstronaut(crew.id, active);
  const tm = astro.t;
  const top = crewAlerts(crew, zone, active, evs, now, astro.at)[0];
  const alert: Level | null = top && top.level !== "info" ? top.level : null;
  const toBase = astro.at && home ? distanceM(astro.at[0], astro.at[1], home[0], home[1]) : null;
  const status: Status = active?.route
    ? isReturn(active.route) ? "return" : astro.live || !tm ? "out" : "lost"
    : astro.live ? (toBase != null && toBase > 40 ? "field" : "base") : tm ? "lost" : "offline";
  const ago = tm ? Math.max(0, Math.round((now - Date.parse(tm.updated_at)) / 1000)) : null;
  const o2 = tm?.o2_pct ?? null;
  const o2Color = o2 == null ? "#9aa4b2" : o2 < 15 ? "#ef4444" : o2 < 30 ? "#fbbf24" : "#7be08a";
  const total = active?.route?.distance_m ?? 0, left = Math.max(0, total - (active?.progress_m ?? 0));

  return (
    <div className={cn("rounded-lg border bg-background/50 p-2.5 text-xs", alert === "critical" && "border-red-500/60", alert === "warning" && "border-amber-400/50")}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline">{crew.name}</button>
        {alert && <span className="size-2 animate-pulse rounded-full" style={{ background: LEVEL_COLOR[alert] }} title={top?.title} />}
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase", STATUS_CLASS[status])}>{t(`expeditions.status_${status}`)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <MapPin className="size-3" />{zone?.name ?? crew.zone}
        {astro.at && <span className="tabular-nums">· {fmtLL(astro.at[0], astro.at[1])}</span>}
      </div>

      {tm ? (
        <>
          <div className="mt-2 flex items-center gap-2 tabular-nums">
            <span className="shrink-0 font-semibold whitespace-nowrap" style={{ color: o2Color }}>O₂ {o2?.toFixed(0) ?? "–"}%</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10"><i className="block h-full" style={{ width: `${Math.max(0, Math.min(100, o2 ?? 0))}%`, background: o2Color }} /></div>
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1 text-[11px] tabular-nums">
            <span className="flex items-center gap-1" title={t("expeditions.pulse")}><Activity className="size-3 text-[#ff9d91]" />{tm.pulse_bpm?.toFixed(0) ?? "–"}</span>
            <span className="flex items-center gap-1" title="CO₂, mmHg"><Gauge className="size-3" />{tm.co2_mmhg?.toFixed(1) ?? "–"}</span>
            <span className="flex items-center gap-1" title={t("expeditions.dose")}><Radiation className="size-3" />{tm.dose_usv?.toFixed(0) ?? "–"}</span>
            <span className="flex items-center gap-1" title={t("expeditions.speed")}><Wind className="size-3" />{tm.speed_ms?.toFixed(1) ?? "–"}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-[11px] text-muted-foreground tabular-nums">
            <span>{t("expeditions.to_base", { dist: toBase != null ? fmtKm(toBase) : "–" })}</span>
            {active?.route && <span>{t("expeditions.route_left", { dist: fmtKm(left) })}</span>}
            <span className={cn(!astro.live && "text-amber-300")}>{astro.live ? t("expeditions.ago", { ago }) : t("expeditions.lost_ago", { ago })}</span>
          </div>
          {tm.off_route_m != null && tm.off_route_m > 15 && active?.route && <div className="mt-1 text-[11px] text-amber-300">{t("expeditions.off_route", { dist: fmtKm(tm.off_route_m) })}</div>}
        </>
      ) : (
        <div className="mt-2 text-[11px] text-muted-foreground">{t("expeditions.no_signal")}</div>
      )}

      <RecallButton crew={crew} plan={active} astro={astro} evs={evs} now={now} status={status} className="mt-2" />
    </div>
  );
}

/**
 * Recall the astronaut: during an EVA a route back to base from where they are (the helmet raises the
 * alarm and follows it); with no EVA running, an urgent call to that crew to come back.
 */
export function RecallButton({ crew, plan, astro, evs, now, status, className }: {
  crew: Crew; plan: WorkPlan | null; astro: AstronautView; evs: MarsEvent[]; now: number; status?: Status; className?: string;
}) {
  const { t } = useTranslation();
  const zone = useZone(crew.zone), home = crewHome(crew, zone);
  const eva = !!plan?.route && plan.status === "in_progress";
  const hm = useHeightmap(eva ? zone : undefined);
  const update = useUpdatePlan(), call = useCreateEvent();
  const [busy, setBusy] = useState(false);
  const back = isReturn(plan?.route);
  const away = astro.at && home ? distanceM(astro.at[0], astro.at[1], home[0], home[1]) > 40 : false;
  if (back || (!eva && !away) || status === "offline") return null;

  async function recall() {
    if (!zone || !home) return;
    setBusy(true);
    try {
      if (eva && plan) {
        const here = astro.at;
        if (!hm.data || !here) throw new Error(t("expeditions.no_position"));
        const avoid = avoidList(areaHazards(evs, zone.id, now, now + 6 * 3600_000));
        const route = await returnRoute(hm.data, here, home, avoid, t("expeditions.recall_reason"));
        await update.mutateAsync({ id: plan.id, patch: { route, progress_m: 0 } });
        toast.success(t("expeditions.recall_sent", { name: crew.name }));
      } else {
        await call.mutateAsync({
          kind: "message", level: "critical", zone: crew.zone, crew_id: crew.id, lat: null, lon: null, radius_m: null,
          starts_at: new Date().toISOString(), ends_at: null, title: t("expeditions.call_title"), text: t("expeditions.call_text"), source: "dispatch",
        });
        toast.success(t("expeditions.call_sent", { name: crew.name }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Button size="sm" variant="destructive" className={cn("w-full", className)} disabled={busy || (eva && (!hm.data || !astro.at))} onClick={recall}>
      {busy ? <Loader2 className="animate-spin" /> : <House />} {t("expeditions.recall_btn")}
    </Button>
  );
}
