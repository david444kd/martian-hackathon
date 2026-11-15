// Orbital map layers of Mars, shared by the zone maps (Leaflet tiles) and the mission-control globe
// (the same tiles stitched into a texture). Taken over from the Martian Map project (NASA Space Apps
// 2026, "Code Huzzlers"): all rasters are NASA Mars Trek WMTS in the equirectangular tile matrix
// (zoom z: 2^(z+1) × 2^z tiles of 256 px, longitude -180 at the left, row 0 at the north pole),
// the point layers are its compaction of Mars Trek feature services (public/data/science_features.json,
// rebuilt by scripts/build_map_layers.py). Imagery only: no layer changes routes, hazards or terrain.

export const TREK_EQ = (layer: string, ext: "png" | "jpg") =>
  `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;

export interface RasterLayer {
  /** tile URL template with {z}/{y}/{x} */
  url: string;
  /** deepest zoom the server has; Leaflet scales those tiles up beyond it */
  maxNativeZoom: number;
  /** drawn over the base map at this opacity (overlays) */
  opacity: number;
  attribution: string;
}

/** a base map: one at a time. "photo" and "relief" exist only on the zone maps (CTX/HiRISE and our DTM) */
export type BaseId = "photo" | "relief" | "viking" | "themis_day" | "themis_night" | "mola";
/** extra layers on top of the base map; geology_jezero only on the Jezero zone, the point layers only on the globe */
export type OverlayId = "geology" | "inertia" | "dust" | "geology_jezero" | "minerals" | "ice";

export const BASE_RASTERS: Partial<Record<BaseId, RasterLayer>> = {
  viking: { url: TREK_EQ("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg"), maxNativeZoom: 7, opacity: 1, attribution: "Viking MDIM 2.1 · NASA/JPL-Caltech/USGS · Mars Trek" },
  themis_day: { url: TREK_EQ("THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png"), maxNativeZoom: 9, opacity: 1, attribution: "THEMIS day IR · NASA/JPL-Caltech/ASU · Mars Trek" },
  themis_night: { url: TREK_EQ("THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", "png"), maxNativeZoom: 9, opacity: 1, attribution: "THEMIS night IR · NASA/JPL-Caltech/ASU · Mars Trek" },
  mola: { url: TREK_EQ("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg"), maxNativeZoom: 6, opacity: 1, attribution: "MGS MOLA · NASA/GSFC · Mars Trek" },
};

export const OVERLAY_RASTERS: Partial<Record<OverlayId, RasterLayer>> = {
  geology: {
    url: "https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/1.0.0/SIM3292_Global_Geology/default/default028mm/{z}/{y}/{x}.png",
    maxNativeZoom: 11, opacity: 0.55, attribution: "USGS SIM 3292 (Tanaka et al. 2014) · Mars Trek",
  },
  inertia: { url: TREK_EQ("TES_Thermal_Inertia", "png"), maxNativeZoom: 1, opacity: 0.6, attribution: "MGS TES thermal inertia · Mars Trek" },
  dust: { url: TREK_EQ("tes_ruffdust", "png"), maxNativeZoom: 2, opacity: 0.6, attribution: "MGS TES dust cover index · Mars Trek" },
};

/** where each layer can be switched on */
export const ZONE_BASES: BaseId[] = ["photo", "relief", "viking", "themis_day", "themis_night", "mola"];
export const GLOBE_BASES: BaseId[] = ["viking", "themis_day", "themis_night", "mola"];
export const ZONE_OVERLAYS: OverlayId[] = ["geology_jezero", "geology", "inertia", "dust"];
export const GLOBE_OVERLAYS: OverlayId[] = ["geology", "inertia", "dust", "minerals", "ice"];

/** legend colour ramps (from the Mars Trek colour tables) */
export const RAMPS: Partial<Record<BaseId | OverlayId, string>> = {
  inertia: "linear-gradient(90deg, #4b0091, #2049ff, #00d0ff, #00ff6a, #f5ff00, #ff8a00, #ff0000)",
  dust: "linear-gradient(90deg, #ff3b00, #ffb000, #9cff57, #00c8ff, #3048ff)",
  mola: "linear-gradient(90deg, #1b2a8c, #2f7bd9, #34c6c0, #8fd14f, #f2d43d, #e8742c, #c0392b, #f4f4f4)",
  themis_night: "linear-gradient(90deg, #111, #666, #eee)",
};

// ---------- point layers (globe) ----------
/** mineral classes, coloured as in Ehlmann & Edwards (2014) */
export const MINERAL_COLORS = {
  phyllosilicate: "#3d9bff", silica: "#a46bff", sulfate: "#ff9f1c", chloride: "#ffe14d", carbonate: "#2ecc71", hydrous: "#00d0ff",
} as const;
export const ACTIVE_COLORS = { ice: "#dff6ff", rsl: "#ff4d4d", gully: "#ff8c42", fresh: "#b9b2ac" } as const;

export interface ScienceFeatures {
  source: string;
  hydrous: [number, number, string][];
  aqueous: [number, number, string][];
  chloride: [number, number, number][];
  active: [number, number, string, string, string][];
}

/** what a HiRISE "active" record is, in our four groups */
export const activeGroup = (type: string): keyof typeof ACTIVE_COLORS =>
  /icy/.test(type) ? "ice" : /RSL/.test(type) ? "rsl" : /gully/.test(type) ? "gully" : "fresh";

let features: Promise<ScienceFeatures> | null = null;
/** the point layers' data, fetched once on first use */
export function loadScienceFeatures() {
  features ??= fetch("/data/science_features.json").then((r) => {
    if (!r.ok) throw new Error(`science_features.json: HTTP ${r.status}`);
    return r.json() as Promise<ScienceFeatures>;
  }).catch((e) => { features = null; throw e; });
  return features;
}

// ---------- detailed geologic map of Jezero (zone map) ----------
export interface JezeroGeology {
  source: string;
  url: string;
  units: Record<string, { symbol: string; name: string; colour: string; interpretation: string }>;
  /** [unit code, rings of [lon, lat]] */
  shapes: [string, [number, number][][]][];
}

let jezero: Promise<JezeroGeology> | null = null;
export function loadJezeroGeology() {
  jezero ??= fetch("/data/jezero_geology_zone.json").then((r) => {
    if (!r.ok) throw new Error(`jezero_geology_zone.json: HTTP ${r.status}`);
    return r.json() as Promise<JezeroGeology>;
  }).catch((e) => { jezero = null; throw e; });
  return jezero;
}

// ---------- remembered choice per surface ----------
export interface LayerChoice { base: BaseId; overlays: OverlayId[] }

export function loadChoice(key: string, fallback: LayerChoice, bases: BaseId[], overlays: OverlayId[]): LayerChoice {
  try {
    const raw = localStorage.getItem(`mars-ops.layers.${key}`);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<LayerChoice>;
    return {
      base: v.base && bases.includes(v.base) ? v.base : fallback.base,
      overlays: Array.isArray(v.overlays) ? v.overlays.filter((o) => overlays.includes(o)) : fallback.overlays,
    };
  } catch { return fallback; }
}

export function saveChoice(key: string, c: LayerChoice) {
  try { localStorage.setItem(`mars-ops.layers.${key}`, JSON.stringify(c)); } catch { /* storage blocked: keep it for this visit only */ }
}
