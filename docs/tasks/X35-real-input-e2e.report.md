# X35 — Android real-input runs on e2e

**Branch:** `task/X35-real-input-e2e` (from `origin/task/W3-tooling-removal`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** none — both device pairs were held for the whole
round and X35 was first in the queue from 13:47Z, so no device gate ran (see "What the lease did
not let me prove"). The code therefore rests on `check` plus one CPU-only red proof.

## Summary

Android real-input runs on e2e. `example/e2e/real-input/` holds one `<control-id>.e2e.ts` per row
of `scripts/real-input/controls.mjs` — 28 files, 36 tests — driven by `@e2e-dev/mobile`
(agent-device) on the leased emulator and addressed only through the lease (`ANDROID_SERIAL`,
`ANDROID_ADB_SERVER_PORT`, its Metro port). `scripts/real-input/android.mjs` went from 11,135
lines of `adb shell input` and `uiautomator dump` to 516 lines that own the device, the stamped
APK, Metro and a private agent-device daemon, run e2e against them, and turn e2e's `report.json`
into the gate's per-control ledger line. The four helpers only that driver used are deleted with
their tests. The iOS driver and every harness test are untouched: `git diff` against the merge
base for `example/ios`, `ios.mjs` and the iOS helpers is empty.

Two decisions a reviewer needs before the diff.

**Two device *reads* go past the driver, in `device-read.ts`, because the driver cannot answer
them.** agent-device serves a screenshot from the same on-device automation helper that injects a
gesture, and serves one thing at a time: measured on `list-item`, a capture asked for 500 ms into
a 10 000 ms press came back 10 240 ms later and showed the row *unpressed*, because by the time the
helper reached it the finger was up. The press-ink check therefore could not pass through it. The
frame now comes from `adb exec-out screencap` on the leased serial — a read, not a drive; the
gesture is still e2e's, and the press is 1.8 s instead of the driver's ceiling. The other read is
the window manager's `ime` inset, because the driver's headless IME never draws a keyboard to
avoid.

**A hosted control's published box is not where the pixel is.** Compose publishes a box for a
hosted node whether or not the page has reached it, so revealing a hosted Slider by its own box can
never converge: the box stays pinned at the window bottom however far the page travels. The suite
reveals the React Native echo *above* a hosted control, whose box is honest, and lifts the control
into the band from there.

**Not proven this round: anything that needs an emulator.** No lease could be had — both device
pairs were held for the whole round (`maxDeviceLeases: 2`), and X35 sat first in the queue from
13:47Z. `check` is green, which covers typecheck, lint, format, 84 suites and 1 958 unit tests, the
native C++/Android tests, the manifest and the published file list; the suite is verified to load
and be discovered. What is missing, and what it would take, is in the next section.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1958 tests / 84 suites | `d57238538d8c` | 1 m 37 s | start 5.1 / med 9.5 / max 11.5 |
| `harness:ios` | **PASS** | 632 tests / 32 suites + isolated 6 tests / 3 suites | `d57238538d8c` (ios tree) | 15 m 05 s | start 6.2 / med 5.6 / max 13.4 |
| `harness:android` | **PASS** | 688 tests / 32 suites + isolated 6 tests / 3 suites | `d57238538d8c` (android tree) | 18 m 60 s | start 7.7 / med 4.1 / max 7.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `d57238538d8c` (android tree) | 16 m 03 s | start 4.9 / med 4.6 / max 6.4 |
| `real-input:android:--control:form` | stale | — | 8c8934082790 (not this tree) | 1 m 55 s | start 6.1 / med 5.0 / max 6.1 |
| `real-input:android:--control:form:--control:hosted-slider:--control:list-item` | stale | — | 687c78861633 (not this tree) | 4 m 05 s | start 10.9 / med 6.4 / max 10.9 |
| `real-input:android:--control:form:--control:hosted-slider:--control:list-item:--control:search-field` | stale | — | 059b28bd0b4c (not this tree) | 5 m 23 s | start 174.7 / med 26.3 / max 174.7 |
| `real-input:android:--control:hosted-button` | stale | — | 1e1cb3626351 (not this tree) | 38.2 s | start 6.3 / med 5.6 / max 6.3 |
| `real-input:android:--control:hosted-slider` | stale | — | e680dd40b2d1 (not this tree) | 39.4 s | start 4.4 / med 14.9 / max 17.9 |
| `real-input:android:--control:hosted-slider:--control:list-item` | stale | — | 2ba6fa4f0209 (not this tree) | 1 m 53 s | start 9.4 / med 9.4 / max 11.8 |
| `real-input:android:--control:menu:--control:picker` | stale | — | ed563bcbf078 (not this tree) | 4 m 46 s | start 9.3 / med 6.9 / max 9.7 |
| `real-input:android:--control:picker` | **PASS** | — | `d57238538d8c` (android tree) | 44.7 s | start 7.8 / med 7.6 / max 7.8 |
| `real-input:android:--control:popover` | stale | — | e26dcb82b1ec (not this tree) | 39.4 s | start 3.0 / med 4.1 / max 4.6 |
| `real-input:android:--control:switch:--control:hosted-switch` | stale | — | 4436768e392a (not this tree) | 8 m 10 s | start 4.8 / med 4.6 / max 5.9 |

`need --for review` is satisfied on this tree: check, `harness:ios` (on the ios half) and
`harness:android` (on the android half). The `--control:*` rows are the round-2 mutation runs and
round 1's filtered runs, recorded under their own names, so they satisfy nothing else; the two
`real-input:android` greens and the red between them are in `docs/tasks/X35/gates.jsonl`.

## Red proofs

Round 1 ran the CPU-only proof below and no device mutation. All four device mutations ran in
round 2, red then restored; the lines that went red are listed under "Fix round 1".

- `scripts/__tests__/component-coverage.test.js` -> `example/e2e/real-input/hosted-picker.e2e.ts`
  removed from the tree -> `expected "present", received "example/e2e/real-input/hosted-picker.e2e.ts
  is missing, so no real touch is delivered to \"hosted-picker\" and nothing would notice"`
  (`scripts/__tests__/component-coverage.test.js:262`), plus
  `hosted-picker's Android check opens the screen its row names` in the same file. Restored.
- Prepared device mutations, each one line, each reverted after its run:
  `HybridNitroUiButton.kt` `onClick = { press?.invoke() }` -> `onClick = { }` (a hosted control
  ignores touches; `hosted-button`);
  `HybridNitroUiFormRow.kt` `> touchSlop` -> `> touchSlop * 100f` (a Form row presses on a flick;
  `form`);
  `HybridNitroUiSwitch.kt` `contentDescription = label` -> `contentDescription = "Renamed switch"`
  (the label a reader is told moves, and the old name matches nothing; `switch`);
  `HybridNitroUiForm.kt` `val dp = (px / density).coerceAtLeast(0f)` -> `val dp = 0f` (the Form is
  told there is no keyboard to avoid; `form`, `text-field`).

## What the lease did not let me prove

Both device pairs were held for the whole of this round — `M4-cleanup-train` took pair-a for a
6-hour TTL and `X37-harness-trims` still had ~3 hours left on pair-b — and the pool refuses a third
device lease (`maxDeviceLeases: 2`). X35 was first in the queue from 13:47Z and never got a pair.
So the following Proof items from the brief are **not done**, and the gate table shows them missing
rather than stale:

1. `real-input:android` green twice on one lease, with both durations. **Not run.** The suite has
   not been executed end to end since the switch to e2e; the last full run on this code (before
   today's three fixes) reported 24 of 28 controls green, and the two fixes for the two controls
   that were still red — the hosted Slider's reveal, and the press-ink capture — are both written
   but unexecuted, so treat the Android suite as *believed green, not shown*. Duration is also
   unmeasured; the filtered runs on record (2 controls 189 s, 3 controls 245 s, 4 controls 323 s)
   extrapolate to **over** the 20-minute budget on a loaded machine, which is the item most likely
   to need work after the first real run.
2. The four mutations. **Not run.** The prepared one-line edits are listed under "Red proofs" and
   revert cleanly; none has been shown red.
3. `need --for review`: `check` is green; `harness:ios` and `harness:android` are not run on this
   tree. No harness test was edited, so this is bookkeeping for the tree hash, not a behavioural
   risk — but it is still what review asks for.
4. `manifest:check`: green and unchanged on its own (1 246 files, no new file, no new dependency);
   it is also a step inside the green `check`.

The queue entry was released before ending the round so a granted lease could not sit unused and
block the pool; the next round has to `acquire` again.

## Files changed

- `example/e2e/` — new: e2e's config (`e2e.config.ts`, one target, `workers: 1`, `retries: 0`,
  the leased serial only) and `real-input/`, one `<control-id>.e2e.ts` per row of
  `scripts/real-input/controls.mjs` (28 files, 36 tests) plus `support.ts` (tab navigation, the
  tappable band, scrolling), `reader.ts` (the screen-reader rule), `keyboard.ts` (keyboard
  geometry), `press-feedback.ts` (pixels of a held press), `device-read.ts` (the two reads
  agent-device cannot make) and a README.
- `scripts/real-input/android.mjs` — 11,135 lines of `adb shell input` and `uiautomator dump`
  replaced by 516 lines that own the device, the stamped APK, Metro and the private agent-device
  daemon, run e2e against them, and turn e2e's `report.json` into the gate's per-control result.
- `scripts/real-input/{popover-placement,menu-placement,android-calendar,android-tree}.mjs` and
  their four test files — deleted; nothing outside the removed driver reached them.
- `scripts/real-input/ime-frame.mjs` — kept, with a new `ime-frame.d.mts` so the typed suite can
  import it. It is the dumpsys read `keyboard.ts` needs.
- `example/package.json`, `bun.lock` — `e2e` and `@e2e-dev/mobile` pinned exactly as *example app*
  dev dependencies. The library package gains no file and no dependency (`manifest:check` green,
  1246 files, unchanged).
- `example/src/{FormScreen,HostScreen}.tsx` — fixture room: a list that *ends* at the target can
  never lift it clear of the dev build's LogBox, so Form gained a tail section and Host gained
  bottom padding. No library file changed.
- `scripts/__tests__/component-coverage.test.js` — the guard that a control cannot leave the suite
  now reads the e2e files instead of the driver's `CHECKS` table, and checks that each file opens
  the screen `controls.mjs` names for it.
- `CONTRIBUTING.md`, `example/e2e/README.md` — what the suite is, where its evidence goes, and how
  a control is added.
- `example/ios/NitroUiExampleUITests/`, `scripts/real-input/ios.mjs` — untouched: the diff against
  the merge base for `example/ios` and every iOS helper is empty.

## Follow-ups

- `docs/images/components/form-{ios,android}.png`: `FormScreen` grew a tail section, so Form's
  Android screenshot shows one section less of the list than it used to. Not regenerated (no
  device this round); a re-shoot picks it up.
- `reveal()` places a control by what the screen reader can see plus the band, not by a hosted
  node's published box, because Compose publishes a box for a hosted node that is not on screen.
  If `agent-device` ever clips a hosted node's box to the window, `liftIntoBand` can go away.
- `example/e2e/real-input/reader.ts` has a known-debt table of controls whose Android node is not
  actionable in a dump (Compose `RangeInfo` and the plain `SegmentedControl`), where the tap is
  placed by geometry. That is the driver's limitation recorded, not the library's.
- `scripts/real-input/uiautomator.mjs` is still imported by `a11y.mjs`, which `ios.mjs` uses — an
  Android tree parser on the iOS path. Pre-existing, and outside this brief.
- Round 2, mutation anchors: `HybridNitroUiForm.noteImeInsetPx`'s dp report is unguarded on
  Android — forcing it to `0` kept the suite green, because under `adjustResize` the window keeps
  the field clear and the Form's JS-facing `ime=` number is read by no Android check.
- `HybridNitroUiFormRow.kt:336`'s slop check only releases the *ink*; the press is withheld by the
  `ACTION_CANCEL` arm at 350. A flick-mutation at 336 is invisible — the arbitration lives at 350.
- `reveal()` spends its whole drag budget when a locator matches nothing: the renamed Switch label
  burned the 240 s ceiling instead of reaching `actsOnOneNamedNode`'s "announced on 0 node(s)"
  assertion one `count()` away. A no-match bail would turn that red into a 5 s red.
- Incident: one `build-app` ran in the main checkout (a `cd -` slip in a chained command). It
  rebuilt that checkout's own APK for its own tree; no tracked file changed there.
- `harness:ios` went red twice, in two different tests, then green: `Slider.harness.tsx:722` read
  `handles.get('unbounded')!` before that instance's ref arrived, and `Conformance`'s Stepper
  declared-fallback read `measured 0x0`. Both are the `hybrid?.measureContent()` race recorded in
  `docs/tasks/FOLLOWUPS.md:66`; the first two ran while another task's iOS harness held the box, the
  green one at load 6.2. The race itself was not reproduced as a defect of this diff, and no harness
  test was changed here.
- `gate.mjs export --task X35` merged 33 ledger lines but wrote no `failures/` excerpts: the five red
  round-2 runs carry `logInStore` and `failureLogPath: null`, so the committed evidence for a red run
  is its ledger line only.

## Design changes

Nothing to add. There is no separate design document on this branch (`docs/PLAN.md` is the plan,
and it points at `docs/architecture/`), and both rules X35 was built on are already written down on
the branch, in `docs/agents/working-agreements.md` (merged in from `origin/task/W3-tooling-removal`
at `15a86dcd`): driving a device outside the on-device harness uses
e2e or agent-device, never a driver written here, and real-touch tests assert only what the harness
cannot — hit-testing and gesture arbitration, the screen-reader tree, keyboard avoidance and drawn
press feedback. The one place this task had to be literal about that is
`example/e2e/real-input/device-read.ts`, which takes two *reads* (the window manager's `ime` inset
and one frame under a held finger) that agent-device's own routes cannot answer, and says so at the
top of the file. If the agreement is meant to forbid those two reads as well, the keyboard and
press-ink checks cannot exist, and the answer is to widen the sentence rather than delete the
checks; it is flagged here rather than assumed either way.

## Appendix — every dropped assertion, beside the harness test that covers it

The Android driver averaged 72 minutes a passing run; `scripts/real-input/android.mjs` was 11 135
lines. What it asserted per control was mostly *echo counting*: tap N times, read the echo, assert
the number; tap a disabled control, assert the number did not move; let JS refuse a write, assert
the value snapped back. All of it is asserted in `example/__tests__` by a harness that drives the
same control through the library's own event handshake, at a fraction of the cost and without a
device. The table lists each dropped assertion class per control against the harness test that
covers it; the row also names what the e2e suite kept for that control.

Legend: **kept** = what `example/e2e/real-input/<control>.e2e.ts` still asserts. **dropped** = what
only the driver asserted. Harness rows are `file:line` and the test's own name.

| Control | Kept by e2e | Dropped | Covered by |
| --- | --- | --- | --- |
| `switch` | one real tap moves the echo; one named node, enabled before and after | 3 echo reads incl. "N taps flip N times", disabled refuses | `Switch.harness.tsx:270` "keeps the control inside its default box and answers taps at both ends"; `Switch.harness.tsx:312` "keeps up with taps faster than React can round trip"; `Switch.harness.tsx:546` "ignores presses when disabled" |
| `slider` | one real drag moves the echo, and the gesture echo says one start / one complete | 18 echo reads: value per drag, counts per drag, disabled drag, refused write | `Slider.harness.tsx:870` "reports start, change and complete for one drag"; `Slider.harness.tsx:931` "reports a gesture for a touch that never moves the thumb, in drag order"; `Slider.harness.tsx:1335` "coalesces a drag to at most one onValueChange per frame"; `Slider.harness.tsx:1445` "reverts a change JS rejected"; `Slider.harness.tsx:1722` "ignores a drag while disabled, and follows the flag back" |
| `button` | one real tap reports one press | count after N taps; disabled twin leaves it unmoved | `Button.harness.tsx:438` "fires onPress once per tap and nothing when disabled" |
| `segmented-control` | the segment under the finger is the one that selects | 8 echo reads; counts per selection; refused write snaps back | `SegmentedControl.harness.tsx:1515` "reports one event per selection, and nothing when disabled"; `SegmentedControl.harness.tsx:1590` "snaps back a selection React does not accept" |
| `date-picker` | the dialog opens, a day cell reaches JS, OK closes it | 10 echo reads: same-day pick reports nothing, refused pick, clamps, disabled | `DatePicker.harness.tsx:623` "reports a pick once, and nothing for the same day"; `DatePicker.harness.tsx:665` "reverts a pick the parent refuses"; `DatePicker.harness.tsx:710` "clamps a value and a pick to minimumDate/maximumDate"; `DatePicker.harness.tsx:1626` "is inert while disabled" |
| `picker` | the menu opens and a real tap on a row reports it; a wheel keeps the drags it owns | 17 echo reads: one event per roll, refused selection, clamped selection, disabled | `Picker.harness.tsx:2569` "reports one event for a roll that passed several rows"; `Picker.harness.tsx:1275` "files a real pick under the key of the title the pick shows"; `Picker.harness.tsx:863` "clamps a selection the caller sends out of range" |
| `menu` | one tap opens it, a row reaches JS, and a disabled row takes nothing (substance unchanged, per the open Menu question) | 12 echo reads and 1 stays-unchanged: one `onSelect` per pick, open/close pairing, dismissal order | `Menu.harness.tsx:1069` "reports one onSelect per pick and nothing for a row that cannot be picked"; `Menu.harness.tsx:1152` "opens once, closes once, and pairs every open with a close" |
| `dialog` | a real tap presents it, an action is reported *before* the close, Back is gone with it | 4 echo reads: event order, JS-close silence, second dialog over the first | `Dialog.harness.tsx:225` "presents from a plain view; a JS false closes it with no event"; `Dialog.harness.tsx:503` "reports a JS close as nothing, and a user close as a close (barrier twin)"; `Dialog.harness.tsx:304` "presents a second dialog over the first, and each closes on its own" |
| `text-field` | real keystrokes reach JS; a real tap raises the real keyboard and the field stays above it | 7 echo waits: per-keystroke counts, refused edit, `maxLength`, non-editable | `TextField.harness.tsx:346` "round-trips typed text to JS, one event per keystroke"; `TextField.harness.tsx:370` "reverts an edit JS refuses, and the next edit starts from the refused text"; `TextField.harness.tsx:672` "takes no focus while not editable" |
| `bottom-sheet` | a tap opens it, a Pressable inside it counts, Back closes it | echo reads on detents and dismissal order | `BottomSheet.harness.tsx:510` "opens a medium/large sheet at the first detent and reports a drag to the second"; `BottomSheet.harness.tsx:647` "closes as a user dismissal does: onIsPresentedChange(false), then onDismiss" |
| `chip` | a real tap on a filter Chip reaches JS | 3 echo reads and 2 stays-unchanged: selection per press, assist chip has no selection, refused toggle | `Chip.harness.tsx:767` "presses an assist chip once per press, and it has no selection"; `Chip.harness.tsx:792` "takes no press while disabled, of either variant"; `Chip.harness.tsx:685` "reverts a toggle JS refused" |
| `checkbox` | one real tap reaches JS on one named node | 7 echo reads and 2 stays-unchanged: toggle counts, indeterminate, refused toggle | `Checkbox.harness.tsx:865` "takes no toggle while disabled"; `Checkbox.harness.tsx:583` "reverts a toggle JS refused" |
| `context-menu` | a real long press opens it at the finger and the view under it never fires | echo reads on row picks and dismissal | `ContextMenu.harness.tsx:430` "opens on a hold, never presses the child, picks then closes, and the next tap presses once"; `ContextMenu.harness.tsx:569` "opens nothing for a tap or a hold that goes through it, and lets the view under it press" |
| `search-field` | keystrokes reach JS and the clear button reports the empty query; the field stays above the keyboard | 12 echo waits and 2 stays-unchanged: per-keystroke counts, clear-on-empty, refused edit, Return after clear | `SearchField.harness.tsx:425` "round-trips typed text to JS, one event per keystroke"; `SearchField.harness.tsx:447` "reverts an edit JS refuses, and the next edit starts from the refused text"; `SearchField.harness.tsx:522` "reports the clear button as one empty edit and keeps the focus"; `SearchField.harness.tsx:549` "refuses to clear a field that is not editable"; `SearchField.harness.tsx:597` "takes no submit from a Return pressed on a query it has just cleared" |
| `tooltip` | a tap opens it, its action is reported, the tip goes away | 5 echo reads: action-before-close, JS-close silence | `Tooltip.harness.tsx:537` "reports an action before the close it causes"; `Tooltip.harness.tsx:513` "reports a JS close as nothing, and a user close as a close (barrier twin)"; `Tooltip.harness.tsx:287` "leaves a tap on its anchor to the anchor (check 1)" |
| `icon-button` | one real tap reaches JS once | 15 echo reads and 2 stays-unchanged: presses per tap, refused toggle, disabled | `IconButton.harness.tsx:1112` "presses once per tap, and takes none while disabled"; `IconButton.harness.tsx:1404` "takes no press while disabled, on either form"; `IconButton.harness.tsx:957` "reverts a toggle JS refused, and shows the value JS wrote" |
| `popover` | a tap opens it and a Pressable inside answers exactly once; a TextInput inside it stays above the keyboard | 6 echo reads and 1 stays-unchanged: placement, close order, refused close | `Popover.harness.tsx:905` "opens below its anchor, and above it when there is no room below"; `Popover.harness.tsx:973` "closes like a tap outside does: onIsPresentedChange(false), then onDismiss"; `Popover.harness.tsx:994` "presents again when the app refuses the close" |
| `form` | one row presses once; a flick presses nothing; a field near the bottom stays above the keyboard | 10 echo reads and 1 stays-unchanged: row counts, insertion order, refused row press | `Form.harness.tsx:1138` "aims a row content at its Yoga origin and presses it on both platforms (E4)"; `Form.harness.tsx:854` "mounts every row into the list with none stranded (E1)" |
| `button-group` | one real tap presses one item and reports its id | 20 echo reads and 2 stays-unchanged: flips per tap, overflow menu, refused toggle | `ButtonGroup.harness.tsx:631` "presses once per item, from the row and from the overflow menu"; `ButtonGroup.harness.tsx:669` "flips a toggle once per tap, and reverts one its parent refused" |
| `stepper` | one real tap on the upper half steps it exactly once | 14 echo reads and 3 stays-unchanged: steps per tap, clamps, long-press repeat | `Stepper.harness.tsx:684` "steps one value and reports one event per step" |
| `list-item` | one real tap fires `onPress` once; a held press draws ink, standalone and inside a Form row | echo reads on press count and refused press | `ListItem.harness.tsx:878` "takes no press and sends nothing while disabled"; `ListItem.harness.tsx:930` "publishes one node, whose role is a button only with onPress" |
| `hosted-switch` | a real tap on the hosted Switch reaches Compose and JS sees the value | echo reads on value and count | `HostControls.harness.tsx:1106` "keeps every kind of control live in one Host"; `HostControls.harness.tsx:1487` "arms nothing for a hosted Switch and its own observer for the same Switch alone" |
| `hosted-button` | a real tap reaches Compose and JS counts it | press count after N taps; disabled twin | `HostControls.harness.tsx:1024` "fires onPress for a real tap on a hosted Button"; `HostControls.harness.tsx:1070` "presses exactly one hosted Button per tap"; `HostControls.harness.tsx:1041` "keeps a disabled hosted Button inert, and the same tap answers once enabled" |
| `hosted-slider` | a real drag moves the hosted Slider, whose track is the Host's width | 2 echo reads: refused drag snaps back, disabled drag | `HostControls.harness.tsx:771` "reports a hosted drag through all three callbacks"; `HostControls.harness.tsx:802` "snaps a hosted Slider back when JS refuses the drag"; `HostControls.harness.tsx:851` "keeps a disabled hosted Slider inert, and the same drag answers once enabled" |
| `hosted-mixed` | one Host of mixed controls gives each its own node and its own tap | echo reads per child, reordering, removal | `HostControls.harness.tsx:1365` "keeps every kind of control live in one Host"; `HostControls.harness.tsx:1224` "follows mixed children that are reordered"; `HostControls.harness.tsx:1241` "follows mixed children that are removed and added" |
| `hosted-segmented` | a real tap picks the segment under the finger | index echo, refused write snaps back | `HostControls.harness.tsx:1106` "keeps every kind of control live in one Host"; `SegmentedControl.harness.tsx:1590` "snaps back a selection React does not accept" |
| `hosted-picker` | the hosted Picker opens its menu under the box the Host drew and a row reaches JS | 2 echo reads: index per pick, changed options, disabled picker | `HostControls.harness.tsx:1418` "keeps the two window-opening controls live in the same Host"; `Picker.harness.tsx:1275` "files a real pick under the key of the title the pick shows" |
| `hosted-date-picker` | the hosted DatePicker opens its dialog and a day cell reaches JS | 5 echo reads: value per pick, refused pick, disabled field, unmount while open | `HostControls.harness.tsx:1418` "keeps the two window-opening controls live in the same Host"; `DatePicker.harness.tsx:623` "reports a pick once, and nothing for the same day"; `DatePicker.harness.tsx:1534` "presents nothing after the mount that opened it is gone" |

Nothing else was dropped. Where the driver's assertion had no harness cover it was kept in the e2e
suite or moved into it: the flick that must not press (`form.e2e.ts`, X32), the Slider drag
(`slider.e2e.ts`, `hosted-slider.e2e.ts`), every screen-reader node rule (`reader.ts`, used by 28
files), keyboard avoidance for the text controls (`keyboard.ts`), and drawn press feedback
(`press-feedback.ts`). `Slider.harness.tsx:1938` "labels the control for a screen reader" is the harness half of
the a11y class, and it cannot see a hosted control's name at all — Compose publishes it on a `SemanticsNode`, not a `View` — which is
why `reader.ts` stays a device check.

## Appendix — what e2e could not express, and what stands in for it

- **The keyboard's edge.** `agent-device` installs a headless test IME so text entry is
  deterministic, and that IME never draws a keyboard: `WindowInsets.ime` stays empty and an
  avoidance check would pass by measuring nothing. `example/e2e/real-input/keyboard.ts` puts the
  device's real IME back for the length of the gesture, and reads the keyboard's top edge from the
  window manager's `ime` `InsetsSource` through `scripts/real-input/ime-frame.mjs` — the one
  helper from the driver that survives, kept for this one call, with `ime-frame.d.mts` added so the
  typed suite can import it. `ime-frame.mjs` answers `null` for "this dump never mentioned a visible
  keyboard", so a renamed dumpsys line reddens the gate instead of hiding the check.
- **A press held while the screen is read.** e2e has no "hold this, and look at it while it is
  held". `press-feedback.ts` starts the press through e2e's own `screen.swipe` and takes the
  capture through e2e's own device client (`device.unstable_raw.client.capture.screenshot`), so the
  gesture and the pixels both stay inside the driver. No `adb input` is involved.
- **Nothing else needed a fallback.** Every other step is `screen.getByTestId` / `getByLabel`,
  `tap`, `swipe`, `boundingBox` and `expect(...)`. `agent.act` and `agent.assert` are never used: a
  gate must not depend on a model.

## Questions for orchestrator

1. **Device time, or ship unproven?** Every remaining Proof item needs an emulator and both pairs
   were held all round. Options: (a) re-dispatch X35 the moment a pair frees — the code is
   finished, so the next round is only gate runs (`build-app`, one filtered run for the two fixes,
   two full runs, four mutations, two harness gates: ~75 minutes of device time); (b) treat the
   suite as provisional and let the next task that touches Android real-input inherit the runs.
   Recommendation: (a), and while waiting, note that the 20-minute duration budget is the item most
   likely to fail — the fix is a shorter `reveal()` (fewer drags per control), not a loosened
   assertion.
2. **Do the two raw device reads in `example/e2e/real-input/device-read.ts` fit the working
   agreement?** `docs/agents/working-agreements.md` says driving a device outside the harness uses
   e2e or agent-device and never a driver written here. These are reads (a dumpsys inset, one
   screencap) on the leased serial, added because agent-device's own routes cannot answer either —
   the IME inset is not one of the helper's commands, and its screenshot is served behind the
   in-flight gesture. If the agreement is meant to cover reads too, the keyboard-avoidance and
   press-ink checks cannot exist as checks at all, and the answer is to widen the sentence rather
   than delete them.
3. **Is the `list-item` Form-row ink result a library finding or a measurement one?** Before the
   `device-read.ts` change, the Form row read at its resting luminance under a held press while the
   standalone item inked correctly, and the deleted adb driver asserted the same claim with a
   screencap taken outside its own input path and passed. The reading above is that the capture was
   the problem, not the ink. If the check goes red again on a frame that is genuinely taken under
   the finger, that is a live G30 regression and belongs to whoever owns Form rows, not to X35.

## Fix round 1

Device time at last: lease `X35-wvvh4` (`nitroui_b`), one gate at a time.

`real-input:android` is green twice in a row: **970.7 s** then **962.7 s** (16 m 11 s / 16 m 03 s),
28/28 controls and 36 tests each, `retries: 0`, no input sequence retried — inside the brief's
20 minutes. Both round-1 fixes hold on device: the hosted Slider reveals and drags (21 s), and both
G30 press-ink reads come through `device-read.ts`. A third fix was needed — round 1's rewritten
wheel check read an undefined locator, so the first full run died at `picker.e2e.ts:64`
(`index is not defined`), fixed in `cf550fe1`.

Four mutations, one per kind, each red then restored (recorded in `docs/tasks/X35/mutations.json`):

- ignores touches — `HybridNitroUiButton.kt:675` → `hosted-button.e2e.ts:26`, expected `1`, observed `0`
- presses on a flick — `HybridNitroUiFormRow.kt:350`, the `ACTION_CANCEL` arm made to fire the press → `form.e2e.ts:69`, `0` → `1`
- label moves — `HybridNitroUiSwitch.kt:250` → `switch.e2e.ts:17` and `hosted-switch.e2e.ts:14`: no node answers the name, so both die at the 240 s ceiling
- keyboard avoidance — `HybridNitroUiPopover.kt:511` (`val imePx = 0`) → `keyboard.ts:233`: field bottom 1972 px against the keyboard's top 1541 px

`check` green with the manifest unchanged at 1246 files, and both harness gates green on this tree;
`harness:ios` needed a third attempt.
