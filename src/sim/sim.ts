/**
 * Đảo Đèn Lồng — deterministic game simulation (no rendering, no wall clock, seeded RNG only).
 * Implements TICKET-02 / Test Contract v1.1. The 12 numbered steps in step() follow the ticket's
 * mandatory tick order. Decisions on open points: docs/notes/phase-2.md.
 */
import { NIGHTS, type NightDef } from './maps.js';
import { makeRng } from './rng.js';
import type {
  Button, DrifterState, GameEvent, GameState, InputState, Scenario, ShadeState, Tuning, Vec3,
} from './types.js';
import { neutralInput } from './types.js';

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

// Standard values from TICKET-02 that are not contract tuning keys.
export const ACCEL = 60; // m/s²: 0 -> 6 m/s (and back) in 0.1 s
export const JUMP_SPEED = 7;
export const GRAVITY = 20;
export const STEP_UP = 0.35; // max ledge you can walk onto (ramps ok, 3 m tiers are walls)
export const FALL_Y = -10;
export const RESPAWN_WAIT = 60;
export const PICKUP_DY = 1.5;
export const HIT_DY = 1.5;
export const PULSE_CENTER_DY = 0.8;
export const PUSH_TICKS = 15;
export const CHARM_TICKS = 600;
export const CHARM_SPEED = 7.2;
export const CHARM_RESPAWN = 2700;
export const MOTES_INITIAL = 20;
export const MOTES_CAP = 30;
export const MOTE_SPAWN_EVERY = 240;
export const DROP_TTL = 480;
export const DROP_RING: [number, number] = [1.5, 2.5];
export const SHADE_FIRST_TICK = 300;
export const SHADE_MIN_PLAYER_DIST = 15;
export const SHADE_DETECT = 12;
export const SHADE_LOSE = 18;
export const SHADE_HOVER = 1;
export const SPAWNING_TICKS = 30; // assumption A-S1
export const WANDER_SPEED = 1.5; // assumption A-S2
export const RECOIL_TICKS = 60;
export const RECOIL_DIST = 2;
export const EVICT_TICKS = 30;
export const DRIFTER_EVERY = 1200;
export const DRIFTER_MAX = 2;
export const DRIFTER_SPEED = 7;
export const DRIFTER_IDLE_SPEED = 2;
export const DRIFTER_SEE = 15;
export const DRIFTER_MIN_CARRY = 5;
export const DRIFTER_TOUCH = 1.2;
export const DRIFTER_STEAL = 3;
export const DRIFTER_FLEE_TICKS = 240;
export const DRIFTER_DROP_VANISH = 120;
export const DRIFTER_HOVER = 1;
export const WIND_PERIOD = 1800;
export const WIND_TICKS = 300;
export const WIND_WARN = 120;
export const WIND_SPEED = 2;

export interface Mote { id: string; pos: Vec3; kind: 'random' | 'dropped'; ttl: number; point: number; born: number }
export interface Shade {
  id: string; pos: Vec3; state: ShadeState; ticks: number;
  push: [number, number]; pushTicks: number; recoilDir: [number, number];
  evictFrom: Vec3 | null; target: Vec3 | null;
}
export interface Drifter { id: string; pos: Vec3; state: DrifterState; stolen: number; ticks: number; target: Vec3 | null }
export interface Charm { id: string; pos: Vec3; available: boolean; respawn: number }
export interface Lantern { id: string; pos: Vec3; lit: boolean; deposited: number }
export interface Player {
  pos: Vec3; vel: Vec3; grounded: boolean; facing: [number, number];
  flames: number; carried: number;
  invuln: number; dashCd: number; pulseCd: number; charm: number;
  dashTicks: number; dashDir: [number, number]; launch: [number, number] | null; respawnWait: number;
}

export const distXZ = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unitXZ = (from: Vec3, to: Vec3): [number, number] => {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const l = Math.hypot(dx, dz);
  return l > 1e-9 ? [dx / l, dz / l] : [1, 0]; // coincident -> +X (ticket)
};
/** Natural id order: S2 < S10. */
export function idCompare(a: string, b: string): number {
  const ma = /^(\D*)(\d+)$/.exec(a);
  const mb = /^(\D*)(\d+)$/.exec(b);
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return a < b ? -1 : a > b ? 1 : 0;
}

export class Sim {
  readonly tuning: Tuning;
  readonly map: NightDef;
  readonly night: 1 | 2 | 3;
  tick = 0;
  simTick = 0;
  state: GameState = 'playing';
  paused = false;
  score = 0;
  player: Player;
  lanterns: Lantern[];
  motes: Mote[] = [];
  shades: Shade[] = [];
  drifters: Drifter[] = [];
  charms: Charm[] = [];
  wind = { active: false, dirDeg: 0, ticks: 0 };
  randomMotes: boolean;
  randomShades: boolean;
  randomDrifters: boolean;
  windEnabled: boolean;
  private readonly duration: number;
  private readonly rng: () => number;
  private moteNum = 1;
  private shadeNum = 1;
  private drifterNum = 1;
  private prev: InputState = neutralInput();
  private pending: GameEvent[] = [];

  constructor(tuning: Tuning, seed: number, night: 1 | 2 | 3 = 1, scenario: Scenario = {}) {
    this.tuning = tuning;
    this.night = night;
    this.map = NIGHTS[night];
    this.rng = makeRng(seed);
    const m = this.map;
    this.duration = scenario.time_left_s ?? tuning[m.durationKey];
    this.randomMotes = scenario.random_motes ?? true;
    this.randomShades = scenario.random_shades ?? true;
    this.randomDrifters = scenario.random_drifters ?? true;
    this.windEnabled = (scenario.wind_enabled ?? true) && m.wind;

    const sp = scenario.player ?? {};
    const pos: Vec3 = sp.pos ? [...sp.pos] : [...m.start];
    const g = m.ground(pos[0], pos[2]);
    this.player = {
      pos, vel: [0, 0, 0], grounded: g !== null && Math.abs(pos[1] - g) < 1e-6, facing: [0, 1],
      flames: sp.flames ?? tuning.flames, carried: sp.carried ?? 0,
      invuln: sp.invuln_ticks ?? 0, dashCd: sp.dash_cd_ticks ?? 0, pulseCd: sp.pulse_cd_ticks ?? 0, charm: sp.charm_ticks ?? 0,
      dashTicks: 0, dashDir: [0, 1], launch: null, respawnWait: 0,
    };

    this.lanterns = m.lanterns.map((l) => ({ id: l.id, pos: [...l.pos], lit: false, deposited: 0 }));
    for (const patch of scenario.lanterns ?? []) {
      const l = this.lanterns.find((x) => x.id === patch.id);
      if (!l) throw new Error(`scenario: unknown lantern id "${patch.id}"`);
      if (patch.pos) l.pos = [...patch.pos];
      if (patch.deposited !== undefined) l.deposited = patch.deposited;
      if (patch.lit !== undefined) l.lit = patch.lit;
      if (patch.lit && patch.deposited === undefined) l.deposited = tuning.lantern_cost; // pre-lit = full
    }

    if (scenario.motes) {
      for (const sm of scenario.motes) this.addMote([...sm.pos], sm.kind ?? 'random', -1, sm.ttl_ticks ?? (sm.kind === 'dropped' ? DROP_TTL : 0), -1);
    } else if (this.randomMotes) {
      const pts = m.moteSpawns.map((_, i) => i);
      for (let n = 0; n < MOTES_INITIAL && pts.length; n++) {
        const i = pts.splice(Math.floor(this.rng() * pts.length), 1)[0];
        this.addMote([...m.moteSpawns[i]], 'random', i, 0, -1);
      }
    }

    for (const s of scenario.shades ?? []) {
      const sh = this.addShade([...s.pos], s.id);
      sh.state = s.state ?? 'chase';
      sh.ticks = s.state_ticks_left ?? (sh.state === 'stunned' ? Math.round(tuning.pulse_stun_s * TICK_HZ) : sh.state === 'recoil' ? RECOIL_TICKS : sh.state === 'spawning' ? SPAWNING_TICKS : 0);
      if (sh.state === 'recoil') sh.recoilDir = unitXZ(this.player.pos, sh.pos);
    }
    for (const d of scenario.drifters ?? []) {
      const dr = this.addDrifter([...d.pos], d.id);
      dr.state = d.state ?? 'idle';
      dr.stolen = d.stolen ?? 0;
      if (dr.state === 'flee') dr.ticks = DRIFTER_FLEE_TICKS;
    }
    const charmDefs = scenario.charms ?? m.charms.map((pos, i) => ({ id: `C${i + 1}`, pos }));
    this.charms = charmDefs.map((c, i) => {
      const cc = c as { id?: string; pos: Vec3; available?: boolean; respawn_ticks?: number };
      const available = cc.available ?? true;
      return { id: cc.id ?? `C${i + 1}`, pos: [...cc.pos], available, respawn: available ? 0 : cc.respawn_ticks ?? CHARM_RESPAWN };
    });
  }

  get timeLeft(): number {
    return Math.max(0, this.duration - this.simTick / TICK_HZ);
  }
  get over(): boolean {
    return this.state === 'won' || this.state === 'lost';
  }
  /** Web-only hint: a gust starts within WIND_WARN ticks. */
  get windWarning(): boolean {
    return this.windEnabled && !this.wind.active && (this.simTick % WIND_PERIOD) >= WIND_PERIOD - WIND_WARN;
  }
  get speed(): number {
    return this.player.charm > 0 ? CHARM_SPEED : this.tuning.player_speed;
  }

  drainEvents(): GameEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  /** Emitted once by the runner right after the tick-0 snapshot. */
  startEvents(): void {
    this.emit('night_start', { night: this.night });
  }

  // ---------------------------------------------------------------- helpers
  private emit(name: string, data: Record<string, unknown>): void {
    this.pending.push({ type: 'event', tick: this.tick, name, data });
  }

  groundAt(x: number, z: number): number | null {
    return this.map.ground(x, z);
  }

  private addMote(pos: Vec3, kind: 'random' | 'dropped', point: number, ttl: number, born: number): Mote {
    const mo: Mote = { id: `M${this.moteNum++}`, pos, kind, ttl, point, born };
    this.motes.push(mo);
    return mo;
  }

  private nextId(prefix: string, taken: { id: string }[], counter: 'shadeNum' | 'drifterNum'): string {
    let id: string;
    do id = `${prefix}${this[counter]++}`;
    while (taken.some((x) => x.id === id));
    return id;
  }

  private addShade(pos: Vec3, id?: string): Shade {
    const s: Shade = {
      id: id ?? this.nextId('S', this.shades, 'shadeNum'), pos, state: 'spawning', ticks: SPAWNING_TICKS,
      push: [1, 0], pushTicks: 0, recoilDir: [1, 0], evictFrom: null, target: null,
    };
    this.shades.push(s);
    this.shades.sort((a, b) => idCompare(a.id, b.id));
    return s;
  }

  private addDrifter(pos: Vec3, id?: string): Drifter {
    const d: Drifter = { id: id ?? this.nextId('D', this.drifters, 'drifterNum'), pos, state: 'idle', stolen: 0, ticks: 0, target: null };
    this.drifters.push(d);
    this.drifters.sort((a, b) => idCompare(a.id, b.id));
    return d;
  }

  private dropMotes(n: number, around: Vec3, ring: [number, number] | null): void {
    for (let i = 0; i < n; i++) {
      let x = around[0];
      let z = around[2];
      if (ring) {
        const a = this.rng() * 2 * Math.PI;
        const r = ring[0] + this.rng() * (ring[1] - ring[0]);
        x += r * Math.cos(a);
        z += r * Math.sin(a);
      }
      const g = this.groundAt(x, z);
      this.addMote([x, g ?? around[1], z], 'dropped', -1, DROP_TTL, this.simTick);
    }
  }

  private litZones(): Lantern[] {
    return this.lanterns.filter((l) => l.lit);
  }

  /** Keep a shade out of lit safe zones and pillars. Returns true if it was blocked. */
  private blockShade(s: Shade): boolean {
    let blocked = false;
    const R = this.tuning.safe_radius;
    for (const l of this.litZones()) {
      const d = distXZ(s.pos, l.pos);
      if (d < R) {
        const [ux, uz] = unitXZ(l.pos, s.pos);
        s.pos[0] = l.pos[0] + ux * R;
        s.pos[2] = l.pos[2] + uz * R;
        blocked = true;
      }
    }
    for (const p of this.map.pillars) {
      const d = Math.hypot(s.pos[0] - p.x, s.pos[2] - p.z);
      if (d < p.r) {
        const [ux, uz] = d > 1e-9 ? [(s.pos[0] - p.x) / d, (s.pos[2] - p.z) / d] : [1, 0];
        s.pos[0] = p.x + ux * p.r;
        s.pos[2] = p.z + uz * p.r;
        blocked = true;
      }
    }
    return blocked;
  }

  private hover(pos: Vec3, h: number): void {
    const g = this.groundAt(pos[0], pos[2]);
    pos[1] = (g === null || g > 8 ? 0 : g) + h;
  }

  private moveToward(pos: Vec3, target: Vec3, speed: number): number {
    const d = distXZ(pos, target);
    if (d < 1e-9) return 0;
    const step = Math.min(speed * DT, d);
    pos[0] += ((target[0] - pos[0]) / d) * step;
    pos[2] += ((target[2] - pos[2]) / d) * step;
    return d - step;
  }

  private pickWanderTarget(around: Vec3, radius: number): Vec3 {
    for (let tries = 0; tries < 8; tries++) {
      const a = this.rng() * 2 * Math.PI;
      const r = this.rng() * radius;
      const x = around[0] + r * Math.cos(a);
      const z = around[2] + r * Math.sin(a);
      if (this.groundAt(x, z) !== null) return [x, 0, z];
    }
    return [around[0], 0, around[2]];
  }

  private playerTargetable(): boolean {
    return this.player.respawnWait === 0;
  }

  // ---------------------------------------------------------------- one tick
  step(input: InputState): void {
    if (this.over) return;
    const t = this.tuning;
    const p = this.player;
    const edge = (k: Button) => input[k] && !this.prev[k];
    this.tick += 1;

    // 1. Read input; pause first. If we just paused, stop here. While paused nothing else runs.
    if (edge('pause')) {
      this.paused = !this.paused;
      this.emit(this.paused ? 'paused' : 'resumed', {});
    }
    this.state = this.paused ? 'paused' : 'playing';
    if (this.paused) {
      this.prev = input;
      return;
    }
    this.simTick += 1;

    // 2. Timers: time (simTick), cooldowns, invulnerability, stun, charm, dropped-mote TTL, charm respawn.
    if (p.invuln > 0) p.invuln--;
    if (p.dashCd > 0) p.dashCd--;
    if (p.pulseCd > 0) p.pulseCd--;
    if (p.charm > 0) p.charm--;
    for (const s of this.shades) {
      if (s.state === 'stunned' && --s.ticks <= 0) this.afterBusy(s);
    }
    this.motes = this.motes.filter((m) => m.kind !== 'dropped' || --m.ttl > 0);
    for (const c of this.charms) if (!c.available && --c.respawn <= 0) { c.available = true; c.respawn = 0; }
    if (this.wind.active && --this.wind.ticks <= 0) this.wind.active = false;
    if (p.respawnWait > 0 && --p.respawnWait === 0) {
      p.pos = [...this.map.start];
      p.vel = [0, 0, 0];
      p.grounded = true;
      p.launch = null;
      p.dashTicks = 0;
      p.invuln = Math.round(t.invuln_s * TICK_HZ);
    }

    // 3. Move Mây (jump, dash, pads, wind), then the fall check.
    if (p.respawnWait === 0) this.movePlayer(input, edge);

    // 4. Pick up fireflies and charms.
    if (this.playerTargetable()) {
      for (let i = 0; i < this.motes.length && p.carried < t.carry_capacity; ) {
        const m = this.motes[i];
        const pickable = m.born < this.simTick && distXZ(m.pos, p.pos) <= t.pickup_radius && Math.abs(p.pos[1] - m.pos[1]) <= PICKUP_DY;
        if (pickable) {
          this.motes.splice(i, 1);
          p.carried++;
          this.emit('mote_picked', { carried: p.carried });
        } else i++;
      }
      for (const c of this.charms) {
        if (c.available && distXZ(c.pos, p.pos) <= t.pickup_radius && Math.abs(p.pos[1] - c.pos[1]) <= PICKUP_DY) {
          c.available = false;
          c.respawn = CHARM_RESPAWN;
          p.charm = CHARM_TICKS;
          this.emit('charm_picked', { charm_id: c.id, charm_ticks: CHARM_TICKS });
        }
      }
    }

    // 5. Interact with lanterns: nearest unlit within radius, ties -> smaller id.
    const newlyLit: Lantern[] = [];
    if (edge('interact') && this.playerTargetable() && p.carried > 0) {
      let best: Lantern | undefined;
      let bestD = Infinity;
      for (const l of this.lanterns) {
        if (l.lit) continue;
        const d = distXZ(l.pos, p.pos);
        if (d > t.interact_radius) continue;
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && idCompare(l.id, best.id) < 0)) { best = l; bestD = d; }
      }
      if (best) {
        const amount = Math.min(p.carried, Math.max(0, t.lantern_cost - best.deposited));
        if (amount > 0) {
          p.carried -= amount;
          best.deposited += amount;
          this.score += amount * t.score.per_mote;
          this.emit('deposit', { lantern_id: best.id, amount, deposited: best.deposited });
          if (best.deposited >= t.lantern_cost) {
            best.lit = true;
            this.score += t.score.per_lantern;
            this.emit('lantern_lit', { lantern_id: best.id });
            newlyLit.push(best);
          }
        }
      }
    }

    // 6. Safe zones: shades inside a just-lit zone are evicted (recoil, harmless, <= 30 ticks).
    for (const l of newlyLit) {
      for (const s of this.shades) {
        if (distXZ(s.pos, l.pos) < t.safe_radius) {
          s.state = 'recoil';
          s.evictFrom = l.pos;
          s.ticks = EVICT_TICKS;
          s.pushTicks = 0;
        }
      }
    }

    // 7. Pulse.
    if (edge('pulse') && this.playerTargetable() && p.pulseCd === 0 && p.carried >= t.pulse_cost) {
      p.carried -= t.pulse_cost;
      p.pulseCd = Math.round(t.pulse_cooldown_s * TICK_HZ);
      const center: Vec3 = [p.pos[0], p.pos[1] + PULSE_CENTER_DY, p.pos[2]];
      const stunned: string[] = [];
      for (const s of this.shades) {
        if (dist3(center, s.pos) > t.pulse_radius) continue;
        s.state = 'stunned';
        s.ticks = Math.round(t.pulse_stun_s * TICK_HZ);
        s.push = unitXZ(center, s.pos);
        s.pushTicks = PUSH_TICKS;
        s.evictFrom = null;
        stunned.push(s.id);
      }
      this.score += stunned.length * t.score.per_stun;
      this.emit('pulse', { stunned_ids: stunned });
      for (const d of this.drifters) {
        if (dist3(center, d.pos) > t.pulse_radius) continue;
        if (d.state === 'chase' || d.state === 'idle') {
          // +1: step 8 of this same tick already counts down once
          if (d.state === 'chase') { d.state = 'flee'; d.ticks = DRIFTER_FLEE_TICKS + 1; }
        } else if (d.state === 'flee' && d.stolen > 0) {
          const amount = d.stolen;
          this.dropMotes(amount, [d.pos[0], p.pos[1], d.pos[2]], null);
          d.stolen = 0;
          d.ticks = DRIFTER_DROP_VANISH + 1; // +1: counted down in step 8 of this tick
          this.emit('drifter_drop', { drifter_id: d.id, amount });
        }
      }
    }

    // 8. Move shades and drifters.
    for (const s of this.shades) this.moveShade(s);
    for (const d of this.drifters) this.moveDrifter(d);

    // 9. Touch: drifters steal first, then shades hit (ascending id).
    if (this.playerTargetable()) {
      for (const d of this.drifters) {
        if (d.state !== 'chase' || distXZ(d.pos, p.pos) > DRIFTER_TOUCH) continue;
        const amount = Math.min(DRIFTER_STEAL, p.carried);
        if (amount <= 0) continue;
        p.carried -= amount;
        d.stolen = amount;
        d.state = 'flee';
        d.ticks = DRIFTER_FLEE_TICKS;
        this.emit('drifter_steal', { drifter_id: d.id, amount, carried: p.carried });
      }
      for (const s of this.shades) {
        if (s.state !== 'chase' && s.state !== 'wander') continue;
        if (distXZ(s.pos, p.pos) > t.shade_hit_radius || Math.abs(p.pos[1] - s.pos[1]) > HIT_DY) continue;
        if (p.invuln > 0) continue; // touching an invulnerable Mây does nothing
        p.flames -= 1;
        const dropped = Math.floor(p.carried * t.hit_drop_ratio);
        p.carried -= dropped;
        this.dropMotes(dropped, p.pos, DROP_RING);
        p.invuln = Math.round(t.invuln_s * TICK_HZ);
        s.state = 'recoil';
        s.ticks = RECOIL_TICKS;
        s.recoilDir = unitXZ(p.pos, s.pos);
        s.evictFrom = null;
        this.emit('player_hit', { by: 'shade', flames: p.flames, dropped });
      }
    }

    // 10. Scheduled spawns (new entities interact from the next tick).
    this.spawnScheduled();

    // 11. Win / lose.
    if (p.flames <= 0) this.endGame('lost', 'no_flames');
    else if (this.lanterns.every((l) => l.lit)) this.endGame('won', 'all_lit');
    else if (this.duration - this.simTick / TICK_HZ <= 1e-9) this.endGame('lost', 'dawn');

    // 12. Snapshot: written by the runner after step() returns.
    this.prev = input;
  }

  private endGame(result: 'won' | 'lost', reason: 'all_lit' | 'dawn' | 'no_flames'): void {
    this.state = result;
    if (result === 'won') {
      const s = this.tuning.score;
      this.score += s.per_second_left * Math.floor(this.timeLeft + 1e-9) + s.per_flame_left * this.player.flames;
    }
    this.emit('game_over', { result, reason });
  }

  /** A stunned / recoiling / spawning shade becomes active again. */
  private afterBusy(s: Shade): void {
    s.ticks = 0;
    s.pushTicks = 0;
    s.evictFrom = null;
    const near = this.playerTargetable() && distXZ(s.pos, this.player.pos);
    s.state = near !== false && near <= SHADE_LOSE ? 'chase' : 'wander';
  }

  private movePlayer(input: InputState, edge: (k: Button) => boolean): void {
    const t = this.tuning;
    const p = this.player;
    let [mx, mz] = input.move;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const th = (input.cam_yaw_deg * Math.PI) / 180;
    const dx = mx * Math.cos(th) + mz * Math.sin(th);
    const dz = -mx * Math.sin(th) + mz * Math.cos(th);
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-9) p.facing = [dx / dl, dz / dl];

    // dash: direction = moving direction, else facing; cooldown counted from the start
    if (edge('dash') && p.dashTicks === 0 && (p.dashCd === 0 || p.charm > 0)) {
      p.dashTicks = Math.round(t.dash_duration_s * TICK_HZ);
      p.dashDir = [...p.facing];
      p.dashCd = p.charm > 0 ? 0 : Math.round(t.dash_cooldown_s * TICK_HZ);
      this.emit('dash', {});
    }
    if (edge('jump') && p.grounded) {
      p.vel[1] = JUMP_SPEED;
      p.grounded = false;
    }

    // horizontal velocity
    let dashing = false;
    let dashEnds = false;
    if (p.dashTicks > 0) {
      p.vel[0] = p.dashDir[0] * t.dash_speed;
      p.vel[2] = p.dashDir[1] * t.dash_speed;
      dashing = true;
      dashEnds = --p.dashTicks === 0;
    } else if (p.launch) {
      p.vel[0] = p.launch[0];
      p.vel[2] = p.launch[1];
    } else {
      const tx = dx * this.speed;
      const tz = dz * this.speed;
      const ex = tx - p.vel[0];
      const ez = tz - p.vel[2];
      const el = Math.hypot(ex, ez);
      const maxDv = ACCEL * DT;
      const k = el > maxDv ? maxDv / el : 1;
      p.vel[0] += ex * k;
      p.vel[2] += ez * k;
    }

    // vertical velocity (an airborne dash holds altitude)
    if (dashing && !p.grounded) p.vel[1] = 0;
    else if (!p.grounded) p.vel[1] -= GRAVITY * DT;

    // horizontal move + wind, walls = ground higher than a step
    let wx = 0;
    let wz = 0;
    if (this.wind.active) {
      const a = (this.wind.dirDeg * Math.PI) / 180;
      wx = Math.cos(a) * WIND_SPEED;
      wz = Math.sin(a) * WIND_SPEED;
    }
    const nx = p.pos[0] + (p.vel[0] + wx) * DT;
    const nz = p.pos[2] + (p.vel[2] + wz) * DT;
    const free = (x: number, z: number) => {
      const g = this.groundAt(x, z);
      return g === null || g <= p.pos[1] + STEP_UP;
    };
    if (free(nx, nz)) { p.pos[0] = nx; p.pos[2] = nz; }
    else if (free(nx, p.pos[2])) { p.pos[0] = nx; p.vel[2] = 0; }
    else if (free(p.pos[0], nz)) { p.pos[2] = nz; p.vel[0] = 0; }
    else { p.vel[0] = 0; p.vel[2] = 0; }
    if (dashEnds && !p.launch) {
      // all 12 dash ticks moved at dash_speed; leave the dash at run speed
      p.vel[0] = p.dashDir[0] * this.speed;
      p.vel[2] = p.dashDir[1] * this.speed;
    }

    // vertical move + landing / walking off edges
    const prevY = p.pos[1];
    p.pos[1] += p.vel[1] * DT;
    const g = this.groundAt(p.pos[0], p.pos[2]);
    if (p.grounded) {
      if (g !== null && prevY - g <= STEP_UP && g <= prevY + STEP_UP) p.pos[1] = g; // follow ramps
      else p.grounded = false; // walked off a ledge or the island
    } else if (g !== null && p.vel[1] <= 0 && p.pos[1] <= g && prevY >= g - STEP_UP) {
      p.pos[1] = g;
      p.vel[1] = 0;
      p.grounded = true;
      if (p.launch) {
        p.launch = null;
        const hl = Math.hypot(p.vel[0], p.vel[2]);
        if (hl > this.speed) { p.vel[0] *= this.speed / hl; p.vel[2] *= this.speed / hl; }
      }
    }

    // jump pads: feet on the pad -> launched; velocity kept until landing
    if (p.grounded) {
      for (const pad of this.map.pads) {
        if (distXZ(p.pos, pad.pos) <= pad.radius && Math.abs(p.pos[1] - pad.pos[1]) < 0.05) {
          p.launch = [pad.dir[0] * pad.hSpeed, pad.dir[1] * pad.hSpeed];
          p.vel = [p.launch[0], pad.vy, p.launch[1]];
          p.grounded = false;
          break;
        }
      }
    }

    // fall off the island: once, ignores invulnerability
    if (p.pos[1] < FALL_Y) {
      p.flames -= 1;
      const lost = p.carried;
      p.carried = 0;
      p.vel = [0, 0, 0];
      p.launch = null;
      p.dashTicks = 0;
      p.respawnWait = RESPAWN_WAIT;
      this.emit('player_hit', { by: 'fall', flames: p.flames, dropped: 0, lost });
    }
  }

  private moveShade(s: Shade): void {
    const p = this.player;
    const speed = this.map.shadeSpeed ?? this.tuning.shade_speed;
    switch (s.state) {
      case 'spawning':
        if (--s.ticks <= 0) this.afterBusy(s);
        break;
      case 'recoil':
        if (s.evictFrom) {
          const R = this.tuning.safe_radius;
          const [ux, uz] = unitXZ(s.evictFrom, s.pos);
          const d = distXZ(s.pos, s.evictFrom);
          const step = Math.min(R / EVICT_TICKS, R - d);
          s.pos[0] += ux * step;
          s.pos[2] += uz * step;
          if (--s.ticks <= 0 || distXZ(s.pos, s.evictFrom) >= R - 1e-9) this.afterBusy(s);
        } else {
          s.pos[0] += s.recoilDir[0] * (RECOIL_DIST / RECOIL_TICKS);
          s.pos[2] += s.recoilDir[1] * (RECOIL_DIST / RECOIL_TICKS);
          this.blockShade(s);
          if (--s.ticks <= 0) this.afterBusy(s);
        }
        break;
      case 'stunned':
        if (s.pushTicks > 0) {
          const before: Vec3 = [...s.pos];
          s.pos[0] += s.push[0] * (this.tuning.pulse_push_m / PUSH_TICKS);
          s.pos[2] += s.push[1] * (this.tuning.pulse_push_m / PUSH_TICKS);
          s.pushTicks--;
          if (this.blockShade(s)) { s.pos = before; s.pushTicks = 0; } // stop at obstacles
        }
        break;
      case 'wander': {
        const dp = distXZ(s.pos, p.pos);
        if (this.playerTargetable() && dp <= SHADE_DETECT) {
          s.state = 'chase';
          s.target = null;
          this.moveToward(s.pos, p.pos, speed);
        } else {
          if (!s.target) s.target = this.pickWanderTarget(s.pos, 8);
          if (this.moveToward(s.pos, s.target, WANDER_SPEED) < 0.05) s.target = null;
        }
        this.blockShade(s);
        break;
      }
      case 'chase': {
        if (!this.playerTargetable() || distXZ(s.pos, p.pos) > SHADE_LOSE) {
          s.state = 'wander';
          s.target = null;
        } else this.moveToward(s.pos, p.pos, speed);
        this.blockShade(s);
        break;
      }
    }
    this.hover(s.pos, SHADE_HOVER);
  }

  private moveDrifter(d: Drifter): void {
    const p = this.player;
    const sees = this.playerTargetable() && p.carried >= DRIFTER_MIN_CARRY && distXZ(d.pos, p.pos) <= DRIFTER_SEE;
    switch (d.state) {
      case 'idle':
        if (sees) {
          d.state = 'chase';
          this.moveToward(d.pos, p.pos, DRIFTER_SPEED);
        } else {
          if (!d.target) d.target = this.pickWanderTarget(d.pos, 10);
          if (this.moveToward(d.pos, d.target, DRIFTER_IDLE_SPEED) < 0.05) d.target = null;
        }
        break;
      case 'chase':
        if (!sees) { d.state = 'idle'; d.target = null; }
        else this.moveToward(d.pos, p.pos, DRIFTER_SPEED);
        break;
      case 'flee': {
        const [ux, uz] = unitXZ(p.pos, d.pos);
        d.pos[0] += ux * DRIFTER_SPEED * DT;
        d.pos[2] += uz * DRIFTER_SPEED * DT;
        if (--d.ticks <= 0) d.state = 'removed';
        break;
      }
      case 'removed':
        return;
    }
    this.hover(d.pos, DRIFTER_HOVER);
  }

  private spawnScheduled(): void {
    const st = this.simTick;
    const m = this.map;
    // fireflies: every 240 ticks, one at a free spawn point while under the cap
    if (this.randomMotes && st % MOTE_SPAWN_EVERY === 0 && this.motes.length < MOTES_CAP) {
      const used = new Set(this.motes.filter((x) => x.point >= 0).map((x) => x.point));
      const free = m.moteSpawns.map((_, i) => i).filter((i) => !used.has(i));
      if (free.length) {
        const i = free[Math.floor(this.rng() * free.length)];
        this.addMote([...m.moteSpawns[i]], 'random', i, 0, st);
      }
    }
    // shades: 2 at tick 300, then 1 per interval; points >= 15 m from Mây; skip if none
    if (this.randomShades && st >= SHADE_FIRST_TICK && (st - SHADE_FIRST_TICK) % m.shadeIntervalTicks === 0) {
      const count = st === SHADE_FIRST_TICK ? 2 : 1;
      const taken = new Set<number>();
      for (let n = 0; n < count && this.shades.length < m.shadeMax; n++) {
        const valid = m.shadeSpawns.map((_, i) => i).filter((i) => !taken.has(i) && distXZ(m.shadeSpawns[i], this.player.pos) >= SHADE_MIN_PLAYER_DIST);
        if (!valid.length) break;
        const i = valid[Math.floor(this.rng() * valid.length)];
        taken.add(i);
        const s = this.addShade([...m.shadeSpawns[i]]);
        this.hover(s.pos, SHADE_HOVER);
        this.emit('shade_spawned', { id: s.id });
      }
    }
    // drifters (Nights 2, 3): ticks 1200, 2400, ... at a random fog point, max 2 alive
    if (m.drifters && this.randomDrifters && st % DRIFTER_EVERY === 0 && this.drifters.filter((d) => d.state !== 'removed').length < DRIFTER_MAX) {
      const pt = m.shadeSpawns[Math.floor(this.rng() * m.shadeSpawns.length)];
      const d = this.addDrifter([...pt]);
      this.hover(d.pos, DRIFTER_HOVER);
    }
    // wind gusts (Night 3): every 30 s for 5 s, random direction
    if (this.windEnabled && st % WIND_PERIOD === 0) {
      this.wind = { active: true, dirDeg: Math.floor(this.rng() * 360), ticks: WIND_TICKS };
    }
  }

  // ---------------------------------------------------------------- output (contract v1.1)
  snapshot(): Record<string, unknown> {
    const p = this.player;
    return {
      type: 'snapshot',
      tick: this.tick,
      sim_tick: this.simTick,
      night: this.night,
      state: this.state,
      time_left_s: r3(this.timeLeft),
      score: this.score,
      wind: { active: this.wind.active, dir_deg: this.wind.dirDeg },
      player: {
        pos: v3(p.pos), vel: v3(p.vel), grounded: p.grounded, flames: p.flames, carried: p.carried,
        invuln: p.invuln > 0, dash_cd_s: r3(p.dashCd / TICK_HZ), pulse_cd_s: r3(p.pulseCd / TICK_HZ), charm_s: r3(p.charm / TICK_HZ),
      },
      lanterns: this.lanterns.map((l) => ({ id: l.id, pos: v3(l.pos), lit: l.lit, deposited: l.deposited })),
      shades: this.shades.map((s) => ({ id: s.id, pos: v3(s.pos), state: s.state })),
      motes_active: this.motes.length,
      motes: this.motes.map((m) => ({ id: m.id, pos: v3(m.pos), kind: m.kind, ttl_s: m.kind === 'dropped' ? r3(m.ttl / TICK_HZ) : null })),
      drifters: this.drifters.map((d) => ({ id: d.id, pos: v3(d.pos), state: d.state, stolen: d.stolen })),
      charms: this.charms.map((c) => ({ id: c.id, available: c.available, respawn_s: r3(c.respawn / TICK_HZ) })),
    };
  }
}

export function r3(x: number): number {
  const v = Math.round(x * 1000) / 1000;
  return v === 0 ? 0 : v; // no "-0"
}

function v3(p: Vec3): Vec3 {
  return [r3(p[0]), r3(p[1]), r3(p[2])];
}
