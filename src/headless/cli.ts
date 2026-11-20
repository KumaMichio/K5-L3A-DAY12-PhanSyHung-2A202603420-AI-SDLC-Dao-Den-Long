#!/usr/bin/env node
/**
 * Test Contract v1.1 headless entry point.
 * node dist/headless/cli.js --seed <int> --night 1|2|3 [--scenario f] [--inputs f] --ticks <int> --out f [--snapshot-every n]
 * Exit codes: 0 ok · 2 malformed inputs/scenario · 1 any other error (bad args, missing file, ...).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FormatError, parseInputs, parseScenario, type InputFrame } from '../sim/parse.js';
import { NIGHTS } from '../sim/maps.js';
import { runHeadless } from '../sim/run.js';
import type { Scenario, Tuning } from '../sim/types.js';

class UsageError extends Error {}

function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument "${a}"`);
    const eq = a.indexOf('=');
    if (eq > 0) m.set(a.slice(2, eq), a.slice(eq + 1));
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`missing value for ${a}`);
      m.set(a.slice(2), v);
      i++;
    }
  }
  return m;
}

function intArg(m: Map<string, string>, name: string, opts: { required?: boolean; min?: number; def?: number }): number {
  const v = m.get(name);
  if (v === undefined) {
    if (opts.required) throw new UsageError(`--${name} is required`);
    return opts.def as number;
  }
  if (!/^-?\d+$/.test(v)) throw new UsageError(`--${name} must be an integer`);
  const n = Number(v);
  if (opts.min !== undefined && n < opts.min) throw new UsageError(`--${name} must be >= ${opts.min}`);
  return n;
}

function readJson(path: string): unknown {
  const text = readFileSync(path, 'utf8'); // missing file -> generic error (exit 1)
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FormatError(`${path}: invalid JSON (${(e as Error).message})`);
  }
}

export function loadTuning(): Tuning {
  const here = dirname(fileURLToPath(import.meta.url));
  const contract = JSON.parse(readFileSync(resolve(here, '../../game.contract.json'), 'utf8'));
  return contract.tuning as Tuning;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  const seed = intArg(args, 'seed', { required: true });
  const night = intArg(args, 'night', { required: true });
  if (night !== 1 && night !== 2 && night !== 3) throw new UsageError(`--night must be 1, 2 or 3 (got ${night})`);
  const ticks = intArg(args, 'ticks', { required: true, min: 0 });
  const snapshotEvery = intArg(args, 'snapshot-every', { min: 1, def: 10 });
  const out = args.get('out');
  if (!out) throw new UsageError('--out is required');

  const tuning = loadTuning();
  const sp = args.get('scenario');
  const ip = args.get('inputs');
  const scenario: Scenario | undefined = sp ? parseScenario(readJson(sp), NIGHTS[night].lanterns.map((l) => l.id)) : undefined;
  const frames: InputFrame[] | undefined = ip ? parseInputs(readJson(ip)) : undefined;

  const lines = runHeadless({ tuning, seed, night, ticks, snapshotEvery, scenario, frames });
  writeFileSync(out, lines.join('\n') + '\n');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exitCode = e instanceof FormatError ? 2 : 1;
}
