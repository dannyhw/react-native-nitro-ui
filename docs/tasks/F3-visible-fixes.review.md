# F3 — review

**Branch:** `task/F3-visible-fixes` at `461e21e` (base `b943a3f`) · **Round reviewed:** 1 of up to 3 (D19)
**Inputs:** the brief, Q4 triage rows 10/27/46 and their `FOLLOWUPS.md` lines, the diff, the report,
`docs/tasks/F3/gates.jsonl`, and the worktree's local `.gates/` logs. No devices used; `bun run check`
not re-run (the ledger's green `check` is on `c047fa692f33`, which `gate.mjs need` confirms is this tree).

## Verdict: FIX ROUND

The sizing fix is right and well proven. The DatePicker fix is right in mechanism, but the claim its
changeset makes is not asserted on iOS, the platform the bug is on, and two comments now contradict
the new test. The SegmentedControl outcome (iOS stays documented as a no-op) is a defensible decision,
but the public docs and changeset support it partly with a defect in a prototype that is not in the
repo. M1 needs a device run, so this is a fix round rather than merge-with-fixes.

## Per item

**Row 10 (`fillWidth`, engine).** Correct. `filedSizeLocked` (`cpp/NitroUiSizingEngine.cpp:206`)
changes only the *width* filed for a `fillWidth` report. The only consumer that reads that width is
`measureContent` under an infinite constraint (`cpp/NitroUiIntrinsic.hpp:208`). Everywhere else the
box replaces it, and `sameSizeForPush` (`:99-107`) compares heights only for `fillWidth`, so no push,
confirmation or correction count changes. The old "last box width wins" behaviour was relied on only
by `testFillWidthInstancesOfDifferentWidthsCostNothing` (the 300→328 edits). Nothing on the hosted
path files a size; only `NitroSwiftUIHost.swift:429` and `NitroComposeHost.kt:1198` report. Progress
declares its *linear* numbers with `fillWidth` (`HybridNitroUiProgress.swift:261`, `.kt:396`), so
circular (intrinsic) is untouched and linear gets 320. Red proofs are confirmed in the local logs: the
C++ test, and `harness:android:Slider` at tree `de54e77` → `never became 240 wide (last=200.00x923.43…)`.
The brief pointed at `NitroComposeHost.kt:1537` (`Constraints()`). The implementer instead located the
cause in the engine and proved it on a device. That is a better fix, but the report never says why
the host branch was left alone (N1).

**Row 46 (DatePicker `builtBounds`).** The move is right, and both red proofs are confirmed in logs
(`11-42-54`: `expected 4 to be greater than 4`; `11-44-14`: `expected 1766232000000 to be
1768910400000`). What is not proven is the user-visible claim. See M1 and M2.

**Row 27 (SegmentedControl `tintColor`).** The Android half is asserted end to end (paint, tap,
retint, removal, neighbour). On iOS the test asserts the no-op three times. The spec addition
(`nuiTestPixelProbe` / `nuiTestPixelReport`) is `@internal` in `.nitro.ts`. It surfaces in
`etc/react-native-nitro-ui.api.md:275-276` inside the `hybridRef` callback type, which is the same
precedent as DatePicker/Picker/Progress/Slider (`:74-76, :200-201, :236-237, :304`). It is additive
to a type the app *receives*, so patch is fine. The docs need fixing; see M3.

**Ledger.** The review bar is met on this tree (`check`, `harness:ios`, `harness:android` green on
`c047fa692f33`). The merge bar is not; see M5. The race attribution is **partly supported**:
- `.gates/detached.jsonl` (machine-local, not exported) has a base run at `b943a3f`,
  `harness:ios:Button|HostPopups`, that fails on the same test with the same message (`No hybrid
  handle for "segmented row"`).
- The base full run failed a *sibling* (`HostControls` › `log.sliders['slide-0']`), not this test.
- On the F3 tree, 3 of 4 full iOS runs failed, all on the hosted **SegmentedControl** handle, which is
  the control this branch changed. Against that, the base has one full run.

The mechanism is plausibly pre-existing: adding methods to a spec does not delay `hybridRef`. The
evidence for it lives only on this machine, though, and the frequency comparison is 3/4 against 1/1
on a different test (N2).

**Hygiene.** No home paths, emails or hostnames in the diff. The only serial is `emulator-5570` (the
lease's), and `emulator-5560` does not appear. `maintainer-mac-1` is the brief's public label.

## M — must fix

**M1. The DatePicker changeset's headline claim is not asserted on iOS, and the code suggests it is
only partly true.** The changeset (`.changeset/date-picker-built-bounds.md:5`) says a value crossing
the bound the picker widened away from no longer replaces the calendar. The test that would show it
is Android-only: `example/__tests__/DatePicker.harness.tsx:1305-1306`
(`if (isAndroid) { expect(afterFlips).toBe(widened) }`), with no comment saying why iOS is exempt.

Reading `controlIdentity` (`ios/components/DatePicker/HybridNitroUiDatePicker.swift:243-253`) with
the new `.onAppear` (`:623`) suggests why:
1. The render that widens `maximumDate` and moves the value adds `|outside`, because `builtBounds` is
   still the old control's at that moment.
2. The new control appears and records the wider bounds. `builtBounds` is not published, so nothing
   re-renders.
3. The *next* render, from any prop, drops `|outside`, changes the identity again, and rebuilds once
   more. That resets the page and scroll position, which is the cost the changeset says is gone.

So `afterFlips` on iOS is probably `widened + 1`.

Failure scenario: an app widens `maximumDate` and moves the value in one batch. On the next parent
render the inline calendar jumps back to its default page.

Fix: assert the iOS number (measure it). If it is `widened + 1`, either remove the bounce (for example,
skip the `|outside` suffix when the granular part already changed, or compare against the bounds the
new identity will build with), or document it and word the changeset accordingly.

**M2. Comments touched or written by F3 now contradict the new test.**
- `HybridNitroUiDatePicker.swift:163-168`, written in this diff, says "an `.id(_:)` change on a
  control that is already on screen does not move that count".
- `DatePicker.harness.tsx:1137-1144` keeps "iOS gets no rebuild assertion… was measured not to move
  it".

Meanwhile the new test asserts on iOS that it *does* move (`:1283`, `expect(widened).toBeGreaterThan(built0)`,
red before the fix). Its own comment at `:1279-1280` even names the old comment as the blindness that
F3 removed.

The `FOLLOWUPS.md` line behind row 46 says the move "likely makes the iOS rebuild assertion provable".
That refers to *this* test's missing iOS assertion, which is still `if (isAndroid)` at `:1158`.

Failure scenario: the next reader trusts either comment and gets the other platform wrong. The iOS
rebuild contract of `keeps the live control…` stays unguarded.

Fix: correct both comments. Then either enable the iOS half of the rebuild assertion at `:1158`, or
state the measured reason it still cannot be made.

**M3. The public SegmentedControl docs and changeset give a prototype's defect as a platform
reason, citing code that is not in the repo.**
- `docs/components/segmented-control.md:250-252` ("Nor is it cleanly undone… 9290 pixels"), the
  matching Swift comment at `HybridNitroUiSegmentedControl.swift:173-177`, and the changeset
  (`.changeset/segmented-tint-ios-documented.md:5`, "taking it back off leaves the old colour behind")
  describe a version in which "the view doing the pushing only existed while a tint was asked for".
  `git log --all -S "selectedSegmentTintColor ="` finds no such code. Not resetting a property on
  removal is a bug in that prototype, not something iOS does. The recycled-host claim at `:175-177` is
  the same kind of claim.
- The measurement is iOS 27 only. The brief's bar was "no per-instance approach on iOS 15.1+", and
  pre-glass iOS (≤ 25) was not measured. The docs say "iOS 27" in one place and read as general
  elsewhere.
- The docs contradict themselves: `:250` says "re-writing the same value does not bring it back", and
  `:255` says it would be "kept true only by re-writing… on every interaction".

Failure scenario: a contributor or app author reads that iOS can't un-tint a `UISegmentedControl`,
which is false. The decision then rests on a reason nobody can reproduce from the repo.

Fix: keep the measured iOS 27 reason (the colour leaves the screen on the first selection change and
does not return when re-written). Drop or qualify the undo/recycle claims as prototype defects. Say
which OS versions were measured. Resolve the re-write contradiction.

**M4. The `fillWidth` changeset and report misstate what the docs said, and `progress.md` is stale.**
- `.changeset/fillwidth-infinite-parent-width.md:5` says the declared width "is the number
  `docs/architecture/sizing.md` already said it stored". The report repeats this at
  `F3-visible-fixes.report.md:14` ("what `sizing.md` §5 already described"). Base `sizing.md` said the
  opposite: "The width in the entry is the last box width some instance was measured at". The doc that
  did describe the declared width's purpose was `slider.md`.
- The changeset names linear Progress, but `docs/components/progress.md:106` still says "For a
  `fillWidth` fallback the width barely matters (the box's width replaces it)". Under an unbounded
  parent, 320 is now what a linear Progress draws permanently.

Failure scenario: the published CHANGELOG cites a doc for a claim that doc never made. The Progress
page tells an author the declared width is irrelevant when it is now the width on screen.

Fix: reword the changeset, pointing at `slider.md` or dropping the clause. Bring `progress.md:104-107`
in line with `sizing.md` §5's new third bullet.

**M5. The merge bar is not met, and the report says it does not apply.** `gate.mjs need --for merge`
on this tree prints `2 gate(s) missing for merge: real-input:ios, real-input:android`. The report
(`:89`) says "`real-input:*` is not required for this branch". That holds for review only. `AGENTS.md`
says "the full harness plus real-input runs once, at merge".

Failure scenario: the branch merges with the merge bar unmet, on a report that says otherwise.

Fix: record both real-input gates on the final tree before merging (in the fix round or the
orchestrator's merge step), and correct the sentence.

## N — nice to have

- **N1.** The report should say in one line why `NitroComposeHost.kt:1537-1538` (the brief's pointer)
  is not the cause and was left alone. Under Fabric the Compose `Layout` always gets a bounded width,
  so that branch is a theoretical last resort.
- **N2.** Export or cite the base runs (`.gates/detached.jsonl`, `b943a3f`, 13:20:40 and 13:21:08).
  They are the only evidence for the race attribution and will be lost with the worktree. One more
  full `harness:ios` at the base would turn "3/4 vs 1/1" into a comparison.
- **N3.** The iOS probe's `mean` is wrong. `redSum += red * area` uses the per-pixel alpha, which is
  always 255 after the grey backdrop (`HybridNitroUiSegmentedControl.swift:583`). It is then divided by
  the pixel count (`:597-601`), so each channel is ×255 and overflows into its neighbours. The report's
  own `mean=#8FAFB6EB` has eight hex digits. Android's version (`.kt`) is correct. Either fix it or drop
  `mean` before the follow-up suggests asserting on it.
- **N4.** The comment at `cpp/NitroUiSizingEngine.cpp:91-94` was garbled by the edit ("so it says such
  a configuration is only the height").
- **N5.** Stale code comments repeat what M4 fixes in docs:
  - `HybridNitroUiProgress.swift:253-259` and `.kt:369`: "barely matters… overwrites with the box's".
  - `HybridNitroUiSlider.swift:641-643` and `.kt:633-636`: "lays out at this width until its own
    measurement arrives". The measurement no longer replaces it.
- **N6.** New comments cite "`docs/tasks/FOLLOWUPS.md` row 10/46" (`NitroUiSizingEngine.hpp:497`,
  `HybridNitroUiDatePicker.swift:236, :618`, `DatePicker.harness.tsx:199, :1198`,
  `Slider.harness.tsx:503`). `FOLLOWUPS.md` has no row numbers: line 10 is F6 and line 46 is an H1
  item. The numbering is `Q4-followups-triage.md`'s, so cite that file.
- **N7.** `Slider.harness.tsx` restores the real declaration at the end of the test body (`:634-640`),
  not in a `finally`. A failure mid-test leaves `NitroUiSlider` declared as 240×12 with intrinsic
  flags (`seedSizingSize` passes `0u`, `HybridNitroUiCore.cpp:76`) for every later Slider test, which
  makes the first red cascade.
- **N8.** The report's gate notes (`:85`) say "the three `stale` rows are the per-suite green runs".
  The table has five stale rows, and `harness:ios:DatePicker` is the red-proof *fail*. Separately,
  `harness:android:Slider` failed once at tree `e381a792` (12:43:53, `The accessibility step probe
  never reported`) between two greens on the same tree. That is an unreported flake. Add it as a
  follow-up line.
- **N9.** The iOS `SegmentedControlModel` does not clear `pixelReport` on recycle, though Android's
  does (`.kt` `reset`). The `n=` counter keeps tests honest, but the asymmetry is unexplained.
- **N10.** Android `builtMinimum` / `builtMaximum` are written on the UI thread outside `reportLock`
  and read under it. The race is benign for the test (polling), but an `@Volatile`, or writing them
  under the lock, would match how the rest of `readReport` is guarded.
