// The EVA scene's rendering budget. A standalone headset (Meta Quest 2: a phone GPU drawing two eyes
// at 72 Hz) gets fewer triangles, a smaller shadow map and stronger foveation than a desktop.
//   ?quest  try the headset budget on a desktop      ?lite  the cheapest settings (no shadows)
//   ?scale=1.2  XR framebuffer scale (sharper, slower)   ?fov=0..1  fixed foveation (1 = strongest)
// Frame rate in the headset is not measured here: NOT TESTED ON DEVICE.
import { LOW_END } from "../lib/globeFx";

const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
export const LITE = q.has("lite");
export const QUEST = LOW_END || q.has("quest") || LITE;

const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);

export const Q = {
  /** XR framebuffer scale and fixed foveation (0 = none, 1 = strongest) */
  fbScale: num("scale") ?? (LITE ? 0.85 : QUEST ? 1 : 1.15),
  foveation: num("fov") ?? (LITE ? 1 : QUEST ? 0.45 : 0.3),
  /** terrain: every DTM cell out to lod[0] m, every 2nd to lod[1], every 4th beyond */
  lod: (LITE ? [300, 900] : QUEST ? [520, 1500] : [1000, 2800]) as [number, number],
  shadows: !LITE,
  shadowSize: QUEST ? 1024 : 2048,
  /** half-width of the shadowed square round the astronaut, m */
  shadowBox: QUEST ? 42 : 70,
  /** redraw the shadow map every n-th frame (it is also redrawn when the scene changes) */
  shadowEvery: QUEST ? 3 : 1,
  aniso: LITE ? 2 : QUEST ? 4 : 8,
  /** rocks: how far pebbles / stones / boulders are drawn, m */
  rocks: (QUEST ? [26, 55, 110] : [34, 70, 150]) as [number, number, number],
  /** buttes are drawn this far, m */
  buttes: QUEST ? 1000 : 1300,
  /** wind-blown sand streaks and drifting dust billows in a storm */
  streaks: LITE ? 260 : QUEST ? 520 : 900,
  sheets: LITE ? 6 : QUEST ? 10 : 16,
  /** noise layers of the storm front */
  wallLayers: QUEST ? 2 : 3,
  wallSeg: QUEST ? 64 : 112,
};
