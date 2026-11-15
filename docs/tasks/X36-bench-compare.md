# X36 — The bench compares against the last release, not against committed baselines

**Kind:** tooling · **Devices:** none · **Budget:** 6 hours, one round

## Goal

Before a release, one bench session answers "is this slower than the last release?" by measuring
both in the same session on the same device. The repository no longer carries per-machine baseline
files or the machinery that mints and checks them.

## Why

The committed baselines and `--check` have never caught a regression: the only red was 13 noise
failures on a loaded machine. The real finds came from plain runs and before/after runs. The bench
has not run since 2026-11-01, baselines cover 8 of 23 components, and the README's comparison with
`@expo/ui` does not come from the baselines at all. Baselines are keyed per machine, which is why
they needed a mint, a merge, missing-sample rules and about 25,000 lines of data.

## Behaviour when done

1. `scripts/bench/run.mjs` (or `report.mjs`, whichever fits) has one comparison mode: given a git
   ref, by default the newest release tag, it measures that ref and the working tree in the same
   session on the same device, interleaved the way the existing paired arms are, and reports per
   cell the ratio with its confidence interval. It exits non-zero when a cell is slower by the rule
   decision D9 already uses (ratio over 1.20, interval excluding 1.05, cell quiet within the run),
   and says which cells.
2. How the older ref is measured is your design; pick the simplest thing that is correct (for
   example building the library at that ref into a second arm of the bench app, or a second app
   build). State the choice and its cost in the report. `--dry-run` prints the full plan for a
   comparison without a device.
3. Gone, with their tests: `bench/baselines/` per-machine files, minting, `--check` against a
   baseline, `--update-baseline`, machine labels that exist only for baselines, and the
   missing-sample rules that exist only for baselines. Follow the audit's "smallest setup" list and
   its "Needs the owner's decision" rows for baselines; where the audit was wrong about something
   being unused, keep it and say so.
4. `bench/baselines/renders.json` and `perf:renders` are untouched: the render-count check in
   `check` keeps working.
5. Documents stay true. `docs/performance.md` and the README quote measured numbers: do not change
   a number. Where a sentence says baselines are committed or names the mint, rewrite it to describe
   the comparison. `docs/architecture/benchmarks.md`, `CONTRIBUTING.md` and `AGENTS.md` describe the
   new command and nothing that was removed. The gate named `bench` in `scripts/gate.mjs` still
   works for a plain run and for the comparison.

## Proof

- Unit tests for the comparison rule and the plan, each shown red once by breaking what it guards
  (the 1.20 bound, the interval, the quiet rule, picking the newest tag, interleaving). Fixtures
  must not coincide with the right answer.
- `--dry-run` output for a comparison, pasted in the report.
- `node scripts/gate.mjs check` green, `bun run bench:typecheck` green.
- No device run in this task: do not acquire a lease and do not run the bench. Both device pairs are
  in use by other tasks. Say plainly in the report that the comparison has not yet been run on a
  device; the first real run is scheduled by the orchestrator.

## Out of scope

`perf:renders`; the README's `@expo/ui` comparison and the tool behind it
(`bench/tools/arm-ratios.mjs`); the Android stale-bundle bug the audit mentions (write one
follow-up line for it); adding components to the bench plan.

## Decided already

- Benchmarks run before a release, not per task.
- No committed baseline of any kind for device timings after this task.
- If measuring an older ref in the same session turns out to need more than about two days of work,
  stop at the design: delete the baseline machinery as listed, leave the comparison as a documented
  manual procedure (two plain runs and the existing report on both), and report why.

## Budget

6 hours. At the budget, commit, write the report with what is and is not done, and stop.
