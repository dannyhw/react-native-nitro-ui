# X4 — Conformance suite for the four recurring bug classes, and `task-ready`

**Branch:** `task/X4-conformance` (from `main` at `3dfe041`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X4-fwfhi` (`nitroui_b` / `emulator-5570`, sim `3AE7EE8D…`, Metro `8293`)

## Summary

Four rules, one parameterised suite, driven by `src/components/*/component.json`. The rules
are data in `scripts/conformance-core.mjs`; `coverageMatrix` + `formatMatrix` print the
rule × control table below, and `checkCoverage` refuses a cell that is neither covered nor
marked `failing` with a `FOLLOWUPS.md` line that actually exists. A new manifest is covered
the day it lands: `checkInAppFixtures`, `checkA11yTable` and `checkCoverage` each go red in
`check` if it is not, so 0.4's Menu inherits all four rules with nobody writing a case.

**Where the Android a11y rule runs, and why.** The in-app harness matches
`View.contentDescription`; Compose publishes the control's name on a `SemanticsNode` that is
not a `View`, so a hosted control's name is invisible to any in-process query — the gap
`Slider.harness.tsx` and `Progress.harness.tsx` each already record. `uiautomator dump` *is*
the accessibility tree, so the rule reads that, from the host, **inside
`scripts/real-input/android.mjs`** after its `CHECKS` loop. Not a new gate: it rides a run
that already boots the app, walks every tab and pays for dumps. `Suite.beginAuxiliary` keeps
the sweep's logs out of the control totals while still failing the run. iOS asserts the same
rule in-app, where `queryByAccessibilityLabel` does reach through the SwiftUI host.

**The rule that the device run corrected.** The first fallback run went red on three of seven
controls and the rule was the wrong part: a `fillWidth` control's width is its parent's
(Slider measured 420 on a 420 dp screen, declaring 328), and Button's declared pair is a
documented middle of a 33.3–103.2 table. `boxRuleFor` now derives which axes a declaration
describes from the generated sizing policy, and the mode travels in the mirrored table so the
asserting suite cannot choose it. Button's exemption has to earn itself every run.

**Nothing asserts against its own copy.** The declared fallbacks, poison sizes, tolerance,
box rules and in-app debt rows live in one marked JSON region in the harness file, regenerated
by `scripts/conformance/print-shared-table.mjs` and compared with `sharedInAppTable()` on every
`check`. Declared fallbacks are hand-written from component source, and the poison
(`97×11` / `111×13`) belongs to no control, so "the box was right" can only mean a correction
arrived.

**Debt, not fixes.** Four a11y findings (Slider, SegmentedControl, each hosted too) are
exempted per *finding*, and `staleExemptions`/`staleDebt` go red when a row stops matching
something real — the list clears itself with a failing test rather than a reviewer noticing.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

## Bench

No bench numbers: this round adds no control and touches no rendering path, and `gate.mjs
need` does not ask for a bench (AGENTS: benches belong to the bench host). The one cost the
suite could plausibly add is at *build* time — it registers no component, so
`app.stamp`'s component count is unchanged at 8, and the new harness file is 28 tests in one
of 14 suites (47 s of a 167 s iOS run).

## Coverage, as the suite prints it

`node --input-type=module -e '…coverageMatrix…formatMatrix…'` — the same call the report's
`checkCoverage` guard is built from, so this table cannot disagree with the test:

| Control | a11y-name-on-focusable-node | declared-fallback | no-leak-on-drop | recycle-reset |
| --- | --- | --- | --- | --- |
| Button | covered | covered | covered | covered |
| DatePicker | covered | covered | covered | covered |
| Picker | covered | covered | covered | covered |
| Progress | covered | covered | covered | covered |
| SegmentedControl | **failing** — see X4 a11y: nothing actionable at the named node | covered | covered | covered |
| Slider | **failing** — see X4 a11y: Compose RangeInfo nodes are not actionable in a dump | covered | covered | covered |
| Switch | covered | covered | covered | covered |

## Red proofs

Every one run on this tree; the mutation is the line that was changed, the right-hand side is
the assertion that went red.

The Android rule (`scripts/__tests__/real-input-a11y.test.js`, against measured dumps):

- `goes red when the name has no box` -> `named = all` (drop the zero-box filter) -> `✕ goes red when the name has no box`
- `goes red when the name is on the control AND on something else` -> `if (named.length > 1)` -> `false` -> `✕ … AND on something else`
- `goes red when a name lands on the scroll container itself` -> `if (node.scrollable === 'true')` -> `false` -> `✕ … scroll container itself`
- `goes red when a name moves to the container around the control` -> drop `covers(node.bounds, named.bounds)` from the actionable-home search -> `✕ … container around the control`
- `passes the controls today's code gets right, and reports the rest as debt` -> the actionable test -> `false` -> `✕ passes the controls today's code gets right`
- `goes red when a control is fixed and its row is left behind` -> `staleExemptions` returns `[]` -> `✕ … its row is left behind`

The sweep (`conformance.test.js`, driven against a fake device):

- `scrolls until its control has a box…` -> no scroll loop -> `✕ scrolls until its control has a box`
- `keeps scrolling past a name with no box…` -> stop on `contentDesc === label` alone -> `✕ keeps scrolling past a name with no box`
- `…judges the tree that has it` -> return the first dump instead of the scrolled-to one -> `✕ scrolls until its control has a box`
- `fails the run when a debt row no longer describes anything` -> report the stale rows -> never report them -> `✕ fails the run when a debt row…`
- `prints debt rather than failing it…` -> fail an exempted finding too -> `✕ prints debt rather than failing it`

The rules and tables (`conformance.test.js`):

- `catches a poisoned guess that was never corrected` -> the poisoned-box branch -> `false` -> `✕ catches a poisoned guess…`
- `goes red when a fallback is shared by two controls` -> `owners.length < 2` -> `< 99` -> `✕ …shared by two controls`
- `goes red when a declared size is not positive` -> drop the positivity test -> `✕ …not a positive size`
- `lets a fillWidth control be wider than its declaration…` -> compare the width anyway -> `✕ lets a fillWidth control be wider`
- `goes red when the content-sized exemption earns nothing` -> that branch -> `false` -> `✕ …exemption earns nothing`
- `goes red for a CONTENT_SIZED_BOX entry that is not an intrinsic control` -> accept any existing control -> `✕ …not an intrinsic control`
- `goes red when ledger entries outlive their instances` -> the ledger comparison -> `false` -> `✕ …outlive their instances`
- `goes red when a failing rule has no FOLLOWUPS line` -> that check -> `false` -> `✕ …no FOLLOWUPS line`
- `goes red when the region is missing, corrupt, or stale` -> `want !== have` -> `false` -> `✕ …missing, corrupt, or stale`
- `goes red for a manifest no rule covers` -> skip the per-manifest requirement -> `✕ …no rule covers`
- `sweeps both lists in one call, each on its own key` -> pass `[]` for the in-app rows -> `✕ sweeps both lists in one call`
- `goes red when a debt row cites a line that is not in FOLLOWUPS.md` -> rename the cited line in `FOLLOWUPS.md` -> `+ "Slider × a11y-name-on-focusable-node: marked failing with no docs/tasks/FOLLOWUPS.md line"`

Coverage as a failing test (`component-coverage.test.js`, on the real tree):

- `every manifest is covered, or has a stated reason` -> rename a fixture in the harness table -> `+ "…Conformance.harness.tsx: no fixture for Picker (picker)"`
- the same test -> rename a `FOLLOWUPS.md` line the debt cites -> `+ "Slider × a11y-name-on-focusable-node: marked failing with no … line"`

`scripts/task-ready.mjs` (`scripts/__tests__/task-ready.test.js`, 30 cases):

- `ends the region at the end marker…` -> the flag is never cleared -> `✕ ends the region at the end marker`
- `goes red for a FIXME in a declared fallback table` -> `FALLBACK_FILE` matches nothing -> `✕ …FIXME in a declared fallback table`
- `goes red for a TODO inside a generated region` -> `GENERATED_MARKER` matches nothing -> `✕ …TODO inside a generated region`
- `accepts the shapes a report actually uses` -> require no `/` -> `✕ accepts the shapes a report actually uses`
- `allows a path the branch itself adds or deletes` -> ignore `touched` -> `✕ allows a path the branch itself adds…`
- `reports each distinct bad path once…` -> compare unstripped citations -> `✕ reports each distinct bad path once`
- `goes red when a row was retyped with different text` -> match rows by gate name only -> `✕ …row was retyped with different text`
- `goes red when a row was retyped…` + `compares the whole row…` -> the `generated.length === 0` early exit -> `false` -> `✕ …row was retyped with different text`
- `does not ask for the same file twice` -> drop the dedup -> `✕ does not ask for the same file twice`
- `fails on one problem, and indents it under its section` -> never clear `ok` -> `✕ fails on one problem`

## Files changed

- `scripts/conformance-core.mjs` — the four rules as data, the fallback/poison/box-rule tables, the coverage matrix, the debt lists and their self-clearing checks, the shared-table mirror.
- `scripts/real-input/{a11y.mjs,a11y-sweep.mjs,screens.mjs}` — the Android rule, one pass over the case table, the tab→file map; `uiautomator.mjs` gains `scrollable`; `support.mjs` gains `Suite.beginAuxiliary`.
- `scripts/real-input/android.mjs` — the sweep, after the `CHECKS` loop.
- `example/__tests__/Conformance.harness.tsx` — the in-app half: fallback (registered + poisoned), 50-mount leak, one-testID second owner, the iOS box comparison; the mirrored JSON table.
- `scripts/conformance/{print-shared-table.mjs,make-a11y-fixtures.mjs}` — the two generators; `scripts/__tests__/fixtures/a11y/*.xml` are 13 measured dumps.
- `scripts/task-ready.mjs` + `scripts/task-ready-core.mjs` — the hand-in bar, and its deciding half.
- `scripts/__tests__/{conformance,real-input-a11y,component-coverage,task-ready}.test.js`, `scripts/conformance/print-shared-table.mjs`, `package.json` (`task-ready`, `conformance:table`).
- `CONTRIBUTING.md`, `docs/tasks/{REPORT-TEMPLATE,ORCHESTRATOR,FOLLOWUPS}.md`.

## Follow-ups

- Android a11y: the four exempted nodes may be a dump artefact — `uiautomator dump` runs without touch exploration, so Compose may mark a node focusable only once TalkBack is up. `FOLLOWUPS.md` names the measurement that settles it.
- Android a11y: Progress's own screen can never be dumped (indeterminate indicators never idle), so what a screen reader announces for an *animating* indicator is unasserted; `hosted-progress` covers the determinate one.
- The recycle rule measures identity, not recycling — `enableViewRecycling` appears nowhere in `src/` or `example/`, so the fixture hands one `testID` to a second owner rather than reaching `prepareForRecycle`.
- `harness.mjs` falls back to the next Metro port and keeps going; only the wall-clock timing
  guard noticed (it compares the port in `harness-timing/state.json` with the run's own). Both
  harness gates were lost that way when a Metro orphaned by a SIGTERM'd real-input run held
  the lease's port — a cheap `gate.mjs` pre-flight that refuses a leased Metro port already
  serving someone else would turn a lost 3-minute run into a 1-second message.
- Two pre-existing ESLint warnings are on `main` and in files this branch does not touch:
  `scripts/harness-suite-timing.mjs:25` (`join` unused) and
  `scripts/__tests__/registry.test.js:651` (`manifests` shadowed).
- `scripts/conformance-core.mjs` and friends count as both platforms in `gate.mjs` (they are not in `TOOLING_FILES`), so a rules-only edit owes two harness runs. Deliberate for `real-input/*`; arguable for `conformance-core.mjs` alone, and left as the expensive-but-honest default.
- `real-input:ios` is not run by this task's `need`, and this round adds no iOS real-input
  check — the sweep is Android-only, because the in-app query already reaches the name on
  iOS. It is worth one run anyway as a regression check on `support.mjs`: `Suite.finish` is
  shared, and the `auxiliary` list now prints in its summary on both platforms.
