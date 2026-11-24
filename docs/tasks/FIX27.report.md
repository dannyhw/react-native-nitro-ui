# FIX27 — A tinted outlined IconButton dims its border when disabled

**Branch:** `task/FIX27-outlined-border` (from `main` at `6f42fe7`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX27-hmd1h` (`emulator-5574` + `iPhone 17` / Metro `9295` android, `8295` iOS)

## Summary

A tinted `outlined` control now asks Material for its state's border and keeps Material's
answer for both the width and the strength, replacing only the hue with the control's tint. A
toggle that is on gets no border, because Material's own answer for that state is no border.

The decision a reviewer needs before the diff: Material's parameter is `enabled`, in
1.5.0-beta02 and in 1.4.0 alike — read off the class files' SMAP strings (`N(enabled)` and
`N(enabled,checked)`) and from Material's own call sites, which pass `enabled = enabled`. Every
call in this file handed it a `disabled` flag, and the toggle's two arguments were swapped, so
the untinted path was inverted as well: an enabled outlined control read Material's *disabled*
answer (its content colour at 38%), and a toggle that was on read the unchecked one. Behaviour 4
asked for no design change without a tint, and there is none — correcting the arguments is what
makes "without a tint the control follows Material" actually true, and the untinted border is
then simply whatever `IconButtonDefaults` returns.

The disabled strength is read from Material's stroke rather than invented. `BorderStroke` carries
no `colour` — only `width` and `brush` — so the strength comes from `SolidColor.value.alpha`.

The proof reads the border and nothing else. `outlined` puts a `tintColor` in the content colour,
so a glyph the app does not have draws nothing and the border is the only ink these controls own.
On the device: the enabled ring is 1047 px of `#FF00A0`; the same control disabled has 0 px of it,
and its nearest ink is `#B1508D` — the tint at Material's strength over the sampler's grey, 110
from that grey and 177 from the tint. A toggle that is on has 0.

One shape of that proof changed after its first run: a checked outlined toggle with no glyph owns
no ink at all, so the answer is read against the control's own unchecked twin — same fixture, same
box, `displayed=1` — rather than against a claim that the checked control painted something. That
claim was false, and the run said so.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2214 tests / 100 suites | `c8fe044f480f` | 55.6 s | start 2.4 / med 5.6 / max 6.6 |
| `harness:ios` | **PASS** | 621 tests / 30 suites + isolated 6 tests / 3 suites | `c8fe044f480f` (harness:ios digest) | 14 m 46 s | start 9.9 / med 3.1 / max 9.9 |
| `harness:android` | **PASS** | 679 tests / 31 suites + isolated 6 tests / 3 suites | `c8fe044f480f` (harness:android digest) | 19 m 41 s | start 3.9 / med 2.9 / max 22.2 |
| `real-input:ios` | **PASS** (from `merge/FIX24-FIX25`) | — | `7ea50279e125` (real-input:ios digest) | 45 m 11 s | start 3.1 / med 6.5 / max 41.5 |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:IconButton` | **FAIL** | — | `c8fe044f480f` (harness:android digest) | 0.9 s | start 3.5 / med 3.5 / max 3.5 |

`need --for review`: "review is satisfied on this code tree."

## Red proofs

- `draws a tinted outlined border … dimmed while disabled` -> `val strength = 1f`, so a disabled
  border is built in the full tint -> "a disabled tinted outlined button is still drawn in the
  full #FF00A0, so its border reads as enabled: … hits=1047 … expected 1047 to be +0" at
  `example/__tests__/IconButton.harness.tsx:1274`.
- `draws a tinted outlined border … not at all when checked` ->
  `base ?: IconButtonDefaults.outlinedIconButtonBorder(enabled)!!`, so a checked toggle is
  answered with the press form's border -> "a tinted outlined toggle that is on is still drawn in
  the full #FF00A0 … hits=1330 … expected 1330 to be +0" at
  `example/__tests__/IconButton.harness.tsx:1326`.

Both were run as filtered `harness:android:IconButton` runs, and the case is green again on the
restored tree, in the full run above.

The `harness:android:IconButton` row above is the newest filtered run on this code tree, and it is
the run the harness refused in 0.9 s because the installed app carried another tree's stamp — a
setup refusal, not a test result. The two mutation runs sit on their own code trees, and the full
`harness:android` run above is the case green on the restored one.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiIconButton.kt`: `outlinedBorder`
  takes `enabled` and answers with Material's border for the state; its two callers pass `enabled`
  and Material's argument order; the 1 dp fallback that only covered the old "read the width or
  guess" path is gone.
- `example/__tests__/IconButton.harness.tsx`: the new case, plus `closestOf`, `sampledArea` and
  `colourDistance` for reading the sampler's line.
- `.changeset/icon-button-outlined-border-state.md`: patch.

## Follow-ups

- ButtonGroup: `toggleOutlinedBorder` keeps only Material's width and builds the stroke in the
  full tint, so it likely has the same dim-and-checked gap
  (`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButtonGroup.kt:533`).
- iOS: the `outlined` ring is `UIColor.separator` at 1 pt with no state branch, so it neither dims
  while disabled nor disappears on a checked toggle — though it never claims the tint either, so
  it is not the same gap (`ios/components/IconButton/HybridNitroUiIconButton.swift:276`).
