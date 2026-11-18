FIX ROUND

# FIX7 review: ButtonGroup overflow icons and iOS toggle variants

Reviewed `task/FIX7-button-group-overflow-icons-toggle-variant` at `e6934e93` against the brief.
`node scripts/gate.mjs check` run once in the worktree (no lease was `in use (real-input:ios)`):
PASS, 18 passed, 72 s. PR #98: CodeRabbit's review was still in progress and had left no inline
comments, so nothing from it is cited.

The Android half is sound: the row takes the already-resolved slot (`model.iconContent(index)`,
`HybridNitroUiButtonGroup.kt:819-824`), `Absent` reaches Material as a `null` leading slot
(`MenuRows.kt:327-336`), `titleOnly` passes `Absent`, the screenshot shows glyph rows and
glyph-free rows at the plain leading edge, and `resetAll` clears both the tints and the key
(`:347`, `:354`). The connected `ControlGroup` path is untouched (a toggle never reaches it,
`HybridNitroUiButtonGroup.swift:328-329`). The event-count handshake is unchanged: the style's
`configuration.isOn.toggle()` goes through the same `toggleBinding` setter (`:503-508`). `.disabled`
and `.controlSize` are applied outside the `Toggle`, so they reach the style's `Button` through the
environment. No hosting view is rebuilt per update, and the drawing sample runs only inside
`nuiTestProbeRow`. Each of the four red proofs matches what its mutation would print.

## Must fix

**M1. iOS: an enabled, unchecked `tonal`, `outlined` or `text` toggle is drawn like a disabled
item.** `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift:580-586, 594`.
- What it paints: unchecked, the style puts `.tint(.secondaryLabel)` on `.bordered` or `.borderless`.
  `.bordered` takes both its label colour and its capsule wash from the tint, so the result is a
  translucent grey label on a wash of an already translucent grey, which is almost nothing.
  `.borderless` paints the grey label alone. In `/tmp/fix7-button-group-ios-toggle-variants.png`,
  rows 3 to 5, the unchecked "Italic" is a dim grey word with a capsule you can barely see. The
  "Copy" and "Bold" items beside it are clearly live.
- What SwiftUI's own `.toggleStyle(.button)` painted (main, the old `:438-440`): a toggle that is
  off draws its label in the tint with no capsule. The worker's own red-proof numbers confirm it:
  the old off state read `off={"fill":5,"tint":3}`, so tinted label pixels and no background. An
  off toggle read as a live button.
- What a disabled item in the same group paints (`.disabled` at `:449`/`:457`): SwiftUI's disabled
  foreground, a grey label, over a grey or absent capsule.
- So "off" and "disabled" are now both a grey label over a faint or absent capsule. They differ
  only in how dense the grey is, and that depends on what sits behind the group: on the
  screenshot's non-system background both are close to invisible. A user cannot tell an off
  toggle from a disabled one without a disabled item next to it to compare. Grey text is the iOS
  sign for disabled.
- The test makes this behaviour required: `example/__tests__/ButtonGroup.harness.tsx:1092` fails
  any off state with more than 2% tint, so the fix has to change it.
- `filled` and `elevated` are fine as they are: a solid `.systemGray` capsule with a white label is
  clearly different from a disabled `.borderedProminent`, which has a pale fill and a grey label.
- Suggested fix (the mapping is the orchestrator's call, since the brief's Decided says "same style
  family"): keep the off state looking enabled. One way is to draw off as the action item draws,
  in the variant's style with the group's tint (which is what SwiftUI's button toggle does), and
  mark on with the next more prominent style (`.bordered` to `.borderedProminent`, `.borderless` to
  `.bordered`). Another is to keep the tint on the off label. Then update the doc table
  (`docs/components/button-group.md:131-145`) and the measured test. The test should also read a
  disabled item and require off to differ from it, so this cannot come back.

**M2. iOS toggle accessibility is unproven, and the report's evidence for it is Android's.**
- What the report claims (`docs/tasks/FIX7.report.md:20-21`): "It stays a `Toggle` for
  accessibility — the existing probe still reads `[Checkbox, … desc=Bold`".
- Why that is no evidence for iOS: that string is asserted only on Android
  (`ButtonGroup.harness.tsx:724-725`). On iOS the probe returns `unavailable`
  (`ButtonGroup.harness.tsx:716-719`, `HybridNitroUiButtonGroup.swift:952-953`).
- What changed on iOS: the style replaces SwiftUI's button toggle with a plain `Button` plus
  `.accessibilityAddTraits(.isSelected)` (`:595`). Whether VoiceOver still announces a toggle and
  its value, or only "Selected, button", has not been run on any gate. That is Behaviour 3 and the
  brief's Decided line ("a toggle that reports its state").
- What will catch it: `real-input:ios` at merge reads the node's `checked`
  (`example/e2e/real-input/button-group.e2e.ts:105-106` and `itemSays`). The driver prints
  `checked` only for a node that offers the state (`os-tree.ts:140-143`), and an `.isSelected`
  trait comes out as `selected`. If SwiftUI dropped the toggle semantics, the first red shows up
  at merge.
- Fix: correct the report's sentence. Prove the iOS announcement before merge, either with a
  filtered `real-input:ios` run on the ButtonGroup control (the orchestrator decides, since the
  brief's Proof names no real-input gate), or by stating the semantics explicitly in the style
  (`.isToggle` on iOS 17+ and a value) and dropping `.isSelected` if it double-announces (N2).

## Nice to have

**N1.** `docs/components/button-group.md:110, 112`: the `iOS connected` column says `variant` and
`tintColor` are "ignored". A connected group with a toggle draws the standard row in the variant
and the tint, and the prose at `:148-151` now says exactly that. This diff edited both rows, so
the cells could read "ignored (a group with a toggle: as `standard`)".

**N2.** `HybridNitroUiButtonGroup.swift:595`: if SwiftUI's `Toggle` already gives the custom style
its toggle trait and value, adding `.isSelected` makes VoiceOver say the state twice ("Selected …
on"). Settle this together with M2.

**N3.** `HybridNitroUiButtonGroup.swift:447`: `inControlGroup ? nil : model.tint` is dead for a
toggle, because a group containing a toggle never uses `ControlGroup` (`:328-329`). It is harmless,
but `tint: model.tint` would say what actually happens.

**N4.** `ButtonGroup.harness.tsx` "keeps menu rows glyph-free under titleOnly" is a negative read
after fixed sleeps (`openOverflow`'s 250 ms plus `EVENT_QUIET_MS`), with no positive sign in the
same mount that the rows were composed. The third red proof shows it can fail when the guard is
removed, so it is acceptable. A composed-row count read in the same mount would also turn
"never composed" red.

**N5.** `HybridNitroUiButtonGroup.kt:825` with `MenuRows.kt:333`: in production, every composition
of a row with a glyph pays one `toRgbHex()` and one lock for the report. `Menu` already does the
same (`MenuRows.kt:417`), and it runs only while a popup is composing, so it is acceptable as a
test seam.

## Checked and clean

- Scope: no file under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e
  helpers.
- Identity: `git log --format='%ae' main..HEAD | sort -u` prints one address.
- Hygiene: no AI or agent mention, home path, email or hostname in the diff or the commit messages.
  The report names a simulator model, not a personal device.
- Comments: they explain quirks and constraints and cite nothing internal.
- Tests: no assertion was loosened, no timeout raised and no retry added. `TINT` matches no scheme
  colour that the toggle under test draws.
- Changeset: a patch, and each sentence is true on both platforms. It will need to match the M1
  outcome.
