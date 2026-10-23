# R1 — Release readiness 1: gate hygiene

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/R1` (branch `task/R1-gate-hygiene`, from `main`).
**Round cap (D19):** 1 + 2 fix rounds. Stay inside this list.

1. **D21:** every harness assertion on a wall-clock threshold (e.g. cold-batch `flushMs`, anything
   `toBeLessThan(<ms>)`) runs only under `HARNESS_TIMING=1` and refuses (fails loudly) when the
   1-minute load average ≥ 10; otherwise it logs the measured value and skips the threshold. The
   structural counters (corrections, immediate, flushes, stale, events) stay gated everywhere.
   List every converted assertion in the report. Show one converted gate still goes red under
   `HARNESS_TIMING=1` with a forced-slow value.
2. **`scripts/real-input/support.mjs:103`** dies with `ERR_STREAM_WRITE_AFTER_END` when the script
   owns Metro (T15b). Fix it; prove by running real-input without a pre-started Metro.
3. **Node 26:** the harness fails with a misleading ESM error on Node 26 (`.nvmrc` pins 24). Add an
   early, clear version check with the fix instruction to the harness/real-input entry points and a
   line in CONTRIBUTING.
4. Gates: `bun run check` green; iOS + Android harness full suites green **without**
   `HARNESS_TIMING`; real-input 3/3 both platforms.
