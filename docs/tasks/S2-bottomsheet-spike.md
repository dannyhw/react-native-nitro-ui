# S2 — BottomSheet spike: React Native children in a presented sheet

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 1 fix
round (D19). **Devices:** your lease (`lease.mjs acquire --task S2 --boot`). T19 holds the other pair on this host.

## Read first

- AGENTS.md;
- `docs/DECISIONS.md` D33;
- `docs/tasks/Q5-next-components.report.md` Appendix C, the BottomSheet design, especially C2 (RN children in a
  presented window), C6 and C10;
- `docs/research/core-architecture.md` R6 (ViewTree owners in RN `Modal`);
- RN's own `Modal` implementation in `node_modules/react-native`, read-only: it's the model C2 follows.

## Why

BottomSheet is the most-wanted next component (Q5). It's the first nitro-ui component that has to host
**React Native children inside a natively presented window**, which nothing in the library can do yet. ContextMenu
needs the same mechanism later. Settle it before anyone builds the component.

## Do

Build a throwaway prototype on this branch (it's never merged) to answer, with evidence on both platforms:

1. **Mount:**
   - Can RN children render inside a UIKit sheet presentation on iOS (custom detents need iOS 16) and inside a
     Material 3 `ModalBottomSheet` on Android?
   - Do they lay out at the sheet's width, which native provides, as RN `Modal` does?
2. **Touch and scroll:**
   - Do taps reach a `Pressable` inside the sheet?
   - Does a `ScrollView` inside scroll, and does its gesture hand off to the sheet's drag?
3. **`fit` detent:** can the sheet size to its RN content's height without a visible jump? Measure the first-frame
   height against the settled height.
4. **Lifecycle:** present and dismiss, dismissal by drag and by back, a JS `isPresented=false` mid-animation, and the
   view dropped while presented. Check for leaked windows or RN roots: memory at N=50 present/dismiss cycles, before
   and after.
5. **Inside navigation and RN `Modal`:** does it present from inside a react-native-screens stack and from inside an
   RN `Modal`?

## Output

Write `docs/tasks/S2-bottomsheet-spike.report.md` containing:
- a go/no-go per question, with evidence (numbers, screenshots, logs), each number load-stamped;
- the mechanism you recommend for the build (G12);
- any change to Q5's Appendix C design;
- "Questions for orchestrator".

Commit the report and the ledger. The prototype code stays on the branch, as evidence only.

## Gates

`check` on the branch. Record every device run in the ledger (harness filters or real-input), so the evidence is
traceable.
