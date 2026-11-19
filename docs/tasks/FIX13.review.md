FIX ROUND

# FIX13 review — `task/FIX13-button-group-text-spacing` at `2f001671`

`check` was run once in the worktree (no lease held `real-input:ios`): PASS, 18 of 18. No CodeRabbit
comments on PR #103.

## Must fix

**M1. An action item's footprint sits outside `.controlSize`, so it is the wrong size for any `size`
other than `medium`.** `HybridNitroUiButtonGroup.swift:476-482`: `.controlSize(model.scale.controlSize)`
is applied to the action `Button`, and *then* `.modifier(BorderedFootprint(...))` wraps it. The
hidden `.bordered` copy is a sibling of `content` inside the ZStack (`:657-662`), so it is not under
that `.controlSize` and takes the ambient size. Nothing in `ios/` sets an ambient control size (the
only `controlSize` calls in ButtonGroup are `:469` and `:476`), so it is always `.regular`. A toggle's
footprint is drawn inside `ItemToggleStyle.makeBody` (`:639`), which does inherit the Toggle's
`.controlSize`. So in a `text` group holding a toggle with `size="small"` an action item reserves a
regular capsule while a toggle reserves a small one. The action item is wider, the gaps go uneven
again, and the row is as tall as a regular capsule, taller than the small row it was before (brief
Behaviour 3: `size` unchanged). `large` and above get the reverse mismatch. The brief's "Decided
already" asks for the footprint "inside `.controlSize`". The fix is to apply `BorderedFootprint`
before `.controlSize` on the action item. No harness read covers a non-`medium` size here, which is
how it got through. The new gap read, or a single `size="small"` row in it, should cover it.

**M2. The changeset says something about the shipped drawing that is false.**
`.changeset/button-group-text-group-even-item-spacing.md:7` says "the items are evenly spaced whatever
mix of them the group holds". A checked capsule fills its footprint and a label does not. The
report's own ink numbers (36 pt label, 62.33 pt capsule, so about 13 pt of padding a side, plus 8 pt
of spacing) give visible gaps of about 8 pt between two checked toggles, 21 pt between a capsule and
a label, and 34 pt between two labels. So `[on, off, off]` draws 21 pt then 34 pt. The committed
README image shows this today (Bold, then Italic, then Underline in
`docs/images/components/button-group-ios.png`). The test deliberately reads only rows where the gaps
come out equal (`ButtonGroup.harness.tsx:1442`). Equal *room* is what the change delivers, and the
brief accepts that. The changelog should say so: every item takes the same room, action items and
unchecked toggles are evenly spaced, and a checked capsule fills its room, so the space beside it is
narrower. `docs/components/button-group.md:172` says "same room", which is accurate, but it should
add that same sentence about the capsule, because an app developer will see it.

## Notes

N1. Is `reserves` true exactly when it should be? `reservesFootprint` (`:425`) is evaluated per
`ViewThatFits` candidate over that candidate's visible items. So a candidate whose toggles have all
moved into the menu reserves nothing, as the doc says. Overflow `Menu` rows never go through
`itemControl`. A `ControlGroup` row has no toggle, so it gets false. A *connected* `text` group with
a toggle falls back to the standard row and gets `true`. That is correct: it draws `text` items, and
its toggles reserved the footprint before this change too (`style == .borderless`). Every other
variant gets false.

N2. Because the all-items candidate is wider, `ViewThatFits` moves items into the menu at a wider
box than before. The brief's "Decided already" accepts the width. The Sizing paragraph implies it
but does not say it; one clause under Overflow would make it plain.

N3. Accessibility: the hidden copy has `.hidden()`, `.accessibilityHidden(true)` and
`.allowsHitTesting(false)`, and the ZStack adds no element. An action item's tap area stays its
borderless button's own frame, not the footprint, so the padding beside its label is dead space,
just like an unchecked toggle's was before. That is consistent. Nothing reads it (the existing
FOLLOWUPS line about the hidden copy's accessibility still stands).

N4. Perf: no hosting view is rebuilt. The props are unchanged, and `ink=` is computed only inside
`nuiTestProbeRow` (`:1011`), in the same pixel pass. Every item of such a row now composes the
hidden copy, as the report says.

N5. The new read can fail: the old drawing reads 9 pt against 21 pt, and if every item were
measured at its label size, `[action, action, off]` would also differ by about 13 pt. A row where
*no* item reserves anything would pass it (8 pt and 8 pt), but the size-stability read, unchanged
and still running, catches that case. Nothing was loosened. It reads only `text` at `medium` (see M1).

N6. The `BorderedFootprint` doc comment (`:643-651`) is nine lines. AGENTS.md "Comments" asks for
one to three. Its "the room between two neighbours is the spacing whatever the pair is" is true
only of the footprints, not of what the user sees (M2).

N7. README image: rows 3 and 4 hold only toggles, which already reserved the footprint, so it is not
stale. The local screenshot `/tmp/fix13-textgroup-gaps.png` crops the capsule's top and bottom.

N8. Scope is clean: nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared
e2e helpers, one author address, nothing personal, a patch changeset.

N9. `harness:android` is owed (the harness file changed, and `need --for review` lists it). It was
not run for this review.
