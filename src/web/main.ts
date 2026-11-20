/** Browser client: renders the shared deterministic Sim with Three.js. All gameplay rules live in src/sim. */
import * as THREE from 'three';
import contract from '../../game.contract.json' with { type: 'json' };
import { ISLAND_RADIUS, Sim, TICK_HZ } from '../sim/sim.js';
import type { InputState, Tuning } from '../sim/types.js';

const T = contract.tuning as Tuning;
const WARM = 0xffa940;
const INK = 0x2a0f3d;

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120a24);
scene.fog = new THREE.Fog(0x1a0d2e, 18, 75);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
const ambient = new THREE.HemisphereLight(0x6a5aa0, 0x1a1030, 0.35);
scene.add(ambient);
const moon = new THREE.DirectionalLight(0x8899ff, 0.25);
moon.position.set(-20, 40, 10);
scene.add(moon);

// island + cloud sea
const island = new THREE.Mesh(
  new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS - 4, 3, 64),
  new THREE.MeshStandardMaterial({ color: 0x2c3f3a, roughness: 1 }),
);
island.position.y = -1.5;
scene.add(island);
const clouds = new THREE.Mesh(new THREE.CircleGeometry(220, 48), new THREE.MeshStandardMaterial({ color: 0x3b2c5e, roughness: 1 }));
clouds.rotation.x = -Math.PI / 2;
clouds.position.y = -4;
scene.add(clouds);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ meshes
const moteGeo = new THREE.SphereGeometry(0.18, 10, 8);
const moteMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
const shadeGeo = new THREE.SphereGeometry(0.9, 16, 12);
const shadeMat = new THREE.MeshStandardMaterial({ color: INK, emissive: 0x3d1260, emissiveIntensity: 0.6, roughness: 0.4 });
const stunMat = new THREE.MeshStandardMaterial({ color: 0x7b5a9e, transparent: true, opacity: 0.45 });

function makePlayer(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.8, 4, 10), new THREE.MeshStandardMaterial({ color: 0x4f7cc4 }));
  body.position.y = 0.75;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.35, 20), new THREE.MeshStandardMaterial({ color: 0xd9b56b }));
  hat.position.y = 1.75; // nón lá
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: WARM }));
  lamp.position.set(0.6, 1.35, 0); // small lantern hanging from the hat brim
  const light = new THREE.PointLight(WARM, 6, 9, 1.6);
  light.position.copy(lamp.position);
  g.add(body, hat, lamp, light);
  return g;
}

interface LanternView { lamp: THREE.Mesh; light: THREE.PointLight; ring: THREE.Mesh }
let lanternViews: LanternView[] = [];
const dynamic = new THREE.Group();
scene.add(dynamic);
const player = makePlayer();
scene.add(player);

// ------------------------------------------------------------------ game state
let sim: Sim;
const moteMeshes = new Map<string, THREE.Mesh>();
const shadeMeshes = new Map<string, THREE.Mesh>();
const pulses: { mesh: THREE.Mesh; age: number }[] = [];

function newGame(): void {
  sim = new Sim(T, (Math.random() * 2 ** 31) | 0);
  dynamic.clear();
  moteMeshes.clear();
  shadeMeshes.clear();
  lanternViews = sim.lanterns.map((l) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 3, 8), new THREE.MeshStandardMaterial({ color: 0x5a3b28 }));
    post.position.set(l.pos[0], 1.5, l.pos[2]);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0x3a2f2a, emissive: WARM, emissiveIntensity: 0 }));
    lamp.position.set(l.pos[0], 3.3, l.pos[2]);
    const light = new THREE.PointLight(WARM, 0, 26, 1.4);
    light.position.copy(lamp.position);
    const ring = new THREE.Mesh(new THREE.RingGeometry(T.safe_radius - 0.08, T.safe_radius, 48), new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.18 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(l.pos[0], 0.02, l.pos[2]);
    dynamic.add(post, lamp, light, ring);
    return { lamp, light, ring };
  });
  document.getElementById('msg')!.style.display = 'none';
}

// ------------------------------------------------------------------ input
const keys = new Set<string>();
let camYaw = 0;
let dragging = false;
const edges = { jump: false, interact: false, pulse: false };
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR' && sim.over) newGame();
});
addEventListener('keyup', (e) => keys.delete(e.code));
renderer.domElement.addEventListener('pointerdown', () => (dragging = true));
addEventListener('pointerup', () => (dragging = false));
addEventListener('pointermove', (e) => { if (dragging) camYaw -= e.movementX * 0.006; });

function readInput(): InputState {
  // Camera looks along (sinθ, 0, cosθ); screen-right is world (-cosθ, 0, sinθ) = move x = -1.
  const z = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const x = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  edges.jump = keys.has('Space');
  edges.interact = keys.has('KeyE');
  edges.pulse = keys.has('KeyF');
  return { move: [x, z], cam_yaw_deg: (camYaw * 180) / Math.PI, ...edges };
}

// ------------------------------------------------------------------ events -> effects
const toast = document.getElementById('toast')!;
let toastTimer = 0;
function say(text: string): void { toast.textContent = text; toastTimer = 2.2; }

function onEvent(name: string, data: Record<string, unknown>): void {
  if (name === 'pulse') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(player.position.x, 0.3, player.position.z);
    scene.add(ring);
    pulses.push({ mesh: ring, age: 0 });
  } else if (name === 'lantern_lit') say(`Đèn ${data.lantern_id} đã sáng!`);
  else if (name === 'player_hit') say('Bóng Mực chạm vào Mây! Mất một ngọn lửa');
  else if (name === 'shade_spawned') say('Một Bóng Mực mới trồi lên từ sương…');
  else if (name === 'game_over') {
    const won = data.result === 'won';
    const msg = document.getElementById('msg')!;
    const why = { all_lit: 'Mọi Đèn Lồng Lớn đã sáng', dawn: 'Trời đã sáng mà đảo vẫn tối', no_flames: 'Mây đã hết lửa' }[data.reason as string];
    msg.innerHTML = `<h1>${won ? 'Đảo đã sáng!' : 'Đêm vẫn còn tối…'}</h1><div>${why}</div><div>Điểm: <b>${sim.score}</b></div><div style="margin-top:14px;font-size:16px">Nhấn R để chơi lại</div>`;
    msg.style.display = 'flex';
  }
}

// ------------------------------------------------------------------ sync view with sim
function sync(time: number): void {
  const p = sim.player;
  player.position.set(p.pos[0], p.pos[1], p.pos[2]);
  player.rotation.y = camYaw;
  player.visible = p.invulnTicks === 0 || Math.floor(time * 12) % 2 === 0;

  const seen = new Set<string>();
  for (const m of sim.motes) {
    seen.add(m.id);
    let mesh = moteMeshes.get(m.id);
    if (!mesh) { mesh = new THREE.Mesh(moteGeo, moteMat); moteMeshes.set(m.id, mesh); dynamic.add(mesh); }
    mesh.position.set(m.pos[0], 0.8 + 0.2 * Math.sin(time * 3 + m.pos[0]), m.pos[2]); // hover is visual only
  }
  for (const [id, mesh] of moteMeshes) if (!seen.has(id)) { dynamic.remove(mesh); moteMeshes.delete(id); }

  for (const s of sim.shades) {
    let mesh = shadeMeshes.get(s.id);
    if (!mesh) { mesh = new THREE.Mesh(shadeGeo, shadeMat); shadeMeshes.set(s.id, mesh); dynamic.add(mesh); }
    mesh.material = s.state === 'stunned' ? stunMat : shadeMat;
    mesh.position.set(s.pos[0], Math.max(0.9, s.pos[1]) + 0.15 * Math.sin(time * 4), s.pos[2]);
    mesh.scale.setScalar(1 + 0.08 * Math.sin(time * 6 + s.pos[2]));
  }

  let lit = 0;
  sim.lanterns.forEach((l, i) => {
    const v = lanternViews[i];
    const fill = l.lit ? 1 : l.deposited / T.lantern_cost;
    (v.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = l.lit ? 2.2 : 0.4 * fill;
    v.light.intensity = l.lit ? 40 : 4 * fill;
    if (l.lit) lit++;
  });
  ambient.intensity = 0.35 + 0.18 * lit; // island brightens as lanterns are lit

  const yaw = camYaw;
  camera.position.set(p.pos[0] - Math.sin(yaw) * 9, p.pos[1] + 5, p.pos[2] - Math.cos(yaw) * 9);
  camera.lookAt(p.pos[0], p.pos[1] + 1.2, p.pos[2]);

  const cd = Math.ceil(p.pulseCooldownTicks / TICK_HZ);
  document.getElementById('hud')!.innerHTML =
    `Lửa: <b>${'●'.repeat(Math.max(0, p.flames))}${'○'.repeat(Math.max(0, T.flames - p.flames))}</b><br>` +
    `Đom đóm: <b>${p.carried}/${T.carry_capacity}</b><br>` +
    `Đèn đã thắp: <b>${lit}/${sim.lanterns.length}</b><br>` +
    `Bình minh sau: <b>${Math.ceil(sim.timeLeft)}s</b><br>` +
    `Điểm: <b>${sim.score}</b><br>` +
    `Tỏa sáng (F): <b>${p.carried < T.pulse_cost ? `cần ${T.pulse_cost} đom đóm` : cd > 0 ? `chờ ${cd}s` : 'sẵn sàng'}</b>`;
}

// ------------------------------------------------------------------ main loop (fixed 60 Hz sim)
newGame();
let acc = 0;
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (keys.has('ArrowLeft')) camYaw += 2 * dt;
  if (keys.has('ArrowRight')) camYaw -= 2 * dt;
  acc += dt;
  while (acc >= 1 / TICK_HZ) {
    acc -= 1 / TICK_HZ;
    if (!sim.over) {
      sim.step(readInput());
      for (const e of sim.drainEvents()) onEvent(e.name, e.data);
    }
  }
  for (let i = pulses.length - 1; i >= 0; i--) {
    const pl = pulses[i];
    pl.age += dt;
    const k = pl.age / 0.45;
    pl.mesh.scale.setScalar(1 + k * (T.pulse_radius - 1));
    (pl.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    if (k >= 1) { scene.remove(pl.mesh); pulses.splice(i, 1); }
  }
  if ((toastTimer -= dt) <= 0) toast.textContent = '';
  sync(now / 1000);
  renderer.render(scene, camera);
});
