---
'react-native-nitro-ui': minor
---

Give `Button` a `shape` prop, and take Android's three button-shaped controls onto Material 3 Expressive's own size and shape tokens.

- **`shape: 'round' | 'square'` on `Button`** (default `'round'`, which draws what it drew before). On Android a Button now goes through Material's `shapes: ButtonShapes` overload, so the corner _morphs_ while the button is held: a round one squares off, a square one rounds out. iOS has no cornerless button style, so `square` is the nearest border shape it has — `.roundedRectangle(radius: 8)` — and it is static, because a `ButtonBorderShape` cannot animate. The `text` variant has no container to give a corner, so it ignores `shape` on both platforms. `Menu`'s trigger is a Button and gets all of this too; its popup is unchanged.
- **Android `size` is Material's height ladder.** `small` / `medium` / `large` now name Material 3's XS / S / M container heights (32 / 40 / 56 dp), and the content padding, label style and corner are read from that height through `ButtonDefaults.contentPaddingFor` / `textStyleFor` / `shapesFor` instead of three hand-rolled tables. Visible effect: 16 dp less width at `medium`, 19 dp less at `large`, which is 5.7 dp taller. The box is never shorter than Material's own 48 dp interactive minimum, so the touch target does not move with the token.
- **`SegmentedControl` on Android is a connected button group** — a row spaced by `ButtonGroupDefaults.ConnectedSpaceBetween` whose items carry the connected leading / middle / trailing corners — about 18% narrower than the `SingleChoiceSegmentedButtonRow` it replaces, at the same 48 dp height. The API, the look and TalkBack's "1 of 3, selected" are unchanged.
- **A selected filter chip has its own corner**, via Material's `shapes: ChipShapes` overload; filter chips measure 3.81 dp narrower at both states than before, by a constant, so a chip still grows by exactly its check mark when selected.
