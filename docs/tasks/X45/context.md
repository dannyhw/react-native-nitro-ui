# Android phase-2 tree checks: what can move to e2e

Read-only audit of the checkout at commit `d5c8c854`. Installed driver versions: `e2e` 0.23.1, `@e2e-dev/mobile` 0.12.7 (pins `agent-device` 0.21.37 in its `package.json`), `agent-device` 0.21.37, and its Android snapshot helper APK 0.21.37. No nested copies: `node_modules/e2e/node_modules` holds only `@clack` and `commander`.

## 4. Summary

`scripts/real-input/android-tree-checks.mjs` has **364 assertions**, covered by 241 rows:

- E2E today: 212
- E2E with a repo helper: 61 (33 popup-window count, 27 phase 1's live tree read, 1 density)
- Already in phase 1: 49
- Better as a harness test: 29
- Needs a driver change: 13

Of the sweep's 6 rules, R1, R2 and R6 move today; R3, R4 and R5 need driver flags.

**Driver changes:**
- **D-A:** publish `clickable` and `focusable`. Removes 8 lines and R4/R5.
- **D-D:** a hold-then-move gesture at points. Removes 3.
- **D-C:** emit `long-clickable`. Removes 2.
- **D-B:** publish `scrollable`. Removes R3.

With all four, nothing is left and phase 2 can be deleted. Without them, 13 lines and 3 rules stay.

**The stated reasons, against the source:**
- No swipe-leaves-its-view refusal exists: `screen.swipe({ from, to, duration })` takes any two points.
- The covered-tap refusal is real but applies to node targets only; point taps avoid it.
- The node map carries `selected` and the class.
- `uiautomator dump` does conflict with the driver's resident helper, but phase 1 already reads the tree live through the driver, and an environment switch may lift the conflict.

**Open device questions (3.4):**
- whether `hittable` can stand in for `clickable` (Q1);
- the environment switch (Q2);
- the 2 px hold (Q3);
- the popup's box (Q4).

## 1. The driver's real capabilities

Sources are under the checkout's `node_modules`. `agent-device/dist/src/*.js` is minified, with a few very long physical lines per file, so I cite the physical line and name the function or quote a fragment. "read" means read in source; "inferred" means deduced, not read.

### 1.1 Ways to send input

| Capability | How (exact call) | Source | Mark |
| --- | --- | --- | --- |
| Tap a located node | `locator.tap()` → `perform` → `client.interactions.press({ ref })` | `@e2e-dev/mobile/dist/surface.js:1204-1205` | read |
| Tap at an offset inside a node | `locator.tap({ position })` → `performWithin` → `performAt` → `press({ x, y })`, after the node is visible with a box. No touch-point resolution. | `e2e/dist/locator/screen.js:272-282`; `e2e/dist/locator/engine.js:377-409`; `@e2e-dev/mobile/dist/actions.js:56-57` | read |
| Tap or double-tap at a viewport point | `screen.tapAt(point)`, `screen.doubleTapAt(point)` | `e2e/dist/locator/screen.js:123-132`; `e2e/dist/types.d.ts:385-387` | read |
| Long press a node | `locator.longPress({ duration })`, 100–10 000 ms, default 1 000 ms → `interactions.longPress({ ref, durationMs })`. No `position` option. | `e2e/dist/types.d.ts:337-340`; `e2e/dist/locator/screen.js:537-544`; `@e2e-dev/mobile/dist/actions.js:18`; `surface.js:1215-1216` | read |
| Long press at a point | No public `Screen`/`Locator` method. The engine supports it internally (`DEVICE_POINTER_ACTIONS`, `actions.js:41`, `:60-61`), but nothing public reaches it. Reachable as `device.unstable_raw.client.interactions.longPress({ x, y, durationMs })`. | `e2e/dist/types.d.ts:367-468`; `@e2e-dev/mobile/dist/device.d.ts:22-44`; `agent-device/dist/src/client-port.d.ts:831-837`, `:898-900` | read |
| Swipe between two arbitrary points | `screen.swipe({ from, to, duration })`, duration 16–10 000 ms. With a duration it becomes `interactions.pan({ x, y, dx, dy, durationMs })`; without one, `interactions.swipe({ from, to })`. No node and no path check in `e2e` or `@e2e-dev/mobile`. | `e2e/dist/types.d.ts:357-366`, `:389`; `e2e/dist/locator/screen.js:133-145`, `:546-553`; `@e2e-dev/mobile/dist/actions.js:62-74` | read |
| Speed / duration | `pan` takes `durationMs`. agent-device's `swipe` refuses a duration ("swipe does not accept durationMs; use gesture pan for timed movement", `agent-device/dist/src/script.js`). Directional swipes take `momentum` (`slow`/`fast`). | as above; `@e2e-dev/mobile/dist/support.js:130-145` | read |
| Swipe inside one node | `locator.swipe({ direction, momentum })`. The path is built inside the node's box (`swipeWithin`), and the type forbids `from`/`to`. It stays in its view by construction, not by refusal. | `e2e/dist/types.d.ts:347-355`, `:451`; `@e2e-dev/mobile/dist/support.js:130-145`; `surface.js:1241-1248` | read |
| Viewport scroll | `screen.swipe({ direction })` → `interactions.scroll` | `surface.js:1161-1170` | read |
| Drag node to node | `locator.dragTo(target)` → `interactions.drag({ source: ref, destination: ref })`. agent-device's drag payload has `sourceHoldMs`, `moveMs` and `destinationHoldMs`, but `e2e` passes none, and the endpoints are refs or selectors, not points. | `surface.js:1250-1258`; `client-port.d.ts:778-785` | read |
| Multi-step / multi-pointer | Raw client only: `interactions.gesture` (pan, fling, swipe preset, pinch, rotate, transform, multi-point tap with `holdMs`, drag), plus `tapGesture`, `pinch`, `rotateGesture`, `transformGesture`. There is **no hold-then-move at points**: `pan` has no hold, and `drag` needs refs or selectors. agent-device builds timed pointer samples internally (`mechanics.js:2`, function `ci`), but exposes no sample list. | `client-port.d.ts:778-828`, `:916-923`, `:2030-2052` | read; the sample builder's reach is inferred |
| Back | `app.back()` / `device.back()` → agent-device `back` → `KEYCODE_BACK` through its helper (`{kind:'key',keyCode:4}`), else `adb shell input keyevent 4` | `agent-device/dist/src/mechanics.js:2` | read |
| Other keys | `press` accepts Enter, Space and single characters only. Other named keys are refused. The raw client has `command.keyboard`, `hardwareButton` and `tvRemote`. | `surface.js:1282-1300`; `client-port.d.ts:1951-1972` | read |
| Typing | `locator.fill`, `locator.pressSequentially` → `interactions.type`. On Android agent-device ships an IME helper APK (`android/ime-helper/dist`); its `input text` fallback is `mechanics.js`, function `Tp`. Which path runs in this suite is not verified. | `e2e/dist/types.d.ts:423-430`; `surface.js` `typeText` | read (paths exist); which one runs: not verified |
| Raw `adb`/shell passthrough | None in `e2e`, `@e2e-dev/mobile`, or the agent-device client type. The repo fills the gap with `device-read.ts:41` `adbShell`, on the leased serial and adb port. | `client-port.d.ts:1974-2085`; `example/e2e/real-input/device-read.ts:41-54` | read |
| Raw driver session | `device.unstable_raw.client` is the agent-device client bound to the session. Its calls are not steps and do not settle. | `@e2e-dev/mobile/dist/device.d.ts:22-44`; `@e2e-dev/mobile/README.md` ("The `device` fixture") | read |

### 1.2 What a snapshot node carries

- **An `e2e` node** (`@e2e-dev/mobile/dist/nodes.js:481-551`) carries:
  - `role`, from the Android class through `ANDROID_ROLE_MAP` (`nodes.js:202-243`; e.g. `spinner`→`combobox`, `radio-button`→`radio`);
  - `name` (`contentDescription ?? label`), `text`, `value`, `testId` (resource id), `rect`, children;
  - `states`: `disabled`, `selected`, `focused`, `hidden`, `secure`, `checked`, `expanded`.

  read. So **`selected` and the class (as a role) are carried**. `isChecked()` answers only for checkable roles (`e2e/dist/locator/screen.js:407-412`), but `getByRole(role, { checked, selected, disabled })` filters on any role (`e2e/dist/types.d.ts` `RoleOptions`).
- **An agent-device node** (`agent-device/dist/src/sdk-contracts.d.ts:295-374`) carries: `type` (the class), `label`, `value`, `contentDescription`, `identifier`, `rect`, `enabled`, `selected`, `checked`, `focused`, `heading`, `roleDescription`, `editable`, `password`, `placeholder`, selection offsets, `visibleToUser`, `hittable`, `depth`, `parentIndex`, `interactionBlocked`, `coveredBy`, and so on. read.
- **What the Android producer reads.** The helper writes uiautomator-format XML (`android/snapshot-helper/dist/*.manifest.json`, `"outputFormat": "uiautomator-xml"`). agent-device's attribute reader (`mechanics.js:5`, function `ws`) takes: `text`, `content-desc`, `resource-id`, `package`, `class`, `bounds`, `clickable`, `enabled`, `focusable`, `focused`, `password`, `editable`, the selection offsets, `hint-showing`, `hint`, `visible-to-user`, `selected`, `heading`, `role-description`, `checked`, `drawing-order`, `scrollable`, `can-scroll-*`, and `window-*`. read. **Not read: `checkable`, `long-clickable`.** read. The helper's `classes.dex` strings contain neither attribute name, but do contain `isCheckable`. From that I infer the helper writes `checked` only on checkable nodes, as `os-tree.ts:129-131` claims. Not verified on device (Q5).
- **What gets published per node** (`mechanics.js:5` function `os`; `mechanics.js:6` function `Fs`, `passiveFacts`):
  - `checked`, `selected`, `enabled`, the class and the names are published.
  - `clickable` and `focusable` are published **only OR-ed together, as `hittable`** (`mechanics.js:5`, functions `io`, `ao`, `W`: clickable, or focusable, or focused). `hittable` is dropped when the node's effective rect is empty (function `lo`), and forced false on a covered node (`snapshot-occlusion.js`).
  - `scrollable` is parsed and used for clipping (function `ls`), but **not published**.

  read.
- **Compose role folding (default mode).** A hittable `android.view.View` takes the class of one childless, unlabelled, non-hittable child whose class is Button, CheckBox, RadioButton, Spinner or NumberPicker (set `gs`). That child is dropped from the output (`mechanics.js:5`, functions `_s`, `vs`, `ys`; `ns` skips folded nodes). read. The re-check found that this matters for the segmented-control rows S6a and S6b.
- **Less-filtered reads.** The `raw` snapshot option (`sdk-contracts.d.ts:260`; `client-port.d.ts:673-692`) keeps hidden nodes and original rects and turns the role folding off (`mechanics.js:5`, `t.options.raw`). It publishes **the same field set** (`os`). Other options: `forceFull`, `interactiveOnly`, `depth`, `scope`, and `customActions` (iOS only). None of them publishes `clickable`, `checkable`, `scrollable` or `long-clickable`. I found no passthrough of the helper's XML in the client API (`client-port.d.ts:2025-2029`). read.
- **Phase 1's own tree read** (`example/e2e/real-input/os-tree.ts:59-108`) runs `agent-device snapshot --json --force-full --serial <lease> --session e2e-android-0` as a second CLI client of the same daemon session, without `--raw`. It maps `enabled`, `checked` (checkable means "`checked` is present"), `selected`, the class, `text`/`content-desc` and the bounds (`os-tree.ts:117-151`). It sets `clickable`, `longClickable` and `focusable` to `''`, guesses `scrollable` from the class, and does **not** map `hittable`. read.

### 1.3 The two refusals

- **A tap on a node covered by its own interactive descendants is refused, in agent-device.** It happens in `agent-device/dist/src/node-touch-point.js:1`, function `V` (exported as `n`). `runtime-factory.js` imports it as `St` and uses it as `resolveTapPoint` for ref and selector targets of any action: tap, long press, and the rest. The condition (functions `x`, `C`, `T`, `E`, `A`):
  1. Take the target's descendants that pass the selector policy filter (`p` from `selector-pipeline-policy.js`; that it means "interactive" is inferred, not traced). Keep those whose box intersects the target's and does not contain it.
  2. With none, tap the centre.
  3. Otherwise, look for a point inside the target's own bounds that is at least 12 px from every such descendant and at least min(12, half the short side − 1) px from the edge.
  4. If no point qualifies, the tap fails with `COMMAND_FAILED`, reason `covered_by_interactive_descendants`.

  read.
  - **Avoided by point targets.** `locator.tap({ position })` and `screen.tapAt` send `press({ x, y })` (`@e2e-dev/mobile/dist/actions.js:56-57`). read. Phase 1 already relies on this: `date-picker.e2e.ts:46-49` and `hosted-date-picker.e2e.ts:30-33` say so in comments.
  - Two other refusals exist and are separate:
    - occlusion by a different element drawn on top (`interactionBlocked: 'covered'`, `snapshot-occlusion.js`);
    - a tap point behind the keyboard (`tap-keyboard-occlusion.js`).

    read.
- **A swipe whose path leaves its view is not refused anywhere I could find.**
  - `locator.swipe` takes only a direction and builds its path inside the node.
  - `screen.swipe({ from, to })` takes any two points and no node (sources in 1.1).
  - In agent-device, the only swipe refusals I found are validation errors and the keyboard-band rule (`scroll-gesture.js`, `interaction2.js`, `script.js`). Absence after searching the error strings: inferred.
  - Phase 1 already sends paths that leave their start view: `form.e2e.ts:58` flicks 700 px from a row; `support.ts:109-113` and `:369-373` drag strips and pages.
  - The stated limit is wrong as stated.

### 1.4 What runs on the device, and the accessibility connection

- **What is installed.** The snapshot helper `com.callstack.agentdevice.snapshothelper` with instrumentation `.SnapshotInstrumentation`, and an IME helper APK (`agent-device/android/*/dist`). read.
- **How the helper runs.** It is started as `adb shell am instrument -w … [-e sessionPort P] <runner>` (`agent-device/dist/src/snapshot-helper-install.js:4`, function `B`). With a session port it stays resident and is reused across captures (`snapshot-helper-session.js:1`, `transport: 'persistent-session'`). Input goes through it too: `runAndroidAutomationHelper(…, { action: 'input' })` falls back to `adb shell input` (`mechanics.js:2`). Its dex holds `UiAutomationInputDispatcher` and `injectInputEvent`, and the modes `input, screenshot, focus, snapshot-immediate, snapshot-short-idle`. read for the strings and the call sites; inferred for runtime behaviour.
- **Why `uiautomator dump` fails while the driver is live.** Android allows one `UiAutomation` connection, and the resident instrumentation holds it. This is platform behaviour, not in this source. The repo states it at `scripts/real-input/a11y-sweep-device.mjs:1-6`. inferred.
- **Can the connection be released mid-run?**
  - Setting `AGENT_DEVICE_ANDROID_SNAPSHOT_HELPER_SESSION` to `0`, `false`, `no` or `off` turns the persistent session off (`snapshot-helper-install.js:10`, function `nn`). It is read from the daemon's environment. read.
  - This repo builds that environment at `scripts/real-input/android.mjs:472-481`. read.
  - With the session off, each capture or input would be a one-shot `am instrument -w` that exits. `uiautomator dump` could then run between driver calls. inferred (Q2).
  - The session is also torn down by agent-device's own stop path (`snapshot-helper-install.js`, function `K`). Whether `device.closeApp()` (`device.d.ts:141-146`) or `client.sessions.close` triggers that stop: not verified.
- **How phase 1 reads `enabled` and `checked` while the driver is live.** It never runs `uiautomator dump`. It asks the driver for its own tree, through the CLI, in the same session (`os-tree.ts:38-42`, `:69-81`), because agent-device refuses a second session (`DEVICE_IN_USE`, per the comment there). So **the one-connection limit applies to `uiautomator dump`, not to reading the tree**. Every tree read phase 2 makes can be made live through the driver. What limits it is which attributes the driver publishes (1.2), not the connection. read.
- **Other device reads that work live.** Phase 1 already uses `wm density`, `dumpsys activity top` (the `ime` inset), `screencap`, and settings writes over adb (`device-read.ts:41-106`, `keyboard.ts`). read. Phase 2's `dumpsys window windows` (popup count) and `dumpsys input_method` do not touch `UiAutomation`, so they work live too. inferred.

### 1.5 Other facts the rows depend on

- The `e2e` matchers include `toHaveText`, `toContainText`, `toHaveCount`, `toBeEnabled`, `toBeDisabled` and `toBeChecked` (`e2e/dist/types.d.ts:759-814`). read.
- While a sheet, dialog or popup is up, phase 1 reads that window's own nodes (`bottom-sheet.e2e.ts:21-23`, `dialog.e2e.ts:21-23`, `context-menu.e2e.ts:22-25`). The page's text is not in the tree meanwhile (comment at `menu.e2e.ts:50-52`). read (repo tests).
- Harness presses are in-process `userEvent.press` from `@react-native-harness/ui` (`example/__tests__/aimedPress.ts:6`, `:25`), not touches delivered by InputDispatcher. read. **Rule used below:** "better as a harness test" only when a harness assertion already checks the same observable, and the observable is bookkeeping (counts, order, a disabled control taking nothing, placement maths), not gesture arbitration or delivery.

## 2. Every phase-2 check

### 2.1 The checks

`TREE_CHECKS` (`android-tree-checks.mjs:3825-3845`) runs 19 entries. `date-picker` runs two sub-checks, `checkInlineCalendarGrids` (`:1618`) and `checkTimeDrums` (`:1297`). The remaining functions are shared helpers that contain assertions:

- `contextClose` `:1013`
- `contextReveal` `:1027`
- `dayGrid` `:1067`
- `positionWheel` `:1179`
- `waitForDialogGone` `:1715`

The context helpers inside `makeContext` (`:51-905`) are counted where they are called, not where they are defined.

### 2.2 How the inventory was counted (re-runnable)

An assertion is a call that can turn the run red. That means:
- `log.check` and `log.checkEquals`, which record a failure (`report.mjs:97-125`);
- `log.abort`, which records a failure and stops (`report.mjs:127-134`);
- `throw new Error` (none matched in range);
- the context helpers that abort on a failed expectation: `requireEcho`, `requireControl`, `requireControlOnScreen`, `requireControlAt`, `requireEchoToStay`, `tapUntilValue`, `tapUntilUp`, `tapOptionUntilValue`, `waitForNodes`, `waitForOption`, `waitForPopupCount`, `pressUntil`.

Count every textual occurrence in lines 923–3823: from after `encodeInputText`, whose throw is an input-encoding refusal, to the end of `tooltipChecks`. A call inside a loop counts once. Two calls on one line count twice. The command:

```sh
awk -v lo=923 -v hi=3823 '
/^(async )?function [a-zA-Z]+/ { match($0,/function [a-zA-Z]+/); fn=substr($0,RSTART+9,RLENGTH-9) }
NR>=lo && NR<=hi { line=$0
  while (match(line,/\.check\(|\.checkEquals\(|\.abort\(|throw new Error|\.require(Echo|Control|ControlOnScreen|ControlAt|EchoToStay)\(|\.tapUntil(Value|Up)\(|\.tapOptionUntilValue\(|\.waitFor(Nodes|Option|PopupCount)\(|\.pressUntil\(/)) {
    print NR"\t"fn"\t"substr(line,RSTART,RLENGTH); line=substr(line,RSTART+RLENGTH) } }' \
  scripts/real-input/android-tree-checks.mjs | wc -l     # 364
```

Totals by call: `checkEquals` 169, `requireEcho` 54, `abort` 25, `requireControlOnScreen` 18, `check` 17, `waitForOption` 16, `waitForPopupCount` 12, `tapUntilValue` 12, `tapUntilUp` 11, `requireControl` 10, `requireEchoToStay` 7, `pressUntil` 5, `tapOptionUntilValue` 3, `requireControlAt` 3, `waitForNodes` 2. That is **364** in 25 functions.

The inventory, by function. Each entry is a line number followed by the call; a repeated number is two calls on one line.

```
contextClose: 1016waitForPopupCount
contextReveal: 1032abort 1042abort
dayGrid: 1068waitForNodes
positionWheel: 1203requireControl 1223requireControl
checkTimeDrums: 1314checkEquals 1316requireEcho 1319checkEquals 1321requireEcho 1341check 1366check 1385check 1415requireControl 1441checkEquals 1446requireEchoToStay 1451requireEcho 1452checkEquals 1457checkEquals 1468checkEquals 1520requireEcho 1521checkEquals 1526checkEquals 1545checkEquals 1551checkEquals 1553requireEcho 1562requireEchoToStay 1570checkEquals 1581checkEquals 1583requireEcho 1598check
checkInlineCalendarGrids: 1672abort 1683check 1694check
waitForDialogGone: 1722abort
bottomSheetChecks: 1751abort 1759abort 1765tapUntilUp 1768waitForOption 1773checkEquals 1773requireEcho 1777checkEquals 1786checkEquals 1794pressUntil 1799waitForOption 1805checkEquals 1815pressUntil 1821abort 1830checkEquals 1840waitForOption 1843checkEquals 1848checkEquals 1849pressUntil 1854waitForOption 1860checkEquals 1874waitForOption 1894checkEquals 1897checkEquals 1899waitForOption 1904checkEquals 1905tapUntilUp 1906waitForOption 1925waitForOption 1929waitForOption 1934checkEquals 1943checkEquals
contextMenuChecks: 1964abort 1983checkEquals 1988waitForPopupCount 2011waitForPopupCount 2031checkEquals 2032checkEquals 2037checkEquals 2038checkEquals 2043checkEquals 2044checkEquals 2073checkEquals 2078checkEquals 2091check 2093waitForPopupCount 2098checkEquals 2103checkEquals 2113abort 2120check 2121checkEquals 2129abort 2134check 2136waitForPopupCount 2142checkEquals 2147checkEquals 2161check 2169checkEquals 2174checkEquals 2190check 2191checkEquals 2192checkEquals 2206checkEquals 2207checkEquals 2212checkEquals 2217checkEquals 2222checkEquals 2230abort 2239check 2248checkEquals
hostedDatePickerChecks: 2271tapUntilUp 2272requireControlOnScreen 2280checkEquals 2282requireEcho 2285check 2290tapUntilUp 2291requireControlOnScreen 2297pressUntil 2302waitForNodes 2310checkEquals 2312requireEcho
hostedMixedChecks: 2321requireControlOnScreen 2339check 2345check 2351check 2358check
dialogChecks: 2385abort 2390tapUntilUp 2393waitForOption 2426checkEquals 2431checkEquals 2439waitForOption 2441checkEquals 2450abort 2457checkEquals 2459tapOptionUntilValue 2476checkEquals 2478requireEcho
chipChecks: 2485requireControl 2486checkEquals 2488requireEcho 2491checkEquals 2498checkEquals 2500tapUntilValue 2509checkEquals 2514checkEquals 2516tapUntilValue 2525checkEquals 2527requireEcho 2530checkEquals 2536checkEquals 2538tapUntilValue 2553checkEquals 2558checkEquals 2563checkEquals
checkboxChecks: 2573requireControl 2578checkEquals 2580requireEcho 2583checkEquals 2585requireEcho 2588checkEquals 2591requireEcho 2594checkEquals 2616checkEquals 2618tapUntilValue 2627checkEquals 2632checkEquals 2634requireEcho 2642checkEquals 2644tapUntilValue 2653checkEquals
iconButtonChecks: 2662requireControl 2668checkEquals 2670requireEcho 2673checkEquals 2675requireEcho 2678checkEquals 2680requireEcho 2683checkEquals 2685requireEcho 2685requireEcho 2690checkEquals 2693requireEcho 2702requireControlOnScreen 2706checkEquals 2708requireEchoToStay 2716checkEquals 2727checkEquals 2729tapUntilValue 2738checkEquals 2740requireEcho 2743checkEquals 2745requireEcho 2752checkEquals 2754tapUntilValue 2763checkEquals 2768checkEquals 2770requireEcho 2773checkEquals 2775tapUntilValue 2784checkEquals 2789checkEquals 2791requireEcho 2794checkEquals 2796requireEcho
buttonGroupChecks: 2820requireControl 2840abort 2855abort 2883checkEquals 2885requireEcho 2888checkEquals 2890requireEcho 2893checkEquals 2895requireEcho 2898checkEquals 2900requireEcho 2903checkEquals 2905requireEcho 2906requireEcho 2909checkEquals 2912requireEcho 2915checkEquals 2931checkEquals 2933tapUntilValue 2941checkEquals 2946checkEquals 2948requireEcho 2951checkEquals 2953tapUntilValue 2961checkEquals 2976checkEquals 2978requireEchoToStay 2986checkEquals 2988requireEchoToStay 2995checkEquals 2998requireEcho 2999requireEcho
pickerChecks: 3025requireControlOnScreen 3026checkEquals 3028tapUntilUp 3029requireControlAt 3036checkEquals 3038waitForPopupCount 3045tapUntilUp 3046requireControlAt 3051waitForOption 3053checkEquals 3055waitForPopupCount 3061checkEquals 3063requireEcho 3067requireControlOnScreen 3068checkEquals 3070requireEcho 3073checkEquals 3082checkEquals 3084tapOptionUntilValue 3092checkEquals 3094requireEcho 3097checkEquals 3099waitForPopupCount 3111checkEquals 3124checkEquals 3138requireControlOnScreen 3141checkEquals 3152waitForOption 3157checkEquals 3159requireEchoToStay 3166requireControlOnScreen 3168checkEquals 3173checkEquals 3182requireControlOnScreen 3184checkEquals 3186waitForPopupCount 3189tapUntilUp 3190requireControlOnScreen 3194checkEquals 3200waitForPopupCount 3204checkEquals 3209checkEquals 3214checkEquals 3219checkEquals
listItemChecks: 3232requireControlOnScreen 3233checkEquals 3239requireControlOnScreen 3243checkEquals 3245requireEchoToStay 3256requireEcho 3258checkEquals 3261tapUntilValue 3262requireControl
menuChecks: 3277requireControlOnScreen 3279checkEquals 3284checkEquals 3289checkEquals 3294requireControlOnScreen 3302abort 3314abort 3328abort 3336checkEquals 3338requireEcho 3341checkEquals 3343requireEcho 3350tapUntilUp 3357checkEquals 3359waitForPopupCount 3362checkEquals 3364requireEcho
hostedPickerChecks: 3372requireControlOnScreen 3373checkEquals 3375tapUntilUp 3376requireControlAt 3382waitForOption 3384checkEquals 3386waitForPopupCount 3389checkEquals 3391requireEcho
hostedSwitchChecks: 3429requireControlOnScreen 3466checkEquals 3471checkEquals 3476checkEquals 3481checkEquals 3486checkEquals 3491checkEquals
popoverChecks: 3507abort 3518abort 3528waitForOption 3531abort 3538checkEquals 3553requireEcho 3554checkEquals
segmentedControlChecks: 3568requireControlOnScreen 3569checkEquals 3571requireEcho 3576checkEquals 3578tapUntilValue 3579requireControl 3586checkEquals 3588requireEcho 3598requireControl 3635checkEquals 3636checkEquals 3642checkEquals 3647checkEquals 3655checkEquals
stepperChecks: 3668requireControlOnScreen 3675checkEquals 3677requireEcho
tooltipChecks: 3697abort 3702tapUntilUp 3705waitForOption 3711abort 3719pressUntil 3730abort 3741abort 3748checkEquals 3750requireEcho 3753checkEquals 3754checkEquals 3760checkEquals 3762requireEcho 3768checkEquals 3777checkEquals 3779requireEcho 3787checkEquals 3789requireEcho 3796checkEquals 3798tapOptionUntilValue 3808checkEquals 3814checkEquals 3816requireEcho
```

### 2.3 One row per assertion

**Grouping rule.** One row holds a read and the assertion on that read (for example `requireEcho` inside `checkEquals`), plus a retried-press helper with the lookup it presses and the witness it waits for, since these are one unit. Reads of different nodes, or reads after different inputs, get separate rows. 241 rows cover the 364 lines; 103 rows group more than one line.

Paths in the Evidence column:
- phase-1 files: `example/e2e/real-input/`;
- harness tests: `example/__tests__/`;
- the phase-2 files: `scripts/real-input/`;
- `e2e/…`, `@e2e-dev/mobile/…`: under the checkout's `node_modules`;
- a bare `mechanics.js`, `client-port.d.ts`, `node-touch-point.js`: `node_modules/agent-device/dist/src/`.

"As H1" means: popup count via `SweepDevice.popupWindowCount` (`a11y-sweep-device.mjs:402`), run over `device-read.ts:41` `adbShell` while the driver is live.

| Id | Lines | Control | Input | Read and asserted | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | 1016 | context-menu (helper `contextClose`) | Back | the app's popup windows reach 0 within 8 s | E2E with a repo helper | Popup count is `SweepDevice.popupWindowCount` (`a11y-sweep-device.mjs:402`), a `dumpsys window windows` parse; run it through `device-read.ts:41` `adbShell`, which phase 1 already calls live (`keyboard.ts:9`, `:131`). It has to be moved out of the class first. E2E-only alternative: `app.back()`, then `getByText(row).waitFor({ state: 'detached' })` (`menu.e2e.ts:20-31`). |
| H2a | 1032 | context-menu (helper `contextReveal`) | slow drags on the right-edge strip | `ctx-scroll` is in the tree | E2E today | `getByTestId('ctx-scroll').boundingBox()`; drags are `screen.swipe({ from, to, duration: 900 })` (as `support.ts:369`). |
| H2b | 1042 | context-menu (helper `contextReveal`) | slow drags on the right-edge strip | the target test id is in the tree | E2E today | `getByTestId(id).boundingBox()`. |
| H3 | 1068 | hosted-date-picker (helper `dayGrid`) | none (dialog already open) | at least 14 day cells: clickable, enabled, square, named with a year | E2E today | `screen.getByLabel(/\d{4}/)` with `count()` ≥ 14 and `boundingBox()` squareness. `clickable` drops out of the predicate, because the driver has no such field (see 1.2). `hosted-date-picker.e2e.ts:28-29` already waits for one named cell. |
| H4 | 1203, 1223 | date-picker (helper `positionWheel`) | page drags | the wheel is named with a non-zero box | E2E today | `getByLabel(label).boundingBox()`, plus `reveal` (`support.ts:172`). |
| H5 | 1722 | hosted-date-picker (helper `waitForDialogGone`) | none | the day cells leave the tree within 8 s | E2E today | `expect(getByLabel(dayRegex)).toHaveCount(0)` (`e2e/dist/types.d.ts:814`). |
| T1a | 1314, 1316 | date-picker, time wheel | none | value echo reads `-` | E2E today | `expect(screen.getByTestId(ECHO.wheelTimeValue)).toHaveText('-')`; the same at-rest read as `slider.e2e.ts:23`. |
| T1b | 1319, 1321 | date-picker, time wheel | none | events echo reads `0` | E2E today | `toHaveText('0')`. |
| T2 | 1341 | date-picker, time wheel | none | at least one node carries the wheel's name | E2E today | `getByLabel(name).count()` (`reader.ts:48-49`). |
| T3 | 1366 | date-picker, time wheel | none | `Select hour` and `Select minutes` are named inside the wheel's box | E2E today | `getByLabel('Select hour').boundingBox()` checked against the wheel box. |
| T4 | 1385 | date-picker, time wheel | none | `check(…, true)`: the condition is the literal `true` (`android-tree-checks.mjs:1388`), so it can never fail | E2E today | Nothing to port. Listed so the count closes; see Follow-ups. |
| T5 | 1415 | date-picker, time wheel (`rollDown`) | none | the drum is named with a box | E2E today | `getByLabel(label).boundingBox()`. |
| T6 | 1441, 1446 | date-picker, time wheel | 130 ms fling down the hour column | the events echo reaches `1` within 8 s and stays `1` for 1.5 s | E2E today | `screen.swipe({ from, to, duration: 130 })` (`e2e/dist/types.d.ts:357-366`; `e2e/dist/locator/screen.js:133-145` → `@e2e-dev/mobile/dist/actions.js:62-72`, a `pan` with `durationMs`), then `toHaveText('1')` and one read 1.5 s later. `picker.e2e.ts:61-64` already rolls a drum this way. |
| T7 | 1451, 1452, 1457 | date-picker, time wheel | (after T6) | the hour moved off 09; the date part is unchanged | E2E today | `textContent()` of the value echo. |
| T8 | 1468 | date-picker, time wheel | (after T6) | the row under the centre line is the reported hour mod 12 (only if the rows are in the tree) | E2E today | `getByText(/^\d{1,2}$/).all()` plus `boundingBox()`. Inferred: the driver lists the same rows a dump does, because both read the same uiautomator XML (`agent-device/dist/src/mechanics.js:6`). Not verified that the rows are present. |
| T9 | 1520, 1521, 1526 | date-picker, time wheel | two more flings | each roll moved the time; the date is unchanged | E2E today | As T6 and T7. |
| T10 | 1545 | date-picker, refusing wheel | none | the refusing drum starts on hour 9 (rows readable) | E2E today | As T8. |
| T11 | 1551, 1553 | date-picker, refusing wheel | none | refused-events echo reads `0` | E2E today | `toHaveText('0')`. |
| T12 | 1562 | date-picker, refusing wheel | fling | the events echo stays `1` for 1.5 s (the rollback is not an event) | E2E today | One read after a fixed window. `DatePicker.harness.tsx:1648` covers the model in-process ("reverts a time the parent refuses, and reports the next roll of it"). |
| T13 | 1570 | date-picker, refusing wheel | (after T12) | the drum is back on hour 9 (rows readable) | E2E today | As T8. |
| T14 | 1581, 1583 | date-picker, refusing wheel | second fling | refused-events echo reads `2` | E2E today | `toHaveText('2')`. |
| T15 | 1598 | date-picker, `wheel` + `mode="date"` | none | the box is taller than the drum plus 100 dp | Better as a harness test | `DatePicker.harness.tsx:1567` "draws the calendar for a date wheel, because there is no date drum": `expect(report.calendarHasSelection).toBe(1)` (`:1600`). |
| C1 | 1672 | date-picker, inline calendars | page drags | each calendar shows a weekday header row | **Needs a driver change** | `measureCalendarGrid` tells the header from day rows by excluding clickable nodes (`android-calendar.mjs:191`). The driver publishes no `clickable`: it folds clickable and focusable into `hittable` (`mechanics.js:5`). Needs capability D-A. |
| C2 | 1683 | date-picker, inline calendars | none | premise: one box is ≥ the wide threshold in dp, the other is under it | E2E with a repo helper | `getByLabel('Wide inline calendar').boundingBox()` plus `displayDensity()` (`device-read.ts:92`, live-safe: `wm density`). |
| C3 | 1694 | date-picker, inline calendars | none | a whole week is laid out on columns ≥ the expected dp | **Needs a driver change** | Same reader as C1. Needs D-A. |
| B1 | 1751 | bottom-sheet | none | the opener test id exists | E2E today | `getByTestId` (`bottom-sheet.e2e.ts:12`). |
| B2 | 1759 | bottom-sheet (helper `waitGone`) | Back, tap outside, drag down, sticky button, second Back | the sheet's text leaves the tree within 8 s | E2E today | `getByText(text).waitFor({ state: 'detached' })` (`bottom-sheet.e2e.ts:29`). |
| B3 | 1765, 1768 | bottom-sheet (helper `open`) | tap the opener (up to 3 tries) | the sheet's content appears | Already in phase 1 | `bottom-sheet.e2e.ts:20-22` (`opener.tap()`, `sheet.waitFor({ state: 'visible' })`). Same read for the fit sheet; the sticky and two-detent openers are the same call. |
| B4 | 1773, 1773 | bottom-sheet (helper `log`, called at 1776, 1879, 1912, 1951) | (after each step) | `sheet-log` equals the expected sequence | E2E today | `expect(getByTestId('sheet-log')).toHaveText(seq)`. `bottom-sheet.e2e.ts:19` already reads it at rest. |
| B5 | 1777 | bottom-sheet | none | the content is not mounted before the sheet is presented | E2E today | `getByText(FIT).count()` is 0. |
| B6 | 1786 | bottom-sheet | tap the opener | the presented sheet is `sheet-fit-sheet` | Already in phase 1 | `bottom-sheet.e2e.ts:21-22`. |
| B7 | 1794, 1799, 1805 | bottom-sheet | tap the Pressable inside the sheet | `Pressed 1 times` | Already in phase 1 | `bottom-sheet.e2e.ts:23-26`. |
| B8 | 1815, 1821, 1830 | bottom-sheet | tap the TextInput inside the sheet | `Input touches: in 1 out 1` | E2E today | `sheet.getByTestId('sheet-input').tap()`, then `toHaveText`. |
| B9a | 1840 | bottom-sheet | none | `Chip 1` is in the sheet (aim for the drag) | E2E today | `getByText('Chip 1').boundingBox()`. |
| B9b | 1843 | bottom-sheet | horizontal drag from 90 % to 10 % of the display at Chip 1's row | Chip 1 moved left or out | E2E today | `screen.swipe({ from, to, duration: 400 })`. The path leaves the chip, which `screen.swipe` allows because it carries no node (`screen.js:133-145`). `form.e2e.ts:58` already flicks 700 px past a row. |
| B9c | 1848 | bottom-sheet | (same drag) | the sheet is still up | E2E today | `getByText(FIT).count()` is 1. |
| B10 | 1849, 1854, 1860 | bottom-sheet | tap the Pressable after the scroll | `Pressed 2 times` | E2E today | As B7. |
| B11 | 1874 | bottom-sheet | none | the fit sheet's title is on screen (aim for the drag) | E2E today | `getByText(FIT_TITLE).boundingBox()`. |
| B12a | 1894 | bottom-sheet, sticky | Back | the sticky sheet is still up | E2E today | `app.back()` (`bottom-sheet.e2e.ts:28`), then `getByText(STICKY).count()` is 1. A gesture-specific claim; `BottomSheet.harness.tsx:574-575` synthesises a dismissal instead. |
| B12b | 1897 | bottom-sheet, sticky | tap at 50 %/12 % of the screen | the sticky sheet is still up | E2E today | `screen.tapAt`, then `count()` is 1. |
| B12c | 1899 | bottom-sheet, sticky | none | the sticky title is on screen (aim for the drag) | E2E today | `getByText(STICKY_TITLE).boundingBox()`. |
| B12d | 1904 | bottom-sheet, sticky | drag down 600 dp in 250 ms on the title | the sticky sheet is still up | E2E today | `screen.swipe`, then `count()` is 1. |
| B13 | 1905, 1906 | bottom-sheet, sticky | tap the sheet's own button | the sheet comes down | E2E today | `getByText(STICKY).tap()`, then `waitFor({ state: 'detached' })`. |
| B14a | 1925 | bottom-sheet, two detents | none | the header is on screen (its top before the drag) | E2E today | `getByText(TWO).boundingBox()`. |
| B14b | 1929, 1934 | bottom-sheet, two detents | drag up on the header, 80 % of its top, in 400 ms | the header's top moves up by more than a third | E2E today | `screen.swipe`, then `boundingBox()`. |
| B15 | 1943 | bottom-sheet, two detents | Back | the sheet is still up (half expanded) | E2E today | `app.back()`, then `count()` is 1. |
| M1 | 1964 | context-menu | none | `ctx-target` exists | E2E today | `getByTestId('ctx-target')` (`context-menu.e2e.ts:12`). |
| M2 | 1983 | context-menu | 3 quick taps at 30 %/40 % of `ctx-target` | press count +1 each time; opens unchanged | E2E today | `screen.tapAt` at a fraction of the box (as `segmented-control.e2e.ts:31`), then `textContent()` of `ctx-echo`. `ContextMenu.harness.tsx:387-390` covers one in-process tap. |
| M3a | 1988 | context-menu | 3 quick taps | the app's popup windows are 0 | E2E with a repo helper | As H1. |
| M3b | 2011 | context-menu | tap on `Copy text` | popup windows reach 0 | E2E with a repo helper | As H1. E2E-only alternative: the row's `waitFor({ state: 'detached' })` (`context-menu.e2e.ts:26`). |
| M3c | 2093 | context-menu | Back after the hold-then-drag | popup windows reach 0 | E2E with a repo helper | As H1. Only reachable after M8a's gesture. |
| M3d | 2136 | context-menu | outside tap | popup windows reach 0 | E2E with a repo helper | As H1. |
| M4a | 2031 | context-menu | 1 s still hold at a chosen point (×3) | a popup with `Copy text` opens each time | Already in phase 1 | `context-menu.e2e.ts:21-23` (900 ms `longPress` on the node, `Reply` row visible). Phase 1 does it once, at the node's own touch point. |
| M4b | 2032 | context-menu | (same holds) | the child is never pressed by a hold that opened the menu | Already in phase 1 | `context-menu.e2e.ts:28` (`press=0;`). |
| M4c | 2037 | context-menu | tap `Copy text` | the row picks (×3) | Already in phase 1 | `context-menu.e2e.ts:25-27` (`select:reply`). |
| M4d | 2043 | context-menu | (same) | order `open>select:copy>close` every time | Already in phase 1 | `context-menu.e2e.ts:27` (`order=open,select:reply,close`). |
| M5 | 2038 | context-menu | a tap after each menu | presses once | E2E today | `screen.tapAt` plus the echo. |
| M6 | 2044 | context-menu | hold at a chosen point (×3) | the popup's top-start is within 1 dp of the finger | Better as a harness test | `ContextMenu.harness.tsx:792` "opens the popup at the finger, not at the view (Android)" throws at `:833-836` when the popup is not at the finger, and at `:841` when it is never top-start. Its tolerance (`near()`, top-start at least once) is looser than phase 2's 1 dp three times out of three. |
| M7 | 2073, 2078 | context-menu | drag from the target's centre 500 px up in 250 ms (×3) | page `scrollY` changed; no menu opened | E2E today | `screen.swipe`. `form.e2e.ts:58-69` asserts the same thing for a Form row. |
| M8a | 2091 | context-menu | DOWN, hold 900 ms, five MOVEs 400 px up, UP (one stream) | the menu opens | **Needs a driver change** | No hold-then-move at points. `screen.swipe` is one `pan` that moves from its first millisecond (`actions.js:62-72`; `PanOptions` has no hold, `client-port.d.ts:916-923`). agent-device's `drag` has `sourceHoldMs` but takes refs or selectors, not points (`client-port.d.ts:778-785`). Needs D-D. |
| M8b | 2098, 2103 | context-menu | (that gesture), then Back | page `scrollY` unchanged; one close reported | **Needs a driver change** | Same echo, read after Back; only meaningful after M8a's gesture. Needs D-D. |
| M9a | 2113 | context-menu | none | `ctx-hscroll` exists | E2E today | `getByTestId('ctx-hscroll')`. |
| M9b | 2120, 2121 | context-menu | swipe from 80 % to 20 % across `ctx-hscroll` | `hX` changed; no open | E2E today | `screen.swipe`, or `getByTestId('ctx-hscroll').swipe({ direction: 'left' })` (inside the node by construction, `@e2e-dev/mobile/dist/support.js:130`). |
| M10a | 2129 | context-menu | none | `ctx-below` exists | E2E today | `getByTestId('ctx-below')`. |
| M10b | 2134 | context-menu | 1 s hold at the press point | the menu opens | E2E today | Hold as `press-feedback.ts:117` does (a 2 px `screen.swipe` lasting the hold), or `device.unstable_raw.client.interactions.longPress({ x, y, durationMs })` (`device.d.ts:44`; `client-port.d.ts:898`). Then `getByText('Copy text').waitFor()`. |
| M10c | 2142, 2147 | context-menu | tap `ctx-below` at 85 % | one close reported; the press below never lands | E2E today | `screen.tapAt`, then the echo. |
| M11a | 2161 | context-menu, nested | hold on the inner menu | the popup shows `Inner action` and not `Outer action` | E2E today | Hold as M10b, then `getByText('Inner action')` / `getByText('Outer action').count()`. |
| M11b | 2169, 2174 | context-menu, nested | (then Back) | the inner reports the open, the outer does not | E2E today | The echo. `ContextMenu.harness.tsx:448-449` asserts the event half in-process. |
| M12a | 2190 | context-menu, disabled | 1 s hold | no popup | Better as a harness test | `ContextMenu.harness.tsx:454` "when disabled, opens nothing and the child keeps the gesture" (`:471` `off.arms` is `'0'`). |
| M12b | 2191 | context-menu, disabled | (same) | no open reported | Better as a harness test | `ContextMenu.harness.tsx:483` `expect(eventsOf('off')).toEqual([])`. |
| M13 | 2192 | context-menu, disabled | 1 s hold | the child presses once on release | E2E today | Hold as M10, then `dPress` in the echo. The harness title at `:454` claims this, but the assertions I read (`:471-483`) do not show the child's press. |
| M14 | 2206 | context-menu, accessible | none | one node carries `Message from Grace` | E2E today | `getByLabel(…).count()` is 1 (`reader.ts:48-56`). |
| M15a | 2207 | context-menu, accessible | none | the node is long-clickable | **Needs a driver change** | The snapshot helper APK emits no `long-clickable` (the string is absent from its `classes.dex`; output format declared in `android/snapshot-helper/dist/*.manifest.json`), and agent-device's attribute reader does not ask for it (`mechanics.js:5`). Needs D-C. |
| M15b | 2217 | context-menu, plain `ctx-bottom` | none | the node is not long-clickable | **Needs a driver change** | As M15a. Needs D-C. |
| M16a | 2212 | context-menu, accessible | none | the node is focusable | **Needs a driver change** | `focusable` is parsed (`mechanics.js:5`) but only published OR-ed with clickable as `hittable` (`mechanics.js:5`, functions `ao`/`W`). Needs D-A. `ContextMenu.harness.tsx:867-868` (`on.ax` 1, `off.ax` 0) may cover it in-process; what `ax` means is not verified. |
| M16b | 2222 | context-menu, plain `ctx-bottom` | none | the node is not focusable | **Needs a driver change** | As M16a. A missing `hittable` would imply "not focusable" for this node, but the field can also drop for an off-screen or covered node (`mechanics.js:5` `lo`), so it is no substitute. Needs D-A. |
| M17a | 2230 | context-menu, bottom edge | none | `ctx-bottom` exists | E2E today | `getByTestId('ctx-bottom')`. |
| M17b | 2239 | context-menu, bottom edge | hold near the bottom edge | the popup's bottom is at or above the finger | E2E today | Popup box from `getByTestId('android:id/content')` while the popup is up. Not verified that the driver's tree carries the popup window's content node; `context-menu.e2e.ts:22-23` shows the popup's rows are in it (question Q4). |
| M17c | 2248 | context-menu, bottom edge | (then Back) | that ContextMenu reported the open | E2E today | The echo. |
| D1 | 2271, 2272 | hosted-date-picker | tap the field | the dialog's day grid appears | Already in phase 1 | `hosted-date-picker.e2e.ts:25-29`. |
| D2 | 2280, 2282, 2285 | hosted-date-picker | Back | the value is still the seed; the app's text is readable again | E2E today | `app.back()`, then `expect(value).toHaveText('2026-05-17')`. |
| D3 | 2290, 2291 | hosted-date-picker | tap the field again | the grid appears | Already in phase 1 | As D1. |
| D4a | 2297, 2302 | hosted-date-picker | tap Cancel (until the grid goes) | the grid leaves | E2E today | `getByText(/^(Cancel\|Close\|Dismiss\|Back)$/).tap()`, then as H5. |
| D4b | 2310, 2312 | hosted-date-picker | (same) | the value is still the seed | E2E today | `toHaveText('2026-05-17')`. |
| X1 | 2321 | hosted-mixed | page drags | `Mixed button` is on screen | E2E today | `reveal` (`hosted-mixed.e2e.ts:17`). |
| X2 | 2339 | hosted-mixed | none | the linear bar is as wide as the Slider (±5 %) | Better as a harness test | `Progress.harness.tsx:346` "hosts each variant, fills the width for a bar and keeps a square for a ring": `Math.abs(linearBox.width - 300)` < 1 (`:380`). Also `HostControls.harness.tsx:1535` "stretches a hosted Slider across the Host box" (`:1553-1556`). These measure drawn boxes, not accessibility bounds. |
| X3 | 2345, 2358 | hosted-mixed | none | the circular indicator keeps its own width and is square | Better as a harness test | `Progress.harness.tsx:388-389` (`circularMeasured` width and height equal `CIRCULAR_SIZE`). |
| X4 | 2351 | hosted-mixed | none | the Switch keeps its own width | E2E today | `getByLabel('Mixed switch').boundingBox()` against the bar's box. I found no harness assertion of a hosted Switch's width (searched the `Host`/`HostControls` test titles). |
| G1 | 2385, 2390, 2393 | dialog | tap the opener | the alert is up | Already in phase 1 | `dialog.e2e.ts:20-22`. |
| G2a | 2426 | dialog | none | the disabled action's clickable node reads `enabled=false` | **Needs a driver change** | Phase 2 finds the node as the innermost clickable box around the label (`android-tree-checks.mjs:2408-2422`); its own comment says the label's TextView reads enabled either way. Needs D-A. Helper geometry (`os-tree.ts:166` `ownerNode`) is an unverified alternative. |
| G2b | 2431 | dialog | none | the ordinary action's clickable node reads `enabled=true` | **Needs a driver change** | As G2a. |
| G3a | 2439 | dialog | none | `Locked action` is up (aim) | E2E today | `getByText('Locked action').boundingBox()`. |
| G3b | 2441 | dialog | tap the disabled action | the alert stays up | Better as a harness test | `Dialog.harness.tsx:512` "takes no tap on a disabled action, and draws it disabled": `eventLog` is `''` (`:529`), `presented` is `'1'` (`:530`). |
| G4 | 2450 | dialog (helper `waitGone`) | none | the alert's title leaves the tree | E2E today | `waitFor({ state: 'detached' })` (`dialog.e2e.ts:25`). |
| G5 | 2457, 2459 | dialog | tap `Delete draft` | log is `action:delete > presented:false` | Better as a harness test | `Dialog.harness.tsx:501`: `expect(eventLog.join(',')).toBe('act:action:delete,act:presented:false')` (`:507`). The real tap's delivery is already `dialog.e2e.ts:23-24`. |
| G6 | 2476, 2478 | dialog | Back, then a tap on the scrim | each closed the alert with one close and no action | E2E today | `app.back()`, `screen.tapAt`, then `toHaveText` on the log. |
| CH1 | 2485 | chip | none | the named control has a box (inside tap lookups) | E2E today | `getByLabel(name).boundingBox()`. |
| CH2 | 2486, 2488 | chip | none | value `off` | Already in phase 1 | `chip.e2e.ts:19`. |
| CH3 | 2491 | chip | none | the chip's own node is not checked | Already in phase 1 | `chip.e2e.ts:20` (`treeAnnounces` → `os-tree.ts:218-221`, the same tightest-checkable rule as `android-tree.mjs:58-64`). |
| CH4 | 2498, 2500 | chip | tap | value `on` | Already in phase 1 | `chip.e2e.ts:22-23`. |
| CH5 | 2509 | chip | none | the node is checked | Already in phase 1 | `chip.e2e.ts:24`. |
| CH6 | 2514, 2516 | chip | second tap | value `off` | E2E today | `chip.tap()`, `toHaveText('off')`; `hosted-switch.e2e.ts:24-25` tests the way back the same way. |
| CH7 | 2525, 2527 | chip | none | events `2` | E2E today | `toHaveText('2')` (as `hosted-switch.e2e.ts:26`). |
| CH8 | 2530 | chip | none | the node is no longer checked | E2E with a repo helper | `treeAnnounces(NAME, { checked: 'off' })` (`reader.ts:86`; works live, `chip.e2e.ts:20`). |
| CH9 | 2536, 2538 | chip, assist | tap | presses `1` | E2E today | `getByLabel('Real-input assist chip').tap()`, `toHaveText('1')` (as `button.e2e.ts:24-25`). |
| CH10a | 2553 | chip, disabled filter | none | `enabled=false` on the tightest clickable box around the label | E2E with a repo helper | `treeAnnounces('Real-input disabled chip', { enabled: 'false' })` (`reader.ts:101-107` → `os-tree.ts:166` `ownerNode`: tightest box ≤ 4× the label's area, not clickable-filtered). Works live. Same node as tightest-clickable: not verified (question Q8). |
| CH10b | 2558 | chip, disabled assist | none | `enabled=false` on the same kind of node | E2E with a repo helper | As CH10a. |
| CH10c | 2563 | chip, enabled assist | none | `enabled=true` on the same kind of node | E2E with a repo helper | As CH10a. |
| CB1 | 2573 | checkbox | none | the named control has a box | E2E today | `getByLabel(BOX).boundingBox()`. |
| CB2 | 2578, 2580 | checkbox | none | value `off` | Already in phase 1 | `checkbox.e2e.ts:23`. |
| CB3a | 2583, 2585 | checkbox | none | events `0` | E2E today | `toHaveText('0')`. |
| CB3b | 2588, 2591 | checkbox | none | the disabled counter `0` (never tapped later, see Follow-ups) | E2E today | `toHaveText('0')`. |
| CB4 | 2594 | checkbox | none | the box's node is unchecked | E2E with a repo helper | `treeAnnounces(BOX, { checked: 'off' })` (as `switch.e2e.ts:27`). |
| CB5 | 2616, 2618 | checkbox | tap | value `on` | Already in phase 1 | `checkbox.e2e.ts:25-26`. |
| CB6 | 2627 | checkbox | none | the node is checked | E2E with a repo helper | As CB4 with `'on'` (`switch.e2e.ts:31`). |
| CB7 | 2632, 2634 | checkbox | none | events `1` | E2E today | `toHaveText('1')`. |
| CB8 | 2642, 2644 | checkbox | second tap | value `off` | E2E today | `tap()`, then `toHaveText('off')`. |
| CB9 | 2653 | checkbox | none | the node is unchecked | E2E with a repo helper | As CB4. |
| IB1 | 2662 | icon-button | none | the named control has a box | E2E today | `boundingBox()`. |
| IB2 | 2668, 2670 | icon-button | none | presses `0` | Already in phase 1 | `icon-button.e2e.ts:22`. |
| IB3a | 2673, 2675 | icon-button | none | toggle value `off` | E2E today | `toHaveText('off')`. |
| IB3b | 2678, 2680 | icon-button | none | toggle events `0` | E2E today | `toHaveText('0')`. |
| IB3c | 2683, 2685, 2685 | icon-button | none | refusing toggle `none 0` (never tapped later, see Follow-ups) | E2E today | `toHaveText` on two echoes. |
| IB3d | 2690, 2693 | icon-button | none | disabled counter `0` | E2E today | `toHaveText('0')`. |
| IB4a | 2702 | icon-button, disabled | page drags | each disabled form is on screen | E2E today | `reveal`. |
| IB4b | 2706, 2708 | icon-button, disabled | 3 taps each on the disabled press and toggle forms | the disabled counter stays `0` | Better as a harness test | `IconButton.harness.tsx:1155` "takes no press while disabled, on either form": `expect(events).toEqual([])` (`:1177`). |
| IB5 | 2716 | icon-button | none | the toggle's node is unchecked | E2E with a repo helper | `treeAnnounces(TOGGLE, { checked: 'off' })`. |
| IB6 | 2727, 2729 | icon-button | two taps | presses `1`, then `2` | E2E today | `tap()` twice (`icon-button.e2e.ts:24-25` does the first). |
| IB7a | 2738, 2740 | icon-button | none | value still `off` | E2E today | `toHaveText('off')`. |
| IB7b | 2743, 2745 | icon-button | none | toggle events still `0` | E2E today | `toHaveText('0')`. |
| IB8 | 2752, 2754 | icon-button, toggle | tap | value `on` | E2E today | `tap()`, `toHaveText('on')`. |
| IB9 | 2763 | icon-button, toggle | none | the node is checked | E2E with a repo helper | `treeAnnounces`. |
| IB10 | 2768, 2770 | icon-button, toggle | none | events `1` | E2E today | `toHaveText`. |
| IB11 | 2773, 2775 | icon-button, toggle | second tap | value `off` | E2E today | `tap()`, `toHaveText('off')`. |
| IB12 | 2784 | icon-button, toggle | none | the node is unchecked | E2E with a repo helper | `treeAnnounces`. |
| IB13a | 2789, 2791 | icon-button | none | toggle events `2` | E2E today | `toHaveText('2')`. |
| IB13b | 2794, 2796 | icon-button | none | presses still `2` | E2E today | `toHaveText('2')`. |
| BG1a | 2820 | button-group | none | the group is named with a box | E2E today | `getByLabel(group).boundingBox()`. |
| BG1b | 2855 | button-group | none | an item titled X is inside the group's box | E2E today | `getByLabel(group).getByText(title)` (`button-group.e2e.ts:43`). |
| BG2 | 2840 | button-group | none | a clickable node contains the item's title | **Needs a driver change** | `tightestFlaggedNode(…, 'clickable')` (`android-tree-checks.mjs:2836`). Needs D-A. |
| BG3a | 2883, 2885 | button-group | none | presses `0` | Already in phase 1 | `button-group.e2e.ts:30`. |
| BG3b | 2888, 2890 | button-group | none | pressed id `none` | Already in phase 1 | `button-group.e2e.ts:31`. |
| BG4a | 2893, 2895 | button-group | none | toggles `bold` | E2E today | `toHaveText('bold')`. |
| BG4b | 2898, 2900 | button-group | none | toggle events `0` | E2E today | `toHaveText('0')`. |
| BG4c | 2903, 2905, 2906 | button-group | none | refusing group `none 0` (never tapped later, see Follow-ups) | E2E today | `toHaveText` on two echoes. |
| BG4d | 2909, 2912 | button-group | none | disabled counter `0` | E2E today | `toHaveText('0')`. |
| BG5 | 2915 | button-group | none | the `Bold` item's node is checked | E2E with a repo helper | `itemAnnounces(TOGGLES, 'Bold', { checked: 'on' })` (`reader.ts:124`, as `button-group.e2e.ts:47`). |
| BG6 | 2931, 2933 | button-group | tap `Italic` | toggles `bold,italic` | Already in phase 1 | `button-group.e2e.ts:48-49` (`toContainText('italic')`; phase 2 asserts the exact set). |
| BG7 | 2941 | button-group | none | `Italic`'s node is checked | Already in phase 1 | `button-group.e2e.ts:50`. |
| BG8 | 2946, 2948 | button-group | none | toggle events `1` | E2E today | `toHaveText`. |
| BG9 | 2951, 2953 | button-group | second tap on `Italic` | toggles `bold` | E2E today | `tap()`, `toHaveText('bold')`. |
| BG10 | 2961 | button-group | none | `Italic`'s node is unchecked | E2E with a repo helper | `itemAnnounces(…, { checked: 'off' })`. |
| BG11a | 2976, 2978 | button-group, disabled item | tap `Cut` | the disabled counter stays `0` | Better as a harness test | `ButtonGroup.harness.tsx:591` "takes nothing from a disabled group or a disabled item…": `expect(events.slice(from)).toEqual([])` (`:636`). |
| BG11b | 2986, 2988 | button-group, disabled group | tap `Copy` | the disabled counter stays `0` | Better as a harness test | `ButtonGroup.harness.tsx:619`. |
| BG12 | 2995, 2998, 2999 | button-group | none | presses and toggle events read `0 2` | E2E today | `toHaveText`. |
| PK1 | 3025 | picker | page drags | the anchor is on screen | E2E today | `reveal`. |
| PK2 | 3026, 3028, 3029 | picker | tap the anchor (re-found each try) | the menu opens as a popup window (count 1) | E2E with a repo helper | Popup count as H1. `picker.e2e.ts:25-26` opens it and taps a row, but does not read the window kind. |
| PK3 | 3036, 3038 | picker | Back | popup count is 0 | E2E with a repo helper | As H1. |
| PK4 | 3045, 3046 | picker | tap the anchor again (re-found) | the popup is up (count) | E2E with a repo helper | As H1. |
| PK5 | 3051 | picker | none | the `Onyx` row is up | E2E today | `getByText('Onyx').waitFor()`. |
| PK6 | 3053, 3055 | picker | tap the row already chosen | the popup count reaches 0 | E2E with a repo helper | As H1. |
| PK7 | 3061, 3063 | picker | none | no change reported | Better as a harness test | `Picker.harness.tsx:1738` "reports nothing for the row already chosen, or for a disabled group": `expect(eventLog).toEqual([])` (`:1769`). |
| PK8 | 3067 | picker, radio | page drags | the radio group is on screen | E2E today | `reveal`. |
| PK9 | 3068, 3070 | picker, radio | none | index `-` | E2E today | `toHaveText('-')`. |
| PK10a | 3073 | picker, radio | none | no popup window belongs to it | E2E with a repo helper | As H1. |
| PK10b | 3097, 3099 | picker, radio | tap `Obsidian` | the row tap opened no window | E2E with a repo helper | As H1. |
| PK11 | 3082, 3084 | picker, radio | tap `Obsidian` | index `2` | E2E today | `getByText('Obsidian').tap()`, `toHaveText('2')`. |
| PK12 | 3092, 3094 | picker, radio | none | events `1` | E2E today | `toHaveText('1')`. |
| PK13 | 3111 | picker, radio (loop over 3 rows) | none | only the tapped row's checkable node is checked | E2E with a repo helper | `itemAnnounces('Real-input radio picker', row, { checked })` (`reader.ts:124` → `os-tree.ts:268-315` `factsForItem`, tightest checkable). |
| PK14 | 3124 | picker, radio (loop over 3 rows) | none | the enabled group's rows read `enabled=true` | E2E with a repo helper | `itemAnnounces(…, { enabled: 'true' })`: the same node `radioRowNode` reads (tightest checkable). |
| PK15 | 3138 | picker, disabled radio | page drags | the disabled radio group is on screen | E2E today | `reveal`. |
| PK16 | 3141 | picker, disabled radio (loop over 3 rows) | none | the rows read `enabled=false` | E2E with a repo helper | `itemAnnounces(…, { enabled: 'false' })`. |
| PK17a | 3152 | picker, disabled radio | none | a disabled row is up (aim) | E2E today | `getByText('Peridot').boundingBox()`. |
| PK17b | 3157, 3159 | picker, disabled radio | tap a disabled row | index stays `2` | Better as a harness test | `Picker.harness.tsx:1738`: `expect(eventLog).toEqual([])` after picks on `radio-disabled` (`:1772`). |
| PK18a | 3166 | picker, disabled | page drags | the disabled picker is on screen | E2E today | `reveal`. |
| PK18b | 3168, 3173 | picker, disabled | none | one node carries the name, and it reads `enabled=false` | E2E today | `actsOnOneNamedNode(screen, { name, state: 'disabled' })` (`reader.ts:41-76`). |
| PK19a | 3182 | picker, disabled | page drags | the disabled picker is on screen (tap target) | E2E today | `reveal`. |
| PK19b | 3184, 3186 | picker, disabled | tap the disabled picker | no popup | E2E with a repo helper | As H1. |
| PK20a | 3189, 3190, 3194 | picker, enabled | tap the enabled picker (re-found) | popup count 1 | E2E with a repo helper | As H1. |
| PK20b | 3200 | picker, enabled | Back | popup count 0 | E2E with a repo helper | As H1. |
| PK21 | 3204 | picker | none | one node carries the enabled picker's name | E2E today | `count()` is 1. |
| PK22 | 3209 | picker | none | that node's text is `Mica` | E2E today | `expect(getByLabel(name)).toHaveText('Mica')`. The engine gives a node `name` from the content description and `text` from the node's text (`@e2e-dev/mobile/dist/nodes.js:503-534`). Not verified on device that both sit on this node. |
| PK23 | 3214 | picker | none | that node is clickable | **Needs a driver change** | No `clickable` field (`mechanics.js:5`). Needs D-A. |
| PK24 | 3219 | picker | none | the node's class is `android.widget.Spinner` | E2E today | `getByRole('combobox', { name })`: `spinner` maps to `combobox` (`nodes.js:221`). Alternatively `treeAnnounces(name, { role: 'Spinner' })` (`reader.ts:108`). |
| L1 | 3232, 3239 | list-item | page drags | the disabled item is on screen | E2E today | `reveal`. |
| L2 | 3233 | list-item | none | the disabled item reads `enabled=false` on the tightest clickable box around it | E2E with a repo helper | `treeAnnounces(DISABLED, { enabled: 'false' })`. Same caveat as CH10. |
| L3 | 3243, 3245 | list-item, disabled | 3 taps | the disabled counter stays `0` | Better as a harness test | `ListItem.harness.tsx:765` "takes no press and sends nothing while disabled": `expect(events.slice(from)).toEqual([])` (`:795`), presses `'0'` (`:796`). |
| L4a | 3256 | list-item | none | the live item's press count before the barrier | E2E today | `textContent()`. |
| L4b | 3258, 3261, 3262 | list-item | tap the live item (re-found) | presses +1 | E2E today | As `list-item.e2e.ts:28-29`. |
| MN1a | 3277 | menu | page drags | the trigger is on screen | E2E today | `reveal`. |
| MN1b | 3294 | menu, split | page drags | the split trigger is on screen | E2E today | `reveal`. |
| MN2 | 3279 | menu | none | one node carries the trigger's name | Already in phase 1 | `menu.e2e.ts:53` (`reader.ts:50-56`, count is 1). |
| MN3 | 3284 | menu | none | that node's text is `Actions` | E2E today | `toHaveText('Actions')`. |
| MN4 | 3289 | menu | none | the node's class is `android.widget.Spinner` | E2E today | `getByRole('combobox', { name })` (as P24). |
| MN5a | 3302 | menu, split (helper `listHalf`) | none | the action half is named | E2E today | `getByLabel(SPLIT_ACTION)`. |
| MN5b | 3314 | menu, split (helper `listHalf`) | none | the `More options` half sits in the action half's band | E2E today | `getByLabel('More options').boundingBox()` against the action half's box. |
| MN5c | 3328 | menu, split (helper `actionHalf`) | none | the action half is named | E2E today | `getByLabel(SPLIT_ACTION)`. |
| MN6 | 3336, 3338 | menu, split | tap the action half | echo `action` | E2E today | `getByLabel(SPLIT_ACTION).tap()`. `Menu.harness.tsx:2032` asserts it in-process. |
| MN7 | 3341, 3343 | menu, split | none | no popup, and the echo is still `action` | E2E with a repo helper | As H1. |
| MN8a | 3350 | menu, split | tap the list half | popup count 1 | E2E with a repo helper | As H1. |
| MN8b | 3357, 3359 | menu, split | Back | popup count 0 | E2E with a repo helper | As H1. |
| MN9 | 3362, 3364 | menu, split | none | echo `action > open > close` | E2E today | `toHaveText`. |
| HP1 | 3372 | hosted-picker | page drags | the anchor is on screen | E2E today | `reveal`. |
| HP2 | 3373, 3375, 3376 | hosted-picker | tap the anchor (re-found) | popup count 1 | E2E with a repo helper | As H1. |
| HP3 | 3382 | hosted-picker | none | the menu shows `Gamma` | Already in phase 1 | `hosted-picker.e2e.ts:28-30` (opens the menu and waits for its row). |
| HP4 | 3384, 3386 | hosted-picker | Back | popup count 0 | E2E with a repo helper | As H1. |
| HP5 | 3389, 3391 | hosted-picker | none | index still `1` | E2E today | `app.back()`, `toHaveText('1')`. |
| HS1 | 3429 | hosted-switch | page drags | `Hosted switch 0` is on screen | E2E today | `reveal`. |
| HS2 | 3466, 3471, 3476, 3481, 3486, 3491 | hosted-switch | none | traversal order: RN text above, the three hosted Switches in mount order, the RN note below | E2E with a repo helper | `tree()` (`os-tree.ts:59`) returns the driver's nodes in capture order. Inferred that agent-device keeps the XML's document order (`mechanics.js:6` builds nodes while walking the XML). E2E-only alternative: `screen.tree()` (`e2e/dist/types.d.ts:400-405`). |
| PO1 | 3507 | popover (helper `waitGone`) | none | the popover's field label leaves the tree | E2E today | `waitFor({ state: 'detached' })`. |
| PO2 | 3518 | popover | none | `popover-log` exists | E2E today | `getByTestId`. |
| PO3a | 3528 | popover | tap the field anchor | the field popover is up (its label) | Already in phase 1 | `popover.e2e.ts:54-56`. |
| PO3b | 3531 | popover | (same) | its TextInput is in the tree | Already in phase 1 | `popover.e2e.ts:57`. |
| PO4 | 3538 | popover | tap the TextInput | the soft keyboard comes up | Already in phase 1 | `popover.e2e.ts:58-60` (`withRealKeyboard` plus `focusAndExpectKeyboard`, `keyboard.ts:196`). Phase 1 reads the window's `ime` inset; phase 2 reads `dumpsys input_method`. |
| PO5 | 3553, 3554 | popover | type `ab`, hide the keyboard, tap outside | the log has `typed:ab` before the field popover's close | E2E today | `field.pressSequentially('ab')` (as `text-field.e2e.ts:28`), `screen.tapAt(outside)`, then `textContent()` of the log. Not verified that agent-device's own typing path (its IME helper, falling back to `input text`, `mechanics.js`) produces the same `typed:ab` commit (question Q9). |
| S1a | 3568 | segmented-control | page drags | the control is on screen | E2E today | `reveal`. |
| S1b | 3598 | segmented-control | none | the control's box (for the structure reads) | E2E today | `boundingBox()`. |
| S2 | 3569, 3571 | segmented-control | none | events `0` | E2E today | `toHaveText('0')`. |
| S3 | 3576, 3578, 3579 | segmented-control | tap the middle (re-found) | index `1` | Already in phase 1 | `segmented-control.e2e.ts:31-32`. |
| S4 | 3586, 3588 | segmented-control | none | events `1` | E2E today | `toHaveText('1')`. `SegmentedControl.harness.tsx:1270` asserts it in-process. |
| S5 | 3635 | segmented-control | none | three checkable item nodes inside the box | E2E with a repo helper | `tree()` (`os-tree.ts:59`), where checkable is "has a `checked`" (`os-tree.ts:131`). Inferred (question Q5). |
| S6a | 3636 | segmented-control | none | three `RadioButton` nodes inside the box | E2E with a repo helper | `tree()` class plus bounds (`os-tree.ts:123`, `:141-150`). Needs one flag in the helper: `tree()` must ask for `--raw` (`os-tree.ts:72-80`). Without it agent-device folds a childless `RadioButton` role node into its clickable `View` parent and drops it (`mechanics.js:5`, functions `_s`/`vs`/`ys`, set `gs`; `ns` skips folded nodes), so this count and centring would read a different tree. Changed by the five-row re-check. |
| S6b | 3642 | segmented-control (loop) | none | each item has a `RadioButton` centred on it | E2E with a repo helper | As S6a, including the `--raw` flag. |
| S7 | 3647 | segmented-control (loop) | none | each item has its own label text | E2E with a repo helper | `tree()` text. |
| S8 | 3655 | segmented-control (loop) | none | each item's `checked` matches index 1 | E2E with a repo helper | `tree()` checked (`os-tree.ts:132`). |
| ST1 | 3668 | stepper | page drags | the hold stepper is on screen | E2E today | `reveal`. |
| ST2 | 3675, 3677 | stepper | 1.4 s hold on the plus half | value `6` (one step) | E2E today | A 2 px `screen.swipe` lasting 1400 ms on the plus half, as `press-feedback.ts:117` holds. Or `unstable_raw` `longPress({ x, y, durationMs: 1400 })`. No harness assertion about hold-repeat (`Stepper.harness.tsx` titles). |
| TT1 | 3697, 3702, 3705 | tooltip | tap the opener | the rich tooltip is up | Already in phase 1 | `tooltip.e2e.ts:20-22`. |
| TT2 | 3711 | tooltip (helper `waitGone`) | none | the message leaves the tree | E2E today | `waitFor({ state: 'detached' })`. |
| TT3 | 3719, 3730 | tooltip | tap the star (one try) | the star's count reaches the expected value | E2E today | `getByTestId('tooltip-anchor').tap()`, `toHaveText`. |
| TT4 | 3741 | tooltip | none | `tooltip-log` exists | E2E today | `getByTestId`. |
| TT5 | 3748, 3750 | tooltip | none | log `none` | Already in phase 1 | `tooltip.e2e.ts:19`. |
| TT6 | 3753 | tooltip | none | no tooltip up before a touch | E2E today | `getByText(MESSAGE).count()` is 0. |
| TT7 | 3754 | tooltip | tap the star | `star presses: 1` | E2E today | `toHaveText`. `Tooltip.harness.tsx:294` asserts it in-process. |
| TT8a | 3760, 3762 | tooltip | first star tap | nothing up; log `none` | Better as a harness test | `Tooltip.harness.tsx:267` "leaves a tap on its anchor to the anchor": `report.presented` is `'0'` (`:297`), `eventLog` is `''` (`:299`). |
| TT8b | 3814, 3816 | tooltip | second star tap | nothing up; log unchanged | Better as a harness test | As TT8a. |
| TT9 | 3768 | tooltip | none | one title and one action shown | Better as a harness test | `Tooltip.harness.tsx:488`: `up.title` (`:498`), `up.actions` is `'1'` (`:500`). |
| TT10 | 3777, 3779 | tooltip | tap outside (the log text) | log `presented:false` | E2E today | `screen.tapAt`, `toHaveText`. |
| TT11 | 3787, 3789 | tooltip | Back | log `presented:false > presented:false` | E2E today | `app.back()`, `toHaveText`. |
| TT12 | 3796, 3798 | tooltip | tap `Got it` | the action, then the close | Better as a harness test | `Tooltip.harness.tsx:512`: `'act:action:ok,act:presented:false'` (`:523`). Delivery is `tooltip.e2e.ts:23-24`. |
| TT13 | 3808 | tooltip | second star tap | `star presses: 2` | E2E today | `toHaveText`. |

### 2.4 The accessibility sweep, one row per rule

The sweep (`a11y-sweep-device.mjs:41-62` → `a11y-sweep.mjs:88-144`) makes one `log.check` per control (`a11y-sweep.mjs:117`) over 24 table rows (`a11y.mjs:149-538`). That check fails when `a11yProblems` (`a11y.mjs:1537-1629`) returns a problem no debt row matches (`a11y.mjs:842-879`; 5 Android debt rows at `a11y.mjs:672-820`). One extra check per stale debt row (`a11y-sweep.mjs:133-142`). `android.mjs:529` makes a run without a sweep red (gate bookkeeping, not a rule).

| Rule | Line | What makes it red | Flags it needs | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| R1 | `a11y.mjs:1542-1555` | no node carries the label, or every one has a zero box | content description, bounds | E2E today | Loop over `A11Y_CONTROLS`: `getByLabel(label).count()` and `boundingBox()`, as `reader.ts:48-67` already does for each phase-1 control. One difference: the engine's name is `contentDescription ?? label` (`nodes.js:503`), while the dump rule matches the content description only. |
| R2 | `a11y.mjs:1559-1567` | more than one node carries the label | as R1 | E2E today | `count()` is 1 (`reader.ts:50-56`). Same caveat. |
| R3 | `a11y.mjs:1593-1602` | the graded node is `scrollable` | `scrollable` | **Needs a driver change** (D-B) | Parsed but not published (`mechanics.js:5`). `os-tree.ts:136` guesses it from the class, which is an approximation. |
| R4 | `a11y.mjs:1603-1615` | a container's box holds no actable member (`clickable`, `checkable` or `focusable`, smaller, not scrollable) | `clickable`, `checkable`, `focusable`, `scrollable` | **Needs a driver change** (D-A, D-B) | The driver publishes `hittable` (clickable, or focusable, or focused) and `checked` (present on checkable nodes, inferred). Their union is the same test, if the two match on device (Q1). `os-tree.ts:126-128` maps neither today. |
| R5 | `a11y.mjs:1616-1628` | an interactive control's named node is not actable, and no actable box ≤ 4× its area contains it | as R4 | **Needs a driver change** (D-A, D-B) | As R4. |
| R6 | `a11y-sweep.mjs:133-142` | a debt row matched no problem this run | none (bookkeeping over R1–R5) | E2E today | Pure JS over the case results. It moves with the rules. |

### 2.5 Reconciliation

- Inventory lines: **364**. Lines covered by the rows: **364**, compared as a multiset of line numbers (`2685` and `1773` each appear twice in both). Missing: none. Extra: none. Rows: 241.
- By verdict, in lines:
  - E2E today: 212
  - E2E with a repo helper: 61
  - Already in phase 1: 49
  - Better as a harness test: 29
  - Needs a driver change: 13
  - Total: 364.
- **Could not classify: none.** One line is classified but cannot fail at all: T4, line 1385, `check(…, true)`.
- Sweep: 6 rules, 6 rows. R1, R2 and R6 are E2E today; R3, R4 and R5 need a driver change.

## 3. What a move would need

### 3.1 Driver capabilities, ordered by assertions unlocked

| # | Missing capability | Smallest change | Package and files | Unlocks | Size |
| --- | --- | --- | --- | --- | --- |
| D-A | `clickable` and `focusable` as separate fields on a snapshot node | Publish both in agent-device's node projection. The attribute reader already takes them (`mechanics.js:5` function `ws`; `mechanics.js:6` function `Fs` keeps both on the parsed node); the projection only folds them into `hittable` (`mechanics.js:5` functions `os`, `W`). Add both to `RawSnapshotNode` (`sdk-contracts.d.ts:295-374`). In this repo, map them in `os-tree.ts:117-151`. | agent-device (upstream source; the package ships only minified `dist`), then this repo | **8 lines**: 1672, 1694, 2212, 2222, 2426, 2431, 2840, 3214. Plus sweep R4 and R5. It also lets CH10a–c (2553, 2558, 2563) and L2 (3233) read exactly the node phase 2 reads. | Small: two fields and their types upstream; about 20 lines here |
| D-D | A hold-then-move gesture at points (DOWN, still for N ms, then move, UP, in one stream) | agent-device: `pan` gains `holdMs` before it moves (`PanOptions`, `client-port.d.ts:916-923`; the timed-sample builder `ci` at `mechanics.js:2` already takes per-sample times). e2e: `SwipePathOptions` gains `hold` (`e2e/dist/types.d.ts:357-366`), validated in `screen.js:133-145` and passed through by `@e2e-dev/mobile/dist/actions.js:62-72`. | agent-device, `e2e`, `@e2e-dev/mobile` | **3 lines**: 2091, 2098, 2103 | Medium: one option in each of three packages |
| D-C | `long-clickable` on a node | The snapshot helper APK has to write it (its Java source is not in the npm package; the APK and its sha256 manifest live in `android/snapshot-helper/dist`). Then read it in `ws` and publish it in `os` (`mechanics.js:5`). | agent-device (native helper and JS) | **2 lines**: 2207, 2217 | Medium: a native helper rebuild |
| D-B | `scrollable` on a node | Publish the parsed field in `os` (`mechanics.js:5`). | agent-device | **0 lines**; sweep R3, and the exact R4/R5 test | Small |

**A route with no driver change, unverified.** `os-tree.ts` could map the `hittable` the driver already publishes, and use "`hittable` or `checked` present" as actable. That covers R4 and R5 exactly if Q1 holds. For C1, C3, G2a, G2b and BG2 (tightest *clickable* box) it is a close substitute. It does not cover PK23 (`clickable` on its own), or M16a/M16b (`focusable` on its own).

### 3.2 Work inside this repo (rows marked E2E today or with a repo helper)

Shared work first:
- **(a)** Move the popup-window count (`a11y-sweep-device.mjs:402-426`) next to `adbShell` in `device-read.ts`. 33 lines need it.
- **(b)** Let `os-tree.ts` `tree()` pass `--raw` for the segmented-control structure reads (S6a, S6b).

New tests go in each control's existing `.e2e.ts`, with `retries: 0` as the config already sets. Phase 2 retries presses up to three times (`pressUntil`, `android-tree-checks.mjs:250-257`), and the moved tests drop those retries.

| Control | Lines (E2E + helper) | What it takes | What could go wrong | Cheapest mutation (behaviour to break) |
| --- | --- | --- | --- | --- |
| context-menu | 22 + 5 popup | Taps and holds at chosen points. Hold = a 2 px `screen.swipe` for the hold, as `press-feedback.ts:117`. Drag scroll, inner horizontal scroll, outside tap, nested menus, disabled child's press, bottom-edge placement. | Whether a 2 px pan reads as a hold (Q3). Popup box through `android:id/content` (Q4). `screen.tapAt` has no node check, so a moved page means a missed aim. Read boxes after the list settles, as `support.ts:307-325` does. | Make the Android ContextMenu open on a short press, or let a hold also press the child. The library line is not looked up. |
| date-picker | 26 + 1 density | Wheel rolls as 130 ms `screen.swipe`, events and value echoes, the refusing wheel. | A 130 ms pan's fling velocity versus `input swipe`'s. The drum rows may not be in the tree (T8, T10 and T13 are conditional in phase 2 too). | Report the drum's value per row crossed (drop the settle gate). T6 goes red. |
| hosted-date-picker | 9 | Back and Cancel on the hosted dialog; the grid leaving (by named cells, without `clickable`). | Cancel's label by regex. The day-cell predicate without `clickable` (H3). | Report the seeded day on dismissal. |
| bottom-sheet | 25 | TextInput press, horizontal list drag, Back / outside / drag on a sticky sheet, the detent drag, log sequences. | Taps at 12 % of the screen are blind points. The sheet's window owns the tree while up (as phase 1 already relies on). | Ignore `dismissible={false}` for Back. |
| hosted-mixed | 2 | The Switch's width from `boundingBox()`. | Accessibility bounds versus drawn box. | Give the hosted Switch `fillMaxWidth`. |
| dialog | 4 | Back and scrim closes, and the log. | Scrim point is blind. | Report an action on Back. |
| chip | 7 + 4 tree | Second tap, event count, assist chip, `treeAnnounces` for `checked` and `enabled`. | `ownerNode` versus tightest-clickable (Q8). | Drop the disabled state from the chip's semantics (the enabled reads go red); stop reporting the deselect (CH6/CH7). |
| checkbox | 9 + 3 tree | Second tap, counts, `treeAnnounces` both ways. | None beyond Q5. | Native box only ever asks for `true` (the second tap stays `on`). |
| icon-button | 27 + 3 tree | Two presses, the toggle both ways, counts, `treeAnnounces`. | None known. | Fire `onPress` twice per tap (IB6 goes red). |
| button-group | 18 + 2 tree | At-rest echoes, Italic both ways, `itemAnnounces`. | Item title unique only inside the group: scope through the group locator, as `button-group.e2e.ts:43` does. | Report a toggle change twice. |
| picker | 18 + 18 popup + 3 tree | Popup count around opens, closes and Back. Radio taps. `itemAnnounces` per row. Class via `getByRole('combobox')`. | `getByText('Onyx')` may also match the anchor's own text. The page is out of the tree while the popup is up (inferred from `menu.e2e.ts:50-52`), but not verified. Spinner class after role folding (Q7). | Open the radio group's rows in a popup (PK10 goes red); report a pick of the chosen row. |
| list-item | 6 + 1 tree | Live-item barrier, `treeAnnounces({ enabled: 'false' })`. | Q8. | Leave the disabled item enabled in semantics. |
| menu | 11 + 5 popup | Split halves, class, title text, popup count. | The two halves by label within one band. | Make the action half open the list. |
| hosted-picker | 3 + 5 popup | Popup count, index unchanged after Back. | As picker. | Treat opening as a choice. |
| hosted-switch | 1 + 6 tree | Order of nodes from `tree()`. | Driver order versus dump order (Q6). | Mount the hosted Switches in reverse semantics order. |
| popover | 4 | `pressSequentially('ab')`, tap outside, log order. | Typing path (Q9). | Close the popover before the field commits. |
| segmented-control | 6 + 5 tree | Counts, plus `tree()` with `--raw` for item, radio and label structure. | Role folding without `--raw` (re-check finding). | Drop `Role.RadioButton` from a segment. |
| stepper | 3 | 1.4 s hold as a 2 px `screen.swipe`. | Q3. | Turn on hold-to-repeat on Android. |
| tooltip | 11 | Anchor presses, outside and Back closes, logs. | None known. | Report a close on Back twice. |

### 3.3 What would still be in phase 2

- **After the in-repo work alone:** 13 lines (C1, C3, M8a, M8b, M15a, M15b, M16a, M16b, G2a, G2b, BG2, PK23) and sweep rules R3, R4, R5. That is under 4 % of the inventory, but it still needs the whole `uiautomator` stack (`SweepDevice`, the daemon stop, `uiautomator.mjs`).
- **With D-A and D-B:** 5 lines (M8a, M8b, M15a, M15b), no sweep rules. The `hittable` route alone would still leave PK23, M16a and M16b.
- **With D-C and D-D as well:** none. **Phase 2 could then be deleted.** So could `SweepDevice`'s dump path, `android-tree.mjs`'s dump readers, and the daemon stop between phases.
- **If Q2 shows the environment switch works,** the leftover rows could run as `uiautomator dump` reads *inside* e2e tests while the driver session is open. That keeps one phase without waiting for any driver change.

### 3.4 Questions the source does not settle, and the device run that settles each

| # | Question | Experiment | Reading |
| --- | --- | --- | --- |
| Q1 | Does `agent-device snapshot --json` print `hittable`, and does "`hittable` or `checked` present" equal the dump's `clickable or checkable or focusable` on the nodes phase 2 grades? | On the Dialogs, Picker, Chip, Date picker and ContextMenu screens: save `os-tree`'s CLI output (`--raw`) with the daemon up, then stop it and `uiautomator dump`; diff per bounds. | Equal → R4, R5, C1, C3, G2, BG2 move with no driver change. Different → D-A is needed. |
| Q2 | Does `AGENT_DEVICE_ANDROID_SNAPSHOT_HELPER_SESSION=0` in the daemon environment (`android.mjs:472-481`) let `uiautomator dump` run between driver steps? | Add it; in one phase-1 test call `adbShell(['uiautomator', 'dump', '/sdcard/x.xml'])` between two locator steps; time the suite. | Dump succeeds → the one-connection limit is ordering only, and any dump read can live in a test. Dump fails, or the driver errors → the limit holds while the daemon runs. |
| Q3 | Does a 2 px (and a 0 px) `screen.swipe` lasting 1 000 / 1 400 ms act as a hold? | Run M10b (ContextMenu opens) and ST2 (Stepper value `6`). | Opens and steps once → the hold rows move as written. Refused (0 px) → use 2 px. No open → use `unstable_raw` `longPress({ x, y })`. |
| Q4 | Does the driver's tree carry the popup window's `android:id/content` node, with the popup's bounds? | With the ContextMenu popup up: `getByTestId('android:id/content')` with `count()` and `boundingBox()`. | One node with the popup's box → M17b and the anchor checks can read it. Two nodes, or the page's → scope by window or fall back to the harness (M6). |
| Q5 | Is `checked` printed only on checkable nodes? | Compare the driver's JSON with a dump on the Segmented and Picker screens. | Yes → "checkable = `checked` present" is exact. |
| Q6 | Is the driver's node order the dump's order? | Host screen: index order of the RN texts and the three hosted Switches in both reads. | Same → HS2 holds as written. |
| Q7 | Does `agent-device snapshot --raw` keep the `RadioButton` role nodes, and does a folded Spinner still read as `android.widget.Spinner` on the named node in default mode? | Segmented and Picker screens, both modes. | Settles S6a/S6b and PK24/MN4. |
| Q8 | Do `ownerNode` (`os-tree.ts:166`) and tightest-clickable pick the same node for the disabled chips and the disabled list item? | Read both on one dump of each screen. | Same → CH10 and L2 hold as written. |
| Q9 | Does `pressSequentially('ab')` into the popover's field produce `typed:ab` before the popover's close? | Run PO5. | Yes → PO5 holds. A different commit shape → assert on the field's value instead. |
| Q10 | Are the wheel drum's rows in the driver's tree? | Date picker screen, wheel on screen: `getByText(/^\d{1,2}$/).all()`. | Present → T8, T10 and T13 run. Absent → they are skipped, as phase 2 already skips them with a warning. |

## Re-check of five rows

| Row | Control | Re-opened | Result |
| --- | --- | --- | --- |
| PK23 | picker | `android-tree-checks.mjs:3212-3217` (`pickerNode[0]?.clickable` equals `'true'`) and `mechanics.js:5` (`os`, no `clickable`) | Unchanged |
| M8a | context-menu | `android-tree-checks.mjs:2088-2092` (`holdThenDrag`), `actions.js:62-74`, `client-port.d.ts:916-923` | Unchanged |
| CH10a | chip | `android-tree-checks.mjs:2551-2556` (`nativeEnabled`), `os-tree.ts:161-184` (`ownerNode`), `:117-124` | Unchanged; the caveat stands |
| B9b | bottom-sheet | `android-tree-checks.mjs:1841-1847` (`swipeAcross` 0.9→0.1, then `Chip 1` moved), `actions.js:62-74` | Unchanged |
| S6a | segmented-control | `android-tree-checks.mjs:3634-3640` (`radios.length` is 3), then `os-tree.ts:72-80` and `mechanics.js:5` (`_s`, `vs`, `ys`, set `gs`) | **Changed.** agent-device folds a childless `RadioButton` role node into its clickable `View` parent and drops it unless `raw` is set. `os-tree` does not pass `--raw`, so the row now names that one-flag change, and the same note is on S6b. |

## Follow-ups (not looked into further)

- **A tap with no assertion.** `android-tree-checks.mjs:2568` taps the disabled filter chip and asserts nothing after it.
- **A check that cannot fail.** `android-tree-checks.mjs:1385` is `check(…, true)`.
- **Counters read only at rest.** Three echoes are read before any touch and never driven afterwards:
  - the disabled checkbox counter (`:2588-2591`);
  - the icon button's refusing toggle (`:2683-2685`);
  - the button group's refusing group (`:2903-2906`).
- **Docs that the source contradicts:**
  - `example/e2e/README.md` (the swipe that "leaves the view it started inside");
  - `reader.ts:83-84` ("the driver's normalised snapshot carries no `checked`, `selected` or role");
  - `android-tree-checks.mjs:1-6`;
  - `a11y-sweep-device.mjs:1-6`.

  The node map does carry `selected` and the class, and `screen.swipe` takes any path.
- **Phase 1's own role reads.** `os-tree.ts` reads without `--raw`, so the classes `treeAnnounces({ role })` sees can be folded ones (`mechanics.js:5`). Not checked whether any phase-1 assertion depends on that.
