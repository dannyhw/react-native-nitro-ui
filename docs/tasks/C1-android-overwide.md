# C1 — Android: intrinsic content wider than its box fits instead of clipping

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/C1` (branch `task/C1-android-overwide`, from `main`).
**Devices / env:** assigned in the delegation message. **Round cap (D19):** 1 + 2 fix rounds.

## Problem (G4 review F2, README "Known limitations")

The Android host measures intrinsic content with unbounded width and draws it centred at that width,
while the sizing engine shrinks the Yoga box to the parent's width (`cpp/NitroUiIntrinsic.hpp` ~212).
Content wider than its box (a long SegmentedControl row, a long Button title) is clipped at both ends,
and the hidden parts of the outer segments can't be tapped. iOS compresses/truncates instead.

## Scope

1. Record intrinsic size with unbounded constraints (unchanged), but **place and draw** the content
   with the box's bounded constraints, so Material 3 components truncate/ellipsize labels the way they
   do in a narrow Compose layout. Fix it in the shared host (`NitroComposeHost` / measured root), not
   per component.
2. Sizing must stay correct: a control whose box equals its intrinsic size is pixel-identical to
   today; D17 counters (corrections, immediate, stale) unchanged on the existing sizing suites.
3. Tests (shown red first): an over-wide SegmentedControl and Button in a narrow parent — the drawn
   width equals the box width, both outer segments are tappable (real-input or harness tap at the
   outer edge), the label is truncated not clipped. Screenshots before/after.
4. Update the README "Known limitations", `segmented-control.md`, `button.md`, the G4 test name
   `keeps a caller width in charge` if its claim changes, and the example/story rows that were
   shortened to hide the clip.

Gates: `bun run check`; Android harness full suite; iOS harness full suite (shared TS/C++ may move);
real-input both. No bench run required unless the measure path changes cost — then one quick
Android run for the touched components, labelled.
