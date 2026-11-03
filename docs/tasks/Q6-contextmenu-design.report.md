# Q6 — ContextMenu design

**Branch:** `task/Q6-contextmenu-design` (from `origin/main` at `5a04da76`) · **Round:** 1 of up to 2 (brief: 1 round
plus at most 1 fix round) · **Lease:** none (research and design only, no devices)

Methods note: nothing was built or run. Sources, all read-only:
- this repo at `5a04da76`;
- `react-native` 0.88.0, `@expo/ui` 58.0.22 and `@react-native-harness/ui` 1.6.0 in the main checkout's `node_modules`;
- Xcode 27's iPhoneOS 27.0 SDK UIKit headers;
- public pages: react-native-context-menu-view's `main` (`ctxmenu:ios/ContextMenuView.m`, the Android
  `ContextMenuView.java`, README), zeego.dev, the `@react-native-menu/menu` README,
  dominicstop/react-native-ios-context-menu#9, an AppleVis bug report and WebKit bug 213953.

No local reference clone of zeego or react-native-context-menu-view exists on this machine. Prefixes: `rn:` is
`react-native` 0.88.0, `expo-ui:` is `@expo/ui`, `uikit:` is UIKit's `Headers/`, `harness-ui:` is
`@react-native-harness/ui`, `ctxmenu:` is react-native-context-menu-view `main`. A claim I could not check in a source
is marked *(reading)*.

## Summary

**API.** A `View` that opens Menu's `group` on a long press:
`<ContextMenu group onSelect onOpen onClose disabled title style>{children}</ContextMenu>`.
- The children are the trigger and stay in place; `style` is a full `ViewStyle`; `sizing: null`, with no fallback.
- No value, no handshake, no `open()`.
- Unlike Menu, `onOpen`/`onClose` fire on **both** platforms (UIKit's `willDisplay`/`willEnd`), in D32's order (the
  spike measures iOS's).

**iOS.**
- `UIContextMenuInteraction` on the generated component view, with a `UIMenu` built from Menu's rows and the system
  preview of that view.
- **No `.mm` patch.** Fabric already mounts the children there. G14's content-children patch would be *wrong* here: the
  content view's frame is inset by padding and border, so padded children would be offset twice.
- Minimum OS: the 15.1 floor; nothing needs more.

**Android.**
- A hand-written manager subclassing RN's `ReactViewManager`, so the box styles like a `View`. Children stay in place.
- A trailing `0 × 0` `NitroComposeHost`, hidden from Fabric's indices, composes an M3 `DropdownMenu` anchored to a
  zero-size box at the press point, with Menu's rows and `MenuWitness`.
- No touch root: the surface's own dispatcher already covers in-place children.

**Arbitration (the central risk).** RN's sources say neither platform cancels JS for us. Pressability fires `onPress` on
release after any hold.
- **iOS.** `RCTSurfaceTouchHandler` can't be prevented by a recognizer on a descendant view. So in
  `willDisplayMenuForConfiguration` we toggle the nearest surface handler's `enabled`, which is RN's own
  `_cancelTouches` → `touchCancel`.
- **Android.** The wrapper watches `dispatchTouchEvent`. When the long press fires it calls
  `NativeGestureUtil.notifyNativeGestureStarted` (JS gets one CANCEL), sends `requestDisallowInterceptTouchEvent(true)`
  up, and intercepts the rest of the gesture.
  - Slop, an ancestor's CANCEL or a child's disallow-intercept drops the pending press.
  - The deepest ContextMenu claims a nested gesture.

**Spike first: yes.** One round, both platforms (D19). It goes ahead only if four questions pass on both platforms:
- the inner `Pressable` never fires after the menu opens, and the next tap fires once;
- a scroll opens nothing, and nothing scrolls under an open menu;
- the iOS layout keeps Yoga's frames with padding and border;
- the Android popup lands within 1 dp of the press point.

Four more only inform the build: iOS pick order, screen-reader reach, iOS timing, a harness hold (Appendix G).

**For the owner:** the accessibility default, a held press in the harness, v1 scope, the shared Menu rows, and order.

## Gates

No code changed. `node scripts/gate.mjs table` (Node 24) prints `table: nothing recorded yet - run a gate first.` for
code tree `87d4b2ab0814` at `5a04da7`. This commit is docs-only, so the code tree stays the same. The brief asks for
no gate (read-only, no devices).

`need --for review` (run by `bun run task-ready`): `need: 3 gate(s) missing for review: check, harness:ios,
harness:android`. That is expected and deliberate: the brief asks for no gate, and nothing in the code tree changed.
`task-ready`'s other checks pass: registry, conformance coverage, no TODO/FIXME, every cited repo path exists, and the
gate table is the generated one.

## Red proofs

None. No test or gate was added. Every test planned in Appendix F names the mutation that has to turn it red.

## Files changed

- `docs/tasks/Q6-contextmenu-design.report.md` (new): this file.

## Follow-ups

- G14 question 1: ContextMenu doesn't need content children (B1), so `CONTENT_CHILDREN_VIEWS` keeps one entry, and
  answer (a) stands.
- Android, every generated manager: `SimpleViewManager` carries only `BaseViewManager`'s props, and its `borderRadius`
  setters just log "unsupported" (`rn:ReactAndroid/.../uimanager/BaseViewManager.java:840-844`). So `borderRadius` in a
  nitro-ui control's `style` does nothing on Android *(reading; not measured)*.
- Bench: an `open.context-menu` scenario needs a native "menu shown" stamp, which no scenario has (G11/G14's line).
- react-native-gesture-handler (Swipeable rows with context menus) is not a dependency here, so coexistence is
  unmeasured. Measure it with the dependency added for one commit, as D35 item 3 did for screens.
- Android context click (mouse right-click, stylus button → `performContextClick`) is not designed. iOS gets it from
  UIKit *(reading)*.

## Questions for orchestrator

- **A. How screen readers reach the menu.**
  - Options:
    - (a) The app sets `accessible` (and a label) on the ContextMenu, which makes the wrapper the element. Android puts
      the long-click action on it, iOS relies on UIKit's "Show Context Menu", and the docs say so.
    - (b) The wrapper is `accessible` by default. One element, but inner buttons become unreachable.
    - (c) Forward the action into the children. Android has no public mechanism, and iOS is unknown.
  - **Recommend (a)** for v1. The spike's question 6 decides whether iOS needs more.
- **B. A held press in the harness.** Today `userEvent` only taps (50 ms on Android, `harness-ui:UIHelperImpl.kt:37`).
  - Options:
    - (a) Patch `@react-native-harness/ui` with `longPressAt(x, y, ms)` on both platforms (D5/D11), recorded in
      `docs/upstream.md`.
    - (b) A test-only `nuiTestLongPress` in ContextMenu's own spec that dispatches through the window's root (Android).
    - (c) Real input only.
  - **Recommend (a).** The library then ships no touch injector. It is a missing feature rather than a bug, so D11's
    wording doesn't clearly cover it, which is why this is the owner's call.
- **C. v1 scope.**
  - Out of v1:
    - a custom preview (it needs RN children in UIKit's preview controller, G14's presented-window mechanism);
    - `previewBackgroundColor`;
    - tap-to-open over children (zeego's `action="press"`; `Menu` covers buttons);
    - `open()`/`close()` (D29's reasoning);
    - Android context click.
  - **Recommend confirming that cut.**
- **D. Shared rows.**
  - The ContextMenu build moves Menu's Android `MenuRow`/`MenuHeader`/`MenuWitness` and the JS `useMenuRows` into
    shared files.
  - That touches Menu, so Menu's harness re-runs on both platforms in that build.
  - **Recommend doing it in the build**, not as a task of its own.
- **E. Order.**
  - Q5 put ContextMenu after Checkbox, and G15 is in flight.
  - **Recommend running the spike when a device pair frees up**, in parallel with G15, and the build after a GO.

---

## Appendix A — Public API

```tsx
<ContextMenu
  group={{ actions: [{ id: 'reply', title: 'Reply' }], sections: [{ id: 'danger', items: [{ id: 'delete', title: 'Delete', destructive: true }] }] }}
  onSelect={(id) => run(id)}
  style={styles.row}
>
  <Pressable onPress={openMessage}>…</Pressable>
</ContextMenu>
```

```ts
// src/components/ContextMenu/ContextMenu.tsx  (public surface)
export interface ContextMenuProps extends ViewProps {
  group: MenuGroup;                 // Menu's type, unchanged (docs/components/menu.md "The group")
  children?: React.ReactNode;       // the trigger content, laid out in place
  title?: string;                   // optional header over the rows (iOS root UIMenu title; Android header row)
  disabled?: boolean;               // no menu; the children keep every gesture of their own
  onSelect?: (id: string) => void;
  onOpen?: () => void;              // both platforms
  onClose?: () => void;             // both platforms; after onSelect on a pick (D32)
}
// spec (ContextMenu.nitro.ts): rows: NitroUiMenuRow[] (Menu.nitro.ts's struct), title: string | null,
// disabled: boolean, testID: string | null, accessibilityLabel: string | null, nuiPerfId: number | null,
// onSelect?, onOpen?, onClose?   — methods (test-only, @internal, D14): nuiTestMenuProbe(),
// nuiTestSelectRow(id), nuiTestContextMenuReport(): string
```

**Repo conventions, and where each comes from.**
- Every native prop is `T | null`, and callbacks are the only `fn?` (D7, D7b).
- `rows` is Menu's flattened struct array, reused through `useMenuRows`. It is moved out of
  `src/components/Menu/Menu.tsx:287` into a shared module, so the array identity changes only when the menu does
  (`docs/research/nitro-patterns.md`).
- Callbacks go through `useStableCallback` with stable no-op defaults, as `Menu.tsx:362-427` does.
- Nitrogen names generated structs globally, so importing `NitroUiMenuRow` into a second spec should generate it once.
  The build checks the generated tree *(reading)*.

**Events (D32 applied, and improved).**
- `onOpen` fires when the menu is shown: iOS `willDisplayMenuForConfiguration`; Android at the long press's
  recognition.
- `onClose` fires exactly once for every `onOpen`, however the menu closed: a pick, an outside tap, back, `disabled`,
  a layout move, or a drop.
- A pick fires `onSelect`, then `onClose`.
- A quick tap fires neither, and neither does an iOS hold released before the lift (the interaction began but never
  displayed).
- The model's `open` flag guards the pair, as Menu's `setOpen` does (`HybridNitroUiMenu.kt:298-310`).
- Menu can't report open and close on iOS (SwiftUI, D32). ContextMenu can, because UIKit has public delegate calls for
  both.

**`disabled` while open closes the menu on both platforms.** iOS has `dismissMenu` (`uikit:UIContextMenuInteraction.h:73`).
D32's iOS limit doesn't apply here. **A `group` change while open** applies live: iOS through
`updateVisibleMenuWithBlock:` (iOS 14, `:68`), Android by recomposing.

**Layout.** No base style. Menu's `alignSelf: 'flex-start'` is right for a button, but a ContextMenu replaces a `View`
around existing content, so it must lay out exactly like that `View`. The box is Yoga's: a flex container sized by
`style` and children.

**Manifest.**
```json
{ "name": "ContextMenu", "hybridView": "NitroUiContextMenu", "implementation": "HybridNitroUiContextMenu",
  "id": "context-menu", "sizing": null, "hostable": false, "exampleTab": "contextmenu", "exampleLabel": "Context",
  "bench": true, "benchUnsuffixed": false, "smoke": true, "realInput": true,
  "realInputTitle": "a real long press opens the menu at the finger and the Pressable under it never fires",
  "androidViewManager": "NitroUiContextMenuViewManager" }
```
- `hostable: false`: a `<Host>` refuses React Native children by design. Add a `UNHOSTABLE_CONTROLS` row
  (`src/components/Host/HostChildren.ts:98`).
- `androidViewManager` is G14's key (`scripts/registry-core.mjs:198`).

**Platform differences, documented.** These are D29's: submenus nest on iOS and flatten under a divider on Android, and
`systemImage` is iOS-only. Expo's slot API (`Trigger`/`Items`/`Preview`, `expo-ui:src/swift-ui/ContextMenu/index.tsx`)
is not copied, because items stay data (D29).

## Appendix B — iOS

### B1. Where the children are, and why there's no `.mm` patch

The brief asks whether the content view needs G14's patch. **No: Fabric's own mounting is right, and the patch would
break layout.**

- **Where Fabric mounts.** `RCTViewComponentView` mounts each child into `currentContainerView`, which is the component
  view itself (`rn:React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:236`, `:1015-1045`). That is G14's
  finding. For a ContextMenu that is exactly the right place: the children are the trigger, and the component view is
  the box.
- **Why the patch breaks layout.**
  - The Hybrid View's view is installed with `setContentView:` and framed at `_layoutMetrics.getContentFrame()`
    (`:153-164`, `:696-697`). Its origin is at border plus padding (`rn:ReactCommon/react/renderer/core/LayoutMetrics.h:53-60`).
  - Yoga gives each child a frame "relative to the outer border of its parent" (`LayoutMetrics.h:24-25`).
  - So children mounted *into* the content view (`scripts/patch-nitrogen.mjs:413`'s list) would be offset by the inset
    twice. A `padding: 12` ContextMenu would draw its children at 24.
  - BottomSheet never meets this, because it has no `style`.
  - *(read from source, not measured; spike question 3 measures it)*
- **The content view.**
  - It is an empty `ContextMenuContentView: UIView`: `isUserInteractionEnabled = false`, transparent,
    `isAccessibilityElement = false`.
  - It is added at init, before any child exists. Fabric then inserts children at `0…n-1`, so it stays the last (top)
    subview.
  - It must take no touches: `betterHitTest` walks the subviews top-first (`:820-825`), and an interactive full-size
    content view would swallow every touch.
  - The unmount index assertion (`:259-268`) still holds, because the children keep indices `0…n-1`.

### B2. The interaction

- **Where it's attached.** In the content view's `didMoveToSuperview`, to `superview`, the generated component view.
  - A debug build asserts that the superview is an `RCTViewComponentView` (by `NSClassFromString`), which is the same
    shape `patch-nitrogen.mjs` hard-fails on (`"[self setContentView:view];"`).
  - It is attached once, when the generated `init` installs the content view (`updateView` → `setContentView:`,
    `nitrogen/generated/ios/c++/views/HybridNitroUiMenuComponent.mm:52-72` shows the shape), and it lives as long as
    the component view.
  - Drop and recycle never detach it. The generated `prepareForRecycle` runs `notifyOnDropView` *before* the reset
    (`:226-231`), so every iOS recycle is also a drop. An interaction removed at drop would leave the recycled view with
    no menu. Drop and reset dismiss the menu and clear the model instead, and with no rows the configuration is `nil`.
  - The delegate is a small object the Hybrid owns. The interaction holds it weakly.
- **`configurationForMenuAtLocation:`** (`uikit:UIContextMenuInteraction.h:112`).
  - It returns `nil` when `disabled` or there are no rows, so no highlight starts and the children are untouched.
  - Otherwise it returns `UIContextMenuConfiguration(identifier: generation, previewProvider: nil, actionProvider:
    { _ in model.buildMenu() })` and records the location for the report.
- **`willDisplayMenuForConfiguration:animator:`** (`:150`).
  - First it cancels React Native's touches (D2), then it sets `open` and fires `onOpen`.
  - It is the only moment that is both certain and late enough. A hold released earlier never displays a menu, so its
    `onPress` must survive.
- **`willEndForConfiguration:animator:`** (`:159`) closes, following B4's order rule.
- **Preview.**
  - Uses `configuration:highlightPreviewForItemWithIdentifier:` / `dismissalPreviewForItemWithIdentifier:` on iOS 16+
    (`:123`, `:132`), and their deprecated forms on 15.x (`:167`, `:179`).
  - Both return `UITargetedPreview(view: componentView, parameters:)`. The component view carries the app's background,
    border and children; the content view would not.
  - `visiblePath` (`uikit:UIPreviewParameters.h:39`) is the bounds rounded at `layer.cornerRadius` and `cornerCurve`
    when the radius is uniform, and the bounds otherwise. The background stays the system default.
  - A preview of other content is out of v1 (question C).

### B3. The menu tree

Built in UIKit from the same flattened rows Android parses (`parseMenuRows`'s rules, `HybridNitroUiMenu.kt:117`):

| Row | UIKit |
| --- | --- |
| action | `UIAction(title:image: UIImage(systemName:) identifier: id attributes: [.destructive?, .disabled?])`, handler → `pick(id)` |
| submenu | `UIMenu(title:image:children:)`, nested (D29) |
| section | `UIMenu(title: title ?? "", options: .displayInline, children:)` |
| root | `UIMenu(title: title ?? "", children:)` |

- **Untitled sections.** An untitled section is an inline menu built with its children. G9's empty inline group was
  SwiftUI's translation of a `Divider` header (`docs/tasks/G9-ios-menu-untitled-group.report.md`). Nothing translates
  here.
- **Row order.** `preferredMenuElementOrder = .fixed` on iOS 16+ (`uikit:UIContextMenuConfiguration.h:15-19`, `:53`),
  so the rows keep `group`'s order, as on Android. `.priority` keeps the first row "closest to the user's interaction
  point" (`:17`). That could reverse a menu that opens above the finger, and `.automatic` may do the same.
- **The probe.** `nuiTestMenuProbe()` hops to main, runs our own `configurationForMenuAtLocation` and action provider,
  and writes the tree in G9's `drawn=` format (`Open,(Share:AirDrop,Mail),(:Delete!,Archive~)`). It reads exactly what
  UIKit is handed; what UIKit *shows* is real input's job.

### B4. Order of a pick (D32)

- The action handler fires `onSelect`, and `willEnd` leads to `onClose`. UIKit's order of those two calls is
  **unmeasured**.
- The indirect evidence: `ctxmenu`'s `_cancelled` flag is set in `willDisplay`, cleared in the handler and read in
  `willEnd`. It only works if the handler runs first.
- **The rule.**
  - `willEnd` marks the menu as closing. `onClose` fires from the animator's completion (`addCompletion`,
    `uikit:UIContextMenuInteraction.h:85`), or on the next main-queue turn when the animator is `nil`.
  - A handler that runs before then fires `onSelect` first.
  - The hop orders two UIKit callbacks on main. It is not a thread hop, so AGENTS' "no redundant `main.async`" doesn't
    forbid it.
- If the spike sees the handler arrive after the completion, that is reported as an iOS limit for the owner (D32
  style).

### B5. OS floor and what UIKit gives for free

**OS floor.** The podspec floor is 15.1 (`docs/research/setup-decisions.md:194`).
- The interaction and its delegate calls are iOS 13.
- `menuAppearance` and `updateVisibleMenuWithBlock:` are iOS 14.
- The new preview names and `preferredMenuElementOrder` are iOS 16, gated with `#available`.
- Nothing needs iOS 17.4: G9's `performPrimaryAction()` is not used.

**What UIKit gives for free** *(reading)*: the lift, dimming, haptics, outside-tap dismissal, dragging to a row, and a
pointer's secondary click (compact appearance, `menuAppearance`, `:39`).

## Appendix C — Android

### C1. The view and its manager

- **`NitroUiContextMenuViewManager : ReactViewManager`.**
  - `ReactViewManager` is `public open` (`rn:ReactAndroid/.../views/view/ReactViewManager.kt:44`), so the wrapper gets
    every prop RN's `View` has: borders, `overflow`, `pointerEvents` (`:344`), `hitSlop`.
  - A generated `SimpleViewManager` gets only `BaseViewManager`'s, whose `borderRadius` just logs
    (`rn:ReactAndroid/.../uimanager/BaseViewManager.java:840-844`).
  - Its body is G14's manager body (`android/src/main/java/com/margelo/nitro/nitroui/NitroUiBottomSheetViewManager.kt:27-126`):
    a Hybrid holder, the generated state updater in `updateState`, `onDropView`, and `prepareForRecycle`.
- **`ContextMenuView : ReactViewGroup`.**
  - The RN children are its children at Fabric's indices, laid out by Fabric (`needsCustomLayoutForChildren() = false`).
  - One more child, the compose host, is kept **last** and hidden from `getChildCount`/`getChildAt`/`removeViewAt`, on
    top of `ReactClippingViewManager`'s versions (`rn:ReactAndroid/.../views/view/ReactClippingViewManager.kt:29-60`).
  - `removeClippedSubviews` on the wrapper itself is refused with a dev warning in v1. Its clipping list would have to
    stay out of the host's way, and a context-menu wrapper is not a scroll container.
- **No touch root.** The children never leave the surface's window, so the surface root's `JSTouchDispatcher` already
  covers them. G14 needed one only because the sheet is another window.

### C2. The composition

`ContextMenuHost : NitroComposeHost<ContextMenuModel>`:
- `isHostable = false`.
- `importantForAccessibility = NO_HIDE_DESCENDANTS`, as `HybridNitroUiBottomSheet.kt:383` does.
- The wrapper measures and lays it out at `0 × 0` in its own `onLayout`. `NitroComposeHost` assumes Fabric is its only
  measurer (`android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:57-66`), so the wrapper takes
  that role. This is a build item, and the spike shows it composes.

```kotlin
@Composable override fun Component(model: ContextMenuModel) {
  Box(Modifier.offset { model.pressPoint }.size(0.dp)) {        // the anchor is a point
    DropdownMenu(expanded = model.expanded, onDismissRequest = { model.setOpen(false) }) {
      MenuWitness(model)                                         // first child, as in Menu
      MenuRows(model.entries, model.enabled, onPick = model::applyPick)
    }
  }
}
```

- **How the press point reaches Compose.**
  - It is written on the UI thread at recognition, in px relative to the wrapper, as snapshot state.
  - It is read only in the `offset {}` lambda, so it costs a placement, not a recomposition. `expanded` flips in the
    same turn.
  - Material's position provider puts the menu's top-start at the anchor and flips it above or toward the start near an
    edge *(reading, m3 1.4.0; spike question 5 measures it)*.
  - It is plain `DropdownMenu`. `ExposedDropdownMenuBox` anchors to a trigger's own box (`docs/components/menu.md`
    "Inside a `Host`"), and here the anchor is a finger.
- **Shared with Menu** (question D).
  - `MenuRow`, `MenuHeader`, the entries loop and `MenuWitness` (`HybridNitroUiMenu.kt:699-840`) move to a shared file.
  - `parseMenuRows` and `applyPick` stay as they are, and `applyPick` keeps D32's order (`:462`).
- **Dismissal on a layout move.** The wrapper's `OnLayoutChangeListener` follows Menu's `noteAnchorBox` →
  `dropOpenMenu` (`:313`, `:360`). A scroll is not a layout move, as in H2b.

### C3. Why not the framework's menus

- `View.showContextMenu(x, y)` is Android's floating context menu, and `ctxmenu` uses it
  (`ctxmenu:android/.../ContextMenuView.java`). It is a framework menu, not Material 3 Compose.
- `PopupMenu` (`@react-native-menu/menu`, zeego's Android) anchors to the view's corner, not the finger.
- Neither shares Menu's rows or gives us a window we can witness.

## Appendix D — Gesture arbitration (the central risk)

### D1. What React Native does today

**iOS.** The surface's `RCTSurfaceTouchHandler` (`rn:React/Fabric/RCTSurfaceTouchHandler.mm`):
- has `cancelsTouchesInView = NO` and `delaysTouches* = NO` (`:152-158`);
- moves to `Began` on the first touch (`:314-318`);
- prevents nothing (`:381-384`);
- **cannot be prevented by any recognizer on a descendant of its view** (`:386-391`);
- cancels JS only for a *preventable* recognizer with `cancelsTouchesInView` (`:402-412`), which means only external
  ones.

A context-menu interaction on our view is a descendant, so UIKit's recognizers will never cancel JS for us.

**Pressability** fires `onPress` on release after a hold of any length, unless `onLongPress` is set
(`rn:Libraries/Pressability/Pressability.js:743-754`), and a terminate ends the press without it (`:522-528`). So a long
press that opened the menu would press the child on lift. Two libraries show it:
- Paper's react-native-ios-context-menu left the JS responder stuck (dominicstop#9: "your entire screen becomes
  unresponsive"; users worked around it with `delayLongPress={100}`).
- `ctxmenu` cancels nothing on either platform.

**Android.**
- The surface root sees every event in `onInterceptTouchEvent` (`rn:ReactAndroid/.../ReactRootView.java:261-267`).
- It keeps intercepting when a child disallows, and only passes the request up (`:454-460`).
- A native gesture takes over with `NativeGestureUtil.notifyNativeGestureStarted` →
  `JSTouchDispatcher.onChildStartedNativeGesture`. JS gets one CANCEL, and the rest of the gesture is dropped until the
  next DOWN (`rn:ReactAndroid/.../uimanager/JSTouchDispatcher.kt:46-67`, `:96-104`, `:121-124`). That is what a
  ScrollView does.
- `ctxmenu`'s Android view feeds a `GestureDetector` from `onInterceptTouchEvent` and never notifies. Its inner
  `Pressable` fires on release, and a child that disallows interception blinds it.

### D2. iOS: cancel at display, through RN's own path

1. **Before the lift: nothing.** Taps and short holds reach the children as they do today, since RN's recognizer is
   never prevented.
2. **In `willDisplayMenuForConfiguration`: cancel.**
   - Walk up from the component view to the nearest view carrying a recognizer of class `RCTSurfaceTouchHandler`: the
     surface's, an RN `Modal`'s, or a BottomSheet's own.
   - The class is looked up by name, as `NitroUiTouchRoot` does (`ios/components/BottomSheet/HybridNitroUiBottomSheet.swift:40-76`).
     That helper moves to `ios/core`.
   - Toggle its `isEnabled` false then true. That is RN's own `_cancelTouches` (`RCTSurfaceTouchHandler.mm:414-418`):
     `reset` sends `touchCancel` for every active touch (`:361-379`), and Pressability gets `onResponderTerminate`, so
     `onPressOut` fires with no `onPress` and no later `onLongPress`.
   - A disabled recognizer loses its touches, so no stray end arrives afterwards. If UIKit had already ended the touch,
     the set is empty and the toggle sends nothing.
3. **Scope.** All active RN touches on that surface are cancelled, a second finger elsewhere included. That is the
   scope RN's own external-recognizer cancel has.
4. **Scroll views** *(reading)*:
   - UIKit fails the interaction when an enclosing scroll view's pan begins first.
   - RN's JS `ScrollView` takes the responder on scroll, which terminates a child `Pressable` as it does today.
   - A horizontal `ScrollView` among the children pans, and a still hold over it opens the menu.
5. **A race.** A child's `onLongPress` (500 ms default, `Pressability.js:257`) races UIKit's lift, whose time is
   unmeasured. Spike question 7 measures touch-down → `willDisplay`. The docs say not to put `onLongPress` inside a
   ContextMenu.
6. **Nested ContextMenus:** UIKit picks the innermost interaction *(reading)*.
7. **Cosmetic:** the lifted snapshot can show a child mid-press (a `Pressable`'s opacity). The spike takes a
   screenshot.

### D3. Android: watch the gesture, and take it at the timeout

`ContextMenuView.dispatchTouchEvent` observes each event, then calls `super`.

- **DOWN** (one pointer, enabled, at least one row):
  - Record the point.
  - `postDelayed(fire, ViewConfiguration.getLongPressTimeout())`. That is 400 ms by default on current Android and
    follows the user's touch-and-hold setting *(reading)*.
  - Claim the gesture slot (below).
- **Keeping the stream.** `onTouchEvent` returns `true` for a DOWN no child took. In a plain RN tree nothing below
  consumes the DOWN, and without this the MOVE and UP go to the root's `onTouchEvent` and never reach the wrapper. JS
  is unaffected, because the root intercepts every event while it has a touch target. That is the path a native child
  that consumes the DOWN (a `ScrollView`) already takes.
- **Dropping the pending press:**
  - movement beyond `scaledTouchSlop`;
  - `ACTION_CANCEL` (an ancestor `ScrollView` intercepted);
  - `ACTION_POINTER_DOWN`;
  - `UP`;
  - a child's `requestDisallowInterceptTouchEvent(true)` passing through (overridden: cancel, then pass up). That is a
    `ScrollView` inside starting to drag.
- **When it fires:**
  1. `NativeGestureUtil.notifyNativeGestureStarted(this, lastEvent)` → JS CANCEL, so the `Pressable` gets
     `onPressOut` and nothing else.
  2. `parent.requestDisallowInterceptTouchEvent(true)`, so ancestor scrolls, pagers and stacks stand down.
  3. `onInterceptTouchEvent` returns `true` on the next event, so native children get `ACTION_CANCEL`.
  4. `performHapticFeedback(LONG_PRESS)`.
  5. `model.openAt(point)`.

  The rest of the gesture is swallowed, because Material has no drag-to-select. At UP or CANCEL,
  `notifyNativeGestureEnded` clears the flag (`JSTouchDispatcher.kt:70-76`); a DOWN clears it anyway (`:96-104`).
- **Nested ContextMenus.**
  - A parent's dispatch runs before its child's, so both would arm on the same DOWN.
  - Each ContextMenu on the path writes itself into a process-wide slot keyed by the gesture's `downTime`. The last
    writer, the deepest, is the only one whose timer may open.
- **A child's `onLongPress`** (500 ms in JS) never fires at the default timeout, because the CANCEL lands at 400 ms. With
  a 1000 ms or 1500 ms system setting it fires first, which is documented.
- **Ordering.** JS gets the CANCEL through the event dispatcher and `onOpen` through Nitro's callback, two different
  queues, so tests assert counts, never their relative order.

### D4. The cases, and their oracles

Each oracle is an echo row from the test screen.

| # | Case | Oracle |
| - | --- | --- |
| 1 | A quick tap on an inner `Pressable` | `press=1;opens=0` |
| 2 | A long press on that `Pressable`, which has no `onLongPress` | `pressIn=1;pressOut=1;press=0;opens=1`, and no `longPress` at the default timeout |
| 3 | After 2: lift, then tap a row | `select:<id>`, then `close` |
| 4 | After 2: tap outside the menu | `close=1;belowPress=0` |
| 5 | A drag in an ancestor vertical `ScrollView`, starting on the ContextMenu, before the timeout | `opens=0`, and the scroll offset moved |
| 6 | After 2: drag the finger | the scroll offset is unchanged |
| 7 | A horizontal `ScrollView` inside the ContextMenu is dragged | its offset moved, `opens=0` |
| 8 | Nested ContextMenus: a long press on the inner one | `inner opens=1;outer opens=0` |
| 9 | After a full menu cycle, a fresh tap on the same `Pressable` (the stuck-responder check) | `press=1` |
| 10 | `disabled`: a long press | `opens=0;press=1` |
| 11 | `disabled` becomes true while open | `close=1` |
| 12 | `group` changes while open | `rows=N` |
| 13 | A layout move while open (Android) | `close=1` |
| 14 | Dropped while open, and dropped during a pending press | `live=0` |

## Appendix E — Sizing, accessibility, recycling and drop

### Sizing (D17)

- **No sizing.** `sizing: null` means no measure function, no `nitro-ui.sizing.json` row and no declared fallback.
  D17's first-frame rule has nothing to apply to, because nothing is measured natively. The box is Yoga's, like a
  `View`'s.
- **Conformance.** The `declared-fallback` and `no-leak-on-drop` rules exempt it by manifest
  (`scripts/conformance-core.mjs:157-175`). The a11y and recycle rules apply.
- **Test.** A ContextMenu with `padding: 12` and `borderWidth: 2` around a 100 × 40 child must give the same box
  (128 × 68) and child frame (14, 14) as a twin `View` with the same style. The oracle is the twin, not a constant.

### Accessibility

**iOS.**
- RN's `accessible` and `accessibilityLabel` land on the component view, which also carries the interaction. The
  content view is not an element.
- VoiceOver lists "Show Context Menu" in the Actions rotor for views with a context menu and opens one with a triple
  tap *(reading: an AppleVis report against iOS 13; WebKit bug 213953)*.
- Whether that reaches an element *inside* the interaction's view is spike question 6.

**Android.**
- The wrapper sets `isLongClickable = true` and an `OnLongClickListener` that opens the menu at its centre, labelled
  through `ViewCompat.replaceAccessibilityAction(ACTION_LONG_CLICK, "Show menu")`. TalkBack's double-tap-and-hold sends
  that action to the focused node.
- The touch path never runs `View`'s own long-press check, because `onTouchEvent` doesn't call `super` for it. So there
  is no double open.
- The menu is reachable when the wrapper is the focused node, which `accessible` makes it (question A). An inner
  focusable child takes the focus, and its own long click.
- The rows are Menu's.

**X4 a11y rule.**
- The ContextMenu gets an `A11Y_CONTROLS` case for an `accessible` ContextMenu, and a G7b-style real-input read on each
  platform.
- "Only there" means the iOS content view and the Android compose host add no node of their own.

### Recycling (`RecyclableView`)

**Close first:** iOS `dismissMenu()`; Android `expanded = false`, as Menu's `reset()` does. Then:
- drop a pending long press and its gesture slot;
- clear the rows, `title`, flags, counters, the press point and the probe's answer.

On iOS the interaction stays on the component view it was recycled with. Fabric unmounts the children before pooling,
and the conformance suite's residue probe covers whatever is left.

### Drop

- **iOS:** `dismissMenu()`, drop the callbacks, and keep the interaction (B2: every iOS recycle runs the drop first).
- **Android:** `removeCallbacks` for a pending press, dispose the composition (which closes the window, and the witness
  goes to `live=0`), drop the callbacks.

A drop while open has nothing to undo, because JS was cancelled at the open.

## Appendix F — Harness, real-input and bench plans

Every new test is shown red first (AGENTS). Fixtures avoid coincidences: the padding fixture's child position is not
the box origin, and the press point is off-centre.

### F1. Harness (a new `ContextMenu.harness.tsx` in `example/__tests__/`), both platforms unless noted

1. **Layout like a `View`.** The padding/border fixture against a `View` twin.
   Red: add `HybridNitroUiContextMenu` to `CONTENT_CHILDREN_VIEWS` (iOS), and the child moves to 28.
2. **Children churn.** Mount, unmount and reorder five children 50 times. The order is read from `onLayout` `y`
   values, and iOS's debug unmount assertion is armed.
   Red: Android puts the host first (indices shift).
3. **Taps pass through.** `userEvent.press` on the inner `Pressable` gives `press=1;opens=0`, with a barrier twin.
   Red: iOS content view `isUserInteractionEnabled = true`; Android `dispatchTouchEvent` consuming without `super`.
4. **The tree.** `nuiTestMenuProbe()` gives `drawn=` for actions, a titled and an untitled section, a submenu, a
   destructive and a disabled row. Android reads the composed rows of an open menu (`rows=`).
   Red: G9's untitled branch, or a dropped `.destructive`.
5. **Picks.** `nuiTestSelectRow`: a disabled row and a disabled control report nothing, each with a barrier twin
   (`docs/architecture/core.md:523`). On Android an open menu reports `select` then `close`.
6. **`disabled`.** iOS: the probe's configuration is `nil`. Android: the count of armed long presses stays `arms=0`
   across a tap, while an enabled twin's reads `arms=1`.
7. **Recycle.** The conformance residue probe, plus `nuiTestContextMenuReport()` showing no rows, no `open` and no press
   point after a recycle. On iOS the recycled view, given rows again, still has its interaction (`interaction=1`) and
   a configuration.
   Red: detach the interaction in `onDropView` → the recycled view reports `interaction=0`.
8. **Leaks (Android).** 50 open/close/drop cycles give `live=0`.
9. **Arbitration, if question B is (a).**
   - Android: D4 cases 1–2, 4–11 and 13–14 through `longPressAt`, which dispatches through the root with real timing,
     so there is no timing fake. The popup's `menu=` rect is within 1 dp of the press point, and flipped above near the
     bottom edge.
   - Red: drop `notifyNativeGestureStarted` → `press=1`; drop `requestDisallowInterceptTouchEvent` → case 6's offset
     moves; drop the gesture slot → `outer opens=1`.
   - iOS: the same cases only if spike question 8 finds a synthesized hold opens the interaction.

### F2. Real input

**iOS: `testRealInputContextMenu`** (XCUITest, `example/ios/NitroUiExampleUITests/RealInputTests.swift`). It uses
`press(forDuration:)` and `press(forDuration:thenDragTo:)`, as `:4411`/`:4420` do.
- D4 cases 1–6, 8 and 9 on the echo.
- The rows are in the tree while the menu is up.
- The order is `open`, `select:<id>`, `close`.
- Red: skip the touch cancel → `press=1` after a hold.

**Android: `CHECKS['context-menu']`** (`scripts/real-input/controls.mjs`).
- A zero-distance `input swipe x y x y 1000` (`scripts/real-input/android.mjs:3917`) opens one popup window in
  `uiautomator dump`, with the rows.
- The popup's bounds are against the press point; back closes it; a row tap gives `select`, `close`.
- A drag before the timeout inside a `ScrollView` opens nothing.
- With `accessible`, the wrapper's node is `long-clickable="true"` with its label.
- Red: the same as F1 item 9.

A screen-reader listen stays a human pass, as for Menu.

### F3. Bench arms

**`mount.context-menu`** at N = 1/50/200, a two-`Text` row in each arm:
- nitro-ui;
- `rn-core`: the same row in a plain `View`. That is the floor, and the ratio is the cost of wrapping.
- iOS only: Expo's `ContextMenu` with an `RNHostView` trigger (`expo-ui:ios/ContextMenu/ContextMenu.swift`,
  `expo-ui:ios/RNHostView.swift`), as `expo-ui-*` arms. Expo ships no Android ContextMenu, only a `combinedClickable`
  modifier (`expo-ui:android/src/main/java/expo/modules/ui/ModifierRegistry.kt:789-803`).

What it measures:
- D15's targets apply on iOS. Android reports against `rn-core` only.
- Memory per instance matters on iOS: each interaction installs its own recognizers, and N = 200 list rows is the
  realistic case.
- The Android open latency (recognition → popup laid out) is reported in the spike, not gated (Follow-ups).

## Appendix G — Risks, and the spike

### Risks, in order

1. **Arbitration** (D). New ground for the repo: no nitro-ui component has touched RN's responder before.
2. **iOS: an interaction on a view we don't own.** The generated component view couples us to Nitro's
   `setContentView:` shape, the same anchor `patch-nitrogen.mjs` hard-fails on. The debug assert and harness item 2
   guard it.
3. **iOS: the order of a pick** (B4).
4. **Android: a new composition shape.** A `0 × 0` `NitroComposeHost` measured by its parent, with a popup anchored to
   a point.
5. **Accessibility reach** (E, question A).
6. **Perf:** an interaction per row at N = 200 (F3).
7. **Competition.**
   - zeego (on react-native-ios-context-menu and `@react-native-menu/menu`) and react-native-context-menu-view already
     ship context menus.
   - The differentiators: Material 3 Compose at the finger on Android; touch cancellation on both platforms (neither
     library does it); open and close events on both platforms; safety under drop and recycle.

### The spike (one round, both platforms, prototype never merged; D19's spike rule)

The prototype is a minimal `ContextMenu` (rows as data, both platforms) with no registry, docs or bench.

**Recommend running it before the build.** Arbitration is new to the repo, the iOS mount answer differs from G14's
mechanism (BottomSheet keeps its patch), and the Android anchor is a new composition shape.

| # | Question | GO when (both platforms unless noted) | Effect |
| - | --- | --- | --- |
| 1 | Does the cancel work? | A long press on a `Pressable` with no `onLongPress` opens the menu 10/10 with 0 `onPress`; a quick tap fires `onPress` 10/10 with no menu; after each cycle a fresh tap fires `onPress` exactly once | **no-go** if any `onPress` after open, or a stuck responder |
| 2 | Scrolls | A drag in an ancestor vertical `ScrollView` scrolls and opens nothing, 10/10; with the menu up the list doesn't move; a horizontal `ScrollView` inside pans | **no-go** if a scroll opens a menu or moves under an open one |
| 3 | iOS mount (B1) | The padding 12 / border 2 fixture places the child at Yoga's frame ±0.5 pt; 50 rounds of insert, remove and reorder with no RN assertion in a debug build | **no-go** for this design (the patch route would need a new content-frame patch) |
| 4 | iOS pick order (B4) | The log of handler, `willEnd` and completion over 10 picks gives `onSelect` before `onClose` 10/10 under B4's rule | informs: a miss is an iOS limit for the owner |
| 5 | Android anchor (C2) | The popup's top-start is within 1 dp of an off-centre press point; it flips above near the bottom edge; a screen recording shows no frame at the previous point | **no-go** if it can't anchor to a point |
| 6 | Screen readers | VoiceOver with an `accessible` wrapper and with an inner `Pressable`: is "Show Context Menu" offered? TalkBack double-tap-and-hold on an `accessible` wrapper opens it | informs question A (human pass, screenshots) |
| 7 | iOS timing | Touch-down → `willDisplay`, 10 samples, load-stamped, against Pressability's 500 ms | informs D2 item 5's doc line |
| 8 | Harness hold | Does a synthesized `UITouch` held for 1 s (HarnessUI's private path) open the interaction? | informs F1 item 9 on iOS |

**GO** means questions 1, 2, 3 and 5 pass on both platforms. The spike also records Android's open latency and one
lifted-preview screenshot per platform, with a `borderRadius` of 16.

## Appendix H — Prior art: what each ships per platform

| Library | iOS | Android | Copy / avoid |
| --- | --- | --- | --- |
| `@expo/ui` 58.0.22 | `ContextMenu`: SwiftUI `.contextMenu` on a SwiftUI trigger slot, optional `Preview` slot (iOS 16), items as SwiftUI child views (`expo-ui:ios/ContextMenu/ContextMenu.swift:4-60`); RN content needs `RNHostView` inside a `Host` | none; a `combinedClickable` modifier to pair with `DropdownMenu` yourself (`expo-ui:src/jetpack-compose/modifiers/index.ts:357-380`) | Copy: the preview as a later slot. Avoid: SwiftUI `.contextMenu`, which needs SwiftUI content, so a Host per ContextMenu (D23 measured an iOS Host losing on mount/unmount CPU), and items as child views |
| react-native-context-menu-view | `UIContextMenuInteraction` on the **first child**; `previewBackgroundColor` and border radius via `UIPreviewParameters`; `onPress`/`onCancel` through a `_cancelled` flag; `dropdownMenuMode` for tap (`ctxmenu:ios/ContextMenuView.m`) | the framework `ContextMenu` at the press point via `showContextMenu(x, y)`, with a `GestureDetector` in `onInterceptTouchEvent` (`ctxmenu:android/.../ContextMenuView.java`) | Copy: the preview parameters. Avoid: no RN touch cancel on either platform, and an interaction on a child the library doesn't own |
| zeego 3 | `react-native-ios-context-menu` 3.1 + `react-native-ios-utilities` (zeego.dev/start); `Preview` (iOS only), `onOpenChange`/`onOpenWillChange` | `@react-native-menu/menu` 1.2: the framework `PopupMenu`, anchored to the view, `shouldOpenOnLongPress` | Copy: the vocabulary (`Trigger action="press"` is question C's cut). Avoid: a different native component per platform, and three dependencies |
