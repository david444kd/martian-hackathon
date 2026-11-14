// Runs the route search off the main thread.
import { findPath } from "./pathfind";
import type { Zone } from "./zones";

export interface PathRequest { zone: Zone; h: Float32Array; from: [number, number]; to: [number, number] }

self.onmessage = (e: MessageEvent<PathRequest>) => {
  const { zone, h, from, to } = e.data;
  try {
    const result = findPath(zone, h, from, to);
    self.postMessage(result ? { ok: true, result } : { ok: false, error: "No safe walking route: the target is cut off by slopes over 25°." });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
