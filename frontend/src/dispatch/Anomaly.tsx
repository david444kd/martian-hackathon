// Surface anomalies on the mission-control globe, drawn entirely on the GPU.
//
// Each anomaly is a few thin spherical caps hugging the planet at different altitudes, so they
// shift against each other as the globe turns. The looks follow orbital imagery (MRO MARCI,
// Mars Express HRSC/VMC, HiRISE):
//   dust storm  — an arced, towering dust front advancing along a drift direction: sunlit boiling
//                 billows with a long shadow, plumes of freshly lifted dust ahead of it, lightning
//                 inside; behind it a pale tan veil hiding the surface, thinning into streaks;
//   dust devil  — a small bright vortex wandering over the area with a long thin shadow, leaving a
//                 dark track that fades with age;
//   rockfall    — ground (pale scar, dark debris fan, sun-lit boulders, debris still sliding while
//                 active) and a thin settling dust plume while active.
//
// Built for Meta Quest 2 (mobile Adreno GPU): no per-frame canvas redraws or texture uploads, one
// shared 128² noise texture (one fetch per octave gives two noise values), one shared time uniform,
// one shared geometry, and fewer octaves in Quest Browser. The pictures illustrate where an anomaly
// is; their size on the globe is not the measured extent (the 2D zone maps show the real radius).
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { EventKind, Level } from "../lib/types";
import { SUN_DIR, anomalySize, stormTime } from "../lib/globeFx";
import { anomalyMaterials, capGeometry } from "../lib/anomalyShader";

interface Props { quat: THREE.Quaternion; seed: number; kind: EventKind; level: Level; active: boolean }

/** an anomaly's shells on the planet, centred where `quat` turns +z (the anomaly's direction) */
export function Anomaly({ quat, seed, kind, level, active }: Props) {
  const mats = useMemo(() => {
    const sunLocal = SUN_DIR.clone().applyQuaternion(quat.clone().invert());
    const sl = new THREE.Vector2(sunLocal.x, sunLocal.y);
    if (sl.lengthSq() > 1e-6) sl.normalize();
    return anomalyMaterials({ kind, seed, level, active, sun: SUN_DIR, sunLocal: sl, time: stormTime, size: anomalySize(kind) });
  }, [quat, seed, kind, level, active]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  const geo = capGeometry();
  return (
    <group quaternion={quat}>
      {mats.map((m, i) => <mesh key={i} geometry={geo} material={m} renderOrder={1 + i} frustumCulled={false} />)}
    </group>
  );
}
