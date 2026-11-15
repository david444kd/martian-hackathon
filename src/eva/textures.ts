// Surface textures drawn in code (no downloaded images): each returns a colour map and a normal map
// derived from a height field, so light models the weave of the suit fabric, the seams and rivets of
// a hull, crinkled gold insulation, solar cells, tyre tread and rock strata. Cached per kind.
import * as THREE from "three";

export interface Tex { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap?: THREE.CanvasTexture }

const cache = new Map<string, Tex>();

function hash2(x: number, y: number) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
/** tileable value noise with period `p` cells */
function vnoise(x: number, y: number, p: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let u = x - ix, v = y - iy;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  const w = (a: number, b: number) => hash2(((a % p) + p) % p, ((b % p) + p) % p);
  return (w(ix, iy) * (1 - u) + w(ix + 1, iy) * u) * (1 - v) + (w(ix, iy + 1) * (1 - u) + w(ix + 1, iy + 1) * u) * v;
}
/** tileable fractal noise over the unit square, 0..1 */
function fbm(u: number, v: number, base = 4, oct = 5) {
  let s = 0, a = 0.5, f = base, n = 0;
  for (let o = 0; o < oct; o++) { s += vnoise(u * f, v * f, f) * a; n += a; a *= 0.5; f *= 2; }
  return s / n;
}

type Painter = (u: number, v: number) => { h: number; r: number; g: number; b: number; rough?: number };

/** run a painter over an N×N grid: colour, height → normal map, optional roughness */
function bake(key: string, N: number, paint: Painter, strength: number, repeat: [number, number] = [1, 1], withRough = false): Tex {
  const hit = cache.get(key);
  if (hit) return hit;
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = N; return c; };
  const cc = mk(), nc = mk(), rc = withRough ? mk() : null;
  const cx = cc.getContext("2d")!, nx = nc.getContext("2d")!, rx = rc?.getContext("2d");
  const ci = cx.createImageData(N, N), ni = nx.createImageData(N, N), ri = rx?.createImageData(N, N);
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = paint(x / N, y / N), i = y * N + x;
    H[i] = p.h;
    ci.data[i * 4] = p.r; ci.data[i * 4 + 1] = p.g; ci.data[i * 4 + 2] = p.b; ci.data[i * 4 + 3] = 255;
    if (ri) { const q = Math.round((p.rough ?? 0.8) * 255); ri.data[i * 4] = 255; ri.data[i * 4 + 1] = q; ri.data[i * 4 + 2] = 0; ri.data[i * 4 + 3] = 255; }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, l = H[y * N + ((x + N - 1) % N)], r = H[y * N + ((x + 1) % N)], u = H[((y + N - 1) % N) * N + x], d = H[((y + 1) % N) * N + x];
    const nxv = (l - r) * strength, nyv = (d - u) * strength, len = Math.hypot(nxv, nyv, 1);
    ni.data[i * 4] = (nxv / len * 0.5 + 0.5) * 255; ni.data[i * 4 + 1] = (nyv / len * 0.5 + 0.5) * 255; ni.data[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255; ni.data[i * 4 + 3] = 255;
  }
  cx.putImageData(ci, 0, 0); nx.putImageData(ni, 0, 0); if (ri) rx!.putImageData(ri, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const out: Tex = { map: tex(cc, true), normalMap: tex(nc, false), roughnessMap: rc ? tex(rc, false) : undefined };
  cache.set(key, out);
  return out;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const sat = (v: number) => Math.min(1, Math.max(0, v));

/** the suit's outer layer: white woven fabric (Ortho-Fabric), a little dusty, with fine creases */
export const fabric = (repeat: [number, number] = [6, 6]) => bake(`fabric${repeat}`, 256, (u, v) => {
  const wx = Math.sin(u * Math.PI * 2 * 40), wy = Math.sin(v * Math.PI * 2 * 40);
  const weave = (wx * wy > 0 ? 1 : -1) * Math.abs(wx) * Math.abs(wy);
  const crease = Math.pow(fbm(u, v, 3, 4), 2);
  const dust = fbm(u + 0.3, v + 0.7, 2, 4);
  const c = 232 + weave * 7 - crease * 26;
  return { h: weave * 0.35 + crease * 1.6, r: c + dust * 6, g: c - dust * 6, b: c - 4 - dust * 22 };
}, 2.2, repeat);

/** glove palms and fingertips: blue-grey silicone rubber with a fine grip pattern */
export const rubber = () => bake("rubber", 128, (u, v) => {
  const dots = Math.sin(u * Math.PI * 2 * 22) * Math.sin(v * Math.PI * 2 * 22);
  const n = fbm(u, v, 6, 3);
  const c = 0.9 + n * 0.2;
  return { h: dots * 0.5 + n * 0.4, r: 92 * c, g: 108 * c, b: 124 * c };
}, 2.5, [3, 3]);

/** a habitat / rover hull: painted panels with seams and rivets, streaked, dusted red towards the bottom (v = 1) */
export const hull = (repeat: [number, number] = [3, 1]) => bake(`hull${repeat}`, 512, (u, v) => {
  const pu = (u * 4) % 1, pv = (v * 3) % 1;
  const seam = Math.min(pu, 1 - pu) < 0.012 || Math.min(pv, 1 - pv) < 0.016 ? 1 : 0;
  const rivetU = Math.abs(((pu * 8) % 1) - 0.5) < 0.09, rivetV = Math.abs(((pv * 6) % 1) - 0.5) < 0.09;
  const edge = Math.min(pu, 1 - pu) < 0.05 || Math.min(pv, 1 - pv) < 0.065;
  const rivet = edge && !seam && ((Math.min(pu, 1 - pu) < 0.05 && rivetV) || (Math.min(pv, 1 - pv) < 0.065 && rivetU)) ? 1 : 0;
  const streak = fbm(u * 3, v * 0.25, 8, 4);
  const grime = fbm(u, v, 5, 5);
  const dust = sat((v - 0.62) * 2.2) * (0.35 + grime * 0.5);
  const tint = hash2(Math.floor(u * 4), Math.floor(v * 3)) * 10 - 5; // panels differ slightly
  let r = 240 + tint - streak * 14 - grime * 9, g = 237 + tint - streak * 15 - grime * 10, b = 230 + tint - streak * 18 - grime * 12;
  r = mix(r, 190, dust * 0.7); g = mix(g, 136, dust * 0.7); b = mix(b, 100, dust * 0.7);
  if (seam) { r *= 0.68; g *= 0.68; b *= 0.68; }
  if (rivet) { r *= 0.9; g *= 0.9; b *= 0.9; }
  return { h: (seam ? -1.2 : 0) + (rivet ? 0.9 : 0) + grime * 0.12, r, g, b, rough: 0.5 + dust * 0.4 + grime * 0.15 };
}, 3, repeat, true);

/** multi-layer insulation: crinkled gold foil */
export const foil = (repeat: [number, number] = [2, 2]) => bake(`foil${repeat}`, 256, (u, v) => {
  // creases: ridged noise at two scales, with flat facets between them
  const a = Math.abs(fbm(u, v, 9, 4) - 0.5) * 2, b = Math.abs(fbm(u + 0.37, v + 0.11, 22, 3) - 0.5) * 2;
  const h = Math.min(1, (1 - a) * 1.25) * 0.9 + (1 - b) * 0.45;
  const k = 0.9 + (1 - a) * 0.16;
  return { h, r: 226 * k, g: 168 * k, b: 74 * k };
}, 2.4, repeat);

/** solar cells: dark blue wafers in a grid with silver bus bars */
export const solar = (repeat: [number, number] = [1, 1]) => bake(`solar${repeat}`, 256, (u, v) => {
  const cu = (u * 8) % 1, cv = (v * 5) % 1;
  const gap = Math.min(cu, 1 - cu) < 0.035 || Math.min(cv, 1 - cv) < 0.045;
  const bus = Math.abs(cu - 0.33) < 0.012 || Math.abs(cu - 0.67) < 0.012;
  const finger = ((cv * 26) % 1) < 0.12;
  const sh = 0.85 + hash2(Math.floor(u * 8), Math.floor(v * 5)) * 0.3;
  if (gap) return { h: -0.6, r: 150, g: 150, b: 148, rough: 0.5 };
  if (bus) return { h: 0.3, r: 190, g: 192, b: 196, rough: 0.3 };
  return { h: 0, r: (finger ? 34 : 18) * sh, g: (finger ? 48 : 30) * sh, b: (finger ? 96 : 78) * sh, rough: 0.12 };
}, 2, repeat, true);

/** a rover tyre: chevron tread blocks on dark rubber, dust in the grooves */
export const tyre = () => bake("tyre", 256, (u, v) => {
  const t = (u * 18 + Math.abs(v - 0.5) * 6) % 1;
  const block = t > 0.28 && Math.abs(v - 0.5) < 0.46 ? 1 : 0;
  const n = fbm(u, v, 10, 3);
  const c = block ? 44 + n * 16 : 96 + n * 30;
  return { h: block, r: c * (block ? 1 : 1.25), g: c * (block ? 1 : 0.92), b: c * (block ? 1 : 0.7) };
}, 4, [1, 1]);

/** layered sedimentary rock: thin horizontal beds of varying hardness and colour, fractured, dusted */
export const strata = (seed = 0, repeat: [number, number] = [2, 1]) => bake(`strata${seed}${repeat}`, 512, (u, v) => {
  const warp = (fbm(u + seed * 0.13, v, 3, 4) - 0.5) * 0.06;
  const y = v + warp;
  const bed = fbm(0.5, y * 9 + seed, 24, 3);                 // which bed, by height
  const thin = fbm(0.2, y * 40 + seed * 3, 64, 2);
  const hard = sat((bed - 0.42) * 4);                           // hard beds stand out as ledges
  const grain = fbm(u, v, 24, 4);
  const crack = Math.pow(sat(1 - Math.abs(fbm(u * 2 + seed, v * 0.5, 9, 3) - 0.5) * 9), 3);
  const h = hard * 1.6 + thin * 0.5 + grain * 0.35 - crack * 1.4;
  const tone = 0.62 + bed * 0.5 + thin * 0.12 + grain * 0.12 - crack * 0.25;
  const red = 0.5 + fbm(u * 0.5, y * 5 + 7, 12, 2) * 0.5;      // iron-rich beds
  return { h, r: sat(tone * (0.74 + red * 0.16)) * 255, g: sat(tone * (0.47 + (1 - red) * 0.1)) * 255, b: sat(tone * (0.31 + (1 - red) * 0.07)) * 255, rough: 0.9 };
}, 3.2, repeat, true);

/** a rock's surface: pits and grain, near-white (the rock's own colours come from its vertices) */
export const boulder = () => bake("boulder", 256, (u, v) => {
  const n = fbm(u, v, 5, 5), pits = Math.pow(sat(fbm(u + 0.5, v + 0.2, 18, 3) * 2.6 - 1.25), 1.5);
  const c = 255 * sat(0.76 + n * 0.36 - pits * 0.3);
  return { h: n * 1.5 - pits, r: c, g: c, b: c };
}, 3.5, [2, 2]);

/** lettering / a mission patch on a transparent canvas */
export function label(text: string, opts: { color?: string; bg?: string; w?: number; h?: number; font?: string } = {}) {
  const key = `label:${text}:${JSON.stringify(opts)}`;
  const hit = cache.get(key);
  if (hit) return hit.map;
  const c = document.createElement("canvas");
  c.width = opts.w ?? 512; c.height = opts.h ?? 128;
  const x = c.getContext("2d")!;
  if (opts.bg) { x.fillStyle = opts.bg; x.fillRect(0, 0, c.width, c.height); }
  x.fillStyle = opts.color ?? "#1b2a36"; x.textAlign = "center"; x.textBaseline = "middle";
  x.font = opts.font ?? `700 ${Math.round(c.height * 0.62)}px system-ui, sans-serif`;
  x.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  cache.set(key, { map: t, normalMap: t });
  return t;
}

/** the mission patch: Mars, an orbit, "ARES · MARS OPS" */
export function patch() {
  const key = "patch";
  const hit = cache.get(key);
  if (hit) return hit.map;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#12233a"; x.beginPath(); x.arc(128, 128, 124, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "#d8b25a"; x.lineWidth = 6; x.stroke();
  const g = x.createRadialGradient(108, 108, 6, 128, 128, 60);
  g.addColorStop(0, "#f0a070"); g.addColorStop(1, "#8a3a22");
  x.fillStyle = g; x.beginPath(); x.arc(128, 128, 56, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "#e9eef2"; x.lineWidth = 3; x.beginPath(); x.ellipse(128, 128, 96, 30, -0.5, 0, Math.PI * 2); x.stroke();
  x.fillStyle = "#e9eef2"; x.beginPath(); x.arc(206, 84, 6, 0, Math.PI * 2); x.fill();
  x.font = "700 26px system-ui, sans-serif"; x.textAlign = "center"; x.fillText("ARES", 128, 42);
  x.font = "600 17px system-ui, sans-serif"; x.fillText("MARS OPS", 128, 232);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  cache.set(key, { map: t, normalMap: t });
  return t;
}
