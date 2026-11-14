import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCrews } from "../lib/queries";
import { isReturn, type PlanStatus, type Route, type WorkPlan } from "../lib/types";
import type { AstronautView } from "../lib/astronaut";
import { fmtDur, fmtKm } from "../lib/geo";
import { LanguageSwitcher } from "./LanguageSwitcher";

const STATUS_CLASS: Record<PlanStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  assigned: "bg-primary/15 text-primary",
  in_progress: "bg-live/15 text-live",
  done: "bg-target/15 text-target",
};

export function StatusBadge({ status, className }: { status: PlanStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary" className={cn("border-0", STATUS_CLASS[status], className)}>
      {status === "in_progress" && <span className="size-1.5 animate-pulse rounded-full bg-live" />}
      {status === "in_progress" ? t("status.eva_active") : t(`status.${status}`)}
    </Badge>
  );
}

type Stats = Pick<Route, "distance_m" | "duration_min" | "ascent_m" | "descent_m" | "max_slope_deg">;

export function RouteStats({ route, className }: { route: Stats; className?: string }) {
  const { t } = useTranslation();
  const items: [string, string][] = [
    [t("eva.distance"), fmtKm(route.distance_m)],
    [t("eva.walk_time"), fmtDur(route.duration_min)],
    [t("eva.climb_descent"), `${route.ascent_m} / ${route.descent_m} m`],
    [t("eva.steepest"), `${route.max_slope_deg}°`],
  ];
  return (
    <dl className={cn("grid grid-cols-2 gap-2", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg border bg-background/50 px-3 py-2">
          <dt className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{k}</dt>
          <dd className="text-sm font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const text = msg === "No safe walking route: the target is cut off by slopes over 25° or closed areas."
    ? t("ship.no_safe_route")
    : msg === "Route worker failed"
    ? t("ship.route_worker_failed")
    : msg;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {text}
    </div>
  );
}

/** a product's name in its header */
export function Brand({ product, icon }: { product: string; icon: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary [&_svg]:size-4.5">{icon}</div>
      <div className="leading-tight">
        <div className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{t("common.appName")}</div>
        <div className="text-sm font-semibold">{product}</div>
      </div>
    </div>
  );
}

/** pick a crew, then go to `${base}/${crew.id}` */
export function CrewPicker({ base, product, icon, question }: { base: string; product: string; icon: ReactNode; question: string }) {
  const { t } = useTranslation();
  const crews = useCrews();
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-auto p-6 pt-10">
      <div className="flex items-center justify-between">
        <Brand product={product} icon={icon} />
        <LanguageSwitcher />
      </div>
      <div>
        <h1 className="font-heading text-2xl font-semibold">{question}</h1>
        <p className="text-sm text-muted-foreground">{t("picker.crewsSubtitle")}</p>
      </div>
      <ErrorNote error={crews.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {crews.data?.map((c) => (
          <Link key={c.id} to={`${base}/${c.id}`} className="group">
            <Card className="transition-colors group-hover:ring-primary/60">
              <CardHeader>
                <CardTitle className="text-lg">{c.name}</CardTitle>
                <CardDescription>{c.ship || t("common.none")} · {c.zone}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      {crews.isPending && <p className="text-sm text-muted-foreground">{t("picker.loadingCrews")}</p>}
      {crews.data?.length === 0 && <p className="text-sm text-muted-foreground">{t("picker.noCrews")}</p>}
    </div>
  );
}

/** the active EVA: plan, how far the astronaut has walked (helmet telemetry), the live suit report, and any controls */
export function EvaCard({ plan, astro, className, children }: { plan: WorkPlan; astro?: AstronautView; className?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  const total = plan.route?.distance_m ?? 0, done = Math.min(plan.progress_m ?? 0, total);
  const back = isReturn(plan.route), tm = astro?.t;
  const ago = tm ? Math.max(0, Math.round((Date.now() - Date.parse(tm.updated_at)) / 1000)) : null;
  return (
    <div className={cn("rounded-xl border p-3", back ? "border-red-500/50 bg-red-500/10" : "border-live/30 bg-live/10", className)}>
      <div className={cn("flex items-center gap-2 text-xs font-medium", back ? "text-red-300" : "text-live")}>
        <span className={cn("size-1.5 animate-pulse rounded-full", back ? "bg-red-400" : "bg-live")} />
        {back ? t("eva.returning_to_base", { reason: plan.route?.reason ?? t("eva.recall_reason") }) : done >= total - 1 ? t("eva.astronaut_at_target") : t("eva.in_progress")}
      </div>
      <div className="mt-1 truncate font-medium">{plan.title}</div>
      <Progress value={(done / (total || 1)) * 100} className={cn("mt-2 h-1.5", back ? "[&>div]:bg-sky-400" : "[&>div]:bg-live")} />
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{t(back ? "eva.of_total_back" : "eva.of_total", { done: fmtKm(done), total: fmtKm(total) })}</span>
        <span>{t("eva.to_go", { left: fmtKm(total - done) })}</span>
      </div>
      {astro && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-white/10 pt-2 text-xs tabular-nums">
          {astro.live && tm ? (
            <>
              <span className="flex items-center gap-1.5 text-live"><span className="size-1.5 animate-pulse rounded-full bg-live" /> {t("eva.helmet_live", { ago })}</span>
              <span className="text-muted-foreground">{tm.speed_ms?.toFixed(1)} m/s · {Math.round(tm.heading_deg ?? 0)}°</span>
              <span>O₂ {tm.o2_pct?.toFixed(0)}% · ♥ {tm.pulse_bpm?.toFixed(0)}</span>
              <span className="text-muted-foreground">CO₂ {tm.co2_mmhg?.toFixed(1)} · {tm.dose_usv?.toFixed(0)} µSv</span>
              {tm.off_route_m != null && tm.off_route_m > 40 && <span className="col-span-2 text-amber-300">{t("eva.off_route", { dist: fmtKm(tm.off_route_m) })}</span>}
            </>
          ) : (
            <span className="col-span-2 text-muted-foreground">{tm ? t("eva.signal_lost", { ago }) : t("eva.no_signal_yet")}</span>
          )}
          <span className="col-span-2 text-[10px] text-muted-foreground/70">{t("eva.suit_simulated")}</span>
        </div>
      )}
      {children}
    </div>
  );
}
