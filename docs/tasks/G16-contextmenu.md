# G16 — ContextMenu

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease on this machine (`lease.mjs acquire --task G16 --boot`). Don't use
`--exclusive`; the owner may be using the machine.

## Workspace on this machine

- The project checkout here is the owner's own working copy. Don't edit it, switch its branch, stash, reset or
  clean it.
- Make your own worktree from `origin/main` on branch `task/G16-contextmenu`, and run `bun install` there.
- Push only that branch: never `main`, tags or force, and don't open a PR.

## Read first

- AGENTS.md: the perf contract, red proofs, the README rule (D4) and CONTRIBUTING "README screenshots".
- `docs/DECISIONS.md` D32, D35, **D36** and **D37**.
- `docs/tasks/Q6-contextmenu-design.report.md` (the design) and `docs/tasks/S3-contextmenu-spike.report.md` (what the
  spike measured and what the build must change). The spike's prototype is on `origin/task/S3-contextmenu-spike`:
  read it as a reference, don't merge it.
- Menu (`docs/components/menu.md`, its source and harness) for `group`, the rows and the witness; BottomSheet's G14
  report for the Android view manager and touch root.

## Do

1. Build `ContextMenu` on both platforms to Q6's design as amended by D36 and D37:
   - the arbitration (touch cancel) on both platforms, the Android press-point anchor, the layout-move dismissal;
   - the a11y paths (iOS getter, Android `onInitializeAccessibilityNodeInfo`), `previewCornerRadius`;
   - Menu's Android rows and `useMenuRows` moved to shared files (D36 item 4) — Menu's harness re-runs on both
     platforms;
   - the `longPressAt` patch to `@react-native-harness/ui` (D36 item 2), shown red/green with a ContextMenu harness
     case;
   - registry and component.json entries, conformance rules, an example screen and Storybook stories;
   - `docs/components/context-menu.md`, a README section (Components row, import line, Usage) with iOS and Android
     screenshots by the CONTRIBUTING convention (the menu shown open), and a minor changeset.
2. Tests, each shown red first: the spike's questions 1, 2, 3 and 5 as harness and/or real-input cases on both
   platforms (cancel, scroll, iOS mount with padding/border, Android anchor), the a11y wrapper test (D37 item 2),
   `onSelect` before `onClose`, drop and recycle (an open menu dropped), and Menu's existing suite.
3. Add a bench arm (an interaction per row at N = 200, Q6 risk 6) if cheap; otherwise one FOLLOWUPS line.

Write the final API at the top of your report before building. Stop and ask on anything that changes another
component's conventions.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G16-contextmenu.report.md`, ledger exported (`gate.mjs export --task G16`), branch pushed.
