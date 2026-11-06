# E3 — SplitButton: Menu's `primaryAction` on Android

**Branch:** `task/E3-split-button` (from `main` at `8a8f005c`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `E3-o7x7a` (`pair-b` — `emulator-5570` / iPhone 17 simulator `3AE7EE8D…` / Metro `8293`)

## API

No new props, no new events, no new exports. `primaryAction` already existed and Android
ignored it; that is what changed.

```tsx
<Menu
  title="Publish"                       // the leading half shows this
  group={[{ id: 'publish', label: 'Publish now' }]}
  primaryAction={publish}               // omit it → one trigger, exactly as before
  onSelect={log}
  onOpen={log}
  onClose={log}
/>
```

- `primaryAction?: () => void`, gated by `hasPrimaryAction: boolean` — the separate flag
  exists because a callback prop can never be *removed* (D7b), so its presence cannot be
  the answer to "is there a second job".
- Setting it is a size statement: Menu's sizing key is now
  `variant|size|action|systemImage|title`, `action` being `'action'` or `'plain'`.
- `onOpen`/`onClose` are unchanged: one open and one close per list, and the action half
  fires neither. `disabled` disables both halves and closes an open list (D29).
- Test seam: `nuiTestMenuReport()` gained `split`, `leading`, `trailing`.

## Android mapping

| Concern | What ships |
| --- | --- |
| Container | `SplitButtonLayout(leadingButton, trailingButton)` from material3 1.5.0-beta02 — no `@ExperimentalMaterial3ExpressiveApi` opt-in is needed for it (Q8 Appendix C row 2; D39 is what makes beta02 usable at all). New file: `android/src/main/java/com/margelo/nitro/nitroui/MenuSplitButton.kt`. |
| Leading half | `SplitButtonDefaults.{Leading,TonalLeading,OutlinedLeading,ElevatedLeading}Button`, `title` on one line tail-truncated as `NitroUiM3Button` draws it, `onClick = model.applyPrimaryAction()` |
| Trailing half | `SplitButtonDefaults.{,Tonal,Outlined,Elevated}TrailingButton(checked = model.expanded, onCheckedChange = model.setOpen)` — Material's *checked* button, so `checked` is the menu's own open state and the inner corner stays morphed while the list is up |
| `variant="text"` | the outlined pair, hairline and colours included: a split button is two containers and `text` has none. One function (`MenuSplitVariant.of`) with a JVM test over every variant. |
| Sizes | E1's `ButtonScale` ladder through Material's own tokens: `SplitButtonDefaults.{leading,trailing}ButtonContentPaddingFor(scale.height)`, `textStyleFor`, `trailingButtonIconSizeFor`, and `leading/trailingButtonShapesFor(scale.layoutHeight)` from a two-entry cache. `heightIn(min = scale.layoutHeight)` goes on the layout, because Material switches the minimum interactive component size *off* inside the halves and says to enforce it on the parent. |
| Chevron | an inline `ImageVector` (24×24 viewport, ExpandMore's geometry) — the library bundles no icon set or string catalogue (D40 item 2), the same choice Chip makes for its check. It turns with `animateFloatAsState(expanded → 180°)` on `MotionScheme.defaultEffectsSpec()`. |
| The list | E2's `NitroUiMenuPopup`, composed inside the **trailing half's slot**. Measured, not assumed: moving that call to the leading half's slot moves the window 181 px, while moving it out of the half's own wrapper `Box` — staying in the trailing slot — moves it nowhere. The slot anchors the list; the `Box` is `propagateMinConstraints` plumbing. |
| Screen reader | two stops instead of one: `"Publish", Button` (named by `accessibilityLabel` else `title`) and `"More options", collapsed`/`expanded`, `Button`, each `clearAndSetSemantics` so Material's nameless node is not a third stop. The plain trigger's single `Role.DropdownList` node cannot survive becoming two controls that do different things. Real input reads both names out of `uiautomator dump`. |
| Recycle | `MenuModel.reset()` and the split composition's `onDispose` each clear the witness and the two half rects; `split` answers "what did the composition draw", deliberately not `hasPrimaryAction`, which is only what JS sent. |
| iOS | one file, eight lines: `nuiTestMenuReport` answers `-1` for the three new fields, because iOS's `primaryAction` is a gesture on one button and `-1` is "no such measurement" where `0` would claim a layout iOS chose. `Menu(content:label:primaryAction:)` (D29) is untouched. |

## Summary

A Menu with `primaryAction` now draws Android's own idiom for "one control, two jobs"
instead of ignoring the prop: the leading half runs the action, the trailing half opens the
list. iOS keeps D29's gesture and no layout, so the same JSX means the same thing on both
platforms and looks like each platform's own control.

Three decisions a reviewer should read before the diff. **`split` is a witness, not a
prop** — the report answers what the composition drew, which is what lets the harness tell
"a Menu that stopped having a `primaryAction`" apart from "a Menu whose prop round-tripped",
both in place and across a recycle. **The sizing key grew a field** (`action`), because a
second container is a wider box and the two configurations must not share a cache entry; iOS
ignores the field and pays one extra entry rather than carrying a platform-specific key.
**Two announcement sites** — the second half gets a name written in the library
("More options") and the menu's own expanded/collapsed state, since the library bundles no
string catalogue to borrow one from.

Measured, both from a poisoned cache: Android `124.95 × 48.00` dp against the same fixture's
plain `78.86 × 48.00` (declared fallback `75.10 × 52.00`, two corrections); iOS
`79.67 × 34.33` with and without the prop, which is the asymmetry stated as a number. The
sizes table and the fallback paragraph in `docs/components/menu.md` carry both columns.

**Screenshots: `menu-{ios,android}.png` were not retaken.** The README's Menu pair shows the
*list*, which E3 does not change; the split is a trigger-level difference, documented in the
Usage block, the platform-mapping table and the new `SplitTrigger` story — which is the
reproducible fixture if a later pass wants a third shot. D4's test is satisfied by the
existing pair plus the new Usage section, so the component does not ship as prose.

Two claims this round wrote, measured and then corrected: the popup's wrapper `Box` is not
what anchors the list (the half's slot is), and iOS's action half *is* observable from the
harness — the synthesised touch reaches SwiftUI's tap on a `Menu(primaryAction:)` even though
G2 measured that a `Button`'s gesture environment refuses it. Both are recorded in
`docs/tasks/E3/mutations.json`, the first as the negative control that forced the wording.

## Gates

