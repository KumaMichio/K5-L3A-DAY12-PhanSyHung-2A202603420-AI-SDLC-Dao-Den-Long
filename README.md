# Đảo Đèn Lồng

> Video demo: _(added in Phase 4)_ · Lab docs: [docs/lab/](docs/lab/README.md) · Phase 1 spec: [docs/specs/phase-1-PRD-0.md](docs/specs/phase-1-PRD-0.md)

3D third-person game. Mây, the young lantern keeper (nón lá + a little lantern), collects fireflies (đom đóm) on Đảo Bến, carries them back to relight the 5 Great Lanterns, and drives off the Ink Shades (Bóng Mực) with a pulse of light. Light all 5 → win. Lose all flames, or reach dawn → lose.

Stack: TypeScript. The game rules live in a deterministic simulation ([src/sim/](src/sim/)) that runs in two places: the Three.js browser client ([src/web/](src/web/)) and the Node headless CLI ([src/headless/](src/headless/)). Runs on macOS / Linux / Windows with Node ≥ 20.19.

## Install & run (3 commands)

```bash
npm ci
npm run build
npm run dev        # open the printed URL (http://localhost:5173)
```

## Controls

| Key | Action |
|---|---|
| W A S D | Move (relative to the camera) |
| ← / → or drag with the mouse | Rotate the camera |
| Space | Jump |
| E | Deposit carried fireflies into a nearby lantern (within 3 m) |
| F | Pulse of light: stuns and pushes Ink Shades within 6 m (costs 2 fireflies, 2 s cooldown) |
| R | Play again after winning or losing |

## Rules & scoring (Night 1)

- Walk within **1.5 m** of a firefly to pick it up (carry up to **10**).
- Each lantern needs **5** fireflies. Interact within **3 m** to deposit; it lights when full.
- Ink Shades chase at **3.5 m/s**. Contact (≤ **1 m**) costs **1 flame** (you have **3**) and makes you drop **50 %** of your fireflies (rounded down; they are lost in the fog). Then **1.5 s** invulnerability.
- Shades can never come within **6 m** of a lantern (lit or not): lanterns are safe zones.
- The night lasts **300 s**. Reaching dawn before all lanterns are lit is a loss.

| Event | Points |
|---|---|
| Firefly picked | +10 |
| Lantern lit | +100 |
| Shade stunned by a pulse | +25 each |
| On a win only: each whole second left | +1 |
| On a win only: each flame left | +50 |

All numbers come from [game.contract.json](game.contract.json) `tuning`. The code reads them from that file, so the two can't drift apart.

## Tests, headless mode, evidence

```bash
npm test             # build + 24 unit/scenario/CLI tests (incl. determinism, exit code 2)
npm run proof        # re-runs the proof scenarios through the real CLI -> docs/proof/phase-1/
node dist/headless/cli.js --seed 1 --night 1 --ticks 600 --out out.jsonl \
     [--scenario f.json] [--inputs f.json] [--snapshot-every 10]
```

- Headless follows Test Contract v1.0: fixed 60 ticks/s, no window/GPU, JSONL snapshots/events/end line. Exit 2 for malformed inputs/scenario.
- Evidence: [docs/proof/phase-1/README.md](docs/proof/phase-1/README.md). Assumptions + AI log: [docs/notes/phase-1.md](docs/notes/phase-1.md).
- `tuning.fall_enabled` is `false`: the island edge stops the player, so there is no `fall` hit event. `dash` is accepted in inputs but does nothing in Phase 1.

## Sáng tạo của tôi

_(Coming after the core is proven. Extras will be disabled in headless mode so contract output is unchanged.)_

## AI harness

[CLAUDE.md](CLAUDE.md) (agent rules + commands) · [.claude/settings.json](.claude/settings.json) (Stop hook: blocks the agent from finishing while `npm test` fails) · [.github/workflows/ci.yml](.github/workflows/ci.yml) (CI: tests + checks committed proof matches regenerated proof).
