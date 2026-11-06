# G19 — `androidIcon` on Button, and the xlarge/xxlarge rungs

**Branch:** `task/G19-android-icon-iconbutton` (from `main` at `9626bbe7`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none obtained — see Questions

## Summary

**Shipped:** `Button`'s `androidIcon` prop, the icon resolver behind it, and the
`xlarge`/`xxlarge` rungs. **Not shipped this round:** IconButton, and the Expo
config plugin. The reason for both is at the end — one is a scope decision I made
under a hard blocker, the other is the blocker itself.

`androidIcon: string` names a drawable the app ships; iOS ignores it and draws
`systemImage`, so a Button that wants a glyph on both platforms writes both names
and needs no `Platform.select`. Android resolves it through React Native's own
`ResourceDrawableIdHelper`, so the lookup behaves exactly like `Image`'s rather
than being a second `getIdentifier` call with its own variant rules
(`android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt`).

Two decisions worth reading before the diff:

**A name that cannot resolve is treated as no icon, not as a smaller icon.** No
slot is reserved and no content padding changes, so the control is exactly its
no-icon self — the contract iOS already keeps for an SF Symbol name that does not
exist. The alternative reserves a gap for artwork that never arrives, which reads
as a layout bug rather than a missing file. The reason a developer *can* tell the
two apart is that the name is checked in two places: `NitroUiIconNames` logs once
per name in `adb logcat -s NitroUi`, and `src/iconName.ts` warns in development
about a string that could never be a resource name (`Share Icon`, `24px`, `""`) —
which native's answer cannot distinguish from a file that was not shipped, because
both are `0`.

**The icon is loaded in the prop setter, behind a name-change guard, not in
composition.** Q9 C1 asked for `afterUpdate()`; the Android host has no such hook,
and doing it in composition would call React Native's `synchronized` id helper on
*every* recomposition of every Button for the life of the view. Guarded on the
name, a re-sent name costs nothing and a changed name pays once, on the thread
already applying props. The bitmap is cached per resource id for the process,
because a hosted control is its own composition and `remember` cannot share the
rasterising between instances.

`xlarge`/`xxlarge` are Material's own `LargeContainerHeight` (96 dp) and
`ExtraLargeContainerHeight` (136 dp), so the ladder now has the five rungs the
tokens publish. iOS draws four button sizes against five rungs, so the top two are
both `.extraLarge` (`.large` before iOS 17) — stated in the docs rather than
papered over.

**The blocker:** this machine caps at two concurrent device leases and E3 and X20
held both for the whole round. `lease.mjs acquire` refused every attempt, so
`harness:*` and `real-input:*` could not run at all. I did not claim a device with
`NITRO_UI_GATE_DEVICE_FORCE`. IconButton needs harness and real-input coverage for
every rule in its test plan, and shipping it ungated would be exactly the
"component as prose" failure D4 exists to stop — so I spent the round making the
half that *can* be proven on the JVM and in Jest as solid as I could instead of
adding a large unproven surface.

## Gates

ledger: git tree 93b526eec89a (what reuse compares), worktree DIRTY - nothing here is reusable
| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | stale | 3 failed of 1774 tests / 70 suites | 8c964dcaa8de (not this tree) | 2 m 38 s | start 6.5 / med 13.2 / max 16.6 |
| `harness:ios` | **FAIL** | — | `4d5fa9e63f96` (ios tree) | 1.4 s | start 42.1 / med 42.1 / max 42.1 |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

pending: this round's `check` is running against HEAD as I write this.

## Red proofs

Each mutation was applied, the suite run, and the file reverted. JVM ones via
`:react-native-nitro-ui:testDebugUnitTest`, JS ones via `jest src/__tests__/iconName.test.tsx`.

- `theTwoNewRungsAreMaterialsLargeAndExtraLargeContainerHeights` -> `XLarge -> ButtonDefaults.MediumContainerHeight` -> `expected:<56.0> but was:<96.0>` (and `everyRungIsTallerThanTheOneBelowIt` went red with it)
- `aNameIsNormalisedTheWayAFileHasToBeRenamedToBuild` -> drop the `-`/`.` → `_` replacement -> `expected:<share_24px> but was:<share-24px>`
- `aNameThatCannotBeAResourceNameIsSaidSo` -> `isValid` returns true for any non-empty name -> `leading digit` assertion failed
- `aBadNameIsReportedOnceHoweverManyTimesItIsSent` -> `shouldWarn = true` -> `Wanted <false> to be equal` on the second call
- `theStoreStopsGrowingAtItsBoundAndDropsTheLeastRecentlyUsedFirst` -> `LinkedHashMap(16, 0.75f, false)` (insertion order, not access order) -> `a was read, so it stayed: expected:<a> but was:<null>`
- `aRecycledModelForgetsTheCornerAndEverythingElseSentWithIt` -> delete `androidIcon = null` from `ButtonModel.reset()` -> `expected:<null> but was:<share>`
- `is part of the size configuration` -> delete `escapeField(androidIcon ?? '')` from the key -> the two Buttons' keys became equal
- `sends the normalised name, not the one that was typed` -> send `androidIcon ?? null` raw -> `expected:<share_24px> but was:<Share-24px>`
- `escapes a pipe in the drawable name, spelled out` -> drop `escapeField` on `androidIcon` -> key `filled|medium||a|b|c` instead of `...||a\|b|c`
- `warns in development about a name the app can never ship` -> delete the `warnAndroidIconName` call -> `Wanted 1 time but was 0`

**Two of these were second attempts.** My first version of the escape test was
written as a collision check ("these two keys differ"); it stayed green with the
escape deleted, because forging a field boundary needs *two* unescaped fields and
`title` is escaped on its own. My first warning test called the helper directly,
which stays green when `Button` stops calling it. Both were rewritten to pin the
behaviour literally, then re-proved. I am recording this because a green test that
a mutation walked through is worse than no test, and the only reason I found them
is that I ran the mutations before trusting the tests.

**Not proven:** nothing in this round is proven on a device. The glyph actually
drawing, the tint following `LocalContentColor`, the icon plus gap being the width
delta, and the 48 dp target at the new rungs are all unverified claims. See
Questions.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt` — name rules, once-per-name warning, the LRU store, drawable → bitmap, and the glyph composable
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt` — `androidIcon` on the model and the one renderer, the leading slot, `contentPaddingFor(hasStartIcon)`, and the two new rungs
- `ios/components/Button/HybridNitroUiButton.swift` — `androidIcon` accepted and not drawn; `xlarge`/`xxlarge` → `.extraLarge`/`.large`
- `src/iconName.ts` — the JS half of the name rules and the development warning
- `src/components/Button/{Button,Button.nitro,NativeNitroUiButton,NitroUiButtonConfig}.ts` — the prop, its doc, and its sizing-key field
- `src/__tests__/iconName.test.tsx`, `src/__tests__/buttonSizingKey.test.tsx`, `android/src/test/.../NitroUiIconTest.kt`, `.../ButtonModelTest.kt` — tests
- `docs/components/button.md`, `.changeset/g19-android-icon.md` — the Android-icons section, the ladder, the API table

## Follow-ups

- `nitrogen/generated/**` regenerated for one new Button prop; `bun run regen` is the only way to reproduce it, and it is committed so `nitrogen:check` stays green.
- `bun install` in this worktree completed only on the second attempt; the first left 3 packages and no `node_modules/.bin`, and `check` failed on 35 unformatted files of an untouched `main` as a result. Worth knowing before blaming a red `format` step on a diff.
- `Button`'s iOS column in the measured-size table has no `xlarge`/`xxlarge` rows; nor does Android's. Both need the device run, not a guess.
- Q9 C2 item 3 (`androidIcon` on Menu/ContextMenu rows, SplitButton, Chip) is untouched, as the brief said.
- `test:native:android` skips itself when `CI` is set unless `NITRO_UI_ANDROID_JVM_TESTS=1`, which is correct and documented — but it means a green `check` row on a hosted job says nothing about the Kotlin tests, and only the `build-android` job proves them.
