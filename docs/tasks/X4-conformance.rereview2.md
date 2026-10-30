# X4: re-review of fix round 2 (2026-10-30)

**Verdict: MERGE WITH FIXES.** All four must-fixes and the Menu coverage hold. The device red proofs are recorded failed runs, and each excerpt shows the failure the report claims. `need --for merge` is satisfied on `7c2ce5f4c3dc` (HEAD `15a8c4e`), `task-ready` prints `ready — 6 checks`, and the X4 unit suites pass 199/199. The fixes below are docs only, so no gate is invalidated.

## Items

- **M1 fixed.** Excerpt `2026-10-30T02-02-45Z--real-input+ios` shows `✗ NitroUiSwitch: no element other than the React Native wrapper is announced as "Controlled switch"` (`:109`), the same for `"Controlled slider"` (`refresh()`, now `:591`), and both hosted cases. The `:469` run is green in the ledger (02:42) and its log says `13/13`.
- **M2 fixed for Switch, Slider and DatePicker; not for Picker** (finding 1). Second owners now default off the reset value. Excerpt `01-56-37Z` has three `(uncontrolled …)` reds and excerpt `01-59-05Z` has four `(controlled …)` reds. Neither mutation turns the other probe red.
- **M3 fixed.** `a11y.mjs:409` matches only the doubled-name sentence (`:565`). `real-input-a11y-ios.test.js:278` shows a lost label going red.
- **M4 fixed.** Button and Progress show `n/a` with the fixture's own reason. Menu and SegmentedControl show **failing** and cite FOLLOWUPS lines 76–77. Those cells are honest:
  - On iOS, `expanded` is `-1`.
  - SegmentedControl emits on every press (`HybridNitroUiSegmentedControl.swift:150-156`), so a press cannot show its residue.
  - The runner prints `known failing`.
  - `check` passes because `checkRecycleNotes` (`conformance-core.mjs:1298`) and `component-coverage.test.js` pin the note, the debt row and the FOLLOWUPS line, and it goes red if any of the three drifts.
- **Menu covered** in every table. `a11y:menu` ran in both final real-input logs.
- **Lows** done: the ✓ wording, the fallback comment, and the invented-row error.
- **D25 clean.** Commit messages and the diff carry no paths, hosts or emails, apart from the test placeholder `/Users/someone/…`.
- **Shipped package.** The only change is a Swift doc comment (`HybridNitroUiSlider.swift:455-463`), which needs no changeset.

## Findings

1. **Medium: Picker's `didApplyDefault` line is unprobed, and the stated reason is wrong.** The uncontrolled second owner's `defaultSelectedIndex={0}` equals the reset's `displayed: 0` (`HybridNitroUiPicker.swift:504-506`). That is the coinciding fixture M2 targeted, and the appendix records the mutation going green.
   - The harness comment (`Conformance.harness.tsx` ~`:1782-1797`) says Picker "cannot be" made line-specific. With three options it can: residue 1, second-owner default 2, then the read picks 0 and expects `conformance-picker:0`. With the line deleted, the control sits on 0 and stays silent, so the test goes red.
   - The matrix still says **covered**.
   - **Minimal fix:** add a FOLLOWUPS line with that recipe, and correct report Fix round 2 item 3 to say "unprobed", not "unprobeable". Fix the comment with that follow-up; editing the harness now costs both platforms' device gates.
2. **Medium: the unit red proofs are prose only.** The round-2 instruction asked for every red proof to be a recorded failed run. That holds for the device proofs. It does not hold for the appendix's five unit mutations or the merge's "seven reds": there is no failed `check` in round 2. All six are plausible against the tests. **Recommend:** accept them, with one sentence in the report saying they are unrecorded. The strict alternative is for the orchestrator to record each with `gate.mjs check` on the mutation, about 2.5 minutes per run.
3. **Low: `report.md:315`** says "Menu's a11y case". The test is the hosted Picker's (`real-input-a11y-ios.test.js:278`).
4. **Low: two final-tree reds are unexplained.** These are the 03:59 `harness:android` run (`Slider › steps to the next legal value…`, known flake FOLLOWUPS:59, green at 04:08) and the 02:58 stale-app refusal. The report's "two runs failed for reasons of mine" covers only the 04:16 pair and the `IOS_UDID` refusals. Add one line.
5. **Low: the `MenuScreen.tsx:213-220` comment** says dropping the label "silently drops" the control from the a11y rule. `checkA11yTable` refuses that in `check`. Fix it at the next touch of the file, since editing it now invalidates both platforms' gates.
6. **Low, accept:** the Slider doc comment's "what SwiftUI's own traversal would use" is unmeasured.

## Must-fix before merge (orchestrator, docs only)

1. A FOLLOWUPS line for the Picker `didApplyDefault` probe (finding 1), and a corrected report item 3.
2. In the report: `:315` Menu → hosted Picker; one sentence that the unit proofs are unrecorded; one line on the 03:59 and 02:58 runs.
