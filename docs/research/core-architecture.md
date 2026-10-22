# nitro-ui core architecture

Status: research / design proposal, 2026-10-22. Read `nitro-patterns.md` first.

Citation prefixes (all paths are under the scratch clone root
`~/.t3/scratch/2026-10-22-please-do-research-around-what-dd4b3604/repos/`):

| prefix | repo @ commit | root |
|---|---|---|
| `nitro:` | margelo/nitro @fb894f6 (0.37.1) | `margelo_nitro/packages/` |
| `rn:` | facebook/react-native @d8789c6 (main) | `react-native/packages/react-native/` |
| `expo:` | expo/expo @aa729f0a (main) | `expo_expo/packages/` |
| `screens:` | software-mansion/react-native-screens @368b40b | `react-native-screens/` |
| `truesheet:` | lodev09/react-native-true-sheet @1e09059 | `react-native-true-sheet/` |
| `input:` | ronickg/react-native-nitro-input | `ronickg_react-native-nitro-input/packages/react-native-nitro-input/` |
| `rive:`, `mgcrea:`, `ctxmenu:` | as in nitro-patterns.md | |

`rn:React/Fabric/Mounting/RCTMountingManager.mm` is not in the sparse clone. Its line numbers come
from `raw.githubusercontent.com/facebook/react-native/main/...`, fetched 2026-10-22.

---

## TL;DR: decisions

1. **Sizing for v1: a custom intrinsic-size ShadowNode, injected by post-processing nitrogen's output.**
   - Nitro's generated `Props` class and prop parsing stay as they are. Only the three `using`
     aliases (State, ShadowNode, ComponentDescriptor) are swapped, plus a few lines in the
     generated iOS `.mm` and Kotlin manager.
   - `measureContent` is a pure C++ lookup, never a call into native UI. It reads, in order:
     (1) a process-wide **size cache** keyed by `(component, sizingKey, environment)`;
     (2) the size **native pushed into Fabric state**;
     (3) a per-component fallback.
   - Native measures on the main thread and pushes the size through
     `ConcreteState::updateState(..., unstable_Immediate)`.
   - On a cache hit, which includes every pre-warmed configuration, the first layout is exact and
     costs no extra commit. On a miss there is one synchronous commit in the same main-thread turn.
     On iOS that should be invisible; on Android we skip the incorrect frame.
2. **Rejected for v1:**
   - nitro-input's "sync measure during render". It needs SwiftUI/Compose on the JS thread, which is
     impossible, or `main.sync`, which can deadlock.
   - Expo's approach: style override in `adopt` after an async geometry callback. It has documented
     one-frame jumps and a 0×0 first frame, and it overwrites user style.
   - The nitro-input approach stays as **plan B** if post-processing turns out to be brittle.
3. **Sizing later (containers):**
   - Same shadow node, flagged as a Yoga leaf, so virtual children get no Yoga layout.
   - The size comes from state and cache, with height-for-width entries.
   - RN-content "slots" are measured by Yoga and pushed into SwiftUI/Compose (Yoga → native).
4. **iOS hosting:**
   - One `UIHostingController<NitroRoot<Content>>` per control, with a concrete generic root and no `AnyView`.
   - A persistent `ObservableObject` model with **plain stored properties and one manual
     `objectWillChange.send()` per `afterUpdate`** (Expo's trick).
   - `safeAreaRegions = []`.
   - View-controller containment only for components that present something (Picker menu,
     DatePicker, Menu).
   - Recycling is enabled; the controller is kept across recycles.
5. **Android hosting:**
   - The Nitro `view` *is* an `AbstractComposeView` subclass. `Content()` reads `mutableStateOf`
     fields of a persistent model.
   - `ViewCompositionStrategy.DisposeOnLifecycleDestroyed(activity)` plus an explicit
     `disposeComposition()` in `onDropView`.
   - Set ViewTree owners only if none are found (RN `Modal`).
   - A root `Layout` records the intrinsic size during Compose's own measure pass.
   - Ship a baseline profile, and pre-warm.
6. **Events:**
   - Nitro `callback()` props, made stable with a ref-backed wrapper.
   - Controlled values use an **event-count handshake**. Native stores the last JS value separately
     from the displayed value, so "reject the change" works even when the prop's identity doesn't change.
   - Worklets and SharedValues are **not in v1**. In v1.1, a boxed `hybridRef` setter can be called
     from a Reanimated worklet on the UI thread.
7. **Containers later:**
   - Use Expo's "Fabric nodes, virtual native" model: each child is a Nitro Hybrid View whose native
     view is a placeholder, and the host collects child content into one SwiftUI/Compose tree.
   - Large data-driven lists use a HybridObject data source, not one Fabric node per row.
   - Typed node ops through a HybridObject are rejected for general trees, because they are not
     atomic with Fabric commits.

---

## 1. Sizing

### 1.1 The constraint, precisely

- nitrogen emits `using HybridXShadowNode = react::ConcreteViewShadowNode<Name, HybridXProps,
  ViewEventEmitter, HybridXState>`, with `HybridXState = nitro::ViewPropsHolderState<HybridXProps>` and
  `HybridXComponentDescriptor = nitro::ViewComponentDescriptor<HybridXShadowNode>`
  (`nitro:nitrogen/src/views/CppHybridViewComponent.ts:150-166`). It has no traits and no
  `measureContent`, so Yoga treats it like a `<View>`. With no style it is 0×0, or stretched by
  `alignItems: stretch`.
- `ViewComponentDescriptor` is `final`. It installs Nitro's raw-props parser and a fast
  `cloneProps` (`nitro:react-native-nitro-modules/cpp/views/ViewComponentDescriptor.hpp:26,38-51`).
- On Android only, its `adopt` stores the props in the **Fabric state** so they can be routed through
  Java and JNI (`:53-74`). It keeps state identity when `hasSameProps` (`:65-69`).
- `ViewPropsHolderState` is `final`. Its folly constructor discards the data, and `getDynamic()` /
  `getMapBuffer()` throw (`nitro:react-native-nitro-modules/cpp/views/ViewPropsHolderState.hpp:24,36-44`).
  So **the Android State slot is taken**: `StateWrapper.updateState(map)` from Kotlin would wipe the props.
- The descriptor is registered by generated code:
  - iOS: `+componentDescriptorProvider` in the generated `.mm`
    (`nitro:nitrogen/src/views/swift/SwiftHybridViewManager.ts:102-104`).
  - Android: `registerNatives()` in `J<State>Updater`
    (`nitro:nitrogen/src/views/kotlin/KotlinHybridViewManager.ts:198-207`).
  - Both resolve the **alias names**. If we change what the aliases point to, everything else in the
    generated code keeps working.
- The generated Android JNI reads props via `static_pointer_cast<ConcreteState<HybridXState>>(...)
  ->getData().getProps()` (`KotlinHybridViewManager.ts:235-261`). Any replacement state type must
  therefore keep `getProps()` and the constructor from `shared_ptr<const Props>`.
- The generated iOS `.mm` does **not** override `updateState:oldState:` or `finalizeUpdates:`
  (`SwiftHybridViewManager.ts:88-193`). The Swift view never sees Fabric state.

### 1.2 Options evaluated

#### (a) nitro-input's two-phase sizing (sync native measure during render, plus `onSizeChange` corrections)

- **How it works:**
  - `NitroInputMeasure.measure(sizing)` is a sync HybridObject called during render to seed `style`
    width/height (`input:src/specs/NitroInputMeasure.nitro.ts:69-78`, `input:src/NitroInput.tsx:819-832,1565-1581`).
  - The view then reports `onSizeChange`, and JS calls `setState` only when the size really changed (`:1185-1201`).
- **Why it works there:** text measurement is thread-safe (`Paint`, CoreText). The Android measurer
  says so explicitly (`input:android/.../HybridNitroInputMeasure.kt:9-16`).
- **Why it fails for us:**
  - `UIHostingController`, SwiftUI layout and Compose composition are all main-thread-only.
  - A JS-thread `measure()` would need `DispatchQueue.main.sync` or `runOnUiThread` plus a latch.
    That deadlocks when the main thread is itself blocked on the JS thread or the ShadowTree commit
    lock, e.g. during an `unstable_Immediate` state update or a sync event (§1.4, "Why no sync native call").
  - Corrections go through a full React re-render: JS thread, a frame or more, and a visible jump.
- **Verdict:**
  - Plan B only, in a reduced form: JS reads a **pre-filled** metrics cache synchronously and never
    measures on demand.
  - Keep the idea of *seeding before mount*. Our version of it is the C++ cache that `measureContent` reads.

#### (b) Hand-written C++ ShadowNode / ComponentDescriptor with `measureContent`

- **Feasible, and it keeps Nitro's prop parsing.**
  - The generated `HybridXProps` is a normal `react::ViewProps` subclass with
    `nitro::ReactProp<T>` members (`.get()`, `.isProvided()`, `.hasSameValue()`;
    `nitro:react-native-nitro-modules/cpp/views/ReactProp.hpp:33-90`).
  - Our templates take `Props` as a parameter and leave it untouched.
- **What we must re-implement:** the ~25 lines of `nitro::ViewComponentDescriptor`:
  - the constructor with `RawPropsCompat::makePropsParser()`;
  - the `cloneProps` fast path;
  - Android `adopt`, extended to **carry the measured size forward**.
- **Yoga-leaf recipe:**
  - Set the traits `LeafYogaNode | MeasurableYogaNode` and override
    `measureContent(const LayoutContext&, const LayoutConstraints&) const`
    (`rn:ReactCommon/react/renderer/core/LayoutableShadowNode.h:93`).
  - The precedent is RN's own `AppleSwitchShadowNode` / `AndroidSwitchShadowNode`, with Leaf +
    Measurable traits (`rn:ReactCommon/react/renderer/components/switch/...`; see the sub-agent notes in References).
  - Override `shouldNewRevisionDirtyMeasurement` (`rn:.../view/YogaLayoutableShadowNode.h:97`, the
    Paragraph pattern at `rn:.../text/ParagraphShadowNode.h:88`). Otherwise every clone of a measurable
    node re-measures (`rn:.../view/YogaLayoutableShadowNode.cpp:151-161,318-322`).
- **The hard part is *what* `measureContent` calls.**
  - It runs on whatever thread runs the commit's layout: the JS thread for React commits, the UI thread
    for `unstable_Immediate` state updates issued from the UI thread.
  - RN's iOS Switch caches `[UISwitch new].intrinsicContentSize` once through
    `RCTUnsafeExecuteOnMainQueueSync`.
  - RN's Android Switch calls JNI `ViewManager.measure`, which constructs a classic `View` off the main thread.
  - Neither works for SwiftUI or Compose. **So `measureContent` must be a pure function of
    props + state + a C++ cache.** Native fills the cache and the state.
- **Android difficulty:**
  - The state type must hold both the props (Nitro's need) and the size (ours).
  - The descriptor's `adopt` must preserve the size when props change.
  - Pushing the size needs a small JNI function, because Java's `StateWrapper.updateState` is
    hard-wired to async mode and to `Data(getData(), dynamic)`. That form rebuilds from the
    **wrapper's** possibly stale data, not the most recent data (`rn:ReactCommon/react/renderer/core/ConcreteState.h:120-123`),
    so it could resurrect stale props.
  - Precedent: true-sheet's JNI `updateState(..., unstable_Immediate)`
    (`truesheet:android/src/main/jni/TrueSheetStateUpdater.cpp:18-52`).
  - Estimate: a few hundred lines of C++ and Kotlin, written once in core.

#### (c) Fabric state updates from native

- **Mechanism:**
  - The component view keeps the `State::Shared` it receives in `updateState:oldState:` (iOS) or
    `ViewManager.updateState` (Android).
  - Native calls `ConcreteState<T>::updateState(callback, mode)`. The callback form receives the
    **most recent** data, and returning `nullptr` cancels the update (`rn:ReactCommon/react/renderer/core/ConcreteState.h:77-108`).
  - That goes `EventQueue::enqueueStateUpdate` → `UIManager::updateState` → a commit cloned from
    `family.getMostRecentState()` → layout → mount.
  - `unstable_Immediate` flushes synchronously **on the calling thread**, otherwise on the next event
    beat on the JS thread (`rn:ReactCommon/react/renderer/core/EventQueue.cpp:64-83`).
  - Each queued update is its own commit (`rn:ReactCommon/react/renderer/core/EventQueueProcessor.cpp:132-137`).
  - React commits run `progressState`, which upgrades obsolete states to the family's most recent
    one, and `adopt` runs again on every clone. So a size stored in state survives React re-renders
    (see sub-agent report; `rn:.../mounting/ShadowTree.cpp:60-75,385-392`).
- **The shadow node consumes the size in one of two ways:**
  - **Style override in `adopt`.** screens uses `setSize` (`screens:common/cpp/.../legacy/RNSScreenComponentDescriptor.h:97-116`);
    true-sheet uses a style copy (`truesheet:common/cpp/.../TrueSheetLayoutUtils.h:13-41`); Expo is
    described in (d). This clobbers user width/height and percentages.
  - **`measureContent` reading state**, like the AndroidTextInput precedent where Java pushes
    `opaqueCacheId` (`rn:.../androidtextinput/AndroidTextInputShadowNode.cpp:30-49`). This respects
    Yoga's min/max, flex and explicit style. **We pick this.**
- **Is it possible from a Nitro view?**
  - Not out of the box: on Android the state slot holds props, and on iOS the `.mm` drops the state.
  - It works with (b)'s combined state type and two small generated-file patches.
- **Mount re-entrancy on iOS is safe and same-turn:** `RCTMountingManager initiateTransaction` loops
  while `_followUpTransactionRequired` (`rn:React/Fabric/Mounting/RCTMountingManager.mm:234-249`).
  A synchronous commit issued during mount is mounted before the turn ends, so before
  Core Animation commits.

#### (d) How Expo UI's `Host` + `matchContents` works (read from source)

- **iOS:**
  - `HostView` applies `.fixedSize(horizontal:vertical:)` and measures *after* SwiftUI layout with
    `onGeometryChange(for: CGSize.self)`, or a `GeometryReader` overlay below iOS 16
    (`expo:expo-ui/ios/HostView.swift:96,229-259`).
  - It calls `shadowNodeProxy.setStyleSize` → `ExpoFabricViewObjC -setStyleSize:` →
    `_state->updateState(...)`.
  - On RN ≥ 82 that runs through a per-turn budget: **2** `unstable_Immediate` updates, then deferred
    `Asynchronous` updates. This breaks a non-converging SwiftUI↔Yoga loop
    (`expo:expo-modules-core/ios/Fabric/ExpoFabricViewObjC.mm:20-35,270-363`).
  - The state is `ExpoViewState {_width,_height,_styleWidth,_styleHeight}`
    (`expo:expo-modules-core/common/cpp/fabric/ExpoViewState.h:11-25`).
    `ExpoViewComponentDescriptor::adopt` `const_cast`s the props' `yogaStyle` and sets the dimension
    (`expo:expo-modules-core/common/cpp/fabric/ExpoViewComponentDescriptor.h:59-118`). No `measureContent`.
- **Android:**
  - `HostView.onMeasure` switches the matched axes to UNSPECIFIED, and an inner `Layout` reports
    `onSizeChanged` → `setStyleSize`, posted to avoid re-entrant measure
    (`expo:expo-ui/android/.../HostView.kt:205-221,320-395`).
  - `ShadowNodeProxy` flushes in `OnPreDrawListener` through JNI `updateStyleSizeImmediate`
    (`expo:expo-modules-core/android/src/main/java/expo/modules/kotlin/views/ShadowNodeProxy.kt:21-91`,
    `.../cpp/fabric/NativeStatePropsGetter.cpp:32-62`).
- **Consequences:**
  - There is always at least one extra commit per `matchContents` Host, and the size arrives *after*
    SwiftUI has rendered.
  - **Documented results:**
    - **#50475:** a half-height jump for one frame. Mitigated with `FillAlignmentModifier`.
    - **#44579:** one frame of clipping on mount.
    - **#47883:** a stale size in FlashList-recycled cells.
    - **#51767:** a 0×0 Host when `removeClippedSubviews` detaches it before it composes.
    - **#50216:** the measurement ignores Yoga constraints and percentages.
  - This is the gap nitro-ui should win on.

### 1.3 Recommended v1 design: "IntrinsicShadowNode + SizeCache + state push"

```
JS render ──► Fabric commit (JS thread)
                 │  measureContent(): cache[key] ▸ state.measured ▸ fallback   (pure C++)
                 ▼
              mount (main/UI thread): updateProps → Swift/Kotlin setters → afterUpdate()
                 │   model updated once; if key ∉ cache: measure synchronously (main)
                 │   cache.put(key,size); if ledger[tag] ≠ (key,exact): push state
                 ▼
              updateState(cb, unstable_Immediate)  → commit + layout + mount in same turn
```

**Sizing key.**
- Every sized component's spec extends `IntrinsicProps { nuiSizingKey: string }`.
- The JS wrapper builds the key from exactly the props that affect size, for example
  `"Button|bordered|regular|Save"` or `"Switch|"`.
- C++ hashes the key together with the component name and an **environment epoch**. Native bumps the
  epoch when dynamic type / font scale, bold text, density or locale change.
- Computing the key in JS keeps the C++ template generic: there is no per-component C++.

**Sizing policies**, declared by native when reporting and stored in the cache entry:
- `intrinsic`: Switch, Button, menu Picker, SegmentedControl, circular Progress, compact DatePicker.
- `fillWidth`: Slider, linear Progress, wheel Picker. Width = `constraints.max.width` when finite,
  height = intrinsic.
- `heightForWidth` (later): graphical DatePicker, multi-line labels. The cache is keyed by a width bucket.

**C++ (core, shared):**

```cpp
// nitroui/IntrinsicViewState.hpp
namespace nitroui {
struct MeasuredSize {
  float width = 0, height = 0; uint64_t key = 0; uint32_t flags = 0; // flags: FillWidth, HeightForWidth
  bool valid() const { return key != 0; }
  bool operator==(const MeasuredSize&) const = default;
};

template <typename TProps>
struct IntrinsicViewState final {                 // replaces nitro::ViewPropsHolderState<TProps>
  IntrinsicViewState() = default;
  explicit IntrinsicViewState(std::shared_ptr<const TProps> p) : _props(std::move(p)) {}       // Nitro JNI + adopt need this
  IntrinsicViewState(std::shared_ptr<const TProps> p, MeasuredSize m) : _props(std::move(p)), measured(m) {}
  const std::shared_ptr<const TProps>& getProps() const { return _props; }                       // generated JNI reads this
  MeasuredSize measured{};
#ifdef ANDROID  // RN_SERIALIZABLE_STATE requirements; never used for writes (see JNI below)
  IntrinsicViewState(const IntrinsicViewState& prev, folly::dynamic) : _props(prev._props), measured(prev.measured) {}
  folly::dynamic getDynamic() const { return folly::dynamic::object("w", measured.width)("h", measured.height); }
  react::MapBuffer getMapBuffer() const { return react::MapBufferBuilder::EMPTY(); }
#endif
 private:
  std::shared_ptr<const TProps> _props;
};
}
```

```cpp
// nitroui/IntrinsicShadowNode.hpp
template <const char* Name, typename TProps>
class IntrinsicShadowNode final
    : public react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, IntrinsicViewState<TProps>> {
  using Base = react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, IntrinsicViewState<TProps>>;
 public:
  using Base::Base;
  static react::ShadowNodeTraits BaseTraits() {
    auto t = Base::BaseTraits();
    t.set(react::ShadowNodeTraits::Trait::LeafYogaNode);
    t.set(react::ShadowNodeTraits::Trait::MeasurableYogaNode);
    return t;
  }
  react::Size measureContent(const react::LayoutContext&, const react::LayoutConstraints& c) const override {
    const uint64_t key = SizeCache::keyFor(Name, this->getConcreteProps().nuiSizingKey.get());
    SizeEntry e;
    bool exact = SizeCache::shared().get(key, e);                       // 1. cache (pre-warmed or measured)
    if (!exact) {
      const auto& m = this->getStateData().measured;                    // 2. native-pushed state (maybe stale key)
      e = m.valid() ? SizeEntry{{m.width, m.height}, m.flags} : SizeCache::shared().fallback(Name); // 3. fallback
      exact = m.valid() && m.key == key;
    }
    LayoutLedger::shared().note(this->getTag(), key, exact);            // lets native skip redundant pushes
    react::Size s = e.size;
    if ((e.flags & FillWidth) && std::isfinite(c.maximumSize.width)) s.width = c.maximumSize.width;
    return c.clamp(s);
  }
  bool shouldNewRevisionDirtyMeasurement(const react::ShadowNode& src, const react::ShadowNodeFragment& f) const override {
    // re-measure only if sizingKey or measured state changed (Paragraph pattern)
    ...
  }
};
```

```cpp
// nitroui/IntrinsicComponentDescriptor.hpp  — copy of nitro::ViewComponentDescriptor + size carry-over
template <typename TShadowNode>
class IntrinsicComponentDescriptor final : public react::ConcreteComponentDescriptor<TShadowNode> {
  using Base = react::ConcreteComponentDescriptor<TShadowNode>;
  using Props = typename TShadowNode::ConcreteProps; using State = typename TShadowNode::ConcreteStateData;
 public:
  explicit IntrinsicComponentDescriptor(const react::ComponentDescriptorParameters& p)
      : Base(p, nitro::RawPropsCompat::makePropsParser()) { StateUpdaters::registerType<TShadowNode>(); }
  std::shared_ptr<const react::Props> cloneProps(const react::PropsParserContext& ctx,
      const std::shared_ptr<const react::Props>& props, react::RawProps raw) const override {
    raw.parse(this->rawPropsParser_);
    return TShadowNode::Props(ctx, raw, props);                     // identical to Nitro (ViewComponentDescriptor.hpp:45-51)
  }
#ifdef ANDROID
  void adopt(react::ShadowNode& sn) const override {
    Base::adopt(sn);
    auto& n = static_cast<TShadowNode&>(sn);
    auto props = std::static_pointer_cast<const Props>(n.getProps());
    const State& prev = n.getStateData();
    if (prev.getProps() && props->hasSameProps(*prev.getProps())) return;   // keep identity (Nitro :65-69)
    n.setStateData(State{std::move(props), prev.measured});               // <-- carry size forward
  }
#endif
};
```

**Size cache:**
- A `std::shared_mutex`-protected `unordered_map<uint64_t, SizeEntry>`. It is read on the JS/UI layout
  threads and written on main.
- `fallback(component)` returns the last size measured for any instance of that component. That is a
  much better first guess than 0×0 for, say, a Button with a new label.
- Cleared when the environment epoch changes.
- **`LayoutLedger`:** a tag → `(key, exact)` map written by `measureContent`. Native uses it to skip
  the push when the node already laid out with the exact cached size. This is what makes 200
  pre-warmed Switches cost **0** extra commits.

**Applying the size from native (shared helper):**

```cpp
template <typename TConcreteState>
void pushMeasured(const std::shared_ptr<const TConcreteState>& st, MeasuredSize m, react::EventQueue::UpdateMode mode) {
  st->updateState([m](const auto& old) -> react::StateData::Shared {
    if (old.measured == m) return nullptr;                          // cancel: no commit
    return std::make_shared<const typename TConcreteState::Data>(old.getProps(), m); // keep *latest* props
  }, mode);
}
```

**iOS wiring:**
- The post-processed `.mm` adds an `updateState:oldState:` override. It casts to
  `HybridXShadowNode::ConcreteState` and binds a type-erased `std::function<void(MeasuredSize)>` into
  an ObjC `NUISizeSink`. The Swift host receives the sink once, in `init`, through an `@objc protocol NUISizeSinkReceiver`.
- **Flush policy:**
  - Swift calls `sink.report(size)`. A global `NUISizeFlusher` (a `CFRunLoopObserver` on
    `kCFRunLoopBeforeWaiting` with an order *below* Core Animation's commit observer at 2000000) flushes
    all reports of the turn.
  - Each report goes out as `unstable_Immediate`. Expo found that one immediate flush drains the whole
    shared queue (`expo:.../ExpoFabricViewObjC.mm:311-318`), so we can enqueue N-1 as `Asynchronous`
    and the last as `Immediate`. They are still N commits, but all of them happen in this turn.
  - Keep Expo's per-view budget: 2 immediate updates per turn, then async. Add a 0.5 pt epsilon,
    like true-sheet (`truesheet:ios/TrueSheetView.mm:392-409`).
- **Mount ordering:**
  - On Insert, RN calls `updateProps`, then `updateState`, then `updateLayoutMetrics`, then
    `finalizeUpdates`, then `mountChildComponentView` (`rn:React/Fabric/Mounting/RCTMountingManager.mm:74-91`).
  - So in `afterUpdate` the view is **not yet in a window** and the state is **not yet bound**. That is
    why we report through the sink and flush at the end of the turn.
  - `UIHostingController.sizeThatFits(in:)` works off-window. Trait differences off-window are a risk; see R3.

**Android wiring:**
- The post-processed Kotlin manager adds one line in `updateState`:
  `(hybridView as? NitroUIStateAware)?.onState(newState, view.id)`.
- Core JNI: `NitroUISizing.nativePush(stateWrapper, componentName, w, h, key, flags, immediate)`.
  - It unwraps `StateWrapperImpl`, as true-sheet does (`truesheet:android/src/main/jni/TrueSheetStateUpdater.cpp:18-27`).
  - It looks up the typed `pushMeasured<…>` that the descriptor constructor registered under
    `componentName`, and calls it with `unstable_Immediate`.
  - It links `ReactAndroid::reactnative` and includes `<react/fabric/StateWrapperImpl.h>`.
- **Flush:**
  - Do not push during mount. Expo hit an RN re-entrancy bug doing that
    (`expo:.../ShadowNodeProxy.kt:21-24`).
  - Flush from a per-root `ViewTreeObserver.OnPreDrawListener`. If a pushed size changes the layout,
    **return `false`** so the stale frame is not drawn and the traversal re-runs with the new layout.
    That costs one frame of delay on first appearance and no visible jump. It needs a prototype (R2).
- Use dp, not px, and a 0.9 dp epsilon, as screens does
  (`screens:android/src/fabric/java/com/swmansion/rnscreens/legacy/FabricEnabledViewGroup.kt:39-57`).

**Pre-warm:**
- `NitroUI.prewarm([{ component: 'Switch', sizingKey: 'Switch|' }, …])` is called from app start. Native
  measures default configurations on main (iOS: `sizeThatFits`, no window needed; Android: an offscreen
  attached ComposeView), during idle time.
- It fills the cache. On Android it also pays Compose's cold-start cost (§3).
- Additionally, each component's Swift/Kotlin type can declare `static let prewarmKeys` so the core warms
  them automatically on the first `createHybridObject` of that type.

**Expected cost:**

| Case | Extra commits | Jump |
|---|---|---|
| 200 pre-warmed Switches | 0 | none |
| Cold first Switch | 1 | none (iOS); one skipped frame (Android) |
| 199 more Switches in the same commit | one each | ledger says "not exact" |
| 200 Buttons with distinct labels | 200 sync commits | none |

- Cold, the first Switch costs one synchronous commit in the same turn. The other 199 Switches in the
  same commit laid out with the fallback, so each needs one push. That is why pre-warming matters.
- For 200 Buttons with distinct labels, the batch commit (v2) or text-metric sizing (v2) removes most of
  the cost; see §1.5.
- All numbers must be confirmed by prototype P1.

### 1.4 Why no synchronous native call from `measureContent`

`measureContent` runs on the JS thread inside `ShadowTree::commit` while the commit lock is held
(`rn:.../mounting/ShadowTree.cpp:418`, where layout runs). Suppose it does `main.sync`, while the main
thread is doing an `unstable_Immediate` state update (our own push, Expo's, screens', true-sheet's), or
running a sync event through `RuntimeScheduler::executeNowOnTheSameThread`. The main thread then waits
for the lock or for the JS runtime, the JS thread waits for main, and the app deadlocks. RN's iOS Switch
gets away with it only because `RCTSwitchSize` runs once and caches. **Rule: `measureContent` never
leaves C++.**

### 1.5 Later

- **Batch commit (v2):** collect a turn's `(family, MeasuredSize)` pairs and commit them once with
  `ShadowNode::cloneMultiple` (`rn:ReactCommon/react/renderer/core/ShadowNode.h:114`) through
  `UIManager`'s ShadowTree registry, as Reanimated does. That turns N commits into 1. Do it only if P1
  shows that cold mounts of many distinct sizes are a problem.
- **Text-metric sizing (v2):** for Button-like controls, size = chrome(style, controlSize, environment)
  + text(label, resolved font).
  - Native measures *chrome* once per style.
  - `measureContent` measures the *label* off the main thread with CoreText / `StaticLayout`, which is
    thread-safe; RN's own text layout relies on this.
  - The native push corrects any sub-point error. Cache misses then never move layout for distinct labels.
- **Containers:** the same `IntrinsicShadowNode`.
  - Leaf, so virtual children get no Yoga layout.
  - `heightForWidth` entries, so native measures for the actual width after the first layout and pushes
    the height (a two-pass, cached per width bucket).
  - RN-content slots inside SwiftUI/Compose use a *non-leaf* slot node measured by Yoga. Its frame is
    observed natively and applied with `.frame()` / `Modifier.size()`. Expo does the same with
    RNHostView + `ApplySizeFromYogaNode` (`expo:expo-ui/ios/RNHostView.swift:176-255`).
- **Upstream:** propose to Nitro
  1. making `ViewComponentDescriptor` and the state holder composable, not `final`;
  2. a `nitro.json` per-view option along the lines of
     `"shadowNode": { "header": "nitroui/IntrinsicShadowNode.hpp", "template": "nitroui::IntrinsicShadowNode" }`;
  3. a generated iOS `updateState` hook that forwards the state to the Swift part.

  Until that exists, post-process.

### 1.6 Post-processing (precedent: `rive:scripts/nitrogen-postprocess.ts`)

`scripts/nitrogen-postprocess.ts` runs after `nitrogen`. It reads `nitro-ui.sizing.json`
(`{ "HybridSwitch": "intrinsic", ... }`) and, for each listed view:

1. In `nitrogen/generated/shared/c++/views/<Component>.hpp`, it replaces the three aliases with
   `nitroui::IntrinsicViewState<P>`, `nitroui::IntrinsicShadowNode<Name, P>` and
   `nitroui::IntrinsicComponentDescriptor<SN>`, and adds `#include <NitroUICore/Intrinsic.hpp>`.
2. In `nitrogen/generated/ios/c++/views/<Component>.mm`, it adds the `NUISizeSink` ivar, attaches the
   sink in `init`, and adds the `updateState:oldState:` override (about 12 lines).
3. In `nitrogen/generated/android/kotlin/.../<Manager>.kt`, it adds the `onState(newState, view.id)`
   line after `afterUpdate()`.
4. It also applies the null→undefined optional-prop patch (`rive:scripts/nitrogen-postprocess.ts:40-75`,
   nitro#1184) and nitro#1655 on RN ≥ 0.86.

The script **fails the build** when an anchor is missing; Rive only warns. CI runs it against the
pinned nitrogen version.

---

## 2. SwiftUI hosting

**What to do per instance:**
- A `UIHostingController<NitroRoot<Content>>`, where `NitroRoot` is a generic struct wrapping the
  component's `View`. There is no `AnyView`, so SwiftUI keeps structural identity and diffs cheaply.
  Expo erases to `AnyView(ContentView(props:))` (`expo:expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIHostingView.swift:66-101`).
- **Model:** `class XModel: NitroUIModel` with plain stored properties. `NitroUIModel` declares
  `let objectWillChange = ObservableObjectPublisher()`. That avoids Combine's side-table lookup
  (`expo:.../SwiftUIViewProps.swift:33-35`) and per-property `@Published` notifications. `afterUpdate`
  calls `objectWillChange.send()` **once**, and only when something is dirty.
  - Animate on normal JS-driven changes. Wrap the send in `withTransaction(Transaction(disablesAnimations))`
    on first mount and after a recycle, so a recycled Toggle doesn't animate from the previous row's value.
  - `@Observable` (iOS 17+) is an option later. It isn't needed for single-control models.
- **Safe area and keyboard:**
  - `safeAreaRegions = []` (iOS 16.4+). Below that, use `.ignoresSafeArea()` on the root.
  - This also removes SwiftUI's keyboard avoidance. RN owns the keyboard.
  - This fixes the classic "control offset near the top of a ScrollView" bug. Expo exposes it as the
    `ignoreSafeArea` prop (`expo:.../SwiftUIHostingView.swift:124-126,322-341`).
- `hostingController.view.backgroundColor = .clear`. Set the frame in `layoutSubviews` (frame = bounds,
  no Auto Layout constraints; mgcrea's constraints are unnecessary work:
  `mgcrea:ios/SwiftUIContainerView.swift:37-49`).
- **`sizingOptions`:** leave them empty. We measure explicitly with `sizeThatFits(in:)` in `afterUpdate`,
  and again on `traitCollectionDidChange` (content size category, legibility weight) and on internal
  size-changing events such as a Picker selection. `.intrinsicContentSize` (Expo, `:76-78`) adds
  invalidation work on every content change and buys us nothing.
- **View-controller containment** is a per-component `class var needsContainment`:
  - `true` for Picker (menu), DatePicker and Menu, because they present popovers and menus and need a
    VC parent for presentation and trait propagation.
  - `false` for Switch, Slider, Button, Progress and SegmentedControl.
  - Attach in `didMoveToWindow` to `reactViewController()`, skipping UINavigationController and
    UITabBarController, and detach when the window becomes nil.
  - Expo always contains (`expo:.../SwiftUIHostingView.swift:219-269`). mgcrea never detaches, which
    leaks VC parentage across screens (`mgcrea:ios/SwiftUIContainerView.swift:58-75`).
- **Recycling:** conform to `RecyclableView`. The generated `.mm` calls `notifyOnDropView` and then
  `maybePrepareForRecycle` (`nitro:nitrogen/src/views/swift/SwiftHybridViewManager.ts:179-184`).
  - `prepareForRecycle` resets the model to defaults without sending, clears callbacks and event
    counters, drops the sink binding (the next `updateState` re-binds), and sets `isRecycled` so the next
    commit doesn't animate.
  - Keep the hosting controller. It is the expensive part. RN's component-view registry pools it.
- **Cost of 200 toggles in a ScrollView:** this is not measured yet (prototype P3). The per-instance cost
  is a UIHostingController, its `_UIHostingView`, and a SwiftUI view graph.
  - Our overhead beyond that is one Fabric node and zero extra commits when the cache is warm.
  - Expo pays a Host plus a virtual child Fabric node, Mirror-based prop parsing, and at least one
    geometry→state commit per `matchContents` Host.
  - **Candidate to prototype:** `UIHostingConfiguration { … }.margins(.all, 0).makeContentView()` (iOS 16).
    It is a public API, intended for cells, that yields a hosting content view with no VC. If it supports
    our controls (presentation, environment) it may be cheaper per instance. `_UIHostingView` directly is
    private API: no.
- **Threading:** props from React arrive on main. A `hybridRef` setter can arrive on the JS thread. The
  core's `@MainActor` model setters assert main and hop with `DispatchQueue.main.async` only when they
  are actually off main.

## 3. Compose hosting

- **The Nitro `view` is `NitroComposeHost`, an `AbstractComposeView` subclass**, rather than a FrameLayout
  around a `ComposeView`.
  - No wrapper view.
  - `@Composable override fun Content()` is fixed for the lifetime of the view: no `setContent` per update.
  - Direct access to `onMeasure` and `onAttachedToWindow`.
  - The generated manager is a `SimpleViewManager<View>`, which suits a leaf view
    (`nitro:nitrogen/src/views/kotlin/KotlinHybridViewManager.ts:58`).
- **Lifecycle owners:**
  - `ReactActivity` is an `AppCompatActivity`, so it is a `LifecycleOwner` and `SavedStateRegistryOwner`.
    It sets the ViewTree owners on its decor view, and react-native-screens fragments set their own.
  - So `findViewTreeLifecycleOwner()` usually succeeds. **Only if it returns null**, for example inside
    RN `Modal`'s Dialog window (to be verified, R6), set the owners from `reactContext.currentActivity`
    before `super.onAttachedToWindow()`.
  - Expo always overrides with the activity (`expo:.../ExpoComposeView.kt:240-264`). That ignores
    fragment lifecycles, so we only fill the gap.
- **Disposal:**
  - The default strategy (`DisposeOnDetachedFromWindowOrReleasedFromPool`) is wrong in RN. Screens
    transitions, `removeClippedSubviews` and recycling pools all detach views, which would throw away
    the composition and its state and re-compose on re-attach.
  - Use `DisposeOnLifecycleDestroyed(activity.lifecycle)`, plus an explicit `disposeComposition()` in
    `onDropView()`, which Nitro calls from `onDropViewInstance` (`KotlinHybridViewManager.ts:102-107`).
    Expo does the same (`expo:.../ExpoComposeView.kt:240-289`).
- **State:**
  - One model class per component with `var checked by mutableStateOf(false)` fields. Setters write them
    on the UI thread; React props arrive in `ViewManager.updateState` on UI.
  - `afterUpdate()` only calls `Snapshot.sendApplyNotifications()` when dirty.
  - Never replace the model object. Expo DSL views do a reflective `copy()` per prop
    (`expo:.../ComposeViewProp.kt:32-62`); avoid that.
- **Measuring:** `Content()` wraps the control in a root `Layout`:

```kotlin
@Composable internal fun IntrinsicRoot(fillWidth: Boolean, onMeasured: (Int, Int) -> Unit, content: @Composable () -> Unit) =
  Layout(content) { ms, c ->
    val p = ms.first().measure(Constraints(maxWidth = if (fillWidth && c.hasBoundedWidth) c.maxWidth else Constraints.Infinity))
    onMeasured(p.width, p.height)                       // record only (px); host converts to dp and schedules a push
    layout(c.maxWidth, c.maxHeight) { p.place((c.maxWidth - p.width) / 2, (c.maxHeight - p.height) / 2) }
  }
```

  - RN measures the view EXACTLY to the Yoga size, and Compose's measure pass runs synchronously inside
    it, so the intrinsic size is known before the first draw with no extra measure call.
  - The push happens in `OnPreDraw` (§1.3).
  - Material components add `minimumInteractiveComponentSize`, a 48 dp touch target. That is part of the
    intrinsic size, by design. Expose an opt-out later.
- **First composition and pre-warming:**
  - The first ComposeView in a process pays class loading and JIT. Mitigations:
    1. Depend on `androidx.profileinstaller` and ship a library `baseline-prof.txt` covering our
       composables. Compose's own artifacts already ship profiles.
    2. `NitroUI.prewarm()` attaches an invisible, offscreen `NitroComposeHost` per requested component to
       the decor view for one frame. That fills the size cache and warms the code paths.
    3. Enable `RecyclableView` so lists reuse live compositions.
  - Every `NitroComposeHost` has its own Composition and its own `AndroidComposeView` owner (layout
    nodes, semantics, focus). The window's Recomposer and frame clock are shared.
  - The cost of 200 instances is not measured yet (P4). If it is too high, the real fix is a container
    (one ComposeView, `LazyColumn`), not micro-tuning.
- **Frame alignment risk (R5):** state written during RN's mount is recomposed on the Recomposer's next
  frame-clock tick. Content can lag the RN layout by one frame on updates. First composition on attach is
  synchronous, so the first frame is fine.

## 4. Events and controlled values

**Callbacks:**
- Nitro function props are `callback(fn)`. Void callbacks are always async through the runtime's
  Dispatcher (CallInvoker) to the JS thread (`nitro:nitro-core/native/cpp/jsi/JSIConverter+Function.hpp:30,44-48`).
- The path is: main/UI (native event) → hop to JS → user handler → React render and commit (JS) → mount (main).
- Make callbacks stable:

```ts
export function useStableCallback<A extends unknown[]>(fn: ((...a: A) => void) | undefined) {
  const ref = useRef(fn)
  useInsertionEffect(() => { ref.current = fn })                // commit-phase write: concurrent-safe
  const has = fn != null
  return useMemo(() => (has ? callback((...a: A) => ref.current?.(...a)) : undefined), [has])
}
```

  The prop's identity changes only when a handler is added or removed.

**Controlled values (event-count handshake):**
- Native owns the *displayed* value and updates it immediately on user interaction. The SwiftUI
  `Binding(set:)` or Compose `onCheckedChange` writes the model, so there is no visual latency.
- It increments `nativeEventCount` and emits `onValueChange(value, nativeEventCount)`.
- The JS wrapper calls the user's handler, then `setMostRecentEventCount(count)`. Both updates are
  batched into one render, so **the prop always changes and the commit always happens**.
- In `afterUpdate`, native runs `if (jsEventCount >= nativeEventCount && jsValue != displayed) displayed = jsValue`.
  Because native stores the last JS `value` separately, a *rejected* change (JS keeps `value={true}`, so
  the prop identity is unchanged and its setter isn't called) is still reverted when the event count arrives.
- Stale JS writes, those with `jsEventCount < nativeEventCount`, are ignored.
- Uncontrolled `defaultValue` skips all of this.
- This mirrors RN TextInput. RN Switch and Expo Toggle revert similarly
  (`expo:expo-ui/ios/Toggle/ToggleView.swift:13-35`).

```swift
struct ControlledValue<T: Equatable> {          // core; Kotlin twin
  var displayed: T; var js: T? = nil; var nativeEvents = 0; var jsEvents = 0
  mutating func user(_ v: T) -> Int { displayed = v; nativeEvents += 1; return nativeEvents }
  mutating func reconcile() -> Bool { guard let js, jsEvents >= nativeEvents, js != displayed else { return false }; displayed = js; return true }
}
```

**Priority risk (R7):** Fabric events get discrete or continuous React priority. Nitro callbacks run
outside React's event system, so `setState` inside them gets default priority. That doesn't matter
visually, because native is optimistic, but the benchmark should measure JS-observed latency against
Expo, which uses Fabric `EventEmitter`.

**UI thread and worklets:**
- **v1: none.**
- **v1.1:** HybridObjects work on any runtime (`nitro:../docs/docs/guides/worklets.md`). A
  `useAnimatedReaction` worklet can call a boxed `hybridRef`'s setter (`progress`, `value`) on the UI
  runtime, which is the main thread. The setter writes the model directly, without React.
- **v2:**
  - Synchronous UI-thread *callbacks* (`onValueChange` as a worklet), using nitro-input's C++ bridge
    holding the worklets UI runtime and calling registered worklets by id (`input:src/specs/NitroInputWorklets.nitro.ts:3-13`,
    `input:src/NitroInput.tsx:1696-1720`).
  - Expo's `useNativeState` / `SyncToggle` is the competitor feature (`expo:expo-ui/ios/State/ObservableState.swift:15-38`).

## 5. Shared core module

The package `@nitro-ui/core` (with its own nitro.json, no views) contains:

**C++ (`cpp/nitroui/`):**
- `IntrinsicViewState`, `IntrinsicShadowNode`, `IntrinsicComponentDescriptor`, `SizeCache` (with the
  environment epoch), `LayoutLedger`, `StateUpdaters`, and `pushMeasured`.
- `PerfTrace`: a lock-free ring buffer of `{instanceId, kind, t_ns}` using `CLOCK_MONOTONIC` /
  `mach_continuous_time`.
- A HybridObject `NitroUICore` (`ios: 'c++', android: 'c++'`) exposing:
  - `now(): number` and `drainPerf(): PerfEvent[]`;
  - `setPerfEnabled(b)`;
  - `prewarm(specs)` (forwards to platform);
  - `hasSize(component, key): boolean`, for tests and plan B.

**iOS (Swift, plus a little ObjC++):**
- `NitroUIModel` (manual `objectWillChange`) and `ControlledValue<T>`.
- `NitroSwiftUIHost<Content: NitroUIContent>: UIView, NUISizeSinkReceiver`. It handles:
  - hosting setup, safe area and background;
  - containment, controlled by `needsContainment`;
  - `commit()` (one send, animation policy, then measure if `sizeDirty` and the key is not cached, then report);
  - trait-change re-measure, recycling reset, `onDropView` cleanup on main, and perf marks.
- `NUISizeSink` (ObjC++) and `NUISizeFlusher` (run-loop observer, budget, epsilon).
- `NitroUIPrewarmer`.
- `MainThread.ensure { }`.

**Android (Kotlin, plus JNI):**
- `NitroComposeModel` and `ControlledValue<T>`.
- `NitroComposeHost<M>: AbstractComposeView, NitroUIStateAware`. It handles owners, strategy,
  `IntrinsicRoot`, the dp conversion, the pre-draw flush and skip-frame, recycling, and perf marks.
- `NitroUISizing` (JNI push).
- `NitroUIPrewarmer`.

**JS:**
- `useStableCallback` and `useControlled(value, defaultValue, onChange)`, which returns
  `{ value, mostRecentEventCount, onNativeChange }`.
- `sizingKey(...parts)`, `processColor` memo helpers and `definedProps(obj)` (send only set props).
- `NitroUI.prewarm`, and `perf` (`now`, `drain`, a `markRender` helper for benchmarks).

**Build:** `scripts/nitrogen-postprocess.ts` (§1.6), shared by all component packages.

**Component example: Switch.** The target is about 60-120 lines per platform.

```ts
// Switch.nitro.ts
export interface SwitchProps extends HybridViewProps {
  nuiSizingKey: string
  value?: boolean; defaultValue?: boolean; mostRecentEventCount: number
  disabled?: boolean; tintColor?: number
  onValueChange?: (value: boolean, eventCount: number) => void
}
export type SwitchView = HybridView<SwitchProps, {}>
// Switch.tsx
export function Switch({ value, defaultValue, onValueChange, disabled, tintColor, style }: Props) {
  const c = useControlled(value, defaultValue ?? false, onValueChange)
  return <NativeSwitch nuiSizingKey="Switch|" value={c.value} defaultValue={defaultValue}
    mostRecentEventCount={c.mostRecentEventCount} onValueChange={c.onNativeChange}
    disabled={disabled} tintColor={useProcessedColor(tintColor)} style={style} />
}
```

```swift
final class SwitchModel: NitroUIModel { var v = ControlledValue(displayed: false); var disabled = false; var tint: Color?
  var onChange: ((Bool, Double) -> Void)? }
struct SwitchContent: NitroUIContent { @ObservedObject var model: SwitchModel
  var body: some View {
    Toggle("", isOn: Binding(get: { model.v.displayed },
                             set: { let n = model.v.user($0); model.objectWillChange.send(); model.onChange?($0, Double(n)) }))
      .labelsHidden().disabled(model.disabled).tint(model.tint)
  } }
final class HybridSwitch: HybridSwitchSpec, RecyclableView {
  let host = NitroSwiftUIHost<SwitchContent>(model: SwitchModel(), component: "Switch", sizing: .intrinsic)
  var view: UIView { host }
  var nuiSizingKey = "" { didSet { host.sizingKey = nuiSizingKey } }
  var value: Bool? { didSet { host.model.v.js = value; host.markDirty() } }
  var mostRecentEventCount = 0.0 { didSet { host.model.v.jsEvents = Int(mostRecentEventCount); host.markDirty() } }
  var defaultValue: Bool? { didSet { if host.isFirstUpdate, let d = defaultValue { host.model.v.displayed = d } } }
  var disabled: Bool? { didSet { host.model.disabled = disabled ?? false; host.markDirty() } }
  var tintColor: Double? { didSet { host.model.tint = tintColor.map(Color.init(processed:)); host.markDirty() } }
  var onValueChange: ((Bool, Double) -> Void)? { didSet { host.model.onChange = onValueChange } }
  func afterUpdate() { _ = host.model.v.reconcile(); host.commit() }
  func onDropView() { host.drop() }
  func prepareForRecycle() { host.recycle { $0.reset() } }
}
```

The Kotlin side is a mirror: `SwitchModel` with `mutableStateOf` fields, and
`class HybridSwitch(ctx) : HybridSwitchSpec(), RecyclableView` with `override val view = object : NitroComposeHost<SwitchModel>(ctx, SwitchModel(), "Switch", Sizing.Intrinsic) { @Composable override fun Control(m: SwitchModel) = Switch(checked = m.displayed, onCheckedChange = { m.user(it) }, enabled = !m.disabled) }`.

**Perf instrumentation**, compiled in but off by default. When disabled it costs one relaxed atomic load.
- **Marks:**
  - `js.render`: the JS wrapper calls `perf.now()`.
  - `native.propsApplied`: at the end of `afterUpdate`.
  - `native.measured` and `native.statePushed`.
  - `native.firstFrame`:
    - iOS: a `CATransaction` completion block registered in the first `commit()`, plus the next
      `CADisplayLink` tick's `targetTimestamp`.
    - Android: `ViewTreeObserver.registerFrameCommitCallback` (API 29+), falling back to `OnDrawListener`.
- `instanceId` comes from an optional `nuiPerfId` prop, only set by the benchmark app.
- **Benchmark matrix against `@expo/ui`:** mount 1/50/200 controls in a ScrollView (time from
  `js.render` to the last `firstFrame`, plus the main-thread busy time); toggle-to-JS latency;
  controlled round trip; memory per instance; and a FlashList scroll with recycling.

## 6. Children and containers (later): brief

- **Recommended: "Fabric nodes, virtual native" (Expo's model,
  `expo:expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIViewDefinition.swift:111-126`,
  `expo:.../ExpoComposeView.kt:152-169,227-230`).**
  - Every `<Section>`, `<Text>`, `<Toggle>` row is a Nitro Hybrid View, so it keeps typed props,
    React keys and ordering, and Fabric's atomic commits.
  - Its native `view` is a cheap placeholder that exposes `@ViewBuilder var content` /
    `@Composable fun Content()` plus its model.
  - The container (`Form`, `List`, `HStack`) owns the single UIHostingController / ComposeView. It
    receives children through Fabric's mount calls and renders `ForEach(children, id: \.identity)` /
    `key(child) { child.Content() }`.
  - **iOS:** post-process the container `.mm` to override `mountChildComponentView:index:` /
    `unmount…` so children are not added as subviews; forward them to the Swift host instead.
  - **Android:** replace the generated `SimpleViewManager` with a `ViewGroupManager`
    (`ctxmenu:android/.../ContextMenuViewManager.kt:14-48`). Child views are `GONE` and
    `setWillNotDraw(true)`.
  - Children use a Yoga-leaf container node (§1.5) so Yoga doesn't lay out virtual children.
- **Large data-driven lists:** `List(data)` backed by a HybridObject data source (`rows`, diffable ops,
  row templates by kind). Do not create 10k Fabric nodes. Native virtualizes (SwiftUI `List` /
  `LazyColumn`).
- **Rejected: general typed node ops from JS effects through a HybridObject.** They re-implement React
  reconciliation, and they are applied after the commit, not atomically with the Fabric mount, which
  causes tearing against sibling RN views.
- **RN content inside native containers:** a non-leaf slot node measured by Yoga, wrapped in
  `UIViewRepresentable` / `AndroidView`, isolated in a container view as Expo does
  (`expo:expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIViewHost.swift:26-38,82-95`).

---

## 7. Open risks / need prototype

| # | Risk / question | Prototype and exit criterion |
|---|---|---|
| R1 | Post-processing is coupled to nitrogen output shape (alias names, `.mm` and `.kt` anchors). | **P0:** generate HybridSwitch with nitro 0.37.1, apply the script, build on both platforms. The script hard-fails on a missing anchor. In parallel, open an upstream issue/PR for a custom-shadow-node hook. |
| R2 | Same-turn immediate state commits. iOS: a flush from a run-loop observer before the CA commit, while mounting is not in flight. Android: an immediate JNI push from `OnPreDraw` that returns `false` must re-layout in the next traversal without loops or crashes (Expo #47625, #49709 class). | **P1:** a cold-cache Switch and a Button with a new label. Record frames (60/120 Hz) and assert no frame shows the wrong size. Count commits. |
| R3 | `UIHostingController.sizeThatFits` before the view is in a window, immediately after `objectWillChange.send()`: does it reflect the pending update, and is the trait environment (dynamic type, bold text) right? | **P1:** if not, measure in `didMoveToWindow`/`layoutSubviews` instead, still before the CA commit. |
| R4 | Cost of N separate commits when many instances miss the cache in one commit. | **P1:** 200 distinct-label Buttons. If more than about 16 ms, implement the `cloneMultiple` batch commit (§1.5) or text-metric sizing. |
| R5 | Compose recomposition lagging the RN mount by one frame on prop updates. | **P4:** frame-by-frame capture of a controlled Switch toggled from JS. If it is visible, explore `Recomposer` frame-clock alignment or forcing a frame. |
| R6 | ViewTree owners missing in RN `Modal` (Dialog) and other non-activity windows. | Test Modal, react-native-screens formSheet, and `removeClippedSubviews` (Expo #51767). |
| R7 | Nitro callbacks bypass React event priority, so JS-observed latency may be worse than Fabric events. | Benchmark against `@expo/ui`. A possible fix is a Fabric `EventEmitter` path for value events, which needs another `.mm`/`.kt` patch. |
| R8 | Per-instance hosting cost: 200 UIHostingControllers and 200 AndroidComposeViews (time and memory). | **P3/P4:** compare UIHostingController with and without containment, and `UIHostingConfiguration.makeContentView()`. Compare cold vs pre-warmed Compose, with and without a baseline profile. |
| R9 | State/props races on Android. Nitro's `adopt` creates a new state on prop change while native pushes a size based on older data. Can a size or props get lost? | Stress test: rapid prop changes plus pushes. The cache makes a lost size self-healing; check that props are never stale. |
| R10 | `IntrinsicProps` inheritance in specs: does nitrogen flatten `interface X extends IntrinsicProps`? | P0. Otherwise declare `nuiSizingKey` per spec. |
| R11 | RN version floor. `unstable_Immediate` same-pass semantics need RN ≥ 0.82 (Expo `REACT_NATIVE_TARGET_VERSION >= 82`; true-sheet's comment). On RN ≥ 0.86 Android, base ViewProps are dropped (nitro#1655). | Set the floor at RN 0.82. Ship the nitro#1655 patch through post-processing until upstream fixes it. |
| R12 | Measured size vs Yoga feedback loops: Button Shapes, rounding, fill-width controls whose height depends on width. | Expo's budget-of-2 plus epsilon. Test with all accessibility text sizes. |

## References

- Sub-agent source reads, verbatim findings condensed above:
  - Expo UI hosting and sizing (expo @aa729f0a). Key files: `expo-modules-core/ios/Core/Views/SwiftUI/*`,
    `expo-modules-core/ios/Fabric/ExpoFabricViewObjC.mm`, `expo-modules-core/common/cpp/fabric/ExpoView*`,
    `expo-modules-core/android/src/compose/.../ExpoComposeView.kt`, `expo-ui/ios/HostView.swift`,
    `expo-ui/android/.../HostView.kt`.
  - Fabric state-based sizing: screens `common/cpp/react/renderer/components/rnscreens/legacy/*`,
    true-sheet `common/cpp/.../TrueSheetSpec/*` and `android/src/main/jni/TrueSheetStateUpdater.cpp`,
    RN `ReactCommon/react/renderer/{core,components/switch,components/textinput}`,
    `ReactAndroid/src/main/jni/react/fabric/StateWrapperImpl.cpp:53-60`,
    `ReactAndroid/.../fabric/FabricUIManager.cpp:19-72`.
- Expo issues: #50475, #51616, #44579, #47883, #51767, #50451, #50216, #49975, #47625, #49709.
- Nitro: `nitro:nitrogen/src/views/{CppHybridViewComponent.ts,swift/SwiftHybridViewManager.ts,kotlin/KotlinHybridViewManager.ts}`,
  `nitro:react-native-nitro-modules/cpp/views/*`, `nitro:react-native-nitro-modules/{apple,android/src/main/java/com/margelo/nitro}/views/*`.
