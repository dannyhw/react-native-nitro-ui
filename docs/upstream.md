# Upstream defects

Defects in other projects' code that this repository works around. Each entry states what is
wrong and in which version, the public evidence, what this repository does about it and where,
and when the workaround can be removed. When upstream ships a fix in a release this repository
can take, delete the workaround and the entry.

A patch in `patches/` must have an entry here. Patches are for development only: `patches/` is
not in `package.json` `files`, so no patch reaches a consumer.

File references into upstream packages are for the version named in each section heading.

## Status

| ID     | Upstream                                         | Defect                                                                | Upstream status                 | Here                                            |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| H1     | `@react-native-harness/platform-apple` 1.6.0     | `simctl install` is skipped when the app is already installed         | no issue filed                  | patched in `patches/`                           |
| H2     | `@react-native-harness/platform-apple` 1.6.0     | `simctl appinfo` exit 3 ("not installed") surfaces as a throw         | no issue filed                  | patched in `patches/`                           |
| H3     | `@react-native-harness/ui` 1.6.0                 | `screen.findByTestId` accepts no timeout                              | no issue filed                  | worked around in the test suite                 |
| H4     | `@react-native-harness/ui` 1.6.0                 | `screen.screenshot(element)` reports 0×0                              | no issue filed                  | worked around in the test suite                 |
| H9     | `react-native-harness` 1.6.0                     | no press reaches a control inside a React Native `Modal`              | no issue filed                  | no press in a second window; other oracles      |
| H10    | `react-native-harness` 1.6.0                     | iOS `queryByTestId` throws `No active window found` with a `Modal` up | no issue filed                  | no testID query in a second window              |
| H11    | `@react-native-harness/ui` 1.6.0                 | `userEvent` can only tap: no held press                               | no issue filed                  | patched in `patches/`                           |
| H7, H8 | `react-native-harness` 1.6.0                     | two reported issues avoided by repository layout                      | reported upstream               | hoisted install; runs start in `example/`       |
| N1     | `nitrogen` / `react-native-nitro-modules` 0.37.1 | Android base `ViewProps` are dropped for Hybrid Views                 | fixed in `#1749`, not in 0.37.1 | post-nitrogen patch and a shipped header        |
| N2     | `react-native-nitro-modules` 0.37.1              | a removed prop arrives as `null`, which crashes an optional prop      | open (`#1184`)                  | lint rule; specs use `T \| null`                |
| N3     | `nitrogen` 0.37.1                                | callback props must be optional; `fn \| null` throws at mount         | no issue filed                  | lint rule; specs use `fn?`                      |
| N4     | `nitrogen` 0.37.1                                | the generated Android view manager draws no border or radius          | no issue filed                  | documented limitation                           |
| N5     | `nitrogen` 0.37.1                                | the generated Android `updateState` runs twice for every new view     | no issue filed                  | documented floor, no code                       |
| N6     | `nitrogen` 0.37.1                                | no hook for a custom shadow node or state                             | no issue filed                  | post-nitrogen patch from `nitro-ui.sizing.json` |
| B1     | `create-react-native-library` 0.64.0             | the `nitro-view` template omits `react { jsRootDir }`                 | no issue filed                  | fixed in `android/build.gradle`                 |

---

## react-native-harness 1.6.0

`react-native-harness` and the `@react-native-harness/*` packages are pinned at exactly 1.6.0 in
`example/package.json`. The patches are applied through `patchedDependencies` in `package.json`
(mirrored in `bun.lock`). Issues belong in `callstackincubator/react-native-harness`.

### H1 — the Apple runner skips `simctl install` when the app is already installed

**Defect.** `getAppleSimulatorPlatformInstance` (`@react-native-harness/platform-apple`,
`dist/instance.js`) installs the app only when `simctl.isAppInstalled(udid, bundleId)` answers
false. That check proves some build is present, not the build under test. JS comes from Metro
and native code does not, so on a reused simulator a run executes an older binary against new
JS, and the failures look like component bugs.

**Today.** Patched: the `dist/instance.js` hunk of
`patches/@react-native-harness%2Fplatform-apple@1.6.0.patch` removes the check, so every run
calls `simctl.installApp(udid, getHarnessAppPath())`. `simctl install` keeps the app container.

**Issue draft.**

```text
Title: iOS runner skips `simctl install` when any build of the app is already installed,
       so a run can test a stale binary

Reproduction
1. Build the app (Debug) and install it on a simulator.
2. Change native code only, rebuild, and run the harness against the same simulator with
   HARNESS_APP_PATH pointing at the new .app.

Expected
The app at HARNESS_APP_PATH is installed before the run.

Actual
`getAppleSimulatorPlatformInstance` asks `simctl.isAppInstalled(udid, bundleId)`, gets true
from the previous build, and skips the install. The tests run the old binary against JS
served by Metro.

Suggested fix
Always `installApp(udid, getHarnessAppPath())` after the simulator is booted. `simctl
install` preserves the app container. If a fast path is wanted, compare the installed
bundle's CFBundleVersion or mtime with the app on disk; never skip on "some build exists".
```

**Removal.** When a release installs unconditionally, or verifies the exact bundle, delete the
`dist/instance.js` hunk of the patch and this entry, then re-pin.

### H2 — `simctl appinfo` exit 3 ("not installed") surfaces as a rejected spawn

**Defect.** `xcrun simctl appinfo <udid> <bundleId>` exits 3, with the message on stderr and
nothing on stdout, when the bundle id has no application record. `getAppInfo`
(`@react-native-harness/platform-apple`, `dist/xcrun/simctl.js`) therefore never reaches its own
not-installed branch: the spawn rejects, `isAppInstalled` throws instead of returning `false`,
and the run fails on a simulator where the app is not installed yet. `createAppSession`
(`dist/instance.js`) calls `getAppInfo` on every session and reads the result with optional
chaining, so the caller already expects `null`.

**Evidence.** With Xcode 27 and a booted iOS 27.0 simulator:

```text
$ xcrun simctl appinfo <udid> com.nitroui.doesnotexist; echo "exit=$?"
exit=3
stderr:
An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=3):
Simulator device failed to lookup application properties for com.nitroui.doesnotexist.
No application record found for that bundle identifier
Underlying error (domain=NSPOSIXErrorDomain, code=3):
	Application not found
	No application record found for that bundle identifier
```

The same command against a simulator that is shut down exits 149 with
`Unable to lookup in current state: Shutdown`. That is a real error and stays one.

**Today.** Patched: the `dist/xcrun/simctl.js` hunk of
`patches/@react-native-harness%2Fplatform-apple@1.6.0.patch` makes `getAppInfo` return `null`
when the failed spawn's stdout or stderr matches `APP_INFO_NOT_INSTALLED`, and rethrow anything
else.

**Issue draft.**

```text
Title: getAppInfo treats `simctl appinfo` exit 3 ("Application not found") as a fatal
       error instead of "not installed"

Reproduction
1. Boot a simulator and do not install the app under test.
2. Start a harness run against it, or run:
   xcrun simctl appinfo <udid> <bundle.id.that.is.not.installed>; echo "exit=$?"

Expected
`getAppInfo` returns null and `isAppInstalled` returns false.

Actual
`simctl appinfo` exits with code 3 and writes "No application record found for that bundle
identifier / Application not found" to stderr; stdout is empty. The spawn rejects, so
`getAppInfo` and `isAppInstalled` throw and the run fails.

Suggested fix
In `getAppInfo`, catch the failed spawn and return null when the child exited with code 3
and its stderr matches the not-installed wording; rethrow otherwise. Exit 149 with "Unable
to lookup in current state: Shutdown" must not be read as "not installed".
```

**Removal.** When `getAppInfo` handles exit 3, delete the `dist/xcrun/simctl.js` hunk and this
entry. If the H1 hunk is gone too, delete the patch file and its `patchedDependencies` line in
`package.json` and `bun.lock`.

### H3 — `screen.findByTestId` accepts no timeout

**Defect.** `findByTestId`, `findAllByTestId`, `findByAccessibilityLabel` and
`findAllByAccessibilityLabel` (`@react-native-harness/ui`, `dist/screen.js` and
`dist/screen.d.ts`) take one argument and call `waitFor` with no options, so they wait for
`waitFor`'s defaults: `interval = 50, timeout = 1000` (`@react-native-harness/runtime`,
`dist/waitFor.js`). A hosted control is queryable only after mount, layout and commit, which
takes longer than 1 s on a loaded machine, and the failure
(`Unable to find element with testID: …`) reads like a missing element. `render` does accept a
timeout.

**Today.** Worked around in the test suite. Each harness test file that renders its own control
defines `waitForTestId` (see `example/__tests__/Switch.harness.tsx`): it polls the non-throwing
`HarnessUI.queryByTestId` every 50 ms for up to 10 s, then returns `screen.findByTestId`'s
reference.

**Issue draft.**

```text
Title: screen.find*ByTestId exposes no timeout, so a slow first mount fails as a missing element

Reproduction
Render a component whose native view is slow to become queryable (a view hosting SwiftUI or
Compose on a cold emulator is enough), then:
   await render(<Switch testID="sized" />);
   const element = await screen.findByTestId('sized');

Expected
`screen.findByTestId(testId, { timeout, interval })`, or a harness-wide query timeout, the
way `render()` already accepts `{ timeout }`.

Actual
The signature is `(testId: string) => Promise<ElementReference>`. It calls `waitFor` with no
options, so the timeout is fixed at 1000 ms with a 50 ms interval. A control that mounts in
1.2 s fails with "Unable to find element with testID: sized".

Suggested fix
Accept `waitFor`'s options on all four `find*` methods and pass them through. Name the
timeout in the failure message.
```

**Removal.** When the queries take a timeout, delete the `waitForTestId` helpers, pass a timeout
at their call sites, and delete this entry.

### H4 — `screen.screenshot(element)` reports 0×0

**Defect.** For an element target, `screenshot` (`@react-native-harness/ui`, `dist/screen.js`)
builds the capture box as `{ nativeId, x: 0, y: 0, width: 0, height: 0 }` and returns
`width: 0, height: 0`. `wrapElement` keeps only `nativeId` from the native query, and
`captureScreenshot` (`dist/HarnessUI.d.ts`) returns a base64 string only, so JS cannot recover
the size of an element or of its capture.

**Today.** Worked around in the test suite. Tests read a laid-out box from the `HarnessUI`
TurboModule's `queryByTestId`, which returns `x`, `y`, `width` and `height`. Each harness test
file that needs a box declares the module (`harnessUi` in `example/__tests__/Switch.harness.tsx`).
`screen`'s element references are used for presses only.

**Issue draft.**

```text
Title: screen.screenshot(element) returns width/height 0, and element references drop their bounds

Reproduction
   const element = await screen.findByTestId('sized');
   const shot = await screen.screenshot(element);
   console.log(shot?.width, shot?.height);   // 0 0
Compare: TurboModuleRegistry.getEnforcing('HarnessUI').queryByTestId('sized') has real
x/y/width/height.

Expected
`shot.width` and `shot.height` describe the captured image, as they do for a `BoundingBox`
target.

Actual
0 0. For an element target the capture box is built with zeros and the result reports the
JS-side target size. `captureScreenshot` returns only a base64 string, and `wrapElement`
discards the `ViewInfo` bounds.

Suggested fix
Return the real size with the image: read it from the PNG header in `screenshot()`, or
return `{ base64, width, height }` from `captureScreenshot`. Keep the bounds on the element
reference.
```

**Removal.** When `screenshot(element)` reports real sizes and element references carry bounds,
read boxes through the harness API, remove the `HarnessUI` declarations that nothing else needs,
and delete this entry.

### H9 — no press reaches a control inside a React Native `Modal`

**Defect.** A control inside React Native's `Modal`, which is a second window, cannot be pressed
on either platform. The native query finds it and reports a real frame, and
`userEvent.pressAt` at that frame's centre changes nothing. React Native's own `Switch` in the
same dialog ignores the same press, so the control is not the cause. `userEvent.press(element)`
calls `simulatePress(nativeId, 0, 0)` (`@react-native-harness/ui`, `dist/userEvent.js`), which
resolves the view against the first window.

**Evidence** (React Native 0.88, an API 35 emulator and an iOS 27 simulator). On Android the
native query returns `{"x":182.5,"y":433.1,"width":46.5,"height":27.0}` for React Native's
`Switch` inside a `Modal`, and `userEvent.pressAt` at its centre leaves `onValueChange` uncalled.
The library's `Switch` in the same dialog, at
`{"x":179.8,"y":398.9,"width":51.8,"height":48}`, ignores the same press and a vertical sweep
of ±24, 40, 48, 80 and 120 dp. On iOS the press misses as well.

**Today.** No harness test presses inside a `Modal`, a dialog, a sheet or a popover. The `Modal`
case in `example/__tests__/Switch.harness.tsx` asserts the host's own measurement and a prop
write, both read through `hybridRef`. The suites for presented surfaces (`Dialog`,
`BottomSheet`, `Popover`, `Tooltip`) read native reports and run the real handlers through
test-only methods (`nuiTest…`), and presses that have to land in a second window are made with
OS-level input by the real-input suite (`scripts/real-input/`).

**Issue draft.**

```text
Title: no way to press a control inside React Native's Modal (Android and iOS)

Reproduction (react-native-harness 1.6.0, RN 0.88)
1. Render <Modal visible><Switch testID="m" onValueChange={...} /></Modal> with React
   Native's own Switch.
2. const box = harnessUi.queryByTestId('m');          // real x/y/width/height
   await userEvent.pressAt(box.x + box.width / 2, box.y + box.height / 2);

Expected
The dialog window takes the tap: the Switch flips and onValueChange fires.

Actual
Nothing happens. Android (API 35): query = {x: 182.5, y: 433.1, width: 46.5, height: 27.0},
the Switch is untouched, and a +/-120 dp sweep around the centre also misses. iOS 27
simulator: same miss. `userEvent.press(element)` resolves the native id against the first
window only.

Suggested fix
Deliver coordinate presses to the window that owns the point, and resolve native ids
across all windows of the app.
```

**Removal.** When a press reaches a second window, add a `userEvent.pressAt` and an event
assertion to the `Modal` test in `example/__tests__/Switch.harness.tsx`, and delete this entry.

### H10 — the iOS testID query throws `No active window found` with a `Modal` open

**Defect.** On iOS, with a React Native `Modal` visible, `HarnessUI.queryByTestId` can throw
`No active window found` instead of returning the element or `null`. It is intermittent: a
dialog holding one control queries successfully, and the same test with a second plain control
in the dialog throws on the first query.

**Today.** Harness tests do not query a testID inside a second window. Tests of presented
surfaces read the control's native report instead (see the header comments of
`example/__tests__/Dialog.harness.tsx` and `example/__tests__/Sizing.harness.tsx`,
`sizes a control inside a Modal`).

**Issue draft.**

```text
Title: queryByTestId throws "No active window found" while a React Native Modal is visible

Reproduction (react-native-harness 1.6.0, RN 0.88, iOS simulator)
1. Render <Modal visible> with two plain controls inside it, each with a testID.
2. Call HarnessUI.queryByTestId on one of them.

Expected
The element, or null when it is not there.

Actual
The call throws "No active window found", intermittently: with one control in the dialog
the query succeeds, with two it throws.

Suggested fix
Return null from the non-throwing query, and time out in `findBy*`. If a window is
unreachable, say which window and what was searched.
```

**Removal.** When the query returns `null` instead of throwing, delete this entry and the notes
that cite it in `example/__tests__/`.

### H11 — `userEvent` has no held press

**Defect.** The only touch `@react-native-harness/ui` injects is a tap: `simulatePress` sends a
DOWN and an UP 50 ms apart on Android (`UIHelperImpl.kt`, `TAP_DURATION_MS = 50L`) and a
`UITouch` that begins and ends 50 ms apart on iOS (`HarnessUI.mm`, `kTapDuration = 0.05`). The
TurboModule spec (`src/NativeHarnessUI.ts`) has `simulatePress`, four queries,
`captureScreenshot`, `typeChar` and `blur`. No long-press recognizer fires, so nothing that
reacts to a held touch can be tested in the app.

**Today.** Patched: `patches/@react-native-harness%2Fui@1.6.0.patch` adds a
`simulateLongPress(nativeId, x, y, durationMs)` TurboModule method on both platforms (the tap's
own path with the touch held for `durationMs`, and `isTap` off on iOS), and
`userEvent.longPress(element, ms)` and `userEvent.longPressAt(x, y, ms)` in `src/` and `dist/`.
Codegen reads `src/`, so an app build regenerates the spec.
`example/__tests__/ContextMenu.harness.tsx` and `example/__tests__/Slider.harness.tsx` use
`longPressAt`.

**Issue draft.**

```text
Title: userEvent has no long press

userEvent.press / pressAt send a 50 ms tap (Android TAP_DURATION_MS, iOS kTapDuration),
so nothing that reacts to a held touch - a Pressable's onLongPress, a
UIContextMenuInteraction, a Compose combinedClickable - can be tested in-app.

Suggested API
  userEvent.longPress(element, durationMs = 1000)
  userEvent.longPressAt(x, y, durationMs = 1000)
backed by a simulateLongPress(nativeId, x, y, durationMs) native method that is
simulatePress with the touch held for durationMs (iOS: setIsTap:NO).
```

**Removal.** When `userEvent` ships a held press, switch the two test files to it, then delete
the patch file, its `patchedDependencies` line in `package.json` and `bun.lock`, and this entry.

### H7, H8 — reported harness issues avoided by repository layout

| ID  | Issue                                                                         | Behaviour                                                     | What this repository does                                                    |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| H7  | [#215](https://github.com/callstackincubator/react-native-harness/issues/215) | two copies of `react-native` in a monorepo break view configs | bun's hoisted linker (`bunfig.toml`) and one React Native version everywhere |
| H8  | [#273](https://github.com/callstackincubator/react-native-harness/issues/273) | the runner must start from the app directory                  | the harness scripts run through `bun --cwd example` (`package.json`)         |

**Removal.** When a release this repository takes fixes one, delete its row.

---

## react-native-nitro-modules and nitrogen 0.37.1

The repository builds with `nitrogen ^0.37.1` and has a peer dependency on
`react-native-nitro-modules ^0.37.1` (`package.json`). Issues belong in `margelo/nitro`.

### N1 — Android base `ViewProps` are dropped for Hybrid Views

**Defect.** On Android a Hybrid View ignores React Native's base props: `backgroundColor`,
`opacity`, `transform`, `testID` and the accessibility props. nitrogen 0.37.1 generates a `Props`
constructor with an empty body, so `Props::initializeDynamicProps` is never called.

**Upstream.** Reported as [#1656](https://github.com/margelo/nitro/issues/1656) and fixed by
[#1749](https://github.com/margelo/nitro/pull/1749). The fix is not in 0.37.1; it is in the
`0.37.2-nightly` and `1.0.0-alpha.nightly` builds. Code generated by a nightly nitrogen calls
`nitro::RawPropsCompat::initializeDynamicProps`, a runtime helper that 0.37.1 does not have, so
it does not build for a consumer on 0.37.1 and cannot be shipped under a `^0.37.1` peer range.

**Today.** `bun run nitrogen` is `nitrogen src && node scripts/patch-nitrogen.mjs`, and
builder-bob's `custom` target runs the same script, so `prepare` and `npm pack` ship patched
code. `patchComponentSource` in `scripts/patch-nitrogen.mjs` rewrites the empty constructor of
every generated `*Component.cpp` and adds the include:

```cpp
// nitrogen/generated/shared/c++/views/HybridNitroUiSwitchComponent.cpp
#include "NitroUiPropsCompat.hpp"
// ... in the Props constructor:
    // nitro-ui: initializeDynamicProps
    ::nitroui::compat::initializeDynamicProps(*this, sourceProps, rawProps, filterObjectKeys);
```

`cpp/NitroUiPropsCompat.hpp` is a header-only copy of the upstream helper in namespace
`::nitroui::compat` (`nitroui::` would collide with the generated `margelo::nitro::nitroui`).
It calls `initializeDynamicProps` unconditionally on Android and refuses to compile against a
React Native older than 0.88. The rewrite skips a file that already contains upstream's
`RawPropsCompat::initializeDynamicProps`, is idempotent through `PATCH_MARKER`, and exits 1 when
a generated `*Component.cpp` has neither the upstream call nor the anchor, so a nitrogen upgrade
cannot drop the fix silently. `scripts/__tests__/patch-nitrogen.test.js` covers it, and
`bun run nitrogen:check` (`scripts/nitrogen-check.mjs`) fails on drift.

**Removal.** When a stable release contains #1749: raise `nitrogen` and the peer range to it and
regenerate. The rewrite then skips every file. Delete `patchComponentSource`, `PATCH_MARKER` and
their tests, `cpp/NitroUiPropsCompat.hpp`, the ViewProps check in `scripts/nitrogen-check.mjs`,
the paragraph about it in `CONTRIBUTING.md` ("Nitrogen and the ViewProps patch"), and this
entry. `scripts/patch-nitrogen.mjs` itself stays while N6 needs it.

### N2 — a removed prop arrives as `null`, which crashes an optional prop

**Defect.** Fabric sends `null` for a prop that was removed, and Nitro's
`JSIConverter<std::optional<T>>` accepts only `undefined`. A `label?: string` prop that goes
from `'x'` to `undefined` crashes the app on Android with React Native 0.88:

```text
Exception in HostFunction: NitroUi.label: Value is null, expected a String
```

**Upstream.** Open: [#1184](https://github.com/margelo/nitro/issues/1184).

**Today.** Hybrid View props are never optional.

- Lint: `nitro-ui/no-optional-view-props` (`eslint-rules/index.js`, enabled in
  `eslint.config.mjs`) rejects a `?:` member in a Hybrid View props interface.
- Specs declare "unset" as `T | null`, which nitrogen maps to `Variant_NullType_T`
  (`src/components/Switch/Switch.nitro.ts`).
- Wrappers send every native prop on every render, with `?? null` for an unset one
  (`src/components/Switch/Switch.tsx`).

**Removal.** When a released converter accepts `null` as `std::nullopt`, optional props become
legal: delete the rule from `eslint-rules/index.js` and `eslint.config.mjs`, the matching rule in
`docs/DESIGN.md`, and this entry. Specs and wrappers stay correct as written.

### N3 — callback props must be optional; `fn | null` throws at mount

**Defect.** React Native cannot send a function as a prop, so Nitro sends `{ f: fn }` and
unwraps `f` only when the prop type is a function (`IsFunctionProp`). For a `fn | null` union
nitrogen 0.37.1 generates `std::variant<std::function<…>, NullType>`, which is not a function
type: the wrapper is never unwrapped and converting the prop throws while the view mounts.
Codegen reports nothing.

**Today.** Callback props are declared `fn?`, the one exception to the rule in N2
(`onValueChange?:` in `src/components/Switch/Switch.nitro.ts`). The lint rule's
`callbackPropNotNullable` and `callbackPropMustBeOptional` messages (`eslint-rules/index.js`)
enforce both directions. `useStableCallback` (`src/core/useStableCallback.ts`) builds `{ f }`
once per mounted view, and a wrapper never sends `null` for a callback while mounted.

**Issue draft.**

```text
Title: Function props cannot be nullable: `fn | null` produces std::variant<std::function,
       NullType>, which IsFunctionProp rejects, so the prop conversion throws at mount

Reproduction
1. Declare a Hybrid View prop as a nullable callback:
   onValueChange?: ((v: boolean) => void) | null   // or the non-optional nullable form
2. Generate with nitrogen 0.37.1 and mount the view from JS, passing a function.

Expected
`fn | null` works like every other nullable type, or nitrogen rejects the declaration at
codegen time with a message that function props must be `fn?`.

Actual
Codegen succeeds. The generated prop type is std::variant<std::function<…>, NullType>, so
IsFunctionProp does not unwrap Nitro's `{ f }` wrapper and converting the prop throws while
mounting.

Suggested fix
Treat a nullable function prop as an optional function in the generator, or emit a codegen
error pointing at `fn?`.
```

**Removal.** When nullable callbacks work, delete the two `callbackProp*` messages, the spec
comment in `src/components/Switch/Switch.nitro.ts`, the matching rule in `docs/DESIGN.md`, and
this entry.

### N4 — the generated Android view manager draws no border or radius

**Defect.** With N1 patched, `backgroundColor`, `opacity`, `transform`, `testID` and the
accessibility props work on an Android Hybrid View, and `borderWidth`, `borderColor` and
`borderRadius` still draw nothing: nitrogen generates a `SimpleViewManager`, and the border
props are implemented in React Native's `ReactViewManager`.

**Today.** A documented limitation with no code: wrap the control in a `View` for a border or a
radius. Whether to draw them in Compose instead is an open question in `docs/DESIGN.md`. No
issue is filed, because `SimpleViewManager` is a reasonable generator default and the fix may
belong in this library.

**Removal.** When the open question is decided, replace this entry with the implementation or
with a line in the component pages.

### N5 — the generated Android `updateState` runs twice for every new view

**Defect.** On Android every newly created Hybrid View receives `updateState` twice:
`ViewManager.createViewInstance` applies the initial state, and Fabric's
`FabricMountingManager.cpp` emits an `UpdateStateMountItem` for every Insert of a view that has
state. React Native's own view managers tolerate the repeat. The manager nitrogen generates
does not short-circuit it: it runs `beforeUpdate`, `updateViewProps` and `afterUpdate` again with
an unchanged props snapshot, which costs one JNI props diff that applies no setter, one
`reconcile()` that applies nothing, and one perf mark. No second composition happens:
`NitroComposeHost.commit()` returns when nothing is dirty.

**Today.** No code. The `propsApplied` perf mark reads 2.00 per instance on an Android mount and
1.00 on an update (1.00 everywhere on iOS). That is the floor for every Android component, not
a regression in one.

**Upstream.** No issue filed. The double delivery is Fabric's design, so the improvement is
Nitro's: the generated `updateState` can return before `beforeUpdate` when the incoming props
snapshot equals `holder.lastState`.

**Removal.** When the generator short-circuits, delete this entry and the line that cites it in
`docs/DESIGN.md`.

### N6 — no hook for a custom shadow node, so a self-sizing view is post-processed

**Defect.** Fabric's state-based sizing needs a shadow node with `measureContent`, a `State`
that carries the measured size through the commit, and an `updateState` that forwards the state
to the Swift or Kotlin view. nitrogen 0.37.1 generates all three itself, `final`, with no
substitution point (`nitrogen/src/views/CppHybridViewComponent.ts` in `margelo/nitro`), so a
Hybrid View cannot report its own size.

**Today.** For each view named in `nitro-ui.sizing.json`, `scripts/patch-nitrogen.mjs` repoints
the generated `…ShadowNode`, `…ComponentDescriptor` and `…State` aliases at the templates in
`cpp/NitroUiIntrinsic.hpp` (`patchSizingHeader`), adds an `updateState:oldState:` override to
the generated `.mm` (`patchSizingObjC`), and binds `onState` in the generated Kotlin manager
(`patchSizingKotlin`). For the same reason `patchScrollShadowHeader` repoints the shadow node of
the views in `SCROLL_SHADOW_VIEWS`. The script is idempotent and fails on a missing anchor or
an unknown policy; `bun run nitrogen:check` fails on drift, and
`scripts/__tests__/patch-nitrogen.test.js` covers the rewrites and their failure cases.

**Issue draft.**

```text
Problem
A library cannot give its own Hybrid View an intrinsic size. Fabric's state-based sizing
needs a shadow node with `measureContent`, a `State` carrying the measured size, and a
generated `updateState` that forwards it to Swift. nitrogen generates all three `final`,
with no option to substitute or subclass any of them, so a library that hosts SwiftUI or
Compose content has to rewrite generated text.

Asks
1. Make the generated `ViewComponentDescriptor` and its state holder composable
   rather than `final`.
2. A per-view option along the lines of
   "shadowNode": { "header": "mylib/IntrinsicShadowNode.hpp",
                   "template": "mylib::IntrinsicShadowNode" }
   that repoints the generated aliases, including the `State` alias.
3. Generate the iOS `updateState:oldState:` hook that forwards the new state to the
   Swift part of the view, and the Kotlin equivalent.
```

**Removal.** When nitrogen offers the option in (2) and the hook in (3), point the views in
`nitro-ui.sizing.json` at it, delete the `patchSizing*` and `patchScrollShadowHeader` rewrites
and their tests, and delete this entry. `cpp/NitroUiIntrinsic.hpp` and the sizing engine stay:
they are this library's code.

---

## create-react-native-library 0.64.0

The repository was generated from the `nitro-view` template of `create-react-native-library`
0.64.0 (recorded in `package.json` under `create-react-native-library`).

### B1 — the `nitro-view` template omits `react { jsRootDir }`

**Defect.** Without a scoped codegen root, the React Native Gradle plugin scans the package
root, which in a library checkout contains the development `node_modules/react-native`, and
regenerates every core TurboModule spec into the library. `assembleRelease` then fails:

```text
Type com.facebook.fbreact.specs.NativeAccessibilityInfoSpec is defined multiple times
```

`assembleDebug` passes, so only a release build shows it.

**Today.** Fixed in `android/build.gradle`:

```groovy
react {
  jsRootDir = file("../src/")
  libraryName = "nitroui"
  codegenJavaPackageName = "com.margelo.nitro.nitroui"
}
```

**Issue draft** (for the repository that owns the template).

```text
Title: nitro-view template: library android/build.gradle omits react { jsRootDir }, so
       assembleRelease fails with duplicate TurboModule specs

Reproduction
1. Scaffold a library and keep its android/build.gradle as generated:
   npx -y create-react-native-library@0.64.0 react-native-nitro-ui --no-interactive \
     --slug react-native-nitro-ui --type nitro-view --languages kotlin-swift \
     --example vanilla --tools eslint
2. Install, then build the library in release:
   cd example/android && ./gradlew :react-native-nitro-ui:assembleRelease

Expected
A release build succeeds out of the box.

Actual
The RN Gradle plugin scans the package root, which contains the dev
node_modules/react-native, and regenerates every core TurboModule spec into the library.
assembleRelease fails: "Type com.facebook.fbreact.specs.NativeAccessibilityInfoSpec is
defined multiple times". assembleDebug passes.

Suggested fix
Generate the block into the library's android/build.gradle:
    react {
      jsRootDir = file("../src/")
      libraryName = "<name>"
      codegenJavaPackageName = "<codegen package>"
    }
```

**Removal.** When the template generates the block, delete this entry. Keep the block in
`android/build.gradle`: it is correct either way.

---

## Deleting an entry

1. Confirm the fix is in a release this repository can take. A merged pull request or a nightly
   build is not enough (N1).
2. Raise the dependency, regenerate if it affects codegen (`bun run nitrogen`), and delete the
   workaround named in the entry's **Removal** line.
3. Delete the entry and its row in the Status table. An entry with no live workaround has
   nothing to attribute.
4. Run `bun run check`. After removing a file from `patches/`, a clean `bun install` must still
   succeed.

An entry belongs here only while an upstream fix would let this repository delete something.
Platform behaviour the library accommodates permanently is documented where it is handled: the
sign of `processColor` (unsigned on iOS, signed on Android) and `UIHostingController`'s opaque
default background are examples.
