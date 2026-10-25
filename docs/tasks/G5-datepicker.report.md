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
- `ios/components/DatePicker/HybridNitroUiDatePicker.swift` (new; 1355 lines after fix round 1)
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt` (new; 1721 lines
  after fix round 1)
- `ios/core/NitroSwiftUIHost.swift`: `+12` lines — a `containingViewController` accessor,
  the only core change. A component that presents needs the containment the host already
  creates (`needsContainment`); nothing else in the library uses it, and no shipped
  control's behaviour moves.
- `ios/core/NitroUiDeclaredFallbacks.swift`, `…/core/NitroUiDeclaredFallbacks.kt`,
  `NitroUiPackage.kt`: register the component and its declared fallback.

**Tests, harness, bench, example**
- `example/__tests__/DatePicker.harness.tsx` — 12 on-device tests
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

These are the gates as they stood before the review; fix round 1 re-ran every one of them and its results are in its own section.

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
| 5 | round-trips an instant across a DST boundary | Android: resolve the calendar fields in UTC | ✕ 4 failed — **superseded**: that mutation priced the test seam; deleting the real UTC-midnight conversion stayed green (M6) |
| 6 | presents nothing after the mount that opened it is gone | both: a presentation that outlives its mount (the B1 failure mode) | ✕ both — **superseded**: the reds used a clickable overlay in the app's own window, and the real dialog leak (`android-t6b`) passed 11/11 (M5) |
| 7 | is inert while disabled | iOS: `disabled` guard removed | ✕ both |
| 8 | gives two compact pickers one box, whatever dates they show | Android: the width probe follows the value | ✕ 1 failed |
| 9 | keeps a date field and a time field at their own boxes | `sizingVariantFor` drops `mode` from the key | ✕ |
| 10 | re-measures the field when the mode changes | iOS: the mode setter stops asking for a re-measure | ✕ 1 failed |
| 11 | starts a remount from its own default, not the previous mount's | iOS: `didApplyDefault` survives the recycle; Android: native never applies its default | ✕ both — **disclosure**: the Android half was the model's default path, not the recycle. `android-t10` (didApplyDefault survives `prepareForRecycle`) was green, because view recycling is off by default in this example app (`core.md` §6) |

Row 12 is missing on purpose: the suite had eleven tests when this table was written. The
twelfth, `shows the month the value is in, and moves the page with it`, is the review's M1 guard
and is shown red in fix round 1's section.

Rows 5, 6 and 11 are marked as superseded after the review: the kept logs
(`/tmp/g5-red-android-android-t5.log`, `/tmp/g5-red-android-android-t6b.log`,
`/tmp/g5-red-android-android-t10.log`) show the *named* failures staying green, and the reds
above came from substitutes — a mutation of the test seam's own calendar arithmetic, and a
clickable `View` added to the app window on each platform. Fix round 1 rebuilt all three
guards so the property named in the row is the property priced; its table has the runs that
hold.

The sizing suite's own poison (a `seedSizingSize` no date picker has, then an environment
bump) is what makes #1, #8, #9 and #10 able to fail at all: with a correct fallback a
missing correction would be invisible.

`scripts/__tests__/bench-gate.test.js` gained a `date-picker` block (5 cases, 53 total
passing). Shown red by making `componentOf` answer `segmented-control` for a
`date-picker` scenario: `divides a DatePicker arm by the DatePicker control`,
`fails conclusively when the DatePicker arm doubles` and
`schedules every date-picker cell and every arm` go red (the ratio becomes 1.47×, the
schedule becomes empty), then green again on restore.

## Fix pass before the review: the compact field ellipsized its value

(D19 does not count this as a fix round - it landed inside the implementation window, before the review. The review's fix round is the section after this one.)

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

## Fix round 1 — the review's M1–M7 (this round)

The review (`docs/tasks/G5-datepicker.review.md`, verdict NEEDS-WORK) is the brief for this
section. All seven must-fixes are in, each guard shown red against the thing it is supposed to
price, and the report/doc claims the review listed are corrected throughout this file and
`docs/components/date-picker.md`. One thing the review asked for could not be shown red on iOS,
and M5 says so plainly instead of claiming a run that did not happen.

Files this round: `HybridNitroUiDatePicker.kt` (1721 lines), `HybridNitroUiDatePicker.swift`
(1355), `DatePicker.harness.tsx` (1462, 12 tests), `RealInputTests.swift`,
`example/src/DatePickerScreen.tsx`, `docs/components/date-picker.md`, this report, the two
retaken Android screenshots, and `bench/src/implementations/expoUi.android.tsx` (a comment).

### M1 — the calendar opens on the value's month, and a bounds change rebuilds it

The second positional argument of `rememberDatePickerState` is `initialDisplayedMonthMillis`,
not a minimum, so the call that read like a minimum left Material 3 to fall back to `today`
(or to the minimum). `android-dialog.png` on `d113c79` is the record: July's header over an
October grid. And `rememberDatePickerState`'s `rememberSaveable` has an empty inputs array, so
the state read its month, year range and selectable days once and never again.

In `HybridNitroUiDatePicker.kt`:

- both date arms now name the argument — `initialDisplayedMonthMillis =
  model.toUtcMonthStartOfLocalDay(shown)` (inline `:1019`, dialog `:1076`);
- `key(model.minimum, model.maximum, yearRange) { rememberDatePickerState(…) }`, so React
  widening the range re-creates the state instead of leaving a calendar whose new value falls
  outside its `yearRange` — which Material 3 stores as *no selection at all*, showing no lit
  day while the field reads a date;
- `syncDatePicker` moves the page when the value moves (`:1229`), because a page is a property
  of the state, not of the model, and the seed is read once;
- the review's other suggestion — assign `state.selectableDates` in an effect keyed on the bounds
  — is not available on the public type: `DatePickerState` exposes `yearRange` and `selectableDates`
  as read-only (`yearRange` has no setter anywhere public), and `rememberDatePickerState` hands back
  the interface. The rebuild is the route that covers both facts at once, and it is what
  `fr2-m1c` prices. The comment at `:1009` records the reason rather than leaving a reader to
  rediscover it;
- new `publishCalendarFacts` (`:1190`) publishes the calendar's own displayed month and whether
  it holds a selection, as two extra fields of `nuiTestStateReport`:
  `"<ms>|<presented>|<calMonth>|<hasSelection>|<livePresentations>"`. Without them the page and
  the lost-selection failure are invisible to the harness;
- the two comments claiming the state "keys its state on the object" now say what is true.

**New test** `shows the month the value is in, and moves the page with it`. The three months are
derived from the device clock — value three months out, minimum four months before that, rerender
eleven months further — because with the positional bug the page lands on *today's* month, so a
hardcoded July would pass by luck in July. It asserts the page equals the value's month, that a
bounds change keeps the selection lit (the `hasSelection` oracle, which is what the `key()`
rebuild has to satisfy), and that a rerendered value moves the page.

| Mutation | Red |
| --- | --- |
| `fr2-m1a` — `initialDisplayedMonthMillis` back to `null` (the pre-fix shape) | ✕ 1 failed — `"page-plain" … is not showing 2027-01 … (month 2026-10)` |
| `fr2-m1b` — the page-sync effect no longer writes `displayedMonthMillis` | ✕ 1 failed |
| `fr2-m1c` — the `key(…)` wrapper removed | ✕ 1 failed |

`/tmp/g5-fr2-red-and-fr2-m1{a,b,c}.log`, and `fr2-m1a` re-run at 18:00 in
`/tmp/g5-fr2-red-android-fr2-m1a.log`. All three on `shows the month the value is in…`,
1 failed / 11 passed.

The same A/B as M2's — reviewed Kotlin installed, then this round's, one Metro, same JS
(`/tmp/g5-fr3-ab.log`, dumps as above) — puts the bug and the fix on the same screen. The inline
calendar at the top of the Dates screen holds `2026-01-01`:

| the calendar's own month header, from `uiautomator` | reviewed build | this round |
| --- | --- | --- |
| headline `Current selection: Thursday, January 1, 2026` | `October 2026` | `January 2026` |
| headline `Current selection: Saturday, July 4, 2026` | `October 2026` (both calendars) | `July 2026` |

Reviewed: the header is the device's month, not the value's — today's month on the day the gate
ran, exactly as `android-dialog.png` on `d113c79` shows. This round: the header is the value's
month in every case, and the compact dialog opened from the labelled field dumps headline
`Jul 4, 2026` over a `July 2026` grid (`/tmp/g5-ab-uia-after-dialog.xml`).

The two Android screenshots are retaken on the fixed build, and their captions say what to look
at. The iOS side of M1 got its own fix (see the crash note in M1-iOS below).

**M1-iOS.** The same class, different mechanism: `UIDatePicker` applies a new `date` *before* a
new `maximumDate`, so a write that moves the value past the old upper bound gets clamped by
UIKit mid-update and the following reload asserts in `UICalendarView._setVisibleMonth:` — a
SIGABRT, not a glitch — two reports are kept,
`~/Library/Logs/DiagnosticReports/NitroUiExample-2026-10-25-160158.ips` and `-160432.ips`, each
aborting with `-[UICalendarView _setVisibleMonth:animated:]` at the top of the UIKit frames
under `_UIDatePickerCalendarView _reload`. `.id(boundsIdentity)` (`:493`) rebuilds the control
from the new bounds before it has a value to clamp. `fr2-m1ios-id` is the mutation that removes
the line; it aborts the app rather than failing an assertion, so it is kept rather than queued
here. `docs/components/date-picker.md` documents why both platforms re-create the control on a
bounds change.

### M2 — Android: the label is on the control, and a disabled picker is one disabled node

`semantics { contentDescription = label }` and `disabled()` sat on the container `Box`, which is
the SF2 finding again: TalkBack got a stop named "Departure", then a nameless `Oct 25, 2026,
button`. And the inline variant had no input blocking at all, behind a `[blockedInputModifier]`
reference to a modifier that did not exist.

- `Modifier.nuiFieldSemantics(label, value, enabled)` (`:809`) goes on the `OutlinedButton`
  itself: `contentDescription` = label, `stateDescription` = the same localised string the field
  paints, `disabled` when disabled. `stateDescription` is not decoration — with a
  `contentDescription` set, TalkBack reads that as the node's *name* and drops the text, so
  without it the field says what it is and never what it holds.
- `Modifier.nuiControlSemantics` (`:821`) does the same for the `DatePicker` / `TimePicker`
  nodes, and when disabled adds `nuiBlockInput()` (an `Initial` pointer-input pass) plus
  `clearAndSetSemantics { disabled(); … }`, so the calendar becomes one disabled node instead of
  a tree of 120 nodes whose 34 day cells stay enabled and activatable (measured below).
- The container `Box` carries no semantics; the dangling reference now points at `nuiBlockInput`.

The harness has no a11y query, so this is read the way the real-input script reads Android:
`uiautomator dump` of the Dates screen, taken twice — once with the reviewed `d113c79` Kotlin built
and installed, once with this round's — so the comparison measures the difference instead of reading
the diff. `/tmp/g5-fr3-ab.sh` does it; its log records for each phase the md5 of the Kotlin it
compiled (`c161062a…` reviewed / `fdec2f70…` this round), the md5 of the APK gradle produced, and the
md5 the device reported for the APK at its installed path (`9eb190aa…` installed 19:40:22,
`d9e51491…` installed 19:42:08 — the same two pairs), so "which build is on the screen" is not an
assumption. One Metro served 8294 for both phases, so the JS is byte-identical across them and only
the Kotlin differs. The trees are `/tmp/g5-ab-uia-before-{top,bottom}.xml` and their `-after-` twins
(+ `scroll0…9` and `after-dialog`), and `/tmp/g5-ab-analyze.py` recomputes every count below.

Two things about this measurement are worth recording, because the first attempt at it was wrong and
an earlier draft of this section quoted that attempt. (a) The first run lost the Metro port to a
server another process owned, the app fell back to `loadScriptFromAssets` and drew the RedBox, and
the "before" and "after" files were copies of one older good dump — which is why they were
byte-identical; those files are withdrawn and nothing below rests on them. (b) Matching
`<node … />` with a regex sees only *leaf* nodes: the top of this screen is 184 nodes, not the 110
that regex counts, and the label nodes are all parents. Both mistakes read as "no difference".

**The label: the name moves from above the control into it.** At the labelled `compact` field's
frame — `[42,771][386,897]` for the `Real-input date picker` row, and `[42,2256][386,2382]` =
344 × 126 px = 131.05 × 48 dp for `Departure date`, the field's measured control box:

```
d113c79   View desc='Real-input date picker' [42,771][386,897]      <- the container, not pressable
            View clickable=true [42,772][386,897]                   <- what a finger presses: nameless
              TextView 'Oct 25, 2026' · Button [42,771][386,897]
this round View clickable=true [42,771][386,897]                    <- one pressable node
              View desc='Real-input date picker' · TextView 'Oct 25, 2026' · Button
```

In the reviewed build the name sits on a non-pressable node one level *above* the pressable one,
which holds the value and the button role and carries no name — the two-stop shape `core.md` §3
bans, and what the review predicted from `:726-729`. On this round's tree the pressable node has
name, value and role inside it, which is what Compose merges into one TalkBack stop. Measured on the
device with only the Kotlin changed; `/tmp/g5-fr3-ab.log`'s `LABELLED CONTROL` and `ancestors` lines
print the chains.

**`disabled` reaches the inline calendar.** At the disabled inline picker's frame,
`[42,0][1038,537]` in both builds' bottom dumps (both scroll to the same stop, so the frames line
up):

| | nodes under the frame | `clickable=true` | the frame's own node |
| --- | --- | --- | --- |
| `d113c79` | 120 | 34 | unnamed, `enabled=true` |
| this round | 3 | 0 | `desc='Jul 4, 2026'`, `enabled=false`, no children |

Those 34 clickable nodes are M3's day cells — Canvas-drawn, so they carry no text (an earlier draft
queried 1-2 digit *text* cells, found none, and wrongly read that as no cells). Reviewed: one
disabled ancestor that says nothing about them and 34 enabled, activatable cells under it. This
round: `clearAndSetSemantics` leaves the calendar as exactly one node, disabled and named with the
localised value, and `nuiBlockInput` is what keeps a finger out of it — the harness's disabled case
is the behavioural half of that claim. The enabled calendar two rows up (`[42,795][1038,2139]`) is
the control for the change and is identical in both dumps: 121 nodes, 34 clickable, 12 with a
`contentDescription` (`January 2026`, the seven weekday headers, `Change to previous month` and its
neighbours, the headline), 0 disabled.

**What these dumps still cannot show.** `uiautomator`'s XML has no attribute for `stateDescription`,
so the value half of `nuiFieldSemantics` is evidenced by the code and by the iOS half of the same
bug, where XCUITest does print the value (M3). The dumps also cannot show TalkBack speaking — they
show the tree it walks.

### M3 — iOS: a labelled compact field announces the localised date as its value

`OptionalDatePickerAccessibility` calls `content.accessibilityLabel(label)` on the whole content,
and for `compact` that content is our own `Button`, whose only accessible text was the date —
so the label *replaced* it and VoiceOver said "Departure, button" and nothing else. The field now
adds `.accessibilityValue(Text(NitroUiDatePickerField.label(millis:mode:)))` (`:440`), the same
localised string it paints, keeping the label as the label. The `.graphical` / `.wheel` variants
were already fine (SwiftUI keeps the value).

Verified in the UI test, on the labelled `low-date` row: it reads the innermost `.button` in the
`testID` subtree and asserts `label == "Departure date"` and that `value` contains the year, and
prints the subtree it walked (`real-input low row a11y …` in `.real-input/ios/xcodebuild-test.log`)
so the tree a screen reader walks is written down. Quoted from the unmutated run of the final tree
(`testRealInputDatePicker` passed in 117.4 s; the log is copied out of `.real-input/`, which every
later run overwrites, to `/tmp/g5-fr3-ios-ri-1921-test.log`):

```
a11y [the testID node]:  id="low-date" label="Departure date" value=""            frame=(16.0, 825.33, 103.0, 36.67)
a11y [descendant ×3]:    label=""                                                   (the RN wrappers, no text)
a11y [descendant]:       type=9 label="Departure date" value="4 Jul 2026"  frame=(16.0, 825.67, 103.0, 36.33)
```

The last line is the node VoiceOver stops on — label *and* localised date, en-GB spelling. The
first is what the fix replaced: a wrapper that carries the label and no value, which is the SF2
shape with the roles swapped. `fr2-m3` (delete the `.accessibilityValue` modifier, rebuild, reinstall) makes the assertion red on the device — `testRealInputDatePicker` **failed** in 68.8 s with

> `RealInputTests.swift:523: … XCTAssertTrue failed - the labelled compact field announced
> value="Optional()", which is not a date: with a label set the label *replaces* the control's own
> text, so the localised day has to be announced as the value …`

and `real-input (ios): 0/1 controls passed` (`/tmp/g5-fr2-red-ios-fr2-m3.log`, 19:01). The same
command on the unmutated tree, minutes earlier, is the pass quoted in the gate table (124.8 s,
`/tmp/g5-fr2-red-ios-fr2-baseline.log`), so the only difference is the modifier.

### M4 — iOS: the popover may point up or down, and the bottom-of-screen case is on the device

`permittedArrowDirections = .up` let UIKit shrink the bubble to the room *below* the field, and
the comment's reason ("a bubble that flipped above the field would point at the tab bar") is
simply wrong — a bubble above the field points down at the field. Now `[.up, .down]` (`:794`),
with the comment fixed.

`example/src/DatePickerScreen.tsx` gained a last row, `low-date`, and `assertLowRowField()` in
`RealInputTests.swift` drives a finger case at it: it scrolls until the page stops moving,
asserts the field is below the mid-line with under 250 pt under it (so the check cannot pass on
a screen that did not scroll into the case), presses it with a real tap, then asserts three
things about the bubble: at least 300 pt wide (seven tappable columns), at least 250 pt tall (not
compressed into the room under the field), and `maxY <= field.minY + 8` — with that little room
below, the bubble has to be *above* the field, pointing down at it. That last one is the
assertion `.up`-only fails: UIKit keeps the popover below a field when it may not flip, however
little room is down there. It also counts the day cells in the calendar it presented.

On device (iPhone Air, 420 × 912 pt, same kept log):

```
real-input low row: field=(16.0, 825.33, 103.0, 36.67) screen=(0,0,420,912) roomBelow=50.0
real-input low row: press 2 -> popovers=1 windows=2
real-input low row: popover=(10.0, 488.33, 336.0, 337.0)
```

The field's last row sits 50 pt off the bottom — the case the review asked for — and the bubble
is 336 × 337 with its bottom edge at y 825.3, exactly the field's top edge: it flipped above and
points down at the field. `fr2-m4` (`permittedArrowDirections = .up`) leaves UIKit no choice but
to keep it below and squeeze 337 pt into 50, which fails both the height and the `maxY` assertion.
The first press of that run did not present anything and the second did (`press 1 ->
popovers=0`), which is why the helper retries rather than assuming one tap lands.

`fr2-m4` (`permittedArrowDirections = .up`) was then run on the device, and it is red exactly
where the review said it would be — `testRealInputDatePicker` **failed** in 98.5 s:

> `RealInputTests.swift:575: XCTAssertGreaterThanOrEqual failed: ("15.999677…") is less than
> ("250.0`) — the last row presented a popover **16.0 pt tall into 50.0 pt of room**: UIKit
> compressed the calendar into the space under the field instead of putting the bubble above
> it, and the month a finger has to use is cut off

(`real-input (ios): 0/1 controls passed`, `/tmp/g5-fr2-red-ios-fr2-m4.log`, 19:03). A 337 pt
calendar rendered as a 16 pt strip: the whole month is gone, which is the user-visible cost
of the one-direction list. The same binary minutes earlier, with `[.up, .down]`, is the pass
above (`/tmp/g5-fr2-red-ios-fr2-baseline.log`).

### M5 — the leak test counts live presentations

The witness-press oracle could not see an Android dialog: a `Dialog` is a separate window and the
harness dispatches its touch into the app's own, which is exactly why the kept `android-t6b` run
passed 11/11. The assertion is now structural, in the one place that survives a drop:

- Android: `DatePickerModel.livePresentations`, an `AtomicInteger` incremented and released by a
  `DisposableEffect` inside `Presentation` — the composition that owns the window;
- iOS: a process-wide counter in `NitroUiDatePickerPresentation`, opened by a `countedOpen`
  ticket in `present`'s completion and closed in `presentationControllerDidDismiss` or
  `dismissNow`'s completion, one decrement per presentation;
- both are the fifth field of `nuiTestStateReport`, and the harness reads it through a *fresh*
  mount after the drop (the dropped view has no handle left). It also asserts the count is 1
  while the dialog is open, so a counter stuck at zero cannot satisfy the rest vacuously. The
  witness press stays as the second signal — "is it in the way", not "is it there".

| Mutation | Red |
| --- | --- |
| `fr2-m5-android` = `android-t6b` — `onDropView` neither closes the dialog nor disposes the composition (the real B1 shape) | ✕ 1 failed — the live-presentations assertion |
| `fr2-m5-iosf` — iOS `countOpened()` stops counting | ✕ 2 failed |
| `fr2-m5-ios`/`iosb`/`iosc`/`iosd`/`iose` — the iOS closing sites removed, in five shapes | ✓ stayed green |

Those last five are the honest half of M5: **the iOS twin of `android-t6b` cannot be shown red
here, because on iOS that mutation does not leak.** UIKit tears the popover down with the host
view, `presentationControllerDidDismiss` runs, and the counter really does fall back to 0. The
iOS counter is still worth having — it is what turns "we assume SwiftUI owns this" into a number
the test reads — but the Android half is the one the review's named failure mode is guarded on,
and this report does not claim an iOS red that did not happen.
`/tmp/g5-fr2-red-and-fr2-m5and.log`, `/tmp/g5-fr2-red-ios-fr2-m5-iosf.log`.

### M6 — the DST test exercises the conversion, and the zone is asserted

The pick direction used to run the *test seam's* own `Calendar` arithmetic (`resolveTestSelection`),
never the `toUtcMidnightOfLocalDay` / `fromUtcMidnightKeepingTimeOfDay` pair that a real tap runs —
which is why deleting the conversion (`android-t5`) stayed green with 11 passing.

- `nuiTestSelect` now routes the day through the picker's own path:
  `applyUserSelection(fromUtcMidnightKeepingTimeOfDay(toUtcMidnightOfLocalDay(…), displayed))`.
- `dst-set` has an `onChange` recorder and asserts `eventLog` stays empty: a conversion that
  reads the wrong day makes the control *emit* the instant it was just handed, which a polling
  test cannot see and this one can.
- The zone is asserted rather than assumed: the test fails loudly if the device's January and
  July `getTimezoneOffset()` are equal, fails if none of its seven instants has a local day that
  differs from its UTC day, and logs the zone on both platforms. The kept runs show
  `dst zone: Wed Jul 01 2026 GMT+0100 winterOffset=0 summerOffset=-60` and
  `dst cases: 1 of 7 cross a UTC day` — so the discriminating instant is doing work on both.
  Both gate devices are on the host's zone, `Europe/Lisbon` (`winterOffset=0` / `summerOffset=-60`
  is WET/WEST), which is *verified* by that assertion rather than pinned by the suite — and the
  gate ran on 25 October, the day the offset actually changes here, so `AUTUMN_EVE`/`AUTUMN_DAY`
  sit on either side of a real transition. Pinning it would need a device-wide `time_zone` change
  and a re-run of every other gate on this tree for it; asserting it is what makes a future
  non-DST environment fail loudly instead of passing quietly, which is the property M6 asked for.
- `fr2-m6` (the same patch as `android-t5`: the conversion returns the raw millis) is
  **✕ 1 failed**, on `round-trips an instant across a DST boundary`
  (`/tmp/g5-fr2-red-and-fr2-m6.log`).
- `docs/components/date-picker.md` no longer claims the harness pins Lisbon at `00:30`; it says
  the suite refuses to run vacuously and logs the zone.

### M7 — the declared fallbacks are measured, final, and registered

`TODO(G5)` and `PROVISIONAL (G5)` are gone. Both files now state where the number came from:

- Android **131 × 48 dp** (`FALLBACK_WIDTH_DP`/`FALLBACK_HEIGHT_DP`, `:1385`), from the harness
  log `variants (android, …): field=131.05x48.00`. `131.0` is inside the sizing engine's 0.5 dp
  epsilon (`cpp/NitroUiSizingEngine.hpp:170`), so the cold mount is laid out at its own size and
  pays no correction; the height was the wrong one before — 40 dp, Material's outline, under a
  control that is 48 dp because M3 puts an interactive minimum under it. The comment no longer
  calls 150 "Material 3's own floor (40 dp)".
- iOS **103 × 36.33 pt** (`fallbackSize`, `:968`), from `variants (ios, …): field=103.00x36.33`.
  The review asked for the `en_US` number; the gate simulator's `AppleLocale` is `en_PT`, so the
  declared pair is what the control measures *there* — the configuration the gates actually run.
  The same field measures 107.00 pt under `en_US`, which the code comment says. The height (36.33)
  is the locale-independent one, and it is the number M7 called wrong on Android. An `en_US` cold
  `compact` `date` mount is therefore laid out 4 pt narrow for its first frame and pays one
  horizontal correction — the safe direction to be wrong in (`core.md` §7: the failure mode worth
  avoiding is a control that is too small, which truncates a month name and shrinks a hit target).
- Both are registered in `NitroUiDeclaredFallbacks.{kt,swift}`, and the width stays locale-dependent
  by design (it is a probe, not a constant), which the page now says.
- What prices this, and what does not: the numbers come from the device log quoted above, and the
  sizing suite's poison (a `seedSizingSize` no date picker has — `WRONG_SIZE` = 13.25 × 66.5, then
  three corrections demanded) is what keeps "the engine outranks a wrong fallback" honest. Nothing
  in the DatePicker suite asserts the *first frame* of a cold mount, which is the assertion that
  would move if these two numbers drifted: `ColdSizing.harness.tsx` (T14's, run by
  `harness:cold:ios` / `harness:cold:android`) covers Slider and Switch only, and adding a third
  component there is that file's owner's call — recorded as a follow-up rather than done here.

### Gates on this round's tree

| Gate | Result |
| --- | --- |
| `bun run check` | **pass** — exit 0 on this round's tree at `load1` 4.9: typecheck, bench typecheck (both tsconfigs), eslint, prettier, jest (176 tests / 11 suites, 184 s), `test:native`, `perf:renders`, nitrogen drift, autolinking, `prepare`, api-extractor, publint, package-files (375 files), readme examples (`/tmp/g5-fr3-check.log`). Re-run green on this round's tree after its bench and gate sections landed: exit 0, 176 tests, 262 `perf:renders` checks, no nitrogen drift over 160 generated files / 24 patched views, `publint --strict`, the 375-file manifest and 5 README blocks (`/tmp/g5-fr3-check-final.log`). Only this report has changed since that run, and `bun run format` is green over the tree as committed |
| Harness `DatePicker`, iOS (iPhone Air, Node 24, absolute `HARNESS_APP_PATH`) | **pass** — 12/12 in 16.9 s, re-run on the committed tree at 21:03 against the `.app` whose binary is stamped 19:23, after the last write to any Swift file (19:04) (`/tmp/g5-fr3-final-ios-dp.log`); the round's earlier 12/12 is `/tmp/g5-fr2-ios-base.log` |
| Harness `DatePicker`, Android (`emulator-5572`, adb 5042) | **pass** — 12/12 in 11.8 s, re-run on the committed tree at 20:57 against `app-debug.apk` md5 `d9e51491…`, the md5 the A/B below recorded when it installed this round's Kotlin (whose md5, `fdec2f70…`, is the committed file's); the round's earlier 12/12 is `/tmp/g5-fr2-and-base2.log` (`/tmp/g5-fr3-final-and-dp.log`) |
| Harness, whole suite, iOS | **pass** — 115 passed, 1 suite skipped, re-run on the committed tree at 21:04 in 65.3 s (`/tmp/g5-fr3-final-ios-full.log`); the round's first full run was also 115 passed, 1 suite skipped (`MountChurn.harness.tsx`'s "is Android-only" placeholder, skipped by every earlier iOS run here too), 99.9 s, on the `.app` built from this tree at 18:17 (Node 24, absolute `HARNESS_APP_PATH`, `HARNESS_TEST_TIMEOUT=90000`; `/tmp/g5-fr3-ios-full.log`) |
| Harness, whole suite, Android | **pass** — 116/116, 9 suites, re-run on the committed tree at 20:59 in 72.2 s against the same `d9e51491…` APK (`/tmp/g5-fr3-final-and-full.log`); the round's earlier green run is `/tmp/g5-fr3-and-full2.log`. The first run of this gate, at 18:39 with `load1` 10.35 / `load5` 44.42, was 115/116: `Progress > honours an explicit size instead of its own box` hit its 1000 ms render timeout. `Progress.harness.tsx` is not a file this round touched, the same suite was 116/116 at `load1` 3.10 earlier on the same code (`/tmp/g5-fr5-and-full.log`) and green again minutes later on this tree, so the failure was the host. A render timeout under 14x that load is an environment failure, and it is recorded here rather than hidden behind the green re-run. |
| Real-input `--control date-picker`, iOS | **pass** — `testRealInputDatePicker` passed in 117.4 s, `** TEST EXECUTE SUCCEEDED **`, `real-input (ios): 1/1 controls passed`, on the unmutated tree at 19:26 — after the last write to any iOS source, against the 19:23 `.app`, so it is this tree (`/tmp/g5-fr3-ios-ri-1921.log`; the detailed xcodebuild log is copied to `/tmp/g5-fr3-ios-ri-1921-test.log`, which holds the a11y subtree and the popover frame quoted above — `.real-input/ios/` is overwritten by every later run). An earlier build of the same round also passed in 54.0 s |
| Real-input `--control date-picker`, Android | **pass** — `real-input (android): 1/1 controls passed`, re-run on the committed tree at 21:06 on the `d9e51491…` APK with the labelled field at `42,781 → 386,907` = 131.05 × 48 dp (`/tmp/g5-fr3-final-and-ri.log`); the round's earlier pass on the same build, including a real `input tap` on a dialog day reaching JS (`Friday, October 16, 2026` → `2026-10-16`) and the refusing-parent case (`/tmp/g5-fr2-red-android-fr2-baseline.log`, 18:41) |
| `bun run bench --platform <p> --plan quick --component date-picker`, both platforms | **ran on both** — 48 iOS launches in 681 s and 24 Android launches in 203 s, both exit 0 with `problems: none`, from a clean tree at `8b60818`; both at a load the runner marks busy, so they are directional — the next subsection |

Two notes on how these were run, because both bit here. The real-input scripts refuse Node 26
(`scripts/node-version.mjs` pins 24.22.1), so every one of them goes through
`fnm exec --using 24 --`. And the harness's `platformReadyTimeout` is a 300 s constant on this
branch: one Android run died on it at `load1` ≈ 189, which is an environment failure and not a
test failure — the re-run in a lull is the one quoted. `HARNESS_TEST_TIMEOUT` *is* env-tunable in
the committed config, and that is what a loaded host needs raised.

The review caught this report once for quoting a gate from an earlier commit, so every row above was re-run
on the committed tree at the end of the round, and the artifacts are identified instead of assumed: the
Android APK on disk is md5 `d9e514917369c96d915b26da9acc78da`, which is what the A/B script recorded when it
installed this round's Kotlin, whose own md5 (`fdec2f704885bcd0db2a002eedbb0ba3`) is the committed file's;
the iOS `.app` binary is stamped later than the last change to any Swift file. The 12/12 + 12/12, the
115/116 whole-suite pair and the Android real-input case are therefore the committed bytes' results, not a
nearby build's. Devices and Metro went back down afterwards.

### Bench re-run on this round's tree (answer 1)

Run from `git status` clean at `8b60818`, starting 19:54 local — iOS first with Android queued
behind it, so the two never shared the CPU, and outside the 00:45–05:00 quiet window as asked:

```
IOS_SIM_UDID=331EF109-21DD-422B-AEF8-DFFFC6998DC3 \
  bun run bench --platform ios --plan quick --component date-picker
ANDROID_SERIAL=emulator-5572 ANDROID_AVD=nitroui_t02 ANDROID_ADB_SERVER_PORT=5042 \
  bun run bench --platform android --plan quick --component date-picker
```

**Neither run got a quiet machine, and each says so in its own header.** iOS: 48 launches in 681 s,
`load1` sampled 70× at median **25.17**, p90 184.48, max 231.38 — 100 % of samples over the
runner's 7.0 ceiling for 14 cores. Android: 24 launches in 203 s, sampled 31× at median **21.51**,
p90 55.01, max 78.41, again 100 % over. The load is the host's own apps (a game client pinned near
42 % CPU for the whole window, two Electron apps, WindowServer) plus G6 building; `load1` did not
come under the ceiling at any point between 19:00 and 20:30. Both runs end `problems: none`, so
every cell completed its four launches: what the load costs is precision, not the setup.

- `bench/results/8b60818-ios-20261025T195630Z.md` (gitignored, like every run)
- `bench/results/8b60818-android-20261025T201353Z.md`

#### iOS — iPhone Air, `8b60818`

| Cell | Implementation | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | rn-core | 16.08 ms | 4.31 ms | 2.16 ms | 2.57 ms | 2.27 ms | n/a |
| mount N=50 | expo-ui-host-per-control | 1197.15 ms | 60.84 ms | 3.92 ms | 8.34 ms | 883.97 ms | n/a |
| mount N=50 | expo-ui-shared-host | 968.07 ms | 32.66 ms | 1.80 ms | 2.38 ms | 657.16 ms | n/a |
| mount N=50 | nitro-ui | 32.54 ms | 33.05 ms | 2.35 ms | 2.67 ms | 36.13 ms | n/a |
| update N=50 | rn-core | 16.08 ms | 5.00 ms | 1.30 ms | 1.55 ms | 5.19 ms | n/a |
| update N=50 | expo-ui-host-per-control | 225.74 ms | 36.28 ms | 3.60 ms | 12.38 ms | 215.73 ms | n/a |
| update N=50 | expo-ui-shared-host | 165.98 ms | 31.36 ms | 1.68 ms | 2.18 ms | 165.81 ms | n/a |
| update N=50 | nitro-ui | 16.08 ms | 3.40 ms | 2.07 ms | 2.26 ms | 13.52 ms | n/a |
| memory N=200 | rn-core | n/a | n/a | n/a | n/a | n/a | 31.8 KiB |
| memory N=200 | expo-ui-host-per-control | n/a | n/a | n/a | n/a | n/a | 139.2 KiB |
| memory N=200 | expo-ui-shared-host | n/a | n/a | n/a | n/a | n/a | 168.3 KiB |
| memory N=200 | nitro-ui | n/a | n/a | n/a | n/a | n/a | 199.1 KiB |

Launch-paired ratio to `rn-core`: mount **2.02x** presented, 9.21x mounted, 1.20x JS commit,
1.12x JS CPU/op, 17.85x UI CPU/op; update **1.00x** presented, 0.68x mounted, 1.62x JS commit,
1.50x JS CPU/op, 2.68x UI CPU/op; memory 6.26x.

#### Android — `nitroui_t02`, `8b60818`

No `expo-ui` rows, for the reason in Known issues: the arm never renders.

| Cell | Implementation | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | rn-core | 104.10 ms | 59.62 ms | 6.04 ms | 9.35 ms | 31.06 ms | n/a |
| mount N=50 | nitro-ui | 155.96 ms | 138.93 ms | 8.01 ms | 10.73 ms | 109.14 ms | n/a |
| update N=50 | rn-core | 94.79 ms | 47.98 ms | 4.72 ms | 5.44 ms | 18.69 ms | n/a |
| update N=50 | nitro-ui | 153.43 ms | 39.79 ms | 6.03 ms | 8.21 ms | 34.86 ms | n/a |
| memory N=200 | rn-core | n/a | n/a | n/a | n/a | n/a | 27.9 KiB |
| memory N=200 | nitro-ui | n/a | n/a | n/a | n/a | n/a | 193.9 KiB |

Ratio: mount 1.39x presented, 2.18x mounted, 1.37x JS commit, 1.17x JS CPU/op, 3.65x UI CPU/op;
update 1.69x presented, 0.85x mounted, 1.32x JS commit, 1.46x JS CPU/op, 1.90x UI CPU/op; memory
6.90x.

**What the runner accepted.** Seven of the twelve iOS cells carry a `Within-run spread above 10 %`
note on named columns: mount `nitro-ui` (JS commit, JS CPU/op, UI CPU/unmount), both `expo-ui`
mount arms (presented 22–25 %), all three `expo-ui`/`nitro-ui` update arms, and memory
`expo-ui-host-per-control`. Both Android `nitro-ui` cells carry one (mount: JS commit 29.4 %,
JS CPU/op 24.3 %, UI CPU/op, UI CPU/unmount 57.1 %; update: mounted, presented, JS CPU/op). The
remaining columns have a spread the runner accepted, which is the most a run at this load offers.

Three readings that survive that, and one that does not:

- **iOS `update` presented is 1.00x `rn-core`** — 16.08 ms in both arms, the same column the
  pre-review run measured at 1.00x. It is the D15 column a form actually spends, and this round
  did not move it.
- **The `expo-ui` arms keep their direction**: iOS mount 74.45x (per control) and 60.23x (shared
  host) presented against `rn-core`, UI CPU/op 437x and 324x. The magnitude is worse than the
  pre-review 3.1–7.9x, which is what a busy machine does to an arm that builds a SwiftUI tree per
  row; direction unchanged, magnitude not usable.
- **Android's numbers sit below their pre-review values** — mount 1.93x → 1.39x presented,
  3.27x → 2.18x mounted, 4.31x → 3.65x UI CPU/op — but the two runs were taken at different loads
  and `presented` is frame-quantised, so this is not a measured improvement.
- **iOS `mount` presented at 2.02x is the one to discard.** 32.54 ms against `rn-core`'s 16.08 ms,
  where the pre-review run read 16.11 ms (1.02x). `presented` is a frame stamp: the busy machine
  put a 50-host mount one frame later, and `rn-core` happened to stay inside its frame. The D15
  mount position is not restated from this run; the Android table's 1.39x, taken on the same busy
  host, is closer to what the pre-review quiet-ish run said.

One number this round cannot attribute, recorded rather than explained: **Android's per-instance
memory moved up**, 27.9 KiB `rn-core` / 193.9 KiB `nitro-ui` against 28.4 / 135.5 KiB pre-review
(6.90x against 4.59x). A heap delta is the metric load affects least, and the candidates are C1's
shared-host fix, this round's wider probe, and the per-recomposition allocations the review lists
as non-blocking. See Follow-ups.

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

Fix round 1 re-ran both platforms from a clean tree at `8b60818`; those cells are in its section, and
the two tables above stay as the history of what the pre-review build measured.

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
  calendar, Cancel/OK, with the three compact fields still readable behind it. Retaken for fix
  round 1 (M1): the header reads `Jul 4, 2026` and the grid is July 2026 with day 4 lit, and the
  background inline calendar is on the same month as its own value. The frame on `d113c79` had
  July's header over an October grid - the review's M1, which that file was the evidence for.
- `android-inline.png` - the inline `DatePicker` (its header and calendar) and the inline
  `TimePicker` under it. Also retaken: the calendar's page is the value's month.
- `android-wheel.png` - the wheel section, where Android has no wheel and renders the inline
  picker instead, and the disabled row below: both variants dimmed and still laid out.
- `android-dark.png` - the top of the screen in dark mode. `Oct 25, 2026` is today's date: the
  value that rendered as `Oct 25, 20…` on the pre-fix build.
- `android-dark-compact.png` - the compact row in dark mode.

## Known issues and follow-ups

- **The DatePicker rows are re-measured; the quiet run is still owed.** Fix round 1 ran both
  platforms from a clean tree (see "Bench re-run"), so the rows are no longer two changes old — but
  the host was over the runner's load ceiling for 100 % of both runs, so nothing in them is a
  verdict. What release prep still owes is the same command once on an idle machine, which is also
  when the other five components' rows should be refreshed.
- **The whole Android suite has not been green since fix round 1** - not because of this
  component. Two full runs after the fix hit a machine at `load1` 11-44 (the human's own apps
  plus another task building): one lost `Slider` on its 1 000 ms render timeout, the second
  lost five suites, `DatePicker` among them, to "the native app crashed while preparing to run
  this test file / the app process exited, but no crash log lines were found" with the emulator
  at 51 % CPU. The `DatePicker` suite alone is green on that same build in 42.7 s, and the
  whole suite was green on this branch's code at `1536201`. Both logs are kept.
- **Android's per-instance memory for this component moved up and is unattributed**: 193.9 KiB in
  fix round 1's run against 135.5 KiB pre-review (6.90x `rn-core`, was 4.59x). A heap delta is the
  least load-sensitive column the runner has, so it deserves one look during the quiet bench run;
  the candidates are C1's shared-host fix, the wider probe, and the per-recomposition allocations.
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
- **There is no Android `expo-ui` date-picker arm at all.** `@expo/ui` exposes no dialog or
  field form of the picker on Android, so `expoUi.android.tsx` throws `unsupportedDatePicker()`
  and `scripts/bench/lib.mjs` lists the arm under `ARMS_WITHOUT_COMPONENT` and never schedules
  it. The Android table has `rn-core` and `nitro-ui` rows only, which is why it is not a ratio
  to compare with G4's four-arm tables. Fix round 1 rewrote the arm's header comment, which
  used to describe an inline M3 calendar that does not exist.
- **iOS `presented` stays a frame-quantised column** for this control too
  (`benchmarks.md`'s noisiest column); the same caveat G1–G4 recorded applies.
- `NitroUiIntrinsicProps`' doc comment still says `prewarmSizing`; the exported name is
  `prewarm`. One-word doc fix, left for whoever touches that file.
- The Android `compact` field is an M3 `OutlinedButton`, which is the closest thing to
  iOS's field but not the same widget (M3 has no date *field* control). The 48 dp height
  and the probe-driven width are its own metrics, not iOS's 103 x 36.33: real-input measures it
  at 131.05 x 48.00 dp for `date` mode in the emulator's `en_US` (48 dp, not 40, because Material
  3 puts an interactive minimum under the 40 dp outline), and that width moves with the locale's
  date format, which is exactly why it is a probe rather than a constant.

### Non-blocking, recorded and deliberately not fixed (the review's list, one line each)

- **Android `DateFormat` cache key.** `DatePickerFieldText` caches by `(mode, locale)`, and a
  `DateFormat` captures `TimeZone.getDefault()` when built, so a zone change while the app runs
  leaves `time`/`datetime` fields formatting in the old zone; the key needs the zone id (`:469`).
- **iOS formatter time zone.** `NitroUiDatePickerField`'s formatters do not set
  `timeZone = .autoupdatingCurrent`, which is the same class of staleness stated explicitly.
- **iOS width cache vs Bold Text.** The field-width cache key omits the legibility weight, so
  Bold Text keeps the cached width; `preferredFont(forTextStyle:compatibleWith:)` would fix it.
- **iOS 520 pt width clamp.** `datetime` truncates at the accessibility Dynamic Type sizes; either
  document it or drop the cap and let C1's fitting handle it.
- **An open Android dialog ignores a programmatic `value`.** The dialog state is seeded once, so
  pressing OK unchanged emits the stale date as a user pick.
- **A `disabled` flip while a popover/dialog is open leaves it open.** Picks are refused; the UI
  stays live. `afterUpdate()` could close the presentation.
- **iOS: a failed `present()` leaves `presented == true`**, so every later tap is a no-op until
  the mount is recycled; the flag should be written back when nothing was presented.
- **iOS: a recycled mount pressed inside the ~500 ms deferred-dismiss window** cancels that
  dismiss and leaves an invisible popover counted as open; un-hiding in `presentIsolated()`
  would cover it.
- **Neither popover nor dialog content applies `.disabled`** to its own subtree.
- **Android's disabled `compact` field is dimmed twice** — `alpha(0.38)` over M3's own disabled
  colours, ≈ 0.14 effective.
- **The `tintColor` "wheel highlight" claim in the docs table is unverified** (the G4 F1 class):
  no tinted wheel is on the example screen and `ios-wheel.png` shows the system grey.
- **A `variant` change remounts**, so an uncontrolled picker resets to `defaultValue` while JS
  still holds the previous `mostRecentEventCount` and the new native view starts at 0 — a short
  window where a stale controlled write is accepted.
- **Per-pass key-string allocation**: `toLanguageTag()` / `Locale.current.identifier` twice per
  recomposition or `body` pass, plus several `Calendar`s per recomposition on Android's inline
  path. Cheap, avoidable.
- **Android real-input `openAndPick` retries with day offsets `[0, 7, -7]`**, so "a second pick is
  a fresh selection" is not the oracle it reads as; picking the same cell twice with no retry
  would be.
- **iOS real-input reads `Echo.rejectValue`** (JS state) for the snap-back, which is trivially
  true, and never reads native's displayed value.
- **Test 11 cannot see an Android recycle bug** because view recycling is off by default in this
  example app (`core.md` §6) — the same disclosure as mutation row 11.
- **Stale Swift comments**: `DatePickerModel.presented` / `presentationHandler` (`:53-72`) and the
  `prepareForRecycle` comment (`:1229`) still describe SwiftUI owning the dismissal, which
  predates the UIKit presentation.
- **`ColdSizing.harness.tsx` has no DatePicker entry**, so no test asserts that a cold first
  DatePicker mounts at its declared `131 × 48` / `103 × 36.33` (M7's numbers are measured, not
  asserted). A third cold component in that file — run through `harness:cold:*`, which is the only
  invocation where "nothing has been measured yet" is true — is the natural next step.
- **Merging with G6** touches 34 shared files; `nitrogen/generated/**` should be regenerated with
  `bun run nitrogen` rather than hand-merged, and `bench-gate.test.js` / `smoke-ready-line.test.js`
  re-run because both branches edit the component list and the ready-line order.

## Questions for orchestrator — and the answers

1. **Bench re-run: when, and does Android get one too?** Every date-picker row on this branch
   came from `fd55c1a-dirty` at a load the runner itself flagged as non-verdictable, and both
   the C1 shared-host fix and fix round 1's box change (120.76 dp -> 131.05 dp) move what the
   Android cells measure. Options: (a) I re-run `--component date-picker` on both platforms in
   the post-05:00 window, which is the only quiet slot I have; (b) fold it into a 0.2
   release-readiness run with the other five components; (c) accept the rows as directional and
   say so in `benchmarks.md`. **Recommend (a)**, and (b) for the other components - a re-run of
   one component while the others stay old is honest as long as the table says so.
   **Answer:** (a), in this round - both platforms, `--plan quick`, from a clean tree, outside
   the quiet window, labelled with the load it was taken at. Only the DatePicker cells matter.
   **Done:** both ran at `8b60818` (see "Bench re-run"). The host stayed over the runner's load
   ceiling for every sample of both runs, so the rows are labelled and directional; the quiet run
   is recorded as still owed.
2. **Who runs `bun run smoke:rn-cli` and `smoke:expo`?** G4 and I both stopped at the same
   place: the per-control ready line is updated and unit-tested, but the pack + Expo + RN-CLI
   cycle is a release-readiness gate, and it is not cheap. **Recommend** one scheduled task
   before 0.2 rather than leaving each component task to guess.
   **Answer:** deferred to release prep (R3). DatePicker's line in `scripts/smoke/App.tsx` and
   its per-control layout check are in this branch and unit-tested; the suites are not run here.
3. **The Android `expo-ui` date-picker arm.** `@expo/ui` has no dialog or field form of the
   picker on Android. `expoUi.android.tsx` therefore throws `unsupportedDatePicker()` and
   `scripts/bench/lib.mjs` keeps the arm in `ARMS_WITHOUT_COMPONENT`, so **it is never rendered
   on any launch** - the earlier text here, which said the arm renders an inline M3 calendar
   while the other arms render a field, described a bench arm that does not exist (review,
   report-claims 4). Keep the throwing arm with a header caveat, or drop it? **Recommend keep +
   a header line**, because deleting it silently would make the Android table look comparable to
   G4's four-arm tables.
   **Answer:** keep it, fix the description, and say plainly that it never renders. Done in
   fix round 1: the arm's header comment now says so, and so does the follow-up above.
4. **`scripts/bench/build.mjs` runs plain `pod install`, not `bundle exec pod install`**, so
   every bench build rewrites the `COCOAPODS:` stamp in `example/ios/Podfile.lock` from 1.17.0
   to the 1.15.2 on `PATH` and lands in someone's diff. One-line fix, in bench infra rather
   than in this component. **Recommend** a small follow-up task; I have not touched it.
   **Answer:** leave it - the stamp is already recorded in `FOLLOWUPS.md` for whoever owns the
   bench infra.

Nothing here blocks reviewing the component: the gates that cover it are green on the final
build and the four items are all "who owns the next run".
