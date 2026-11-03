# Q6 — ContextMenu design

**Type:** research and design. Read-only on code, no devices. **Round cap:** 1 round, plus at most 1 fix round.
**Output:** `docs/tasks/Q6-contextmenu-design.report.md`.

## Why

Q5 ranked ContextMenu fifth and gave it one paragraph (Appendix D): medium-high risk, gated on BottomSheet's work on
React Native children. That work has now shipped (G14): the iOS `.mm` patch that mounts children into a content view
(`scripts/patch-nitrogen.mjs`, `CONTENT_CHILDREN_VIEWS`), and the Android hand-written view manager with a touch root
(`androidViewManager` in the manifest). ContextMenu is the first component that wraps React Native children **in
place** rather than in a presented window, so it needs a design at Q1's depth before a build.

## Read first

- `docs/PLAN.md`, `docs/DECISIONS.md` (D14, D17, D29, D32, D33, D35), AGENTS.md's perf contract.
- `docs/tasks/Q5-next-components.report.md`: the ContextMenu paragraph and row, and Appendix C2 (React Native
  children in a presented window).
- `docs/tasks/Q1-menu-design.md`: the format and depth to match, and Menu's `group` model.
- `docs/components/menu.md`, `docs/components/bottom-sheet.md`, and the G14 report (what the children mechanism
  actually turned out to need, including the iOS mount finding and the Android touch root).
- `docs/tasks/G9-ios-menu-untitled-group.report.md`: the `UIMenu` tree a probe reads.
- Expo UI and zeego / react-native-context-menu-view from a local read-only reference clone if one exists (AGENTS.md);
  otherwise their public docs. Note what each ships per platform.

## Do

A full design at Q1's depth:
1. **Public API** following repo conventions: `T | null` props, Menu's `group` reused, stable callbacks, `onSelect`,
   `onOpen`/`onClose` semantics (D32), children as the trigger content.
2. **iOS:** `UIContextMenuInteraction` on the Fabric view holding the children. The menu as `UIMenu`/`UIAction` from
   `group`; the preview (system snapshot vs a custom preview), and whether the content view needs the `.mm` patch
   or Fabric's own mounting is enough (check G14's finding). Minimum OS.
3. **Android:** no platform long-press menu. An M3 `DropdownMenu` at the press point with Menu's rows and its witness;
   how the press point reaches Compose; the children mechanism (G14's view manager and touch root, or a simpler
   wrapper, since nothing is presented).
4. **Gesture arbitration** on both platforms, the central risk: a `Pressable`/`onPress` inside must not fire after
   the menu opens; scroll views around and inside; RN's responder system vs the native long-press. Name the exact
   mechanism (touch cancellation, `requestDisallowInterceptTouchEvent`, the iOS interaction's gesture relationships).
5. Sizing (D17: the wrapper takes its children's size; no fallback?), a11y (the accessibility action that opens the
   menu on each platform), recycling and drop.
6. Harness and real-input test plans with oracles, including the arbitration cases; bench arms if any.
7. Known risks, and the **spike questions** to settle first. Recommend whether a spike (one round, D19's spike rule)
   should come before the build, and what its go/no-go criteria are.
8. Decisions that are the owner's: under "Questions for orchestrator", with options and your recommendation.

## Not in scope

Any code change. Other components.
