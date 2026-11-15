// The suit display on a screen: the helmet visor over the view (glass, shell, breath fog) and the
// same head-up display blocks as inside the headset (xrHud.ts), pinned round the edge of the visor on a
// canvas over the view, sharp at the screen's pixel ratio. The display is information only; the demo operator
// gets two small buttons in the corner (sound, Enter VR) and hold-to-walk pads on touch screens.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Glasses, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Heightmap } from "../lib/zones";
import type { P2 } from "./frame";
import type { EvaRuntime } from "./runtime";
import type { EvaApi } from "./useEva";
import { drawHudScreen } from "./xrHud";
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

export function EvaHud({ v, rt, hm, home, vrOk, muted, onMute, onEnterVr }: Props) {
  const { t } = useTranslation();
  const s = v.suit;
  const recalled = v.mode === "return" || v.recall.state === "computing" || v.recall.state === "failed";
  const critical = recalled || v.top?.level === "critical";

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

      {/* the head-up display projected on the visor */}
      <HudCanvas v={v} rt={rt} hm={hm} home={home} />

      {/* operator controls for the demo, out of the way: the astronaut's display has nothing to press */}
      <div className="absolute right-4 bottom-4 flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex items-center gap-1.5 opacity-60 transition-opacity hover:opacity-100">
          <button type="button" className="eva-btn" onClick={onMute} title={muted ? t("evahud.sound_on") : t("evahud.mute")} aria-label={muted ? t("evahud.sound_on") : t("evahud.mute")}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          {vrOk && <button type="button" className="eva-btn" onClick={onEnterVr}><Glasses className="size-4" /> {t("helmet.enter_vr")}</button>}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-3 flex justify-center"><TouchPad rt={rt} /></div>
    </div>
  );
}

/** the visor HUD at 30 fps over the whole view, its blocks pinned round the visor edge */
function HudCanvas({ v, rt, hm, home }: { v: EvaApi; rt: EvaRuntime; hm: Heightmap; home: P2 }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // the latest props for the drawing loop, which runs on its own (the page re-renders often)
  const latest = useRef({ v, rt, hm, home });
  useEffect(() => { latest.current = { v, rt, hm, home }; });
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let k = 1, w = 0, ht = 0, raf = 0, last = 0;
    const fit = () => {
      const r = c.getBoundingClientRect();
      k = Math.min(2, window.devicePixelRatio || 1); w = r.width; ht = r.height;
      const pw = Math.round(w * k), ph = Math.round(ht * k);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      if (ms - last < 33 || !w) return;
      last = ms;
      const p = latest.current;
      drawHudScreen(ctx, { hm: p.hm, v: p.v, rt: p.rt, home: p.home, t: ms / 1000 }, w, ht, k);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 size-full" aria-hidden />;
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
