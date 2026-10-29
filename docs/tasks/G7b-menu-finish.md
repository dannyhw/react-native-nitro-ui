# G7b — Menu: bench arm, real-input, story, smoke, and what G7a left open

**Worktree / branch:** named in your delegation message (from `main`). **Round cap:** 1 implementation
round plus at most 2 fix rounds (D19). **Devices:** your lease (`lease.mjs acquire --task G7b --boot`).

G7a merged Menu (`41e30c5`, PR #7). Read `docs/tasks/G7a-menu.md`, its report, review, re-review, and
**D29 and D32** in `docs/DECISIONS.md` (the owner's rulings: `onOpen`/`onClose` Android-only; iOS
`disabled` while open is a platform limit; a pick fires `onSelect` then `onClose`). Use G6 (Picker,
`docs/tasks/G6-picker.md`) as the sibling: it has a bench arm, real-input, stories and smoke.

## Do

1. **Manifest:** set `bench`, `smoke` and `realInput` to `true` in `src/components/Menu/component.json`,
   then `bun run regen`. `hostArm()` returns Menu to the Host bench arm (G7a report, Questions 5).
2. **Bench arm:** add Menu to every arm the registry asks for, with the same cells as Picker, where a
   menu has an equivalent. Say which cells don't apply and why. Run the bench on your lease; per-machine
   baselines are minted only in the orchestrator's exclusive window, so report numbers and don't mint.
3. **Real-input case, both platforms:**
   - open the menu with a real tap on the trigger, pick a row, and assert `onSelect` (and, on Android,
     `onOpen`, `onSelect`, then `onClose`, in that order: D32);
   - a disabled row takes no pick;
   - on iOS, assert the SwiftUI trigger's `.accessibilityLabel` on the accessibility tree XCUITest sees
     (FOLLOWUPS: "Menu iOS a11y"). Remove the modifier to show it red.
   - Use F1's witness pattern: read native state before any retry.
   - If the iOS rows inherit the trigger's `.buttonStyle`, as the real-input screenshot will show, apply
     `.buttonStyle(.plain)` to the row content (G7a report follow-up).
4. **Android `menuAnchor` proof** (G7a owner decision 4, FOLLOWUPS "Menu Android `menuAnchor`"): add the
   upper bound `mTop - aBottom < 48 px` to the hosted test, and commit a red run with a plain
   `DropdownMenu`, reverted after.
5. **Storybook story** (Playground with every prop, plus a showcase) and **smoke** (`scripts/smoke`), per
   S1's layout and G6's.
6. **iOS open/close spike (one attempt, time-boxed):** see whether `.onAppear`/`.onDisappear` on the
   menu content reliably reports open and close on iOS 27. Report the measurement. Don't ship it unless
   it is reliable under real-input; D32 stays as ruled.
7. **Conformance:** if X4 (`task/X4-conformance`) has merged by the time you start, cover Menu in its
   tables (`check` refuses an uncovered manifest). If it hasn't, say so in the report; whichever lands
   second covers Menu.

## Gates

`check`, both `harness:*`, both `real-input:*`, `need --for review`. Bench numbers in the report
(load-stamped). Report: `docs/tasks/G7b-menu-finish.report.md`, with the ledger exported. No changeset
unless the published package changes (a row-style fix would be a patch changeset).
