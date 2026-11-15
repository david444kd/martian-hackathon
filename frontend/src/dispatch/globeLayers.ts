// The globe's surface texture for a chosen base map + raster science layers (lib/marsLayers.ts):
// Mars Trek's equirectangular tiles at one zoom stitched into a canvas (zoom z = 2^(z+1) × 2^z tiles
// of 256 px, the same layout as the globe's own Viking texture), overlays drawn on top at their
// opacity. Quest gets zoom 2 (2048 × 1024, 32 tiles per layer), desktops zoom 3 (4096 × 2048).
import * as THREE from "three";
import { BASE_RASTERS, OVERLAY_RASTERS, type LayerChoice, type RasterLayer } from "../lib/marsLayers";
import { LOW_END } from "../lib/globeFx";

export const GLOBE_ZOOM = LOW_END ? 2 : 3;
/** the globe's built-in Viking colour texture (scripts/build_globe_texture.py, zoom 3) */
export const DEFAULT_TEXTURE = "/textures/mars-4k.jpg";

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error(src));
  img.src = src;
});

/** runs jobs with at most n in flight */
async function pool<T>(jobs: (() => Promise<T>)[], n: number) {
  const out: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      try { out[i] = { status: "fulfilled", value: await jobs[i]() }; } catch (e) { out[i] = { status: "rejected", reason: e }; }
    }
  }));
  return out;
}

// stitched layers, kept for quick switching back (only a few: each is 8 MB on Quest, 32 MB on desktop)
const stitched = new Map<string, Promise<{ canvas: HTMLCanvasElement; failed: number }>>();

/** one Trek layer at zoom z (capped at its native zoom) as a canvas; failed tiles stay transparent */
function stitch(layer: RasterLayer, zoom: number) {
  const z = Math.min(zoom, layer.maxNativeZoom), key = `${layer.url}@${z}`;
  const hit = stitched.get(key);
  if (hit) return hit;
  const job = (async () => {
    const cols = 2 ** (z + 1), rows = 2 ** z;
    const canvas = document.createElement("canvas");
    canvas.width = cols * 256; canvas.height = rows * 256;
    const ctx = canvas.getContext("2d")!;
    const jobs: (() => Promise<void>)[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
      jobs.push(async () => { ctx.drawImage(await loadImage(layer.url.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x))), x * 256, y * 256); });
    const res = await pool(jobs, 8);
    const failed = res.filter((r) => r.status === "rejected").length;
    if (failed === jobs.length) throw new Error("no tiles");
    return { canvas, failed };
  })();
  stitched.set(key, job);
  job.catch(() => stitched.delete(key));
  while (stitched.size > 3) stitched.delete(stitched.keys().next().value!);
  return job;
}

export const choiceKey = (c: LayerChoice) => [c.base, ...c.overlays.filter((o) => OVERLAY_RASTERS[o]).sort()].join("+");

/** the texture for a choice; null when the built-in texture alone is right (Viking, no raster overlay) */
export async function buildGlobeTexture(c: LayerChoice): Promise<{ texture: THREE.Texture; failed: number } | null> {
  const overlays = c.overlays.map((o) => OVERLAY_RASTERS[o]).filter((r): r is RasterLayer => !!r);
  const base = BASE_RASTERS[c.base];
  if (c.base === "viking" && overlays.length === 0) return null;

  const W = 256 * 2 ** (GLOBE_ZOOM + 1), H = W / 2;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  let failed = 0;
  if (c.base === "viking" || !base) ctx.drawImage(await loadImage(DEFAULT_TEXTURE), 0, 0, W, H);
  else { const b = await stitch(base, GLOBE_ZOOM); failed += b.failed; ctx.drawImage(b.canvas, 0, 0, W, H); }
  const layers = await Promise.allSettled(overlays.map((o) => stitch(o, GLOBE_ZOOM)));
  layers.forEach((r, i) => {
    if (r.status === "rejected") { failed++; return; }
    failed += r.value.failed;
    ctx.globalAlpha = overlays[i].opacity;
    ctx.drawImage(r.value.canvas, 0, 0, W, H);
  });
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = LOW_END ? 2 : 8;
  return { texture, failed };
}
