# F7 — Quick taps on a hosted control in a busy screen are dropped (iOS)

**Branch:** `task/F7-quick-tap` (from `main` at `3dfe041`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `F7-p6svp` (pair-b: iPhone Air / `nitroui_b` · Metro `8293`) — the earlier half of the
measurements were taken on lease `F7-fnto8` (pair-a), which expired mid-run.

## Summary

**The drop is real, it is not ours, and no library patch is proposed.** On the shipped Switch
screen (200 hosted Switches in a `ScrollView`) a 50 ms press arrives **0–1 times in 12**. Every
number below is 12 presses at 50 ms unless stated, with `load1` recorded.

**It is not the probe.** `--quiet` reads its witness twice instead of polling it, so no
accessibility traffic enters the app between presses: hosted Switch **0/12**, React Native's own
`Switch` on the same screen **0/12**, RN's `Pressable` **12/12**, positive control **12/12**
(load 1.8 / 4.8 / 3.8). Both are read as a JS event count, so the loss is visible through JS's own
render.

**Whose it is.** `RCTScrollViewComponentView.mm:145` already sets `delaysContentTouches = NO`, so
the brief's experiment 1 was moot; measured anyway — `canCancelContentTouches=false` **0/12**,
`scrollEnabled=false` **0/12**, no `ScrollView` at all **0/12**. The list is the variable: remove it
**12/12**; keep its geometry and swap the 200 hosted Switches for plain boxes **12/12**; swap them
for **RN's own** 200 Switches **0/12**. Button and SegmentedControl take the press **12/12** on
their 200-row screens and inside a `<Host>`. A plain SwiftUI `Toggle` in a `UIHostingController`
inside a bare `UIScrollView`, no React Native in the process, is **12/12** in all four shapes.

**The mechanism, reproduced.** `--stall <ms>` blocks the no-RN window's main thread on every
run-loop pass, and the window publishes the longest block it actually performed
(`measured-max=122ms`). Toggle rows, acted/12: no stall **12**, 40 ms **4**, 80 ms **0–1**, 120 ms
**0**, and the scroller is not required (the `view` shape drops too). In the same launches a
`UITapGestureRecognizer` on the very view whose Toggle never acted fired **12/12**, so the press is
hit-tested and recognised and what is lost is delivery to the control. A plain `UIButton` in the
same scroller under the same stall takes them all, **12/12** — the arm's first version of this cell
said otherwise and read the wrong counter (see Follow-ups). Android is not affected: 5 / 20 / 50 /
100 ms all **12/12**, control 3/3 (load 3.8–5.2).

**Guard.** `testRealInputSwitch` now also delivers twelve presses once each with no retry and
asserts all twelve moved the control, and asserts the 200-row list is mounted first. `pressDwell`
stays **0.15**: nothing was fixed, and the measured boundary is between **80 ms (0/12)** and
**100 ms (12/12)**.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1161 tests / 45 suites | `eada65983c29` | 2 m 36 s | start 3.3 / med 3.6 / max 7.5 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `eada65983c29` (ios tree) | 2 m 09 s | start 2.7 / med 3.2 / max 4.0 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `2d6b9f063bea` (android tree) | 6 m 13 s | start 3.3 / med 3.7 / max 7.3 |
| `real-input:ios` | **PASS** | — | `eada65983c29` (ios tree) | 10 m 56 s | start 3.7 / med 4.5 / max 21.5 |
| `real-input:android` | **PASS** | — | `2d6b9f063bea` (android tree) | 15 m 14 s | start 1.5 / med 2.7 / max 5.7 |

The two Android rows sit on the earlier tree because everything committed after it
touches iOS and docs only, and `gate.mjs` matches a device run against that
platform's half of the tree.

`real-input:ios:--control:switch` — the guard's red proof — is in the ledger as three `FAIL`s and
one `PASS`: two at the mutated trees (the global-dwell mutation, then the guard-only mutation that
produced the line quoted under Red proofs), one at the guard mutation as well but for an unrelated
cause (the lease expired mid-run and the app never rendered), and the `PASS` after the revert.
`gate.mjs status` prints the row `stale` above because a mutation run is not evidence about the
committed tree by design.

`need --for review`: `need: review is satisfied on this code tree.`

## Measurements

Calm and loaded, same cells (50 ms, 12 presses, quiet where the witness is a count). Cells taken
at `load1` ≥ 8 were re-measured on an idle machine; none moved.

| Cell | loaded | calm |
| --- | --- | --- |
| busy screen, hosted Switch (native value) | 0/12 (`6.48`) | — |
| busy screen, hosted Switch, quiet | 0/12 (`8.75`) | 0/12 (`1.81`) |
| busy screen, RN's own `Switch`, quiet | 1/12 (`10.62`) | 0/12 (`4.80`) |
| busy screen, RN's `Pressable`, quiet | 12/12 (`8.96`) | 12/12 (`3.78`) |
| busy screen, controlled Switch read through its echo | 1/12 (`10.24`) | 1/12 (`3.98`) |
| 200-row list removed | 12/12 (`3.59`) | 12/12 (`5.50`) |
| 200 plain boxes instead of hosted Switches | 12/12 (`8.07`) | 12/12 (`4.76`) |
| 200 RN `Switch`es instead of hosted ones | 0/12 (`2.99`) | 0/12 (`4.66`) |
| no `ScrollView`, 200 hosted Switches still mounted | 0/12 (`3.50`) | 0/12 (`4.15`) |
| a Switch *inside* the 200-row list | 1/12 (`13.42`) | 1/12 (`4.36`) |
| Button / SegmentedControl, own 200-row screens | 12/12 / 12/12 | 12/12 / 12/12 |
| Button / Segmented / Switch inside a `<Host>` | 12/12 / 12/12 / 12/12 | same |
| no-RN, `scroll`, 200 rows | 12/12 (`7.59`) | 12/12 (`3.60`) |
| no-RN, `scroll-rn` (RN's own scroll config) | 12/12 (`4.29`) | 12/12 (`5.93`) |
| no-RN, `view` (no scroller), 200 rows | 12/12 (`4.87`) | 12/12 (`4.45`) |
| no-RN + 120 ms stall, Toggles, `view` | 0/12 (`152.7`) | 0/12 (`2.48`) |
| no-RN + 120 ms stall, Toggles, `scroll` | 0/12 (`12.28`) | 0/12 (`2.73`) |
| no-RN + 120 ms stall, plain `UIButton` in the scroller | 0/12 (wrong witness) | **12/12** (`2.17`) |

Ladder on the busy screen, hosted Switch, quiet: **0.08 s 0/12 · 0.10 s 12/12 · 0.12 s 12/12**
(controls 12/12, load 4.2 / 5.5 / 6.3). No-RN stall ladder, Toggle rows acted/12: **12 · 4 (40 ms) ·
0–1 (80 ms) · 0 (120 ms)**. The 40 ms and 80 ms cells have recognisers attached and fired 8 and 12
(calm: 11) in those launches; the 120 ms recogniser figure, 12, comes from the two `--rescue` cells,
since a cell without that flag has no recogniser to count.

Android, same busy screen and same counting witness (`probe-hosted-events`), press length set by
`input swipe x y x y <ms>` at zero distance, because `input tap` has no dwell knob:

| Press length | Hosted Switch delivered | RN `Switch` (control) | load1 |
| --- | --- | --- | --- |
| 5 ms | 12/12 | 3/3 | 5.15 |
| 20 ms | 12/12 | 3/3 | 3.80 |
| 50 ms | 12/12 | 3/3 | 4.34 |
| 100 ms | 12/12 | 3/3 | 4.58 |

**Negative result, kept because it contradicts the obvious story.** `--watchdog` measures main-queue
latency (a background timer offers a block every 20 ms; the log records when it runs). The busy RN
screen: median **85 ms**, p90 162 ms, max 718 ms over 1290 samples. The no-RN window, which
delivers every press at 50 ms: median **398 ms**, p90 774 ms over 2384 samples. So main-queue
latency is *not* the quantity that loses a press — queueing behind UIKit waits without losing
touches, while blocking at `.beforeSources` stops the input source before it is read. The stall arm
reproduces the failure by name; it does not show that the React Native screen stalls the way the
stall arm does, and nothing measured here says what the busy screen crosses.

## Red proofs

- `testRealInputSwitch` busy-screen phase -> `pressOnce` pressing at `0.05` instead of
  `RealInputTests.pressDwell` -> `XCTAssertEqual failed: ("5") is not equal to ("12") — the busy
  Switch screen dropped 7 of 12 presses` (the guard's own assertion; it printed at
  `RealInputTests.swift:284` on that tree). Reverted, then `real-input:ios:--control:switch`
  **PASS** (99 s).
- `testRealInputSwitch` -> shared `pressDwell` lowered to `0.05` -> the pre-existing `tapUntilValue`
  aborts before the guard runs: "the first real tap: 3 real presses on the controlled Switch
  (`switch-controlled`) left it at \"off\". Its own state never moved either, so on the evidence
  here the touch was never delivered". Kept because it says something a reviewer would otherwise
  assume: at a globally lowered dwell the old failure comes first, which is why the guard is a phase
  of the Switch check rather than a later assertion in a run that has already aborted.
- The guard's row-count precondition -> not mutated. Turning the list off is a probe variant rather
  than a mutation of the guard, so the precondition is asserted rather than shown red; it exists so
  a stripped screen cannot pass the check for the wrong reason.

## Files changed

- `scripts/real-input/dwell-probe.mjs` — `--quiet`, `--probe-ui`/`--rows`, `--stall`, `--rescue`,
  `--watchdog`, `--witness echo:<id>`, `--fractions`, `--label`, `--skip-build`.
- `scripts/real-input/f7-matrix.mjs` — the cell table, one variant write per cell, per-cell JSON.
- `scripts/real-input/android-dwell-probe.mjs` — zero-distance `input swipe` at a caller-set dwell;
  aims by `testID` or `desc:<accessibilityLabel>`, because hosted Compose controls publish the latter.
- `example/ios/NitroUiExample/NitroUiProbe.swift` — the no-React-Native arm: three shapes, counting
  witnesses, stall observer, in-scroller `UIButton`, recogniser counter, watchdog.
- `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the guard, `publishedNumber`, the
  stall/rescue recognisers, probe env forwarded as a list, per-target quiet witnesses.
- `example/src/probeVariant.ts`, `example/src/SwitchScreen.tsx` — probe variants and witnesses,
  committed off, borrowed by the probe for the length of a run.
- `example/ios/NitroUiExample.xcodeproj/project.pbxproj` — `NitroUiProbe.swift` as explicit file
  refs (no synchronized groups).

## Follow-ups

- probe: quiet mode read the Toggle's counter regardless of which control was pressed; an
  in-scroller `UIButton` cell therefore reported 0/12 while that button's *own* counter said 12/12.
  Fixed by deriving the default counter from the target; the corrected cell is **12/12**, which says
  the plain UIKit button takes the stall and it is the hosted SwiftUI `Toggle` that does not — the
  opposite of the claim commit `8742a4c` drew from it ("a plain `UIButton` in the same container
  drops identically"). That commit is tested and pushed-through-four-gates history, so it is left
  alone and this line plus the table are the correction. The conclusion does not move: the no-RN arm
  is 12/12 with no stall and the React Native screen's drop is shown against React Native's own
  `Switch` and `Pressable`, none of which read that counter.
- probe: `f7-matrix.mjs`'s printed table had been wrong since `a07e83e` (a dropped capture group
  printed `taps` as `delivered`); fixed here. The per-cell JSON files were always parsed correctly.
- example: mounted-kind vs pressed-kind is answered only by inference — a variant mounting 200
  hosted Switches while pressing a Button would pin it directly.
- tooling: `f7-matrix.mjs` treats the variant file as global state; two probes on one checkout would
  fight over it.
- example: `assertStillInPlace`'s exact-`CGRect` comparison is genuinely fragile at fractional
  origins (`28.0` vs `28.000015258789062`); this branch routes around it rather than fixing it.

## Questions for orchestrator

1. **Should the library do anything itself?** The measured options:
   - **(a) Ship nothing; document it.** App authors keep presses above ~100 ms (measured 0/12 at
     80 ms, 12/12 at 100 ms) or reduce mounted switch count (list removed = 12/12; 200 plain boxes =
     12/12). Costs nothing, changes no behaviour, matches "if it's RN's or the platform's, don't
     patch around it blind".
   - **(b) A library-side recogniser rescue.** *Measured and not supported:* under a stall a tap
     recogniser on the host view fires 12/12 while the control beneath acts 0/12, so a recogniser
     rescues the *event*, not the control. Making the control act would mean synthesising its action
     — the blind patch the brief forbids — and it would fire during scrolls for anything that also
     drives one.
   - **(c) Upstream to React Native.** The evidence is ready: the busy screen loses a 50 ms press
     for RN's own `Switch` (0/12) and ours (0/12) in the same launch, RN's `Pressable` (12/12) does
     not, and a no-RN process of the same shape never loses one.
   - **Recommendation: (a) now, plus (c) as a bug report.** I cannot file it (AGENTS.md: no
     outward-facing actions); say the word and I will write the report text and minimal repro as a
     file for you to post.
2. **The brief's 50 ms real-input case.** With no fix landing, a case that presses 50 ms and asserts
   delivery is a permanently red test, so I guarded the shipped dwell and showed red at 50 ms by
   mutation. Options: keep as is (recommended); add a 50 ms case that measures and logs without
   asserting, which duplicates the probe; or an expected-failure case, for which this repo has no
   mechanism. Which do you want?
3. **`pressDwell` stays 0.15** because no fix landed, per the brief's condition. If you want it
   lowered anyway, 0.12 is 12/12 busy and calm; 0.10 is the lowest value measured 12/12 on the busy
   screen and is my floor recommendation.
