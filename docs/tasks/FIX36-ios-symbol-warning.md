# FIX36 — iOS warns in development when an SF Symbol name draws nothing

**Kind:** bugfix · **Devices:** ios (android only for the harness run of a changed test file) ·
**Budget:** 2.5 h for round one (median of the recent single-concern bugfixes FIX27, FIX30, FIX35)

## Goal

An app developer who passes an SF Symbol name that iOS cannot draw (a typo, or a symbol newer
than the device's iOS) sees one development warning naming the component, the prop and the
name. Today the icon is just silently missing.

## Why

Android warns in development about an `androidIcon` name it cannot use (`warnAndroidIconName`
in `src/iconName.ts`). iOS has no counterpart: `Image(systemName:)` with an unknown name draws
nothing, and nothing tells the developer. Eight iOS components draw SF Symbols: Button, Chip,
ButtonGroup, Checkbox, ContextMenu, ListItem, IconButton and Menu (`grep -rl "systemName:"
ios/components`). SF Symbol availability depends on the iOS version, so a name that works on
the developer's simulator can be empty on an older device.

## Behaviour

1. In a development build, an SF Symbol name that `UIImage(systemName:)` cannot resolve on the
   running device produces one warning per component and name. It appears in the JS console
   (and LogBox) as `nitro-ui: <Component>'s <prop> "<name>" …`, in the same voice as the
   Android warning.
2. It covers every place in those eight components where an app-supplied name becomes an SF
   Symbol, including item and row props (ButtonGroup `items[]`, Menu and ContextMenu rows).
   Names the library picks itself are out of scope unless they fail too.
3. A release build does no lookup and warns nothing. A valid name warns nothing. Drawing is
   unchanged for valid and invalid names.

## Proof

- A harness test on iOS: a Button with a valid and an invalid `systemImage`, and one row-level
  case (Menu or ButtonGroup). It asserts exactly one warning for the invalid name, none for the
  valid one, and none on re-render. Show it red by removing the warning call. Android runs the
  file (the test can skip itself on Android) because it is a changed harness file.
- `node scripts/gate.mjs check` passes. `node scripts/gate.mjs need --for review` prints
  nothing missing.

## Out of scope

- Android icon warnings and `src/iconName.ts`'s existing behaviour.
- Falling back to another glyph, or any change to what is drawn.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- Development only, behind the same `__DEV__`/`DEBUG` line the library uses elsewhere. The
  release path must not call `UIImage(systemName:)` just to warn.
- One shared helper in `ios/core/`, not a copy per component.
- If a native warning cannot reach the JS console on this React Native version, carry the
  unresolved names to JS through the narrowest existing native-to-JS path, and say which in
  the report. Do not add a new public prop or event for it.
- The docs (`docs/components/button.md` and the components whose docs describe `systemImage`)
  gain one sentence each about the warning.

## Context

`src/iconName.ts` (the Android warning), `ios/components/*/Hybrid*.swift` (each
`Image(systemName:)` / `Label(…, systemImage:)`), `ios/core/`, `docs/components/button.md`
"Android icons".
