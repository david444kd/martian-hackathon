import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import "./helmet-visor.css";

export function HelmetVisor() {
  return (
    <div className="eva-visor" aria-hidden="true">
      <div className="eva-visor-glass" />
      <div className="eva-visor-brow"><i /><span /><i /></div>
      <div className="eva-visor-jaw"><i /><span /><i /></div>
      <div className="eva-visor-seal" />
    </div>
  );
}

/** A small head-locked rim: only the upper/lower edge enters either XR eye view. */
export function XRHelmetVisor() {
  const group = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const viewer = useMemo(() => new THREE.Vector3(), []);
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-1.45, 0.91);
    shape.lineTo(-1.45, 0.63);
    shape.quadraticCurveTo(0, 0.78, 1.45, 0.63);
    shape.lineTo(1.45, 0.91);
    shape.closePath();
    const lower = new THREE.Shape();
    lower.moveTo(-1.45, -0.91);
    lower.lineTo(-1.45, -0.67);
    lower.quadraticCurveTo(0, -0.79, 1.45, -0.67);
    lower.lineTo(1.45, -0.91);
    lower.closePath();
    return [new THREE.ShapeGeometry(shape), new THREE.ShapeGeometry(lower)];
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#18252b", transparent: true, opacity: 0.68, depthTest: false, depthWrite: false, toneMapped: false,
  }), []);
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    const active = gl.xr.isPresenting;
    node.visible = active;
    if (!active) return;
    const poseCamera = gl.xr.getCamera();
    poseCamera.getWorldPosition(viewer);
    node.position.copy(viewer);
    poseCamera.getWorldQuaternion(node.quaternion);
  });
  return <group ref={group} visible={false}>
    {geo.map((geometry, i) => <mesh key={i} geometry={geometry} material={mat} position={[0, 0, -1.18]} renderOrder={1000} />)}
  </group>;
}
