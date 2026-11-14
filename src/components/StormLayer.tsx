// An anomaly on a Leaflet zone map as a live picture (lib/stormArt.ts): a canvas in the overlay
// pane, kept over the anomaly's area as the map moves, redrawn ~30 times a second.
import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { drawStorm, seedOf } from "../lib/stormArt";
import type { MarsEvent } from "../lib/types";

const M_PER_DEG = (Math.PI / 180) * 3_389_500;

export function StormCanvas({ e, active }: { e: MarsEvent; active: boolean }) {
  const map = useMap();
  const { id, kind, level, lat, lon, radius_m } = e;
  useEffect(() => {
    if (lat == null || lon == null || radius_m == null) return;
    const pane = map.getPane("overlayPane");
    if (!pane) return;
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide", pane) as HTMLCanvasElement;
    canvas.style.position = "absolute"; canvas.style.pointerEvents = "none";
    const ctx = canvas.getContext("2d")!, seed = seedOf(id), dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0, last = 0;
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      if (ms - last < 33) return;
      last = ms;
      const c = map.latLngToLayerPoint([lat, lon]), edge = map.latLngToLayerPoint([lat + radius_m / M_PER_DEG, lon]);
      const r = Math.abs(c.y - edge.y), size = Math.ceil(r * 2.7);
      const b = map.getSize(), o = map.containerPointToLayerPoint([0, 0]);
      // off-screen: nothing to draw
      if (c.x + size / 2 < o.x || c.y + size / 2 < o.y || c.x - size / 2 > o.x + b.x || c.y - size / 2 > o.y + b.y) { canvas.style.display = "none"; return; }
      canvas.style.display = "";
      // draw at most 640 px across, stretched over the area when zoomed far in
      const res = Math.max(32, Math.min(640, Math.round(size * dpr)));
      if (canvas.width !== res) { canvas.width = res; canvas.height = res; }
      canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
      L.DomUtil.setPosition(canvas, L.point(c.x - size / 2, c.y - size / 2));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, res, res);
      const k = res / size;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawStorm(ctx, size / 2, size / 2, r, ms / 1000, { kind, level, active, seed });
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); canvas.remove(); };
  }, [map, id, kind, level, lat, lon, radius_m, active]);
  return null;
}
