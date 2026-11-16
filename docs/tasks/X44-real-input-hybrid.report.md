# X44 — Android real-input: e2e for what it can drive, the proven checks for the rest

**Branch:** `task/X44-real-input-hybrid` (from `origin/main`, merged at `0361d72`) · **Round:** 1
**Leases:** `X44-9898u` (`emulator-5570` / `nitroui_b`, adb 5041, Metro 8293) for the mutation run,
then `X44-eoov2` (`emulator-5574` / `nitroui_a`, adb 5043, Metro 8295) for everything after — the
first lease's TTL could not be extended in place, so it was released and the pair re-acquired.

## Summary

Android real-input is now two phases on one device session, reporting through one ledger line.

Phase 1 is the e2e suite: 28 files, 37 tests, one real tap or natural gesture per control, plus the
placement and reader-state checks that e2e can express and were shown red on a device (Form's
keyboard avoidance, Popover under the keyboard, `button-group`, `chip`). Anything neither green on a
device nor shown red is out. One removal runs the other way: `dialog`'s "Locked action" node-state
claim read the *label's* node, which always says `enabled=true`, so it could not go red; it is now a
phase-2 claim about the node a tap lands on.

Phase 2 runs after the suite with the agent-device daemon stopped, where the accessibility sweep
already lived. `scripts/real-input/android-tree-checks.mjs` holds twelve checks and 104 assertions
moved out of `origin/main:scripts/real-input/android.mjs` with the helpers they need, not rewritten:
the sheet's drags and the `TextInput` tap inside it, the drums' event count and the inline
calendar's column rule, the hosted dialog's `Back` and `Cancel`, and the
role/checked/selected/disabled facts on the node a person acts on for seven more controls. Both
phases leave one process exit and one ledger line, and `--control` scopes both. The module is
2 927 lines rather than the 1 500 aimed at: the 36 context methods the moved checks call, the moved
checks with the reasoning they shipped with, and the wheel and calendar geometry helpers. Everything
else of the old driver stays deleted; no library, harness or iOS file changed.

**The gate is red, and on a different test each clean run.** The three clean runs since phase 2
settled each lost one phase-1 test, in a different place: `popover`'s first G22 assertion at 21:42,
its second at 23:01, and in the last run `date-picker.e2e.ts`, refused by the driver — `perform tap
failed: Ref @e79 has no parent-owned touch point outside its interactive descendants` — after
passing 62 minutes earlier in 12.84 s. (The run before those failed the dialog node claim that has
since moved to phase 2, where it passes.) That last run is 27/28 controls and 36/36 auxiliary: the
sweep and every phase-2 check passed. Phase 2 is solid; phase 1 is one moving red test from green,
and no wait was added and nothing was loosened to move it. `check` is green on the final tree; two
green `real-input:android` runs in a row were not reached.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1987 tests / 88 suites | `03759525c338` | 1 m 33 s | start 6.4 / med 7.0 / max 8.2 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | stale | 659 tests / 31 suites + isolated 6 tests / 3 suites | 5c12f3af4b83 (not this tree) | 18 m 08 s | start 4.3 / med 4.1 / max 12.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **FAIL** | — | `03759525c338` (android tree) | 44 m 03 s | start 2.7 / med 4.0 / max 14.8 |
| `real-input:android:--control:bottom-sheet:--control:dialog:--control:chip` | stale | — | 28f58767cdbc (not this tree) | 14 m 05 s | start 3.6 / med 4.8 / max 6.2 |
| `real-input:android:--control:date-picker` | stale | — | 2746bc7f812e (not this tree) | 12 m 39 s | start 3.6 / med 4.4 / max 10.0 |
| `real-input:android:--control:date-picker:--control:hosted-mixed` | stale | — | 89b3158559a8 (not this tree) | 14 m 05 s | start 18.6 / med 5.5 / max 28.1 |

Two clean full runs of the gate, one lease: 23:01 in 2 642.5 s (27/28 controls, 35/36 auxiliary)
and 00:03 in 2 642.7 s (27/28 controls, 36/36 auxiliary). Phase 1 timed itself at 966.6 s (16 m 07 s)
inside the second; the other 1 676 s (27 m 56 s) is app and Metro start, the 24-case sweep and the
twelve tree checks. The target was under 30 minutes. The gate prints one duration for both phases,
so that split is the e2e runner's own number read against the ledger's, not a printed pair. The
mutation run before them took 2 605.3 s with every phase-2 check broken at once, which is the same
shape: the cost is phase 2, not the suite.

`need --for review` asks for two more: `harness:ios`, never run on this branch because no iOS build
was made this round, and `harness:android`, which passed at `713998e` on android tree `c7e23367a02b`
and reads as stale only because the two fixes after it touched `scripts/real-input/*`, which the
mapping counts as android code. No harness file changed in this branch.

## Red proofs

One mutation run carried every phase-2 check at once (`real-input:android`, 21:42, 23/28 controls
and 25/36 auxiliary checks passing), and a second, scoped run (`--control date-picker`, 22:48)
carried the three the first one missed. `example/src` and the mutation edits are not committed.
Format: check -> mutation -> the line that went red.

### Phase 2 — the moved `uiautomator` checks

- `bottom-sheet` a tap on the `TextInput` inside the sheet is one whole press -> `onPressIn={() => {}}` -> "expected Input touches: in 1 out 1, saw Input touches: in 0 out 1"
- `bottom-sheet` Back, an outside tap and a drag leave a non-dismissible sheet up -> `dismissible={false}` -> "Back leaves the sticky sheet up — expected 1, saw 0" and "and so does a tap outside — expected 1, saw 0"
- `context-menu` a drag starting on the control scrolls the page and opens nothing -> `scrollEnabled={false}` on `ctx-scroll` -> "a drag starting on the ContextMenu scrolls the page (of 3) — expected 3, saw 0"
- `date-picker` the inline calendar's column rule -> `wideBox` and `narrowBox` swapped between the two rows -> "'Wide inline calendar' is laid out in a 320 dp box, at the 360 dp width that decides the touch target" and the same sentence inverted for the 411 dp row
- `date-picker` one roll of a drum reports exactly one change -> the wheel's `onChange` counting two -> "one roll of the hour reports exactly one change, not one per row crossed — expected 1, saw 2"
- `hosted-date-picker` Back and Cancel close the dialog and report no day -> the popup Host seeded 2026-05-18 -> "expected 2026-05-17, saw 2026-05-18", twice
- `hosted-mixed` a linear Progress is as wide as the Slider in the same Host -> `variant="circular"` on that Progress -> "the linear bar is as wide as the Slider (105 vs 996)"
- `dialog` a disabled action is a node that is not enabled -> `disabled: true` taken off "Locked action" -> "expected false, saw true", and "a real tap on a disabled action leaves the alert up — expected 1, saw 0"
- `chip` the node a tap lands on says checked -> `selected={false}` on the controlled chip -> "the selected chip's node says it is checked — expected on, saw off"
- `checkbox` the same read on the box -> `checked={false}` -> "the checked box's node says it is checked — expected on, saw off"
- `icon-button` the same read on the toggle form -> `checked={false}` -> "the checked toggle's own node says it is checked — expected on, saw off"
- `button-group` the same read on each toggle item -> `withChecked(FORMAT_TOGGLES, [])` -> "the controlled toggle publishes a checkable state, and it says checked — expected on, saw off" and "the item publishes its own checked state — expected on, saw off"
- `picker` a disabled group's rows say not-enabled -> `disabled` taken off the radio picker -> "the disabled group's row \"Gabbro\" says it is not enabled — expected false, saw true" (and Peridot, Scoria)
- `list-item` a disabled row is in the tree as disabled and takes nothing -> `disabled` taken off the row -> "expected false, saw true" and "three real taps on a disabled item: real-input-listitem-disabled-events went to \"3\" when it should have stayed \"0\""

Phase 2's accessibility sweep is not new to this task and was not edited by it, so its own red
proofs stay where they were made; its three known-failing rules (Slider, SegmentedControl,
Stepper — a `RangeInfo` node nothing is actionable on) still print as notes, not failures.

### Phase 1 — the suite still bites

Four of the last round's proofs, re-run here rather than trusted:

- `button-group.e2e.ts` one real tap presses one item and reports its id -> `withChecked(FORMAT_TOGGLES, [])` -> "the 'Italic' item of 'Real-input formatting toggles' is not 'on' on its node"
- `chip.e2e.ts` a real tap on a filter Chip reaches JS -> `selected={false}` -> "'Real-input chip' is not 'on' on the node that holds its state: android…"
- `switch.e2e.ts` a real tap reaches JS and the node says so too -> `onValueChange={() => {}}` -> "a real tap on the Switch reaches JS, and the node says so too: failed"
- `hosted-date-picker.e2e.ts` the hosted dialog opens and a day cell reaches JS -> the popup Host seeded 2026-05-18 -> "expect.toHaveText failed"

### Not a mutation: `popover` G22

The same run failed `popover.e2e.ts` "a TextInput inside a popover stays above the keyboard (G22)"
with "the focused field's bottom (1972 px) is below the keyboard's top (1541 px)" while nothing on
the Popover screen was touched. `fieldAboveKeyboard` (`example/e2e/real-input/keyboard.ts:233`)
reads the box once and does not poll, so a placement that is still animating when the box is read
reads as a control under the keyboard. It went red again on the next run (23:01, the other half of
the pair) and green on the run after that, which lost a different control instead. No wait was added
and nothing was loosened — see "Follow-ups".

## Assertions this gate no longer makes

The old driver's 468 assertions across 28 controls fold into 236 distinct observables — a read of
the same echo taken N times is one observable. The appendix lists every one this gate no longer
makes, each beside the `example/__tests__/<Name>.harness.tsx` test that asserts the same
observable, and separately the 32 that have no witness at all. Of the 236, phase 1 re-expresses
86, the a11y sweep 3 and the phase-2 tree checks 11 more; 104 are asserted only in the harness.
Nothing was dropped without a test named for it.

X44 removed no e2e test that had gone green on a device and added none that had not been shown
red; the one exception runs the other way — the dialog's "Locked action" node-state claim came out
of `dialog.e2e.ts`, where it read the label's node and so could never go red, and went into
phase 2 as a claim about the node a tap lands on.

Phase 2 keeps, per control, exactly what was moved out of
`origin/main:scripts/real-input/android.mjs` — 104 assertions over twelve checks. "Also made" is
what the old driver asserted on the same control that this gate no longer does, and the test that
observes it instead; titles are copied from the harness files.

| Control | Phase 2 asserts | Also made, and where it lives now |
| --- | --- | --- |
| `bottom-sheet` | 10: the sheet node is named, a tap inside it presses once, a horizontal drag scrolls its list and leaves it up, the Pressable still answers after that scroll, `Back`/outside-tap/drag-down all fail to close a non-dismissible sheet, a drag up expands it, `Back` from there leaves it half expanded | nothing — all twelve of the old driver's claims moved |
| `context-menu` | 5: a drag starting on the control scrolls the page (3/3) and opens nothing, a hold-then-drag opens it with the page still, `Back` closes it once | pan inside an inner `ScrollView`, outside-tap close, non-accessible menu publishes no long-click → see gaps |
| `date-picker` | 18: the uncontrolled wheel reports nothing before a touch, both drums are named, one roll reports exactly one change, the rolled hour moves and the day is left alone, a refused roll leaves the drum on the parent's time; the inline calendar's column rule in a 40 dp-wide and a narrow box | `DatePicker.harness.tsx` "reports a pick once, and nothing for the same day"; "clamps a value and a pick to minimumDate/maximumDate"; "sends nothing from a disabled time drum"; "reverts a time the parent refuses, and reports the next roll of it"; "shows the month the value is in, and moves the page with it" |
| `hosted-date-picker` | 3: `Back` closes the hosted dialog and reports no day, the app's text is readable again once it is gone, `Cancel` does the same | `HostPopups.harness.tsx` "opens its dialog as a window of the Host's composition"; "leaves no window behind when the composition that opened one goes away"; "takes a hosted dialog down when only its child leaves the Host" |
| `hosted-mixed` | 4: the linear bar is as wide as the Slider beside it, the circular indicator keeps its own width and stays square, the Switch keeps its own width | `Progress.harness.tsx` "hosts each variant, fills the width for a bar and keeps a square for a ring"; "honours an explicit size instead of its own box"; `Host.harness.tsx` "lets a real touch reach a hosted Switch, and JS sees the new value" |
| `dialog` | 3: a disabled action is a node that is not enabled, an ordinary one is, and a real tap on the disabled one leaves the alert up | `Dialog.harness.tsx` "reports an action before the close it causes"; "does nothing on a user dismissal while not dismissible"; "updates title, message and a disabled action in place while up" |
| `chip` | 8: selection per real tap both ways, two taps report two changes, the assist chip's press, and the disabled filter and assist chips both announcing not-enabled against their enabled twin | `Chip.harness.tsx` "takes no press while disabled, of either variant"; "reverts a toggle JS refused"; "presses an assist chip once per press, and it has no selection"; "tells accessibility what it is and whether it is selected" |
| `checkbox` | 8: state and counter before a touch, the box publishing a toggleable state that says unchecked, one tap one check one change, the second tap back to unchecked reported both ways | `Checkbox.harness.tsx` "takes no toggle while disabled"; "reverts a toggle JS refused"; "follows a controlled checked in both directions"; "draws the third state on both platforms, and off in the switch style" |
| `icon-button` | 11: the same handshake on the toggle form, the refusing form asked for nothing, the disabled control's counter unmoved, two taps two changes | `IconButton.harness.tsx` "presses once per tap, and takes none while disabled"; "reverts a toggle JS refused, and shows the value JS wrote"; "names the control, and a toggle says whether it is checked" |
| `button-group` | 15: the toggle set React rendered, the checked state published on the item's own node, one tap one change both ways, the disabled item and the disabled group reporting no press | `ButtonGroup.harness.tsx` "presses once per item, from the row and from the overflow menu"; "flips a toggle once per tap, and reverts one its parent refused"; "takes nothing from a disabled group or a disabled item, and closes an open menu" |
| `picker` | 9: radio rows are the control (no popup window belongs to it), a tap on row 2 is index 2, one row one change, the tree marking the chosen row, enabled against disabled group, a disabled row reporting nothing | `Picker.harness.tsx` "measures a radio group as its option count, one row per option"; "draws the selected row as a selected row (E2)"; "picks a row through the selection path and rolls back a refused one"; "reports nothing for the row already chosen, or for a disabled group"; "reports one event for a roll that passed several rows" |
| `list-item` | 3: the disabled item is in the tree as disabled, three real taps on it report nothing, and the live item still presses after them | `ListItem.harness.tsx` "takes no press and sends nothing while disabled"; "publishes one node, whose role is a button only with `onPress`" |

### No witness found

32 of the 236 observables have no witness in either phase *and* no harness test: they are listed
with their old-driver line and the reason nothing replaced them in the appendix. They cluster into
four kinds, all of them things only a `uiautomator` tree could see:

- **Baseline reads** the old driver made before acting — "no popup window belongs to the app
  before a touch" (`button-group`, `menu`, `picker`, `hosted-picker`, `hosted-segmented`), "no
  alert is up before a touch", "no tooltip is up before a touch". The moved checks wait for the
  window to appear instead of proving it was absent.
- **Node roles and values** published by the Android widget: Menu's and Picker's
  list-of-choices role, the trigger's value being the title it paints, and SegmentedControl's
  one named radio node per option (5 rows). `a11yProblems` never reads a role or `enabled`, and
  the reader's `groupAnnounces` helper has no call site.
- **Reading order and surrounding text**: the RN text above and below a `Host` staying in the
  tree and being read in that order around the hosted Switches.
- **Gesture negatives on the untested axis**: a drag along a Form row or a ListItem row being a
  scroll (only the vertical flick is driven), a 1.4 s hold on a Stepper half stepping once with no
  Android auto-repeat, keystrokes inside a Popover, the ripple ink being gone after the lift, and
  a tap outside a Form still pressing.

None of the 32 caught a library defect in the driver era, and each is cheap to add as a phase-2
check — a follow-up, not this task.

## Why these twelve checks are not e2e tests

Three limits of the driver's own surface decide this, and they are worth filing upstream.
Its node map publishes no `clickable`, `checkable` or `scrollable`, so a control's state has to be
read off the node a finger lands on and an actionable node cannot be told from a text node at all;
it refuses a swipe whose path leaves the view it started in, which is exactly what a page scroll
beginning on a control, or a drag across a time drum, has to do; and `uiautomator dump` is killed
while its session holds the device's single accessibility connection, so the tree a check wants
cannot be asked while the driver is attached — which is why phase 2 runs after the suite with the
daemon stopped, beside the sweep that has always done it that way.

## Files changed

- `scripts/real-input/android-tree-checks.mjs` — new: the twelve `uiautomator`-only checks, the
  context they need, and the two fixes that only a clean run could show (2 927 lines).
- `scripts/real-input/a11y-sweep-device.mjs` — `SweepDevice` exported, and given `motion`, `key`,
  `tapAt`, `density` and `popupWindowCount`.
- `scripts/real-input/android.mjs` — calls the phase after the sweep; `--control` scopes it.
- `example/e2e/README.md`, `docs/tasks/X44-real-input-hybrid.md` — the two-phase shape, and the brief.
- `example/e2e/real-input/*` — phase 1: the suite as it ran green twice, plus the reader/os-tree
  checks that were shown red, minus the dialog node-state claim.

## Follow-ups

- `popover` G22 (`example/e2e/real-input/keyboard.ts:233`): `fieldAboveKeyboard` and the placement
  test each read one box once, right after `expectKeyboard` first sees an inset. A poll-until-rest on
  the *box* (deadline, same assertion, failure still names the same numbers) would settle it; that is
  a wait, so it was not done here.
- `origin/main` was force-pushed while this task ran: `git fetch` moved it from `dd14b8db` (the
  commit merged at `0361d729`) to `66c76dcb`, same messages, new SHAs, so `HEAD` and `origin/main`
  now share no merge base and `gate.mjs need` can no longer read the diff base. Nothing was merged
  over it.
- Device host: the machine rebooted at 20:44 WET mid-round (`uptime` says 55 minutes as of 21:39),
  which killed every emulator and simulator on it, wiped `/tmp`, and SIGTERMed the
  `real-input:android` run in flight; `lease.mjs acquire --task X44 --boot` brought the pair back.
- Host load: it came back at load1 172 with `milod` and `spotlightknowledged.updater` reindexing,
  and the lease's own boot wait timed out at the settle ceiling ("load average 176.93 is still
  above the settle ceiling 5 after 181s"). Device timings measured on this box today are not
  numbers to quote as typical.
- Crash on launch: `nitroui.example` took a SIGTRAP in `libhwui`
  (`GrGLGpu::bindTextureToScratchUnit` ← `GlyphVector::regenerateAtlasForGanesh`) at 20:27:27,
  20:28:30 and 20:39:09, same fault address each time, `-gpu host`. Four of the e2e failures in
  this round are that, not a control refusing a finger.
- Gate diagnostics: when the app is not in the tree at setup the gate says "no tab bar in the
  accessibility tree"; the crash buffer next to that sentence would name the cause immediately.
- Coupling: e2e bails on the first failure, so one crashing app ends phase 1 and the run that
  follows it is decided by the app's health rather than by the checks.
- Five old-driver observables are left with no witness at all (the list above) — cheap to add as
  phase-2 checks.
- Tooling: `it(`cycles 10 more times (round N)`)` in `example/__tests__/Popover.harness.tsx:974`
  is invisible to any harness-title extraction that matches quoted strings only; X44's inventory
  had to be rebuilt to follow template literals.
- Phase-2 duration: the twelve checks are the expensive half of the gate; if the 30-minute target
  matters, the next step is one dump per check rather than one per read, not fewer checks.
- `date-picker.e2e.ts` (00:03 run): the day cell is named "Friday, November 20, 2026", `waitFor`
  says visible, and the driver then refuses the tap outright — a ref whose whole tappable area
  belongs to a child gets no coordinate at all. Same test, same tree, green at 23:01. No gate log
  shows a crash in that run, so this is either the driver's tap resolution reading a tree a frame
  too early or the calendar's own node shape; the trace directory is cleaned when the next run
  starts, so a filtered run is the only way to see it again.

## Appendix — every assertion this gate no longer makes, beside its harness twin

`scripts/real-input/android.mjs` on `origin/main` was 11 135 lines and made 468 assertions over 28
controls. Repeated reads of one echo (tap twice, read the counter, read it again) fold into a single
observable, which leaves 236. The 100 the gate still makes are not here: 86 are read by a
phase-1 spec in `example/e2e/real-input/`, 3 by the a11y sweep and 11 in some wording by a phase-2 tree
check; all 104 assertions phase 2 makes have a verbatim twin in the old driver's text, which is
the mechanical form of "moved, not rewritten". The 104 rows below are the rest — each is asserted nowhere on a device now, and this is the test that asserts the same
observable from inside React. The further 32 have no witness at all and are listed on their own
below. Titles are copied from the harness files; line numbers are this tree's.

| Control | The old driver read | Asserted now, in `example/__tests__` |
| --- | --- | --- |
| `button` | a second real tap presses the enabled Button again | `example/__tests__/Button.harness.tsx:354` "fires onPress once per tap and nothing when disabled" |
| `button` | a real tap on the disabled Button does not press it | `example/__tests__/Button.harness.tsx:403-404` |
| `button-group` | pressing the action items never moves the toggle state | `example/__tests__/ButtonGroup.harness.tsx:462` "presses once per item, from the row and from the overflow menu" |
| `button-group` | a refused toggle asks for true and the item snaps back to unchecked | `example/__tests__/ButtonGroup.harness.tsx:496` "flips a toggle once per tap, and reverts one its parent refused" |
| `button-group` | a refused group leaves the group next to it alone | same test |
| `button-group` | the enabled item of a half-disabled group still answers | `example/__tests__/ButtonGroup.harness.tsx:591` "takes nothing from a disabled group or a disabled item, and closes an open menu" |
| `button-group` | a too-narrow well overflows an item and still draws the ones that fit | `example/__tests__/ButtonGroup.harness.tsx:323` "moves the items a 220-point well cannot hold, and takes some back when it grows" |
| `button-group` | the overflow control announces itself, so a reader can find the menu | `example/__tests__/ButtonGroup.harness.tsx:686` "names every item kind, and an icon-only item by its title" |
| `button-group` | a real tap on the overflow control opens the menu | `example/__tests__/ButtonGroup.harness.tsx:462` "presses once per item, from the row and from the overflow menu" |
| `button-group` | a real tap on the overflowed row reports onPress for it, once | same test |
| `button-group` | the overflow pick leaves the rest of the row's counters alone | same test |
| `checkbox` | a refused toggle still reaches JS asking for true, and the box snaps back with its echo unmoved | `example/__tests__/Checkbox.harness.tsx:501` "reverts a toggle JS refused" |
| `checkbox` | a real tap on the disabled checkbox reports nothing | `example/__tests__/Checkbox.harness.tsx:723` "takes no toggle while disabled" |
| `chip` | a refused toggle asks for true and the chip snaps back | `example/__tests__/Chip.harness.tsx:607` "reverts a toggle JS refused" |
| `date-picker` | the control displays the day React holds | `example/__tests__/DatePicker.harness.tsx:653` "shows the month the value is in, and moves the page with it" |
| `date-picker` | a refused pick is rolled back, the parent keeps its day, and the next pick is fresh | `example/__tests__/DatePicker.harness.tsx:558` "reverts a pick the parent refuses" |
| `dialog` | Back and an outside tap each close the alert with one close and no action | `example/__tests__/Dialog.harness.tsx:478` "reports a JS close as nothing, and a user close as a close (barrier twin)" |
| `dialog` | a non-dismissible alert stays up under Back, and its one action closes it reporting the action first | `example/__tests__/Dialog.harness.tsx:659` "does nothing on a user dismissal while not dismissible" |
| `dialog` | the sheet shows the title the app asked to be visible | `example/__tests__/Dialog.harness.tsx:671` "updates title, message and a disabled action in place while up" |
| `dialog` | the sheet's disabled row is published not-enabled | `example/__tests__/Dialog.harness.tsx:546` "reports the sheet rows as the component draws them, disabled included" |
| `dialog` | a real tap on a disabled row takes nothing and leaves the sheet up | `example/__tests__/Dialog.harness.tsx:512` |
| `dialog` | a sheet's row reports its id once, then the close | `example/__tests__/Dialog.harness.tsx:1020` "composes the confirmation form as a sheet with one row per action" |
| `form` | repeated real taps on a row press exactly once each, and nothing else fires | `example/__tests__/Form.harness.tsx:885` "aims a row content at its Yoga origin and presses it on both platforms (E4)" |
| `hosted-button` | a second real tap presses the hosted Button again | `example/__tests__/HostControls.harness.tsx:944` "presses exactly one hosted Button per tap" |
| `hosted-button` | a real tap on the disabled hosted Button does not press it | `example/__tests__/HostControls.harness.tsx:915` "keeps a disabled hosted Button inert, and the same tap answers once enabled" |
| `hosted-date-picker` | the dialog opens on the month the Host is drawing | `example/__tests__/HostPopups.harness.tsx:923` "opens its dialog as a window of the Host’s composition" |
| `hosted-date-picker` | while the hosted dialog is up it is a window of its own and the app's own text is gone | `livePresentations === 1` |
| `hosted-date-picker` | removing only the hosted child leaves no dialog window behind | `example/__tests__/HostPopups.harness.tsx:1000` "takes a hosted dialog down when only its child leaves the Host" |
| `hosted-mixed` | the mixed Host publishes its own node for each of its five children, in mount order | `example/__tests__/HostControls.harness.tsx:1207` "keeps every kind of control live in one Host" |
| `hosted-mixed` | the Button in a mixed Host presses, and nothing else in it moved | same test |
| `hosted-picker` | the hosted menu marks the current choice selected to a reader | `example/__tests__/Picker.harness.tsx:1435` "draws the selected row as a selected row (E2)" |
| `hosted-picker` | a real tap on a menu row closes the popup | `example/__tests__/HostPopups.harness.tsx:744` "a row closes it, the handshake holds, and a refusal still closes it" |
| `hosted-picker` | opening and dismissing reported no selection — a menu is not a choice | `example/__tests__/Picker.harness.tsx:1486` "does not treat opening as a choice, and the next mount sizes normally after going away mid-menu" |
| `hosted-segmented` | the drawing did not move out from under the finger | `example/__tests__/SegmentedControl.harness.tsx:641` "keeps its size when the selection moves" |
| `hosted-segmented` | a real tap on the last segment reaches JS as index 2 | `example/__tests__/HostPopups.harness.tsx:618` "takes a real press on a segment, through the Host’s composition" |
| `hosted-slider` | the hosted Slider fills the Host box rather than its own style width | `example/__tests__/HostControls.harness.tsx:1535` "stretches a hosted Slider across the Host box, not its own style width" |
| `hosted-slider` | the hosted Slider is drawn as a track, not a square | `:1553-1559` |
| `hosted-slider` | dragging back moves a hosted Slider the other way | `example/__tests__/HostControls.harness.tsx:700` "snaps a hosted Slider back when JS refuses the drag" |
| `hosted-slider` | a drag the machine stretches out still lands where the finger left it | `example/__tests__/Slider.harness.tsx:966` "coalesces a drag to at most one onValueChange per frame" |
| `hosted-switch` | a second real tap flips it back and the Host reports both changes | `example/__tests__/Host.harness.tsx:321` "lets a real touch reach a hosted Switch, and JS sees the new value" |
| `icon-button` | a refused toggle asks for true and snaps back to unchecked | `example/__tests__/IconButton.harness.tsx:786` "reverts a toggle JS refused, and shows the value JS wrote" |
| `icon-button` | the disabled press button and the disabled toggle take nothing | `example/__tests__/IconButton.harness.tsx:1155` "takes no press while disabled, on either form" |
| `list-item` | a real tap inside a Form.Row reaches the item | `example/__tests__/ListItem.harness.tsx:951` "draws no insets, container or highlight of its own inside a Form.Row" |
| `menu` | the log pairs every open with a close, and orders each pick open → select → close | `example/__tests__/Menu.harness.tsx:989` "opens once, closes once, and pairs every open with a close" |
| `menu` | the checked row is still pickable and reports exactly one select | `example/__tests__/Menu.harness.tsx:916` "reports one onSelect per pick and nothing for a row that cannot be picked" |
| `menu` | the two halves sit side by side, without overlapping, at the same height | `example/__tests__/Menu.harness.tsx:2018` "is two halves, and each one does only its own job" |
| `menu` | the split trigger has reported nothing before a touch | `liveBefore` |
| `menu` | a real tap on the action half runs the primary action | `:2075-2078` |
| `menu` | and raises no list — no window, and no open in the echo either | `:2079-2084` |
| `menu` | one press of the list half is one open and one close, action included | `example/__tests__/Menu.harness.tsx:2018` |
| `menu` | a pick from the split list closes its own popup | `:2110-2115` |
| `picker` | the open menu marks the current choice selected to a reader | `example/__tests__/Picker.harness.tsx:1435` "draws the selected row as a selected row (E2)" |
| `picker` | opening and dismissing reported no selection | `example/__tests__/Picker.harness.tsx:1486` "does not treat opening as a choice, and the next mount sizes normally after going away mid-menu" |
| `picker` | and the anchor still shows the title it started with | `example/__tests__/Picker.harness.tsx:766` "reads back what React sent" |
| `picker` | tapping the row already chosen closes the menu and reports nothing | `example/__tests__/Picker.harness.tsx:1738` "reports nothing for the row already chosen, or for a disabled group" |
| `picker` | one choice reports exactly one change | `example/__tests__/Picker.harness.tsx:1688` "picks a row through the selection path and rolls back a refused one" |
| `picker` | choosing closes the popup it opened | `example/__tests__/HostPopups.harness.tsx:744` "a row closes it, the handshake holds, and a refusal still closes it" |
| `picker` | the anchor paints the chosen title and the control re-measures to fit it | `example/__tests__/Picker.harness.tsx:560` "re-measures when the selection moves to a longer title" |
| `picker` | a refused pick is rolled back, the anchor returns to the parent's title, and the next pick is fresh | `example/__tests__/Picker.harness.tsx:1688` "picks a row through the selection path and rolls back a refused one" |
| `picker` | unmounting with the menu open leaves no popup window | `example/__tests__/Picker.harness.tsx:1486` "does not treat opening as a choice, and the next mount sizes normally after going away mid-menu" |
| `picker` | the disabled picker opens no menu, while the enabled one does and closes again | `example/__tests__/Picker.harness.tsx:1738` "reports nothing for the row already chosen, or for a disabled group" |
| `picker` | the wheel has reported no index and no change before a roll | `example/__tests__/Picker.harness.tsx:2161` "reports nothing for the row already shown, or for a disabled wheel" |
| `picker` | one fling across several rows reports exactly one change | `example/__tests__/Picker.harness.tsx:1992` "reports one event for a roll that passed several rows" |
| `picker` | the second roll moved the drum again | `example/__tests__/Picker.harness.tsx:2021` "rolls a refused pick back, and reports the next roll of it again" |
| `popover` | a tap outside closes the popover and reports it | `example/__tests__/Popover.harness.tsx:881` "closes like a tap outside does: onIsPresentedChange(false), then onDismiss" |
| `popover` | the press inside reports, then the dismiss its own close causes | `example/__tests__/Popover.harness.tsx:881` |
| `popover` | ten opens and closes repeat cleanly and leave nothing up | `example/__tests__/Popover.harness.tsx:974` |
| `search-field` | a chosen placeholder is drawn, and a missing one still draws a word for search | `example/__tests__/SearchField.harness.tsx:659` "shows the placeholder it was given, and what the platform brings when given none" |
| `search-field` | maxLength keeps five of seven keys and the field holds the same five | `example/__tests__/SearchField.harness.tsx:436` "holds maxLength in UTF-16 units and never splits an emoji" |
| `search-field` | every key into the frozen field is reported to JS and then reverted | `example/__tests__/SearchField.harness.tsx:410` "reverts an edit JS refuses, and the next edit starts from the refused text" |
| `search-field` | a hardware KEY_ENTER with an empty query submits nothing and blurs nobody | `example/__tests__/SearchField.harness.tsx:522` |
| `search-field` | clearing keeps focus: no blur, no submit | `example/__tests__/SearchField.harness.tsx:484` "reports the clear button as one empty edit and keeps the focus" |
| `search-field` | a hardware KEY_ENTER submits the query and then blurs | `example/__tests__/SearchField.harness.tsx:522` |
| `search-field` | a button that calls `ref.focus()` focuses, and one that calls `ref.blur()` blurs | `example/__tests__/SearchField.harness.tsx:624` "focuses from its parent’s mount effect" |
| `search-field` | the keyboard type the app asked for reaches the IME, Search action included (none, number-pad, email) | `example/__tests__/SearchField.harness.tsx:725` "gives the field the keyboard the app asked for, Search key included" |
| `search-field` | keys reach a field whose keyboard was changed | `example/__tests__/SearchField.harness.tsx:388` "round-trips typed text to JS, one event per keystroke" |
| `search-field` | keyboardType changed while focused restarts the input session | `example/__tests__/SearchField.harness.tsx:725` "gives the field the keyboard the app asked for, Search key included" |
| `segmented-control` | one tap reports one change | `example/__tests__/SegmentedControl.harness.tsx:1210` "reports one event per selection, and nothing when disabled" |
| `segmented-control` | the three items are one row, and each segment is within the connected gap of its neighbour | `example/__tests__/SegmentedControl.harness.tsx:456` "is as wide as its own segments added up" |
| `segmented-control` | the control did not move out from under the finger | `example/__tests__/SegmentedControl.harness.tsx:641` "keeps its size when the selection moves" |
| `segmented-control` | a real tap on the first segment reaches JS as index 0 | `example/__tests__/SegmentedControl.harness.tsx:1210` "reports one event per selection, and nothing when disabled" |
| `segmented-control` | a refused selection is rolled back, and the next tap is a fresh selection | `example/__tests__/SegmentedControl.harness.tsx:1278` "snaps back a selection React does not accept" |
| `slider` | no gesture has been reported yet | `example/__tests__/Slider.harness.tsx:607` "reports start, change and complete for one drag" |
| `slider` | one drag fires start once, complete once, in start → change → complete order, reporting the way over | `example/__tests__/Slider.harness.tsx:607` "reports start, change and complete for one drag" |
| `slider` | a second drag fires both phases again, in the same order | `example/__tests__/Slider.harness.tsx:607` "reports start, change and complete for one drag" |
| `slider` | dragging back moves the value the other way | `example/__tests__/Slider.harness.tsx:607` "reports start, change and complete for one drag" |
| `slider` | a press that never moves the thumb still reports a gesture, in order, on the value it already had | `example/__tests__/Slider.harness.tsx:642` "reports a gesture for a touch that never moves the thumb, in drag order" |
| `stepper` | the refusing stepper has been asked for nothing yet | `example/__tests__/Stepper.harness.tsx:650` "reverts a change the app refused, and shows a value the app wrote" |
| `stepper` | the counter the disabled stepper reports into starts at zero, so a stray event is visible | `example/__tests__/Stepper.harness.tsx:691` "sends nothing while disabled, and follows the flag back" |
| `stepper` | none of the half buttons is clickable, so the merged node is the only stop | `example/__tests__/Stepper.harness.tsx:869` "presents one adjustable control to a reader" |
| `stepper` | one real tap on the lower half steps back | `example/__tests__/Stepper.harness.tsx:507` "steps one value and reports one event per step" |
| `stepper` | the stepper is at its minimum and the half there reports nothing | `example/__tests__/Stepper.harness.tsx:543` "disables the half at a bound and reports nothing from it" |
| `stepper` | upward taps stop at the maximum and the half there reports nothing | same test |
| `stepper` | a refused request reaches JS asking for one step above the value React kept, and leaves the live stepper alone | `example/__tests__/Stepper.harness.tsx:650` "reverts a change the app refused, and shows a value the app wrote" |
| `stepper` | a real tap on the disabled stepper's half reports no step | `example/__tests__/Stepper.harness.tsx:691` "sends nothing while disabled, and follows the flag back" |
| `switch` | a second real tap flips it back, so the check is not one fluke | `example/__tests__/Switch.harness.tsx:366` "follows a controlled value in both directions" |
| `text-field` | maxLength 5 keeps five of seven keys and the field holds the same five | `example/__tests__/TextField.harness.tsx:377` "holds maxLength in UTF-16 units and never splits an emoji" |
| `text-field` | every key into the frozen field is reported to JS and each one is reverted | `example/__tests__/TextField.harness.tsx:345` "reverts an edit JS refuses, and the next edit starts from the refused text" |
| `text-field` | Enter submits the text and then blurs the field | `example/__tests__/TextField.harness.tsx:598` "reports focus and blur, focuses on a tap, and submits on Return" |
| `text-field` | a button that calls `ref.focus()` focuses, and one that calls `ref.blur()` blurs | `example/__tests__/TextField.harness.tsx:497` "focuses from its parent’s mount effect" |
| `tooltip` | a real tap on a closed tooltip's anchor presses the anchor and opens nothing | `example/__tests__/Tooltip.harness.tsx:267` "leaves a tap on its anchor to the anchor (check 1)" |
| `tooltip` | a tap outside closes the tooltip and reports the close alone | `example/__tests__/Tooltip.harness.tsx:488` "reports a JS close as nothing, and a user close as a close (barrier twin)" |
| `tooltip` | Back closes it and reports the close alone | same test |
| `tooltip` | once closed, a real tap on the anchor presses it once more | `example/__tests__/Tooltip.harness.tsx:267` "leaves a tap on its anchor to the anchor (check 1)" |

## Appendix — the 32 observables with no witness at all

Old driver = `scripts/real-input/android.mjs` at `6da369a0~1`, the last commit before the rewrite.

| Control | The old driver read | Old driver | Why nothing replaced it |
| --- | --- | --- | --- |
| `button-group` | no popup window belongs to the app before the overflow is opened | :2610 | `popupWindowCount()` survives only in the radio-picker check |
| `dialog` | no alert is up before a touch | :3560 | phase 2b opens with `tapUntilUp` (`scripts/real-input/android-tree-checks.mjs:2159`) and never reads the empty baseline |
| `form` | a row without onPress does not press | :5844 | no phase-1 spec, phase-2b check or `Form.harness` case covers a row with no handler |
| `form` | a tap outside the Form is one press (the refusal was not a dead screen) | :5846 | the barrier half of the old pair has no replacement |
| `form` | a drag that slides along the row is not a press | :5950 | phase 1 only tests the vertical flick (`example/e2e/real-input/form.e2e.ts:41-71`) |
| `hosted-picker` | no popup window belongs to the app before a touch | :816 | phase 1 waits for a row (`example/e2e/real-input/hosted-picker.e2e.ts:28-29`), never counts windows |
| `hosted-picker` | Back shuts the hosted popup with no window left behind | :931 | no Back step exists for a hosted popup in any gate; phase 2b Back only for the hosted **dialog** |
| `hosted-segmented` | a SegmentedControl has no popup window, before or after a tap | :715, :754 | segmented-control has no phase-2b check at all |
| `hosted-switch` | the React Native text above and below the Host is still in the tree | :338, :343 | `a11yProblems` looks only for the control's own label (`scripts/real-input/a11y.mjs:1538`) |
| `hosted-switch` | the RN text above the Host is read before every hosted Switch, and the note below after | :358, :363 | no reading-order assertion exists anywhere in `scripts/real-input/` or `example/e2e/real-input/` |
| `icon-button` | pressing the press form never moves the toggle form's value | :2109, :2114 | the harness counts presses (`example/__tests__/IconButton.harness.tsx:902`) and never a sibling's toggle echo |
| `icon-button` | a tap on the toggle form is not also a press | :2165 | no test reads a press counter beside a toggle |
| `list-item` | the highlight is back where it started once the finger lifts | :6369 | `pressPaintsFeedback` samples the held frame only (`example/e2e/real-input/press-feedback.ts:157-171`) |
| `list-item` | a drag that starts on the row is a scroll, not a press | :6510 | the guard exists for a Form row, never for a ListItem |
| `menu` | the trigger's node carries the title it paints as its value | :1013 | `example/__tests__/Menu.harness.tsx:2625` reads back the label prop; no gate reads a node's value |
| `menu` | the node announces the role of a list of choices | :1020 | `a11yProblems` never reads a role, and the Spinner-class assertion is gone |
| `menu` | no popup window belongs to the app before a touch | :1035 | menu has no phase-2b check at all |
| `menu` | the split trigger's two halves are one named node each | :1294, :1299 | the sweep grades the whole Menu's label only; `example/__tests__/Menu.harness.tsx:2018` measures the halves' rects, not their names |
| `menu` | the list half shuts on Back | :1377 | `dismissPopup` is used after a row tap, never for the split list half |
| `picker` | no popup window belongs to the app before a touch | :5026 | the surviving window-count check is for the radio group (`scripts/real-input/android-tree-checks.mjs:2694`) |
| `picker` | Back shuts the popup with no window left behind | :5054 | `dismissPopup` lives in `menu.e2e.ts` only; `picker.e2e.ts` never presses Back |
| `picker` | the anchor's node carries the value it shows | :5353 | no gate reads `contentDescription`+value together |
| `picker` | the node announces the role of a list of choices | :5366 | as for menu |
| `picker` | the disabled picker is one node as well | :5372 | `Real-input disabled picker` is not swept (`scripts/real-input/a11y.mjs:205-212` covers the enabled one) |
| `picker` | and that node is the one that says it is disabled | :5377 | `a11yProblems` never reads `enabled`; `treeAnnounces` has no picker call site |
| `picker` | the radio group is named once, then its rows | :5483 | `Real-input radio picker` is not swept; phase 2b reads its rows' flags, not the group name |
| `picker` | the drum is named once, and its named node says it is enabled | :5581, :5586 | no wheel/drum id in `A11Y_CONTROLS` (`example/src/PickerScreen.tsx:308`, `:596`) |
| `popover` | real keystrokes reach the field inside the popover, before its own close | :4094 | `popover.e2e.ts` focuses the field and measures it; it never types |
| `segmented-control` | the group publishes one named radio node per option, each carrying the selection | :3241, :3246, :3252, :3257, :3266 | `groupAnnounces` (`example/e2e/real-input/reader.ts:179`) is dead code, and the harness asserts only the control's own label (`example/__tests__/SegmentedControl.harness.tsx:848`) |
| `segmented-control` | segment 1 keeps its connected corner: the border is still on the top edge | :3394 | the only drawn-pixel harness check for this control is the tint (`:1073`) |
| `stepper` | a 1.4 s hold on the plus half steps exactly once (no Android auto-repeat) | :2867 | no hold/long-press/repeat case in `example/__tests__/Stepper.harness.tsx` |
| `tooltip` | no tooltip is up before a touch | :3783 | phase 1 waits for the tip only after the tap (`example/e2e/real-input/tooltip.e2e.ts:21-22`) |

The two raw reads in `example/e2e/real-input/device-read.ts` are the only places the suite touches
`uiautomator` itself, and they are accepted as written.

## Questions for orchestrator

1. **The suite loses one test per run, in a different place, and the gate cannot be green until
   that stops.** `popover` G22's two halves (21:42, 23:01) and now `date-picker`'s day-cell tap
   (00:03), where the driver refuses the tap it accepted an hour earlier. Both families smell the
   same: a node map read one frame before the window has settled. (a) Settle the *measurement* — poll
   the popup's box until it stops moving, up to a deadline, then assert exactly what is asserted now;
   the numbers printed do not change and a library that never moves the popup still reds. It is four
   lines in `example/e2e/real-input/keyboard.ts`. (b) Same treatment for the day-cell tap, which the
   driver refuses rather than misses, so it needs a re-read of the ref, not a wait. (c) Drop the
   three tests as "not green on a device": cheap, but G22's two were shown red by a mutation and no
   harness test measures a popup window against an `InsetsSource`, so that observable would have no
   witness at all. **Recommendation: (a), then re-run once for (b)'s evidence.** A full run is 44
   minutes, so one round is one run: say the word and it is a small commit plus two runs, which is
   what green twice needs. I did not do it under this brief because a wait to reach green was ruled
   out and the budget was spent.
2. **The base moved.** `origin/main` was rewritten under this branch (`dd14b8db` → `66c76dcb`), so
   the merge at `0361d729` is against a commit that is no longer `main`, and `gate.mjs need` no
   longer knows the diff base. Should this branch re-merge, or is the rewrite the orchestrator's own
   history edit that the branch should simply be rebased onto at review time?
