// Generate a walking route in a Web Worker so the page stays responsive during the search.
import type { PathResult } from "./pathfind";
import type { PathRequest } from "./pathfind.worker";
import type { Heightmap } from "./zones";
import type { Avoid } from "./hazards";

export function generateRoute(hm: Heightmap, from: [number, number], to: [number, number], avoid: Avoid[] = []): Promise<PathResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pathfind.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ ok: true; result: PathResult } | { ok: false; error: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || "Route worker failed")); };
    const msg: PathRequest = { zone: hm.zone, h: hm.h, from, to, avoid };
    worker.postMessage(msg);
  });
}
