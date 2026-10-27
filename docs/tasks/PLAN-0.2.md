# 0.2 plan (D22 scope)

Fixed scope: Picker, DatePicker, Android over-wide content fix, opt-in Android `<Host>` (Switch
first, then the rest), iOS mount profiling, and (D23) an iOS `<Host>` spike — shipped if better. Per task: 1 impl + ≤ 2 fix rounds
(D19); spikes and profiling get one round. Stories for every new component (Storybook, S1).

| Wave | Task | Platform | Depends on |
| --- | --- | --- | --- |
| 1 | **C1** Android over-wide intrinsic content fits its box — merged | Android | A1 |
| 1 | **P1** iOS mount-cost profiling (one round, decides iOS `<Host>`) — done | iOS | A1 |
| 2 | **G6** Picker (`menu` / `wheel`) — merged | both | C1 |
| 2 | **G5** DatePicker (brief refreshed 2026-10-25) — merged | both | C1 |
| 3 | **H1** Android `<Host>` for Switch — merged, shipped in 0.1.0 | Android | C1 |
| 3 | **H2a** Host for Slider, Progress, Button + N4 (brief `H2a-host-more-controls.md`) — merged, shipped in 0.2.0 | Android | H1 |
| 3 | **H2b** Host for SegmentedControl, Picker, DatePicker (popups/dialogs) — merged, versioned as 0.3.0 | Android | H2a |
| 3 | **T17** iOS `<Host>` spike — done, report merged | iOS | A1c |
| 3 | ~~**H3** iOS `<Host>`~~ — not built: T17 failed D23 (memory better, mount/unmount UI CPU worse) | iOS | — |
| 4 | ~~**R3** 0.2 readiness: docs, stories, smoke, baselines refresh, changelog~~ — superseded: releases go through Changesets and staged npm publishing (D27, D28), which is how 0.2.0 shipped. Still open from it: a quiet re-run of the H2a/H2b Host benches (both runs are indicative) | both | all |

Device pairs: superseded by the lease pool (`scripts/lease.mjs`, X1), which hands each task a
simulator/emulator pair and its ports; `node scripts/doctor.mjs --setup` creates the pairs.
