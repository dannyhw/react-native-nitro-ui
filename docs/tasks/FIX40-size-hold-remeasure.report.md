# FIX40 — A Picker whose held size is dropped measures again

**Branch:** `task/FIX40-size-hold-remeasure` (from `main` at `f6e1e331`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX40-0hqsh` (iPhone 17 / iOS 27.0 and `nitroui_a` / API 35 / Metro 8295 and 9295)

## Summary

No library change. The brief's first item asked for a measurement on the current library before
any change, and on both platforms the measurement says the gap is not there: a Picker whose held
size is dropped by a batch that no longer shows what the pick painted still ends at its own
measured size. This report ships the harness case that reads it, controlled and uncontrolled.

The case picks the long title with JS blocked for 220 ms, so the pick has painted before the
handler replaces `options` with a list whose same index is a different width. That batch is the
first to have seen the pick, and `pickIsStillShown` is false because the options differ, so the
held size is dropped. The key it lands on is poisoned to 13.25 x 66.5, so the control can only
leave it by reporting the title it now shows. Reference pickers measured both widths beforehand and
are unmounted, so nothing else can file either width, and the case asserts that the pick's width
and the replacement's differ by more than 8 px - otherwise "the pick's size was filed under the new
key" and "the right size" would be the same reading.

Readings, box against the control's own measured content:

| Platform | before pick | pick painted | replaced by | final box | `measureContent()` |
| --- | --- | --- | --- | --- | --- |
| iOS | 72.00 x 34.67 | 360.33 x 34.67 | 291.33 x 34.67 | 291.33 x 34.67 | 291.33 x 34.67 |
| Android | 280.00 x 56.00 | 384.76 x 56.00 | 318.86 x 56.00 | 318.86 x 56.00 | 318.86 x 56.00 |

The reason there is nothing to fix is that every prop that can make `pickIsStillShown` false is
already a prop that asks for a fresh measure in the same batch: `options`, `label` and `variant`
call `noteContentSizeMayHaveChanged()` beside `markDirty()` on iOS, and on Android they recompose
and Compose's own measure pass reports; a move of the shown index is flagged in `afterUpdate()`. So
the release path is never the only thing that can file a size for the new key. On iOS a pick alone
does not reach the release with a size in hand: a sentinel filed from the drop path never appeared
in the trace, because iOS has no measure point between a pick and the batch that follows it.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2307 tests / 107 suites | `ce0169497bf6` | 54.3 s | start 3.4 / med 5.2 / max 6.6 |
| `harness:ios` | **PASS** | 630 tests / 32 suites + isolated 6 tests / 3 suites | `ce0169497bf6` (harness:ios digest) | 14 m 48 s | start 5.5 / med 4.2 / max 27.6 |
| `harness:android` | **PASS** | 686 tests / 32 suites + isolated 6 tests / 3 suites | `ce0169497bf6` (harness:android digest) | 18 m 54 s | start 5.5 / med 3.9 / max 27.6 |
| `real-input:ios` | **PASS** (from `merge/ios-picker-hold`) | — | `8364b88515e2` (real-input:ios digest) | 44 m 28 s | start 2.5 / med 3.5 / max 9.6 |
| `real-input:android` | **PASS** (CI run 45730323679; from `merge/picker-hold`) | — | `95d5c2073183` (real-input:android digest) | 49 m 21 s | — |
| `harness:android:%2FPicker%5C.harness` | stale | 2 failed of 42 tests / 1 suites | 050fd4a78211 (not this tree) | 45.0 s | start 2.9 / med 3.0 / max 3.2 |
| `harness:android:batch%20drops` | stale | — | ea24ce4a1774 (not this tree) | 1.2 s | start 3.0 / med 3.0 / max 3.0 |
| `harness:android:Picker` | stale | 3 failed of 61 tests / 2 suites | 2b78ceee8758 (not this tree) | 1 m 24 s | start 3.6 / med 5.3 / max 7.1 |
| `harness:ios:%2FPicker%5C.harness` | stale | 2 failed of 42 tests / 1 suites | e8d66fe2bffc (not this tree) | 38.4 s | start 12.6 / med 9.5 / max 12.6 |
| `harness:ios:batch%20drops` | stale | — | ea24ce4a1774 (not this tree) | 1.9 s | start 3.0 / med 3.0 / max 3.0 |
| `harness:ios:Picker` | stale | 61 tests / 2 suites | 2b78ceee8758 (not this tree) | 57.4 s | start 3.6 / med 5.5 / max 7.1 |

`need --for review`: `need: review is satisfied on this code tree.`

The stale rows are the filtered runs the red proofs below were taken with; an ordinary filtered run
satisfies nothing, and no `real-input` gate was run on this branch (they run at merge).

## Red proofs

- `measures again when a batch drops the size a pick held` and its controlled twin -> Android
  `NitroComposeHost.releaseSizingReports`: keep `sizingReportsHeld` armed when a held size is
  dropped, so nothing files a size afterwards -> both red on
  `"replaced" shows a title that measures 318.86x56.00 but its box ended at 13.33x66.67
  (measureContent 318.86x56.00, laidOut 13.25x66.50)`; `files a real pick under the key of the
  title the pick shows` went red with them (3 failed, 58 passed).
- The same two iOS cases -> `NitroSwiftUIHost`: `holdSizingReports()` also calls
  `invalidateContentSize()` so the hold really carries a size, and `releaseSizingReports` keeps the
  hold armed after a drop -> both red, box stranded at 13.33 x 66.67 against a measured
  291.33 x 34.67. The forced measure is needed because without it the iOS hold is empty at the
  release; the same run turned 10 cases red, so it shows what the case guards, not that iOS is
  broken today.
- iOS drop-path probe (a reading, not a mutation of a guard): filing `222 x 222` from the release
  whenever it drops a held size left the trace at `13.25x66.50` and the box at 291.33 x 34.67 - the
  sentinel never appeared, so on iOS the release had no held size to file in this scenario.

## Files changed

- `example/__tests__/Picker.harness.tsx`: `remeasuresAfterADroppedHeldSize` and its two cases,
  uncontrolled and controlled. No file under `src/`, `ios/`, `android/`, `cpp/` or `scripts/`.

## Follow-ups

- `scripts/harness.mjs`: its positional argument is a file-path pattern, so a test-name filter is
  recorded as a red "No tests found" run rather than a filtered pass.
- `docs/architecture/core.md` section 7: on iOS nothing measures between a pick and the batch that
  follows it, so the hold is usually empty at the release; that asymmetry with Android is unstated.
