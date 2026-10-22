# Nitro UI patterns — research digest

Source: a read-through of margelo/nitro (0.37.x), mrousavy/react-native-nitro-image,
margelo/react-native-vision-camera v5, mrousavy/react-native-data-scanner,
margelo/react-native-nitro-zxing, rive-app/rive-nitro-react-native,
jpudysz/react-native-unistyles v3, TheWidlarzGroup/react-native-video v7,
ronickg/react-native-nitro-input, kiethuynh0904/react-native-nitro-toast,
vineyardbovines/react-native-nitro-contextmenu, mgcrea/react-native-swiftui,
and mrousavy's `concentric-sheet` (Oct 2026).

Every agent working on this repo should read this before writing native code.

## Hard facts about Nitro Hybrid Views (0.37.x)

- A Hybrid View is a HybridObject with a `view`. Platforms: `ios: 'swift'`, `android: 'kotlin'` only.
  C++ is for HybridObjects that feed a view, not the view itself.
- Requires RN >= 0.78, New Architecture.
- **Leaf views.** Android codegen emits a `SimpleViewManager` (cannot hold children). iOS sets the
  Swift view as the `RCTViewComponentView` `contentView`. If a component needs RN children, Android
  needs a hand-written `ViewGroupManager` that replicates the generated state-updater call
  (see nitro-contextmenu `android/.../ContextMenuViewManager.kt`).
- **No custom measure.** The generated shadow node is a stock `ConcreteViewShadowNode`; Yoga never
  asks the native view for its size. `sizeThatFits` / `intrinsicContentSize` are ignored.
  Size must come from `style`, a JS-side measurement, or a hand-written shadow node.
- **Identity-based prop diffing** both in JS (`a !== b`) and native (`jsi::Value` strictEquals
  short-circuits conversion). Unmemoized objects/arrays and inline `callback()` wrappers are re-sent
  and re-applied every render.
- **Function props** must be wrapped as `callback(fn)` (`{ f: fn }`). Void callbacks are dispatched
  async to the JS thread.
- **Batching:** setters are called only for changed props, wrapped in `beforeUpdate()` / `afterUpdate()`.
  React-driven props arrive on the UI thread; props set via `hybridRef` may arrive on the JS thread.
- **Recycling** is opt-in (`RecyclableView` + `prepareForRecycle()`), you must reset *all* state.
- `memorySize` should report real native memory; `onDropView()` is the cleanup hook.
- **Known issues:**
  - RN >= 0.86 on Android: base `ViewProps` (backgroundColor, border, opacity, transform, testID,
    a11y) are dropped for Hybrid Views. Upstream fix margelo/nitro#1655 (patch available in
    ronickg/react-native-nitro-input `patches/react-native-nitro-modules@0.37.1.patch`).
  - Nitro < 0.37: `isDirty` flags break when Fabric recreates a view from an unchanged ShadowNode.
  - Fabric sends `null` for removed props; Nitro maps only `undefined` to "unset" (nitro#1184).

## Patterns to copy (ranked)

1. **State/resources live in HybridObjects; views are thin renderers** (nitro-image `Image` prop,
   VisionCamera `previewOutput`, Rive `RiveFile`/`ViewModelInstance`). Enables preload, sharing,
   correct first frame. Rive measured 94x faster multi-view load, 4.7x less memory from this alone.
2. **Dirty flags in setters, one commit in `afterUpdate()`** on the main thread (nitro-input, Rive).
   Separate cheap paths from expensive ones (rebind vs rebuild).
3. **SwiftUI/Compose hosting: set the root once, mutate a persistent model.** One `ObservableObject`
   (SwiftUI) / `mutableStateOf` holder (Compose) per view; `afterUpdate` writes only changed fields.
   Never replace `rootView` / call `setContent` per update. Avoid `AnyView` type-erasure at the root.
4. **Bypass React for high-frequency state:** Reanimated SharedValue listeners on the UI thread
   (VisionCamera zoom), synchronous UI-thread worklets (nitro-input), direct native writes.
5. **Two-phase sizing** (nitro-input): a synchronous native `measure()` HybridObject called during
   render seeds `style` width/height in the same commit; native then reports `onSizeChange`
   corrections (deferred outside commit), JS only `setState`s on real change.
6. **Controlled values use an event-count handshake** (RN TextInput style): native sends
   `(value, eventCount)`; JS echoes `mostRecentEventCount`; native ignores stale writes. Prevents
   flicker / lost input.
7. **Stable callbacks:** `useMemo(() => callback((...a) => latest.current?.(...a)), [])`.
   Only send props that are set.
8. **Lifecycle:** idempotent `dispose()`, real `memorySize`, tear down on native detach /
   `onDropView` (not from a JS unmount effect — Rive #356), `deinit` may run off-main so dispatch
   UI cleanup to main, HMR/StrictMode-safe hooks (Rive `useDisposableMemo`).
9. **Sync by default, async only when >~50ms** (`Promise.async` / `Promise.parallel(queue)`).
   Never block the JS thread on main-thread getters; never block main on MainActor.
10. **Listener APIs:** `addOnXListener(cb) -> { remove() }`, locked store, snapshot iteration.
11. **Platform-owned UI -> Promise-returning HybridObject, not a view** (data-scanner).
12. **Language per object:** shared C++ for pure compute; Swift/Kotlin where the platform API lives.

## Anti-patterns seen

- Whole-tree JSON serialization + `JSONDecoder` + fresh `AnyView` root per structural change (mgcrea).
- Relying on `sizeThatFits` for Yoga (ignored) -> hardcoded heights.
- Inline `callback()` -> dirty prop every render -> expensive rebuild (nitro-contextmenu).
- Mutating UI state from the JS thread on Android without confinement (nitro-toast).
- Extra `DispatchQueue.main.async` hops when already on main (frame lag).
- Applying props from a JS `useEffect` after mount (react-native-video v7).
- Swizzling / `DispatchQueue.main.sync` from JS / polling timers (concentric-sheet experiment).
