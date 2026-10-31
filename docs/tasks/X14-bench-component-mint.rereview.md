# X14 re-review — fix round 1

**Verdict: MERGE WITH FIXES.** H1 is fixed for every case the first review named. One path is
still open: `--force` lets a merge write a partial block, and the new docs say it can't. The fix
is one line plus a test. Everything else is fixed.

Reviewed at `ff37824`. 93/93 tests pass in the merge and dry-run suites. `gate.mjs status`:
`check` is green on `736601d1f783`. `need --for review` is satisfied (the diff is check-only).

## Must fix

**F1. With `--force`, a quick-plan run merges a partial block.** `lib.mjs:3217` builds the expected
set from `run.plan`, not from the file's plan. The plan check is in `baselineBlockers()`, and
`--force` skips it. Plan is not in `COMPARABILITY_FIELDS`. I ran a scratch copy of `report.mjs`
on a file holding switch and slider, with a results file measuring menu whole on the **quick**
plan, and passed `--update-baseline --component menu --force`. It exited 0 and wrote **12 of
menu's 28** full-plan cells. After that, menu counts as present, so the other 16 rows can never
be merged in. That is the outcome H1 exists to prevent. `run.mjs --plan quick --component menu
--update-baseline --force` takes the same route, because its `componentPlan` comes from the run's
plan too.

This also makes three claims false:
- `docs/architecture/benchmarks.md:179`: "never buys a partial block either".
- `CONTRIBUTING.md:1102`.
- Commit `9108ebc`: "the quick plan, which … a merge refuses". That holds only without `--force`.

Fix:
- In `mergeBaselineProblems`, make `run.plan !== (baseline.plan ?? BASELINE_PLAN)` an absolute
  problem. A file mixing quick and full rows is a regime break, not a measurement judgement.
- Build the expected set in `missingComponentCells` from the file's plan.
- Add a CLI case: a quick-plan menu run with `--force` leaves the file byte-identical. Show it
  red, and add a row to the ledger.

## Should fix

**F2. With `--force`, a run with no cells writes a provenance entry and no cells.**
`missingComponentCells` returns null for an empty `run.cells` (`lib.mjs:3211`). It treats any
empty run as the pre-flight's candidate. A results file with `cells: {}` plus a recorded waiting
rule, under `--force`, exits 0 with "Merged … 0 cells" and adds `components.menu`. A real run
where every launch failed could produce this. Fix: pass an explicit `candidate: true` from the
pre-flight instead of inferring it from emptiness, or refuse when `addedCells === 0` in
`writeBaseline`.

**F3. A forged results file can overwrite another component's cell.** The stray check
(`lib.mjs:3385`) and `cellsForComponent` (`lib.mjs:2731`) both trust `cell.scenario` over the key.
A cell keyed `mount:nitro-ui:50` (a switch key) that carries `scenario: 'mount.menu'` passes both
checks and replaces switch's row. My scratch run showed `otherChanged=1`. A real run cannot
produce this; only a hand-edited file can. Fix: judge by `parseCellKey(key).scenario`, and refuse
any cell whose `scenario` disagrees with its key.

## Verified fixed

- **H1 (named cases):** a full run, a slider run or a `--scenario`-narrowed run filed as menu, and
  `--component bogus`, are all refused with the file byte-identical. `mergeComponentBaseline`
  filters cells and skipped cells itself.
- **Completeness** uses `buildSchedule` with the run's platform, so arm scopes apply. An Android
  date-picker run without its two expo-ui cells is not refused; an iOS one missing
  `expo-ui-shared-host` is (21 of 28). Measured-and-skipped cells count as present.
- **M1:** the report's 64 lines match the ledger both ways, every cited test exists, and all
  anchors match once. I replayed 14 rows in scratch copies and each named test went red: 34, 37,
  44–48, 50, 52, 54, 55, 61–63.
- **M2** is fixed apart from F1's sentence. **L1:** an unresolved device is its own refusal
  (row 55).
- **L2:** temp file, format, rename. Real prettier 3.9.10 formats the dot-prefixed temp name, and
  the output is byte-identical to a committed file.
- **L3:** 18 ms on `bun.lock`. Still rejects `{"a":1,,}`, `garbage`, `{"a":1,}}` and empty
  input; commas, `//` and `\",}` inside strings survive. The dead reader and the duplicate are
  gone.
- **L4/L5** are explained and reported. **D25:** no home paths, hostnames or emails in the diff,
  commit bodies or excerpts.
