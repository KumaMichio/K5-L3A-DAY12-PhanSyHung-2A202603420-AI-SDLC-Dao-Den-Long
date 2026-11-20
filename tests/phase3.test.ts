/** TICKET-03 "Đèn cạn dầu": fuel, drain, dawn win, capacity, scoring, contract v1.2 fields. */
import { describe, expect, it } from 'vitest';
import { dxz, quiet, run } from './helpers.js';

const L1 = [0, 0, 25];
const lit = (ids: string[], fuel?: number) => ids.map((id) => (fuel === undefined ? { id, lit: true } : { id, lit: true, fuel }));

describe('contract v1.2 fields', () => {
  it('lanterns carry fuel (1 dp; 0 when off), ever_lit, relit_count; lit without fuel = 100; player has capacity', () => {
    const r = run(quiet({ lanterns: [{ id: 'L1', lit: true }] }), [], 0);
    const l = r.snaps[0].lanterns;
    expect(Object.keys(l[0])).toEqual(['id', 'pos', 'lit', 'deposited', 'fuel', 'ever_lit', 'relit_count']);
    expect(l[0]).toMatchObject({ lit: true, fuel: 100, ever_lit: true, relit_count: 0 });
    expect(l[1]).toMatchObject({ lit: false, fuel: 0, ever_lit: false });
    expect(r.snaps[0].player.capacity).toBe(10);
  });
});

describe('fuel', () => {
  it('decays 1/s while lit; at fuel <= 0 the lantern goes out (lantern_out, deposited 0, ever_lit kept)', () => {
    const r = run(quiet({ player: { pos: [0, 0, -30] }, lanterns: lit(['L1'], 1) }), [], 70);
    expect(r.at(30).lanterns[0].fuel).toBe(0.5);
    expect(r.named('lantern_out')).toEqual([{ type: 'event', tick: 60, name: 'lantern_out', data: { lantern_id: 'L1' } }]);
    expect(r.at(60).lanterns[0]).toMatchObject({ lit: false, fuel: 0, deposited: 0, ever_lit: true });
    const long = run(quiet({ lanterns: lit(['L1']) }), [], 600, 600);
    expect(long.at(600).lanterns[0].fuel).toBe(90);
  });

  it('refuel: used = min(carried, ceil((100 - fuel)/10)), fuel = min(100, fuel + 10 x used), +5 per firefly', () => {
    const r = run(quiet({ player: { carried: 10 }, lanterns: [{ id: 'L1', pos: [0, 0, 1], lit: true, fuel: 55 }] }), [{ tick: 0, interact: true }], 1);
    // step 2 decays first: 55 - 1/60 -> ceil(45.02 / 10) = 5 fireflies
    expect(r.events).toEqual([{ type: 'event', tick: 1, name: 'refuel', data: { lantern_id: 'L1', amount: 5, fuel: 100 } }]);
    expect(r.at(1).player.carried).toBe(5);
    expect(r.end.score).toBe(25);
    const few = run(quiet({ player: { carried: 2 }, lanterns: [{ id: 'L1', pos: [0, 0, 1], lit: true, fuel: 40 }] }), [{ tick: 0, interact: true }], 1);
    expect(few.events[0].data).toEqual({ lantern_id: 'L1', amount: 2, fuel: 60 });
  });

  it('interact picks the nearest RECEIVING lantern (unlit, or lit and not full); ties -> smaller id', () => {
    const r = run(quiet({ player: { carried: 3 }, lanterns: [{ id: 'L2', pos: [1, 0, 0], lit: true, fuel: 50 }, { id: 'L1', pos: [-1, 0, 0] }] }), [{ tick: 0, interact: true }], 1);
    expect(r.events[0]).toMatchObject({ name: 'deposit', data: { lantern_id: 'L1' } });
  });

  it('relight costs 5 for a lantern that was ever lit (+40, relit_count+1); first light costs 10 (+100)', () => {
    const r = run(quiet({ player: { carried: 5 }, lanterns: [{ id: 'L1', pos: [0, 0, 1], ever_lit: true }] }), [{ tick: 0, interact: true }], 1);
    expect(r.events.map((e) => [e.name, e.data])).toEqual([
      ['deposit', { lantern_id: 'L1', amount: 5, deposited: 5 }],
      ['lantern_lit', { lantern_id: 'L1', relight: true }],
    ]);
    expect(r.at(1).lanterns[0]).toMatchObject({ lit: true, fuel: 100, relit_count: 1, ever_lit: true });
    expect(r.end.score).toBe(5 * 5 + 40);
  });

  it('a lantern that burns out remembers ever_lit and relights for 5', () => {
    const r = run(quiet({ player: { pos: [0, 0, 1], carried: 5 }, lanterns: [{ id: 'L1', pos: [0, 0, 0], lit: true, fuel: 0.5 }] }), [{ tick: 40, interact: true }], 41);
    expect(r.named('lantern_out')[0].tick).toBe(30);
    expect(r.named('lantern_lit')[0]).toMatchObject({ tick: 41, data: { lantern_id: 'L1', relight: true } });
  });
});

describe('capacity grows with successful lights', () => {
  it('capacity = 10 + 2 x successful_lights, max 20; relights count, pre-lit lanterns do not', () => {
    const r = run(quiet({ player: { carried: 10 }, lanterns: [{ id: 'L1', pos: [0, 0, 1] }, { id: 'L2', lit: true }] }), [{ tick: 0, interact: true }], 1);
    expect(r.at(0).player.capacity).toBe(10);
    expect(r.at(1).player.capacity).toBe(12);
    expect(run(quiet({ player: { successful_lights: 4 } }), [], 0).snaps[0].player.capacity).toBe(18);
    expect(run(quiet({ player: { successful_lights: 9 } }), [], 0).snaps[0].player.capacity).toBe(20);
    const motes = Array.from({ length: 15 }, () => ({ pos: [0, 0, 0.5] as [number, number, number] }));
    expect(run(quiet({ player: { successful_lights: 2 }, motes }), [], 1).at(1).player.carried).toBe(14);
  });
});

describe('safe zone needs fuel >= 30', () => {
  it('exactly 30 still protects; below 30 the zone is gone', () => {
    const sc = quiet({ player: { pos: L1 as [number, number, number] }, lanterns: lit(['L1'], 30 + 1 / 60), shades: [{ id: 'A', pos: [0, 1, 25 - 6.05] }] });
    const r = run(sc, [], 4);
    expect(r.at(1).lanterns[0].fuel).toBe(30);
    expect(dxz(r.at(1).shades[0].pos, L1)).toBeGreaterThanOrEqual(6 - 1e-3);
    expect(dxz(r.at(3).shades[0].pos, L1)).toBeLessThan(6);
  });
});

describe('drain', () => {
  it('a wandering shade walks to the nearest weak lantern, drains 5/s (+1/s decay), reports fuel_drain every 60 ticks, leaves when it goes out', () => {
    const sc = quiet({ player: { pos: [0, 0, -30] }, lanterns: lit(['L1'], 20), shades: [{ id: 'A', pos: [0, 1, 20], state: 'wander' }] });
    const r = run(sc, [], 400, 1);
    const start = r.snaps.find((s) => s.shades[0].state === 'drain');
    expect(start).toBeDefined();
    expect(dxz(start.shades[0].pos, L1)).toBeLessThanOrEqual(2);
    const t0 = start.tick;
    expect(r.at(t0 + 60).lanterns[0].fuel).toBeCloseTo(start.lanterns[0].fuel - 6, 1);
    const drains = r.named('fuel_drain');
    expect(drains[0]).toMatchObject({ tick: t0 + 60, data: { lantern_id: 'L1', shade_id: 'A' } });
    const out = r.named('lantern_out')[0];
    expect(out.data.lantern_id).toBe('L1');
    expect(r.at(out.tick + 1).shades[0].state).toBe('wander');
  });

  it('several draining shades add up', () => {
    const shades = [{ id: 'A', pos: [0, 1, 23.5] as [number, number, number], state: 'drain' as const, target_lantern_id: 'L1' }, { id: 'B', pos: [1, 1, 24] as [number, number, number], state: 'drain' as const, target_lantern_id: 'L1' }];
    const r = run(quiet({ player: { pos: [0, 0, -30] }, lanterns: lit(['L1'], 25), shades }), [], 60, 60);
    expect(r.at(60).lanterns[0].fuel).toBe(25 - 1 - 5 - 5);
  });

  it('drain -> chase when Mây comes within 6 m; draining shades do not hit', () => {
    const r = run(quiet({ player: { pos: [0, 0, 19] }, lanterns: lit(['L1'], 20), shades: [{ id: 'A', pos: [0, 1, 23.5], state: 'drain', target_lantern_id: 'L1' }] }), [], 1);
    expect(r.at(1).shades[0].state).toBe('chase');
  });

  it('pulse on a draining shade scores 15 in total; the stun ends in wander', () => {
    const r = run(quiet({ player: { pos: [0, 0, 20.5], carried: 3 }, lanterns: lit(['L1'], 20), shades: [{ id: 'A', pos: [0, 1, 23.5], state: 'drain', target_lantern_id: 'L1' }] }), [{ tick: 0, pulse: true }], 125);
    expect(r.named('pulse')[0].data.stunned_ids).toEqual(['A']);
    expect(r.at(1).score).toBe(15);
    expect(r.at(121).shades[0].state).not.toBe('stunned'); // Mây is within 12 m, so wander -> chase in step 8
  });

  it('a stun always ends in wander (Ticket-03), even within 18 m of Mây', () => {
    // 15 m away: the Phase 2 rule would have resumed chase (<= 18 m); Ticket-03 says wander (and > 12 m keeps it wandering)
    const r = run(quiet({ shades: [{ id: 'A', pos: [15, 1, 0], state: 'stunned', state_ticks_left: 1 }] }), [], 1);
    expect(r.at(1).shades[0].state).toBe('wander');
  });

  it('refuelling to >= 30 evicts shades inside the 6 m zone (harmless while pushed)', () => {
    const sc = quiet({ player: { pos: [0, 0, 23], carried: 10 }, lanterns: lit(['L1'], 20), shades: [{ id: 'A', pos: [0, 1, 23.5], state: 'drain', target_lantern_id: 'L1' }] });
    const r = run(sc, [{ tick: 0, interact: true }], 60);
    expect(r.named('refuel')[0].data).toEqual({ lantern_id: 'L1', amount: 9, fuel: 100 });
    expect(r.at(1).shades[0].state).toBe('recoil');
    expect(r.named('player_hit')).toEqual([]);
    expect(dxz(r.at(31).shades[0].pos, L1)).toBeGreaterThanOrEqual(6 - 1e-3);
  });
});

describe('dawn win', () => {
  it('lighting every lantern no longer ends the night', () => {
    const r = run(quiet({ lanterns: lit(['L1', 'L2', 'L3', 'L4', 'L5']) }), [], 100, 100);
    expect(r.end).toMatchObject({ ticks: 100, state: 'playing' });
  });

  it('at dawn: win with >= ceil(0.6 x n) lit (dawn_survived + 50 + floor(fuel) per lit lantern + 50 per flame)', () => {
    const r = run(quiet({ player: { pos: [0, 0, -30] }, lanterns: lit(['L1', 'L2', 'L3']), time_left_s: 1 }), [], 100);
    expect(r.events.at(-1)).toEqual({ type: 'event', tick: 60, name: 'game_over', data: { result: 'won', reason: 'dawn_survived' } });
    expect(r.end).toEqual({ type: 'end', ticks: 60, state: 'won', score: 3 * (50 + 99) + 3 * 50 });
  });

  it('at dawn with too few lit lanterns: lost (dawn); thresholds 3/5, 4/6, 5/7', () => {
    expect(run(quiet({ lanterns: lit(['L1', 'L2']), time_left_s: 1 }), [], 100).end.state).toBe('lost');
    expect(run(quiet({ lanterns: lit(['L1', 'L2', 'L3']), time_left_s: 1 }), [], 100, 1, 2).end.state).toBe('lost');
    expect(run(quiet({ lanterns: lit(['L1', 'L2', 'L3', 'L4']), time_left_s: 1 }), [], 100, 1, 2).end.state).toBe('won');
    expect(run(quiet({ lanterns: lit(['L1', 'L2', 'L3', 'L4']), time_left_s: 1 }), [], 100, 1, 3).end.state).toBe('lost');
    expect(run(quiet({ lanterns: lit(['L1', 'L2', 'L3', 'L4', 'L5']), time_left_s: 1 }), [], 100, 1, 3).end.state).toBe('won');
  });

  it('losing the last flame on the dawn tick is a loss (no_flames is checked first)', () => {
    const r = run(quiet({ player: { flames: 1 }, lanterns: lit(['L1', 'L2', 'L3', 'L4', 'L5']), shades: [{ pos: [0.5, 1, 0] }], time_left_s: 1 / 60 }), [], 10);
    expect(r.events.at(-1).data).toEqual({ result: 'lost', reason: 'no_flames' });
  });

  it('night lengths are 240 / 270 / 300 s', () => {
    expect([1, 2, 3].map((n) => run({}, [], 0, 1, n as 1 | 2 | 3).snaps[0].time_left_s)).toEqual([240, 270, 300]);
  });
});
