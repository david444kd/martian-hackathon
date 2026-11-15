// Recall: a walking route from where the astronaut is now back to the crew's base, around the active
// anomalies (critical ones closed). Used by the helmet when a hazard reaches the route, and by the
// ship's "Recall to base" button. Same A* as every other route; not a safety guarantee.
import type { Heightmap } from "./zones";
import type { Route } from "./types";
import type { Avoid } from "./hazards";
import { generateRoute } from "./routing";
import i18n from "../i18n";

export async function returnRoute(hm: Heightmap, from: [number, number], home: [number, number], avoid: Avoid[], reason: string): Promise<Route> {
  const r = await generateRoute(hm, from, home, avoid);
  return {
    ...r,
    start: { lat: from[0], lon: from[1], name: i18n.t("evahud.recall_point") },
    target: { lat: home[0], lon: home[1] },
    generated_at: new Date().toISOString(),
    mode: "return",
    reason,
  };
}
