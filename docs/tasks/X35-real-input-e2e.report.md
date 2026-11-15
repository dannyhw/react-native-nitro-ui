# X35 — Android real-input runs on e2e

**Branch:** `task/X35-real-input-e2e` (from `origin/task/W3-tooling-removal`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** PLACEHOLDER

## Summary

PLACEHOLDER-SUMMARY

## Gates

PLACEHOLDER-GATES

## Red proofs

PLACEHOLDER-RED

## Files changed

PLACEHOLDER-FILES

## Follow-ups

PLACEHOLDER-FOLLOWUPS

## Design changes

`docs/DESIGN.md` is not on this branch, so the two rules this task was built on are recorded
here rather than in the design document:

1. **Device driving outside the harness goes through e2e or `agent-device`, never a driver of
   our own.** The sentence in the brief replaces the arrangement `docs/research/setup-decisions.md`
   and `docs/tasks/T15-real-input.md` describe, where Android real-input was a hand-written
   `adb shell input` + `uiautomator dump` driver. The rule generalises: anything that moves a
   finger on a device from this repo uses the harness, e2e, or `agent-device`.
2. **A device check asserts only what the on-device harness cannot see.** The audit of 2026-11-15
   counted 389 red real-input runs and 31 library defects, all of four kinds. Anything an in-app
   harness test already asserts is dropped from the device suite rather than paid for twice on
   hardware. The four kinds are hit-testing and gesture arbitration, the screen-reader tree,
   keyboard avoidance, and drawn press feedback.

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
