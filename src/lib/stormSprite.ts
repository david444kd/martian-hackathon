// Anomalies on 2D canvases (the helmet's navigation map, on screen and in the visor HUD texture),
// drawn with the same GPU shaders as the globe and the zone maps (lib/anomalyShader.ts): each one is
// rendered into one small shared offscreen WebGL canvas and copied onto the 2D map with drawImage.
// One extra WebGL context for the whole page; a few hundred pixels per anomaly per redraw. Without
// WebGL the previous 2D picture (lib/stormArt.ts) is drawn instead.
import * as THREE from "three";
import { anomalyMaterials } from "./anomalyShader";
import { drawStorm, seedOf } from "./stormArt";
import type { EventKind, Level } from "./types";

/** the shader draws the boundary ring at this fraction of its disc */
const RING = 0.965;
/** light from the upper left, as on the shaded relief (the maps are north up) */
const SUN = new THREE.Vector3(-0.5, 0.5, 0.7).normalize();
const SUN_LOCAL = new THREE.Vector2(-1, 1).normalize();

export interface SpriteAnomaly { id: string; kind: EventKind; level: Level; active: boolean }

interface Entry { group: THREE.Group; mats: THREE.ShaderMaterial[]; used: number }

let gl: {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; quad: THREE.PlaneGeometry;
  time: { value: number }; entries: Map<string, Entry>; size: number;
} | null = null;
let broken = false;

function init() {
  if (gl || broken) return gl;
  try {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);
    canvas.addEventListener("webglcontextlost", () => { gl = null; });
    gl = {
      renderer, scene: new THREE.Scene(), camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1), quad: new THREE.PlaneGeometry(2, 2),
      time: { value: 0 }, entries: new Map(), size: 0,
    };
  } catch {
    broken = true;
  }
  return gl;
}

function entry(a: SpriteAnomaly, now: number) {
  const g = gl!, key = `${a.id}|${a.kind}|${a.level}|${a.active}`;
  let e = g.entries.get(key);
  if (!e) {
    const mats = anomalyMaterials({ kind: a.kind, seed: seedOf(a.id), level: a.level, active: a.active, sun: SUN, sunLocal: SUN_LOCAL, time: g.time, flat: true });
    const group = new THREE.Group();
    mats.forEach((m, i) => { const mesh = new THREE.Mesh(g.quad, m); mesh.renderOrder = i; mesh.frustumCulled = false; group.add(mesh); });
    g.scene.add(group);
    e = { group, mats, used: now };
    g.entries.set(key, e);
  }
  e.used = now;
  // anomalies no longer drawn for a while: free their materials
  for (const [k, o] of g.entries) if (now - o.used > 10_000) { g.scene.remove(o.group); o.mats.forEach((m) => m.dispose()); g.entries.delete(k); }
  return e;
}

/** draw the anomaly centred at (cx, cy) whose real boundary is r canvas pixels, at time t seconds */
export function drawAnomaly(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, a: SpriteAnomaly) {
  if (r < 1.5) return;
  const g = init();
  if (!g) { drawStorm(ctx, cx, cy, r, t, { kind: a.kind, level: a.level, active: a.active, seed: seedOf(a.id) }); return; }
  const R = r / RING;
  // the sprite's resolution follows its size on the map, in steps (resizing the buffer is not free)
  const size = Math.min(384, Math.max(64, Math.ceil((2 * R) / 64) * 64));
  if (size !== g.size) { g.renderer.setSize(size, size, false); g.size = size; }
  const e = entry(a, performance.now());
  for (const o of g.entries.values()) o.group.visible = o === e;
  g.time.value = t;
  g.renderer.render(g.scene, g.camera);
  // read straight after rendering, in the same task: no preserveDrawingBuffer needed
  ctx.drawImage(g.renderer.domElement, cx - R, cy - R, 2 * R, 2 * R);
}
