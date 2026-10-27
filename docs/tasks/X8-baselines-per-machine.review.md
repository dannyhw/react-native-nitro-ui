# X8 review — bench baselines per machine

**Branch:** `task/X8-baselines-per-machine-xhigh` @ `1b12b0b` · **Diff:** `main...HEAD`
(6 commits, 14 files) · **Reviewer run:** read-only; mutations were made in the worktree and
reverted with `git checkout -- scripts` after each one. `git status` is clean apart from this file.

## Verdict: **MERGE**

The implementation does what the brief asks, and I found no correctness bugs. Everything below is
nice-to-have. N1–N3 are one-line docs or message fixes the orchestrator can fold into the merge
commit, or skip.

## What I verified

- **Layout:** both baselines are `git mv` renames at 100 % similarity (`git diff -M --summary`).
  `renders.json` stays where it was, and `scripts/perf/renders.mjs` is untouched.
- **Resolution:** `baselinePath(deviceKey, machineLabel)` goes through `baselineFileFor`, and the
  only label source is the run's `machine.hostname` (`machineLabelOf`). `collectMachine` and the
  pre-flight both call `machineLabelFromEnv()` (`scripts/bench/run.mjs:170`, `:631`), so the two
  can't disagree.
- **Refusals:** the pre-flight sits right above the R4 load check and before `resolveIosDevice()`.
  An unlabelled or badly shaped label is exit 2 for both flags in both CLIs. A foreign or missing
  `machine.hostname` in the baseline file is exit 2. There is no fallback anywhere: `existsSync`
  is only ever asked about the per-machine path.
- **The report's data claim, re-run independently:** through `openBaselineForCheck`,
  `maintainer-mac-1` opens iOS with 168 cells and Android with 140, and `maintainer-mac-2` gets
  `missing`. Both match the report.
- **Tests:** the new suite plus `bench-gate` and `bench-baseline-format` pass under Node 24
  (3 suites, 100 tests). `gate.mjs status` shows `check` green on `3912ba585abc`.
  `need --for review` exits 0 with the note that the diff is tooling only, as the brief predicted.
  The report's gate table is byte-identical to `gate.mjs table`.
- **Red proofs re-run by me:**
  - label dropped from the path → 11 red (report says 11 ✓);
  - `return null` in `baselineProvenanceProblem` → 4 red, including the CLI one;
  - `--check` removed from the run.mjs pre-flight → `…for --check too` red;
  - pre-flight moved below `resolveIosDevice()` → both run.mjs tests red;
  - report.mjs exit for missing changed 1→2 → `never falls back…` red.
- **Env vs run label in report.mjs:** I checked that tests would catch report.mjs reading the
  environment instead of the run's label. The CLI env is `maintainer-mac-1`, and the
  `OTHER`-labelled mint plus the `unlabelled` results file would both go red.

## Must fix

None.

## Nice to have

- **N1. Docs: the README says every refusal exits 2, but report.mjs exits 1 for a missing
  baseline.** `bench/baselines/README.md:39` and `:46`: "The refusals, each exit 2…" heads a
  table that includes "no baseline for this machine". `report.mjs` exits **1** there
  (`scripts/bench/report.mjs:263`), and `docs/architecture/benchmarks.md:292` defines 1 as
  "conclusive regression". The report discloses the choice, but the README contradicts it.
  - Failure scenario: on `maintainer-mac-2`, which now has no baselines,
    `bun run bench:report <file> --check` exits 1. A script or person following the documented
    exit codes reads that as a regression, and the README says it would be 2.
  - Fix: either say "exit 1 in `report.mjs`, 2 in `run.mjs`" on that row, or move the row out
    from under "each exit 2".
- **N2. Message: the refusal says doctor checks the label, but doctor only checks that it is
  non-empty.** `scripts/bench/baseline.mjs:81` says "(`node scripts/doctor.mjs` checks it)".
  `scripts/doctor.mjs:175-183` reports `ok` for any truthy label, including `"  "` and
  `"Maintainer Mac"`, both of which the bench refuses.
  - Failure scenario: someone exports `NITRO_UI_MACHINE_LABEL=Mac2` and runs doctor, which says
    ok. Then `bun bench --update-baseline` refuses.
  - Fix: drop the parenthetical. Alternatively, add a follow-up for doctor to apply
    `MACHINE_LABEL_PATTERN` (doctor itself is out of scope here).
- **N3. Docs: the README implies `--force` overrides the label rule, but it does not.**
  `bench/baselines/README.md:93` says the minting rules are "overridable only with `--force`",
  and the list includes "Machine + device key — the label rules are above". The label refusal is
  not in `baselineBlockers()`, and `--force` does not bypass it (correctly).
  - Failure scenario: someone tries `--update-baseline --force` with no label, expecting it to
    go through, and is refused.
  - Fix: say so in one clause.
- **N4. Test gap: no test proves the live run records the same label the pre-flight checked.**
  - Mutation 1, which survives (25/25 green): revert `collectMachine` to
    `process.env.NITRO_UI_MACHINE_LABEL ?? 'unlabelled'` (`scripts/bench/run.mjs:170`). With
    `NITRO_UI_MACHINE_LABEL=" maintainer-mac-1"` the pre-flight passes, because it trims, but
    the run records the untrimmed value. `baselinePath` then **throws uncaught after the
    three-hour plan**, which is exactly what the pre-flight exists to prevent.
  - Mutation 2, which also survives: give `openBaselineForCheck` a run with a hard-coded
    `machine.hostname` at `run.mjs:864`. The run.mjs post-run `--check` and `--update-baseline`
    paths are only checked structurally (a regex over the source).
  - The current code is correct. This is a hole in the red-proof coverage of the report's
    "cannot disagree" claim.
  - Fix: a unit test that `collectMachine`'s hostname equals `machineLabelFromEnv` for a padded
    value. This may need `collectMachine` exported.
- **N5. Test hermeticity: one run.mjs test doesn't clear `IOS_SIM_UDID`.**
  `scripts/__tests__/bench-baseline-machine.test.js:656-662`: the `'Mac One'` `--check` case
  doesn't set `IOS_SIM_UDID: ''`, unlike the other two run.mjs invocations.
  - Failure scenario: `check` runs in a leased shell with a real `IOS_SIM_UDID`, and the
    pre-flight regresses. The test then goes on to `simctl` and a build instead of failing
    fast. I confirmed that with a fake UDID it still goes red (status 1 ≠ 2), but with a real
    one it would touch the device until the 120 s timeout. The
    `not.toContain('No iOS simulator')` assertion is also vacuous in that environment.
  - Fix: add `IOS_SIM_UDID: ''`.
- **N6. Report overclaims the structural guard, and a few small docs nits.**
  - Report line 36 says the regex test means "a call site cannot silently resurrect the old
    lookup". It only matches `path.join(BASELINES_DIR` (test line 716): `path.resolve`, a
    template string, or a substituted run (N4) all pass. "Makes it harder to" is accurate;
    "cannot" is not.
  - Smaller docs nits, none blocking:
    - `docs/architecture/benchmarks.md:248` (and `baseline.mjs:6`) write `SS5` where the bench
      README writes `§5`;
    - `CONTRIBUTING.md` leaves `` `.github/workflows/bench.yml` `` alone on a reflowed line;
    - `scripts/__tests__/bench-baseline-format.test.js:4` still says `bench/baselines/*.json`.
      That one could be a follow-up line instead.

## Scores

| Area                           | Score | Justification                                                                                                                                                                                                                               |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness                    | 5     | Resolution, every refusal, the pre-run placement and the no-fallback rule are right in both CLIs. Real data resolves as claimed.                                                                                                             |
| Brief completeness             | 5     | All five "Do" items are done: layout, resolution, the three refusals plus the missing path, tests and all four docs. The published package is unchanged and `need --for review` is satisfied.                                              |
| Test rigour (red proofs real)  | 4     | Every red proof I re-ran went red as reported, and the fixtures can't coincide with the right answer. The live-run label consistency and the post-run run.mjs paths are only structurally guarded (N4), and one test isn't hermetic (N5). |
| Docs accuracy                  | 4     | Docs describe current behaviour and the Status section matches the brief. The README says "each exit 2" though one row is exit 1 (N1), and the `--force` wording (N3) and the doctor claim (N2) are slightly off.                           |
| Scope discipline               | 5     | Outside the brief, only a docstring, a comment and the README provenance line changed, all needed for accuracy. CHANGELOG and other briefs are untouched. Adjacent findings went to Follow-ups.                                             |
| Code clarity / fit with style  | 4     | One pure module shared by both CLIs, matching the `comparisonSections()` precedent, with comments in the house style. The comments and messages are long, and the refusal-`kind`-to-exit-code mapping is split across two call sites.     |
