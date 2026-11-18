FIX ROUND

# FIX6 re-review: fix round 1, `task/FIX6-form-row-press` at `a1105e34`

Read: AGENTS.md, the brief, the first review, the report, both diffs, and the hosts of every
component that can sit in a row on both platforms. PR #95's CodeRabbit inline comments were
checked against the code; the `ListItem` one is valid and is M3.

No `in use (real-input:ios)` lease, so `gate.mjs check` ran once here: **PASS**, 17/17, 123.9 s.

## M1: closed

`HybridNitroUiFormRow.kt:302` now gives the touch up only when the deepest view's ancestry holds
a `NitroComposeHost`. The Android `ContextMenu` wrapper is a `ReactViewGroup` whose compose host
is laid out `0 x 0` (`HybridNitroUiContextMenu.kt:541-542`), so a tap on its text climbs
Text -> wrapper -> row and the row presses, as on iOS, where `HybridNitroUiContextMenu` is not a
`NitroSwiftUIHost`. The new case exists on both platforms (`form.e2e.ts:288`,
`RealInputTests.swift` `assertWrapperOfReactNativeContentInsideAPressingRowIsTheRows`), aims at
the wrapper's centre after asserting it is inside the row, and the Android red proof (tag rule
restored -> `form-row-context-presses` observed `"0"`) is what that mutation produces.

Per component, after M1 (H = row gives the tap up, R = row presses):

| Component | iOS | Android | Agree |
| --- | --- | --- | --- |
| Switch, Button, TextField, SearchField, Progress, Menu (no RN children) | H | H | yes |
| ListItem (whole row) | H | H | yes, and wrong: M3 |
| ContextMenu around RN text | R | R (host 0x0) | yes |
| Popover / BottomSheet / Dialog, closed | R | R (host 0x0 or zero width) | yes |
| Tooltip anchor | R | R on the anchor; H on wrapper area no child covers | mostly: N3 |
| `<Host>` | passthrough View: R in gaps | one Compose host: H everywhere | no: N3 |

## M2: closed

`form.e2e.ts:358` parks the field with `revealLowInPage`, `:383-390` asserts
`parked.y + parked.height > keyboardTop`, and the field is read at `:394`, before the travel, as
the comment now says. The recorded red (509 px; parked 1954, now 1445) is what ignoring
`avoidsKeyboardForIme` in `revealFocusedRow` (`HybridNitroUiForm.kt:311`) produces, and the
parked top below the keyboard's top is the premise holding. The height half keeps its 883 px red
from round one. iOS asserts the same premise (`RealInputTests.swift:6124-6130`), and its red
(287.3 pt, `afterUpdate` adding observers regardless, `HybridNitroUiForm.swift:189`) matches
that test's message text.

## Must fix

**M3. A `ListItem` with `onPress` inside a `Form.Row` no longer presses, on both platforms.**
`HybridNitroUiFormRow.kt:302`, `NitroUiFormViews.swift:309`, `NitroSwiftUIHost.swift:459`.
Inside a row a `ListItem` hands its `onPress` up to the row (`ListItem.tsx:213-221`,
`Form.tsx:514,569`: `pressable={effectiveOnPress != null}`) and installs no press of its own
(`HybridNitroUiListItem.kt:377,401` `pressable && !insideRow`; `HybridNitroUiListItem.swift:317`
`pressGesture.isEnabled = ... && !model.insideRow`). Its view is a `NitroComposeHost`
(`ListItemHost`) / `NitroSwiftUIHost<ListItemContent>` that fills the row, so the row now gives
up every tap on it and nothing answers. This is the README's own example
(`readme-examples.tsx:686-707`, `README.md:1354`) and what `list-item.md:9-12` promises ("the row
is the cell and owns ... the press"). The same holds for `<Form.Row onPress>` around a
`ListItem` without `onPress`: the row can no longer be pressed at all. The existing checks would
catch it but were not run on this branch: `testRealInputListItem`
(`RealInputTests.swift:5402`, `assertOnePressPerTap(... times: 5)` on
`real-input-listitem-in-form`) and `list-item.e2e.ts:44` (the row's ink on a held press). Fix the
rule so a host whose press belongs to the row (a `ListItem` inside a row) is row content, and
run `--control list-item` on both platforms. The round-one tree has the same defect (tag on
Android, marker on iOS); CodeRabbit's comments on `HybridNitroUiFormRow.kt:300` and
`NitroSwiftUIHost.swift:459` name it, and they are right. `form.md:76-80` and the changeset
("the control answers") are then wrong for a `ListItem`, and N2's first-review note that a
`ListItem` in a pressing row takes its tap is this bug, not a wording point.

## Nice to have

**N1.** `NitroUiFormViews.swift:303-304`: "UIKit asks this of the cell as delegate of
recognizers that are not this one". The cell is the delegate of `pressGesture` only (line 263 is
the one `delegate = self`), so the comment describes something that does not happen. The guard
is harmless; say it keeps the answer for any other recognizer later given this delegate, or drop
it. N4 itself is honoured: `gestureRecognizerShouldBegin` returns `isPressable`, as on `main`.

**N2.** iOS gives the tap up for a hosted control on any branch under the point
(`holdsHostedControl`), Android only in the topmost view's ancestry: a control under RN content
drawn over it differs by platform. Rare; one follow-up line.

**N3.** Android-only H areas from the table: a `<Host>` in a pressing row takes the taps between
its controls (iOS presses there), and a `Tooltip`'s `absoluteFill` host takes taps on wrapper
area its children leave uncovered. `form.md`'s "a component that only holds your children ...
draws nothing under the finger" is near enough for Tooltip; `Host` is unmentioned. Follow-up.

**N4.** A disabled hosted control still takes the row's tap on both platforms, so it is a dead
spot. `form.md` compares the rule to "a switch trailing a Material `ListItem`", where a
disabled switch passes the click to the item. Consistent across platforms; a doc clause or a
follow-up line.

**N5.** `NitroUiFormViews.swift:317-318`: a doc comment wraps as "`view`" / "`///'s`". Reflow.

**N6.** Report: `## Fix round 1` is about 1,100 words against AGENTS.md's 200. The Android
opt-out red-proof line drops "the Form scrolled for a keyboard it was told to leave alone"
from the failure text (`form.e2e.ts:406-407`) with no ellipsis. Round one's Summary still states
the `associated_hybrid_view_tag` rule as the code's.

**N7.** iOS opt-out park (`RealInputTests.swift:6063-6069`): the loop stops at the first swipe
that realises the field, so the comment's "its park is the list's end" is not what the code
guarantees. The premise assertion added at `:6124-6130` makes the check sound either way. Reword.

## The two XCUITest cases changed to pass

- Pressable case, row tap `atFraction(0.05)` -> `0.9`: correct. The pressable sits at the
  leading edge, so 0.05 was a second tap on the pressable. The new assert
  (`minX + 0.9 * width > control.maxX + 8`) makes the aim a checked premise. Nothing loosened.
- Opt-out field parked by swiping down the list instead of `scrollIntoView`: what a user does,
  and stronger, as the keys-cover-the-field premise is asserted and red-proven (287.3 pt). The
  swipe loop searches for the row; it re-runs no assertion. Nothing loosened.

## Red proofs

All four fix-round lines name code that exists and each recorded failure matches its assertion's
format and the mutation's direction; two Android mutations in one run is fine (each case fails
only on its own assertion).

## Scope and hygiene

Nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e helpers
changed. All 28 commits carry one author address; no AI or agent mention, home path, email,
hostname or device name in the diff or messages. First review's N1, N3, N7 left as told.
