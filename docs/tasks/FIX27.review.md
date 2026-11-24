# FIX27 review (round 1)

Reviewed `task/FIX27-outlined-border` at `01123283` against `origin/main` (`6f42fe7a`).

## Verdict

Fix round needed. The Kotlin fix is correct for every state; the untinted half of it is unguarded
and the changeset describes it in implementation terms.

## Blocking findings

1. `example/__tests__/IconButton.harness.tsx:1184` (the new case). Every fixture is tinted, so
   nothing guards the untinted correction, which is the default configuration and the larger
   visible change. Putting `!enabled` back in the two fallback calls
   (`HybridNitroUiIconButton.kt:675` and `:720`) keeps every gate green. Add untinted outlined
   fixtures (enabled, disabled, toggle off, toggle on) and assert the state relative to each
   other, not against a hard-coded colour: the enabled ring is stronger (further from the
   sampler's grey) than the disabled ring, and the toggle that is on has no ring where its
   unchecked twin has one. Show it red by restoring `!enabled` / `(selected, !enabled)` in the
   fallbacks. Note: without a tint the ring is `LocalContentColor`, which the host never provides,
   so it is Compose's default black; a probe on `#000000` finds the enabled ring (hits > 0) and,
   on main, finds none (black at 38% over grey is about `#4F4F4F`).
2. `.changeset/icon-button-outlined-border-state.md:9-12`. The untinted sentence explains the
   cause ("handed it a disabled flag where its parameter is `enabled`") rather than what an app
   developer sees, and it is incomplete. On main, untinted: an enabled outlined button drew its
   ring at the disabled 38%, a disabled one drew it at full strength; an enabled toggle drew a
   full ring while on and a dim one while off; a disabled toggle drew none. Say what changes in
   those terms and drop the parameter-order explanation.

## Non-blocking

- Signatures verified from the 1.5.0-beta02 AAR in the Gradle cache (`javap -l`, local variable
  tables): `outlinedIconButtonBorder(enabled)` and `outlinedIconToggleButtonBorder(enabled,
  checked)`. The toggle form returns `null` when `checked`, otherwise the plain form's border; the
  plain form is `BorderStroke(1.dp, LocalContentColor)` while enabled and
  `LocalContentColor.copy(alpha = 0.38f)` while disabled. Main's calls were inverted (plain) and
  swapped plus inverted (toggle). The worker's claim is correct, and so is the untinted fix:
  the brief's premise that the untinted path already followed Material was false.
- Every state after the fix, tinted (T) and untinted (U). Plain enabled: T full tint, U full.
  Plain disabled: T tint x 0.38, U 0.38. Toggle off enabled: T full, U full. Toggle off disabled:
  T tint x 0.38, U 0.38. Toggle on (either): T none (`outlinedBorder` returns `null`, then the
  fallback also returns `null`), U none. All match Material.
- `HybridNitroUiIconButton.kt:545` multiplies the tint's own alpha by Material's (absolute) 0.38,
  so a translucent tint dims further than Material's `copy(alpha = 0.38f)` would. Defensible; no
  change asked. While enabled the multiplier is `LocalContentColor`'s alpha, which is 1 here.
- The tinted case would go red on a revert of the Kotlin change: main drew the tinted ring in the
  full tint in every state, so the disabled `hits == 0` and checked `hits == 0` assertions fail.
  Its fixtures do not coincide with the answer: the dim colour is read from the screen
  (`closest`), not hard-coded, and is checked against both the grey and the tint. It accepts any
  alpha roughly between 0.1 and 0.5, which is the right looseness for "dimmed, not invented".
  The `sameSize` check on the two toggles adds little; harmless.
- Perf contract: no setter, lifecycle or threading change; `BorderStroke` is still built per
  composition as on main. Comments follow the rules (no history, no references).
- The report's gate table shows a `harness:android:IconButton` FAIL row; the report explains it as
  a stale-stamp setup refusal superseded by the full green run on the same tree. Accepted.
- CodeRabbit (PR #124): summary only, review still "in progress"; no inline comments to verify.

## Follow-ups

- ButtonGroup `toggleOutlinedBorder` (`HybridNitroUiButtonGroup.kt:533`, caller `:483`): no
  inverted-argument bug. It calls `OutlinedToggleButtonDefaults.border(checked = ..., enabled =
  !disabled)` with named arguments against `border(enabled, checked)`, so the values land right.
  It does have the tinted gap this task fixed for IconButton: the ring is the full tint while
  disabled, and a checked toggle (Material answers `null`) gets a 1 dp tinted ring. Two more
  things seen there: the untinted path passes `border = null`, so an untinted outlined ButtonGroup
  toggle draws no outline at all; and a tinted `text` variant gets a tinted ring.
- The untinted IconButton ring is `LocalContentColor`'s default black in light and dark themes,
  because the host provides no content colour; in dark mode it is close to invisible.
