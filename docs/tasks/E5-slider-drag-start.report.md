# E5 — Slider: a real drag start on Android, and the real-input drag flake

**Branch:** `task/E5-slider-drag-start` (from `main` at `bb47a604`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `E5-onhkl` (pair-a — iPhone 17 / iOS 27.0 and `emulator-5574` (`nitroui_a`, API 35,
pixel_9) / Metro `8295`)
**Fix round 1 lease:** `E5-2fe1c` (pair-b — iPhone Air / iOS 27.0 and `emulator-5570`
(`nitroui_b`, API 35, pixel_9) / Metro `8293`).

## Summary

**Android opens a Slider gesture at the touch, not at the first value change.**
`HybridNitroUiSlider.kt` gained a `sliderPressWatcher` modifier: `awaitFirstDown(Initial)`
calls `SliderModel.beginDrag()`, and the release — read on the `Final` pass, behind the pass
where Material 3 calls `onValueChangeFinished` — calls the idempotent `endDrag()`. Of the two
candidates, `interactionSource` is the one I did **not** take: `DragInteraction.Start` and
`SliderState.isDragging` both appear only past the touch slop, and `PressInteraction.Press`
arrives through a collector coroutine, so its order against the control's own end callback is
a dispatcher detail. Pointer-pass order is defined, which is what the start's "before any
`onValueChange` of its own gesture" and the end's "after" need. A stream a scrolling parent
steals is still closed (`GestureCancellationException` → `endDrag()`), an unmount or recycle
stays silent, and a value arriving with no touch behind it still opens its own drag — so the
screen-reader and keyboard step keep the same triple. iOS is unchanged: SwiftUI's
`onEditingChanged` decides. `slider.md` has the event rows, a "What counts as a gesture"
table and the Limits to match.

**The drag flake was the wait, not the threshold.** `hosted-slider` asked "is the drag over?"
of the *value* echo — "has the number stopped moving for 1200 ms" — and a drag that is merely
slow answers that exactly like a finished one. `adb shell input swipe` returns once the gesture
is *injected*, and every poll is a `uiautomator dump` that walks the tree on the app's own UI
thread, part of what stops the gesture being drawn. E4 read `0.43` of a drag aimed at `0.9`
while every other control in the run passed; across the 35 days the log store keeps, that line
stopped short in two runs — both E4's — against 79 reads landing between `0.84` and `0.89`. A
pause read as an ending. The control answers now: the hosted Slider echoes
`start=N complete=M`, and `dragAndSettle` waits for both phases of *this* gesture before
reading the value, at 700 ms rather than 300. A drag whose end never arrives is injected once
more and counted in the run's retry total the way a retried press is. Thresholds are untouched.
A third drag is injected stretched out — samples 1400 ms apart, wider than the old settle
needed to be convinced — so the stopwatch regression goes red on an idle machine.


## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1826 tests / 72 suites | `58c03193364b` | 2 m 42 s | start 10.0 / med 8.6 / max 10.6 |
| `harness:ios` | **PASS** | 449 tests / 25 suites + isolated 4 tests / 2 suites | `58c03193364b` (ios tree) | 13 m 00 s | start 5.0 / med 6.8 / max 26.5 |
| `harness:android` | **PASS** | 503 tests / 25 suites + isolated 4 tests / 2 suites | `58c03193364b` (android tree) | 15 m 28 s | start 8.0 / med 9.2 / max 98.7 |
| `real-input:ios` | stale | — | 102b3f7923ed (not this tree) | 27 m 11 s | start 4.3 / med 5.8 / max 15.8 |
| `real-input:android` | **PASS** | — | `58c03193364b` (android tree) | 43 m 20 s | start 12.5 / med 5.1 / max 59.5 |
| `harness:android:Slider` | stale | 29 tests / 1 suites | d8f6063dd0ca (not this tree) | 32.8 s | start 6.0 / med 5.9 / max 6.1 |
| `harness:android:Slider:--background` | stale | — | 6c1a1d4ed8a4 (not this tree) | 0.6 s | start 10.1 / med 10.1 / max 10.1 |
| `real-input:android:--control:hosted-slider` | stale | — | cc79f8feb27e (not this tree) | 8 m 44 s | start 6.1 / med 4.7 / max 9.2 |
| `real-input:ios:--control:search-field` | stale | — | 102b3f7923ed (not this tree) | 7 m 40 s | start 4.9 / med 5.7 / max 8.5 |

The table is fix round 1's, regenerated for the tree this round ships. The four green rows
above are the bar; `harness:android:Slider` is the row `gate.mjs table` keeps for the name,
and under it this round ran four diagnostic runs, none of which is the bar: three that went
red as red proofs (trees `89039c30ce9d`, `42c59a2c89f1`, `1fc79af67943`, listed under Red
proofs / Fix round 1) and one that logged which way the watcher's loop leaves when the
control goes inert (`d8f6063dd0ca`, whose Kotlin probe was reverted before this commit). The
last three rows are round 1's diagnostics, unchanged.

`real-input:ios` shows stale, and that is the honest state rather than a gap: the fix round's
probe stub went into `HybridNitroUiSlider.swift`, so round 1's green run is a tree behind.
`harness:ios` is green on the current iOS tree and `real-input:ios` injects no HID touch that
this round's Android change could disturb, so the re-run belongs to merge — where
`real-input:android` was re-run here anyway, at 43 m. `need --for review` reads the five rows
above the diagnostics.


`need --for review`: need: review is satisfied on this code tree.

### Re-runs, and what each one lost

Both device gates needed a second run, and neither loss was this task's code.

- `real-input:android` (first run, 02:53) died at `hosted-date-picker` with *"tapping the
  Host tab did not bring up its screen"* — `goToScreen` polled for the arrival echo, never
  saw it, and took the run down. Every Slider line in that run was already green, including
  `a drag the machine stretches out … (0.11 -> 0.83)`. `load1` at the failure was 18.19 with
  E4's own `real-input:android` on the other pair in the same minutes.
- `real-input:ios` failed `testRealInputSearchField` twice, and a targeted
  `--control search-field` probe failed a third time, always on the same line:
  `("frozen: 1 edits refused") is not equal to ("frozen: 2 edits refused")`. E3's iOS run
  lost the *identical* assertion on `testRealInputTextField` and went green on a re-run, and
  E4's iOS run on the other pair passed both an hour earlier. Nothing in this diff reaches a
  text field. The clean run above — on a machine with the other task's gate finished —
  passed it in 52.5 s.

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
- `example/__tests__/Slider.harness.tsx` — the two Android-only tests, the held-press write test moved to the middle of the track and given a `finally`, and `pressInBox` (a point on a control's own box, at its own height).
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
- The two iOS `frozen: N edits refused` checks (`RealInputTests.swift:3721` TextField,
  `:3873` SearchField) assume XCUITest's `typeText("xy")` delivers one text change per
  character; two characters can arrive as one edit, and then the count is 1 forever —
  `readUntil` has nothing left to wait for. Same shape as the Android drag gap this task
  fixed: the input is never retried, although the suite learned that lesson for taps
  (`tapUntilEcho`).
- `gate.mjs` inherits the lease from the shell's environment, so a fresh shell that forgot to
  source `lease.mjs acquire`'s env file spends a ledger row on `neither IOS_UDID nor
  IOS_SIM_UDID is set`. It already knows the branch and the task id; it could look the live
  lease up itself.
- `gate.mjs`: `--background` written *after* the `--` filter separator is swallowed into the gate name and handed to jest as a CLI option; the mangled run is unwaitable. It should reject a flag after `--`.
- `react-native-harness` has no drag primitive (press/pressAt/longPressAt only), so a Slider drag in the harness is a held press; the repo-patched `simulateLongPress` is docs/upstream.md H11.
- `nuiTestDrag` drives `SliderModel` directly and never enters Compose, though its doc comment reads as a real drag.
- Any harness test that throws mid-`longPressAt` leaks the injected finger into the next test; the other suites that hold presses (`HostControls`, `Menu`, …) deserve the same `finally` this one now has.
- Another task's shell read `logcat` from this task's leased `emulator-5574` through the *default* adb server. Read-only, but AGENTS.md's serial-isolation rule assumes every caller passes `-s`.
- iOS "press without moving the thumb" stays unmeasured (row 3 of the new table): the harness iOS touch has no HID event behind it, so `real-input:ios` is the only evidence there.
- `hosted-slider`'s `dragAndSettle` could assert that `start` advanced by exactly the number of injections it made: a gesture that reports twice today still passes, because the wait only asks whether a complete has arrived.
- `await injecting` in `scripts/real-input/android.mjs` has no timeout: an `adb shell input` that never returns hangs the run rather than failing it.
- `sliderPressWatcher` is a `@Composable` modifier factory, so it re-runs on every `SliderTrack` recomposition; a `Modifier.Node` would install its pointer input once and read the model from the node.
- A `DragDelta` Material 3 queued before a recycle can be drained after `prepareForRecycle` has reset the model, which would apply one gesture's value to its next owner. Older than E5, and the generation guard on `nuiTestDrag` does not cover M3's own channel.

## Fix round 1

**Corrects the Summary and `slider.md`:** the `Final` pass is *first* to see a release, not
last — foundation's `DragGestureNode` queues `DragStarted`/`DragDelta`/`DragStopped` on a
channel a later coroutine drains, so the watcher's `endDrag()` always beat Material 3. It now
reads `SliderState.isDragging` at the release and ends only a drag M3 never took, one plain
`Dispatchers.Main` hop behind that channel, covering slop crossed in the release's batch.
Going inert mid-drag leaves a drag nobody can end (measured: the loop goes by cancellation, a
detached `DraggableNode` reaching no end action), so `afterUpdate` ends it, reported.
`gestureReported` also requires `completes >= starts`. The steal comment no longer promises a
`GestureCancellationException`; `fastAny` replaces `changes.any {}`. A 4-mode
`nuiTestPointerStream` probe drives batching, `ACTION_CANCEL`, two fingers, same-batch slop.

Red proofs (`test -> mutation -> line`):

- batched probe -> round-1 watcher -> `expected [s,c,s,v,c] to equal [s,v,c]`; two fingers, same run -> `expected 2 to be 1`.
- `closes the drag when the control goes inert mid-press` -> `afterUpdate` guard removed -> `expected [s] to equal [s,c]`.
- `closes a stream that is taken over` -> launched `endDrag()` removed -> same line.
- `refuses a start ahead of every complete on the screen` -> `completes >= starts` removed -> `Received: true`.

## Merge round

`origin/main` merged into `task/E5-merge` (E4 Progress, FIX4 icons, E3, X20 — 37 commits). One
file overlapped, the generated API report; `bun install`'s codegen plus `bun run api-extractor`
settle it, and nitrogen, registry, manifest and lock checks then pass with nothing committed —
no generated drift. Both apps built from `459e2c830a8a`; lease `E5-5qnlx` (pair-a) after a
25-minute queue behind X21 and G19.

Four gates green. `real-input:ios` is not, and the sanctioned re-run did not help: both runs,
and a targeted `--control text-field` probe after them, fail the same line —
`RealInputTests.swift:3721`, `frozen: 1 edits refused` where the check wants `2`. That is X21
item 1, seen in X19, E2, E3, G16 and E5; X21's fix (one keystroke per witness, plus a retry —
`8fcdd714`) is in review, not on `main`, so this branch cannot go green while `main` carries the
check as written. E5's iOS diff is Slider's hybrid and its generated spec: nothing reaches a
`UITextField`. (`real-input:ios:text-field`, 0.2 s, is my own filter written without
`--control`, recorded under its own name.)

### Merge gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1837 tests / 74 suites | `459e2c830a8a` | 3 m 16 s | start 9.9 / med 66.3 / max 183.6 |
| `harness:ios` | **PASS** | 454 tests / 25 suites + isolated 4 tests / 2 suites | `459e2c830a8a` (ios tree) | 10 m 57 s | start 9.1 / med 5.9 / max 19.8 |
| `harness:android` | **PASS** | 510 tests / 25 suites + isolated 4 tests / 2 suites | `459e2c830a8a` (android tree) | 15 m 27 s | start 34.3 / med 7.4 / max 34.3 |
| `real-input:ios` | **FAIL** | — | `459e2c830a8a` (ios tree) | 26 m 14 s | start 6.0 / med 4.5 / max 22.0 |
| `real-input:android` | **PASS** | — | `459e2c830a8a` (android tree) | 43 m 55 s | start 5.3 / med 5.8 / max 218.1 |
| `real-input:ios:--control:text-field` | **FAIL** | — | `459e2c830a8a` (ios tree) | 7 m 22 s | start 4.6 / med 10.1 / max 30.5 |
| `real-input:ios:text-field` | **FAIL** | — | `459e2c830a8a` (ios tree) | 0.2 s | start 5.0 / med 5.0 / max 5.0 |

### need --for merge

```
need: merge against .gates/task/E5-merge.jsonl; code diff base 2ed9415 touches ios + android
  ✓ check — green
  ✓ harness:ios — green
  ✓ harness:android — green
  ✗ real-input:ios — red (exit 1 on tree 459e2c830a8a, task/E5-merge/real-input+ios-2026-11-07T10-40-20.187Z.log)
  ✓ real-input:android — green
  note: no check line was borrowed for this tree: no other ledger has a check line on tree 841f7788404d
  note: treated as both platforms (outside the known prefixes): example/__tests__/HostControls.harness.tsx, example/__tests__/Slider.harness.tsx, example/src/HostScreen.tsx, example/src/SliderScreen.tsx, scripts/real-input/android.mjs, scripts/real-input/report.mjs, …
need: 1 gate(s) missing for merge: real-input:ios
```

## Questions for orchestrator

`real-input:ios` cannot go green on this tree, and the choice is yours, not mine.

- **Land X21 first, then re-run this round (recommended).** X21's `8fcdd714` rewrites exactly
  the failing check — one keystroke per witness, plus the retry the check never had. Merging
  their branch moves the iOS tree, so budget a fresh `real-input:ios` and `harness:ios` at
  minimum.
- **Merge E5 with this line documented.** `need --for merge` stays unsatisfied on
  `real-input:ios`. The failure is X21 item 1, hit by X19, E2, E3, G16 and E5; three runs here
  (26 m, 26 m and a 7 m targeted probe) failed one assertion at `RealInputTests.swift:3721`.
- **Have me relax the check instead.** It sits in `RealInputTests.swift`, which X21 is editing
  right now — two branches in that file is how the next conflict starts, so I did not.
