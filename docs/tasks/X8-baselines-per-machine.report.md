# X8 — Bench baselines per machine

**Branch:** `task/X8-baselines-per-machine-xhigh` (from `main` at `e5efdf9`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** none — no devices, no bench runs (tooling,
proven by `check`).

## Summary

Committed baselines are now keyed by machine as well as by device:
`bench/baselines/<machine-label>/<deviceKey>.json`. The two existing files moved with
`git mv` into `maintainer-mac-1/`, byte-for-byte (verified by sha256), and
`renders.json` stays at the top level because a JS render count does not depend on the
hardware. Nothing that reads `renders.json` changed.

A ratio to `rn-core` cancels drift inside one machine and explains nothing between two
(process review §5), so the lookup is the run's own `machine.hostname` with **no
fallback**: not to another machine's directory, and none to the old top-level path.
Path resolution and every refusal live in one new pure module,
`scripts/bench/baseline.mjs`, which both CLIs call, so `run.mjs` (a live run) and
`report.mjs` (re-reporting a results file) resolve the same file for the same run — the
label comes from the run, never from the environment read afterwards.

Refusals, each exit 2 with a message that names the fix:

- no label, or `unlabelled`. `run.mjs` refuses `--update-baseline` **before the run
  starts**, in the same pre-flight as the R4 load check, so an unlabelled machine does
  not spend three hours and then fail;
- a label that is not one safe path segment (`^[a-z0-9][a-z0-9-]{0,62}$`). An
  all-whitespace export reads as unlabelled, which is the message that helps;
- `--check` only: the file's own `machine.hostname` differs from the run's (a copied or
  moved file).

A plain `bun bench --plan quick` with neither flag still needs no label: it gates
nothing against a baseline. `baselinePath(deviceKey, machineLabel)` is the only
resolver, and a test asserts no bench script joins `BASELINES_DIR` with a device key,
so a call site cannot silently resurrect the old lookup.

Verified against the committed data, not only fixtures: through the new resolver
`maintainer-mac-1` reads both real baselines (168 cells each) and `maintainer-mac-2` is
told to mint its own; `report.mjs --check` against the real
`maintainer-mac-1/ios27-sim-iphone17.json` still gates. The published package is
unchanged (`package-files`: 465 files, matches `etc/package-files.txt`).

One judgement call: `report.mjs --check` keeps its historical exit 1 for *no baseline
for this machine* (it was 1 there, 2 in `run.mjs`); every new refusal is a 2 on both.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 486 tests / 26 suites | `3912ba585abc` | 2 m 49 s | start 1.9 / med 2.6 / max 2.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` — the diff base
`e5efdf9` "touches no platform-specific code" and the code diff is tooling (check-only)
only, so no device gate is asked for beyond `check`, exactly as the brief expected. The
`bench/` moves and the docs are non-code paths, and the published tarball is unchanged.

## Red proofs

Suite: `scripts/__tests__/bench-baseline-machine.test.js` (25 tests). Fixtures use
`maintainer-mac-1` (the run) and `maintainer-mac-9` (the other machine), and every
tempting file is a table that would change the verdict if read — never a pass — so a
fallback that should be gone shows up as a wrong answer rather than a green test.

- path built without the machine label -> `join(baselinesDir, \`${deviceKey}.json\`)` ->
  11 tests red, incl. `keys the file by machine label, then device key` and
  `mints into the machine directory, creating it`.
- provenance check disabled -> `return null` at the top of
  `baselineProvenanceProblem` -> `refuses a file whose hostname is another machine…` ->
  `expect(out.status).toBe(2)` got 0, i.e. it gated against `maintainer-mac-9`'s table
  and printed a FAIL.
- missing-baseline check removed -> `if (false && !existsSync(file))` ->
  `never falls back to another machine file or to the old top-level path` (a foreign
  table was read instead of refused).
- `unlabelled` accepted + an unset label falling back to `maintainer-mac-1` -> 9 red,
  incl. `run.mjs refuses an unlabelled --update-baseline before the run starts`.
- path-segment check removed -> 4 red, incl. `refuses to resolve a path at all for an
  unlabelled or unusable label`.
- the pre-run refusal moved below `resolveIosDevice()` ->
  `run.mjs refuses an unlabelled --update-baseline before the run starts` -> the output
  contained `No iOS simulator`, i.e. it had already reached for a device.
- refusal widened to every run -> `…and not for a plain run` -> the plain run that must
  still proceed got refused.
- an old top-level baseline restored in the tree ->
  `the committed baselines sit in their machine directory` -> the directory/name vs
  `machine.hostname` equality went red.
- `report.mjs` rebuilding the top-level path itself -> `only baseline.mjs joins a
  baselines directory with a device key` + both mint tests.

## Files changed

- `scripts/bench/baseline.mjs` (new) — label rules, the one path, the provenance check,
  `openBaselineForCheck()` shared by both CLIs.
- `scripts/bench/report.mjs`, `scripts/bench/run.mjs` — resolve by (machine, device);
  `run.mjs` gains the pre-flight refusal next to the R4 load check.
- `bench/baselines/{ => maintainer-mac-1}/ios27-sim-iphone17.json`,
  `…/android35-emu-pixel9.json` — `git mv`, unchanged.
- `scripts/__tests__/bench-baseline-machine.test.js` (new), one comment line in
  `bench-gate.test.js`, `scripts/bench/format.mjs` (docstring path).
- `bench/baselines/README.md` (layout, the per-machine rule, Status),
  `docs/architecture/benchmarks.md`, `CONTRIBUTING.md` (bench env table + gates),
  `README.md` ("Baselines and gating", the Performance provenance line).

## Follow-ups

- bench tooling: `bench/baselines/README.md` still lists `Picker` / Android
  `DatePicker` cells as `new arm`; refreshing that is a mint, not this task.
- CI tooling: `.github/workflows/bench.yml` is disabled and predates per-machine keys;
  re-enabling it will need a label decision (its runner is a third machine).
- docs: `docs/tasks/RECOVERY.md` step 1 says mac-2 mints "new files under
  `bench/baselines/`" — true, and they now land in `bench/baselines/maintainer-mac-2/`.
