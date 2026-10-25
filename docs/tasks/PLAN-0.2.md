# 0.2 plan (D22 scope)

Fixed scope: Picker, DatePicker, Android over-wide content fix, opt-in Android `<Host>` (Switch
first, then the rest), iOS mount profiling to decide an iOS Host. Per task: 1 impl + ≤ 2 fix rounds
(D19); spikes and profiling get one round. Stories for every new component (Storybook, S1).

| Wave | Task | Platform | Depends on |
| --- | --- | --- | --- |
| 1 | **C1** Android over-wide intrinsic content fits its box | Android | A1 |
| 1 | **P1** iOS mount-cost profiling (one round, decides iOS `<Host>`) | iOS | A1 |
| 2 | **G6** Picker (`menu` / `wheel`) | both | C1 |
| 2 | **G5** DatePicker (brief refreshed 2026-10-25) | both | C1 |
| 3 | **H1** Android `<Host>` productionised for Switch, D17 rule for hosted controls | Android | C1 |
| 3 | **H2** Host support for Slider, Progress, Button, SegmentedControl, Picker, DatePicker | Android | H1, G5, G6 |
| 3 | ~~**H3** iOS `<Host>`~~ — dropped: P1 no-go (iOS cost is the synchronous first measure, not hosting) | iOS | — |
| 4 | **R3** 0.2 readiness: docs, stories, smoke, baselines refresh, changelog | both | all |

Device pairs: nitro-ui owns iPhone 17 + `nitroui_t01`; iPhone Air + `nitroui_t02` are lent to the
RN Storybook fixes thread. Wave 2 needs a second pair (create one, or run G5/G6 in sequence).
