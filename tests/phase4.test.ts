/** Ticket-04: leaderboard rules, bench scene, soak + export commands, contract v1.3. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addEntry, isoWithOffset, rank, validName, type LeaderboardEntry } from '../src/shared/leaderboard.js';
import { makeBenchSim } from '../src/sim/bench.js';
import { T } from './helpers.js';

const e = (name: string, score: number, at: string, nights = 1): LeaderboardEntry => ({ name, score, nights_won: nights, achieved_at: at, seed: 1 });

describe('leaderboard rules', () => {
  it('names: 3-12 chars of letters/digits/_; Vietnamese with diacritics accepted', () => {
    for (const ok of ['Mây', 'abc', 'A_1', 'Nguyễn_Văn', 'x'.repeat(12)]) expect(validName(ok)).toBe(true);
    for (const bad of ['ab', 'x'.repeat(13), 'a b c', 'abc!', '']) expect(validName(bad)).toBe(false);
  });

  it('sorted by score desc, ties: earlier achieved_at first; top 10 kept', () => {
    let list: LeaderboardEntry[] = [];
    list = addEntry(list, e('late', 500, '2026-11-20T21:00:00+07:00'));
    list = addEntry(list, e('early', 500, '2026-11-20T20:00:00+07:00'));
    list = addEntry(list, e('best', 900, '2026-11-20T22:00:00+07:00'));
    expect(list.map((x) => x.name)).toEqual(['best', 'early', 'late']);
    for (let i = 0; i < 12; i++) list = addEntry(list, e(`p${i}xx`, i * 10, '2026-11-20T23:00:00+07:00'));
    expect(list.length).toBe(10);
    expect(list.at(-1)!.score).toBe(50); // 900, 500, 500, 110, 100, 90, 80, 70, 60, 50
    // offsets are compared as instants: 13:00Z == 20:00+07:00 -> earlier than 21:00+07:00
    expect(rank([e('b', 1, '2026-11-20T21:00:00+07:00'), e('a', 1, '2026-11-20T13:00:00Z')]).map((x) => x.name)).toEqual(['a', 'b']);
  });

  it('achieved_at is ISO 8601 with a timezone offset; invalid entries are refused', () => {
    expect(isoWithOffset(new Date())).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(() => addEntry([], e('ok_name', -5, '2026-11-20T20:00:00+07:00'))).toThrow();
    expect(() => addEntry([], { ...e('ok_name', 5, '2026-11-20T20:00:00+07:00'), nights_won: 4 })).toThrow();
  });
});

describe('bench scene', () => {
  it('200 wandering shades + 100 fireflies spread over the island, L1-L3 lit at 100; nothing spawns, hurts, picks up, burns or ends', () => {
    const sim = makeBenchSim(T, 42);
    expect(sim.shades.length).toBe(200);
    expect(sim.shades.every((s) => s.state === 'wander')).toBe(true);
    expect(sim.motes.length).toBe(100);
    expect(sim.lanterns.slice(0, 3).every((l) => l.lit && l.fuel === 6000)).toBe(true);
    for (const s of sim.shades) expect(Math.hypot(s.pos[0], s.pos[2])).toBeLessThanOrEqual(40);
    const input = { move: [0, 0] as [number, number], cam_yaw_deg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false };
    for (let i = 0; i < 20000; i++) sim.step(input); // past the 240 s night
    expect(sim.state).toBe('playing');
    expect(sim.shades.length).toBe(200);
    expect(sim.motes.length).toBe(100);
    expect(sim.player.flames).toBe(3);
    expect(sim.lanterns.slice(0, 3).every((l) => l.fuel === 6000)).toBe(true);
    expect(sim.shades.every((s) => s.state === 'wander')).toBe(true);
    expect(makeBenchSim(T, 42).shades.map((s) => s.pos)).toEqual(makeBenchSim(T, 42).shades.map((s) => s.pos));
  });
});

describe('commands (contract v1.3)', () => {
  const contract = JSON.parse(readFileSync('game.contract.json', 'utf8'));

  it('declares bench_cmd and soak_cmd', () => {
    expect(contract.contract_version).toBe('1.3');
    expect(contract.bench_cmd).toBeTruthy();
    expect(contract.soak_cmd).toBeTruthy();
  });

  it('soak: 10 nights, 0 crashes, memory end <= 1.2 x start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ddl-soak-'));
    const out = join(dir, 'soak.json');
    const [cmd, ...pre] = contract.soak_cmd.split(' ');
    const r = spawnSync(cmd, [...pre, '--seed', '7', '--nights', '10', '--out', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const s = JSON.parse(readFileSync(out, 'utf8'));
    expect(s.nights).toBe(10);
    expect(s.crashes).toBe(0);
    expect(s.results.length).toBe(10);
    expect(s.mem_end_mb).toBeLessThanOrEqual(1.2 * s.mem_start_mb);
  });

  it('run_cmd --export-leaderboard writes {"entries": [...]} from the on-disk store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ddl-lb-'));
    const out = join(dir, 'out.json');
    const [cmd, ...pre] = contract.run_cmd.split(' ');
    const r = spawnSync(cmd, [...pre, '--export-leaderboard', out], { encoding: 'utf8', env: { ...process.env, DDL_DATA_DIR: dir } });
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ entries: [] });
  });
});
