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
- Flaky Android `Sizing › sizes a control inside a Modal` (`corrections=0`), seen twice in G1 fix round 1, unreproducible after APK rebuild; T14 should try to reproduce (it touches fallback/first-measure timing).
- Harness fails on Node 26 with a misleading ESM error; `.nvmrc` pins 24 — document in CONTRIBUTING or fix.
- G1 Slider verifier follow-ups (8 items) are listed in docs/tasks/G1-slider.report.md "Follow-ups".
- Transient iOS harness `app heartbeat timed out` on Sizing.harness (FIX1, re-run green).
