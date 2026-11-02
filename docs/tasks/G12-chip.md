# G12 — Chip

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease on this machine (`lease.mjs acquire --task G12 --boot`). Don't use
`--exclusive`; the owner may be using the machine.

## Workspace on this machine

- The project checkout here is the owner's own working copy. Don't edit it, switch its branch, stash, reset or
  clean it.
- Make your own worktree from `origin/main` on branch `task/G12-chip`, and run `bun install` there.
- Push only that branch: never `main`, tags or force, and don't open a PR.
- Touch no other project.

## Read first

- AGENTS.md, including the perf contract and red proofs;
- `docs/DECISIONS.md` D14, D17, D29 and D33;
- `docs/tasks/Q5-next-components.report.md`: the Chip paragraph in Appendix D and its row in Appendix A;
- how Button and Switch were built (`docs/components/button.md`, `switch.md`, and the G2 report), because Chip is a
  sibling of both;
- G11 (`docs/components/dialog.md` and its report), the most recent component, for the current registry,
  conformance and docs conventions.

## Design (Q5), to refine in this task

- **Android:** Material 3 chips. A filter chip is `FilterChip`, and an assist chip is `AssistChip`. Decide whether
  input and suggestion chips are in v1. Recommendation: filter and assist only; keep the API open for the others.
- **iOS** has no chip:
  - a filter chip is `Toggle(isOn:) { Label }.toggleStyle(.button)` (iOS 15);
  - an assist chip is a `Button` with `.buttonStyle(.bordered)`, `.buttonBorderShape(.capsule)` and
    `.controlSize(.small)`.
- Inline and `intrinsic`. A filter chip's `selected` is a value, so it uses Switch's event-count handshake.
- Material's selected filter chip gains a leading check, so `selected` belongs in the sizing key on Android.
- One-node semantics, the sizing-key shape (escaped free-form fields, as G10 fixed for Button) and the fallback
  rules all come from Button.
- Props to settle:
  - `variant: 'filter' | 'assist'`;
  - `label`;
  - optional SF Symbol / Material icon names, following Button's icon convention;
  - `selected` and `onSelectedChange` (filter only);
  - `onPress` (assist);
  - `disabled`;
  - `testID` and the a11y props.

Write the final API at the top of your report before building. If a choice affects other components' conventions,
stop and ask.

## Do

1. Build `Chip` on both platforms to that design:
   - registry and component.json entries;
   - the conformance rules;
   - an example screen and Storybook stories;
   - `docs/components/chip.md`, and a README section with iOS and Android screenshots taken the way PR #11 did;
   - a minor changeset.
2. Tests, each shown red first:
   - harness on both platforms: sizing, the handshake (a controlled `selected`, and a refused change reverting),
     a11y role and selected state, disabled, recycle-reset;
   - real-input taps on both platforms.
3. Add bench arms the way Button's were added, if that's cheap. Otherwise leave one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at `docs/tasks/G12-chip.report.md`,
with the ledger exported.
