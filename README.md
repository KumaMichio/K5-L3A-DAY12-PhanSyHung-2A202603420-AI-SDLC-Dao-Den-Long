# Đảo Đèn Lồng

> Video demo: _(added in Phase 4)_ · Lab docs: [docs/lab/](docs/lab/README.md) · Specs: [Phase 1](docs/specs/phase-1-PRD-0.md), [Phase 2](docs/specs/phase-2-TICKET-02.md), [Phase 3](docs/specs/phase-3-TICKET-03.md) · [CHANGELOG](CHANGELOG.md) · [ADR 0001](docs/adr/0001-lantern-fuel-and-dawn-win.md)

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
| W A S D (↑ ↓) | Move (relative to the camera) |
| ← / → or drag with the mouse | Rotate the camera (sensitivity in Settings) |
| Space | Jump |
| Shift | Dash (14 m/s for 0.2 s, 1.5 s cooldown) |
| E | Within 2 m: light / relight the nearest lantern, or refuel a lit one |
| F | Pulse of light: stuns + pushes Ink Shades within 5 m (costs 3 fireflies, 3 s cooldown) |
| Esc / P | Pause (Continue / Replay night / Settings / Menu) |

## Game & scoring (Phase 3 rules, contract v1.2)

Three nights: **Đảo Bến** (5 lanterns, 240 s), **Đảo Cau** (two islands, bamboo bridge, jump pads, 6 lanterns, 270 s), **Đảo Chuông** (3 tiers, ramps, bell tower, wind gusts, 7 lanterns, 300 s). **Goal: keep at least 60% of the lanterns lit until dawn** (3/5, 4/6, 5/7). Lighting them all does not end the night. Menu → night intro → play → result → next night. Winning Night 3 shows the Dawn screen with your total.

- Fireflies are picked up automatically within 1 m. You carry 10 + 2 per lantern you light this night (max 20).
- A lantern needs 10 fireflies the first time (5 to relight one that went out). Lit lanterns burn 1 fuel/s from 100; each firefly refuels +10. At 0 the lantern goes out.
- A lantern with ≥ 30 fuel has a 6 m safe zone against Ink Shades. Below 30 it blinks, loses the zone, and wandering shades come to **drain** it (5 fuel/s each). Pulse them off. Shades chase within 12 m and give up beyond 18 m. A touch costs 1 flame (3 per night), drops half your fireflies around you, then 1.5 s invulnerability.
- Falling off an island costs a flame and all carried fireflies; you respawn at the start.
- **Gió Lạc** (Nights 2–3): a silk ribbon that steals 3 fireflies if you carry ≥ 5; pulse it to get them back.
- **Bùa Gió** (red charm): 10 s of 7.2 m/s running and dash without cooldown.

| Event | Points |
|---|---|
| Firefly deposited (light, relight or refuel) | +5 |
| Lantern lit for the first time | +100 |
| Lantern relit | +40 |
| Shade hit by a pulse | +5 (+15 if it was draining) |
| On a win: each lit lantern at dawn | +50 + its remaining fuel |
| On a win: each flame left | +50 |

Game total = sum of the nights you won. All numbers come from [game.contract.json](game.contract.json) `tuning` (contract v1.2); the code reads them from that file. Settings include volume, mouse sensitivity and a **colour-blind palette** (saved).

## Tests, headless mode, evidence

```bash
npm test             # build + 70 tests: Phase 1-2 regression, Phase 2 + 3 feature scenarios, CLI, full-night timing
npm run proof        # re-runs the Phase 3 proof cases through the real CLI -> docs/proof/phase-3/
node dist/headless/cli.js --seed 1 --night 1 --ticks 600 --out out.jsonl      [--scenario f.json] [--inputs f.json] [--snapshot-every 10]      # --night 1 | 2 | 3
```

- Headless follows Test Contract v1.2: fixed 60 ticks/s, the 12-step tick order, no window/GPU, JSONL snapshots/events/end line. Exit 2 for malformed inputs/scenario. A full night (21 600 ticks) takes about 0.2 s.
- Evidence: [Phase 1](docs/proof/phase-1/README.md) (frozen at tag `phase-1`), [Phase 2](docs/proof/phase-2/README.md) (frozen at `phase-2`), [Phase 3](docs/proof/phase-3/README.md). Notes (assumptions, superseded rules, acceptance criteria, AI log): [phase-1](docs/notes/phase-1.md), [phase-2](docs/notes/phase-2.md), [phase-3](docs/notes/phase-3.md).

## Sáng tạo của tôi

- **Mây's design**: hooded wanderer with glowing eyes, red scarf, plant basket and a staff whose glass orb shows the fireflies you carry (one light per firefly), plus the PRD's nón lá with a small lantern.
- **Ink Shades** as tattered ink wraiths with violet eyes; they fade and shrink while stunned.
- **Hội An–style Great Lanterns** that fill up with light as you deposit.
- All visual/audio only: `src/web/` never feeds back into `src/sim`, so headless output is unchanged (the proof cases and determinism tests pass).

## AI harness

[CLAUDE.md](CLAUDE.md) (agent rules + commands) · [.claude/settings.json](.claude/settings.json) (Stop hook: blocks the agent from finishing while `npm test` fails) · [.claude/skills/verify-phase](.claude/skills/verify-phase/SKILL.md) (skill: full phase verification) · [.github/workflows/ci.yml](.github/workflows/ci.yml) (CI: tests + checks the committed proof matches the regenerated proof).
