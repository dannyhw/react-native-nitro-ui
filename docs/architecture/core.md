# The core runtime

The design of a component (hosting, props, events, controlled values, recycling, threads) is
[DESIGN.md, section 3](../DESIGN.md#3-how-a-component-is-built). This file holds what that
section leaves out and a contributor working inside `src/core/`, `ios/core/`, `cpp/` or the
Android `core` package needs: internal invariants, the order of operations, test idioms and
build traps. Sizing internals are in [sizing.md](sizing.md).

In paths below, `android/…/nitroui/` is `android/src/main/java/com/margelo/nitro/nitroui/`.

## 1. Layout

| Layer   | Files                                                                                                   | Holds                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| JS      | `src/core/` (`useStableCallback`, `useControlled`, `useProcessedColor`, `useSizingId`, `useSelfSizing`) | the hooks every wrapper uses                                                                |
| JS      | `src/NitroUiCore.nitro.ts`, `src/NitroUiCore.ts`                                                        | the `NitroUiCore` Hybrid Object: clock, perf marks, sizing diagnostics, `prewarm`           |
| iOS     | `ios/core/NitroSwiftUIHost.swift`, `NitroUIContent.swift`, `NitroUiModel.swift`                         | the host, the content protocol, the model base class and `NitroUiControlledValue`           |
| iOS     | `ios/core/NitroUiDeclaredFallbacks.swift`, `NitroUiDeclaredFallbacksLoader.m`                           | the startup table of declared sizes                                                         |
| iOS     | `ios/core/NitroUiPresentation.swift`, `NitroUiPresenterChain.swift`                                     | presenting from a window of the library's own, and choosing where to present from           |
| iOS     | `ios/core/NitroUiMainThread.swift`, `UIColor+NitroUiColor.swift`                                        | `nitroUiAssertMainThread`, the colour decode                                                |
| Android | `android/…/nitroui/core/NitroComposeHost.kt`                                                            | the host, `NitroUiTheme`, `NitroUiColorSchemes`, `NitroUiMeasuredRoot`                      |
| Android | `android/…/nitroui/core/NitroUiModel.kt`, `NitroUiLifetimeGate.kt`                                      | the model base class and `NitroUiControlledValue`; the "dropped host must not compose" rule |
| Android | `android/…/nitroui/core/NitroUiSizing.kt`, `NitroUiPerf.kt`, `NitroUiDeclaredFallbacks.kt`              | JNI doors into the sizing engine and the perf ring; the startup table of declared sizes     |
| Android | `android/…/nitroui/core/NitroUiHost.kt`, `NitroUiMaterialTheme.kt`                                      | the `Host` view; the process-wide theme setting                                             |
| C++     | `cpp/NitroUiSizingEngine.{hpp,cpp}`, `cpp/NitroUiIntrinsic.hpp`                                         | the sizing engine; the shadow node, state and descriptor templates                          |
| C++     | `cpp/core/NitroUiClock.hpp`, `cpp/core/NitroUiPerf.hpp`, `cpp/core/NitroUiSizing.hpp`                   | the clock, the perf ring and the sizing door, as headers Swift can parse                    |
| C++     | `cpp/HybridNitroUiCore.{hpp,cpp}`, `cpp/NitroUiPropsCompat.hpp`, `cpp/NitroUiScrollShadow.hpp`          | the `NitroUiCore` implementation; the `ViewProps` helper; `Form`'s shadow node              |

`cpp/core/*.hpp` are the podspec's `public_header_files`, so Swift's C++ interop parses them:
they take plain integers and include no React Native header. `cpp/NitroUiSizingEngine.hpp`
type-erases the Fabric `State` as `std::shared_ptr<const void>` for the same reason, and so that
the engine compiles on the host for `bun run test:native`.

## 2. One instance, one host

`grep -n "rootView ="` in `ios/` and `grep -n "setContent"` in `android/src/main` find no code
outside comments: the root view is passed to the hosting controller's initializer and never
reassigned, and the Compose view's content is fixed. No props update re-creates a host, its
controller, its composition or its `Recomposer`.

iOS (`ios/core/NitroSwiftUIHost.swift`):

- The hosted view is framed to the host's bounds in `layoutSubviews`, not constrained with Auto
  Layout. Both the host and the hosted view have a clear background.
- The safe area is disclaimed twice: `safeAreaRegions = []` on iOS 16.4 and later, and in
  `NitroUiRoot` (`ios/core/NitroUIContent.swift`) before that.
- With `needsContainment`, `didMoveToWindow` adds the hosting controller as a child of the
  nearest view controller in the responder chain, skipping `UINavigationController` and
  `UITabBarController`, and removes it when the view leaves the window.

Android (`android/…/nitroui/core/NitroComposeHost.kt`):

- React Native is the only thing that measures the host (`SurfaceMountingManager.updateLayout`
  calls `measure` with exact specs once per layout update), and `requestLayout()` reaches
  nobody, because the parent `ReactViewGroup` does nothing in `onMeasure`.
- `onMeasure` declines (measures 0 by 0 and sets `isMeasurePending`) while the host has no
  window, while it is the direct child of a `Host`, and after `drop()` until the next attach
  (`NitroUiLifetimeGate`). `onLayout` and the Compose child's `onAttachedToWindow` run the
  pending measure at the first moment there is both a window and a frame, in the same UI-thread
  turn, with no posted retry.
- `onAttachedToWindow` arms the composition strategy, then sets the view-tree
  `LifecycleOwner` and `SavedStateRegistryOwner` only where the tree has none, each one
  separately, and only then calls `super`, which is what dispatches the attach that creates the
  composition. The activity is cast to `LifecycleOwner` at runtime; without one the strategy is
  not armed.

## 3. Props: store, mark, commit once

```
Fabric updateProps / updateState
  └─ beforeUpdate()
       setter per changed prop → write the model, host.markDirty()
     afterUpdate()             → reconcile the controlled value, host.commit()
```

- A getter answers what the model holds. Where `afterUpdate()` normalises a value against other
  props (`Slider` clamps and quantises `value` against the range and `step`), the getter
  answers the normalised value, not the number React sent.
- The model object is never replaced or rebuilt.
- On Android every new view receives `updateState` twice, so `propsApplied` is 2.00 per
  instance on a mount ([upstream.md](../upstream.md), entry N5).

### Colours

A colour travels as `number | null`. `processColor` is unsigned on iOS and signed on Android:
opaque `#FF5733` arrives as `4292877107` on iOS and `-110652` on Android. A decode that
range-checks (`Int32(exactly:)`, or Kotlin `Double.toInt()`, which saturates) drops or corrupts
every opaque colour of the other sign, with no error.

- iOS: `ios/core/UIColor+NitroUiColor.swift` accepts both halves and truncates with
  `UInt32(truncatingIfNeeded:)`.
- Android: `raw.toLong().toInt()` in each Hybrid View that takes a colour.
- Each platform's getter returns what its own `processColor` produces, so JS can compare the
  value it sent with the value it reads back.
- A colour with no integer form (an iOS dynamic colour) becomes `null` in JS, with a development
  warning (`src/core/useProcessedColor.ts`). Native does not try to resolve it.

### Shared objects

A hosted control is its own composition, so anything built in a composable, or `remember`ed in
one host, is built once per mounted control, on the UI thread, during mount.

- `NitroUiColorSchemes.forContext` (`NitroComposeHost.kt`) keeps one `ColorScheme` for the
  process, keyed on the context, the dark flag and `uiMode`. The context half of the key is a
  `WeakKey`, because the cache outlives every activity. `onConfigurationChanged` calls
  `NitroUiColorSchemes.invalidate()`.
- Material's `…Defaults.colors(...)` factories allocate a new object per call. A tinted control
  caches the result on the scheme's identity and the tint (`SwitchColorsCache` in
  `android/…/nitroui/HybridNitroUiSwitch.kt`). That cache hits only because the scheme is shared.

Objects derived from the theme, a colour or a defaults factory go in a process-wide keyed cache
or are hoisted out of the composable. `remember` is for state that belongs to one control.

## 4. Controlled values

- Switching a mounted control from uncontrolled to controlled is supported, with a development
  warning. `useControlled` (`src/core/useControlled.ts`) records every native event count in
  both modes and seeds `mostRecentEventCount` on the switch; without that, every later `value`
  write looks stale until the next interaction.
- `useControlled` always passes native a change callback, with or without a handler from the
  app, because the echo depends on it.
- The harness has no query for a control's accessibility value, so a rejected change is tested
  with two taps: after a change the app refused, the next tap must report the pre-tap value
  again (`example/__tests__/Switch.harness.tsx`).

## 5. Threading and `hybridRef`

- The size `measureContent()` answers from JS is a cache written on the main thread: a
  `CGSize?` behind an `NSLock` on iOS, an immutable `NitroUiDpSize` behind `@Volatile` on
  Android.
- A prop written through `hybridRef` runs the setter on the JS thread against model state the
  UI thread owns, and Nitro calls no `afterUpdate()` for it, so nothing renders. The typed
  handle (`src/components/Switch/NativeNitroUiSwitch.ts`) is read-only for that reason.
- An imperative method writes on the main thread and commits there: on iOS
  `DispatchQueue.main.async { write; host.markDirty(); host.commit() }` (`TextField`'s `focus()`
  in `ios/components/TextField/HybridNitroUiTextField.swift` hops the same way), on Android
  `host.post { … }`. `host.applyModelWrites()` sends the snapshot apply notification for a model
  write made outside a Compose event handler, so it paints when a press would.
- `hybridRef` is a callback prop, so native calls it once, when the view mounts. A new closure
  later changes only what `useStableCallback`'s ref points at and is not called.

## 6. Recycling and drop

### Android: the order of a drop

A view is reused only when the Hybrid View implements `RecyclableView` (the generated manager
then calls `setupViewRecycling()`) and the app turns on
`ReactNativeFeatureFlags.enableViewRecycling()`, which is `false` by default in React Native
0.88. With the flag off, `ViewManager` allocates no pool and every `onDropViewInstance` is an
unmount.

With both on, the order is fixed by React Native and the generated manager
(`nitrogen/generated/android/kotlin/com/margelo/nitro/nitroui/views/HybridNitroUiSwitchManager.kt`):

1. `onDropViewInstance` calls `hybridView.onDropView()`, which calls `host.drop()`.
2. `super.onDropViewInstance(view)` calls `prepareToRecycleView`, which calls
   `hybridView.prepareForRecycle()`.

`drop()` disposes the composition, so a composition never survives a recycle; the next attach
measures and builds a new one from the reset model. Recycling keeps the `View`, the Hybrid
Object, the host and the model. It does not keep the composition, anything `remember`ed in it,
or an animation in flight.

`NitroComposeHost.drop()`, in order: marks `dropped`, `disposeComposition()`, uninstalls the
composition strategy, removes both pre-draw listeners, clears the cached size and the over-wide
placement, and calls `NitroUiSizing.forget(id)`. `prepareForRecycle()` marks `recycled`, calls
`model.reset()`, and re-arms the per-mount flags (dirty, pending measure, first frame). It arms
no strategy: React Native's pool is unbounded and is emptied without telling the views in it
(`ViewManager.trimMemory`, `onSurfaceStopped`), so anything registered at pool entry may never
be undone. `onAttachedToWindow` arms the strategy for the mount that follows.

### Android: registrations that `drop()` must undo

`DisposeOnLifecycleDestroyed` is the strategy the host uses, because the default strategy and
`DisposeOnDetachedFromWindowOrReleasedFromPool` dispose on detach, and React Native detaches a
mounted view during a screen transition, under `removeClippedSubviews` and for the pool.

A strategy is a registration. `AbstractComposeView.setViewCompositionStrategy` installs a
`LifecycleEventObserver` on the owner's `LifecycleRegistry`, which holds observers strongly.
The only code that removes it is the uninstaller that runs when the next strategy is installed;
`disposeComposition()`, a detach and a drop do not (Compose UI 1.12.1). A strategy left
installed after a drop retains the `ComposeView` through the activity for the life of the
activity: 3 `View`s and about 42 KiB per mounted control.

- `unarmCompositionStrategy()` installs `DisposeWithTheHost`, a strategy that observes nothing,
  after `disposeComposition()`: the setter wants no composition in flight.
- A hosted child arms no strategy; its `Host` arms one for the shared composition.
- The two pre-draw listeners (first frame, and the sizing flush) are registered while the host
  is attached, so they sit on the window's `ViewTreeObserver`. A detached view's
  `viewTreeObserver` is a new floating object, so removing a listener through it removes
  nothing. `PreDrawWatch` keeps the observer each listener was registered on, and `drop()`
  removes the listener from that one.

`lifetimeReport()` and `armedGuardsReport()` expose the counters the harness reads to prove
these paths (`drops`, `recycles`, measures and layouts after a drop, and which guards a mount
armed and still holds).

### iOS

The generated component view (`nitrogen/generated/ios/c++/views/HybridNitroUiSwitchComponent.mm`)
calls `onDropView()` from both `prepareForRecycle` and `invalidate`, guarded by `_didDropView`,
so it runs once per mount. React Native's `RCTComponentViewRegistry` calls `prepareForRecycle`
when it pools the view and `invalidate` when the class is not recyclable or the pool is full.
`+shouldBeRecycled` answers whether the Hybrid View implements `RecyclableView`.

`NitroSwiftUIHost.drop()` detaches containment, clears the cached size and calls
`NitroUiSizing.forget(id)`. It does not destroy the hosting controller. `prepareForRecycle()`
re-arms the dirty flag, animation suppression, first-frame marking and the size measure. The
component's own `prepareForRecycle()` resets the model fields.

### Both platforms

- Everything a setter writes appears in the reset. A `testID`, label or tint left over from the
  previous row is a bug.
- Every per-mount flag is re-armed: animation suppression, first frame, cached content size.
- `onDropView()` runs before the reset and is also the unmount path. It releases callbacks
  first, and it does not destroy the host.

## 7. Sizing hooks in the hosts

The engine is described in [sizing.md](sizing.md). This section is when a host measures.

iOS (`ios/core/NitroSwiftUIHost.swift`):

- `wantsContentSize` is off by default. With it on, `refreshContentSize()` measures only when
  `contentSizeNeedsMeasure` is set: by the first commit, a bounds change, a change of content
  size category or legibility weight, a recycle, `invalidateContentSize()`, or a commit after
  `noteContentSizeMayHaveChanged()`. An ordinary commit costs three boolean checks.
- `commit()` sends `objectWillChange`, which only invalidates SwiftUI. `measureFittingSize()`
  therefore calls `layoutIfNeeded()` on the hosted view before `sizeThatFits`, so the number
  describes the new content. While the host has no window that layout is impossible, so the
  measure stays pending until `didMoveToWindow`.
- A report is skipped when it is within 0.5 pt of the last size this host reported. A setter
  for `nuiSizingKey` calls `host.noteSizingKeyChanged()`, which clears that memory at the next
  layout carrying a new box, so a new configuration that measures the same size is still
  reported.
- `holdSizingReports()` and `releaseSizingReports(heldSizeBelongsToBatch:)` bracket the time
  between a pick the `Picker` paints itself and the props batch that re-keys it. A size measured
  meanwhile is kept, not reported, and filed at the release only when the batch keys what it
  measured; recycle and drop clear it.

Android (`NitroUiMeasuredRoot` in `NitroComposeHost.kt`):

- A `Measurable` may be measured once per pass (`MeasurePassDelegate` throws otherwise), and
  the incoming constraints are exact, so the root asks one question chosen by the policy and
  returns Yoga's box, with the content centred in it.
- Policy `intrinsic` asks `Constraints()`, with no minimum and no maximum. `intrinsic` content
  must therefore tolerate infinite constraints: a `verticalScroll` or `LazyColumn` throws, so a
  control that scrolls is `fillWidth` or bounds its own scroll axis.
- Policy `fillWidth` asks
  `constraints.copy(minWidth = 0, minHeight = 0, maxHeight = Constraints.Infinity)`: the box's
  width, any height.
- Material's 48 dp minimum touch target is part of the recorded size.
- When the unbounded answer is wider than the box, the measure block arms
  `NitroUiOverWidePlacement` and bumps `remeasureToken`. The next pass measures at the box's
  width with unbounded height and places that, so Material truncates a long label. The
  placement pass reports nothing; the reported size stays the unbounded answer.
- The arming is valid for one content at one box. It records the box width (`armedWidthPx`) and
  the `contentRevision` the composition rendered (`armedRevision`). A pass under another width,
  or against another revision, asks the unbounded question again. A pass that cannot name its
  content stamps `NO_REVISION`, and such an arming is never placed: a props batch measures the
  host before its own recomposition, so that pass measured content about to be replaced.
- The measured root reads `armed`, and reads `contentRevision` only while armed. A control that
  fits its box pays one snapshot write in `markDirty()` and no recomposition of the root.
- After a prop change, an over-wide control draws its unbounded, clipped content for one
  traversal before the placement pass redraws it, and for two on a host that was not armed
  before.
- `holdSizingReports()` and `releaseSizingReports(heldSizeBelongsToBatch)` bracket the time
  between a choice the control paints itself and the props batch that re-keys it (`Picker`,
  `Menu`, `Chip`), so a size is never filed under a key that names other content.

## 8. Perf marks

`cpp/core/NitroUiPerf.hpp` is a ring shared by C++, Swift and Kotlin (through JNI). A host whose
view has `nuiPerfId >= 0` records `propsApplied`, `firstFrame`, `dropped` and `recycled`.
`nitroUiCore.setPerfEnabled(true)` clears the ring and starts recording, and
`nitroUiCore.drainPerf()` takes everything. Times are milliseconds on the clock of
`cpp/core/NitroUiClock.hpp` (`CLOCK_UPTIME_RAW` on Apple, `CLOCK_MONOTONIC` on Android), the
base of `CADisplayLink` and `Choreographer` timestamps.

- `propsApplied` marks every `commit()`, before the dirty check, on both platforms. It counts
  `updateState` calls, not visible updates.
- `firstFrame` on iOS is the first layout with non-empty bounds while in a window. On Android it
  is the first pre-draw after attach with no sizing report pending, from a listener that then
  removes itself. Neither is a frame completed by the GPU.
- `dropped` is marked in `drop()` and `recycled` in `prepareForRecycle()`. A `dropped` with no
  `recycled` after it is an unmount.
- `drainPerf()` empties the ring, so a test that polls accumulates what it reads.
- Cost: a view without `nuiPerfId` pays one integer compare per mark site. A marked view with
  recording off pays one relaxed atomic load. With recording on, a mark takes a mutex.

## 9. Test idioms

- The handshake has three implementations with one set of vectors:
  `src/__tests__/useControlled.test.tsx` (`bun run test`),
  `scripts/native-tests/handshake.test.swift` (`bun run test:native`, host `swiftc`, no
  simulator) and
  `android/src/test/java/com/margelo/nitro/nitroui/core/NitroUiControlledValueTest.kt`
  (`bun run test:native:android`). A change to one changes all three and the vectors.
- Use real taps (`userEvent.press`) in harness tests, not prop writes.
- Wait for a testID with `waitForTestId` before taking the harness reference
  ([upstream.md](../upstream.md), entry H3), and read a laid-out box from the `HarnessUI`
  module's `queryByTestId` (entry H4).
- Assert that nothing happened with a barrier. Render a second, enabled control, press both,
  wait for the barrier's event, then assert that the first control's event list is empty
  (`example/__tests__/Switch.harness.tsx`). An empty list checked straight after a press also
  passes for an event still in flight.
- Recycling is tested on device, because iOS keeps the SwiftUI state and Android rebuilds the
  composition: `example/__tests__/Recycling.harness.tsx` proves a view goes through the pool and
  comes back, and the recycle rule in `example/__tests__/Conformance.harness.tsx` asserts every
  manifest's reset against the props of the second mount.

## 10. Traps

- A callback declared `fn | null` fails at mount with
  `Cannot convert "[object Object]" to any type in variant<...>`, and the view never appears in
  any query ([upstream.md](../upstream.md), entry N3).
- Swift types in this pod are `internal`, not `public`. A public type lands in `NitroUi-Swift.h`,
  whose C++ thunks do not import `Combine`, so an `ObservableObject` fails to compile there.
  Nitrogen's generated Swift is in the same module, so `internal` is enough.
- `AbstractComposeView.onMeasure` and `onLayout` are `final`. A detached `ComposeView` that is
  measured throws `Cannot locate windowRecomposer; View … is not attached to a window` inside
  the mount batch, and React Native measures a `Modal`'s tree before `Dialog.show()` gives it a
  window. That is why the host is a `FrameLayout` around the Compose view, and why a first-frame
  hook is a pre-draw listener.
- React Native's Android autolinker finds the package class by matching source text. Keep
  comments above a Kotlin Hybrid View or package free of text that reads like a package or class
  declaration. If `react-native config` output is stale, regenerate
  `example/android/build/generated/autolinking/autolinking.json`.
- Setting `testID` on the hosted content as well as the container makes `findAllByTestId`
  return two elements.
- The harness does not build the app. JS comes from Metro and native code does not, so rebuild
  and reinstall after a native change (`node scripts/build-app.mjs --platform <p>`).

## 11. Continuous controls

`Slider` is the reference (`ios/components/Slider/HybridNitroUiSlider.swift`,
`android/…/nitroui/HybridNitroUiSlider.kt`).

- Coalesce touch samples to the newest value on a real frame source: a `CADisplayLink` for the
  length of the drag on iOS, a `Choreographer` frame callback on Android. A timer is unrelated
  to the display and emits twice in one frame or skips one.
- Call `NitroUiControlledValue.user(value)` once per emitted event, not per sample. It
  increments `nativeEvents`, and its return value is the event count to emit. Between a sample
  and the frame that emits it, the value sits in `unreported`.
- `onValueChange` fires during the drag and `onSlidingComplete` at release with the final value
  and the final count. JS does not infer the end of a drag from a timeout.
- On iOS, `Binding.get` returns the in-drag value. SwiftUI re-reads it on every invalidation;
  returning the props value there draws the previous emitted value and the thumb trails the
  finger by a frame.
- A drag start is idempotent (`beginDrag()` returns when already dragging) and is called from
  both `onEditingChanged(true)` and the first `Binding` write, which have no defined order. On
  Compose the first value change starts the drag; Material 3's `onValueChangeFinished` ends it.
- An interaction re-renders itself, because no props arrive during a drag. On iOS the model
  sends `objectWillChange` on the frame tick with the emit, not in the `Binding` setter and not
  through `host.markDirty()`/`host.commit()`, which is the props path and adds a perf mark. On
  Android the interaction writes snapshot state and stops; Compose's global snapshot applies it
  on the next frame, and `Snapshot.sendApplyNotifications()` stays in `commit()`.
- Emit the JS event after the local write.
- Quantise in native before emitting, then compare exactly. Material 3's `Slider` is
  `Float`-based, so `0.1` comes back as `0.10000000149011612`; the emitted value is rounded to
  15 significant digits on both platforms (`ios/components/Slider/NitroUiSliderValue.swift`,
  `android/…/nitroui/NitroUiSliderValue.kt`, with shared vectors in
  `scripts/native-tests/slider-value.test.swift`).
- On Android, read the fast-changing value in the smallest composable that needs it. On iOS one
  `objectWillChange` re-evaluates the whole hosted body, so keep the body small.
- `prepareForRecycle()` clears in-flight drag state.
- A `value` written by the app while the finger is down, with JS caught up and no sample in
  flight, is accepted and moves the thumb under the finger. A component that must not allow it
  gates its own writes between drag start and drag end.

## 12. Components without a value

A component with nothing the user edits (`Progress`) has no `NitroUiControlledValue` in its
model, no `mostRecentEventCount` prop and no change callback; its `afterUpdate()` is
`host.commit()` alone (`ios/components/Progress/HybridNitroUiProgress.swift`). It still
implements `RecyclableView` with a full reset, and `onDropView()` still calls `host.drop()`.
The host disables animation on the first commit and on the first commit after a recycle, so a
props write that starts an animation does not animate from the previous row's value.

## 13. The Android baseline profile

`android/src/main/baseline-prof.txt` holds ART rules for the library's own classes. The Android
Gradle plugin merges it into the app's `assets/dexopt/baseline.prof`. A consumer adds nothing:
`androidx.profileinstaller` is a runtime dependency of Compose, which the library already
requires.

Installing an app does not compile it from the profile. On an API 35 emulator:

| Step                                                               | `dumpsys package dexopt` |
| ------------------------------------------------------------------ | ------------------------ |
| `adb install -r`                                                   | `status=verify`          |
| `cmd package bg-dexopt-job` (job finished)                         | `status=verify`          |
| `cmd package compile -m speed-profile -f`, before any launch       | `status=verify`          |
| start the app once, then `cmd package compile -m speed-profile -f` | `status=speed-profile`   |

The compiler reads the app's profile file, which profileinstaller writes a few seconds after
process start, so `-m speed-profile` before the first launch falls back to `verify` without an
error. `scripts/bench/run.mjs` primes through profileinstaller's `INSTALL_PROFILE` broadcast,
compiles, and reads the status back; a baseline is recorded only at `speed-profile`.
