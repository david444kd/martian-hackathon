// Anomalies on a Leaflet zone map (ship console, mission control plans, event dialogs), drawn with
// the same GPU shaders as the mission-control globe (lib/anomalyShader.ts): a dust storm's arced
// front with boiling billows, lifted plumes, lightning and the veil behind it; a dust devil with its
// shadow and track; a rockfall's debris fan. The dashed ring is the anomaly's real boundary (centre +
// radius from the `events` row); everything inside it is an illustration.
//
// One WebGL canvas per map, whatever the number of anomalies (Quest Browser allows only a few WebGL
// contexts), in its own pane under the routes and markers, redrawn ~30 times a second while an
// anomaly is in view, hidden during zoom animations. If WebGL is unavailable, the previous 2D
// canvas picture (lib/stormArt.ts) is drawn instead.
import { useEffect, useId } from "react";
import L from "leaflet";
import * as THREE from "three";
import { useMap } from "react-leaflet";
import { drawStorm, seedOf } from "../lib/stormArt";
import { anomalyMaterials } from "../lib/anomalyShader";
import { LOW_END } from "../lib/globeFx";
import type { MarsEvent } from "../lib/types";

const M_PER_DEG = (Math.PI / 180) * 3_389_500;
/** the shader draws the boundary ring at this fraction of its disc */
const RING = 0.965;
/** light from the upper left, as on the shaded relief */
const SUN = new THREE.Vector3(-0.5, 0.5, 0.7).normalize();
const SUN_LOCAL = new THREE.Vector2(-1, 1).normalize();

interface Item { lat: number; lon: number; radius: number; group: THREE.Group; mats: THREE.ShaderMaterial[] }

/** all anomalies of one map in one WebGL canvas */
class MapStorms {
  private static all = new WeakMap<L.Map, MapStorms>();
  static of(map: L.Map) {
    let s = MapStorms.all.get(map);
    if (!s) { s = new MapStorms(map); MapStorms.all.set(map, s); }
    return s;
  }

  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  private quad = new THREE.PlaneGeometry(2, 2);
  private items = new Map<string, Item>();
  private time = { value: 0 };
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private drawn = false;
  private map: L.Map;

  private constructor(map: L.Map) {
    this.map = map;
    const pane = map.getPane("storms") ?? map.createPane("storms");
    pane.style.zIndex = "390"; // above the tiles and science layers, below routes (400) and markers
    pane.style.pointerEvents = "none";
    this.canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide", pane) as HTMLCanvasElement;
    this.canvas.style.position = "absolute";
    this.canvas.style.pointerEvents = "none";
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    } catch (e) {
      this.canvas.remove();
      throw e;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.raf = requestAnimationFrame(this.frame);
  }

  set(key: string, e: MarsEvent, active: boolean) {
    this.remove(key, false);
    const mats = anomalyMaterials({ kind: e.kind, seed: seedOf(e.id), level: e.level, active, sun: SUN, sunLocal: SUN_LOCAL, time: this.time, flat: true });
    const group = new THREE.Group();
    mats.forEach((m, i) => { const mesh = new THREE.Mesh(this.quad, m); mesh.renderOrder = i; mesh.frustumCulled = false; group.add(mesh); });
    this.scene.add(group);
    this.items.set(key, { lat: e.lat!, lon: e.lon!, radius: e.radius_m!, group, mats });
  }

  remove(key: string, mayClose = true) {
    const it = this.items.get(key);
    if (it) {
      this.scene.remove(it.group);
      it.mats.forEach((m) => m.dispose());
      this.items.delete(key);
    }
    if (mayClose && this.items.size === 0) this.close();
  }

  private close() {
    cancelAnimationFrame(this.raf);
    this.quad.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    MapStorms.all.delete(this.map);
  }

  private frame = (ms: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (ms - this.last < (LOW_END ? 40 : 33)) return;
    this.last = ms;
    this.time.value = ms / 1000;
    const { map } = this, size = map.getSize();
    if (size.x !== this.w || size.y !== this.h) {
      this.w = size.x; this.h = size.y;
      this.renderer.setPixelRatio(Math.min(LOW_END ? 1 : 1.5, window.devicePixelRatio || 1));
      this.renderer.setSize(this.w, this.h, false);
      this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
      this.camera.right = this.w; this.camera.bottom = -this.h;
      this.camera.updateProjectionMatrix();
    }
    // the canvas covers the view: keep it there as the panes move under it
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    let any = false;
    for (const it of this.items.values()) {
      const c = map.latLngToContainerPoint([it.lat, it.lon]), edge = map.latLngToContainerPoint([it.lat + it.radius / M_PER_DEG, it.lon]);
      const R = Math.abs(c.y - edge.y) / RING;
      const seen = R >= 3 && c.x + R > 0 && c.y + R > 0 && c.x - R < this.w && c.y - R < this.h;
      it.group.visible = seen;
      it.group.position.set(c.x, -c.y, 0);
      it.group.scale.set(R, R, 1);
      any ||= seen;
    }
    // nothing in view: clear once, then stay idle
    if (any || this.drawn) { this.renderer.render(this.scene, this.camera); this.drawn = any; }
  };
}

export function StormCanvas({ e, active }: { e: MarsEvent; active: boolean }) {
  const map = useMap();
  const key = useId();
  const { id, kind, level, lat, lon, radius_m } = e;
  useEffect(() => {
    if (lat == null || lon == null || radius_m == null) return;
    let storms: MapStorms | null = null;
    try { storms = MapStorms.of(map); } catch { /* no WebGL: the 2D picture below */ }
    if (storms) {
      storms.set(key, e, active);
      return () => storms.remove(key);
    }
    return legacyStorm(map, e, active);
  }, [map, key, id, kind, level, lat, lon, radius_m, active]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** the previous 2D picture (lib/stormArt.ts), for browsers without WebGL */
function legacyStorm(map: L.Map, e: MarsEvent, active: boolean) {
  const { id, kind, level, lat, lon, radius_m } = e;
  const pane = map.getPane("overlayPane")!;
  const canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide", pane) as HTMLCanvasElement;
  canvas.style.position = "absolute"; canvas.style.pointerEvents = "none";
  const ctx = canvas.getContext("2d")!, seed = seedOf(id), dpr = Math.min(2, window.devicePixelRatio || 1);
  let raf = 0, last = 0;
  const frame = (ms: number) => {
    raf = requestAnimationFrame(frame);
    if (ms - last < 33) return;
    last = ms;
    const c = map.latLngToLayerPoint([lat!, lon!]), edge = map.latLngToLayerPoint([lat! + radius_m! / M_PER_DEG, lon!]);
    const r = Math.abs(c.y - edge.y), size = Math.ceil(r * 2.7);
    const b = map.getSize(), o = map.containerPointToLayerPoint([0, 0]);
    if (c.x + size / 2 < o.x || c.y + size / 2 < o.y || c.x - size / 2 > o.x + b.x || c.y - size / 2 > o.y + b.y) { canvas.style.display = "none"; return; }
    canvas.style.display = "";
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
}
