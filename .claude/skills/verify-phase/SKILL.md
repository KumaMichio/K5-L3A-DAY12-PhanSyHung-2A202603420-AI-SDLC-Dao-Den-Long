---
name: verify-phase
description: Run the full verification for the current phase (tests, headless proof, determinism, full-night timing) and save evidence to docs/proof/phase-N. Use before tagging a phase or after changing src/sim.
---

# Verify a phase

1. `npm test`: must be all green. If a test from an earlier phase now fails because the ticket changed a rule, do not delete it silently. Update it, and record the old rule, the new rule and the ticket section in `docs/notes/phase-N.md` under "Superseded".
2. `npm run proof -- phase-N`: regenerates `docs/proof/phase-N/` from the real CLI (each case runs twice, sha256 compared). Never edit those files by hand.
3. Full-night timing (contract: ≤ 30 s for 21 600 ticks), once per night:
   `node dist/headless/cli.js --seed 1 --night K --ticks 21600 --out out/full-K.jsonl` with `time`; record the result + machine in the proof README/notes.
4. Update the requirement → evidence table in `docs/notes/phase-N.md` (Pass / Not met + reason).
5. Commit code + regenerated proof together, then tag `phase-N` only when the user asks.
