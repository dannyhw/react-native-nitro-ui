# S5 — Popover spike (React Native content)

**Branch:** `task/S5-popover-spike` (from `main` at `66d46049`) · **Round:** 1 of 1 (D19, spike) ·
**Lease:** `S5-bp78g` (iPhone 17 iOS 27.0 `F08675D3…` / `emulator-5574` API 35 / Metro `8295`)

## Summary

**GO.** Q1, Q2 and Q5 are met on both platforms: 10 of 10 by real input, plus the harness counts. Q4 is met.
Q3 is met on iOS. On Android it is met for "the keyboard comes up", but the popup does not move, and coverage by a
full soft keyboard could not be measured on this AVD.

The question table, with its evidence, is the next section.

**What the build must change from Appendix F:**
- **No presented-container shadow node.** The content lays itself out with Yoga, in place: the native node is
  absolute, `width: cap`, `alignItems: 'flex-start'`, and holds one content-box child. Native reads that box. It gives
  two-axis `fit` with no native measuring, and the cap is `min(maxWidth, window − 32)`.
- **iOS:** set `preferredContentSize` from that box before presenting, one runloop turn after the commit, and retry
  until it is sized. Otherwise the first frame is UIKit's default 320×480 (the red arm).
- **Android:**
  - compose the `Popup` only once the box's `onLayout` has a size (otherwise you get 840×126 and then 840×359);
  - use our own `PopupPositionProvider`: below the anchor, start-aligned, flipping above when there is no room;
  - make the popup `focusable` for the IME;
  - create one RN root per presentation and release it on dispose, which the red proof shows is load-bearing.
- **Keyboard:** document the Android popup as covered, or make the position provider read the IME insets
  (question 1).

**API:**
- `<Popover isPresented onIsPresentedChange? anchor children onDismiss? maxWidth? testID? style?>`.
- Native props, every one always passed:
  - `presented: boolean`, `mostRecentEventCount: number`, `maxWidth: number`, `testID: string | null`;
  - events `onPresentedChange(presented, eventCount)` and `onDismissed(ended)`.
- The handshake is `useControlled` (core-architecture §4), with Tooltip's refusal warning (D33).
- The spike-only `sizeBeforePresent` knob and the `nuiTest*` methods do not ship.

## The five questions

| # | Question | iOS | Android | Evidence |
| --- | --- | --- | --- | --- |
| 1 | First frame at its final size | **met** 10/10 | **met** 10/10 | **iOS:** real input `fit=10/10` at 301×123/148/173/198 pt. On every present, first = final = Yoga's box, one size per present. The layout bounds are constant from the first visible frame; UIKit's own zoom and fade play over them (`trace` in the log). Harness: 10/10 fixtures.<br>**Android:** real input `fit=10/10`. firstDraw = lastDraw = Yoga's box × 2.625 (766×342…558 px), and the first draw comes 11–29 ms after compose. Harness: 10/10 fixtures. |
| 2 | An RN `Pressable` takes a real tap exactly once | **met** 10/10 | **met** 10/10 | `press=10` over 10 real opens on each platform, with `closes=10`. |
| 3 | `TextInput`: the keyboard comes up, and the popup moves or is covered | **met**: it moves | **met** (keyboard) / position **unmeasurable** | **iOS:** the keyboard comes up and UIKit moves the popover up 91 pt. Its bottom is at 533 pt, above the keyboard top at 590, so it is not covered. Real key taps reach the field (`docs/tasks/S5/shots/s5-ios-keyboard-after.jpg`).<br>**Android:** `ime=1`, and `abc` typed. The field bounds stay at 84,2034→662,2123 px, so the popup does not move. This AVD has a hardware keyboard, so Gboard shows only its floating toolbar (`docs/tasks/S5/shots/s5-android-keyboard-after.jpg`). |
| 4 | Over an RN `Modal`; nested, closes cleanly | **met** | **met** | On both platforms a popover inside the Modal takes a real tap. Path A (popover closed, then the Modal): `main=1`. Path B (the Modal closed from inside the popover): `main=2`, with 0 popovers left. On Android `mopen` stays 1: the dropped popover reports no close. |
| 5 | Lifetime | **met** | **met** | **iOS:** 50 cycles leave `live=0`, `controllers=0` and `windows=0`, with touchRoots 0→0. A drop at 0, 50, 100 or 150 ms into the entry leaves all zeros. Three recycle rounds take the counter 24→27, and the closed rounds show `presented=0`, `presentCount=0` and `children=0`.<br>**Android:** `live=0`, `roots=0` and `lifecycleObservers` 9→9 after the cycles and after every drop. The recycle counter goes 20→23. |

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1752 tests / 70 suites | `240e6428729c` | 1 m 57 s | start 5.8 / med 8.7 / max 10.7 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:PopoverProto` | **FAIL** | 1 failed of 9 tests / 1 suites | `0e5d24e14c8d` (android tree) | 37.6 s | start 2.8 / med 2.9 / max 3.3 |
| `harness:ios:PopoverProto` | **FAIL** | 1 failed of 9 tests / 1 suites | `0e5d24e14c8d` (ios tree) | 1 m 38 s | start 3.2 / med 3.1 / max 3.4 |
| `real-input:android:--control:s5-popover:--control:s5-keyboard:--control:s5-modal` | **PASS** | — | `34d84ff6af54` (android tree) | 12 m 44 s | start 12.9 / med 3.6 / max 12.9 |
| `real-input:ios:--control:s5-popover:--control:s5-keyboard:--control:s5-modal` | **PASS** | — | `0e5d24e14c8d` (ios tree) | 7 m 33 s | start 2.7 / med 4.6 / max 8.4 |

The one failure in each `PopoverProto` run is the last test, "prints every number the tests above measured". It fails
by design: the harness keeps a test's output only when it fails, so this test carries the Q1 and Q5 numbers into the
failure excerpts:
- `docs/tasks/S5/failures/2026-11-06T03-21-32Z--harness+ios+PopoverProto--01.log`
- `docs/tasks/S5/failures/2026-11-06T03-23-25Z--harness+android+PopoverProto--01.log`

The other 8 tests pass. `need --for review` asks for the full `harness:ios` and `harness:android` runs. They were not
run: this prototype is never merged, and the brief's gate is `check`.

## Red proofs

- Q1 oracle, the harness test "sees a resize when the size arrives after the present": `sizeBeforePresent=false`. It
  went red on iOS (`ok=0 sizes=320x480,320x124`) and on Android (`ok=0 drawSizes=840x126,840x359`). This runs on
  every pass.
- Q5 harness tests, Android: `releaseRoot` skips `liveRoots.decrementAndGet()`. It went red with `"cycles" never
  reached nothing left after 50 cycles; … roots=61`: 7 of 9 failed (`docs/tasks/S5/failures/2026-11-06T03-32-06Z--harness+android+PopoverProto--01.log`). Then reverted.
- Q5 on iOS, and the real-input "exactly once" counts: no mutation was run.

## Files changed

- Prototype:
  - `src/spike/PopoverProto/*`
  - `ios/spike/PopoverProto/HybridNitroUiPopoverProto.swift`
  - `android/…/HybridNitroUiPopoverProto.kt`
  - `android/…/NitroUiPopoverProtoViewManager.kt`
  - `nitro.json`
  - `nitrogen/generated/**`
  - `NitroUiPackage.kt`
  - `scripts/{patch-nitrogen,registry-core}.mjs`
  - `etc/package-files.txt`
- Tests:
  - `example/__tests__/PopoverProto.harness.tsx`
  - `example/src/PopoverProtoScreen.tsx` and its `App.tsx` tab
  - `RealInputTests.swift` (`testRealInputS5*`)
  - `scripts/real-input/{android,controls}.mjs`
  - `scripts/__tests__/{patch-nitrogen,real-input-tab-targets}.test.js`
  - `src/__tests__/viewConfigs.test.ts`
- Evidence: `docs/tasks/S5/` (`gates.jsonl`, `failures/` and `shots/`).

## Follow-ups

- Harness: a passing run drops console output, so evidence needs a test that fails on purpose.
- iOS real input: `typeText` drops characters on a controlled `TextInput` (`abc` → `a`/`ab`), while per-key taps
  land. Autocorrect also rewrote `axyz` → `acts` on blur.
- Android AVDs: they have a hardware keyboard, so Q3 against a full soft keyboard needs a `hw.keyboard=no` device.
- Popover: following an anchor that moves (scroll or rotation) while it is open was neither built nor measured.
- Popover: a content resize while open is not wired (`preferredContentSize` and the Popup size update).
- Example: the RN dev warning banner covers the screen's bottom controls (the S5 screen pads by 200).

## Questions for orchestrator

1. **The Android keyboard.**
   - (a) Ship the popup documented as covered by the IME.
   - (b) Make the position provider IME-aware (`WindowInsets.ime`) and test it on a soft-keyboard AVD.

   **Recommend (b).** It is a small change in the provider, and iOS already moves the popover.
2. **A popover dropped while it is presented** (for example when its Modal closes).
   - iOS reports `onIsPresentedChange(false)`.
   - Android reports nothing.

   **Recommend:** make both follow BottomSheet's drop rule, whichever it is, and test it on both platforms.
3. **iOS entrance.** The layout size is final from the first frame, but UIKit's zoom-and-fade scales the popover in. I
   counted that as met: it is not a resize.

   **Recommend:** accept it, since it is the system popover. Otherwise, add a prop that presents with
   `animated: false`.
