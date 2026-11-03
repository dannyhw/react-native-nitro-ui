# G15 — Checkbox

**Worktree / branch:** named in your delegation message (`task/G15-checkbox`). **Round cap:** 1 round, plus at most 2
fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G15 --boot`).

## Read first

- AGENTS.md: the perf contract, red proofs, and the README rule (D4: Components row, import line, Usage section and
  both screenshots, enforced by `scripts/__tests__/readme-components.test.js`);
- CONTRIBUTING "README screenshots";
- `docs/DECISIONS.md` D14, D17, D29 and D33;
- `docs/tasks/Q5-next-components.report.md`: the Checkbox paragraph in Appendix D and its row in Appendix A;
- how Switch was built (`docs/components/switch.md`), because Checkbox is a Switch clone with a different composable;
- G12 Chip (`docs/components/chip.md`, `docs/tasks/G12-chip.report.md`), the most recent inline control with a
  controlled value: it has the current registry, conformance, sizing-key and docs conventions, and the Android
  size-hold handshake lessons from its fix round.

## Design (Q5), to refine in this task

- **Android:** Material 3 `Checkbox`, and `TriStateCheckbox` when the value is indeterminate. One merged a11y node
  with `Role.Checkbox` and its toggleable state, so TalkBack announces a checkbox, not a switch.
- **iOS** has no checkbox (`CheckboxToggleStyle` is unavailable on iOS). Render SwiftUI `Toggle(isOn:)` with the
  switch style, as Expo's universal `Checkbox` does. Indeterminate is Android-only; on iOS it reads as off. Document
  it (D29/D32 style).
- Its own export, not a Switch variant.
- Inline and `intrinsic`. `checked` is a controlled value, so it uses Switch's event-count handshake.
- Props to settle:
  - `checked: boolean | null` and `onCheckedChange`; whether `indeterminate` is its own prop or a
    `checked: 'indeterminate'` value (recommend a separate `indeterminate: boolean | null`, so `checked` stays a
    boolean on both platforms);
  - an optional `label`: decide whether a label is in v1, on both platforms (SwiftUI `Toggle` takes one; on Android
    a `Row` with the checkbox and text, the row toggleable). Recommend in v1, because a bare Android checkbox has no
    accessible name and every real use has a label;
  - `disabled`, a tint following Switch's convention, `testID` and the a11y props.
- Write the final API at the top of your report before building. If a choice affects other components' conventions,
  stop and ask.

## Do

1. Build `Checkbox` on both platforms to that design:
   - registry and component.json entries (decide `hostable`; Chip shipped unhostable until measured, follow that
     unless hosting is trivially the same as Switch's, and say which);
   - the conformance rules;
   - an example screen and Storybook stories;
   - `docs/components/checkbox.md`, a README section (Components row, import line, Usage) with iOS and Android
     screenshots by the CONTRIBUTING convention (804 px / 720 px wide, Storybook, light);
   - a minor changeset.
2. Tests, each shown red first:
   - harness on both platforms: sizing (with and without a label), the handshake (a controlled `checked`, and a
     refused change reverting), indeterminate on Android, a11y role and checked state, disabled, recycle-reset;
   - real-input taps on both platforms.
3. Add a bench arm the way Switch's were added, if that's cheap. Otherwise leave one FOLLOWUPS line.

## Not in scope

RadioGroup (Q5: that's a Picker `variant="radio"` on Android, a separate task). Anything else: one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G15-checkbox.report.md`, with the ledger exported (`gate.mjs export --task G15`).
