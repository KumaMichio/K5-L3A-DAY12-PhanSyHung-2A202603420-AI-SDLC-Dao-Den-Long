# Phase 1 notes: assumptions, acceptance, AI log

## Assumptions (where PRD-0 is open)

| # | Topic | Decision | Why |
|---|---|---|---|
| A1 | Pulse cost | Paid from **carried fireflies** (`pulse_cost` = 2). Not enough fireflies, or cooldown running → nothing happens, no event. | PRD: "tỏa sáng … tốn ánh sáng". Fireflies are the light. |
| A2 | Pulse with no shade in range | Still costs light and emits `pulse` with `stunned_ids: []`. | The action happened. |
| A3 | Pulse push | Each stunned shade is pushed `pulse_push_m` straight away from the player (XZ), then kept out of safe zones. Re-pulsing a stunned shade resets its stun. | Simplest reading. |
| A4 | Deposit | Interact deposits into the **nearest unlit** lantern within `interact_radius`: `amount = min(carried, lantern_cost − deposited)`. A lantern lights when `deposited == lantern_cost`. Events in that tick: `deposit`, then `lantern_lit`. | Avoids wasting fireflies. Event order matches cause → effect. |
| A5 | Hit | A chasing shade within `shade_hit_radius` hits a non-invulnerable player: −1 flame, `dropped = floor(carried × hit_drop_ratio)`. Dropped fireflies disappear. Then `invuln_s` of invulnerability. At most one hit per tick; stunned shades don't hit. | Dropped motes reappearing would change `motes_active` in ways tests can't predict. |
| A6 | Safe zone | Shades can't enter `safe_radius` around **any** lantern, lit or unlit. A shade is placed exactly on the boundary. | PRD: "Bóng Mực sợ những chiếc đèn" (all lanterns). |
| A7 | Win / lose priority | Step order: timers → move → jump → pickup → interact (**win check**) → pulse → shades move → hit (**no_flames**) → spawns → **dawn**. A win in the same tick beats a loss. | Fixed order = deterministic event order. |
| A8 | Score bonus | `per_second_left × floor(time_left)` + `per_flame_left × flames`, **only on a win**, included in the `end` score. | Bonus rewards finishing early. |
| A9 | Snapshots | Only at ticks that are multiples of `--snapshot-every` (from 0). No extra snapshot at game over; the `end` line carries the final state. | Contract says "mỗi N tick". |
| A10 | Fall | `fall_enabled: false`: the island (r = 40 m) edge is a wall. No `fall` events. | Simpler. The contract allows it. |
| A11 | Jump | Vertical only (6 m/s, gravity 20 m/s²). All radii are XZ, so jumping does not dodge shades. | Contract: distances are XZ-only. |
| A12 | Level | Island r = 40 m. L1..L5 on a 25 m ring, L1 = (0,0,25), every 72°. 30 random fireflies (r ≤ 36 m); +1 every 3 s while < 30. 2 shades at start on a 38 m ring (y = 1), +1 every 45 s up to 4 (`shade_spawned`). | Enough fireflies to win (25 needed). Pressure grows. |
| A13 | Ids | Fireflies `M1, M2…`, shades `S1, S2…` in creation order. Scenario ids are kept; generated ids skip ids already taken. | Deterministic ids. |
| A14 | Scenario | `random_* = false` with no list → none. `random_* = true` with a list → the list is the start, auto-spawn continues. Unknown lantern id → exit 2. | Follows contract §D. |
| A15 | Exit codes | 2 = malformed inputs/scenario (bad JSON, wrong types, `move` out of [−1,1], non-increasing ticks). 1 = other errors (bad CLI args, missing file, `--night` ≠ 1). | Contract §B. |

## Acceptance criteria → evidence

| Requirement | Check | Evidence | Result |
|---|---|---|---|
| Headless CLI args, exit 0, `end` line last | `tests/cli.test.ts` | `npm test` | Pass |
| Malformed file → exit 2 + stderr | `tests/cli.test.ts`, proof `bad.inputs.json` | [proof](../proof/phase-1/README.md) | Pass |
| Tick model (tick-0 snapshot, events at k+1, time_left) | `sim.test.ts` "tick model" | `npm test` | Pass |
| Movement speed, camera-yaw rotation, normalisation, sticky inputs, edge buttons | `sim.test.ts` | `npm test` | Pass |
| Pickup ≤ radius, capacity | `sim.test.ts` | `npm test` | Pass |
| Deposit / light / win + bonus | `sim.test.ts`, proof `win` (score 598 checked by hand) | proof | Pass |
| Shade chase, hit, drop, invulnerability, lose (no_flames) | `sim.test.ts`, proof `hit-lose` | proof | Pass |
| Pulse cost, radius, push, stun duration, cooldown | `sim.test.ts`, proof `pulse` | proof | Pass |
| Safe radius | `sim.test.ts`, proof `safe-zone` | proof | Pass |
| Dawn | `sim.test.ts`, proof `dawn` | proof | Pass |
| Determinism (same seed/scenario/inputs → identical bytes) | unit + CLI test + proof (2 runs, sha256) | proof | Pass |
| Playable Night 1 in 3D, HUD, replay (R) | Manual play in browser | _Screenshot / clip TODO_ | **Not yet verified visually.** The dev server serves the page, but nobody has played it yet |
| Lanterns brighten the island; warm = good, purple-black = danger | Manual | _TODO_ | Not yet verified |

## AI usage log

| Step | Tool / model | What it did | Problems found & fix |
|---|---|---|---|
| Read lab docs | Claude Code (Opus 5.5) | Summarised the tasks from the 6 lab docs | — |
| Store PRD-0 | Claude Code | Copied PRD-0 verbatim into `docs/specs/`, added hard-rule checklist + ambiguity list, created `CLAUDE.md` | Couldn't read the lab-board artifact directly (owned by someone else, needs approval) → pasted manually |
| Build sim + CLI + tests | Claude Code | Wrote `src/sim`, `src/headless`, 24 tests, proof scenarios | One test failed: it recomputed a length from 3-decimal-rounded output. The test's tolerance was too tight, the code was fine. Fixed the test with a comment explaining why. |
| Web client | Claude Code | Three.js renderer reusing `Sim` | Typecheck + build pass. Visual check still to do by hand. |
| Stop hook | Claude Code | `npm test` gate on Stop | The first version blocked even though tests passed by hand. It hid the output (`> /dev/null`), so the cause was invisible. Reproduced it: vitest crashes on Windows when the cwd drive letter is lowercase (`e:\` vs `E:\`). Fix: [scripts/stop-gate.mjs](../../scripts/stop-gate.mjs) runs from the canonical project root (`realpathSync.native`) and prints the last 25 lines on failure. Checked both ways: green → exit 0, a deliberately red test → exit 2. |

Token/cost estimate (Phase 1): _fill in from the Claude usage page at tag time._ Savings: one spec file loaded once; tests written alongside the code so failures pointed at the exact rule; no exploratory agent runs.

## Phase 1 evaluation

_Fill in at tag time: what passed, what didn't, harness changes._
