// The Martian Map point layers on the globe: water-formed minerals (CRISM/OMEGA/THEMIS) and
// HiRISE ice / active-slope sites, ~5,200 dots in one Points draw (cheap on a Quest). The planet's
// depth hides the far side; dots keep a fixed size on screen.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { ACTIVE_COLORS, MINERAL_COLORS, activeGroup, loadScienceFeatures, type ScienceFeatures } from "../lib/marsLayers";

const R = 1.0025;

function onSphere(lat: number, lon: number) {
  const la = THREE.MathUtils.degToRad(lat), ph = THREE.MathUtils.degToRad(lon + 180);
  return [-Math.cos(ph) * Math.cos(la) * R, Math.sin(la) * R, Math.sin(ph) * Math.cos(la) * R];
}

export function SciencePoints({ minerals, ice, onStatus }: { minerals: boolean; ice: boolean; onStatus: (s: { busy: boolean; error: boolean }) => void }) {
  const [data, setData] = useState<ScienceFeatures | null>(null);
  const wanted = minerals || ice;
  useEffect(() => {
    if (!wanted || data) return;
    let live = true;
    onStatus({ busy: true, error: false });
    loadScienceFeatures().then(
      (d) => { if (live) { setData(d); onStatus({ busy: false, error: false }); } },
      () => { if (live) onStatus({ busy: false, error: true }); },
    );
    return () => { live = false; };
  }, [wanted, data, onStatus]);

  const geo = useMemo(() => {
    if (!data || !wanted) return null;
    const pos: number[] = [], col: number[] = [], size: number[] = [];
    const c = new THREE.Color();
    const add = (lat: number, lon: number, hex: string, s: number) => {
      pos.push(...onSphere(lat, lon));
      c.set(hex); // the shader writes these straight to the screen (sRGB)
      col.push(c.r, c.g, c.b);
      size.push(s);
    };
    if (minerals) {
      for (const [lat, lon] of data.hydrous) add(lat, lon, MINERAL_COLORS.hydrous, 2.6);
      for (const [lat, lon, cls] of data.aqueous) add(lat, lon, MINERAL_COLORS[cls as keyof typeof MINERAL_COLORS] ?? "#cccccc", 3.2);
      for (const [lat, lon, km2] of data.chloride) add(lat, lon, MINERAL_COLORS.chloride, Math.max(3, Math.min(7, Math.sqrt(km2))));
    }
    if (ice) for (const [lat, lon, type] of data.active) {
      const g = activeGroup(type);
      add(lat, lon, ACTIVE_COLORS[g], g === "fresh" ? 3 : 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
    return g;
  }, [data, wanted, minerals, ice]);
  useEffect(() => () => geo?.dispose(), [geo]);

  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uPx: { value: Math.min(2, window.devicePixelRatio || 1) } },
    vertexShader: /* glsl */ `attribute vec3 aColor; attribute float size; uniform float uPx; varying vec3 vC;
      void main() { vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        // a little larger as the camera comes close, never huge
        gl_PointSize = size * uPx * clamp(3.2 / -mv.z, 0.8, 2.2); }`,
    fragmentShader: /* glsl */ `varying vec3 vC;
      void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c); if (r > 0.5) discard;
        float edge = smoothstep(0.5, 0.36, r), ring = smoothstep(0.3, 0.42, r);
        gl_FragColor = vec4(mix(vC, vec3(0.05), ring * 0.7), edge); }`,
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);

  if (!geo) return null;
  return <points geometry={geo} material={mat} renderOrder={8} />;
}
