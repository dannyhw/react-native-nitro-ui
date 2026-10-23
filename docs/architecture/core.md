# The core runtime — how to build a component

The contract every component follows, from T10 (the Switch tracer bullet) and `docs/research/core-architecture.md`; where
the two disagree this file describes what the code does, and every claim has a `file:line` you can check. Everything is
one package (`react-native-nitro-ui`, D6) — the core is inside it, not a separate `@nitro-ui/core`.

**Read the reference implementation first** — Switch is the model to copy, not reinvent: `Switch.nitro.ts`,
`NativeNitroUiSwitch.ts` and `Switch.tsx` in `src/components/Switch/`, `ios/components/Switch/HybridNitroUiSwitch.swift`,
`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSwitch.kt`, `example/src/SwitchScreen.tsx`. Building Slider
(T12)? §11 as well as everything here. Progress (T13)? §12, which also lists what you must *not* copy.

## 1. Layout

| Layer   | Core                                                                                                     | Component                                                |
| ------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| JS      | `src/core/` (`useStableCallback`, `useControlled`, `useProcessedColor`), `src/NitroUiCore.ts`            | `src/components/<Name>/` (`<Name>.tsx`, `Native<Name>.ts`, `<Name>Config.ts`) |
| Spec    | `src/NitroUiCore.nitro.ts`                                                                             | `src/components/<Name>/<Name>.nitro.ts`                  |
| iOS     | `ios/core/` (`NitroUIContent`, `NitroSwiftUIHost`, `NitroUiModel`, `NitroUiMainThread`, `UIColor+NitroUiColor`) | `ios/components/<Name>/HybridNitroUi<Name>.swift`        |
| Android | `android/.../nitro/nitroui/core/` (`NitroComposeHost`, `NitroUiModel`, `NitroUiPerf`)                    | `android/.../nitro/nitroui/HybridNitroUi<Name>.kt`       |
| C++     | `cpp/HybridNitroUiCore.{hpp,cpp}`, `cpp/core/NitroUiClock.hpp`, `cpp/core/NitroUiPerf.hpp`, `cpp/NitroUiPropsCompat.hpp` | —                                             |

The Kotlin Hybrid View stays in package `com.margelo.nitro.nitroui`, not a subpackage — the generated manager resolves it
through a wildcard import of exactly that package (`nitrogen/generated/.../HybridNitroUiSwitchManager.kt:17`). Core
helpers may live in `...nitroui.core`. Keep the KDoc above it free of text that reads like a package or class declaration:
RN's Android autolinker matches text, not code (§10).

## 2. One instance, one host

Each Hybrid View owns exactly one host, created with it and never replaced.

- **iOS** — `NitroSwiftUIHost<Content>` (a `UIView`) owns one `UIHostingController<NitroUiRoot<Content>>`, built in `init`
  (`ios/core/NitroSwiftUIHost.swift:88-109`). `rootView` is never reassigned and the content type stays concrete — no
  `AnyView`, so SwiftUI keeps structural identity (`ios/core/NitroUIContent.swift:22-25`). The hosted view is framed to
  the Yoga box, not constrained (`ios/core/NitroSwiftUIHost.swift:118-128`), safe area is disclaimed twice
  (`ios/core/NitroSwiftUIHost.swift:105-107`, `ios/core/NitroUIContent.swift:44`) and its background is clear.
  `needsContainment` is only for controls that *present* UI (menus, pickers) — Switch sets it `false`
  (`ios/components/Switch/HybridNitroUiSwitch.swift:99-101`); the containment walk skips nav/tab controllers
  (`ios/core/NitroSwiftUIHost.swift:293-304`).
- **Android** — `NitroComposeHost<M>` is a `FrameLayout` with one `AbstractComposeView` child, added in `init` and given a
  fixed `Content()` (`android/.../nitroui/core/NitroComposeHost.kt:140-170`). The wrapper is load-bearing: RN measures a
  view before it has a window, and `AbstractComposeView.onMeasure` is `final` and resolves the window's `ViewRecomposer`, so
  a host that *is* the Compose view dies inside a `Modal` (§10). The host's own `onMeasure`/`onLayout` decline while detached
  and run that measure at the first moment there is a window *and* a frame (`:278-332`). Lifecycle and saved-state owners are
  filled only where the view has none, each gap separately (`:248-262`); the composition ends via
  `DisposeOnLifecycleDestroyed` (`:140-144`) plus `disposeComposition()` in `drop()` — §6 says when that runs. The M3 theme
  is `remember`ed per `(context, dark)`, not per instance (`:386-402`).

`grep -n "rootView ="` (iOS) and `grep -n "setContent"` (Android) may only ever hit init paths: no props update may
re-create a host, its controller, its composition or its `Recomposer`.

## 3. Props: store, mark, commit once

```
Fabric updateProps / updateState
  └─ beforeUpdate()
       setter per changed prop → write the model, host.markDirty()
     afterUpdate()             → reconcile the controlled value, host.commit()
```

- Setters **only** store and mark dirty. `commit()` applies the batch and invalidates the UI **once** per React commit:
  one `model.objectWillChange.send()` (`ios/core/NitroSwiftUIHost.swift:162-194`) / one
  `Snapshot.sendApplyNotifications()` (`android/.../nitroui/core/NitroComposeHost.kt:207-214`).
- Bookkeeping props (the controlled value's JS copy, `mostRecentEventCount`, callbacks) must not mark dirty, so an
  interaction costs zero re-renders. **Anything rendered must mark dirty** — including `accessibilityLabel`
  (`ios/components/Switch/HybridNitroUiSwitch.swift:189-196`, `android/.../HybridNitroUiSwitch.kt:211-222`): stored
  without a commit, a label never reaches VoiceOver/TalkBack and no screenshot can show it.
- iOS `NitroUiModel` is an `ObservableObject` with a **manual** `objectWillChange` — `@Published` would fire per write
  (`ios/core/NitroUiModel.swift:25-31`). Android's model uses `mutableStateOf` only for what renders and keeps logic-only
  fields plain (`android/.../HybridNitroUiSwitch.kt:33-59`). Never replace or rebuild the model.

**Android calls `updateState` twice for every newly created view** (measured in T02 round 3: `propsApplied` = 2.00 per
instance on `mount`, 1.00 on `update`; iOS is 1.00 everywhere). Both deliveries are RN Fabric's doing, not the
component's: `ViewManager.createViewInstance` applies the state once (`ViewManager.java:231-236`), and
`FabricMountingManager.cpp:760-766` then emits an `UpdateStateMountItem` for every **Insert** of a view that has state,
so the generated `HybridNitroUi<Name>Manager.updateState` runs again with an unchanged props snapshot. Nitro's generated
manager does not short-circuit that second call: it runs `beforeUpdate → updateViewProps → afterUpdate`, the props diff
applies no setter (the old snapshot from `holder.lastState` equals the new one), and `afterUpdate` → `host.commit()`
makes one unconditional mark plus one no-op `reconcile()`. Cost per mount: one extra JNI props diff, one `reconcile()`,
one perf mark. **Read `propsApplied` = 2.00 on Android mount as the architecture's floor, never as a component
regression** — every future Android component will show it. Upstream N5; a generator-side short-circuit (skip when the
snapshot equals `lastState`) is the fix and belongs to whoever touches the generated path (T12), not to components.

The JS side guarantees the batching preconditions:

- **Callbacks keep one identity forever.** `useStableCallback` builds `{ f: … }` once per mounted view and swaps only the
  ref it reads (`src/core/useStableCallback.ts:49-61`); an inline `callback(…)` in JSX changes identity every render and
  re-applies the prop (lint `no-inline-callback-in-jsx`).
- **No optional spec props** (nitro#1184, D7, upstream N2): Fabric sends `null` for a removed prop and Nitro treats only
  `undefined` as unset, so every prop is `T | null` and the wrapper always sends all of them (lint
  `no-optional-view-props`).
- **Callbacks are the exception, and `| null` is not an alternative** (D7b, upstream N3): RN cannot send a function, so
  Nitro sends `{ f: fn }` and unwraps `f` only when the prop type *is* a function (`IsFunctionProp`). `fn | null`
  generates `variant<std::function, NullType>`, which is not a function type: the wrapper is never unwrapped and
  converting the prop throws while mounting. Declare `fn?` and never send `null` while the view is mounted —
  `useControlled` always keeps one, even with no user handler (`src/core/useControlled.ts:115-119`). Same for `hybridRef`.

### Colours

Process once in JS (`useProcessedColor`) and travel as an ARGB `number | null`. **Decode the bits, never the sign** (D10):
iOS `processColor` is *unsigned* (`>>> 0`) and Android's is *signed* (`| 0`) today, so opaque `#FF5733` arrives as
`4292877107` on iOS and `-110652` on Android. A decode that range-checks (`Int32(exactly:)`, or Kotlin `toInt()` on a
double above `Int.MAX_VALUE`) silently drops every opaque iOS colour and the control keeps the platform accent — no error,
just a wrong colour.

- iOS: accept both halves, then truncate — `ios/core/UIColor+NitroUiColor.swift:16-27` (guard `:17`,
  `UInt32(truncatingIfNeeded:)` `:20`); the inverse getter returns unsigned, like iOS `processColor` (`:30-44`).
- Android: `raw.toLong().toInt()` (`android/.../HybridNitroUiSwitch.kt:188-199`, the write at `:193`). `Double.toInt()`
  saturates — the mirror-image latent bug: Android is signed today so it never fires, and one RN change to unsigned would
  make every opaque colour `Int.MAX_VALUE`.
- Each platform's getter returns what *its own* `processColor` produces, so JS can round-trip a colour by comparing sent
  with read (`example/__tests__/Switch.harness.tsx:304-321`).
- A colour with no integer form (iOS dynamic provider) becomes `null` in JS with a dev warning
  (`src/core/useProcessedColor.ts:19-34`). Do not try to rescue it natively.

### testID and accessibility

- **`testID`** — RN already puts it on the iOS component view as `accessibilityIdentifier`, so iOS hosts do not set it
  again (`ios/components/Switch/HybridNitroUiSwitch.swift:170-180`): that would match a testID query twice. Android has no
  such pipeline for a Compose child, so the prop is required and lands on `host.tag`
  (`android/.../HybridNitroUiSwitch.kt:201-209`), which is what the harness and `findNodeByName` read.
- **Labels belong on the control, never on the container** (review SF2). Android: `Modifier.semantics { contentDescription
  = label }` on the M3 `Switch` itself (`android/.../HybridNitroUiSwitch.kt:92-98`) — the node TalkBack focuses, because
  M3 gives it `Role.Switch`. On the container instead, the actionable switch announces "Switch, off" with no name *and*
  the empty box becomes a second focus stop. iOS: `content.accessibilityLabel(label)` on the hosted element, only when
  set, since an empty label would silence the Toggle's own (`ios/components/Switch/HybridNitroUiSwitch.swift:79-89`,
  applied `:57`). Both are rendered state: store + `markDirty()` (§3) or a late-set label never renders.
- **Gaps you must not paper over** (review NIT7): `Switch` does not forward `ref` and does not map
  `aria-label`/`aria-disabled` — only `accessibilityLabel`/`disabled` reach the control
  (`src/components/Switch/Switch.tsx:16-63`). Because the wrapper spreads leftover `ViewProps` onto the Fabric container,
  a caller setting `accessible`/`accessibilityRole` there can turn it into an accessibility element and hide the hosted
  control from VoiceOver. In a new component: keep labels on the control, and either strip those container a11y props from
  the spread or document container-level a11y as unsupported — never mirror a container label onto the control "to be
  safe" (the double-announcement bug again).

## 4. Controlled values (the event-count handshake)

`src/core/useControlled.ts` plus `NitroUiControlledValue` on each platform (`ios/core/NitroUiModel.swift:40-72`,
`android/.../nitroui/core/NitroUiModel.kt:40-73`):

- Native owns the *displayed* value and writes it immediately on interaction — no visual latency, and an uncontrolled
  control costs no React render at all.
- Native emits `(value, eventCount)`; JS calls the user's handler and echoes `eventCount` back as `mostRecentEventCount`
  in the same commit — *before* the user's handler, so a handler that throws cannot strand native
  (`src/core/useControlled.ts:102-113`).
- Native accepts a `value` write only once it has seen at least that many of its own events: `jsEvents >= nativeEvents`
  (`ios/core/NitroUiModel.swift:65-71`, `android/.../nitroui/core/NitroUiModel.kt:66-72`). That covers rejected changes
  (JS kept its value, so the prop is unchanged but the count moved → still a commit → native reverts), stale writes (a
  `value` in flight is ignored) and uncontrolled mode (`value === null`).
- `defaultValue` seeds an uncontrolled control once, then is ignored
  (`ios/components/Switch/HybridNitroUiSwitch.swift:126-141`, `android/.../HybridNitroUiSwitch.kt:152-165`).
- Uncontrolled → controlled is supported but warned: JS remembers counts in both modes and seeds the echo on the flip
  (`src/core/useControlled.ts:59-74`), since otherwise every later `value` write looks stale until the next tap.

There is no accessibility *value* query in the harness, so the revert case is tested with a tap-twice oracle: after a
rejected change, the next tap must report the pre-tap value again (`example/__tests__/Switch.harness.tsx:347-372`). The
section is opt-in — a component with no user-editable value skips it (§12).

## 5. Threading, `hybridRef`, and future imperative methods

- Host code is main/UI thread only; `nitroUiAssertMainThread()` guards entries (`ios/core/NitroUiMainThread.swift:14-20`).
- A Hybrid View method callable from JS must not touch SwiftUI/Compose, so `measureContent()` reads a **cached** size
  written on main during the last layout/commit — `NSLock` + `CGSize?` (`ios/core/NitroSwiftUIHost.swift:60-75`),
  `@Volatile` (`android/.../nitroui/core/NitroComposeHost.kt:107-109`).
- Never a synchronous JS↔main round trip in the props path; never `DispatchQueue.main.sync` (it can deadlock against JS);
  no redundant `main.async` hop when already on main.

**`hybridRef` is a diagnostic handle, not an API** (D14). v0.1 publishes no Hybrid View types — `src/index.ts:1-15`
exports components and the clock only — and `hybridRef`/`nuiPerfId` are `@internal`, for this repo's harness and
benchmarks (`src/components/Switch/Switch.tsx:33-62`). The typed handle is **read-only**
(`src/components/Switch/NativeNitroUiSwitch.ts:20-40`): reading props and calling `measureContent()` is all it is for.

- **Every prop write goes through React.** A direct write runs the Swift/Kotlin setter on the JS thread, mutates
  unsynchronised model state the UI thread owns (UIColor/`String` retain races, `View.tag` off the UI thread), and never
  commits — Nitro calls no `afterUpdate` for a direct write, so nothing renders. "It looked like it worked" is the worst
  outcome: state diverged silently.
- **Rule for a future imperative method** (e.g. `Slider.setValue`): make it a *method*, not a prop write, and give it an
  explicit hop plus a commit — iOS `DispatchQueue.main.async { write; host.markDirty(); host.commit() }`, Android
  `view.post { … }`. Until that hop exists, a method may only read caches. Never hop implicitly from a setter.
- **A changed `hybridRef` function is never re-invoked**: it is a callback prop, so it fires when the view mounts and a
  new closure later changes only what `useStableCallback`'s ref points at (`src/core/useStableCallback.ts:49-61`). Treat
  it as one-shot. (Its identity comes from `useMemo`, which React may discard — `useState(() => …)` is the guaranteed
  form; a lost memo costs one re-sent prop, not correctness.)

## 6. Recycling and drop

### Android: opt-in twice, and the composition does not survive it

A view is only ever reused when **both** switches are on:

1. the Hybrid implements `RecyclableView` — that is what makes the generated manager call `setupViewRecycling()` at all
   (`nitrogen/generated/.../HybridNitroUiSwitchManager.kt:31-36`);
2. `ReactNativeFeatureFlags.enableViewRecycling()` is on — **`false` by default** in RN 0.88
   (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/internal/featureflags/ReactNativeFeatureFlagsDefaults.kt:120`),
   and `ViewManager.setupViewRecycling()` allocates the pool only under that flag
   (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ViewManager.java:67-71`).

With the flag off — the default — the pool is `null`, `getRecyclableViewStack` returns `null`
(`.../uimanager/ViewManager.java:79-86`) and **every `onDropViewInstance` is a real unmount**. Recycling is a feature of
the host app, not of this library: never assume your view was recycled.

When both are on, the order is fixed by RN plus generated code. `ViewManager.onDropViewInstance`
(`.../uimanager/ViewManager.java:245-273`) is the method that pushes to the pool, and it calls `prepareToRecycleView`
inside itself (`:267-272`). The generated override calls `hybridView.onDropView()` **first** and only then
`super.onDropViewInstance(view)` (`nitrogen/generated/.../HybridNitroUiSwitchManager.kt:66-71`); `prepareToRecycleView`
then calls `hybridView.prepareForRecycle()` (`:73-91`). So `drop()` → `disposeComposition()`
(`android/.../nitroui/core/NitroComposeHost.kt:241-244`) runs *before* `prepareForRecycle()`: **the composition does not
survive a recycle** — the next attach runs a measure (`:172-190`), and Compose builds a new composition there, reading the
reset model from scratch.

What recycling still saves: the `View`, the Hybrid Object, the host, the model, the activity/owner wiring from
`onAttachedToWindow`, and the composition **strategy** stored on the view (`DisposeOnLifecycleDestroyed`). What it does
not: the composition, the `Recomposer`, `NitroUiTheme`'s `remember`ed colour scheme (per composition), and any animation
in flight — which is why `prepareForRecycle()` re-arms first-frame marking and the other per-mount flags
(`android/.../nitroui/core/NitroComposeHost.kt:222-229`). The dispose is deliberate: not disposing in `drop()` leaks a
composition on every real unmount, and with the flag off every unmount *is* real. Keeping the composition alive is T02's
measurement with the flag on, not an assumption made here.

### iOS: same hooks, deeper reuse

`onDropView()` runs once per mount on both exits and never twice: the generated view guards it with `_didDropView` and
calls it from `prepareForRecycle` and `invalidate`
(`nitrogen/generated/ios/c++/views/HybridNitroUiSwitchComponent.mm:74-82`, `:178-189`), and RN's registry runs one or the
other on unmount — `prepareForRecycle` when it pools the view, `invalidate` when the class refuses or the pool is full
(`node_modules/react-native/React/Fabric/Mounting/RCTComponentViewRegistry.mm:104-118`). `+shouldBeRecycled` reports
whether the Hybrid implements `RecyclableView` (`nitrogen/generated/ios/.../HybridNitroUiSwitchComponent.mm:174-176`).

Reuse goes further than Android because there is no composition to dispose: the component view, the Hybrid Object, the
model, `NitroSwiftUIHost`, its `UIHostingController` — root view included — and the SwiftUI state are all kept. `drop()`
only detaches containment and clears cached measurements (`ios/core/NitroSwiftUIHost.swift:213-221`);
`prepareForRecycle()` resets the model and re-arms animation suppression, first-frame marking and a size re-measure
(`ios/core/NitroSwiftUIHost.swift:196-206`). **An iOS recycled view keeps its composition; an Android one does not.**
Don't write a component that behaves differently because of it: both sides must be correct after a bare
`prepareForRecycle()` reset.

### Rules for both platforms

- `RecyclableView` is mandatory for anything that can live in a list.
- Everything a setter writes appears in the reset — iOS lists it in `prepareForRecycle()`
  (`ios/components/Switch/HybridNitroUiSwitch.swift:223-233`), Android in `model.reset()`
  (`android/.../HybridNitroUiSwitch.kt:61-73`). A leaked `testID`, label or tint between rows is a bug.
- `onDropView()` releases what must not outlive a mount: callbacks first (they hold JS refs), then host caches
  (`ios/components/Switch/HybridNitroUiSwitch.swift:235-238`, `android/.../HybridNitroUiSwitch.kt:265-268`). It runs
  before the reset and, on Android, is also the unmount path — cheap, and it must not destroy the host.
- Re-arm every per-mount flag (animation suppression, `firstFrame`, cached content size).

## 7. Sizing (until T11)

A Nitro Hybrid View is a plain Yoga leaf: with no style it is 0×0. T11 adds the intrinsic-size shadow node; meanwhile the
JS wrapper applies a default box (`style={[DEFAULT_SIZE, style]}`, user style wins,
`src/components/Switch/Switch.tsx:131`). The default must be the control's real layout size, and on iOS that is
**OS-versioned** (`src/components/Switch/Switch.tsx:98-104`, D14):

| Platform | Default box | Why                                                              |
| -------- | ----------- | ---------------------------------------------------------------- |
| iOS ≥26  | `61 × 28`   | SwiftUI `Toggle(.switch)` lays out at 61×28 pt from iOS 26.      |
| iOS <26  | `51 × 31`   | The pre-26 control (UIKit `UISwitch` size) is 51×31 pt.          |
| Android  | `52 × 48`   | M3 `Switch`: 52×32 dp track inside a 48 dp minimum touch target. |

Getting this wrong is not cosmetic. SwiftUI refuses to shrink into a smaller box: it overflows, centred, and nothing clips
it (`clipsToBounds` is false) — but `RCTViewComponentView` hit-tests to its bounds unless `hitTestEdgeInsets` widens them
(`node_modules/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:181-189`). The control
paints outside its Fabric box, the outer few points of each end are dead to touches, and neighbouring layout is off by the
overflow: T10 measured a 51 pt box around a 63 pt painted track on iOS 26/27, ~6 pt dead at each end. Too *big* is quieter
but equally wrong: dead padding swallows taps beside the control. T11 replaces the constant, not the plumbing — hosts
already report a measured size.

Measurement cadence — this is where sizing costs performance:

- **iOS**: `wantsContentSize` is off by default (`ios/core/NitroSwiftUIHost.swift:51-56`). When a component turns it on
  (`ios/components/Switch/HybridNitroUiSwitch.swift:105`), `sizeThatFits(in: .infinity)` runs once per **bounds change,
  size-affecting trait change, first commit, or `invalidateContentSize()`** — never per commit
  (`ios/core/NitroSwiftUIHost.swift:242`, `:190-193`, `:118-125`, `:140-148`). Content that can change size with neither
  (`Picker`'s longer selected title, a re-wrapped label) must call `invalidateContentSize()`
  (`ios/core/NitroSwiftUIHost.swift:225-234`) or the cache keeps the old size.
- **Android**: one `measure()` call per pass, asked with **the minimum dropped** —
  `constraints.copy(minWidth = 0, minHeight = 0)` (`android/.../nitroui/core/NitroComposeHost.kt:443-465`, measure at
  `:446-449`, record at `:364-373`). The recorded size is then the control's **intrinsic** size — 52 × 48 dp for the M3
  Switch even inside a 90 × 50 box — and the control is centred with a real offset. Passing the incoming constraints
  through does *not* work: the host lays the composition out `MATCH_PARENT`, Fabric measures the host `EXACTLY`,
  `AndroidComposeView` turns `EXACTLY` into `minWidth == maxWidth`, and a `Placeable`'s size is always coerced into its
  constraints — so that version reports the box back and the centring offset is always 0. Asking the question twice is
  also not available: a `Measurable` may be measured exactly once per pass (`MeasurePassDelegate` throws
  "measure() may not be called multiple times").
  So the Android answer is intrinsic **up to the box maximum** (content can never be recorded bigger than its box), while
  iOS asks the unbounded `sizeThatFits(in: .infinity)` in a pass of its own and can therefore report an oversized
  control. Content whose intrinsic size may exceed its box (a re-wrapped label, a longer selected `Picker` title) still
  needs the unbounded question asked outside this layout pass, which is T11's design
  (§11 of `docs/tasks/T11-intrinsic-sizing.md`). Material's 48 dp touch target is inside the recorded size by design.
- The cached size crosses threads, so it is immutable behind a lock/`@Volatile` (§5), and `measureContent()` never touches
  SwiftUI/Compose.

## 8. Perf marks

`cpp/core/NitroUiPerf.hpp` is a header-only ring shared by C++, Swift (C++ interop) and Kotlin (JNI), so every entry point
takes plain integers. A host with `nuiPerfId >= 0` records `propsApplied` and `firstFrame`;
`nitroUiCore.setPerfEnabled(true)` starts recording (and clears), `nitroUiCore.drainPerf()` takes everything. Times are ms
in the D1 base (`CLOCK_UPTIME_RAW` / `CLOCK_MONOTONIC`, `cpp/core/NitroUiClock.hpp:34-47`) — the same base as
`CADisplayLink` and Choreographer, so marks are comparable with frame clocks.

The two marks differ per platform — know which you are reading:

- **`propsApplied`** — iOS marks *every* commit (`ios/core/NitroSwiftUIHost.swift:162-169`, before the dirty check), and
  `afterUpdate`/`commit` only run when the props snapshot actually differs
  (`nitrogen/generated/ios/c++/views/HybridNitroUiSwitchComponent.mm:96-99`). Android marks every
  `updateState` too, before its own dirty check (`android/.../nitroui/core/NitroComposeHost.kt:207-214`), so both platforms
  count `updateState`s rather than one counting updates and the other visible updates. Neither mark implies pixels.
- **`firstFrame`** — iOS: the first layout with non-empty bounds while in a window
  (`ios/core/NitroSwiftUIHost.swift:269-275`, driven by `layoutSubviews`/`didMoveToWindow`). Android: the first pre-draw
  after attach, via a self-removing `OnPreDrawListener`, because `AbstractComposeView.onLayout` is final
  (`android/.../nitroui/core/NitroComposeHost.kt:339-362`). **Neither is a GPU-completed frame**: they answer "props
  landed on the UI thread" and "the UI thread produced display content"; for a real frame boundary use T02's `BenchProbe`.
- Both re-arm on recycle and drop, or a list reports nothing after the first mount.

`drainPerf()` consumes the buffer, so a polling test must accumulate what it read or the first poll eats the marks it
waits for (`example/__tests__/Switch.harness.tsx:487-500`). **Cost, exactly:** each host gates mark sites on its instance
id (`ios/core/NitroSwiftUIHost.swift:277-284`, `android/.../nitroui/core/NitroUiPerf.kt:23-29`), so an unmarked view pays
one integer compare and never enters the ring; a marked view with recording off pays one relaxed atomic load
(`cpp/core/NitroUiPerf.hpp:71-79`, `:57-60`). With recording on it is a mutex-guarded ring, not a lock-free queue — on
purpose: marks are diagnostics a benchmark enables for one run, a handful per commit, and lock-free would buy nothing
measurable while being much harder to prove correct (`cpp/core/NitroUiPerf.hpp:9-16`).

## 9. Checklists for a new component

### Build

1. `src/components/<Name>/<Name>.nitro.ts` — props `T | null` (callbacks `fn?`), methods,
   `HybridView`/`HybridViewMethods`; then `bun run nitrogen`.
2. `Native<Name>.ts` + `<Name>Config.ts` (Switch: `NitroUiSwitchConfig.ts`) — host component; every spec prop required in
   the wrapper's prop type, callbacks typed `{ f: Fn }`. That hand-written copy of the generated config (its
   `validAttributes`) is drift-checked against `nitrogen/generated/shared/json/` by `src/__tests__/viewConfigs.test.ts`.
3. `<Name>.tsx` — friendly props, `useControlled` (only if it has a value), `useProcessedColor`, `useStableCallback`,
   `style={[DEFAULT_SIZE, style]}` with a per-OS-correct default (§7), and an `@internal` read-only `hybridRef` only if
   the harness needs one (§5).
4. `ios/components/<Name>/HybridNitroUi<Name>.swift` — model, `NitroUIContent` view, Hybrid View (`Hybrid…Spec,
   RecyclableView`).
5. `android/.../nitroui/HybridNitroUi<Name>.kt` — the same three pieces on Compose, in the package named in §1.

### Register

6. Native registration: generated manager into `NitroUiPackage.createViewManagers`
   (`android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt`) and the view entry into `nitro.json`'s
   `autolinking` map; then `bun run nitrogen` (which also applies `scripts/patch-nitrogen.mjs`) and `bun run
   nitrogen:check`.
7. `export { <Name>, type <Name>Props }` in `src/index.ts`; then `bun run api-extractor` and **commit**
   `etc/react-native-nitro-ui.api.md` (`api-extractor:check` is in the gate). An `ae-forgotten-export` warning means a
   public type names something unexported — mark internals `@internal` (D14) instead of exporting them.
8. One import and one JSX line in `scripts/smoke/App.tsx` (`scripts/smoke/App.tsx:62-65`): it renders every exported
   component exactly once with a `SMOKE-<name>` testID and is typechecked, so a public-API rename fails the gate here, not
   10 minutes into a smoke run.
9. `docs/components/<name>.md` — API table, platform mapping, the sizes you measured, behaviour notes, limits (copy
   `docs/components/switch.md`'s shape).
10. `example/src/<Name>Screen.tsx` (+ its use in `example/src/App.tsx`) and `example/__tests__/<Name>.harness.tsx`.
11. `bun run manifest:update` when files were added — the published list is `etc/package-files.txt` and `manifest:check`
    fails otherwise. Any dev-dependency patch (D5/D11) gets an entry in `docs/upstream.md`.
12. `bun run check` — typecheck, lint, format, unit tests, native handshake tests, nitrogen drift, autolinking, build,
    api-extractor, publint, manifest.

### Test

- **Handshake logic has three twins**, each with its own runner: `src/__tests__/useControlled.test.tsx` (jest, `bun run
  test`), `scripts/native-tests/handshake.test.swift` (host `swiftc`, no simulator, `bun run test:native`),
  `android/src/test/java/com/margelo/nitro/nitroui/core/NitroUiControlledValueTest.kt` (JVM, `bun run
  test:native:android`). Copy the vector set: fresh/uncontrolled, `user()` counts and displays at once, rejected change
  reverts only after the echo, stale write dropped not queued, rapid interaction applies the newest write, first
  controlled write after a mode switch, exact `Double` equality (`scripts/native-tests/handshake.test.swift:105-115`,
  `android/src/test/.../NitroUiControlledValueTest.kt:97`). Change one twin's semantics and you change all three plus the
  vectors, in one commit.
- **On-device harness** (`bun run harness:ios` / `harness:android`; needs a built app, and installs it — see H1 in
  §10). Cover what the Switch suite covers: controlled both ways, rejected revert via the tap-twice oracle, a value
  written from JS, uncontrolled independence, disabled, mount/unmount cycles, many instances, reported content size,
  colour round-trip, perf marks for one instance. Use real taps (`userEvent.press`), never prop writes.
- **Wait for testIDs.** `screen.findByTestId` has no timeout and throws on its first empty pass (upstream H3), so poll the
  non-throwing `queryByTestId` first, then take the harness reference (`example/__tests__/Switch.harness.tsx:106-130`);
  pay one-time process costs in `beforeAll` (`example/__tests__/Switch.harness.tsx:138-148`).
- **Assert a non-event with a barrier, not an empty array.** "The disabled control fired nothing" is evidence only once an
  *enabled* control's event has been awaited: render a barrier Switch, press both, wait for the barrier's event, then
  assert the empty array (`example/__tests__/Switch.harness.tsx:416-451`); the same trick proves a dropped view stopped
  marking (`example/__tests__/Switch.harness.tsx:502-524`). A bare `expect(seen).toEqual([])` right after a press passes
  for an event still in flight.
- A recycled/retained-state case (a row that keeps `disabled`/tint across a recycle) needs its own on-device test: §6 is
  why the platform difference makes it easy to regress.

### Perf contract

- Setters store + mark dirty; exactly one `commit()` per `afterUpdate`/`updateState`; dirty only for rendered changes.
- No host/controller/composition recreation after init (§2); no `sizeThatFits` or intrinsic measure on a commit path (§7).
- No inline `callback()` in JSX; stable callback identities; every spec prop sent.
- No `DispatchQueue.main.sync`, no JS→main sync call, no redundant async hop.
- No per-prop allocation on the hot path: no JSON strings, no `AnyMap`, no new colour/scheme object per prop.
- Narrow recomposition: the fastest-changing value is read by the smallest composable (§11); on iOS keep the hosted body
  cheap enough that a whole-body re-evaluation per commit is trivial.
- An interaction costs zero React renders when uncontrolled (§4) and zero re-applied props (`mostRecentEventCount` and
  callbacks never mark dirty).
- Full recycle reset + `onDropView` cleanup (§6); `bun run check` green.

## 10. Traps T10 hit (so you don't)

- **`{ f: fn }` callbacks** — see §3. Symptom: mounting throws `Cannot convert "[object Object]" to any type in
  variant<...>` and the view never shows up in any query.
- **Swift `internal`, not `public`.** A public Swift type in this pod lands in `NitroUi-Swift.h`, whose C++ thunks do not
  import `Combine`, so `ObservableObject` fails to compile (`use of undeclared identifier 'Combine'`). Nitrogen's
  generated Swift is in the same module, so internal is enough.
- **Kotlin properties have no accessor braces**: `override var x: T { get() … set() … }` is a syntax error.
- **`AbstractComposeView.onLayout` is final** — use a self-removing `ViewTreeObserver.OnPreDrawListener` for a first-frame
  hook. `onMeasure` is final too, and that one is fatal rather than annoying: **RN measures a view before it has a window**
  (a `Modal`'s tree is laid out before `Dialog.show()`), and a detached `ComposeView` answering a measure throws
  "Cannot locate windowRecomposer; View … is not attached to a window" inside the mount batch, which aborts the update and
  kills the app. Hence the `FrameLayout` wrapper plus the decline-and-retry in `onMeasure`/`onLayout`/`runPendingMeasure`
  (`android/.../nitroui/core/NitroComposeHost.kt:278-332`), and a `Modal` test in the on-device suite. Do not "simplify" the
  wrapper away.
- **`DisposeOnLifecycleDestroyed` needs a `LifecycleOwner`** — cast the activity at runtime, do not assume it; and Compose
  needs the `SavedStateRegistryOwner` too, filled separately, because a parent may set one and not the other
  (`android/.../nitroui/core/NitroComposeHost.kt:248-262`).
- **A per-mount flag that is never re-armed** (firstFrame) silently stops reporting for recycled views, which is most of a
  list.
- **`testID` on the hosted content as well as the container** makes `findAllByTestId` return two elements.
- **RN's Android autolinker matches text, not code**: a comment that reads like a declaration can be parsed as the package
  class and break the app build. If `react-native config` output is stale, regenerate
  `example/android/build/generated/autolinking/autolinking.json`.
- **The harness did not reinstall** an app already on the device, so native changes silently did nothing (JS comes from
  Metro, native does not). `patches/@react-native-harness%2Fplatform-apple@1.6.0.patch` makes iOS install every run
  (upstream H1); every such patch gets an entry in `docs/upstream.md` (D11).
- **`screen.screenshot(element)` reports `0×0`** for any element target (upstream H4). Measure with `queryByTestId` from
  the `HarnessUI` TurboModule, as `example/__tests__/Switch.harness.tsx` does.

## 11. Continuous controls — building a Slider

A drag is not a bigger tap. §3-§8 still apply; what changes is that events arrive per frame instead of per gesture.

### Emit at frame rate, not touch rate

Native fires while the finger moves, and a touch stream samples faster than the display. **Throttle natively: at most one
emitted event per frame**, coalesced to the newest value. Never call the JS callback per touch-move: each call is a JS
entry, the user's handler, a React render and a props commit back — at 120 Hz sampling you pay that ~2× per frame while
the UI thread is also trying to draw. Keep a plain "value during this drag" field for the coalesced updates and call
`NitroUiControlledValue.user(value)` **exactly once per emitted event** (`ios/core/NitroUiModel.swift:55-59`,
`android/.../nitroui/core/NitroUiModel.kt:53-58`) — it is what increments `nativeEvents`, and its return value is the
`eventCount` you emit. Calling it per touch-move is the same mistake as emitting per touch-move.

### Split the two callbacks

`onValueChange` during the drag (throttled); `onSlidingComplete` at release with the final value and final event count.
Both are Nitro callback props: `fn?` in the spec (§3), always sent, both through `useStableCallback`, and neither marks
dirty. Do not let JS infer "finished" from a timeout — it drifts.

### The handshake at 60 Hz

JS echoes the **latest** count it processed, not every count (`src/core/useControlled.ts:102-113` keeps a monotonic max),
so intermediate counts are legitimately skipped whenever JS is slower than native. Hence `reconcile` accepts a write as
soon as `jsEvents >= nativeEvents` and must **not** require 1:1 agreement — which is what the twins do
(`ios/core/NitroUiModel.swift:66`, `android/.../nitroui/core/NitroUiModel.kt:68`), and "rapid interaction applies the
newest write" is already a vector in both native suites. Do not "fix" a skipped echo by waiting for equality.

What that costs during a drag, stated exactly: a parent's `value` write is ignored **only while JS lags**. While the
finger keeps moving, native is ahead by design (`jsEvents < nativeEvents`), so `reconcile` rejects the write and the drag
wins — the intended behaviour. But the instant JS has caught up (`jsEvents == nativeEvents`) and the finger is still
down, the next props commit applies a differing `value` mid-drag. A parent that writes something else while the user is
dragging (a value derived from elsewhere, a reset, an animation) therefore does fight the finger, and the thumb jumps
under the hand. Clamping to the in-drag range only hides the fight; it does not decide who wins. If a component must be
immune, gate its own writes while a drag is in flight — the end-of-drag hook below is the signal — and document that
choice. After release the newest echo lands and writes apply normally.

### Where a drag ends, and what the read side returns

- **The read side must return the in-drag value (iOS).** SwiftUI re-reads `Binding.get` whenever the view is invalidated,
  which under the manual publisher (§3) means every emitted frame of the drag. If `get` returns the props value instead
  of the coalesced "value during this drag" field, the thumb renders the *previous* emitted value and trails the finger a
  frame at the exact moment the user is watching. One field is both what `set` writes and what `get` reads — the Switch's
  one-bit version is `ios/components/Switch/HybridNitroUiSwitch.swift:42-51`.
- **The end-of-drag hooks are platform-named, not invented.** SwiftUI: `Slider(value:in:step:onEditingChanged:)`, whose
  callback fires `true` at gesture start and `false` at release. Compose Material 3: `Slider`'s `onValueChangeFinished`,
  which fires at release only — Compose has no start callback, so take "dragging" from the first value change (or
  `pointerInput`). That hook, not a JS timeout (which drifts — §"Split the two callbacks"), is what flushes the final
  value with the final event count, clears the in-drag fields (see §"Recomposition scoping" for the recycle angle), and
  stops ignoring parent writes.
- **Per-frame coalescing needs a real frame source.** Nothing in SwiftUI or Compose emits "at most once per frame" for
  free. Use `CADisplayLink` on iOS (scheduled for the drag, invalidated when it ends and when the view leaves the window)
  or `Choreographer.postFrameCallback` / Compose `withFrameNanos` in a coroutine scoped to the interaction on Android.
  Never a timer: a timer is unrelated to the display, so it emits twice in one frame or skips one, and its values are not
  comparable with frame timestamps in the D1 base (§8).

### Float equality in `reconcile`

Compare exactly — Swift `==` on `Double`, Kotlin `==`, `js != displayed`. No epsilon (`ios/core/NitroUiModel.swift:65-71`,
`android/.../nitroui/core/NitroUiModel.kt:66-72`). It is safe because native computes the value, JS stores and re-sends
the number it received, and Nitro carries `number` ↔ `double` without loss, so the round trip returns the same bits; both
native suites test with `Double` (`scripts/native-tests/handshake.test.swift:105-115`,
`android/src/test/.../NitroUiControlledValueTest.kt:97`). An epsilon is worse than useless: `js != displayed` is also how
a *rejected* change is detected, so a tolerance turns a real small step into "unchanged" (the thumb stops moving) and a
rejected revert into "close enough, keep what the user did" (the control silently lies), and the platforms would pick
different tolerances. Want snapping? **Quantise in native before emitting** — round to the step, emit that — then compare
JS's `value` exactly; re-deriving it in JS with different rounding means native reverts to a value nobody dragged to.

### A native interaction must re-render itself

During a drag no props arrive, so `commit()` never runs: the interaction must invalidate the UI, and the platforms do it
differently on purpose.

- **iOS**: the `Binding` setter writes the handshake value, sends the change, then calls out to JS —
  `model.state.user(requested)`, `model.objectWillChange.send()`, `model.onChange?(...)`
  (`ios/components/Switch/HybridNitroUiSwitch.swift:42-51`, send at `:48`). The `send()` is required: with the manual
  publisher (§3) nothing else invalidates the view. Do **not** route an interaction through
  `host.markDirty()`/`host.commit()` — that is the props path, and it adds a second invalidation plus a perf mark per
  frame. `objectWillChange` invalidates the whole hosted body, so keep it small.
- **Android**: write the snapshot state and stop — `model.state.user(requested)` then `model.displayed = requested`
  (`android/.../HybridNitroUiSwitch.kt:100-106`, write at `:104`). Do **not** call `Snapshot.sendApplyNotifications()`
  there: that call belongs to `commit()` only (`android/.../nitroui/core/NitroComposeHost.kt:207-214`), where its
  documented job is to make a *props* batch land inside the same UI-thread turn instead of waiting for Compose's own
  global apply. The interaction write lands in Compose's **global** snapshot, and the `GlobalSnapshotManager` applies it
  on the next frame — so the control does invalidate without help, one frame later, which is what a drag wants anyway.
  Calling `sendApplyNotifications()` yourself just moves a global apply into the gesture callback.
- Both: emit the JS event **after** the local write, so the control repaints before JS starts work.

### Recomposition scoping

Read a fast-changing value in the narrowest composable that needs it, never at the root of `Component`. Switch's
`Component` reads four model fields (`android/.../HybridNitroUiSwitch.kt:88-116`) — fine for a control that fires per tap,
wrong for a Slider: put track+thumb in a composable that reads only `value` and let labels, legend and layout siblings
read nothing (or only the release-time value), so a drag frame invalidates a handful of nodes. iOS is stricter — one
`objectWillChange` re-evaluates the whole hosted body — so keep expensive siblings (images, formatted lists, nested
subviews) out of it and let a `Canvas`/`Shape` do the moving part. Clear in-flight drag state in `prepareForRecycle()` too
(offsets, the coalesced value, "is-dragging"): a recycled row that resumes somebody else's drag is a real bug, and §6
means Android rebuilds the composition underneath you anyway.

## 12. Non-interactive components — building a Progress

A progress bar has no user-editable value, so it has **no handshake, no event count and no `onValueChange`**. Everything
you must not copy from Switch is a handshake part:

- No `NitroUiControlledValue` in the model, no `value`/`js`/`nativeEvents`/`jsEvents`, no `reconcile()` in `afterUpdate()`
  — compare `ios/components/Switch/HybridNitroUiSwitch.swift:205-221`; a Progress's `afterUpdate()` is just
  `host.commit()`.
- No `mostRecentEventCount` prop, and no `T | null` "uncontrolled" encoding: the value is a plain `progress: Double`,
  always sent.
- No callback prop unless the component really reports something. A no-op `onValueChange` "for symmetry" costs an
  always-sent prop (§3, D7b) and a stable identity, and a fake one becomes public API. No `hybridRef` handle unless the
  harness needs one (§5).

What you still need, unchanged from §2-§8:

- A model per platform, `mutableStateOf`/manual publisher only for what renders
  (`android/.../HybridNitroUiSwitch.kt:33-59`, `ios/core/NitroUiModel.swift:25-31`); setters store + `markDirty()`;
  `afterUpdate()` → `commit()` exactly once.
- `RecyclableView` with a full reset, and `onDropView()` → `host.drop()` (§6). With no callbacks to release,
  `onDropView()` is still not optional.
- Sizing (§7): the default box must be the control's real size, `wantsContentSize` only if something reads it,
  `invalidateContentSize()` if content can change size without a bounds/trait change.
- Accessibility (§3): label and value on the **control** — `Modifier.semantics { … }` on Android, `.accessibilityLabel` on
  the hosted element on iOS — and both mark dirty.
- Animation is yours, on the UI thread. Indeterminate motion is a render-time concern (`rememberInfiniteTransition` on
  Compose, a phase/`TimelineView` animator on SwiftUI) and needs no JS round trip. If a props write starts an animation,
  note that the host suppresses animation on the first commit and the first commit after a recycle
  (`ios/core/NitroSwiftUIHost.swift:170-184`) — so a recycled row does not animate from the previous row's value.
