// What a route is like to walk, for the ship's planner: its elevation along the way (the DTM heights
// stored with each route point), coloured by slope the same way as the route line on the map, and
// what the walk is expected to cost the suit (lib/consumables.ts — a simulated model, not a safety
// calculation). Hovering the profile reads out a point and marks it on the map.
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtKm } from "../lib/geo";
import { addUse, idleUse, legUse, routeUse, SLOPE_CLASSES, slopeClass, slopeDegOf, worst, type Use } from "../lib/consumables";
import { alongs } from "../astro/checkpoints";
import { WORK_MIN } from "../lib/hazards";
import type { Route, RoutePoint } from "../lib/types";

type Pts = { points: RoutePoint[] };

/** the route cut into runs of one slope class (for the map line and the profile) */
export function slopeRuns(points: RoutePoint[], along: number[]) {
  const runs: { key: string; color: string; from: number; to: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const c = slopeClass(slopeDegOf(along[i] - along[i - 1], points[i][2] - points[i - 1][2]));
    const last = runs[runs.length - 1];
    if (last && last.key === c.key) last.to = i; else runs.push({ key: c.key, color: c.color, from: i - 1, to: i });
  }
  return runs;
}

const W = 320, H = 116, L = 38, R = 8, T = 8, B = 18;

export function RouteProfile({ route, progress, onHover }: { route: Pts; progress?: number | null; onHover?: (at: [number, number] | null) => void }) {
  const { t } = useTranslation();
  const d = useMemo(() => {
    const p = route.points, along = alongs(route as Route), total = along[along.length - 1] || 1;
    let lo = Infinity, hi = -Infinity;
    for (const q of p) { lo = Math.min(lo, q[2]); hi = Math.max(hi, q[2]); }
    const span = Math.max(8, hi - lo), pad = span * 0.12, y0 = lo - pad, y1 = lo + span + pad;
    const x = (m: number) => L + (m / total) * (W - L - R), y = (e: number) => T + (1 - (e - y0) / (y1 - y0)) * (H - T - B);
    // oxygen used by the time each point is reached
    const o2 = [0];
    for (let i = 1; i < p.length; i++) o2.push(o2[i - 1] + legUse(along[i] - along[i - 1], p[i][2] - p[i - 1][2]).o2);
    return { p, along, total, lo, hi, x, y, o2, runs: slopeRuns(p, along), exaggeration: ((H - T - B) / (y1 - y0)) / ((W - L - R) / total) };
  }, [route]);
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  if (d.p.length < 2) return null;

  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect(), m = ((((clientX - r.left) / r.width) * W - L) / (W - L - R)) * d.total;
    let best = 0;
    for (let i = 1; i < d.along.length; i++) if (Math.abs(d.along[i] - m) < Math.abs(d.along[best] - m)) best = i;
    setAt(best); onHover?.([d.p[best][0], d.p[best][1]]);
  };
  const leave = () => { setAt(null); onHover?.(null); };
  const area = `M${d.x(0)},${H - B} ${d.p.map((q, i) => `L${d.x(d.along[i]).toFixed(1)},${d.y(q[2]).toFixed(1)}`).join(" ")} L${d.x(d.total)},${H - B} Z`;
  const ticks = [d.lo, (d.lo + d.hi) / 2, d.hi];
  const hov = at != null ? { x: d.x(d.along[at]), y: d.y(d.p[at][2]), deg: at > 0 ? slopeDegOf(d.along[at] - d.along[at - 1], d.p[at][2] - d.p[at - 1][2]) : 0 } : null;
  const prog = progress != null && progress > 0 ? Math.min(d.total, progress) : null;

  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex items-baseline justify-between text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        <span>{t("eva.profile_title")}</span>
        <span className="tracking-normal normal-case">{t("eva.profile_vertical", { n: d.exaggeration >= 10 ? Math.round(d.exaggeration) : d.exaggeration.toFixed(1) })}</span>
      </figcaption>
      <div className="relative">
        <svg ref={box} viewBox={`0 0 ${W} ${H}`} className="block w-full touch-none select-none" role="img"
          aria-label={t("eva.profile_aria", { dist: fmtKm(d.total), lo: Math.round(d.lo), hi: Math.round(d.hi) })}
          onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={leave}>
          {ticks.map((e, i) => (
            <g key={i}>
              <line x1={L} x2={W - R} y1={d.y(e)} y2={d.y(e)} className="stroke-border" strokeWidth={1} />
              <text x={L - 5} y={d.y(e) + 3} textAnchor="end" className="fill-muted-foreground text-[9px] tabular-nums">{Math.round(e)}</text>
            </g>
          ))}
          <text x={L} y={H - 4} className="fill-muted-foreground text-[9px]">0</text>
          <text x={W - R} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[9px]">{fmtKm(d.total)}</text>
          <path d={area} className="fill-foreground/[0.06]" />
          {d.runs.map((r, i) => (
            <polyline key={i} fill="none" stroke={r.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              points={d.p.slice(r.from, r.to + 1).map((q, k) => `${d.x(d.along[r.from + k]).toFixed(1)},${d.y(q[2]).toFixed(1)}`).join(" ")} />
          ))}
          {prog != null && <line x1={d.x(prog)} x2={d.x(prog)} y1={T} y2={H - B} className="stroke-live" strokeWidth={1.5} strokeDasharray="3 3" />}
          {hov && (
            <g pointerEvents="none">
              <line x1={hov.x} x2={hov.x} y1={T} y2={H - B} className="stroke-foreground/50" strokeWidth={1} />
              <circle cx={hov.x} cy={hov.y} r={4} className="fill-card stroke-foreground" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hov && at != null && (
          <div className="pointer-events-none absolute bottom-full z-10 mb-0.5 rounded-md border bg-popover px-2 py-1 text-[11px] leading-tight shadow-md"
            style={hov.x > W * 0.6 ? { right: `${100 - (hov.x / W) * 100 + 3}%` } : { left: `${(hov.x / W) * 100 + 3}%` }}>
            <div className="font-semibold tabular-nums">{Math.round(d.p[at][2])} m · {hov.deg > 0 ? "+" : ""}{hov.deg.toFixed(1)}°</div>
            <div className="text-muted-foreground tabular-nums">{fmtKm(d.along[at])} · O₂ −{d.o2[at].toFixed(1)}%</div>
          </div>
        )}
      </div>
      <SlopeLegend />
    </figure>
  );
}

/** the slope colours: what each means on the map line and on the profile */
export function SlopeLegend({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground", className)}>
      {SLOPE_CLASSES.map((c) => (
        <span key={c.key} className="flex items-center gap-1"><span className="h-[3px] w-3.5 rounded-full" style={{ background: c.color }} />{t(`eva.slope_${c.key}`)}</span>
      ))}
    </div>
  );
}

/**
 * What walking out, an hour's work at the target and walking back are expected to use, how hard the
 * walking is (mean and peak metabolic rate, W) and how tired it leaves the astronaut (0..1).
 */
export function routeBudget(route: Pts, tempC?: number) {
  const along = alongs(route as Route), env = { tempC };
  const out = routeUse(route.points, along, 0, false, env);
  // an hour at the site, about as hard as an Apollo geology stop: working, not resting, so only half the tiredness goes
  const work = idleUse(WORK_MIN * 60, 1, env);
  const back = routeUse(route.points, along, 0, true, { ...env, fatigue: out.fatigue * 0.5 });
  const use: Use = addUse(addUse(out, work), back);
  return {
    use, mean: (out.mean + back.mean) / 2, peak: Math.max(out.peak, back.peak),
    tiredOut: out.fatigue, tiredBack: back.fatigue, rests: out.rests + back.rests, minutes: (out.seconds + back.seconds) / 60 + WORK_MIN,
  };
}

export function RouteBudget({ route, tempC }: { route: Pts; tempC?: number }) {
  const { t } = useTranslation();
  const b = useMemo(() => routeBudget(route, tempC), [route, tempC]), use = b.use;
  const top = worst(use), level = top > 100 ? "critical" : top > 80 ? "warning" : "ok";
  const spent = b.rests > 0 ? "critical" : Math.max(b.tiredOut, b.tiredBack) > 0.7 ? "warning" : "ok";
  const rows: [string, number][] = [[t("eva.use_o2"), use.o2], [t("eva.use_power"), use.power], [t("eva.use_water"), use.water]];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        <span>{t("eva.use_title")}</span><span className="tracking-normal normal-case">{t("eva.use_simulated")}</span>
      </div>
      {rows.map(([label, v]) => (
        <div key={label} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-xs" title={`${label}: ${v.toFixed(1)}%`}>
          <span className="truncate text-muted-foreground">{label}</span>
          <span className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <span className={cn("absolute inset-y-0 left-0 rounded-full", v > 100 ? "bg-red-400" : v > 80 ? "bg-amber-300" : "bg-foreground/70")} style={{ width: `${Math.min(100, v)}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{Math.round(v)}%</span>
        </div>
      ))}
      <div className="text-[11px] text-muted-foreground tabular-nums">{t("eva.use_load", { avg: Math.round(b.mean), peak: Math.round(b.peak) })}</div>
      {/* how tired the walk leaves the astronaut: this, not the tanks, is what usually limits a walk in a suit */}
      <div className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-xs" title={t("eva.tired_title")}>
        <span className="truncate text-muted-foreground">{t("eva.tired")}</span>
        <span className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <span className={cn("absolute inset-y-0 left-0 rounded-full", spent === "critical" ? "bg-red-400" : spent === "warning" ? "bg-amber-300" : "bg-foreground/70")} style={{ width: `${Math.min(100, Math.max(b.tiredOut, b.tiredBack) * 100)}%` }} />
        </span>
        <span className="text-right font-semibold tabular-nums">{Math.round(Math.max(b.tiredOut, b.tiredBack) * 100)}%</span>
      </div>
      {spent !== "ok" && (
        <div className={cn("flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs", spent === "critical" ? "bg-red-500/15 text-red-200" : "bg-amber-400/10 text-amber-200")}>
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{spent === "critical" ? t("eva.tired_rests", { count: b.rests, min: Math.round(b.minutes) }) : t("eva.tired_hard")}
        </div>
      )}
      {level !== "ok" && (
        <div className={cn("flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs", level === "critical" ? "bg-red-500/15 text-red-200" : "bg-amber-400/10 text-amber-200")}>
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{level === "critical" ? t("eva.use_over") : t("eva.use_tight")}
        </div>
      )}
    </div>
  );
}
