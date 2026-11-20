/** Terrain meshes per night, built from the same map data the sim uses (src/sim/maps.ts). Visual only. */
import * as THREE from 'three';
import type { NightDef } from '../sim/maps.js';
import { PALETTE, glowSprite } from './models.js';

export const SKY = 0x0e1430;
export const FOG = 0x1b2350;
const GRASS = 0x2f5d50;
const SAND = 0xc9b48a;
const WOOD = 0x6b4a2f;
const CLOUD_SEA = 0x12384a;
const CLIFF = 0x3d4a52;

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1 });

/** Disc island: grass top at y = top, sandy rim, rocky underside. */
function island(cx: number, cz: number, r: number, top = 0, depth = 3): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.6, depth + 4, 48), mat(CLIFF));
  body.position.set(cx, top - (depth + 4) / 2, cz);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(r - 1.2, 48), mat(GRASS));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(cx, top + 0.01, cz);
  const sand = new THREE.Mesh(new THREE.RingGeometry(r - 1.2, r, 48), mat(SAND));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(cx, top + 0.005, cz);
  g.add(body, grass, sand);
  return g;
}

function pad(pos: readonly number[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 0.12, 24), new THREE.MeshStandardMaterial({ color: PALETTE.gold, emissive: PALETTE.gold, emissiveIntensity: 0.5 }));
  disc.position.y = 0.06;
  const glow = glowSprite(PALETTE.gold, 2.4);
  glow.position.y = 0.4;
  g.add(disc, glow);
  return g;
}

/** Ramp wedge from radius 30 (Y 0) up to radius 24 (Y 3), 3 m wide, along angle a. */
function ramp(aRad: number): THREE.Mesh {
  const shape = new THREE.Shape([new THREE.Vector2(24, 0), new THREE.Vector2(30, 0), new THREE.Vector2(24, 3)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
  geo.translate(0, 0, -1.5);
  const m = new THREE.Mesh(geo, mat(WOOD));
  m.rotation.y = -aRad; // local +X -> (cos a, 0, sin a)
  return m;
}

/** Half annulus (z > 0) extruded to height h. */
function halfAnnulus(r0: number, r1: number, h: number): THREE.Group {
  const shape = new THREE.Shape();
  // shape (x, y) maps to world (x, -y) after the rotation below, so angles PI..2PI give z > 0
  shape.absarc(0, 0, r1, Math.PI, 2 * Math.PI, false);
  shape.absarc(0, 0, r0, 2 * Math.PI, Math.PI, true);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 48 });
  const body = new THREE.Mesh(geo, [mat(GRASS), mat(CLIFF)]);
  body.rotation.x = -Math.PI / 2;
  return new THREE.Group().add(body);
}

export function buildWorld(map: NightDef): THREE.Group {
  const world = new THREE.Group();
  const sea = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: CLOUD_SEA, roughness: 1 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -8;
  world.add(sea);

  if (map.night === 1) world.add(island(0, 0, 40));
  if (map.night === 2) {
    world.add(island(0, 0, 28), island(70, 0, 28));
    const bridge = new THREE.Group();
    for (let x = 26.25; x < 44; x += 0.5) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 4), mat(WOOD));
      plank.position.set(x, -0.06, 0);
      bridge.add(plank);
    }
    world.add(bridge);
  }
  if (map.night === 3) {
    world.add(island(0, 0, 45));
    world.add(halfAnnulus(12, 24, 3));
    const t2 = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 6, 40), [mat(CLIFF), mat(GRASS), mat(GRASS)]);
    t2.position.y = 3;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 24), mat(0x8a7f74));
    tower.position.y = 10;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 2.2, 8), mat(WOOD));
    roof.position.y = 15.1;
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.6), new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.6, roughness: 0.35 }));
    bell.position.y = 13.4;
    world.add(t2, tower, roof, bell, ramp((30 * Math.PI) / 180), ramp((150 * Math.PI) / 180));
  }
  for (const p of map.pads) world.add(pad(p.pos));
  return world;
}

/** Leaves blown by the Night 3 wind (warning + gust). */
export class WindLeaves {
  readonly root = new THREE.Group();
  private readonly leaves: THREE.Mesh[] = [];

  constructor() {
    const m = new THREE.MeshBasicMaterial({ color: 0x9fb06a, side: THREE.DoubleSide });
    for (let i = 0; i < 60; i++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.12), m);
      l.userData.seed = i * 7.31;
      this.leaves.push(l);
      this.root.add(l);
    }
    this.root.visible = false;
  }

  update(t: number, center: readonly number[], show: boolean, dirDeg: number, strong: boolean): void {
    this.root.visible = show;
    if (!show) return;
    const a = (dirDeg * Math.PI) / 180;
    const span = 30;
    for (const l of this.leaves) {
      const s = l.userData.seed as number;
      const along = (((t * (strong ? 9 : 4) + s * 3) % span) + span) % span - span / 2;
      const side = ((s * 13.7) % span) - span / 2;
      l.position.set(center[0] + Math.cos(a) * along - Math.sin(a) * side, center[1] + 0.5 + ((s * 3.3) % 4), center[2] + Math.sin(a) * along + Math.cos(a) * side);
      l.rotation.set(t * 5 + s, t * 3 + s, 0);
    }
  }
}
