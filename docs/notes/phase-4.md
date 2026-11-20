# Phase 4 notes — TICKET-04 "Bình minh: phát hành v1.0.0" (contract v1.3)

Spec: [docs/specs/phase-4-TICKET-04.md](../specs/phase-4-TICKET-04.md) · Results: [bench.json](../../bench.json), [soak.json](../../soak.json) · Regression proof: [docs/proof/phase-4/README.md](../proof/phase-4/README.md) · Tests: `tests/phase4.test.ts` (77 tests in total).

## Assumptions

| # | Topic | Decision |
|---|---|---|
| A4-1 | Bench "Bóng Mực vẫn di chuyển theo luật wander" | Shades stay in `wander` for the whole bench (the wander → chase detection is off with damage). They follow the Phase 3 wander rule (head to the nearest weak/unlit lantern), so they gather at L4/L5. |
| A4-2 | Bench spread | 200 shades and 100 fireflies are uniform by area in a disc of radius 38 m (inside the 40 m island), seed 42. Shades hover 1 m up. |
| A4-3 | Camera direction | "Counter-clockwise from above" uses the ticket's map convention (angle from +X toward +Z): position (30·cos a, 15, 30·sin a), a = 2π·t/15. |
| A4-4 | `load_ms` | From the bench Node process start (`performance.timeOrigin`) to the page's first bench frame (same machine clock). |
| A4-5 | `peak_mem_mb` | Summed RSS (working set on Windows) of the browser process and all its children, sampled every 2 s (5 s on Windows, where a probe is costly) during the measured window. |
| A4-6 | vsync | `--disable-gpu-vsync --disable-frame-rate-limit`. The measured 92 FPS is above 60 Hz, which confirms it is off. |
| A4-7 | MSAA | Off by default in play and bench (fill-rate on integrated GPUs; the 1 % low dropped below 30 with it on). `?aa=1` turns it on. |
| A4-8 | Soak | Night i is 1-based (seed 7 + i, i = 1..10). Input uses its own RNG seeded from the night seed. `mem_start` is after the first night's `Sim` is constructed; `mem_end` is after the last night is released. Both are measured after a forced GC (`--expose-gc`) so garbage is not counted. |
| A4-9 | Leaderboard storage | "On local disk": the launcher (`run_cmd`) stores `~/.dao-den-long/leaderboard.json`. When the game is opened from a plain static server (Release zip without Node), it falls back to `localStorage`. `score` = the sum of the nights won in the session; `seed` = the session seed (night n uses seed + n). |
| A4-10 | Names | `[A-Za-z0-9_]{3,12}`, plus Vietnamese letters with diacritics (bonus): `\p{L}\p{M}\p{Nd}_`, NFC-normalised. |
| A4-11 | Pause key | Rebindable (default P); Esc always pauses as well and cancels a rebinding. |

## Requirement → evidence

| Requirement | Evidence | Result |
|---|---|---|
| bench_cmd output + scene (200 wander shades, 100 fireflies, L1–L3 lit, switches off, camera orbit, 3 s warm-up, exit 0) | `bench.json`; `phase4.test` "bench scene" (counts, states, no spawns/damage/pickup/fuel loss/end over 20 000 ticks, deterministic positions); screenshot `docs/screenshot-bench.png` | avg 92.1 · p1 33.6 · load 1 561 ms on UHD 630 → **Pass** (on our laptop; the grader's machine decides) |
| Soak 10 nights, 0 crashes, mem_end ≤ 1.2 × start | `soak.json` (52 → 57.5 MB = 1.11×); `phase4.test` "soak" | Pass |
| Leaderboard: entry after dawn/loss, name rule, fields, top 10, order, on disk, screen, export | `phase4.test` rules + export; manual API test (POST, server restart, export, Vietnamese name) | Pass (UI flow checked by screenshots up to the HUD; the full win → name entry path was not played through) |
| Rebinding, clash warning, reset, saved | Code `main.ts` `tryBind`/settings; screenshot `4-settings.png` | Screen verified; clash message not exercised by a test |
| Subtitles/cues (shade + edge arrow, wind, last 10 s, low fuel), reduced motion, 18 px / ×1.25 | Code `main.ts` `subtitle`/`edgeArrow`/`flash`/shake, `index.html` rem sizes | Built; partially verified (screenshots) |
| ≤ 3 commands from a clean clone | README (`npm ci`, `npm run build`, `npm start`) | Verified locally; **clean-machine test still to do** |
| README / CHANGELOG (4 phases) / CREDITS / LICENSE | files in the repo root | Pass |
| Release v1.0.0 with a runnable build | `release/` zip (web build + launcher, needs only Node) | Built; **upload pending** |
| v1.0–v1.2 still hold | All 77 tests; Phase 4 proof outputs byte-identical to the Phase 3 proof | Pass |

## AI log (Phase 4)

- **Bench at 7 FPS** on the first run: separate meshes per shade (~5 000 draw calls). Fixed with instanced crowds (`ShadeCrowd`, `MoteSwarm`).
- **WebGL shader errors** with 200 shades: a zero-intensity `PointLight` left on every shade since Phase 2 (each light costs shader work for every material). Removed. It was also wasting time in normal play.
- **Bench hung** waiting for the page: a synchronous `PowerShell` memory probe blocked Node's event loop and starved puppeteer. Made async and less frequent.
- **Bundled Chrome for Testing blocked** on this Windows machine (exit 0xC0E90002). Added fallback to an installed Chrome/Edge or `CHROME_PATH`.
- 1 % low under 30 with MSAA → MSAA off by default. Results varied ±5 FPS between runs on this laptop.
- One test-side arithmetic slip (top-10 cutoff 40 vs 50).
- A `sed` edit put a `//` comment inside a one-line object and broke the build. The bench that ran right after used the previous build; this was caught by reading the build output, and the bench was rerun.

## Phase 4 evaluation

_Fill in at tag time (see also docs/RETRO.md)._
