// The ground around the astronaut in full detail: HiRISE tiles (~0.6 m/px) for a few hundred metres
// around where they stand, fetched on the fly, coloured like the zone texture and faded out at the
// edge so it blends into the zone-wide photo (2.5 m/px).
import { useEffect, useState } from "react";
import * as THREE from "three";

const TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.png";
const LAYER: Record<string, string> = {
  jezero: "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd",
  gale: "curiosity_hirise_mosaic",
};
const Z = 16;                        // 256 px tiles ≈ 0.64 m/px
const M_PER_DEG = (Math.PI / 180) * 3_389_500;
const DUST = [1.36, 0.94, 0.66];     // same colouring as scripts/build_zone_photos.py (with gamma 0.8)

export interface Bounds { north: number; south: number; west: number; east: number }
export interface Closeup { texture: THREE.CanvasTexture; bounds: Bounds; key: string }

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
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const url = TREK.replace("{layer}", layer).replace("{z}", String(Z)).replace("{y}", String(y)).replace("{x}", String(x));
      jobs.push(tile(url, signal).then((img) => { if (img) ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256); }));
    }
  }
  await Promise.all(jobs);
  if (signal.aborted) return null;

  // colour the greyscale, and fade the alpha out towards the edge of the circle
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
  const cx = (fx(lon) - x0) * 256, cy = (fy(lat) - y0) * 256;
  const rPx = (radius / M_PER_DEG) * (2 ** Z / 180) * 256; // radius in canvas pixels (rows)
  const sx = Math.cos((lat * Math.PI) / 180); // columns are narrower in metres than rows
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      const i = (py * canvas.width + px) * 4;
      const g = 255 * (d[i] / 255) ** 0.8; // lift the shadows a little: they're baked into the photo
      d[i] = Math.min(255, g * DUST[0]);
      d[i + 1] = Math.min(255, g * DUST[1]);
      d[i + 2] = Math.min(255, g * DUST[2]);
      const r = Math.hypot((px - cx) * sx, py - cy) / rPx;
      const f = r < 0.7 ? 1 : r > 1 ? 0 : 1 - (r - 0.7) / 0.3;
      d[i + 3] *= f * f * (3 - 2 * f); // smoothstep
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const bounds = {
    west: (x0 / 2 ** (Z + 1)) * 360 - 180, east: ((x1 + 1) / 2 ** (Z + 1)) * 360 - 180,
    north: 90 - (y0 / 2 ** Z) * 180, south: 90 - ((y1 + 1) / 2 ** Z) * 180,
  };
  return { texture, bounds, key: `${zoneId}|${lat.toFixed(5)}|${lon.toFixed(5)}` };
}

/** the close-up around (lat, lon); keeps showing the previous one until the next has loaded */
export function useCloseup(zoneId: string, lat: number, lon: number, radius = 400) {
  const [c, setC] = useState<Closeup | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    load(zoneId, lat, lon, radius, ac.signal).then((next) => {
      if (!next) return;
      setC((prev) => { prev?.texture.dispose(); return next; });
    }).catch(() => {});
    return () => ac.abort();
  }, [zoneId, lat, lon, radius]);
  useEffect(() => () => c?.texture.dispose(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return c;
}
