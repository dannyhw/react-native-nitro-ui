# F3 — review (re-review after fix round 1)

**Branch:** `task/F3-visible-fixes` at `d596410` (base `b943a3f`; this round `432b2ad..d596410`) ·
**Round reviewed:** fix round 1 (round 2 of up to 3, D19)
**Inputs:** the brief, the round 1 review, the report (including `## Fix round 1`), both diffs,
`docs/tasks/F3/gates.jsonl`, `docs/tasks/F3/base-race-gates.jsonl` and the worktree's local
`.gates/logs/`. No devices used. `bun run check` was not re-run: `gate.mjs need --for merge`
(Node 24, `NITRO_UI_MACHINE_LABEL=maintainer-mac-1`) prints `merge is satisfied on this code tree`
for code tree `18da47b86583` at HEAD, with `check`, both full harnesses and both real-input gates green.

## Verdict: MERGE WITH FIXES

All five round 1 M findings are resolved in the code, not just in the report. Each new assertion
has a red run in the local logs that matches the report. The new `controlIdentity` suppression is
crash-safe. When it drops the suffix, the granular part differs from the on-screen control's, so
the identity still changes and the control is still replaced. The remaining findings are about
wording.
- M1 touches only docs and a changeset. Neither is in the code-tree digest
  (`isCodeFile('.changeset/a.md') === false`), so fixing it keeps every gate green.
- M2 is two stale code comments. Fixing them changes the code tree and re-owes the whole merge bar,
  so the orchestrator can choose to record them instead (see M2).

## Round 1 findings: status

| # | Status | Evidence at HEAD |
| --- | --- | --- |
| M1 | **Resolved** | Real second rebuild, fixed in `controlIdentity` (`HybridNitroUiDatePicker.swift:291-303`). `afterFlips === widened` is asserted on both platforms (`DatePicker.harness.tsx:1336`). Red with the suppression removed: log `14-12-03`, `expected 9 to be 8`. The probe run `13-56-42` reads `built0=8 widened=9 afterFlips=10`. The changeset is reworded to match. |
| M2 | **Mostly resolved** | Both named comments are corrected. The iOS half of `keeps the live control…` is enabled (`:1166-1186`). Red with `.onAppear` back outside the identity: log `14-14-49`, `still reports 2 builds, want more than 2`. Two sibling comments still say the old thing (new M2). |
| M3 | **Resolved** | iOS 27 only is stated in the docs, the Swift comment and the changeset. The prototype claims are disowned explicitly. The re-write contradiction is gone. |
| M4 | **Resolved, with one overreach** | The changeset now cites `slider.md`. `progress.md`, the Progress/Slider comments and `sizing.md` §5 are aligned. The new Progress text claims more than was measured and gives app authors an instruction they cannot follow (new M1). |
| M5 | **Resolved** | `real-input:ios` and `real-input:android` are green on `18da47b86583`. The report sentence is corrected. |
| N1 | Resolved | One line in the report (`## Fix round 1`, "N1"). |
| N2 | Resolved | `docs/tasks/F3/base-race-gates.jsonl` is committed. Its five lines match the report's base row (4 full runs: 1 fail, 3 pass). |
| N3 | Resolved | Swift `mean` no longer weights by alpha (`HybridNitroUiSegmentedControl.swift:602-629`) and matches Android (`.kt:779`). A shape guard was added (`SegmentedControl.harness.tsx:362-367`). Red: log `14-25-08`, `not six hex digits … mean=#8FAFB6EB`. |
| N4 | Resolved | `NitroUiSizingEngine.cpp:91-95` reads correctly. |
| N5 | Resolved | Progress and Slider comments on both platforms. |
| N6 | Resolved | Every citation now names `Q4-followups-triage.md` (rows 10 and 46 exist there). |
| N7 | Resolved, one leftover | `try/finally` (`Slider.harness.tsx:533-652`). See N4 below. |
| N8 | Resolved, one miscount | Stale rows explained, and the Slider flake added as a follow-up. See N5 below. |
| N9 | Resolved | `clearPixelReport()` on recycle (`HybridNitroUiSegmentedControl.swift:82, :470`). |
| N10 | Resolved | `builtMinimum`/`builtMaximum` are written under `reportLock` (`HybridNitroUiDatePicker.kt:314-322`). |

## Native changes this round

**iOS DatePicker `controlIdentity`.** The suffix is added only when `granular == builtGranular`.
- **Safety.** When it is suppressed, `granular != builtGranular`. The on-screen identity was
  `builtGranular` or `builtGranular|outside`, so the new identity differs and SwiftUI replaces the
  control. No path keeps a live control while dropping the clause.
- **Remaining rebuild.** The bounce left behind (a sub-granular bound move) is stated in the
  comment and listed as a follow-up.
- **Mode switch.** A mode change alters the granular format, so it is suppressed and rebuilds,
  which is correct.
- **What the safety argument rests on.** `builtGranular` has to describe the control on screen.
  The two points below (N1, N2) are where that could slip. Neither is a demonstrated defect.

**Android DatePicker.** The lock change is correct and matches `readReport`'s guard.

**SegmentedControl (both platforms).** The arithmetic is now identical on both platforms. `area`
is guarded upstream by the "sampled nothing" check. The recycle clear is symmetric.

**Slider / Progress.** These are comment-only changes on both platforms.

## Premises

- Every file the report and the new comments cite is in `git ls-files` at HEAD:
  - `docs/tasks/Q4-followups-triage.md` (rows 10, 27 and 46)
  - `docs/tasks/F3/base-race-gates.jsonl`
  - `example/__tests__/ColdSizing.harness.tsx`
  - `cpp/HybridNitroUiCore.cpp:76` (`seedSize(…, 0u)`)
  - `docs/research/core-architecture.md` ("the controller is kept across recycles")
- The test names the comments cite exist.
- Exceptions: `/tmp/f3b.env` and the `git log -S` instruction (N3, N5).

## Hygiene

No home paths, emails or hostnames in the branch diff or the two JSONL files. Their `logPath`s
are repo-relative. The serials and labels that do appear are the lease's (`emulator-5570`,
`nitroui_t01`, a simulator UDID) and the brief's public `maintainer-mac-1`. `emulator-5560` appears
only in the round 1 review's hygiene note.

## M — must fix

**M1. The Progress page and the `fillWidth` changeset tell app authors to choose a number they
cannot set, and label an unmeasured claim as measured.**
- **The instruction.** `docs/components/progress.md:111` says "Declare the width you would want
  that bar to be". `.changeset/fillwidth-infinite-parent-width.md:5` says the declared width "is a
  number to choose deliberately rather than a placeholder". The declaration is the library's
  `NitroUiSizing.setFallback(…320…)` at startup. Nothing in `src/` or the API report exposes it
  (`grep setFallback src etc/*.api.md` finds nothing). An app author's only lever is an explicit
  `width` style. `sizing.md` §5's version (`:334-337`) is fine, because it addresses component
  authors.
- **The "measured" label.** `progress.md:102` introduces the list with "both measured rather than
  argued". For Progress, though, the unbounded-parent width is inferred from the shared engine. Only
  the Slider has a device case for it (`Slider.harness.tsx` › `hands an unbounded parent its
  declared width…`), and `Progress.harness.tsx` has no unbounded-parent test.
- **Failure scenario.** An app author reads the CHANGELOG or the Progress page, looks for a way to
  "declare" the width, and finds none. The page also presents an inference as a measurement.
- **Fix.** Tell the app what to do: give the bar an explicit `width` if 320 is wrong for the
  layout. Say that the Progress half follows from the shared engine change and is asserted on
  Slider. Both edits are docs-only and gate-free.

**M2. Two comments still say what M2 asked to stop saying.** The round corrected the comments
round 1 named, but two siblings still contradict the new iOS assertions:
- `example/__tests__/DatePicker.harness.tsx:1283-1289` says the blindness "is `keeps the live
  control…`'s reason for saying iOS gets no rebuild assertion at all". That test now has its iOS
  rebuild assertion (`:1166-1186`), and its comment (`:1134-1153`) says the opposite.
- `ios/components/DatePicker/HybridNitroUiDatePicker.swift:208-211` (the `noteControlBuilt`
  docstring, untouched since base) says "changing an `.id(_:)` on a control that is already on
  screen can update the live one in place". The report's own M2 red proof attributes that
  observation to the pre-F3 instrument. With the handler inside the identity, the count moves on
  every re-identification, and `readReport`'s rewritten comment (`:163-170`) says exactly that.
- **Failure scenario.** The same as round 1's M2. A reader trusts the old sentence and drops or
  doubts the iOS rebuild assertion.
- **Fix.** Correct both. Both files are code-tree files, so the edit re-owes `check`, both full
  harnesses and both real-input runs. If the orchestrator would rather not pay that for comments,
  add one `FOLLOWUPS.md` line naming both locations, to land with the next DatePicker code change.
  That also satisfies this item.

## N — nice to have

- **N1. `clearBuiltBounds()` rests on a premise the host contradicts, and nothing tests it.**
  - The docstring (`HybridNitroUiDatePicker.swift:218-226`) calls recycling "the one path that
    tears [the control] down … keeps this model but not the control".
  - `NitroSwiftUIHost.prepareForRecycle()` (`ios/core/NitroSwiftUIHost.swift:301`) says "Keeps the
    hosting controller and its SwiftUI state". The new comment at `:1401-1402` says the same.
  - That leaves two cases:
    - If SwiftUI fires `.onAppear` again when the recycled host re-enters a window, the clear is
      redundant. The new mount records afresh anyway, and `controlBuilds` counts the remount as a
      build.
    - If it does not, the still-live control has `builtBounds == nil` until its next
      re-identification. In that window `controlIdentity` never adds the suffix, and the
      sub-granular crash case loses its escape.
  - The only recycle test (`starts a remount from its own default…`, `:1814`) uses a bounds-free
    `compact` picker, so it cannot tell the two apart.
  - Fix: state which case holds, measured with a bounded `inline` remount reading
    `builtMaximum`/`controlBuilds`, or drop the clear and fix the docstring.
- **N2. The record is read at appearance time, not at build time.**
  - `.onAppear { model.noteControlBuilt(minimum: model.minimum, maximum: model.maximum) }` (`:671`)
    and `builtGranular = granularBoundsIdentity` (`:215`) read the model when the handler fires.
    They do not read the values the `.id(_:)` was computed from.
  - A prop batch landing between that body evaluation and the appearance would make `builtGranular`
    describe bounds the on-screen control was not built with. That is the one input the
    suppression's safety argument depends on.
  - This is the pre-existing pattern extended to a new field, and probably unreachable on one main
    thread. Capturing the identity's own inputs in `body` and passing them to the handler would make
    "in the same breath" literally true.
- **N3.** `HybridNitroUiSegmentedControl.swift:196-197` tells the reader
  that `git log --all -S "selectedSegmentTintColor ="` "finds no such code". Now that this comment
  contains the string, that command finds `9ec044d` (this comment) and `432b2ad` (the review).
  Say "finds only this comment and the review", or drop the command.
- **N4.** The `finally` (`Slider.harness.tsx:640-651`) restores the declaration through
  `seedSizingSize`, which always writes flags `0u` (`HybridNitroUiCore.cpp:76`). So the "real
  declaration" it puts back is 351×h with **intrinsic** flags, not the `fillWidth` one
  `HybridNitroUiSlider` registers. The new comment at `:527-534` names exactly that as the poison.
  This predates the round (as does `ColdSizing`'s identical exit), and later Slider tests pass.
  Still, the comment and the code now disagree. Either say the restore is numbers-only, or add a
  flags argument to the test seam in a later task (one `FOLLOWUPS.md` line).
- **N5. Report accuracy.**
  - The fix-round race table says "5 runs: 4 pass, 1 fail" for paired runs on `18da47b8`
    (`report.md:278`). The ledger has six: `Button|HostPopups` ×4, `DatePicker|HostPopups` and
    `SegmentedControl|HostPopups`, so 5 pass and 1 fail.
  - The quoted command (`:281`) sources `/tmp/f3b.env`, a machine-local file that is not in the repo.
  - "Both are re-runnable from the committed JSONL" (`:285`) overstates the evidence. The JSONL
    records the results, but their `logPath`s point at the uncommitted `.gates/logs/`.
  - Two of the three real-input failures in the ledger are setup errors that the report does not mention:
    - `14:28:44`, simulator shut down.
    - `14:42:20`, `emulator-5570` not on adb 5041.
    They are harmless, but a reader of the table will wonder.
