// A solar particle event on the mission-control globe, drawn on the GPU.
//
// Mars has no global magnetic field: during strong solar events MAVEN has seen a diffuse aurora
// over much of the night side, and the solar wind drapes around the planet behind a bow shock in
// the upper atmosphere. Shown here as an illustration (not measured data):
//   - a faint glowing shell over the night side with slow, patchy bands;
//   - a stream of charged particles from the sun's side, deflected around a paraboloid bow shock.
// Quest-friendly: one shell, one Points draw (positions computed in the vertex shader from a seed
// and the shared clock), additive blending, no textures uploaded per frame.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Level } from "../lib/types";
import { LOW_END, NOISE_GLSL, SUN_DIR, noiseTexture, stormTime } from "../lib/globeFx";

export function SolarStorm({ level }: { level: Level }) {
  const strength = level === "critical" ? 1 : level === "warning" ? 0.75 : 0.5;
  return (
    <>
      <Aurora strength={strength} />
      <Wind strength={strength} />
    </>
  );
}

function Aurora({ strength }: { strength: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    defines: { OCT: LOW_END ? 2 : 3 },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uNoise: { value: noiseTexture() }, uTime: stormTime, uSun: { value: SUN_DIR }, uStrength: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV;
      void main() { vN = normalize(mat3(modelMatrix) * position); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform sampler2D uNoise; uniform float uTime, uStrength; uniform vec3 uSun;
      varying vec3 vN; varying vec3 vV;
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vN);
        float night = smoothstep(0.15, -0.35, dot(n, uSun));
        // patchy bands that drift along latitude
        float lon = atan(n.z, n.x), lat = asin(clamp(n.y, -1.0, 1.0));
        vec2 b = fbm2(vec2(lon * 3.0 + uTime * 0.05, lat * 7.0 - uTime * 0.03));
        float bands = smoothstep(0.45, 0.8, b.x) + 0.06;
        float limb = 0.35 + 0.65 * pow(1.0 - abs(dot(normalize(vV), vec3(0.0, 0.0, 1.0))), 1.5);
        vec3 col = mix(vec3(0.55, 0.30, 1.0), vec3(0.35, 0.95, 0.7), b.y * 0.45);
        gl_FragColor = vec4(col * night * bands * limb * uStrength * 0.4, 1.0);
      }`,
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { mat.uniforms.uStrength.value = strength; }, [mat, strength]);
  return (
    <mesh material={mat} scale={1.013} renderOrder={6}>
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}

function Wind({ strength }: { strength: number }) {
  const count = LOW_END ? 500 : 900;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), seed = new Float32Array(count * 4);
    let s = 987654;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 7);
    return g;
  }, [count]);
  // the flow's frame: +z toward the sun
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), SUN_DIR), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: stormTime, uStrength: { value: 0 }, uPx: { value: Math.min(2, window.devicePixelRatio || 1) } },
    vertexShader: /* glsl */ `attribute vec4 seed; uniform float uTime, uStrength, uPx; varying float vA;
      void main() {
        // travel from z = +5 (sunward) to z = -4, faster for more energetic particles
        float life = fract(seed.x + uTime * (0.05 + seed.w * 0.05));
        float z = mix(5.0, -4.0, life);
        float ang = seed.y * 6.2831853, b = sqrt(seed.z) * 2.6;
        // paraboloid bow shock, standoff ~1.45 planet radii: flow inside it is pushed out to the surface
        float shock = sqrt(max(0.0, (1.45 - z) * 1.8));
        float rho = max(b, shock * (1.0 + 0.08 * seed.w));
        vec3 p = vec3(cos(ang) * rho, sin(ang) * rho, z);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float draped = 1.0 - smoothstep(0.0, 0.3, abs(rho - shock));    // brighter along the shock
        vA = sin(life * 3.14159) * (0.25 + 0.75 * draped) * uStrength;
        gl_PointSize = (1.6 + 2.4 * draped) * uPx * 5.0 / -mv.z;
      }`,
    fragmentShader: /* glsl */ `varying float vA;
      void main() { vec2 c = gl_PointCoord - 0.5; float d = 1.0 - smoothstep(0.1, 0.5, length(c));
        gl_FragColor = vec4(vec3(0.75, 0.55, 1.0) * d * vA, 1.0); }`,
  }), []);
  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);
  useEffect(() => { mat.uniforms.uStrength.value = strength; }, [mat, strength]);
  return <points geometry={geo} material={mat} quaternion={quat} renderOrder={7} />;
}
