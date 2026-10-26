# X2 — Gate ledger, re-run rules and short reports

**Branch:** `task/X2-gate-ledger` (from `main` at `cdcd6a8`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X2-rcxej` (AVD leased as `emulator-5570` on a private adb server, Metro 8293) ·
**Code tree:** `f4fccfdabe6f` (504 code files)

## Summary

Three things, all of them the process review's item 4.

`scripts/gate.mjs <gate>` runs a named gate (`check`, `harness:<platform>[:suite]`,
`real-input:<platform>`, `smoke:*`, `bench`), tees the log, samples the load average every 15 s,
and appends one JSON line to `.gates/<branch>.jsonl`: gate, command, the **code tree** digest
(reusing X1's `currentCodeTree()`, so `docs/`, Markdown and build output are already excluded),
HEAD beside it, platform / device serial / lease id, load start-median-max, duration, result,
test counts and the log path. `status` prints green / red / stale / missing for the tree in front
of you; `need --for review|merge` exits non-zero with what that stage still owes; `table` renders
the report's gate table; `export --task X2` copies the ledger verbatim into `docs/tasks/X2/`.

The re-run rules live in `gate-core.mjs`: `review` needs `check` plus one harness gate per
platform the code diff touches (`android/`, `ios/`, and `cpp/`/`src/`/`nitrogen/` → both);
`merge` needs `check` + full harness both + real-input both, once; benches are never required. A
result is keyed to the code tree, so a docs commit invalidates nothing — demonstrated below on
the real tree, not only in a test.

Two decisions worth a reviewer's attention. First, a code path outside those prefixes counts as
**both** platforms rather than nothing: `example/`, `patches/` and `package.json` are not in the
brief's list, and a ledger that asked for nothing when the harness patch moved would be the same
false claim in a new shape. It is noisy for tooling-only diffs (my own diff trips it) and is
listed as a follow-up. Second, `ledgerFileName` nests (`/`) instead of flattening: my own test
went red proving a separator collides, because `+` is legal in a ref, so `task/a` and `task+a`
would share a ledger.

`docs/tasks/REPORT-TEMPLATE.md` is the shrunk format and `AGENTS.md` now requires it, sends gates
through `gate.mjs`, and drops the device-hygiene paragraph.

Not run: `harness:ios` and both real-input gates — the brief allows one proof run. Nothing this
branch changes enters the tarball: 465 packed files, identical to `etc/package-files.txt` (the
manifest `manifest:check` diffs the real tarball against), and no path this branch touches is in
the pack — so `npm pack` output is main's.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 7 tests / 7 suites | `f4fccfdabe6f` | 8 m 57 s | start 29.3 / med 162.5 / max 312.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 187 tests / 12 suites | `f4fccfdabe6f` | 7 m 37 s | start 11.7 / med 12.7 / max 247.6 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`node scripts/gate.mjs need --for review` → `need: 1 gate(s) missing for review: harness:ios`.
`need --for merge` → `3 gate(s) missing for merge: harness:ios, real-input:ios,
real-input:android` (it read 4 while `check` was still red, naming `check` too).

The `check` counts cell reads `7 tests / 7 suites` because the rule is "the last jest-style
summary in the log" and `check` ends with the perf gate. The unit-test step in the same log is
**23 suites / 391 tests**, and `test:native`, nitrogen drift, api-extractor, publint, manifest
(465 files) and README examples all passed inside it. Follow-up below.

Both runs happened while another task's builds pushed load to 248–313; the harness run still took
457 s against 175 s in X1. That is what the load column is for — read it before believing a
duration or a red.

## Red proofs

Tests (mutation → the test that went red, then restored and green at 36/36):

- `decideNeed` review bar -> `requiredGatesFor` also asks real-input -> 7 red, incl. *an android-only
  diff needs android only*
- `platformsTouchedByPaths` -> `cpp|src|nitrogen` mapped to iOS only -> *maps the brief prefixes:
  android/, ios/, and shared code to both*
- `decideNeed` -> `stale` accepted as satisfied -> *a code change makes yesterday green stale, not green*
- `MERGE_GATES` -> drop `real-input:ios` -> 3 red, incl. *merge needs the whole set on this tree, once*
- `renderGateTable` -> print PASS from `entry.result` -> *will not print PASS for a run from another
  code tree*
- `parseTestCounts` -> first summary wins -> *keeps the last summary when a gate printed several*
- `platformsTouchedByPaths` -> stop excluding docs/bench -> 2 red, incl. *a docs-only commit keeps a
  green gate green*
- `summarizeLoad` -> report the mean -> *reports start, median and max over the whole run*
- `ledgerFileName` -> the first implementation flattened `/` to `+` -> *puts one file per branch
  under .gates, no separator to collide* went red by itself, before any mutation (`+` is a legal
  ref character, so `task/a` and `task+a` collided)

The tool, run for real:

- `gate.mjs harness:android` with nothing built -> recorded `fail` exit 1 in 0.2 s; the log carries
  X1's refusal (`no app to test… build it: node scripts/build-app.mjs`), so a device gate reached
  through `gate.mjs` still refuses an unstamped app before touching a device.
- `gate.mjs check` at load 140 -> recorded `fail` in 453 s (the last summary in that log reads
  `1 failed of 7 tests`: `perf:renders`' DatePicker case over jest's 5 s timeout). `status` showed
  it red and `need` listed it missing; the re-run at load 29 passed.
- tree keying, live: after the 187-test green, appending one line to `scripts/gate-core.mjs` made
  `need` print `harness:android — passed on tree f4fccfdabe6f at e671661, which is not this code
  tree (2c571a5aa70b): re-run it`; reverting the line brought the digest and the green back without
  a device. And the commits made after the run — `3c8a1e3`, which committed a `gate-core.mjs` edit
  that was already on disk when the suite ran, plus this report and the exported ledger — leave the
  digest where it is, because a commit is not a code change. That is the rule, run.
- `gate.mjs harness:android` before the path fix -> recorded `fail`, `MODULE_NOT_FOUND` for
  `example/scripts/harness.mjs`: the entry is `../scripts/harness.mjs` once the cwd is `example/`.
  Found by running the gate, not by a unit test.

## Files changed

- `scripts/gate-core.mjs` — the decisions: ledger shape, states, `need` rules, table, load summary.
- `scripts/gate.mjs` — the runner and `status` / `need` / `table` / `export`.
- `scripts/__tests__/gate.test.js` — 36 tests over the decisions in `gate-core.mjs` (the ledger
  shape and its parser, the four gate states, both `need` stages, the table renderer, the counts and
  load readers, the command table). The CLI in `gate.mjs` is those decisions plus spawn/print, and it
  was exercised by hand on the real tree: every `status`, `need`, `table` and `export` line in this
  report is its output.
- `.gitignore` — `.gates/` (ledgers and per-run logs stay machine-local; the committed evidence is
  the exported copy).
- `docs/tasks/REPORT-TEMPLATE.md`, `AGENTS.md` — the short report format and the gate command.
- `docs/tasks/X2/gates.jsonl` — this branch's 5 ledger lines, copied verbatim.

## Follow-ups

- `check`'s counts cell should come from its jest step, not the last summary in the log.
- A `tooling` prefix class (`scripts/`, `eslint-rules/`, `etc/`, `.changeset/`) would let a
  tools-only diff ask for `check` alone instead of both platforms.
- `perf:renders` uses jest's 5 s default and flakes under another task's builds; it needs the same
  kind of knob `HARNESS_TEST_TIMEOUT` is.
- `CONTRIBUTING.md` has no `gate.mjs` section — the brief scoped the doc change to `AGENTS.md`.
- A `FAIL` row prints its tree but not the `(not this tree)` marker; only `stale` rows do.
- The `mutations.json` helper from PROCESS §3 is not built; red proofs are the lines above.
- `.gates/logs/` grows one file per run with no rotation.

## Questions for orchestrator

- Should `need --for review` treat a tools-only diff as `check` only? Recommendation: yes — add the
  `tooling` prefix class above in a fix round. Until then this task's own review bar reads
  `missing: harness:ios`, which the one-proof-run brief could not satisfy.
- X2's merge bar (`harness:ios`, both real-input, on `f4fccfdabe6f`) was not run. Recommendation:
  merge on D19 with the follow-ups, and let the next task that touches `scripts/` pick up the
  missing platform runs, rather than spending a device pair on a change that reaches no app binary.
