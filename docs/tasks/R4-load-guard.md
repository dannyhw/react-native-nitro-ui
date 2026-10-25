# R4 — Bench load guard samples the whole run

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/R4` (branch `task/R4-load-guard`, from `main`).
**Devices:** none (unit tests only). **Round cap (D19):** 1 + 2 fix rounds.

A1 and A1b were refused `--update-baseline` on iOS by the idle-machine rule (load1 ≤ 0.5 × cores),
which `baselineBlockers()` (`scripts/bench/lib.mjs`) checks from a single `os.loadavg()` sample taken
at the **end** of a 2.5–3 h run: A1b's iOS run was quiet for hours (load5 4.06 at the end, 2.39 hours
earlier) and was refused at 7.60 vs a 7.0 ceiling by its last minute.

1. Sample `os.loadavg()[0]` throughout the run (e.g. every 30 s and at each launch boundary) and
   record the samples (or a compact summary: count, median, p90, max, fraction over the ceiling) in
   the results JSON next to the existing load field.
2. The idle rule judges the run, not its last minute: refuse when the **median** exceeds the ceiling
   or more than 10 % of samples do (document the exact rule in `bench/baselines/README.md` and
   `docs/architecture/benchmarks.md`, and as a D9 amendment line in `docs/DECISIONS.md`). Keep
   refusing at start if load1 is already over the ceiling (fail fast, don't burn 3 h).
3. Older result files without samples keep today's behaviour.
4. Unit tests for the rule (all-quiet, quiet-with-a-spike-at-the-end → accepted, sustained-busy →
   refused, >10 % over → refused, legacy file → old rule), each shown red against the old rule where
   relevant. `bun run check` green.
