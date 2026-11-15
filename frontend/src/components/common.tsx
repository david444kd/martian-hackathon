import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCrews } from "../lib/queries";
import { STATUS_LABEL, type PlanStatus, type Route, type WorkPlan } from "../lib/types";
import { fmtDur, fmtKm } from "../lib/geo";

const STATUS_CLASS: Record<PlanStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  assigned: "bg-primary/15 text-primary",
  in_progress: "bg-live/15 text-live",
  done: "bg-target/15 text-target",
};

export function StatusBadge({ status, className }: { status: PlanStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0", STATUS_CLASS[status], className)}>
      {status === "in_progress" && <span className="size-1.5 animate-pulse rounded-full bg-live" />}
      {status === "in_progress" ? "EVA active" : STATUS_LABEL[status]}
    </Badge>
  );
}

type Stats = Pick<Route, "distance_m" | "duration_min" | "ascent_m" | "descent_m" | "max_slope_deg">;

export function RouteStats({ route, className }: { route: Stats; className?: string }) {
  const items: [string, string][] = [
    ["Distance", fmtKm(route.distance_m)],
    ["Walk time", fmtDur(route.duration_min)],
    ["Climb / descent", `${route.ascent_m} / ${route.descent_m} m`],
    ["Steepest", `${route.max_slope_deg}°`],
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
  if (!error) return null;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

/** a product's name in its header */
export function Brand({ product, icon }: { product: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary [&_svg]:size-4.5">{icon}</div>
      <div className="leading-tight">
        <div className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">Mars Ops</div>
        <div className="text-sm font-semibold">{product}</div>
      </div>
    </div>
  );
}

/** pick a crew, then go to `${base}/${crew.id}` */
export function CrewPicker({ base, product, icon, question }: { base: string; product: string; icon: ReactNode; question: string }) {
  const crews = useCrews();
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-auto p-6 pt-10">
      <Brand product={product} icon={icon} />
      <div>
        <h1 className="font-heading text-2xl font-semibold">{question}</h1>
        <p className="text-sm text-muted-foreground">Crews registered by mission control.</p>
      </div>
      <ErrorNote error={crews.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {crews.data?.map((c) => (
          <Link key={c.id} to={`${base}/${c.id}`} className="group">
            <Card className="transition-colors group-hover:ring-primary/60">
              <CardHeader>
                <CardTitle className="text-lg">{c.name}</CardTitle>
                <CardDescription>{c.ship || "—"} · {c.zone}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      {crews.isPending && <p className="text-sm text-muted-foreground">Loading crews…</p>}
      {crews.data?.length === 0 && <p className="text-sm text-muted-foreground">No crews yet: mission control adds them.</p>}
    </div>
  );
}

/** the active EVA: plan, how far the astronaut has walked (helmet telemetry), and any controls */
export function EvaCard({ plan, className, children }: { plan: WorkPlan; className?: string; children?: ReactNode }) {
  const total = plan.route?.distance_m ?? 0, done = Math.min(plan.progress_m ?? 0, total);
  return (
    <div className={cn("rounded-xl border border-live/30 bg-live/10 p-3", className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-live">
        <span className="size-1.5 animate-pulse rounded-full bg-live" /> {done >= total - 1 ? "Astronaut at the target" : "EVA in progress"}
      </div>
      <div className="mt-1 truncate font-medium">{plan.title}</div>
      <Progress value={(done / (total || 1)) * 100} className="mt-2 h-1.5 [&>div]:bg-live" />
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{fmtKm(done)} of {fmtKm(total)}</span>
        <span>{fmtKm(total - done)} to go</span>
      </div>
      {children}
    </div>
  );
}
