# Upstream bugs

This is the single place this repo records defects that live in someone else's
code: what we observed, the evidence, what we do about it today (patched /
worked around in code / documented limitation), and — where we intend to report
it — an issue draft that pastes straight into GitHub. It exists so every
workaround in this repo is attributable to a named upstream bug rather than to
repo folklore, which is what makes it deletable. **When upstream ships a fix,
delete the entry and the workaround it describes**; each entry ends with a
**Removal** line saying what to delete and what to bump first. DECISIONS D11
requires an entry for every dev-tooling patch in `patches/`; D5 keeps those
patches dev-only (never needed by consumers, never in the npm tarball).

Line references point at this branch as of 2026-10-22. A few of these files are
under active work, so each entry also names the symbol, helper or patch hunk it
means.

## Status

| ID   | Upstream                                       | Defect                                                            | Upstream status          | Here                                   |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------- | ------------------------ | -------------------------------------- |
| H1   | `@react-native-harness/platform-apple` 1.6.0   | `simctl install` skipped when the app is already installed         | no upstream issue yet    | patched in `patches/`                  |
| H2   | `@react-native-harness/platform-apple` 1.6.0   | `simctl appinfo` exit 3 ("not installed") surfaces as a throw      | no upstream issue yet    | patched in `patches/`                  |
| H3   | `@react-native-harness/ui` 1.6.0               | `screen.findByTestId` accepts no timeout                           | no upstream issue yet    | worked around in the test suite        |
| H4   | `@react-native-harness/ui` 1.6.0               | `screen.screenshot(element)` reports 0×0                           | no upstream issue yet    | worked around in the test suite        |
| H9   | `react-native-harness` 1.6.0                   | no press reaches a control inside an RN `Modal` (second window)     | no upstream issue yet    | documented limitation, no Modal press    |
| H10  | `react-native-harness` 1.6.0                   | iOS `queryByTestId` throws `No active window found` with a Modal     | no upstream issue yet    | noted; only one test queries in a Modal  |
| H5–H8| `react-native-harness` 1.6.0                   | four issues we avoid by policy                                     | reported upstream        | policy (pin, committed baselines, …)   |
| N1   | `nitrogen` / `react-native-nitro-modules` 0.37.1 | Android base `ViewProps` dropped for Hybrid Views                | fixed upstream, unreleased (`#1749`, nightlies only) | post-nitrogen patch + shipped header |
| N2   | `react-native-nitro-modules` 0.37.1            | removed props arrive as `null`, which crashes optional props       | open (`nitro#1184`)      | lint rule + spec/wrapper rule (D7)     |
| N3   | `nitrogen` 0.37.1                              | callback props must be optional; `fn \| null` throws at mount      | no upstream issue yet    | lint rule + spec rule (D7b)            |
| N4   | `nitrogen` 0.37.1                              | generated `SimpleViewManager` ignores border/radius on Android     | no upstream issue yet    | documented limitation, undecided       |
| N5   | `nitrogen` 0.37.1                              | generated Android `updateState` no-ops through RN's second per-view delivery | no upstream issue yet    | documented limitation; generator short-circuit is the fix (T12) |
| N6   | `nitrogen` 0.37.1                              | no hook for a custom shadow node/state, so self-sizing needs post-processing | no upstream issue yet (draft below) | post-nitrogen patch via `nitro-ui.sizing.json`  |
| B1   | `create-react-native-library` 0.64.0 (bob)     | template omits `react { jsRootDir }` → duplicate dex in release    | no upstream issue yet    | fixed in `android/build.gradle`        |
| B2   | `create-react-native-library` 0.64.0 (bob)     | `--tools a b c` keeps only the first value, silently               | no upstream issue yet    | one `--tools` flag per tool            |

Names: the repo's npm dependencies are `react-native-builder-bob` and
`create-react-native-library` (`package.json` devDependencies, and
`package.json` `create-react-native-library.version` = `0.64.0`); the research
notes call the generator "create-react-native-library (bob)" and record its two
defects as "Builder-bob template bugs" (`docs/research/setup-decisions.md:630`).

---

## react-native-harness 1.6.0

Harness is pinned exactly at 1.6.0 (`example/package.json:27-29,36`) and the CI
action is `callstackincubator/react-native-harness@v1.6.0`
(`docs/research/setup-decisions.md:527`). One of its packages is patched with
bun `patchedDependencies` (`package.json:224-226`, mirrored in `bun.lock:82-84`)
from `patches/@react-native-harness%2Fplatform-apple@1.6.0.patch`; `patches/` is
not in `package.json` `files`, so it never reaches a consumer (D5).

### H1 — the Apple runner skips `simctl install` when the app is already installed

**Observed.** On a simulator where the bundle id already exists,
`getAppleSimulatorPlatformInstance` never installs the app the run was asked to
test. JS comes from Metro, native code does not, so a run silently executes an
arbitrarily old binary against new JS. In T10 a two-hour-stale binary ran the
whole suite (`docs/tasks/T10-core-switch.report.md:196-197`), and the failures
looked like component bugs. Simulators here are long-lived and reused across
tasks, which is exactly the case the check trusts.

**Evidence.** The install check is upstream `dist/instance.js:67-74` (patch hunk
`@@ -67,8 +67,12 @@`); it gates the install on an "is *some* build present"
answer:

```diff
--- a/dist/instance.js
+++ b/dist/instance.js
@@ -67,8 +67,12 @@ export const getAppleSimulatorPlatformInstance = async (config, harnessConfig, i
             iosInstanceLogger.debug('waiting for iOS simulator %s to finish booting', udid);
             await simctl.waitForBoot(udid, init.signal);
         }
-        const isInstalled = await simctl.isAppInstalled(udid, config.bundleId);
-        if (!isInstalled) {
+        // nitro-ui patch: an install check only proves *some* build is present.
+        // This repo reuses long-lived simulators, and JS comes from Metro while
+        // native code does not, so skipping the install silently runs an old
+        // binary against new JS. Always install the app this run was asked to
+        // test; `simctl install` is fast and keeps the app container.
+        {
             const appPath = getHarnessAppPath();
             await simctl.installApp(udid, appPath);
         }
```

**Today.** Patched — always install. Applied result:
`node_modules/@react-native-harness/platform-apple/dist/instance.js:70-77`.
`simctl install` is fast and keeps the app container, so nothing else in a run
changes; the report records 14/14 on iOS twice in a row with the patch
(`docs/tasks/T10-core-switch.report.md:24`).

**Issue draft** (repo `callstackincubator/react-native-harness`):

```text
Title: iOS runner skips `simctl install` when any build of the app is already installed,
       so a run can test a stale binary

Reproduction
1. Build the example app (Debug) and install it on a simulator:
   xcrun simctl install <udid> path/to/NitroUiExample.app
2. Wait, then change native (Swift/Kotlin) code only — no JS change — and rebuild.
3. Run the harness against the same simulator with HARNESS_APP_PATH pointing at the
   new .app:
   cd example && bunx react-native-harness --harnessRunner ios

Expected
The app the run was asked to test is installed before the run, so the tests execute
the binary HARNESS_APP_PATH points at.

Actual
`getAppleSimulatorPlatformInstance` asks `simctl.isAppInstalled(udid, bundleId)`,
gets true from the *previous* build, and skips the install
(dist/instance.js:67-74). The tests then run the old binary against JS served by
Metro. Measured here: a binary two hours older than the JS ran a full suite, and
the resulting failures were indistinguishable from a broken component.

Suggested fix
Drop the install check and always `installApp(udid, getHarnessAppPath())` after the
simulator is booted — that is what an automated run means by "test this app".
`simctl install` is cheap and preserves the app container, so state (the
`debug_http_host` override applied at dist/instance.js:79, container data)
survives. If a fast path is wanted, compare the installed bundle's
CFBundleVersion / mtime against the app on disk and reinstall on a mismatch —
never on "some build exists".
```

**Removal.** When a release installs unconditionally (or verifies the exact
bundle), delete this entry and hunk 1 of
`patches/@react-native-harness%2Fplatform-apple@1.6.0.patch`, then re-pin.

### H2 — `simctl appinfo` exit 3 ("not installed") surfaces as a rejected spawn

**Observed.** `xcrun simctl appinfo <udid> <bundleId>` on a booted simulator
whose bundle id has no application record exits **3** instead of printing a
plist. `getAppInfo` therefore never reaches its own "not installed" branch: the
spawn rejects, `isAppInstalled` throws instead of returning `false`, and the
harness dies on a simulator where the app simply is not installed yet.

**Evidence.** Measured on this machine (Xcode 27, booted iOS 27.0 simulator,
bundle id that is not installed):

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

stdout is empty, so the message is only on stderr — hence the patch tests both
streams (`patches/…patch:35-36`). The same command against a **Shutdown**
simulator exits **149** with `Unable to lookup in current state: Shutdown`, and
the patch deliberately does not swallow that. The upstream branch that should
have answered "not installed" is the entry-count check in `getAppInfo`
(`dist/xcrun/simctl.js`, patch hunk `@@ -87,13 +87,31 @@`):

```diff
--- a/dist/xcrun/simctl.js
+++ b/dist/xcrun/simctl.js
@@ -87,13 +87,31 @@ export const collectCrashReports = async ({ udid, processNames, crashArtifactWri
+// nitro-ui patch: Xcode's `simctl appinfo` exits with code 3 and prints
+// "Application not found" when the bundle id has no application record, so a
+// not-installed app surfaces as a rejected spawn instead of an empty plist.
+// `isAppInstalled` then throws instead of returning false, which makes the
+// harness fail on a simulator where the app has not been installed yet. Treat
+// that specific output as "not installed" and keep failing loudly on anything
+// else. Drop this patch once react-native-harness handles the exit code.
+const APP_INFO_NOT_INSTALLED = /application not found|no application record found/i;
+const isAppInfoMissingError = (error) => APP_INFO_NOT_INSTALLED.test(`${error?.stdout ?? ''}\n${error?.stderr ?? ''}`);
 export const getAppInfo = async (udid, bundleId) => {
-    const { stdout: plistOutput } = await spawn('xcrun', [
-        'simctl',
-        'appinfo',
-        udid,
-        bundleId,
-    ]);
+    let plistOutput;
+    try {
+        ({ stdout: plistOutput } = await spawn('xcrun', [ /* …unchanged… */ ]));
+    }
+    catch (error) {
+        if (isAppInfoMissingError(error)) {
+            return null;
+        }
+        throw error;
+    }
     const json = await plistToJson(plistOutput);
     // If there is only one entry, it means the app is not installed
     const hasMoreThanOneEntry = Object.keys(json).length > 1;
```

**Today.** Patched: exit-3 output maps to `null`, anything else still throws
(applied at
`node_modules/@react-native-harness/platform-apple/dist/xcrun/simctl.js:90-122`).
This matters independently of H1: `createAppSession` still calls
`simctl.getAppInfo(udid, config.bundleId)` on every session
(`dist/instance.js:125`) and reads it with optional chaining
(`dist/instance.js:126`), so the caller already expects `null`.

**Issue draft** (repo `callstackincubator/react-native-harness`):

```text
Title: getAppInfo treats `simctl appinfo` exit 3 ("Application not found") as a fatal
       error instead of "not installed"

Reproduction
1. Boot a simulator and do not install the app under test.
2. Run any harness run against it, or call the helper directly:
   xcrun simctl appinfo <udid> <bundle.id.that.is.not.installed>; echo "exit=$?"

Expected
`getAppInfo` returns null and `isAppInstalled` returns false — the function already
has a not-installed branch (`Object.keys(json).length > 1`, plus an `appInfo?…`
caller in dist/instance.js:125-126).

Actual
`simctl appinfo` exits with code 3 and writes the message to stderr, so the spawn
rejects, `getAppInfo` throws, `isAppInstalled` throws, and the run fails on a
simulator where the app is merely not installed. Exit 3 output on this machine:
"An error was encountered processing the command (domain=NSPOSIXErrorDomain,
code=3): … No application record found for that bundle identifier / Application
not found". stdout is empty, so only stderr carries the signal.

Suggested fix
In `getAppInfo`, catch the failed spawn and return null when the child exited with
code 3 and its stderr matches the not-installed wording; rethrow otherwise. Keep
failing loudly on other codes — exit 149 with "Unable to lookup in current state:
Shutdown" is a real error and must not be read as "not installed".
```

**Removal.** When `getAppInfo` handles exit 3, delete this entry and hunk 2 of
the patch file; if hunk 1 is gone too, delete the file and the
`patchedDependencies` entries in `package.json:224-226` and `bun.lock:82-84`.

### H3 — `screen.findByTestId` accepts no timeout

**Observed.** `findByTestId` is the only way to get an `ElementReference`, and it
cannot be told to wait longer than its built-in window. Tests that render their
own control failed under machine load with `Unable to find element with testID:
sized` while tests driving the app's own screen passed
(`docs/tasks/T10-core-switch.report.md:174-177`) — a hosted control is only
queryable after mount + layout + commit. The report records it as throwing on
the first pass that finds nothing; the shipped code polls for a fixed 1 s, which
under load produces the same message and the same outcome.

**Evidence.** The public type takes one argument:
`findByTestId: (testId: string) => Promise<ElementReference>`
(`node_modules/@react-native-harness/ui/dist/screen.d.ts:25`; the same for
`findAllByTestId`, `findByAccessibilityLabel`,
`findAllByAccessibilityLabel`). The implementation calls `waitFor` with no
options (`node_modules/@react-native-harness/ui/dist/screen.js:8-15`), and
`waitFor`'s defaults are `interval = 50, timeout = 1000`
(`node_modules/@react-native-harness/runtime/dist/waitFor.js:10`). `render`
*does* take a timeout — the warm-up render passes `timeout: 15000` and the
40-instance render passes `timeout: 20000`
(`example/__tests__/Switch.harness.tsx:138,532`) — so the gap is specific to the
`find*` queries.

**Today.** Worked around inside the suite, not patched. `waitForTestId`
(`example/__tests__/Switch.harness.tsx:108`, rationale in the comment above it)
polls the non-throwing native query with a 10 s deadline at 50 ms intervals, then
hands back the harness' own reference. After that, two consecutive iOS runs and
an Android run came back 14/14
(`docs/tasks/T10-core-switch.report.md:24,26,178-179`).

**Issue draft** (repo `callstackincubator/react-native-harness`):

```text
Title: screen.find*ByTestId exposes no timeout, so a slow first mount fails as a missing element

Reproduction
1. In a harness test, render a component whose native view is slow to become
   queryable — a Nitro Hybrid View hosting SwiftUI/Compose is enough on a cold
   emulator:
   await render(<Switch testID="sized" />);
   const element = await screen.findByTestId('sized');   // ~1 s window, no option

Expected
Either `screen.findByTestId(testId, { timeout, interval })` (defaulting to today's
values), or a configurable harness-wide query timeout — the way `render()` already
accepts `{ timeout }`.

Actual
The signature is `(testId: string) => Promise<ElementReference>`
(ui/dist/screen.d.ts:25); it calls `waitFor` with no options (ui/dist/screen.js:8-15),
so the timeout is fixed at `waitFor`'s default 1000 ms with a 50 ms interval
(runtime/dist/waitFor.js:10). A control that mounts in 1.2 s fails with
"Unable to find element with testID: sized", indistinguishable from a genuinely
missing element. Measured here: the same test failed twice under load and passed
every time once the suite waited with its own 10 s poll.

Suggested fix
Accept the same options object `waitFor` takes on all four `find*` methods
(findByTestId, findAllByTestId, findByAccessibilityLabel,
findAllByAccessibilityLabel), pass it through, and document the default. Longer
term, have the failure name the timeout it used, so a timeout failure reads as
one.
```

**Removal.** When the queries take a timeout, delete this entry, drop
`waitForTestId` in `example/__tests__/Switch.harness.tsx` and pass a timeout at
each of its call sites instead.

### H4 — `screen.screenshot(element)` reports 0×0

**Observed.** For an element target, the returned `ScreenshotResult` says
`width: 0, height: 0` whatever was captured, and the element reference itself
carries no bounds, so JS cannot recover them. Element-level visual assertions
have to get geometry from somewhere else.

**Evidence.** `node_modules/@react-native-harness/ui/dist/screen.js`:

- `:3-5` — `wrapElement(viewInfo)` keeps only `nativeId`, dropping the bounds the
  native query returned.
- `:63-71` — for an `ElementReference` target, `captureBounds` is built as
  `{ nativeId, x: 0, y: 0, width: 0, height: 0 }`.
- `:95-101` — "the bridge doesn't return it … For now we use the provided target
  size or 0", then `return { data, width: targetWidth, height: targetHeight }`,
  both `0` on this path.
- `node_modules/@react-native-harness/ui/dist/HarnessUI.d.ts:9` —
  `captureScreenshot(bounds: ViewInfo | null): Promise<string | null>` returns a
  base64 string only, so the PNG's real size never reaches JS.

**Today.** Worked around, not patched: the suite reads bounds straight from the
`HarnessUI` TurboModule's `queryByTestId`: `example/__tests__/Switch.harness.tsx:37-49`
declares the module and its `ViewInfo`, and the tests read the laid-out box from it
(`:177`, `:200`, `:274`). `screen`'s element references stay in use for presses.

**Issue draft** (repo `callstackincubator/react-native-harness`):

```text
Title: screen.screenshot(element) returns width/height 0 (and element references drop their bounds)

Reproduction
1. Render any view with a testID, then screenshot it:
   const element = await screen.findByTestId('sized');
   const shot = await screen.screenshot(element);
   console.log(shot?.width, shot?.height);
2. Compare with the raw query: TurboModuleRegistry.getEnforcing('HarnessUI')
     .queryByTestId('sized')   // has real x/y/width/height

Expected
`shot.width`/`shot.height` describe the captured image, like they do for a
`BoundingBox` target (ui/dist/screen.js:76-80).

Actual
0 0. For an element target the capture box is built with zeros
(ui/dist/screen.js:63-71) and the result reports the JS-side target size, which is 0
on that path; the comment at ui/dist/screen.js:95-97 says the bridge does not return
the captured size. `captureScreenshot` returns only a base64 string
(ui/dist/HarnessUI.d.ts:9), and `wrapElement` (ui/dist/screen.js:3-5) throws away
the `ViewInfo` bounds, so nothing in the JS API can recover them. A visual test
cannot tell a correct crop from a 0×0 capture.

Suggested fix
Return the real size with the image: either read width/height out of the PNG
header in `screenshot()`, or widen `captureScreenshot` to return
`{ base64, width, height }`. Independently, keep the bounds on the element
reference (`{ nativeId, x, y, width, height }`) — the native query already
returns them — so element targets can pass a real box.
```

**Removal.** When `screenshot(element)` reports real sizes, delete this entry and
switch the `harnessUi.queryByTestId` box reads in
`example/__tests__/Switch.harness.tsx:177,200,274` back to the harness API
(dropping the `HarnessUI` declaration at `:37-49` if `waitForTestId` is gone
too).

### H9 — no press reaches a control inside an RN `Modal`

**Observed.** A control rendered inside React Native's `Modal` cannot be pressed
by a test, on either platform. The native query finds it and reports a real frame,
and pressing that frame's centre does nothing: the control's own state never
changes. It is not a Hybrid View quirk - measured with **React Native's own
`Switch`** in the same dialog, which ignores the same press.

**Evidence** (harness 1.6.0, RN 0.88, API 35 emulator and iOS 27 simulator):

- `example/__tests__/Switch.harness.tsx` (`hosts, measures and takes props inside a
  Modal`) renders our Switch and, in the same dialog, RN's `Switch`. On Android the
  native query returns `{"x":182.5,"y":433.1,"width":46.5,"height":27.0}` for RN's
  control; `userEvent.pressAt` at its centre leaves `onValueChange` uncalled.
- Ours, at `{"x":179.8,"y":398.9,"width":51.8,"height":48}`: the same, plus a
  vertical sweep of +/-24, 40, 48, 80 and 120 dp - nothing flips it.
- `userEvent.press(element)` is no better: `wrapElement` keeps only `nativeId` (H4),
  and `simulatePress(nativeId, 0, 0)` resolves the view against the first window, so
  a view in the dialog's window is a no-op (`ui/dist/userEvent.js:24-30`).
- On iOS the press misses ours too (`waitFor` on the control's displayed value times
  out).

**Today.** The Modal case in the on-device suite asserts what the platform still
answers from inside a second window - the host's own measurement and a JS-to-native
prop write - and presses nothing. Every other press in the suite is on the first
window, where the harness works. **A `Modal`, `Dialog` or `Popover`-hosted control
therefore has no on-device interaction test** until this is fixed, which matters for
`Picker` and any future overlay component.

**Issue draft** (repo `callstackincubator/react-native-harness`):

```text
Title: no way to press a control inside React Native's Modal (Android and iOS)

Reproduction (react-native-harness 1.6.0, RN 0.88)
1. Render a screen containing  <Modal visible><Switch testID="m" onValueChange={...} /></Modal>
   (React Native's own Switch - no third-party component involved).
2. Query it natively and press the reported centre:
   const box = harnessUi.queryByTestId('m');          // real x/y/width/height
   await userEvent.pressAt(box.x + box.width / 2, box.y + box.height / 2);
3. Look at the Switch and at onValueChange.

Expected
The dialog window takes the tap: the Switch flips and onValueChange fires, as it
does for a control on the first screen.

Actual
Nothing happens. Android (API 35): query = {x: 182.5, y: 433.1, width: 46.5,
height: 27.0}, RN's Switch untouched; a +/-120 dp sweep around the reported centre
also misses. iOS 27 simulator: same miss. `userEvent.press(element)` is worse - the
element reference carries no bounds (see the separate screenshot/bounds issue) and
`simulatePress(nativeId, 0, 0)` resolves the native id against the first window only.
The testID query itself does find the view, with correct-looking bounds, so the
harness knows the control is there; it just cannot touch it.

Suggested fix
Deliver coordinate presses to the window that owns the point (on Android, the
`Instrumentation`/`UiDevice` gesture on the dialog's window rather than the activity's;
on iOS, the presented window), and resolve native ids across all windows of the app
rather than the first root view. A test should be able to press a `Modal`, an
`ActionSheet` and a custom overlay the same way it presses a screen.
```

**Removal.** When a press reaches a second window, delete this entry and add the
missing interaction oracle - a `userEvent.pressAt` plus an event assertion - to the
Modal test in `example/__tests__/Switch.harness.tsx` (the comment there names this
entry).

### H10 — the iOS testID query throws `No active window found` with a `Modal` open

**Observed.** With an RN `Modal` visible, `HarnessUI.queryByTestId` threw
`No active window found` on the first query after a standard RN control (`Switch`)
was added inside the dialog. The identical query for another control in the same
dialog succeeded in the previous run of the same file, so this looks like a
window-lookup race rather than a permanent failure - either way a test cannot rely
on querying anything while a `Modal` is up.

**Evidence.** Run of `example/__tests__/Switch.harness.tsx` on iPhone 17 / iOS 27
(2026-10-23): the suite reports `No active window found` for the test, at the line
calling `harnessUi.queryByTestId('rn-in-modal')`; the preceding run of the same test,
whose only difference was that the dialog held one control instead of two, queried
both successfully.

**Today.** The suite queries inside a `Modal` only in the one test that needs it, and
does not press there (H9). If the throw reappears, that test is where to look.

**Issue draft** (repo `callstackincubator/react-native-harness`):

```text
Title: queryByTestId throws "No active window found" while a React Native Modal is visible

Reproduction (react-native-harness 1.6.0, RN 0.88, iOS simulator)
1. Render <Modal visible> with two plain controls inside it, each with a testID.
2. Call HarnessUI.queryByTestId on one of them.

Expected
Either the element, or null when it is not there.

Actual
The call throws "No active window found". Reproduced intermittently: the same test
file with one control in the dialog queries fine, with two it throws. A query API
that throws on window state makes every test that opens a Modal flaky, and the error
names neither the window nor the reason.

Suggested fix
Return null from the non-throwing query (and time out in `findBy*`), and treat
"no active window" as "not found right now" rather than an error. If a window really
is unreachable, include which window and what was searched.
```

**Removal.** When the query returns null instead of throwing, delete this entry and
drop the "the query itself throws" note in
`example/__tests__/Switch.harness.tsx`.

### H5–H8 — harness issues we avoid by policy (already reported upstream)

Not ours to file; recorded so a reader does not rediscover them. All from
`docs/research/setup-decisions.md`, listed as open at 1.6.0 (`:629`).

| ID  | Issue                     | Behaviour recorded                                                                | Our mitigation                                                                 |
| --- | ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| H5  | harness #197              | Android `TextureView`/`SurfaceView` screenshots come out transparent (`:385`)     | no such surfaces in the example app today                                       |
| H6  | harness #198              | a missing image-snapshot baseline **passes** (`:378`)                             | commit the baselines; visual assertions are only trusted with a committed file |
| H7  | harness #215              | two copies of `react-native` in a monorepo break view configs (`:384`)            | bun hoisted linker, one RN version everywhere (`docs/tasks/T01-scaffold.report.md:308`) |
| H8  | harness #273              | the runner must start from the app directory (`:374`)                             | scripts run via `bun --cwd example` (`package.json:37`)                          |

**Removal.** Re-check each against the pinned version; when one is fixed in a
release we take, drop its row and its mitigation note.

---

## react-native-nitro-modules / nitrogen 0.37.1

This repo builds against `nitrogen ^0.37.1` and peers on
`react-native-nitro-modules ^0.37.1` (`package.json:107` and peerDependencies),
with RN floor 0.86 (D8).

### N1 — Android base `ViewProps` dropped for Hybrid Views (nitro#1655 → #1656)

**Observed.** On RN ≥ 0.86 Android, a Hybrid View ignores RN's base props —
`backgroundColor`, `opacity`, `transform`, `testID`, accessibility
(`docs/research/nitro-patterns.md:35-37`). Measured before/after in the spike:
on an Android emulator with RN 0.88 the Nitro view ignored `backgroundColor` and
`opacity`; after the patch it applies them, in the example app and in both
consumer smoke apps (`docs/research/setup-decisions.md:241`). Cause: nitrogen
0.37.1 generates a `Props` constructor whose body is empty, so
`Props::initializeDynamicProps` is never called
(`scripts/patch-nitrogen.mjs:4-8`).

**Evidence — upstream state, as recorded.** `docs/research/setup-decisions.md:216-232`:

- `#1655` closed **unmerged**; the maintainer asked for the fix to move into
  nitrogen-generated Props with `filterObjectKeys` and a version gate; `#1661`
  also closed (`:219-220`).
- The real fix is `#1749` "fix: restore Android base View props", merged
  2026-10-19, commit `ffd9031`; issue `#1656` closed as completed (`:220`).
- It ships **only** in nightlies: `react-native-nitro-modules@0.37.2-nightly.*`
  (dist-tag `nightly` = `0.37.2-nightly.62.gfb894f673ff0`) and
  `1.0.0-alpha.nightly.*`; `latest` is still 0.37.1 from 2026-08-27 and does not
  contain it — checked by grepping the tarballs (`:222-224`).
- Nightly codegen emits a call into the runtime helper
  `cpp/views/RawPropsCompat.cpp`, version-gated (RN ≥ 0.87 always; RN 0.84–0.86
  behind `enableExclusivePropsUpdateAndroid`), so codegen produced by nightly
  nitrogen **does not build** for consumers on 0.37.1 (`:226-231`). With our peer
  range and RN floor, shipping nightly codegen is not an option.

**Evidence — what ships.** `bun run nitrogen` is `nitrogen src &&
node scripts/patch-nitrogen.mjs` (`package.json:42`), and bob's `custom` target
runs the same script (`package.json:130-137`), so `prepare` and `npm pack` always
ship patched code. The script rewrites the empty ctor and adds the include
(`scripts/patch-nitrogen.mjs:33-39`), producing committed output:

```cpp
// nitrogen/generated/shared/c++/views/HybridNitroUiSwitchComponent.cpp:12
#include "NitroUiPropsCompat.hpp"
// nitrogen/generated/shared/c++/views/HybridNitroUiSwitchComponent.cpp:34-35
    // nitro-ui: initializeDynamicProps
    ::nitroui::compat::initializeDynamicProps(*this, sourceProps, rawProps, filterObjectKeys);
```

`cpp/NitroUiPropsCompat.hpp` is a header-only copy of the upstream helper under
`::nitroui::compat` (not `nitroui::`, which would collide with the generated
`margelo::nitro::nitroui`). Guards, in this order: skip files already containing
upstream's `RawPropsCompat::initializeDynamicProps` (`scripts/patch-nitrogen.mjs:39,47`);
idempotent via `PATCH_MARKER` (`:33`); **exit 1** if a generated
`*Component.cpp` has neither the upstream call nor our anchor (`:116`), so a
nitrogen upgrade cannot silently drop the fix; no-op when there are no Hybrid
Views. Covered by `scripts/__tests__/patch-nitrogen.test.js:49,72,93,106,156`,
and `bun run nitrogen:check` re-runs it to catch drift
(`scripts/nitrogen-check.mjs:165`). Alternatives rejected: patch-package cannot
patch a consumer's `node_modules`, and a hand-written `ViewManager` duplicates
generated state-updater code per view (`docs/research/setup-decisions.md:244-246`).

**Upstream status.** The bug is fixed upstream and unreleased, so there is no new
bug to file — what this repo waits for is a release. The artifact to post is:

```text
Title (issue/discussion on margelo/nitro, or a comment on #1656): When will a stable
       release contain #1749 (Android base View props)?

Body
`latest` is 0.37.1 (2026-08-27) and does not contain ffd9031 from #1749; the fix is only
in 0.37.2-nightly.* (nightly = 0.37.2-nightly.62.gfb894f673ff0) and 1.0.0-alpha.nightly.*.

Downstream effect: libraries generated with stable nitrogen 0.37.1 must keep dropping RN's
base ViewProps on Android >= 0.86 (backgroundColor, opacity, transform, testID, a11y) or
post-process their own codegen, because codegen from nightly nitrogen calls
nitro::RawPropsCompat::initializeDynamicProps, which does not exist in 0.37.1 — so we
cannot ship the fixed codegen either. react-native-nitro-ui does exactly that
post-processing today (scripts/patch-nitrogen.mjs + a header-only copy of the helper).

Asks
1. A date for a stable (0.37.2 or later) that includes #1749, so libraries can bump the
   peer and delete their local patch.
2. Confirmation that generated code may then rely on the runtime helper unconditionally,
   i.e. that the version gate stays a runtime concern.
```

**Removal.** Per the recorded plan (`docs/research/setup-decisions.md:243`): when
0.37.2 stable ships, bump `nitrogen` and the peer to `^0.37.2`, regenerate —
the script becomes a no-op because the output already contains
`RawPropsCompat::initializeDynamicProps` — then delete this entry,
`scripts/patch-nitrogen.mjs`, `scripts/__tests__/patch-nitrogen.test.js`,
`cpp/NitroUiPropsCompat.hpp`, the `&& node scripts/patch-nitrogen.mjs` half of
`package.json:42`, and the patch references in
`scripts/nitrogen-check.mjs:165` and `CONTRIBUTING.md:72-77`.

### N2 — a removed prop arrives as `null`, which crashes an optional prop (nitro#1184)

**Observed.** Fabric sends `null` for a prop that disappeared; Nitro maps only
`undefined` to "unset". A `label?: string` prop going from `'x'` to `undefined`
crashes the app on Android with RN 0.88:

```text
Exception in HostFunction: NitroUi.label: Value is null, expected a String
```

(`docs/research/setup-decisions.md:278`).

**Upstream status.** Open, and not fixed in 0.37.2 or 1.0 nightlies:
`JSIConverter<std::optional<T>>` still accepts only `undefined`
(`docs/research/setup-decisions.md:274-276`).

**Today.** Worked around in code, by rule (D7, `docs/DECISIONS.md:14-15`),
enforced three ways:

- Lint: `nitro-ui/no-optional-view-props` (`eslint-rules/index.js:306-313,555`,
  enabled `eslint.config.mjs:95`) reports the rule message naming
  `margelo/nitro#1184`.
- Specs: no `?:` members; "unset" is `T | null`, which nitrogen maps to
  `Variant_NullType_T` (`src/components/Switch/Switch.nitro.ts:10-13,18-43`).
- Wrappers: always send every native prop, `?? null` for unset
  (`src/components/Switch/Switch.tsx:119-125`), documented as a contract in
  `docs/architecture/core.md` §3 (the "No optional props in a spec" bullet).

Verified: with `label: string | null` toggling between a value and `null`, no
crash across 200+ ticks on Android and 20+ ticks on iOS
(`docs/research/setup-decisions.md:285`). Cost, recorded as an open risk
(`:621`): the rule is ergonomically expensive on the native side, and the
suggested upstream fix is small. Gap: the "never send undefined" Jest test the
notes recommend copying (`:286`, nitro-input's `NitroNumber.test.tsx`) is not in
this repo — enforcement today is the lint rule plus the spec and wrapper shape.

**Draft** — a comment on the existing `nitro#1184`, not a new issue:

```text
Title (comment on margelo/nitro#1184): +1 with a reproducer, and a proposed fix: treat null
       as nullopt in JSIConverter<std::optional<T>>

Reproduction
1. Declare a Hybrid View prop as optional: `label?: string`.
2. Render it with a value, then re-render without it (prop removed):
   <MyView label="x" /> → <MyView />
3. On Android with react-native 0.88 and react-native-nitro-modules 0.37.1.

Expected
The prop converts to std::nullopt. Fabric sends `null` for removed props, and JS-side
"absent" and "explicitly null" are not distinguishable once the diff is serialized, so a
library cannot avoid the case by validating its own props.

Actual
Crash on the props conversion: "Exception in HostFunction: NitroUi.label: Value is null,
expected a String". JSIConverter<std::optional<T>> accepts only `undefined`, so a `null`
arriving from Fabric throws instead of becoming nullopt.

Suggested fix
Make JSIConverter<std::optional<T>>::fromJSI accept null as well as undefined and return
std::nullopt (the same change on the write side if a round-trip is wanted). That removes
the constraint for every library at once.

Workaround every affected library has to ship meanwhile (why the constraint is expensive)
Never declare an optional value prop: use `T | null` (native side
Variant_NullType_T) and have the JS wrapper pass every prop on every render, `null` for
"not set". We enforce it with a custom ESLint rule because a violation is a runtime crash,
not a type error. Verified with `T | null`: no crash across 200+ value/null toggles on
Android and 20+ on iOS.
```

**Removal.** When the released converter accepts `null`, delete this entry and
D7, then optional props become legal: drop
`nitro-ui/no-optional-view-props` (`eslint-rules/index.js:306-313,555`,
`eslint.config.mjs:95`) and relax the specs/wrappers at your own pace (they stay
correct as written).

### N3 — callback props must be optional; `fn | null` throws at mount

**Observed.** The opposite face of N2: for callback props, `T | null` is not
available. RN cannot send a function as a prop, so Nitro sends `{ f: fn }` and
unwraps `f` only when the prop type *is* a function (`IsFunctionProp`). A
`fn | null` union generates `std::variant<std::function, NullType>`, which is not
a function type, so the wrapper is never unwrapped and converting the prop
**throws while mounting**. Callbacks therefore have to be declared `fn?` — an
explicit exception to D7, recorded as D7b (`docs/DECISIONS.md:32-34`,
`docs/architecture/core.md` §3, the "Callbacks are the one exception" bullet).

**Evidence.** Spec comment and the resulting shape:
`src/components/Switch/Switch.nitro.ts:46-59` (`onValueChange?:` at `:59`).
Lint enforces both directions — `callbackPropNotNullable` and
`callbackPropMustBeOptional` (`eslint-rules/index.js:367-378`). The rule that
makes it safe is behavioural: `useStableCallback` builds `{ f: … }` once per
mounted view and the wrapper always passes a real callback while mounted, never
`null` (`docs/architecture/core.md` §3, the "Callbacks keep one identity forever"
bullet).

**Upstream status.** No upstream issue yet — this repo records none.

**Draft** (repo `margelo/nitro`):

```text
Title: Function props cannot be nullable: `fn | null` produces std::variant<std::function,
       NullType>, which IsFunctionProp rejects, so the prop conversion throws at mount

Reproduction
1. Declare a Hybrid View prop as a nullable callback:
   onValueChange?: ((v: boolean) => void) | null   // or the non-optional nullable form
2. Generate with nitrogen 0.37.1, mount the view from JS passing a function.

Expected
Either `fn | null` works like every other nullable type (null = no callback), or nitrogen
rejects the declaration at codegen time with a message saying function props must be
`fn?`.

Actual
Codegen succeeds; the generated prop type is std::variant<std::function<…>, NullType>,
which is not a function type, so IsFunctionProp does not unwrap Nitro's `{ f }` wrapper and
converting the prop throws while mounting. Library authors end up declaring callbacks
optional (`fn?`) — the one place where the null-instead-of-undefined rule (issue #1184)
cannot be followed — and never passing null for them.

Suggested fix
Treat a nullable function prop as an optional function in the generator (unwrap `{ f }` for
the variant case, map NullType to nullopt), or emit a codegen error pointing at `fn?`.
Either way the rule becomes visible at build time instead of a mount-time crash.
```

**Removal.** If upstream makes nullable callbacks work, this entry, D7b, the
`callbackProp*` lint messages (`eslint-rules/index.js:367-378`) and the spec
comment at `src/components/Switch/Switch.nitro.ts:46-59` can go; until then D7
and D7b stay as a pair.

### N4 — generated Android view manager ignores border and radius (documented limitation)

**Observed.** Even with N1 patched, `borderWidth`/`borderColor` are not drawn on
an Android Hybrid View: nitrogen generates a `SimpleViewManager`, and the border
props live in `ReactViewManager`. `backgroundColor`, `opacity`, `transform`,
`testID` and accessibility props work after the fix
(`docs/research/setup-decisions.md:204`).

**Today.** Documented limitation, no code: the recorded options are "use a
wrapping `View` for borders and radius" or implement border/radius in Compose,
and the choice is still an open risk (`docs/research/setup-decisions.md:626`).
Nothing in `docs/architecture/core.md` or `docs/components/switch.md` claims
border support, and the Switch needs none.

**Upstream status.** No upstream issue yet, and this repo records no intent to
file one: with `SimpleViewManager` being the reasonable codegen default, the fix
may belong in this library. Keep the entry until the open risk is decided, then
replace it with either the implementation or a line in the component docs.

### N5 — generated Android `updateState` re-runs for RN's second per-view state delivery (documented limitation)

**Observed.** On Android, every newly created Nitro Hybrid View receives
`updateState` **twice**: `ViewManager.createViewInstance` applies the initial
state once (`ViewManager.java:231-236`), and
`FabricMountingManager.cpp:760-766` emits an additional
`UpdateStateMountItem` for every **Insert** of a view that has state. RN's own
view managers tolerate the repeat because they read props field-by-field
against the old snapshot; the manager nitrogen generates does not
short-circuit — it runs `beforeUpdate → updateViewProps → afterUpdate`, so the
second call costs a JNI props diff, a `reconcile()` that applies nothing (the
snapshot from `holder.lastState` equals the new one), and one unconditional
`host.commit()` mark. Measured by the T02 bench probe: `propsApplied` is
**2.00 per instance** on Android `mount` and 1.00 on `update`; iOS is 1.00
everywhere (`docs/tasks/T02-bench.review.md`, "Android `propsApplied = 2.00`").

**Today.** Documented limitation, no code: `docs/architecture/core.md` §3 tells
component authors to read Android mount `propsApplied = 2.00` as the floor, and
the bench sanity metric is interpreted through that note.

**Upstream status.** No upstream issue yet. The double delivery is RN Fabric's
design (view managers are expected to be idempotent), so the improvement is
Nitro's: the generated `updateState` could return before `beforeUpdate` when
the incoming props snapshot equals `holder.lastState`, or count `updateState`
calls and "applied" marks separately. **Removal.** When the generator
short-circuits (planned under T12), re-record the Android sanity expectations,
drop this entry, and update the §3 note in `docs/architecture/core.md`.

### N6 — no hook for a custom shadow node, so a self-sizing view must be post-processed

**Observed.** RN's state-based sizing needs three things at once: a shadow node
with a `MeasurableYogaNode` (`measureContent`), a `State` that carries the
measured size through the commit, and — on iOS — an `updateState:oldState:` that
forwards that state to the Swift side. Nitro 0.37.1 generates all three itself,
`final` and with no substitution point
(`nitro:nitrogen/src/views/CppHybridViewComponent.ts`), so a Hybrid View cannot
report its own intrinsic size. `docs/research/core-architecture.md` §1.5 lists
this as the thing to propose upstream; T11 is the task that needed it.

**Today.** `scripts/patch-nitrogen.mjs` rewrites the generated output for each
view named in `nitro-ui.sizing.json`: it repoints the `…ShadowNode`,
`…ComponentDescriptor` and `…State` aliases at the templates in
`cpp/NitroUiIntrinsic.hpp`, adds the `updateState:oldState:` hook to the
generated `.mm`, and the `onState` bind to the generated Kotlin manager. It is
one script, idempotent, hard-failing on a missing anchor or an unknown policy;
`bun run nitrogen:check` fails on drift and
`scripts/__tests__/patch-nitrogen.test.js` asserts the behaviour including the
failure cases. That is the mitigation for risk R1, not a removal of it: the cost
is three anchor sets per platform whose breakage a nitrogen release would
otherwise reveal only at build time.

```text
Problem
A library cannot give its own Hybrid View an intrinsic size. Fabric's state-based
sizing needs a shadow node with `measureContent`, a `State` carrying the measured
size, and a generated `updateState` that forwards it to Swift — and nitrogen
generates all three `final`, with no option to substitute or subclass any of them.
Every library that hosts SwiftUI/Compose content ends up rewriting generated text
to get there (ours: alias swaps + an `.mm` hook + a Kotlin `onState` bind).

Asks
1. Make the generated `ViewComponentDescriptor` and its state holder composable
   rather than `final`, so a library can build on them instead of replacing them.
2. A per-view option along the lines of
   "shadowNode": { "header": "mylib/IntrinsicShadowNode.hpp",
                   "template": "mylib::IntrinsicShadowNode" }
   that repoints the generated aliases (including the `State` alias, which is the
   one a self-sizing view has to change).
3. Generate the iOS `updateState:oldState:` hook that forwards the new state to the
   Swift part of the view, and the Kotlin equivalent. Without it, a state a library
   puts into the `State` can never reach the view that put it there.

Why it belongs upstream: this is not a preference about generated style — with (1)
and (2) absent, the mechanism is unreachable, and with (3) absent it is unreachable
on iOS specifically. Three small codegen options remove a post-processing patch from
every library that sizes its own controls.
```

**Upstream status.** No issue filed yet. Task branches in this repo are not allowed
to open issues, so T11 records the draft above for a maintainer to file; until then
the post-processing stays, with its tests.

**Removal.** When nitrogen offers the option in (2) and the hook in (3): point
`nitro-ui.sizing.json`'s views at it, delete the alias/hook hunks from
`scripts/patch-nitrogen.mjs` and the tests that assert them, keep
`cpp/NitroUiIntrinsic.hpp` and the sizing engine (those are this library's, not
generated), and delete this entry.

---

## create-react-native-library 0.64.0 / react-native-builder-bob

The repo was generated with `create-react-native-library@0.64.0 --type
nitro-view --languages kotlin-swift --example vanilla`
(`package.json` `create-react-native-library`, and the recorded command in
`docs/research/setup-decisions.md:31-41`), and builds with
`react-native-builder-bob` (`package.json` devDependencies). Both defects below
are recorded as spike findings with the instruction "Report both upstream. Our
repo carries the fixes either way" (`docs/research/setup-decisions.md:630-634`),
so neither has an upstream issue yet.

### B1 — the `nitro-view` template omits `react { jsRootDir }`, so release builds fail with duplicate dex classes

**Observed.** Without a scoped codegen root, the RN Gradle plugin scans the
package root — including the dev `node_modules/react-native` — and regenerates
every core TurboModule spec into the library. `assembleRelease` then fails with:

```text
Type com.facebook.fbreact.specs.NativeAccessibilityInfoSpec is defined multiple times
```

Debug builds pass, so the failure goes unnoticed until a release build
(`docs/research/setup-decisions.md:86`). It is invisible in CI unless CI builds
release, which is why the Android CI job assembles release
(`docs/research/setup-decisions.md:525`).

**Evidence.** `docs/research/setup-decisions.md:84-86`, which also notes Rive
does the same thing and that it is "worth reporting upstream to builder-bob".

**Today.** Fixed in our template copy: `android/build.gradle:42-46`.

```groovy
react {
  jsRootDir = file("../src/")
  libraryName = "nitroui"
  codegenJavaPackageName = "com.margelo.nitro.nitroui"
}
```

**Issue draft** (repo `callstack/react-native-create-library` /
`create-react-native-library`, as the generator that owns the template):

```text
Title: nitro-view template: library android/build.gradle omits react { jsRootDir }, so
       assembleRelease fails with duplicate TurboModule specs

Reproduction
1. Scaffold a library and take the library's own android/build.gradle as generated:
   npx -y create-react-native-library@0.64.0 react-native-nitro-ui --no-interactive \
     --slug react-native-nitro-ui --type nitro-view --languages kotlin-swift \
     --example vanilla --tools eslint
2. Install, then build the library's Android artifacts in release:
   cd example/android && ./gradlew :react-native-nitro-ui:assembleRelease

Expected
Either the template scopes codegen to the library's own sources, or codegen finds nothing
in the package root — so a release build succeeds out of the box.

Actual
The RN Gradle plugin scans the package root, which in a scaffolded library contains the dev
node_modules/react-native, and regenerates every core TurboModule spec into the library.
assembleRelease fails: "Type com.facebook.fbreact.specs.NativeAccessibilityInfoSpec is
defined multiple times". assembleDebug passes, so nothing flags it during normal
development — it first bites in a release build or a release CI job.

Suggested fix
Generate the block into the library's android/build.gradle:
    react {
      jsRootDir = file("../src/")
      libraryName = "<name>"
      codegenJavaPackageName = "<codegen package>"
    }
That is what Rive does and what react-native-nitro-ui carries by hand. A note in the
generated file ("codegen scans this directory; keep it pointed at your spec sources") would
also stop people from deleting it.

Related: the multi-value `--tools` parsing issue reported separately; both were found in
the same scaffold run.
```

**Removal.** Once the template generates the block, delete this entry and drop
the manual note in `docs/research/setup-decisions.md:84-86` (research files are
not edited by tasks — leave it to a notes cleanup). Keep
`android/build.gradle:42-46`: it is correct either way.

### B2 — `--tools a b c` keeps only the first value, silently

**Observed.** Passing several tools after one `--tools` flag drops every tool
after the first, with no warning: "In the spike, `--tools a b c` silently kept
only the first tool" (`docs/research/setup-decisions.md:43`). The result is a
scaffold that is missing Jest, lefthook or release-it config with no signal about
why, and the omission only shows up later as "there is no test setup".

**Evidence.** `docs/research/setup-decisions.md:39-43` — the recorded command
repeats the flag once per tool (`--tools eslint --tools jest --tools lefthook
--tools release-it`), with the note "Repeat `--tools` once per tool."

**Today.** Documented workflow: one flag per tool, and the generated repo proves
the four survived — `package.json` `create-react-native-library.tools` lists
`eslint`, `jest`, `lefthook`, `release-it`.

**Issue draft** (same repo as B1):

```text
Title: --tools accepts only the first value after the flag, silently dropping the rest

Reproduction
1. Run the generator with several tools after one flag:
   npx -y create-react-native-library@0.64.0 demo-lib --no-interactive \
     --slug demo-lib --type nitro-view --tools eslint jest lefthook release-it
2. Inspect what was generated.

Expected
Either every listed tool is set up, or the CLI errors/exits and says which argument it did
not understand.

Actual
Only `eslint` is set up. `jest`, `lefthook` and `release-it` are dropped with no warning,
and the recorded config lists one tool, so the run looks successful. Repeating the flag
(`--tools eslint --tools jest --tools lefthook --tools release-it`) works.

Suggested fix
Collect repeated values for the flag (the standard variadic option behaviour), and warn
when a positional-looking value follows `--tools`. Repeating the flag should keep working
either way.
```

**Removal.** When the flag is variadic, delete this entry and shorten the
recorded command in `docs/research/setup-decisions.md:39-43` during a notes
cleanup.

---

## Deleting an entry

1. Confirm the upstream fix in a release we can actually take — a merged PR or a
   nightly is not enough (N1 is the cautionary example: merged 2026-10-19, still
   unreleased in `latest`).
2. Bump the dependency, regenerate if it affects codegen (`bun run nitrogen`),
   and delete the workaround named in the entry's **Removal** line.
3. Delete this entry, and its row in the Status table. Do not leave a "fixed"
   entry behind: an entry with no live workaround has nothing to attribute.
4. `bun run check` (`CONTRIBUTING.md:40,62-64`) is the gate; for N1, `nitrogen:check`
   reports patched-view drift, and for `patches/` entries a clean `bun install`
   must still succeed after the patch file is removed.

## Not in this file

Third-party behaviour we absorbed into our own code with no upstream change
pending, recorded where it was fixed instead: the `processColor` sign split
between platforms (unsigned iOS, signed Android — D10,
`docs/architecture/core.md` §3 "Colours", `docs/tasks/T10-core-switch.report.md:239-240`);
`UIHostingController`'s opaque default background
(`docs/research/setup-decisions.md:203`); RN's deprecated `SafeAreaView` applying
no inset on Android (`docs/tasks/T10-core-switch.report.md:188-192`); and
environmental flakiness in shared tooling — the `adb` server restarting under
concurrent `platform-tools` versions, and load-dependent harness timing
(`docs/tasks/T10-core-switch.report.md:164-172`). None of these has an upstream
fix waiting to be picked up, which is the test for membership here.
