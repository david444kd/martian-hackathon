// Draw calls are what a headset's browser runs out of first: every mesh is one, per eye. The base, the
// buttes and the suit are built from hundreds of small parts, so once built their parts are welded
// into one mesh per material (a few draw calls for a whole outpost).
import { useLayoutEffect, useRef, type DependencyList, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { air } from "./atmo";

const KEEP = ["position", "normal", "uv"];

/** a copy of a mesh's geometry in `frame`'s coordinates, reduced to position / normal / uv, indexed */
function baked(mesh: THREE.Mesh, toFrame: THREE.Matrix4) {
  const g = mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  g.clearGroups();
  g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld));
  if (new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld).determinant() < 0) {
    // a mirrored part: turn its triangles back to face outwards
    const idx = g.index!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  }
  return g;
}

function weld(buckets: Map<THREE.Material, THREE.BufferGeometry[]>, cast: boolean, receive: boolean) {
  const out: THREE.Mesh[] = [];
  buckets.forEach((list, material) => {
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) list.forEach((x) => x.dispose());
    if (!g) return;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    // lamps, lettering and screens throw no shadow worth a draw call
    m.castShadow = cast && !(material as THREE.MeshBasicMaterial).isMeshBasicMaterial && (!material.transparent || material.opacity === 0);
    m.receiveShadow = receive;
    out.push(m);
  });
  return out;
}

/**
 * Weld a built object in place: every mesh under `root` (not below a child marked `userData.joint`,
 * which moves on its own and is welded separately) becomes one mesh per material.
 */
export function mergeStatic(root: THREE.Object3D, opts: { cast?: boolean; receive?: boolean } = {}) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>(), joints: THREE.Object3D[] = [], old: THREE.BufferGeometry[] = [];
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.joint) { joints.push(c); continue; }
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material)) {
        let b = buckets.get(m.material);
        if (!b) buckets.set(m.material, (b = []));
        b.push(baked(m, inv)); old.push(m.geometry);
      }
      walk(c);
    }
  };
  walk(root);
  // a joint keeps its place relative to the root even if it hung deeper in the tree
  const placed = joints.map((j) => ({ j, m: new THREE.Matrix4().multiplyMatrices(inv, j.matrixWorld) }));
  root.clear();
  old.forEach((g) => g.dispose());
  weld(buckets, opts.cast ?? false, opts.receive ?? false).forEach((m) => root.add(m));
  for (const { j, m } of placed) { m.decompose(j.position, j.quaternion, j.scale); root.add(j); mergeStatic(j, opts); }
  return root;
}

/**
 * The same for JSX: the children are built as usual, then hidden and replaced by welded meshes.
 * Re-welds when `deps` change. Things that must stay separate (lights, sprites, animated parts) go outside.
 */
export function Merged({ children, deps, cast = true, receive = true }: { children: ReactNode; deps: DependencyList; cast?: boolean; receive?: boolean }) {
  const src = useRef<THREE.Group>(null), out = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const s = src.current!, o = out.current!;
    s.visible = true;
    s.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(s.matrixWorld).invert();
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    s.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      let b = buckets.get(m.material);
      if (!b) buckets.set(m.material, (b = []));
      b.push(baked(m, inv));
    });
    const made = weld(buckets, cast, receive);
    made.forEach((m) => o.add(m));
    s.visible = false;
    air.shadowDirty = true;
    return () => { made.forEach((m) => { o.remove(m); m.geometry.dispose(); }); air.shadowDirty = true; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return <><group ref={src}>{children}</group><group ref={out} /></>;
}
