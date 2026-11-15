// Runs the route search off the main thread.
import { findPath } from "./pathfind";
import type { Zone } from "./zones";
import type { Avoid } from "./hazards";

export interface PathRequest { zone: Zone; h: Float32Array; from: [number, number]; to: [number, number]; avoid: Avoid[] }

self.onmessage = (e: MessageEvent<PathRequest>) => {
  const { zone, h, from, to, avoid } = e.data;
  try {
    const result = findPath(zone, h, from, to, avoid);
    self.postMessage(result ? { ok: true, result } : { ok: false, error: "No safe walking route: the target is cut off by slopes over 25° or closed areas." });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
