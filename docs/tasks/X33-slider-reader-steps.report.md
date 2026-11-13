# X33 — Slider: screen-reader steps compare the shown value, and the step test stops flaking

**Branch:** `task/X33-slider-reader-steps` (from `main` at `a16f7b8d`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X33-nquip` (pair-a: `emulator-5574` / sim `49D5024D-967B-4B93-ACF6-F73BA0A19E9F`, Metro `8295`)

## Summary

Two defects, one symptom.

**The comparison (Android).** A `setProgress` target is computed by the
accessibility delegate from the progress this control's semantics node publishes, and that node
carries the progress in a `Float`. `SliderModel.accessibilityStepToward` weighed it against the
`Double` the model holds, so on any grid whose stops are not exact in binary the two are different
numbers: `0.3` through a `Float` is 0.30000001192092896 — a step *up* from what is on screen — and
`0.7` comes back 0.699999988079071, a step *down*. A reader asking for the value it was shown got a
whole gesture it never asked for. Over a narrow window at a large offset — epoch milliseconds, the
everyday shape — a `Float` at 1e9 is 64 apart, so the reader's stride lands back on the published
progress and every press up answered the previous value. The comparison now makes the round-trip the node makes
(`asPublishedProgress`), which can only move the equality branch — a target the float can still
stride steps one stop of this Slider's own grid. That is X32's Stepper rule completed here, and
X21's rule — the direction belongs to the reader's tree — extended to the space that tree carries.

**The delivery race (the test).** `walkTo` computed `index = events.complete.length - 1` *after* the
press. While that press's release was still in the Nitro queue the assertion compared the array
against a prefix of `expected` of its own length — one that cannot fail — so the lag stayed invisible
until the next bare `toEqual`, which is `expected [3, 6, 9] to deeply equal [3, 6, 9, 10]`. It counts the press before performing it and waits for that press's own release;
nothing was loosened: every step still asserts the whole array, its values and its starts.

**iOS has no equivalent problem** — `accessibilityStep(up:)` is handed a direction, never a number
to compare, and its announced value is a `String`. The harness records the difference: the same
large-offset fixture steps on iOS and refuses on Android.

Fifteen committed failure excerpts name this test, and 14 of them are an unwanted step (`[3, 6, 3]`,
`[3, 6, 9, 6]`, `expected 3 to be +0`), not a lost event; one is a lost event. Both families are
this round's, and every one predates X21's `71e6c615` — newest excerpt 09:11Z, the fix landed
09:39Z — which is why two bugs read as one flake.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2093 tests / 88 suites | `6962e42f3afe` | 2 m 47 s | start 9.4 / med 22.7 / max 41.4 |
| `harness:ios` | **PASS** | 631 tests / 32 suites + isolated 6 tests / 3 suites | `6962e42f3afe` (ios tree) | 15 m 26 s | start 45.4 / med 10.6 / max 45.4 |
| `harness:android` | **PASS** | 687 tests / 32 suites + isolated 6 tests / 3 suites | `6962e42f3afe` (android tree) | 18 m 59 s | start 17.0 / med 8.7 / max 27.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `6962e42f3afe` (android tree) | 72 m 14 s | start 14.5 / med 5.0 / max 127.1 |
| `harness:android:Slider` | **PASS** | 33 tests / 1 suites | `6962e42f3afe` (android tree) | 31.5 s | start 8.0 / med 7.2 / max 8.0 |

`need --for review`: `need: review is satisfied on this code tree.` (`check`, `harness:ios` and
`harness:android` green; the only both-platform path in the diff is
`example/__tests__/Slider.harness.tsx`). `real-input:android` is in because the brief asks for it.
`real-input:ios` is deliberately not run: no iOS code changed — the iOS half of this round is the
harness's other branch of one assertion, and the merge stage is where that gate belongs.

## Red proofs

Each mutation is one line in `accessibilityStepToward`, applied to
`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSlider.kt` and undone with
`git checkout` before the next one. The JVM ones ran through `scripts/native-tests-android.sh
--tests com.margelo.nitro.nitroui.SliderModelTest` (20 tests in that class, 5 red, log
`/tmp/x33-jvm-preX33.log`); the device ones are filtered `harness:android -- Slider` runs whose logs
are in the gate log store under this branch.

- `aReaderAskingForThePublishedProgressMovesNothing` -> drop the round-trip
  (`val shown = publishedProgress`) -> `java.lang.AssertionError at SliderModelTest.kt:259`
- `aReaderAskingForThePublishedProgressDoesNotStepDownEither` -> same -> `SliderModelTest.kt:278`
- `theSameTargetIsAStepWhenItIsNotTheValueOnScreen` -> same -> `SliderModelTest.kt:309`
- `aReaderAskingForWhatAStaleTreeStillShowsMovesNothing` -> same -> `SliderModelTest.kt:334`
- `aStrideTooSmallForTheFloatIsNotADirection` -> same -> `SliderModelTest.kt:368`
- `theFloatRoundTripIsWhatMakesThoseFixturesMeanAnything` -> same -> **green on purpose**: it
  asserts `0.3f > 0.3` and `0.7f < 0.7`, the two facts those five rest on, so a refactor that made a
  tenth exact cannot turn them into free passes.
- `Slider › does not step when a reader asks for the value it was shown` -> same mutation, on the
  device -> `expected [ 1000000010 ] to deeply equal []`, red in 11 of 11 filtered runs at load1
  peaks 7.9 to 95.8. That is the deterministic half of the old symptom on the platform path: the
  press asks for `1000000010`, the node publishes `1000000000`, and the control answered with the
  value before it. The same test's iOS branch — the press *does* step there — passed inside
  `harness:ios`.
- `Slider › steps up twice when a reader presses again before the a11y tree catches up` ->
  `val shown = from` (X21's rule dropped as well) -> `Wanted 2 onSlidingComplete(s), have 1 after
  5000ms (start=[0] change=[3] complete=[3])`
- `Slider › steps up three times when a reader presses twice more before the a11y tree catches up`
  -> same -> `Wanted 3 onSlidingComplete(s), have 1 after 5000ms (start=[0] change=[3]
  complete=[3])`. These two are the race on purpose: three presses posted in one JS turn with real
  timing, so all three aim at the progress the node published before any of them ran.
- `Slider › steps a tenths grid the way the node publishes it` -> the tempting wrong fix, a
  tolerance instead of an equality (`abs(target - publishedProgress) < 0.2`) -> `Wanted 1
  onSlidingComplete(s), have 0 after 5000ms (start=[] change=[] complete=[])`: a band wide enough to
  hide the float noise swallows the press. The large-offset case cannot judge a band — it refuses
  either way — so this is the case that proves the guard is an equality test and not a tolerance.
- `Slider › steps to the next legal value when a screen reader asks` -> **no mutation was run
  against the walk's own assertion, because the pre-fix form cannot be reddened by the thing it
  hides**: with a press still in flight, `index + 1` equals `events.complete.length` by
  construction, so it compares the array against a prefix of `expected` of exactly its own length.
  The red evidence for the delivery lag is the recorded flake itself, seen again on this code at
  load1 95.8: `expected [ 3, 6, 9 ] to deeply equal [ 3, 6, 9, 10 ]`, alongside the offset case in
  the same run (`Tests: 2 failed, 31 passed, 33 total`). That walk is on `0..10 step 3`, exact in a
  `Float`, so the mutation that run carried cannot move its result — the two causes are independent.

## Flake counts

`gate.mjs harness:android -- Slider`, one lease, as recorded in the ledger:

| Code under test | Runs | Red | Load1 peaks | What was red |
| --- | --- | --- | --- | --- |
| pre-X33 comparison | 11 | 11 | 7.9-95.8 | the offset case every run; one run also lost the walk's fourth release |
| + this round's fix | 7 | 0 | 29.7-75.3 | — |
| + the strict `walkTo` wait | 5 | 0 | 8.0-17.8 | — |

Then the whole platform suites, both green: `harness:android` 687 tests and `harness:ios` 631. The
three 1-second `harness:android:Slider` failures at 08:26Z are the stamp guard refusing a
deliberately reverted harness file, not test results; `real-input:android` ran the whole thing
again afterwards under a load1 peak of 127.1 and passed.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSlider.kt`: `asPublishedProgress`,
  the comparison in `accessibilityStepToward`, and the two comments that now say which number the
  direction is weighed against.
- `android/src/test/java/com/margelo/nitro/nitroui/SliderModelTest.kt`: six JVM cases — both sides
  of the rounding, the stale-tree case, the stride too fine for the float, and the witness that
  keeps the two fixtures honest.
- `example/__tests__/Slider.harness.tsx`: three device cases (a tenths grid, a three-press burst,
  the large-offset press with its iOS counterpart), the per-press report log, and the walk's
  press-count wait.
- `docs/components/slider.md`: the reader rule in the Android accessibility bullet, and a Limits
  bullet for a stride the float cannot carry.
- `.changeset/slider-reader-steps-float.md`: patch entry.
- `docs/tasks/FOLLOWUPS.md`: line 56 closed, the Slider part.

## Follow-ups

- `check` cannot be run from a leased shell: `scripts/__tests__/bench-baseline-merge.test.js`
  spawns `run.mjs` with the ambient environment, so the lease's `EMULATOR_PORT` leaks in and the
  assertion about "No attached emulator" reads a lease error instead (X33's first `check`, red for
  that alone). Unit tests should scrub the device environment.
- `scripts/__tests__/lease-queue.test.js` "hands a freed pair to the older ticket" reads `leases`
  right after serving X24, before the waiting X25's next poll can be ruled out: red on X33's second
  `check` (load1 27.5), green on the third (load1 41.4). A timer, not a rule.
- The a11y probe's comment says the stride divides the range "by the tick count plus the two ends"
  while the code divides by `steps + 1` — one interval. The arithmetic looks right and the sentence
  is the wrong wording; whoever next owns the probe should fix the sentence, not the number.
- `asPublishedProgress` makes the comparison honest but cannot give a reader a stride a `Float`
  cannot hold: a `1000000000..1000000200 step 10` Slider is still unstridable, and now refuses
  instead of stepping back. Normalising the progress before Compose sees it is the deeper fix, and
  that is a design decision rather than this task's.
- The reader-space question applies to any control whose platform hands the model a number to
  compare. X32 covered the Stepper; nothing else in this repo does that today.
