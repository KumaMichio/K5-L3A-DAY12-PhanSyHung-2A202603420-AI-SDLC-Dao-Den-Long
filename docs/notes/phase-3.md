# Phase 3 notes — TICKET-03 "Đèn cạn dầu" (contract v1.2)

Spec: [docs/specs/phase-3-TICKET-03.md](../specs/phase-3-TICKET-03.md) · Design: [ADR 0001](../adr/0001-lantern-fuel-and-dawn-win.md) · Breaking changes: [CHANGELOG.md](../../CHANGELOG.md) · Evidence: [docs/proof/phase-3/README.md](../proof/phase-3/README.md) · Tests: `tests/phase3.test.ts` (19 tests) + the earlier suites (70 tests in total, all green).

## Tests changed by Ticket-03 (none skipped)

| Test | Action | Reason |
|---|---|---|
| `sim.test` "interact deposits … (+10/firefly +100/lantern)" | Updated: +5/firefly, `lantern_lit.relight: false` | §5 new scoring, §7 `relight` field |
| `sim.test` "lighting the last lantern wins with time ×2 + flame bonus" | **Deleted**, comment left in place | §3: no early win, time bonus removed. Replaced by `phase3.test` "no longer ends the night" + dawn tests |
| `sim.test` "winning on the very tick time runs out" | Updated to "at dawn with every lantern lit Mây wins (dawn_survived)" | §3 reason `dawn_survived` |
| `phase2.test` snapshot key list | Updated: `player.capacity` added | §7 |
| `phase2.test` pause clock (300 s) | Updated to 240 s | §3 night lengths |
| Proof `docs/proof/phase-2` | Kept frozen (matches tag `phase-2`); CI now diffs `docs/proof/phase-3` | Proof must match the code at its tag |

## Assumptions (open points in Ticket-03)

| # | Topic | Decision |
|---|---|---|
| A3-1 | Fuel precision | Integer units of 1/60 (`FUEL_UNIT`). Snapshot/event fuel is rounded to 1 decimal. Unlit lanterns report `fuel: 0`. |
| A3-2 | Speed toward a lantern | A wandering shade walks to its target lantern at **shade speed** (4.0, or 4.5 on Night 3). It only wanders randomly at 1.5 m/s when there is no weak and no unlit lantern. It stops 2 m from an unlit target. |
| A3-3 | "Đi về đèn tắt gần nhất như trước" | Phase 2 shades wandered randomly; we read "như trước" as "head for the nearest unlit lantern" (nearest from the shade, ties → smaller id). Side effect: in a default run Mây standing still at the centre is not found (lanterns are 25 m away, detection is 12 m). |
| A3-4 | `target_lantern_id` (scenario) | Used while that lantern is weak. Otherwise the shade picks the nearest weak / unlit lantern as usual. |
| A3-5 | Refuel at a "full" lantern | Decay runs in step 2 before interact (step 5), so a lit lantern is never exactly 100 when E is pressed. E at a fresh lantern spends 1 firefly (formula as written). |
| A3-6 | Eviction on refuel | Only when the refuel brings fuel from < 30 to ≥ 30 (a zone that was already up had no shades inside). Same 30-tick push and `recoil` state as a new light. |
| A3-7 | `fuel_drain` cadence | Each draining shade counts its own drain ticks from 0 when it enters `drain`, and emits on every 60th (with the lantern's fuel after that tick's drain). |
| A3-8 | Pre-lit lanterns | `lit: true` → `ever_lit: true` unless the scenario says otherwise; `deposited` = 10; they do not count as successful lights. |
| A3-9 | Score keys | Added tuning `score.per_relight` (40), `per_stun_drain` (15, total), `per_lit_lantern_dawn` (50); `per_second_left` is 0. |

## Acceptance criteria → evidence

| Requirement | Evidence | Result |
|---|---|---|
| Fuel 100 on light/relight, −1/s, out at ≤ 0 (`lantern_out`, deposited 0, `ever_lit`) | `phase3.test` fuel tests; proof `burnout-relight` | Pass |
| Refuel formula, full lantern not selectable, receiving-lantern choice | `phase3.test` refuel + choice tests; proof `refuel` | Pass |
| Relight 5 (+40, `relit_count`), first light 10 (+100) | `phase3.test`; proof `burnout-relight`, `capacity` | Pass |
| Safe zone only at fuel ≥ 30 (exactly 30 still protects) | `phase3.test` "exactly 30…" | Pass |
| Drain: target choice, 5/s cumulative, `fuel_drain` every 60, exits (chase ≤ 6 m, pulse, out, ≥ 30, > 2 m), stun → wander, refuel eviction | `phase3.test` drain (6 tests); proof `drain`, `drain-pulse`, `refuel-evict` | Pass |
| Dawn win ≥ ceil(0.6 n) (3/5, 4/6, 5/7), no early win, no_flames first, nights 240/270/300 | `phase3.test` dawn (5 tests); proof `dawn-win`, `dawn-lose`, `all-lit-continues` | Pass |
| Capacity 10 + 2 × lights, max 20 | `phase3.test` capacity | Pass |
| Scoring (+5, +100, +40, +5/+15, dawn bonus) | tests above (exact scores); proof `dawn-win` = 597 | Pass |
| Contract v1.2 fields + exit 2 on a bad `target_lantern_id` | `phase3.test` fields; proof "Malformed file" | Pass |
| Fuel bar + 1 Hz blink < 30; unlit squashed 20% + torn; colour-blind setting (#00B3FF shades, white ⚠ warnings), HUD carried/capacity | Code: `src/web/models.ts` GreatLanternModel/ShadeModel, `main.ts` settings + HUD, `index.html` `.cb` | Built; **not yet checked in a browser** |

## AI log (Phase 3)

- Stored the ticket verbatim, then wrote the ADR before touching code, so the state model was decided first.
- A bash heredoc failed on quoting while patching `sim.ts`. Nothing was half-applied (checked with `git diff`). The same patch was run from a script file.
- New tests found one test-side mistake: "stun ends in wander" was asserted while Mây stood within 12 m, so the shade went straight to chase. The test was split, and the new one also tells the old rule (chase ≤ 18 m) apart from the new one.
- Token estimate: _fill in at tag time._

## Phase 3 evaluation

_Fill in at tag time._
