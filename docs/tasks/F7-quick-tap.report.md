# F7 — Quick taps on a hosted control in a busy screen are dropped (iOS)

**Branch:** `task/F7-quick-tap` (from `main` at `3dfe041`) · **Round:** 2 of up to 3 (D19) ·
**Lease:** `F7-xbddv` (pair-b: iPhone Air / `nitroui_b` · Metro `8293`) for fix round 1; round 1 used
`F7-p6svp` (pair-b) and, for its earlier half, `F7-fnto8` (pair-a), which expired mid-run.

## Summary

**A 50 ms press is not delivered on the busy screen — under XCUITest, on a simulator.** On the
shipped Switch screen (200 hosted Switches in a `ScrollView`) it arrives **0–1 times in 12**. That
is the whole of what was measured: nothing here involves a finger, a real device, or any harness
other than XCUITest, and XCUITest resolves the control by accessibility identifier and waits for
the app to go idle before it posts each event. Whether a real thumb is affected is therefore
**still unmeasured**, and an XCUITest artefact is not ruled out (see Fix round 1). What is ruled
out, narrowly, is that the difference between our Switch and React Native's is ours: the same press
in the same launch hits both equally. Every number below is 12 presses at 50 ms unless stated, with
`load1` recorded.

**Quieter, but not silent.** `--quiet` reads its witness twice instead of polling it, which removes
the *witness* traffic — hosted Switch **0/12**, React Native's own `Switch` on the same screen
**0/12**, RN's `Pressable` **12/12**, positive control **12/12** (load 1.8 / 4.8 / 3.8), both read
as a JS event count so the loss is visible through JS's own render. It does **not** remove the
traffic of aiming: each press still resolves its element, and XCTest still waits for idle per
event, so an accessibility query of a 200-control tree runs on the app's main thread right before
every press. The claim that no accessibility traffic enters the app between presses was wrong, and
the review caught it.

**Whose it is.** `RCTScrollViewComponentView.mm:145` already sets `delaysContentTouches = NO`, so
the brief's experiment 1 was moot; measured anyway — `canCancelContentTouches=false` **0/12**,
`scrollEnabled=false` **0/12**, no `ScrollView` at all **0/12**. The list is the variable: remove it
**12/12**; keep its geometry and swap the 200 hosted Switches for plain boxes **12/12**; swap them
for **RN's own** 200 Switches **0/12**. Button and SegmentedControl take the press **12/12** on
their 200-row screens and inside a `<Host>`. A plain SwiftUI `Toggle` in a `UIHostingController`
inside a bare `UIScrollView`, no React Native in the process, is **12/12** in all four shapes.

**A mechanism that reproduces the symptom, not a demonstration that this screen uses it.**
`--stall <ms>` blocks the no-RN window's main thread on every run-loop pass, and the window
publishes the longest block it actually performed
(`measured-max=122ms`). Toggle rows, acted/12: no stall **12**, 40 ms **4**, 80 ms **0–1**, 120 ms
**0**, and the scroller is not required (the `view` shape drops too). In the same launches a
`UITapGestureRecognizer` on the very view whose Toggle never acted fired **12/12**, so a press can
be hit-tested and recognised and still never reach the control beneath. A plain `UIButton` in the
same scroller under the same stall takes them all, **12/12**. That is *a* way to lose a Toggle
press; it is not shown to be this screen's way — the watchdog row below argues against it. Android
is not affected: 5 / 20 / 50 / 100 ms all **12/12**, control 3/3 (load 3.8–5.2).

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

Two load conditions, because the brief asks for both: **busy** means other work was running on the
machine (the "loaded" column below spans `load1` 2.99–13.42 at the row level), **quiet machine**
means the machine was idle. Cells taken at `load1` ≥ 8 were re-measured on an idle machine; none
moved. The second column is the busy one, the third the quiet one — neither is a controlled
variable of the experiment, both are recorded because the numbers move with it.

| Cell | busy machine | quiet machine |
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

**Negative result, kept because it contradicts the obvious story.** `--watchdog` logs every delay of
8 ms or more between offering a block to the main queue and that block running. The busy RN screen:
median **85 ms**, p90 162 ms, max 718 ms over 1290 samples. The no-RN window, which delivers every
press at 50 ms: median **398 ms**, p90 774 over 2384 samples. Read as a headline, that says the
screen which delivers every press has four times the main-queue latency of the one that delivers
none — so latency is not the quantity that loses a press. But the comparison is weaker than it
looks, and the review is right to say so: a block of length *L* behind a 20 ms timer logs roughly
*L*/20 decreasing samples, so a median of *logged gaps* counts block **frequency** as well as
length, and two screens with the same typical block and different busyness print different medians
for reasons that have nothing to do with either. What survives is the shape: queueing behind UIKit
waits without losing touches, while blocking at `.beforeSources` stops the input source before it is
read. The stall arm reproduces the failure by name; it does not show that the React Native screen
stalls the way the stall arm does, and nothing measured here says what the busy screen crosses.

### Fix round 1: is any of this the harness?

Round 1's numbers all came from an XCUITest loop that resolved the control by accessibility
identifier before each press, and XCUITest waits for the app to be idle before posting an event:
`-[XCUIApplication _waitForQuiescenceAsPreEvent:]` → `-[XCUIApplicationProcess
waitForQuiescenceIncludingAnimationsIdle:isPreEvent:]`, both in `XCUIAutomation.framework`
(the strings are in the binary; the option that skips it,
`XCUIApplicationInteractionOptionSkipPreEventQuiescence`, is not declared in any header in this
Xcode). So the probe's own traffic was a live candidate for causing the thing it measured. Two arms
take it out, both at 50 ms on the busy screen, `load1` recorded, and both with the positive control
pressed the same way.

| Cell | Delivered | Positive control | load1 |
| --- | --- | --- | --- |
| **no-RN, no SwiftUI: 200 plain `UISwitch`es, bare `UIScrollView`** | **12/12** | 3/3 | 2.66 |
| **no-RN, no SwiftUI: same, RN's own scroll configuration** | **12/12** | 3/3 | 3.38 |
| busy screen, hosted Switch, pressed **through its element** | 1/12 | 12/12 | 6.08 |
| busy screen, hosted Switch, **no per-press lookup** (fixed window point) | **0/12** | 12/12 | 9.10 |
| busy screen, RN's own `Switch`, no per-press lookup | **0/12** | 12/12 | 5.79 |
| busy screen, hosted Switch, no lookup, **XCTest idle-wait disabled** | **1/12** | 12/12 | 4.74 |
| same aim and same code path at the **shipped 150 ms dwell** | **12/12** | 12/12 | 4.9 |
| same aim and same code path, 50 ms, **200-row list removed** (variant 3) | 12/12 | 12/12 | 5.1 |

The aim was checked, not assumed: `y=338.67` for the hosted Switch cell is a fixed point taken once
from the window root, and pressing exactly that point at 150 ms delivers **12/12** through the same
no-lookup path. A mis-aimed point cannot produce that, so the 0/12 at 50 ms is a dropped press and
not an aiming bug.

**What this changes in the conclusion.** Taking the harness out did not fix the drop, so the
sentence "an XCUITest artefact" is not available either — but neither is "users lose taps", because
what remains measured is still only XCUITest events on a simulator. The claim narrows to exactly
what is measured: **a 50 ms press is not delivered to a Switch-type control on this screen, and
the cause is not the probe's queries, not XCTest waiting for idle, and not anything of ours** — the
last because the private skip flag took effect (`skip-quiescence=on(3)`, read back from the app) and
changed nothing. The `UISwitch` arm closes the gap the review named: with no React Native *and* no
SwiftUI in the process, two hundred real UIKit switches in a bare scroller lose nothing, so the
effect needs React Native's own tree around the control, which is where round 1's pair cells already
put it.

**A negative result worth more than the table.** The same `press(forDuration:)` call, at the same
fixed point, costs **median 630 ms** on the busy screen and **median 1642 ms** on the same screen
with the list removed — while the *slower* screen delivers 12/12 and the faster one delivers 0/12.
So the time XCTest spends inside a press is not the quantity that loses one either, and neither is
main-queue latency (the round 1 watchdog row said the same thing from the other side). Whatever the
busy screen crosses, it is not "the app was busy when the press happened", and nothing here says
what it is.

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
- The guard's busy-screen precondition -> round 1 left this unproven, which the review
  counted as M2. It is now both checked against Switch elements rather than testIDs and
  shown red: `SWITCH_SCREEN_VARIANT=6` (the 200-row list rendered as plain boxes carrying
  exactly the `switch-list-*` identifiers, so the old ID count read "busy") ->
  `XCTAssertGreaterThanOrEqual failed: ("14") is less than ("100") — the Switch screen has
  to carry its 200-row list of Switches … The tree exposes 14 switch elements.` Variant
  restored, then `real-input:ios:--control:switch` **PASS** (93.6 s).
- The guard's witness check (M1) -> `nativeSwitchState` returning nil for
  `switch-uncontrolled` only, with the control still present and still being pressed — the
  exact case the old `?? ""` turned into twelve credited presses ->
  `failed - switch-uncontrolled published no switch value before press 1 of 12, so this
  check cannot tell a delivered press from a dropped one. A witness that stops publishing
  must not be able to read as twelve successes.` Reverted, then
  `real-input:ios:--control:switch` **PASS** (93.6 s).

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

## Fix round 1

Review: MERGE WITH FIXES at `229a481`. All must-fixes and nits done, plus the two measurements.

**M1** a nil witness counted as delivered (`before` was `?? ""`, then `String?` vs `String`). The
read is required now; the wait returns delivered / dropped / unreadable, nil never a change, and
unreadable is asserted separately. Red, then green. **M2** the precondition counts `.switch`
elements, not `switch-list-*` IDs — the difference between passing and meaning something on variant
6. Red at 14 against a floor of 100, on variant 6. **M3** lines 9, 13, 27 and the loaded header
rewritten; "keep presses above ~100 ms" withdrawn. **N1** `ink.muted`. **N2** the run-together
summaries. **N3** the watchdog's real threshold. **N4** the median-of-logged-gaps caveat, in code
and report. **N5** per-cell JSON carries target/variant/quiet/witness/stall; the superseded
wrong-witness cell says so and points at the 12/12 correction. **N6** `pressOnce` returns the dwell
it used.

**Measurements** (table above): removing the harness's traffic leaves the drop where it was — 0/12
by fixed point, 1/12 with XCTest's idle wait switched off and the flag verified on — while 200 real
`UISwitch`es with no React Native and no SwiftUI lose nothing. New arms: `--no-lookup`,
`--skip-quiescence`, the `uikit-switch` shapes.
