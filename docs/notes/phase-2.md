# Phase 2 notes — TICKET-02 "Ba hòn đảo" (contract v1.1)

Spec: [docs/specs/phase-2-TICKET-02.md](../specs/phase-2-TICKET-02.md) · Evidence: [docs/proof/phase-2/README.md](../proof/phase-2/README.md) · Tests: `tests/sim.test.ts` (Phase 1 regression under standard numbers), `tests/phase2.test.ts` (new features), `tests/cli.test.ts`.

## Superseded Phase 1 rules (changed by Ticket-02, tests updated with a `SUPERSEDED` comment)

| Phase 1 (ours) | Ticket-02 (standard) | Where |
|---|---|---|
| Instant speed | Accelerate / stop in ≤ 0.1 s (we use 60 m/s², 6 ticks) | `sim.test.ts` "accelerates…" |
| Island edge = wall, `fall_enabled: false` | Falling (Y < −10) costs a flame, respawn after 60 ticks; `fall_enabled: true` | `phase2.test.ts` "falling…" |
| All lanterns are safe zones | Only **lit** lanterns; shades inside a just-lit zone are evicted | `sim.test.ts` "LIT lanterns…", "a shade inside…" |
| Score per mote **picked** | Score per mote **deposited** (+10) | `sim.test.ts` pickup test |
| Pulse 2 motes / 6 m XZ / instant 4 m push | 3 motes / 5 m **3D** from feet + 0.8 m / 4 m push over 15 ticks | `sim.test.ts` pulse test |
| Hit-dropped motes vanish | Dropped into a 1.5–2.5 m ring, TTL 480, pickable from next tick | `sim.test.ts` hit test |
| Lantern cost 5, pickup 1.5 m, interact 3 m, jump 6 m/s, shades 3.5 m/s, stun 3 s, cooldown 2 s, bonus 1/s | 10, 1.0 m, 2.0 m, 7 m/s, 4.0 (4.5 Night 3), 2 s, 3 s, 2/s | `game.contract.json` |
| Our level layout (lanterns on a 25 m ring, 30 motes, 2 shades at start) | Standard maps (Part 2) | `src/sim/maps.ts` |
| Shade state names `chase`/`stunned` | `spawning`, `wander`, `chase`, `recoil`, `stunned` | `phase2.test.ts` states test |

## Assumptions (open points in Ticket-02)

| # | Topic | Decision |
|---|---|---|
| A-M1 | Night 3 start | Ticket gives none; (0,0,0) is inside the bell tower → **(0, 0, −15)** on tier 0. Nights 1–2 start at (0,0,0). |
| A-M2 | Angle convention | From +X toward +Z: (r·cos a, y, r·sin a). Fixed by "tier 1 (z > 0)" holding motes at 20°–160°. |
| A-M3 | Terrain | A height field. You can walk onto ground ≤ 0.35 m above your feet (ramps), higher ground is a wall (tiers 3 m, jump apex 1.2 m), lower ground makes you fall. Tower = ground 14 m in r ≤ 2 (unclimbable). |
| A-S1 | `spawning` length | 30 ticks: no movement, no hits. Then `chase` if ≤ 18 m (else `wander`). |
| A-S2 | `wander` | 1.5 m/s toward random points ≤ 8 m away (seeded). |
| A-S3 | Scenario shade default state | `chase` ("active immediately", as in v1.0). |
| A-S4 | Eviction state | Shades evicted from a just-lit zone use state `recoil` (harmless, pushed) and move 0.2 m/tick, so ≤ 30 ticks. |
| A-S5 | Who can hit | Only `wander`/`chase` shades. Height check uses feet vs. shade centre (shades hover 1 m above the ground). |
| A-S6 | Spawn choice | Random among valid points (≥ 15 m from Mây, all nights), seeded; the 2 shades at tick 300 use different points. |
| A-P1 | `player.invuln` | Boolean (true while invulnerable). Other cooldowns are seconds (`*_s`). |
| A-P2 | Dash end | After the 12 dash ticks, horizontal speed drops to run speed, then normal accel. Pad flight resumes after a mid-air dash. |
| A-P3 | Fall event | `player_hit {by:"fall", flames, dropped: 0, lost: n}`; Mây stays frozen below −10 during the 60-tick wait. |
| A-F1 | `motes_active` cap 30 | Counts all motes (random + dropped). "Free point" = no random mote currently on that spawn point. |
| A-D1 | Gió Lạc | Hovers 1 m; idle = 2 m/s to random points; fog points = the night's shade spawn points. `removed` drifters stay in the array with state `removed` (max 2 counts only non-removed). |
| A-D2 | Pulse timers | A flee started by a pulse (step 7) lasts exactly 240 / 120 ticks from the next tick (it gets +1 because step 8 of the same tick counts down). |
| A-W1 | Wind | Gusts start at sim ticks 1800, 3600, … for 300 ticks, direction = seeded integer degrees; pushes position (not velocity). Warning shown from 120 ticks before. |
| A-E1 | `night_start` | Emitted at tick 0, right after the tick-0 snapshot. |
| A-E2 | Pause in headless | `pause` input toggles. While paused only `tick` advances; the end line reports `state: "paused"` if the run stops while paused. |
| A-C1 | Charm in scenario | `charms[]` items: `{id?, pos, available?, respawn_ticks?}`. Motes in a scenario may be `[x,y,z]` or `{pos, kind?, ttl_ticks? / ttl_s?}`. |

## Acceptance criteria — Part 3 features

| Feature | Acceptance criteria (testable) | Check | Result |
|---|---|---|---|
| Gió Lạc | Spawns at 1200/2400 on Nights 2–3 only, ids D1.., max 2. idle→chase when carried ≥ 5 and ≤ 15 m, back to idle if not. Touch ≤ 1.2 m steals min(3, carried) once, emits `drifter_steal`, flees 240 ticks → `removed`. Pulse on chase → flee without stealing. Pulse on flee with loot → `drifter_drop`, loot becomes dropped motes, gone 120 ticks later. Never costs a flame, not blocked by safe zones or invulnerability. | `phase2.test.ts` "Gió Lạc" (5 tests); proof `drifter-steal`, `drifter-drop` | Pass |
| Bùa Gió | C1 at (35,0,0) N2, C1/C2 at (±30,0,25) N3. Picked like a mote → `charm_picked {charm_id, 600}`, run 7.2 m/s, dash without cooldown (re-press needed, ignored mid-dash), respawns after 2700 ticks. | `phase2.test.ts` "Bùa Gió" (2 tests); proof `charm` | Pass |
| 3-night chain | Menu → intro (island name + Ông Đăng) → play → result → next night; winning Night 3 shows Bình Minh with the total = sum of won nights; losing offers a replay of that night. | Manual play | **Not yet verified in a browser** |
| Pause | Esc/P stops logic completely; menu offers Tiếp tục / Chơi lại Đêm / Cài đặt / Về menu. Headless `pause` freezes sim_tick/time/spawns. | `phase2.test.ts` "pause"; proof `pause`; manual for the menu | Headless pass; UI not yet verified |
| Settings | Volume + mouse sensitivity sliders, saved in localStorage and restored on reload. | Manual | Not yet verified |
| Sound | Night music + SFX for pickup, lantern lit, pulse, hit, jump, dash, win, lose, shade spawn, last-10-s countdown (all synthesised in `src/web/audio.ts`). | Manual | Not yet verified |
| HUD | Flames top-left; mm:ss top-centre, red + blinking ≤ 30 s; lanterns k/n + score top-right; 10-cell firefly bar bottom-centre; dash & pulse cooldown icons bottom-right; "E — Nạp ánh sáng (x/10)" within 2 m; arrow to nearest unlit lantern when off-screen. | Manual (screenshot) | Not yet verified |
| Palette | Colours in Part 3 used for sky/fog/grass/sand/wood/cloud sea, lanterns, motes, shades, Mây, charm, gold, drifter, UI. Ambient = 0.15 + 0.55 × lit/total. | Code review: `src/web/world.ts`, `models.ts` PALETTE, `index.html` CSS vars, `main.ts` ambient | Pass (code); visual check pending |
| ≥ 30 FPS @ 1280×720 | Average FPS shown in the HUD corner during play. | Manual measurement | **Not yet measured** |
| Full night ≤ 30 s headless | 21 600 ticks per night. | `phase2.test.ts` "performance"; measured ≈ 0.2 s per night on the dev laptop (Windows 11, Node 24) | Pass |

## AI usage log (Phase 2)

| Step | What | Problems found & fix |
|---|---|---|
| Spec | Stored Ticket-02 verbatim, updated CLAUDE.md (mandatory tick order, maps as data), added `verify-phase` skill | — |
| Sim rewrite | maps.ts + sim.ts following the 12 steps with step-number comments | **Night 3 start inside the bell tower** found by the first full-night run (lost in 300 ticks by 3 falls) → assumption A-M1. **Dash moved at run speed on its last tick** (found while computing expected test values) → fixed. **Pulse-started flee lasted 1 tick less** (step 7 + step 8 same tick) → caught by a test, fixed. |
| Tests | 16 regression + 32 new + 4 CLI = 52, all green | 3 test-side mistakes (held key after respawn, walking off the 4 m bridge, strict `<` on a rounded value). The tests were fixed, the code was not changed for them. |
| Web | Flow, pause, settings, audio, HUD, palette, Night 2–3 terrain, drifter/charm models | Typecheck + build pass. In-browser behaviour still needs a manual check. |

Token/cost estimate: _fill in at tag time._ Saving tactics: maps as data copied once from the ticket; tests written from hand-computed expected values (they found 2 real bugs); one proof script driven by `cases.json`.

## Phase 2 evaluation

_Fill in at tag time._
