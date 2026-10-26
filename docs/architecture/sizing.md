# Intrinsic sizing — how a control tells Yoga its size

A Nitro Hybrid View is a plain Yoga leaf: with no style it is 0×0, and the SwiftUI or Compose
control inside it is centred in nothing. This document is how a control instead reports its own
size, so a caller writing `<Switch />` gets the control's real box and nobody sees a jump.

Design source: `docs/research/core-architecture.md` §1. This is the mechanism **as built**, plus
what a device measured (task T11: `docs/tasks/T11-intrinsic-sizing.report.md`).

## 1. The one rule that shapes everything

`measureContent` runs on the layout thread under the commit lock. SwiftUI and Compose are
main-thread-only, so the shadow node **cannot ask native how big the control is**. Everything below
exists to keep that question off the layout path:

- native pushes every size it learns into a C++ cache (main/UI thread, cheap);
- the shadow node answers layout from that cache, the node's own state, or a declared fallback —
  a lookup, never a call (`cpp/NitroUiIntrinsic.hpp:197`);
- when the cache did not know, the correction is applied as a Fabric state update at the end of the
  turn, batched, with a per-flush budget of synchronous updates — the platform's number, not the
  engine's (§3).

A control's size therefore arrives in two steps — a guess that is laid out immediately, and the
measured size that replaces it before the frame is drawn where the platform allows. The guess is
never arbitrary: it is the platform's documented control size, declared by the component itself.

## 2. The three pieces

| Piece                                          | Lives in                          | Does                                                                      |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Shadow node + state                            | `cpp/NitroUiIntrinsic.hpp`        | Answers `measureContent` from cache → state → fallback; stores the policy. |
| Engine: cache, ledger, fallbacks, flush        | `cpp/NitroUiSizingEngine.{hpp,cpp}` | Decides who needs correcting, batches it, times itself.                  |
| Host integration                               | `cpp/core/NitroUiSizing.hpp` + hosts | Reports measured sizes, flushes at the frame boundary, invalidates on environment change. |

The lookup in `measure` is `cache → state → guess` (`cpp/NitroUiSizingEngine.cpp`):

1. **cache** — a size already learned for this exact configuration in this environment. Exact, unless the entry is
   **provisional** (§8): a pre-warmed or test-seeded size answers the layout but does not count as an answer.
2. **state** — the size the engine pushed into *this node's* Fabric state for this configuration. Exact.
3. **guess** — the size *this same configuration* last measured, which survives an environment bump that clears
   the cache. Inexact by construction: it carries an empty key, so `valid()` can tell a guess from an answer.
4. **declared fallback** — the size the component declared for this OS, keyed by component only, used when this
   configuration has never been measured. Also inexact.

Steps 3 and 4 are deliberately separate maps. Only step 4 may be answered by another configuration's
measurement, and it may not: `fallbacks_` is written by declarations (`setFallback`, `seedSize`) and never by a
measurement, because it is keyed by component and would let a 100pt variant become the default variant's guess.

Every answer is recorded in a per-instance **ledger**. That is what makes a warm mount free: when a
host later reports a size, `report()` looks at the ledger, sees the instance was laid out at the
size it just measured, and drops the report without queueing anything
(`cpp/NitroUiSizingEngine.cpp:272`).

`flush()` (`cpp/NitroUiSizingEngine.cpp:321`) applies the queued reports as one batch: it corrects
**every** instance that was laid out for the configuration a report answers for, keeps at most
`kImmediateBudgetPerTurn` (2, or whatever the platform hands `flush(immediateBudget)`: Android hands
one) of them synchronous, batches the rest, ignores changes under 0.5 dp/pt, and returns whether
anything changed — Android's `OnPreDrawListener` uses that to cancel a frame whose layout was stale.

## 3. Where a turn ends, per platform

A report is never applied where it is made. Each platform has one place that is after "everything
this turn measured" and before pixels:

- **iOS**: a run-loop observer at `kCFRunLoopBeforeWaiting`, order 1 000 000 — deliberately below
  UIKit's own commit observer (2 000 000), so a correction made in a turn is in that same turn's
  commit (`cpp/NitroUiSizingEngine.cpp:68`).
- **Android**: an `OnPreDrawListener` per host that returns `!flush()`. Returning `false` cancels
  that one draw; the state update re-lays-out and RN draws again with the right box
  (`android/.../NitroComposeHost.kt:469`).

That difference is measurable, and T11 measured it. With a stale size in the cache (an environment
change leaves one behind), a control is laid out wrong and corrected once its native measure
arrives:

|              | Frame at the wrong size                                   |
| ------------ | --------------------------------------------------------- |
| Android      | never — the pre-draw pass cancels it (`stale=0` measured) |
| iOS          | at most one, when the size could only be known in a later turn (`stale=1` measured) |

A natively measured size cannot exist before the native side has laid the control out, so the iOS
case is not a scheduling bug to fix by flushing earlier: it is the first turn having nothing to
flush. It is also what stock RN does — it keeps the old box until something re-measures too. The
trace (`§7`) is what turned this from an argument into a number.

### How many corrections a flush may make synchronously

`flush(immediateBudget)` takes the number of synchronous pushes the platform wants to pay for, and
the platforms differ because a synchronous push is a Fabric commit run *where `flush` was called*:

| Platform | Budget | Why |
| -------- | ------ | --- |
| iOS      | 2 (`kImmediateBudgetPerTurn`) | the commit joins the turn already on its way, so a push is nearly free — a cold batch of 200 costs 8.5 ms for the flush |
| Android  | 1 (`IMMEDIATE_BUDGET_PER_FLUSH`) | the commit happens inside the pre-draw pass that is about to cancel the frame, so it is a full re-layout spent on a frame that never draws |

T12 phase 2 attributed the Android number on the harness's cold batch of 200 (debug build): the
engine's own work — 200 reports, one correction, 199 asynchronous enqueues — is **0.09 ms**, and the
flush is **36–38 ms** on a quiet emulator (84–125 ms on a loaded one). The whole cost is the one
synchronous commit, so a second synchronous push re-lays out a tree that commit just made correct
and spending none is what the 0.09 ms measures. Dropping from two pushes to one is dropping one of
those commits, and T12 measured it on three rounds each side (same tree, same probe):

| N   | Budget 2 (first batch / median of 3) | Budget 1 (first batch / median of 3) | Median  |
| --- | ------------------------------------ | ------------------------------------ | ------- |
| 200 | 38.80 ms / 18.88 ms                  | 36.76 ms / 12.84 ms                  | −32 %   |
| 500 | 75.38 ms / 42.51 ms                  | 53.97 ms / 26.77 ms                  | −37 %   |

Quote it as both, not as one number: the first batch in a process — the one the committed test sits
in — moves −5 % at 200 rows and −28 % at 500, while later rounds in the same process move far more,
because a cold first commit is paying for a tree that has just been built. All six pairs are lower.

One is also the smallest budget that keeps D17's floor: at 0 the harness's own cold-control test goes
red, and the same cold batch measures `stale=100` — every box drawn wrong once — because no
correction at all reaches the cancelled frame. At 1 the batch T12 measured drew `stale=0`, which is a
measurement on one device rather than a property of the budget: one synchronous push clones one
family, so an untouched sibling keeps the measurement it cached
(`cpp/NitroUiIntrinsic.hpp`, `shouldNewRevisionDirtyMeasurement`), and T11 round 2 expected 198 of 200
to arrive after the redraw. What is *not* in doubt is the floor — one instance, the one that reported,
is corrected inside the frame that gets cancelled — and the remaining batch is what D17 already
allows to land on the next frame. The harness logs `stale` for this reason and does not assert it.

## 4. The first mount, counted

A cold Switch on iOS, counters as deltas (`example/__tests__/Sizing.harness.tsx`):

1. JS mounts with `nuiSizingKey=""`, `nuiSizingId=n`, and no size.
2. `measure` finds nothing cached and answers the declared fallback (61×28). Ledger: inexact, so this
   instance is now on the list of things to correct for this configuration.
3. The host's first `commit()` deliberately does **not** measure. Fabric runs a `Create` mutation's
   props, state, layout metrics and `finalizeUpdates` (→ `commit()`) *before* the `Insert` that puts
   the view in a window, and SwiftUI has nothing to lay out while its view has none — a number taken
   there describes the content being replaced, not the content being mounted. So
   `refreshContentSize()` refuses while a content update is pending and the host is off-window, and
   keeps the measure pending (`ios/core/NitroSwiftUIHost.swift:356`).
4. `didMoveToWindow()` is the deferred measure point (`NitroSwiftUIHost.swift:175`), and it lands in
   the `Insert` of the **same** transaction. The pending update is applied (`layoutIfNeeded()`), then
   `sizeThatFits(.infinity)` says 61×28. An `intrinsic` control is measured regardless of its current
   bounds, which is what keeps this out of `layoutSubviews` — where a report would land inside Core
   Animation's commit, after the flush observer. Still the same turn as the mount, so the number is in
   front of the frame rather than behind it. It reports.
5. `report()` compares the report with the size *this instance* laid out with, not with the cache:
   - **matches** (the declared number was right): the entry is **confirmed**. The cache entry becomes
     authoritative, the ledger entry goes exact, and there is no state update at all — a Switch
     mounted on the OS whose control size it declares costs zero commits, which is why the harness
     seeds a wrong guess to be able to see a correction at all.
   - **differs** (the harness's `seedWrongGuess` case, and every genuinely new variant): one report is
     queued, the run loop is woken so the turn really does end (`CFRunLoopWakeUp`) rather than waiting
     for the next touch, and `flush()` corrects every inexact instance of the configuration — the
     first two immediate, the rest enqueued. "End of turn" is literal here: iOS flushes from an
     observer below Core Animation's commit observer, and Android flushes from a pre-draw listener
     that cancels the frame. A correction queued *after* the immediate budget is not in this turn —
     see §3 for what that costs on each platform.

So the first instance of a configuration costs a commit only when the guess was wrong, and a right
guess costs nothing: the confirmation writes the answer into the cache, which is what the next instance
reads. Every later instance is free either way: `report()` drops it or confirms a provisional entry
without pushing (measured: 200 warm Switches = 0 corrections, 200 dropped reports).

A `fillWidth` configuration is held to that rule with one adjustment: its width belongs to the box,
so two instances of one configuration legitimately report different widths, and the comparison that
decides "is there anything to correct" ignores the width for exactly that policy (`sameSizeForPush`,
`cpp/NitroUiSizingEngine.cpp:99`). Without that adjustment the promise above is false for every
Slider: each instance whose parent is a different width than the last one measured pays a commit, and
each correction rewrites the cache with its own box width. The first `fillWidth` component measured
it: two Sliders in boxes of 300 and 200 cost 2 corrections and left the cache answering 200 to a
control that had only ever been 300 wide
(`scripts/native-tests/sizing.test.cpp:testFillWidthInstancesOfDifferentWidthsCostNothing`).

## 5. Opting in

Five things, four of which a component already has reasons to write:

1. **Declare the policy.** Add the Hybrid View to `nitro-ui.sizing.json`
   (`{ "HybridNitroUiSwitch": "intrinsic" }`). `scripts/patch-nitrogen.mjs` reads it and repoints
   the three generated aliases (`…ShadowNode`, `…ComponentDescriptor`, `…State`) at the
   `Intrinsic…` templates for that view, adds the `updateState:oldState:` hook to the generated
   `.mm`, and the `onState` line to the Kotlin manager (`scripts/patch-nitrogen.mjs:102`). A view
   that is not in the file is a normal Nitro view, untouched. `bun run nitrogen:check` regenerates
   into a temp directory and fails if the patched output and the committed output differ, so a
   nitrogen version that changes shape fails loudly rather than silently un-sizing a control.
2. **Declare the fallback size**, once, from the component's own native type:
   `NitroUiSizing::setFallback("NitroUiSwitch", 61, 28, POLICY_INTRINSIC)`. Only the component knows
   what it hosts, and on iOS which OS's control size applies. It has to be a good one (a box smaller than the
   control makes SwiftUI paint outside it — T10's `docs/architecture/core.md` §7 has the hit-test story), and
   **it has to be in the engine before the component's first measure**, which means it cannot be declared only
   from the Hybrid View: Fabric measures a shadow node before it creates the view, so a fallback that waits for
   its own first view arrives one measure too late and the first instance is laid out `0 × 0` (there is no engine
   default size — a cache miss with neither a guess nor a fallback is no size at all). Each platform therefore has
   one startup table that calls every component's `declareFallback()`: `ios/core/NitroUiDeclaredFallbacks.swift`
   (from `+load`) and `.../nitroui/core/NitroUiDeclaredFallbacks.kt` (from `NitroUiPackage`'s static init, which is
   earlier than the first view manager Fabric can ask for). The view still declares its own in `init` as the
   backstop, both are once per process, and one line per component goes in the table (core.md §9). After the first
   report a configuration's own measurement outranks the declaration, so the fallback is only ever the first
   frame's guess.
3. **Send the two props** from the JS wrapper: `nuiSizingKey` (the size-affecting props, variant
   only) and `nuiSizingId` (one id per mounted instance, from `useSizingId()` in `src/core`). They are declared in
   `src/core/NitroUiIntrinsicProps.ts` and are `@internal`: users never pass them (D14). The
   interface is *not* a `.nitro.ts` file — nitrogen prints "No specs found" for a spec file with no
   specs, and a plain `.ts` interface resolves and flattens into the props just the same (R10).
4. **Report the measured size** from the host when it changes (`NitroUiSizing.report(id, w, h, policy)`),
   hand the id back when the host goes away (`NitroUiSizing.forget(id)`, from `drop()` and
   `prepareForRecycle()` / Android's drop), and call
   `NitroUiSizing.invalidateEnvironmentIfChanged(signature)` when the environment may have changed
   (`traitCollectionDidChange` / `onConfigurationChanged`). The signature is what the host can observe
   about the environment (iOS: content size category + legibility weight; Android:
   `fontScale|densityDpi|locales`); the engine bumps the epoch only when it actually moved, so the
   notification that fires once per mounted view costs one invalidation per real change.
5. **Say when a prop can change the size (iOS).** The host does not watch `nuiSizingKey`: the key is
   the engine's identity for a configuration, not a native signal, and `set { model.sizingKey = … }` is
   a plain store (`ios/components/Switch/HybridNitroUiSwitch.swift:254`). Nor is a commit a measure
   point — most props change pixels, not size, and a `sizeThatFits` on every one of them is a
   synchronous SwiftUI layout after every invalidation (review SF5). `commit()` re-measures after the
   first commit, a bounds change, a trait change, **or a component that said so**: a prop setter whose
   value can move the control's size must call `host.noteContentSizeMayHaveChanged()` next to
   `host.markDirty()`, as `nuiTestWidth` does
   (`ios/components/Switch/HybridNitroUiSwitch.swift:275` — the only prop a Switch has that moves its
   size, which is why nothing else calls it today). The flag costs one bool per prop write and one
   `layoutIfNeeded` + `sizeThatFits` per size-affecting commit, and it is the only thing that makes the
   report reach the engine after such a change: without it the control re-renders at its new size
   inside a box that still belongs to the old one, and nothing ever reports the difference — the engine
   cannot correct a size it is never told about. Android needs no such call: Compose observes the model,
   recomposes, and its own measure pass reports the new size by itself. A Button's `label`, `variant`
   and `size` are all size-affecting, so every one of them has to say so.

Then drop any default-size style. What is left is the base style, and it depends on the policy: an `intrinsic`
control keeps `{ alignSelf: 'flex-start' }` (`SELF_SIZING_BASE_STYLE`, `src/components/Switch/Switch.tsx:111`) so a
parent cannot stretch it, while a `fillWidth` control needs the opposite - `{ alignSelf: 'stretch' }`
(`FILL_WIDTH_BASE_STYLE`, `src/components/Slider/Slider.tsx:135`) - because the cross axis is the axis it *wants*
filled and `alignSelf` is the only thing that decides it (the trap in §6). Either way an explicit `width`, `height`,
`flex` or `alignSelf` in the caller's `style` still wins.

### Building `nuiSizingKey`

The key is the **variant only**: the size-affecting props of this instance, serialised — `""` for a
Switch (nothing it takes changes its size), `"bordered|large|Save"` for a Button. The engine composes
the cache identity itself from component name + key + environment epoch
(`cpp/NitroUiSizingEngine.cpp:keyFor`), so:

- **never put the component name in the key** — the default configuration would then not be the empty
  key, and `prewarm` could not find it;
- **never put anything the environment decides in it** (text size, density, OS control size) — native
  folds those in through the epoch, and a key that repeats them fragments the cache and re-measures
  on every environment change;
- **include everything that does change the size**, including text: two instances with the same key
  share one cached size, so a missing input is a wrong size for every instance after the first;
- pass `""` rather than omitting it (D7 / nitro#1184). An empty string is a real configuration.

### Instance ids

`nuiSizingId` keys the engine's ledger and registry, which are **process-global** — so the id has to
be unique across components and across JS runtimes, not just within one component's module.
`useSizingId()` (`src/core/useSizingId.ts`) takes it from `nitroUiCore.nextSizingId()`, a synchronous
call to one atomic counter in C++. A per-component counter would give Button #1 and Switch #1 the same
id and deliver a correction to the wrong control, and a per-runtime counter would restart on every
JS reload against an engine that outlives the reload. One native counter is the only one of these
that cannot collide, and at one call per mount it is free next to the mount itself.

### Environment epoch

`invalidateEnvironment()` bumps an epoch that is part of every cache identity, and clears the cache —
every size in there was measured under a text size, density or OS control size that may no longer
apply. It keeps two things instead. The **declared fallbacks** stay because a component declares its size once
per process, and dropping them would leave the next first mount with nothing to lay out (0×0) until a
measurement arrived. And so does each configuration's **own last measured size** (`guesses_`, keyed by
component + sizing key rather than by cache identity), which is what keeps an environment change that did not
move a control from costing that control a commit. Measured, and covered by
`scripts/native-tests/sizing.test.cpp`.

The ledger entries **survive** the bump, marked inexact, with their key recomputed for the new epoch
from the component name and sizing key the entry already holds. That is what lets a control that is
*already mounted* be corrected: the host re-measures and reports, and `report()` finds a live ledger
entry to correct instead of an instance "that was never laid out" to drop. Dropping the ledger here
was the round-1 bug — a mounted text-sized control would have kept its old-environment box until it
remounted.

The first mount after an environment change therefore lays out at the declared size, measures, and
corrects. Nothing cached survives the change to be wrong forever.

### Policies

`POLICY_INTRINSIC` — the control's intrinsic size is its size: Switch, Button, SegmentedControl.
`POLICY_FILL_WIDTH` — width comes from the Yoga box when it is finite, height stays intrinsic:
Slider, linear Progress, wheel Picker (`cpp/core/NitroUiSizing.hpp:28`). The control declares the
policy when it reports; the shadow node applies it. The `nitro-ui.sizing.json` entry therefore only
selects the intrinsic shadow node and names the component's *default* policy: the policy that applies
to an instance is the one its host reports, which is how a circular Progress stays `intrinsic` under an
entry that says `fillWidth` and a `wheel` Picker goes `fillWidth` under an entry that says `intrinsic`. A component whose width is decided by its parent
must use `fillWidth`, or it will fight the parent for its own preferred width.

The policy also changes the **question the host asks the toolkit**, which is not obvious from either side of the
`fillWidth` contract: an `intrinsic` control must be proposed an unbounded size (what does it want to be?), while a
`fillWidth` control must be proposed *the box's width* with unbounded height (what height does it want **at that
width**?). Ask the unbounded question of a `fillWidth` control and you get two wrong numbers — a width nobody asked
for, and a height implied by that width — which is what iOS did for both policies until the first `fillWidth`
component arrived; the proposal is now per policy (`fittingSizeProposal`, `ios/core/NitroSwiftUIHost.swift:457`),
and the answer's width is replaced with the proposal's. Android has to be told the same question, in its own terms:
`NitroUiMeasuredRoot` measures a `fillWidth` control at the box's **width** with the height **unbound**
(`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:632`). Unbinding the height is not a
detail — a `maxHeight` left in place lets a box that is temporarily the wrong height clamp the answer to itself, so
the wrong height confirms itself (the report matches the layout, so the engine is never told and never corrects).
The `fillWidth` measure must also not run while the box has no **width** — a zero proposal is not the box's
width — which is why `refreshContentSize()` refuses it there (`ios/core/NitroSwiftUIHost.swift:356`). Which
half of the box gates it matters as much as the fact that something does: the **width** is the input a
`fillWidth` control may not invent, so it gates; the **height** is the number being measured, so it must never
gate. A box really can arrive with no height — a caller's `height: 0`, a `maxHeight` squashed below the
control, a parent that has not decided — and a measure that waits for a non-zero height then closes the loop the
sizing engine exists to break: no measure, so no height, so no measure. (Until T14 a cold first instance supplied
its own zero: the declared fallback arrived with the component's first *view*, and Fabric creates that view after
the shadow node's first measure. `NitroUiDeclaredFallbacks` closes that gap (§5), but the rule stays, because the
other ways a box has no height never went anywhere.) On iOS the stalled host then paints SwiftUI's minimum content
(`clipsToBounds` is false), which looks like a working control that has lost its track.

**What a `fillWidth` cache entry stores.** Only the height is the configuration's own answer. The
width in the entry is the last box width some instance was measured at — a restatement of a parent,
not a fact about the control — so it is never compared, and the one case where it reaches the screen
is a node measured under an *infinite* width constraint (a control in a horizontal scroller), where
there is no box width to use. Two consequences a component author must know:

- a `fillWidth` control whose **height depends on its width** (a wrapping label, a multi-line text
  field) cannot share one entry between its widths, because an entry holds one height: it has to put
  the width in its `nuiSizingKey` so each width becomes its own configuration. A Slider's height does
  not move with its width — measured 200/300/328 pt on iOS and 200/480 dp on Android, same height.
- the first frame of a cold `fillWidth` mount is the declared **height** at whatever width the box
  has, which is why the width in `setFallback` barely matters and the height has to be right (D14,
  D17).

## 6. Traps (each one measured, each one cost someone an hour)

- **A measure result does *not* stop the cross-axis stretch — `alignSelf` does.** Yoga stretches a
  child on the cross axis whenever its size there is *undefined*, and a leaf with a measure function
  is no exception: the measurement is what Yoga fills, not what resists the fill. So the engine
  writing a size into the node's state never protects a control from being stretched. The thing that
  does is the base style, `alignSelf: 'flex-start'` — the same guard stock RN's own `Switch` carries
  (`Switch.js`), for the same reason. Without it, a parent's default `alignItems: 'stretch'` would
  widen a Switch into a
  300 pt box and the control would sit centred in it. The consequence, measured on both platforms:
  `style={{ flex: 1 }}` in a 300×60 row gives **300×28 on iOS / 300.19×48 on Android** — the axis
  flex applies grows, the control's own size holds the other. A caller who wants the fill asks for
  it with `alignSelf: 'stretch'` (measured: 300 wide, control height kept). Stock RN's `Switch`
  behaves differently here; this is a deliberate trade, not an oversight.

  (An earlier version of this document blamed the correction. It was wrong, and the number above is
  the same with or without a correction, which is how it was checked.)
- **Never push a Fabric state update while holding the engine lock.** A push can come straight back:
  the commit re-layouts, `measureContent` calls `measure`, and `std::shared_mutex` is not recursive.
  `flush()` therefore collects under the lock and pushes after dropping it
  (`cpp/NitroUiSizingEngine.cpp:345`). Deadlocked once, on a device, in a harness run.
- **Never capture a reference in a state-update callback.** The callback handed to
  `ConcreteState::updateState` may run on the JS thread at some later point — `Asynchronous` updates
  are only *queued* by `EventQueue::enqueueStateUpdate`. Round 1 captured `[&measured]`, a reference
  into a local vector in `applyReports`, so every batched correction read freed memory; ASan caught it
  in seconds once a host test deferred the push instead of running it inline. Capture by value.
- **A correction does not reach React's revision.** A correction is committed as a new `State` on the
  instance's family, but React's next props update is cloned *without* `.state` (`UIManager.cpp`) and
  copies the state of React's own previous revision — the one made before the correction. That
  revision carries the superseded size twice over: in its Yoga measurement cache and in its
  `layoutMetrics_`. RN normally heals exactly this — an obsolete state is re-cloned with `.state` by
  `ShadowTree::progressState` — and our `adopt` defeats it, because a props change mints a brand-new,
  never-obsolete `State` from the stale one every single turn, and the stale one is committed as the
  family's most recent. So `shouldNewRevisionDirtyMeasurement` (`cpp/NitroUiIntrinsic.hpp`), which
  keeps a props-only clone clean on purpose (a Switch being toggled must not re-size), lets a clone be
  committed at the superseded box with `measureContent` never reached to notice. The engine meanwhile
  learned the right size, so the host's next report is dropped as agreement and the wrong box is
  permanent for that instance — only another instance's correction, which is per configuration, healed
  it. On iOS that is what put a controlled Switch's `Toggle` outside the window and out of the a11y
  tree, its row's `flex: 1` label grown by exactly the 61 pt that went missing (FIX2, T15 Finding 1; it
  reproduces on Android once the first answer is wrong). An earlier draft of this bullet blamed Yoga's
  cache holding *both* answers and `canUseCachedMeasurement` picking the older one. That is what
  happens when something else dirties the tree in the same turn — not in the failing case, where
  nothing else is dirty and the box is simply the copied `layoutMetrics_`. The ledger therefore
  records whether an instance's answer ever moved (`answerChanged`), and `requiresFreshMeasure` makes a
  props turn dirty the measurement of *that* instance and nobody else: the dirty leaf forces the Yoga
  pass a clean tree skips, and `needToVisitNode` drops the stale cache entry with it. A control the
  engine never had to correct still costs no measure per prop turn — and a re-key alone does not flag
  one, because a key is a JS prop and the turn that changes it is already dirty for that reason. A
  control it *did* correct pays the real cost on every turn of its mount: the lookup (11.4 ns on host,
  and every sized instance pays that flagged or not), a measure (32.5 ns warm), and a Yoga pass from
  the root up the dirtied ancestors — 8.4 µs for a 35-node tree, 18.3 µs for 99, 47.8 µs for 316
  (RN 0.88's Yoga, host, `-O2`; excluding RN's layout-metrics walk and diff, so expect 1–3× on a
  phone) — where a clean tree pays 0. That is the price of a box that stays right; the cheaper
  non-sticky signal is a follow-up (D20).
- **An instance's id is owned by the JS side and its memory by the native side.** `forget(id)` from
  `drop()`/`prepareForRecycle()` is what keeps the ledger and registry bounded; pruning on weak
  expiry alone leaks one entry per mount for the life of the process, and a recycled Android host
  keeps an id it will reuse. `flush()` sweeps expired registry entries as a backstop for a host that
  forgot to call it.
- **`invalidateEnvironment()` must keep the fallbacks**, or the next cold mount has no box at all (§5).
- **A `drew` sample is one-shot.** The host samples the box it first drew, attributed to the instance
  id it holds at that moment. A host that paints before its props land (RN's `Modal` mounts its tree
  on the second surface separately) has no sample to give. The sizing is fine; the diagnostic is
  silent — so a test asserts the drawn box when there is one and never requires one from a dialog.
- **Reading the trace consumes it.** `drainSizingTrace()` empties the ring, and a drawn sample lands
  a runloop turn after the frame it describes, so tests accumulate across reads until the sample
  arrives (`collectTrace` in `example/__tests__/Sizing.harness.tsx`) — the same pattern the T10 suite
  uses for the perf ring. A fixed sleep here is a flaky test waiting to happen; it happened.
- **The harness waits one render per `rerender`.** Firing ten rerenders without awaiting them fails
  with "Element did not update within 1000ms", so a rapid-prop test loops with awaits instead.
- **`testTimeout` is one global number** (react-native-harness 1.6 has no per-test timeout), and the
  suite's slowest test mounts 200 hosted controls — hence the 30 s floor and
  `HARNESS_TEST_TIMEOUT` in `example/rn-harness.config.mjs`.

## 7. Diagnostics — and what each one proves

On `nitroUiCore` (`src/NitroUiCore.ts`), all of it diagnostics except `prewarm` (§8):

| Call                             | Proves / measures                                                            |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `sizingStats()`                  | counts + timings: cached sizes, epoch, measures, reports queued/dropped/**confirmed**, corrections immediate/batched, flushes, `maxFlushMs`, `changedFlushes`, and live `ledgerEntries`/`registryEntries`. |
| `setSizingTraceEnabled(true)` / `drainSizingTrace()` | per-instance log: `laidOut` (what Yoga was told), `corrected` (what was pushed), `drew` (what the platform sampled on its first frame). Only size *changes* are recorded, cap 512. |
| `seedSizingSize(c, key, w, h)`   | put a known-wrong size in the cache — the R2 test's poisoned guess.          |
| `invalidateSizingEnvironment()`  | move the environment without changing a setting on a device.                  |
| `prewarmSizing(names)`           | the production path, below.                                                   |

Counters are process-global and monotonic, and the engine outlives a runtime reset between test
files, so every assertion is a **delta** over a snapshot taken inside the test.

What the trace buys is the distinction the brief asked for — "Yoga was corrected" versus "nobody saw
a wrong size". `laidOut` + `corrected` alone cannot tell those apart; adding the box the host
sampled drew is what measured the iOS/Android difference in §3. What it cannot see: a correction
applied inside a turn *after* the commit, and any frame after the first.

`changedFlushes` counts flushes that changed a size (D16 renamed it from
`staleFramesSkipped`, which it never was on iOS). On Android that is exactly the number of frames
that were cancelled before reaching the screen; on iOS it is not evidence of a skipped frame at all
(see the comment in `flush()`) — the `drew` samples are. `reportsConfirmed` is its own counter
because a report that agrees with the cache is a different event from one that was dropped: it is
the pre-warmed and environment-unchanged case, and the proof that a provisional entry was promoted
without a commit.

### Measured, debug builds, iOS 27 simulator + API 35 emulator

| Scenario                       | iOS                              | Android                       |
| ------------------------------ | -------------------------------- | ----------------------------- |
| Control's real size            | 61×28 pt                         | 52.19×48 dp                   |
| First cold instance            | 1 correction, 1 immediate, 1 flush | same                        |
| Second warm instance           | 0 corrections, 1 dropped report  | same                          |
| 200 same configuration, cold   | 200 corrections (2 immediate + 198 batched) in 1 flush, ~5 ms | same shape, 8.5–24 ms |
| 200, pre-warmed                | 0 corrections, 200 dropped reports | same                        |
| 200 mounts, warm / cold        | 295–329 ms / 137–155 ms          | 899–2310 ms / 830–3469 ms     |
| 50 mounts, warm / cold         | 0.66–0.71 / 0.76–0.83 ms ea.     | 5.7–12.0 / 7.5–12.1 ms ea.    |
| 30 rapid prop turns            | 0 measures, 0 corrections        | same                          |
| One further prop turn on an instance that *was* corrected | 1 measure, 0 corrections (§6, FIX2) | 1 measure, 0 corrections |
| font scale 1.3 / Dynamic Type XL | unchanged size                 | unchanged size                |

The two prop-turn rows are the same fast path read two ways: the storm test's Switch is answered at the size the
engine already believed, so 30 turns cost 0 measures; an instance the engine had to correct re-asks once per turn
and still costs no correction (§6).

Ranges are the spread across the runs in the report. The Android ones are wide because another
task's device work shares this machine (D13): its cold-batch flush measured 8.5 ms on a quiet
machine and 17.9–24.2 ms under load, so read the Android rows as an order of magnitude, not a
number. Read them all as *the mount dominating, not the sizing*: on iOS the correction path is
invisible inside mount noise, and Android's cold batch costs a few ms more per instance while
paying ~1 frame in one pre-draw flush. T02's bench harness is not merged, so these are core perf
clock deltas (`nitroUiCore.now()`, D1) around a render, not published benchmark numbers.

## 8. `prewarm`

`prewarm(['NitroUiSwitch'])` (exported, `src/NitroUiCore.ts`) adopts each component's *declared* size
as this environment's **provisional** cached size for the default configuration. A provisional entry
answers `measure` — that is the whole point, the first mount gets a real box instead of a guess that
carries no key — but it does not mark the instance exact. The first control that measures and reports
either **promotes** the entry (the sizes match: no state update, counted as `reportsConfirmed`) or
**replaces** it through the ordinary correction path. Returns how many it seeded; an unknown name
costs nothing and counts zero, which makes the list safe to keep in an app that upgrades the library.

Limits, stated plainly:

- it seeds the **empty variant** only. A component whose size depends on its props (a Button's title)
  has more than one configuration, and pre-warming those needs a per-component list of keys — the
  brief's `prewarmKeys` — which nothing has needed yet, because the only self-sizing component so far
  has one variant.
- it is a declared number, not a measurement, and the engine treats it that way. Round 1 wrote it into
  the cache as an *authoritative* size, which made the documented guarantee false: with a declared
  61×28 and a real 51×31 (an app opting into `UIDesignRequiresCompatibility` on iOS 26+), every Switch
  was laid out, marked exact, and then had its real measurement dropped for the whole session. Same for
  `seedSizingSize`, which is why the harness can poison a cache and still have the control come out
  right — that is what makes the on-device tests able to fail.
- pre-warming after an environment change is safe for the same reason: the entry belongs to the new
  epoch and is provisional in it, so it can be stale without being trusted.
- a real pre-measure (mount one off-screen, let it report, throw it away) is the stronger version and
  is deliberately not here yet: it has main-thread cost at the worst moment (app start), and T10's
  Android recycling notes (`docs/architecture/core.md` §6) say off-screen Compose is where surprises
  live.

## 9. What this does not do

- It does not know a size before the first measure of an *unusual* variant. `fillWidth` and the
  declared fallback cover the common shapes; a text-sized control's first frame of a new string is
  its own problem, and iOS shows at most one stale frame there (§3).
- It does not observe a real environment change through the only component that exists yet: neither
  `UISwitch`/`Toggle(.switch)` nor the M3 Switch changes size with font scale, measured at 1.3× and
  AccessibilityLarge. The epoch path is exercised mechanically (`invalidateSizingEnvironment`,
  `traitCollectionDidChange`/`onConfigurationChanged`), and the first component with a text-derived
  size will exercise it for real.
- It cannot know a trait environment that is not on screen yet, in the one case that still asks for it:
  `invalidateContentSize()` called on a host that has no window. The mount path no longer has this
  problem — a commit does not measure a detached host at all, it leaves the measure pending until
  `didMoveToWindow` (§4), so a `Modal`'s content before presentation keeps the guess and is measured
  when it appears. An explicit invalidate is different: with no content update pending it goes straight
  to `sizeThatFits`, which answers under the **default** traits, and the number it gets is cached under
  the *current* epoch. Harmless for Switch, which does not resize with Dynamic Type; wrong for the
  first text-sized control whose component invalidates before presentation, and the wrong number then
  serves other instances of that configuration. Such a control should call `invalidateContentSize()`
  when it is presented, not before — that is the first such component's job, and this is the note
  saying so.
- It does not shrink a control into a smaller box on request. Yoga still owns layout: a caller's
  `width`, `height` or `flex` wins, unchanged (`example/__tests__/Sizing.harness.tsx`).

## 10. A control inside a `<Host>` (D24)

`<Host>` (Android, opt-in, `Switch` in 0.2 — `docs/components/host.md`) composes its direct
nitro-ui children into **one** Compose composition, which is where the mount memory and
UI-thread win comes from (T16: 2.75x → 0.87x `expo-ui-shared-host` on mount memory). The cost
is that the hosted control stops being a Yoga leaf whose box anybody draws:

- **It never measures its content, and never reports.** `NitroComposeHost.onMeasure` declines
  while its parent is a `NitroUiHostView` (`isHostedByParent`), `onLayout` returns early, and
  `shouldCreateCompositionOnAttachedToWindow` is false: measuring would build a second
  composition for content that is already in the Host's. No content measurement means no
  report, so the cache gains no entry, no correction is queued, and **D17's first-frame
  budget has nothing to govern** — a hosted control cannot be a frame late because nothing
  arrived. Measured over eight hosted Switches on an invalidated cache: reports 0, cache
  entries 0, corrections 0 (`example/__tests__/Host.harness.tsx`).
- **The measure call itself does not go away.** Fabric still asks each hosted child's Yoga
  node for its frame, and `measure()` is still entered once per child — 8 hosted, 8
  unhosted, the same number. The answer comes from §2's cache or the declared fallback, so
  it costs a lookup, not a measurement, and it is never reported back.
- **The frame it gets is decorative.** The shadow node answers layout from the same
  cache/fallback as an unhosted control — it has no idea who draws the pixels and must not
  start asking (§1) — so `<Host><Switch /></Host>` still gives the Switch a 48 dp row box and
  RN still computes a frame from it. Nothing places pixels with that frame; on Android the
  platform view behind it is `GONE` and reports `0x0` to anything reading real view bounds.
  A hosted child's `alignSelf: 'stretch'`, `width: '100%'` or `height` therefore moves the
  frame and not the drawing (D16's cross-axis opt-in means nothing inside a Host), and does
  not space the rows.
- **The Host places the children.** One `Column`, mount order, the Host's width, from the box's
  **top-leading edge**, clipped to the box. The same measured root that centres a control
  inside the box the engine gave it (`placeRelative((w-mw)/2, (h-mh)/2)`) is what `centersContent`
  now turns off for the Host: centred, a Host 60 tall holding 144 of content drew its second
  row at the top of its box.
- **The Host measures nothing either.** Its view config has no measure function, so its box is
  pure Yoga: `style` first, and with no `height`/`flex` the sum of its children's decorative
  boxes (three children of `height: 24` → 72 tall, while Compose drew 144). Growing to measured
  Compose height was rejected: it needs a Compose measurement on the layout path (§1's forbidden
  question) or a hard-coded row height (a declared fallback with nothing to correct it). So a
  dense list says how tall it is, and the declared fallbacks stay honest because that sum is
  what a content-sized Host gets.
- **Unhosted controls are untouched.** The hosted path is a branch on the direct parent, taken
  or reverted on attach and detach, and every case in §3–§7 runs unchanged for a control with
  any other parent — which is the regression `Switch.harness` and `Sizing.harness` keep true.
