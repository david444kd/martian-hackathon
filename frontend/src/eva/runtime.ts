// What the 3D scene and the screen HUD share every frame without going through React state:
// the astronaut's pose (written by the Player) and the inputs pressed on screen. The HUD samples
// it a few times a second (useRuntime), the 3D HUD reads it directly.
import { useEffect, useState } from "react";
import type { Polyline } from "./frame";

/** a closed area the astronaut may leave but not walk into (critical anomalies), local frame */
export interface Closed { x: number; z: number; r: number }

export interface Pose {
  x: number; z: number;   // local frame, m
  y: number;              // ground height there
  heading: number;        // compass degrees, where the astronaut is looking
  speed: number;          // m/s over the ground, smoothed
  moving: boolean;
  slope: number;          // degrees under the boots
  blocked: string;        // why the last step was refused ("" = it wasn't)
}

export class EvaRuntime {
  pose: Pose = { x: 0, z: 0, y: 0, heading: 0, speed: 0, moving: false, slope: 0, blocked: "" };
  /** set once the astronaut has been placed in the world (first plan / telemetry / base) */
  placed = false;
  /** the scene asks to put the astronaut here (spawn or a jump), consumed by the Player */
  teleportTo: { x: number; z: number; heading?: number } | null = null;
  input = { forward: 0, right: 0, turn: 0, fast: false };
  autopilot = false;
  /** autopilot pace multiplier over a suited walk (?speed=) */
  autoSpeed = 1;
  /** how much of the normal walking pace the astronaut can keep, 0.65 (exhausted) .. 1 (fresh): useEva sets it from the suit model */
  pace = 1;
  presenting = false;
  /** the active route in the local frame (autopilot follows it), and how far along it we are */
  line: Polyline | null = null;
  progress = 0;
  closed: Closed[] = [];
  /** solid things to walk around (the habitat) */
  solid: Closed[] = [];
  /** ack requested from a controller button (A) */
  ackPressed = 0;
  /** counts up when something should be felt in the controllers (an alert, a notice): Presence.tsx */
  buzz = 0;
  private ls = new Set<() => void>();
  subscribe(l: () => void) { this.ls.add(l); return () => { this.ls.delete(l); }; }
  notify() { this.ls.forEach((l) => l()); }
}

/** re-render every `ms` while mounted (the HUD reads the runtime directly) */
export function useTicker(ms = 200) {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(id); }, [ms]);
}
