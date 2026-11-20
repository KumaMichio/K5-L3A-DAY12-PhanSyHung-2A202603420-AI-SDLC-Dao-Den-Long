#!/usr/bin/env node
// Claude Code Stop hook: block the agent from finishing while `npm test` fails.
// Runs from the project root no matter where the session cwd is, and shows the real failure output.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// realpathSync.native gives the canonical casing ("E:\..." not "e:\..."): vitest crashes on Windows
// ("Cannot read properties of undefined (reading 'config')") when the cwd drive letter is lowercase.
const root = realpathSync.native(process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const r = spawnSync('npm test', { cwd: root, encoding: 'utf8', shell: true });
if (r.status === 0) process.exit(0);

const out = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`.trim().split('\n').slice(-25).join('\n');
process.stderr.write(`npm test is failing (exit ${r.status}) in ${root}. Fix it (or explain why a test is obsolete) before finishing.\n${out}\n`);
process.exit(2);
