/**
 * Procedural character / prop models (Three.js primitives only, no external assets).
 * Visual only: nothing here touches gameplay or headless output.
 * Mây's look: hooded wanderer (cream hood, dark face, glowing eyes, red scarf (standard palette), harness + pouches,
 * plant basket, crooked staff with a glass orb) + the nón lá with a small lantern required by PRD-0.
 */
import * as THREE from 'three';

/** Ticket-02 standard palette (Part 3) where it applies; other details are ours. */
export const PALETTE = {
  cream: 0xe8e2d0, // áo Mây
  scarf: 0xc8102e, // khăn Mây / Bùa Gió
  gold: 0xf2c14e,
  drifter: 0x8fa3b8,
  lanternLit: 0xffb347,
  lanternCore: 0xffe9b0,
  lanternOff: 0x5b5f6e,
  moteCore: 0xfff6c2,
  moteHalo: 0xffe58a,
  shadeStunned: 0x3a3450,
  olive: 0x5f6e35,
  oliveDark: 0x3c4624,
  umber: 0x4a3f38,
  leather: 0x6b4a30,
  amber: 0xe39a2b,
  wood: 0x6b4a2f,
  void: 0x0d0a09,
  straw: 0xd9b56b,
  ink: 0x120a1a, // Bóng Mực thân
  inkGlow: 0x7a3cff, // Bóng Mực viền
  shadeEye: 0x7a3cff,
};

/** Ticket-03 §6 "Bảng màu dễ phân biệt": shade rim/eyes #7A3CFF -> #00B3FF. */
export const display = { colorblind: false };
const shadeAccent = () => (display.colorblind ? 0x00b3ff : PALETTE.inkGlow);

const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
const basic = (color: number) => new THREE.MeshBasicMaterial({ color });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glowSprite(color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  s.scale.setScalar(size);
  return s;
}

function leaf(color: number, size: number): THREE.Mesh {
  const m = mesh(new THREE.SphereGeometry(size, 8, 6), std(color));
  m.scale.set(0.45, 1.3, 0.18);
  return m;
}

const shortAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// =====================================================================================  Mây
export class MayModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly orbPivot = new THREE.Group();
  private readonly hatLantern = new THREE.Group();
  private readonly orbFlies: THREE.Mesh[] = [];
  private readonly orbGlow: THREE.Sprite;
  private readonly orbLight: THREE.PointLight;
  private readonly last = new THREE.Vector3();
  private heading = 0;
  private walk = 0;

  constructor() {
    const P = PALETTE;
    const cream = std(P.cream);
    const umber = std(P.umber);
    const leather = std(P.leather);
    const olive = std(P.olive);
    const wood = std(P.wood);
    const amber = std(P.amber, { emissive: P.amber, emissiveIntensity: 0.15 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe8e0, transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false });
    const b = this.body;
    this.root.add(b);

    // boots + under-robe
    for (const x of [-0.14, 0.14]) {
      const boot = mesh(new THREE.SphereGeometry(0.12, 10, 8), umber, x, 0.08, 0.04);
      boot.scale.set(1, 0.7, 1.4);
      b.add(boot);
    }
    b.add(mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.22, 18), std(P.oliveDark), 0, 0.2, 0));

    // robe (flared), front trim, amber hem stitch
    b.add(mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.85, 20), cream, 0, 0.62, 0));
    const trim = mesh(new THREE.BoxGeometry(0.09, 0.82, 0.02), olive, 0, 0.62, 0.33);
    trim.rotation.x = -0.174;
    b.add(trim);
    const hem = mesh(new THREE.TorusGeometry(0.405, 0.015, 6, 32), amber, 0, 0.21, 0);
    hem.rotation.x = Math.PI / 2;
    b.add(hem);
    for (const [x, y, z, ry] of [[0.25, 0.4, 0.27, 0.7], [-0.3, 0.33, 0.22, -0.9]]) {
      const patch = mesh(new THREE.BoxGeometry(0.12, 0.1, 0.01), olive, x, y, z);
      patch.rotation.set(-0.17, ry, 0.2);
      b.add(patch);
    }

    // belt, buckle, chest strap, pouches, glass jar
    const belt = mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 28), leather, 0, 0.72, 0);
    belt.rotation.x = Math.PI / 2;
    b.add(belt, mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), amber, 0, 0.72, 0.315));
    const strap = mesh(new THREE.BoxGeometry(0.06, 0.78, 0.03), leather, 0, 0.95, 0.25);
    strap.rotation.set(-0.2, 0, 0.6);
    b.add(strap);
    const pouch = mesh(new THREE.BoxGeometry(0.13, 0.15, 0.08), leather, 0.22, 0.6, 0.25);
    pouch.rotation.y = 0.55;
    b.add(pouch, mesh(new THREE.SphereGeometry(0.025, 6, 6), amber, 0.25, 0.65, 0.3));
    const jar = new THREE.Group();
    jar.position.set(-0.2, 0.58, 0.28);
    jar.add(
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 12), glass),
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 10), std(0x7d9a3a, { emissive: 0x2f4010 }), 0, -0.025, 0),
      mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 12), umber, 0, 0.09, 0),
    );
    b.add(jar);

    // scarf + hanging tail
    const red = std(P.scarf);
    const scarf = mesh(new THREE.TorusGeometry(0.22, 0.09, 10, 22), red, 0, 1.08, 0);
    scarf.rotation.x = Math.PI / 2;
    b.add(scarf);
    const tail = mesh(new THREE.BoxGeometry(0.14, 0.4, 0.05), red, 0.13, 0.88, 0.27);
    tail.rotation.set(-0.15, 0, 0.15);
    b.add(tail);

    // sleeves + gloves (right hand at -X holds the staff)
    const sl = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.45, 10), cream, 0.33, 0.85, 0.04);
    sl.rotation.z = 0.35;
    const sr = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.45, 10), cream, -0.33, 0.86, 0.1);
    sr.rotation.set(0.35, 0, -0.25);
    b.add(sl, sr, mesh(new THREE.SphereGeometry(0.075, 10, 8), umber, 0.42, 0.63, 0.04), mesh(new THREE.SphereGeometry(0.075, 10, 8), umber, -0.39, 0.67, 0.22));

    // head: hood, dark face, glowing eyes, leaf
    const head = new THREE.Group();
    head.position.y = 1.38;
    const hood = mesh(new THREE.SphereGeometry(0.34, 22, 16), cream);
    hood.scale.set(1, 1.05, 1);
    const drape = mesh(new THREE.SphereGeometry(0.3, 16, 12), cream, 0, -0.12, -0.1);
    drape.scale.set(1.05, 0.9, 1.1);
    const face = mesh(new THREE.SphereGeometry(0.25, 18, 14), basic(P.void), 0, -0.03, 0.21);
    face.scale.set(1, 0.95, 0.55);
    const rim = mesh(new THREE.TorusGeometry(0.245, 0.04, 8, 28), cream, 0, -0.03, 0.29);
    head.add(hood, drape, face, rim);
    for (const x of [-0.085, 0.085]) {
      const eye = mesh(new THREE.SphereGeometry(0.04, 10, 8), basic(0xfff4d6), x, 0, 0.335);
      eye.scale.set(1, 1.35, 0.5);
      head.add(eye);
    }
    const hl = leaf(0x6f8a3a, 0.09);
    hl.position.set(0.24, 0.16, 0.12);
    hl.rotation.z = -0.8;
    head.add(hl);
    b.add(head);

    // nón lá (PRD-0) + small hanging paper lantern on the brim
    const hat = new THREE.Group();
    hat.position.y = 1.72;
    hat.add(mesh(new THREE.ConeGeometry(0.62, 0.32, 28), std(P.straw, { roughness: 0.95 }), 0, 0.16, 0));
    for (const [r, y] of [[0.6, 0.0], [0.42, 0.1], [0.24, 0.2]]) {
      const ring = mesh(new THREE.TorusGeometry(r, 0.008, 4, 32), std(0xb48f4c), 0, y, 0);
      ring.rotation.x = Math.PI / 2;
      hat.add(ring);
    }
    this.hatLantern.position.set(0.42, 0, 0.3);
    this.hatLantern.add(
      mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 4), umber, 0, -0.08, 0),
      (() => {
        const l = mesh(new THREE.SphereGeometry(0.065, 12, 10), std(0xd0452a, { emissive: 0xff6a2a, emissiveIntensity: 1.3 }), 0, -0.21, 0);
        l.scale.y = 1.3;
        return l;
      })(),
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), umber, 0, -0.13, 0),
      mesh(new THREE.ConeGeometry(0.015, 0.07, 6), std(0xd0452a), 0, -0.33, 0),
      (() => { const g = glowSprite(0xff8a3a, 0.45); g.position.y = -0.21; return g; })(),
    );
    hat.add(this.hatLantern);
    b.add(hat);

    // basket backpack with plants
    const basket = new THREE.Group();
    basket.position.set(0, 0.92, -0.34);
    basket.rotation.x = 0.15;
    basket.add(mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.42, 14), std(0x7a5634, { roughness: 1 })));
    for (const y of [-0.12, 0.02, 0.16]) {
      const band = mesh(new THREE.TorusGeometry(0.225 - y * 0.12, 0.012, 4, 20), std(0x4f3520), 0, y, 0);
      band.rotation.x = Math.PI / 2;
      basket.add(band);
    }
    const leafAngles = [0, 1.2, 2.4, 3.6, 4.8];
    leafAngles.forEach((a, i) => {
      const l = leaf(i % 2 ? 0x6f8a3a : 0x52692c, 0.13);
      l.position.set(Math.cos(a) * 0.1, 0.32, Math.sin(a) * 0.1);
      l.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5);
      basket.add(l);
    });
    basket.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), amber, 0.06, 0.45, 0.03));
    b.add(basket);

    // staff with curled hook, leaves and hanging glass orb (holds the carried fireflies)
    const staff = new THREE.Group();
    staff.position.set(-0.41, 0, 0.24);
    staff.add(mesh(new THREE.CylinderGeometry(0.022, 0.035, 2.0, 8), wood, 0, 1.0, 0));
    for (const y of [0.6, 1.25, 1.7]) staff.add(mesh(new THREE.SphereGeometry(0.035, 6, 6), wood, 0, y, 0));
    const hook = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 1.95, 0), new THREE.Vector3(0, 2.32, 0.04), new THREE.Vector3(0, 2.16, 0.32));
    staff.add(new THREE.Mesh(new THREE.TubeGeometry(hook, 12, 0.02, 6), wood));
    for (const [y, z, r] of [[2.2, 0.0, 0.6], [2.05, -0.03, -0.7], [2.28, 0.12, 1.4]]) {
      const l = leaf(0x6f8a3a, 0.07);
      l.position.set(0.04, y, z);
      l.rotation.z = r;
      staff.add(l);
    }
    this.orbPivot.position.set(0, 2.15, 0.32);
    this.orbPivot.add(
      mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), umber, 0, -0.06, 0),
      mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.05, 10), umber, 0, -0.12, 0),
      mesh(new THREE.SphereGeometry(0.16, 18, 14), glass, 0, -0.28, 0),
      (() => { const d = mesh(new THREE.ConeGeometry(0.035, 0.1, 8), amber, 0, -0.49, 0); d.rotation.x = Math.PI; return d; })(),
    );
    for (let i = 0; i < 10; i++) {
      const f = mesh(new THREE.SphereGeometry(0.022, 6, 6), basic(0xffd36b));
      this.orbFlies.push(f);
      this.orbPivot.add(f);
    }
    this.orbGlow = glowSprite(0xffb347, 0.9);
    this.orbGlow.position.y = -0.28;
    this.orbLight = new THREE.PointLight(0xffa940, 4, 10, 1.6);
    this.orbLight.position.y = -0.28;
    this.orbPivot.add(this.orbGlow, this.orbLight);
    staff.add(this.orbPivot);
    b.add(staff);
  }

  reset(pos: readonly number[]): void {
    this.last.set(pos[0], pos[1], pos[2]);
  }

  update(dt: number, t: number, pos: readonly number[], carried: number, visible: boolean): void {
    const dx = pos[0] - this.last.x;
    const dz = pos[2] - this.last.z;
    const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    if (speed > 0.5) this.heading += shortAngle(Math.atan2(dx, dz) - this.heading) * Math.min(1, dt * 12);
    const moving = Math.min(1, speed / 6);
    this.walk += dt * speed * 2.4;

    this.root.position.set(pos[0], pos[1], pos[2]);
    this.root.rotation.y = this.heading;
    this.root.visible = visible;
    this.body.position.y = Math.abs(Math.sin(this.walk)) * 0.07 * moving + Math.sin(t * 2) * 0.01;
    this.body.rotation.z = Math.sin(this.walk) * 0.05 * moving;
    this.body.rotation.x = moving * 0.08;
    this.orbPivot.rotation.x = Math.sin(t * 1.7) * 0.1 - moving * 0.35;
    this.orbPivot.rotation.z = Math.sin(this.walk) * 0.15 * moving;
    this.hatLantern.rotation.x = Math.sin(t * 2.1 + 1) * 0.15 - moving * 0.4;
    this.hatLantern.rotation.z = Math.sin(this.walk + 0.5) * 0.2 * moving;

    // fireflies swirl inside the orb: one per carried mote, so the light you carry is visible
    this.orbFlies.forEach((f, i) => {
      f.visible = i < carried;
      const a = t * (1.2 + i * 0.13) + i * 2.4;
      f.position.set(Math.cos(a) * 0.09, -0.28 + Math.sin(a * 1.3 + i) * 0.08, Math.sin(a) * 0.09);
    });
    const glow = Math.min(carried, 10) / 10;
    this.orbGlow.scale.setScalar(0.5 + glow * 0.9 + Math.sin(t * 5) * 0.04);
    this.orbLight.intensity = 2 + glow * 8;
    this.last.set(pos[0], pos[1], pos[2]);
  }
}

// =====================================================================================  Bóng Mực
export class ShadeModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly eyeGlow: THREE.Sprite[] = [];
  private readonly tendrils: THREE.Mesh[] = [];
  private readonly drops: THREE.Mesh[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly light: THREE.PointLight;
  private readonly phase: number;
  private readonly drain: THREE.Sprite;

  constructor(phase: number) {
    this.phase = phase;
    this.drain = glowSprite(0x7a5cff, 1.6); // a dim "sucking" glow while draining
    this.drain.position.set(0, 0.3, 0.8);
    this.drain.visible = false;
    this.root.add(this.drain);
    const P = PALETTE;
    this.bodyMat = std(P.ink, { emissive: P.inkGlow, emissiveIntensity: 0.12, roughness: 0.45, side: THREE.DoubleSide, transparent: true });
    this.eyeMat = basic(P.shadeEye);
    const b = this.body;
    this.root.add(b);

    // tattered cloak: open cone with a jagged hem
    const cloakGeo = new THREE.CylinderGeometry(0.2, 0.62, 1.4, 18, 4, true);
    const pos = cloakGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < -0.69) {
        const k = Math.sin(i * 12.9898) * 43758.5453;
        pos.setY(i, pos.getY(i) - (k - Math.floor(k)) * 0.35);
      }
    }
    cloakGeo.computeVertexNormals();
    b.add(mesh(cloakGeo, this.bodyMat, 0, -0.2, 0));
    b.add(mesh(new THREE.CylinderGeometry(0.18, 0.5, 1.2, 12), basic(0x07030a), 0, -0.2, 0)); // dark inside

    // hood with curling tip, black face, slanted violet eyes
    const hood = mesh(new THREE.SphereGeometry(0.36, 18, 14), this.bodyMat, 0, 0.62, 0);
    hood.scale.set(1, 1.08, 1);
    const tip = mesh(new THREE.ConeGeometry(0.16, 0.5, 10), this.bodyMat, 0, 0.98, -0.18);
    tip.rotation.x = -0.95;
    const face = mesh(new THREE.SphereGeometry(0.26, 16, 12), basic(0x040106), 0, 0.58, 0.22);
    face.scale.set(1, 0.95, 0.5);
    b.add(hood, tip, face);
    for (const s of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.05, 10, 8), this.eyeMat, s * 0.09, 0.6, 0.34);
      eye.scale.set(1.3, 0.8, 0.5);
      eye.rotation.z = s * 0.35;
      const g = glowSprite(P.shadeEye, 0.35);
      g.position.set(s * 0.09, 0.6, 0.38);
      this.eyeGlow.push(g);
      b.add(eye, g);
    }

    // reaching ink arms
    for (const s of [-1, 1]) {
      const arm = mesh(new THREE.ConeGeometry(0.09, 0.75, 8), this.bodyMat, s * 0.42, 0.05, 0.2);
      arm.rotation.set(2.2, 0, s * 0.35);
      b.add(arm);
    }
    // hem tendrils + orbiting ink drops
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tnd = mesh(new THREE.ConeGeometry(0.06, 0.55, 6), this.bodyMat, Math.cos(a) * 0.48, -1.05, Math.sin(a) * 0.48);
      tnd.rotation.x = Math.PI;
      this.tendrils.push(tnd);
      b.add(tnd);
    }
    for (let i = 0; i < 4; i++) {
      const d = mesh(new THREE.SphereGeometry(0.055, 8, 6), this.bodyMat);
      this.drops.push(d);
      b.add(d);
    }
    this.light = new THREE.PointLight(P.inkGlow, 0, 0.01); // no real light: keeps the light count (and FPS) bounded
    this.light.position.set(0, 0.5, 0.3);
    b.add(this.light);

    this.shadow = mesh(new THREE.CircleGeometry(0.75, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.root.add(this.shadow);
  }

  update(t: number, pos: readonly number[], state: string, player: readonly number[]): void {
    const stunned = state === 'stunned';
    const y = Math.max(1, pos[1]) + Math.sin(t * 2.2 + this.phase) * 0.12;
    this.root.position.set(pos[0], y, pos[2]);
    this.shadow.position.y = -y + 0.03;
    this.body.rotation.y = Math.atan2(player[0] - pos[0], player[2] - pos[2]);

    this.bodyMat.opacity = stunned ? 0.6 : 1;
    this.bodyMat.color.setHex(stunned ? PALETTE.shadeStunned : PALETTE.ink);
    this.bodyMat.emissiveIntensity = stunned ? 0 : 0.12 + Math.sin(t * 3 + this.phase) * 0.05;
    this.eyeMat.color.setHex(stunned ? 0xb9c6ff : shadeAccent());
    this.bodyMat.emissive.setHex(shadeAccent());
    for (const g of this.eyeGlow) { g.visible = !stunned; g.material.color.setHex(shadeAccent()); }
    this.drain.visible = state === 'drain';
    
    const s = stunned ? 0.82 + Math.sin(t * 18) * 0.03 : 1 + Math.sin(t * 5 + this.phase) * 0.04;
    this.body.scale.set(s, stunned ? s * 0.92 : s, s);
    this.body.rotation.z = stunned ? Math.sin(t * 9) * 0.12 : 0;

    const sway = stunned ? 0.6 : 1.8;
    this.tendrils.forEach((tnd, i) => {
      tnd.rotation.z = Math.sin(t * sway * 2 + i * 1.7 + this.phase) * 0.35;
      tnd.rotation.x = Math.PI + Math.cos(t * sway * 1.6 + i) * 0.25;
    });
    this.drops.forEach((d, i) => {
      const a = t * 1.4 + (i * Math.PI) / 2 + this.phase;
      d.position.set(Math.cos(a) * 0.8, -0.3 + Math.sin(a * 2) * 0.25, Math.sin(a) * 0.8);
    });
  }
}

// =====================================================================================  Đèn Lồng Lớn
export class GreatLanternModel {
  readonly root = new THREE.Group();
  private readonly silk: THREE.MeshStandardMaterial;
  private readonly light: THREE.PointLight;
  private readonly glow: THREE.Sprite;
  private readonly hang = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly tears = new THREE.Group();
  private readonly bar = new THREE.Group();
  private readonly barFill: THREE.Mesh;
  private readonly barMat: THREE.MeshBasicMaterial;

  constructor(pos: readonly number[]) {
    const P = PALETTE;
    const wood = std(P.wood);
    const stone = std(0x55505a, { roughness: 1 });
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.root.add(
      mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.3, 10), stone, 0, 0.15, 0),
      mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.22, 10), stone, 0, 0.41, 0),
      mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.4, 10), wood, 0, 2.1, 0),
      mesh(new THREE.ConeGeometry(0.2, 0.28, 8), wood, 0, 3.94, 0),
      mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), wood, 0.45, 3.55, 0),
    );
    const brace = mesh(new THREE.BoxGeometry(0.6, 0.07, 0.07), wood, 0.22, 3.27, 0);
    brace.rotation.z = 0.8;
    this.root.add(brace);

    // hanging silk lantern (Hội An style): body, ribs, caps, tassel
    this.hang.position.set(0.88, 3.5, 0);
    this.silk = std(P.lanternOff, { emissive: P.lanternLit, emissiveIntensity: 0, roughness: 0.7 });
    const bodyY = -0.75;
    const body = mesh(new THREE.SphereGeometry(0.42, 22, 16), this.silk, 0, bodyY, 0);
    body.scale.y = 1.25;
    this.body = body;
    // torn paper (shape cue for "off", not colour): dark jagged slits on the silk
    const tearMat = new THREE.MeshBasicMaterial({ color: 0x14100e, side: THREE.DoubleSide });
    for (const [a, y, h] of [[0.3, 0.1, 0.35], [2.2, -0.15, 0.3], [4.1, 0.05, 0.4]]) {
      const tear = new THREE.Mesh(new THREE.ConeGeometry(0.07, h, 3), tearMat);
      tear.position.set(Math.sin(a) * 0.43, bodyY + y, Math.cos(a) * 0.43);
      tear.lookAt(Math.sin(a) * 2, bodyY + y, Math.cos(a) * 2);
      tear.rotateX(Math.PI / 2);
      tear.scale.z = 0.15;
      this.tears.add(tear);
    }
    this.hang.add(this.tears);
    // fuel bar above the lantern (billboarded in update)
    this.bar.position.set(0.88, 4.5, 0);
    this.bar.add(mesh(new THREE.PlaneGeometry(1.3, 0.16), new THREE.MeshBasicMaterial({ color: 0x14182c, side: THREE.DoubleSide })));
    this.barMat = new THREE.MeshBasicMaterial({ color: PALETTE.lanternLit, side: THREE.DoubleSide });
    const fillGeo = new THREE.PlaneGeometry(1.24, 0.1);
    fillGeo.translate(0.62, 0, 0);
    this.barFill = mesh(fillGeo, this.barMat, -0.62, 0, 0.005);
    this.bar.add(this.barFill);
    this.root.add(this.bar);
    this.hang.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 4), std(P.umber), 0, -0.12, 0), body);
    for (let k = 0; k < 6; k++) {
      const rib = mesh(new THREE.TorusGeometry(0.425, 0.011, 4, 32), wood, 0, bodyY, 0);
      rib.scale.y = 1.25;
      rib.rotation.y = (k * Math.PI) / 6;
      this.hang.add(rib);
    }
    this.hang.add(
      mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.1, 12), wood, 0, bodyY + 0.5, 0),
      mesh(new THREE.CylinderGeometry(0.22, 0.15, 0.1, 12), wood, 0, bodyY - 0.5, 0),
    );
    const tassel = mesh(new THREE.ConeGeometry(0.07, 0.4, 8), std(0xb3262a), 0, bodyY - 0.75, 0);
    tassel.rotation.x = Math.PI;
    this.hang.add(tassel);
    this.glow = glowSprite(P.lanternCore, 3.2);
    this.glow.position.y = bodyY;
    this.light = new THREE.PointLight(P.lanternLit, 0, 26, 1.4);
    this.light.position.y = bodyY;
    this.hang.add(this.glow, this.light);
    this.root.add(this.hang);
  }

  update(t: number, lit: boolean, fill: number, fuel = 100, low = false, cam?: THREE.Camera): void {
    // Ticket-03: fuel bar on lit lanterns; below 30 the lantern and bar blink slowly (1 Hz)
    const blinkOff = lit && low && Math.floor(t * 2) % 2 === 1;
    this.bar.visible = lit;
    this.barFill.scale.x = Math.max(0.001, fuel / 100);
    this.barMat.color.setHex(low ? (display.colorblind ? 0xffffff : 0xff5a5f) : PALETTE.lanternLit);
    this.barMat.opacity = blinkOff ? 0.25 : 1;
    this.barMat.transparent = true;
    if (cam) this.bar.quaternion.copy(cam.quaternion);
    // off = squashed 20% + torn paper (distinguishable without colour)
    this.body.scale.set(1, lit ? 1.25 : 1.25 * 0.8, 1);
    this.tears.visible = !lit;
    if (blinkOff) {
      this.silk.emissiveIntensity = 0.3;
      this.light.intensity = 6;
      this.glow.visible = false;
      return;
    }
    this.silk.emissiveIntensity = lit ? 1.6 + Math.sin(t * 3) * 0.1 : 0.5 * fill;
    this.silk.color.setHex(lit ? PALETTE.lanternLit : PALETTE.lanternOff);
    this.light.intensity = lit ? 40 : 5 * fill;
    this.glow.visible = lit || fill > 0;
    this.glow.scale.setScalar(lit ? 3.2 + Math.sin(t * 2.5) * 0.15 : 1 + fill);
    this.hang.rotation.z = Math.sin(t * 0.9 + this.root.position.x) * 0.04;
  }
}

// =====================================================================================  Đom đóm
export class MoteModel {
  readonly root = new THREE.Group();
  private readonly glow: THREE.Sprite;
  private readonly wings: THREE.Mesh[] = [];
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.root.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), basic(PALETTE.moteCore)));
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    for (const s of [-1, 1]) {
      const w = mesh(new THREE.CircleGeometry(0.07, 8), wingMat, s * 0.06, 0.03, 0);
      w.scale.set(1, 0.55, 1);
      this.wings.push(w);
      this.root.add(w);
    }
    this.glow = glowSprite(PALETTE.moteHalo, 0.75);
    this.root.add(this.glow);
  }

  update(t: number, pos: readonly number[]): void {
    const s = this.seed;
    // the sim position is the ground point; hovering/drifting is visual only
    this.root.position.set(pos[0] + Math.sin(t * 0.8 + s) * 0.15, 0.8 + Math.sin(t * 2 + s) * 0.2, pos[2] + Math.cos(t * 0.7 + s) * 0.15);
    this.glow.scale.setScalar(0.6 + 0.25 * (0.5 + 0.5 * Math.sin(t * 4 + s * 3)));
    this.wings.forEach((w, i) => (w.rotation.y = (i ? -1 : 1) * (0.4 + Math.sin(t * 30 + s) * 0.6)));
  }
}

// =====================================================================================  Gió Lạc
export class DrifterModel {
  readonly root = new THREE.Group();
  private readonly ribbon: THREE.Mesh;
  private readonly base: Float32Array;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly sack: THREE.Mesh;

  constructor() {
    // a grey-blue silk ribbon: a long thin plane whose vertices wave every frame
    const geo = new THREE.PlaneGeometry(2.4, 0.35, 24, 1);
    geo.rotateY(Math.PI / 2); // length along local Z
    this.base = Float32Array.from(geo.attributes.position.array as Float32Array);
    this.mat = new THREE.MeshStandardMaterial({ color: PALETTE.drifter, emissive: PALETTE.drifter, emissiveIntensity: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.9, roughness: 0.4 });
    this.ribbon = new THREE.Mesh(geo, this.mat);
    this.sack = mesh(new THREE.SphereGeometry(0.16, 10, 8), basic(PALETTE.moteHalo), 0, 0, -1.1);
    this.root.add(this.ribbon, this.sack, glowSprite(PALETTE.drifter, 1.2));
  }

  update(t: number, pos: readonly number[], state: string, stolen: number, player: readonly number[]): void {
    this.root.visible = state !== 'removed';
    if (!this.root.visible) return;
    this.root.position.set(pos[0], pos[1] + Math.sin(t * 3) * 0.15, pos[2]);
    const away = state === 'flee';
    const dx = player[0] - pos[0];
    const dz = player[2] - pos[2];
    this.root.rotation.y = Math.atan2(away ? -dx : dx, away ? -dz : dz);
    const p = this.ribbon.geometry.attributes.position as THREE.BufferAttribute;
    const speed = state === 'idle' ? 3 : 8;
    for (let i = 0; i < p.count; i++) {
      const z = this.base[i * 3 + 2];
      p.setX(i, this.base[i * 3] + Math.sin(z * 2.5 - t * speed) * 0.25);
      p.setY(i, this.base[i * 3 + 1] + Math.cos(z * 2 - t * speed * 0.8) * 0.15);
    }
    p.needsUpdate = true;
    this.mat.emissiveIntensity = state === 'chase' ? 0.7 : 0.35;
    this.sack.visible = stolen > 0;
  }
}

// =====================================================================================  Bùa Gió
export class CharmModel {
  readonly root = new THREE.Group();

  constructor(pos: readonly number[]) {
    this.root.position.set(pos[0], pos[1], pos[2]);
    const tag = new THREE.Group();
    tag.position.y = 1.1;
    tag.add(
      mesh(new THREE.BoxGeometry(0.42, 0.62, 0.02), std(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.4 })),
      mesh(new THREE.BoxGeometry(0.34, 0.54, 0.03), std(PALETTE.scarf, { emissive: PALETTE.scarf, emissiveIntensity: 0.35 })),
      mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 20), std(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.6 }), 0, 0.05, 0.02),
      glowSprite(PALETTE.scarf, 1.4),
    );
    this.root.add(tag);
  }

  update(t: number, available: boolean): void {
    this.root.visible = available;
    const tag = this.root.children[0];
    tag.rotation.y = t * 1.5;
    tag.position.y = 1.1 + Math.sin(t * 2) * 0.12;
  }
}
