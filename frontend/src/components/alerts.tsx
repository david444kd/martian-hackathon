// Shared pieces for the events: alert cards, the conditions panel, the 24-hour safety outlook and
// the anomalies on a Leaflet zone map. Used by all three apps so they look and read the same.
import type { ReactNode } from "react";
import { Circle, Tooltip } from "react-leaflet";
import { CheckCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Alert, EvaCheck, Slot } from "../lib/hazards";
import { areaHazards } from "../lib/hazards";
import { eventLabel, fmtLmst, isActive, marsTime, season, type Conditions } from "../lib/mars";
import { fmtDur } from "../lib/geo";
import type { Level, MarsEvent } from "../lib/types";
import type { Zone } from "../lib/zones";
import { LEVEL_CLASS, LEVEL_COLOR } from "./levels";

export const LevelIcon = ({ level, className }: { level: Level; className?: string }) => {
  const I = level === "critical" ? OctagonAlert : level === "warning" ? TriangleAlert : Info;
  return <I className={cn("size-4 shrink-0", className)} />;
};

export function AlertList({ alerts, onAck, max, className, empty }: {
  alerts: Alert[]; onAck?: (a: Alert) => void; max?: number; className?: string; empty?: ReactNode;
}) {
  if (!alerts.length) return empty ? <>{empty}</> : null;
  const shown = max ? alerts.slice(0, max) : alerts;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {shown.map((a) => (
        <div key={a.id} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs", LEVEL_CLASS[a.level], a.level === "critical" && "animate-pulse [animation-duration:2.5s]")}>
          <LevelIcon level={a.level} className="mt-px" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{a.title}</div>
            {a.text && <div className="mt-0.5 text-[11px] leading-snug opacity-85">{a.text}</div>}
          </div>
          {onAck && a.ackable && (
            <Button size="xs" variant="outline" className="h-6 shrink-0 bg-transparent px-2 text-[11px]" onClick={() => onAck(a)}><CheckCheck /> Got it</Button>
          )}
        </div>
      ))}
      {max && alerts.length > max && <div className="px-1 text-[11px] text-muted-foreground">+{alerts.length - max} more</div>}
    </div>
  );
}

const tone = (bad: boolean, worse = false) => (worse ? "text-red-300" : bad ? "text-amber-300" : "");

/** the surface conditions in the crew's zone right now */
export function ConditionsGrid({ c, zone, className }: { c: Conditions; zone: Zone; className?: string }) {
  const items: [string, ReactNode, string?][] = [
    ["Local time", <>{fmtLmst(c.time.lmst)} <span className="text-[10px] font-normal text-muted-foreground">{c.daylight ? "day" : "night"}</span></>],
    ["Air", `${c.tempC} °C`, tone(c.tempC < -85)],
    ["Wind", `${c.windMs} m/s`, tone(c.windMs > 14, c.windMs > 22)],
    ["Dust τ", c.tau.toFixed(1), tone(c.tau > 1.5, c.tau > 3)],
    ["Radiation", `${c.doseUSvH} µSv/h`, tone(c.doseUSvH > 80, c.doseUSvH > 300)],
    ["Pressure", `${c.pressurePa} Pa`],
  ];
  return (
    <div className={className}>
      <div className="mb-1.5 flex justify-between text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        <span>Surface now · {zone.name}</span>
        <span>Sol {Math.floor(c.time.msd)} · {season(c.time.ls, zone.base.lat)}</span>
      </div>
      <dl className="grid grid-cols-3 gap-1.5">
        {items.map(([k, v, cls]) => (
          <div key={k} className="rounded-md border bg-background/40 px-2 py-1.5">
            <dt className="text-[9px] font-medium tracking-wider text-muted-foreground uppercase">{k}</dt>
            <dd className={cn("text-xs font-semibold tabular-nums", cls)}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const SLOT_CLASS: Record<Slot["level"], string> = {
  ok: "bg-emerald-500/70", night: "bg-slate-600/60", info: "bg-sky-500/60", warning: "bg-amber-400/80", critical: "bg-red-500/90",
};

/** the next 24 hours as a bar: green = fine for an EVA, grey = night, amber / red = anomalies */
export function OutlookBar({ zone, slots, next, title = "Next 24 h" }: { zone: Zone; slots: Slot[]; next?: number | null; title?: string }) {
  if (!slots.length) return null;
  const t0 = slots[0].t, span = slots[slots.length - 1].t - t0 || 1;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        <span>{title}</span>
        {next !== undefined && (
          <span className={next == null ? "text-amber-300" : "text-emerald-300"}>
            {next == null ? "no safe window" : next - t0 < 60_000 ? "safe to start now" : `safe from LMST ${fmtLmst(marsTime(next, zone.base.lon).lmst)} (in ${fmtDur((next - t0) / 60_000)})`}
          </span>
        )}
      </div>
      <div className="relative flex h-3 gap-px overflow-hidden rounded">
        {slots.map((s) => <div key={s.t} className={cn("flex-1", SLOT_CLASS[s.level])} title={`LMST ${fmtLmst(marsTime(s.t, zone.base.lon).lmst)}`} />)}
        {next != null && <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${((next - t0) / span) * 100}%` }} />}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground tabular-nums">
        {[0, 6, 12, 18, 24].map((h) => <span key={h}>{h === 0 ? "now" : `+${h} h`}</span>)}
      </div>
    </div>
  );
}

/** the pre-EVA safety check for a route */
export function EvaCheckView({ check }: { check: EvaCheck }) {
  return (
    <div className={cn("rounded-lg border px-2.5 py-2 text-xs", check.level === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : LEVEL_CLASS[check.level])}>
      <div className="flex items-center gap-1.5 font-semibold">
        {check.level === "ok" ? <CheckCheck className="size-4" /> : <LevelIcon level={check.level} />}
        {check.level === "ok" ? "Safe to go now" : check.level === "critical" ? "Not safe to go now" : "Go with care"}
      </div>
      <div className="mt-1 text-[11px] opacity-85">
        EVA ~{fmtDur(check.needMin)} (there, {fmtDur(60)} work, back) · dose ~{check.doseMSv.toFixed(2)} mSv
      </div>
      {check.issues.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[11px] opacity-90">
          {check.issues.map((i) => <li key={i.text}>{i.text}</li>)}
        </ul>
      )}
    </div>
  );
}

/** anomaly areas in this zone on a Leaflet map: filled while active, dashed while only forecast */
export function HazardAreas({ events, zoneId, now }: { events: MarsEvent[]; zoneId: string; now: number }) {
  return (
    <>
      {areaHazards(events, zoneId, now, now + 12 * 3600_000).map((e) => {
        const on = isActive(e, now), color = LEVEL_COLOR[e.level];
        return (
          <Circle key={e.id} center={[e.lat!, e.lon!]} radius={e.radius_m!} interactive
            pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: on ? 0.22 : 0.05, dashArray: on ? undefined : "6 6" }}>
            <Tooltip direction="top" sticky>
              <b>{eventLabel(e)}</b> · {on ? (e.ends_at ? `until ${new Date(e.ends_at).toLocaleTimeString([], { timeStyle: "short" })}` : "active") : `from ${new Date(e.starts_at).toLocaleTimeString([], { timeStyle: "short" })}`}
            </Tooltip>
          </Circle>
        );
      })}
    </>
  );
}
