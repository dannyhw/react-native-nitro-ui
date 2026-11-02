# G11 — AlertDialog and ConfirmationDialog

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease on this machine (`lease.mjs acquire --task G11 --boot`). Don't use
`--exclusive`; the owner may be using the machine.

## Workspace on this machine

- The project checkout here is the owner's own working copy. Don't edit it, switch its branch, stash, reset or
  clean it.
- Make your own worktree from `origin/main` on branch `task/G11-dialogs`, and run `bun install` there.
- Push only that branch: never `main`, tags or force, and don't open a PR.
- Touch no other project.

## Read first

- AGENTS.md (the perf contract, red proofs, scope);
- `docs/DECISIONS.md` D33, which settles Q5's open questions, plus D14, D17, D29 and D32;
- `docs/tasks/Q5-next-components.report.md` Appendix B, your design;
- how Menu and DatePicker were built (`docs/components/menu.md`, `date-picker.md`, and the G7a/G7b and G5 reports),
  and the registry/conformance tooling a new component must join (X3, X4).

## Do

1. **Spike first, inside this task** (Q5 B9): can a plain view always find a controller to present from on iOS?
   Check inside an RN `Modal`, inside a react-native-screens `formSheet`, and while something else is already
   presented. Does it dismiss cleanly mid-animation, and when its view is dropped while presented? Also check the
   Android equivalents.
   - If a case can't be made to work, STOP and report it with options, before building on top of it.
2. **Build the component** to Appendix B and D33:
   - the public TS API;
   - the iOS `UIAlertController` path, through a core presentation helper factored out of DatePicker's popover (keep
     DatePicker's behaviour identical);
   - the Android Material 3 `AlertDialog`, plus a `ModalBottomSheet` for the confirmation form;
   - `isPresented` through the event-count handshake, the action order from D32, `sizing: null`, and support inside
     `<Host>`;
   - registry and component.json entries, the conformance rules, an example screen and Storybook stories;
   - docs at `docs/components/dialog.md` (or one file per export, matching the repo's convention), and a README
     section;
   - a minor changeset, because this adds a component.
3. **Tests from Appendix B7,** each shown red first. Harness on both platforms, plus real-input cases on both
   (present, tap an action, dismiss by back/outside where that applies, a refused dismissal re-presents).
4. **Bench arms per B8,** if they're cheap. Otherwise leave one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G11-dialogs.report.md`, with the ledger exported.
