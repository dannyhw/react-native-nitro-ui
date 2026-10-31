# F6 — Recycling and drop-path gates

**Branch:** `task/F6-recycling-gates` (from `main` at `1d97611`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `F6-586pg` (pair-a: `emulator-5574` / `49D5024D…19E9F` / Metro `8295`)

## Summary

**Android recycles, and X4's report said otherwise.** Its claim was that `prepareToRecycleView`
is a legacy hook whose only caller is `ViewManager.recycleView`, so Fabric "calls
`onDropViewInstance` and nothing else". On RN 0.88 that is incomplete: `onDropViewInstance` also
prepares the view and pushes it onto a pool, and `createViewInstance(tag, …)` pops it — guarded
on `enableViewRecycling`, whose default is `false`, which is why reading the graph in a flag-off
app looked like proof. The example app now sets that flag and `Recycling.harness.tsx` measures
the result: the ring answers `dropped`+`recycled`, and a later mount reports `recycles >= 1` from
counters the reset deliberately does not clear — which a freshly allocated view cannot do.

Installing the flag was not a one-liner. `loadReactNative` is what calls `SoLoader.init`, and the
flag accessor's class loads `libreactnative.so` in a static initialiser, so an override installed
ahead of it crashes the launch; installed after, `override` throws, because `load` already
installed RN's provider and the C++ side takes one per process. The working shape is
`dangerouslyForceOverride` wrapping the RNOSS/Stable provider by delegation, after `loadReactNative`.

The recycle rule now has teeth on both platforms. SegmentedControl has `nuiTestDisplayedIndex()`,
written in the body rather than a prop setter, so its cell is a probe and its debt row is gone;
Picker's second owner now defaults to `2` — this file's own recipe — which makes its
`didApplyDefault` line the only thing that can pass the cell. Both were shown red on Android.
Menu's hole **narrowed** to iOS alone (no gesture reaches a SwiftUI `Menu`, and `expanded`
answers `-1` there); Android's reset line is guarded by a JVM test, so the cell is honest debt.

B1's two unasserted branches are counted in the shipping code and asserted at zero — the only
honest gate for a branch expected never to fire. Doing that exposed a real bug in `38a1e93`: the
two M2 counters were declared twice, an instance field shadowing the companion's "process-wide"
total. Screens-pop blanking is not reachable in anything this repo runs — `react-native-screens`
is not a dependency of the example app — so it is reported rather than fixed.

**And the flag caught a product bug.** Turning recycling on made three DatePicker G5 tests red:
a 131.05 dp `compact` field laid out at its row's 411.43. `sizingPolicy` is host state that the
`variant` setter moves, and that setter compares against `model.variant` — which
`prepareForRecycle()` has already restored to `compact`. So the next mount, wanting the default
variant, saw "no change" and left the previous owner's `fillWidth` in place; the next field was
then measured by the box instead of by its own text. Android's DatePicker was the only host
missing the reset (Picker, Progress and iOS's DatePicker all had it). Fixed in product code with
a changeset, and owned by a new recycle test that asserts the pessimistic pair — widest field
across rounds against narrowest row — so one stretched field fails it.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`:

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

## Questions for orchestrator

None.
