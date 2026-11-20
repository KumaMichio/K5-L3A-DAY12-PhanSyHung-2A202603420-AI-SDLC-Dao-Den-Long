/**
 * Standard maps from TICKET-02 Part 2. Data only.
 * Angles: measured from +X, counter-clockwise seen from above => point = (r·cos a, y, r·sin a)
 * (Night 3's tier 1 "z > 0 half" holds fireflies at 20°..160°, which fixes this convention).
 */
import type { Vec3 } from './types.js';

export interface PadDef { pos: Vec3; radius: number; vy: number; hSpeed: number; dir: [number, number] }

export interface NightDef {
  night: 1 | 2 | 3;
  name: string;
  durationKey: 'night1_duration_s' | 'night2_duration_s' | 'night3_duration_s';
  start: Vec3;
  lanterns: { id: string; pos: Vec3 }[];
  moteSpawns: Vec3[];
  shadeSpawns: Vec3[];
  shadeIntervalTicks: number;
  shadeMax: number;
  /** null = use tuning.shade_speed */
  shadeSpeed: number | null;
  pads: PadDef[];
  charms: Vec3[];
  drifters: boolean;
  wind: boolean;
  /** Walkable surface height at (x, z); null = void (cloud sea). */
  ground(x: number, z: number): number | null;
  /** Solid columns shades/players cannot enter (Night 3 bell tower). */
  pillars: { x: number; z: number; r: number }[];
}

const DEG = Math.PI / 180;
const ring = (cx: number, cz: number, r: number, y: number, angles: number[]): Vec3[] =>
  angles.map((a) => [cx + r * Math.cos(a * DEG), y, cz + r * Math.sin(a * DEG)]);
const steps = (from: number, step: number, n: number) => Array.from({ length: n }, (_, i) => from + i * step);

function towards(from: [number, number], to: [number, number]): [number, number] {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
}

// ------------------------------------------------------------------ Night 1 — Đảo Bến
const night1: NightDef = {
  night: 1,
  name: 'Đảo Bến',
  durationKey: 'night1_duration_s',
  start: [0, 0, 0],
  lanterns: [
    { id: 'L1', pos: [0, 0, 25] },
    { id: 'L2', pos: [23.8, 0, 7.7] },
    { id: 'L3', pos: [14.7, 0, -20.2] },
    { id: 'L4', pos: [-14.7, 0, -20.2] },
    { id: 'L5', pos: [-23.8, 0, 7.7] },
  ],
  moteSpawns: [...ring(0, 0, 12, 0, steps(0, 45, 8)), ...ring(0, 0, 33, 0, steps(0, 22.5, 16))],
  shadeSpawns: ring(0, 0, 37, 0, steps(15, 30, 12)),
  shadeIntervalTicks: 480,
  shadeMax: 6,
  shadeSpeed: null,
  pads: [],
  charms: [],
  drifters: false,
  wind: false,
  ground: (x, z) => (Math.hypot(x, z) <= 40 ? 0 : null),
  pillars: [],
};

// ------------------------------------------------------------------ Night 2 — Đảo Cau
const islandMotes = (cx: number) => [...ring(cx, 0, 10, 0, [0, 90, 180, 270]), ...ring(cx, 0, 22, 0, steps(0, 45, 8))];
const night2: NightDef = {
  night: 2,
  name: 'Đảo Cau',
  durationKey: 'night2_duration_s',
  start: [0, 0, 0],
  lanterns: [
    { id: 'L1', pos: [0, 0, 20] },
    { id: 'L2', pos: [17, 0, -10] },
    { id: 'L3', pos: [-17, 0, -10] },
    { id: 'L4', pos: [70, 0, 20] },
    { id: 'L5', pos: [87, 0, -10] },
    { id: 'L6', pos: [53, 0, -10] },
  ],
  moteSpawns: [...islandMotes(0), ...islandMotes(70)],
  shadeSpawns: [...ring(0, 0, 26, 0, steps(22.5, 45, 8)), ...ring(70, 0, 26, 0, steps(22.5, 45, 8))],
  shadeIntervalTicks: 420,
  shadeMax: 8,
  shadeSpeed: null,
  pads: [
    { pos: [20, 0, 18], radius: 1, vy: 14, hSpeed: 24, dir: towards([20, 18], [70, 0]) },
    { pos: [50, 0, -18], radius: 1, vy: 14, hSpeed: 24, dir: towards([50, -18], [0, 0]) },
  ],
  charms: [[35, 0, 0]],
  drifters: true,
  wind: false,
  ground: (x, z) =>
    Math.hypot(x, z) <= 28 || Math.hypot(x - 70, z) <= 28 || (x >= 26 && x <= 44 && Math.abs(z) <= 2) ? 0 : null,
  pillars: [],
};

// ------------------------------------------------------------------ Night 3 — Đảo Chuông
const RAMP_ANGLES = [30 * DEG, 150 * DEG];
const night3: NightDef = {
  night: 3,
  name: 'Đảo Chuông',
  durationKey: 'night3_duration_s',
  // Ticket gives no Night 3 start; (0,0,0) is inside the bell tower. Tier 0, south side (assumption A-M1).
  start: [0, 0, -15],
  lanterns: [
    { id: 'L1', pos: [0, 6, 6] },
    { id: 'L2', pos: [18, 3, 10] },
    { id: 'L3', pos: [-18, 3, 10] },
    { id: 'L4', pos: [35, 0, -10] },
    { id: 'L5', pos: [-35, 0, -10] },
    { id: 'L6', pos: [20, 0, -35] },
    { id: 'L7', pos: [-20, 0, -35] },
  ],
  moteSpawns: [
    ...ring(0, 0, 34, 0, steps(0, 20, 18)),
    ...ring(0, 0, 18, 3, steps(20, 20, 8)),
    ...ring(0, 0, 5, 6, [45, 135, 225, 315]),
  ],
  shadeSpawns: ring(0, 0, 43, 0, steps(0, 22.5, 16)),
  shadeIntervalTicks: 360,
  shadeMax: 10,
  shadeSpeed: 4.5,
  pads: [{ pos: [0, 3, 13], radius: 1, vy: 12, hSpeed: 8, dir: [0, -1] }],
  charms: [[30, 0, 25], [-30, 0, 25]],
  drifters: true,
  wind: true,
  ground: (x, z) => {
    const r = Math.hypot(x, z);
    if (r > 45) return null;
    if (r <= 2) return 14; // bell tower: 8 m above tier 2 -> an unclimbable wall
    if (r <= 8) return 6; // tier 2
    if (r >= 12 && r <= 24 && z > 0) return 3; // tier 1 (half annulus, z > 0)
    for (const a of RAMP_ANGLES) {
      const along = x * Math.cos(a) + z * Math.sin(a);
      const lateral = Math.abs(-x * Math.sin(a) + z * Math.cos(a));
      if (lateral <= 1.5 && along >= 24 && along <= 30) return (3 * (30 - along)) / 6;
    }
    return 0; // tier 0
  },
  pillars: [{ x: 0, z: 0, r: 2 }],
};

export const NIGHTS: Record<1 | 2 | 3, NightDef> = { 1: night1, 2: night2, 3: night3 };
