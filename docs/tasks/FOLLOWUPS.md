# Follow-ups (not blocking v0.1, see D19)

- Android D15 gap (UI CPU 1.35×, memory 2.52× vs expo-ui-shared-host): per-control composition cost; options in T12 report §P2f; T13 showed Compose owner services are already shared per window (one context for 50 controls), so the residual is each control's Composition + AndroidComposeView tree; the only remaining lever is an opt-in Expo-style `<Host>` container (public API, 0.2+).
- iOS Slider memory 1.42× expo-ui-shared-host (same one-host-per-control cost).
- Primed Android + iOS (iPhone 17) latency baselines (D18) — Phase 4.
- One-off check of declared fallbacks on an iOS < 26 runtime (none installed; D8).
- Compose-semantics accessibility queries in react-native-harness (Android a11y asserted View-level only).
- Modal instances lack perf marks (T11).
- T11 minor: initial environment signature clears cache once; ledger entries for never-mounted instances; report before any measure is dropped.
- `fillWidth` control in a parent with no finite width (horizontal scroller) keeps the last cached width, never corrected (G1 review).
- iOS mount `mounted`: per-instance UIHostingController creation (~0.46 ms each at N=50); profile before 0.2 (G1 review).
- iOS 18 CI row for declared fallbacks (release readiness).
- Was flaky Android `Sizing › sizes a control inside a Modal` (`corrections=0`), seen twice in G1 fix round 1 and once by T14 (1 in 3 runs of the same invocation). What is observed, precisely: the first-frame watcher records `drew` only when no report is queued, so the dialog's report arrived *after* its window's last draw — and Android's pre-draw flush is a request to be consulted at the next draw, not a request for one, so a report landing in an idle window left its correction `queued` until an unrelated redraw. (Not "pre-draw cancellation does not cover the second window" — at the frame that drew there was nothing queued to cancel.) Fixed in T14 fix round 1: when it schedules a flush the host also requests the draw that flush needs (`postInvalidateOnAnimation()` on the host, whose observer is the window the correction has to reach), the test waits for its own instance's `corrected` so unrelated activity cannot carry it green, and `scripts/check-sizing-flush-draw-request.sh` guards the request — which is the part that can be shown red on demand: measured in T14's report, an RN dialog always has at least one more traversal after a measure-driven report, so no arrangement of mounts and re-renders makes the harness fail without the fix (9 runs out of 9 passed with the request removed).
- `Slider › ignores a drag while disabled, and follows the flag back` is red on iOS on `main` since 381b1f2 (merged): the assertion tests Android-only probe text (`disabled=true`), and the iOS element's traits were `4096` = `.adjustable` with no `.notEnabled`, so the iOS half of that announcement may be missing rather than just unasserted. Gate it by platform and check the flag; found by T14.
- Harness fails on Node 26 with a misleading ESM error; `.nvmrc` pins 24 — document in CONTRIBUTING or fix.
- G1 Slider verifier follow-ups (8 items) are listed in docs/tasks/G1-slider.report.md "Follow-ups".
- Transient iOS harness `app heartbeat timed out` on Sizing.harness (FIX1, re-run green).
- Android: re-laying out an already-mounted control at a wrong guess produces no report (Compose doesn't re-measure when only the box moves); sizing.md's "every mounted instance is asked to measure again" is prospective there (T14).
- iOS Slider only answers drags that start on the thumb (T15); matches UISlider behaviour — document in slider.md, not a bug.
