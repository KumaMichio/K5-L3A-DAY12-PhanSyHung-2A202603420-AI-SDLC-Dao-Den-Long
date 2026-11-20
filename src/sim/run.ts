/** Headless run loop shared by the CLI and the tests. Returns JSONL lines (no trailing newline). */
import { InputTimeline, type InputFrame } from './parse.js';
import { Sim } from './sim.js';
import type { Scenario, Tuning } from './types.js';

export interface RunOptions {
  tuning: Tuning;
  seed: number;
  ticks: number;
  snapshotEvery?: number;
  scenario?: Scenario;
  frames?: InputFrame[];
}

export function runHeadless(o: RunOptions): string[] {
  const every = o.snapshotEvery ?? 10;
  const sim = new Sim(o.tuning, o.seed, o.scenario ?? {});
  const inputs = new InputTimeline(o.frames ?? []);
  const lines: string[] = [JSON.stringify(sim.snapshot())];
  for (let k = 0; k < o.ticks && !sim.over; k++) {
    sim.step(inputs.at(k));
    for (const e of sim.drainEvents()) lines.push(JSON.stringify(e));
    if (sim.steps % every === 0) lines.push(JSON.stringify(sim.snapshot()));
  }
  lines.push(JSON.stringify({ type: 'end', ticks: sim.steps, state: sim.state, score: sim.score }));
  return lines;
}
