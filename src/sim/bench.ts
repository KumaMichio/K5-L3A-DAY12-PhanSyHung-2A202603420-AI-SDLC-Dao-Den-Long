/**
 * Ticket-04 §1 benchmark scene (identical for every run): Night 1, 200 wandering shades and
 * 100 fireflies spread uniformly over the island (seed), L1–L3 lit with fuel 100, Mây idle at
 * the origin. Spawns, damage, pickup, fuel loss and the end of the night are switched off.
 */
import { makeRng } from './rng.js';
import { Sim } from './sim.js';
import type { Tuning, Vec3 } from './types.js';

export const BENCH_SHADES = 200;
export const BENCH_MOTES = 100;
const SPREAD_RADIUS = 38; // inside the 40 m island

function uniformDisc(rng: () => number, n: number, y: number): Vec3[] {
  return Array.from({ length: n }, () => {
    const r = Math.sqrt(rng()) * SPREAD_RADIUS; // sqrt -> uniform by area
    const a = rng() * 2 * Math.PI;
    return [r * Math.cos(a), y, r * Math.sin(a)] as Vec3;
  });
}

export function makeBenchSim(tuning: Tuning, seed: number): Sim {
  const rng = makeRng(seed);
  const sim = new Sim(tuning, seed, 1, {
    player: { pos: [0, 0, 0] },
    random_motes: false,
    random_shades: false,
    random_drifters: false,
    wind_enabled: false,
    motes: uniformDisc(rng, BENCH_MOTES, 0).map((pos) => ({ pos })),
    shades: uniformDisc(rng, BENCH_SHADES, 1).map((pos) => ({ pos, state: 'wander' as const })),
    drifters: [],
    charms: [],
    lanterns: ['L1', 'L2', 'L3'].map((id) => ({ id, lit: true, fuel: 100 })),
  });
  sim.bench = { noSpawns: true, noDamage: true, noPickup: true, noFuelLoss: true, noEnd: true, noChase: true };
  return sim;
}
