import { readFileSync } from 'node:fs';
import type { InputFrame } from '../src/sim/parse.js';
import { runHeadless } from '../src/sim/run.js';
import type { Scenario, Tuning } from '../src/sim/types.js';

export const T: Tuning = JSON.parse(readFileSync('game.contract.json', 'utf8')).tuning;

/** Empty, quiet world: only what the test lists. */
export const quiet = (extra: Scenario = {}): Scenario => ({
  random_motes: false, random_shades: false, random_drifters: false, wind_enabled: false,
  motes: [], shades: [], drifters: [], charms: [], ...extra,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = any;

export function run(scenario: Scenario, frames: InputFrame[] = [], ticks = 60, snapshotEvery = 1, night: 1 | 2 | 3 = 1, seed = 1) {
  const lines: Line[] = runHeadless({ tuning: T, seed, night, ticks, snapshotEvery, scenario, frames }).map((l) => JSON.parse(l));
  const snaps = lines.filter((l) => l.type === 'snapshot');
  return {
    lines,
    snaps,
    /** snapshot at a given tick */
    at: (tick: number) => snaps.find((s) => s.tick === tick),
    events: lines.filter((l) => l.type === 'event' && l.name !== 'night_start'),
    named: (name: string) => lines.filter((l) => l.type === 'event' && l.name === name),
    end: lines[lines.length - 1],
  };
}

export const dxz = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);
