/** TICKET-02 features: at least one headless scenario per new feature (DoD). */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NIGHTS } from '../src/sim/maps.js';
import { dxz, quiet, run } from './helpers.js';

describe('contract v1.1 output', () => {
  it('snapshot carries night, wind, extended player and the motes/drifters/charms arrays; night_start at tick 0', () => {
    const r = run({}, [], 10, 10, 2, 7);
    const s = r.snaps[0];
    expect(Object.keys(s)).toEqual(['type', 'tick', 'sim_tick', 'night', 'state', 'time_left_s', 'score', 'wind', 'player', 'lanterns', 'shades', 'motes_active', 'motes', 'drifters', 'charms']);
    expect(s.night).toBe(2);
    expect(s.wind).toEqual({ active: false, dir_deg: 0 });
    // v1.2 adds player.capacity (Ticket-03 §7)
    expect(Object.keys(s.player)).toEqual(['pos', 'vel', 'grounded', 'flames', 'carried', 'capacity', 'invuln', 'dash_cd_s', 'pulse_cd_s', 'charm_s']);
    expect(s.player.grounded).toBe(true);
    expect(s.motes[0]).toEqual({ id: 'M1', pos: expect.any(Array), kind: 'random', ttl_s: null });
    expect(s.charms).toEqual([{ id: 'C1', available: true, respawn_s: 0 }]);
    expect(r.lines[1]).toEqual({ type: 'event', tick: 0, name: 'night_start', data: { night: 2 } });
    expect(s.lanterns.map((l: { id: string }) => l.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  });
});

describe('standard maps & spawning', () => {
  it('Night 1: 20 fireflies on 20 distinct standard points, +1 at tick 240', () => {
    const r = run({ random_shades: false }, [], 240, 240);
    const pts = NIGHTS[1].moteSpawns.map((p) => p.map((v) => Math.round(v * 1000) / 1000).join(','));
    const start = r.snaps[0].motes.map((m: { pos: number[] }) => m.pos.join(','));
    expect(new Set(start).size).toBe(20);
    for (const p of start) expect(pts).toContain(p);
    expect(r.at(240).motes_active).toBe(21);
  });

  it('Night 1 shades: 2 at tick 300, then every 480 ticks, max 6, >= 15 m from Mây, ids S1.., state spawning', () => {
    const r = run({ random_motes: false, player: { pos: [0, 0, 25] }, lanterns: [{ id: 'L1', lit: true }] }, [], 3000, 10);
    const sp = r.named('shade_spawned');
    expect(sp.map((e) => e.tick)).toEqual([300, 300, 780, 1260, 1740, 2220]);
    expect(sp.map((e) => e.data.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    const at300 = r.at(300);
    for (const s of at300.shades) {
      expect(s.state).toBe('spawning');
      expect(dxz(s.pos, [0, 0, 25])).toBeGreaterThanOrEqual(15);
    }
  });

  it('shade states: spawning -> wander (far) -> chase (<= 12 m) -> wander (> 18 m)', () => {
    const r = run(quiet({ shades: [{ id: 'A', pos: [30, 1, 0], state: 'spawning', state_ticks_left: 5 }] }), [], 6);
    expect(r.at(4).shades[0].state).toBe('spawning');
    expect(r.at(6).shades[0].state).toBe('wander');
    const c = run(quiet({ shades: [{ id: 'A', pos: [11.9, 1, 0], state: 'wander' }] }), [], 1);
    expect(c.at(1).shades[0].state).toBe('chase');
    const w = run(quiet({ shades: [{ id: 'A', pos: [18.5, 1, 0], state: 'chase' }] }), [], 1);
    expect(w.at(1).shades[0].state).toBe('wander');
  });

  it('dropped fireflies expire after their TTL', () => {
    const r = run(quiet({ player: { pos: [10, 0, 10] }, motes: [{ pos: [0, 0, 5], kind: 'dropped', ttl_ticks: 5 }] }), [], 6);
    expect(r.at(4).motes_active).toBe(1);
    expect(r.at(5).motes_active).toBe(0);
  });
});

describe('dash', () => {
  it('14 m/s for 12 ticks in the facing direction (+Z when idle), cooldown 1.5 s from the start', () => {
    const frames = [{ tick: 0, dash: true }, { tick: 1, dash: false }, { tick: 50, dash: true }, { tick: 51, dash: false }, { tick: 90, dash: true }];
    const r = run(quiet(), frames, 100);
    expect(r.named('dash').map((e) => e.tick)).toEqual([1, 91]);
    expect(r.at(12).player.pos[2]).toBeCloseTo(14 * 12 / 60, 3);
    expect(r.at(1).player.dash_cd_s).toBe(1.5);
  });

  it('dashes in the moving direction and holds altitude in the air', () => {
    const r = run(quiet(), [{ tick: 0, jump: true, move: [1, 0] }, { tick: 10, dash: true }], 30);
    expect(r.at(11).player.vel[0]).toBe(14);
    expect(r.at(22).player.pos[1]).toBe(r.at(11).player.pos[1]);
  });
});

describe('jump & fall', () => {
  it('jumps at 7 m/s only from the ground (gravity -20)', () => {
    const r = run(quiet(), [{ tick: 0, jump: true }, { tick: 10, jump: false }, { tick: 11, jump: true }], 60);
    const ys = r.snaps.map((s) => s.player.pos[1]);
    expect(Math.max(...ys)).toBeGreaterThan(1.1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1.225);
    expect(r.at(60).player).toMatchObject({ grounded: true, pos: [0, 0, 0] });
  });

  it('falling off the island (Y < -10): once, -1 flame, loses everything, 60-tick wait, respawn at start with invuln', () => {
    const r = run(quiet({ player: { pos: [39.5, 0, 0], carried: 4, invuln_ticks: 500 } }), [{ tick: 0, move: [1, 0] }, { tick: 20, move: [0, 0] }], 300);
    const falls = r.named('player_hit');
    expect(falls.length).toBe(1);
    expect(falls[0].data).toEqual({ by: 'fall', flames: 2, dropped: 0, lost: 4 });
    const back = r.at(falls[0].tick + 60);
    expect(back.player).toMatchObject({ pos: [0, 0, 0], vel: [0, 0, 0], carried: 0, invuln: true });
    expect(r.at(falls[0].tick + 59).player.pos[1]).toBeLessThan(-10);
  });

  it('falling with the last flame loses at once (no respawn)', () => {
    const r = run(quiet({ player: { pos: [39.5, 0, 0], flames: 1 } }), [{ tick: 0, move: [1, 0] }], 300);
    expect(r.events.map((e) => e.name)).toEqual(['player_hit', 'game_over']);
    expect(r.end.state).toBe('lost');
  });
});

describe('pause', () => {
  it('freezes sim_tick, time and movement; tick keeps counting; paused/resumed events', () => {
    const frames = [{ tick: 0, move: [0, 1] as [number, number] }, { tick: 10, pause: true }, { tick: 11, pause: false }, { tick: 20, pause: true }];
    const r = run(quiet(), frames, 30);
    expect(r.events.map((e) => [e.tick, e.name])).toEqual([[11, 'paused'], [21, 'resumed']]);
    expect(r.at(15)).toMatchObject({ state: 'paused', sim_tick: 10 });
    expect(r.at(15).player.pos).toEqual(r.at(11).player.pos);
    // SUPERSEDED (Ticket-03 §3): Night 1 lasts 240 s (was 300)
    expect(r.at(30)).toMatchObject({ state: 'playing', sim_tick: 20, time_left_s: Math.round((240 - 20 / 60) * 1000) / 1000 });
  });
});

describe('Gió Lạc (drifters)', () => {
  it('idle -> chase when Mây carries >= 5 within 15 m; steals min(3, carried) on touch; flees 240 ticks then removed', () => {
    const r = run(quiet({ player: { carried: 6 }, drifters: [{ id: 'D1', pos: [5, 1, 0] }] }), [], 300, 1, 2);
    const steal = r.named('drifter_steal');
    expect(steal).toEqual([{ type: 'event', tick: 33, name: 'drifter_steal', data: { drifter_id: 'D1', amount: 3, carried: 3 } }]);
    expect(r.at(1).drifters[0].state).toBe('chase');
    expect(r.at(33).drifters[0]).toMatchObject({ state: 'flee', stolen: 3 });
    expect(r.at(272).drifters[0].state).toBe('flee');
    expect(r.at(273).drifters[0].state).toBe('removed');
  });

  it('stays idle when Mây carries < 5; ignores the invulnerability and safe zones', () => {
    expect(run(quiet({ player: { carried: 4 }, drifters: [{ pos: [3, 1, 0] }] }), [], 30, 1, 2).at(30).drifters[0].state).toBe('idle');
    const r = run(quiet({ player: { carried: 6, invuln_ticks: 300, pos: [0, 0, 20] }, lanterns: [{ id: 'L1', lit: true }], drifters: [{ pos: [5, 1, 20] }] }), [], 60, 1, 2);
    expect(r.named('drifter_steal').length).toBe(1);
    expect(r.named('player_hit')).toEqual([]); // never costs a flame
  });

  it('pulse on a chasing drifter makes it flee without stealing', () => {
    const r = run(quiet({ player: { carried: 6 }, drifters: [{ id: 'D1', pos: [6, 1, 0] }] }), [{ tick: 9, pulse: true }], 120, 1, 2);
    expect(r.at(10).drifters[0]).toMatchObject({ state: 'flee', stolen: 0 });
    expect(r.named('drifter_steal')).toEqual([]);
  });

  it('pulse on a fleeing drifter that carries fireflies drops them all (dropped kind) and it vanishes 120 ticks later', () => {
    const r = run(quiet({ player: { carried: 3 }, drifters: [{ id: 'D1', pos: [3, 1, 0], state: 'flee', stolen: 3 }] }), [{ tick: 0, pulse: true }], 130, 1, 2);
    expect(r.named('drifter_drop')).toEqual([{ type: 'event', tick: 1, name: 'drifter_drop', data: { drifter_id: 'D1', amount: 3 } }]);
    expect(r.at(1).motes.filter((m: { kind: string }) => m.kind === 'dropped').length).toBe(3);
    expect(r.at(120).drifters[0].state).toBe('flee');
    expect(r.at(121).drifters[0].state).toBe('removed');
  });

  it('spawn at sim ticks 1200, 2400 on Nights 2-3 (max 2 alive), never on Night 1', () => {
    const r = run({ random_shades: false, random_motes: false, motes: [] }, [], 3600, 1200, 2);
    expect(r.at(1200).drifters.map((d: { id: string; state: string }) => [d.id, d.state])).toEqual([['D1', 'idle']]);
    expect(r.at(3600).drifters.length).toBe(2);
    expect(run({ random_shades: false }, [], 2400, 1200, 1).at(2400).drifters).toEqual([]);
  });
});

describe('Bùa Gió (charm)', () => {
  it('pick-up rule like a firefly; 600 ticks of 7.2 m/s; respawns after 2700 ticks', () => {
    const r = run(quiet({ player: { pos: [35, 0, 0.5] }, charms: [{ id: 'C1', pos: [35, 0, 0] }] }), [{ tick: 1, move: [1, 0] }, { tick: 40, move: [0, 0] }], 2701, 1, 2); // walk along the bridge
    expect(r.named('charm_picked')).toEqual([{ type: 'event', tick: 1, name: 'charm_picked', data: { charm_id: 'C1', charm_ticks: 600 } }]);
    expect(r.at(1).player.charm_s).toBe(10);
    expect(r.at(1).charms[0]).toEqual({ id: 'C1', available: false, respawn_s: 45 });
    expect(r.at(30).player.vel[0]).toBe(7.2);
    expect(r.at(2700).charms[0].available).toBe(false);
    expect(r.at(2701).charms[0].available).toBe(true);
  });

  it('with the charm, dash has no cooldown (re-press needed; pressing mid-dash is ignored)', () => {
    const frames = [{ tick: 0, dash: true }, { tick: 1, dash: false }, { tick: 4, dash: true }, { tick: 5, dash: false }, { tick: 20, dash: true }];
    const r = run(quiet({ player: { charm_ticks: 600 } }), frames, 30);
    expect(r.named('dash').map((e) => e.tick)).toEqual([1, 21]);
  });
});

describe('Night 2 — Đảo Cau', () => {
  it('jump pad launches Mây (14 up, 24 toward island B), keys do not steer, lands on island B', () => {
    const land = (frames: { tick: number; move?: [number, number] }[]) => {
      const r = run(quiet({ player: { pos: [20, 0, 18] } }), frames, 120, 1, 2);
      const s = r.snaps.find((x) => x.tick > 5 && x.player.grounded);
      return { r, s };
    };
    const a = land([]);
    const b = land([{ tick: 2, move: [-1, 0] }, { tick: 50, move: [0, 0] }]);
    expect(a.r.at(1).player.vel).toEqual([expect.closeTo(24 * 50 / Math.hypot(50, 18), 2), 14, expect.closeTo(-24 * 18 / Math.hypot(50, 18), 2)]);
    expect(dxz(a.s.player.pos, [70, 0, 0])).toBeLessThan(28);
    expect(a.s.tick).toBeGreaterThan(80);
    expect(a.s.tick).toBeLessThan(90); // ~1.4 s
    expect(b.s.player.pos).toEqual(a.s.player.pos);
    expect(a.r.named('player_hit')).toEqual([]);
  });

  it('the bamboo bridge (x 26..44, |z| <= 2) is walkable; stepping off its side falls', () => {
    const ok = run(quiet({ player: { pos: [27, 0, 0] } }), [{ tick: 0, move: [1, 0] }], 180, 30, 2);
    expect(ok.named('player_hit')).toEqual([]);
    expect(ok.at(180).player.pos[0]).toBeGreaterThan(44);
    const off = run(quiet({ player: { pos: [35, 0, 1.5] } }), [{ tick: 0, move: [0, 1] }], 180, 30, 2);
    expect(off.named('player_hit')[0].data.by).toBe('fall');
  });
});

describe('Night 3 — Đảo Chuông', () => {
  it('tier cliffs are walls from below; ramps climb to tier 1; stepping off a tier drops to the one below', () => {
    const wall = run(quiet({ player: { pos: [0, 0, 10] } }), [{ tick: 0, move: [0, 1] }], 120, 120, 3);
    expect(wall.at(120).player.pos[2]).toBeLessThanOrEqual(12); // stops at the r = 12 cliff (output rounded)
    expect(wall.at(120).player.pos[1]).toBe(0);
    const a = (30 * Math.PI) / 180;
    const ramp = run(quiet({ player: { pos: [31 * Math.cos(a), 0, 31 * Math.sin(a)] } }), [{ tick: 0, move: [-Math.cos(a), -Math.sin(a)] }, { tick: 110, move: [0, 0] }], 130, 10, 3);
    expect(ramp.at(130).player).toMatchObject({ grounded: true });
    expect(ramp.at(130).player.pos[1]).toBe(3);
    const down = run(quiet({ player: { pos: [0, 3, 13] } }), [{ tick: 0, move: [1, 0] }], 200, 10, 3); // walk sideways on tier 1, off its end at z = 0
    expect(down.named('player_hit')).toEqual([]);
  });

  it('jump pad at (0,3,13) lands Mây on tier 2 (Y = 6), outside the tower', () => {
    const r = run(quiet({ player: { pos: [0, 3, 13] } }), [], 90, 1, 3);
    const landed = r.snaps.find((s) => s.tick > 5 && s.player.grounded);
    expect(landed.player.pos[1]).toBe(6);
    expect(Math.hypot(landed.player.pos[0], landed.player.pos[2])).toBeLessThan(8);
    expect(Math.hypot(landed.player.pos[0], landed.player.pos[2])).toBeGreaterThan(2);
  });

  it('the bell tower (r 2) cannot be entered or climbed', () => {
    const r = run(quiet({ player: { pos: [0, 6, 6] } }), [{ tick: 0, move: [0, -1] }, { tick: 30, jump: true }], 120, 10, 3);
    for (const s of r.snaps) expect(Math.hypot(s.player.pos[0], s.player.pos[2])).toBeGreaterThanOrEqual(2 - 1e-3);
  });

  it('wind: a 5 s gust every 30 s pushes Mây 2 m/s (10 m), reported in the snapshot', () => {
    const r = run(quiet({ wind_enabled: true }), [], 2110, 10, 3);
    expect(r.at(1790).wind.active).toBe(false);
    expect(r.at(1800).wind.active).toBe(true);
    expect(r.at(2100).wind.active).toBe(false);
    expect(dxz(r.at(2100).player.pos, r.at(1800).player.pos)).toBeCloseTo(10, 1);
    expect(dxz(r.at(1790).player.pos, [0, 0, -15])).toBe(0);
  });
});

describe('performance', () => {
  it('a full night (21 600 ticks) runs headless in <= 30 s on every night', () => {
    const contract = JSON.parse(readFileSync('game.contract.json', 'utf8'));
    const [cmd, ...pre] = contract.headless_cmd.split(' ');
    for (const n of ['1', '2', '3']) {
      const t0 = Date.now();
      const r = spawnSync(cmd, [...pre, '--seed', '3', '--night', n, '--ticks', '21600', '--out', `out/perf-${n}.jsonl`], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(Date.now() - t0).toBeLessThan(30_000);
    }
  });
});
