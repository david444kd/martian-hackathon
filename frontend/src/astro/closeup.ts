// The ground around the astronaut in full detail: HiRISE tiles (~0.6 m/px) for a few hundred metres
// around where they stand, fetched on the fly; detail.ts's shader colours it like the zone texture
// and fades it out at the edge so it blends into the zone-wide photo (2.5 m/px).
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.png";
const LAYER: Record<string, string> = {
  jezero: "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd",
  gale: "curiosity_hirise_mosaic",
};
const Z = 16;                        // 256 px tiles ≈ 0.64 m/px
const M_PER_DEG = (Math.PI / 180) * 3_389_500;

interface Bounds { north: number; south: number; west: number; east: number }
export interface Closeup { texture: THREE.CanvasTexture; bounds: Bounds; fade: { center: THREE.Vector2; scale: THREE.Vector2 } }

function tile(url: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    signal.addEventListener("abort", () => { img.src = ""; resolve(null); });
    img.src = url;
  });
}

async function load(zoneId: string, lat: number, lon: number, radius: number, signal: AbortSignal): Promise<Closeup | null> {
  const layer = LAYER[zoneId];
  if (!layer) return null;
  const dLat = radius / M_PER_DEG, dLon = radius / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  const fx = (l: number) => ((l + 180) / 360) * 2 ** (Z + 1), fy = (l: number) => ((90 - l) / 180) * 2 ** Z;
  const x0 = Math.floor(fx(lon - dLon)), x1 = Math.floor(fx(lon + dLon));
  const y0 = Math.floor(fy(lat + dLat)), y1 = Math.floor(fy(lat - dLat));
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;

  const canvas = document.createElement("canvas");
  canvas.width = nx * 256;
  canvas.height = ny * 256;
  const ctx = canvas.getContext("2d")!;
  const jobs: Promise<void>[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const url = TREK.replace("{layer}", layer).replace("{z}", String(Z)).replace("{y}", String(y)).replace("{x}", String(x));
      jobs.push(tile(url, signal).then((img) => { if (img) ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256); }));
    }
  }
  await Promise.all(jobs);
  if (signal.aborted) return null;

  // the shader colours the greyscale and fades it out towards this circle's edge (see detail.ts)
  const cx = (fx(lon) - x0) * 256, cy = (fy(lat) - y0) * 256;
  const rPx = (radius / M_PER_DEG) * (2 ** Z / 180) * 256;    // radius in canvas pixels (rows)
  const sx = Math.cos((lat * Math.PI) / 180);                  // columns are narrower in metres than rows
  const fade = {
    center: new THREE.Vector2(cx / canvas.width, 1 - cy / canvas.height),
    scale: new THREE.Vector2((canvas.width * sx) / rPx, canvas.height / rPx),
  };

  const texture = new THREE.CanvasTexture(canvas); // raw greyscale: the shader colours it
  const bounds = {
    west: (x0 / 2 ** (Z + 1)) * 360 - 180, east: ((x1 + 1) / 2 ** (Z + 1)) * 360 - 180,
    north: 90 - (y0 / 2 ** Z) * 180, south: 90 - ((y1 + 1) / 2 ** Z) * 180,
  };
  return { texture, bounds, fade };
}

/** the close-up around (lat, lon); keeps showing the previous one until the next has loaded */
export function useCloseup(zoneId: string, lat: number, lon: number, radius = 400) {
  const [c, setC] = useState<Closeup | null>(null);
  const shown = useRef<Closeup | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    load(zoneId, lat, lon, radius, ac.signal).then((next) => {
      if (!next) return;
      shown.current?.texture.dispose();
      shown.current = next;
      setC(next);
    }).catch(() => {});
    return () => ac.abort();
  }, [zoneId, lat, lon, radius]);
  useEffect(() => () => shown.current?.texture.dispose(), []);
  return c;
}
