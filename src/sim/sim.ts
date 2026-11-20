/**
 * Đảo Đèn Lồng — deterministic game simulation (no rendering, no wall clock).
 * Implements PRD-0 / Test Contract v1.0. See docs/notes/phase-1-assumptions.md for every rule
 * the PRD left open; the step order below is documented there too.
 */
import { makeRng } from './rng.js';
import type { GameEvent, GameState, InputState, Scenario, ShadeState, Tuning, Vec3 } from './types.js';

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

// Level constants (not part of the contract "tuning"; documented in the assumptions).
export const ISLAND_RADIUS = 40;
export const LANTERN_RING_RADIUS = 25;
export const JUMP_SPEED = 6;
export const GRAVITY = 20;
export const INITIAL_MOTES = 30;
export const MAX_MOTES = 30;
export const MOTE_RESPAWN_TICKS = 180; // one mote every 3 s while below MAX_MOTES
export const MOTE_SPAWN_RADIUS = 36;
export const INITIAL_SHADES = 2;
export const MAX_SHADES = 4;
export const SHADE_SPAWN_TICKS = 2700; // one shade every 45 s while below MAX_SHADES
export const SHADE_SPAWN_RING = 38;
export const SHADE_HOVER_Y = 1;

export interface Mote { id: string; pos: Vec3 }
export interface Shade { id: string; pos: Vec3; state: ShadeState; stunTicks: number }
export interface Lantern { id: string; pos: Vec3; lit: boolean; deposited: number }
export interface Player {
  pos: Vec3;
  vy: number;
  flames: number;
  carried: number;
  invulnTicks: number;
  pulseCooldownTicks: number;
}

export function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** Default Đêm 1 layout: L1..L5 evenly on a ring, L1 at (0,0,25). */
export function defaultLanterns(count: number): Lantern[] {
  const out: Lantern[] = [];
  for (let k = 0; k < count; k++) {
    const a = (2 * Math.PI * k) / count;
    out.push({
      id: `L${k + 1}`,
      pos: [LANTERN_RING_RADIUS * Math.sin(a), 0, LANTERN_RING_RADIUS * Math.cos(a)],
      lit: false,
      deposited: 0,
    });
  }
  return out;
}

export class Sim {
  readonly tuning: Tuning;
  steps = 0;
  state: GameState = 'playing';
  score = 0;
  player: Player;
  lanterns: Lantern[];
  motes: Mote[] = [];
  shades: Shade[] = [];
  randomMotes = true;
  randomShades = true;
  /** Seconds left at setup (night duration or scenario time_left_s). */
  private readonly timeLeftAtSetup: number;
  private readonly rng: () => number;
  private nextMoteNum = 1;
  private nextShadeNum = 1;
  private prev: InputState = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false };
  /** Events produced since the last drainEvents() call. */
  private pending: GameEvent[] = [];

  constructor(tuning: Tuning, seed: number, scenario: Scenario = {}) {
    this.tuning = tuning;
    this.rng = makeRng(seed);
    const sp = scenario.player ?? {};
    this.player = {
      pos: sp.pos ? [...sp.pos] : [0, 0, 0],
      vy: 0,
      flames: sp.flames ?? tuning.flames,
      carried: sp.carried ?? 0,
      invulnTicks: 0,
      pulseCooldownTicks: 0,
    };
    this.timeLeftAtSetup = scenario.time_left_s ?? tuning.night1_duration_s;
    this.randomMotes = scenario.random_motes ?? true;
    this.randomShades = scenario.random_shades ?? true;

    this.lanterns = defaultLanterns(tuning.lantern_count_night1);
    for (const patch of scenario.lanterns ?? []) {
      const l = this.lanterns.find((x) => x.id === patch.id);
      if (!l) throw new Error(`scenario: unknown lantern id "${patch.id}"`);
      if (patch.pos) l.pos = [...patch.pos];
      if (patch.deposited !== undefined) l.deposited = patch.deposited;
      if (patch.lit !== undefined) l.lit = patch.lit;
    }

    if (scenario.motes) {
      for (const p of scenario.motes) this.addMote([...p]);
    } else if (this.randomMotes) {
      for (let i = 0; i < INITIAL_MOTES; i++) this.addMote(this.randomMotePos());
    }

    if (scenario.shades) {
      for (const s of scenario.shades) this.addShade([...s.pos], s.id);
    } else if (this.randomShades) {
      for (let i = 0; i < INITIAL_SHADES; i++) this.addShade(this.randomShadePos());
    }
  }

  get timeLeft(): number {
    return Math.max(0, this.timeLeftAtSetup - this.steps / TICK_HZ);
  }

  get over(): boolean {
    return this.state !== 'playing';
  }

  drainEvents(): GameEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  // ---------------------------------------------------------------- setup helpers
  private randomMotePos(): Vec3 {
    const r = Math.sqrt(this.rng()) * MOTE_SPAWN_RADIUS;
    const a = this.rng() * 2 * Math.PI;
    return [r * Math.cos(a), 0, r * Math.sin(a)];
  }

  private randomShadePos(): Vec3 {
    const a = this.rng() * 2 * Math.PI;
    return [SHADE_SPAWN_RING * Math.cos(a), SHADE_HOVER_Y, SHADE_SPAWN_RING * Math.sin(a)];
  }

  private addMote(pos: Vec3): Mote {
    const m = { id: `M${this.nextMoteNum++}`, pos };
    this.motes.push(m);
    return m;
  }

  private addShade(pos: Vec3, id?: string): Shade {
    let sid = id;
    if (!sid) {
      do sid = `S${this.nextShadeNum++}`;
      while (this.shades.some((s) => s.id === sid));
    }
    const s: Shade = { id: sid, pos, state: 'chase', stunTicks: 0 };
    this.shades.push(s);
    return s;
  }

  private emit(name: string, data: Record<string, unknown>): void {
    this.pending.push({ type: 'event', tick: this.steps, name, data });
  }

  private endGame(result: 'won' | 'lost', reason: 'all_lit' | 'dawn' | 'no_flames'): void {
    this.state = result;
    if (result === 'won') {
      const s = this.tuning.score;
      this.score += s.per_second_left * Math.floor(this.timeLeft + 1e-9) + s.per_flame_left * this.player.flames;
    }
    this.emit('game_over', { result, reason });
  }

  // ---------------------------------------------------------------- one tick
  /** Applies the input of tick k and produces state k+1. Events are stamped with tick k+1. */
  step(input: InputState): void {
    if (this.over) return;
    const t = this.tuning;
    const p = this.player;
    const edge = (k: 'jump' | 'interact' | 'pulse') => input[k] && !this.prev[k];
    this.steps += 1;

    // 1. timers
    if (p.invulnTicks > 0) p.invulnTicks--;
    if (p.pulseCooldownTicks > 0) p.pulseCooldownTicks--;
    for (const s of this.shades) {
      if (s.state === 'stunned' && --s.stunTicks <= 0) {
        s.state = 'chase';
        s.stunTicks = 0;
      }
    }

    // 2. player movement (camera-relative, normalized if |move| > 1)
    let [mx, mz] = input.move;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const th = (input.cam_yaw_deg * Math.PI) / 180;
    const wx = mx * Math.cos(th) + mz * Math.sin(th);
    const wz = -mx * Math.sin(th) + mz * Math.cos(th);
    p.pos[0] += wx * t.player_speed * DT;
    p.pos[2] += wz * t.player_speed * DT;
    const r = Math.hypot(p.pos[0], p.pos[2]);
    if (r > ISLAND_RADIUS) { // fall_enabled=false: the island edge is a soft wall
      p.pos[0] *= ISLAND_RADIUS / r;
      p.pos[2] *= ISLAND_RADIUS / r;
    }

    // 3. jump (vertical only; never affects XZ distances)
    if (edge('jump') && p.pos[1] <= 0) p.vy = JUMP_SPEED;
    if (p.pos[1] > 0 || p.vy > 0) {
      p.pos[1] += p.vy * DT;
      p.vy -= GRAVITY * DT;
      if (p.pos[1] <= 0) { p.pos[1] = 0; p.vy = 0; }
    }

    // 4. pick up motes (list order, up to capacity)
    for (let i = 0; i < this.motes.length && p.carried < t.carry_capacity; ) {
      if (distXZ(this.motes[i].pos, p.pos) <= t.pickup_radius) {
        this.motes.splice(i, 1);
        p.carried++;
        this.score += t.score.per_mote;
        this.emit('mote_picked', { carried: p.carried });
      } else i++;
    }

    // 5. interact: deposit into nearest unlit lantern in range
    if (edge('interact') && p.carried > 0) {
      let best: Lantern | undefined;
      let bestD = Infinity;
      for (const l of this.lanterns) {
        if (l.lit) continue;
        const d = distXZ(l.pos, p.pos);
        if (d <= t.interact_radius && d < bestD) { best = l; bestD = d; }
      }
      if (best) {
        const amount = Math.min(p.carried, Math.max(0, t.lantern_cost - best.deposited));
        if (amount > 0) {
          p.carried -= amount;
          best.deposited += amount;
          this.emit('deposit', { lantern_id: best.id, amount, deposited: best.deposited });
          if (best.deposited >= t.lantern_cost) {
            best.lit = true;
            this.score += t.score.per_lantern;
            this.emit('lantern_lit', { lantern_id: best.id });
            if (this.lanterns.every((l) => l.lit)) {
              this.endGame('won', 'all_lit');
              this.prev = input;
              return;
            }
          }
        }
      }
    }

    // 6. pulse: costs carried light, stuns + pushes shades in range
    if (edge('pulse') && p.pulseCooldownTicks === 0 && p.carried >= t.pulse_cost) {
      p.carried -= t.pulse_cost;
      p.pulseCooldownTicks = Math.round(t.pulse_cooldown_s * TICK_HZ);
      const stunned: string[] = [];
      for (const s of this.shades) {
        const d = distXZ(s.pos, p.pos);
        if (d > t.pulse_radius) continue;
        s.state = 'stunned';
        s.stunTicks = Math.round(t.pulse_stun_s * TICK_HZ);
        const [dx, dz] = d > 1e-9 ? [(s.pos[0] - p.pos[0]) / d, (s.pos[2] - p.pos[2]) / d] : [1, 0];
        s.pos[0] += dx * t.pulse_push_m;
        s.pos[2] += dz * t.pulse_push_m;
        this.keepOutOfSafeZones(s);
        stunned.push(s.id);
      }
      this.score += t.score.per_stun * stunned.length;
      this.emit('pulse', { stunned_ids: stunned });
    }

    // 7. shades chase (cannot enter safe_radius around any lantern)
    for (const s of this.shades) {
      if (s.state !== 'chase') continue;
      const d = distXZ(s.pos, p.pos);
      if (d > 1e-9) {
        const stepLen = Math.min(t.shade_speed * DT, d);
        s.pos[0] += ((p.pos[0] - s.pos[0]) / d) * stepLen;
        s.pos[2] += ((p.pos[2] - s.pos[2]) / d) * stepLen;
      }
      this.keepOutOfSafeZones(s);
    }

    // 8. shade touches player
    if (p.invulnTicks === 0) {
      const hitter = this.shades.find((s) => s.state === 'chase' && distXZ(s.pos, p.pos) <= t.shade_hit_radius);
      if (hitter) {
        p.flames -= 1;
        const dropped = Math.floor(p.carried * t.hit_drop_ratio);
        p.carried -= dropped;
        p.invulnTicks = Math.round(t.invuln_s * TICK_HZ);
        this.emit('player_hit', { by: 'shade', flames: p.flames, dropped });
        if (p.flames <= 0) {
          this.endGame('lost', 'no_flames');
          this.prev = input;
          return;
        }
      }
    }

    // 9. auto-spawns (disabled by scenario random_* = false)
    if (this.randomMotes && this.steps % MOTE_RESPAWN_TICKS === 0 && this.motes.length < MAX_MOTES) {
      this.addMote(this.randomMotePos());
    }
    if (this.randomShades && this.steps % SHADE_SPAWN_TICKS === 0 && this.shades.length < MAX_SHADES) {
      const s = this.addShade(this.randomShadePos());
      this.keepOutOfSafeZones(s);
      this.emit('shade_spawned', { id: s.id });
    }

    // 10. dawn
    if (this.timeLeftAtSetup - this.steps / TICK_HZ <= 1e-9) this.endGame('lost', 'dawn');

    this.prev = input;
  }

  private keepOutOfSafeZones(s: Shade): void {
    const R = this.tuning.safe_radius;
    for (const l of this.lanterns) {
      const d = distXZ(s.pos, l.pos);
      if (d >= R) continue;
      const [dx, dz] = d > 1e-9 ? [(s.pos[0] - l.pos[0]) / d, (s.pos[2] - l.pos[2]) / d] : [1, 0];
      s.pos[0] = l.pos[0] + dx * R;
      s.pos[2] = l.pos[2] + dz * R;
    }
  }

  // ---------------------------------------------------------------- output
  snapshot(): Record<string, unknown> {
    return {
      type: 'snapshot',
      tick: this.steps,
      sim_tick: this.steps,
      state: this.state,
      time_left_s: r3(this.timeLeft),
      score: this.score,
      player: { pos: v3(this.player.pos), flames: this.player.flames, carried: this.player.carried },
      lanterns: this.lanterns.map((l) => ({ id: l.id, pos: v3(l.pos), lit: l.lit, deposited: l.deposited })),
      shades: this.shades.map((s) => ({ id: s.id, pos: v3(s.pos), state: s.state })),
      motes_active: this.motes.length,
      motes: this.motes.map((m) => ({ id: m.id, pos: v3(m.pos) })),
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
