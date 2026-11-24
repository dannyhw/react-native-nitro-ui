# FIX33 — The Android Form section draws into a layer as tall as itself; the clear case waits for its count

**Branch:** `task/FIX33-form-band-and-clear-count` (from `main` at `1479176e`) ·
**Round:** 1 of up to 3 ·
**Lease:** `FIX33-91fi2` (iPhone Air iOS 27.0 / `avd:nitroui_b` serial `emulator-5570`, adb server
5041 / Metro 8293 iOS, 9293 Android)

## Summary

**The Android section's layer.** It took its size as values passed into its modifier, so it measured
against the box the previous composition captured: a layer one pass behind a section that had just
grown drew into its old height, and a short layer is visible — the footer bottom-aligns inside it
and the row shapes clip to it. `intoSectionBox(model)` reads `boxW`/`boxH` inside the `layout` block,
where they are the box the section was just measured and laid out at, and measures the child to
exactly that; width keeps the clamp to the incoming constraint. The box is no longer read by the
composition, so a resize re-measures one node instead of recomposing the layer — still one measure
pass, no prop changes, nothing per update.

**Why CI read 8 dp.** The shared host measures the layer's content with an unbounded height
(`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`), so main's
`coerceAtMost(constraints.maxHeight)` had nothing to clamp against; the host view itself is measured
`EXACTLY` at the section's height. CI's own report says a lag: `hostBox` 296.4 while the layer was
288.4, and its drawn row shapes sat at tops 37.3/93.3/149.3/205.3 (56 dp apart) against row boxes at
38.3/96.2/154.1/212.0 (58 dp apart). A clamp leaves shapes on their rows; instead the whole
composition — `rects` and `boxH` — was older than the section, and a software-rendered CI
emulator makes that pass slow enough for a one-shot read to land inside it.
`intoSectionBox` removes the height half of the lag; the shapes still come from the last
composition, so the case now waits for a pass that read the section as it is now (Fix round 1). The
leased emulator is already CI's configuration (`pixel_9`, API 35, 1080x2424, 420 dpi, `font_scale`
1.0), so no `wm` or `settings` change was made or needed. Sampled every tick from mount, the section
went 224.0 dp -> 296.4 dp with the layer beside it: the lag here is under a tick, so the case needs
a wait, not a longer timeout or a looser tolerance.

**The SearchField clear case.** It read its report as soon as the text was empty, but the text and
the count of the event that emptied it settle in separate writes, so that count can be the one from
before the clear — CI read 2 where 3 was expected. The wait now asks for both halves; every
assertion is unchanged.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2231 tests / 103 suites | `36dc403e56c9` | 57.4 s | start 5.2 / med 13.9 / max 16.3 |
| `harness:ios` | **PASS** | 622 tests / 30 suites + isolated 6 tests / 3 suites | `36dc403e56c9` (harness:ios digest) | 14 m 38 s | start 8.5 / med 5.4 / max 8.5 |
| `harness:android` | **PASS** | 681 tests / 31 suites + isolated 6 tests / 3 suites | `36dc403e56c9` (harness:android digest) | 18 m 22 s | start 4.0 / med 5.6 / max 10.8 |
| `real-input:ios` | **PASS** (completed: 1 of 53 units re-run, attempt 1; from `merge/button-group-border`) | — | `6bb466dc8146` (real-input:ios digest) | 6 m 51 s + full run 41 m 40 s | start 3.0 / med 6.5 / max 13.7 |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Form.harness` | stale | 4 failed of 27 tests / 1 suites | 0cc56469bff0 (not this tree) | 1 m 11 s | start 4.0 / med 4.3 / max 4.9 |
| `harness:android:reserves%20a%20band` | stale | — | 1ab6fb8e4346 (not this tree) | 1.3 s | start 4.0 / med 4.0 / max 4.0 |
| `harness:android:SearchField.harness` | stale | 2 failed of 18 tests / 1 suites | e9e59be9c5d5 (not this tree) | 30.0 s | start 3.0 / med 3.0 / max 3.0 |
| `harness:android:TextField.harness` | stale | 1 failed of 21 tests / 1 suites | c8f6f044c683 (not this tree) | 29.4 s | start 3.2 / med 3.0 / max 3.2 |
| `harness:ios:SearchField.harness` | stale | 18 tests / 1 suites | c8f6f044c683 (not this tree) | 36.3 s | start 9.8 / med 9.9 / max 10.4 |

`need --for review` at round 1 asked for `check`, `harness:ios` and `harness:android`; the table above
is the current one, and Fix round 1 closes it. No `real-input` gate was run here.

## Red proofs

- `example/__tests__/Form.harness.tsx` "reserves a band with its padding and draws into a layer as
  tall as its section (E2)" -> the layer frozen after its first non-zero composition (`layoutHost`
  writes `boxW`/`boxH` once, and the layer keeps the first non-empty `rects`) -> `question 2: the
  section never settled into a layer as tall as itself: the layer is 224 dp tall against a 296.4 dp
  section, and row 0 draws 0.0,0.0,411.4,56.0 against its box 12.2,38.3,387.4,54.0 (out by 38.3 dp)`
  — the wait times out on the stale pair, and `hostBox` still read 296.4 as it did in CI.
- `example/__tests__/SearchField.harness.tsx` "reports the clear button as one empty edit and keeps
  the focus" -> the new wait made unsatisfiable, `current.nativeEvents > typed.nativeEvents + 1`, so
  the clear never counts its event -> `SearchField cleared: the clear, counted as a native event,
  and every event reported to JS never happened; last report {"text":"","focused":true,...,
  "nativeEvents":3,"jsEvents":3,...}` (run on Android; on iOS the case is green unmutated).

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiFormSection.kt`
- `example/__tests__/SearchField.harness.tsx`
- `docs/tasks/FIX33-form-band-and-clear-count.report.md`

## Follow-ups

- Harness: three submit-then-blur units were red in round 1 on `emulator-5570` — the question
  below. The Form and clear cases pass in the same runs.

## Questions for orchestrator

- `harness:android` is red on three units: `TextField › reports focus and blur, focuses on a tap,
  and submits on Return`, `SearchField › submits on the Search key, then blurs`, `SearchField ›
  gives the field the keyboard the app asked for`. All three wait for a blur that a Submit or Search
  action should cause. This is not the change here: the first is in a file this branch does not
  touch and fails when run alone (`1 failed of 21`), the other two are red with `main`'s version of
  `example/__tests__/SearchField.harness.tsx` too (`2 failed of 18`, the clear case green), and the
  Form and clear cases pass in the same runs. The device
  block shows `mInputShown=false`. `show_ime_with_hard_keyboard` was `0`, and setting it to `1` did
  not change the result; it is back to `0`, no `wm` override was ever set, and `wm size` /
  `wm density` still read the AVD's own 1080x2424 / 420. `emulator-5570` came to this lease booted,
  out of FIX32's `real-input:android` run. Options: re-run `harness:android` on a freshly booted
  device, or open it as an Android bug in the submit-to-blur route. Recommendation: the fresh-device
  re-run first — it costs one gate and separates device state from a real bug.

## Fix round 1

The cause is a lag, not a clamp: the shared host measures the layer's content with an unbounded
height, so main's `coerceAtMost(constraints.maxHeight)` never bit; CI has `hostBox` 296.4 beside a
288.4 layer whose row shapes sat 1-6.7 dp off their rows — `rects` and `boxH` both read a pass ago.
The Summary and the comments on `boxW`/`boxH` and `intoSectionBox` say that; width keeps its clamp.

`example/__tests__/Form.harness.tsx` now waits, inside the case's own 12 s deadline, until `layerH` is
within 1 dp of `boxH` and every `drawnCards` box matches its `cardBoxes` box, then asserts exactly as
before. Red proof — freeze the layer after its first non-zero composition (`layoutHost` writes the box
once, the layer keeps the first non-empty `rects`):

> question 2: the section never settled into a layer as tall as itself: the layer is 224 dp tall
> against a 296.4 dp section, and row 0 draws 0.0,0.0,411.4,56.0 against its box 12.2,38.3,387.4,54.0
> (out by 38.3 dp)

Unmutated, green. `emulator-5570` came booted and was not rebooted; the keyboard was up, the three
submit-then-blur units did not return, and `harness:android` is green.

`need --for review`: `need: review is satisfied on this code tree.`
