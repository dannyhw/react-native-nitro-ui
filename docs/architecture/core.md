# The core runtime — how to build a component

The contract every component in this library follows. It came out of T10 (the
Switch tracer bullet) and `docs/research/core-architecture.md`; where the two
disagree, this file describes what the code actually does.

Everything lives in one package (`react-native-nitro-ui`, DECISIONS D6): the
core is inside it, not in a separate `@nitro-ui/core`.

## 1. Layout

| Layer   | Core                                                                                                          | Component                             |
| ------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| JS      | `src/core/` (`useStableCallback`, `useControlled`, `useProcessedColor`), `src/NitroUiCore.ts`                | `src/components/<Name>/`              |
| Spec    | `src/NitroUiCore.nitro.ts`                                                                                  | `src/components/<Name>/<Name>.nitro.ts`, `Native<Name>.ts`, `<Name>Config.ts` |
| iOS     | `ios/core/` (`NitroUIContent`, `NitroSwiftUIHost`, `NitroUiModel`, `NitroUiMainThread`, `UIColor+NitroUiColor`) | `ios/components/<Name>/`              |
| Android | `android/.../nitro/nitroui/core/` (`NitroComposeHost`, `NitroUiModel`, `NitroUiPerf`)                        | `android/.../nitro/nitroui/HybridNitroUi<Name>.kt` |
| C++     | `cpp/HybridNitroUiCore.{hpp,cpp}`, `cpp/core/NitroUiPerf.hpp`, `cpp/NitroUiPropsCompat.hpp`                  | —                                     |

A component's Kotlin Hybrid View must stay in the package
`com.margelo.nitro.nitroui` (not a subpackage): the generated
`HybridNitroUi<Name>Manager` resolves it through a wildcard import of exactly
that package. Core helpers can live in `...nitroui.core`.

## 2. One instance, one host

Each Hybrid View owns exactly one host, created with it and never replaced:

- **iOS** — `NitroSwiftUIHost<Content>` (a `UIView`) owns one
  `UIHostingController<NitroUiRoot<Content>>`. `rootView` is never reassigned;
  the generic parameter is the concrete content type, so there is no `AnyView`.
  Components that present UI (menus, pickers, date pickers) set
  `needsContainment = true`; plain controls leave it off.
- **Android** — `NitroComposeHost<M>` (an `AbstractComposeView`) with a fixed
  `Content()`; owners are created only when the view has none, and the
  composition goes away through `DisposeOnLifecycleDestroyed` plus an explicit
  `disposeComposition()` in `drop()`.

`grep -n "rootView ="` (iOS) and `grep -n "setContent"` (Android) may only ever
hit init paths. No props update may re-create a host, its controller or its
composition.

## 3. Props: store, mark, commit once

```
Fabric updateProps
  └─ beforeUpdate()
       setter per changed prop → write the model, host.markDirty()
     afterUpdate()             → reconcile the controlled value, host.commit()
```

- Setters **only** store and mark dirty. `commit()` applies the batch and
  invalidates the UI **once** per React commit (iOS: one
  `model.objectWillChange.send()`; Android: writes to snapshot state).
- Bookkeeping props (the controlled value's JS copy, `mostRecentEventCount`, the
  callback) must not mark dirty, so a user interaction costs zero re-renders.
- `NitroUiModel` (iOS) is an `ObservableObject` with a **manual**
  `objectWillChange` — `@Published` would fire per property write. Android's
  model uses `mutableStateOf` only for what renders; logic-only fields stay
  plain `var`s.

The JS side guarantees the batching preconditions:

- **Callbacks keep one identity forever.** `useStableCallback` builds
  `{ f: … }` once per mounted view and swaps only the ref it reads. An inline
  `callback(…)` in JSX changes identity every render, which re-applies the prop
  (lint rule `no-inline-callback-in-jsx`).
- **No optional props in a spec** (nitro#1184): Fabric sends `null` for a prop
  that disappeared and Nitro only treats `undefined` as unset, so every spec
  prop is `T | null` and the wrapper always sends all of them (lint rule
  `no-optional-view-props`).
- **Callbacks are the one exception, and `| null` is not an alternative.** RN
  cannot send a function as a prop, so Nitro sends `{ f: fn }` and unwraps `f`
  only when the prop type *is* a function (`IsFunctionProp`). `fn | null`
  generates `std::variant<std::function, NullType>`, which is not a function
  type, so the wrapper is never unwrapped and converting the prop throws while
  mounting. Declare callbacks `fn?` (→ `std::optional<std::function>`), send a
  real callback whenever the view is mounted, never `null`. Same for
  `hybridRef`.
- **Colours** are processed once (`useProcessedColor`) and travel as an ARGB
  `number | null`. Decode the bits, never the sign: `processColor` returns an
  *unsigned* 32-bit value on iOS and a *signed* one on Android, so an opaque
  colour arrives as `4286676479` on one platform and `-8692737` on the other. A
  decode written with `Int32(exactly:)` (or a Kotlin `toInt()` that assumes the
  signed half) silently discards every opaque iOS colour and the control keeps
  the platform accent, with no error anywhere. `UInt32(truncatingIfNeeded:)`
  accepts both; a prop getter returns whatever its own platform's
  `processColor` would produce, so JS can compare them.
- **`testID`/`accessibilityLabel`** are ordinary props: RN's own accessibility
  pipeline already puts `testID` on the iOS component view as
  `accessibilityIdentifier`, so iOS hosts deliberately do not set it again (that
  would make the view match a testID query twice). Android needs the explicit
  prop and applies it as `host.tag`. Accessibility *labels* belong to the hosted
  control (SwiftUI `.accessibilityLabel`), not the container.

## 4. Controlled values (the event-count handshake)

`src/core/useControlled.ts` plus `NitroUiControlledValue` on each platform:

- Native owns the *displayed* value and writes it immediately on interaction —
  no visual latency, and an uncontrolled control costs no React render at all.
- Native emits `(value, eventCount)`; JS calls the user's handler and echoes
  `eventCount` back as `mostRecentEventCount` in the same commit.
- Native accepts a `value` write only after seeing at least that many of its own
  events. That gives rejected changes (JS did not update state, so the `value`
  prop is unchanged but `mostRecentEventCount` is → still a commit → native
  reverts), stale writes (a `value` in flight is ignored) and uncontrolled mode
  (`value === null`, native keeps what it shows).
- `defaultValue` seeds an uncontrolled control once and is ignored afterwards.

There is no accessibility *value* query in the harness, so the revert case is
tested with a tap-twice oracle: after a rejected change, the next tap must report
the pre-tap value again.

## 5. Threading

- Host code is main/UI thread only; `nitroUiAssertMainThread()` guards entries.
- A Hybrid View method callable from JS must not touch SwiftUI/Compose, so
  `measureContent()` reads a **cached** size written on main during the last
  layout/commit (`NSLock` + `CGSize?` on iOS, `@Volatile` on Android).
- No synchronous JS↔main round trip anywhere in the props path.

## 6. Recycling and drop

`RecyclableView` is mandatory for anything that can live in a list:

- `prepareForRecycle()` resets the model to fresh-component state and keeps the
  host/controller/composition (the expensive part). It also re-arms per-mount
  state: animation suppression (so a recycled row does not slide from the
  previous row's value) and the `firstFrame` mark.
- `onDropView()` releases what must not outlive a mount — callbacks first (they
  hold JS refs), then host caches. The generated component view calls it before
  `prepareForRecycle` as well as on a real unmount, so it must stay cheap and
  reversible; it must not destroy the controller.
- Anything a props setter writes has to appear in the recycle reset. A leaked
  `testID` or `onChange` between recycled rows is a bug.

## 7. Sizing (until T11)

A Nitro Hybrid View is a plain Yoga leaf: with no style it is 0×0. T11 adds the
intrinsic-size shadow node; meanwhile the JS wrapper applies a per-platform
default box (`style={[DEFAULT_SIZE, style]}`, user style wins). Measured numbers
are in `docs/components/switch.md`.

Hosts with `wantsContentSize` measure the content's fitting size on main after a
visual commit and cache it; the component exposes it as `measureContent()`. T11
only has to push that cached size into Fabric state — components do not change.

## 8. Perf marks

`cpp/core/NitroUiPerf.hpp` is a header-only ring buffer shared by C++, Swift
(through C++ interop) and Kotlin (through JNI), so every entry point takes plain
integers. A host with `nuiPerfId >= 0` records `propsApplied` (in `commit()`)
and `firstFrame` (first layout in a window / first pre-draw).
`nitroUiCore.setPerfEnabled(true)` starts recording (and clears), and
`nitroUiCore.drainPerf()` takes everything. Disabled — the default — a mark site
costs one relaxed atomic load. T02's `BenchProbe` does the black-box frame
measurement; these marks answer "when did props land, when did it draw".

`drainPerf()` consumes the buffer: a test that polls it must accumulate what it
read, or the first poll eats the marks it is waiting for.

## 9. Checklist for a new component

1. `src/components/<Name>/<Name>.nitro.ts` — props as `T | null` (callbacks
   `fn?`), methods, `HybridView`/`HybridViewMethods`. `bun run nitrogen`.
2. `Native<Name>.ts` + `<Name>Config.ts` — host component; every spec prop
   required in the wrapper's prop type, callbacks typed `{ f: Fn }`.
3. `<Name>.tsx` — friendly props (`value?`, `defaultValue?`, `onValueChange?`,
   `disabled?`, `tintColor?`, plus `ViewProps`), `useControlled`,
   `useProcessedColor`, `useStableCallback`, `style={[DEFAULT_SIZE, style]}`.
4. `ios/components/<Name>/HybridNitroUi<Name>.swift` — model, `NitroUIContent`
   view, and the Hybrid View (`Hybrid…Spec, RecyclableView`).
5. `android/.../HybridNitroUi<Name>.kt` — same three pieces on Compose.
6. Register it: `NitroUiPackage.createViewManagers`, the `nitro.json` view
   entry, and `bun run manifest:update` if the published file list changed.
7. Example screen + `example/__tests__/<Name>.harness.tsx`; run the harness on
   both platforms (see `CONTRIBUTING.md`).
8. Perf contract: setters store + mark dirty only; one commit per `afterUpdate`;
   no host recreation; no inline callbacks; stable callback identities; full
   recycle reset; `onDropView` cleanup; nothing blocking from JS to main;
   `bun run check` green.

## 10. Traps T10 hit (so you don't)

- **`{ f: fn }` callbacks** — see §3. Symptom: mounting throws `Cannot convert
  "[object Object]" to any type in variant<...>` and the view never shows up in
  any query.
- **Swift `internal`, not `public`.** A public Swift type in this pod lands in
  `NitroUi-Swift.h`, whose C++ thunks do not import `Combine`, so
  `ObservableObject` fails to compile (`use of undeclared identifier
  'Combine'`). Nitrogen's generated Swift is in the same module, so internal is
  enough.
- **Kotlin properties have no accessor braces**: `override var x: T
  { get() … set() … }` is a syntax error — write the accessors directly.
- **`AbstractComposeView.onLayout` is final** — use a self-removing
  `ViewTreeObserver.OnPreDrawListener` for a first-frame hook.
- **`DisposeOnLifecycleDestroyed` needs a `LifecycleOwner`** — cast the activity
  at runtime, do not assume it.
- **A per-mount flag that is never re-armed** (firstFrame) silently stops
  reporting for recycled views, which is most of a list.
- **`testID` on the hosted content as well as the container** makes
  `findAllByTestId` return two elements.
- **RN's Android autolinker matches text, not code**: a comment that reads like
  a declaration can be parsed as the package class and break the app build. If
  `react-native config` output is stale, regenerate
  `example/android/build/generated/autolinking/autolinking.json`.
- **The harness does not build, and did not reinstall** an app already present
  on the device, so native changes silently did nothing (JS comes from Metro,
  native does not). `patches/@react-native-harness%2Fplatform-apple@1.6.0.patch`
  makes iOS install every run.
- **`screen.screenshot(element)` reports `0×0`** for any element target — the
  module does not return the captured size. Measure with `queryByTestId` from
  the `HarnessUI` TurboModule, as `example/__tests__/Switch.harness.tsx` does.
