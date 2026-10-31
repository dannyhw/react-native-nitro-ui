# X14 review — merge mint

**Verdict: FIX ROUND.** Small and check-only: no device time. The run.mjs path and the committed Android
file are correct. But the second write path (`report.mjs --update-baseline --component`) can overwrite
other components' cells, which breaks the task's central promise. And the report's red-proof list does
not match the committed ledger.

Reviewed at `d0b8a2e`. 127/127 tests pass in the four suites. `gate.mjs status`: `check` green on
`d76e1d429a3b`, both bench rows stale (as the report says).

## Must fix

**H1. A merge writes every cell the run holds, not just the named component's.**
`scripts/bench/lib.mjs:3558` copies all of `built.cells`/`built.skippedCells` into the file. Neither it
nor `report.mjs:292` (`mergeBaselineProblems(input)` with no `scheduled`/`componentPlan`/`filters`)
checks that the run measured only `<component>`, or all of it. run.mjs is safe only because its schedule
is already filtered. `report.mjs` takes any results file:
- `report.mjs <full-run.json> --update-baseline --component menu` (file without menu) rewrites all 231
  existing cells, and files them under `components.menu`.
- A `--component slider` results file passed with `--component menu` silently replaces slider's numbers.
- A `--component menu --scenario …` results file merges a partial block. After that, menu counts as
  "already present", so the missing rows can never be added by a merge.

I confirmed this with a scratch script: the switch cell is overwritten (`OLD`→`NEW`), with
`changedCells: ['+mount.menu…', '+mount:nitro-ui:1']`.

Fix:
- In `mergeComponentBaseline`, keep only `cellsForComponent(built.cells, component)`, and the same for
  skipped cells.
- In `mergeBaselineProblems`, refuse when the run holds cells of another component. Also refuse when the
  run is missing any cell key that `buildSchedule({plan, launches, platform, component})` expects,
  outside the run's `skippedCells`. That brings the completeness check into the report.mjs path.
- Test both through the report.mjs CLI, using a full-run results file whose other cells differ from the
  file's. Show it red.

**M1. The report's red proofs don't match `docs/tasks/X14/mutations.json`.**
- 15 of the 44 lines name mutations the ledger doesn't have, e.g. "merge accepts a different core
  count", "…react-native version", "provenance loses the per-component launch count", "the schema
  version is not compared".
- Two lines cite tests that don't exist: "records per-component provenance for a merge" and "seeds the
  file's own components from its founding run".
- I replayed four per-field drops the ledger lacks (`expoUi`, `reactNative`, `cpuCount`, `androidApi`).
  All went red, so those tests are sound.
- But `launches: null` at `lib.mjs:3165` **survives**. Among a merged entry's provenance fields, only
  `sha` is asserted (`bench-baseline-merge.test.js:892`). `mintedAt`, `launches`, `loadSamples` and
  `dependencies` are not asserted. The fixture's `loadSamples: null` (`:150`) is also the same value a
  dropped field would produce, so a missing load summary would go unnoticed.
- Ledger row 34 ("--check reads the baseline at the results file's version") no longer matches any source
  at HEAD. Row 18's anchor matches twice.

Fix:
- Assert all of a merged entry's provenance fields, using a non-null `loadSamples` fixture.
- Show the new assertions red, and add them to the ledger.
- Regenerate the report's list from the ledger.
- Drop or re-anchor row 34.

**M2. `docs/architecture/benchmarks.md` now says false things.**
- Line 76: "`--force` Override a `--update-baseline` refusal".
- Lines 160–165: "`--update-baseline` refuses a narrowed schedule … `--force` overrides that too".

With `--component`, neither is true. The report lists this as a follow-up, but these are false claims,
not a missing mention. Fix: two sentences, plus a pointer to `bench/baselines/README.md` "Adding one
component".

## Should fix (or one-line follow-ups)

**L1. The pre-flight drops `device.problem`.** Without `IOS_SIM_UDID`, `preflightDevice()` (`run.mjs:858`)
returns `deviceKey: null`. The merge then refuses with "no baseline at `…/null.json` … the first mint
for a machine is a full run". That points a contributor at an 11-hour window when the real cause is an
unset variable. Fix: when `deviceKey` is null, surface `device.problem` as an absolute refusal.

**L2. The write is not atomic.** `report.mjs:164` writes the file, then runs prettier on it in place. A
crash leaves a truncated file (git restores it). If prettier fails, every array is re-wrapped and the
other cells are no longer byte-identical. A race between two merges is unlikely: the file is re-read
just before the write, and `--exclusive` stops two runs on one file. Fix: write and format a temp file
in the same directory, then `renameSync`.

**L3. `deps.mjs` hygiene.**
- `stripJson5Syntax` calls `out.trimEnd()` on every closer, which is quadratic: 503 ms on the 518 KB
  `bun.lock`, read about 3 times per run.
- It accepts `[,]`/`{,}`, which is harmless. It still rejects `{"a":1,,}`, `garbage`, extra closers and
  commas inside strings, so it is safe.
- `machine.mjs:74` `collectDependencies` still parses `bun.lock` with strict `JSON.parse`. Its lock
  values are discarded, so that half is dead code carrying the old bug. Delete it.
- `foundingDependencyEvidence` (`dry-run.mjs`) duplicates `foundingDependencies` (`baseline.mjs`).

**L4. Report accuracy.**
- The ledger shows **two** full 35-minute menu mints (01:10 and 01:56, both exit 0, both "Baseline
  written"). The report describes one. Say why it ran twice.
- CONTRIBUTING says the diff is "one component's cells plus its provenance entry". A first merge into a
  pre-X14 file also adds 7 seeded entries, `dependencies`, `skippedCells: {}` and the schema bump.
  README says so; CONTRIBUTING should too.

**L5. Hygiene incident not reported.** AGENTS.md (X11): "do *not* power off your devices at the end of a
round … Only shut down a device you started outside the lease." `emulator-5574` came from `acquire
--boot`, so powering it down at the end was a **breach**. It was minor (the next run pays a boot) and
nobody else's device was touched. It belongs in the report as an incident beside the Gradle-daemon line,
which itself was handled correctly (killed by PID after checking).

## Verified correct

- **Comparability:** every field the brief lists is checked, plus platform, system image and the
  waiting rule. Each is read from both the file and the run; a field missing on either side never
  matches. A pre-X14 file refuses, except for the app versions (recovered from `git show <sha>:bun.lock`)
  and a platform-default `timeouts`, both recorded in `comparabilityNotes`.
- **`--force`** never bypasses comparability or filter refusals: not in the pre-flight, not after the
  run, not in report.mjs. The check at write time re-judges every deferred field.
- **The Android file** (my own parse): the 231 old cells are unchanged and in their original order;
  all 35 added keys are menu's; the founding fields are untouched; the only removed lines are the schema
  version and a closing brace.
- **Readers:** v2 and v3 both read, v1 is refused, and no other reader looks at `components`. The CLI
  test forges cells inside and outside the merged component.
- **The schema-constant fix is right.** Ledger rows 0, 5, 6, 28, 32, 35 and 36, re-run, all went red.
- **D25:** no leaks in the diff, the commit bodies or the failure excerpt. No scope creep.
