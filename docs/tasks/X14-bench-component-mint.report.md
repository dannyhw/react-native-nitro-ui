# X14 — Add one component's cells to a baseline without re-running the rest

**Branch:** `task/X14-bench-component-mint` (from `main` at `d3f27d3`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X14-p6phr` (`nitroui_a` → `emulator-5574`, both pairs, exclusive; released)

## Summary

`bun bench --platform <p> --plan full --launches 8 --component <name> --update-baseline` now
writes that component's cells into the machine's existing baseline and leaves every other cell
byte-for-byte alone. Menu's Android cells are minted by that path and committed here, so the
repo holds the proof, not only a test for it. iOS uses the same code path and is **left for the
orchestrator's next window**: 224 launches (4 arms — `nitro-ui-host` is Android-only), about
40 min at A3's 10.2 s per launch.

Two decisions to read before the diff.

**`SCHEMA_VERSION` (results files, 2) is no longer also `BASELINE_SCHEMA_VERSION` (3).** Bumping
the shared constant would have made all four committed v2 baselines unreadable, so `--check`
accepts `READABLE_BASELINE_SCHEMA_VERSIONS = {2, 3}` and writes 3. That split caused two bugs
found on the way, both fixed here: `run.mjs`'s two baseline opens were passing the *results*
constant to the reader, so a v1 file was refused as "not a v2 ratio baseline" about a version the
predicate accepts — the message is now built where the readable set lives and takes no argument;
and the version readers used strict `JSON.parse` on a `bun.lock` that bun writes with trailing
commas, so they resolved nothing and **every** merge refused. The unit-test fixture was hand-written
strict JSON, which is why that passed: the fixture is now what bun writes, and the test reads this
repo's shipped lock at HEAD and at an older commit.

**A file that predates a comparability field answers with evidence or the merge refuses** —
recovery from `bun.lock` at the file's own `sha` for the two app versions, the platform's default
waiting rule for `timeouts`, refusal for runtime/Xcode/API/image/ART. Everything matched lands in
`comparabilityNotes`. `--force` silences judgements about a measurement (load, plan, launches,
dirt, marks) and nothing else, in the pre-flight, the runner and the writer alike.

The device proof: 280 launches, 35.5 min, 0 of 352 load samples over the ceiling. The diff is
menu's 35 cells plus bookkeeping — 231 old cells byte-identical, founding fields untouched, and
the only two removed lines are `"schemaVersion": 2,` and the cells table's closing brace, which
gains a comma as three new blocks are appended after it. Neither is a data row.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1416 tests / 51 suites | `d76e1d429a3b` | 2 m 31 s | start 1.5 / med 2.5 / max 3.2 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `bench:--platform:android:--plan:full:--launches:8:--component:menu:--update-baseline:--skip-build` | stale | — | ad3a6b2a67ed (not this tree) | 35 m 36 s | start 1.3 / med 1.4 / max 2.3 |
| `bench:--platform:android:--plan:quick:--launches:4:--scenario:mount:--n:50:--only:nitro-ui%2Crn-core:--skip-build` | stale | — | ad3a6b2a67ed (not this tree) | 5 m 51 s | start 2.1 / med 1.4 / max 2.3 |

`need --for review`: **satisfied on this code tree** — `check` green; the note says the code diff
is check-only tooling, so no device gate is asked for beyond `check`. `need --for merge` asks for
the four device gates, which is the merge stage's bar (AGENTS.md).

Both bench rows print `stale` because one code commit landed after the mint: `54694a9`
reformatted one test file, and the bench's tree digest covers `scripts/`. It is whitespace in a
test, and `bench` is not in `need`'s required prefixes, so nothing is owed — and the row cannot be
refreshed as things stand: the merge refuses a component the file already holds, so re-running
that command now is a refusal by design (which is itself item 1 of the brief, proven by the file
in this branch). Re-minting would mean reverting `dcd3634` first, then spending 35 min of an
exclusive machine to move a row from `stale` to `green`. The first `check` run on the final tree
failed on that same formatting error, which is why its excerpt is committed under
`docs/tasks/X14/failures/`.

## Device proof

| Item | Value |
| --- | --- |
| Command | `bun bench --platform android --plan full --launches 8 --component menu --update-baseline --skip-build`, via `node scripts/gate.mjs bench --background -- …` |
| Run | 280/280 launches, `problems: []`, 35.5 min, ART `speed-profile` on attempt 1 |
| Load | 352 samples, median 1.45, p90 1.81, max 2.22, **0** over the 5.0 ceiling |
| Merge | 35 `menu` cells added, 0 replaced; 266 in the file; `sha cb269c9`, `dirty: false` |
| Read-back | `report.mjs <results.json> --check` on the merged file exits 0: 24 rows within tolerance, 0 FAIL, 1 `new arm` (`leak.menu:nitro-ui:200`, which stores no slope), 15 metrics noisy within the run |
| Forged inside | 25 menu cells' base `presented` ÷3 (aggregate **and** `launchRatios`) → exit 1, 2 FAIL lines name the forged rows, one printing `0.33x / 1.00x / 3.00x` |
| Forged outside | 15 `slider` cells ÷3 → exit 1 naming them; the restored menu rows no longer appear as FAIL |
| Restored | exit 0 again — the two failures were the forgery, not the fixture |

`verify-merge.mjs` (22 checks, all ok): old keys are a prefix of the new table; 231/231 cells
byte-identical by source text, not deep-equal; 0 removed; all 35 added keys are menu's; `sha`,
`updatedAt`, `plan`, `launches`, `deviceKey`, `platform` and the `machine` and `art` blocks are
unchanged (`compileFlags` and `timeouts` are absent from both versions of the file, so the check
on them is a no-op the verifier reports honestly rather than skips); `skippedCells` 0 rows before,
0 after. The outside-component proof needed a run that had *measured* a non-menu row (`--check`
only compares rows its own run measured), hence the second bench gate above: 64 launches, all
components, `nitro-ui`/`rn-core`.

## Red proofs

44 rows in `docs/tasks/X14/mutations.json`; drivers restore with `git checkout --` between rows.
Three rows are worth naming: the `skippedCells` carry-through went red both ways (dropping every
row, and dropping none); an escaped quote inside a lock string went green on its first draft
because the input was still valid strict JSON, so the tolerant walk never ran — the trailing comma
is what reaches that code; and the `--check` version refusal is asserted through `report.mjs`
rather than the function, because a call site is what can pass the wrong constant.

- `bench-baseline-merge.test.js` -> `merge wipes every other component's cells` (`lib.mjs`) -> `leaves every other cell byte-for-byte identical`
- `bench-baseline-merge.test.js` -> `merge writes only the new component's cells (full overwrite)` (`lib.mjs`) -> `leaves every other cell byte-for-byte identical`
- `bench-baseline-merge.test.js` -> `merge drops the components block the file already had` (`lib.mjs`) -> `keeps the components block the file already had`
- `bench-baseline-merge.test.js` -> `merge rewrites the founding run's sha/updatedAt` (`lib.mjs`) -> `merges into a pre-X14 file, recovering its versions from its own commit`
- `bench-baseline-merge.test.js` -> `merge re-sorts the whole cells table` (`lib.mjs`) -> `appends new cell keys instead of re-sorting the table`
- `bench-baseline-merge.test.js` -> `merge allowed onto a component the file already has` (`lib.mjs`) -> `refuses when the file already has this component, and counts the cells`
- `bench-baseline-merge.test.js` -> `merge ignores the other filters (--scenario/--n/--only)` (`lib.mjs`) -> `refuses a merge that narrows the run beyond --component`
- `bench-baseline-merge.test.js` -> `merge allowed on a schedule too small for the component` (`lib.mjs`) -> `refuses a schedule that does not cover the component whole`
- `bench-baseline-merge.test.js` -> `merge accepts a different device key` (`lib.mjs`) -> `refuses a different device key`
- `bench-baseline-merge.test.js` -> `merge accepts a different CPU model` (`lib.mjs`) -> `refuses a different CPU model or core count`
- `bench-baseline-merge.test.js` -> `merge accepts a different core count` (`lib.mjs`) -> `refuses a different CPU model or core count`
- `bench-baseline-merge.test.js` -> `merge accepts a different simulator runtime` (`lib.mjs`) -> `refuses a different simulator runtime or Xcode on iOS, and ignores both on Android`
- `bench-baseline-merge.test.js` -> `merge accepts a different Android API level` (`lib.mjs`) -> `refuses a different Android API level, system image or ART state`
- `bench-baseline-merge.test.js` -> `comparability stops checking the ART compile state` (`lib.mjs`) -> `refuses a different Android API level, system image or ART state`
- `bench-baseline-merge.test.js` -> `merge accepts a different react-native version` (`lib.mjs`) -> `refuses a different react-native or @expo/ui version`
- `bench-baseline-merge.test.js` -> `merge accepts a different @expo/ui version` (`lib.mjs`) -> `refuses a different react-native or @expo/ui version`
- `bench-baseline-merge.test.js` -> `a version the file predates is waved through instead of refused` (`lib.mjs`) -> `refuses when the file already has this component, and counts the cells`
- `bench-baseline-merge.test.js` -> `any waiting rule accepted for a file that records none` (`lib.mjs`) -> `refuses a pre-X14 file when the run waited under a non-default rule`
- `bench-baseline-merge.test.js` -> `a pre-X14 file's versions are never recovered` (`lib.mjs`) -> `matches pre-X14 app versions against the founding commit, and records the source`
- `bench-baseline-merge.test.js` -> `the schema version is not compared` (`lib.mjs`) -> `accepts a v2 file and says the bookkeeping is upgraded`
- `bench-baseline-merge.test.js` -> `a v1 file is accepted` (`lib.mjs`) -> `refuses a v1 file`
- `bench-baseline-merge.test.js` -> `a pre-flight deferral is treated as a pass` (`lib.mjs`) -> `reports the unknown halves as deferred when allowed`
- `bench-baseline-merge.test.js` -> `provenance loses the per-component launch count` (`lib.mjs`) -> `records per-component provenance for a merge`
- `bench-baseline-merge.test.js` -> `existing components are not seeded` (`lib.mjs`) -> `seeds the file's own components from its founding run`
- `bench-baseline-merge.test.js` -> `seeded entries are not marked as seeded` (`lib.mjs`) -> `seeds the file's own components from its founding run`
- `bench-baseline-merge.test.js` -> `the runner lets --force skip the merge refusal` (`run.mjs`) -> `refuses an API level that differs even under --force, before the device`
- `bench-baseline-merge.test.js` -> `the pre-flight crashes printing a merge's deferred fields` (`baseline.mjs`) -> `refuses a thin launch count, and lets --force past it to the device`
- `bench-baseline-merge.test.js` -> `the CLI ignores the merge refusals` (`report.mjs`) -> `refuses a component the file already holds, without writing`
- `bench-baseline-merge.test.js` -> `the refusal names the version it wanted, not the version it found` (`baseline.mjs`) -> `refuses a pre-D9 file before the merge rules run`
- `bench-baseline-merge.test.js` -> `--check reads the baseline at the results file's version` (`report.mjs`) -> `names the baseline schema version it wanted when a pre-D9 file is checked`
- `bench-baseline-merge.test.js` -> `the merge drops every skippedCells row, not just its own` (`lib.mjs`) -> `carries the other components' skippedCells rows and drops only its own`
- `bench-baseline-merge.test.js` -> `the merged component's stale skipped row survives its own re-measure` (`lib.mjs`) -> `carries the other components' skippedCells rows and drops only its own`
- `bench-baseline-machine.test.js` -> `the refusal lists one readable version instead of every one` (`baseline.mjs`) -> `refuses a pre-D9 baseline before the provenance check`
- `bench-deps.test.js` -> `bun's own lock stops parsing (the strict-only reader returns)` (`deps.mjs`) -> `reads bun's own file, which is not strict JSON`
- `bench-deps.test.js` -> `the string walk loses its escape handling` (`deps.mjs`) -> `accepts strict JSON too, and does not touch what is inside a string`
- `bench-deps.test.js` -> `a trailing comma before a closer is no longer dropped` (`deps.mjs`) -> `reads bun's own file, which is not strict JSON`
- `bench-deps.test.js` -> `a // comment is no longer stripped` (`deps.mjs`) -> `reads bun's own file, which is not strict JSON`
- `bench-deps.test.js` -> `a broken lock is also reported as two missing packages` (`deps.mjs`) -> `says so when the lock could not be read or parsed`
- `bench-deps.test.js` -> `the lock reader keeps a peer suffix in the version` (`deps.mjs`) -> `drops a peer suffix rather than returning it as the version`
- `bench-deps.test.js` -> `a stale install stops being reported` (`deps.mjs`) -> `refuses a stale install, naming both versions`
- `bench-deps.test.js` -> `an unreadable revision stops coming back null` (`deps.mjs`) -> `comes back null when the revision cannot be read, rather than using the working tree`
- `bench-dry-run.test.js` -> `--force silences a merge's comparability refusals` (`dry-run.mjs`) -> `refuses a quick plan or a thin launch count without touching the file rules`
- `bench-dry-run.test.js` -> `the dry run stops asking the merge question at all` (`dry-run.mjs`) -> `answers the merge question instead of refusing a narrowed schedule`
- `bench-dry-run.test.js` -> `a pre-flight with no --timeout flag reports no waiting rule` (`machine.mjs`) -> `answers the merge question instead of refusing a narrowed schedule`

## Files changed

- `scripts/bench/lib.mjs` — merge rules: `mergeBaselineProblems()`, `comparabilityCheck()`,
  `mergeComponentBaseline()`, seeded provenance, the schema split.
- `scripts/bench/deps.mjs` (new) — app-version readers, `parseLockFile()` for the lock bun writes.
- `scripts/bench/baseline.mjs` — `openBaselineForMerge()`, `foundingDependencies()`, and a
  refusal message that quotes the reader's own readable set.
- `scripts/bench/run.mjs` — the startup pre-flight (overridable vs absolute refusals) and the
  authoritative write-time re-check; `machine.mjs`/`dry-run.mjs` — the stand-in candidate run.
- `scripts/bench/report.mjs` — the merge write path through the same guards.
- `scripts/__tests__/bench-baseline-merge.test.js`, `bench-deps.test.js`, `bench-dry-run.test.js`,
  `bench-baseline-machine.test.js` — 80 new tests (127 across those four files), incl. `run.mjs`
  driven over a fake tree with an adb that reports nothing attached, and the repo's own `bun.lock`
  read at two commits.
- `bench/baselines/maintainer-mac-2/android35-emu-pixel9.json` — Menu's cells, by the new path.
- `bench/baselines/README.md`, `CONTRIBUTING.md` — adding a component vs a full re-mint.
- `docs/tasks/X14/` — the ledger, its failure excerpt, `mutations.json`.

## Follow-ups

- `deps.mjs`: `installedDependenciesProblem()` cannot see a `node_modules` (the bench workspace is
  hoisted, `bun.lock` lives only at the repo root), so the installed half is inert here.
- `docs/architecture/benchmarks.md` does not mention `--component`; the two documents the brief
  named are updated, this is a third place nobody pointed at.
- `report.mjs`'s missing-baseline exit stays 1 by history while `run.mjs`'s is 2; the new refusals
  are 2 on both. Unifying them changes a gate's exit code.
- `gate.mjs` encodes a bench's args into the gate name, so `--only a,b` becomes `--only:a%2Cb` and
  the printed `wait` line needs that exact form. Cosmetic, but it cost one retried wait.
- The menu mint and the narrowed check-run both record `--skip-build`; nothing re-verified the APK
  against the tree mid-window beyond the stamp the build wrote at 01:05.

## Questions for orchestrator

**iOS Menu cells are unminted, on purpose** (the brief says to leave them and say so). The code
path is the same one proven on Android, and `--dry-run` answers its merge question for iOS today;
what it needs is a window. Recommendation: take `--exclusive` on `maintainer-mac-2` and run
`--platform ios --plan full --launches 8 --component menu --update-baseline` (~40 min, 224
launches); `maintainer-mac-1` owes menu on both platforms, which is two more runs whenever that
machine is next free.
