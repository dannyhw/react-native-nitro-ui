# G25 — Stepper

**Worktree / branch:** named in your delegation message (`task/G25-stepper`). **Round cap:** 1 round, plus at most 2
fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G25 --boot`). Export the lease's
environment before any device gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4) and CONTRIBUTING's "README screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D17, **D38 item 1** (a platform with no native control is built from its real controls, and
  the docs say so), D39 and **D43** (icons come from official Material Symbols files, never hand-drawn).
- `docs/tasks/Q7-next-components-2.report.md` **Appendix E** (the design). Where it and this brief differ, the brief
  wins: Q7 predates D43 and IconButton.
- Slider (`NitroUiSliderValue.quantize` on both platforms) and IconButton (G23) as they are on `main`.

## Do

1. **API** per Q7 E1: `value`/`defaultValue`/`onValueChange` on the event-count handshake, `minimumValue`,
   `maximumValue`, `step` (> 0, dev throw otherwise), `disabled`, `accessibilityLabel`. Clamping and snapping reuse
   Slider's `quantize`, never a copy. Every native prop always passed.
2. **iOS:** SwiftUI `Stepper(value:in:step:)` with `.labelsHidden()` and `.accessibilityValue`, keeping SwiftUI's
   hold-to-repeat (each repeat is one step event) and its own disabled halves at the bounds.
3. **Android:** Material has no stepper, so it's two Material 3 tonal icon buttons with an 8 dp gap, each disabled at
   its bound. Reuse IconButton's Android pieces (container, colours, touch target) rather than a second copy. The minus
   and plus glyphs are Material Symbols `remove` and `add`, fetched by `scripts/icons/fetch-material-symbols.mjs` and
   recorded in its lock (D43), never built `ImageVector`s. No hold-to-repeat in v1; the docs say so.
4. **Accessibility** per Q7 E2: iOS's adjustable element; on Android one node with `progressBarRangeInfo` and a
   `setProgress` action, the buttons cleared from the tree.
5. **Sizing (D17):** `intrinsic`, measured on both platforms (don't copy Q7's estimates), declared fallbacks that
   don't coincide with the real size in the conformance fixture, and conformance rules.
6. **Recycling with a full reset, the registry entry, stories, `docs/components/stepper.md` (the Android composition
   and the missing hold-to-repeat stated plainly), the README row, import, Usage section and both screenshots
   (`docs/images/components/stepper-{ios,android}.png`), and a minor changeset.**

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

Q7 E2's harness list (bounds disable the half and stop events, `0.1` steps exact through `quantize`, a refused value
snaps back, disabled sends nothing, sizes from a poisoned fallback, recycling resets the value), plus:
- the Android glyphs are drawn (IconButton's pixel probe);
- accessibility: iOS adjustable trait, Android range info, and a TalkBack/VoiceOver-style adjust action steps once;
- real input on both platforms: taps on both halves step once each, a tap at a bound does nothing, and on iOS a
  long press repeats.

**Bench:** `mount.stepper` by merge mint (X14) on this machine, against an RN `View` floor and @expo/ui's iOS
`Stepper`.

## Not in scope

Hold-to-repeat on Android, a value label, and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G25-stepper.report.md`, with the API at the top. Export the ledger with `gate.mjs export --task G25`.
