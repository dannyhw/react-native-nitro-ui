---
'react-native-nitro-ui': minor
---

`Picker` gained `variant="radio"`: every option on screen at once instead of behind a menu.

- **Android draws Material 3's own radio group**, not an imitation of one — a `Column(Modifier.selectableGroup())` of rows, each `selectable(selected, enabled, Role.RadioButton)` around a `RadioButton(onClick = null)` and its label, 48 dp tall with the whole row as the press target. `selectableGroup()` is what gives TalkBack "2 of 3"; each row is one node with its own selected state, and the group's name comes from `label` / `accessibilityLabel`, which the variant never draws.
- **iOS renders the menu**, because `RadioGroupPickerStyle` is `@available(iOS, unavailable)` and DECISIONS D38 rules that a missing control falls back to the platform's real one (the same rule that makes `wheel` the menu on Android). An iOS layout that needs every choice visible uses `SegmentedControl` for up to about five options.
- **A pick costs nothing in the sizing engine.** A group paints every label at once, so its box is the widest row by the option count and `radio`'s sizing key has no `sel:` field: choosing a row is not a new configuration — 0 corrections, and the box does not move. A cold group's first frame is still the component's one declared fallback (280 × 56 dp) and is corrected the turn it measures, because the engine holds one fallback per component, not per variant.
- **Nothing else moved.** The value is still an index with the same clamps and the same event-count handshake; `onChange`, `label`, `disabled` and `tintColor` keep their meanings — on this variant the tint paints the selected dot, through a bounded colour cache like the menu's field colours. Picking the row already chosen reports nothing, and a disabled group reports nothing, because a pick is applied in one place on every variant.
