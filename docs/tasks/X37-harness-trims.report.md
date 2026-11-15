# X37 — Remove harness tests that measure or repeat, and the closed dwell probe

**Branch:** `task/X37-harness-trims` (from `origin/task/W3-tooling-removal` at `5202ce95`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** `X37-q7vgh` (nitro-ui B / `emulator-5570`, adb
server 5041 / Metro 8293)

## Summary
All six items shipped, and a full run is shorter on both platforms — iOS went from 632 tests over
32 files to 601 over 30. Where a candidate turned out not to be a duplicate I kept it and said why.

**Item 1** removed Sizing's in-harness bench (`mounts the same batch from every starting guess…`)
and its cold-batch wrong-frame count; the three `mounts many instances at once`; Conformance's
churn rule and `CHURN`; and both `it.skip` placeholders whose titles were sentences.

**Item 2** removed three default-configuration twins of Conformance rule 1 (Slider, Stepper,
ButtonGroup). The rest are not twins and stay: each covers a non-default configuration (Progress
seeds linear *and* circular; ListItem "each configuration"; Chip `variant="assist"` plus a probe of
the tint it drew), a transition (Picker's new configuration, Progress's variant change), a
mechanism rule 1 does not use (the iOS measure-signal cases; SearchField's sizing *trace* stages),
or residue rule 4 cannot reach (TextField resets eight props; the popup family's open state is
native-owned, which Conformance itself lists as a blind spot). Per the brief: when unsure, keep.

**Item 3** deleted the duration half of the timing gate: every `expectTimingBudget` site, the
duration code in `timingGate.ts`, `scripts/harness-timing-gate.js` and its Metro route. The locale
flag it carried still works, in `example/__tests__/runState.ts` served from
`/harness-run/state.json`.

**Item 4** deleted `FormFidelity.harness.tsx`. Its three Android regressions moved into
`Form.harness.tsx`; the iOS comparison went with the SwiftUI reference Form built only for it, so
`NitroUiFormReference.swift` and the `show-reference`/`hide-reference` commands no longer ship
(patch changeset).

**Item 5** deleted the dwell probe — `NitroUiProbe.swift` (615 lines), `probeVariant.ts`, the probe
halves of `SwitchScreen.tsx`, the probe cases and launch branch in `RealInputTests.swift`, and
their Xcode entries. `pressOnce`, `PressOutcome` and `waitForNativeValueToChange` stayed. Item 6
corrected the stale comments.

Two deletions exposed something live. The moved band test read `headerBand`/`footerBand` before
Compose measured them; it passed only because a screenshot pause settled it, and a `layerH*0.8`
mutation showed the reads landing at `0.0` — it now waits (`3c074f75`). And deleting MountChurn's
`it.skip` left iOS collecting a test-less file, which Jest refuses outright (the deleted `else`
block had said so): the suite is now `MountChurn.android.harness.tsx`, the platform filter the
audit asked for, in the name the runner already honours.

`Menu · Split trigger (E3)` failed the first iOS run and passed the single rerun the flake skill
allows, with the same signature as X32's committed log.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2002 tests / 88 suites | `0680885cb9fd` | 1 m 48 s | start 7.0 / med 15.6 / max 24.8 |
| `harness:ios` | **PASS** | 601 tests / 30 suites + isolated 6 tests / 3 suites | `0680885cb9fd` (ios tree) | 14 m 21 s | start 5.3 / med 6.6 / max 15.8 |
| `harness:android` | **PASS** | 659 tests / 31 suites + isolated 6 tests / 3 suites | `0680885cb9fd` (android tree) | 18 m 16 s | start 7.1 / med 5.6 / max 19.9 |
| `real-input:ios` | **PASS** | — | `0680885cb9fd` (ios tree) | 51 m 07 s | start 4.0 / med 19.3 / max 216.9 |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Form.harness` | stale | 1 failed of 23 tests / 1 suites | edee23116624 (not this tree) | 24.8 s | start 6.8 / med 6.1 / max 6.8 |
| `harness:ios:MountChurn` | stale | 0 tests / 1 suites | 09ac5033a5fa (not this tree) | 16.8 s | start 13.2 / med 12.3 / max 13.2 |

Both example apps build from this tree after the Xcode project edit —
`build-app.mjs --platform ios` and `--platform android` each stamped `0680885cb9fd`, which is the
same stamp every device gate above refuses to run without.

`need --for review`: `need: review is satisfied on this code tree` (`check`, `harness:ios` on the ios half, `harness:android` on the android half; `real-input:android` is not asked for — nothing under `scripts/real-input/` changed, and the brief asks for `real-input:ios`, which is green above). `real-input:ios` took 51 m because it rebuilt the app *and* the UI-test bundle under a load spike (max 216.9).

### Full-run duration, before and after

Full runs, same lease and device pair; "run" is the harness's own suite time, which excludes
device setup. Load median in brackets — a shared machine, so the run figure is the fairer pair.

| Platform | Tests before → after | Files | Wall before → after | Run before → after |
| --- | --- | --- | --- | --- |
| iOS | 632 → 601 | 32 → 30 | 923.9 s [8.11] → 860.7 s [6.59] | 871.0 s → 814.8 s (−6.5%) |
| Android | 688 → 659 | 32 → 31 | not comparable → 1096.3 s [5.64] | not comparable → 1057.1 s |

iOS loses two files (the deleted `FormFidelity` and the now name-scoped `MountChurn`) and 31 tests;
Android loses one file and 29 tests. The Android "before" run is not a fair baseline: the code
tree moved during it, the ledger records it as failed, and five of the removed tests were already
missing from it, so no Android duration is compared.

## Removed test → the rule that covers it

| Removed | Suite | Covered by |
| --- | --- | --- |
| `lays out at the declared fallback and corrects a wrong cached size` | Slider | Conformance
`has its own declared fallback, and still corrects a wrong guess` (rule 1, default config) |
| `lays out at the declared fallback and corrects a poisoned cached size` | Stepper | same rule 1 |
| `lays the default row out at the size it measured, not at the planted one` | ButtonGroup | same
rule 1 |
| `leaves the engine where it started across a churn of drops` + `CHURN` | Conformance | removed
with the rule; the surviving leak rule is its positive control |
| `mounts the same batch from every starting guess, at the right size`; `counts how many boxes of
a cold batch reached a frame wrong` | Sizing | nothing — they measured; `bench/` judges durations |
| `mounts many instances at once` (x3) | Switch, Slider, Progress | nothing — measured; `bench/` |
| `Mount churn (B1)` / `recycling · churn does not leak (iOS)` `it.skip` | MountChurn, Recycling |
placeholders; the iOS gap stays written up in Recycling's comment |

Kept, with the reason (each is something the Conformance rule does not assert): Progress
`lays out at the declared guess…` seeds **linear and circular** together; ListItem `sizes each
configuration…` is a per-configuration matrix; Chip `starts empty for its next owner` is
`variant="assist"` plus a pixel probe of the tint it drew; Picker `grows an unpoisoned pick whose
new configuration starts at the fallback` and Progress `re-measures a variant change…` test a
**transition**; Picker and SegmentedControl `corrects a planted size that matches the current box`
test the iOS measure signal; SearchField `lays out at its declared fallback…` asserts the sizing
**trace** stages; the `comes back from the pool…` / `none of its previous…` family (TextField's
eight props, Stepper's value/range/name, SearchField, Checkbox's picture, Menu's glyph, Form's
gone title's band, and BottomSheet/Dialog/Popover/Tooltip's native-owned open state, which
Conformance records as a blind spot) assert residue rule 4 cannot reach.

## Red proofs

Recorded as data in `docs/tasks/X37/mutations.json`; every mutated build is the same
`build-app.mjs` artefact the gates use, and the file was restored and rebuilt before the next row.

- moved band test -> `headerBand` reported 20 dp short (no padding) -> `expected -4 to be greater
  than or equal to 8` at `example/__tests__/Form.harness.tsx:2985`
  (`harness:android:Form.harness`, 4 failed of 23, 47.5 s).
- moved accessory test -> `drawnAccessory` reported +40 dp -> `question 2: the accessory ends at
  x=391.6 dp, past its row's trailing edge at x=367.6 dp` (same run).
- moved card test -> `drawnCards` reported +30 dp -> `X24: row 0: its container is drawn at y=68.5
  while the row starts at y=37.3` (same run, which also reddened the G24 recycle case as an
  artefact of mutating three report fields at once).
- footer half of the band claim -> `footerBand` reported 10 dp short, on its own -> exactly 1 failed
  of 23: `expected 2.1999999999999993 to be greater than or equal to 4` at
  `example/__tests__/Form.harness.tsx:2986`, header line still green.
- layer half of the band claim -> `layerH` reported at 80% -> `question 2: the section draws into a
  layer 237.1 dp tall while the section itself is 296.4 dp … (out by 59.3 dp)` at
  `example/__tests__/Form.harness.tsx:3014` (2 failed of 23).
- the band-measure fix (`3c074f75`) -> the same `layerH` mutation, run before the fix -> the test
  failed on `headerBand=0.0`/`footerBand=0.0` instead of the claim. That is the read-too-early race
  this round found, and the reason `FormFidelity` never saw it: its 400 ms screenshot pause settled
  the pair by accident.
- `MountChurn.android.harness.tsx` scoping -> its `it.skip` deleted while the file was still named
  for both platforms -> `FAIL __tests__/MountChurn.harness.tsx — Your test suite must contain at
  least one test.` (`harness:ios:MountChurn`, 0 tests, 3.1 s).
- not a mutation: `Menu · Split trigger (E3)` failed the first full iOS run with `expected [] to
  deeply equal [ 'split:action' ]` and passed the single rerun. The race itself was **not**
  reproduced; the identical assertion sits in X32's committed full-run log, and the press is the
  runner's own `userEvent.pressAt` at a measured box, so nothing this branch deleted is on that
  path.
## Files changed

- Removed measurements: `example/__tests__/Sizing.harness.tsx`, `Switch.harness.tsx`,
  `Slider.harness.tsx`, `Progress.harness.tsx`, `Conformance.harness.tsx` (churn rule).
- Rule-1 twins and the moved Form regressions: `example/__tests__/Stepper.harness.tsx`,
  `ButtonGroup.harness.tsx`, `Slider.harness.tsx`, `Form.harness.tsx`; deleted
  `example/__tests__/FormFidelity.harness.tsx`.
- Platform scoping: `example/__tests__/MountChurn.harness.tsx` →
  `example/__tests__/MountChurn.android.harness.tsx`, with its path references in
  `example/android/app/src/main/java/nitroui/example/MainApplication.kt`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt` and
  `docs/components/picker.md`.
- Timing gate: `example/__tests__/runState.ts` (new, locale flag), deleted `timingGate.ts` and
  `scripts/harness-timing-gate.js`, new `scripts/harness-run-state.js`, wired in
  `example/metro.config.js` and `example/rn-harness.config.mjs`.
- Package: `ios/components/Form/NitroUiFormReference.swift` deleted, `ios/components/Form/HybridNitroUiForm.swift`,
  `src/components/Form/Form.nitro.ts`, `etc/package-files.txt`, `.changeset/x37-harness-trims-form-reference.md`.
- Dwell probe: `example/ios/NitroUiExample/NitroUiProbe.swift`, `example/src/probeVariant.ts`,
  `example/src/SwitchScreen.tsx`, `example/ios/NitroUiExample/SceneDelegate.swift`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `example/ios/NitroUiExample.xcodeproj/project.pbxproj`.
- Docs: `CONTRIBUTING.md`, `example/__tests__/Conformance.harness.tsx` comments.

## Follow-ups

- Flaky: `Menu · Split trigger (E3) › is two halves, and each one does only its own job`,
  2026-11-15, `<store>/task/X37-harness-trims/harness+ios-2026-11-15T12-26-09.278Z.log` — same
  assertion as X32's full-run log; green on the one rerun.
- Item 2: the ~20 remaining rule-4 candidates each assert component-specific residue (TextField's
  eight props, Stepper's value/range/name, the popup family's open state) — Conformance's rule
  stays the generic contract and none of these are its twin.
- `docs/DECISIONS.md` D21 still describes the wall-clock gate whose duration half is now gone.
- The Form report's `kind` field is now constant (its only non-default value came from the
  deleted reference Form) and should be retired.
- `scripts/__tests__/real-input-ios-log.test.js:83` still parses a dwell-probe log line;
  `scripts/real-input/tab-targets.mjs` and `scripts/__tests__/helpers/scrubbed-env.js` still
  mention the probe — all in or beside the Android-driver task's scope.
- Committed failure logs from earlier tasks still quote the wall-clock route this branch
  deletes, which no reviewer can open any more.
- `AGENTS.md` still says `gate.mjs export` writes a scrubbed excerpt per failed run into
  `docs/tasks/<ID>/failures/`; ledger v6 no longer writes `failureLogPath`, so the paragraph
  describes a mechanism that is gone and my export produced no such directory.
- `gate.mjs` retention is now tight enough to matter: one `check` run pruned 52 stored logs to the
  64 MiB cap. This branch's own logs survived, but a red proof left for a day may not.
- Shared-helper refactor across the harness files (audit decision 11) not attempted.

## Questions for orchestrator

None.

## Fix round 1

The review (`docs/tasks/X37.review.md`) found no code to change. Its three must-fix items were
text: the Android before-and-after figures in this report came from a run that the ledger records
as failed (corrected above: 688 to 659 tests, no duration comparison); `docs/components/stepper.md`
and `docs/architecture/core.md` each still described a test this branch removed; and
`CONTRIBUTING.md` said three full runs went red on the timing plumbing where the records show
seven runs in three tasks. The changeset is rewritten for an app developer. New comments in this
branch that cite the task are left for the comment sweep that follows the merge.

