// Shared pieces of the GPU effects (globe: dispatch/Anomaly.tsx, SolarStorm.tsx; zone maps:
// components/StormLayer.tsx): device tier, the globe's sun direction and clock, and the one noise
// texture with its GLSL sampling helpers.
import * as THREE from "three";
import type { EventKind } from "./types";

/** Quest / other standalone headsets: fewer noise octaves */
export const LOW_END = typeof navigator !== "undefined" && /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);

/** the scene's directional light, in world space (Globe.tsx places it at [-4, 2, 5]) */
export const SUN_DIR = new THREE.Vector3(-4, 2, 5).normalize();

/** shared animation clock: Globe advances it once per frame */
export const stormTime = { value: 0 };

let noiseTex: THREE.DataTexture | null = null;
/** 128×128 random texel values; smooth value noise comes from sampling with a quintic-faded coordinate */
export function noiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 128, data = new Uint8Array(N * N * 4);
  let s = 1234567;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) & 255;
  for (let i = 0; i < N * N; i++) { data[i * 4] = rnd(); data[i * 4 + 1] = rnd(); data[i * 4 + 2] = rnd(); data[i * 4 + 3] = rnd(); }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = noiseTex.minFilter = THREE.LinearFilter;
  noiseTex.generateMipmaps = false;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

/** GLSL: value noise / fbm over the shared noise texture (needs `uniform sampler2D uNoise` and OCT) */
export const NOISE_GLSL = /* glsl */ `
vec4 n4(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return texture2D(uNoise, (i + f + 0.5) / 128.0);
}
vec2 n2(vec2 p) { return n4(p).xy; }
const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
vec2 fbm2(vec2 p) {
  vec2 s = vec2(0.0); float a = 0.5, t = 0.0;
  for (int i = 0; i < OCT; i++) { s += a * n2(p); t += a; p = ROT * p * 2.03 + 17.1; a *= 0.5; }
  return s / t;
}
/** a per-cell random vector without filtering (cell centres for boulders) */
vec4 cell4(vec2 c) { return texture2D(uNoise, (c + 0.5) / 128.0); }
`;

/** the picture's radius on the globe (sphere units); Globe sizes the pulse ring from it */
export function anomalySize(kind: EventKind) {
  return kind === "dust_devil" ? 0.05 : kind === "rockfall" ? 0.055 : 0.1;
}
