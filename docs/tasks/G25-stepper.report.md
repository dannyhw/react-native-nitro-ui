# G25 — Stepper

**Branch:** `task/G25-stepper` (from `main` at `9da86a2b`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G25-ztv7a` (`emulator-5574` / iPhone 17 · Metro `8295`)

## Summary

`Stepper` ships: two halves that move a number by one `step`, and nothing else. It draws no
number, so the value goes to the app's own `Text` — which is why `accessibilityLabel` is the
one prop the control cannot infer.

**Two halves, per platform.** iOS hosts SwiftUI's own `Stepper` with its label hidden, which
brings hold-to-repeat and makes every repeat one step and one event. Android has no stepper
control, so its half is two Material 3 tonal icon buttons 8 dp apart, each disabled at its own
bound; a tap steps once. `docs/components/stepper.md` says so.

**Value rules are Slider's, called rather than copied** — `NitroUiSliderValue.quantize` and
`.stepped` on both platforms, so `0.1` cannot mean two things in one library. The grid is
measured from `minimumValue`, `maximumValue` is always reachable, and an inverted range
clamps rather than trapping (`ClosedRange(a...b)` and `coerceIn` both throw on one).

**A reader meets one adjustable value.** iOS vends its own `.adjustable` element, because
SwiftUI's stepper hands VoiceOver two buttons. Android merges the row into one node that
publishes `ProgressBarRangeInfo` — with `steps` counted on this control's own grid — and a
`setProgress` action, and clears the two buttons' semantics away.

**Two decisions worth reading before the diff.**

- Android's reader node is actionable only through Compose's *custom* `SetProgress`, which a
  uiautomator dump cannot print. Rather than widen the a11y rule, the sweep carries a fifth
  Android debt row for it (the Slider's and SegmentedControl's limitation, same FOLLOWUPS
  question), and the device suite performs `SetProgress` and asserts the step. The cell
  records the missing flag, not a missing behaviour.
- The shared "carries its value" assertion used to be `toContain('4')`, which this fixture's
  own `range=…@4/steps=4` and `traits=4096` satisfy for free. Android's probe now reports the
  value the *node* publishes, and both platforms are read as `value=4`.

Both halves refuse a request for the value already displayed, which is what makes "a half at
a bound produces no event at all" true for a finger, a reader and a test seam alike. Prop
setters store and apply once in `afterUpdate()`; the hosting view is built at init and never
rebuilt; `RecyclableView`'s reset re-arms the one-shot default; controlled values go through
the event-count handshake. The iOS box is 94×32 pt, measured on the iOS 26/27
runtimes this pool has; no older runtime is installed here, so one box is declared for every
version, documented as such.

## Gates

Round 1 ran on code tree `197834c30d3b`: `check` green in 2 m 45 s (1940 tests / 81 suites),
`harness:ios` green in 13 m 49 s (538 tests / 28 suites + isolated 6 tests / 3 suites),
`harness:android` green in 17 m 18 s (594 tests / 28 suites + isolated 6 tests / 3 suites), both
`real-input` gates missing. The only table in this report is the generated one under
"Gates (fix round 1)"; every line of both rounds, with durations and load, is
`docs/tasks/G25/gates.jsonl`.

`need --for review`: satisfied — `check`, `harness:ios` and `harness:android` are green on this code tree; the two `real-input` gates and the full harness-plus-real-input sweep are merge's, and are not claimed here.

## Red proofs

- `Stepper > snaps a value outside the range back into it` -> `quantize` = clamp only ->
  `"offgrid" never drew displayed=6 - it reports "displayed=7;…"` (Android and iOS)
- `Stepper > steps 0.1 without float drift, and reaches the maximum` -> `quantize` = clamp
  only -> `the maximum is a stop of this grid, so the increment half is disabled at it:
  expected '1' to be '0'`
- `Stepper > disables the half at a bound and reports nothing from it` -> `canStep(up)` =
  `enabled` -> `at the minimum the decrement half is disabled and the increment half is
  live: expected '1/1' to be '1/0'`
- `Stepper > disables the half at a bound and reports nothing from it` -> `userStep` loses
  the "already displayed" refusal -> `a half that is disabled at a bound must produce no
  event at all: expected ['at-min:0', 'at-max:2', …(1)] to deeply equal
  ['bounds-barrier:1']` (Android and iOS)
- `Stepper > sends nothing while disabled, and follows the flag back` -> `step()` loses
  `if (!enabled) return false` -> `expected ['off:6', 'off:5', 'off-barrier:6'] to deeply
  equal ['off-barrier:6']` (Android and iOS)
- `Stepper > sends nothing while disabled, and follows the flag back` -> the semantics block
  never calls `disabled()` -> `a disabled stepper announces itself as disabled: expected
  'range=0..10@5/steps=9,clickable=0,dis…' to contain 'disabled=true'`; `.notEnabled` dropped
  on iOS -> the same line against `traits=4096,adjustable=true,label=Dis…`
- `Stepper > presents one adjustable control to a reader` -> the row publishes neither name
  nor range -> `the control is named: expected 'range=none,clickable=0,disabled=false…' to
  contain 'Quantity'`
- `Stepper > presents one adjustable control to a reader` -> `accessibilityValue = ""` ->
  `the control carries its value: expected 'traits=4096,adjustable=true,label=Qua…' to
  contain 'value=4'` — and `traits=4096` is exactly why the old `toContain('4')` could not
  have caught it
- `Stepper > steps once when a reader asks, and not at all at a bound` -> no
  `progressBarRangeInfo` -> `expected '#1 #232 has SetProgress but no range …' to contain
  '4->6'`; -> loses the "already displayed" refusal -> `a reader asking past the maximum
  produced an event: ["reader-at-max:10", "reader:6"] (…10->10…)` (Android and iOS)
- `Stepper > draws the two Material Symbols glyphs on Android` -> `tint = Color.Transparent`
  -> `the "ink" is barely a different colour from the surface it sits on (#808081 vs
  #6E7487, 36 apart…): expected 36 to be greater than 60`
- `Stepper > keeps its own value when uncontrolled` and `…when its view is recycled` ->
  `reset()` sets `didApplyDefault = true` -> `"seeded" never drew displayed=3 - it reports
  "displayed=0;…"` and `"recycled" never drew displayed=1 - it reports "displayed=0;…"`
- `Stepper > reverts a change the app refused` -> `onValueChange(next, 0)` instead of the
  handshake count -> `"refused" never drew displayed=2 - it reports "displayed=3;…"`
- `real-input-a11y > goes red when a stepper's two halves each keep a name` -> a second node
  carrying the label added to the measured fixture -> `2 nodes carry the name … announces
  twice`, and the same test asserts the measured tree does *not* carry that finding
- `real-input-a11y > passes the controls today's code gets right` -> delete the new
  `stepper.xml` fixture -> `ENOENT: … fixtures/a11y/stepper.xml`
- `stepper.test.tsx` -> the dev `step <= 0` throw neutralised -> three wrapper tests red
- `stepper.test.tsx` -> `step` dropped from the props sent to the view -> `passes every prop
  the view config declares` and `passes the defaults it declares` red
- `stepper.test.tsx` -> the sizing key varied with the range -> `has one configuration for
  the whole app` red
- `readme-components.test.js` -> remove `stepper-ios.png` -> `Stepper:
  docs/images/components/stepper-ios.png does not exist`

## Files changed

- `src/components/Stepper/*`, `src/index.ts` — the spec, the wrapper, the dev throws, the
  export and the component manifest.
- `ios/components/Stepper/*` — the SwiftUI half, the vended `.adjustable` element, the test
  seams and the pixel/state probes.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiStepper.kt`,
  `android/src/main/res/drawable/*` — the Compose half, the merged reader node, the two
  locked Material Symbols drawables.
- `example/__tests__/Stepper.harness.tsx`, `example/src/StepperScreen.tsx`,
  `example/src/stories/Stepper.stories.tsx` — the device suite (15 tests), the real-input
  screen and the stories.
- `example/__tests__/Conformance.harness.tsx` — the Stepper's recycle case lifted
  `nuiTestStep` into a local and called it detached, which a Nitro hybrid refuses; it is
  called on the handle now.
- `scripts/__tests__/fixtures/a11y/stepper.xml`, `scripts/real-input/a11y.mjs`,
  `scripts/conformance/make-a11y-fixtures.mjs` — the measured a11y case and its debt row.
  (Round 1 also added an `--only <screen>` filter here; `origin/main` shipped its own
  `--only <id>[,<id>…]` by the time of the fix round, so the duplicate was dropped and the
  claim is corrected — see *Fix round 1*.)
- `docs/components/stepper.md`, `README.md`, `docs/images/components/stepper-*.png`,
  `.changeset/g25-stepper.md` — the docs page, the README row/section/usage and the
  screenshot pair.
- `nitrogen/generated/**` — regenerated by `bun run prepare`.

## Follow-ups

- screenshots: CONTRIBUTING states the required sizes but no recipe for taking them; the
  Android example APK loads its JS from a dev server, which is the awkward part. Worth a
  short doc page.
- harness: `nuiTestPixelProbe` samples the whole view, so the glyph test proves ink exists
  and is sparse, not that each of the two slots paints on its own.
- harness: iOS answers `merged=unavailable` where Android counts merged nodes; the Stepper
  case leans on the `.adjustable` probe instead.
- a11y: the fifth Android debt row retires with the same measurement the four above it
  already point at — a dump taken with touch exploration enabled.
- ci-workflows: `the preflight does not wait forever for -accel-check` failed once inside a
  loaded `check` run and passes in isolation — a timing assertion worth a look by its owner.
- harness: HostPopups' hosted DatePicker dialog read `calendarMonth = -1` once on Android
  and passed unchanged on the re-run — the only failure in 594, and no other branch's log
  store has ever shown it.
- package: `etc/package-files.txt` was missing the `package.json` that the build writes
  into its typescript output folder — deterministic from `bun run prepare`, so a whole-tree
  `check` failure for anyone who builds. Refreshed here rather than investigated further.
- bench: the `mount.stepper` arm exists in `bench/src/plan.ts`; no numbers here — benches
  belong to the bench host (D15) and this lease went to the device suites first.

## Fix round 1 (review)

Merged `origin/main` (ButtonGroup, G21): 28 conflicts, resolved as unions so both controls stay in
every shared list — README, registry, both fallback tables, the bench plan,
`screens`/`controls`/`a11y`, the harness fixtures, both real-input drivers. What a generator owns
was regenerated, not hand-merged: the shared conformance table and the nitrogen output. The a11y
case list went back into generated tab order, which is what the navigation expectation and the iOS
`A11yCase` list describe, and the debt counts were re-derived from the merged table: 22 cases, 4
Android rows, 5 stale.

iOS takes only the **direction** of a `Binding` write, so one tap on `0…1.05` by `0.1` moves one
tenth: a new UIKit-free `NitroUiStepperBinding`, run by `test:native` against the shipping value
rule. Android's node says its value and the probe reads `StateDescription`, so "carries its value"
is what a reader hears. `0…10` by `3` is `0, 3, 6, 9, 10` in all three places; the Storybook row
that called its own `1…10` fixture `0…10` now does not. The hold is counted: its events equal its
steps. Sizing plumbing moved out of the component doc into CONTRIBUTING; four lines went
to `FOLLOWUPS.md`.

## Gates (fix round 1)

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1967 tests / 83 suites | `45d6f2f4c33d` | 2 m 46 s | start 9.6 / med 9.0 / max 10.2 |
| `harness:ios` | **PASS** | 564 tests / 29 suites + isolated 6 tests / 3 suites | `45d6f2f4c33d` (ios tree) | 14 m 19 s | start 22.9 / med 6.6 / max 37.7 |
| `harness:android` | **PASS** | 620 tests / 29 suites + isolated 6 tests / 3 suites | `45d6f2f4c33d` (android tree) | 17 m 48 s | start 6.4 / med 4.8 / max 13.6 |
| `real-input:ios` | **FAIL** | — | `45d6f2f4c33d` (ios tree) | 35 m 17 s | start 3.8 / med 7.4 / max 61.1 |
| `real-input:android` | **PASS** | — | `45d6f2f4c33d` (android tree) | 56 m 01 s | start 5.0 / med 5.6 / max 15.1 |
| `harness:android:Stepper` | stale | 1 failed of 15 tests / 1 suites | 2dfdfd1dea29 (not this tree) | 25.2 s | start 9.3 / med 8.4 / max 9.3 |
| `real-input:ios:--control:stepper` | stale | — | 0a43ddc5b57c (not this tree) | 12 m 22 s | start 6.7 / med 23.2 / max 218.7 |

`need --for merge` is one line short: `real-input:ios` is red on two lines that are not Stepper's.
26/26 controls and 22 of 24 auxiliary checks pass, `stepper` and `a11y:stepper` among them; the two
are the sweep reading **4** stops under `ctx-accessible` where G16's debt row records 2, and the
`a11y:ios-debt` staleness check that follows from it — X22's brief names this branch and owns the
cause. What this round adds to that hunt: it is not load (the 19:04 read is deterministic, med load
7.4, and the a11y sweep ran in its first 6 min), not the device (G26 reads 4 on pair-a, this ran on
pair-b), and not the merge (`a526807e..409bd638` is one docs commit — no code path in
`scripts`, `example`, `src`, `ios` or `android`). The only sweep delta here is one added `A11yCase`
(#12 of 22, before `context-menu`); the wrapper's box is identical to the 2-stop runs
(`12, 452.67, 396x68`), and the two extra elements are the *second* Text, listed twice — exactly
the "four stops" shape that row's comment calls a D37 regression. `real-input:android` is green
here after the 17:04 run's two DatePicker reds did not repeat (`date-picker` and
`hosted-date-picker` both passed on a quieter machine), so those two read as a dump-timing flake
under load, not as a bug in this diff.

## Red proofs (fix round 1)

- `test:native › stepper-binding.test` -> put the round-1 branch back in
  `NitroUiStepperBinding.value` (take the write when `quantize` recognises it) -> 5 of 15 vectors
  red, first `FAIL one plus tap on 0...1.05 by 0.1 moves one tenth (got 1.0, want 0.1; a literal
  write would land on 1.0)`, exit 1.
- `harness:android:Stepper > presents one adjustable control to a reader` -> delete the
  `stateDescription = nitroUiStepperValueText(displayed)` line
  (`HybridNitroUiStepper.kt:385`) -> `the control carries its value: expected
  'range=0..10@4/steps=4,value=none,clic…' to contain 'value=4'`, exit 1.
- `real-input:ios:--control:stepper > testRealInputStepper` -> `userStep` emits two
  `onValueChange`s per step -> `XCTAssertEqual failed: ("4") is not equal to ("2") - a hold should
  report one event per step — the value moved from 5 to 7 (2 steps) while 4 events were reported`,
  exit 1.
- `real-input:ios:--control:stepper > a11y:stepper` -> the new case run before its debt row
  recorded the measured announcement (that tree predates `e6f4c752`) ->
  `NitroUiStepper: "Real-input stepper" is announced as an other and not as an adjustable`; the
  same line prints as a known-failing debt row once the announcement is recorded.

The last three ran through `gate.mjs`, so their evidence is in the gate log store
(`gate.mjs logs --branch task/G25-fix1 --failed`); the first is a host binary, run directly with
`bun run test:native` on the mutated tree.

## Questions for orchestrator

`real-input:ios` cannot be green on this tree this round, and the failing lines are not Stepper's
(see "Gates (fix round 1)"). Options:

1. **Wait for X22, then re-run the iOS half only (recommended).** X22 owns the `ctx-accessible`
   2-versus-4 hunt and holds a lease now. When it lands, merge it into this branch and re-run
   `real-input:ios`: `check`, both harnesses and `real-input:android` are already green on
   `45d6f2f4c33d`, and a fix in `scripts/real-input` or ContextMenu moves the iOS half, not the
   Android one.
2. **Merge with the red line recorded.** 26/26 controls and `a11y:stepper` passed; the two reds are
   a debt row on another component. This is the option `need --for merge` exists to refuse, so it
   is yours to take, not mine.

Recounting the exemption to 4 is not on the list: X22's brief forbids it, and the four-stop shape
is exactly the D37 regression that row is there to catch.

One hand-off for that hunt, cheap and decisive: run the case sweep on this tree with the single
`A11yCase(id: "stepper")` line removed (it is #12 of 22, `context-menu` is last). If
`ctx-accessible` reads 2 again, the trigger is one more case in the sweep rather than anything
Stepper vends; if it stays 4, look outside this diff.
