# CLAUDE.md — Đảo Đèn Lồng

Solo lab: a 3D game built across 4 phases. Correct-to-spec beats complex or pretty.

## Current phase
**Phase 1 (PRD-0, Test Contract v1.0)** — spec: [docs/specs/phase-1-PRD-0.md](docs/specs/phase-1-PRD-0.md). Read it before any work. Its "Agent notes" section lists the hard rules and the open ambiguities.

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
- `src/sim/` — ALL gameplay rules (deterministic, no DOM, no Date/Math.random). `sim.ts` step order is documented in `docs/notes/phase-1.md` (A7).
- `src/headless/cli.ts` — contract CLI. `src/web/main.ts` — Three.js view only; never put rules here.
- `tests/` (vitest) · `scenarios/phase-N/` (proof inputs) · `docs/proof/phase-N/` (generated, never hand-edited) · `docs/notes/` (assumptions, AI log) · lab docs in `docs/lab/`.

## Commands
- `npm ci && npm run build` — install + compile headless to `dist/`
- `npm test` — build + all tests (a Stop hook blocks finishing while this fails)
- `npm run proof` — regenerate `docs/proof/phase-1/` from the real CLI (CI diffs it against the committed copy)
- `npm run dev` — play in the browser · `npm run typecheck`
- Headless: `node dist/headless/cli.js --seed 1 --night 1 --ticks 600 --out out/x.jsonl [--scenario f] [--inputs f]`

## When you change rules
Update the test + `docs/notes/phase-N.md` assumption, run `npm test` and `npm run proof`, and commit the regenerated proof together with the code.
