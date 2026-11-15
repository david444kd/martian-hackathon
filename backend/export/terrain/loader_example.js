// three.js: рельеф Jezero из export/terrain. Ось вверх — Y; точка (x, y, h) → position (x, h, -y).
import * as THREE from 'three';

async function loadHeights(url) {               // *.u16: сырые uint16 little-endian, n×n, строка 0 = север
  const buf = await (await fetch(url)).arrayBuffer();   // (те же значения, что в 16-битном PNG; canvas даёт лишь 8 бит)
  const u = new Uint16Array(buf), v = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) v[i] = u[i] / 65535;
  return { v, n: Math.round(Math.sqrt(u.length)) };
}

async function makeTerrain({ heightUrl, texUrl, sizeM, hMin, hMax, hRef, drop = 0 }) {
  const { v, n } = await loadHeights(heightUrl);
  const geo = new THREE.PlaneGeometry(sizeM, sizeM, n - 1, n - 1); // вершины: строка 0 = север (y=+size/2)
  geo.rotateX(-Math.PI / 2);                                        // плоскость XZ, z = -y (север = -Z)
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hMin + v[i] * (hMax - hMin) - hRef - drop);
  geo.computeVertexNormals();
  const tex = await new THREE.TextureLoader().loadAsync(texUrl);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
}

export async function addJezero(scene, base = './terrain/', quest = false) {
  const meta = await (await fetch(base + 'meta.json')).json();
  const N = meta.near, F = meta.far;
  const near = await makeTerrain({
    heightUrl: base + (quest ? 'near_height_513.u16' : 'near_height.u16'),
    texUrl: base + (quest ? 'near_texture_2048.jpg' : 'near_texture_4096.jpg'), sizeM: N.size_m,
    hMin: quest ? N.px_513.h_min : N.h_min, hMax: quest ? N.px_513.h_max : N.h_max, hRef: N.h_ref });
  const far = await makeTerrain({ heightUrl: base + 'far_height.u16', texUrl: base + 'far_texture_2048.jpg',
    sizeM: F.size_m, hMin: F.h_min, hMax: F.h_max, hRef: N.h_ref, drop: 0.5 }); // на 0.5 м ниже ближнего
  scene.add(far, near);
  return { near, far, meta };
}
