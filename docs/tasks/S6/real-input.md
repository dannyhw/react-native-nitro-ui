# S6 — real input into the Form prototype

Questions 4 and 7 of Q10 Appendix E ask for taps the **operating system** synthesised, not the
in-app events `react-native-harness` delivers by tag: a reparented iOS cell or a Compose shape
behind a row only has to satisfy the platform's own hit-testing. The case under test is
`example/__tests__/FormTouch.harness.tsx`; this file is the driver and the transcript.

## Android — driven, `adb shell input tap` (real input)

Device: the lease's `emulator-5570` (pair-b, `nitroui_b`), addressed by serial with the lease's
private adb server. Nothing else on the bus was touched.

```
export ANDROID_SERIAL=emulator-5570 ANDROID_ADB_SERVER_PORT=5041
```

`FormTouch.harness.tsx` logs each target's window rect with `measureInWindow` (`S6 GEOM …`, in
dp, and Android's JS console reaches logcat). The driver reads those lines back and taps the
centre of each, converted at the device's own density — it never hard-codes a position:

```
adb -s $ANDROID_SERIAL logcat -d -s "ReactNativeJS" | grep "S6 GEOM"
S6 GEOM outside=0,0,411,48
S6 GEOM rowA=16,67,40,19
S6 GEOM inner=28,255,83,32
S6 GEOM switch=58,285,52,48
adb -s $ANDROID_SERIAL shell wm density   # 420 -> density 2.625
```

```js
// 12 rounds of: adb -s $ANDROID_SERIAL shell input tap <x> <y>   (250 ms apart)
// density 2.625   outside -> 539,63   rowA -> 95,201   inner -> 182,711   switch -> 221,811
```

Twelve taps per target, because ten is the go line and two are slack for a tap the emulator
drops. The counters the app echoes back:

```
S6 REALINPUT driven rows=20 pressable=10 switches=10 outside=10 taps=20 orphans=0 where=inplace
```

`rows=20` is more than twelve because the row's own press also fires for the tap that landed on
its content. The assertion in `FormTouch.harness.tsx` requires at least ten of each, at least one
`Switch` change reported as `true`, and `orphans=0`; it recorded green inside the full
`harness:android` run and as `harness:android:FormTouch:FormTouch`.

The same case on the **pre-fix** tree, driven the same way, is what found the Android bug:

```
expected 'outside=43 rows=0 pressable=0 …' to be 'all ten'
```

Every tap landed on the Compose chrome host instead — see
`NitroUiFormSectionView.addReactChild`.

## iOS — NOT driven

There is no iOS transcript. `xcrun simctl` has no touch injection, and the only OS-level channel
in this repo is XCUITest (`scripts/real-input/ios.mjs`), which needs a session of its own: while
the harness's iOS runner is driving the app, a second automation session replaces it and the run
dies (`AGENT_DEVICE_RUNNER_MAIN_THREAD_WORK_ABANDONED`). The repo's own channel for this is
`real-input:ios`, whose cases are registry-driven over the example app's screens
(`scripts/real-input/screens.mjs`) — and `Form` has no example screen, so it does not reach the
prototype. Adding one is a round of its own. **Question 4's iOS taps are therefore unmeasured**,
and the iOS press path introduced this round (`NitroUiFormRowCell.pressGesture`) has no positive
evidence yet; what is measured on iOS is the negative half (a row's measured box is wrong, so
harness-aimed taps reach nothing — asserted in `Form.harness.tsx`).
