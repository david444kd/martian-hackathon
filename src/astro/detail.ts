// Up close no orbital photo is sharp (HiRISE is ~0.3-0.6 m a pixel), so near the astronaut the ground
// gets a fine, repeating regolith texture (sand grain, pebbles, small stones) multiplied over the
// photo and faded out with distance: the usual "detail map" trick for terrain seen from eye level.
import * as THREE from "three";
import type { Closeup } from "./closeup";

let cached: THREE.CanvasTexture | null = null;

/** a tileable greyscale texture around mid-grey (128 = leave the photo unchanged) */
export function detailTexture(): THREE.CanvasTexture {
  if (cached) return cached;
  const N = 512, c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // draw a shape at (x, y) and its wrapped copies, so the texture tiles seamlessly
  const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      if (x + ox > -r && x + ox < N + r && y + oy > -r && y + oy < N + r) draw(x + ox, y + oy);
    }
  };
  // sand: lots of faint specks
  for (let i = 0; i < 14000; i++) {
    const x = rnd() * N, y = rnd() * N, v = 100 + rnd() * 56, r = 0.6 + rnd() * 1.4;
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    wrapped(x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); });
  }
  // soft blotches: uneven dust cover
  for (let i = 0; i < 60; i++) {
    const x = rnd() * N, y = rnd() * N, r = 20 + rnd() * 60, v = rnd() < 0.5 ? 110 : 146;
    wrapped(x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${v},${v},${v},0.25)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // pebbles and small stones, lit from the north-west: a shadow, the stone, a highlight
  for (let i = 0; i < 260; i++) {
    const x = rnd() * N, y = rnd() * N, r = 1.5 + rnd() ** 3 * 9, rot = rnd() * Math.PI, el = 0.6 + rnd() * 0.4;
    wrapped(x, y, r + 3, (px, py) => {
      ctx.fillStyle = "rgba(40,40,40,0.55)";
      ctx.beginPath(); ctx.ellipse(px + r * 0.35, py + r * 0.35, r, r * el, rot, 0, Math.PI * 2); ctx.fill();
      const v = 95 + rnd() * 50;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath(); ctx.ellipse(px, py, r, r * el, rot, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(220,220,220,0.35)";
      ctx.beginPath(); ctx.ellipse(px - r * 0.3, py - r * 0.3, r * 0.45, r * 0.45 * el, rot, 0, Math.PI * 2); ctx.fill();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cached = t;
  return t;
}

/**
 * The close-up's material. The HiRISE greyscale is coloured like scripts/build_zone_photos.py does
 * (gamma 0.8, × Martian dust colour) and faded out at the edge of its circle; then multiplied by the
 * detail texture, which repeats every `period` metres (and at a second scale, to hide the
 * repetition) and fades out between `near` and `far` metres from the eye.
 */
export function closeupMaterial(c: Closeup, detail: THREE.Texture, maxAniso: number) {
  detail.anisotropy = maxAniso;
  c.texture.anisotropy = maxAniso;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      map: { value: c.texture },
      fadeCenter: { value: c.fade.center },
      fadeScale: { value: c.fade.scale },
      detail: { value: detail },
      period: { value: 3.0 },
      near: { value: 8.0 },
      far: { value: 70.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D detail;
      uniform float period, near, far;
      uniform vec2 fadeCenter, fadeScale;
      const vec3 DUST = vec3(1.36, 0.94, 0.66);
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vec4 tex = texture2D(map, vUv);
        vec3 srgb = min(pow(tex.r, 0.8) * DUST, 1.0);
        float edge = 1.0 - smoothstep(0.7, 1.0, length((vUv - fadeCenter) * fadeScale));
        vec4 photo = vec4(sRGBTransferEOTF(vec4(srgb, 1.0)).rgb, tex.a * edge);
        float d1 = texture2D(detail, vWorld.xz / period).r;
        float d2 = texture2D(detail, vWorld.xz / (period * 7.3) + 0.37).r;
        float k = (d1 * 0.65 + d2 * 0.35) / 0.502;          // ~1 on average
        float fade = 1.0 - smoothstep(near, far, distance(vWorld, cameraPosition));
        vec3 col = photo.rgb * mix(1.0, k, 0.85 * fade);
        gl_FragColor = vec4(col, photo.a);
        #include <colorspace_fragment>
      }`,
  });
}
