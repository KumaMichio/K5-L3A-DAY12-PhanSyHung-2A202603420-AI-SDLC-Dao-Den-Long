/**
 * Environment detail: sky dome, stars, moon, cloud sea, grass, flowers, rocks, trees/palms, stone paths,
 * hanging roots. Visual only, seeded (same every run), and built from instanced/merged geometry
 * (one draw call per kind, no extra lights) so the Ticket-04 bench stays within budget.
 * Standard palette (Ticket-02) for sky/fog/grass/sand/wood/cloud sea; nearby tints stay within ~10%.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NightDef } from '../sim/maps.js';
import { makeRng } from '../sim/rng.js';
import { glowTexture } from './models.js';

const SKY_TOP = new THREE.Color(0x0e1430);
const SKY_HORIZON = new THREE.Color(0x1b2350);
const GRASS = [0x2f5d50, 0x34665a, 0x2a5447, 0x3a6b55];
const WOOD = 0x6b4a2f;
const CLOUD = [0x12384a, 0x16405a, 0x1d4a63, 0x12384a];
const ROCK = [0x4a5560, 0x566170, 0x3f4952];
const FLOWERS = [0xffb347, 0xf2c14e, 0xf5f1e6, 0xe8a0b4];
const CANOPY = [0x24493f, 0x2a5447, 0x1f4038];

type Rng = () => number;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const matrix = (pos: THREE.Vector3, rotY: number, scale: THREE.Vector3, tilt = 0) =>
  new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, rotY, tilt * 0.5)), scale);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { m: THREE.Matrix4; c?: number }[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const col = new THREE.Color();
  items.forEach((it, i) => {
    im.setMatrixAt(i, it.m);
    if (it.c !== undefined) im.setColorAt(i, col.setHex(it.c));
  });
  im.count = items.length;
  im.instanceMatrix.needsUpdate = true;
  return im;
}

const pick = <T>(rng: Rng, a: readonly T[]) => a[Math.floor(rng() * a.length)];

// ------------------------------------------------------------------ sky (shared by all nights)
export function buildSky(): THREE.Group {
  const g = new THREE.Group();
  // gradient dome
  const dome = new THREE.SphereGeometry(360, 32, 16);
  const pos = dome.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 360, 0, 1);
    c.copy(SKY_HORIZON).lerp(SKY_TOP, Math.pow(t, 0.6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  // stars (upper hemisphere)
  const rng = makeRng(7);
  const n = 900;
  const sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const y = 0.08 + rng() * 0.92;
    const r = Math.sqrt(1 - y * y);
    sp.set([Math.cos(a) * r * 330, y * 330, Math.sin(a) * r * 330], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xf5f1e6, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false })));
  // moon, in the direction of the moonlight (-20, 40, 10)
  const dir = v3(-20, 40, 10).normalize().multiplyScalar(320);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xfff3d6, fog: false }));
  moon.position.copy(dir);
  moon.lookAt(0, 0, 0);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9aa8ff, transparent: true, opacity: 0.6, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(70);
  halo.position.copy(dir).multiplyScalar(0.99);
  g.add(halo, moon);
  g.renderOrder = -1;
  return g;
}

// ------------------------------------------------------------------ cloud sea
export function buildCloudSea(map: NightDef): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: 0x12384a, roughness: 1 }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -9;
  g.add(base);
  const rng = makeRng(100 + map.night);
  const cx = map.night === 2 ? 35 : 0;
  const items: { m: THREE.Matrix4; c: number }[] = [];
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2;
    const r = 30 + rng() * 150;
    const x = cx + Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (map.ground(x, z) !== null || (map.night === 2 && Math.hypot(x - 70, z) < 32) || Math.hypot(x, z) < 32) continue;
    const s = 4 + rng() * 9;
    items.push({ m: matrix(v3(x, -8.5 + rng() * 2.5, z), rng() * 6, v3(s * (1 + rng()), s * 0.35, s)), c: pick(rng, CLOUD) });
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  g.add(instanced(new THREE.IcosahedronGeometry(1, 1), mat, items));
  return g;
}

// ------------------------------------------------------------------ island underside
/** Jagged rock underside + hanging roots for a disc island (cx, cz, r). */
export function buildUnderside(cx: number, cz: number, r: number, top: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const depth = 14;
  const geo = new THREE.ConeGeometry(r, depth, 40, 6, true);
  geo.rotateX(Math.PI); // point down
  const p = geo.attributes.position;
  const rng = makeRng(seed);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > depth / 2 - 0.01) continue; // keep the rim exact so it meets the grass
    const k = 1 + (rng() - 0.5) * 0.35;
    p.setXYZ(i, p.getX(i) * k, y + (rng() - 0.5) * 1.2, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3d4a52, roughness: 1, flatShading: true }));
  body.position.set(cx, top - depth / 2 - 0.02, cz);
  g.add(body);
  // grassy lip so the top edge reads as a cliff
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(r, r - 0.4, 0.8, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a5447, roughness: 1, side: THREE.DoubleSide }));
  lip.position.set(cx, top - 0.4, cz);
  g.add(lip);
  // hanging roots
  const roots: { m: THREE.Matrix4 }[] = [];
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2;
    const rr = r * (0.85 + rng() * 0.14);
    const len = 1.5 + rng() * 4;
    roots.push({ m: matrix(v3(cx + Math.cos(a) * rr, top - 0.6 - len / 2, cz + Math.sin(a) * rr), a, v3(1, len, 1), (rng() - 0.5) * 0.3) });
  }
  const rootGeo = new THREE.CylinderGeometry(0.03, 0.08, 1, 4);
  g.add(instanced(rootGeo, new THREE.MeshStandardMaterial({ color: 0x4f3a2a, roughness: 1 }), roots));
  return g;
}

// ------------------------------------------------------------------ ground detail
function grassTuft(): THREE.BufferGeometry {
  const blades = [0, 1, 2, 3, 4].map((i) => {
    const b = new THREE.ConeGeometry(0.035, 0.42 + (i % 3) * 0.08, 3);
    b.translate(0, 0.21, 0);
    b.rotateZ((i - 2) * 0.22);
    b.rotateY(i * 1.3);
    b.translate(Math.cos(i * 2.1) * 0.06, 0, Math.sin(i * 2.1) * 0.06);
    return b;
  });
  return mergeGeometries(blades)!;
}

function flower(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.01, 0.012, 0.3, 3);
  stem.translate(0, 0.15, 0);
  const head = new THREE.IcosahedronGeometry(0.06, 0);
  head.translate(0, 0.32, 0);
  // the whole flower is tinted per instance; a pale stem is fine at night
  return mergeGeometries([stem.toNonIndexed(), head])!; // icosahedra are non-indexed
}

function roundTree(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.4, 6);
  trunk.translate(0, 1.2, 0);
  const blobs = [[0, 3.0, 0, 1.25], [0.6, 2.6, 0.3, 0.9], [-0.55, 2.7, -0.2, 0.95], [0.1, 3.6, -0.1, 0.85]].map(([x, y, z, s]) => {
    const b = new THREE.IcosahedronGeometry(s, 1);
    b.translate(x, y, z);
    return b;
  });
  return { trunk, canopy: mergeGeometries(blobs)! };
}

/** Areca palm ("cau", Night 2): tall thin trunk + drooping fronds. */
function arecaPalm(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 6, 6, 4);
  trunk.translate(0, 3, 0);
  const fronds = Array.from({ length: 7 }, (_, i) => {
    const f = new THREE.ConeGeometry(0.28, 2.4, 4);
    f.scale(1, 1, 0.25);
    f.translate(0, 1.2, 0);
    f.rotateZ(Math.PI / 2 + 0.55); // droop outwards
    f.rotateY((i / 7) * Math.PI * 2);
    f.translate(0, 6, 0);
    return f;
  });
  return { trunk, canopy: mergeGeometries(fronds)! };
}

export function buildGroundDetail(map: NightDef): THREE.Group {
  const g = new THREE.Group();
  const rng = makeRng(31 * map.night + 5);
  const keepOut: { x: number; z: number; r: number }[] = [
    ...map.lanterns.map((l) => ({ x: l.pos[0], z: l.pos[2], r: 2.6 })),
    ...map.pads.map((p) => ({ x: p.pos[0], z: p.pos[2], r: 1.8 })),
    { x: map.start[0], z: map.start[2], r: 2.5 },
  ];
  const flat = (x: number, z: number): number | null => {
    const h = map.ground(x, z);
    if (h === null || h > 8) return null;
    for (const [dx, dz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) if (map.ground(x + dx, z + dz) !== h) return null; // no edges / ramps
    for (const k of keepOut) if (Math.hypot(x - k.x, z - k.z) < k.r) return null;
    if (map.night === 2 && x > 25 && x < 45 && Math.abs(z) < 3) return null; // keep the bridge clear
    return h;
  };
  const extent = map.night === 2 ? { x0: -30, x1: 100, z: 30 } : map.night === 3 ? { x0: -46, x1: 46, z: 46 } : { x0: -41, x1: 41, z: 41 };
  const sample = (tries: number, accept: (x: number, z: number, h: number) => boolean, make: (x: number, z: number, h: number) => void) => {
    for (let i = 0; i < tries; i++) {
      const x = extent.x0 + rng() * (extent.x1 - extent.x0);
      const z = (rng() * 2 - 1) * extent.z;
      const h = flat(x, z);
      if (h !== null && accept(x, z, h)) make(x, z, h);
    }
  };
  const islandR = (x: number, z: number) => (map.night === 2 ? Math.min(Math.hypot(x, z), Math.hypot(x - 70, z)) : Math.hypot(x, z));
  const rimR = map.night === 1 ? 40 : map.night === 2 ? 28 : 45;

  // grass tufts
  const tufts: { m: THREE.Matrix4; c: number }[] = [];
  sample(3000, () => true, (x, z, h) => { // ~3000 tufts: tuned against the bench budget
    const s = 0.7 + rng() * 0.8;
    tufts.push({ m: matrix(v3(x, h, z), rng() * 6.28, v3(s, s * (0.8 + rng() * 0.6), s)), c: pick(rng, GRASS) });
  });
  g.add(instanced(grassTuft(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), tufts));

  // flowers (warm = good, per the PRD mood)
  const flowers: { m: THREE.Matrix4; c: number }[] = [];
  sample(700, () => rng() < 0.6, (x, z, h) => flowers.push({ m: matrix(v3(x, h, z), rng() * 6.28, v3(1, 0.8 + rng() * 0.5, 1)), c: pick(rng, FLOWERS) }));
  g.add(instanced(flower(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, emissive: 0x2a1a08, emissiveIntensity: 0.4 }), flowers));

  // rocks: a few inland, more along the rim
  const rocks: { m: THREE.Matrix4; c: number }[] = [];
  sample(1600, (x, z) => islandR(x, z) > rimR - 3.5 || rng() < 0.03, (x, z, h) => {
    const s = 0.25 + rng() * 0.7;
    rocks.push({ m: matrix(v3(x, h + s * 0.25, z), rng() * 6.28, v3(s * (1 + rng() * 0.6), s * (0.5 + rng() * 0.5), s), rng() * 0.4), c: pick(rng, ROCK) });
  });
  g.add(instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), rocks));

  // trees near the rim (round trees; areca palms on Đảo Cau)
  const tree = map.night === 2 ? arecaPalm() : roundTree();
  const trunks: { m: THREE.Matrix4 }[] = [];
  const canopies: { m: THREE.Matrix4; c: number }[] = [];
  const placed: [number, number][] = [];
  sample(3000, (x, z) => islandR(x, z) > rimR - 5.5 && islandR(x, z) < rimR - 1.6 && placed.every(([px, pz]) => Math.hypot(x - px, z - pz) > 4.5), (x, z, h) => {
    if (trunks.length >= (map.night === 2 ? 34 : 30)) return;
    placed.push([x, z]);
    const s = 0.8 + rng() * 0.45;
    const m = matrix(v3(x, h, z), rng() * 6.28, v3(s, s, s), (rng() - 0.5) * (map.night === 2 ? 0.25 : 0.08));
    trunks.push({ m });
    canopies.push({ m, c: map.night === 2 ? pick(rng, [0x2f5d50, 0x3a6b55]) : pick(rng, CANOPY) });
  });
  g.add(instanced(tree.trunk, new THREE.MeshStandardMaterial({ color: WOOD, roughness: 1 }), trunks));
  g.add(instanced(tree.canopy, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), canopies));

  // stone paths from the start toward every lantern on the same level
  const stones: { m: THREE.Matrix4; c: number }[] = [];
  for (const l of map.lanterns) {
    const [sx, , sz] = map.start;
    const d = Math.hypot(l.pos[0] - sx, l.pos[2] - sz);
    for (let t = 2.5; t < d - 2.2; t += 1.25) {
      const x = sx + ((l.pos[0] - sx) * t) / d + (rng() - 0.5) * 0.35;
      const z = sz + ((l.pos[2] - sz) * t) / d + (rng() - 0.5) * 0.35;
      const h = map.ground(x, z);
      if (h === null || h !== l.pos[1] || h > 8) continue; // only on the lantern's own tier
      const s = 0.38 + rng() * 0.14;
      stones.push({ m: matrix(v3(x, h + 0.02, z), rng() * 6.28, v3(s, 1, s)), c: pick(rng, [0x8e8573, 0x9c917c, 0x7f7766]) });
    }
  }
  g.add(instanced(new THREE.CylinderGeometry(1, 1, 0.05, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), stones));
  return g;
}
