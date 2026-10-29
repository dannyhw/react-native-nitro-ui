# F2 — Follow-ups sweep (docs, comments, two real fixes, one test-hygiene change)

**Branch:** `task/F2-followups-sweep` (from `main` at `747debc`) · **Round:** 1 of 1 (D19) ·
**Lease:** `F2-3hxh8` (`iPhone Air` `331EF109-…` / `nitroui_t01` `emulator-5570`, Metro `8293`)

## Summary

Fifteen items in sixteen commits (the FOLLOWUPS prune is its own commit). Fixed: X1's doc-table `20`→`19`; the always-true lease-TTL
assertion (now assertable); platform-correct `harness:*` labels in `scripts/harness.mjs`;
`--clean` also dropping the pod-inputs record, with a test; C1's N1 caption, N2 `armed`
comment, N3 `settle()` before the over-wide edge taps and N4 apply-notification/clipped-frame
wording; the bench `nitro-ui-host` comment; the `0 x 0` comment a696d05 left behind; the
`slider.md` thumb-only-drag note; the three fake dark cards; and the S1 `real-input:android`
PASS row (annotated, not rewritten).

Three of the brief's items were **wrong about the tree** and are closed as readings, not fixes:

- the word "prospective" is not in `sizing.md`, and `git log -S prospective` over that file finds
  no change at all, so the line row 18 names does not exist (T14's own sentence was about sizing.md's
  claim that a mounted instance "is asked to measure again"). What *was* vague — "the host re-measures and reports" — now
  names the two asks it means (`onConfigurationChanged`, `traitCollectionDidChange`).
- H1's S2 "value change while hidden" is already covered (`Host.harness.tsx:1124-1178`,
  `6028511`); the gap Q4 cited is the dialog test. Round 1 called F10's **shown→hidden after
  mount** half open, and review M1 showed that is wrong — `HostPopups.harness.tsx:1135` performs
  that teardown; the hit-test half is what has no test (fixed in the fix round, below).
- Row 25's audit tail closes clean: the three components passing a configuration to
  `useSizingId` are exactly the three that render their native view with a `key`.

Two items were skipped as larger than a small fix and left as one FOLLOWUPS line each: C1's N5
(a behaviour change to `onConfigurationChanged`) and the T11 sizing-engine minors.

Two things a reviewer should see first. The N1 fix edits **another task's report**
(`C1-android-overwide.report.md`), which the brief authorises by naming N1; the caption now
describes the shot as it draws (row 1 ellipsised, row 2 showing January…April whole). And
`DatePicker.stories.tsx` turned out to carry the same honesty defect as the three named cards —
its note pointed at a light/dark pair `docs/components/date-picker.md` does not contain — so it
went in as a fourth one-line commit. Checking that claim is what showed only
`docs/components/button.md` holds a captured pair, which is why the new notes say that instead
of promising one.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1113 tests / 42 suites | `b65316f3df4e` | 1 m 54 s | start 3.2 / med 6.4 / max 7.4 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `b65316f3df4e` (ios tree) | 2 m 05 s | start 11.2 / med 7.8 / max 11.2 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `b65316f3df4e` (android tree) | 6 m 04 s | start 24.2 / med 4.7 / max 24.2 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need: review is satisfied on this code tree.` The ledger also carries three earlier
`harness:ios` rows that did not pass: two refusals before the stamped app was built (`05:43`,
`05:44`), and one real red at `05:45` — `Sizing · intrinsic (T11) › lays a cold Switch out at
the size the control measures` failed `expect(content).not.toBeNull()` at load 50 while its own
trace showed the correction (`laidOut:40.0x20.0 … corrected:61.0x28.0`) and printed
  `box=61.00x28.00` — the corrected size — so the handle read lost a race, not the sizing. Excerpts in `docs/tasks/F2/failures/`.
`real-input` is not owed here: no runner or control code changed.

## Red proofs

- `lease.test.js` TTL -> `EXCLUSIVE_TTL_MINUTES 960 -> 240` in `scripts/lease-core.mjs` ->
  `lease.test.js:1117` `Expected: >= 840, Received: 240` (mutation reverted).
- `build-speed.test.js` `iosCleanTargets` -> delete the new helper -> `build-speed.test.js:220`
  `TypeError: (0 , _buildSpeedLib.iosCleanTargets) is not a function`.
- The N3 change adds no assertion (it is `await settle()` before existing taps), and the other
  thirteen commits are comments, docs and story markup, so there is nothing else to show red.
  The story change is covered by `check`'s typecheck, not by a test.

## Files changed

- Docs: `docs/architecture/sizing.md`, `docs/architecture/core.md`, `docs/components/slider.md`,
  `docs/tasks/FOLLOWUPS.md`, `docs/tasks/S1-storybook.report.md`,
  `docs/tasks/C1-android-overwide.report.md`, `docs/tasks/F2/gates.jsonl` + `failures/`.
- Kotlin: `android/.../core/NitroComposeHost.kt` (two comments).
- Scripts/bench: `scripts/__tests__/lease.test.js`, `scripts/harness.mjs`, `scripts/build-app.mjs`,
  `scripts/build-speed-lib.mjs`, `scripts/__tests__/build-speed.test.js`, `bench/src/plan.ts`.
- Example: `example/__tests__/SegmentedControl.harness.tsx`, `example/__tests__/HostControls.harness.tsx`,
  `example/src/stories/{Switch,Progress,SegmentedControl,DatePicker}.stories.tsx`.

## Follow-ups

- C1 N5: gate the `onConfigurationChanged` `remeasureToken` bump on the host having been armed, or drop it.
- H1 F10: one harness case for shown→hidden after mount (the value-write half already exists).
- T11 minors: the three engine behaviours in `FOLLOWUPS.md`, each a behaviour change.
- Docs: only `button.md` has a captured light/dark pair; the other six controls' appearance
  claims live in prose only. Capturing the pair is someone's task, not F2's.
