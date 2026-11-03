# Q8 — Material 3 Expressive per component, and everything held back for old RN

**Type:** read-only research and design, no devices. **Round cap:** 1 round, plus at most 1 fix round.
**Output:** `docs/tasks/Q8-expressive-and-holdbacks.report.md`.

## Why

D39: current platforms only, and Material 3 Expressive as the Android design, matching and going past `@expo/ui`
(e.g. expo/expo#52598 wrapped the Expressive `DropdownMenuPopup`, `DropdownMenuGroup`, `SelectableDropdownMenuItem`).
X18 raises the floor and switches the theme in parallel; this task plans what comes after.

## Do

1. **Per Android component** (every control in `src/components`, including Host and the ones being built: SearchField,
   Tooltip), name its Material 3 Expressive counterpart(s) in `material3` 1.5 — exact composables and overloads, which
   are still `@ExperimentalMaterial3ExpressiveApi`, and what the theme alone already changes. Read the 1.5.0-beta02
   API (the AAR in the Gradle cache or the public reference docs) and Expo UI's current Compose wrappers (reference
   clone or public source). For each: the public API change for our users (new props/variants, defaults), the risk,
   and the effort.
2. **New components Expressive makes possible** that `@expo/ui` has or lacks (e.g. ButtonGroup/connected buttons,
   SplitButton, LoadingIndicator, FAB menu, toolbars), ranked as Q5/Q7 did.
3. **Everything held back for an older RN / Expo SDK / iOS that RN 0.88 no longer supports:** search the code, docs,
   decisions and follow-ups (e.g. D8, the Compose BOM pin, `#available` fallbacks below RN 0.88's iOS floor, Host or
   sizing workarounds for old RN, Nitro version pins). One row each: what, where, what lifting it buys.
4. **A build order** in passes grouped by shared code (e.g. menus: Menu + ContextMenu + Picker; buttons: Button +
   SegmentedControl→ButtonGroup; Progress→LoadingIndicator), which can run in parallel on two machines, and which must
   wait for X18.
5. "Questions for orchestrator" only for what truly needs the owner; decide the rest with a recommendation.

## Not in scope

Code changes. Anything needing a human device pass.
