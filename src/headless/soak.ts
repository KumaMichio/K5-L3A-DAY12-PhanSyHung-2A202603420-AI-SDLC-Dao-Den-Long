#!/usr/bin/env node
/**
 * Ticket-04 §2 soak test: node --expose-gc dist/headless/soak.js --seed 7 --nights 10 --out soak.json
 * Runs N nights back to back in ONE process (Night 1 -> 2 -> 3 -> 1 ...), night i (1-based) uses
 * seed + i, with seeded random input: a new move direction every 30 ticks; each tick 5% jump,
 * 3% dash, 2% pulse, 10% interact. Records crashes, results and process RSS.
 */
import { writeFileSync } from 'node:fs';
import { loadTuning } from './tuning.js';
import { makeRng } from '../sim/rng.js';
import { Sim, TICK_HZ } from '../sim/sim.js';
import type { InputState, Tuning } from '../sim/types.js';

function arg(argv: string[], name: string, def?: string): string {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`--${name} is required`);
}

const rssMb = () => {
  (globalThis as { gc?: () => void }).gc?.(); // with --expose-gc: measure live memory, not garbage
  return Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
};

export function playNight(tuning: Tuning, seed: number, night: 1 | 2 | 3): Sim {
  const sim = new Sim(tuning, seed, night);
  const rng = makeRng((seed * 2654435761) >>> 0); // input stream, independent of the world RNG
  const maxTicks = Math.ceil(tuning[`night${night}_duration_s`] * TICK_HZ) + 10;
  const input: InputState = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false };
  for (let k = 0; k < maxTicks && !sim.over; k++) {
    if (k % 30 === 0) {
      const a = rng() * 2 * Math.PI;
      input.move = [Math.cos(a), Math.sin(a)];
    }
    input.jump = rng() < 0.05;
    input.dash = rng() < 0.03;
    input.pulse = rng() < 0.02;
    input.interact = rng() < 0.1;
    sim.step({ ...input, move: [...input.move] as [number, number] });
    sim.drainEvents();
  }
  return sim;
}

function main(argv: string[]): void {
  const seed = Number(arg(argv, 'seed'));
  const nights = Number(arg(argv, 'nights', '10'));
  const out = arg(argv, 'out');
  if (!Number.isInteger(seed) || !Number.isInteger(nights) || nights < 1) throw new Error('--seed and --nights must be integers (nights >= 1)');
  const tuning = loadTuning();
  const t0 = performance.now();
  const results: string[] = [];
  let crashes = 0;
  let memStart = 0;
  for (let i = 1; i <= nights; i++) {
    const night = (((i - 1) % 3) + 1) as 1 | 2 | 3;
    try {
      if (i === 1) {
        // "after the first night has loaded"
        const probe = new Sim(tuning, seed + i, night);
        memStart = rssMb();
        void probe;
      }
      const sim = playNight(tuning, seed + i, night);
      results.push(sim.state);
    } catch (e) {
      crashes++;
      results.push('crash');
      process.stderr.write(`night ${i} crashed: ${(e as Error).stack}\n`);
    }
  }
  const memEnd = rssMb(); // after the last night has been released
  const report = {
    nights,
    crashes,
    results,
    mem_start_mb: memStart,
    mem_end_mb: memEnd,
    duration_s: Math.round((performance.now() - t0) / 100) / 10,
  };
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report) + '\n');
}

try {
  main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exitCode = 1;
}
