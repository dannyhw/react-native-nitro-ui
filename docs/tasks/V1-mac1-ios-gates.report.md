# V1 — The two missing iOS gates for 0.4.2, run on maintainer-mac-1

**Branch:** `task/V1-mac1-ios-gates` (from `main` at `161e7d2`) · **Round:** 1 of 1 (verification) ·
**Lease:** `V1-0tfk3` (simulator `F08675D3-A32B-4F88-BC81-02D7E0CB797E` / iPhone 17, iOS 27.0 / Metro `8295`)

## Summary

Verification only — no code changed. PR #12 (`e011d8e`) merged with a documented exception:
`harness:ios` came from a GitHub CI run rather than a device, and `real-input:ios` had not run
anywhere, because maintainer-mac-2's simulators could not launch apps (`DataMigrationFailed`).
Both iOS gates are now green locally on mac-1, on the tree staged on npm as 0.4.2.

Code tree `ca6541f7d377` (650 files) at HEAD `161e7d2`, which includes `e011d8e`; the iOS half is
`3a97cae8af8d`. `node scripts/doctor.mjs`: 0 failing, 2 warnings. `build-app.mjs` built the example
app from this tree (89 s, stamp `ca6541f7d377`, 9 components, 8..8 mentions) and both gates
accepted that stamp with no force flag.

`real-input:ios` passed: **14/14 controls, 14/14 auxiliary checks, 0 press sequences needed a
retry**. `harness:ios` passed: **227 tests in 15 suites, 2 skipped of 229 total**. Those counts
match the CI run PR #12 relied on (227 passed), so the device run reproduces what CI claimed and
the exception can be closed rather than merely documented. The 2 skips are the pre-existing
`it.skip` in `MountChurn.harness.tsx` (its whole suite) and one in `Recycling.harness.tsx`, both
intentional on iOS and unrelated to this tree.

The controls PR #12 put at risk are covered: `DatePicker` and `hosted-date-picker` pass in
real-input (56.6 s / 28.6 s) after the `en_US` fallback re-measure, on the `en_US` +
`Europe/Lisbon` launch pinning the harness printed. The sizing engine's ledger reclaim is covered
by `Sizing`, `ColdSizing` and the leak suites.

No gate failed, so nothing was re-run, and there is nothing to classify.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | missing | — | — | — | — |
| `harness:ios` | **PASS** | 229 tests / 16 suites | `ca6541f7d377` (ios tree) | 3 m 47 s | start 2.2 / med 2.5 / max 3.2 |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | **PASS** | — | `ca6541f7d377` (ios tree) | 12 m 56 s | start 19.7 / med 3.3 / max 27.4 |
| `real-input:android` | missing | — | — | — | — |

`real-input:ios`'s counts column is `—` because the ledger records no counts for that gate; its
numbers are in the log's last line: `14/14 controls passed · 0 press sequence(s) needed a retry ·
14/14 auxiliary checks passed`.

`need --for review`: `need: 2 gate(s) missing for review: check, harness:android` — deliberately
out of scope. This task was asked for the two iOS gates only; `check` and both Android gates were
already run locally on the merged tree (RECOVERY.md "F8 + F8b merged"), and this branch changes no
code, so re-owing them here would prove nothing new.

`bun run task-ready` is therefore not green for this branch: it is red on exactly those two lines
and green on every other one (registry, conformance coverage, no TODO/FIXME, report paths exist,
report's gate table is the generated one).

## Red proofs

None. This task adds no test or gate — it runs two that already exist and were shown red by the
tasks that introduced them.

## Files changed

- `docs/tasks/V1/gates.jsonl` — the exported ledger (2 lines, both passing, no failure excerpts).
- `docs/tasks/V1-mac1-ios-gates.report.md` — this report.

## Follow-ups

- lease: `acquire --boot` for an ios-only lease still tries to reset the pair's Android AVD and
  printed `reset avd:nitroui_t03: pm clear FAILED ((no answer, exit 1))` for an emulator that was
  never started; harmless here, and the next Android run inherits nothing it did not already have.
