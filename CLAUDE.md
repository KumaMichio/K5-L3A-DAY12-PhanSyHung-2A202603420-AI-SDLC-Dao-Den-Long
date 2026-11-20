# CLAUDE.md — Đảo Đèn Lồng

Solo lab: a 3D game built across 4 phases. Correct-to-spec beats complex or pretty.

## Current phase
**Phase 2 (TICKET-02, Test Contract v1.1)** — spec: [docs/specs/phase-2-TICKET-02.md](docs/specs/phase-2-TICKET-02.md). It REPLACES Phase 1 tuning + contract v1.0 where they differ (standard numbers, 3 nights, mandatory 12-step tick order, new snapshot fields, exact shade state names). Our decisions on its open points: [docs/notes/phase-2.md](docs/notes/phase-2.md).
History: Phase 1 spec [docs/specs/phase-1-PRD-0.md](docs/specs/phase-1-PRD-0.md) (superseded parts are listed in the Phase 2 notes).
- The 12-step tick order in the ticket is mandatory; `Sim.step` must follow it step by step, with the step number in a comment.
- Maps are data (`src/sim/maps.ts`), copied from ticket Part 2. Angles are measured from +X toward +Z: (r·cos a, y, r·sin a).
- Every new feature needs at least one headless scenario in `tests/` (DoD). Full night (21 600 ticks) headless must run in ≤ 30 s.

## Rules for the agent
- The Test Contract (headless CLI, input/scenario/JSONL formats, tick model) is exact. Never deviate; when unsure, re-read the spec, don't guess.
- Keep game logic separate from rendering: the headless sim must run with no window or GPU.
- `game.contract.json` tuning must match the values the code uses. Load tuning from that file, don't duplicate the constants.
- Determinism: seeded RNG only, no wall clock, stable iteration order.
- Creative extras must be off in headless mode and must not change contract output.
- Don't invent requirements. Record every assumption in `docs/notes/` (assumptions per phase).
- Not done without evidence: run the tests/headless scenarios and save the output in `docs/proof/phase-N/`. Never hand-edit output or write always-pass tests.
- Small commits, one change each. Never commit `.env` or keys.

## Layout
- `src/sim/` — ALL gameplay rules (deterministic, no DOM, no Date/Math.random). `sim.ts` `step()` follows Ticket-02's mandatory 12-step order (numbered comments); `maps.ts` holds the standard maps.
- `src/headless/cli.ts` — contract CLI. `src/web/main.ts` — Three.js view only; never put rules here.
- `tests/` (vitest) · `scenarios/phase-N/` (proof inputs) · `docs/proof/phase-N/` (generated, never hand-edited) · `docs/notes/` (assumptions, AI log) · lab docs in `docs/lab/`.

## Commands
- `npm ci && npm run build` — install + compile headless to `dist/`
- `npm test` — build + all tests (a Stop hook blocks finishing while this fails)
- `npm run proof` — regenerate `docs/proof/phase-2/` from the real CLI using `scenarios/phase-2/cases.json` (CI diffs it). Earlier phases' proof is frozen at their tag.
- `npm run dev` — play in the browser · `npm run typecheck`
- Headless: `node dist/headless/cli.js --seed 1 --night 1 --ticks 600 --out out/x.jsonl [--scenario f] [--inputs f]`

## When you change rules
Update the test + `docs/notes/phase-N.md` assumption, run `npm test` and `npm run proof`, and commit the regenerated proof together with the code.
