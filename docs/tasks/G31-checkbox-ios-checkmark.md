# G31 — Checkbox on iOS: a checkmark, not a switch

**Worktree / branch:** named in your delegation message (`task/G31-checkbox-ios-checkmark`). **Round cap:** 1 round,
plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G31 --boot`). Export
the lease's environment before any device gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4) and CONTRIBUTING's "README screenshots" (804/720 px, Storybook, light).
- `docs/DECISIONS.md` D17, D38 item 1 and **D47** (this decision).
- Checkbox as it is on `main`: `docs/components/checkbox.md` (including why a switch-style `Toggle` answers touches
  on its glyph only, and the real-input notes), `ios/components/Checkbox/`, its harness and real-input cases.

## Do

1. **iOS:** a custom SwiftUI `ToggleStyle` on the existing `Toggle` that draws SF Symbols: `'circle'`
   (`checkmark.circle.fill` / `circle`) and `'square'` (`checkmark.square.fill` / `square`), the filled glyph in the
   accent colour (`tintColor`), the empty one in the system's secondary label colour, the label beside it in the
   platform's spacing, and `indeterminate` as `minus.circle.fill` / `minus.square.fill`. **The whole row (glyph and
   label) toggles on a tap**, as Reminders' rows do. `disabled` dims as the system does. Dynamic type scales the glyph.
2. **API:** `iosStyle: 'circle' | 'square' | 'switch'`, default `'circle'`; `'switch'` is today's look, unchanged.
   Android ignores it. Every native prop always passed.
3. **Accessibility:** one element, the label as its name, and a checked/unchecked/mixed value VoiceOver reads (measure
   what the custom style exposes: the toggle trait, `.isToggle`, the value). Write down what VoiceOver says.
4. **Sizing (D17):** each style measured on the device, in the sizing key, conformance rules, fallbacks that don't
   coincide with the real size.
5. **Docs:** `checkbox.md` (the iOS column, the new prop, why), the README usage block, a minor changeset, stories for
   each style, and retake `docs/images/components/checkbox-ios.png` (804 px, light, Storybook) showing the default.

## Tests, each shown red first

- Harness, iOS: each style's box from a poisoned fallback; the glyph drawn (checked vs unchecked differ, pixel probe or
  the rendered symbol name); `indeterminate` draws the minus glyph; `disabled` sends nothing; recycling between styles
  resets; `'switch'` still behaves exactly as before.
- Real input, iOS: a tap on the glyph and a tap on the label each toggle once; a tap on a disabled checkbox does
  nothing.
- Android: unchanged; both Android gates stay green.

## Not in scope

Android, and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G31-checkbox-ios-checkmark.report.md`. Export the ledger with `gate.mjs export --task G31`.
