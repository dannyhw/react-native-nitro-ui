# G5 — DatePicker · re-review of fix round 1 (`d113c79..9a29a3c`)

Worktree `~/Developer/oss/nitro-ui-worktrees/G5`, branch `task/G5-datepicker` @ `9a29a3c`.

**Scope.** I read the round's diff:

- `HybridNitroUiDatePicker.kt` and `.swift`;
- the harness;
- `RealInputTests.swift` and `DatePickerScreen.tsx`;
- the `expoUi.android.tsx` comment;
- the docs and the report.

I also read the kept mutation scripts (`/tmp/g5-mut/fr2-*.py`) and red logs (`/tmp/g5-fr2-red-*.log`).

**Not run.** No simulator, emulator, adb, Metro, harness or bench was run. The native findings come from reading the code against Material 3 1.4.0 and UIKit behaviour.

## Verdict: **MERGE-AFTER-SMALL-FIXES**

M1–M7 are resolved in substance. The calendar page, the label, disabled, the popover direction, the structural leak count, the DST path and the fallbacks all do what was asked, and the Android reds are real.

The round did introduce **two regressions** in the code it touched, and both are small native fixes:

- **N1.** The new own-write guard swallows the user's first tap back to an earlier day or time.
- **N2.** The new rebuild key is the raw bound instant, so the docs' own `minimumDate={new Date()}` re-creates the platform control on every parent render.

**N3** is a false report claim, because the iOS M5 mutations didn't mutate what they say. Under D19, fix round 2 is the last round. N1 and N2 are Kotlin/Swift, so that round needs a re-review, but the diff should be about 20 lines.

## Gate

`bun run check` on `9a29a3c`: **green** (exit 0). It covers:

- typecheck, lint, format;
- jest, 176/176;
- `test:native`;
- `perf:renders` (262 checks);
- nitrogen, no drift (160 files);
- api-extractor, publint `--strict`;
- package-files (375);
- the README examples.

The log is `/tmp/g5-rereview-check.log`. `git status` was clean afterwards.

`check` does not compile Kotlin or Swift. For the native changes, the report's device runs (12/12 + 12/12 harness, whole suites, real-input on both platforms) are the evidence, and their artifact identities are recorded.

## M1–M7

| | Status | Notes |
| --- | --- | --- |
| M1 Android page/state | **Verified, with two regressions (N1, N2)** | See below. |
| M1 iOS `.id(boundsIdentity)` | **Verified, with N2** | See below. |
| M2 Android label/disabled | **Verified** | One non-blocking item: `mergeDescendants` on the picker variants. |
| M3 iOS value | **Verified** | Red on device (`fr2-m3`). Non-blocking: the value is announced twice when there is no label. |
| M4 popover directions | **Verified** | See below. |
| M5 leak count | **Android verified. iOS claim false (N3)** | See below. |
| M6 DST | **Verified** | See below. |
| M7 fallbacks | **Android verified. iOS acceptable, with a wording fix** | See below. |

### M1 Android: page and state

- Both calls now name `initialDisplayedMonthMillis`.
- The page follows the value: `syncDatePicker` sets `displayedMonthMillis`.
- `key(min, max, yearRange)` rebuilds the state on a bounds change.
- The test hook reports the displayed month.
- `fr2-m1a`, `fr2-m1b` and `fr2-m1c` are red on the right test, with the right message.

Answers to the brief's questions:

- **A value-only change does not rebuild.** `yearRange` is an `IntRange`, which has value equality, and it only moves if the value leaves the range. So a value change never resets the page or scroll.
- **A bounds change rebuilds by design.** It resets the page, and in an open dialog it drops the provisional selection. The docs say so.
- **Programmatic value while the dialog is open.** There is no rebuild unless the year range moves. The dialog keeps its provisional pick, and OK applies it. This is the pre-existing non-blocking item and is unchanged.
- **The setter cannot throw.** The `displayedMonthMillis` setter can't be handed an out-of-range month, because the effect captures the state from the same composition as `shown`.

### M1 iOS: `.id(boundsIdentity)`

- **The crash rationale holds up.** The `.ips` files are present for 16:01 and 16:04.
- **No extra rebuilds when the bounds are stable.** The identity is `""` when unbounded, and the bounds otherwise. The per-body cost is one small string interpolation, which is non-blocking.
- **The popover's calendar is re-identified on a bounds change too.** That's fine.

### M2 Android: label and disabled

- **Compact.** `nuiFieldSemantics` is on the `OutlinedButton`'s own layout node, so it merges into the button's single node: name, value, role and disabled together.
- **Inline/wheel enabled.** The label and value are on the `DatePicker`/`TimePicker` node.
- **Disabled.** `nuiBlockInput()` consumes at the `Initial` pass before the day cells and dial see the event. `clearAndSetSemantics { disabled() … }` leaves one disabled node with no actions.
- **The enabled path is unaffected.** `pointerInput` is only in the disabled chain.
- **Evidence.** The A/B uiautomator dump gives a sound comparison: 120 nodes and 34 clickable before, 3 and 0 after.
- **Non-blocking.** `semantics(mergeDescendants = true)` on a whole calendar (`:814`) merges every non-boundary child into the root stop: the title, the headline and the seven weekday `contentDescription`s. TalkBack would likely read all of that on the container. Plain `semantics {}` is enough on the picker variants. This is unverified, because uiautomator can't show it.

### M3 iOS: value

`.accessibilityValue` is on the compact button (`.swift:440`). It goes red on device without the modifier (`fr2-m3`).

Non-blocking: it is applied even when there is no label, so an unlabelled field reads the date twice ("4 Jul 2026, 4 Jul 2026, button"). Android has the twin: `stateDescription = value` next to the button's own text, and `contentDescription = label ?: value` plus `stateDescription = value` when disabled. Set the value or state only when a label is set.

### M4: popover directions

`[.up, .down]` is in place.

The bottom-of-screen case is real:

- The UI test scrolls until the page stops moving.
- It asserts the field is below mid-screen with less than 250 pt below it. The device shows 50 pt.
- It requires the bubble to be at least 250 pt tall and to sit above the field.

`fr2-m4` (`.up` only) is red on device: a 16 pt bubble.

### M5: leak count

**Android is verified.**

- The `DisposableEffect` counter lives in `Presentation`.
- `fr2-m5-android` is exactly `android-t6b`, and it goes red.
- The red fires at the next test's "untouched process: want 0" assertion, because the month test's unmount leaked first. That is still the real leak, seen.
- The test comment "This is the assertion the Android leak mutation failed" (`harness.tsx`, the `probe` wait) points at the wrong line. Non-blocking.

**The iOS counter mechanics are fine.**

- The ticket is taken in `present`'s completion.
- There is one decrement per presentation.
- `fr2-m5-iosf` is red, so the field is read.

**The iOS claim is false.** See N3.

### M6: DST

- **The seam now goes through the real conversion.** `resolveTestSelection` runs `toUtcMidnightOfLocalDay` → `fromUtcMidnightKeepingTimeOfDay`.
- **`dst-set` has a recorder.**
- **The zone is asserted.** The test checks that DST is observed and that at least one case crosses a UTC day.
- **`fr2-m6` is red.** It is the same patch as `android-t5`.
- **`dst-set`'s recorder was what failed:** `expected ['dst-set:1774824300000'] to deeply equal []`. Material 3 canonicalises the written millis, so the own-write guard sees a different day and emits. That means the eventLog oracle is real.
- **The pick half was not shown red in isolation.** The test stops at the first failure. Acceptable.

### M7: fallbacks

**Android is verified.**

- 131 × 48 dp, measured in en-US.
- Inside the 0.5 dp epsilon.
- Registered in `NitroUiDeclaredFallbacks.kt:41`.

**iOS is acceptable, with a wording fix.**

- 103 × 36.33 pt, measured in `en_PT`.
- Registered in `.swift:35`.
- The height is exact. The width is the gate locale's, not en_US (107). That deviation from the review is disclosed.
- **Fix the wording.** The report and comment call 4 pt narrow "the safe direction to be wrong in", but `core.md` §7, which the same comment cites, says the opposite: a fallback smaller than the control is the dead-touch direction. Either declare 107 (en_US, the safe direction), or fix the sentence.

**The D14/D17 concern does not bite here.** A fallback equal to the real size makes a failed correction invisible, but the DatePicker sizing tests poison every cold configuration (`WRONG_SIZE` 13.25 × 66.5, `harness.tsx:415`), so a broken correction still fails. No harness covers the cold first frame (`ColdSizing` covers only Slider and Switch). That gap is recorded as a follow-up, which is correct.

## New must-fixes

### N1 — Android correctness, a regression from this round: the first tap back to the previously selected day or time is swallowed and snapped away

**Where.**

- `HybridNitroUiDatePicker.kt:1217-1246` (`syncDatePicker`)
- `:1258-1283` (`syncTimePicker`)

**Why it happens.** `pushed` is only written when the model writes the state (`:1221`, `:1242`, `:1265`, `:1280`). It is not written after a user pick that the model accepted. `applyUserSelection` moves `displayed` synchronously, so after a tap the state already equals `wanted` and nothing updates `pushed`.

**Scenario: inline calendar on A.**

1. The user taps B. It is emitted. `pushed` is still A.
2. The user taps A. `picked == pushed`, so nothing is emitted.
3. `wanted` is B, so the state is written back to B. The calendar flashes A and snaps to B.
4. A second tap on A works.

**Same on the inline clock.** Drag 10→11, which is emitted, then back to 10. The dial snaps to 11 under the finger. Overshooting and correcting is the normal dial gesture.

Before this round, the comparison was against `model.displayed`, which handled this. No test covers it:

- `nuiTestSelect` goes model-first, so `pushed` is updated.
- Real-input picks once, through the dialog.

**Fix.** In both effects, record the model's value as `pushed` unconditionally, not only when writing:

- In the selected effect, put `pushed.value = wanted` before the `if` (`:1241-1244`).
- In the time twin, put `pushed.value = wanted` before the `if` (`:1279-1283`).
- Optionally do the same in the `shown` effects.

This keeps the race the guard was written for closed: the model's own write still sets `pushed` first.

**Verification.** If possible, add an Android real-input step on an inline picker: tap B, then A, and expect two events.

### N2 — Android and iOS correctness/perf, a regression from this round: the rebuild key is the raw bound instant, so `minimumDate={new Date()}` re-creates the platform control on every parent render

**Where.**

- `.kt:1019` and `:1076`: `key(model.minimum, model.maximum, yearRange)`.
- `.swift:493-508`: `.id(boundsIdentity)`, built from the raw doubles.

**Why it matters.** `docs/components/date-picker.md:13`, the page's first example, is `<DatePicker value={date} onChange={setDate} minimumDate={new Date()} />`. Every render sends a new millisecond bound, including the render that each pick causes through `setDate`.

**Scenarios.**

- **Android inline.** Each pick and each unrelated parent render rebuilds `DatePickerState`. A user browsing months is snapped back to the value's month by any re-render.
- **Android dialog.** Any re-render while the dialog is open, from a timer, a fetch or a context change, rebuilds the dialog's state. The provisional selection is discarded.
- **iOS.** `UIDatePicker`/`UICalendarView` is torn down and rebuilt per render and per pick. That includes inside an open popover, mid-interaction, and in `datetime` the expanded time row is likely rebuilt too.

This breaks the perf contract the code itself cites ("nothing gets rebuilt per render").

**Fix, Android.** Key on what the state actually consumes: `key(selectable, yearRange)`. `rememberSelectableDates` is already remembered on the bounds' UTC-midnight days, and `yearRange` is day-granular too, so this is exact.

**Fix, iOS.** Re-identify only when it is needed. Build the identity from the bounds at the control's own granularity: the local day for `.date`, the minute otherwise. Also bump it whenever the incoming value falls outside the range the live control was built with, which is the crash's actual precondition.

**Verification.** Add a harness case that rerenders with `minimumDate` moved by 1 ms and asserts the calendar did not rebuild. On Android, the calendar-month report must stay at a non-value page that was set before; or add a rebuild counter to the report.

**Also.** The docs paragraph at `:130` should say "a bounds change at day granularity".

### N3 — report claim (doc only): the iOS M5 "does not leak" finding rests on mutations that didn't remove the drop's close

**What the report says.** `report.md`, M5: "the iOS twin of `android-t6b` cannot be shown red here, because on iOS that mutation does not leak. UIKit tears the popover down with the host view, `presentationControllerDidDismiss` runs".

**What the mutation scripts actually do.**

- **`fr2-m5-iosc`, `-iosd`, `-iose`.** Each replaces only `func onDropView() {\n    model.onChange = nil`. `model.setPresented(false)` and `host.drop()` stay in `onDropView`, so the drop still closes the popover. Their comments ("nothing here closes the presentation or drops the host") are false.
- **`fr2-m5-ios` and `-iosb`.** These remove the drop's close but leave `prepareForRecycle`'s `setPresented(false)`. iOS Fabric recycles, so that path closes the popover.
- **Under `iose` the count still returned to 0, which contradicts the report's explanation.** That mutation silenced `presentationControllerDidDismiss`, which leaves `dismissNow`, reached through the intact `onDropView`, as the only decrement path.
- **No run removed both closing paths.**

**Fix.**

- Replace the paragraph and the ✓ row with what was actually run.
- Preferably, run the real twin: remove `setPresented(false)` from both `onDropView` and `prepareForRecycle`. It will very likely go red, and then the claim becomes "✕ both".

## Non-blocking (one line each)

- `.kt:814`: drop `mergeDescendants = true` on the picker variants. It merges the title, headline and weekday names into the label stop (see M2).
- Value announced twice with no label: iOS `.accessibilityValue` (`.swift:440`), and Android `stateDescription` (`:816`, `:831-832`). Apply them only when a label is set.
- `publishCalendarFacts` (`.kt:1190-1200`): after a bounds-only rebuild with an unchanged month and selection, `DisposableEffect(state)` clears to `-1` and the `LaunchedEffect` doesn't relaunch. The report then says "no calendar" while one is composed. Key the `LaunchedEffect` on `state` too. This is test-hook only.
- The M7 comment and report call a narrower-than-real fallback "the safe direction". `core.md` §7 says the opposite. Reword it, or declare en_US 107.
- The harness comment in "presents nothing…" names the wrong assertion as the one `fr2-m5-android` failed. It actually failed at "the untouched process".
- Per-recomposition allocations grew. Android: `toUtcMonthStartOfLocalDay(shown)`, `toUtcMidnightOfLocalDay(shown)` and `format(mode, shown)` per `InlinePicker` pass. iOS: the `boundsIdentity` string per body. These are cheap, and belong with the existing allocation follow-up.
- The `dst-pick` half of M6 was not shown red in isolation, because the test stops at `dst-set`'s first failure. Note it in the report, or reorder.

## Report and bench honesty

**These claims are now true:**

- the Kotlin, Swift and harness line counts (1721, 1355, 1462);
- the `expo-ui` Android arm ("never rendered") in both places;
- rows 5, 6 and 11 marked superseded or disclosed;
- the `date-picker.md` corrections (matchParentSize, composition, inverted range, Lisbon pin, `enabled`);
- the screenshots retaken.

**The bench is labelled honestly.** The report gives the load as median `load1` 25.17 on iOS and 21.51 on Android, 100 % over the ceiling, and calls the numbers "directional". It discards iOS mount 2.02× as frame quantisation, and it reports the Android memory rise as unattributed rather than explained away.

**The one false claim is N3.**

## Shared files outside DatePicker

This round touched only one file outside the component: `bench/src/implementations/expoUi.android.tsx`. The change is a comment, and it removes an orphaned duplicate docblock.

The round made no changes to:

- core (`ios/core`, `android/.../core`, `cpp`);
- `src/`;
- `scripts/`;
- other components.

`example/src/DatePickerScreen.tsx` gains one row at the bottom, so the existing real-input targets near the top are unaffected, and the Android real-input passed on the final tree per the report. **There is no regression risk outside DatePicker.**

## Do the must-fixes change native code?

**N1 and N2: yes.** N1 is Kotlin. N2 is Kotlin and Swift, plus one docs line. Per D19, fix round 2 needs a re-review, but each diff is small and local. **N3: no.** It is report text, plus an optional iOS mutation run.
