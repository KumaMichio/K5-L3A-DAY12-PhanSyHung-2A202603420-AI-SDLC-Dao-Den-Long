# Changelog

## [phase-3] — Test Contract v1.2 (Ticket-03 "Đèn cạn dầu")

### Breaking changes
- **Win rule:** the night no longer ends when every lantern is lit. Winning happens only at dawn with `lit ≥ ceil(0.6 × lanterns)`; `game_over.reason` is `dawn_survived`, and `all_lit` is never emitted.
- **Night length:** 240 / 270 / 300 s (was 300 / 330 / 360) → `time_left_s` and the dawn tick changed.
- **Scoring replaced:** +5 per firefly deposited (was +10), +100 first light, +40 relight, pulse +5 (+15 total on a draining shade), dawn bonus 50 + floor(fuel) per lit lantern + 50 per flame. The time bonus is removed (`score.per_second_left: 0`, new keys `per_relight`, `per_stun_drain`, `per_lit_lantern_dawn`).
- **Lit lanterns accept fireflies (refuel)** and can go out. New events `refuel`, `lantern_out`, `fuel_drain`. `lantern_lit` gains `relight`.
- **Safe zone** exists only while `fuel ≥ 30` (was: whenever lit).
- **Shade states:** new `drain`. A stun now ends in `wander` (was `chase` within 18 m).
- **Carry capacity** is 10 + 2 × successful lights (max 20), not a constant 10. `player.capacity` was added to the snapshot.
- **Snapshot:** each lantern adds `fuel`, `ever_lit`, `relit_count`.
- **Scenario:** lanterns accept `fuel`, `ever_lit` (`lit: true` without `fuel` → 100); `player.successful_lights`; `shades[].target_lantern_id`; shade `state` may be `drain`.
- **Tuning:** `contract_version` is "1.2"; new keys `fuel_max`, `fuel_decay_per_s`, `fuel_per_mote`, `relight_cost`, `win_ratio`, `drain_per_s`, `low_fuel_threshold`, `capacity_max`.

### Added
- Web: fuel bar with a 1 Hz blink below 30; an unlit lantern is squashed 20% with torn paper; colour-blind palette setting (shades #00B3FF, UI warnings white + ⚠); HUD shows carried/capacity and lit/needed.
- Docs: [ADR 0001](docs/adr/0001-lantern-fuel-and-dawn-win.md).

## [phase-2] — Test Contract v1.1 (Ticket-02 "Ba hòn đảo")

### Breaking changes
- Standard numbers replaced every Phase 1 tuning value (lantern cost 10, pickup 1 m, interact 2 m, pulse 3/5 m/3 s, jump 7 m/s, shades 4 m/s…). `fall_enabled: true`.
- The default Night 1 layout was replaced by the standard map. Nights 2 and 3 were added (`--night 1|2|3`).
- Mandatory 12-step tick order. Acceleration ≤ 0.1 s replaces instant speed.
- Only lit lanterns are safe zones (was: every lantern).
- Score per firefly deposited (was: per firefly picked up).
- Shade states renamed to `spawning`/`wander`/`chase`/`recoil`/`stunned`.
- Snapshot adds `night`, `wind`, the extended `player`, and the `motes`/`drifters`/`charms` arrays. Input adds `dash` and `pause`.

## [phase-1] — Test Contract v1.0 (PRD-0)
- First playable Night 1 with headless mode.
