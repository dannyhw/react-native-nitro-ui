# H2a — Android `<Host>` for Slider, Progress, Button (+ N4) — report

**Branch:** `task/H2a-host-more-controls` (from `main` at `9c60166`). **Round:** 1 of 3 (D19).
**Devices:** Android `emulator-5570` (AVD assigned to this task), Metro 8293, private adb server on
port 5041; iOS simulator UDID `331EF109-21DD-422B-AEF8-DFFFC6998DC3`. **Not pushed.**

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
list. Drag gestures, the three phase callbacks, the controlled handshake (a JS write with no touch,
a refused change snapping back), `disabled`, and the screen-reader step all run inside the Host's
composition. Two pieces of plumbing were needed and neither is Slider-specific:

- **Accessibility through the Host.** `runTestAccessibilityStep` and the progress-report probe look
  for the control's Compose root; a hosted control has none of its own, so they now search the
  Host's when `isHostedByParent` is set. Without that the step silently answered for nothing.
- **The reader gate.** `NitroUiHostView.requestSendAccessibilityEvent` refuses when no accessibility
  service is enabled. A hosted `Slider`/`Progress` publishing a state change into a composition
  whose view is not the child's own otherwise dies with `IllegalStateException: Accessibility off`
  on the first drag — a crash that only a *hosted* control can reach.

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
`armedGuardsReport()` answers `strategy` / `preDraw` / empty, surfaced to tests as
`nuiTestArmedGuards()` on the Switch handle (empty string on iOS, where there is nothing to arm).
The answer is about the **mount** — whether a guard was ever armed — rather than about the
instant: the first-frame listener unregisters itself as soon as it marks a frame, so a probe that
reads only what is live cannot tell "never armed" from "armed and released". That difference is not
a refinement. Round 1 deleted the `watchForFirstFrame` guard and the test stayed green, which is
what forced the probe to change (`0a4501f`); with it, both guards are now provably load-bearing.
The churn gate and the unhosted suites are unchanged for every other parent.

### Sizing rule per control (D24)

| Control           | Policy     | What it draws inside a Host                                       | How it is proved                                          |
| ----------------- | ---------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `Slider`          | fillWidth  | the Host's inner width × its own height                            | tap-to-value differs in a 260 dp vs a 100 dp Host, same child, `width: 60` ignored |
| `Progress` linear | fillWidth  | the Host's inner width × the bar's thickness                       | accessibility-tree width equals a `Slider`'s in the same Host |
| `Progress` circle | intrinsic  | its own square, at the column's leading edge                       | accessibility-tree bounds are a square, ≪ the bar          |
| `Switch`          | intrinsic  | its own box, at the leading edge (H1's rule, re-proved)            | unchanged from H1 + the mixed Host width claim             |
| `Button`          | intrinsic  | the width its title needs × its scale's height, leading edge       | `Go` and `Roll back the release` answer different x sweeps; `width: 220` changes nothing |

Every one of those frames is still decorative in the D24 sense — the child's RN frame is the sizing
engine's answer, computed as if it drew itself, and on Android the child's own view is laid out at
`0 × 0`. What the per-control rule adds is *which* drawing replaces it.

## Files changed

**Native (Android).**
`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSlider.kt`,
`HybridNitroUiProgress.kt`, `HybridNitroUiButton.kt` — `isHostable = true` on all three, plus two
control-specific paths: the Slider's screen-reader step and progress-report probes now find the
Host's composition (a hosted control has none of its own), and `Progress` needed no change at all —
its animation gate is written by attach/detach of its own view, which a Host keeps doing, so an
indeterminate bar animates inside the shared composition and stops when the Host leaves the window.
The two are worth naming for what they say: the seams H1 chose were the right ones, and the only
new native hazard was one none of the four controls can reach alone.
`core/NitroComposeHost.kt` — N4 (`armCompositionStrategy()`, `watchForFirstFrame()` decline for a
hosted child; `releaseOwnCompositionGuards()` for one that moved in mid-mount), and the
`armedGuardsReport()` seam.
`core/NitroUiHost.kt` — `requestSendAccessibilityEvent` refuses when no reader is enabled; the
style-crossing docs corrected (`borderWidth` insets, `alignSelf` was never an arrangement style).

**Bridge / JS.** `NitroUiSwitch.nitro.ts` + regenerated `generated/` +
`src/specs/NativeNitroUiSwitch.ts` + `src/components/Switch/Switch.tsx` — the
`nuiTestArmedGuards()` probe (iOS answers `""`). `src/components/Host/HostChildren.ts` — the
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

**iOS.** `ios/components/Switch/HybridNitroUiSwitch.swift` answers `""` for the guards probe, where
there is no composition strategy and no pre-draw listener to arm.

**Example / docs.** `example/src/HostScreen.tsx`, `example/src/stories/Host.stories.tsx`,
`docs/components/host.md`, `docs/architecture/sizing.md`, `README.md`,
`etc/react-native-nitro-ui.api.md`.

## Gates

Commands are the ones actually run, with the task's AVD name as `<avd>` and the harness app path
absolute. The Android app is built with `:app:assembleDebug -PreactNativeArchitectures=arm64-v8a`
against a private adb server (port 5041), so nothing here touches the default adb server.

| Gate | Command | Result |
| ---- | ------- | ------ |
| Repo checks | `bun run check` | exit 0 — 16 jest suites / 237 tests, native checks 7/7, nitrogen no-drift (198 files), api-extractor, publint, manifest (464 entries, unchanged), `readme:check` |
| Android harness — Host | `HARNESS_APP_PATH=…/app-debug.apk ANDROID_SERIAL=emulator-5570 ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 bunx react-native-harness --harnessRunner android "Host"` | **2 suites / 38 passed** |
| Android harness — churn | same, `"MountChurn"` | **5 passed** (Switches, hosted Switches, mixed Host, 200 single-child Hosts, Picker) |
| Android harness — full | same, no pattern | **12 suites / 183 passed** |
| iOS harness — Host | `HARNESS_APP_PATH=…/NitroUiExample.app IOS_SIM_UDID=331EF109… METRO_PORT=8293 bunx react-native-harness --harnessRunner ios "Host"` | **2 suites / 17 passed** |
| iOS harness — full | same, no pattern | **11 suites / 157 passed, 1 skipped** (the skipped test is `MountChurn`'s documented Android-only case) |
| Real input — Android | `ANDROID_SERIAL=emulator-5570 ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 HARNESS_APP_PATH=… bun run test:real-input:android` | **10 / 10**, including the new `hosted-button`, `hosted-slider`, `hosted-mixed` |
| Real input — iOS | `IOS_UDID=331EF109… METRO_PORT=8293 bun run test:real-input:ios` | **10 / 10**, same three (`hosted-mixed` in 26.7 s of XCUITest) |
| JS style-warning table | `bun run test hostInertStyles` | passes, and shown red below |

Every row is a run of the tree as committed at the end of this round — the harness rows against
the same debug APK the real-input row uses, rebuilt after the last source change.

Two real bugs came out of the real-input runs rather than out of the harness: a hosted `Button`
needing a second tap before its press reaches JS on a real touchscreen (`089ec1e`), and the hosted
`Slider` echo being read before it had landed (`c8f5819`). Both are fixed on the branch, and the
iOS half of the second was a Swift throwing-autoclosure compile error that only the UI-test bundle
build reaches (`c8f5819` again).

## Red proofs

Each row: mutate, rebuild (with `:react-native-nitro-ui:compileDebugKotlin` shown to *execute*
rather than report `UP-TO-DATE`), run the named gate on the device, read the failure, revert, and
confirm `git status` clean. The last two rows are the ones recorded in the earlier rounds of this
task; the rest are from the final tree, after the probe fix that made the first two possible.

| Mutation | Gate | The failure it produced |
| -------- | ---- | ----------------------- |
| delete the `isHostedByParent` return in `watchForFirstFrame()` | N4 guards | `expected ['preDraw', 'preDraw', 'preDraw'] to deeply equal ['', '', '']` |
| delete the same return in `armCompositionStrategy()` | N4 guards | `expected ['strategy', 'strategy', 'strategy'] to deeply equal ['', '', '']` |
| give every hosted child a fixed `Modifier.width(80.dp)` | D24 sizing, 2 gates | `expected 63.19 to be less than 35` (a Slider track that stopped stretching); `expected 2 to be greater than 2` (a long title no longer reaches further than a short one) |
| `HybridNitroUiSlider.isHostable = false` | the two gates that only a shared composition can satisfy | 2 of 19 fail: the screen-reader step loses its adjustable node, and the sizing gate loses its track |
| empty `onDropView()` (no `host.drop()`) | 200 single-child Hosts churn | `expected 10.98 to be less than 2` (MiB retained per cycle) |
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
  arming, and both are covered (`releaseOwnCompositionGuards()` is idempotent).
- **`armedGuardsReport()` is a probe on the Switch handle only.** Three more handles with one
  method each, all returning the same string, would be a wider API surface for no extra
  coverage: the guards live in `NitroComposeHost`, so one control that can read them proves the
  branch for all of them.
- **`alignSelf` came off the dev warning list; `borderWidth` came off the "does not cross" list.**
  Both were claims the code does not support: border and padding arrive as one
  `layoutMetrics.contentInsets` that the view manager forwards as padding (so `borderWidth` *does*
  cross, as an inset), and a self style never reached the drawing on either side of the bridge.
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
before/after: memory **0.31x / 0.41x / 0.26x / 0.32x** and mount UI CPU **0.54x / 0.50x / 0.56x /
0.48x** for Switch / Slider / Progress / Button. The Host does what H1 said it does, on all four.

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
- **`update` cells are noisy on this machine.** Every `update.*` cell for the host arm carries a
  spread over 10 % except `mounted` (1–2 %), so none of them carry a verdict. In particular
  `update.progress` lost its `rn-core` and `expo-ui-*` pairings entirely (`n/a` — the signal did
  not arrive in enough launches to clear `MAX_MISSING_SAMPLE_RATIO`), which is reported rather than
  interpolated.
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
* **`update.progress` lost its cross-arm pairings** in this run (`n/a`, missing-sample rule) and every
  host-arm `update.*` cell carries a spread over 10 %. Re-measured on a quiet machine before any of
  those numbers are quoted.
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
