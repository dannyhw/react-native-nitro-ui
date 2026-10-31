# F6 — Recycling and drop-path gates

**Branch:** `task/F6-recycling-gates` (from `main` at `1d97611`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `F6-586pg` (pair-a: `emulator-5574` / `49D5024D…19E9F` / Metro `8295`)

## Summary

**Android recycles, and X4's report said otherwise.** Its claim was that `prepareToRecycleView`
is a legacy hook whose only caller is `ViewManager.recycleView`. On RN 0.88 that is incomplete:
`onDropViewInstance` also prepares the view and pushes it onto a pool, and `createViewInstance
(tag, …)` pops it — guarded on `enableViewRecycling`, whose default is `false`, which is why
reading the graph in a flag-off app looked like proof. The example app now sets that flag and
`Recycling.harness.tsx` measures the result: the ring answers `dropped`+`recycled`, and a later
mount reports `recycles >= 1` from counters the reset deliberately does not clear.

Installing the flag was not a one-liner. `loadReactNative` calls `SoLoader.init`, and the flag
accessor's class loads `libreactnative.so` in a static initialiser, so an override installed
ahead of it crashes the launch; installed after, `override` throws, because `load` already
installed RN's provider and the C++ side takes one per process. The working shape is
`dangerouslyForceOverride` wrapping the RNOSS/Stable provider by delegation, after `loadReactNative`.

The recycle rule now has teeth on both platforms. SegmentedControl has `nuiTestDisplayedIndex()`,
written in the body rather than a prop setter, so its cell is a probe and its debt row is gone;
Picker's second owner now defaults to `2`, which makes its `didApplyDefault` line the only thing
that can pass the cell. Both were shown red on Android. Menu's hole **narrowed** to iOS alone (no
gesture reaches a SwiftUI `Menu`, and `expanded` answers `-1` there); Android's reset line is
guarded by a JVM test, so the cell is honest debt.

B1's two unasserted branches are counted in the shipping code and asserted at zero — the only
honest gate for a branch expected never to fire. That exposed a real bug in `38a1e93`: the two M2
counters were declared twice, an instance field shadowing the companion's "process-wide" total.
Screens-pop blanking is unreachable here — `react-native-screens` is not an example dependency —
so it is reported rather than fixed.

**The flag caught a product bug.** Recycling on made three DatePicker G5 tests red: a 131.05 dp
`compact` field laid out at its row's 411.43. `sizingPolicy` is host state that the `variant`
setter moves, and that setter compares against `model.variant` — which `prepareForRecycle()` has
already restored to `compact`. So the next mount saw "no change" and left the previous owner's
`fillWidth` in place, and the field was sized by its box. Android's DatePicker was the only host
missing the line (Picker, Progress and iOS's DatePicker had it). Fixed in product code with a
changeset, and owned by a new recycle test that asserts the pessimistic pair — widest field
against narrowest row across rounds — so one stretched field fails it.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1432 tests / 51 suites | `d9036d532516` | 2 m 40 s | start 3.7 / med 4.0 / max 5.4 |
| `harness:ios` | **PASS** | 227 tests / 16 suites | `d9036d532516` (ios tree) | 3 m 51 s | start 3.9 / med 3.8 / max 4.6 |
| `harness:android` | **PASS** | 277 tests / 16 suites | `d9036d532516` (android tree) | 8 m 04 s | start 5.7 / med 2.6 / max 5.8 |
| `real-input:ios` | stale | — | 228eff2a30f1 (not this tree) | 16 m 19 s | start 11.6 / med 11.6 / max 56.7 |
| `real-input:android` | stale | — | 228eff2a30f1 (not this tree) | 20 m 43 s | start 3.3 / med 2.5 / max 13.0 |
| `harness:android:Conformance` | stale | 2 failed of 40 tests / 1 suites | 49097b0d9fc5 (not this tree) | 1 m 28 s | start 3.1 / med 3.0 / max 3.8 |
| `harness:android:DatePicker` | stale | 3 failed of 14 tests / 1 suites | a982ed897a7d (not this tree) | 47.8 s | start 2.0 / med 2.2 / max 2.6 |
| `harness:android:MountChurn` | stale | 1 failed of 5 tests / 1 suites | 4e4de08b2e69 (not this tree) | 46.0 s | start 2.0 / med 2.3 / max 2.4 |
| `harness:android:Recycling` | stale | 1 failed of 5 tests / 1 suites | a982ed897a7d (not this tree) | 23.6 s | start 2.2 / med 2.3 / max 2.5 |
| `harness:android:Recycling:--background` | stale | — | a6bcccf687a4 (not this tree) | 0.7 s | start 8.2 / med 8.2 / max 8.2 |
| `harness:ios:Conformance` | stale | 2 failed of 40 tests / 1 suites | 4a5f0cc904d7 (not this tree) | 1 m 28 s | start 3.4 / med 3.2 / max 3.5 |
| `harness:ios:Recycling` | stale | 3 tests / 1 suites | f8b2d79d92b2 (not this tree) | 16.3 s | start 3.0 / med 3.7 / max 3.7 |

`need --for review`:

```
need: review against .gates/task/F6-recycling-gates.jsonl; code diff base 1d97611 touches ios + android
  ✓ check — green
  ✓ harness:ios — green on the ios code tree
  ✓ harness:android — green on the android code tree
  note: treated as both platforms (outside the known prefixes): example/__tests__/Conformance.harness.tsx,
        example/__tests__/Recycling.harness.tsx, scripts/conformance-core.mjs
need: review is satisfied on this code tree.
```

The two `real-input:*` rows are the merge-stage bar and were green on `228eff2a30f1`, one
docs/changeset commit back; the diff since is `android/` + `example/__tests__/`, so they are stale
rather than missing. The filtered rows are the red proofs above (a filtered run records under its
own name and satisfies nothing), plus `harness:android:Recycling:--background` from a mistyped
invocation, recorded in `## Follow-ups`.

## Red proofs

- `NitroUiLifetimeGateTest.aDroppedHostDeclinesUntilItIsRecycled` + `everyDeclinedAskIsCounted` ->
  delete `isDropped = false` from `onRecycle` -> both `FAILED` on the JVM.
- `NitroUiLifetimeGateTest.countersSurviveARecycleAndNameTheObject` + `anUnmountAndARecycleAreToldApartByThePair`
  -> reset `drops` on recycle -> both `FAILED`.
- `NitroUiLifetimeGateTest.aFreshHostMeasuresAndLaysOutNormally` + `everyDeclinedAskIsCounted` ->
  invert the counting guard in `declineMeasure` -> both `FAILED`.
- `Recycling › gives a later mount an instance the pool took back` -> delete `recycles += 1` ->
  `expected 0 to be greater than or equal to 1` (`harness:android:Recycling`, 31 Oct 10:06).
- `Recycling` (all three) -> remove the app's `enableViewRecycling` override -> red on the
  precondition: `AssertionError: expected false to be true` at the `expect(enabled).toBe(true)`
  in `beforeAll` — the flag check, not the recycling assertions, which is the order wanted.
- `Recycling › keeps the post-GC heap floor flat` -> retain a 64 KiB allocation per
  `prepareForRecycle` -> `expected 13.24 to be less than 2` (31 Oct 10:56).
- `Recycling › measures the drop-path branches … at zero` -> invert the non-zero filter ->
  `measuresAfterDrop, layoutsAfterDrop, giveUps, floatingFlushes are non-zero, so B1's
  unreachable drop-path branch is a live leak path: drops=8 recycles=8 measuresAfterDrop=0 …`
  (the mutation makes every field read as a leak, which is what proves the assertion reads them).
- `Conformance › · SegmentedControl` -> delete `didApplyDefault = false` from Android's
  `SegmentedControlModel.reset` -> `the segment the row paints reads 0 where the props say 1`
  (31 Oct 10:41). The same mutation in iOS's `prepareForRecycle` goes red on the same line
  (`harness:ios:Conformance`, 31 Oct 11:08), so the cell is proven on both platforms.
- `Conformance › · Picker` -> the same mutation in `PickerModel.reset` -> `choosing an option
  other than the second owner's default emits reads  where the props say conformance-picker:0`
  (Android 10:41, iOS 11:08 — both).
- `MenuModelTest.aRecycleClosesThePopupWithoutReportingToItsPreviousOwner` -> delete
  `expanded = false` from `MenuModel.reset` -> `AssertionError` at `MenuModelTest.kt:146`.
- `Recycling › hands the next mount a host with no sizing policy left behind` -> comment out
  `host.sizingPolicy = POLICY_INTRINSIC` in `HybridNitroUiDatePicker.prepareForRecycle` ->
  `a compact field was laid out at its row's width — widest field 411.43 against narrowest row
  411.43` (`harness:android:Recycling`, 31 Oct 12:33). The same mutation reds the three DatePicker
  G5 tests it came from: `testID "narrow" … never reached 131.05x48.00 - last box 411.43x48.00`,
  and likewise `key-date` and `mode-date` (`harness:android:DatePicker`, 12:32).
- `check` (`component-coverage` / `conformance`) -> leave `SegmentedControl`'s exemption row in
  place over its new probe -> `checkRecycleNotes` refuses it: "exempts `SegmentedControl` … that
  fixture has a residue probe".
- Two mutations found gates too weak, and are reported rather than papered over: `drop()` without
  `unarmCompositionStrategy()` stays green on **this** file's churn (200 hosts, pool-capped) while
  `MountChurn` goes red on it (`expected 7.92 to be less than 2`), and retaining the host itself
  stays green everywhere — the pool hands the same object back, so a per-host retain is invisible
  to a heap-floor slope. The B1 leak gate that catches the first is `MountChurn`, not this file.

## Files changed

- `example/android/app/src/main/java/nitroui/example/NitroUiFeatureFlags.kt`,
  `example/android/app/src/main/java/nitroui/example/MainApplication.kt`,
  `example/android/app/src/main/java/nitroui/example/NitroUiProbePackage.kt` —
  the flag, where RN can take it, plus a read-back so a refused override cannot pass silently.
- `example/__tests__/Recycling.harness.tsx` — new: pool marks, per-object identity, heap floor,
  drop-path counters, and the sizing-policy reset rule. New file so it does not collide with
  X15's edits to `Menu.harness.tsx`.
- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiLifetimeGate.kt` (+
  `android/src/test/java/com/margelo/nitro/nitroui/core/NitroUiLifetimeGateTest.kt`) and
  `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt` — the post-drop rule
  as a testable type; the shadowed process-wide counters fixed. Every host's `drop()` now routes
  through the gate, so the rule has one place to be enforced from.
- `cpp/core/NitroUiPerf.hpp`, `cpp/HybridNitroUiCore.cpp`,
  `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiPerf.kt`,
  `ios/core/NitroSwiftUIHost.swift`, `ios/components/Switch/HybridNitroUiSwitch.swift` — the
  `dropped`/`recycled` ring kinds on both platforms, and the per-object `drops=`/`recycles=`
  read-out on Switch.
- `ios/components/DatePicker/HybridNitroUiDatePicker.swift`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt` — the sizing
  policy reset on recycle (Android was missing the line iOS already had), which is what made
  three DatePicker G5 tests red.
- `ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSegmentedControl.kt` —
  `nuiTestDisplayedIndex`, and the body fix that made the iOS build compile again.
- `src/components/Switch/Switch.nitro.ts`, `src/components/Switch/NativeNitroUiSwitch.ts`,
  `src/components/Switch/Switch.tsx`, `src/components/SegmentedControl/SegmentedControl.nitro.ts`,
  `src/components/SegmentedControl/NativeNitroUiSegmentedControl.ts`,
  `src/components/SegmentedControl/SegmentedControl.tsx` and the nitrogen output under
  `nitrogen/generated/` — the two probes are spec methods, so the generated bindings move with
  them (`check`'s drift step is what says so).
- `example/__tests__/Conformance.harness.tsx`, `scripts/conformance-core.mjs`,
  `scripts/__tests__/conformance.test.js`, `scripts/__tests__/component-coverage.test.js` — two
  cells flipped to covered, one narrowed, the platform section rewritten to say what was measured.
- `android/src/test/java/com/margelo/nitro/nitroui/MenuModelTest.kt` — the Android half of Menu's
  popup reset, at JVM distance.
- `docs/tasks/FOLLOWUPS.md` — the B1 line closed, the four X4 recycle lines corrected.

## Follow-ups

- conformance: the coverage matrix has one state per cell, so Menu's recycle cell cannot be
  `failing` on iOS and `covered` on Android at once; a per-platform cell would retire the row.
- Recycling: `drop()` without `unarmCompositionStrategy()` stays green on this file's churn — the
  pool absorbs a per-host retain. Worth one comment in `MountChurn.harness.tsx` saying it is the
  gate that owns that mutation, since F6's is not.
- real-input: `react-native-screens` is not in the example app, so B1's screens-pop blanking has
  no reproducible shape here; a screen-stack screen would be the place to look for it.
- tooling: `gate.mjs harness:android:Recycling:--background` recorded one line from a mistyped
  invocation; argument parsing after `--` accepts a flag as a filter name.
- tooling (`scripts/__tests__/gate.test.js`, X-series — not touched here because X15 is editing
  gate and lease files): "refuses a device another live run holds" spawns the CLI on
  `process.env`, so an ambient `NITRO_UI_GATE_DEVICE_FORCE=1` makes it run anyway and the suite
  fails on `expect(run.status).toBe(1)`. It cost one `check` cycle here. Either strip the
  variable in `runCli`/`spawnCli` unless a case passes it explicitly, or have the test name it
  `undefined`; the first keeps any future case from inheriting the same hole.

## Questions for orchestrator

None.
