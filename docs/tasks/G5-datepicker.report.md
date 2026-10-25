# G5 — DatePicker (0.2) — implementation report

**Branch:** `task/G5-datepicker` (from `main` @ `fd55c1a`)
**Round:** implementation round 1 of 1 (+2 fix rounds available)
**Devices:** iPhone Air `331EF109…`, AVD `nitroui_t02` / `emulator-5572` (adb 5042), Metro 8294

## Summary

`DatePicker` is in: SwiftUI `DatePicker` (`.graphical` / `.wheel`, plus our own compact
field that opens a UIKit popover) on iOS, and Material 3 `DatePicker` / `TimePicker`
(inline, and `DatePickerDialog` / `TimePickerDialog` behind a compact field) on Android.
Modes `date` / `time` / `datetime`, variants `compact` / `inline` / `wheel`, bounds,
disabled, tint, controlled + uncontrolled through the event-count handshake.

It is the first control in the library that **presents** something, and that is where most
of the design went: the mount owns the presentation on both platforms, so recycle, drop
and unmount-while-open cannot leave a popover or a dialog behind (the B1 class of bug), and
"it closed" is a structural assertion rather than a screenshot.

`docs/components/date-picker.md` is the user-facing page, with the per-platform
mode × variant matrix and the two Android gaps.

## Files

**Library**
- `src/components/DatePicker/DatePicker.nitro.ts`, `DatePicker.tsx`,
  `NativeNitroUiDatePicker.ts`, `NitroUiDatePickerConfig.ts`, `DatePicker.perf-test.tsx`
- `src/index.ts` (public export), `nitro.json`, `nitro-ui.sizing.json`,
  `nitrogen/generated/**` (regenerated, no drift)
- `ios/components/DatePicker/HybridNitroUiDatePicker.swift` (new, 1232 lines)
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt` (new, 1386 lines)
- `ios/core/NitroSwiftUIHost.swift`: `+12` lines — a `containingViewController` accessor,
  the only core change. A component that presents needs the containment the host already
  creates (`needsContainment`); nothing else in the library uses it, and no shipped
  control's behaviour moves.
- `ios/core/NitroUiDeclaredFallbacks.swift`, `…/core/NitroUiDeclaredFallbacks.kt`,
  `NitroUiPackage.kt`: register the component and its declared fallback.

**Tests, harness, bench, example**
- `example/__tests__/DatePicker.harness.tsx` — 11 on-device tests
- `example/src/DatePickerScreen.tsx`, `example/src/App.tsx` (Date tab),
  `example/src/stories/DatePicker.stories.tsx` (Playground + showcases, S1's layout)
- `scripts/real-input/{controls,android,uiautomator}.mjs`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the open-and-pick case
- `scripts/smoke/App.tsx`, `scripts/smoke/lib.mjs`, `scripts/__tests__/smoke-ready-line.test.js`
  — the A2 per-control layout line now includes `date-picker=…`
- `bench/src/{types,plan}.ts`, `bench/src/implementations/{shared,nitroUi,rnCore,expoUi.ios,expoUi.android}.tsx`,
  `scripts/bench/lib.mjs`, `scripts/__tests__/bench-gate.test.js` — the `date-picker` cells
- `src/__tests__/viewConfigs.test.ts` — the generated view-config copy is checked

## Decisions

- **Dates cross the bridge as `number` (ms since the epoch), and an absent bound is
  `null`, not a sentinel.** The brief allowed "NaN or sentinel"; `number | null` is what
  core.md/D7 already use for an absent colour and an absent controlled value. A magic
  `Date` would have to be chosen to sit outside every calendar (both platforms derive a
  real year range from the bounds they are handed — a number that means "unbounded" to one
  is the year 1 to the other), and a clamp against `NaN` silently clamps nothing because
  every `NaN` comparison is false. Documented on the spec.
- **`nuiSizingKey` is `"<variant>|<mode>"` and deliberately excludes the displayed value**
  (the open question in the brief). Reason: two pickers that share a key must want the
  same box. If the field's width followed the date, `Mar 5` and `December 28, 2288` would
  share a key and each first instance would report a size that corrects the other's box —
  layout ping-pong with a cache entry per date ever rendered. Instead the field is as wide
  as the **widest string its mode can produce**: probed from the platform formatter (every
  month name in the locale, one- and two-digit days, `0/8/12/20/23` hours, both AM/PM
  halves, four-digit year), cached per `mode` × content-size-category × locale on iOS, and
  on Android done with layout — an invisible probe `Text` under `clearAndSetSemantics`
  with the real value overlaid on `matchParentSize`, which is right for locale *and* font
  scale with no cache. Cost: a compact field is wider than today's date needs. Gated by
  `gives two compact pickers one box, whatever dates they show` and
  `keeps a date field and a time field at their own boxes`.
- **The `compact` field is ours, not `.datePickerStyle(.compact)`** — see the page's
  section. Three buys: the mount can close the presentation, JS can read whether it is
  open, and the width is value-independent.
- **iOS popover = a UIKit presentation with SwiftUI content.** A SwiftUI `.popover`
  cannot be closed from `onDropView`, and while it animates in UIKit *refuses* a
  dismissal — so a control dropped mid-animation would leave its dimming layer eating
  touches in an app that no longer owns it (measured: 500 ms of a dead screen). The
  presentation therefore remembers a dismissal requested mid-transition and the
  `popoverPresentationController`'s own `containerView` is hidden in the same turn
  (`hitTest:`-dead immediately), with UIKit's real `dismiss` still running at the
  completion. This is what `presents nothing after the mount that opened it is gone`
  pins on iOS.
- **Android dialogs are composed from `model.presented` inside the host's own
  composition.** `NitroComposeHost.drop()` disposes that composition, so the dialog window
  goes with it; nothing registers on the activity, a window or a `ViewTreeObserver`
  (the B1 lesson). The back gesture dismisses through `onDismissRequest`, which is the
  same write as the outside tap.
- **Android gaps, documented rather than faked:** `wheel` renders the inline picker (M3
  has no wheel — inventing one means drawing a picker, not hosting the platform's), and
  `datetime` is a date dialog followed by a time dialog, because Material 3 has two
  controls and no combined one. The inline form of `datetime` shows the calendar.
- **A variant change remounts the native view** (`key={normalisedVariant}`): it is the
  difference between an intrinsic field and a `fillWidth` calendar, and the sizing policy
  is a property of the mount. `useSizingId` gets the same key so the remount cannot
  inherit the dropped mount's id.
- **Test-only surface, same shape as the shipped controls (D14):** `nuiTestSelect`,
  `nuiTestPresent`, `nuiTestStateReport` (`"<displayed ms>|<presented 0|1>"`). A calendar
  cell, a wheel row and a dialog button are unreachable to a synthesised press on at least
  one platform, so the suite drives the control's *own selection path* (clamped,
  optimistic, emitted with a fresh event count — indistinguishable from a tap) and reads
  back the report. The dialog test needs no readout: a leaked window swallows the press of
  a witness next to it.
- **Android's `DatePickerState` speaks UTC midnight of the selected local day.** The
  conversions to/from the instant live in one place next to the clamp, which is what makes
  the DST round-trip testable.

## Gates

| Gate | Result |
| --- | --- |
| Harness, iOS (iPhone Air, Node 24, absolute `HARNESS_APP_PATH`) | **pass** — `DatePicker` 11/11; whole suite 110 passed, 1 skipped (`HARNESS_TIMING` unset, D21) |
| Harness, Android (`emulator-5572`, adb 5042) | **pass** — `DatePicker` 11/11; whole suite 111 passed, 9 suites |
| Real-input, iOS (`--control date-picker`) | **pass** — `testRealInputDatePicker` 31.9 s |
| Real-input, Android | see below |
| `bun run check` | see below |
| `bun run bench:typecheck` | pass (both tsconfigs) |
| api-extractor | see below |
| Storybook stories (iOS) | all `DatePicker` stories render (Playground + showcases), no crash |

```
cd example && IOS_SIM_UDID=331EF109-21DD-422B-AEF8-DFFFC6998DC3 METRO_PORT=8294 \
  HARNESS_APP_PATH=$PWD/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app \
  fnm exec --using 24 -- bunx react-native-harness --harnessRunner ios
# and the Android twin with ANDROID_AVD=nitroui_t02 ANDROID_SERIAL=emulator-5572 \
#   ANDROID_ADB_SERVER_PORT=5042 HARNESS_APP_PATH=<absolute app-debug.apk>
```

## Every new test shown red

Mutations applied to the implementation, one per guarded claim, each built and run on the
platform whose code it breaks; the tree was restored and re-run green after each.
`/tmp/g5-mut/*.py` are the scripts, `/tmp/g5-red-*.log` the runs.

| # | Test | Mutation | Red? |
| --- | --- | --- | --- |
| 1 | lays each variant out at the size the control measured | Android: `variant` never reaches the model + sizing policy always intrinsic | ✕ 1 failed |
| 2 | reports a pick once, and nothing for the same day | iOS: same-value suppression removed; Android: same → ✕ | ✕ both |
| 3 | reverts a pick the parent refuses | Android: the handshake never reverts | ✕ 4 failed |
| 4 | clamps a value and a pick to `minimumDate`/`maximumDate` | iOS: no clamping (Android twin ✕ too) | ✕ both |
| 5 | round-trips an instant across a DST boundary | Android: resolve the calendar fields in UTC | ✕ 4 failed |
| 6 | presents nothing after the mount that opened it is gone | both: a presentation that outlives its mount (the B1 failure mode) | ✕ both |
| 7 | is inert while disabled | iOS: `disabled` guard removed | ✕ both |
| 8 | gives two compact pickers one box, whatever dates they show | Android: the width probe follows the value | ✕ 1 failed |
| 9 | keeps a date field and a time field at their own boxes | `sizingVariantFor` drops `mode` from the key | ✕ |
| 10 | re-measures the field when the mode changes | iOS: the mode setter stops asking for a re-measure | ✕ 1 failed |
| 11 | starts a remount from its own default, not the previous mount's | iOS: `didApplyDefault` survives the recycle; Android: native never applies its default | ✕ both |

The sizing suite's own poison (a `seedSizingSize` no date picker has, then an environment
bump) is what makes #1, #8, #9 and #10 able to fail at all: with a correct fallback a
missing correction would be invisible.

`scripts/__tests__/bench-gate.test.js` gained a `date-picker` block (5 cases, 53 total
passing). Shown red by making `componentOf` answer `segmented-control` for a
`date-picker` scenario: `divides a DatePicker arm by the DatePicker control`,
`fails conclusively when the DatePicker arm doubles` and
`schedules every date-picker cell and every arm` go red (the ratio becomes 1.47×, the
schedule becomes empty), then green again on restore.

## Bench

## Screenshots

## Known issues and follow-ups

- **`bun run smoke:rn-cli` / `smoke:expo` were not run** — the smoke *app* line and the
  shared parser are updated and unit-tested (`smoke-ready-line.test.js`, 6 controls), but a
  full pack + Expo + RN-CLI cycle is a release-readiness run, and G4 stopped in the same
  place. Someone with a quiet hour should run both before 0.2 ships.
- **`scripts/bench/build.mjs` runs plain `pod install`, not `bundle exec pod install`**, so
  every bench build rewrites `example/ios/Podfile.lock`'s `COCOAPODS:` stamp from 1.17.0 to
  the 1.15.2 on `PATH`. Nothing else changes; it just lands in someone's diff. One-line fix
  in the bench infra, not in my scope.
- **The Android `expo-ui` date-picker arm is not like-for-like** (documented in
  `bench/src/implementations/expoUi.android.tsx`): `@expo/ui` exposes no dialog/field form
  of the picker — only the inline `DateTimePicker` and whole dialogs — so that arm renders
  an inline M3 calendar while every other arm renders a compact field. The Android
  date-picker rows are a direction, not a ratio to compare with G4's rows. Its
  `initialDate` is also a seed, not a controlled value, so `update.date-picker` prices the
  props write there and a native value change here.
- **iOS `presented` stays a frame-quantised column** for this control too
  (`benchmarks.md`'s noisiest column); the same caveat G1–G4 recorded applies.
- `NitroUiIntrinsicProps`' doc comment still says `prewarmSizing`; the exported name is
  `prewarm`. One-word doc fix, left for whoever touches that file.
- The Android `compact` field is an M3 `OutlinedButton`, which is the closest thing to
  iOS's field but not the same widget (M3 has no date *field* control). The 40 dp height
  and 150 dp probe-driven width are its own metrics, not iOS's 36/118.

## Questions for orchestrator
