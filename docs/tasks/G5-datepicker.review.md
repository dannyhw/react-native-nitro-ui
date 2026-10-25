# G5 — DatePicker · review (D19: the one full review)

Branch `task/G5-datepicker` @ `d113c79`, from `fd55c1a`, with main `d21f0ce` merged in (`58d34f0`;
`d21f0ce` is an ancestor of `d113c79`). I reviewed `git diff d21f0ce...d113c79` against the brief
(including the "0.2 additions"), the G6 lessons, AGENTS.md, D7/D14–D22, `core.md` (§3, §4, §6, §7)
and `sizing.md` (§5, §6). I also read the implementer's report, the screenshots, the harness and
real-input code, and the kept logs and mutation scripts in `/tmp/g5-*` and `/tmp/g5-mut/`. No
simulator, emulator, Metro, harness or bench was run. Native findings come from reading the code.
I checked Material 3's behaviour against the bytecode of `material3-android-1.4.0`, which is the
version the example app resolves.

## Verdict: **NEEDS-WORK**

Most of the component is good:

- **Handshake, clamping and reset.** The handshake is wired correctly on both platforms. Setters
  store raw values, and the value, default and bounds are reconciled once in `afterUpdate()`. Native
  and JS clamp the same way. Absent bounds are `number | null`, which is the right D7 spelling, and
  the argument for it holds. The recycle reset is complete.
- **Presentation lifecycle.** The model owns whether the presentation is open, which is the right
  shape for the B1 class of bug. The iOS popover's dismiss-during-entry-transition handling is
  careful work.
- **Sizing key.** `"<variant>|<mode>"` is a sound and well-argued decision.
- **Gate.** `bun run check` is green.

But the review found these must-fixes:

- **A user-visible Android bug in the default variant (M1).** Every Material 3 calendar opens on
  the wrong month. The report's own `android-dialog.png` shows it: the header reads "Jul 4, 2026"
  and the grid shows October 2026. The state is also never re-keyed, so bounds React changes never
  reach a mounted calendar.
- **Accessibility label and value bugs on both platforms (M2, M3).** One of them repeats SF2.
- **An iOS popover that is squeezed when its field is low on the screen (M4).**
- **Two tests that do not guard what the report says they guard (M5, M6).** The kept mutation logs
  show that the real Android dialog-leak mutation (`android-t6b`) and the real UTC-midnight
  conversion mutation (`android-t5`) both stayed **green**. The "red" rows in the report come from
  substitute mutations.
- **A declared fallback left provisional (M7).** It is 8 dp short on Android.

Each fix is small and local. Together they fit fix round 2. M1–M7 change native code (Kotlin and
Swift), so D19 calls for a re-review after the fix round.

## Gate

`bun run check`: **green** on `d113c79`. It covers:

- typecheck and bench typecheck, lint, format;
- 176/176 jest;
- `test:native` (clock, handshake, slider-value, sizing);
- `perf:renders` (262 checks);
- `nitrogen:check` (no drift), autolinking, prepare, api-extractor, publint (strict), manifest
  (375 files), README examples.

`git status` was clean afterwards. The report ran `check` at `1536201`, not at the final commit.
That is now covered by this run.

## Findings that must be fixed

### M1 — correctness (Android): every M3 calendar opens on the wrong month, and the date state ignores later bounds and range changes

`HybridNitroUiDatePicker.kt:820-825` (inline) and `:851-856` (dialog) call:

```kotlin
rememberDatePickerState(
  model.toUtcMidnightOfLocalDay(shown),
  model.minimum?.let { model.toUtcMidnightOfLocalDay(it) },   // <- 2nd positional
  yearRange = yearRange, selectableDates = selectable,
)
```

The second positional parameter of `rememberDatePickerState` is `initialDisplayedMonthMillis`, not
a minimum. In 1.4.0, `BaseDatePickerStateImpl.<init>` falls back to `calendarModel.today` when that
value is `null`. So:

- **No `minimumDate`:** the calendar opens on **today's month**.
- **With `minimumDate`:** the calendar opens on **the minimum's month**.
- **Either way, the selected day is usually off-screen.**

The evidence:

- `docs/tasks/G5-datepicker/android-dialog.png` shows the value `Jul 4, 2026` over an October 2026
  grid.
- `android-inline.png` shows the same mismatch.
- The background inline calendar in `android-dialog.png` sits on January 2026, its minimum's month.
- The report describes `android-dialog.png` as "header, calendar" without noticing.

**Second half of the bug: nothing is ever re-keyed.** `rememberDatePickerState` uses
`rememberSaveable` with an **empty inputs array**, which I checked in the 1.4.0 bytecode
(`anewarray 0` before `RememberSaveableKt.rememberSaveable`). That means `yearRange`,
`selectableDates` and the displayed month are read once per composition. Two comments claim the
state "keys its state on the object" (`:557-560`, `:1020-1023`), and they are false.

Consequences for a mounted inline picker, or for a dialog that is open:

- **Bounds changes do not reach the calendar.** React changes `minimumDate`/`maximumDate`, but the
  greyed days and the navigable years stay at the first composition's values. The model's clamp
  keeps the *value* legal, but the calendar offers days the control will clamp away, or hides days
  that are now valid. That contradicts the page's claim (`date-picker.md` §Selection) that "the
  platform control cannot show a day outside the range".
- **A value outside the original `yearRange` blanks the selection.** `DatePickerStateImpl
  .setSelectedDateMillis` stores `null` for a year outside the range. Then
  `syncDatePicker`'s second effect returns early (`selected ?: return`), so the calendar shows no
  selection while the field says otherwise. Example: a range-limited picker whose `maximumDate`
  moves into next year, followed by a value in January.
- **Programmatic value changes leave the page behind.** `syncDatePicker` (`:947-952`) moves the
  selection but never the displayed month. A "Reset to 2026-01-01" from the example screen selects
  a day on a page the user is not looking at.

**Fix:**

- Use named arguments, with `initialDisplayedMonthMillis = toUtcMidnightOfLocalDay(shown)` in both
  places.
- In `syncDatePicker`'s model→picker effect, also set
  `state.displayedMonthMillis = wanted` when the value moved.
- Assign `state.selectableDates = selectable` in an effect keyed on the bounds. The setter is public
  in 1.4.0.
- Re-create the state when `yearRange` changes, using `key(yearRange) { rememberDatePickerState(…) }`.
  Alternatively, derive the range from the bounds only and widen it once to cover the value.
- Correct the two comments.
- For the test, add the displayed month to `nuiTestStateReport`, for example
  `<ms>|<presented>|<displayedMonthUtc>`. Then assert three things, shown red with the current
  positional call:
  - an inline picker seeded in July with no bounds displays July;
  - a picker with a March `minimumDate` and a July value displays July;
  - a rerender to a value in another month moves the page.

### M2 — accessibility (Android): the label is on the container, not the control (SF2 again), and `disabled` does not reach the inline calendar

**The label.** `HybridNitroUiDatePicker.kt:726-729` puts `semantics { contentDescription = label }`
and `nuiDisabled` on the outer `Box`. `core.md` §3 "testID and accessibility" bans exactly this
(review SF2). With `accessibilityLabel="Departure"`, TalkBack does the following:

- It focuses the `Box` as its own stop, saying "Departure".
- It then focuses the `OutlinedButton`, saying "Oct 25, 2026, button", with no name.

This is the double-stop / nameless-control bug.

**`disabled`.** The `disabled()` semantics also sit only on that container. The inline variant has
no input blocking, despite the `[blockedInputModifier]` reference at `:285`, which does not exist.
So TalkBack still offers every day cell of a disabled inline calendar as an enabled, activatable
button. Activating one moves the selection for a frame and snaps back. "Disabled" is never
announced on the node the user is on. This is the "disabled semantics lost on Android" bug class
the brief asked about.

**Fix:**

- Compact: put the semantics on the `OutlinedButton` itself, so the merged node reads the label and
  the date. Use `Modifier.semantics { contentDescription = label; stateDescription = formattedValue }`.
  The `Box` must carry no `contentDescription`.
- Inline/wheel: put the label on the `DatePicker`/`TimePicker` modifier.
- When disabled, wrap the picker in a node that swallows pointer input and clears the children's
  semantics, for example `clearAndSetSemantics { disabled(); contentDescription = label ?: value }`
  plus a pointer-input consumer.
- Delete the dangling `[blockedInputModifier]` reference.
- The harness has no a11y query, so state in the report how this was verified (a uiautomator dump of
  `content-desc` / `enabled` on the button and the day cells, as the real-input script already does).

### M3 — accessibility (iOS): with a label set, the compact field never announces its date

`HybridNitroUiDatePicker.swift:384` applies `OptionalDatePickerAccessibility`, which calls
`content.accessibilityLabel(label)` (`:542`), to the whole content. For `compact` that content is
the custom `Button` (`:407`), whose only accessible text is the date. The label **replaces** it. So
VoiceOver reads "Departure, button" and never the date.

The brief requires that the announced value be localised. The docs say "the platform control
supplies the localised *value*" and the report says the requirement is met. That is not true for the
variant an app actually puts in a form. The `.graphical` and `.wheel` variants are fine, because
SwiftUI's `DatePicker` keeps its value.

**Fix:** on the compact button, add
`.accessibilityValue(Text(NitroUiDatePickerField.label(...)))`, keeping the label as the label.
Optionally add `.accessibilityHint` or the `.isButton` trait for "opens a calendar".

### M4 — correctness (iOS): the popover may only point up, so a field in the lower part of the screen gets a calendar squeezed into the space below it

`HybridNitroUiDatePicker.swift:704` sets `popover.permittedArrowDirections = .up`. UIKit honours the
permitted directions and shrinks the popover to fit the room on that side. The content is
`preferredContentSize` = 336 × the measured graphical height, roughly 340–420 pt with a time row.

Concrete case on iPhone Air (912 pt tall): a compact field below about y ≈ 480 pt does not have
that room below it. Examples are a form's last row, or a field above the keyboard or tab bar. The
popover is clamped, and the calendar is clipped or squashed below the 44 pt touch target that
`calendarWidth`'s comment works to guarantee.

The comment's reason ("a bubble that flipped above the field would point at the tab bar") is wrong.
A bubble above the field points down at the field. Every iOS screenshot and the real-input case use
fields near the top of the screen, so this was never exercised.

**Fix:** set `permittedArrowDirections = [.up, .down]` and fix the comment.

**Verification:** a real-input or screenshot case with a field at the bottom of the Date screen.
Assert that the popover's frame height equals `preferredContentSize.height` (XCUITest can read the
popover element's frame).

### M5 — test and false claim: "presents nothing after the mount that opened it is gone" cannot see a leaked Android dialog, and on both platforms it was shown red only against a stand-in

The test (`DatePicker.harness.tsx:725-784`) depends on one idea: a leaked presentation would swallow
the harness's press on a witness. The kept mutation runs show this does not work on Android:

- **`/tmp/g5-mut/android-t6b.py`** is the real B1 failure: `onDropView` neither closes the dialog
  nor disposes the composition, so the `Dialog` window survives. Result:
  `/tmp/g5-red-android-android-t6b.log` reports **11 passed**. The harness's press does not pass
  through the dialog's separate window.
- **`android-t6`** hangs a view on the decor view. It never produced a result.
- **`android-t6c`** went red. It adds a clickable `View` to the host's own window, which is not a
  dialog at all.
- **`ios-t6c`** does the same thing with a `UIView` added to the app window, not the popover. Its
  comment still says SwiftUI owns the popover, which predates the UIKit presentation.

The report's table row 6 ("both: a presentation that outlives its mount (the B1 failure mode) —
✕ both") therefore does not describe what went red. On Android, the gate does not guard the
property it is named after.

**Fix:**

- Make it structural. Keep a process-wide count of live presentations:
  - Android: a `DisposableEffect` inside `Presentation` increments and decrements an
    `AtomicInteger` in the companion.
  - iOS: increment in `present()`'s completion and decrement in `presentationControllerDidDismiss`
    / `dismissNow()`'s completion.
- Expose the count through a test-only read. It could be a third field of `nuiTestStateReport` on a
  fresh instance, or a static read through `nitroUiCore`.
- Assert the count is `0` after the unmount, polled.
- Re-run `android-t6b` and an iOS twin that skips `model.setPresented(false)` in `onDropView`, and
  show both red.
- Keep the witness press as a second, iOS-only signal if wanted.
- Correct row 6 of the report.

### M6 — test and false claim: the DST test never exercises Android's UTC-midnight conversion, and the device zone is not checked

The report says that "the conversions to/from the instant live in one place next to the clamp, which
is what makes the DST round-trip testable", and row 5 says the test went red. The mutations say
otherwise:

- **`android-t5`** removes the conversion entirely: `toUtcMidnightOfLocalDay` returns the raw
  millis. Result: `/tmp/g5-red-android-android-t5.log` reports **11 passed**.
- **`android-t5b`** went red, with 4 failures across pick, revert, DST and remount. It mutates
  `resolveTestSelection`, the test seam's own `Calendar` arithmetic, not anything a real tap runs.

How the test misses the real path:

- The pick direction (`dst-pick`) goes through `nuiTestSelect` → `resolveTestSelection`, which never
  touches `toUtcMidnightOfLocalDay` / `fromUtcMidnightKeepingTimeOfDay`.
- The set direction (`dst-set`) does run the conversion, through `syncDatePicker`. But that instance
  has no `onChange` recorder, and `waitForDisplayed` polls. A spurious emit that the controlled
  parent then rejects lands back on the same value and passes.

The zone is also uncontrolled. The iOS log shows the simulator really observes UK DST: `summer` is
UTC−1 h, and the transition dates in the test are the EU ones. For Android there is no log evidence,
and the docs claim "`2026-03-29T00:30` in Lisbon … the harness pins this" (`date-picker.md:51`).
In fact the test uses 12:30/23:45 and pins nothing. In a UTC or US zone the test passes without
crossing a transition.

**Fix:**

- On Android, route `nuiTestSelect`'s date fields through the picker's own path:
  `applyUserSelection(fromUtcMidnightKeepingTimeOfDay(utcMidnightOf(y, m, d), displayed))`, then the
  time fields through `fromTimeOfDay`.
- Give `dst-set` an `onChange` recorder and assert `eventLog` stays empty.
- At the top of the test, assert that the device zone observes DST:
  `new Date(2026,0,1).getTimezoneOffset() !== new Date(2026,6,1).getTimezoneOffset()`. Fail loudly
  if it does not, rather than pass vacuously. Log the zone.
- Show `android-t5` red.
- Correct `date-picker.md:50-53` and row 5 of the report.

### M7 — sizing (D14/D17): the declared fallbacks are still "provisional", and Android's height is wrong

- iOS `HybridNitroUiDatePicker.swift:817-819, :845` declares `118 × 36` with
  "TODO(G5): replaced with the on-device measurement before the commit".
- Android `HybridNitroUiDatePicker.kt:1081-1089` declares `150 × 40` dp with "PROVISIONAL (G5)".

What the control actually measures:

- iOS: `103.00 × 36.33`, from the en-GB harness log.
- Android: `131.05 × 48` dp in en-US. The harness and real-input logs report 48 dp height, because
  of M3's minimum touch target.

The Android comment also contradicts itself: it calls the width "Material 3's own floor
(`ButtonDefaults.MinWidth`, 40 dp)" but declares 150.

Every cold `compact` mount on Android is therefore laid out 8 dp short for its first frame and pays
a correction. D17 says "a correct declaration costs 0 corrections", and D14 says declared fallbacks
must be accurate per OS. The width is locale-dependent and cannot be exact, but the height can.

**Fix:** declare `131 × 48` dp (Android) and the en-US iOS measurement, both from the default
`en_US` configuration. Delete the TODO/PROVISIONAL text. The harness's poisoning is unaffected,
because the tests seed `13.25 × 66.5`.

## Non-blocking (one line each)

**Platform behaviour**

- Android `DatePickerFieldText` caches `DateFormat` keyed by `(mode, locale)` only, and a
  `DateFormat` captures `TimeZone.getDefault()` when it is built. After a time-zone change while the
  app runs, `time`/`datetime` fields format in the old zone while the dialogs use the new one. Add
  the zone id to the key (`:469`). On iOS, set `formatter.timeZone = .autoupdatingCurrent` to be
  explicit (`:278`).
- iOS field-width cache key (`:262`) omits legibility weight. Bold Text makes SwiftUI's `.body`
  bolder while the cached width stays the same. Add `UITraitCollection.current.legibilityWeight` and
  measure with `preferredFont(forTextStyle:compatibleWith:)`.
- iOS width clamp `min(…, 520)` truncates `datetime` at the accessibility (AX) Dynamic Type sizes.
  Document it, or drop the cap and let C1-style fitting handle it.
- An open Android dialog does not follow a programmatic `value` change: the dialog state is seeded
  once. Pressing OK unchanged then emits the stale date as a user pick. Document it, or sync the
  dialog like the inline picker.
- A `disabled` flip while the popover or dialog is open leaves it open. The picks are refused, but
  the UI is live. Close the presentation in `afterUpdate()` when disabled.
- iOS: if `present()` fails (no presenter, or the presenter is busy), `presented` stays `true` and
  every later tap is a no-op until recycle. Write the flag back when presentation does not happen.
- iOS: a recycled mount pressed within the ~500 ms after a mid-transition drop cancels the deferred
  dismiss. The container stays `isHidden = true`, so an invisible popover is "open". Rare. Un-hide in
  `presentIsolated()`.
- iOS/Android popover and dialog content does not apply `.disabled`.
- Android: the disabled compact field is dimmed twice (`alpha(0.38)` over M3's own disabled
  colours, ≈ 0.14 effective).
- iOS `tintColor` "wheel highlight" (docs table) is unverified: no tinted wheel is on the example
  screen, and `ios-wheel.png`'s highlight is the system grey. This is the G4 F1 class. Verify it, or
  drop the claim.
- A `variant` change remounts, so an uncontrolled picker resets to `defaultValue`. JS also keeps the
  old `mostRecentEventCount` while the new native view starts at 0, which opens a short window
  where a stale controlled write is accepted. Document it.
- Each recomposition or body pass allocates key strings for cache lookups: `toLanguageTag()` and
  `Locale.current.identifier`, twice per pass. Android's inline path also allocates several
  `Calendar`s per recomposition. These are cheap but avoidable. Compute once per composition.

**Tests**

- Android real-input `openAndPick` retries with offsets `[0, 7, -7]`. A second attempt on a
  different day emits regardless of rollback, so "a second pick is a fresh selection … only true if
  the refused one was rolled back" is not an oracle. Pick the same cell twice, with no retry.
- iOS real-input checks `Echo.rejectValue` (JS state) for the snap-back. That is trivially true, and
  native's displayed value is never read.
- Test 11 ("starts a remount from its own default") cannot see a recycle bug on Android, because
  view recycling is off by default (`core.md` §6). The kept `android-t10` (didApplyDefault survives
  the recycle) is **green**. Say so, or enable recycling for that suite.

**Docs and comments**

- `date-picker.md`:
  - `:94` still says the value is overlaid with `matchParentSize`. Fix round 1 removed that.
  - `:67` "composition reused" is false on Android: drop disposes it (`core.md` §6).
  - `:145` "an inverted range is an empty range … unselectable" contradicts the code (lower bound
    wins).
  - `:137` "with `disk` behaviour" is garbled.
  - `:27` "Compose `enabled = false`": M3 `DatePicker` has no `enabled`.
- Swift `DatePickerModel.presented` / `presentationHandler` docs (`:53-72`, "a SwiftUI `popover` is
  owned by the presentation system", "SwiftUI's dismissal of the bubble") and the `prepareForRecycle`
  comment (`:1105-1108`, "SwiftUI dismisses it") predate the UIKit presentation.

**Merge**

- **With G6 (34 shared files).** The overlap includes `nitro.json`, `nitro-ui.sizing.json`, both
  `NitroUiDeclaredFallbacks`, `NitroUiPackage.kt`, `src/index.ts`, `viewConfigs.test.ts`,
  `bench/{types,plan}.ts`, all four bench arms and `shared.ts`, `bench/baselines/renders.json`,
  `scripts/bench/lib.mjs` with `bench-gate.test.js`, smoke `App.tsx`/`lib.mjs` with their test,
  `real-input/{controls,android,uiautomator}.mjs`, `RealInputTests.swift`, `example/src/App.tsx`,
  `etc/package-files.txt`, `etc/*.api.md`, and every aggregate `nitrogen/generated` file.
  - Nearly all of it is additive, with no semantic conflict.
  - Both branches add a `selected` field to `parseHierarchy`, so keep one.
  - **Regenerate `nitrogen/` with `bun run nitrogen`** rather than hand-merging the bridge, umbrella,
    autolinking and `nitrouiOnLoad.cpp`.
  - Re-run `etc` api-extractor and `package-files`.
  - Re-run `bench-gate.test.js` and `smoke-ready-line.test.js`, since both edit the component list
    and the ready-line order.
- **With main:** the main merge is clean and gated. The only core edit is the additive
  `containingViewController` accessor in `NitroSwiftUIHost.swift`.

## Checked and fine (no action)

- **Props (D7, D7b).** Every view prop is `T | null` and always sent. `onValueChange?` is the only
  optional. `nuiSizingKey` is normalised from closed enums, and `useSizingId(normalisedVariant)`
  matches the element `key`.
- **Perf contract.**
  - Setters store and mark dirty, with one `commit()` per batch.
  - The bookkeeping props (`valueMillis`, `defaultValueMillis`, `mostRecentEventCount`,
    `onValueChange`, `testID` on iOS) do not mark dirty.
  - The host is never recreated.
  - Formatters are process-wide (iOS dictionary on main; Android `@Synchronized` map with a cap).
    There is no per-update `DateFormatter` / `SimpleDateFormat`.
  - Tinted M3 schemes are cached per base-scheme identity.
  - The test report string is built only when it changes.
- **Size-affecting setters (G2 F1, R3).** `mode` calls `noteContentSizeMayHaveChanged()` on iOS,
  and the key setter calls `noteSizingKeyChanged()` on both platforms. Variant moves the policy, and
  the remount makes that per mount.
- **Value-independent compact width.** The approach is correct. The Android `maxBy(measureText)`
  ranking is order-invariant under font scale, and Compose lays out the winning string, so it is
  environment-correct without a size cache. The iOS width is cached per mode × size category ×
  locale (but see the Bold Text line). Both are cheap: about 120 formats once per key.
- **C1.** The compact field's probe is `maxLines = 1` and the value is `Ellipsis`, so the C1 fitted
  pass truncates the value inside its box.
- **`fillWidth` M3 `DatePicker`.** It is safe under unbounded height, because the year grid is
  `requiredHeight`.
- **B1 on Android.** The dialog is composed inside the host's composition, so it registers nothing
  on the Activity, window or `ViewTreeObserver`. `DialogWrapper` uses its own `ComponentDialog`
  lifecycle. Back dismisses through `onDismissRequest`. The *mechanism* is right; M5 is about the
  test.
- **iOS presentation.** It is torn down in `onDropView` and `prepareForRecycle`. The weak handler
  avoids a cycle. Hiding the container mid-transition is a sound fix for the dead-touch window.
- **D21.** No wall-clock assertions. Timing appears only in `pollUntil` deadlines.
- **Remaining deliverables.**
  - The Reassure scenario is in `renders.json`.
  - Storybook has a Playground with every prop, plus Modes and Variants showcases.
  - The smoke `App.tsx` line and A2 per-control layout are in, with the parser unit-tested.
  - The real-input case covers open → pick on both platforms.
  - Screenshots cover each variant, light and dark, and dialog open.
- **Bench honesty.** The report flags `fd55c1a-dirty`, pre-C1 and pre-fix-round, plus load
  (iOS median 17.3, Android 10.2 against a 7.0 ceiling) and the two Android full runs that died
  under load. Those disclosures are accurate. The iOS D15 position is fine: 1.02× presented, and
  well below both `@expo/ui` arms on UI CPU.

## Report claims to correct

1. **Mutation row 5 (DST).** The red came from mutating the test seam (`android-t5b`). The mutation
   of the real UTC-midnight conversion (`android-t5`) stayed green (M6).
2. **Mutation row 6 (presentation).** "A presentation that outlives its mount — ✕ both" is not what
   went red. The real Android dialog leak (`android-t6b`) passed 11/11. The red runs used a
   clickable overlay in the app window on both platforms (M5).
3. **Mutation row 11.** Disclose that the Android recycle mutation (`android-t10`) was green, since
   recycling is off.
4. **Bench and Known issues / Question 3.** These describe an Android `expo-ui` arm that "renders an
   inline M3 calendar". The code has no such arm: `expoUi.android.tsx` throws
   `unsupportedDatePicker()` and `lib.mjs` never schedules it. The Bench section ("No `expo-ui`
   rows") is right, and the other two places contradict it.
5. **Screenshots.** The `android-dialog.png` / `android-inline.png` descriptions should note the
   wrong displayed month, or the frames should be retaken after M1.
6. **Accessibility.** "Both platforms … announce a localised value" is false for `compact` with a
   label on iOS (M3), and the Android label placement repeats SF2 (M2).
7. **`date-picker.md`.** It claims the harness pins Lisbon 00:30, that Android reuses the
   composition, that an inverted range is empty, that `matchParentSize` is used, and that the
   platform control cannot show an out-of-range day. All of these are false (see M1, M6 and
   Non-blocking).
8. **Files list.** It gives the Kotlin file as 1386 lines. It is 1425.

## Do the must-fixes change native code?

**Yes.**

- **M1, M2, M7:** Kotlin.
- **M3, M4:** Swift.
- **M5, M6:** add or adjust native test seams on both platforms (Android only for M6), plus harness
  edits.

Per D19, the fix round needs an Opus re-review. Per AGENTS.md, the harness changes must be run on
both platforms. This is fix round 2 of 2, so anything that misses it becomes a follow-up.
