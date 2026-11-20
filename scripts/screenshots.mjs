#!/usr/bin/env node
// Captures README/evidence screenshots of the real UI at 1280×720: menu, night intro, gameplay HUD, settings.
// Usage: node scripts/screenshots.mjs [outDir=docs/screenshots]   (needs `npm run build`; CHROME_PATH optional)
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { serve } from './server.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? join(repo, 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const { server, port } = await serve(join(repo, 'dist-web'));
const opts = { headless: false, defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, args: ['--window-size=1280,720', '--no-first-run'] };
const fallbacks = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter((p) => p && existsSync(p));
let browser;
for (const executablePath of [undefined, ...fallbacks]) {
  try { browser = await puppeteer.launch({ ...opts, ...(executablePath ? { executablePath } : {}) }); break; } catch { /* next */ }
}
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await wait(1500);
await page.screenshot({ path: join(outDir, '1-menu.png') });
await page.click('#b-start');
await wait(800);
await page.screenshot({ path: join(outDir, '2-intro.png') });
await page.click('#b-go');
await page.keyboard.down('KeyW');
await wait(2500);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyD');
await wait(900);
await page.keyboard.up('KeyD');
await wait(400);
await page.screenshot({ path: join(outDir, '3-play.png') });
await page.keyboard.press('Escape');
await wait(400);
await page.click('#b-set');
await wait(400);
await page.screenshot({ path: join(outDir, '4-settings.png'), fullPage: false });
// Nights 2 and 3: start from the menu, walk a little, rotate the camera for a wider view
for (const n of [2, 3]) {
  await page.goto(`http://127.0.0.1:${port}/`);
  await wait(1200);
  await page.click(`#b-n${n}`);
  await wait(600);
  await page.click('#b-go');
  await page.keyboard.down('KeyW');
  await wait(1800);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('ArrowLeft');
  await wait(700);
  await page.keyboard.up('ArrowLeft');
  await wait(300);
  await page.bringToFront();
  if (await page.$('#b-resume')) { await page.click('#b-resume'); await wait(400); } // a lost focus pauses the game
  await page.screenshot({ path: join(outDir, `${4 + n}-night${n}.png`) });
}
console.log(JSON.stringify({ outDir, pageErrors: errors }));
await browser.close();
server.close();
