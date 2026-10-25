# G5 — DatePicker (0.2) — implementation report

**Branch:** `task/G5-datepicker` (from `main` @ `fd55c1a`)
**Round:** implementation round 1 of 1, fix round 1 of 2
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
| Harness, iOS (iPhone Air, Node 24, absolute `HARNESS_APP_PATH`) | **pass** — `DatePicker` 11/11; whole suite 114 passed, 1 skipped of 115 (`HARNESS_TIMING` unset, D21). Re-run after the `main` merge and after fix round 1; no iOS source changed in the fix |
| Harness, Android (`emulator-5572`, adb 5042) | **pass** — `DatePicker` 11/11 in 42.7 s on the fix-round build (`/tmp/g5-h-and-dp-final.log`). Whole suite: 115 passed, 9 suites, 132.7 s (`/tmp/g5-h-and-full-postmerge.log`) - that run is this branch's code at `1536201`, i.e. fix round 1 not yet in it. After the fix the machine went to `load1` 38+ and two full runs lost other suites to the environment, not to this component (Known issues) |
| Real-input, iOS (`--control date-picker`) | **pass** — `testRealInputDatePicker` 31.9 s |
| Real-input, Android (`--control date-picker`) | **pass** — `date-picker: PASS`, 1/1 controls (`/tmp/g5-realinput-android-final.log`), on the fix-round build; the field box is 131.05 dp (`42,781 → 386,907`) where the pre-fix build measured 120.76 dp (`42,781 → 359,907`) |
| `bun run check` | **pass** end to end (`/tmp/g5-check-postmerge.log`): typecheck + bench typecheck, lint, format, 176 unit tests, `test:native`, `perf:renders` (262 checks), `nitrogen:check` (no drift), autolinking, prepare. That run is this branch at `1536201`; fix round 1 touched only a Kotlin file, which `check` does not compile. The final tree's docs were re-checked with `bunx prettier --check` |
| `bun run bench:typecheck` | pass (both tsconfigs) |
| api-extractor | **pass** — "API Extractor completed successfully"; `etc/react-native-nitro-ui.api.md` +43 lines in the feature commit, then publint, manifest, package-files (375 files) and README checks pass |
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

## Fix round 1

The compact field ellipsized its own value on Android: the Date screen's real-input field
rendered `Oct 25, 20…` inside a 120.76 dp box (`/tmp/g5-realinput-android.log`:
`"Real-input date picker" occupies 42,781 → 359,907`). That is the one Android variant an
app actually shows in a form.

Root cause, in `DatePickerFieldText.entry`. The field's width comes from a *probe* - the
widest string its mode can produce, laid out invisibly so the box never depends on the
displayed date. The candidate set was right (widest digits, every month name in the
locale, both AM/PM halves); the reduction was not. `PROBES.maxOf { formatter.format(…) }`
takes the maximum **formatted string**, and `String` is comparable, so `maxOf` ranks the
candidates *lexicographically*: `Sep` sorts after `Oct`, and a one-digit day after a
two-digit one. The alphabetical winner (`Sep 8, 2288`) is a character narrower than
ordinary dates, the box was that width, and the value was cut to it.

Two changes, both in `HybridNitroUiDatePicker.kt`:

- rank the candidates by measured width - `maxBy { WIDEST_MEASURE.measureText(text) }`.
  The measurement is an instrument, not a size: only the *identity* of the widest string
  is taken from it, and Compose still lays it out at the user's font scale. A text width
  is glyph advances times text size (`Paint` letter-spacing is in em), so the order is the
  same at every scale - which is what lets the cache stay keyed by `(mode, locale)` with no
  Dynamic Type in the key, as the brief requires.
- the value `Text` in `CompactField` stops filling the Box with `matchParentSize()`, so the
  field is `max(probe, value)` rather than exactly the probe. A locale this file has not met
  that makes the probe under-read then costs a field a few dp too wide for one measure
  instead of an unreadable date.

**Shown red.** Reverting just the ranking (`maxBy { measureText(text) }` → `maxOf { text }`)
and rebuilding fails test 8 on Android:

> testID "narrow" (the 2026 field) never reached 120.76x48.00 - last box 129.52x48.00,
> control measured 120.76x48.00

(`/tmp/g5-red-t8-mutant.log`, kept as `.log.keep`; build in `/tmp/g5-and-build-red.log`). The
test is exactly the one the brief asked for: narrow and wide dates share one sizing key, so a
box that follows a string instead of the widest one fails there. Restoring the ranking turns
the suite green again - `DatePicker` 11/11.

**Re-ran after the fix:** the Android `DatePicker` suite (11/11), Android real-input (PASS; the
same field is now 131.05 dp, the width of the widest date the mode formats), and `bun run
check`. The iOS harness was re-run after merging `main` (114 passed, 1 skipped) and the Android
whole-suite green run above is also post-`main`-merge, so C1's `NitroComposeHost` change is
covered on both platforms.

## Bench

`bun run bench --platform ios --plan quick --component date-picker` and its Android twin (4
launches per cell, 5 warmup + 20 measured iterations, on the assigned devices).

**Both runs were on a busy machine.** The runner's ceiling is load1 > 0.5 x cores (7.0 here,
14 cores): iOS sampled median 17.30 with 100 % of samples over, Android median 10.20 with
96.9 % over, because G6 was building in parallel. The runner marked the affected metrics
non-verdictable inside the cells (`Within-run spread above 10 %` on `mounted`, `JS commit`,
`JS CPU/op` in most of them). Read these as a direction, not a verdict.

- `bench/results/fd55c1a-dirty-ios-20261025T111156Z.md` - one problem:
  `mount.date-picker:rn-core:50` launch 1/4 hit `simctl ... Busy ("Application failed preflight
  checks")`, so that cell rests on 3 paired launches.
- `bench/results/fd55c1a-dirty-android-20261025T113501Z.md` - `problems: none`.

### iOS - iPhone Air

| Cell | Implementation | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | rn-core | 15.71 ms | 5.28 ms | 2.59 ms | 3.34 ms | 2.65 ms | n/a |
| mount N=50 | expo-ui-host-per-control | 49.43 ms | 30.66 ms | 2.13 ms | 3.51 ms | 253.61 ms | n/a |
| mount N=50 | expo-ui-shared-host | 312.49 ms | 17.90 ms | 1.04 ms | 1.44 ms | 321.06 ms | n/a |
| mount N=50 | nitro-ui | 16.11 ms | 22.03 ms | 1.51 ms | 1.76 ms | 22.67 ms | n/a |
| update N=50 | rn-core | 16.08 ms | 3.02 ms | 882.81 us | 1.10 ms | 3.24 ms | n/a |
| update N=50 | expo-ui-host-per-control | 127.25 ms | 18.75 ms | 1.89 ms | 5.86 ms | 119.21 ms | n/a |
| update N=50 | expo-ui-shared-host | 111.24 ms | 15.39 ms | 931.36 us | 1.36 ms | 95.11 ms | n/a |
| update N=50 | nitro-ui | 16.08 ms | 2.30 ms | 1.28 ms | 1.43 ms | 7.55 ms | n/a |
| memory N=200 | rn-core | n/a | n/a | n/a | n/a | n/a | 32.2 KiB |
| memory N=200 | expo-ui-host-per-control | n/a | n/a | n/a | n/a | n/a | 229.6 KiB |
| memory N=200 | expo-ui-shared-host | n/a | n/a | n/a | n/a | n/a | 222.8 KiB |
| memory N=200 | nitro-ui | n/a | n/a | n/a | n/a | n/a | 199.3 KiB |

Launch-paired ratio to `rn-core`: `nitro-ui` mount **1.02x** presented, 4.35x mounted, 0.60x JS
commit, 0.54x JS CPU/op, 9.61x UI CPU/op; update **1.00x** presented, 0.75x mounted, 1.44x JS
commit, 1.28x JS CPU/op, 2.35x UI CPU/op; memory **6.20x**. Both `expo-ui` arms are 3.1x-7.9x
presented and 107x-118x UI CPU/op on mount: they build a UIKit/SwiftUI tree per row and pay a
JS->native round trip for the same date.

### Android - `nitroui_t02`

No `expo-ui` rows: `@expo/ui` has no mountable date field on Android, so those cells are omitted
(see Known issues).

| Cell | Implementation | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | rn-core | 94.34 ms | 53.10 ms | 7.62 ms | 8.64 ms | 31.75 ms | n/a |
| mount N=50 | nitro-ui | 183.89 ms | 164.40 ms | 11.73 ms | 12.76 ms | 140.66 ms | n/a |
| update N=50 | rn-core | 98.82 ms | 63.60 ms | 5.67 ms | 7.57 ms | 23.37 ms | n/a |
| update N=50 | nitro-ui | 148.72 ms | 43.85 ms | 8.89 ms | 9.56 ms | 35.06 ms | n/a |
| memory N=200 | rn-core | n/a | n/a | n/a | n/a | n/a | 28.4 KiB |
| memory N=200 | nitro-ui | n/a | n/a | n/a | n/a | n/a | 135.5 KiB |

Ratio: `nitro-ui` mount 1.93x presented, 3.27x mounted, 1.60x JS commit, 1.31x JS CPU/op, 4.31x
UI CPU/op; update 1.48x presented, 0.69x mounted, 1.35x JS commit, 1.18x JS CPU/op, 1.38x UI
CPU/op; memory 4.59x. Android's `presented` column is the frame-quantised one G1-G4 recorded,
so the mount gap there is inside its own noise.

What the cells say within that noise: the frame the user sees is not where hosting is paid
(iOS `presented` 1.02x mount / 1.00x update); the 50-host mount is (iOS 22.03 ms mounted against
rn-core's 5.28 ms - every instance builds a `UIHostingController` and probes its formatter for
the widest string its mode can produce, and Android's field measures that probe as an invisible
`Text` at layout time); memory is the honest penalty, same shape as G1-G4 (199.3 KiB vs 32.2 KiB
per instance on iOS). `update` is the column a real form spends, and it is 2.35x iOS / 1.38x
Android UI CPU per 50 value writes.

A verdictable run needs the machine to itself. It did not get one here: G6 was compiling for
most of the afternoon, and the human's own sessions keep load1 in the tens. See Questions.

- **These rows are two changes old.** They were built at `fd55c1a-dirty`, before C1 landed the
  Android shared-host fix in `NitroComposeHost.kt` and before fix round 1 changed the compact
  field's box from 120.76 dp to 131.05 dp. Both touch what the Android cells measure, so the
  Android table in particular is a direction that has since moved. See Questions.

## Screenshots

`docs/tasks/G5-datepicker/`, on the Date screen (`example/src/DatePickerScreen.tsx`) of the
example app: iOS on iPhone Air, Android on `nitroui_t02` (1080x2424, 420 dpi). The Android
frames are from the fix-round build.

- `ios-light.png` - the top of the screen: the two real-input fields (the uncontrolled one and
  the one whose parent refuses), their readouts, and the controlled graphical calendar.
- `ios-variants.png` - the compact fields for `date`, `time` and `datetime`, which iOS renders
  as an inline accent-coloured value, above the inline graphical picker.
- `ios-dialog.png` - the compact field's popover: graphical calendar with the hour and minute
  wheels beside it, presented by the mount that owns it.
- `ios-wheel.png` - the wheel variant: iOS's wheel picker, selected row highlighted.
- `ios-dark.png` - the top of the screen in dark mode.
- `android-light.png` - the same opening on Android: both real-input fields at the box the
  control measured, the readouts, and the controlled inline picker below, in light mode.
- `android-compact.png` - the compact row: `Jul 4, 2026`, `1:45 PM` and `Jul 4, 2026 1:45 PM`,
  each field wide enough for what it shows. The `datetime` field is the widest string the
  probe has to cover, which is what fix round 1 is about.
- `android-dialog.png` - `DatePickerDialog` opened from the compact date field: scrim, header,
  calendar, Cancel/OK, with the three compact fields still readable behind it.
- `android-inline.png` - the inline `DatePicker` (its header and calendar) and the inline
  `TimePicker` under it.
- `android-wheel.png` - the wheel section, where Android has no wheel and renders the inline
  picker instead, and the disabled row below: both variants dimmed and still laid out.
- `android-dark.png` - the top of the screen in dark mode. `Oct 25, 2026` is today's date: the
  value that rendered as `Oct 25, 20…` on the pre-fix build.
- `android-dark-compact.png` - the compact row in dark mode.

## Known issues and follow-ups

- **The Android bench rows need a re-run** (see the Bench bullet): they predate C1's shared-host
  fix and fix round 1's width change, and neither run was verdictable at the load it was taken
  at. The iOS rows need one too, for the load reason alone.
- **The whole Android suite has not been green since fix round 1** - not because of this
  component. Two full runs after the fix hit a machine at `load1` 11-44 (the human's own apps
  plus another task building): one lost `Slider` on its 1 000 ms render timeout, the second
  lost five suites, `DatePicker` among them, to "the native app crashed while preparing to run
  this test file / the app process exited, but no crash log lines were found" with the emulator
  at 51 % CPU. The `DatePicker` suite alone is green on that same build in 42.7 s, and the
  whole suite was green on this branch's code at `1536201`. Both logs are kept.
- **`assembleDebug` without `-PreactNativeArchitectures=arm64-v8a`** packages every ABI (the
  all-ABI build left here was 235 MB against this one's 78 MB). Every Android command in this
  report passes the flag; it is worth a line in the device docs.
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
  and the probe-driven width are its own metrics, not iOS's 36/118: real-input measures it at
  131.05 dp for `date` mode in the emulator's `en_US`, and that number moves with the locale's
  date format, which is exactly why it is a probe rather than a constant.

## Questions for orchestrator

1. **Bench re-run: when, and does Android get one too?** Every date-picker row on this branch
   came from `fd55c1a-dirty` at a load the runner itself flagged as non-verdictable, and both
   the C1 shared-host fix and fix round 1's box change (120.76 dp -> 131.05 dp) move what the
   Android cells measure. Options: (a) I re-run `--component date-picker` on both platforms in
   the post-05:00 window, which is the only quiet slot I have; (b) fold it into a 0.2
   release-readiness run with the other five components; (c) accept the rows as directional and
   say so in `benchmarks.md`. **Recommend (a)**, and (b) for the other components - a re-run of
   one component while the others stay old is honest as long as the table says so.
2. **Who runs `bun run smoke:rn-cli` and `smoke:expo`?** G4 and I both stopped at the same
   place: the per-control ready line is updated and unit-tested, but the pack + Expo + RN-CLI
   cycle is a release-readiness gate, and it is not cheap. **Recommend** one scheduled task
   before 0.2 rather than leaving each component task to guess.
3. **The Android `expo-ui` date-picker arm.** `@expo/ui` has no dialog or field form of the
   picker on Android, so that arm renders an inline M3 calendar while every other arm renders a
   compact field, and its `initialDate` is a seed rather than a controlled value, so
   `update.date-picker` prices a props write there and a native value change here. Keep it with
   that caveat in the arm file and in the results header, or drop the rows so nobody reads a
   ratio into them? **Recommend keep + a header line**, because dropping it silently would make
   the Android table look comparable to G4's.
4. **`scripts/bench/build.mjs` runs plain `pod install`, not `bundle exec pod install`**, so
   every bench build rewrites the `COCOAPODS:` stamp in `example/ios/Podfile.lock` from 1.17.0
   to the 1.15.2 on `PATH` and lands in someone's diff. One-line fix, in bench infra rather
   than in this component. **Recommend** a small follow-up task; I have not touched it.

Nothing here blocks reviewing the component: the gates that cover it are green on the final
build and the four items are all "who owns the next run".
