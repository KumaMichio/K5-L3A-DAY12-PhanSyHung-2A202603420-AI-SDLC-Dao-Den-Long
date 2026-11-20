/**
 * Browser client. All gameplay rules live in src/sim (shared with headless); this file is the
 * game flow (menu -> night intro -> play -> result -> next night -> dawn), input, camera, HUD and sound.
 */
import * as THREE from 'three';
import contract from '../../game.contract.json' with { type: 'json' };
import { NIGHTS } from '../sim/maps.js';
import { Sim, TICK_HZ, distXZ } from '../sim/sim.js';
import type { InputState, Tuning, Vec3 } from '../sim/types.js';
import { Audio } from './audio.js';
import { CharmModel, DrifterModel, GreatLanternModel, MayModel, MoteModel, ShadeModel } from './models.js';
import { FOG, SKY, WindLeaves, buildWorld } from './world.js';

const T = contract.tuning as Tuning;
const $ = (id: string) => document.getElementById(id)!;

// ------------------------------------------------------------------ settings (saved between sessions)
interface Settings { volume: number; sensitivity: number }
function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem('ddl-settings') ?? '{}');
    return { volume: typeof s.volume === 'number' ? s.volume : 0.7, sensitivity: typeof s.sensitivity === 'number' ? s.sensitivity : 1 };
  } catch {
    return { volume: 0.7, sensitivity: 1 };
  }
}
const settings = loadSettings();
function saveSettings(): void {
  try { localStorage.setItem('ddl-settings', JSON.stringify(settings)); } catch { /* private mode: keep in memory */ }
}
const audio = new Audio();
audio.setVolume(settings.volume);

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(FOG, 22, 90);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
const ambient = new THREE.HemisphereLight(0x8a9ad8, 0x1b2350, 0.15);
const moon = new THREE.DirectionalLight(0x9aa8ff, 0.3);
moon.position.set(-20, 40, 10);
scene.add(ambient, moon);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ per-night view state
const may = new MayModel();
scene.add(may.root);
const leaves = new WindLeaves();
scene.add(leaves.root);
let world = new THREE.Group();
let dynamic = new THREE.Group();
scene.add(world, dynamic);
let lanterns: GreatLanternModel[] = [];
let charms: CharmModel[] = [];
const motes = new Map<string, MoteModel>();
const shades = new Map<string, ShadeModel>();
const drifters = new Map<string, DrifterModel>();
const pulses: { mesh: THREE.Mesh; age: number }[] = [];

type Mode = 'menu' | 'intro' | 'playing' | 'paused' | 'settings' | 'result' | 'dawn';
let mode: Mode = 'menu';
let sim: Sim;
let night: 1 | 2 | 3 = 1;
let totalScore = 0;
const nightScores: Record<number, number> = {};

const INTRO: Record<1 | 2 | 3, string> = {
  1: 'Mây à, sương đen đã nuốt Đảo Bến. Gom đom đóm, thắp lại năm ngọn đèn trước khi trời sáng. Nhớ: Bóng Mực sợ những ngọn đèn đã sáng.',
  2: 'Hai hòn Đảo Cau nối nhau bằng cây cầu tre. Bục nhảy sẽ đưa con bay qua biển mây. Coi chừng Gió Lạc, nó hay giật đom đóm của người mang nhiều.',
  3: 'Đảo Chuông có ba tầng, ngọn đèn cao nhất nằm cạnh tháp chuông. Gió mạnh thổi từng cơn; khi thấy lá bay, hãy đứng cho vững.',
};

function startNight(n: 1 | 2 | 3): void {
  night = n;
  sim = new Sim(T, (Math.random() * 2 ** 31) | 0, n);
  scene.remove(world, dynamic);
  world = buildWorld(sim.map);
  dynamic = new THREE.Group();
  scene.add(world, dynamic);
  motes.clear();
  shades.clear();
  drifters.clear();
  may.reset(sim.player.pos);
  lanterns = sim.lanterns.map((l) => {
    const m = new GreatLanternModel(l.pos);
    const ring = new THREE.Mesh(new THREE.RingGeometry(T.safe_radius - 0.08, T.safe_radius, 48), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(l.pos[0], l.pos[1] + 0.03, l.pos[2]);
    m.root.userData.ring = ring;
    dynamic.add(m.root, ring);
    return m;
  });
  charms = sim.charms.map((c) => {
    const m = new CharmModel(c.pos);
    dynamic.add(m.root);
    return m;
  });
  camYaw = 0;
  lastSecond = -1;
  fpsFrames = 0;
  fpsTime = 0;
  showIntro();
}

// ------------------------------------------------------------------ screens
function screen(html: string | null): void {
  const s = $('screen');
  s.classList.toggle('hidden', html === null);
  if (html !== null) {
    s.innerHTML = `<div class="card">${html}</div>`;
    s.querySelector('button')?.focus();
  }
  $('hud').classList.toggle('hidden', !(mode === 'playing' || mode === 'paused' || mode === 'settings' || mode === 'result'));
}
function on(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener('click', () => { audio.start(); fn(); });
}

function showMenu(): void {
  mode = 'menu';
  audio.setMusic(true);
  screen(`<h1>Đảo Đèn Lồng</h1><h2>Ba đêm, mười tám ngọn đèn</h2>
    <button id="b-start">Bắt đầu</button>
    <button id="b-n2">Chơi Đêm 2</button><button id="b-n3">Chơi Đêm 3</button>
    <button id="b-set">Cài đặt</button>
    <div class="keys">WASD đi · chuột kéo / ←→ xoay camera · Space nhảy · Shift lướt · E nạp đèn · F tỏa sáng · Esc/P tạm dừng</div>`);
  on('b-start', () => { totalScore = 0; startNight(1); });
  on('b-n2', () => { totalScore = 0; startNight(2); });
  on('b-n3', () => { totalScore = 0; startNight(3); });
  on('b-set', () => showSettings(showMenu));
}

function showIntro(): void {
  mode = 'intro';
  screen(`<h2>Đêm ${night}</h2><h1>${NIGHTS[night].name}</h1>
    <p class="quote">Ông Đăng: “${INTRO[night]}”</p>
    <p>Thắp ${sim.lanterns.length} đèn · ${Math.round(sim.timeLeft)} giây trước bình minh</p>
    <button id="b-go">Vào đêm</button>`);
  on('b-go', () => { mode = 'playing'; screen(null); });
}

function showPause(): void {
  mode = 'paused';
  audio.setMusic(false);
  screen(`<h1>Tạm dừng</h1>
    <button id="b-resume">Tiếp tục</button><button id="b-retry">Chơi lại Đêm</button>
    <button id="b-set">Cài đặt</button><button id="b-menu">Về menu</button>`);
  on('b-resume', resume);
  on('b-retry', () => startNight(night));
  on('b-set', () => showSettings(showPause));
  on('b-menu', showMenu);
}
function resume(): void {
  mode = 'playing';
  audio.setMusic(true);
  screen(null);
  last = performance.now();
}

function showSettings(back: () => void): void {
  const prev = mode;
  mode = 'settings';
  screen(`<h1>Cài đặt</h1>
    <label>Âm lượng <input id="s-vol" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label>
    <label>Độ nhạy chuột <input id="s-sens" type="range" min="0.2" max="3" step="0.1" value="${settings.sensitivity}"></label>
    <button id="b-back">Quay lại</button>`);
  ($('s-vol') as HTMLInputElement).oninput = (e) => { settings.volume = Number((e.target as HTMLInputElement).value); audio.setVolume(settings.volume); saveSettings(); };
  ($('s-sens') as HTMLInputElement).oninput = (e) => { settings.sensitivity = Number((e.target as HTMLInputElement).value); saveSettings(); };
  on('b-back', () => { mode = prev === 'settings' ? 'menu' : prev; back(); });
}

function showResult(won: boolean, reason: string): void {
  mode = 'result';
  if (won) {
    nightScores[night] = sim.score;
    totalScore += sim.score;
  }
  const why = { all_lit: 'Mọi Đèn Lồng Lớn đã sáng', dawn: 'Trời đã sáng mà đảo vẫn tối', no_flames: 'Mây đã hết lửa' }[reason] ?? '';
  if (won && night === 3) return showDawn();
  screen(won
    ? `<h1>Đêm ${night} hoàn thành!</h1><p>${why}</p><p>Điểm đêm này: <span class="score">${sim.score}</span></p><p>Tổng điểm: <b>${totalScore}</b></p>
       <button id="b-next">Sang Đêm ${night + 1}</button><button id="b-menu">Về menu</button>`
    : `<h1>Đêm vẫn còn tối…</h1><p>${why}</p><p>Điểm: ${sim.score} (không tính vào tổng)</p>
       <button id="b-retry">Chơi lại Đêm ${night}</button><button id="b-menu">Về menu</button>`);
  on('b-next', () => startNight((night + 1) as 2 | 3));
  on('b-retry', () => startNight(night));
  on('b-menu', showMenu);
}

function showDawn(): void {
  mode = 'dawn';
  scene.background = new THREE.Color(0xf2c1a0);
  screen(`<h1>Bình Minh</h1><p class="quote">Ông Đăng: “Ba hòn đảo đã sáng trở lại. Cảm ơn con, Mây.”</p>
    <p>Đêm 1: ${nightScores[1] ?? 0} · Đêm 2: ${nightScores[2] ?? 0} · Đêm 3: ${nightScores[3] ?? 0}</p>
    <p>Tổng điểm: <span class="score">${totalScore}</span></p><button id="b-menu">Về menu</button>`);
  on('b-menu', () => { scene.background = new THREE.Color(SKY); showMenu(); });
}

// ------------------------------------------------------------------ input
const keys = new Set<string>();
let camYaw = 0;
let dragging = false;
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
    if (mode === 'playing') showPause();
    else if (mode === 'paused') resume();
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (mode === 'playing') showPause(); });
renderer.domElement.addEventListener('pointerdown', () => (dragging = true));
addEventListener('pointerup', () => (dragging = false));
addEventListener('pointermove', (e) => { if (dragging && mode === 'playing') camYaw -= e.movementX * 0.005 * settings.sensitivity; });

function readInput(): InputState {
  // camera looks along (sinθ, 0, cosθ); screen-right is world (-cosθ, 0, sinθ) = move x = -1
  const z = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const x = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  return {
    move: [x, z],
    cam_yaw_deg: (camYaw * 180) / Math.PI,
    jump: keys.has('Space'),
    interact: keys.has('KeyE'),
    pulse: keys.has('KeyF'),
    dash: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    pause: false, // the browser pauses by not stepping the sim (logic fully stopped)
  };
}

// ------------------------------------------------------------------ events -> sound / effects
let toastTimer = 0;
function say(text: string): void { $('toast').textContent = text; toastTimer = 2.4; }

function onEvent(name: string, data: Record<string, unknown>): void {
  switch (name) {
    case 'mote_picked': audio.play('pickup'); break;
    case 'lantern_lit': audio.play('lit'); say(`Đèn ${data.lantern_id} đã sáng!`); break;
    case 'dash': audio.play('dash'); break;
    case 'charm_picked': audio.play('charm'); say('Bùa Gió! Chạy nhanh hơn, lướt không cần chờ'); break;
    case 'drifter_steal': audio.play('steal'); say(`Gió Lạc giật mất ${data.amount} đom đóm! Tỏa sáng để lấy lại`); break;
    case 'drifter_drop': audio.play('pickup'); break;
    case 'shade_spawned': audio.play('shade'); break;
    case 'player_hit': audio.play('hit'); say(data.by === 'fall' ? 'Mây rơi khỏi đảo! Mất một ngọn lửa' : 'Bóng Mực chạm vào Mây! Mất một ngọn lửa'); break;
    case 'pulse': {
      audio.play('pulse');
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sim.player.pos[0], sim.player.pos[1] + 0.8, sim.player.pos[2]);
      scene.add(ring);
      pulses.push({ mesh: ring, age: 0 });
      break;
    }
    case 'game_over': {
      const won = data.result === 'won';
      audio.play(won ? 'win' : 'lose');
      setTimeout(() => showResult(won, data.reason as string), 900);
      break;
    }
  }
}

// ------------------------------------------------------------------ HUD
const barCells: HTMLDivElement[] = [];
for (let i = 0; i < T.carry_capacity; i++) {
  const c = document.createElement('div');
  c.className = 'cell';
  $('bar').appendChild(c);
  barCells.push(c);
}
let lastSecond = -1;
let wasWarning = false;

function setCd(id: string, remaining: number, total: number): void {
  const el = $(id);
  const p = total > 0 ? 100 * (1 - remaining / total) : 100;
  el.style.setProperty('--p', `${p}%`);
  el.classList.toggle('cooling', remaining > 0);
}

function updateHud(): void {
  const p = sim.player;
  $('flames').innerHTML = Array.from({ length: T.flames }, (_, i) => (i < p.flames ? '🔥' : '<span class="off">●</span>')).join('');
  const secs = Math.ceil(sim.timeLeft);
  const clock = $('clock');
  clock.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  clock.classList.toggle('danger', secs <= 30);
  if (secs !== lastSecond) {
    if (secs <= 10 && secs > 0 && lastSecond !== -1 && mode === 'playing') audio.play('tick');
    lastSecond = secs;
  }
  const lit = sim.lanterns.filter((l) => l.lit).length;
  $('topright').innerHTML = `Đèn <b>${lit}/${sim.lanterns.length}</b><br>Điểm <b>${sim.score}</b>${totalScore ? `<br><small>Tổng ${totalScore}</small>` : ''}`;
  barCells.forEach((c, i) => c.classList.toggle('on', i < p.carried));
  setCd('cd-dash', p.charm > 0 ? 0 : p.dashCd, Math.round(T.dash_cooldown_s * TICK_HZ));
  setCd('cd-pulse', p.pulseCd, Math.round(T.pulse_cooldown_s * TICK_HZ));

  // nearest unlit lantern: interact prompt + off-screen arrow
  let nearest: { id: string; pos: Vec3; deposited: number } | null = null;
  let nd = Infinity;
  for (const l of sim.lanterns) {
    if (l.lit) continue;
    const d = distXZ(l.pos, p.pos);
    if (d < nd) { nd = d; nearest = l; }
  }
  const prompt = $('prompt');
  if (nearest && nd <= T.interact_radius) {
    prompt.textContent = `E — Nạp ánh sáng (${nearest.deposited}/${T.lantern_cost})`;
    prompt.classList.remove('hidden');
  } else prompt.classList.add('hidden');

  const arrow = $('arrow');
  arrow.classList.add('hidden');
  if (nearest) {
    const v = new THREE.Vector3(nearest.pos[0], nearest.pos[1] + 3, nearest.pos[2]).project(camera);
    const behind = v.z > 1;
    if (behind || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) {
      let dx = behind ? -v.x : v.x;
      let dy = behind ? v.y : -v.y; // screen y grows downwards
      if (Math.hypot(dx, dy) < 1e-3) { dx = 0; dy = 1; }
      const hw = innerWidth / 2 - 40;
      const hh = innerHeight / 2 - 50;
      const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
      arrow.style.left = `${innerWidth / 2 + dx * k - 14}px`;
      arrow.style.top = `${innerHeight / 2 + dy * k - 15}px`;
      arrow.style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
      arrow.classList.remove('hidden');
    }
  }
  const warn = sim.windWarning;
  $('windwarn').classList.toggle('hidden', !(warn || sim.wind.active));
  $('windwarn').textContent = sim.wind.active ? '🍃 Gió mạnh!' : '🍃 Gió sắp nổi…';
  if (warn && !wasWarning) audio.play('wind');
  wasWarning = warn;
}

// ------------------------------------------------------------------ sync models with the sim
let moteSeed = 0;
function sync(dt: number, t: number): void {
  const p = sim.player;
  may.update(dt, t, p.pos, p.carried, p.respawnWait === 0 && (p.invuln === 0 || Math.floor(t * 12) % 2 === 0));

  const seen = new Set<string>();
  for (const m of sim.motes) {
    seen.add(m.id);
    let model = motes.get(m.id);
    if (!model) { model = new MoteModel(moteSeed++ * 1.37); motes.set(m.id, model); dynamic.add(model.root); }
    model.update(t, m.pos);
    model.root.position.y += m.pos[1];
  }
  for (const [id, model] of motes) if (!seen.has(id)) { dynamic.remove(model.root); motes.delete(id); }

  for (const s of sim.shades) {
    let model = shades.get(s.id);
    if (!model) { model = new ShadeModel(shades.size * 2.1); shades.set(s.id, model); dynamic.add(model.root); }
    model.update(t, s.pos, s.state, p.pos);
    model.root.scale.setScalar(s.state === 'spawning' ? 0.4 + 0.6 * (1 - s.ticks / 30) : 1);
  }
  for (const d of sim.drifters) {
    let model = drifters.get(d.id);
    if (!model) { model = new DrifterModel(); drifters.set(d.id, model); dynamic.add(model.root); }
    model.update(t, d.pos, d.state, d.stolen, p.pos);
  }
  sim.charms.forEach((c, i) => charms[i]?.update(t, c.available));

  let lit = 0;
  sim.lanterns.forEach((l, i) => {
    lanterns[i].update(t, l.lit, l.lit ? 1 : l.deposited / T.lantern_cost);
    ((lanterns[i].root.userData.ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = l.lit ? 0.35 : 0;
    if (l.lit) lit++;
  });
  ambient.intensity = 0.15 + 0.55 * (lit / sim.lanterns.length); // Ticket-02 formula

  leaves.update(t, p.pos, sim.windWarning || sim.wind.active, sim.wind.dirDeg, sim.wind.active);

  const camY = p.respawnWait > 0 ? sim.map.start[1] : p.pos[1];
  camera.position.set(p.pos[0] - Math.sin(camYaw) * 8, camY + 4.5, p.pos[2] - Math.cos(camYaw) * 8);
  camera.lookAt(p.pos[0], camY + 1.3, p.pos[2]);
}

// ------------------------------------------------------------------ main loop (fixed 60 Hz sim)
let acc = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let wasGrounded = true;
startNight(1);
showMenu();

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (mode === 'playing') {
    if (keys.has('ArrowLeft')) camYaw += 2 * dt * settings.sensitivity;
    if (keys.has('ArrowRight')) camYaw -= 2 * dt * settings.sensitivity;
    acc += dt;
    while (acc >= 1 / TICK_HZ) {
      acc -= 1 / TICK_HZ;
      if (sim.over) break;
      sim.step(readInput());
      for (const e of sim.drainEvents()) onEvent(e.name, e.data);
      const g = sim.player.grounded;
      if (wasGrounded && !g && sim.player.vel[1] > 6 && sim.player.vel[1] <= 7) audio.play('jump');
      wasGrounded = g;
    }
  } else acc = 0;
  for (let i = pulses.length - 1; i >= 0; i--) {
    const pl = pulses[i];
    pl.age += dt;
    const k = pl.age / 0.45;
    pl.mesh.scale.setScalar(1 + k * (T.pulse_radius - 1));
    (pl.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    if (k >= 1) { scene.remove(pl.mesh); pulses.splice(i, 1); }
  }
  if ((toastTimer -= dt) <= 0) $('toast').textContent = '';
  sync(dt, t);
  if (mode !== 'menu' && mode !== 'intro' && mode !== 'dawn') updateHud();
  renderer.render(scene, camera);

  // FPS: rolling average over the current night (evidence for the >= 30 FPS requirement)
  if (mode === 'playing') {
    fpsFrames++;
    fpsTime += dt;
    $('fps').textContent = `FPS ${(fpsFrames / Math.max(fpsTime, 1e-3)).toFixed(0)} · ${renderer.domElement.width}×${renderer.domElement.height}`;
  }
});
