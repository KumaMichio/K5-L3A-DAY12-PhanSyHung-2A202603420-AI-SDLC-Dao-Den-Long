/** Browser client: renders the shared deterministic Sim with Three.js. All gameplay rules live in src/sim. */
import * as THREE from 'three';
import contract from '../../game.contract.json' with { type: 'json' };
import { ISLAND_RADIUS, Sim, TICK_HZ } from '../sim/sim.js';
import type { InputState, Tuning } from '../sim/types.js';
import { GreatLanternModel, MayModel, MoteModel, ShadeModel } from './models.js';

const T = contract.tuning as Tuning;
const WARM = 0xffa940;

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

// ------------------------------------------------------------------ models
const may = new MayModel();
scene.add(may.root);
const dynamic = new THREE.Group();
scene.add(dynamic);
let lanternModels: GreatLanternModel[] = [];
const moteModels = new Map<string, MoteModel>();
const shadeModels = new Map<string, ShadeModel>();
const pulses: { mesh: THREE.Mesh; age: number }[] = [];

// ------------------------------------------------------------------ game state
let sim: Sim;

function newGame(): void {
  sim = new Sim(T, (Math.random() * 2 ** 31) | 0);
  dynamic.clear();
  moteModels.clear();
  shadeModels.clear();
  may.reset(sim.player.pos);
  lanternModels = sim.lanterns.map((l) => {
    const m = new GreatLanternModel(l.pos);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(T.safe_radius - 0.08, T.safe_radius, 48),
      new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.18 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(l.pos[0], 0.02, l.pos[2]);
    dynamic.add(m.root, ring);
    return m;
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
    ring.position.set(sim.player.pos[0], 0.3, sim.player.pos[2]);
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
let moteSeed = 0;
function sync(dt: number, time: number): void {
  const p = sim.player;
  may.update(dt, time, p.pos, p.carried, p.invulnTicks === 0 || Math.floor(time * 12) % 2 === 0);

  const seenMotes = new Set<string>();
  for (const m of sim.motes) {
    seenMotes.add(m.id);
    let model = moteModels.get(m.id);
    if (!model) { model = new MoteModel(moteSeed++ * 1.37); moteModels.set(m.id, model); dynamic.add(model.root); }
    model.update(time, m.pos);
  }
  for (const [id, model] of moteModels) if (!seenMotes.has(id)) { dynamic.remove(model.root); moteModels.delete(id); }

  for (const s of sim.shades) {
    let model = shadeModels.get(s.id);
    if (!model) { model = new ShadeModel(shadeModels.size * 2.1); shadeModels.set(s.id, model); dynamic.add(model.root); }
    model.update(time, s.pos, s.state, p.pos);
  }

  let lit = 0;
  sim.lanterns.forEach((l, i) => {
    lanternModels[i].update(time, l.lit, l.lit ? 1 : l.deposited / T.lantern_cost);
    if (l.lit) lit++;
  });
  ambient.intensity = 0.35 + 0.18 * lit; // island brightens as lanterns are lit

  const yaw = camYaw;
  camera.position.set(p.pos[0] - Math.sin(yaw) * 7.5, p.pos[1] + 4, p.pos[2] - Math.cos(yaw) * 7.5);
  camera.lookAt(p.pos[0], p.pos[1] + 1.3, p.pos[2]);

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
  sync(dt, now / 1000);
  renderer.render(scene, camera);
});
