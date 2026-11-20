/**
 * Browser client. All gameplay rules live in src/sim (shared with headless); this file is the
 * game flow (menu -> night intro -> play -> result -> next night -> dawn -> leaderboard), input,
 * camera, HUD, accessibility and sound. `?bench` runs the Ticket-04 benchmark scene instead.
 */
import * as THREE from 'three';
import contract from '../../game.contract.json' with { type: 'json' };
import { addEntry, isoWithOffset, rank, validName, type LeaderboardEntry } from '../shared/leaderboard.js';
import { makeBenchSim } from '../sim/bench.js';
import { NIGHTS } from '../sim/maps.js';
import { Sim, TICK_HZ, distXZ } from '../sim/sim.js';
import type { InputState, Tuning, Vec3 } from '../sim/types.js';
import { Audio } from './audio.js';
import { CharmModel, DrifterModel, GreatLanternModel, MayModel, MoteSwarm, ShadeCrowd, display } from './models.js';
import { FOG, SKY, WindLeaves, buildWorld } from './world.js';

const T = contract.tuning as Tuning;
const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const BENCH = params.has('bench');

// ------------------------------------------------------------------ settings (saved between sessions)
type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'dash' | 'interact' | 'pulse' | 'pause';
const ACTIONS: { id: Action; label: string }[] = [
  { id: 'forward', label: 'Đi tới' }, { id: 'back', label: 'Đi lùi' }, { id: 'left', label: 'Sang trái' }, { id: 'right', label: 'Sang phải' },
  { id: 'jump', label: 'Nhảy' }, { id: 'dash', label: 'Lướt' }, { id: 'interact', label: 'Tương tác' }, { id: 'pulse', label: 'Tỏa sáng' }, { id: 'pause', label: 'Tạm dừng' },
];
const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', dash: 'ShiftLeft', interact: 'KeyE', pulse: 'KeyF', pause: 'KeyP',
};
interface Settings { volume: number; sensitivity: number; colorblind: boolean; reducedMotion: boolean; largeText: boolean; keys: Record<Action, string> }
function loadSettings(): Settings {
  const def: Settings = { volume: 0.7, sensitivity: 1, colorblind: false, reducedMotion: false, largeText: false, keys: { ...DEFAULT_KEYS } };
  try {
    const s = JSON.parse(localStorage.getItem('ddl-settings') ?? '{}');
    return {
      volume: typeof s.volume === 'number' ? s.volume : def.volume,
      sensitivity: typeof s.sensitivity === 'number' ? s.sensitivity : def.sensitivity,
      colorblind: s.colorblind === true,
      reducedMotion: s.reducedMotion === true,
      largeText: s.largeText === true,
      keys: { ...DEFAULT_KEYS, ...(typeof s.keys === 'object' && s.keys ? s.keys : {}) },
    };
  } catch {
    return def;
  }
}
const settings = loadSettings();
function applyDisplay(): void {
  display.colorblind = settings.colorblind;
  document.body.classList.toggle('cb', settings.colorblind);
  document.body.classList.toggle('rm', settings.reducedMotion);
  document.documentElement.classList.toggle('large', settings.largeText);
}
applyDisplay();
function saveSettings(): void {
  try { localStorage.setItem('ddl-settings', JSON.stringify(settings)); } catch { /* private mode: keep in memory */ }
}
const keyName = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Shift trái').replace('ShiftRight', 'Shift phải').replace('Space', 'Space');
const audio = new Audio();
audio.setVolume(settings.volume);

// ------------------------------------------------------------------ renderer / scene
// MSAA off by default (?aa=1 turns it on): same in play and bench; costly fill-rate on integrated GPUs
const renderer = new THREE.WebGLRenderer({ antialias: params.get('aa') === '1', powerPreference: 'high-performance' });
renderer.setPixelRatio(BENCH ? 1 : Math.min(devicePixelRatio, 2));
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
const swarm = new MoteSwarm(256); // all fireflies: instanced (bench has 100)
const crowd = new ShadeCrowd(256); // all Ink Shades: instanced (bench has 200)
scene.add(swarm.root, crowd.root);
const drifters = new Map<string, DrifterModel>();
const pulses: { mesh: THREE.Mesh; age: number }[] = [];

type Mode = 'menu' | 'intro' | 'playing' | 'paused' | 'settings' | 'result' | 'dawn' | 'board' | 'bench';
let mode: Mode = 'menu';
let sim: Sim;
let night: 1 | 2 | 3 = 1;
let totalScore = 0;
let sessionSeed = 0;
const nightScores: Record<number, number> = {};

const INTRO: Record<1 | 2 | 3, string> = {
  1: 'Mây à, sương đen đã nuốt Đảo Bến. Gom đom đóm, thắp lại các ngọn đèn và giữ chúng sáng tới bình minh. Nhớ: Bóng Mực sợ những ngọn đèn còn nhiều dầu.',
  2: 'Hai hòn Đảo Cau nối nhau bằng cây cầu tre. Bục nhảy sẽ đưa con bay qua biển mây. Coi chừng Gió Lạc, nó hay giật đom đóm của người mang nhiều.',
  3: 'Đảo Chuông có ba tầng, ngọn đèn cao nhất nằm cạnh tháp chuông. Gió mạnh thổi từng cơn; khi thấy lá bay, hãy đứng cho vững.',
};

function loadWorld(s: Sim): void {
  sim = s;
  scene.remove(world, dynamic);
  world = buildWorld(sim.map);
  dynamic = new THREE.Group();
  scene.add(world, dynamic);
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
}

function startNight(n: 1 | 2 | 3): void {
  night = n;
  loadWorld(new Sim(T, (sessionSeed + n) | 0, n));
  camYaw = 0;
  lastSecond = -1;
  fpsFrames = 0;
  fpsTime = 0;
  lowWarned.clear();
  showIntro();
}

function newSession(first: 1 | 2 | 3): void {
  totalScore = 0;
  for (const k of [1, 2, 3]) delete nightScores[k];
  sessionSeed = (Math.random() * 2 ** 31) | 0;
  startNight(first);
}

// ------------------------------------------------------------------ leaderboard (disk via the launcher API; localStorage when served statically)
async function loadBoard(): Promise<LeaderboardEntry[]> {
  try {
    const r = await fetch('api/leaderboard');
    if (r.ok) return (await r.json()).entries as LeaderboardEntry[];
  } catch { /* static hosting */ }
  try { return rank(JSON.parse(localStorage.getItem('ddl-leaderboard') ?? '[]')); } catch { return []; }
}
async function saveEntry(e: LeaderboardEntry): Promise<LeaderboardEntry[]> {
  try {
    const r = await fetch('api/leaderboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
    if (r.ok) return (await r.json()).entries as LeaderboardEntry[];
  } catch { /* static hosting */ }
  const list = addEntry(await loadBoard(), e);
  try { localStorage.setItem('ddl-leaderboard', JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function showBoard(highlight?: LeaderboardEntry): Promise<void> {
  mode = 'board';
  const list = await loadBoard();
  const rows = list.map((e, i) => {
    const me = highlight && e.name === highlight.name && e.achieved_at === highlight.achieved_at;
    return `<tr class="${me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(e.name)}</td><td>${e.score}</td><td>${e.nights_won}/3</td><td>${e.achieved_at.slice(0, 16).replace('T', ' ')}</td></tr>`;
  }).join('');
  screen(`<h1>Bảng xếp hạng</h1>
    ${list.length ? `<table><tr><th>#</th><th>Tên</th><th>Điểm</th><th>Đêm thắng</th><th>Thời gian</th></tr>${rows}</table>` : '<p>Chưa có ai. Hãy là người đầu tiên!</p>'}
    <button id="b-menu">Về menu</button>`);
  on('b-menu', showMenu);
}

function showNameEntry(after: string): void {
  mode = 'board';
  const won = Object.keys(nightScores).length;
  screen(`<h1>Lưu điểm</h1>${after}<p>Tổng điểm: <span class="score">${totalScore}</span> · Đêm thắng: ${won}/3</p>
    <label>Tên (3–12 ký tự: chữ, số, _ ; có thể gõ tiếng Việt) <input id="n-name" maxlength="12" autocomplete="off"></label>
    <p id="n-err" class="warn" role="alert"></p>
    <button id="b-save">Lưu vào bảng xếp hạng</button><button id="b-skip">Bỏ qua</button>`);
  const input = $('n-name') as HTMLInputElement;
  input.focus();
  const submit = async () => {
    const name = input.value.trim().normalize('NFC');
    if (!validName(name)) { $('n-err').textContent = '⚠ Tên cần 3–12 ký tự: chữ, số hoặc _'; return; }
    const entry: LeaderboardEntry = { name, score: totalScore, nights_won: won, achieved_at: isoWithOffset(new Date()), seed: sessionSeed };
    await saveEntry(entry);
    void showBoard(entry);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void submit(); });
  on('b-save', () => void submit());
  on('b-skip', showMenu);
}

// ------------------------------------------------------------------ screens
function screen(html: string | null): void {
  const s = $('screen');
  s.classList.toggle('hidden', html === null);
  if (html !== null) {
    s.innerHTML = `<div class="card">${html}</div>`;
    (s.querySelector('input, button') as HTMLElement | null)?.focus();
  }
  $('hud').classList.toggle('hidden', !(mode === 'playing' || mode === 'paused' || mode === 'settings' || mode === 'result'));
}
function on(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener('click', () => { audio.start(); fn(); });
}

function showMenu(): void {
  mode = 'menu';
  scene.background = new THREE.Color(SKY);
  audio.setMusic(true);
  const k = settings.keys;
  screen(`<h1>Đảo Đèn Lồng</h1><h2>Giữ đảo sáng tới bình minh</h2>
    <button id="b-start">Bắt đầu</button>
    <button id="b-n2">Chơi Đêm 2</button><button id="b-n3">Chơi Đêm 3</button>
    <button id="b-board">Bảng xếp hạng</button>
    <button id="b-set">Cài đặt</button>
    <div class="keys">${keyName(k.forward)}${keyName(k.left)}${keyName(k.back)}${keyName(k.right)} đi · kéo chuột / ←→ xoay camera · ${keyName(k.jump)} nhảy · ${keyName(k.dash)} lướt · ${keyName(k.interact)} nạp/châm dầu · ${keyName(k.pulse)} tỏa sáng · Esc/${keyName(k.pause)} tạm dừng</div>`);
  on('b-start', () => newSession(1));
  on('b-n2', () => newSession(2));
  on('b-n3', () => newSession(3));
  on('b-board', () => void showBoard());
  on('b-set', () => showSettings(showMenu));
}

function showIntro(): void {
  mode = 'intro';
  screen(`<h2>Đêm ${night}</h2><h1>${NIGHTS[night].name}</h1>
    <p class="quote">Ông Đăng: “${INTRO[night]}”</p>
    <p>Giữ ít nhất <b>${sim.litNeeded}/${sim.lanterns.length}</b> đèn sáng tới bình minh (${Math.round(sim.timeLeft)} giây). Đèn cạn dầu sẽ tắt; nạp đom đóm để châm dầu.</p>
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

let rebinding: Action | null = null;
function showSettings(back: () => void, note = ''): void {
  const prev = mode === 'settings' ? settingsBack : mode;
  settingsBack = prev;
  mode = 'settings';
  const rows = ACTIONS.map((a) => `<label>${a.label} <button class="key" id="k-${a.id}">${rebinding === a.id ? 'Nhấn phím…' : keyName(settings.keys[a.id])}</button></label>`).join('');
  screen(`<h1>Cài đặt</h1>
    <label>Âm lượng <input id="s-vol" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label>
    <label>Độ nhạy chuột <input id="s-sens" type="range" min="0.2" max="3" step="0.1" value="${settings.sensitivity}"></label>
    <label>Bảng màu dễ phân biệt <input id="s-cb" type="checkbox" ${settings.colorblind ? 'checked' : ''}></label>
    <label>Giảm chuyển động (tắt rung camera, chớp màn hình) <input id="s-rm" type="checkbox" ${settings.reducedMotion ? 'checked' : ''}></label>
    <label>Chữ lớn (×1.25) <input id="s-lg" type="checkbox" ${settings.largeText ? 'checked' : ''}></label>
    <h2>Phím</h2>${rows}
    <p id="k-msg" class="warn" role="alert">${note}</p>
    <button id="b-reset">Khôi phục mặc định</button>
    <button id="b-back">Quay lại</button>`);
  ($('s-vol') as HTMLInputElement).oninput = (e) => { settings.volume = Number((e.target as HTMLInputElement).value); audio.setVolume(settings.volume); saveSettings(); };
  ($('s-sens') as HTMLInputElement).oninput = (e) => { settings.sensitivity = Number((e.target as HTMLInputElement).value); saveSettings(); };
  ($('s-cb') as HTMLInputElement).onchange = (e) => { settings.colorblind = (e.target as HTMLInputElement).checked; applyDisplay(); saveSettings(); };
  ($('s-rm') as HTMLInputElement).onchange = (e) => { settings.reducedMotion = (e.target as HTMLInputElement).checked; applyDisplay(); saveSettings(); };
  ($('s-lg') as HTMLInputElement).onchange = (e) => { settings.largeText = (e.target as HTMLInputElement).checked; applyDisplay(); saveSettings(); };
  for (const a of ACTIONS) on(`k-${a.id}`, () => { rebinding = a.id; showSettings(back); });
  on('b-reset', () => { settings.keys = { ...DEFAULT_KEYS }; rebinding = null; saveSettings(); showSettings(back, 'Đã khôi phục phím mặc định.'); });
  on('b-back', () => { rebinding = null; mode = settingsBack; back(); });
  settingsReturn = back;
}
let settingsBack: Mode = 'menu';
let settingsReturn: () => void = showMenu;

/** Rebinding: refuses a key that is already used and tells the player which action has it. */
function tryBind(code: string): void {
  const a = rebinding!;
  rebinding = null;
  if (code === 'Escape') { showSettings(settingsReturn, 'Đã hủy. (Esc luôn dùng để tạm dừng.)'); return; }
  const clash = ACTIONS.find((x) => x.id !== a && settings.keys[x.id] === code);
  if (clash) {
    showSettings(settingsReturn, `⚠ Phím ${keyName(code)} đang dùng cho "${clash.label}". Chọn phím khác.`);
    return;
  }
  settings.keys[a] = code;
  saveSettings();
  showSettings(settingsReturn, `Đã gán ${keyName(code)} cho "${ACTIONS.find((x) => x.id === a)!.label}".`);
}

function showResult(won: boolean, reason: string): void {
  mode = 'result';
  if (won) {
    nightScores[night] = sim.score;
    totalScore += sim.score;
  }
  const why = { dawn_survived: `Đảo còn sáng lúc bình minh (${sim.litCount}/${sim.lanterns.length} đèn)`, dawn: `Bình minh đến khi chỉ còn ${sim.litCount} đèn sáng (cần ${sim.litNeeded})`, no_flames: 'Mây đã hết lửa' }[reason] ?? '';
  if (won && night === 3) return showDawn();
  screen(won
    ? `<h1>Đêm ${night} hoàn thành!</h1><p>${why}</p><p>Điểm đêm này: <span class="score">${sim.score}</span></p><p>Tổng điểm: <b>${totalScore}</b></p>
       <button id="b-next">Sang Đêm ${night + 1}</button><button id="b-menu">Về menu</button>`
    : `<h1>Đêm vẫn còn tối…</h1><p>${why}</p><p>Điểm đêm này: ${sim.score} (không tính vào tổng) · Tổng: ${totalScore}</p>
       <button id="b-save">Lưu điểm vào bảng xếp hạng</button>
       <button id="b-retry">Chơi lại Đêm ${night}</button><button id="b-menu">Về menu</button>`);
  on('b-next', () => startNight((night + 1) as 2 | 3));
  on('b-retry', () => startNight(night));
  on('b-save', () => showNameEntry(`<p>Thua ở Đêm ${night}.</p>`));
  on('b-menu', showMenu);
}

function showDawn(): void {
  mode = 'dawn';
  scene.background = new THREE.Color(0xf2c1a0);
  screen(`<h1>Bình Minh</h1><p class="quote">Ông Đăng: “Ba hòn đảo đã sáng trở lại. Cảm ơn con, Mây.”</p>
    <p>Đêm 1: ${nightScores[1] ?? 0} · Đêm 2: ${nightScores[2] ?? 0} · Đêm 3: ${nightScores[3] ?? 0}</p>
    <p>Tổng điểm: <span class="score">${totalScore}</span></p><button id="b-save">Lưu điểm</button><button id="b-menu">Về menu</button>`);
  on('b-save', () => showNameEntry('<p>Bình minh đã lên trên cả ba hòn đảo.</p>'));
  on('b-menu', showMenu);
}

// ------------------------------------------------------------------ input
const keys = new Set<string>();
let camYaw = 0;
let dragging = false;
addEventListener('keydown', (e) => {
  if (rebinding) { e.preventDefault(); tryBind(e.code); return; }
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if ((e.code === 'Escape' || e.code === settings.keys.pause) && !e.repeat) {
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
  const k = settings.keys;
  const down = (a: Action) => keys.has(k[a]) || (a === 'dash' && k.dash === 'ShiftLeft' && keys.has('ShiftRight'));
  const z = (down('forward') ? 1 : 0) - (down('back') ? 1 : 0);
  const x = (down('left') ? 1 : 0) - (down('right') ? 1 : 0);
  return {
    move: [x, z],
    cam_yaw_deg: (camYaw * 180) / Math.PI,
    jump: down('jump'),
    interact: down('interact'),
    pulse: down('pulse'),
    dash: down('dash'),
    pause: false, // the browser pauses by not stepping the sim (logic fully stopped)
  };
}

// ------------------------------------------------------------------ cues: subtitles, shade arrows, shake, flash
let toastTimer = 0;
function say(text: string): void { $('toast').textContent = text; toastTimer = 2.4; }
const subs: { text: string; until: number }[] = [];
function subtitle(text: string, secs = 3.5): void {
  subs.push({ text, until: performance.now() / 1000 + secs });
  if (subs.length > 4) subs.shift();
}
const spawnArrows: { pos: Vec3; until: number }[] = [];
let shake = 0;
function flash(): void {
  if (settings.reducedMotion) return;
  const f = $('flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}
const lowWarned = new Set<string>();

function onEvent(name: string, data: Record<string, unknown>): void {
  switch (name) {
    case 'mote_picked': audio.play('pickup'); break;
    case 'lantern_lit': audio.play('lit'); flash(); say(data.relight ? `Đèn ${data.lantern_id} sáng lại!` : `Đèn ${data.lantern_id} đã sáng!`); lowWarned.delete(data.lantern_id as string); break;
    case 'refuel': audio.play('charm'); say(`Châm dầu đèn ${data.lantern_id}: ${data.fuel}`); if ((data.fuel as number) >= T.low_fuel_threshold) lowWarned.delete(data.lantern_id as string); break;
    case 'lantern_out': audio.play('lose'); subtitle(`[Đèn ${data.lantern_id} tắt] Đèn đã cạn dầu`); break;
    case 'dash': audio.play('dash'); break;
    case 'charm_picked': audio.play('charm'); say('Bùa Gió! Chạy nhanh hơn, lướt không cần chờ'); break;
    case 'drifter_steal': audio.play('steal'); subtitle(`[Gió Lạc] Giật mất ${data.amount} đom đóm! Tỏa sáng để lấy lại`); break;
    case 'drifter_drop': audio.play('pickup'); break;
    case 'shade_spawned': {
      audio.play('shade');
      const s = sim.shades.find((x) => x.id === data.id);
      if (s) spawnArrows.push({ pos: [...s.pos], until: performance.now() / 1000 + 4 });
      subtitle('[Tiếng rít] ⚠ Bóng Mực xuất hiện — xem mũi tên tím ở mép màn hình');
      break;
    }
    case 'player_hit':
      audio.play('hit');
      if (!settings.reducedMotion) shake = 0.4;
      say(data.by === 'fall' ? 'Mây rơi khỏi đảo! Mất một ngọn lửa' : 'Bóng Mực chạm vào Mây! Mất một ngọn lửa');
      break;
    case 'pulse': {
      audio.play('pulse');
      flash();
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
function ensureCells(n: number): void {
  while (barCells.length < n) {
    const c = document.createElement('div');
    c.className = 'cell';
    $('bar').appendChild(c);
    barCells.push(c);
  }
  barCells.forEach((c, i) => c.classList.toggle('hidden', i >= n));
}
let lastSecond = -1;
let wasWarning = false;

function setCd(id: string, remaining: number, total: number): void {
  const el = $(id);
  const p = total > 0 ? 100 * (1 - remaining / total) : 100;
  el.style.setProperty('--p', `${p}%`);
  el.classList.toggle('cooling', remaining > 0);
}

/** Places an edge arrow pointing at a world position when it is off screen. Returns false if on screen. */
function edgeArrow(el: HTMLElement, pos: readonly number[]): boolean {
  const v = new THREE.Vector3(pos[0], pos[1] + 2, pos[2]).project(camera);
  const behind = v.z > 1;
  if (!behind && Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95) return false;
  let dx = behind ? -v.x : v.x;
  let dy = behind ? v.y : -v.y; // screen y grows downwards
  if (Math.hypot(dx, dy) < 1e-3) { dx = 0; dy = 1; }
  const hw = innerWidth / 2 - 40;
  const hh = innerHeight / 2 - 60;
  const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  el.style.left = `${innerWidth / 2 + dx * k - 14}px`;
  el.style.top = `${innerHeight / 2 + dy * k - 15}px`;
  el.style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
  return true;
}

function updateHud(): void {
  const p = sim.player;
  const now = performance.now() / 1000;
  $('flames').innerHTML = Array.from({ length: T.flames }, (_, i) => (i < p.flames ? '🔥' : '<span class="off">●</span>')).join('');
  const secs = Math.ceil(sim.timeLeft);
  const clock = $('clock');
  clock.textContent = `${secs <= 30 && settings.colorblind ? '⚠ ' : ''}${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  clock.classList.toggle('danger', secs <= 30);
  if (secs !== lastSecond) {
    if (secs <= 10 && secs > 0 && lastSecond !== -1 && mode === 'playing') {
      audio.play('tick');
      if (secs === 10) subtitle('[Chuông đếm ngược] ⚠ 10 giây cuối trước bình minh!', 4);
    }
    lastSecond = secs;
  }
  const lit = sim.litCount;
  const tooFew = lit < sim.litNeeded;
  $('topright').innerHTML = `Đèn <b class="${tooFew ? 'warn' : ''}">${tooFew && settings.colorblind ? '⚠ ' : ''}${lit}/${sim.lanterns.length}</b> <span class="sub">(cần ${sim.litNeeded})</span><br>Điểm <b>${sim.score}</b>${totalScore ? `<br><span class="sub">Tổng ${totalScore}</span>` : ''}`;
  ensureCells(sim.capacity);
  barCells.forEach((c, i) => c.classList.toggle('on', i < p.carried));
  $('carry').textContent = `Đom đóm ${p.carried}/${sim.capacity}`;
  setCd('cd-dash', p.charm > 0 ? 0 : p.dashCd, Math.round(T.dash_cooldown_s * TICK_HZ));
  setCd('cd-pulse', p.pulseCd, Math.round(T.pulse_cooldown_s * TICK_HZ));

  // low-fuel cue (once per lantern until refuelled / relit)
  for (const l of sim.lanterns) {
    if (sim.weak(l) && !lowWarned.has(l.id)) {
      lowWarned.add(l.id);
      subtitle(`[Đèn ${l.id} chập chờn] ⚠ Sắp cạn dầu (${Math.floor(l.fuel / 60)}) — mang đom đóm tới châm`);
    }
  }

  // nearest receiving lantern: interact prompt + off-screen arrow
  let nearest: { id: string; pos: Vec3; deposited: number; lit: boolean; fuel: number; everLit: boolean } | null = null;
  let nd = Infinity;
  for (const l of sim.lanterns) {
    if (l.lit && l.fuel >= T.fuel_max * 60) continue;
    const d = distXZ(l.pos, p.pos);
    if (d < nd) { nd = d; nearest = l; }
  }
  const prompt = $('prompt');
  const ik = keyName(settings.keys.interact);
  if (nearest && nd <= T.interact_radius) {
    prompt.textContent = nearest.lit
      ? `${ik} — Châm dầu (${Math.floor(nearest.fuel / 60)}/${T.fuel_max})`
      : `${ik} — Nạp ánh sáng (${nearest.deposited}/${nearest.everLit ? T.relight_cost : T.lantern_cost})`;
    prompt.classList.remove('hidden');
  } else prompt.classList.add('hidden');
  const target = sim.lanterns.filter((l) => !l.lit).sort((a, b) => distXZ(a.pos, p.pos) - distXZ(b.pos, p.pos))[0];
  $('arrow').classList.toggle('hidden', !(target && edgeArrow($('arrow'), target.pos)));

  // shade-spawn arrows (purple; cyan in colour-blind mode)
  const holder = $('spawnarrows');
  for (let i = spawnArrows.length - 1; i >= 0; i--) if (spawnArrows[i].until < now) spawnArrows.splice(i, 1);
  while (holder.children.length < spawnArrows.length) { const d = document.createElement('div'); d.className = 'sarrow'; holder.appendChild(d); }
  Array.from(holder.children).forEach((el, i) => {
    const a = spawnArrows[i];
    (el as HTMLElement).classList.toggle('hidden', !a || !edgeArrow(el as HTMLElement, a.pos));
  });

  const warn = sim.windWarning;
  $('windwarn').classList.toggle('hidden', !(warn || sim.wind.active));
  $('windwarn').textContent = sim.wind.active ? '🍃 Gió mạnh!' : '🍃 Gió sắp nổi…';
  if (warn && !wasWarning) { audio.play('wind'); subtitle('[Gió hú] 🍃 Gió sắp thổi — đứng xa mép đảo'); }
  wasWarning = warn;

  for (let i = subs.length - 1; i >= 0; i--) if (subs[i].until < now) subs.splice(i, 1);
  $('subs').innerHTML = subs.map((s) => `<div>${s.text}</div>`).join('');
}

// ------------------------------------------------------------------ sync models with the sim
function sync(dt: number, t: number): void {
  const p = sim.player;
  may.update(dt, t, p.pos, p.carried, p.respawnWait === 0 && (p.invuln === 0 || Math.floor(t * 12) % 2 === 0));

  swarm.update(t, sim.motes);
  crowd.update(t, sim.shades, p.pos);
  for (const d of sim.drifters) {
    let model = drifters.get(d.id);
    if (!model) { model = new DrifterModel(); drifters.set(d.id, model); dynamic.add(model.root); }
    model.update(t, d.pos, d.state, d.stolen, p.pos);
  }
  sim.charms.forEach((c, i) => charms[i]?.update(t, c.available));

  sim.lanterns.forEach((l, i) => {
    lanterns[i].update(t, l.lit, l.lit ? 1 : l.deposited / (l.everLit ? T.relight_cost : T.lantern_cost), l.fuel / 60, sim.weak(l), camera);
    ((lanterns[i].root.userData.ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = sim.safe(l) ? 0.35 : 0;
  });
  ambient.intensity = 0.15 + 0.55 * (sim.litCount / sim.lanterns.length); // Ticket-02 formula

  leaves.update(t, p.pos, sim.windWarning || sim.wind.active, sim.wind.dirDeg, sim.wind.active);

  if (mode === 'bench') return; // the bench camera is set by the bench loop
  const camY = p.respawnWait > 0 ? sim.map.start[1] : p.pos[1];
  camera.position.set(p.pos[0] - Math.sin(camYaw) * 8, camY + 4.5, p.pos[2] - Math.cos(camYaw) * 8);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt);
  }
  camera.lookAt(p.pos[0], camY + 1.3, p.pos[2]);
}

// ------------------------------------------------------------------ benchmark scene (Ticket-04 §1)
interface BenchState { firstFrameAt: number; measuring: boolean; done: boolean; dts: number[]; three: string; gpu: string; shades: number; motes: number }
const bench: BenchState = { firstFrameAt: 0, measuring: false, done: false, dts: [], three: THREE.REVISION, gpu: '', shades: 0, motes: 0 };
let benchStart = 0;
const benchWarmup = Number(params.get('warmup') ?? 3);
const benchDuration = Number(params.get('duration') ?? 30);
function startBench(): void {
  mode = 'bench';
  screen(null);
  $('hud').classList.add('hidden');
  loadWorld(makeBenchSim(T, Number(params.get('seed') ?? 42)));
  bench.shades = sim.shades.length;
  bench.motes = sim.motes.length;
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  bench.gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  (window as unknown as { __bench: BenchState }).__bench = bench;
}
function benchCamera(elapsed: number): void {
  // radius 30 m, Y 15 m, starts at 0° = (30, 15, 0), counter-clockwise seen from above
  // (angle from +X toward +Z, the ticket's map convention), one turn per 15 s
  const a = (2 * Math.PI * elapsed) / 15;
  camera.position.set(30 * Math.cos(a), 15, 30 * Math.sin(a));
  camera.lookAt(0, 0, 0);
}

// ------------------------------------------------------------------ main loop (fixed 60 Hz sim)
let acc = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let wasGrounded = true;
if (BENCH) startBench();
else {
  newSession(1);
  showMenu();
}

renderer.setAnimationLoop((now) => {
  const rawDt = now - last; // ms
  const dt = Math.min(0.25, rawDt / 1000);
  last = now;
  const t = now / 1000;
  if (mode === 'bench') {
    if (!bench.firstFrameAt) { bench.firstFrameAt = performance.timeOrigin + now; benchStart = now; }
    const elapsed = (now - benchStart) / 1000;
    acc += dt;
    while (acc >= 1 / TICK_HZ) { acc -= 1 / TICK_HZ; sim.step(readNeutral); sim.drainEvents(); }
    sync(dt, t);
    benchCamera(elapsed);
    renderer.render(scene, camera);
    if (elapsed >= benchWarmup && !bench.done) {
      if (bench.measuring) bench.dts.push(rawDt);
      bench.measuring = true;
      if (elapsed >= benchWarmup + benchDuration) bench.done = true;
    }
    return;
  }
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
  if (mode === 'playing' || mode === 'paused' || mode === 'settings' || mode === 'result') updateHud();
  renderer.render(scene, camera);

  // FPS: rolling average over the current night
  if (mode === 'playing') {
    fpsFrames++;
    fpsTime += dt;
    $('fps').textContent = `FPS ${(fpsFrames / Math.max(fpsTime, 1e-3)).toFixed(0)} · ${renderer.domElement.width}×${renderer.domElement.height}`;
  }
});
const readNeutral: InputState = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false };
