# S3 — ContextMenu spike: arbitration, iOS mount, Android anchor

**Branch:** `task/S3-contextmenu-spike` (from `main` at `afcac0f1`) · **Round:** 1 of 1 (D19's spike rule) ·
**Lease:** `S3-70m31` (pair-a: iOS `iPhone 17` 27.0 / `emulator-5574` API 35 / Metro 8295).
The prototype is evidence only and is never merged.

## Summary

**GO.** Questions 1, 2, 3 and 5 are met with real input (XCUITest on iOS, the lease's adb by serial on Android),
all 10/10 on one final tree (`e4ae564360e6`). Q4 and Q8 are met and Q7 is measured. On Android, Q6 is met through the
action TalkBack sends. On iOS it is **not met as designed**, and is met after a one-getter fix. VoiceOver itself
could not be run.

- **Cancel (Q1).** Every hold opened the menu with no `onPress`, and the next tap pressed once. With the cancel
  skipped, Android presses on release, which is red. iOS 27 doesn't go red: UIKit's lift already ends RN's touch
  (`pressOut=1 onPress=0`).
- **Scrolls (Q2).** Ancestor drags scroll and open nothing. Nothing scrolls under an open menu. An inner horizontal
  `ScrollView` pans.
- **iOS mount (Q3).** B1 holds: with no `.mm` patch the child sits at the twin's 14,14 in a 128×68 box, and 50 churn
  rounds keep the native order.
- **Android anchor (Q5).** The popup's top-start is the press point (dx=dy=0 px) at three off-centre presses. Near the
  bottom edge it opens above the finger. The recording never shows a popup at the previous point.
- **Pick order (Q4).** UIKit calls the handler before `willEnd` 10/10, so B4's rule gives `open>select>close`.
- **iOS timing (Q7).** Touch-down → `willDisplay` is 740–765 ms, median 744. That is about 240 ms after
  Pressability's 500 ms `onLongPress`.
- **Harness hold (Q8).** HarnessUI's private `UITouch`, held 1 s, opens the menu with no `onPress`, and a real hold
  after it still opens.

Two of the build changes below are Q6 design errors that only a device shows:

- B1's content view makes an `accessible` ContextMenu invisible to VoiceOver as one element.
- B2's preview path reads a `layer.cornerRadius` that RN leaves at 0 whenever the view has a visible border.

Android's open latency is the 400 ms timeout plus 45–94 ms open→drawn (median 60).

## The eight questions

| # | Question | Result | Evidence (counts out of 10, final tree `e4ae564360e6`) |
| - | --- | --- | --- |
| 1 | Cancel | **met**, both | Both platforms: quick taps press once with no menu 10/10; holds open 10/10 with `onPress` 0; a fresh tap presses once 10/10; picks 10/10 |
| 2 | Scrolls | **met**, both | Ancestor drags scroll 10/10 with 0 opens; hold-then-drag leaves the list still 10/10; a swipe under an open menu leaves it still 10/10 (menus up 10/10; on Android the swipe closes the popup); inner pans 10/10 with 0 opens |
| 3 | iOS mount (B1) | **met** | Box 128.0×68.0 with the child at 14.0,14.0, the twin `View`'s exactly; content view last subview at 14,14; churn `rounds=50/50;ok=50;late=0`; app up (no RN assertion). Android: 128.0×68.2 dp, child 14.1,14.1, same as its twin |
| 4 | iOS pick order (B4) | **met** | Native `cfg>display>handler>willEnd>close` 10/10; JS `open>select:copy>close` 10/10 |
| 5 | Android anchor (C2) | **met** | Presses (211,1158), (588,1226), (399,1192) px: popup top-start at the press, dx=0 dy=0 (density 2.625). Bottom edge: a press at y=2351 gives a popup at 1678–2098, above the finger. Recording: each open fades in at its own point (`docs/tasks/S3/android-anchor-transitions.png`) |
| 6 | Screen readers | **Android met; iOS not met as designed, met after the getter; VoiceOver unmeasurable** | Android: the accessible wrapper is one `long-clickable` node, and `ACTION_LONG_CLICK` opened it; TalkBack focus lands on it. iOS: `isAccessibilityElement` reads 0 with the label set, and 1 after the getter. See the appendix for what was and wasn't checked |
| 7 | iOS timing | **measured** | 740, 741, 741, 743, 743, 744, 749, 754, 755, 765 ms; `cfg→display` 582–600 ms; host load1 34.1→14.8. The 05:09Z run: 739–779 ms at 7–11, so load doesn't move it |
| 8 | Harness hold | **met** | iOS: a synthesized `UITouch` held 1 s gives `opened=1 onPress=0` (`docs/tasks/S3/ios-synth-hold-open.png`), then a real hold gives `opened=1`. Android: test-only `MotionEvent`s through the decor view, real timing: `opened=1 onPress=0` |

D4's other cases, as measured on both platforms:

- **4:** an outside tap closes the menu and presses nothing below (`closes=1 below=0`).
- **8:** nested gives `inner=1 outer=0`.
- **10:** disabled gives `opens=0`, `press=1`.

## What the build must change from Q6's design

1. **iOS accessibility (Appendix E, D36 item 1).**
   - `RCTViewComponentView.isAccessibilityElement` returns its content view's value
     (`rn:React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:1560-1566`).
   - With B1's `isAccessibilityElement = false`, an `accessible` ContextMenu is never an element: `ax=0` with
     `axLabel=Message from Ada`.
   - The content view must answer with the value RN stored on the component view. The spike reads it through
     `UIView`'s own getter (`ios/spike/ContextMenuProto/HybridNitroUiContextMenuProto.swift:49`), which gives `ax=1`.
2. **iOS preview corners (B2).**
   - With a visible border and no clipping, RN draws the border in its own layer and sets `layer.cornerRadius = 0`
     (`rn:.../RCTViewComponentView.mm:1109-1118`, `:1167`).
   - So the lifted preview of a `borderRadius: 16` box has square corners (`docs/tasks/S3/ios-preview-radius16.png`).
   - The `visiblePath` radius must come from the style, not the layer.
3. **Android accessibility action (Appendix E).**
   - `ViewCompat.replaceAccessibilityAction` installs its own delegate. That drops RN's, and the wrappers lost their
     `testID`.
   - Use an `onInitializeAccessibilityNodeInfo` override instead
     (`android/src/main/java/com/margelo/nitro/nitroui/spike/HybridNitroUiContextMenuProto.kt:201`).
4. **Android host layout (C2).**
   - `ReactViewGroup.requestLayout` is a no-op (`rn:ReactAndroid/.../views/view/ReactViewGroup.kt:243-246`).
   - So the wrapper lays out the 0×0 host on `onLayout` and again on a posted pass
     (`HybridNitroUiContextMenuProto.kt:225-245`).
   - D3's "keeping the stream" `onTouchEvent` claim is unnecessary, because `ReactViewGroup.onTouchEvent` already
     returns `true` (`:283-293`).
5. **Android dismissal on a layout move (C2).** This is required, not optional. An open popup follows its anchor:
   when an echo above it grew, the popup was drawn 73 dp low.
6. **iOS `onLongPress` race (D2 item 5).**
   - Pressability's 500 ms comes about 240 ms before UIKit's ~744 ms lift, so an inner `onLongPress` always fires
     first, and the menu then opens over it.
   - The doc line should say so. On Android the CANCEL at 400 ms wins at default settings.
7. **Android bottom edge (C2).** Material keeps the menu 48 dp from the window, so a press in the bottom band gets a
   popup whose bottom sits 96 dp above the finger rather than at it. That is a docs note, not a code change.
8. **D2's cancel on iOS 27.** Skipping the toggle doesn't press the child (see Q1), so the build's red proof for it
   can't run on iOS 27 (question A).

## Gates

`node scripts/gate.mjs table`, as printed:

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1716 tests / 67 suites | `083b5f361ec2` | 1 m 55 s | start 6.9 / med 11.3 / max 13.4 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:s3-cancel:--control:s3-scroll:--control:s3-layout:--control:s3-misc` | **PASS** | — | `e4ae564360e6` (android tree) | 18 m 02 s | start 5.1 / med 4.5 / max 6.2 |
| `real-input:ios:--control:s3-cancel:--control:s3-scroll:--control:s3-layout:--control:s3-misc` | **PASS** | — | `e4ae564360e6` (ios tree) | 10 m 54 s | start 5.5 / med 4.7 / max 70.9 |

`need --for review`: `2 gate(s) missing for review: harness:ios, harness:android`. Left deliberately: the brief's only
gate is `check`, and the prototype is never merged. `bun run task-ready` passes every check except that same `need`
line.

All 12 runs are in `docs/tasks/S3/gates.jsonl`, and every red run has an excerpt under `docs/tasks/S3/failures/`.

- The five red device runs were all test design:
  - Android twice: echoes or nodes were missing from the dump;
  - Android once: the run started without the lease env;
  - iOS twice: a menu wasn't confirmed open, then a close tap left it up.
- The `455b678079d0` iOS pass is the `ax=0` evidence.
- Two red `check` runs came from untracked generated files and an unbuilt `lib/` in the manifest.

## Red proofs

- Q1 Android `s3 red proof` -> `cancelTouches=false` (no `notifyNativeGestureStarted`) -> `opened=1 onPress=1`.
- Q1 iOS, same knob (no `isEnabled` toggle) -> **did not go red**: `onPress after the hold=0 pressIn=1 pressOut=1`.
  UIKit cancels RN's touch itself on iOS 27, so D2's cancel can't be shown necessary on this OS.
- Q3 churn order -> a read that came before the round's mount at load1 ~30 (unplanned) ->
  `ok=49;bad=r23:js=c123,c122:native=c121,c122` (06:07Z). The re-read was added for this, and the final run reads `late=0`.
- Q6 iOS element -> B1's `isAccessibilityElement = false` as designed -> `ax=0` (`455b678079d0`) -> after the getter,
  `ax=1` (`e4ae564360e6`).
- Q2 "menus up" guard -> a close tap that left the menu up -> `menus up 5/10` (06:07Z).
- Q5 and Q3 fixtures: **no mutation run**.
  - Q5's presses are off-centre, so a centre anchor would read |dx| of 329/48/141 px.
  - Q3's oracle is the twin `View`, not a constant.

## Files changed

- Spec, wrapper and view config: `src/spike/ContextMenuProto/`; generated files: `nitrogen/generated/`; `nitro.json`;
  `etc/package-files.txt`.
- iOS: `ios/spike/ContextMenuProto/HybridNitroUiContextMenuProto.swift` and `NitroUiS3TouchSynth.m` (HarnessUI's
  `UITouch` path, copied).
- Android: `android/src/main/java/com/margelo/nitro/nitroui/spike/`, registered in `NitroUiPackage.kt`.
- Screen: `example/src/ContextMenuProtoScreen.tsx` (the Ctx tab in `example/src/App.tsx`).
- Real input: `scripts/real-input/controls.mjs`, `android.mjs`, `ios.mjs` (an s3-only run skips the shared a11y
  pass); `example/ios/NitroUiExampleUITests/RealInputTests.swift`.
- Spike bookkeeping: `scripts/registry-core.mjs`, `src/__tests__/viewConfigs.test.ts`.
- Evidence: `docs/tasks/S3/*.png`.

## Follow-ups

- iOS: run Q1's red proof on an iOS 15–26 runtime, to see whether D2's toggle is needed there.
- iOS: a human VoiceOver pass on a device, for "Show Context Menu" on an accessible wrapper (with the getter) and on
  an inner `Pressable`.
- Android: a human TalkBack double-tap-and-hold on the accessible wrapper (the appendix says why it couldn't be done here).
- Real input (iOS): a tap at 4 % of the height (status-bar band) doesn't reliably dismiss a context menu. Tap the
  dimmed area away from the rows instead.
- Real input (Android): adb `input` bypasses TalkBack's touch exploration, while `adb emu event mouse` goes through it.
  That's a lead for an a11y harness.
- Android: the popup's first layout is at (0,142), before the position provider runs. It is invisible, but a witness
  must take the last frame.
- Hygiene incident: during the TalkBack pass one console double tap answered TalkBack's notification prompt with
  "Allow". It was reverted (`pm revoke` and flags cleared), and the a11y settings were restored to their recorded values.

## Questions for orchestrator

- **A. D2's cancel on iOS.** On iOS 27, UIKit already terminates RN's touch at the lift.
  - (a) Keep the toggle: RN's own path, cheap, and it covers older iOS. The build proves it red on an older runtime,
    or records it as unprovable on 27.
  - (b) Drop it.
  - **Recommend (a).**
- **B. Fixing the iOS accessible wrapper (change 1).**
  - (a) The content view answers through `UIView`'s getter, as the spike does. This is measured, and it needs a
    harness case that goes red if RN moves the getter again.
  - (b) Pass `accessible` to the Hybrid as a prop as well. This duplicates a base prop.
  - **Recommend (a)**, with that harness case.
- **C. The preview radius (change 2).**
  - (a) The JS wrapper sends the flattened `borderRadius` as `previewCornerRadius: number | null`.
  - (b) Read RN's background layer mask. That's private layout.
  - **Recommend (a).**
- **D. Q6's human pass.** VoiceOver isn't available in the Simulator, and the emulator couldn't produce TalkBack's
  double-tap-and-hold. **Recommend** that the owner runs both on devices with this branch's Ctx tab before G16 writes
  the docs line.

## Appendix — Q6, exactly what was and wasn't checked

**iOS (XCUITest plus the native report, no VoiceOver).**

Checked:
- With `accessible` and a label, XCUITest finds the wrapper as `Other`, labelled "Message from Ada".
- The native `isAccessibilityElement` is 0 before the getter and 1 after.
- `accessibilityCustomActions` is empty on the wrapper and its first child. UIKit's "Show Context Menu" is not a
  custom action, so this read can't see it.
- `UIAccessibility.isVoiceOverRunning` is 0.
- XCUITest still finds the inner `Pressable` with the wrapper accessible. That says nothing about VoiceOver focus.

Not checked: whether VoiceOver offers "Show Context Menu" on either configuration. The Simulator has no VoiceOver.

**Android.**

Checked:
- `uiautomator`: the accessible wrapper is one node (`s3-menu`, `content-desc="Message from Ada"`,
  `focusable="true"`, `long-clickable="true"`).
- `performAccessibilityAction(ACTION_LONG_CLICK)` opened the menu at the centre (`popup=1 opens=1`).
- TalkBack enabled on `emulator-5574`:
  - explore-by-touch on the wrapper's padding focused the whole wrapper (`docs/tasks/S3/android-talkback-wrapper-focus.png`);
  - a touch on the inner `Pressable` focused the `Pressable` (`docs/tasks/S3/android-talkback-inner-focus.png`), so
    inner buttons stay reachable.

Not checked: TalkBack's own double-tap-and-hold.
- adb `input` bypasses touch exploration: the wrapper saw a raw `down`/`drop why=up`.
- Five tries through the emulator console's touchscreen produced explore and double-tap, but never a long click
  (no trace line in the view).
