#!/usr/bin/env node
// run_cmd: serves the built game (dist-web) and opens it in the default browser.
// The local leaderboard is stored on disk (survives restarts): ~/.dao-den-long/leaderboard.json
// (override with DDL_DATA_DIR). Export: node scripts/play.mjs --export-leaderboard out.json
import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEntry, rank } from '../dist/shared/leaderboard.js';
import { serve } from './server.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DDL_DATA_DIR ?? join(homedir(), '.dao-den-long');
const file = join(dataDir, 'leaderboard.json');

function load() {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return rank(Array.isArray(data.entries) ? data.entries : []);
  } catch {
    return [];
  }
}
function save(entries) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ entries }, null, 2) + '\n');
}

const argv = process.argv.slice(2);
const exp = argv.indexOf('--export-leaderboard');
if (exp >= 0) {
  const out = argv[exp + 1];
  if (!out) { console.error('error: --export-leaderboard needs a file'); process.exit(1); }
  writeFileSync(out, JSON.stringify({ entries: load() }, null, 2) + '\n');
  console.log(`exported ${load().length} entries from ${file} -> ${out}`);
  process.exit(0);
}

const portArg = argv.indexOf('--port');
const { port } = await serve(join(repo, 'dist-web'), {
  port: portArg >= 0 ? Number(argv[portArg + 1]) : 5180,
  api(req, res, body) {
    if (!req.url?.startsWith('/api/leaderboard')) return false;
    try {
      if (req.method === 'POST') save(addEntry(load(), JSON.parse(body)));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ entries: load() }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }));
    }
    return true;
  },
});
const url = `http://127.0.0.1:${port}/`;
console.log(`Đảo Đèn Lồng is running at ${url}  (leaderboard: ${file})  — Ctrl+C to stop`);
if (!argv.includes('--no-open')) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
void existsSync;
