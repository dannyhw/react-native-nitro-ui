# X21 — The four flakes that keep costing merge rounds a re-run

**Branch:** `task/X21-recurring-flakes` (from `main` at `9019f302`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X21-znj7u` (`pair-a` — `emulator-5574` + `nitro-ui A` simulator, adb server `5043`, Metro `8295`)

## Summary

All four flakes have a cause and a fix, and three of them are not what their message said.

**1 (iOS `frozen: 1 edits refused`) was the check, not the component.** `frozen.typeText("xy")`
typed a blind string and then waited for a count of two, which assumes both keys arrived and that
a field emits exactly one edit per key. A keystroke is synthesised input on the same path as a
touch, and this machine drops touches (`FOLLOWUPS.md:58`) — a lost key then reads as a revert that
lost an edit. `typeKey` now types one key, waits for that key's own echo, and re-types a key the
field never received through `pressUntil`, so the retry is counted and reported like a press
retry. The field's own text stays the witness for a key it *keeps* showing with no echo, which
fails instead of being re-typed into a green (F1 M3); a field the app puts back whatever JS did
with the edit leaves no trace for a witness read from out here, and the check says so.

**4 (`expected [3, 6, 3] to deeply equal [3, 6, 9]`) is a product bug**, not a flake: Compose
publishes `ProgressBarRangeInfo` at composition and republishes it a frame later, so a reader's
`setProgress` target is built from the progress the reader was *shown* while the model decided the
direction against its own newer value. A tree one press behind turns "up" into "no direction" (a
press that does nothing on `0..12 step 3`); two behind turns it into "down". The direction now
comes from the published progress; the destination stays the model's.

**2 (`mounted 9 of 10`) is a read taken too early.** The counters live in `Content`'s passive
effect while both witnesses the test waited for (`onDismiss`, native `live=0`) fire before the
render that unmounts, so the exact `toBe(10)` was racing React. It now waits for the number and
still asserts it exactly.

**3 (`goToScreen`) was one press and a throw** that aborted a 30-minute run — and two captured
runs had no app process at all, so "slow tab" was sometimes a dead app. Navigation now re-presses
the way every other delivery in the suite does, counts the retry, and says which of the three
causes it is looking at.

## The four flakes

| Flake | Runs seen failing | Cause | Fix | Proof |
| --- | --- | --- | --- | --- |
| 1 `real-input:ios` · `testRealInputTextField`: `("frozen: 1 edits refused") is not equal to ("frozen: 2 edits refused")` | X19, G16, E2, E3 (report), E5 ×3 (`gate.mjs logs --failed --all`) | `frozen.typeText("xy")` typed blind, then waited for a count of 2: assumed one edit per key and never checked a key arrived. Keys are synthesised input, and those are dropped here too (`FOLLOWUPS.md:58`) | `typeKey`: one key → that key's echo → re-type an undelivered key through `pressUntil` (counted, `answered on key n/N`, parsed by `ios-log.mjs`); a field that took the key and lost the event fails instead of being retried | red: pre-fix code with one key withheld → the historical line, byte-for-byte. green: the same drop at delivery → `testRealInputTextField` passed, logging `answered on key 2/3` twice and `2 press sequence(s) needed a retry`. A swallowed app-side event still fails the case (Red proofs) |
| 2 `harness:android` · `BottomSheet · 50 cycles`: `expected 9 to be 10` | E2 ×2, G16, X19 committed excerpts (+ FIX4 ×2 per brief) | `mounts`/`unmounts` are bumped in `Content`'s `useEffect` (a *passive* effect), while `dismissedCallback` fires `onDismiss()` in the same call and native's `live` clears on its own hop — both witnesses predate the last unmount's bookkeeping | `waitForContentCycles` polls both counters before the assertion; the exact `toBe(10)` asserts are unchanged, so a sheet that never unmounts (or unmounts twice) still fails, naming both counters | red: lagging `unmounts` + the old blind assert → `expected 9 to be 10`, then `20/30/40/50 to be 10` in the carry-over rounds, matching the excerpts; with the fix the same lag is green, and dropping the tenth unmount stays red |
| 3 `real-input:android` · `goToScreen`: `tapping the "X" tab did not bring up its screen` aborts the run | X4 (Dates), M2 (Switch, Host), G16 (Picker ×2, Segments), E5 (Host) — 6 committed excerpts, 2 store logs; two of them show `no nitroui.example process` | One `tap`, then `REACT_TIMEOUT`, then a throw that ended the whole suite. It could not tell a dropped tap from a slow screen from an app that had stopped existing, and pressed on into the dead-app case | Re-`revealTab` + re-tap up to `TAB_TAPS = 3`, counted as `navigation: … answered on tap n/N`, with `appPid()` asked between presses: a dead app is named and *not* retried, and the final throw prints `screenSummary()` (pid + the tabs on screen) plus the app log | green: first tap swallowed → `tap 1/3 … tapping again`, `answered on tap 2/3`, `1/1 controls passed · 1 press sequence(s) needed a retry`. red: `am force-stop` mid-navigation → `nitroui.example stopped running … Not retried` in 99 s |
| 4 `harness:android` · `Slider › steps to the next legal value when a screen reader asks`: `expected [3, 6, 3] to deeply equal [3, 6, 9]` | FOLLOWUPS (`H1`, `F3`), G15, E3, and `[3, 6, 9, 6]` / `[3, 6, 9, 10, 9]` in M2, X4, E5 | `accessibilityStepToward` compared a target derived from the *published* `ProgressBarRangeInfo` with the model's already-updated `displayed`. Composition writes that node and Compose republishes it a frame later, so a tree one press behind sends "up" as no-direction and two behind as "down" | Product fix: `accessibilityStepToward(target, publishedProgress)` takes its direction from the progress the reader was shown; the `setProgress` lambda passes the composition's own `displayed`. Destination still `stepped(from, up)` | JVM test `anAccessibilityStepTakesItsDirectionFromTheProgressTheReaderWasShown` → red when the comparison goes back to `from`. New harness case posts two `nuiTestAccessibilityStep(1)` in one turn → on the old code `Wanted 2 onSlidingComplete(s), have 1 (start=[0] change=[3] complete=[3])` |

**Repeat runs (the brief's >= 5 back-to-back, on the final tree `c96349c087ab`):** 5x
`harness:android -- BottomSheet` (27/27 each), 5x `harness:android -- Slider` (25/25 each), 5x
`real-input:ios -- --control text-field` (1/1 controls + 20/20 auxiliary each, zero retries), then the full
`harness:android`, `harness:ios`, `real-input:ios` and `real-input:android` suites - the last of which walks all 17 tabs twice (its 22 checks and the a11y sweep), which is flake 3's affected path - 41 m 46 s, 22/22 controls, 20/20 auxiliary, and `0 press sequence(s) needed a retry`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1823 tests / 72 suites | `c96349c087ab` | 2 m 46 s | start 5.3 / med 7.9 / max 13.6 |
| `harness:ios` | **PASS** | 454 tests / 25 suites + isolated 4 tests / 2 suites | `c96349c087ab` (ios tree) | 15 m 01 s | start 6.8 / med 4.7 / max 10.4 |
| `harness:android` | **PASS** | 505 tests / 25 suites + isolated 4 tests / 2 suites | `c96349c087ab` (android tree) | 15 m 08 s | start 10.1 / med 3.5 / max 10.1 |
| `real-input:ios` | **PASS** | — | `c96349c087ab` (ios tree) | 26 m 16 s | start 8.1 / med 7.4 / max 31.4 |
| `real-input:android` | **PASS** | — | `c96349c087ab` (android tree) | 41 m 46 s | start 4.0 / med 5.4 / max 115.4 |
| `harness:android:-t:catches%20up` | stale | 1 failed of 505 tests / 25 suites | 34eb539768ec (not this tree) | 53.7 s | start 123.6 / med 76.4 / max 123.6 |
| `harness:android:before%20the%20a11y%20tree%20catches%20up` | stale | — | 34eb539768ec (not this tree) | 1.1 s | start 170.9 / med 170.9 / max 170.9 |
| `harness:android:before%20the%20a11y%20tree%20catches%20up:--background` | stale | — | 34eb539768ec (not this tree) | 1.5 s | start 109.4 / med 109.4 / max 109.4 |
| `harness:android:BottomSheet` | **PASS** | 27 tests / 1 suites | `c96349c087ab` (android tree) | 2 m 10 s | start 4.7 / med 4.6 / max 5.4 |
| `harness:android:Slider` | **PASS** | 25 tests / 1 suites | `c96349c087ab` (android tree) | 21.2 s | start 12.5 / med 11.4 / max 12.5 |
| `real-input:android:--control:button` | stale | — | ea6e7f333968 (not this tree) | 1 m 39 s | start 3.8 / med 3.4 / max 3.8 |
| `real-input:ios:--control:text-field` | **PASS** | — | `c96349c087ab` (ios tree) | 6 m 56 s | start 10.4 / med 9.0 / max 23.8 |

`need --for review`: `need: review is satisfied on this code tree.` (`check`, `harness:ios`, `harness:android`). `need --for merge`: also satisfied — `real-input:ios` and `real-input:android` are green on the same tree. The three `stale` rows are named probes from this branch's earlier drafts (`gate.mjs harness:android -- -t ...`, which filters by file path, not test name) and the tab-tap mutation run; they are on trees this branch no longer has.

## Red proofs

- `real-input-ios-log.test.js › counts a re-typed keystroke as the retry it is` -> `isRetry` regex back to `/ answered on tap \d+\/\d+/` -> `expected true, received false` at `:122`, and `testRealInputTextField` keeps its key retry in `notes` instead of `retries`.
- `real-input:ios -- --control text-field` -> pre-fix block with the second keystroke never delivered -> `RealInputTests.swift:3721: error: XCTAssertEqual failed: ("frozen: 1 edits refused") is not equal to ("frozen: 2 edits refused")`.
- `real-input:ios -- --control text-field` -> `typeKey`'s first delivery of each key swallowed -> passes, and the log carries `answered on key 2/3 - the earlier key(s) were never delivered`, counted in the summary.
- `real-input:ios -- --control text-field` -> `refuseEdit` in `TextFieldScreen.tsx` emptied out, so the app takes the key and never reports it -> `3 real presses on key "x" into the frozen field left it at "frozen: 0 edits refused"`: a swallowed event is not retried into a green. It is not *named* as a lost event either - RN put the field back to `frozen` regardless, so the `took the key and lost the event` branch could not fire; `typeKey`'s comment now says so instead of claiming a witness this control does not give.
- `harness:android -- BottomSheet` -> `unmounts` bumped 400 ms late + the old blind `toBe(10)` -> `expected 9 to be 10`, then `20/30/40/50 to be 10` in the rounds that inherit the counters.
- `harness:android -- BottomSheet` -> tenth unmount dropped, with the fix in place -> `"cycle" never counted ten mounts and ten unmounts in round 1: mounts=10, unmounts=9`.
- `SliderModelTest.anAccessibilityStepTakesItsDirectionFromTheProgressTheReaderWasShown` -> direction compared against `from` again -> that test alone: `expected 6.0 to be 3.0`.
- `harness:android -- Slider` (new a11y double-press case) -> old `accessibilityStepToward(target)` -> `Wanted 2 onSlidingComplete(s), have 1 after 5000ms (start=[0] change=[3] complete=[3])`.
- `real-input:android -- --control button` -> first tab tap swallowed -> `navigation: the "Button" tab answered on tap 2/3 …` and `1 press sequence(s) needed a retry`.
- `real-input:android -- --control button` -> `am force-stop` before the first tap -> `real-input: nitroui.example stopped running while navigating to the "Button" tab … Not retried.`

## Files changed

- `example/ios/NitroUiExampleUITests/RealInputTests.swift`: `typeKey` (+ `waitUntil`), used at both frozen fields; `pressUntil` gains `pressNoun` so a re-typed key is reported as a key.
- `scripts/real-input/ios-log.mjs`, `scripts/real-input/report.mjs`, `scripts/__tests__/real-input-ios-log.test.js`: key retries are counted, not filed as notes.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSlider.kt`: the a11y step's direction comes from the published progress.
- `android/src/test/java/com/margelo/nitro/nitroui/SliderModelTest.kt`: JVM test for the stale-tree window.
- `example/__tests__/Slider.harness.tsx`: two reader presses posted in one turn — the ordering the flake found by accident.
- `example/__tests__/BottomSheet.harness.tsx`: `waitForContentCycles` before the exact counter asserts.
- `scripts/real-input/android.mjs`: `goToScreen` presses until the screen arrives, or names why it never will (`appPid`, `screenSummary`, `crashTail`).

## Follow-ups

- `real-input:android`: every filtered run still pays for the whole a11y sweep, so iterating on one control costs ~13 min and a 5-run repeat battery of navigation costs an hour - that is why flake 3's repeats here are full-suite walks.
- `real-input:ios`: the other typed bursts (`typing`, `maxLength`, `focus`, search `typing`) still type blind strings and assert one edit per character — `typeKey` covers them the same way.
- `real-input:ios`: a controlled field the app puts back whether or not JS saw the edit leaves `nativeState` nothing to read, so a lost keystroke event and a dropped keystroke are indistinguishable from out here - the frozen-field check can only assert delivery.

## Questions for orchestrator

(none)
