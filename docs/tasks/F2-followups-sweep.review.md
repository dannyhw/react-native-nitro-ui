# F2 review — follow-ups sweep

**Branch:** `task/F2-followups-sweep` @ `5bd780f` (base `main` @ `747debc`) · **Reviewer round:** 1

## Verdict: MERGE WITH FIXES

Every brief item is done, closed with a reason I could check, or skipped with a FOLLOWUPS line.
`bun run check` passes on the tip (16/16, re-run by the reviewer, foreground). `gate.mjs need --for
review` is satisfied, with `harness:ios` and `harness:android` green on this code tree. The commits
after the gated tree touch only docs. Both must-fixes are wording: one FOLLOWUPS line understates
what is already covered, and one new Kotlin comment contradicts the paragraph right after it. M2
changes a file in the Android half, so it costs one `harness:android` re-run. No device is needed
for M1.

## What I verified

- **Premises the report leans on.**
  - *"prospective" was never in sizing.md:* true. `git log -S prospective -- docs/architecture/sizing.md`
    returns nothing. The word comes from T14's report (`T14-early-fallbacks.report.md:275,387`),
    which describes sizing.md's "asked to measure again" claim. The rewritten paragraph
    (`sizing.md:270-277`) names the real asks, and both exist:
    `NitroComposeHost.kt:1262-1273` (dedupe reset, `overWidePlacement.reset()`, token bump) and
    `NitroSwiftUIHost.swift:203-215` → `invalidateContentSize()` → `refreshContentSize()` →
    `reportToSizingEngine`.
  - *S2 already covered at `Host.harness.tsx:1126`:* true. The test
    `applies a value written while the hosted child was hidden` (line 1124, blamed to `6028511`)
    writes while the child is `display: 'none'`, shows the child, and asserts the next press asks
    for `false`. That is F10's second bullet word for word. Q4's citation
    (`HostPopups.harness.tsx:1126-1146`) is the dialog test, as the report says. See M1 for what
    the new line gets wrong about the *other* direction.
  - *Row 25 audit:* `useSizingId(<config>)` appears only in Progress:182, Picker:291 and
    DatePicker:315. Their `key=`s are at the cited lines (195, 348, 321). The other four call
    `useSizingId()`, and `useSizingId.ts:32` allows omitting the argument for a view that is never
    replaced.
  - *T11 minors line:* `NitroUiSizingEngine.cpp:262-276` treats an empty initial signature as
    "changed" (`environmentSignature_{}` in the `.hpp`), and `:525-535` drops a report with no
    ledger entry and leaves no trace. Both are accurate. Calling each fix a behaviour change, and
    skipping them, is reasonable.
  - *S1 annotation:* there is no `docs/tasks/S1-storybook/gates.jsonl`. `c21d754` (gate ledger,
    2026-10-26) postdates `12f67e9` (S1 report, 2026-10-24). The A2 quote matches
    `A2-small-fixes.report.md:176-178` verbatim. The annotation is placed after the table rather
    than rewriting the row, as the brief asked.
  - *C1 N1 caption:* I looked at `docs/tasks/C1-android-overwide/android-after.png`. Row 1 shows
    four `…` segments. Row 2 shows January / February / March / April in full. The Button reads
    `A title far too…`. The caption now matches the image.
  - *slider.md:* the T15 Finding 2 table (`T15-real-input.report.md:162-182`) shows four
    off-thumb gestures with 0 callbacks, and the thumb drag with 1 / 40 / 1. The two call-site
    strategies match `android.mjs:969` and `RealInputTests.swift:95-99`. The "open product
    question" is T15's question 2 (`:243`).
  - *Bench comment:* `implementations/index.ts:66-80` lists all seven components, and
    `BenchApp.tsx:160-175` records the `skip`. The comment is now true.
  - *"Only button.md has a captured pair":* true. Only `button.md:77,81` embed a light/dark
    pair. The DatePicker story's old pointer at `date-picker.md` was false, so the extra commit
    is justified.
  - *The 05:45 red:* the full log in the store has
    `cold: box=61.00x28.00 content=null trace=[…"corrected:61.0x28.0"]` at line 26, and the
    ledger's load start is 50.78. The report's reading is right (see N2 for where the evidence
    is kept).
- **Red proofs.** I ran both as behavioural mutations, which is stronger than what the report
  claims for one of them, and restored both files afterwards:
  - removing the `POD_INPUTS_RECORD` entry from `iosCleanTargets` turns
    `also drops the record of what the last pod install saw` red
    (`Received array: ["/repo/example/ios/build"]`);
  - setting `EXCLUSIVE_TTL_MINUTES` to 240 turns `lease.test.js:1117` red (`Expected: >= 840,
    Received: 240`). The old `ttlMinutes * 60 >= 14` would have passed at 240, so the new
    assertion is the fix.
- **Package.** `npm pack --dry-run` lists 465 files, identical to `etc/package-files.txt`, and
  `manifest:check` agrees. The only changed file that ships is `NitroComposeHost.kt`, with
  comments only. None of the tooling changes ship.
- **Public-repo safety.** The added lines contain no home path, email, hostname or personal
  device name. Excerpt paths are scrubbed to `~`/`<repo>`/`<store>`, and the simulator names are
  model names. The full simulator UDID in `F2/gates.jsonl` and `F2/failures/*` has precedent in
  five exported ledgers on `main` (F3, H2b, X11, X3, X6). It is a per-install random id, not a
  personal identifier, and I agree it is fine. Commit author: the repo's own identity only.
- **harness.mjs labels.** `bunScriptName` maps the four `example/package.json` scripts correctly.
  A filtered `harness:android -- ColdSizing` would be labelled `harness:cold:android`, which is
  harmless.

## Must fix

- **M1 — `docs/tasks/FOLLOWUPS.md:43` (and the report's "F10's shown→hidden half is still open"):
  understates the coverage.** The line says "uncovered is shown → hidden after mount … in both
  existing cases the child is hidden from its first frame." But
  `HostPopups.harness.tsx:1135` (`does not reopen a dialog that a hidden child left behind`)
  mounts a shown DatePicker, opens its dialog, hides the child with `setDateHidden(true)`, and
  asserts `livePresentations === 0`. That is a drawn child leaving the composition after mount.
  What really has no test is the *drawing/hit-test* half: after a row is hidden, a press sweep no
  longer reaches it. Say that, and cite `HostPopups.harness.tsx:1135` as the partial coverage, so
  the next task does not duplicate it or treat the direction as untested.
- **M2 — `NitroComposeHost.kt:1511-1516`: the new N2 comment overstates and mislabels.**
  - "[armed] is the one snapshot value read here" is false. The same block reads
    `remeasureToken.value` (`:1558`), and the paragraph right after it says so ("which this
    block already reads").
  - "the only recomposition this read can cause": a read inside the measure block causes a
    *re-measure* of this node. It is the composition-scope read at `:1496` that restarts the
    group.
  - "every write is a verdict" leaves out `reset()`, called from `onLayout`,
    `onConfigurationChanged` and `drop`, which writes `false` outside any pass. The idempotence
    argument still holds, because `false → false` is not a state write.

  Suggested wording: "the one *placement* value read here that is snapshot state", "re-measure"
  in place of "recomposition", and "every write from a pass is a verdict". This is the precision
  N2 was raised about, in shipped source. It is comment-only, but it moves the Android tree, so
  re-run `harness:android` (or fold it into the orchestrator's merge-time run).

## Nice to have

- **N1 — report `:62`:** the `iosCleanTargets` red proof is "delete the helper → TypeError",
  which proves the import and not the behaviour. Replace it with the mutation above (drop the
  record from the list → `Received array: [".../build"]`). Also, nothing tests that `buildIos`
  *uses* the helper: reverting `build-app.mjs:311-318` to `removeIfPresent(derivedData)` stays
  green. That is acceptable for a script, but say so.
- **N2 — report `:52-55` / FOLLOWUPS:** the report's diagnosis of the 05:45 red rests on the
  `cold:` trace line. That line is only in the store log (line 26 of 199). The committed excerpt
  keeps the last 150 lines, so the evidence is not in the repo. Quote the line in the report.
  Also record the flake: `Sizing · lays a cold Switch out…` read `measureContent()` as `null` at
  load ≈50, and S1 saw the same test fail at load 108. No FOLLOWUPS line tracks it, and it
  belongs in the F1 determinism group (for example, wait for the hybrid ref before reading).
- **N3 — `C1-android-overwide.report.md:242,333`:** the report still says "at the end of the
  traversal", which C1's re-review N4 named (as `report.md:240/:331`). FOLLOWUPS:37 calls N4
  fixed. Either add a one-line pointer to the corrected `core.md` text, or say that the report
  text is left as history.
- **N4 — `docs/architecture/core.md:419-423`:** "One clipped frame is therefore the
  `markDirty()` case only" holds for a control that is *already armed*. A prop change that makes
  a never-armed control overrun for the first time goes through the same `NO_REVISION` hop as a
  cold mount (`armedAtComposition` is false at `:1496`), so it also costs two frames. The stated
  cause ("not yet placing at the box") is really "the composition was not armed, so it did not
  read `contentRevision`".
- **N5 — `FOLLOWUPS.md:37`:** the N5 citation `NitroComposeHost.kt:1259-1270` stops before the
  bump. The function is `:1262` and the bump is `:1273`.
- **N6 — `bench/src/types.ts:66`, `bench/src/BenchApp.tsx:158`:** both still give "T16's
  `nitro-ui-host`, Switch only" as the example, in the present tense. They are attributed to
  T16, so the wording is not false, but "as T16's arm once was" would stop the next reader from
  re-raising H1's comment finding.

## Owner decisions needed

None.
