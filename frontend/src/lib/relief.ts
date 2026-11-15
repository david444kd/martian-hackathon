// Colouring a heightmap: an elevation ramp and a hillshade, shared by the 2D map and the 3D terrain.

// Mars ramp: low → high
const RAMP: [number, number, number][] = [[58, 30, 22], [120, 62, 38], [176, 98, 58], [214, 150, 98], [236, 205, 160]];

function ramp(t: number): [number, number, number] {
  const f = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(f)), k = f - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** hillshade (sun from the north-west, 40° up) in 0..1 for cell i */
function shade(h: Float32Array, W: number, H: number, dx: number, dy: number, x: number, y: number) {
  const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
  const gx = (h[y * W + xr] - h[y * W + xl]) / ((xr - xl) * dx);
  const gy = (h[yd * W + x] - h[yu * W + x]) / ((yd - yu) * dy);
  // normal (-gx, 1, -gy) in (east, up, south); sun towards north-west
  const az = (315 * Math.PI) / 180, alt = (40 * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt), lz = -Math.cos(az) * Math.cos(alt), ly = Math.sin(alt);
  const n = Math.hypot(gx, 1, gy);
  return Math.max(0, (-gx * lx + ly + -gy * lz) / n);
}

const cache = new WeakMap<Float32Array, HTMLCanvasElement>();

/** the zone drawn as shaded relief, one canvas pixel per heightmap cell (cached per heightmap) */
export function reliefCanvas(h: Float32Array, W: number, H: number, dx: number, dy: number, min: number, max: number) {
  const hit = cache.get(h);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, [r, g, b] = ramp((h[i] - min) / (max - min || 1));
      const s = 0.35 + 0.85 * shade(h, W, H, dx, dy, x, y);
      img.data[i * 4] = Math.min(255, r * s);
      img.data[i * 4 + 1] = Math.min(255, g * s);
      img.data[i * 4 + 2] = Math.min(255, b * s);
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cache.set(h, c);
  return c;
}
