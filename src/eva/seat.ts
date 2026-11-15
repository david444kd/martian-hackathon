// Setting things down on sloping ground. The terrain is the measured DTM (frame.ts groundY): an object
// placed at the height of one point and left level sinks into the slope on its uphill side and floats
// on the downhill one. These helpers sample the ground under an object's footprint and give it the
// height and tilt that make it rest on the surface.
import * as THREE from "three";
import type { Heightmap } from "../lib/zones";
import { groundY } from "./frame";

export interface Seat {
  /** height of the object's origin (the middle of its base) */
  y: number;
  /** tilt to the slope, then the object's own heading `yaw` */
  q: THREE.Quaternion;
  /** the same as Euler angles, order YXZ, for JSX `rotation` */
  r: [number, number, number, "YXZ"];
}

/**
 * A rigid object with a rectangular base `2·hw` × `2·hd` m (its local X × Z), heading `yaw` (radians,
 * about +Y as three.js turns it), at (x, z): tilted to the plane through the ground at its four corners
 * and raised so that plane passes through its middle or above (never below the ground under its centre),
 * less `sink` m (bedded in a little, so no daylight shows under its edges).
 */
export function seat(hm: Heightmap, x: number, z: number, yaw: number, hw: number, hd: number, sink = 0.03): Seat {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // the object's local axes in the terrain frame: X → (c, -s), Z → (s, c)
  const at = (lx: number, lz: number) => groundY(hm, x + lx * c + lz * s, z - lx * s + lz * c);
  const pp = at(hw, hd), pm = at(hw, -hd), mp = at(-hw, hd), mm = at(-hw, -hd), mid = groundY(hm, x, z);
  const sx = (pp + pm - mp - mm) / (4 * hw), sz = (pp + mp - pm - mm) / (4 * hd);
  const plane = (pp + pm + mp + mm) / 4;
  const y = Math.max(plane, mid) - sink;
  const r: Seat["r"] = [-Math.atan(sz), yaw, Math.atan(sx), "YXZ"];
  return { y, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], r[3])), r };
}

/** the up direction of the ground at (x, z), from its slope over ±`s` m */
export function groundNormal(hm: Heightmap, x: number, z: number, s = 1, out = new THREE.Vector3()) {
  const gx = (groundY(hm, x + s, z) - groundY(hm, x - s, z)) / (2 * s), gz = (groundY(hm, x, z + s) - groundY(hm, x, z - s)) / (2 * s);
  return out.set(-gx, 1, -gz).normalize();
}

const UP = new THREE.Vector3(0, 1, 0);
/** a rotation that stands an object up on the ground's normal, then turns it by `yaw` about that normal */
export function onSlope(hm: Heightmap, x: number, z: number, yaw: number, s = 1, out = new THREE.Quaternion()) {
  const n = groundNormal(hm, x, z, s, TMP_N);
  return out.setFromUnitVectors(UP, n).multiply(TMP_Q.setFromAxisAngle(UP, yaw));
}
const TMP_N = new THREE.Vector3(), TMP_Q = new THREE.Quaternion();

/** the highest and lowest ground under a footprint of radius `r` round (x, z) (centre + 8 points on its rim) */
export function groundRange(hm: Heightmap, x: number, z: number, r: number) {
  let hi = groundY(hm, x, z), lo = hi;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, g = groundY(hm, x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (g > hi) hi = g; if (g < lo) lo = g;
  }
  return { hi, lo };
}

/**
 * A flat disc laid over the ground (a landing pad): a ring mesh whose every vertex sits `lift` m above
 * the terrain, in a group placed at (cx, oy, cz). uv as on a circle, so a square texture maps onto it.
 */
export function drapedDisc(hm: Heightmap, cx: number, cz: number, oy: number, radius: number, lift = 0.06, rings = 24, segs = 72) {
  const g = new THREE.RingGeometry(0.001, radius, segs, rings);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, groundY(hm, cx + p.getX(i), cz + p.getZ(i)) - oy + lift);
  g.computeVertexNormals();
  return g;
}
