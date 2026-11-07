# E5 — Slider: a real drag start on Android, and the real-input drag flake

**Branch:** `task/E5-slider-drag-start` (from `main` at `bb47a604`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `E5-onhkl` (`emulator-5574` + `49D5024D-967B-4B93-ACF6-F73BA0A19E9F` / Metro `8295`)

## Summary

**Android opens a Slider gesture at the touch, not at the first value change.**
`HybridNitroUiSlider.kt` gained a `sliderPressWatcher` modifier: `awaitFirstDown(Initial)`
calls `SliderModel.beginDrag()`, and the release — read on the `Final` pass, behind the pass
where Material 3 calls `onValueChangeFinished` — calls the idempotent `endDrag()`. Of the two
candidates, `interactionSource` is the one I did **not** take:
`DragInteraction.Start` and `SliderState.isDragging` both appear only past the touch slop, and
`PressInteraction.Press` arrives through a collector coroutine, so its order against the
control's own end callback is a dispatcher detail. The pointer-pass order is defined, which is
what the start's "before any `onValueChange` of its own gesture" and the end's "after" need. A
stream a scrolling parent steals is still closed (`GestureCancellationException` → `endDrag()`),
an unmount or recycle stays silent, and a value arriving with no touch behind it still opens its
own drag — so the screen-reader and keyboard step keep the same triple. iOS is unchanged:
SwiftUI's `onEditingChanged` decides. `slider.md` has a "What counts as a gesture" table and its
stated Limits.

**The drag flake was the wait, not the threshold.** `hosted-slider` asked "is the drag over?"
of the *value* echo — "has the number stopped moving for 1200 ms" — and a drag that is merely
slow answers that exactly like a finished one. `adb shell input swipe` returns once the gesture
is *injected*, and every poll is a `uiautomator dump` that walks the tree on the app's own UI
thread, part of what stops the gesture being drawn. E4 read `0.43` of a drag aimed at `0.9`
while every other control in the run passed. Across the 35 days of logs the store keeps, that
drag line was read 81 times and stopped short in two runs — both E4's, `0.4 -> 0.43` out and
`0.84 -> 0.83` back — against 79 reads landing between `0.84` and `0.89`. The brief's "several
branches" reaches further back than the store does. A pause read as an ending. The control
answers now: the hosted
Slider echoes `start=N complete=M`, and `dragAndSettle` waits for both phases of *this* gesture
before reading the value, at 700 ms rather than 300. A drag whose end never arrives is injected
once more and counted in the run's retry total the way a retried press is. Thresholds are
untouched. A third drag is injected stretched out — samples 1400 ms apart, wider than the old
settle needed to be convinced — so the stopwatch regression goes red on an idle machine.

Both halves are tested on-device and off it; the red proofs below say how each was shown to
bite.

## Gates

GATE_TABLE_PLACEHOLDER

`need --for review`: NEED_PLACEHOLDER

## Red proofs

Each one re-run against the code in this branch, not an earlier draft of it.

- `Slider.harness.tsx` "reports a gesture for a touch that never moves the thumb, in drag order" -> `sliderPressWatcher` reduced to `return this` -> `expected [] to deeply equal [ 's', 'c' ]`.
- `Slider.harness.tsx` "reconciles a write from JS while a real finger is down" -> same mutation -> `expected [ 's', 'v', 'c' ] to deeply equal [ 's' ]`: with the start inferred from the value, the down reports nothing and all three phases arrive at the release, so the gesture is never open-and-empty.
- `real-input-gesture-echo.test.js` -> `gestureCounts` returns `0` for a phase it cannot see -> `✕ reports a phase it cannot see as null, not as zero` (`Received: 0`).
- same file -> the named-number regex replaced by "the first number in the text" -> `✕ reads both phases out of the order the echo draws them in` and `✕ does not read a digit out of a neighbouring number` (`Received: 9`).
- same file -> `gestureReported`'s `&&` relaxed to `||` -> `✕ refuses a complete with no start after it`, `✕ refuses a start that has not been closed yet` and `✕ counts a first gesture against an echo that read zero`.
- `real-input:android --control hosted-slider` -> the pre-E5 wait (settle the value, no gesture echo) restored, drag injected stretched out -> `✗ a drag the machine stretches out still lands where the finger left it (0.12 -> 0.12)`; the two ordinary drags in that same run stayed green.
- `real-input:android` `slider:` -> the watcher off again -> `✗ two still presses each report a gesture (start 2 -> 3, complete 2 -> 3)` and `✗ a touch with no value change in it reads as "SC" (order=SVCSVC)`; the `order=SVC`/`SVCSVC` drag lines stayed green.
- Note, not a proof: with both tasks on devices at once, E4's run on pair-b failed exactly
  the line E5 fixes (`dragging back moves a hosted Slider the other way (0.84 -> 0.83)`) while
  E5's run on pair-a passed it and the stretched drag after it (`0.11 -> 0.83`). Same machine,
  same minute, the fix on one side and not the other.
- Note, not a proof: that first mutation run also lost `steps to the next legal value when a screen reader asks` (`expected [ 3, 6, 9, 10, 9 ] to deeply equal [ 3, 6, 9, 10 ]`) — a failing hold leaks the injected finger into the next test. The held press now releases in a `finally`, so one red test stays one red test.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSlider.kt` — `sliderPressWatcher`: `beginDrag()` on the `Initial` down, the idempotent `endDrag()` on the `Final` up and on a stream a parent took; not installed when disabled. iOS untouched.
- `docs/components/slider.md` — the two event-table rows, the new "What counts as a gesture" section with the two Material-3 measurements, and the stale "Android start events are inferred" Limits row replaced.
- `example/__tests__/Slider.harness.tsx` — the two Android-only tests, and `pressInBox` (the middle of a control's own box, at its own height).
- `example/src/SliderScreen.tsx` — `slider-phase-order`, the three phases in the order the app was told them (`order=SVC`).
- `example/src/HostScreen.tsx` — `host-slider-gesture` (`start=N complete=M`) on the hosted Slider.
- `scripts/real-input/screens.mjs` — the two echo ids, plus `gestureCounts` and `gestureReported`: the parse of a gesture echo and the rule applied to it, out of the runner so both platforms and a unit test can share them.
- `scripts/real-input/android.mjs` — `dragAndSettle` (wait for the control's gesture end, then settle; one retry, counted), `drag` with an optional stretched injection, `waitForGestureEnd` polled at 700 ms, the two still presses in `slider:`, and the stretched third drag in `hosted-slider:`.
- `scripts/real-input/report.mjs` — the retry count is now "input sequence(s)", because drags are counted in it.
- `scripts/__tests__/real-input-gesture-echo.test.js` — new: 10 tests for the echo parse and the rule, with fixtures that are not the right answer.

## Follow-ups

- `gate.mjs`'s failure-time device context reported `(no nitroui.example process on
  emulator-5574)` for an app that was alive — E4's context said the same mid-run. The `pidof`
  probe asks the default adb server, not the run's private one, so a reader is told the app
  died when it did not.
- `goToScreen` aborts the whole run when one echo is missing after a tab tap. That, not
  anything in E5, ended this task's first `real-input:android` run: it failed at
  `hosted-date-picker` with "tapping the Host tab did not bring up its screen" at `load1`
  18.19, with every Slider line green. The tab reveal re-looks; the arrival check does not.
- `gate.mjs`: `--background` written *after* the `--` filter separator is swallowed into the gate name and handed to jest as a CLI option; the mangled run is unwaitable. It should reject a flag after `--`.
- `react-native-harness` has no drag primitive (press/pressAt/longPressAt only), so a Slider drag in the harness is a held press; the repo-patched `simulateLongPress` is docs/upstream.md H11.
- `nuiTestDrag` drives `SliderModel` directly and never enters Compose, though its doc comment reads as a real drag.
- Any harness test that throws mid-`longPressAt` leaks the injected finger into the next test; the other suites that hold presses (`HostControls`, `Menu`, …) deserve the same `finally` this one now has.
- Another task's shell read `logcat` from this task's leased `emulator-5574` through the *default* adb server. Read-only, but AGENTS.md's serial-isolation rule assumes every caller passes `-s`.
- iOS "press without moving the thumb" stays unmeasured (row 3 of the new table): the harness iOS touch has no HID event behind it, so `real-input:ios` is the only evidence there.
