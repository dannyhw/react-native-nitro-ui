# X14 — Add one component's cells to a baseline without re-running the rest

**Worktree / branch:** named in your delegation message (from `main`). **Round cap:** 1 round, plus at most 2 fix rounds
(D19). **Devices:** your lease (`lease.mjs acquire --task X14 --boot`) for the device proof only, and `--exclusive`
for that proof's mint.

## Why

A committed baseline (`bench/baselines/<machine>/<deviceKey>.json`) can only be minted from a complete
`--plan full --launches 8` run. `narrowingProblem()` (`scripts/bench/lib.mjs`) refuses a filtered run, and it is
right to: `writeBaseline()` (`scripts/bench/report.mjs`) replaces the whole file, so a one-component mint would
leave every other row `not measured in base`, which reads as a passing gate. As a result, every new component
costs a full exclusive window on each machine: about 11 hours on maintainer-mac-2 (A3: iOS 4 h 24 min, Android
5 h 13 min, at about 10 s per launch). This task makes adding a component cost that component's cells only:
7 cells × 4–5 arms × 8 launches, roughly 40 min a platform.

## Do

1. **A merge mint:** `bun bench --platform <p> --plan full --launches 8 --component <name> --update-baseline`
   writes that component's cells into the machine's existing file and leaves every other cell byte-for-byte
   unchanged.
   - It refuses, at startup, before any device time is spent, when:
     - the file doesn't exist (the first mint for a machine is still a full run);
     - the component already has cells in the file (replacing them is a full re-mint, or a separate decision);
     - the run's environment isn't comparable with the file's (item 2);
     - any other filter narrows the run (`--scenario`, `--n`, `--only`).
   - Every guard `baselineBlockers()` applies to a full mint still applies: plan, launches, completeness, load
     over the whole run, a clean tree, and Android's `speed-profile`. No `--force` path skips item 2.
2. **Comparability.** Each cell's ratio is normalised to `rn-core` inside its own run, so cells from different
   runs can share a file. They can't share it across a change of regime:
   - schema version;
   - device key, CPU model and core count;
   - Xcode and simulator runtime, or Android API level and ART compile state (`docs/architecture/benchmarks.md`,
     "a comparability break like a runtime change is");
   - RN version;
   - the bench app's `@expo/ui` version.
   Read which of these the file and the run already record, and refuse on any mismatch. Name the field and both
   values in the refusal.
3. **Provenance.** The file's top-level `sha`, `updatedAt` and `machine.loadSamples` currently describe one run.
   After a merge they don't.
   - Record per-component provenance: the sha, date, launches and load summary of the run that minted each
     component's cells.
   - Keep the existing top-level fields meaning "the full run this file was founded on".
   - Bump `schemaVersion` only if `--check` and the readers need it, and keep them reading today's committed
     files.
   - `bench/baselines/README.md` and CONTRIBUTING "Benchmarks" must say how a component is added and when a full
     re-mint is still required.
4. **Tests,** every one shown red first (AGENTS.md):
   - a merge that leaves the other cells unchanged (a byte comparison of everything outside the component);
   - each refusal in items 1 and 2;
   - `--check` reads a merged file and still goes red on a doctored cell, both inside and outside the merged
     component;
   - a fixture whose existing cells differ from what a whole-file rewrite would produce, so a merge that
     secretly rewrites is caught.
5. **Device proof, one platform:**
   - mint Menu's cells into this machine's Android file with the new path, in an `--exclusive` window, settling
     first as A3 2b says;
   - commit the baseline change on its own, with a diff showing only `menu` keys plus the provenance entry;
   - run the `--check` read-back.
   iOS uses the same code path. Leave iOS's Menu cells for the orchestrator's next window, and say so.

## Not in scope

Changing what the plans measure, or the gates' thresholds. Re-minting any existing component.

## Gates

`check`, then `need --for review`. Report the device proof's bench table, load-stamped. Report:
`docs/tasks/X14-bench-component-mint.report.md`, with the ledger exported.
