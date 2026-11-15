// The ground of the EVA scene: the zone's measured terrain (20 m DTM) with its orbital photo, drawn
// in one pass. The mesh is cut into chunks with three levels of detail (every DTM cell near the
// astronaut — exactly the triangles groundY() walks on — coarser far away) so a headset draws tens of
// thousands of triangles instead of half a million, and chunks behind you are not drawn at all.
// One shader does what three layered meshes did before: the zone photo, the HiRISE close-up around
// you (astro/closeup.ts), fine regolith relief lit by the scene's sun, shadows, wind-blown sand in a
// storm, and the haze. The DTM gives the geometry; the photographs only colour it.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { useCloseup } from "../astro/closeup";
import { ATMO, ATMO_GLSL, regolithTexture } from "./atmo";
import { toLocal } from "./frame";
import { Q } from "./quality";
import type { EvaRuntime } from "./runtime";

const CH = 64; // DTM cells per chunk side (1.28 km)
const STEPS = [1, 2, 4];

/** one chunk at a level of detail, in the local terrain frame, with a skirt that hides the seams between levels */
function chunkGeometry(hm: Heightmap, ci: number, cj: number, step: number) {
  const { width: W, height: H, dx, dy, min } = hm.zone, h = hm.h;
  const i0 = ci * CH, i1 = Math.min(i0 + CH, W - 1), j0 = cj * CH, j1 = Math.min(j0 + CH, H - 1);
  const xs: number[] = [], ys: number[] = [];
  for (let i = i0; i < i1; i += step) xs.push(i);
  xs.push(i1);
  for (let j = j0; j < j1; j += step) ys.push(j);
  ys.push(j1);
  const n = xs.length, m = ys.length, ring = 2 * (n + m), count = n * m + ring;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const put = (v: number, px: number, py: number, drop: number) => {
    const e = h[py * W + px];
    pos[v * 3] = (px + 0.5 - W / 2) * dx; pos[v * 3 + 1] = e - min - drop; pos[v * 3 + 2] = (py + 0.5 - H / 2) * dy;
    // the slope of the measured surface, the same at every level of detail
    const gx = (h[py * W + Math.min(W - 1, px + 1)] - h[py * W + Math.max(0, px - 1)]) / (2 * dx);
    const gz = (h[Math.min(H - 1, py + 1) * W + px] - h[Math.max(0, py - 1) * W + px]) / (2 * dy);
    const l = Math.hypot(gx, 1, gz);
    nor[v * 3] = -gx / l; nor[v * 3 + 1] = 1 / l; nor[v * 3 + 2] = -gz / l;
    uv[v * 2] = (px + 0.5) / W; uv[v * 2 + 1] = 1 - (py + 0.5) / H;
  };
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) put(j * n + i, xs[i], ys[j], 0);
  const idx: number[] = [];
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d); // the diagonal groundY() uses
  }
  // skirt: the border again, lower
  const drop = 3 + step * 4;
  let v = n * m;
  const edge = (top: number[], coords: [number, number][]) => {
    const start = v;
    coords.forEach(([px, py]) => put(v++, px, py, drop));
    for (let k = 0; k < top.length - 1; k++) idx.push(top[k], start + k, top[k + 1], top[k + 1], start + k, start + k + 1);
  };
  edge(xs.map((_, i) => i), xs.map((x) => [x, ys[0]]));
  edge(xs.map((_, i) => (m - 1) * n + i), xs.map((x) => [x, ys[m - 1]]));
  edge(ys.map((_, j) => j * n), ys.map((y) => [xs[0], y]));
  edge(ys.map((_, j) => j * n + n - 1), ys.map((y) => [xs[n - 1], y]));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
BLANK.needsUpdate = true;

function groundMaterial() {
  const uniforms = {
    ...ATMO,
    uPhoto: { value: BLANK as THREE.Texture }, uPhotoOn: { value: 0 },
    uClose: { value: BLANK as THREE.Texture }, uCloseRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFadeCenter: { value: new THREE.Vector2(0.5, 0.5) }, uFadeScale: { value: new THREE.Vector2(1, 1) }, uCloseOn: { value: 0 },
    uDetail: { value: regolithTexture() as THREE.Texture },
  };
  // a ShadowMaterial is the cheapest material three gives shadow lookups to; its output is replaced
  const mat = new THREE.ShadowMaterial({ transparent: false, side: THREE.DoubleSide, fog: false });
  mat.customProgramCacheKey = () => "eva-ground";
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGUv; varying vec3 vGW; varying vec3 vGN;")
      .replace("#include <fog_vertex>", "vGUv = uv; vGW = (modelMatrix * vec4(position, 1.0)).xyz; vGN = normal;");
    const out = "gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );";
    if (!sh.fragmentShader.includes(out)) console.warn("EVA ground: three's shadow shader changed, the ground will not be textured");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", /* glsl */ `#include <common>
        ${ATMO_GLSL}
        uniform sampler2D uPhoto, uClose, uDetail, uCloud;
        uniform vec4 uCloseRect; uniform vec2 uFadeCenter, uFadeScale, uWind;
        uniform float uPhotoOn, uCloseOn, uDrift, uLight, uTime, uLamp;
        uniform vec3 uLampPos, uLampDir;
        uniform vec3 uDust, uShadow;
        uniform vec4 uFronts[2];
        varying vec2 vGUv; varying vec3 vGW; varying vec3 vGN;
        const vec3 MARS = vec3(1.36, 0.94, 0.66);`)
      .replace(out, /* glsl */ `
        vec3 gTo = vGW - cameraPosition; float gDist = length(gTo); vec3 gV = gTo / max(gDist, 0.001);
        vec3 col = mix(vec3(0.38, 0.17, 0.07), texture2D(uPhoto, vGUv).rgb, uPhotoOn);
        // the HiRISE close-up round the astronaut: greyscale, coloured like the zone photo, faded at its rim
        vec2 cu = (vGW.xz - uCloseRect.xy) * uCloseRect.zw; cu.y = 1.0 - cu.y;
        vec4 ct = texture2D(uClose, cu);
        float edge = uCloseOn * (1.0 - smoothstep(0.7, 1.0, length((cu - uFadeCenter) * uFadeScale)));
        col = mix(col, sRGBTransferEOTF(vec4(min(pow(ct.r, 0.8) * MARS, 1.0), 1.0)).rgb, ct.a * edge);
        // regolith relief at two scales, lit by the Sun: no orbital photo is sharp at your boots
        float near = 1.0 - smoothstep(5.0, 55.0, gDist), mid = 1.0 - smoothstep(30.0, 260.0, gDist);
        vec4 d1 = texture2D(uDetail, vGW.xz / 3.1);
        vec4 d2 = texture2D(uDetail, vGW.xz / 26.3 + 0.37);
        vec2 lean = (d1.xy - 0.5) * (2.2 * near) + (d2.xy - 0.5) * (0.75 * mid);
        vec3 gN = normalize(vGN);
        vec3 bN = normalize(gN + vec3(lean.x, 0.0, lean.y));
        float gFlat = max(dot(gN, uSun), 0.0), gLit = max(dot(bN, uSun), 0.0);
        float relief = clamp(1.0 + (gLit - gFlat) / max(gFlat, 0.28) * 0.85, 0.3, 1.8);
        float tone = mix(1.0, d1.z * 2.0, 0.6 * near) * mix(1.0, d2.z * 2.0, 0.14 * mid);
        // the photo has its own shading; the DTM's slope only leans it gently towards the scene's Sun
        float slope = mix(1.0, clamp(gFlat / max(uSun.y, 0.2), 0.6, 1.3), 0.3);
        vec3 albedo = col * tone;
        // thin dust high up is never even: broad soft patches of shade and light drift over the plain in clear air
        float drift = texture2D(uCloud, vGW.xz * 0.00042 + uWind * (uTime * 0.0021)).g;
        float veil = mix(1.0, 0.8 + 0.3 * smoothstep(0.32, 0.68, drift), (1.0 - uStorm) * (1.0 - smoothstep(4000.0, 9000.0, gDist) * 0.5));
        col = albedo * relief * slope * uLight * veil;
        col *= mix(uShadow, vec3(1.0), getShadowMask());
        // the helmet lamps: a warm pool of light ahead when the daylight goes
        if (uLamp > 0.01) {
          vec3 toL = uLampPos - vGW; float ld = length(toL); vec3 Ld = toL / ld;
          float aim = dot(-Ld, uLampDir), cone = smoothstep(0.86, 0.95, aim) * (0.7 + 0.3 * smoothstep(0.95, 0.99, aim));
          col += albedo * vec3(1.0, 0.96, 0.9) * (uLamp * cone * max(dot(bN, Ld), 0.0) * 13.0 / (1.0 + ld * ld * 0.2));
        }
        // sand streaming over the ground in the wind
        if (uStorm > 0.03) {
          float al = dot(vGW.xz, uWind), ac = dot(vGW.xz, vec2(-uWind.y, uWind.x));
          float a = texture2D(uCloud, vec2((al - uDrift) * 0.011, ac * 0.1)).g;
          float b = texture2D(uCloud, vec2((al - uDrift * 1.6) * 0.03 + 0.5, ac * 0.31 + 0.3)).r;
          float s = smoothstep(0.3, 0.62, a * (0.45 + b) + (uStorm - 1.0) * 0.3) * (1.0 - smoothstep(20.0, 110.0, gDist));
          col = mix(col, uHorizon * 1.25 + col * 0.25, s * 0.6 * uStorm);
        }
        // dust spilling along the ground from the foot of a storm front
        for (int i = 0; i < 2; i++) {
          float fd = distance(vGW.xz, uFronts[i].xy) - uFronts[i].z;
          col = mix(col, uDust * 0.5, uFronts[i].w * 0.9 * (1.0 - smoothstep(-20.0, 170.0, fd)) * step(-60.0, fd));
        }
        gl_FragColor = vec4(col, 1.0);`)
      .replace("#include <fog_fragment>", /* glsl */ `
        gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(atmoFog(gV), 1.0)).rgb, atmoFogAmount(gDist));
        gl_FragColor.rgb += atmoDither(gl_FragCoord.xy);`);
  };
  return { mat, uniforms };
}

export function Ground({ hm, rt, anchor }: { hm: Heightmap; rt: EvaRuntime; anchor: [number, number] }) {
  const gl = useThree((s) => s.gl);
  const { mat, uniforms } = useMemo(groundMaterial, []);
  useEffect(() => () => mat.dispose(), [mat]);

  // the zone's orbital photo
  useEffect(() => {
    let off = false;
    const tex = new THREE.TextureLoader().load(`/zones/${hm.zone.id}-photo.jpg`, (t) => {
      if (off) return;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(Q.aniso, gl.capabilities.getMaxAnisotropy());
      uniforms.uPhoto.value = t; uniforms.uPhotoOn.value = 1;
    });
    return () => { off = true; uniforms.uPhoto.value = BLANK; uniforms.uPhotoOn.value = 0; tex.dispose(); };
  }, [hm.zone.id, gl, uniforms]);

  // the HiRISE close-up around the astronaut
  const c = useCloseup(hm.zone.id, anchor[0], anchor[1]);
  useEffect(() => {
    if (!c) { uniforms.uCloseOn.value = 0; return; }
    c.texture.anisotropy = Math.min(Q.aniso, gl.capabilities.getMaxAnisotropy());
    const a = toLocal(hm, c.bounds.north, c.bounds.west), b = toLocal(hm, c.bounds.south, c.bounds.east);
    uniforms.uCloseRect.value.set(a.x, a.z, 1 / (b.x - a.x), 1 / (b.z - a.z));
    uniforms.uFadeCenter.value.copy(c.fade.center); uniforms.uFadeScale.value.copy(c.fade.scale);
    uniforms.uClose.value = c.texture; uniforms.uCloseOn.value = 1;
  }, [c, hm, gl, uniforms]);
  useEffect(() => { uniforms.uDetail.value.anisotropy = Math.min(Q.aniso, gl.capabilities.getMaxAnisotropy()); }, [gl, uniforms]);

  // chunks, each showing the level of detail its distance from the astronaut calls for
  const chunks = useMemo(() => {
    const { width: W, height: H, dx, dy } = hm.zone;
    const group = new THREE.Group(), list: { mesh: THREE.Mesh; x0: number; x1: number; z0: number; z1: number; ci: number; cj: number; geos: (THREE.BufferGeometry | null)[]; lod: number }[] = [];
    for (let cj = 0; cj * CH < H - 1; cj++) for (let ci = 0; ci * CH < W - 1; ci++) {
      const mesh = new THREE.Mesh(undefined, mat);
      mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.visible = false;
      group.add(mesh);
      const i1 = Math.min(ci * CH + CH, W - 1), j1 = Math.min(cj * CH + CH, H - 1);
      list.push({ mesh, ci, cj, geos: [null, null, null], lod: -1, x0: (ci * CH + 0.5 - W / 2) * dx, x1: (i1 + 0.5 - W / 2) * dx, z0: (cj * CH + 0.5 - H / 2) * dy, z1: (j1 + 0.5 - H / 2) * dy });
    }
    return { group, list };
  }, [hm, mat]);
  useEffect(() => () => chunks.list.forEach((c) => c.geos.forEach((g) => g?.dispose())), [chunks]);
  const last = useRef({ x: NaN, z: NaN, chunks: null as typeof chunks | null });
  useFrame(() => {
    const p = rt.pose, s = last.current;
    if (s.chunks === chunks && Math.hypot(p.x - s.x, p.z - s.z) < 24) return;
    last.current = { x: p.x, z: p.z, chunks };
    for (const c of chunks.list) {
      const d = Math.hypot(Math.max(c.x0 - p.x, 0, p.x - c.x1), Math.max(c.z0 - p.z, 0, p.z - c.z1));
      const lod = d < Q.lod[0] ? 0 : d < Q.lod[1] ? 1 : 2;
      if (lod === c.lod) continue;
      c.lod = lod;
      c.mesh.geometry = c.geos[lod] ??= chunkGeometry(hm, c.ci, c.cj, STEPS[lod]);
      c.mesh.visible = true;
    }
  });
  return <primitive object={chunks.group} />;
}
