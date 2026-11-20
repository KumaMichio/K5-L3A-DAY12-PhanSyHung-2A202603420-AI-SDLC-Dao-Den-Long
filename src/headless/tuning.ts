import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tuning } from '../sim/types.js';

/** Reads tuning from game.contract.json at the repo root (single source of truth). */
export function loadTuning(): Tuning {
  const here = dirname(fileURLToPath(import.meta.url));
  const contract = JSON.parse(readFileSync(resolve(here, '../../game.contract.json'), 'utf8'));
  return contract.tuning as Tuning;
}
