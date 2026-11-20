/** Strict validation of the contract's inputs/scenario files. Any problem -> FormatError (CLI exit 2). */
import type { InputState, Scenario, Vec3 } from './types.js';

export class FormatError extends Error {}

export interface InputFrame {
  tick: number;
  move?: [number, number];
  cam_yaw_deg?: number;
  jump?: boolean;
  interact?: boolean;
  pulse?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

function vec3(v: unknown, where: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) throw new FormatError(`${where}: expected [x, y, z] numbers`);
  return [v[0], v[1], v[2]];
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') throw new FormatError(`${where}: expected boolean`);
  return v;
}

function nonNegInt(v: unknown, where: string): number {
  if (!isInt(v) || (v as number) < 0) throw new FormatError(`${where}: expected integer >= 0`);
  return v as number;
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
    for (const k of ['jump', 'interact', 'pulse', 'dash'] as const) {
      if (f[k] !== undefined) {
        const b = bool(f[k], `${w}.${k}`);
        if (k !== 'dash') out[k] = b; // dash: accepted, not implemented in Phase 1
      }
    }
    return out;
  });
}

/** Walks frames tick by tick: sticky fields, defaults before the first frame. */
export class InputTimeline {
  private i = 0;
  private cur: InputState = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false };
  constructor(private readonly frames: InputFrame[]) {}

  /** Must be called with tick = 0, 1, 2, ... in order. */
  at(tick: number): InputState {
    while (this.i < this.frames.length && this.frames[this.i].tick <= tick) {
      const f = this.frames[this.i++];
      this.cur = {
        move: f.move ?? this.cur.move,
        cam_yaw_deg: f.cam_yaw_deg ?? this.cur.cam_yaw_deg,
        jump: f.jump ?? this.cur.jump,
        interact: f.interact ?? this.cur.interact,
        pulse: f.pulse ?? this.cur.pulse,
      };
    }
    return this.cur;
  }
}

export function parseScenario(raw: unknown, lanternCount: number): Scenario {
  if (!isObj(raw)) throw new FormatError('scenario: expected object');
  const s: Scenario = {};
  if (raw.player !== undefined) {
    const p = raw.player;
    if (!isObj(p)) throw new FormatError('scenario.player: expected object');
    s.player = {};
    if (p.pos !== undefined) s.player.pos = vec3(p.pos, 'scenario.player.pos');
    if (p.carried !== undefined) s.player.carried = nonNegInt(p.carried, 'scenario.player.carried');
    if (p.flames !== undefined) s.player.flames = nonNegInt(p.flames, 'scenario.player.flames');
  }
  if (raw.random_motes !== undefined) s.random_motes = bool(raw.random_motes, 'scenario.random_motes');
  if (raw.random_shades !== undefined) s.random_shades = bool(raw.random_shades, 'scenario.random_shades');
  if (raw.motes !== undefined) {
    if (!Array.isArray(raw.motes)) throw new FormatError('scenario.motes: expected array');
    s.motes = raw.motes.map((m, i) => vec3(m, `scenario.motes[${i}]`));
  }
  if (raw.shades !== undefined) {
    if (!Array.isArray(raw.shades)) throw new FormatError('scenario.shades: expected array');
    const ids = new Set<string>();
    s.shades = raw.shades.map((sh, i) => {
      if (!isObj(sh)) throw new FormatError(`scenario.shades[${i}]: expected object`);
      const out: { id?: string; pos: Vec3 } = { pos: vec3(sh.pos, `scenario.shades[${i}].pos`) };
      if (sh.id !== undefined) {
        if (typeof sh.id !== 'string' || ids.has(sh.id)) throw new FormatError(`scenario.shades[${i}].id: expected unique string`);
        ids.add(sh.id);
        out.id = sh.id;
      }
      return out;
    });
  }
  if (raw.lanterns !== undefined) {
    if (!Array.isArray(raw.lanterns)) throw new FormatError('scenario.lanterns: expected array');
    const valid = new Set(Array.from({ length: lanternCount }, (_, k) => `L${k + 1}`));
    s.lanterns = raw.lanterns.map((l, i) => {
      const w = `scenario.lanterns[${i}]`;
      if (!isObj(l) || typeof l.id !== 'string' || !valid.has(l.id)) throw new FormatError(`${w}.id: expected one of L1..L${lanternCount}`);
      const out: { id: string; pos?: Vec3; lit?: boolean; deposited?: number } = { id: l.id };
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
