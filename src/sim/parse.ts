/** Strict validation of the contract's inputs/scenario files (v1.1). Any problem -> FormatError (CLI exit 2). */
import { BUTTONS, DRIFTER_STATES, SHADE_STATES, neutralInput } from './types.js';
import type { Button, DrifterState, InputState, Scenario, ScenarioMote, ShadeState, Vec3 } from './types.js';

export class FormatError extends Error {}

export interface InputFrame {
  tick: number;
  move?: [number, number];
  cam_yaw_deg?: number;
  jump?: boolean;
  interact?: boolean;
  pulse?: boolean;
  dash?: boolean;
  pause?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function vec3(v: unknown, where: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) throw new FormatError(`${where}: expected [x, y, z] numbers`);
  return [v[0], v[1], v[2]];
}
function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') throw new FormatError(`${where}: expected boolean`);
  return v;
}
function nonNegInt(v: unknown, where: string): number {
  if (!Number.isInteger(v) || (v as number) < 0) throw new FormatError(`${where}: expected integer >= 0`);
  return v as number;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new FormatError(`${where}: expected one of ${allowed.join(', ')}`);
  return v as T;
}
function optId(v: unknown, ids: Set<string>, where: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || ids.has(v)) throw new FormatError(`${where}: expected unique string`);
  ids.add(v);
  return v;
}
function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new FormatError(`${where}: expected array`);
  return v;
}

export function parseInputs(raw: unknown): InputFrame[] {
  if (!isObj(raw) || !Array.isArray(raw.frames)) throw new FormatError('inputs: expected {"frames": [...]}');
  let lastTick = -1;
  return raw.frames.map((f, i) => {
    const w = `inputs.frames[${i}]`;
    if (!isObj(f)) throw new FormatError(`${w}: expected object`);
    const tick = nonNegInt(f.tick, `${w}.tick`);
    if (tick <= lastTick) throw new FormatError(`${w}.tick: ticks must be strictly increasing`);
    lastTick = tick;
    const out: InputFrame = { tick };
    if (f.move !== undefined) {
      const m = f.move;
      if (!Array.isArray(m) || m.length !== 2 || !m.every((x) => isNum(x) && x >= -1 && x <= 1)) {
        throw new FormatError(`${w}.move: expected [x, z] with each in [-1, 1]`);
      }
      out.move = [m[0], m[1]];
    }
    if (f.cam_yaw_deg !== undefined) {
      if (!isNum(f.cam_yaw_deg)) throw new FormatError(`${w}.cam_yaw_deg: expected number`);
      out.cam_yaw_deg = f.cam_yaw_deg;
    }
    for (const k of BUTTONS) if (f[k] !== undefined) out[k] = bool(f[k], `${w}.${k}`);
    return out;
  });
}

/** Walks frames tick by tick: sticky fields, defaults before the first frame. */
export class InputTimeline {
  private i = 0;
  private cur: InputState = neutralInput();
  constructor(private readonly frames: InputFrame[]) {}

  /** Must be called with tick = 0, 1, 2, ... in order. */
  at(tick: number): InputState {
    while (this.i < this.frames.length && this.frames[this.i].tick <= tick) {
      const f = this.frames[this.i++];
      const next: InputState = { ...this.cur, move: f.move ?? this.cur.move, cam_yaw_deg: f.cam_yaw_deg ?? this.cur.cam_yaw_deg };
      for (const k of BUTTONS) next[k as Button] = f[k] ?? this.cur[k];
      this.cur = next;
    }
    return this.cur;
  }
}

export function parseScenario(raw: unknown, lanternIds: string[]): Scenario {
  if (!isObj(raw)) throw new FormatError('scenario: expected object');
  const s: Scenario = {};
  if (raw.player !== undefined) {
    const p = raw.player;
    if (!isObj(p)) throw new FormatError('scenario.player: expected object');
    s.player = {};
    if (p.pos !== undefined) s.player.pos = vec3(p.pos, 'scenario.player.pos');
    for (const k of ['carried', 'flames', 'invuln_ticks', 'dash_cd_ticks', 'pulse_cd_ticks', 'charm_ticks', 'successful_lights'] as const) {
      if (p[k] !== undefined) s.player[k] = nonNegInt(p[k], `scenario.player.${k}`);
    }
  }
  for (const k of ['random_motes', 'random_shades', 'random_drifters', 'wind_enabled'] as const) {
    if (raw[k] !== undefined) s[k] = bool(raw[k], `scenario.${k}`);
  }
  if (raw.motes !== undefined) {
    s.motes = arr(raw.motes, 'scenario.motes').map((m, i): ScenarioMote => {
      const w = `scenario.motes[${i}]`;
      if (Array.isArray(m)) return { pos: vec3(m, w) };
      if (!isObj(m)) throw new FormatError(`${w}: expected [x, y, z] or {pos, kind?, ttl_ticks?}`);
      const out: ScenarioMote = { pos: vec3(m.pos, `${w}.pos`) };
      if (m.kind !== undefined) out.kind = oneOf(m.kind, ['random', 'dropped'] as const, `${w}.kind`);
      if (m.ttl_ticks !== undefined) out.ttl_ticks = nonNegInt(m.ttl_ticks, `${w}.ttl_ticks`);
      else if (m.ttl_s !== undefined) {
        if (!isNum(m.ttl_s) || m.ttl_s < 0) throw new FormatError(`${w}.ttl_s: expected number >= 0`);
        out.ttl_ticks = Math.round(m.ttl_s * 60);
      }
      return out;
    });
  }
  if (raw.shades !== undefined) {
    const ids = new Set<string>();
    s.shades = arr(raw.shades, 'scenario.shades').map((sh, i) => {
      const w = `scenario.shades[${i}]`;
      if (!isObj(sh)) throw new FormatError(`${w}: expected object`);
      const out: { id?: string; pos: Vec3; state?: ShadeState; state_ticks_left?: number; target_lantern_id?: string } = { pos: vec3(sh.pos, `${w}.pos`) };
      if (sh.target_lantern_id !== undefined) {
        if (typeof sh.target_lantern_id !== 'string' || !lanternIds.includes(sh.target_lantern_id)) throw new FormatError(`${w}.target_lantern_id: expected one of ${lanternIds.join(', ')}`);
        out.target_lantern_id = sh.target_lantern_id;
      }
      out.id = optId(sh.id, ids, `${w}.id`);
      if (sh.state !== undefined) out.state = oneOf(sh.state, SHADE_STATES, `${w}.state`);
      if (sh.state_ticks_left !== undefined) out.state_ticks_left = nonNegInt(sh.state_ticks_left, `${w}.state_ticks_left`);
      return out;
    });
  }
  if (raw.drifters !== undefined) {
    const ids = new Set<string>();
    s.drifters = arr(raw.drifters, 'scenario.drifters').map((d, i) => {
      const w = `scenario.drifters[${i}]`;
      if (!isObj(d)) throw new FormatError(`${w}: expected object`);
      const out: { id?: string; pos: Vec3; state?: DrifterState; stolen?: number } = { pos: vec3(d.pos, `${w}.pos`) };
      out.id = optId(d.id, ids, `${w}.id`);
      if (d.state !== undefined) out.state = oneOf(d.state, DRIFTER_STATES, `${w}.state`);
      if (d.stolen !== undefined) out.stolen = nonNegInt(d.stolen, `${w}.stolen`);
      return out;
    });
  }
  if (raw.charms !== undefined) {
    const ids = new Set<string>();
    s.charms = arr(raw.charms, 'scenario.charms').map((c, i) => {
      const w = `scenario.charms[${i}]`;
      if (!isObj(c)) throw new FormatError(`${w}: expected object`);
      const out: { id?: string; pos: Vec3; available?: boolean; respawn_ticks?: number } = { pos: vec3(c.pos, `${w}.pos`) };
      out.id = optId(c.id, ids, `${w}.id`);
      if (c.available !== undefined) out.available = bool(c.available, `${w}.available`);
      if (c.respawn_ticks !== undefined) out.respawn_ticks = nonNegInt(c.respawn_ticks, `${w}.respawn_ticks`);
      return out;
    });
  }
  if (raw.lanterns !== undefined) {
    const valid = new Set(lanternIds);
    s.lanterns = arr(raw.lanterns, 'scenario.lanterns').map((l, i) => {
      const w = `scenario.lanterns[${i}]`;
      if (!isObj(l) || typeof l.id !== 'string' || !valid.has(l.id)) throw new FormatError(`${w}.id: expected one of ${lanternIds.join(', ')}`);
      const out: { id: string; pos?: Vec3; lit?: boolean; deposited?: number; fuel?: number; ever_lit?: boolean } = { id: l.id };
      if (l.fuel !== undefined) {
        if (!isNum(l.fuel) || l.fuel < 0) throw new FormatError(`${w}.fuel: expected number >= 0`);
        out.fuel = l.fuel;
      }
      if (l.ever_lit !== undefined) out.ever_lit = bool(l.ever_lit, `${w}.ever_lit`);
      if (l.pos !== undefined) out.pos = vec3(l.pos, `${w}.pos`);
      if (l.lit !== undefined) out.lit = bool(l.lit, `${w}.lit`);
      if (l.deposited !== undefined) out.deposited = nonNegInt(l.deposited, `${w}.deposited`);
      return out;
    });
  }
  if (raw.time_left_s !== undefined) {
    if (!isNum(raw.time_left_s) || raw.time_left_s < 0) throw new FormatError('scenario.time_left_s: expected number >= 0');
    s.time_left_s = raw.time_left_s;
  }
  return s;
}
