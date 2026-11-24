# FIX30 — ButtonGroup's outlined toggles draw Material's outline

**Branch:** `task/FIX30-button-group-outlined-border` (from `main` at `88adce26`) ·
**Round:** 1 of up to 3 · **Lease:** `FIX30-y61e2` (`emulator-5570` / Metro `9293`)

## Summary

`toggleOutlinedBorder` in `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButtonGroup.kt`
now follows Material for the state, the way `outlinedBorder` in
`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiIconButton.kt` does. A `text` item
passes `null`, which is what it draws. An `outlined` item takes Material's own border: untinted it
keeps it, and tinted it keeps the width and the colour's alpha — the state's strength — and replaces
only the hue. Where Material returns no border, none is drawn, so a toggle that is on wears no ring.

The two decisions behind that, both read out of the 1.5.0-beta02 class files rather than assumed:
`OutlinedToggleButtonDefaults.border(enabled, checked)` is `ButtonDefaults.outlinedButtonBorder(enabled)`,
whose stroke is `outlineVariant` at full strength enabled and at alpha 0.1 disabled, and `null` once
the toggle is on. The old function kept only the width, invented `1.dp` when Material answered `null`
— which it does for an item that is on — and, untinted, returned `null` itself, replacing the
parameter's own default with nothing. So an untinted `outlined` toggle drew no outline at all.

The group also gains the pixel probe `IconButton` already has (`NitroUiPixelProbes` and
`nitroUiSamplePixels`, plus the two `@internal` methods on the spec, both platforms), because the
harness case has to read an outline whose colour it may not name: Material's is the scheme's own.

Two fixture notes a reviewer needs. Each group holds one toggle whose `title` is a single space, so
the border is the only ink in the box and the box still measures a real size. And the untinted states
are read as the exact ink each one puts on screen, not as a colour share: this device's
dynamic-colour `outlineVariant` is `#797A82`, fifteen of the sampler's units away from its own grey
backdrop, so counting pixels against the backdrop cannot see the outline. The tinted states are read
against `#00FF00`, a colour no scheme draws.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2231 tests / 103 suites | `3102a35c1982` | 57.3 s | start 13.0 / med 27.1 / max 32.8 |
| `harness:ios` | **PASS** | 622 tests / 30 suites + isolated 6 tests / 3 suites | `3102a35c1982` (harness:ios digest) | 16 m 47 s | start 3.2 / med 3.9 / max 7.4 |
| `harness:android` | **PASS** | 680 tests / 31 suites + isolated 6 tests / 3 suites | `3102a35c1982` (harness:android digest) | 18 m 49 s | start 3.6 / med 4.1 / max 43.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:ButtonGroup` | **PASS** | 15 tests / 1 suites | `3102a35c1982` (harness:android digest) | 18.2 s | start 3.6 / med 3.8 / max 3.8 |

`need --for review`: `need: review is satisfied on this code tree.` — `check`, `harness:ios` and
`harness:android` green; the `ButtonGroup` rows are the filtered runs behind the red proofs below.
`real-input` is left for merge, as the brief says.

The first `check` run was red on one unrelated tooling test: `bench-dry-run.test.js` could not
extract a release tag (`Compare: refused - could not extract v9.9.0: spawnSync tar EPIPE`) with the
machine at load 15.26 over 10 cores, because the merge's `real-input:android` was running beside
it. The rerun, with the same tree, is the row above.


## Red proofs

- `draws Material own outline for each state, in the tint when one is given` -> untinted keeps
  `null` (main's line: `?: return null`) -> `an enabled "outlined" toggle with no tint draws
  nothing but the sampler's backdrop, so it has no outline at all: … closest=#808080: expected
  '#808080' not to be '#808080'`
- same test -> the disabled alpha is dropped (`BorderStroke(base.width, color)`) -> `a disabled
  tinted "outlined" toggle is drawn in the full #00FF00, so its border reads as enabled rather than
  at Material's disabled strength: … hits=818 … expected 818 to be 0`
- same test -> the `text` variant is given the border too -> `a tinted "text" item is drawn in the
  tint #00FF00, so it wears a ring the "text" variant must not draw: … hits=818 … expected 818 to
  be 0`
- same test -> Material's border is asked for an unchecked toggle (`checked = false`), so it is
  never `null` -> `a tinted "outlined" toggle that is on is drawn in the full #00FF00, so it wears
  a ring Material's own toggle does not draw: … hits=1049 … expected 1049 to be 0`

Each run: `node scripts/gate.mjs harness:android -- ButtonGroup`, one suite, 15 tests, one red per
mutation, and the reverted tree green again in the same session.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButtonGroup.kt`: the border, and the
  pixel probe on the model and the view.
- `src/components/ButtonGroup/ButtonGroup.nitro.ts`, `NativeNitroUiButtonGroup.ts`, `ButtonGroup.tsx`,
  `nitrogen/generated/**`, `etc/react-native-nitro-ui.api.md`: the two probe methods on the spec and
  the handle.
- `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift`: the `no pixels` stub the other
  components use.
- `example/__tests__/ButtonGroup.harness.tsx`: the probe helpers and the new case.
- `.changeset/button-group-outlined-toggle-border.md`, `docs/tasks/FIX30-…report.md`.

## Follow-ups

- `ButtonGroup`'s probe samples the whole group's box, so a fixture needs one item per group; a
  per-item box would let a mixed row be read.
- The sampler reports one colour's hits; a dynamic `outlineVariant` within tolerance of its own grey
  is invisible to pixel counting. A histogram line would suit untinted outlines on any device.
- `scripts/__tests__/bench-dry-run.test.js`: `tar EPIPE` when extracting a tag under load; one
  `check` in four hit it here, green on the rerun.

## Questions for orchestrator

None.
