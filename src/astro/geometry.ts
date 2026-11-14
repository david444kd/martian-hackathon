// Turning a zone heightmap and a route into scene geometry.
// Local terrain frame, in metres: X east, Y up (height above the zone's lowest point), Z south,
// origin at the zone centre.
import * as THREE from "three";
import { heightAt, toPx, type Heightmap } from "../lib/zones";
import { ramp, shade } from "../lib/relief";

export const MESH_STEP = 2; // every 2nd pixel: 256 x 256 vertices (~40 m), light enough for Quest 2

export function localOf(hm: Heightmap, lat: number, lon: number, lift = 0): THREE.Vector3 {
  const z = hm.zone, [x, y] = toPx(z, lat, lon);
  const e = heightAt(hm.h, z.width, z.height, x, y);
  return new THREE.Vector3((x - z.width / 2) * z.dx, e - z.min + lift, (y - z.height / 2) * z.dy);
}

export function terrainGeometry(hm: Heightmap, step = MESH_STEP): THREE.BufferGeometry {
  const { width: W, height: H, dx, dy, min, max } = hm.zone, h = hm.h;
  const n = Math.floor(W / step), m = Math.floor(H / step);
  const pos = new Float32Array(n * m * 3), col = new Float32Array(n * m * 3);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      const px = i * step, py = j * step, v = (j * n + i) * 3, e = h[py * W + px];
      pos[v] = (px + 0.5 - W / 2) * dx;
      pos[v + 1] = e - min;
      pos[v + 2] = (py + 0.5 - H / 2) * dy;
      const [r, g, b] = ramp((e - min) / (max - min || 1)), s = 0.3 + 0.9 * shade(h, W, H, dx, dy, px, py);
      // canvas-style sRGB colours → linear for three
      col[v] = srgbToLinear(Math.min(1, (r * s) / 255));
      col[v + 1] = srgbToLinear(Math.min(1, (g * s) / 255));
      col[v + 2] = srgbToLinear(Math.min(1, (b * s) / 255));
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
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
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
