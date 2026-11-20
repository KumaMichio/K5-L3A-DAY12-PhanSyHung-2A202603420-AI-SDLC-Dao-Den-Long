import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FormatError, parseInputs, parseScenario, type InputFrame } from '../src/sim/parse.js';
import { runHeadless } from '../src/sim/run.js';
import { distXZ } from '../src/sim/sim.js';
import type { Scenario, Tuning } from '../src/sim/types.js';

const T: Tuning = JSON.parse(readFileSync('game.contract.json', 'utf8')).tuning;

/** Empty, quiet world: only what the test lists. */
const quiet = (extra: Scenario = {}): Scenario => ({ random_motes: false, random_shades: false, motes: [], shades: [], ...extra });

function run(scenario: Scenario, frames: InputFrame[] = [], ticks = 60, snapshotEvery = 1) {
  const lines = runHeadless({ tuning: T, seed: 1, ticks, snapshotEvery, scenario, frames }).map((l) => JSON.parse(l));
  return {
    lines,
    snaps: lines.filter((l) => l.type === 'snapshot'),
    events: lines.filter((l) => l.type === 'event'),
    end: lines[lines.length - 1],
  };
}

describe('tick model & output format', () => {
  it('tick-0 snapshot is the scenario state before input; --ticks N runs N steps; end is last', () => {
    const r = run(quiet(), [{ tick: 0, move: [0, 1] }], 30, 10);
    expect(r.snaps.map((s) => s.tick)).toEqual([0, 10, 20, 30]);
    expect(r.snaps[0].player.pos).toEqual([0, 0, 0]);
    expect(r.end).toEqual({ type: 'end', ticks: 30, state: 'playing', score: 0 });
    expect(r.snaps[3].time_left_s).toBe(T.night1_duration_s - 0.5);
    expect(r.snaps[3].sim_tick).toBe(30);
  });

  it('moves player_speed m/s along +Z with move [0,1] at yaw 0', () => {
    const r = run(quiet(), [{ tick: 0, move: [0, 1] }], 60);
    expect(r.end.ticks).toBe(60);
    expect(r.snaps[60].player.pos).toEqual([0, 0, T.player_speed]);
  });

  it('applies camera yaw rotation and normalises |move| > 1', () => {
    // yaw 90: z=1 -> world +X ; diagonal [1,1] normalised to length 1
    const r = run(quiet(), [{ tick: 0, move: [0, 1], cam_yaw_deg: 90 }], 60);
    expect(r.snaps[60].player.pos[0]).toBeCloseTo(T.player_speed, 3);
    expect(r.snaps[60].player.pos[2]).toBeCloseTo(0, 3);
    const d = run(quiet(), [{ tick: 0, move: [1, 1] }], 60).snaps[60].player.pos;
    // output coords are rounded to 3 decimals, so the recomputed length is only accurate to ~1e-3
    expect(Math.hypot(d[0], d[2])).toBeCloseTo(T.player_speed, 2);
  });

  it('input fields are sticky; buttons fire only on false->true edges', () => {
    const frames: InputFrame[] = [{ tick: 0, pulse: true }, { tick: 5, move: [0, 1] }, { tick: 200, pulse: false }, { tick: 201, pulse: true }];
    const r = run(quiet({ player: { carried: 10 } }), frames, 210);
    expect(r.events.filter((e) => e.name === 'pulse').map((e) => e.tick)).toEqual([1, 202]);
  });
});

describe('motes & lanterns', () => {
  it('picks up a mote exactly at pickup_radius (<= r), not beyond', () => {
    const r = run(quiet({ motes: [[T.pickup_radius, 0, 0], [T.pickup_radius + 0.01, 0, 0]] }), [], 1);
    expect(r.events).toEqual([{ type: 'event', tick: 1, name: 'mote_picked', data: { carried: 1 } }]);
    expect(r.end.score).toBe(T.score.per_mote);
  });

  it('respects carry_capacity', () => {
    const motes = Array.from({ length: T.carry_capacity + 3 }, () => [0, 0, 0.5] as [number, number, number]);
    const r = run(quiet({ motes }), [], 1);
    expect(r.end.ticks).toBe(1);
    expect(r.snaps[1].player.carried).toBe(T.carry_capacity);
    expect(r.snaps[1].motes_active).toBe(3);
  });

  it('interact deposits up to lantern_cost and lights the lantern (deposit then lantern_lit)', () => {
    const sc = quiet({ player: { carried: T.lantern_cost + 2 }, lanterns: [{ id: 'L1', pos: [0, 0, T.interact_radius] }] });
    const r = run(sc, [{ tick: 3, interact: true }], 10);
    expect(r.events.map((e) => [e.tick, e.name, e.data])).toEqual([
      [4, 'deposit', { lantern_id: 'L1', amount: T.lantern_cost, deposited: T.lantern_cost }],
      [4, 'lantern_lit', { lantern_id: 'L1' }],
    ]);
    expect(r.end.score).toBe(T.score.per_lantern);
    expect(r.snaps[10].player.carried).toBe(2);
  });

  it('partial deposit does not light; out-of-range interact does nothing', () => {
    const sc = quiet({ player: { carried: 2 }, lanterns: [{ id: 'L1', pos: [0, 0, 1] }, { id: 'L2', pos: [0, 0, T.interact_radius + 0.1] }] });
    const r = run(sc, [{ tick: 0, interact: true }], 2);
    expect(r.events).toEqual([{ type: 'event', tick: 1, name: 'deposit', data: { lantern_id: 'L1', amount: 2, deposited: 2 } }]);
  });

  it('lighting the last lantern wins with time + flame bonus; pre-lit lanterns score nothing', () => {
    const lanterns = ['L2', 'L3', 'L4', 'L5'].map((id) => ({ id, lit: true }));
    const sc = quiet({ player: { carried: T.lantern_cost }, lanterns: [...lanterns, { id: 'L1', pos: [0, 0, 1] }], time_left_s: 100 });
    const r = run(sc, [{ tick: 59, interact: true }], 600);
    expect(r.events.at(-1)).toEqual({ type: 'event', tick: 60, name: 'game_over', data: { result: 'won', reason: 'all_lit' } });
    expect(r.end).toEqual({ type: 'end', ticks: 60, state: 'won', score: T.score.per_lantern + 99 * T.score.per_second_left + T.flames * T.score.per_flame_left });
  });
});

describe('shades, hits, pulse', () => {
  it('shade chases at shade_speed and hits within shade_hit_radius; drops motes; invulnerability', () => {
    const sc = quiet({ player: { carried: 4 }, shades: [{ id: 'X', pos: [3, 0, 0] }] });
    const r = run(sc, [], 300);
    expect(r.snaps[60].shades[0].pos[0]).toBeLessThan(3); // moving toward the player
    const hits = r.events.filter((e) => e.name === 'player_hit');
    const first = hits[0];
    // starts 3 m away, hit when distance <= hit radius
    expect(first.tick).toBe(Math.ceil(((3 - T.shade_hit_radius) / T.shade_speed) * 60 - 1e-9));
    expect(first.data).toEqual({ by: 'shade', flames: T.flames - 1, dropped: Math.floor(4 * T.hit_drop_ratio) });
    expect(hits[1].tick - first.tick).toBe(Math.round(T.invuln_s * 60));
  });

  it('losing the last flame ends the game (no_flames)', () => {
    const r = run(quiet({ player: { flames: 1 }, shades: [{ pos: [0.5, 0, 0] }] }), [], 100);
    expect(r.events.map((e) => e.name)).toEqual(['player_hit', 'game_over']);
    expect(r.events[1].data).toEqual({ result: 'lost', reason: 'no_flames' });
    expect(r.end).toMatchObject({ ticks: 1, state: 'lost' });
  });

  it('pulse costs pulse_cost, stuns + pushes shades within pulse_radius, scores per_stun, has cooldown', () => {
    const sc = quiet({ player: { carried: 6 }, shades: [{ id: 'A', pos: [T.pulse_radius, 0, 0] }, { id: 'B', pos: [-(T.pulse_radius + 1), 0, 0] }] });
    const frames: InputFrame[] = [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 2, pulse: true }];
    const r = run(sc, frames, 5);
    const pulses = r.events.filter((e) => e.name === 'pulse');
    expect(pulses).toEqual([{ type: 'event', tick: 1, name: 'pulse', data: { stunned_ids: ['A'] } }]); // 2nd blocked by cooldown
    const a = r.snaps[1].shades.find((s: { id: string }) => s.id === 'A');
    expect(a.state).toBe('stunned');
    expect(a.pos[0]).toBeCloseTo(T.pulse_radius + T.pulse_push_m, 3);
    expect(r.snaps[1].player.carried).toBe(6 - T.pulse_cost);
    expect(r.end.score).toBe(T.score.per_stun);
  });

  it('stun lasts pulse_stun_s then shade chases again', () => {
    const r = run(quiet({ player: { carried: 2 }, shades: [{ id: 'A', pos: [2, 0, 0] }] }), [{ tick: 0, pulse: true }], 400);
    const stunTicks = Math.round(T.pulse_stun_s * 60);
    expect(r.snaps[stunTicks].shades[0].state).toBe('stunned');
    expect(r.snaps[stunTicks + 1].shades[0].state).toBe('chase');
  });

  it('pulse without enough light does nothing', () => {
    const r = run(quiet({ player: { carried: T.pulse_cost - 1 }, shades: [{ pos: [2, 0, 0] }] }), [{ tick: 0, pulse: true }], 1);
    expect(r.events.filter((e) => e.name === 'pulse')).toEqual([]);
  });

  it('shades never enter safe_radius around a lantern (player standing at the lantern is safe)', () => {
    const sc = quiet({ player: { pos: [0, 0, 25] }, shades: [{ id: 'A', pos: [0, 0, 5] }] });
    const r = run(sc, [], 900);
    expect(r.events.filter((e) => e.name === 'player_hit')).toEqual([]);
    for (const s of r.snaps) expect(distXZ(s.shades[0].pos, [0, 0, 25])).toBeGreaterThanOrEqual(T.safe_radius - 1e-3);
  });
});

describe('time, spawning, determinism', () => {
  it('dawn: game lost when time runs out', () => {
    const r = run(quiet({ time_left_s: 1 }), [], 1000, 10);
    expect(r.events.at(-1)).toMatchObject({ tick: 60, name: 'game_over', data: { result: 'lost', reason: 'dawn' } });
    expect(r.end).toMatchObject({ ticks: 60, state: 'lost' });
  });

  it('random_* false disables auto-spawn; default game spawns shades with events', () => {
    expect(run(quiet(), [], 3000, 100).events).toEqual([]);
    const r = runHeadless({ tuning: T, seed: 3, ticks: 2700, snapshotEvery: 2700, scenario: { player: { pos: [0, 0, 25] } } }).map((l) => JSON.parse(l));
    expect(r.filter((l) => l.name === 'shade_spawned').map((l) => l.data.id)).toEqual(['S3']);
  });

  it('same seed + inputs -> identical output; different seed -> different world', () => {
    const frames: InputFrame[] = [{ tick: 0, move: [0.3, 1] }, { tick: 100, pulse: true }];
    const a = runHeadless({ tuning: T, seed: 42, ticks: 1200, frames });
    const b = runHeadless({ tuning: T, seed: 42, ticks: 1200, frames });
    const c = runHeadless({ tuning: T, seed: 43, ticks: 1200, frames });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('file validation', () => {
  it('rejects malformed inputs', () => {
    expect(() => parseInputs({ frames: [{ tick: 5 }, { tick: 5 }] })).toThrow(FormatError);
    expect(() => parseInputs({ frames: [{ tick: 0, move: [2, 0] }] })).toThrow(FormatError);
    expect(() => parseInputs({ frames: [{ tick: 0, pulse: 'yes' }] })).toThrow(FormatError);
    expect(() => parseInputs([])).toThrow(FormatError);
  });
  it('rejects malformed scenarios', () => {
    expect(() => parseScenario({ motes: [[0, 0]] }, 5)).toThrow(FormatError);
    expect(() => parseScenario({ lanterns: [{ id: 'L9' }] }, 5)).toThrow(FormatError);
    expect(() => parseScenario({ player: { carried: -1 } }, 5)).toThrow(FormatError);
  });
});
