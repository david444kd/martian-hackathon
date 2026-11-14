// The suit display on a screen: the helmet visor frame over the view, suit systems top left, the
// heading tape, navigation top right, the map bottom left, calls and warnings in the middle, and the
// big RETURN TO BASE alert when the EVA is recalled. In VR the same is drawn inside the headset.
import { useEffect, useRef } from "react";
import { Activity, Bot, Check, Footprints, Gauge, Glasses, HardHat, House, Radiation, Radio, Satellite, ShieldAlert, Volume2, VolumeX, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Heightmap } from "../lib/zones";
import { LEVEL_COLOR } from "../components/levels";
import { fmtDur, fmtKm } from "../lib/geo";
import { fmtLmst } from "../lib/mars";
import { compass, drawMap, ROUTE_BACK, ROUTE_OUT } from "./draw";
import type { P2 } from "./frame";
import type { EvaRuntime } from "./runtime";
import type { EvaApi } from "./useEva";
import "./eva.css";

interface Props {
  v: EvaApi;
  rt: EvaRuntime;
  hm: Heightmap;
  home: P2;
  crewName: string;
  vrOk: boolean | null;
  muted: boolean;
  onMute: () => void;
  onEnterVr: () => void;
}

export function EvaHud({ v, rt, hm, home, crewName, vrOk, muted, onMute, onEnterVr }: Props) {
  const s = v.suit, hd = rt.pose.heading;
  const back = v.mode === "return" || v.mode === "complete";
  const routeColor = back ? ROUTE_BACK : ROUTE_OUT;
  const recalled = v.mode === "return" || v.recall.state === "computing" || v.recall.state === "failed";
  const critical = recalled || v.top?.level === "critical";
  const since = v.link.lastSent ? Math.round((Date.now() - v.link.lastSent) / 1000) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none text-[#e8efe9]">
      {/* the visor */}
      <div className={cn("eva-visor", critical && "eva-visor-alarm")} aria-hidden>
        <div className="eva-visor-glass" />
        <div className="eva-visor-shell" />
        <div className="eva-visor-fog" style={{ animationDuration: `${60 / Math.max(8, s.resp)}s` }} />
        <div className="eva-visor-brow"><i /><span /><i /></div>
        <div className="eva-visor-jaw"><i /><span /><i /></div>
        <div className="eva-visor-seal" />
      </div>

      {/* suit systems */}
      <section className="eva-panel absolute top-5 left-5 w-[260px] max-sm:w-[200px]">
        <header className="flex items-center justify-between text-[11px] tracking-[0.18em] text-[#9fb7b0] uppercase">
          <span className="flex items-center gap-1.5"><HardHat className="size-3.5" /> Suit · {crewName}</span>
          <b className={cn(s.status === "NOMINAL" ? "text-[#7be08a]" : s.status === "CAUTION" ? "text-amber-300" : "animate-pulse text-red-400")}>{s.status}</b>
        </header>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-[11px] text-[#9fb7b0]">O₂ primary</div>
            <div className={cn("text-4xl font-semibold tabular-nums", s.o2Pct < 30 && "text-red-300")}>{s.o2Pct.toFixed(0)}<small className="text-base">%</small></div>
          </div>
          <div className="text-right text-xs text-[#cfe0da] tabular-nums">
            <div>{fmtDur(s.remainingMin)} left</div>
            <div>{s.kpa.toFixed(1)} kPa · batt {s.batteryPct.toFixed(0)}%</div>
          </div>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/10"><i className="block h-full bg-[#7fe0c4]" style={{ width: `${s.o2Pct}%` }} /></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs tabular-nums">
          <div className="flex items-center gap-1.5"><Activity className="size-3.5 text-[#ff9d91]" /> {s.pulse.toFixed(0)} bpm</div>
          <div className="flex items-center gap-1.5"><Wind className="size-3.5" /> {s.resp.toFixed(0)} /min</div>
          <div className={cn("flex items-center gap-1.5", s.co2 > 6 && "text-amber-300")}><Gauge className="size-3.5" /> CO₂ {s.co2.toFixed(1)}</div>
          <div className={cn("flex items-center gap-1.5", (v.cond?.doseUSvH ?? 0) > 80 && "text-red-300")}><Radiation className="size-3.5" /> {v.cond?.doseUSvH ?? "–"} µSv/h</div>
        </div>
        <svg viewBox="0 0 116 20" className="eva-ecg mt-2 h-4 w-full" style={{ animationDuration: `${60 / Math.max(40, s.pulse)}s` }} aria-hidden>
          <path d="M0 12H15L19 9L23 14H34L39 11L44 12L49 2L53 19L57 9L61 12H80L84 10L89 13H116" />
        </svg>
        <div className="mt-1 text-[10px] text-white/40">Simulated suit values · not biometrics</div>
      </section>

      {/* heading tape */}
      <div className="eva-panel absolute top-5 left-1/2 w-[min(440px,46vw)] -translate-x-1/2 overflow-hidden px-0 py-2 max-sm:top-auto max-sm:bottom-28">
        <div className="relative h-9">
          {Array.from({ length: 25 }, (_, i) => {
            const deg = Math.round(hd / 5) * 5 + (i - 12) * 5, x = 50 + ((deg - hd) / 60) * 50;
            const label = ((deg % 360) + 360) % 360;
            return (
              <div key={i} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${x}%` }}>
                <div className={cn("mx-auto w-px bg-[#d9e6e1]", deg % 15 === 0 ? "h-3" : "h-1.5")} />
                {label % 45 === 0 && <div className="mt-0.5 text-[11px] font-semibold">{compass(label)}</div>}
              </div>
            );
          })}
          <Mark bearing={v.bearingBase} hd={hd} color="#e9f2ef" title="Base" />
          {v.guide && <Mark bearing={v.guide.bearing} hd={hd} color={routeColor} title="Route" />}
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[11px] font-semibold tabular-nums">{Math.round(hd).toString().padStart(3, "0")}°</div>
        </div>
      </div>

      {/* navigation */}
      <section className="eva-panel absolute top-5 right-5 w-[280px] max-sm:w-[190px]" style={{ borderColor: routeColor + "66" }}>
        <header className="flex items-center justify-between text-[11px] tracking-[0.18em] text-[#9fb7b0] uppercase">
          <span className="flex items-center gap-1.5">{back ? <House className="size-3.5" /> : <Footprints className="size-3.5" />}
            {v.mode === "return" ? "Return to base" : v.mode === "out" ? "Outbound" : v.mode === "complete" ? "At base" : "Standby"}</span>
          {rt.autopilot && <b className="flex items-center gap-1 text-[#9fe3ff]"><Bot className="size-3.5" /> Auto</b>}
        </header>
        {v.route ? (
          <>
            <div className="mt-1 truncate text-sm font-medium" style={{ color: routeColor }}>{back ? v.route.reason ?? "Recall" : v.plan?.title ?? ""}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{v.arrived ? "Arrived" : fmtKm(v.left)}</div>
            {!v.arrived && v.guide && <div className="text-sm text-[#cfe0da] tabular-nums">head {Math.round(v.guide.bearing)}° {compass(v.guide.bearing)} · ~{fmtDur(v.etaMin)}</div>}
            <div className="mt-2 h-1 overflow-hidden rounded bg-white/10"><i className="block h-full" style={{ width: `${Math.min(100, (v.progress / (v.line?.length || 1)) * 100)}%`, background: routeColor }} /></div>
            {v.rerouting ? <div className="mt-2 rounded bg-sky-400/15 px-2 py-1 text-xs text-sky-200">Off the route: making a new one from here…</div>
              : v.offRoute > 40 && !v.arrived && <div className="mt-2 rounded bg-amber-400/15 px-2 py-1 text-xs text-amber-200">{v.progress < 1 && v.offRoute > 60 ? `Route starts ${Math.round(v.offRoute)} m away: follow the markers to it` : `Off the route by ${Math.round(v.offRoute)} m: a new route follows if you stay off it`}</div>}
          </>
        ) : (
          <div className="mt-1 text-sm text-[#cfe0da]">No active EVA. The ship sends the route; you can walk around the base.</div>
        )}
        <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-xs text-[#cfe0da] tabular-nums">
          <span>Base {fmtKm(v.toBase)} {compass(v.bearingBase)}</span>
          <span>slope {rt.pose.slope.toFixed(0)}° · {rt.pose.speed.toFixed(1)} m/s</span>
        </div>
      </section>

      {/* map */}
      <section className="eva-panel absolute bottom-5 left-5 p-2 max-sm:hidden">
        <MiniMap v={v} rt={rt} hm={hm} home={home} />
        <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-[#9fb7b0] tabular-nums">
          <span>{v.at[0].toFixed(5)}°, {v.at[1].toFixed(5)}°</span>
          <span>{Math.round(v.elev)} m</span>
        </div>
      </section>

      {/* link and conditions */}
      <section className="eva-panel absolute right-5 bottom-5 w-[280px] text-xs max-sm:hidden">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5"><Satellite className="size-3.5" /> Link to ship</span>
          <span className={cn("tabular-nums", since != null && since < 6 ? "text-[#7be08a]" : "text-amber-300")}>{since == null ? "connecting…" : `sent ${since}s ago`}</span>
        </div>
        <div className="mt-1 text-[10px] text-white/45">Position every 2.5 s{v.link.table === false ? " (live broadcast; run supabase/eva_telemetry.sql to keep it)" : ""}</div>
        {v.cond && (
          <div className="mt-2 grid grid-cols-2 gap-1 border-t border-white/10 pt-2 text-[#cfe0da] tabular-nums">
            <span>{v.cond.tempC} °C</span><span>wind {v.cond.windMs} m/s</span>
            <span className={cn(v.storm > 0.4 && "text-amber-300")}>dust τ {v.cond.tau.toFixed(1)}</span><span>LMST {fmtLmst(v.cond.time.lmst)}</span>
          </div>
        )}
      </section>

      {/* alerts */}
      <div className="absolute top-[30%] left-1/2 flex w-[min(620px,90vw)] -translate-x-1/2 flex-col items-center gap-3">
        {recalled && <RecallBanner v={v} />}
        {!recalled && v.top && (
          <section className="eva-panel pointer-events-auto flex w-full items-start gap-3 border-l-4" style={{ borderLeftColor: LEVEL_COLOR[v.top.level] }}>
            {v.top.event.kind === "message" ? <Radio className="mt-0.5 size-5 shrink-0" /> : <ShieldAlert className="mt-0.5 size-5 shrink-0" style={{ color: LEVEL_COLOR[v.top.level] }} />}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] tracking-[0.18em] uppercase" style={{ color: LEVEL_COLOR[v.top.level] }}>
                {v.top.level === "critical" ? "Priority 1 · Emergency" : v.top.level === "warning" ? "Priority 2 · Caution" : "Mission command"}
              </div>
              <div className="font-semibold">{v.top.title}</div>
              <p className="text-sm text-[#dfe7e2]">{v.top.text}</p>
            </div>
            <button type="button" onClick={v.ack} className="grid size-9 shrink-0 place-items-center rounded-full border border-white/30 hover:bg-white/10" title="Acknowledge (Enter)"><Check className="size-4" /></button>
          </section>
        )}
        {v.mode === "complete" && <div className="eva-panel text-center text-lg font-semibold text-[#c9f5d3]">Airlock reached · EVA complete</div>}
        {v.mode === "out" && v.arrived && !v.top && <div className="eva-panel text-center"><div className="text-lg font-semibold text-[#c9f5d3]">Target reached</div><div className="text-sm">{v.plan?.description || "Carry out the work plan."}</div></div>}
        {rt.pose.blocked && <div className="eva-panel border-amber-400/50 py-2 text-sm text-amber-200">{rt.pose.blocked}</div>}
      </div>

      {/* reticle */}
      <div className="absolute top-1/2 left-1/2 size-6 -translate-1/2 rounded-full border border-white/25" aria-hidden />

      {/* controls */}
      <div className="absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 max-sm:bottom-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button type="button" className="eva-btn" onClick={onMute} title={muted ? "Sound on" : "Mute"}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
          <button type="button" className={cn("eva-btn", rt.autopilot && "eva-btn-on")} disabled={!v.line} onClick={() => { rt.autopilot = !rt.autopilot; rt.notify(); }} title="Walk along the route by itself (F)">
            <Bot className="size-4" /> Autopilot
          </button>
          {vrOk && <button type="button" className="eva-btn eva-btn-on" onClick={onEnterVr}><Glasses className="size-4" /> Enter VR</button>}
        </div>
        <div className="text-[11px] text-white/55 max-sm:hidden">Click the view · drag to look · WASD walk · Shift fast · Q/E turn · F autopilot · Enter acknowledge</div>
        <TouchPad rt={rt} />
      </div>
    </div>
  );
}

function Mark({ bearing, hd, color, title }: { bearing: number; hd: number; color: string; title: string }) {
  let d = bearing - hd; d = ((d + 540) % 360) - 180;
  const x = 50 + (Math.max(-58, Math.min(58, d)) / 60) * 50;
  return <div className="absolute top-3.5 -translate-x-1/2" style={{ left: `${x}%` }} title={title}>
    <div className="size-0 border-x-[6px] border-b-[9px] border-x-transparent" style={{ borderBottomColor: color }} />
  </div>;
}

function RecallBanner({ v }: { v: EvaApi }) {
  const failed = v.recall.state === "failed", computing = v.recall.state === "computing";
  return (
    <section className="eva-recall pointer-events-auto w-full text-center">
      <div className="text-[11px] tracking-[0.25em] text-red-200 uppercase">Priority 1 · Abort EVA</div>
      <div className="mt-1 text-3xl font-bold tracking-wide text-white">{failed ? "HOLD POSITION" : "RETURN TO BASE"}</div>
      <div className="mt-1 text-sm text-red-100">{v.recall.reason || v.route?.reason || "Recall from the ship"}</div>
      <div className="mt-2 text-sm text-white/90">
        {failed ? `No safe return route: ${v.recall.error ?? "contact the ship"}.` : computing ? "Preparing the return route…" : `Follow the blue markers · ${fmtKm(v.left)} to the airlock · ~${fmtDur(v.etaMin)}`}
      </div>
    </section>
  );
}

function MiniMap({ v, rt, hm, home }: { v: EvaApi; rt: EvaRuntime; hm: Heightmap; home: P2 }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vr = useRef(v);
  vr.current = v;
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      drawMap(ctx, hm, vr.current, rt, home, 0, 0, c.width);
    };
    draw();
    const id = setInterval(draw, 250);
    return () => clearInterval(id);
  }, [hm, rt, home]);
  return <canvas ref={ref} width={420} height={420} className="block size-[210px]" />;
}

/** on touch screens: hold to walk / turn */
function TouchPad({ rt }: { rt: EvaRuntime }) {
  const hold = (k: "forward" | "turn", val: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.currentTarget.setPointerCapture(e.pointerId); rt.input[k] = val; },
    onPointerUp: () => { rt.input.forward = 0; rt.input.turn = 0; },
    onPointerCancel: () => { rt.input.forward = 0; rt.input.turn = 0; },
  });
  return (
    <div className="pointer-events-auto hidden gap-2 max-sm:flex [@media(pointer:coarse)]:flex">
      <button type="button" className="eva-btn" {...hold("turn", -1)}>◀</button>
      <button type="button" className="eva-btn" {...hold("forward", 1)}>▲</button>
      <button type="button" className="eva-btn" {...hold("forward", -1)}>▼</button>
      <button type="button" className="eva-btn" {...hold("turn", 1)}>▶</button>
    </div>
  );
}
