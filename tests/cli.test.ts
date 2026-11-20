/** End-to-end tests of the built CLI exactly as the grader calls it (requires `npm run build`). */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const contract = JSON.parse(readFileSync('game.contract.json', 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'ddl-'));

function cli(args: string[]) {
  const [cmd, ...pre] = contract.headless_cmd.split(' ');
  return spawnSync(cmd, [...pre, ...args], { encoding: 'utf8' });
}

describe('headless CLI', () => {
  it('runs, exits 0, and writes JSONL ending with an end line', () => {
    const out = join(dir, 'a.jsonl');
    const r = cli(['--seed', '1', '--night', '1', '--ticks', '120', '--out', out]);
    expect(r.status).toBe(0);
    const lines = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'snapshot', tick: 0 });
    expect(lines.at(-1)).toMatchObject({ type: 'end', ticks: 120 });
  });

  it('is byte-for-byte deterministic for the same seed, scenario and inputs', () => {
    const inp = join(dir, 'in.json');
    writeFileSync(inp, JSON.stringify({ frames: [{ tick: 0, move: [1, 1], cam_yaw_deg: 30 }, { tick: 90, pulse: true }] }));
    const outs = ['x.jsonl', 'y.jsonl'].map((f) => {
      const out = join(dir, f);
      expect(cli(['--seed', '9', '--night', '1', '--inputs', inp, '--ticks', '2000', '--out', out, '--snapshot-every', '7']).status).toBe(0);
      return readFileSync(out, 'utf8');
    });
    expect(outs[0]).toBe(outs[1]);
  });

  it('exits 2 with a stderr message on malformed inputs or scenario', () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"frames": [{"tick": 3}, {"tick": 1}]}');
    const r1 = cli(['--seed', '1', '--night', '1', '--inputs', bad, '--ticks', '10', '--out', join(dir, 'o.jsonl')]);
    expect(r1.status).toBe(2);
    expect(r1.stderr).toMatch(/error/);
    writeFileSync(bad, 'not json');
    expect(cli(['--seed', '1', '--night', '1', '--scenario', bad, '--ticks', '10', '--out', join(dir, 'o.jsonl')]).status).toBe(2);
  });

  it('exits non-zero on bad arguments', () => {
    const r = cli(['--seed', 'abc', '--night', '1', '--ticks', '10', '--out', join(dir, 'o.jsonl')]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
