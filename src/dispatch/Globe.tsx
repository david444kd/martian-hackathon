// Mission control's Mars globe: drag to turn, scroll to zoom; every crew on the surface is a dot.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Stars, useTexture } from "@react-three/drei";
import * as THREE from "three";

interface GlobeCrew { id: string; name: string; lat: number; lon: number; active: boolean }

interface Props {
  crews: GlobeCrew[];
  selected: string | null;
  onSelect: (id: string) => void;
}

/** a point on the unit sphere for an equirectangular texture with longitude -180 at its left edge */
function onSphere(lat: number, lon: number, r = 1) {
  const la = THREE.MathUtils.degToRad(lat), ph = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(-Math.cos(ph) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(ph) * Math.cos(la) * r);
}

export function Globe(props: Props) {
  return (
    <Canvas camera={{ fov: 35, near: 0.01, far: 100, position: onSphere(12, 95, 4.2).toArray() }} dpr={[1, 2]}>
      <color attach="background" args={["#07060a"]} />
      <Stars radius={30} depth={20} count={2500} factor={2.2} fade saturation={0} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[-4, 2, 5]} intensity={1.6} />
      <Planet />
      <Atmosphere />
      <Markers {...props} />
      <CameraRig {...props} />
    </Canvas>
  );
}

function Planet() {
  const map = useTexture("/textures/mars-4k.jpg", (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
  });
  return (
    <mesh>
      <sphereGeometry args={[1, 128, 64]} />
      <meshStandardMaterial map={map} roughness={1} metalness={0} />
    </mesh>
  );
}

// a thin dusty-orange rim, brightest at the edge of the disc
function Atmosphere() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color("#e8925a") } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(1.0 - abs(dot(vN, vV)), 5.0); gl_FragColor = vec4(color, f * 0.55); }`,
  }), []);
  return (
    <mesh material={mat} scale={1.03}>
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}

function Markers({ crews, selected, onSelect }: Props) {
  return <>{crews.map((c) => <Marker key={c.id} crew={c} selected={c.id === selected} onSelect={onSelect} />)}</>;
}

function Marker({ crew, selected, onSelect }: { crew: GlobeCrew; selected: boolean; onSelect: (id: string) => void }) {
  const pos = useMemo(() => onSphere(crew.lat, crew.lon, 1.004), [crew.lat, crew.lon]);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize()), [pos]);
  const ring = useRef<THREE.Mesh>(null), label = useRef<HTMLDivElement>(null);
  const color = crew.active ? "#4fd1ff" : "#ffb347";
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock, camera }) => {
    if (ring.current) {
      const t = (clock.elapsedTime * (crew.active ? 0.9 : 0.5)) % 1;
      ring.current.scale.setScalar(1 + t * 2.4);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
    }
    // hide the label when the dot is on the far side of the planet
    if (label.current) {
      tmp.copy(camera.position).sub(pos);
      label.current.style.opacity = tmp.dot(pos) > 0 ? "1" : "0";
    }
  });

  const click = (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelect(crew.id); };
  return (
    <group position={pos} quaternion={quat}>
      <mesh onClick={click} onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
        <circleGeometry args={[selected ? 0.02 : 0.014, 32]} />
        <meshBasicMaterial color={selected ? "#ffffff" : color} />
      </mesh>
      <mesh ref={ring} position={[0, 0, 0.001]}>
        <ringGeometry args={[0.016, 0.019, 40]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} />
      </mesh>
      <Html position={[0, 0, 0.01]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div ref={label} className="translate-y-[-22px] transition-opacity duration-200">
          <div className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap backdrop-blur-sm ${selected ? "border-white/60 bg-white/20 text-white" : "border-white/10 bg-black/60 text-white/90"}`}>
            {crew.active && <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-[#4fd1ff] align-middle" />}
            {crew.name}
          </div>
        </div>
      </Html>
    </group>
  );
}

/** orbit controls; flies to a crew when one is picked, turns slowly while nothing is */
function CameraRig({ crews, selected }: Props) {
  const camera = useThree((s) => s.camera);
  const flight = useRef<{ to: THREE.Vector3; t: number } | null>(null);
  const crew = crews.find((c) => c.id === selected);

  useEffect(() => {
    if (!crew) { flight.current = null; return; }
    // fly to look at the crew, keeping the zoom (but at least near enough to read the region)
    const dist = Math.min(camera.position.length(), 3.2);
    flight.current = { to: onSphere(crew.lat - 4, crew.lon, dist), t: 0 };
  }, [crew?.id, crew?.lat, crew?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const f = flight.current;
    if (!f) return;
    f.t = Math.min(1, f.t + dt * 1.1);
    const from = camera.position.clone(), len = THREE.MathUtils.lerp(from.length(), f.to.length(), 0.08);
    const dir = from.normalize().lerp(f.to.clone().normalize(), 0.08).normalize();
    camera.position.copy(dir.multiplyScalar(len));
    camera.lookAt(0, 0, 0);
    if (f.t >= 1) flight.current = null;
  });

  return (
    <OrbitControls enablePan={false} minDistance={1.4} maxDistance={8} rotateSpeed={0.5} zoomSpeed={0.7}
      autoRotate={!selected} autoRotateSpeed={0.35} enableDamping
      onStart={() => { flight.current = null; }} />
  );
}
