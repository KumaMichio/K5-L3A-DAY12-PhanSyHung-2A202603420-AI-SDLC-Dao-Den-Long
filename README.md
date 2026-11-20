# Đảo Đèn Lồng

> Video demo: _(added in Phase 4)_ · Lab docs: [docs/lab/](docs/lab/README.md) · Specs: [Phase 1](docs/specs/phase-1-PRD-0.md), [Phase 2](docs/specs/phase-2-TICKET-02.md)

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
| E | Deposit fireflies into the nearest unlit lantern within 2 m |
| F | Pulse of light: stuns + pushes Ink Shades within 5 m (costs 3 fireflies, 3 s cooldown) |
| Esc / P | Pause (Continue / Replay night / Settings / Menu) |

## Game & scoring (Phase 2, standard numbers from Ticket-02)

Three nights: **Đảo Bến** (5 lanterns, 300 s), **Đảo Cau** (two islands, bamboo bridge, jump pads, 6 lanterns, 330 s), **Đảo Chuông** (3 tiers, ramps, bell tower, wind gusts, 7 lanterns, 360 s). Menu → night intro → play → result → next night. Winning Night 3 shows the Dawn screen with your total.

- Fireflies are picked up automatically within 1 m (carry 10). Each lantern needs 10 and remembers partial deposits.
- Lit lanterns make a 6 m safe zone against Ink Shades. Shades chase within 12 m and give up beyond 18 m. A touch costs 1 flame (3 per night), drops half your fireflies around you, then 1.5 s invulnerability.
- Falling off an island costs a flame and all carried fireflies; you respawn at the start.
- **Gió Lạc** (Nights 2–3): a silk ribbon that steals 3 fireflies if you carry ≥ 5; pulse it to get them back.
- **Bùa Gió** (red charm): 10 s of 7.2 m/s running and dash without cooldown.

| Event | Points |
|---|---|
| Firefly deposited | +10 |
| Lantern lit | +100 |
| Shade hit by a pulse | +5 each |
| On a win: each whole second left | +2 |
| On a win: each flame left | +50 |

Game total = sum of the nights you won. All numbers come from [game.contract.json](game.contract.json) `tuning` (contract v1.1); the code reads them from that file.

## Tests, headless mode, evidence

```bash
npm test             # build + 52 tests: Phase 1 regression, one scenario per Phase 2 feature, CLI, full-night timing
npm run proof        # re-runs the Phase 2 proof cases through the real CLI -> docs/proof/phase-2/
node dist/headless/cli.js --seed 1 --night 1 --ticks 600 --out out.jsonl      [--scenario f.json] [--inputs f.json] [--snapshot-every 10]      # --night 1 | 2 | 3
```

- Headless follows Test Contract v1.1: fixed 60 ticks/s, the 12-step tick order, no window/GPU, JSONL snapshots/events/end line. Exit 2 for malformed inputs/scenario. A full night (21 600 ticks) takes about 0.2 s.
- Evidence: [Phase 1](docs/proof/phase-1/README.md) (frozen at tag `phase-1`), [Phase 2](docs/proof/phase-2/README.md). Notes (assumptions, superseded rules, acceptance criteria, AI log): [phase-1](docs/notes/phase-1.md), [phase-2](docs/notes/phase-2.md).

## Sáng tạo của tôi

- **Mây's design**: hooded wanderer with glowing eyes, red scarf, plant basket and a staff whose glass orb shows the fireflies you carry (one light per firefly), plus the PRD's nón lá with a small lantern.
- **Ink Shades** as tattered ink wraiths with violet eyes; they fade and shrink while stunned.
- **Hội An–style Great Lanterns** that fill up with light as you deposit.
- All visual/audio only: `src/web/` never feeds back into `src/sim`, so headless output is unchanged (the proof cases and determinism tests pass).

## AI harness

[CLAUDE.md](CLAUDE.md) (agent rules + commands) · [.claude/settings.json](.claude/settings.json) (Stop hook: blocks the agent from finishing while `npm test` fails) · [.claude/skills/verify-phase](.claude/skills/verify-phase/SKILL.md) (skill: full phase verification) · [.github/workflows/ci.yml](.github/workflows/ci.yml) (CI: tests + checks the committed proof matches the regenerated proof).
