#!/usr/bin/env node
// bench_cmd (Ticket-04 §1): node scripts/bench.mjs --seed 42 --duration 30 --out bench.json [--screenshot docs/screenshot.png]
// Opens a 1280×720 (device scale 1) Chrome window via puppeteer with vsync and the frame-rate cap
// disabled, loads the fixed bench scene (?bench), warms up 3 s, measures --duration s of frames, exits 0.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer';
import { serve } from './server.mjs';

const t0 = performance.timeOrigin; // ~ process start (epoch ms), used for load_ms
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const seed = Number(opt('seed', '42'));
const duration = Number(opt('duration', '30'));
const out = opt('out', 'bench.json');
const shot = opt('screenshot', null);
const WARMUP = 3;
const contract = JSON.parse(readFileSync(join(repo, 'game.contract.json'), 'utf8'));

// RSS (MB) of the browser process and all its children. Async (a blocking call starves puppeteer's
// DevTools traffic) and only every few seconds (spawning a probe costs CPU and could disturb the frames).
const run = promisify(execFile);
const WIN_PS = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $([math]::Round($_.WorkingSetSize/1024))" }';
const SAMPLE_MS = process.platform === 'win32' ? 5000 : 2000;
async function treeRssMb(rootPid) {
  try {
    const { stdout } = process.platform === 'win32'
      ? await run('powershell', ['-NoProfile', '-Command', WIN_PS], { encoding: 'utf8' })
      : await run('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' });
    const rows = stdout.trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number));
    const kids = new Map();
    for (const [pid, ppid] of rows) (kids.get(ppid) ?? kids.set(ppid, []).get(ppid)).push(pid);
    const rss = new Map(rows.map(([pid, , kb]) => [pid, kb]));
    let total = 0;
    const stack = [rootPid];
    while (stack.length) { const p = stack.pop(); total += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); }
    return total / 1024;
  } catch {
    return null;
  }
}

const { server, port } = await serve(join(repo, 'dist-web'));
const launchOpts = {
  headless: false,
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  args: ['--window-size=1280,720', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run'],
};
// Bundled Chrome for Testing first (installed by `npm ci`); CHROME_PATH or an installed Chrome/Edge as fallback
// (some Windows policies block the downloaded test build).
const systemBrowsers = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p) => p && existsSync(p));
let browser;
for (const executablePath of process.env.CHROME_PATH ? systemBrowsers : [undefined, ...systemBrowsers]) {
  try {
    browser = await puppeteer.launch({ ...launchOpts, ...(executablePath ? { executablePath } : {}) });
    break;
  } catch (e) {
    console.error(`could not launch ${executablePath ?? 'bundled Chrome'}: ${String(e.message).split('\n')[0]}`);
  }
}
if (!browser) { server.close(); console.error('bench failed: no browser could be launched'); process.exit(1); }

let code = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/?bench&seed=${seed}&duration=${duration}&warmup=${WARMUP}`);
  await page.waitForFunction('window.__bench && window.__bench.firstFrameAt > 0', { timeout: 60000 });
  const firstFrameAt = await page.evaluate('window.__bench.firstFrameAt');
  const pid = browser.process()?.pid;
  let peak = null;
  let busy = false;
  const sample = async () => {
    if (busy || !pid) return;
    busy = true;
    const m = await treeRssMb(pid);
    if (m !== null) peak = Math.max(peak ?? 0, m);
    busy = false;
  };
  await page.waitForFunction('window.__bench.measuring', { timeout: 60000, polling: 100 });
  const timer = setInterval(sample, SAMPLE_MS);
  void sample();
  if (shot) setTimeout(() => page.screenshot({ path: shot }).catch(() => {}), (duration / 2) * 1000);
  await page.waitForFunction('window.__bench.done', { timeout: (duration + 60) * 1000, polling: 250 });
  clearInterval(timer);
  while (busy) await new Promise((ok) => setTimeout(ok, 50));
  await sample();
  const b = await page.evaluate('window.__bench');
  const dts = b.dts; // ms per frame inside the measured window
  const N = dts.length;
  const sum = dts.reduce((a, x) => a + x, 0);
  const sorted = [...dts].sort((a, c) => a - c);
  const k = Math.max(1, Math.ceil(0.01 * N));
  const worst = sorted.slice(-k);
  const p95 = sorted[Math.min(N - 1, Math.ceil(0.95 * N) - 1)];
  const r1 = (x) => Math.round(x * 10) / 10;
  const report = {
    contract_version: contract.contract_version,
    avg_fps: r1((1000 * N) / sum),
    p1_low_fps: r1(1000 / (worst.reduce((a, x) => a + x, 0) / k)),
    frame_ms_p95: r1(p95),
    frames: N,
    load_ms: Math.round(firstFrameAt - t0),
    peak_mem_mb: peak === null ? null : Math.round(peak),
    vsync_off: true,
    renderer: `three.js r${b.three} WebGL2 on ${await browser.version()} (${b.gpu})`,
    os: `${os.type()} ${os.release()} ${os.arch()} · ${os.cpus()[0]?.model.trim()} · ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`,
    shades: b.shades,
    motes: b.motes,
  };
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (e) {
  console.error(`bench failed: ${e.stack ?? e}`);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
