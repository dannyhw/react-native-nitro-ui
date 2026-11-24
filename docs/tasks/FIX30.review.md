# FIX30 review: ButtonGroup outlined toggle border

Branch `task/FIX30-button-group-outlined-border` at `1955261b`, against `origin/main` (`88adce26`).

## Verdict

**Fix round needed.** The fix is right and reads Material correctly. Two assertions in the harness case need changing: one rests on a margin of 1 to 2 units on common light schemes, and one cannot fail.

Checked against the material3 1.5.0-beta02 class files:
- `OutlinedToggleButtonDefaults.border(enabled, checked)` returns `null` when `checked` and `ButtonDefaults.outlinedButtonBorder(enabled)` otherwise.
- `outlinedButtonBorder` is `BorderStroke(1.dp, outlineVariant)` when enabled and `outlineVariant.copy(alpha = 0.1f)` when disabled. `BorderStroke(Dp, Color)` builds a `SolidColor`, so the alpha read works.
- `OutlinedToggleButton`'s default `border` is exactly `border(enabled, checked)`.
- So the untinted path (`?: return base`) is Material's own border in every state.
- Tinted: `null` when on, and the tint at the stroke's alpha otherwise.
- `text`: always `null`.
- The caller passes named `checked`/`enabled` with the same values as the button. The `!disabled` flip went away cleanly.

All 16 combinations (variant × tint × enabled × checked) give what the brief asks for. The code matches `outlinedBorder` in `HybridNitroUiIconButton.kt`.

## Blocking findings

1. **`example/__tests__/ButtonGroup.harness.tsx:1946-1950`: the `> 30` threshold for the disabled tint is fragile.**
   - A disabled `OutlinedToggleButton` is filled: `disabledContainerColor = outlineVariant.copy(alpha = 0.1f)`, read from `getDefaultOutlinedToggleButtonColors`. The tinted path keeps that fill. So the disabled border pixel is `0.1·tint + 0.9·fill`, not `0.1·tint` over grey, and the comment at :1933 leaves the fill out.
   - On this device (`#797A82`) the pixel comes out about 39 from `#808080`.
   - With a light `outlineVariant` it comes out about 31 to 32: baseline `#CAC4D0` gives about 31, and a typical dynamic light `#C4C6CF` gives about 32. That is the usual case for a light-mode device or CI image, and only 1 to 2 rounding units above a strict `> 30`.
   - With the border dropped, the fill alone already reads about 20 from grey. The threshold therefore sits in a narrow gap that depends on the scheme.
   - Change: compare state against state, as the brief asks. Probe `bg-border-plain-disabled` with the same `tint`. Require `colourDistance(plainDim, TINT) - colourDistance(dim, TINT)` to be above about 10.
     - With the border correct, the gap is ≥ ~25 for any scheme.
     - With the border dropped, the gap is ≤ 0, because the plain box holds the same fill.
   - Keep the `hits == 0` check for full strength. Prove the new assertion red with the "disabled border dropped" mutation (for example `if (!enabled) return null`).
2. **`ButtonGroup.harness.tsx:1991-1999`: the untinted "on" assertion can never fail.**
   - A checked outlined toggle is filled with `inverseSurface`.
   - In a light theme that fill is the darkest ink. In a dark theme it is the lightest and farthest from grey.
   - Either way `inkOf` returns the fill colour, so `onPlain !== ring` holds whether or not a ring is drawn. The message ("wears a ring Material does not draw") is a false claim.
   - The tinted "on" case already guards ring-while-on for both paths, because they share `base`.
   - Change: remove this assertion, or replace it with one that can go red. If you remove it, say in one comment line that the tinted case covers it. Also correct the report's sentence that all four untinted states are read.

## Non-blocking

- `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift:1065-1066`: the doc comment is copied from the stubs with icons. ButtonGroup has no "Android icon glyph" here, and this test expects `no pixels` on iOS rather than "treating it as a failure". Say only that iOS has nothing to sample.
- `HybridNitroUiButtonGroup.kt:544-552`: the KDoc on the private `toggleOutlinedBorder` runs to 7 lines; the rule is 1 to 3. Keep two points: Material's state strength stays and only the hue changes; `null` from Material means none. IconButton puts the same thing in two inline lines.
- `.changeset/button-group-outlined-toggle-border.md`: "because the group passed an explicit border and `null` stood in place of Material's own" is about the implementation, not the app developer. Drop that clause; the rest reads well.
- `ButtonGroup.harness.tsx:1809`: the test name says "Material own" (missing apostrophe).
- `inkOf` (:1758) anchors only on black and white. It cannot see an outline whose channel sum equals grey's (384), because then both closest answers tie at the first pixel. That is unlikely, but probing the 8 RGB cube corners closes it, since any colour other than grey is strictly nearer one corner.
- The untinted "disabled" assertion (:2000) catches "full strength while disabled" (the full-alpha `outlineVariant` would equal `ring`). It cannot catch "dropped", because the disabled fill supplies ink either way. Finding 1's comparison covers that for the shared path.

Probe and spec:
- The probe is test-only. The model holds one `NitroUiPixelProbes` and clears it in `reset()`, which runs on recycle. Nothing is added to the setter, apply or compose path.
- The sampling runs on the UI thread or is posted there. It never blocks JS.
- Nitrogen output matches the spec on both platforms (C++ and JNI, Kotlin abstract, Swift protocol and `_cxx`).
- `@internal` methods show up in `etc/*.api.md` through the inline `hybridRef` type. That is the existing pattern for every component's `nuiTest*` methods, not new here.

CodeRabbit (PR #128): the review was still "processing" at `1955261b`. There are no inline comments to check yet.

## Follow-ups

- The sampler reports one colour's hits and the closest pixel. A small histogram (top N colours with counts) would read low-contrast outlines on any scheme without anchors. The worker's report already lists this.
- The ButtonGroup probe samples the whole group box. A per-item box would allow mixed-state rows (worker follow-up).
