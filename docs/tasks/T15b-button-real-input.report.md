# T15b — Button in the real-input suite + the Slider mid-write test: report

**Branch:** `task/T15b-button-real-input` (from `main` at `7f9b03c`) · **Devices:**
iPhone Air `331EF109-21DD-422B-AEF8-DFFFC6998DC3`, AVD `nitroui_t02`
(`emulator-5572`, adb server 5042), Metro 8294 — all booted by hand for this task
and shut down at the end · **Platforms:** both.

## Verdict

Both halves are done, and the one the brief said might stop the task did not:

1. **Button is in the real-input suite, and it is green on both platforms.** A real
   OS tap does reach the hosted SwiftUI `Button`'s `onPress`: XCUITest taps it, and
   the app renders a press count of 1, then 2; a real tap on the disabled Button
   leaves the number where it was. So G2's open question — a SwiftUI `Button` that
   ignored `react-native-harness`'s HID-less touch — was a **harness** limitation
   and not a library bug: with a touch that starts outside the app, the control
   answers. Nothing in the library was patched, and no blocker evidence
   (screen recording / hierarchy dump of a tap that went nowhere) was needed,
   because there was no such tap to capture.
2. **`Slider › finishes a drag that a write from JS lands inside` no longer asserts
   one outcome of a three-outcome race**, and is green on both platforms. It is
   still a test that can fail: three mutations of it go red on both platforms,
   including the one where `onSlidingComplete` never fires.

Gates: `bun run check` green; Slider and Button harness suites green on both
platforms (21 + 12 each); `test:real-input:ios` and `test:real-input:android`
green for **all three** controls. The iOS Switch check, which T15 left red pending
FIX2, **passed** here — `449524f fix(sizing)` is on this branch, and the check
that needed it is the one that was red.

## 1. Button in the real-input suite

| Path | What changed |
| --- | --- |
| `example/src/ButtonScreen.tsx` | additive "Real input" block, first on the page: enabled `Button` (`testID="real-input-enabled"`), disabled `Button` (`testID="real-input-disabled"`), both wired to one counter, echoed by `Text` `testID="real-input-count"`. Nothing existing moved or changed. |
| `scripts/real-input/controls.mjs` | the `button` entry, and the `screen` typedef widened to name the third tab |
| `scripts/real-input/android.mjs` | `CHECKS.button`, `ECHO.buttonCount`, `goToScreen` for three tabs, and `requireEchoToStay` (the negative needs a window, not an instant) |
| `example/ios/NitroUiExampleUITests/RealInputTests.swift` | `Tab.buttonTab`, `Echo.buttonCount`, `func testRealInputButton` |
| `scripts/real-input/ios.mjs` | usage line: `--control switch|slider|button` |

Two decisions worth keeping:

- **Both Buttons share one counter**, and the enabled one is tapped again after
  the disabled one. `onPress` is passed to the disabled Button too, so "it did not
  fire" can only be shown by a number that could have moved; and a counter that
  had stopped rendering would satisfy that check forever, which the third tap
  rules out. `requireEchoToStay` watches for 1.5 s rather than reading once, so
  the claim is "nothing moved during that window", not "one sample looked
  unchanged".
- **The block is first on the page on purpose.** `uiautomator dump` lists no
  off-screen nodes, so a control near the bottom of a scrolling screen gives the
  Android driver nothing to aim at. Measured: the enabled Button occupies
  `42,792 → 332,897` and the disabled one `42,939 → 486,1044`.

### Results

```
real-input (ios):     switch PASS · slider PASS · button PASS   → 3/3
real-input (android): switch PASS · slider PASS · button PASS   → 3/3
```

iOS `testRealInputButton` passed in 24.7 s; Android's four button lines:

```
✓ the Button starts with no presses recorded — expected 0, saw 0
✓ one real tap on the enabled Button reaches onPress — expected 1, saw 1
✓ a real tap on the disabled Button does not press it — expected 1, saw 1
✓ a second real tap presses the enabled Button again — expected 2, saw 2
```

### The checks can fail (mutations, both platforms)

| Mutation | iOS | Android |
| --- | --- | --- |
| A — expect `2` after the *first* tap | red: `("1") is not equal to ("2")` | red: `timed out waiting for a real tap to reach onPress (real-input-count="2")` |
| B — drop the `disabled` prop so the second Button is really enabled | red at the refusal line: `("2") is not equal to ("1")` | red: `real-input-count went to "2" when it should have stayed "1"` |

A is red on the enabled tap, B is red on the *disabled* one, so each half of the
check is separately load-bearing. B is the mutation that matters most: it changes
only the app, not the check, and both platforms noticed.

The two coverage guards were re-armed and confirmed too: a `CHECKS.bogus` key on
Android and a `func testRealInputToggle` on iOS each make that platform's runner
refuse the run rather than skip it.

## 2. The Slider mid-drag write test

`example/__tests__/Slider.harness.tsx:857` (main) asserted, per round:

- `events.start[before]` **is** the previous round's release value, and
- the release is `0.8` (drag target) or `0.5` (the app's write).

The second one is where main's failure comes from (`expected 0.5 to be 0.8`), and
both are one of three endings rather than the only one. The comment above the test
already documented two — a write refused while a sample is pending (the drag
wins), and a write accepted with nothing pending (the app takes the thumb, §11) —
but there is a third: **a refused write is not dropped**, so once the pending
sample is emitted the write is judged on the count alone and can land *after* the
release was reported. Then the thumb the next drag begins from is the app's value,
not the value the last drag reported; and if the commit is delivered late enough,
even the *first* release can be the value React mounted with.

Measured for this task (iOS, real 8 × 55 ms gesture timing, probe since removed):
`1st release=0.2 · 2nd beganFrom=0.2 · 2nd release=0.2 · prop=0.5 · next
beganFrom=0.5` — a post-release write does move the thumb, so "the next drag
begins from what the last one reported" is not the contract. Main's assertion is
also timing-dependent rather than simply wrong on this machine: run as-is, main's
test passed on both platforms here (`21 passed` × 2) and went red only once the JS
commit was delayed (`sleep(700 + attempt * 120)`, i.e. a busy JS thread):
`expected [ 0.5, 0.8 ] to include 0.2`. That is the shipped `expected 0.5 to be
0.8` family of failure — a real flake, and the reason to fix it here.

### What it asserts now

Per round, five rounds, write injected at a different offset into the drag each
time — the things that must survive *every* legitimate ending:

- the gesture **ends**, with `onSlidingComplete` firing **exactly once**
  (`expect(events.complete.length).toBe(before + 1)`);
- one `onSlidingStart` per end;
- the value it began from ∈ `{previous release, the write}` (round 0: the mount
  value — no write exists yet);
- the value it stopped on ∈ `{0.8, 0.5}` (round 0 also allows the mount value,
  because a commit delivered after the release leaves React's last committed
  value as the answer);
- every change on the step grid, and the frame pump disarmed;
- afterwards a clean drag still ends where it was dragged to (`0.3`), beginning
  from one of the two values the last round could have left on the thumb.

The header comment names the three endings and points at where the race is
actually gated: `scripts/native-tests/handshake.test.swift:117-151` and
`android/src/test/java/com/margelo/nitro/nitroui/core/NitroUiControlledValueTest.kt:116-147`.

### It is not a test that cannot fail

| Mutation | iOS | Android |
| --- | --- | --- |
| M1 — `onSlidingComplete` records nothing | red | red |
| M2 — the release reports twice | red: `expected 2 to be 1` | red: `expected 2 to be 1` |
| M3 — JS writes `0.7`, a value nobody legitimately holds | red: `expected [ 0.8, 0.5, 0.2 ] to include 0.7` | red: `expected [ 0.8, 0.5, 0.2 ] to include 0.7` |

M1 is the one the brief asked for; its message is the test's own:

```
Attempt 0: no onSlidingComplete after a mid-drag write
(start=[0.2] change=[0.3,0.4,0.4,0.5,0.6,0.7,0.7,0.8] complete=[]).
```

A dead-end attempt fails on the `pollUntil` before any assertion is reached, so a
release that never arrives is still loud. An earlier attempt at a third mutation —
changing the `written` constant itself — stayed green, and correctly so: the
accepted sets are derived from that constant, so moving it moves the goalposts.
M3 injects the out-of-set value through the app instead, which is the shape that
matters.

## Gates

| Gate | Result |
| --- | --- |
| `bun run check` | green (exit 0, final tree) |
| Slider harness — iOS / Android | 21 passed / 21 passed |
| Button harness — iOS / Android | 12 passed / 12 passed |
| `bun run test:real-input:ios` | 3/3 (switch, slider, button) |
| `bun run test:real-input:android` | 3/3 (switch, slider, button) |

Commands used, with the task's devices:

```sh
IOS_UDID=331EF109-21DD-422B-AEF8-DFFFC6998DC3 METRO_PORT=8294 bun run test:real-input:ios
ANDROID_AVD=nitroui_t02 ANDROID_SERIAL=emulator-5572 ANDROID_ADB_SERVER_PORT=5042 \
  METRO_PORT=8294 bun run test:real-input:android

# harness suites (example/)
IOS_SIM_UDID=331EF109-… METRO_PORT=8294 HARNESS_APP_PATH=$PWD/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app \
  bunx react-native-harness --harnessRunner ios Slider   # and Button
ANDROID_AVD=nitroui_t02 ANDROID_ADB_SERVER_PORT=5042 ANDROID_SERIAL=emulator-5572 METRO_PORT=8294 \
  HARNESS_APP_PATH=$PWD/android/app/build/outputs/apk/debug/app-debug.apk \
  bunx react-native-harness --harnessRunner android Slider   # and Button
```

Logs are in `.real-input/` (gitignored): `final-ios.log`, `final-android.log`,
`final-check.log`, `harness-*-final.log`, `mutation-{A,B}-*-{ios,android}.log`,
`mutation-M{1,2,3b}-*.log`, `slider-main-failure-ios.log`.

## Follow-ups (not touched here)

- **`scripts/real-input/support.mjs:103` crashes when the runner owns Metro.** If
  the script starts Metro itself, tearing it down throws
  `ERR_STREAM_WRITE_AFTER_END` and the run dies after the checks. Pre-starting
  Metro on the port makes both runners print `reusing the server already
  listening on <port>` and finish cleanly, which is what every run here did.
  Harness runs are unaffected — `react-native-harness` picks the next free port
  itself (8295 when 8294 was occupied).
- `docs/tasks/STATUS.md` still describes T15's runner as Switch/Slider only and
  says "Button added after G2 merges". G2 has merged and the Button check is now
  in, so that row is stale; STATUS.md is the orchestrator's, so it was left alone.
- `react-native-harness`'s HID-less touch still does not reach a SwiftUI `Button`.
  This task does not fix that and does not need to — but a harness test that
  "passes" on a hosted SwiftUI Button tap proves less than the same test on
  Android, and the real-input suite is where that tap belongs.
