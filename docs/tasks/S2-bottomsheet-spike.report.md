# S2 — React Native children in a natively presented bottom sheet

**Branch:** `task/S2-bottomsheet-spike` (from `main` at `8875dcb5`) · **Round:** 1 of 1 (D19 cap) ·
**Lease:** `S2-7bluv`, then `S2-g2lpi` (pair-a: iOS `49D5024D-967B-4B93-ACF6-F73BA0A19E9F` /
`emulator-5574` / Metro 8295).
The prototype is evidence only: this branch is never merged and nothing was pushed.

## Summary

**Q1 mount — GO on both.** RN children render inside a UIKit `.pageSheet` and lay out at the *sheet's*
width: `contentW=402` equals the box native reported and **no `.mm` patch is needed** —
Nitro's generated component already does `[self setContentView:view]`
(`nitrogen/generated/ios/c++/views/HybridNitroUiSheetProtoComponent.mm:70`). Android is the same
through a `DialogRootViewGroup` copy in Material 3's `ModalBottomSheet`: `box 411.43x240`,
`content 411.43x240`, `liveSheetRoots=1`.

**Q2 touch — GO on Android with a real finger, structurally on iOS.** `adb -s emulator-5574 shell input
tap 540 2046`, at app-published coordinates, pressed a `Pressable` in a sheet held **over an open RN
`Modal`**: `presses=1 after=33ms`, `sheetWindowFocused=1`. iOS cannot: the sheet's own `RCTSurfaceTouchHandler`
is what a finger would hit; there the witness is `hitTest` inside the content box, which resolves in the
sheet (`contentHitOwner=sheet`). A `ScrollView` gets the sheet's box on both (Android `medium` viewport
430 against `large` 797).

**Q3 `fit` — GO on both.** Two rows of 80 moved the sheet by exactly 160 on each (iOS `settledBoundsH`
+160; Android 240→400, `boundsChanges=1`), and a fresh `fit` sheet's first frame is its settled
height. Chrome must **not** be measured: the at-rest gate never fired (`chromeChanges=0`).
Re-`invalidateDetents()` on a content change is mandatory. In a window of its own on iOS the same change
moved the sheet by **0** — open item.

**Q4 lifecycle and leaks — GO on both.** iOS: 50/50 cycles, `closes=56`,
`liveControllers=0`, no `exitStuck`; the first leak was a per-sheet closure capturing the sheet. Android:
50/50 cycles, `liveSheetRoots=0`; memory grows +750 KiB/cycle (unattributed), so the object counter is
its leak witness.

**Q5 `Modal` — REPRODUCES on iOS, not on Android.** In the app's chain an RN `Modal` takes the sheet
(`inModalChain=1`) and closing it leaves the `Modal`'s host in a window (`modalHostsInWindow=1`,
`appMarkerOwner=modal`): G11's stuck `Modal`, authored by a sheet. From a window one level above alerts
the same close is clean (`inModalChain=0`, `windowLevel=2001`, `modalHostsInWindow=0`). Android's sheet
is a `Dialog` window already: nothing was dismissed (`unasked=0`) and it stayed up and focused
(`sheetWindowFocused=1`). Survivable only by whoever made the strand: RN does not hand the app back — a
second `Modal` closed over it leaves `appMarkerOwner=modal` — and the app returns when the sheet
that caused it is dropped and clears the leftover.

**Mechanism for G12:** on iOS, present from a window of its own above alerts (G11's
`NitroUiPresentation`, read with `git show`), root view not interactive, torn down with the
sheet. Android needs no equivalent.

## Gates

`node scripts/gate.mjs table`, pasted as it prints.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1641 tests / 62 suites | `3eab8129fc60` | 2 m 43 s | start 2.8 / med 9.9 / max 11.6 |
| `harness:ios` | **PASS** | 243 tests / 17 suites | `3eab8129fc60` (ios tree) | 5 m 31 s | start 2.8 / med 4.8 / max 11.6 |
| `harness:android` | **PASS** | 294 tests / 17 suites | `3eab8129fc60` (android tree) | 8 m 59 s | start 9.7 / med 3.7 / max 9.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:SheetProto` | stale | 10 tests / 1 suites | 1805c810d6d2 (not this tree) | 53.5 s | start 3.5 / med 3.4 / max 3.5 |
| `harness:ios:SheetProto` | **PASS** | 10 tests / 1 suites | `3eab8129fc60` (ios tree) | 1 m 48 s | start 3.9 / med 5.8 / max 12.4 |
| `harness:ios:SheetProto:--background` | stale | — | dd3653b40d5e (not this tree) | 1.0 s | start 8.0 / med 7.9 / max 8.0 |

Reading it:

- Both whole-suite rows are the final tree and both are green. `harness:ios` took 5 m 31 s against the
  41 minutes the same suite took while the in-chain `Modal` case left RN's host over the app and the 15
  files after it laid out at `0x0`: handing the app back is what turned that row green, so the
  survivability answer is a gate result and not only a measurement.
- `harness:ios:SheetProto` is the *filtered* spike suite, so the ledger is right that it satisfies
  nothing else. It is where the ten measurements live, and the run that shows the strand being released
  (`strandedReleaseRuns`, `strandedHostsReleased`, then `appMarkerOwner=app`, `modalHostsInWindow=0`).
- `harness:android:SheetProto` is stale on purpose: the Android half of every measurement is inside the
  green whole-suite row, which is also where the real tap ran (`presses=1 after=33ms`; an earlier run
  took 2.9 s — with a quick watcher the finger beats the test's own bookkeeping). `real-input:*` stay
  missing: the sanctioned host-side input on iOS is a registered XCUITest control, which a spike should
  not build (Questions 4), and Android's tap lives inside this suite instead.
- `harness:ios:SheetProto:--background` is a junk row from a run whose `--background` was placed after
  `--`, so the filter became part of the gate's name; it records one second of nothing.
- Three earlier `check` rows on this branch went red for reasons the branch caused, and each is a red
  proof below: `registry:check`, `test` (the view-config guard) and `manifest:check`.

## Changes to Q5's Appendix C

- **C2, mounting on iOS:** delete the `.mm` post-processing item. Nitro's generated component already
  sets `contentView`, so Fabric mounts the children into the hybrid's view and the sheet adopts them
  (`HybridNitroUiSheetProtoComponent.mm:70`). Keep the `RCTSurfaceTouchHandler` — but own it on the
  view controller, as `RCTFabricModalHostViewController` does, and detach it as the sheet leaves; an
  associated object on the attached view leaves a touch root behind (measured: `handlerViews=1` with
  `liveControllers=0`).
- **C2, layout:** the box→JS→`style` round trip is enough to be *correct* (a fresh `fit` sheet's first
  frame is already its settled height), so the `PresentedContainerShadowNode` is now a latency and
  robustness decision, not a blocker. Keep it. Keep the withheld-box test as the witness: without the
  box, the children are 0 wide.
- **C3, detents:** do not measure the sheet's chrome on iOS. The at-rest gate never fired
  (`chromeChanges=0`) and the sheet still settled at content + 34 pt, because UIKit clamps a custom
  detent up to include its own chrome — `fit` should hand over the content height. Re-`invalidateDetents()`
  whenever that height changes, and **never** re-apply `detents` on a close: React writes every prop on
  every render, so a close always arrives with a config write, and a sheet layout pass on the way out
  is a sheet that leaves its window.
- **C6, presentation:** replace "iOS presents from the modal's controller, which the responder chain
  reaches first" — that is the *unsafe* option. A `BottomSheet` presents from a window of its own one
  level above alerts (G11's `NitroUiPresentation`), whose root view is `isUserInteractionEnabled =
  false`, torn down with the sheet. Measured A/B: in-chain leaves RN's `Modal` in a window after it
  closes; own-window does not.
- **C6, dismissal:** a close may need one bounded retry (UIKit drops a present or dismiss issued to a
  busy chain silently — `presentQueued` exists because of it); a sheet inside someone else's chain gets
  **no** `presentationController*` callbacks when they tear it down, so the "exit was unasked" witness
  must not be `viewDidDisappear` alone in a multi-window app; and no closure stored on the sheet may
  capture the sheet — that cycle is what the leak probe caught.
- **C6, Android:** no escape is needed there, and measured rather than assumed — Material's sheet is a
  `Dialog` window, so an RN `Modal` opening over it and closing left the sheet attached, sized and
  focused with `unasked=0`. Android's `presentInOwnWindow` is inert, which also means the in-chain /
  own-window A/B is an iOS-only experiment and the suite says so on both arms.
- **C6, recycling:** a full reset must take the content view out of the dismissed sheet's view
  (`container.removeFromSuperview()`) and must not nil the JS handlers — the drop is delivered after
  the next mount's props.
- **C8, harness:** the frame sampler and the `presented`/`closed` events are load-bearing for three of
  the five questions, and neither platform had an Android equivalent when the first Android run timed
  out on all of them. Both now exist (`presented` from the first drawn frame, `closed` from the window
  going away, `exit-taken` from a window that went while React still wanted it up, a `Choreographer`
  height sampler). Material draws its own surface, so Android's `settledBoundsH` is the box the sheet
  gave its children, chrome excluded — the `fit` oracle is a difference, so the answer is the same
  number, but the two platforms are not reading the identical quantity and a shared harness must say
  so. Real input: `adb … input tap` at app-published coordinates works and is cheap (33 ms to 2.9 s);
  iOS's is XCUITest.
- **C8, harness (survivability):** reproducing the `Modal` hazard is not a harmless experiment. With the
  sheet presented in the chain, the run's later files lay out at `0x0` — 15 of the 16 other iOS suites
  did exactly that on the first full run — because RN leaves its `Modal` host over the app, the harness
  does not restart the app between files, and no second `Modal` cycle hands it back (every run still had
  the app under the leftover after one opened and closed). The spike therefore clears up its own strand
  when React drops the sheet that caused it — `strandedReleaseRuns`/`strandedHostsReleased` say so, and
  the app is back in the app's hands (`appMarkerOwner=app`, `modalHostsInWindow=0`) — which is why the
  whole suite passes. **A shipped `BottomSheet` must not copy that**: dismissing a controller it does not
  own is exactly the thing the own-window mechanism exists to avoid, so G12 still owes the hazard case an
  app instance of its own (Questions 6). The churn loop also needs `HARNESS_TEST_TIMEOUT` at 240 s or
  more: the default 30 s times it out mid-file, which is how an earlier full iOS run "passed" by never
  reaching the `Modal` cases.

## Red proofs

- `reports a box that never reached Yoga as a collapsed layout` -> `feedBox={false}` on the same
  fixture (the suite's built-in mutation) -> the sibling test's `content.width > 100` would be 0 wide.
- The leak -> a per-sheet closure capturing the sheet (`onExitTaken`) -> `survivedExit=5
  survivedUnpresented=5 survivedOffscreen=5` with `liveControllers=5`; fixed, the churn line now
  reads `releasedAfterExit=55 liveControllers=0`. This one is proven by a *committed* red run, not a
  throwaway mutation.
- The churn -> `countEvents` matching `':presented'` while events arrive as `s26:presented=1` ->
  `the first cycle did not complete: events=[s26:presented=1]` against a sheet that had presented
  and dismissed correctly; fixed, 50/50 cycles.
- Own window vs in chain -> the same file run twice (`presentInOwnWindow` on/off) ->
  `inModalChain=0, windowLevel=2001, modalHostsInWindow(after close)=0` against
  `inModalChain=1, windowLevel=0, modalHostsInWindow(after close)=1`. The A/B *is* the mutation: with
  the own window removed the suite's `Modal` case goes red on the stuck-`Modal` assertion.
- Who hands the app back -> `strandedReleaseRuns` left out of this suite's list of readable probe keys,
  so `num()` could not see it -> `dropping the sheet did not release the stranded Modal: … expected 0 to
  be greater than or equal to 1`, with the release path in the binary and the app coming back in the same
  breath: a counter that cannot be read reads as a counter that never fired, and the mechanism was
  deleted for it. Named in the list, the same assertion passes on the next run; without the mechanism the
  strand stays put — `the app did not come back after the stranded Modal: … expected 'modal' to be
  'app'`.
- Android's four "unmeasured" questions -> the Android sheet's only event was `user-dismiss` ->
  `No fit at 3 rows to be sampled within 10000ms. events=[] box={"width":411.43…}`; with `presented`,
  `closed`, `exit-taken` and the sampler added, the same tree is 10/10 there.
- The sampler itself -> a `fit` sheet's first frames have no height, and one empty frame ended
  sampling -> `No fit at 3 rows to be sampled … events=[s21:presented=1]` (presented, never sampled);
  fixed, `samples=98` and `settledBoundsH=400` after +160.
- The scroll viewport -> `until(() => p.viewport)` taking the *first* `onLayout` ->
  `the scroll viewport is not the sheet's width: … viewport=0x0` on Android, against a sheet 411 wide.
  Waiting for the number to hold still is what `p.content` already did.
- The spike's autolinked hybrid view -> `registry:check` red: `autolinking has NitroUiSheetProto and no
  manifest declares it`, and 11 of `registry.test.js`'s cases with it.
- The same view's generated config -> `viewConfigs.test.ts` red: `"NitroUiSheetProtoConfig.json"`
  present in nitrogen's output, absent from the copies — which also disproved a comment in the spike
  claiming that guard could not see it.
- A hybrid view whose sources are exported -> `manifest:check` red: `+src/spike/…` and 46 generated
  files `would be published (not in the manifest)`; `bun run manifest:update` refreshed the list, since
  the spike's `./spike` export has to resolve in a published tarball for the guard to be honest.
- `attachTouchHandler={false}` (the touch-handler arm) and the `atRest` chrome-measurement gate were
  **not** run as mutations this round — the first is out of the time budget, the second is now
  argued against by the measurement itself (`chromeChanges=0` with a correct sheet height).

## Files changed

- `ios/spike/SheetProto/HybridNitroUiSheetProto.swift`, `ios/spike/NitroUiSpikeTouchBridge.{h,mm}` —
  the UIKit sheet, both presentation mechanisms, the witnesses, and the release of a `Modal` host stranded by its own sheet.
- `android/src/main/java/com/margelo/nitro/nitroui/spike/*`, `HybridNitroUiSheetProto.kt` — the
  Material 3 sheet, `SheetRootViewGroup` and its `IViewGroupManager` redirect.
- `android/src/main/java/com/margelo/nitro/nitroui/spike/SheetProtoViews.kt` — the events, the
  `Choreographer` sampler and the app-window probes described above.
- `src/spike/SheetProto/*`, `nitrogen/generated/**` — the spike component and its generated spec.
- `example/__tests__/SheetProto.harness.tsx` — the ten measurements, the survivability case, and the list of probe keys a witness has to join to be readable.
- `scripts/registry-core.mjs`, `src/__tests__/viewConfigs.test.ts` — the two places the registry and
  the config guard had to *name* a hybrid view that owns no component.

## Follow-ups

- `react-native-harness` 1.6: `console.log` from the app never reaches an iOS gate log
  (`forwardClientLogs` ignored), so every iOS number has to ride inside an assertion message.
- `gate.mjs harness:ios` reports "Failed to load configuration file" when the real cause is a stale
  `app.stamp`.
- The spike's `ownWindows` counter is process-wide, so a leaked sheet's late exit can drive it down
  while another sheet's window is still up.
- A harness suite reads only the probe keys it names in its own list, and a native counter missing from
  that list is silently invisible — `num()` answers with its default instead of failing. A new witness
  has to be named twice, in the native code and in the suite; this spike drew one wrong conclusion from
  that before it was caught.
- `scripts/s2-device-log.sh` is dead weight from an earlier round.
- Android's memory figure grows +750 KiB per present/dismiss cycle (`Debug.getPss` + Java heap + native
  heap) while `liveSheetRoots` returns to 0. Unattributed: ART and PSS are not iOS's `phys_footprint`,
  and this spike has no Android heap-walk. G12 owes a leak gate that compares two cycle counts before
  reading a slope.
- The spike's two callbacks are optional props (`onSheetEvent?`), against the repo's nitro#1184 rule.
  They did arrive on both platforms in this Nitro version — the Android events in the summary above rode
  through that prop — but the shipped component should still use `T | null` and always send every prop.

## Questions for orchestrator

1. **`fit` inside a window of its own does not follow its content** (+160 pt of rows moved the sheet
   by 0 pt; the same fixture in the app's own window grew by exactly 160). Options: (a) G12 presents
   in the app's chain and only *escalates* to a window when an RN `Modal` is open — recommended,
   because it keeps `fit` on the path that measured correct and the `Modal` case is the rare one;
   (b) ship the window always and spend a round on `invalidateDetents()` from a foreign window;
   (c) ship `fit` as `large` on iOS when a `Modal` is open. My recommendation is (a) with (c) as the
   fallback G12 can choose per-detent.
2. **A view leaving the screen is not an exit** — `viewDidDisappear` as an "exit taken" witness made
   this spike release its own window under a live sheet (`windowLevel=-999` while `presented=1`).
   Recommend the component infer unasked exits from `presentationControllerDidDismiss` /
   `isBeingDismissed` only. Needs a decision for the shared presentation helper, so it is not mine to
   make here.
3. **react-native-screens was never measured**: it is not a dependency of the example app
   (`example/package.json`), so the "inside a react-native-screens stack" half of question 5 is
   untested. Options: (a) accept it and put the case in G12's harness plan; (b) a fix round that adds
   `react-native-screens` to the example app. Recommend (a) — it is a second spike's worth of surface.
4. **iOS real input** is the one arm left: the sanctioned path is XCUITest with a registered control,
   which a spike should not build. Android's real tap is done and passed. Is iOS structural evidence
   enough to green-light the mechanism, or does G12 owe an XCUITest control of its own?
5. **A host-sent Android tap can dismiss the *next* fixture's sheet.** An earlier Android run showed
   `user-dismiss=1` on a sheet under an RN `Modal`, which read like a mechanism finding; the final run
   shows `unasked=0` and the sheet alive. The difference is my own hand: the tap is sent from outside
   the suite, and in the earlier run it arrived after that suite had moved on, onto a scrim. Two ways
   to keep that honest — (a) the runner waits for the coordinates the app publishes (the last two runs
   did exactly that, and 10/10 followed), or (b) the Android real tap moves into `real-input:android`,
   where the control is registered and the timing is the gate's. **Recommend (b) for the build**, since
   a BottomSheet is exactly the component whose scrim punishes a mistimed tap.
6. **The hazard case needs an app instance of its own, because the only thing that reliably clears it is
   something a shipped sheet must not do.** The in-chain case leaves RN's `Modal` host over the app and RN
   never dismisses it: on the first full suite run the 15 files after it reported `0x0` layouts, and a
   second `Modal` opening and closing never handed the app back. What did hand it back was the prototype
   dismissing that leftover host from the dropping sheet's teardown — which works (`strandedReleaseRuns`,
   `strandedHostsReleased`, `appMarkerOwner=app`) and is a spike privilege, not a component behaviour: a
   `BottomSheet` that dismisses view controllers it does not own is worse than the bug. Options: (a) G12
   reproduces the stuck-`Modal` case in an app instance of its own — a gate run whose file list is that
   case alone, which is how this spike measured it (**recommended**); (b) the harness grows a
   restart-the-app step between files, which `react-native-harness` does not offer today; (c) rely on the
   hazard file sorting last, which jest's cached ordering will not promise. Recommend (a). The build answer
   is unaffected and is the recommended mechanism: never enter the chain, so never strand anything.
