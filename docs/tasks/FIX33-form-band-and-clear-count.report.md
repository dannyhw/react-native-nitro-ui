# FIX33 — The Android Form section draws into a layer as tall as itself; the clear case waits for its count

**Branch:** `task/FIX33-form-band-and-clear-count` (from `main` at `1479176e`) ·
**Round:** 1 of up to 3 ·
**Lease:** `FIX33-91fi2` (iPhone Air iOS 27.0 / `avd:nitroui_b` serial `emulator-5570`, adb server
5041 / Metro 8293 iOS, 9293 Android)

## Summary

**The Android section's layer.** It took its size from state read during composition, and then
clamped that size to the incoming measure spec: `withPixelSize(model.boxW, model.boxH)` with
`coerceAtMost(constraints.maxHeight)`. Either half can make the layer shorter than the section, and
a short layer is visible: the footer is bottom-aligned inside it and the row shapes are clipped to
it. `intoSectionBox(model)` reads the box inside the `layout` block, where it is the box the section
was just measured and laid out at, and measures the child to exactly that. The box is no longer
read by the composition at all, so a section that resizes re-measures one node instead of
recomposing the layer; still one measure pass, no prop changes, nothing per update.

**Reproduction.** The leased emulator already is CI's configuration — `pixel_9`, API 35, 1080x2424,
density 420, `font_scale` 1.0 — so nothing under `wm` or `settings` was changed and there was
nothing to restore. Sampling the section's report every tick from mount: the section goes
224.0 dp → 296.4 dp and the layer reads 296.4 dp with it. Locally the layer never lags, and CI's
288.4 dp is a height the section never has; a short read of a still-settling pair would have to be
a height the section held a moment earlier. So the CI number is a clamp, not a lag: there the host's
measure spec arrives 8 dp shorter than the section, and `coerceAtMost` applied it. The red proof
below reproduces CI's exact numbers — 288.4 dp against a 296.4 dp section, out by 8.0 dp — by
shortening the box on purpose. The other possible cause, a measure taken with the previous
composition's box, was not reproduced on this machine; the fix removes it too, by reading the box
where it is used.

**The SearchField clear case.** It read its report as soon as the text was empty. The text and the
count of the event that emptied it settle in separate writes, so that count can be the one from
before the clear — CI read 2 where 3 was expected. The wait now asks the report for both halves of
the clear; every assertion in the case is unchanged.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2231 tests / 103 suites | `c8f6f044c683` | 59.6 s | start 5.4 / med 9.2 / max 10.5 |
| `harness:ios` | **PASS** | 622 tests / 30 suites + isolated 6 tests / 3 suites | `c8f6f044c683` (harness:ios digest) | 14 m 34 s | start 8.2 / med 5.4 / max 17.5 |
| `harness:android` | **FAIL** (completed: 2 of 31 units re-run, attempt 1) | 3 failed of 39 tests / 2 suites | `c8f6f044c683` (harness:android digest) | 51.3 s + full run 18 m 35 s | start 3.5 / med 3.7 / max 3.8 |
| `real-input:ios` | **PASS** (completed: 1 of 53 units re-run, attempt 1; from `merge/button-group-border`) | — | `6bb466dc8146` (real-input:ios digest) | 6 m 51 s + full run 41 m 40 s | start 3.0 / med 6.5 / max 13.7 |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Form.harness` | **PASS** | 27 tests / 1 suites | `c8f6f044c683` (harness:android digest) | 29.0 s | start 17.4 / med 15.0 / max 17.4 |
| `harness:android:reserves%20a%20band` | stale | — | 1ab6fb8e4346 (not this tree) | 1.3 s | start 4.0 / med 4.0 / max 4.0 |
| `harness:android:SearchField.harness` | **FAIL** | 2 failed of 18 tests / 1 suites | `c8f6f044c683` (harness:android digest) | 30.2 s | start 15.2 / med 12.1 / max 15.2 |
| `harness:android:TextField.harness` | **FAIL** | 1 failed of 21 tests / 1 suites | `c8f6f044c683` (harness:android digest) | 29.4 s | start 3.2 / med 3.0 / max 3.2 |
| `harness:ios:SearchField.harness` | **PASS** | 18 tests / 1 suites | `c8f6f044c683` (harness:ios digest) | 36.3 s | start 9.8 / med 9.9 / max 10.4 |

`need --for review`: `check`, `harness:ios`, `harness:android`. No `real-input` gate was run here.
`bun run task-ready` is clean on every check except the red `harness:android` row, which is the
question below.

## Red proofs

- `example/__tests__/Form.harness.tsx` "reserves a band with its padding and draws into a layer as
  tall as its section (E2)" -> `val height = (model.boxH - 21f)` in `intoSectionBox`, a layer 8 dp
  shorter than its section -> `question 2: the section draws into a layer 288.4 dp tall while the
  section itself is 296.4 dp ... (out by 8.0 dp)` — CI's numbers.
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

- Harness: three submit-then-blur units are red on `emulator-5570` — the question below. The Form
  and clear cases pass in the same runs.

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
