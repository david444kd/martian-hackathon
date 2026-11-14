// Turning a zone heightmap and a route into scene geometry.
// Local terrain frame, in metres: X east, Y up (height above the zone's lowest point), Z south,
// origin at the zone centre.
import * as THREE from "three";
import { heightAt, toPx, type Heightmap } from "../lib/zones";
import { ramp, shade } from "../lib/relief";

export const MESH_STEP = 1; // every heightmap cell (20 m): 512 × 512 vertices

export function localOf(hm: Heightmap, lat: number, lon: number, lift = 0): THREE.Vector3 {
  const z = hm.zone, [x, y] = toPx(z, lat, lon);
  const e = heightAt(hm.h, z.width, z.height, x, y);
  return new THREE.Vector3((x - z.width / 2) * z.dx, e - z.min + lift, (y - z.height / 2) * z.dy);
}

/**
 * A terrain mesh over heightmap cells [i0, i1) × [j0, j1), every `step` cells, in the local frame.
 * uv(x, y) gives the texture coordinate of a point in pixel coordinates.
 */
function grid(hm: Heightmap, i0: number, i1: number, j0: number, j1: number, step: number, uv: (x: number, y: number) => [number, number], colours = false) {
  const { width: W, height: H, dx, dy, min, max } = hm.zone, h = hm.h;
  const n = Math.floor((i1 - 1 - i0) / step) + 1, m = Math.floor((j1 - 1 - j0) / step) + 1;
  const pos = new Float32Array(n * m * 3), tex = new Float32Array(n * m * 2), col = colours ? new Float32Array(n * m * 3) : null;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      const px = i0 + i * step, py = j0 + j * step, v = j * n + i, e = h[py * W + px];
      pos[v * 3] = (px + 0.5 - W / 2) * dx;
      pos[v * 3 + 1] = e - min;
      pos[v * 3 + 2] = (py + 0.5 - H / 2) * dy;
      const [u, w] = uv(px + 0.5, py + 0.5);
      tex[v * 2] = u;
      tex[v * 2 + 1] = w;
      if (col) {
        const [r, g, b] = ramp((e - min) / (max - min || 1)), s = 0.3 + 0.9 * shade(h, W, H, dx, dy, px, py);
        col[v * 3] = srgbToLinear(Math.min(1, (r * s) / 255));
        col[v * 3 + 1] = srgbToLinear(Math.min(1, (g * s) / 255));
        col[v * 3 + 2] = srgbToLinear(Math.min(1, (b * s) / 255));
      }
    }
  }
  const idx = new Uint32Array((n - 1) * (m - 1) * 6);
  let k = 0;
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(tex, 2));
  if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** the whole zone; uv maps the zone's photo texture (row 0 = north = top of the image) */
export function terrainGeometry(hm: Heightmap, step = MESH_STEP): THREE.BufferGeometry {
  const { width: W, height: H } = hm.zone;
  return grid(hm, 0, W, 0, H, step, (x, y) => [x / W, 1 - y / H], true);
}

/** the part of the zone inside lat/lon bounds, with uv spanning those bounds (for a close-up texture) */
export function patchGeometry(hm: Heightmap, b: { north: number; south: number; west: number; east: number }) {
  const z = hm.zone;
  const [x0, y0] = toPx(z, b.north, b.west), [x1, y1] = toPx(z, b.south, b.east);
  const i0 = Math.max(0, Math.floor(x0)), i1 = Math.min(z.width, Math.ceil(x1));
  const j0 = Math.max(0, Math.floor(y0)), j1 = Math.min(z.height, Math.ceil(y1));
  return grid(hm, i0, i1, j0, j1, 1, (x, y) => [(x - x0) / (x1 - x0), 1 - (y - y0) / (y1 - y0)]);
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** a text label as a sprite texture */
export function labelTexture(text: string, color: string, bg = "rgba(10,8,6,0.75)") {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 56px system-ui, sans-serif";
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  c.width = w; c.height = 84;
  ctx.font = "bold 56px system-ui, sans-serif";
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, w, 84, 18); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.stroke();
  ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText(text, w / 2, 45);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, aspect: w / 84 };
}
