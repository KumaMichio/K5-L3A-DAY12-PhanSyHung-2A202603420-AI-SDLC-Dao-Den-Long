/**
 * Phase 1 behaviour, re-checked under the TICKET-02 standard numbers (regression).
 * Where Ticket-02 changed a Phase 1 rule, the test was updated and the reason is noted inline
 * ("SUPERSEDED: ..."); the full list is in docs/notes/phase-2.md.
 */
import { describe, expect, it } from 'vitest';
import { FormatError, parseInputs, parseScenario, type InputFrame } from '../src/sim/parse.js';
import { runHeadless } from '../src/sim/run.js';
import { T, dxz, quiet, run } from './helpers.js';

const N1 = ['L1', 'L2', 'L3', 'L4', 'L5'];

describe('tick model & output format', () => {
  it('tick-0 snapshot is the scenario state before input; --ticks N runs N steps; end is last', () => {
    const r = run(quiet(), [{ tick: 0, move: [0, 1] }], 30, 10);
    expect(r.snaps.map((s) => s.tick)).toEqual([0, 10, 20, 30]);
    expect(r.snaps[0].player.pos).toEqual([0, 0, 0]);
    expect(r.end).toEqual({ type: 'end', ticks: 30, state: 'playing', score: 0 });
    expect(r.at(30).time_left_s).toBe(T.night1_duration_s - 0.5);
    expect(r.at(30).sim_tick).toBe(30);
  });

  it('accelerates to player_speed within 0.1 s and stops within 0.1 s', () => {
    // SUPERSEDED: Phase 1 had instant speed. Ticket-02: accelerate/stop in <= 0.1 s (6 ticks).
    const r = run(quiet(), [{ tick: 0, move: [0, 1] }, { tick: 60, move: [0, 0] }], 70);
    expect(r.at(6).player.vel[2]).toBe(T.player_speed);
    expect(r.at(60).player.pos[2]).toBeCloseTo(5.75, 3); // 6 m/s for 1 s minus the 0.25 m ramp-up
    expect(r.at(66).player.vel).toEqual([0, 0, 0]);
  });

  it('applies camera yaw rotation and normalises |move| > 1', () => {
    const r = run(quiet(), [{ tick: 0, move: [0, 1], cam_yaw_deg: 90 }], 60);
    expect(r.at(60).player.pos[0]).toBeCloseTo(5.75, 2);
    expect(r.at(60).player.pos[2]).toBeCloseTo(0, 3);
    const d = run(quiet(), [{ tick: 0, move: [1, 1] }], 60).at(60).player.pos;
    expect(Math.hypot(d[0], d[2])).toBeCloseTo(5.75, 2); // rounded output -> 2 decimals
  });

  it('input fields are sticky; buttons fire only on false->true edges', () => {
    const frames: InputFrame[] = [{ tick: 0, pulse: true }, { tick: 5, move: [0, 1] }, { tick: 200, pulse: false }, { tick: 201, pulse: true }];
    const r = run(quiet({ player: { carried: 10 } }), frames, 210);
    expect(r.named('pulse').map((e) => e.tick)).toEqual([1, 202]);
  });
});

describe('fireflies & lanterns', () => {
  it('picks up within pickup_radius (<= r) only', () => {
    const r = run(quiet({ motes: [{ pos: [T.pickup_radius, 0, 0] }, { pos: [T.pickup_radius + 0.01, 0, 0] }] }), [], 1);
    expect(r.events).toEqual([{ type: 'event', tick: 1, name: 'mote_picked', data: { carried: 1 } }]);
    expect(r.end.score).toBe(0); // SUPERSEDED: v1.1 scores per firefly DEPOSITED, not picked
  });

  it('needs the height difference to be <= 1.5 m', () => {
    const r = run(quiet({ motes: [{ pos: [0.5, 1.5, 0] }, { pos: [0, 1.6, 0.5] }] }), [], 1);
    expect(r.named('mote_picked').length).toBe(1);
    expect(r.at(1).motes.map((m: { pos: number[] }) => m.pos)).toEqual([[0, 1.6, 0.5]]);
  });

  it('respects carry_capacity', () => {
    const motes = Array.from({ length: 13 }, () => ({ pos: [0, 0, 0.5] as [number, number, number] }));
    const r = run(quiet({ motes }), [], 1);
    expect(r.at(1).player.carried).toBe(T.carry_capacity);
    expect(r.at(1).motes_active).toBe(3);
  });

  it('interact deposits min(carried, missing) and lights at lantern_cost (+10/firefly +100/lantern)', () => {
    const sc = quiet({ player: { carried: 12 }, lanterns: [{ id: 'L1', pos: [0, 0, T.interact_radius] }] });
    const r = run(sc, [{ tick: 3, interact: true }], 10);
    expect(r.events.map((e) => [e.tick, e.name, e.data])).toEqual([
      [4, 'deposit', { lantern_id: 'L1', amount: 10, deposited: 10 }],
      [4, 'lantern_lit', { lantern_id: 'L1' }],
    ]);
    expect(r.end.score).toBe(10 * T.score.per_mote + T.score.per_lantern);
    expect(r.at(10).player.carried).toBe(2);
  });

  it('lanterns remember progress across deposits', () => {
    const sc = quiet({ player: { carried: 5 }, lanterns: [{ id: 'L1', pos: [0, 0, 1], deposited: 7 }] });
    const r = run(sc, [{ tick: 0, interact: true }], 2);
    expect(r.events.map((e) => e.name)).toEqual(['deposit', 'lantern_lit']);
    expect(r.events[0].data).toEqual({ lantern_id: 'L1', amount: 3, deposited: 10 });
    expect(r.at(2).player.carried).toBe(2);
  });

  it('chooses the nearest unlit lantern; ties go to the smaller id; out of range does nothing', () => {
    const tie = quiet({ player: { carried: 2 }, lanterns: [{ id: 'L2', pos: [1, 0, 0] }, { id: 'L1', pos: [-1, 0, 0] }] });
    expect(run(tie, [{ tick: 0, interact: true }], 1).events[0].data.lantern_id).toBe('L1');
    const far = quiet({ player: { carried: 2 }, lanterns: [{ id: 'L1', pos: [0, 0, T.interact_radius + 0.01] }] });
    expect(run(far, [{ tick: 0, interact: true }], 1).events).toEqual([]);
  });

  it('lighting the last lantern wins with time x2 + flame bonus; pre-lit lanterns score nothing', () => {
    const lit = N1.slice(1).map((id) => ({ id, lit: true }));
    const sc = quiet({ player: { carried: 10 }, lanterns: [...lit, { id: 'L1', pos: [0, 0, 1] }], time_left_s: 100 });
    const r = run(sc, [{ tick: 59, interact: true }], 600);
    expect(r.events.at(-1)).toEqual({ type: 'event', tick: 60, name: 'game_over', data: { result: 'won', reason: 'all_lit' } });
    expect(r.end).toEqual({ type: 'end', ticks: 60, state: 'won', score: 100 + 100 + 99 * 2 + 3 * 50 });
  });

  it('winning on the very tick time runs out is still a win', () => {
    const lit = N1.slice(1).map((id) => ({ id, lit: true }));
    const sc = quiet({ player: { carried: 10 }, lanterns: [...lit, { id: 'L1', pos: [0, 0, 1] }], time_left_s: 1 });
    const r = run(sc, [{ tick: 59, interact: true }], 600);
    expect(r.end).toMatchObject({ ticks: 60, state: 'won' });
  });
});

describe('shades, hits, pulse', () => {
  it('chases at shade_speed, hits within 1 m: -1 flame, drops floor(carried/2) into a 1.5-2.5 m ring, 90 ticks invuln, recoil', () => {
    const r = run(quiet({ player: { carried: 4 }, shades: [{ id: 'X', pos: [2.5, 0, 0] }] }), [], 300);
    const hits = r.named('player_hit');
    expect(hits[0]).toEqual({ type: 'event', tick: 23, name: 'player_hit', data: { by: 'shade', flames: 2, dropped: 2 } });
    const s = r.at(23);
    expect(s.shades[0].state).toBe('recoil');
    expect(s.player.invuln).toBe(true);
    const dropped = s.motes.filter((m: { kind: string }) => m.kind === 'dropped');
    expect(dropped.length).toBe(2);
    for (const m of dropped) {
      expect(dxz(m.pos, [0, 0, 0])).toBeGreaterThanOrEqual(1.5 - 1e-3);
      expect(dxz(m.pos, [0, 0, 0])).toBeLessThanOrEqual(2.5 + 1e-3);
      expect(m.ttl_s).toBe(8);
    }
    expect(hits[1].tick - hits[0].tick).toBeGreaterThanOrEqual(90);
  });

  it('touching an invulnerable Mây does nothing (no hit, no recoil)', () => {
    const r = run(quiet({ player: { invuln_ticks: 100 }, shades: [{ pos: [0.5, 1, 0] }] }), [], 60);
    expect(r.named('player_hit')).toEqual([]);
    expect(r.at(60).shades[0].state).toBe('chase');
  });

  it('losing the last flame ends the game (no_flames)', () => {
    const r = run(quiet({ player: { flames: 1 }, shades: [{ pos: [0.5, 1, 0] }] }), [], 100);
    expect(r.events.map((e) => e.name)).toEqual(['player_hit', 'game_over']);
    expect(r.events[1].data).toEqual({ result: 'lost', reason: 'no_flames' });
  });

  it('pulse: 3 fireflies, 3D radius 5 from feet + 0.8 m, stuns + pushes 4 m over 15 ticks, +5 each, 3 s cooldown', () => {
    const sc = quiet({ player: { carried: 6 }, shades: [{ id: 'A', pos: [4.9, 1, 0] }, { id: 'B', pos: [5.2, 1, 0] }] });
    const r = run(sc, [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 2, pulse: true }], 16);
    expect(r.named('pulse')).toEqual([{ type: 'event', tick: 1, name: 'pulse', data: { stunned_ids: ['A'] } }]);
    expect(r.at(15).shades[0]).toMatchObject({ id: 'A', state: 'stunned' });
    expect(r.at(15).shades[0].pos[0]).toBeCloseTo(4.9 + T.pulse_push_m, 3);
    expect(r.at(16).shades[0].pos[0]).toBeCloseTo(4.9 + T.pulse_push_m, 3); // push stops after 15 ticks
    expect(r.at(1).player.carried).toBe(3);
    expect(r.at(1).player.pulse_cd_s).toBe(3);
    expect(r.end.score).toBe(T.score.per_stun);
  });

  it('stun lasts 120 ticks; re-pulsing a stunned shade refreshes it and scores again', () => {
    const s = run(quiet({ player: { carried: 3 }, shades: [{ id: 'A', pos: [2, 1, 0], state: 'stunned', state_ticks_left: 10 }] }), [{ tick: 0, pulse: true }], 125);
    expect(s.named('pulse')[0].data.stunned_ids).toEqual(['A']);
    expect(s.at(120).shades[0].state).toBe('stunned');
    expect(s.at(121).shades[0].state).not.toBe('stunned');
    expect(s.end.score).toBe(T.score.per_stun);
  });

  it('pulse without 3 fireflies does nothing', () => {
    const r = run(quiet({ player: { carried: 2 }, shades: [{ pos: [2, 1, 0] }] }), [{ tick: 0, pulse: true }], 1);
    expect(r.named('pulse')).toEqual([]);
  });

  it('LIT lanterns are safe zones (unlit ones are not)', () => {
    // SUPERSEDED: Phase 1 assumption A6 (all lanterns protect). Ticket-02: only lit lanterns.
    const lit = run(quiet({ player: { pos: [0, 0, 25] }, lanterns: [{ id: 'L1', lit: true }], shades: [{ id: 'A', pos: [0, 1, 15] }] }), [], 900, 30);
    expect(lit.named('player_hit')).toEqual([]);
    for (const s of lit.snaps) expect(dxz(s.shades[0].pos, [0, 0, 25])).toBeGreaterThanOrEqual(T.safe_radius - 1e-3);
    const unlit = run(quiet({ player: { pos: [0, 0, 25] }, shades: [{ id: 'A', pos: [0, 1, 15] }] }), [], 900, 30);
    expect(unlit.named('player_hit').length).toBeGreaterThan(0);
  });

  it('a shade inside a lantern as it lights is pushed to the edge within 30 ticks and is harmless meanwhile', () => {
    const sc = quiet({ player: { pos: [0, 0, 24], carried: 10 }, shades: [{ id: 'A', pos: [0, 1, 27.5] }] });
    const r = run(sc, [{ tick: 0, interact: true }], 60);
    expect(r.named('lantern_lit').map((e) => e.tick)).toEqual([1]);
    expect(r.at(1).shades[0].state).toBe('recoil');
    expect(r.named('player_hit')).toEqual([]);
    expect(dxz(r.at(31).shades[0].pos, [0, 0, 25])).toBeGreaterThanOrEqual(T.safe_radius - 1e-3);
  });
});

describe('time, determinism, validation', () => {
  it('dawn: lost when time runs out', () => {
    const r = run(quiet({ time_left_s: 1 }), [], 1000, 10);
    expect(r.events.at(-1)).toMatchObject({ tick: 60, name: 'game_over', data: { result: 'lost', reason: 'dawn' } });
  });

  it('same seed + inputs -> identical output; different seed -> different world (all nights)', () => {
    const frames: InputFrame[] = [{ tick: 0, move: [0.3, 1] }, { tick: 100, pulse: true }, { tick: 400, dash: true }];
    for (const night of [1, 2, 3] as const) {
      const a = runHeadless({ tuning: T, seed: 42, night, ticks: 2500, frames });
      expect(runHeadless({ tuning: T, seed: 42, night, ticks: 2500, frames })).toEqual(a);
      expect(runHeadless({ tuning: T, seed: 43, night, ticks: 2500, frames })).not.toEqual(a);
    }
  });

  it('rejects malformed inputs and scenarios', () => {
    expect(() => parseInputs({ frames: [{ tick: 5 }, { tick: 5 }] })).toThrow(FormatError);
    expect(() => parseInputs({ frames: [{ tick: 0, move: [2, 0] }] })).toThrow(FormatError);
    expect(() => parseInputs({ frames: [{ tick: 0, dash: 'yes' }] })).toThrow(FormatError);
    expect(() => parseScenario({ motes: [[0, 0]] }, N1)).toThrow(FormatError);
    expect(() => parseScenario({ lanterns: [{ id: 'L6' }] }, N1)).toThrow(FormatError);
    expect(() => parseScenario({ shades: [{ pos: [0, 0, 0], state: 'sleeping' }] }, N1)).toThrow(FormatError);
    expect(() => parseScenario({ drifters: [{ pos: [0, 0, 0], state: 'chase', stolen: -1 }] }, N1)).toThrow(FormatError);
    expect(parseScenario({ lanterns: [{ id: 'L6' }] }, [...N1, 'L6']).lanterns).toEqual([{ id: 'L6' }]);
  });
});
