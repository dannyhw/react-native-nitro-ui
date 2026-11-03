# G16 — ContextMenu

**Branch:** `task/G16-contextmenu` (from `main` at `e812a977`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G16-dymmb` (pair-a: iPhone 17 iOS 27 `F08675D3` / `emulator-5574` / Metro `8295`)

## Final API

```tsx
import { ContextMenu, type ContextMenuProps, type MenuGroup } from 'react-native-nitro-ui';

<ContextMenu
  group={{ actions: [{ id: 'reply', title: 'Reply' }], sections: [{ id: 'danger', items: [{ id: 'delete', title: 'Delete', destructive: true }] }] }}
  title="Message"            // optional header over the rows
  disabled={false}           // no menu; the children keep every gesture of their own
  onSelect={(id) => run(id)} // a pick; fires before onClose (D32)
  onOpen={() => {}}          // both platforms
  onClose={() => {}}         // both platforms, once per open, however it closed
  style={styles.row}         // a full ViewStyle: the box is Yoga's, laid out like a View
  accessible accessibilityLabel="Message from Ada" // opt-in (D36 item 1): the wrapper is the a11y element
>
  <Pressable onPress={openMessage}>…</Pressable>
</ContextMenu>
```

```ts
export interface ContextMenuProps extends ViewProps {
  group: MenuGroup;                  // Menu's type, unchanged
  children?: ReactNode;              // the trigger content, in place
  title?: string;
  disabled?: boolean;
  onSelect?: (id: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  hybridRef?: (view: …) => void;     // @internal (D14): the test seams below
  nuiPerfId?: number | null;         // @internal: bench marks
}
// Spec (ContextMenu.nitro.ts), every prop T | null or required (D7), callbacks D7b:
//   rows: NitroUiMenuRow[]; title: string | null; disabled: boolean;
//   previewCornerRadius: number | null (the flattened style borderRadius, D37 item 3);
//   nuiPerfId: number | null; onSelect?, onOpen?, onClose?
// Methods, test-only (@internal, D14): nuiTestSelectRow(id), nuiTestMenuProbe(),
//   nuiTestContextMenuReport(): string, nuiTestA11yLongClick()
// Manifest: id context-menu, sizing null, hostable false, androidViewManager
//   NitroUiContextMenuViewManager, tab `contextmenu` ("Context").
```

No `.mm` patch, no value, no handshake, no `open()` (Q6, D36). `testID`, `accessible` and
`accessibilityLabel` are React Native's own `View` props on the wrapper, not Nitro props: the
wrapper *is* the component view (iOS) and a `ReactViewGroup` (Android).

## Summary

ContextMenu: a `View` that opens a menu on a long press, with Menu's `group` as its rows (D36). Menu's row flattening (`MenuRows.ts`) and its Android row
composables (`MenuRows.kt`) moved to shared files, so both components draw the same rows.

**iOS.** A `UIContextMenuInteraction` on the generated component view. The lifted preview's
corners follow the style's `borderRadius` (`previewCornerRadius`, D37 item 3), rows keep
`group`'s order, and a `group` change while open is applied in place. `isAccessibilityElement`
is answered from the value React Native stored on the component view (D37 item 2). React
Native's touch is reset at `willDisplayMenu`: kept, though unproven here, because iOS 27 already
ends it (D37 item 1, Questions).

**Android.** A hand-written `ReactViewManager` subclass, so the wrapper styles like a `View`.
A 0 × 0 compose host, hidden as its last child, draws an M3 `DropdownMenu` anchored at the
press point. At recognition the view calls `notifyNativeGestureStarted` plus
`requestDisallowInterceptTouchEvent`. The devices found two bugs, both fixed:

- **The anchor was never placed.** A 0 × 0 host never runs `dispatchDraw`, and Compose's
  scheduled layout returns early while a request is pending, so `layoutHost` now forces the
  subtree's layout. Measured offset: 0,0 px at three holds.
- **A recycled `View` kept its old label.** React Native's recycle leaves
  `contentDescription` in place, so a wrapper reused by an unlabelled owner still announced
  the previous label. The manager now clears it.

Layout-move dismissal uses an `OnPreDrawListener`: Fabric moves views outside a global-layout
pass.

**Accessibility is checked by automation only** (the D37 item 4 change). The harness reads
`ax` and the "Show menu" long-click action, and performs it. Real input reads the XCUITest and
`uiautomator` trees. On iOS 27 an accessible ContextMenu still lists its first Text under the
labelled wrapper. That is recorded as `A11Y_EXEMPTIONS` debt, matched to the measured shape
only, so the regression (the wrapper is not an element at all) stays red.
`context-menu.md` says what is covered, and that VoiceOver's and TalkBack's
double-tap-and-hold were not run on a device.

**Also in this task:**

- the `longPressAt` harness patch;
- the registry manifest (`sizing: null`, `hostable: false`, `androidViewManager`);
- a conformance fixture (`isView`), the a11y case, and real-input checks on both platforms;
- the example screen, five stories, the docs, the README section and a changeset.

There is no bench arm (FOLLOWUPS line).

**Not done:** the Android README screenshot (Questions). Until it lands, `check` fails on
`readme-components`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **FAIL** | 1 failed of 1719 tests / 67 suites | `234b0b5c2ce3` | 1 m 48 s | start 3.8 / med 11.6 / max 17.5 |
| `harness:ios` | **PASS** | 362 tests / 21 suites + isolated 2 tests / 1 suites | `234b0b5c2ce3` (ios tree) | 20 m 52 s | start 3.6 / med 4.2 / max 16.2 |
| `harness:android` | **PASS** | 411 tests / 21 suites + isolated 2 tests / 1 suites | `234b0b5c2ce3` (android tree) | 12 m 13 s | start 3.3 / med 3.8 / max 11.6 |
| `real-input:ios` | **PASS** | — | `234b0b5c2ce3` (ios tree) | 16 m 39 s | start 2.7 / med 3.6 / max 5.9 |
| `real-input:android` | **PASS** | — | `234b0b5c2ce3` (android tree) | 31 m 60 s | start 4.0 / med 3.0 / max 6.0 |
| `harness:android:Conformance` | stale | 1 failed of 65 tests / 1 suites | 289025a3d31f (not this tree) | 2 m 04 s | start 3.4 / med 2.9 / max 3.5 |
| `harness:android:ContextMenu` | stale | 8 failed of 17 tests / 1 suites | 8c7ab9549fb5 (not this tree) | 1 m 08 s | start 4.8 / med 10.2 / max 17.0 |
| `harness:ios:ContextMenu` | stale | 6 failed of 17 tests / 1 suites | 8c7ab9549fb5 (not this tree) | 47.8 s | start 10.7 / med 8.2 / max 10.7 |
| `real-input:android:--control:context-menu` | stale | — | 289025a3d31f (not this tree) | 8 m 36 s | start 2.5 / med 2.8 / max 4.0 |
| `real-input:ios:--control:context-menu` | stale | — | 8c7ab9549fb5 (not this tree) | 5 m 41 s | start 6.8 / med 8.9 / max 32.3 |

`need --for review`: `need: 1 gate(s) missing for review: check`. `check`'s single failure
is `readme-components` (no `context-menu-android.png`, Question 1). The five steps it then
skipped (`perf:renders`, `prepare`, `api-extractor:check`, `publint`, `manifest:check`) each
exit 0 when run with `bun run` on this tree. The stale rows are the red proofs' runs, on
mutated trees. Two device gates were green only on a second run, both outside G16
(Follow-ups):

- `harness:android`: `BottomSheet · 50 cycles`;
- `real-input:ios`: TextField's frozen field.

## Red proofs

Each one was run against the shipped code with one thing broken, on the leased pair.

- harness:android anchor (holds at two points) -> no forced subtree layout in `layoutHost` -> `the popup is not at the finger … menu=0,142,294,1223 anchor=-1`
- harness:android layout move -> `OnGlobalLayoutListener` in place of `OnPreDrawListener` -> `timed out waiting for the close`
- harness:android recycled wrapper keeps no label -> no `contentDescription` reset in `prepareToRecycleView` -> `expected { …(5) } to be null`
- real-input:android a11y sweep -> the same -> `2 nodes carry the name "Message from Grace"`
- harness:android zero-size twin (A7) -> JS `paddingTop: 5` -> `expected 7.238 to be less than 0.6`
- harness:android child not pressed by a hold (A1) -> no `notifyNativeGestureStarted` -> `expect(count('hold:press')).toBe(0)` got 1
- harness:android nested opens the innermost (A2) -> no gesture slot -> `expected [ 'open' ] to deeply equal []`
- harness:android a11y action (A3) -> no `ACTION_LONG_CLICK` -> `expected '-' to be 'Show menu'`
- harness:android drop while open (A5) -> no `closeMenu` in `onDropView` -> `timed out waiting for the close of the dropped menu`
- harness:android recycle reset (A6) -> no `host.prepareForRecycle` -> `expected '3' to be '0'`
- harness:android Conformance recycle -> A6 -> `picks this mount reports reads 1 where the props say 0`
- real-input:android hold never presses the child -> A1 -> `and the child is never pressed by a hold that opened it — expected 0, saw 3`
- real-input:android nested -> A2 -> `a hold on the inner ContextMenu opens the inner menu (rows Outer)`
- harness:ios zero-size twin -> A7 -> `expected 7 to be less than 0.6`
- harness:ios disabled refuses (I5) -> `canOpen` ignores `disabled` -> `a refused probe: the report never got there … drawn=Reply,…`
- harness:ios destructive row (I2) -> no `.destructive` -> drawn-rows mismatch
- harness:ios accessible is an element (I1) -> the getter returns false -> `expected '0' to be '1'`
- harness:ios drop while open (I3) -> no `finishClose` -> timed out on the dropped close
- harness:ios recycle reset (I4) -> no counter reset -> `expected '2' to be '0'`
- harness (both) the held press (P1) -> `longPressAt` replaced by `pressAt` -> 8 Android and 6 iOS hold tests `timed out waiting for the open`
- real-input:ios disabled (P2) -> the screen's `ctx-disabled` enabled -> `XCTAssertEqual failed: ("1") is not equal to ("0") - a disabled ContextMenu opens nothing`
- unit `wrapperIsControl` (two cases) -> the rule only skips `!node.anchor` -> 2 failed
- unit one-element rule (measured I1 tree) -> the rule's block disabled -> `reports the wrapper with stops of its own` failed
- unit iOS debt row ("only that") -> the row's matcher widened to any count of stops -> `Expected length: 1, Received length: 0` (the I1 tree went exempt)
- Not provable in the pool: the iOS touch reset on iOS < 27 (Questions).

## Files changed

- Component: `src/components/ContextMenu/*`, `ios/components/ContextMenu/HybridNitroUiContextMenu.swift`, `android/…/HybridNitroUiContextMenu.kt`, `NitroUiContextMenuViewManager.kt`, `NitroUiPackage.kt`, `nitro.json`, `nitrogen/generated/**`
- Shared rows: `src/components/Menu/MenuRows.ts`, `Menu.tsx`, `android/…/MenuRows.kt`, `HybridNitroUiMenu.kt`
- Harness: `patches/@react-native-harness%2Fui@1.6.0.patch`, `example/__tests__/ContextMenu.harness.tsx`, `Conformance.harness.tsx`
- Real input: `scripts/real-input/{a11y,android,controls,screens,uiautomator}.mjs`, `RealInputTests.swift`, `scripts/conformance/make-a11y-fixtures.mjs`
- Unit tests and fixtures: `scripts/__tests__/{real-input-a11y,real-input-a11y-ios,conformance,component-coverage}.test.js`, `fixtures/a11y/{context-menu.xml,ios-context-menu.log,ios-context-menu-not-an-element.log}`, `src/__tests__/viewConfigs.test.ts`
- Example and docs: `example/src/{ContextMenuScreen,App,readme-examples}.tsx`, `example/src/stories/ContextMenu.stories.tsx`, `docs/components/context-menu.md`, `README.md`, `docs/images/components/context-menu-ios.png`, `docs/upstream.md`, `docs/tasks/FOLLOWUPS.md`, `etc/*`, `.changeset/context-menu.md`

## Follow-ups

- bench: no ContextMenu arm (`bench: false`), FOLLOWUPS line.
- iOS: the touch reset at `willDisplayMenu` is unproven below iOS 27 (no such pair in the pool).
- Android: no mouse or stylus right-click (`performContextClick`).
- gesture-handler: a swipeable row with a context menu is not measured.
- upstream: RN's `prepareToRecycleView` never clears a recycled `View`'s `contentDescription`. Report it to React Native.
- iOS a11y: an accessible ContextMenu still lists its first Text as a stop. Next, measure a plain `View` with `accessible`.
- smoke: ContextMenu is not in the consumer smoke app (`smoke: false`).
- flake, harness:android: `BottomSheet · 50 cycles` round 3 read `unmounts` 9 of 10 right after `live` was `0`, and rounds 4–5 failed on the carried-over counts (`reset()` is skipped on a failure). It was green on the rerun; the evidence is `docs/tasks/G16/failures/2026-11-03T09-29-11Z--harness+android--01.log`.
- flake, real-input:ios: `testRealInputTextField` saw `frozen: 1 edits refused` for `typeText("xy")`, then was green on the rerun; the evidence is `docs/tasks/G16/failures/2026-11-03T09-50-22Z--real-input+ios--01.log`.

## Questions for orchestrator

1. **The Android README screenshot is not taken.** The device tools cannot reach the leased
   emulator. It runs on the lease's private adb server (port 5043), so the device hub lists
   `nitroui_t03` as off and would boot a second copy. I tried registering its port with the
   default server (`adb -P 5037 connect 127.0.0.1:5575`, since undone). The hub then failed with
   `Failed to read AVD name for 127.0.0.1:5575: … adb -s 127.0.0.1:5575 emu avd name`, because
   `emu` only works on an `emulator-NNNN` transport. The session's device rules forbid adb
   input or screencap for UI work, and `check` fails on `readme-components` until the PNG
   lands. The options:
   - (a) allow CONTRIBUTING's `adb -s emulator-5574` hold-and-screencap for this one picture;
   - (b) take it in the merge round;
   - (c) have the lease start emulators so the default adb server lists them as `emulator-NNNN`.

   **Recommend (a).** The story is ready: `contextmenu--conversation`, hold
   `storybook-context-message`, crop to 720 px.
2. **The iOS < 27 touch-reset proof.** D37 item 1 keeps the `RCTSurfaceTouchHandler` reset,
   but iOS 27 already ends React Native's touch, so the pool cannot show the reset doing
   anything. The options:
   - (a) keep the reset, and prove it once an iOS 26.4 pair is in the pool;
   - (b) drop the reset and support iOS 27 only.

   **Recommend (a).** The machine already has 26.4 simulators outside the pool.

## Fix round 1

Lease `G16-lq26x` (pair-a). Merged `origin/main` (README kept main's structure, plus the
ContextMenu row, import and Usage). **1:** Android stores the observer its pre-draw
listener went on, and unwatches from the model's close funnel (every close path) and
`onDetachedFromWindow`. `watchStray` counts listener runs on a closed or detached view.
**2:** a DOWN the wrapper does not take drops the pending press. **3:** iOS matches a close
to the ended configuration's identifier, and never resets `generation`. **4:** both reports
are built only once asked (cleared on recycle); event copies only while pending. Also:
`nuiTestSelectRow` calls `host.choose` only, the debt matcher is anchored, and a
non-accessible wrapper offers TalkBack no long-click (it did). Android README screenshot
taken. `real-input:ios` was green on a rerun after TextField's frozen-field key flake.
`generation` across a recycle has no proof: nothing in the harness can hold an end
animator past `prepareForRecycle`.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1720 tests / 67 suites | `a8ccfd7d641c` | 1 m 60 s | start 9.1 / med 9.1 / max 13.3 |
| `harness:ios` | **PASS** | 366 tests / 21 suites + isolated 2 tests / 1 suites | `a8ccfd7d641c` (ios tree) | 8 m 51 s | start 4.1 / med 5.5 / max 8.1 |
| `harness:android` | **PASS** | 415 tests / 21 suites + isolated 2 tests / 1 suites | `a8ccfd7d641c` (android tree) | 12 m 29 s | start 9.1 / med 4.4 / max 9.1 |
| `real-input:ios` | **PASS** | — | `a8ccfd7d641c` (ios tree) | 16 m 44 s | start 4.9 / med 4.8 / max 13.4 |
| `real-input:android` | **PASS** | — | `a8ccfd7d641c` (android tree) | 32 m 08 s | start 3.7 / med 4.1 / max 8.0 |

`need --for review`: `need: review is satisfied on this code tree.`

- harness:android no layout listener left -> no unwatch in the close funnel -> `expected 6 to be +0` (after a pick)
- harness:android the same -> unwatch through today's `viewTreeObserver`, no detach unwatch -> `expected 10 to be 3` (drop while open: Fabric detaches first)
- harness:android not the touch target -> no drop for an untaken DOWN -> `timed out waiting for the held press under it`
- harness:ios a hold during the close -> the reviewed `generation` guard -> `timed out waiting for the close`
- harness:ios / android no report until asked -> publish ungated -> `expected 11 (Android 12) to be less than or equal to 2`
- harness:android disabled copies nothing -> copy every event -> `expected '2' to be '0'`
- real-input:android `ctx-bottom` -> no non-accessible branch -> `offers TalkBack no long-click — expected false, saw true`
- unit debt row -> unanchored `/2 element\(s\)/` -> `Expected: false Received: true`
