# Intrinsic sizing

How a control reports its size to Yoga is designed in
[DESIGN.md, section 3.6](../DESIGN.md#36-intrinsic-sizing): the lookup order, the configuration
key, the declared fallback, the two policies and `prewarm`. This file holds what a contributor
working inside the engine or the host integration needs beyond it. When a host measures is in
[core.md, section 7](core.md#7-sizing-hooks-in-the-hosts).

In paths below, `android/…/nitroui/` is `android/src/main/java/com/margelo/nitro/nitroui/`.

## 1. The one rule

`measure` runs on the layout thread under Fabric's commit lock. Every engine entry point is one
lock and hash-map reads or writes. None calls SwiftUI, Compose or the JS runtime, and none pushes
Fabric state while holding the lock.

## 2. The pieces

| Piece                                                   | Lives in                             | Does                                                                                       |
| ------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `IntrinsicShadowNode`, `IntrinsicViewState`, descriptor | `cpp/NitroUiIntrinsic.hpp`           | answers `measureContent` from the engine and applies the policy and the layout constraints |
| `NitroUiSizingEngine`                                   | `cpp/NitroUiSizingEngine.{hpp,cpp}`  | cache, ledger, registry, flush, counters and trace                                         |
| `NitroUiSizing`                                         | `cpp/core/NitroUiSizing.hpp` + hosts | the hosts' door: `report`, `flush`, `forget`, `setFallback`, environment                   |

The engine is one process-wide object that is never destroyed: a layout thread or the run-loop
observer can still call in at process exit. Its state, all behind one `std::shared_mutex`:

| Member                             | Maps                                                  | Rules                                                                                                                |
| ---------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `cache_`                           | configuration key → size, with a `provisional` flag   | cleared by an environment bump; a provisional entry (from `prewarm` or `seedSize`) answers layout but is not exact   |
| `fallbacks_`                       | component → declared size                             | written only by `setFallback` and `seedSize`, never by a measurement                                                 |
| `guesses_`                         | (component, sizing key) → last measured size          | survives an environment bump; read only on a cache miss; dropped for a component that declares again                 |
| `ledger_`                          | instance id → what it was laid out with               | a row is created only by `measure`; holds the key, `exact`, `laidOut`, the configuration strings and `answerChanged` |
| `registry_`                        | instance id → push function and weak Fabric `State`   | written by `registerInstance` when the platform binds the state; `owesFreshMeasure` lives here                       |
| `needsCorrection_`                 | configuration key → instance ids laid out inexactly   | what a flush walks to correct every instance of a configuration                                                      |
| `pending_`                         | reports waiting for the next flush                    | the last report of a turn wins per instance                                                                          |
| `forgotten_`                       | a 512-slot ring of finished ids                       | a layout that arrives for a finished id is held, not filed                                                           |
| `lateFilings_`, `lateFilingQueue_` | finished id → the ledger entry a late layout produced | claimed only by `registerInstance`; dropped after `kLateFilingGraceNs` (1 s) or at `kLateFilingCapacity` (2,048)     |
| `waitingForBind_`, `unboundQueue_` | ids whose ledger row was filed before their bind      | a row with no bind inside the same window moves to the held table; at most `kUnboundFilingCapacity` (1,024) wait     |
| `abandonedFilings_`                | a 512-slot ring of ids whose filing was dropped       | a bind that arrives later sets `owesFreshMeasure`, so the instance asks again on its next props turn                 |

A configuration key (`NitroUiSizeKey`) is two independent 64-bit hashes of the component name,
the sizing key and the environment epoch (`keyFor`), so a cache hit verifies both and
`measureContent` never compares strings.

What `measure` returns, in order: the cache entry for this key; the size in this node's own
state when it carries this key; this configuration's entry in `guesses_`; the component's entry
in `fallbacks_`; otherwise no size. The last three carry an empty key, which is how `valid()`
tells a guess from an answer. The instance is `exact` only for a non-provisional cache entry or
its own state. `measure` records the answer in the ledger and, when it is not exact, adds the
instance to `needsCorrection_`.

Layout runs on the shadow thread before the mount transaction binds the instance, so `measure`
files a row for an id that is not in `registry_` yet. An id also outlives a native view: iOS
creates no view for a `display: none` node, so hiding a control runs `forget(id)` while its
React mount keeps the id, and showing it again lays the new view out before it is bound. The
held and waiting tables above exist for those two orders. `report` never claims a held entry.

`report(id, w, h, policy)` compares the size with what this instance was laid out with
(`sameSizeForPush`), not with the cache. When they agree within `kEpsilon` (0.5 pt or dp) and no
other instance of the configuration is waiting, the report is dropped: the ledger row becomes
exact, the cache entry is written or promoted from provisional, and `reportsDropped` and
`reportsConfirmed` each count one. Otherwise it is queued.

`flush(immediateBudget)` swaps the queue out under the lock, then `applyReports` corrects every
inexact instance of each reported configuration: up to `immediateBudget` as synchronous Fabric
state updates and the rest asynchronously. It returns whether any size changed. The pushes are
collected under the lock and issued after it is released. A flush also closes the two filing
windows and, once `registry_` has grown by `kRegistrySweepStride` (512) entries, sweeps
registry rows whose `State` has expired.

## 3. Where a turn ends

A report is applied at the one point per platform that is after everything the turn measured
and before pixels.

- iOS: an observer on the main run loop at `kCFRunLoopBeforeWaiting` with order 1 000 000,
  below UIKit's own commit observer (2 000 000). It is installed on the first queued report, and
  `report` calls `CFRunLoopWakeUp` so a correction queued at the end of a turn does not wait for
  the next touch.
- Android: one `OnPreDrawListener` per host (`scheduleSizingFlush` in `NitroComposeHost.kt`)
  that returns `!NitroUiSizing.flush()`. Returning `false` cancels that draw; the state update
  re-lays-out and React Native draws again. The host also calls `postInvalidateOnAnimation()`,
  because a pre-draw listener runs only when the window next traverses and an idle window, such
  as a presented `Modal`, never does on its own.

A natively measured size cannot exist before the control is laid out, so:

|         | Frame at the wrong size                                      |
| ------- | ------------------------------------------------------------ |
| Android | none: the pre-draw pass cancels it                           |
| iOS     | at most one, when the size can only be known in a later turn |

### The synchronous budget

A synchronous push is a Fabric commit run where `flush` was called.

| Platform | Budget                           | Why                                                                                                                              |
| -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| iOS      | 2 (`kImmediateBudgetPerTurn`)    | the commit joins the turn already on its way: a cold batch of 200 costs 8.5 ms for the flush                                     |
| Android  | 1 (`IMMEDIATE_BUDGET_PER_FLUSH`) | the commit happens inside the pre-draw pass that is about to cancel the frame, so it is a full re-layout for a frame never drawn |

On Android's cold batch of 200 in a debug build, the engine's own work (200 reports, one
correction, 199 asynchronous enqueues) is 0.09 ms and the flush is 36–38 ms on a quiet emulator:
the cost is the one synchronous commit. The budget is not 0, because then no correction reaches
the cancelled frame and every box of a cold batch is drawn wrong once. With 1, the instance that
reported is corrected inside the cancelled frame and the rest of the batch lands on the next
one. The harness logs the count of stale boxes for a cold batch and does not assert it.

## 4. The first mount, in order

A cold `Switch` on iOS:

1. JS mounts with `nuiSizingKey=""`, `nuiSizingId=n` and no size.
2. `measure` finds nothing cached and answers the declared fallback. The ledger row is inexact.
3. The host's first `commit()` does not measure. Fabric runs a `Create` mutation's props, state,
   layout metrics and `finalizeUpdates` (which calls `commit()`) before the `Insert` that puts
   the view in a window, and SwiftUI lays nothing out without one. `refreshContentSize()`
   returns while a content update is pending and the hosted view has no window.
4. `didMoveToWindow()` runs in the `Insert` of the same transaction. It applies the pending
   update (`layoutIfNeeded()`), measures with `sizeThatFits`, and reports. An `intrinsic`
   control is measured whatever its bounds, which keeps this out of `layoutSubviews`, where a
   report would land inside Core Animation's commit, after the flush observer.
5. `report` compares with what this instance was laid out with. A match confirms the entry with
   no state update. A difference queues one report, and the flush corrects every inexact
   instance of the configuration.

So the first instance of a configuration costs a commit only when the fallback is wrong, and a
later instance of a cached configuration costs none: its report is dropped. Harness tests seed
a wrong size (`seedWrongGuess` in `example/__tests__/Sizing.harness.tsx`) so that a correction
is visible at all.

For a `fillWidth` configuration, `sameSizeForPush` compares heights only: the width belongs to
the box, so two instances in parents of different widths agree
(`testFillWidthInstancesOfDifferentWidthsCostNothing` in `scripts/native-tests/sizing.test.cpp`).

## 5. Opting in

The steps for a new component are in CONTRIBUTING, "Adding a component". What each one does:

1. A view listed in `nitro-ui.sizing.json` has its generated shadow node, state and descriptor
   repointed by `scripts/patch-nitrogen.mjs`, which also adds the `updateState:oldState:`
   override to the generated `.mm` and the `onState` bind to the Kotlin manager
   ([upstream.md](../upstream.md), entry N6). A view not in the file is an ordinary Nitro view.
2. The fallback is declared from the component's native type with
   `NitroUiSizing.setFallback(name, width, height, policy)`. Each platform has one startup table
   that calls every component's `declareFallback()`: `ios/core/NitroUiDeclaredFallbacks.swift`,
   run from `+load` in `ios/core/NitroUiDeclaredFallbacksLoader.m`, and
   `android/…/nitroui/core/NitroUiDeclaredFallbacks.kt`, run from the companion `init` of
   `NitroUiPackage`. The Hybrid View also declares it in `init`. There is no engine default: a
   miss with neither a guess nor a fallback is no size, and the instance is laid out 0 by 0.
3. The wrapper sends `nuiSizingKey` and `nuiSizingId`, declared in
   `src/core/NitroUiIntrinsicProps.ts`. That file is a plain `.ts` interface, not a `.nitro.ts`
   spec: nitrogen prints "No specs found" for a spec file with no specs, and a plain interface
   flattens into the props the same way.
4. The host reports with `NitroUiSizing.report(id, w, h, policy)`, releases the id with
   `NitroUiSizing.forget(id)` from both `drop()` and `prepareForRecycle()`, and calls
   `NitroUiSizing.invalidateEnvironmentIfChanged(signature)` from `traitCollectionDidChange` or
   `onConfigurationChanged`.
5. On iOS a setter whose prop can change the size calls `host.noteContentSizeMayHaveChanged()`
   beside `host.markDirty()`, and the `nuiSizingKey` setter calls `host.noteSizingKeyChanged()`.
   Without the first, the control re-renders at its new size in the old box and nothing reports
   the difference. On Android a `nuiSizingKey` setter calls `noteSizingKeyChanged()` as well,
   and Compose's own measure pass reports a changed size.

### Building `nuiSizingKey`

- Never put the component name in the key. The default configuration is the empty key, and
  `prewarm` finds it by that.
- Never put anything the environment decides in it (text size, density, OS control size). The
  epoch covers those, and repeating them fragments the cache.
- Include everything that changes the size, text included. A missing input is a wrong size for
  every instance after the first.
- Pass `""`, never omit it. An empty string is a real configuration.

### Instance ids

`useSizingId()` (`src/core/useSizingId.ts`) takes the id from `nitroUiCore.nextSizingId()`, one
atomic counter in C++ whose values are never reused. The id belongs to a native mount, not to a
React element: a component that puts a `key` on its native view passes the same value as
`configuration`, so a replaced view gets a new id. Fabric orders Delete before Create, and the
dropped view's `forget(id)` would otherwise erase the row the new view just filed. An id never
changes under a view that is not remounting, because only that view's drop can end the entry
(`src/__tests__/useSizingId.test.tsx`).

### Environment epoch

`invalidateEnvironmentIfChanged(signature)` bumps the epoch only when the signature differs
from the last one, so the callback that fires once per mounted view costs one bump per real
change. The signature is the content size category and legibility weight on iOS and
`fontScale|densityDpi|locales` on Android. An empty signature always bumps.

`invalidateEnvironment()` increments the epoch and clears `cache_` and `needsCorrection_`. It
keeps `fallbacks_` and `guesses_`. Ledger rows stay: each row's key is recomputed for the new
epoch from the strings it holds, and the row is marked inexact, so a mounted control's next
report finds something to correct. Each platform asks for that report: Android's
`onConfigurationChanged` clears the report memory, resets the over-wide placement and bumps
`remeasureToken`; iOS's `traitCollectionDidChange` calls `invalidateContentSize()`.

### Policies

The entry in `nitro-ui.sizing.json` selects the intrinsic shadow node and names the component's
default policy. The policy that applies to an instance is the one its host reports, so a
circular `Progress` reports `intrinsic` under an entry that says `fillWidth`, and a wheel
`Picker` reports `fillWidth` under an entry that says `intrinsic`.

The policy decides the question the host asks the toolkit. `intrinsic` proposes an unbounded
size. `fillWidth` proposes the box's width with unbounded height (`fittingSizeProposal` in
`ios/core/NitroSwiftUIHost.swift`; `NitroUiMeasuredRoot` on Android), and the reported width is
the proposed one.

- The height stays unbounded. A height limit lets a box that is temporarily the wrong height
  clamp the answer to itself; the report then matches the layout and nothing corrects it.
- The width gates a `fillWidth` measure and the height never does. `refreshContentSize()` on
  iOS does not measure a `fillWidth` host whose bounds have no width, and measures one whose
  bounds have no height: the report is what gives the box a height.

A `fillWidth` cache entry stores the measured height and the declared width, not the reported
width (`filedSizeLocked`). A reported width restates one instance's box. `measureContent`
substitutes the box width only when the constraint width is finite, so the cached width reaches
the screen only under an infinite width constraint, such as a horizontal scroller.

- A `fillWidth` control whose height depends on its width (a wrapping label, a multi-line text
  field) puts the width in its `nuiSizingKey`, because one entry holds one height.
- Under a finite parent, the first frame of a cold `fillWidth` mount shows the declared height
  at the box's width.
- Under an infinite parent the declared width is what draws, on every frame. Declare the width
  the control should have when nothing constrains it.

## 6. Traps

- Never push a Fabric state update while holding the engine lock. The commit re-layouts,
  `measureContent` calls `measure`, and `std::shared_mutex` is not recursive.
- Never capture a reference in a state-update callback. An asynchronous update's callback runs
  later, possibly on the JS thread. Capture by value. `scripts/native-tests/sizing.test.cpp`
  runs under AddressSanitizer and defers pushes (`testDeferredPushesReadSizesAfterFlush`) to
  catch it.
- A correction does not reach React's revision. It commits as a new `State` on the family, but
  React's next props update is cloned without `.state` and copies the state of React's previous
  revision, which carries the superseded size in its Yoga measurement cache and its layout
  metrics. `adopt` mints a new `State` from it on every props change, so React Native never
  re-clones it as obsolete. `LedgerEntry.answerChanged` records that an instance's answer moved,
  and `requiresFreshMeasure`, read by `shouldNewRevisionDirtyMeasurement`
  (`cpp/NitroUiIntrinsic.hpp`), then dirties the measurement of that instance on every props
  turn. A change of configuration alone does not set the flag: that turn is already dirty.
- What a flagged props turn costs: the lookup (11.4 ns on the host, paid by every sized instance
  on every props turn), a measure (32.5 ns warm) and a Yoga pass from the root up the dirtied
  ancestors: 8.4 µs for a 35-node tree, 18.3 µs for 99, 47.8 µs for 316 (React Native 0.88's
  Yoga, on the host, `-O2`; excluding React Native's layout-metrics walk and diff, so expect 1–3×
  on a phone). A clean tree pays none of the Yoga pass.
- `forget(id)` from `drop()` and `prepareForRecycle()` is what keeps the ledger and the registry
  bounded. Waiting for the weak `State` to expire leaks one entry per mount.
- `invalidateEnvironment()` keeps the fallbacks, or the next cold mount has no box.
- A `drew` trace sample is taken once, for the instance id the host holds at its first frame. A
  host that paints before its props land, as inside a `Modal`, has none. A test asserts the
  drawn box when there is one and never requires one from a dialog.
- `drainSizingTrace()` empties the ring, and a drawn sample lands a run-loop turn after its
  frame. Tests accumulate across reads until the sample arrives (`collectTrace` in
  `example/__tests__/Sizing.harness.tsx`), never after a fixed sleep.
- The harness waits one render per `rerender`. Ten rerenders fired without awaiting fail with
  "Element did not update within 1000ms"; loop with awaits.
- `testTimeout` is one number for the whole suite (react-native-harness 1.6 has no per-test
  timeout). It is 30 s because the slowest sizing test mounts 200 hosted controls;
  `HARNESS_TEST_TIMEOUT` raises it (`example/rn-harness.config.mjs`).

## 7. Diagnostics

On `nitroUiCore` (`src/NitroUiCore.ts`):

| Call                                                 | Use                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sizingStats()`                                      | cached sizes, epoch, measurements, reports queued, dropped and confirmed, corrections immediate and batched, flushes, `changedFlushes`, `lastFlushMs`, `maxFlushMs`, `ledgerEntries`, `registryEntries` |
| `setSizingTraceEnabled(true)` / `drainSizingTrace()` | per-instance events: `laidOut` (what Yoga was told), `corrected` (what was pushed), `drew` (the box the platform sampled on its first frame). Only size changes are recorded; the ring holds 512.       |
| `seedSizingSize(component, key, w, h)`               | put a provisional size in the cache: the wrong guess a sizing test starts from                                                                                                                          |
| `invalidateSizingEnvironment()`                      | bump the epoch without changing a device setting                                                                                                                                                        |
| `prewarmSizing(names)`                               | what `prewarm` calls                                                                                                                                                                                    |

- Counters are process-wide and monotonic, and the engine outlives the runtime reset between
  test files, so every assertion is a delta over a snapshot taken inside the test.
- `changedFlushes` counts flushes that changed a size. On Android that is the number of frames
  cancelled before reaching the screen. On iOS it is not evidence of a skipped frame; the `drew`
  samples are.
- `reportsConfirmed` counts reports that agreed with what the instance was laid out with: the
  pre-warmed case and an environment change that did not move the control.
- `ledgerEntries` and `registryEntries` must stay flat across mount and unmount churn.
- The trace cannot see a correction applied inside a turn after the commit, or any frame after
  the first.

## 8. `prewarm`

`prewarm(['NitroUiSwitch'])` (`src/NitroUiCore.ts`) writes each component's declared size into
the cache as a provisional entry for the empty sizing key. A provisional entry answers
`measure` but leaves the instance inexact. The first control that reports either promotes the
entry (same size, no state update, counted in `reportsConfirmed`) or replaces it through the
ordinary correction. `seedSizingSize` writes the same kind of entry, which is why a test can
seed a wrong size and still see the control come out right.

- It returns how many components it seeded. A name with no declared fallback counts zero.
- It covers the empty key only, so it helps a component whose default configuration has an
  empty key (`Switch`) and not one whose key always names props (a `Button` title).
- An entry seeded after an environment change belongs to the new epoch and is provisional in it.
- Nothing is mounted off screen to measure ahead of time.

## 9. Limits

- The first instance of a configuration that is not cached shows its fallback until the
  measurement arrives; on iOS that can be one frame (section 3).
- `Switch` does not change size with text size on either platform (measured at 1.3× and
  AccessibilityLarge). The controls whose size follows text size are the ones with labels;
  their component pages state what was measured.
- `invalidateContentSize()` on an iOS host with no window and no pending content update goes
  straight to `sizeThatFits`, which answers under the default traits, and the result is cached
  under the current epoch. A text-sized control calls it when it is presented, not before.
- A caller's `width`, `height` or `flex` wins. The shadow node clamps its answer to the layout
  constraints.

## 10. A control inside a `Host`

What an app sees is in [host.md](../components/host.md). Inside the engine and the host:

- A control whose direct parent is a `NitroUiHostView` (`isHostedByParent`) never measures its
  content and never reports: `NitroComposeHost.onMeasure` declines, `onLayout` returns early,
  and `shouldCreateCompositionOnAttachedToWindow` is false. The cache gains no entry and no
  correction is queued.
- `measure` is still entered once per hosted child, because Fabric asks each child's Yoga node
  for a frame. It answers from the cache or the fallback and is never corrected.
- Nothing draws with that frame. The child's own Android view is 0 by 0 at mount and takes its
  Yoga frame on the next layout pass over it; `SurfaceMountingManager.updateLayout` re-asserts
  its visibility on every pass.
- `measureContent()` on a hosted control answers 0 by 0, or the size it measured before it moved
  into the `Host`.
- The `Host` places its children in one `Column` from the top-leading edge, clipped to its box.
  `centersContent` is false for it. Each child's policy applies to the `Host`'s inner width.
- The `Host` is not in `nitro-ui.sizing.json`, so its own box is Yoga's: its `style`, or the sum
  of its children's frames.
- `display: none` reaches Android as `INVISIBLE`; `setVisibility` records it and the `Host`
  leaves that child out of its composition. `padding` reaches the view through
  `ViewManager.setPadding`, which `NitroUiHostViewManager` forwards.
- The hosted branch is taken or reverted on attach and detach. A control with any other parent
  runs every path above unchanged.
