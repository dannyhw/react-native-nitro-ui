# H2a — Android `<Host>` for Slider, Progress, Button (+ N4) — report

**Branch:** `task/H2a-host-more-controls` (from `main` at `9c60166`). **Rounds:** implementation
round 1 of 3 (D19), then fix round 1 of 2 — the review's findings and their fixes are in
"Fix round 1" at the end.
**Devices:** Android `emulator-5570` (AVD assigned to this task), Metro 8293, private adb server on
port 5041; iOS `iPhone Air` simulator. **Not pushed.**

## Summary

A `<Host>` now composes `Slider`, `Progress` and `Button` as well as `Switch`, and the allowlist is
still an allowlist: `SegmentedControl`, `Picker` and `DatePicker` stay refused, on both sides of the
bridge. Each of the three joins the mechanism H1 built for one control rather than adding a new one
— `isHostable = true`, the JS table row, and the hosted branch of the composition gates — and each
was then proved to still be *itself* inside somebody else's composition: a drag that reaches JS and
snaps back when JS refuses it, a progress value written while hosted, a press that fires once, a
`disabled` that refuses, four kinds of control in one Host that can be reordered and removed and
still answer.

N4 (H1's re-review) is fixed: a hosted child no longer arms a lifecycle observer or a first-frame
pre-draw listener for a composition it never builds, unhosted behaviour unchanged, and the guards
are now readable from JS so a test can ask which of the two a control armed.

D24 per control is now a rule with measurements behind it rather than a promise: the Host offers one
constraint (its inner width) and the control's existing `intrinsic` / `fillWidth` policy decides
what to do with it, which is why a hosted `Slider` drags across the whole Host and a hosted
`Button` does not stretch one pixel past its title.

## What shipped, per control

### Slider

`isHostable = true` (`HybridNitroUiSlider.kt`), a `HOSTABLE_CONTROLS` row, removed from the refused
list. What round 1 proved about a hosted Slider splits in two, and the split matters (review M3/S1):

- **Driven through the model, not the drawing.** The drag cases, the three phase callbacks, the
  controlled handshake (a JS write with no touch, a refused change snapping back) and `disabled`
  go through `nuiTestDrag` → `runTestDrag`, which refuses on `SliderModel.enabled` and starts from
  `SliderModel.displayed` — a model field written in `afterUpdate`/`dragTo`, not a reading of the
  drawing. They prove that the model a hosted control answers to is the one JS talks to; they cannot
  prove what the Host's shared composition drew.
- **Read out of the Host's composition.** The sizing taps (one offset, two Host widths, two values),
  the screen-reader step and real-input `hosted-slider`. Fix round 1 added the two composition-level
  cases round 1 lacked: a real tap on a **disabled** hosted Slider's track answers nobody until one
  prop changes, and a **refused** value is redrawn — the next tap opening its gesture at the old
  value is the drawing's own answer.

Two pieces of plumbing were needed and neither is Slider-specific:

- **Accessibility through the Host.** `runTestAccessibilityStep` looks for the control's Compose
  root; a hosted control has none of its own, so it now searches the Host's when
  `isHostedByParent` is set. Without that the step silently answered for nothing. (The
  progress-report probe reads the model and needed no change.)
- **The reader gate.** `NitroUiHostView.requestSendAccessibilityEvent` refuses when no accessibility
  service is enabled. A hosted `Slider`/`Progress` publishing a state change into a composition
  whose view is not the child's own otherwise dies with `IllegalStateException: Accessibility off` —
  reachable once Compose's own accessibility is on while the platform has no service, which is what
  the harness's step seam does (`forceAccessibilityForTesting`, `HybridNitroUiSlider.kt:1006`). With
  a reader connected the platform check passes and `super` runs; with nothing connected Compose
  announces nothing at all. So the guard is `SliderHost`'s existing refusal, applied at the view the
  event now leaves through — not a suppression of an event anyone would have received.

### Progress

`isHostable = true` (`HybridNitroUiProgress.kt`) and one table row. Both variants are hosted. The
indeterminate animation runs inside the shared composition: `nuiTestIsAnimating()` answers `true`
for a spinning bar and `false` for a determinate one *in the same Host*, and giving the spinning bar
a value stops it there rather than only at its own view's attach — which is the animation gate
reading the model, not the mount.

### Button

`isHostable = true` (`HybridNitroUiButton.kt`) and one table row. `onPress`, press feedback and
`disabled` all answer inside the Host. A harness-synthesised touch reaches a hosted `Button` on
Android; on iOS no harness-synthesised touch has ever reached a SwiftUI `Button` at all (G2,
`docs/tasks/G2-button.report.md`), so the press cases are Android-only and the real tap is proved
in the real-input suite on both platforms — where the input is injected at HID level. The case kept
live on both is that a hosted Button's `title`/`disabled` props keep reaching the drawing.

### N4 — guards a hosted child never needs

`armCompositionStrategy()` and `watchForFirstFrame()` decline while `isHostedByParent` is set, and
`releaseOwnCompositionGuards()` drops guards armed by a control that moved *into* a Host mid-mount.
`armedGuardsReport()` answers `strategy` / `preDraw`, surfaced to tests as `nuiTestArmedGuards()` on
the Switch handle. The line has two halves, `ever|live:<live>`, because the two directions need
different witnesses:

- the **ever** half says what this mount armed at any point (both flags reset on recycle), which is
  the only way to gate a first-frame listener that takes itself off as soon as it marks a frame —
  round 1 deleted the `watchForFirstFrame` guard and a live-only probe stayed green, which is what
  forced the probe to change (`0a4501f`);
- the **live** half says what is installed *now*, which is the only witness the move-in release has:
  a control that armed both while unhosted and then moved into a Host has to answer both armed and
  nothing installed (fix round 1, review S2).

A hosted control answers `|live:`; the same control mounted alone answers
`strategy,preDraw|live:strategy`. iOS answers `|live:` as well, because there is no composition
strategy and no pre-draw listener there — it keeps Android's shape rather than inventing a third
answer. The churn gate and the unhosted suites are unchanged for every other parent.

### Sizing rule per control (D24)

| Control           | Policy     | What it draws inside a Host                                       | How it is proved                                          |
| ----------------- | ---------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `Slider`          | fillWidth  | the Host's inner width × its own height                            | tap-to-value differs in a 260 dp vs a 100 dp Host, same child, `width: 60` ignored |
| `Progress` linear | fillWidth  | the Host's inner width × the bar's thickness                       | accessibility-tree width equals a `Slider`'s in the same Host |
| `Progress` circle | intrinsic  | its own square, at the column's leading edge                       | accessibility-tree bounds are a square, ≪ the bar          |
| `Switch`          | intrinsic  | its own box, at the leading edge (H1's rule, re-proved)            | unchanged from H1 + the mixed Host width claim             |
| `Button`          | intrinsic  | the width its title needs × its scale's height, leading edge       | `Go` and `Roll back the release` answer different x sweeps; `width: 220` changes nothing |

Every one of those frames is still decorative in the D24 sense — the child's RN frame is the sizing
engine's answer, computed as if it drew itself, and the drawing answers at the same offsets whether
that frame is `0 × 0` (the pass that mounts it) or the child's own Yoga frame (any later pass over
it — fix round 1 re-tested F8 by re-framing the hosted child itself, and Android then reports
`[160, 60, 0, 48]`, with a child added later at `[52, 48, 0, 96]`). Neither is where the control is
drawn. What the per-control rule adds is *which* drawing replaces it.

## Files changed

**Native (Android).**
`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSlider.kt`,
`HybridNitroUiProgress.kt`, `HybridNitroUiButton.kt` — `isHostable = true` on all three, plus two
control-specific paths: the Slider's screen-reader step now finds the Host's composition (a hosted
control has none of its own), and `Progress` needed no change at all — its animation gate is written
by attach/detach of its own view, which a Host keeps doing, so an indeterminate bar animates inside
the shared composition. That it *stops* when the Host leaves the window is reasoned from that same
attach/detach pair and is **not gated** for the hosted case (review N5): no case detaches a Host.
The two are worth naming for what they say: the seams H1 chose were the right ones, and the only
new native hazard was one none of the four controls can reach alone.
`core/NitroComposeHost.kt` — N4 (`armCompositionStrategy()`, `watchForFirstFrame()` decline for a
hosted child; `releaseOwnCompositionGuards()` for one that moved in mid-mount), and the
`armedGuardsReport()` seam.
`core/NitroUiHost.kt` — `requestSendAccessibilityEvent` refuses when no reader is enabled; the
style-crossing docs corrected (`borderWidth` insets, `alignSelf` was never an arrangement style).

**Bridge / JS.** `src/components/Switch/Switch.nitro.ts` + regenerated `nitrogen/generated/` +
`src/components/Switch/NativeNitroUiSwitch.ts` + `src/components/Switch/Switch.tsx` — the
`nuiTestArmedGuards()` probe (iOS answers `|live:`). `src/components/Host/HostChildren.ts` — the
HOSTABLE/UNHOSTABLE tables. `src/components/Host/Host.tsx` — `HostProps` docs.

**Tests.** `example/__tests__/HostControls.harness.tsx` (new: per-control hosted behaviour,
mixed add/remove/reorder, per-control sizing, N4 guard gate), `example/__tests__/Host.harness.tsx`
(S2 display-hidden value change, F8 box-after-later-layout), `example/__tests__/MountChurn.harness.tsx`
(mixed Host churn), `src/__tests__/hostInertStyles.test.tsx` (which styles the dev warning names).

**Bench.** `scripts/bench/lib.mjs` (`ARM_SCOPES['nitro-ui-host']` widened, `armScopeCovers()`),
`bench/src/implementations/nitroUi.tsx` (`NitroUiHostList` renders the four, throws on a control
the arm may not claim), `bench/src/implementations/index.ts` (the arm's entry),
`scripts/__tests__/bench-gate.test.js`.

**Real-input.** `scripts/real-input/controls.mjs` + `android.mjs` (`hosted-button`,
`hosted-slider`, `hosted-mixed`), `example/ios/NitroUiExampleUITests/RealInputTests.swift` (the
same three names).

**iOS.** `ios/components/Switch/HybridNitroUiSwitch.swift` answers `|live:` for the guards probe —
nothing ever armed, nothing installed — where there is no composition strategy and no pre-draw
listener to arm. `ios/components/Host/HybridNitroUiHost.swift` is the documented no-op, unchanged in
behaviour.

**Example / docs.** `example/src/HostScreen.tsx`, `example/src/stories/Host.stories.tsx`,
`docs/components/host.md`, `docs/architecture/sizing.md`, `README.md`,
`etc/react-native-nitro-ui.api.md`.

## Gates

Commands are the ones actually run, with the task's AVD name as `<avd>`, the simulator as `<udid>`
and the harness app path absolute. The Android app is built with
`:app:assembleDebug -PreactNativeArchitectures=arm64-v8a` against a private adb server (port 5041),
so nothing here touches the default adb server.

These are fix round 1's runs, on the tree this branch ends at; round 1's rows are superseded, and
their counts differ because the suites have grown since. Both apps are builds of this tree rather
than leftovers: the branch's merge of `main` predates `scripts/build-app.mjs`, so freshness is shown
by content — no file under `src/`, `ios/` or `android/` is newer than the APK, whose build had
`:react-native-nitro-ui:compileDebugKotlin` *execute* rather than report `UP-TO-DATE`, and the iOS
binary still carries the fix round's `|live:` probe string, which `main`'s build does not have.

| Gate | Command | Result |
| ---- | ------- | ------ |
| Repo checks | `bun run check` | exit 0 — 18 jest suites / 271 tests, `test:native` PASS, `perf:renders` 7/7, nitrogen no-drift (198 files), autolinking, api-extractor, publint, manifest (465 files), `readme:check` (8 blocks) |
| Android harness — Host and churn | `HARNESS_APP_PATH=…/app-debug.apk ANDROID_SERIAL=emulator-5570 ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 bunx react-native-harness --harnessRunner android "Host\|MountChurn"` | **3 suites / 47 passed** — the re-framed F8 case, the two Slider composition gates, the flattening gate, and churn over Switches, hosted Switches, a mixed Host, 200 single-child Hosts and a Picker |
| Android harness — full | same, no pattern | **12 suites / 187 passed** |
| iOS harness — full | `HARNESS_APP_PATH=…/NitroUiExample.app IOS_SIM_UDID=<udid> METRO_PORT=8293 bunx react-native-harness --harnessRunner ios` | **11 suites / 158 passed, 1 skipped** (the skipped test is `MountChurn`'s documented Android-only case), the same `Host.harness.tsx` the Android row ran |
| Real input — Android | `ANDROID_SERIAL=emulator-5570 ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 HARNESS_APP_PATH=… bun run test:real-input:android` | **10 / 10**, including the new `hosted-button`, `hosted-slider`, `hosted-mixed` |
| Real input — iOS | `IOS_UDID=<udid> METRO_PORT=8293 bun run test:real-input:ios` | **10 / 10**, same three, after a fresh `xcodebuild` build-and-test of this tree; two waits retried once each without changing the result |
| JS style-warning table | part of the `bun run check` row (`hostInertStyles`) | passes, and shown red below |

Every row above is a device or CI run of the tree as committed. What came after them is this
section and the `## Fix round 1` below it, which change no code: the last commit a device gate ran is
`2cbf051`, and that is the commit every harness and real-input row above ran.

Two fixes came out of the real-input runs, and both were in the **check scripts**, not in the
library (review M3). `089ec1e`: the hosted-Button check waited for an echo of `2` after asking for
one tap — it was missing a second `tapNode`, so the script's expectation, not the control, was
wrong. `c8f5819`: the hosted-Slider check read its echo before it had landed, and the same file had
a Swift throwing-autoclosure compile error that only the UI-test bundle build reaches. The library
answered correctly in both cases once the scripts asked the right question.

## Red proofs

Each row: mutate, rebuild (with `:react-native-nitro-ui:compileDebugKotlin` shown to *execute*
rather than report `UP-TO-DATE`), run the named gate on the device, read the failure, revert, and
confirm `git status` clean. The first six rows are fix round 1's runs against the tree as it
stands; the last six are round 1's, recorded against a tree that differs only in the probe's
answer format and the doc comments.

| Mutation | Gate | The failure it produced |
| -------- | ---- | ----------------------- |
| delete both `isHostedByParent` declines (`armCompositionStrategy()` and `watchForFirstFrame()`) in one build | N4 guards, the `ever` half | `expected [ 'strategy,preDraw', …(2) ] to deeply equal [ '', '', '' ]` — round 1 proved the two registrars one at a time under a probe with no `live` half; this is both, against the probe as it now reads |
| delete the `releaseOwnCompositionGuards()` call | a live control moved into a Host by flattening | `expected 'strategy' to be ''` — the activity `LifecycleRegistry` observer from its unhosted life is still installed inside the Host (review S2's unguarded path, now gated) |
| `disabled` stops reaching a hosted control (its setter returns early while `isHostedByParent`) | the composition answers, not the model | `expected null to be 'tap-slide-0'` — the press after `setSliderDisabled(false)` finds nobody home. The refusal while disabled is *not* what this gate is for: it holds even under the mutation, which is why round 1's model-level case could not see this |
| a hosted Slider stops applying JS writes (`afterUpdate` skips the handshake write while hosted) | a refused value is redrawn | `expected 90.5083618164063 to be less than 10` — the next tap opens its gesture at the value the app refused. The two model-level write cases went red in the same run: the same bug, seen from the model |
| put the F8 re-frame on the *sibling* instead of the asserted child | F8 | `expected [ 52, 48, +0, 60 ] to deeply equal [ 160, 60, +0, 48 ]` — an untouched child keeps its own answer, so the assertion is per-child. A measured extra: moving a row *above* a child hands that child its frame too, which is the same rule (Fabric re-lays what changed) |
| empty `onDropView()` (no `host.drop()`) | 200 single-child Hosts churn | `expected 10.45 to be less than 2` (MiB retained per cycle) — fix round 1's own number. Round 1's row said 10.98, which is H1's figure, not this task's (review S6) |
| give every hosted child a fixed `Modifier.width(80.dp)` | D24 sizing, 2 gates | `expected 63.19 to be less than 35` (a Slider track that stopped stretching); `expected 2 to be greater than 2` (a long title no longer reaches further than a short one) |
| `HybridNitroUiSlider.isHostable = false` | the two gates that only a shared composition can satisfy | 2 of 19 fail: the screen-reader step loses its adjustable node, and the sizing gate loses its track |
| `model.inWindow = !isHostedByParent` | hosted animation gate | `expected false to be true` on `nuiTestIsAnimating()` for a spinning hosted bar |
| remove the hosted branch of `onMeasure` | mixed-Host churn witness | `expected [411, 4800] to deeply equal [0, 0]` |
| re-add `'alignSelf'` to `INERT_HOST_STYLES` | `hostInertStyles` (JS) | fails: the warning says something about a style that does reach the drawing |
| widen `ARM_SCOPES['nitro-ui-host']` past the four controls | `bench-gate` "scope in one place" | fails on the scope list, both with one extra component and with two |

### Two claims this round retired

* A probe that reads live state cannot gate a listener that unregisters itself. That is how the N4
  gate was written, and it survived one full round of "green" before a mutation found it.
* The mixed-Host churn witness does **not** notice a control coming off the allowlist: with `Slider`
  marked non-hostable the churn stayed green, because the measure decline is keyed on
  `isHostedByParent` and not on `isHostable`. The comment that claimed it would is corrected in
  `example/__tests__/MountChurn.harness.tsx`, which now names the `HostControls` gates as the ones
  that answer that question.

### How a build was proved fresh

`example/android` autolinks the library from the worktree named in
`example/android/build/generated/autolinking/autolinking.json` — there is no
`example/node_modules/react-native-nitro-ui`, so the wiring is invisible from the tree. Two things
learned here are worth keeping:

* **APK byte size is not a freshness signal.** The debug APK is 79 139 345 bytes both with a 33-byte
  probe string compiled into the library and without it, which is how a stale-build scare turned out
  to be nothing.
* What does work: a symbol unique to the change in the dex
  (`for f in $(unzip -Z1 app-debug.apk | grep 'classes.*dex'); do unzip -p app-debug.apk "$f" | grep -a everArmedPreDraw && echo "$f"; done`),
  a compile failure that quotes the mutated line, and — the strongest of the three, and the one
  every row above uses — a mutation that flips an assertion on the device.

## Decisions made

- **The allowlist stays an allowlist.** `SegmentedControl`, `Picker` and `DatePicker` keep
  `isHostable = false`. Each of them presents a popup or a dialog — a window of its own — and a
  Host owns a rectangle inside somebody else's window. Refusing is H2b's decision to make, not
  this round's to pre-empt.
- **The hosted accessibility step searches the Host's composition** rather than giving a hosted
  control a synthetic compose root. The alternative (a root per child) is a second composition,
  which is the thing a Host exists to avoid.
- **A hosted control publishes no accessibility event when no reader is enabled.** Compose throws
  `IllegalStateException` for a state-change event on a composition whose host view is not the
  child's own, and the throw arrived on the first drag of a hosted `Slider`. The refusal mirrors
  what `View` itself does with no service enabled; it is not a suppression of a real event, because
  there is no reader to deliver it to.
- **N4 was fixed at the registrar, not with a teardown sweep.** Not arming is the root cause; a
  `release` path is still needed for the transition where a control moves *into* a Host after
  arming, and both need a witness: the *steady state* is gated by the `ever` half of
  `armedGuardsReport()`, and the *transition* is the job of the `live` half, which fix round 1 added
  because round 1's claim that both were covered was false — deleting
  `releaseOwnCompositionGuards()` turned nothing red (review S2).
- **`armedGuardsReport()` is a probe on the Switch handle only.** Three more handles with one
  method each, all returning the same string, would be a wider API surface for no extra
  coverage: the guards live in `NitroComposeHost`, so one control that can read them proves the
  branch for all of them.
- **`alignSelf` came off the dev warning list; `borderWidth` came off the "does not cross" list.**
  Both were claims the code does not support: border and padding arrive as one
  `layoutMetrics.contentInsets` that the view manager forwards as padding (so `borderWidth` *does*
  cross, as an inset), and the warning reads the **Host's own** `style`, where `alignSelf` positions
  the Host inside *its* parent — it moves the box, and the drawing is inside the box, so it works.
  (`Host.tsx` gives this reason; four places had invented one about *children* instead.)
- **One echo for the mixed Host** (`off 0.50 0`) instead of four. A check reading one string for
  three different kinds of answer is also the cheapest proof that pressing one child left the
  others alone.
- **The mixed readouts sit above their boxes on the example's Host screen**, so a real-input
  check that has scrolled to the last control can still read what its own tap did. A `dump` lists
  nothing off screen; below the box, the readout and the last child cannot both be on screen on a
  small device.

## Bench

One run, `--platform android --plan quick`, from `e7b7dbf` + the docs commit's tree (no source
change since `e7b7dbf`, so the measured APK *is* the shipped one — verified by dex content, not by
`UP-TO-DATE`). Results file `bench/results/e7b7dbf-dirty-android-20261026T135002Z.json`,
`BENCH_EXIT=0`, `problems: []`, 4 launches, ART `speed-profile` (primed, 1 attempt),
`durationMs` 2 965 109 (~49 min). Ratios are the runner's own launch-paired
`pairedLaunchRatios()`, read with `bench/tools/arm-ratios.mjs --arm=…`; the denominator
`expo-ui-shared-host` was also read directly (`--arm=expo-ui-shared-host`) to confirm it sits
where the tables say.

The `nitro-ui-host` arm now carries all four hostable controls, which is what makes the D15
question answerable per control instead of by extrapolation from the Switch.

### Hosted vs unhosted vs `expo-ui-shared-host`

Mount memory (KiB per instance, N=200), and mount UI / JS CPU per op (ms, N=50):

| Control    | `nitro-ui` no Host    | `nitro-ui` + `<Host>`  | `expo-ui-shared-host` | memory ratio (host ÷ shared) |
| ---------- | --------------------- | ---------------------- | --------------------- | ---------------------------- |
| `Switch`   | 144.1 KiB / 9.97 / 2.08 | **45.4 KiB / 5.43 / 3.08** | 51.1 KiB / 6.54 / 2.62 | **0.88x**(3%) |
| `Slider`   | 155.0 KiB / 11.93 / 2.29 | 62.2 KiB / 6.33 / 2.56 | 62.3 KiB / 7.16 / 2.30 | 1.00x(2%) |
| `Progress` | 130.6 KiB / 8.55 / 1.98 | **33.3 KiB / 5.00 / 2.90** | 91.2 KiB / 9.61 / 3.28 | **0.37x**(1%) |
| `Button`   | 188.7 KiB / 13.85 / 2.13 | **61.3 KiB / 7.21 / 2.54** | 77.1 KiB / 8.37 / 3.34 | **0.80x**(2%) |

Host ÷ *unhosted*, same run (`--arm=nitro-ui-host`, `vs nitro-ui` column) — the host's own
before/after. Memory per instance: **0.31x**(2%) / **0.41x**(3%) / **0.26x**(0%) / **0.32x**(1%) for
Switch / Slider / Progress / Button, every cell inside spread. Mount UI CPU: 0.54x (13%, `n/v`) /
**0.50x**(3%) / **0.56x**(9%) / 0.48x (13%, `n/v`). The memory half says the Host does what H1 said
it does on all four; the UI-CPU half only says it on Slider and Progress — the Switch and Button
cells are noise-flagged and carry no verdict (review S5).

### What this run cannot say

- **It is not quiet.** 459 load samples, median 5.51, p90 15.87, max 36.18, **170 over the ceiling
  of 7 — 37 %**, against `LOAD_OVER_CEILING_FRACTION` = 10 %, so `machine.quiet` is false. A
  non-quiet run mints no baseline (`bench/baselines/README.md`), and this is a `quick` plan at 4
  launches anyway. The numbers are same-run paired readings; the `Switch` row's agreement with H1's
  quiet run (0.88x/0.84x against 0.86x/0.87x) is the evidence that they are readable.
- **The `Slider` memory ratio is a denominator story.** Hosting halves our own footprint
  (155.0 → 62.2 KiB) and lands exactly on the shared host, because `@expo/ui`'s shared-host Slider
  is 62.3 KiB here while a bare RN `Slider` is 14.8 KiB. Compare H1's quiet run for the shape and
  this run for the ratio; do not sell it as a 1.00x win.
- **The `update` cells are mixed, and none of them carries a claim.** The aggregate (`Switch`)
  update cells against the shared host are *inside* spread — `mountedNs` 0.99x(1%), `presentedNs`
  1.01x(0%), `mainNsPerOp` 0.84x(5%), `jsCommitNs` 0.96x(6%) — while `jsNsPerOp` 1.10x(14%) is not;
  per-control update spreads run 0–21 %. Round 1's sentence that every host-arm `update.*` cell was
  over 10 % is simply wrong (review S5). Nothing was claimed from any of them.
- **`update.progress` has `n/a` cells.** `mountedNs`/`presentedNs` do not pair with `rn-core` or
  either `expo-ui-*` arm (they pair with `nitro-ui`: 0.96x / 1.00x); `mainNsPerOp` does not pair with
  `rn-core` but does pair with both `expo-ui-*` arms (0.04x(2%) and 0.05x(11%));
  `unmountMainNsPerOp` pairs with nothing. `jsCommitNs` and `jsNsPerOp` pair with all four. The gaps
  are the missing-sample rule (`MAX_MISSING_SAMPLE_RATIO`), reported rather than interpolated —
  round 1's "lost its `rn-core` and `expo-ui-*` pairings entirely" overstates it.
- The 5-arm × 21-cell plan means 4 launches × 105 cells; the host arm self-limits to its four
  controls through `armScopeCovers()`, so 3 of the 7 components never scheduled it (the
  `picker`/`date-picker`/`segmented-control` rows have no `nitro-ui-host` line at all).

## Known issues and follow-ups

* **Pre-existing text names the devices earlier tasks measured on** — the task AVD in
  `NitroComposeHost.kt`, `scripts/real-input/android.mjs` and `docs/components/host.md`, and a
  simulator model plus a second AVD in `example/__tests__/Slider.harness.tsx`. Nothing *added* by
  this task names one (the one mention this task's new test file carried is now "the iOS
  simulator"), and rewriting other tasks' sentences is one sweep for the orchestrator rather than
  four for four tasks (D25).
* **The mixed-Host churn is a fixture-shape gate.** With one Host per cycle, a Host-level leak of
  ~56 KiB cannot show against a 2 MiB-per-cycle bound — the many-Hosts gate exists for exactly that
  reason and is the one that goes red. If a later round adds a control with real per-child
  retention, the mixed fixture wants the many-Hosts shape (many Hosts, one of each kind inside
  each), which this round deliberately did not do: it would have made two gates measure the same
  thing.
* **Two device runs dropped a connection, and both are recorded rather than quietly rerun.** The
  Android `Host|MountChurn` gate lost its app bridge mid-suite in one attempt where the harness
  could not take Metro 8293 — a Metro left running by an earlier step of this task held the port, so
  the harness ran the suite on 8294. With 8293 free the same gate passed twice (3 suites / 47), and
  the run in Gates is one of those. Nothing refuses a port fallback while the wall-clock gates are
  off, so a fallback run simply does not count as a gate result here. Separately, one iOS full run
  failed `reports a hosted drag through all three callbacks` on its first `log.sliders` lookup, in a
  test body no fix-round commit touched; the fix round's full iOS run passed it, and no cause is
  known, so it stands as an unreproduced single failure rather than a fixed one.
* **The whole H2a run wants a quiet re-run.** 37 % of its load samples were over the ceiling, some
  `update` cells are spread-flagged, and the `update.progress` gaps above are the missing-sample
  rule. Fix round 1 added **no** new bench run: the re-run waits for a quiet bench machine, and
  until then every H2a number in `README.md`, `host.md` and this report is labelled indicative.
* **H1's load-ceiling follow-up is still open**: the load-sensitive probes (heap floors, animation
  reports) have no gate that refuses a busy machine, and this bench run recorded 37 % of samples
  over the ceiling.
* `queryByAccessibilityLabel` cannot see Compose nodes on Android, which is why the hosted gates go
  through the `nuiTest*` seams and a hit-test rather than through labels.

## Questions for the orchestrator

1. **H2b's shape.** `SegmentedControl`, `Picker` and `DatePicker` are refused because a popup owns a
   window and a Host owns a rectangle. If H2b wants them inside a Host, does that mean a Host that
   can host a *second* window owner, or a refusal that becomes a thrown error in dev instead of a
   `console.error`?
2. **The guards probe is on the Switch handle only.** It is one method on one control reading a
   field in the shared base, which covers the branch for every control. If H3 gives a control a
   *different* guard shape, does the probe move onto a shared spec protocol then, or grow one method
   per handle?
3. **Bench honesty policy.** This run is same-run paired but not quiet, and the ratios agree with
   H1's quiet run to ~2 %. Should a non-quiet run be allowed to publish per-control ratios at all, or
   only the host ÷ unhosted half (which is same-arm and so less exposed to machine drift)?
## Fix round 1

Verdict: MERGE WITH FIXES — the native change held, several claims did not. No new bench
run: the ratios wait for a quiet machine.

**Merge.** `ae9cc95`, `f7a9f51` brought the public-docs rewrite, 0.1.0 and its tooling; the Host text
now sits inside main's structure. `README.md` calls hosting `Slider`/`Progress`/`Button` **the next
release** and passes `readme:check`. `CHANGELOG.md` untouched: the line is
`.changeset/host-composes-more-controls.md` (`minor`).

| Finding | Commit | Evidence |
| ------- | ------ | -------- |
| M1 — verdicts read noise-flagged cells | `fe02042` | every H2a cell in `README.md`, `host.md`, `sizing.md` carries a spread or `n/v`; run labelled busy (37 % of samples over ceiling), indicative, re-run pending |
| M2 — F8 never exercised | `a696d05`, `2cbf051` | a self re-frame reads `[160, 60, 0, 48]`; the later-added `list-d` reads `[52, 48, 0, 96]`; the caveat now reads "the engine's frame, not the drawn one". Red proof: re-framing the sibling answers `[52, 48, +0, 60]`. The probe is Android's; on iOS the box *is* the drawing |
| M3.2, S1 — Slider claims outgrew their gates | `e2efc46` | model-level cases name `SliderModel`; two gates press the composition — a disabled hosted track answers nobody until one prop changes; a refused value is redrawn |
| M3.3, S2 — the move-in was not covered | `e2efc46` | the probe answers `ever|live:`; flattening moves a mounted control in and out; deleting `releaseOwnCompositionGuards()` → `expected 'strategy' to be ''` |
| S3 — probe doc read as live state | `e2efc46` | spec and KDoc say armed **at any point in this mount**, reset on recycle |
| S4 — one `alignSelf`, four reasons | `a696d05`, `bc76549` | `Host.tsx`'s reason told everywhere; `alignSelf` reaches the drawing |
| M3.1, S5, S6 — report accuracy | this commit | the "real bugs" are the script fixes they are; noise sentences per the results file; churn proof is this task's `10.45` (H1's was `10.98`); header names `iPhone Air` |
| N1–N6 | `bc76549`, report | bench list, citation, spec paths, crash claim, "ever armed" |
| `check` red since `a696d05` | `8c0a98b` | a TSDoc span across a newline is fatal to api-extractor, ending the chain before `readme:check` |

Two runs dropped a device connection, both re-run green (Known issues): churn on a Metro 8294
fallback, and one iOS run a hosted-drag assertion that has not repeated.
