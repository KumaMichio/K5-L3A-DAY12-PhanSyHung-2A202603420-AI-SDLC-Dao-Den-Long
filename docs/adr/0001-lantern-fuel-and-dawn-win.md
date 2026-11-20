# ADR 0001 — Lantern fuel state model and dawn-survival win

- Status: Accepted (Phase 3, Ticket-03 "Đèn cạn dầu", contract v1.2)
- Supersedes: Ticket-02 rules "lit lanterns accept no more fireflies", "shades never enter a safe zone", "win as soon as all lanterns are lit", and the whole Ticket-02 scoring.

## Context

Playtests showed strong players lit every lantern in about 2 minutes and the night ended early. The designer changed the goal from "light everything" to "keep the island lit until dawn". So lanterns now burn fuel and can go out, shades can drain weak lanterns, and winning is only checked at dawn.

## Decision

### 1. Lantern state model

A lantern was `{lit, deposited}` with one transition (unlit → lit). It is now:

```
            deposit ≥ cost (10 first time, 5 if ever_lit)
  UNLIT ───────────────────────────────────────────────▶ LIT (fuel = 100)
 (fuel 0,                                                │  fuel −1/s (decay)
  deposited                                              │  fuel −5/s per draining shade
  counts up)  ◀──────────── fuel ≤ 0: lantern_out ───────┘  refuel: +10 per firefly, cap 100
                             deposited = 0, ever_lit = true
LIT has two sub-states that matter to shades:  SAFE (fuel ≥ 30, 6 m zone)  /  WEAK (fuel < 30, no zone)
```

- **Fuel is an integer number of 1/60 units** (`FUEL_UNIT = 60`), as the ticket recommends. Decay is exactly 1 unit per tick and a drain is 5. Fuel is only rounded (to 1 decimal) when written to the snapshot or an event, so "exactly 30" and "≤ 0" comparisons are exact.
- Tick order: step 2 subtracts decay + drain. Lanterns at ≤ 0 go out right after step 2, before Mây moves. Interact (step 5) chooses among receiving lanterns (unlit, or lit and below full) and either deposits (light/relight) or refuels. Step 6 evicts shades from every zone that came back this tick (newly lit, or refuelled from < 30 to ≥ 30).
- `relit_count` and `ever_lit` live on the lantern. `successful_lights` lives on the player (it drives capacity: 10 + 2 per light, max 20).

### 2. Shades

A new `drain` state. A wandering shade targets the nearest WEAK lantern (or the nearest UNLIT one if there is none), drains it within 2 m, and leaves it when the lantern goes out, is refuelled to ≥ 30, or the shade is > 2 m away. Mây within 6 m → `chase`. Pulse → `stunned`. A stun now always ends in `wander`. Safe-zone blocking checks `fuel ≥ 30` instead of `lit`.

### 3. Win rule

The early win is removed: lighting everything only raises the dawn bonus. Step 11 now checks, in order: no flames → `lost/no_flames` (even on the dawn tick); dawn reached → `won/dawn_survived` if `lit ≥ ceil(0.6 × n)` (3/5, 4/6, 5/7), else `lost/dawn`. `all_lit` is no longer emitted. The dawn bonus is 50 + floor(fuel) per lit lantern, plus 50 per flame left. The time bonus is gone (`per_second_left: 0`).

## Consequences

- Phase 2 tests that encoded the replaced rules were updated or deleted with a written reason (see [CHANGELOG.md](../../CHANGELOG.md) and [docs/notes/phase-3.md](../notes/phase-3.md)). None were skipped.
- Because decay runs in step 2 before interact (step 5), a lit lantern is never exactly full when E is pressed. Pressing E at a freshly lit lantern therefore spends 1 firefly (ceil(1/600 / 10) = 1). This is literally what the formula says, and we keep it.
- The web view needs: a fuel bar, a 1 Hz blink below 30, an "off" look that doesn't depend on colour (squashed 20% + torn paper), and a colour-blind palette.
