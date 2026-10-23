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
  turn, batched, with a per-turn budget of synchronous updates.

A control's size therefore arrives in two steps — a guess that is laid out immediately, and the
measured size that replaces it before the frame is drawn where the platform allows. The guess is
never arbitrary: it is the platform's documented control size, declared by the component itself.

## 2. The three pieces

| Piece                                          | Lives in                          | Does                                                                      |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Shadow node + state                            | `cpp/NitroUiIntrinsic.hpp`        | Answers `measureContent` from cache → state → fallback; stores the policy. |
| Engine: cache, ledger, fallbacks, flush        | `cpp/NitroUiSizingEngine.{hpp,cpp}` | Decides who needs correcting, batches it, times itself.                  |
| Host integration                               | `cpp/core/NitroUiSizing.hpp` + hosts | Reports measured sizes, flushes at the frame boundary, invalidates on environment change. |

The lookup in `measure` is `cache → state → fallback` (`cpp/NitroUiSizingEngine.cpp:184`):

1. **cache** — a size already learned for this exact configuration in this environment. Exact.
2. **state** — the size the engine pushed into *this node's* Fabric state for this configuration. Exact.
3. **fallback** — the component's declared size, keyed by component only. Inexact by construction:
   it carries an empty key, so `valid()` can tell a guess from an answer.

Every answer is recorded in a per-instance **ledger**. That is what makes a warm mount free: when a
host later reports a size, `report()` looks at the ledger, sees the instance was laid out at the
size it just measured, and drops the report without queueing anything
(`cpp/NitroUiSizingEngine.cpp:272`).

`flush()` (`cpp/NitroUiSizingEngine.cpp:321`) applies the queued reports as one batch: it corrects
**every** instance that was laid out for the configuration a report answers for, keeps at most
`kImmediateBudgetPerTurn` (2) of them synchronous, batches the rest, ignores changes under 0.5
dp/pt, and returns whether anything changed — Android's `OnPreDrawListener` uses that to cancel a
frame whose layout was stale.

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

## 4. The first mount, counted

A cold Switch on iOS, counters as deltas (`example/__tests__/Sizing.harness.tsx`):

1. JS mounts with `nuiSizingKey=""`, `nuiSizingId=n`, and no size.
2. `measure` finds nothing cached and answers the declared fallback (61×28). Ledger: inexact.
3. The host lays out at 61×28, then measures the real `Toggle(.switch)`: 61×28. It reports.
4. `report()` sees an inexact ledger → queues one report.
5. End of turn: `flush()` corrects the ledger's instances to 61×28 — the same numbers, and that is
   the point. One state update, immediate, and the node is now **exact**, so every later instance of
   that configuration costs nothing.

The first instance of a configuration pays exactly one state update per environment even when the
guess was right, because the state has to learn the size. Every later one is free: pre-warmed or
already-measured, `report()` drops it (measured: 200 warm Switches = 0 corrections, 200 dropped
reports).

## 5. Opting in

Four things, all of which a component already has reasons to write:

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
   what it hosts, and on iOS which OS's control size applies. A real measurement overwrites it; it is
   only ever the first frame's guess, and it has to be a good one (a box smaller than the control
   makes SwiftUI paint outside it — T10's `docs/architecture/core.md` §7 has the hit-test story).
3. **Send the two props** from the JS wrapper: `nuiSizingKey` (the size-affecting props, variant
   only) and `nuiSizingId` (a module-level counter per mounted instance). They are declared in
   `src/core/NitroUiIntrinsicProps.ts` and are `@internal`: users never pass them (D14). The
   interface is *not* a `.nitro.ts` file — nitrogen prints "No specs found" for a spec file with no
   specs, and a plain `.ts` interface resolves and flattens into the props just the same (R10).
4. **Report the measured size** from the host when it changes (`NitroUiSizing.report(id, w, h, policy)`),
   and call `NitroUiSizing.invalidateEnvironment()` when the environment changes
   (`traitCollectionDidChange` / `onConfigurationChanged`).

Then drop any default-size style: `SELF_SIZING_BASE_STYLE` in
`src/components/Switch/Switch.tsx:91` is only `{ alignSelf: 'flex-start' }`. See the trap in §6.

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

### Environment epoch

`invalidateEnvironment()` bumps an epoch that is part of every cache identity, and clears the cache
and the ledger — every size in there was measured under a text size, density or OS control size that
may no longer apply. It deliberately **keeps the declared fallbacks**: a component declares its size
once per process, and dropping it would leave the next first mount with nothing to lay out (0×0)
until a measurement arrived. Measured, and covered by `scripts/native-tests/sizing.test.cpp`.

The first mount after an environment change therefore lays out at the declared size, measures, and
corrects. Nothing cached survives the change to be wrong forever.

### Policies

`POLICY_INTRINSIC` — the control's intrinsic size is its size: Switch, Button, SegmentedControl.
`POLICY_FILL_WIDTH` — width comes from the Yoga box when it is finite, height stays intrinsic:
Slider, linear Progress, wheel Picker (`cpp/core/NitroUiSizing.hpp:28`). The control declares the
policy when it reports; the shadow node applies it. A component whose width is decided by its parent
must use `fillWidth`, or it will fight the parent for its own preferred width.

## 6. Traps (each one measured, each one cost someone an hour)

- **A correction writes an explicit size, and an explicit size stops the cross-axis stretch.** Yoga
  stretches a child on the cross axis only while its size there is *undefined*; once the engine has
  written a height, `alignItems: 'stretch'` has nothing to fill. That is why the base style is
  `alignSelf: 'flex-start'` — without it, a parent's default stretch would widen a Switch into a
  300 pt box and the control would sit centred in it. The consequence, measured on both platforms:
  `style={{ flex: 1 }}` in a 300×60 row gives **300×28 on iOS / 300.19×48 on Android** — the axis
  flex applies grows, the control's own size holds the other. A caller who wants the fill asks for
  it with `alignSelf: 'stretch'` (measured: 300 wide, control height kept). Stock RN's `Switch`
  behaves differently here; this is a deliberate trade, not an oversight.
- **Never push a Fabric state update while holding the engine lock.** A push can come straight back:
  the commit re-layouts, `measureContent` calls `measure`, and `std::shared_mutex` is not recursive.
  `flush()` therefore collects under the lock and pushes after dropping it
  (`cpp/NitroUiSizingEngine.cpp:345`). Deadlocked once, on a device, in a harness run.
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
| `sizingStats()`                  | counts + timings: cached sizes, epoch, measures, reports queued/dropped, corrections immediate/batched, flushes, `maxFlushMs`, `staleFramesSkipped`. |
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

`staleFramesSkipped` counts flushes that changed a size. On Android that is exactly the number of
frames that were cancelled; on iOS it is not evidence of a skipped frame (see the comment at
`cpp/NitroUiSizingEngine.cpp:336`) — the `drew` samples are. Renaming it to something platform-neutral
(`changedFlushes`) is worth doing before this is published.

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
| font scale 1.3 / Dynamic Type XL | unchanged size                 | unchanged size                |

Ranges are the spread across the runs in the report. The Android ones are wide because another
task's device work shares this machine (D13): its cold-batch flush measured 8.5 ms on a quiet
machine and 17.9–24.2 ms under load, so read the Android rows as an order of magnitude, not a
number. Read them all as *the mount dominating, not the sizing*: on iOS the correction path is
invisible inside mount noise, and Android's cold batch costs a few ms more per instance while
paying ~1 frame in one pre-draw flush. T02's bench harness is not merged, so these are core perf
clock deltas (`nitroUiCore.now()`, D1) around a render, not published benchmark numbers.

## 8. `prewarm`

`prewarm(['NitroUiSwitch'])` (exported, `src/NitroUiCore.ts`) adopts each component's *declared*
size as this environment's cached answer for the default configuration, so the first mount is exact
and costs no correction. Returns how many it seeded; an unknown name costs nothing and counts zero,
which makes the list safe to keep in an app that upgrades the library.

Limits, stated plainly:

- it seeds the **empty variant** only. A component whose size depends on its props (a Button's title)
  has more than one configuration, and pre-warming those needs a per-component list of keys — the
  brief's `prewarmKeys` — which nothing has needed yet, because the only self-sizing component so far
  has one variant.
- it is a declared number, not a measurement. It cannot make a layout worse: a wrong guess is
  corrected exactly like a cold mount.
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
- It does not shrink a control into a smaller box on request. Yoga still owns layout: a caller's
  `width`, `height` or `flex` wins, unchanged (`example/__tests__/Sizing.harness.tsx`).
