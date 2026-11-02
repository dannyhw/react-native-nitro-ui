# Q5 — Which components next, and their designs

**Type:** research and design. Read-only on code, no devices. **Round cap:** 1 round, plus at most 1 fix round.
**Output:** `docs/tasks/Q5-next-components.md` (this brief) plus `docs/tasks/Q5-next-components.report.md`, the
deliverable.

## Why

The owner's priority is now new components. What has shipped: Switch, Slider, Button, Progress, SegmentedControl,
Picker, DatePicker and Menu, with an opt-in Android `<Host>`. TextField is being re-measured in T19, so leave it out of
scope here. `docs/PLAN.md` lists for later: Alert/Dialog, BottomSheet, Toast/Snackbar and Form/List/Section/stacks.
Nothing on that list is designed yet.

## Read first

- `docs/PLAN.md`, `docs/DECISIONS.md` (especially D14, D17, D19, D29, D30 and D31), AGENTS.md's perf contract,
  `docs/architecture/` (sizing, core), `docs/components/menu.md`.
- `docs/tasks/Q1-menu-design.md`: the format and depth to match. It was the design input that G7a and G7b built Menu
  from, including its popup/presentation decisions.
- `docs/research/core-architecture.md` R6: ViewTree owners in RN `Modal` and other non-activity windows. This matters
  for anything that presents.
- Expo UI's component set, if a local read-only reference clone exists (`expo_expo`, see AGENTS.md); otherwise its
  public docs. Note what Expo ships for each candidate on iOS and Android, so we match or beat it.

## Do

1. **Rank the candidates.**
   - Candidates: Alert/Dialog (incl. confirmation dialog / action sheet), BottomSheet (with detents),
     ContextMenu (long press), Stepper, Checkbox/RadioGroup (Android-native; iOS has no direct native),
     Toast/Snackbar, Gauge, ColorPicker, Chip, and Form/List/Section containers. Add any strong candidate that's
     missing.
   - Score each on:
     - a native counterpart on both platforms (SwiftUI and Compose/Material 3), or one platform only;
     - how well it fits our Hybrid View model (inline control vs presentation; how presentation interacts with RN
       `Modal`, navigation and recycling);
     - user demand: compare Expo UI's set and common app needs;
     - risk and effort, and reuse of the Menu popup work.
   - Recommend an order for the next three to five.
2. **Full design for the top two,** at Q1's depth:
   - the public TS API, following the repo's conventions: `T | null` props, the controlled-value handshake where a
     value exists, and stable callbacks;
   - the native mapping on each platform, with the exact SwiftUI and Compose APIs and their minimum OS versions;
   - sizing (D17 fallbacks or none for presentations);
   - presentation and dismissal semantics, and the controlled `isPresented` handshake if any;
   - a11y;
   - recycling and drop behaviour;
   - harness and real-input test plans, with oracles;
   - bench arms;
   - known risks, with the spike questions to settle first.
3. **One paragraph each** on the rest of the ranked list.
4. **Decisions that are the owner's:** list them under "Questions for orchestrator", with options and your
   recommendation.

## Not in scope

TextField (T19). Any code change.
