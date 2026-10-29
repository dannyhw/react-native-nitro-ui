# G7a — Menu (button-anchored): native control, harness, sizing, a11y, Host

**Machine:** maintainer-mac-1 (`NITRO_UI_MACHINE_LABEL=maintainer-mac-1`). **Worktree / branch:** named
in your delegation message (from `main`). **Round cap:** 1 implementation round plus at most 2 fix
rounds (D19). **Devices:** that machine's lease (`node scripts/lease.mjs acquire --task G7a --boot`).
**Context pack:** `docs/tasks/G7a/context.md`.

The design is decided. Build from `docs/tasks/Q1-menu-design.md` (read all of it) as amended by
**D29** in `docs/DECISIONS.md`:
- no imperative `open()`/`close()`;
- a nested `group` of typed structs (sections plus one submenu level);
- submenus nest on iOS and render inline under a divider on Android;
- `primaryAction` is iOS-only and documented as such;
- `disabled` while open closes the menu.

Where Q1 and D29 disagree, D29 wins. Anything Q1 left open that D29 doesn't settle goes in Questions;
don't guess an API.

## Do

1. **Register the component through the registry (X3):** `src/components/Menu/component.json`, then
   `bun run regen`. Write the hand-written files CONTRIBUTING "Adding a component" lists: spec, wrapper
   (`Menu.tsx`, Button's sibling, no `useControlled`), `src/index.ts` exports, a docs page
   `docs/components/menu.md`, and a changeset (minor).
2. **iOS:** SwiftUI `Menu` inside our host (`ios/core`), as Q1 §2 describes. The label sizes like
   Button (`intrinsic`), `needsContainment`, `primaryAction` with its availability gate, and a11y
   (label, trait, the items announced).
3. **Android:** a Compose `DropdownMenu` anchored to the button inside our host, as Q1 §3 describes.
   Reuse H2b's popup handling (`placedViewOf`, `onGloballyPositioned`, dismissal on layout move, a
   `MenuWitness` and a process-wide live count *for tests*; see Q3 §2 on why harness assertions must use
   deltas, not absolute counts). One-node `clearAndSetSemantics` for a11y. Works plain and inside
   `<Host>`.
4. **Perf contract (AGENTS.md):** setters store and mark dirty, apply in `afterUpdate`, no hosting
   recreation, a stable `group` identity in the wrapper (props diff by identity), `RecyclableView`
   with a full reset, and cleanup in `onDropView`.
5. **Harness (`example/__tests__/Menu.harness.tsx`, both platforms):**
   - sizing, including a declared fallback that differs from the measured size;
   - open/select/close events with exact counts;
   - `disabled` while open closes it;
   - submenu behaviour per platform;
   - inside `<Host>` (Android);
   - drop while open leaves nothing, with a delta-based assertion;
   - recycle reset;
   - a11y.

   Each new test is shown red. Waits must refuse a wrong answer: no `waitFor` that a zero size or a
   stale handle satisfies (Q3).
6. **Example app:** a Menu tab and screen. The registry generates the tab; the screen is hand-written.

Bench arm, real-input case, Storybook story and smoke are **G7b**, not this task.

## Rules

AGENTS.md applies in full. Use leased devices only, and never touch `emulator-5560`. With `--boot`
the lease owns device lifecycle, so leave warm devices booted. Commit after each item. Don't push:
mac-1's orchestrator pushes only this task branch when review passes.

## Gates

`check`, both harnesses and `need --for review`. Real-input isn't required (G7b adds Menu's case).
Report: `docs/tasks/G7a-menu.report.md` (REPORT-TEMPLATE), with the ledger exported.
