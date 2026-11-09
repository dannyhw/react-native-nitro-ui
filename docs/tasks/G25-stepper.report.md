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

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1940 tests / 81 suites | `197834c30d3b` | 2 m 45 s | start 10.9 / med 11.9 / max 17.7 |
| `harness:ios` | **PASS** | 538 tests / 28 suites + isolated 6 tests / 3 suites | `197834c30d3b` (ios tree) | 13 m 49 s | start 4.2 / med 4.9 / max 9.8 |
| `harness:android` | **PASS** | 594 tests / 28 suites + isolated 6 tests / 3 suites | `197834c30d3b` (android tree) | 17 m 18 s | start 11.0 / med 4.4 / max 12.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Stepper` | stale | 15 failed of 15 tests / 1 suites | a20f1e5c45d8 (not this tree) | 2 m 40 s | start 9.0 / med 5.4 / max 9.0 |
| `harness:android:Switch` | stale | 15 tests / 1 suites | 465d19029f04 (not this tree) | 13.6 s | start 8.7 / med 9.4 / max 10.2 |

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
  `scripts/conformance/make-a11y-fixtures.mjs` — the measured a11y case, its debt row, and
  the `--only <screen>` filter that let one fixture be re-measured without re-dumping every
  other control's.
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
