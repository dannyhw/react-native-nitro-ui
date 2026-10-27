# X3 Re-review — Component registry, fix round 1

**Branch:** `task/X3-component-registry` at `dbc3380` (code tree `40c26c7535df`) · **Base:** `dc13833`
**Reviewed:** `git diff 0ed30fd..HEAD`, the 14 commits after the review commit. I also read the
brief, the first review, the report's `## Fix round 1` and the sections it rewrote, the step-6
scripts and logs in `/tmp`, and `gate.mjs status`.

## Verdict: MERGE WITH FIXES

The code is right. M1–M4 are fixed, and each new test goes red on its own; I mutated and reverted
eight of them myself (table below). The shipped files are byte-identical to `main`'s.
`merge=union` covers only `nitrogen/generated/**`. That is the right boundary, because nitrogen
deletes stale files and `nitrogen:check` compares the whole tree. The branch still merges cleanly
into `main`'s tip: `git merge-tree` reports no conflicts.

One must-fix is left, and it is a claim, not code. The report's step-6 table says that `check` on
the merged tree showed "zero test failures caused by the merge", and CONTRIBUTING repeats it. The
script the report cites for that claim never reads an exit status, so its log cannot support it.
Withdraw the sentence or re-measure it, then fix the N items. None of this needs another review
round or another device run: the edits are to docs, test comments and one error string, and none
of them touches a platform half.

## Must fix

**M1. The claim that the full suite after the merge showed "nothing the merge broke" has no
evidence. The script cited for it is broken.**
Report `:145` ("`bun run check` after the recipe | … **zero test failures caused by the merge**"),
`:150-154` ("16 failures … contains **nothing** that was not already red on a parent"), `:180`;
`CONTRIBUTING.md:244-245` ("with the full test suite showing nothing the merge broke").
- **What the report cites:** `/tmp/x3-n5b.mjs` "(gates red after a merge)" and its log
  `/tmp/x3-n5b-gen.log`.
- **Why that script cannot support it:** `x3-n5b.mjs:47` runs
  `` `{ ${cmd} ; } ; echo "EXIT:\\$?"` ``. The template literal hands bash `\$?`, so the script
  prints the literal `EXIT:$?`. I confirmed this with the same `execFileSync` call. The regex then
  falls back to status `1`, so every gate counts as red. The jest JSON never parses either, so
  every run logs `jest: no report`.
- **What the log shows:** exactly that. It lists `nitrogen:check: no drift` and
  `registry:check: OK` as red. Taken at face value it also says "red: 6 (3 not already red on a
  parent branch)", which contradicts the report.
- **What survives:** the "16 failures" number appears in no surviving log.
  `/tmp/x3-n5-generated.log` does support "typecheck clean": `tail -3` printed only `$ tsc`. Its
  subset of three suites shows 8 failures on the merged tree against 6 on one parent. That is
  consistent with the claim, but it is not the full suite and not `check`.
- **Failure scenario:** the orchestrator reads the step-6 row as proof that the recipe is
  regression-free under `check`. That is the exact gap N5 of the first review raised, and the claim
  rests on a measurement that recorded nothing.
- **Fix:** either fix the exit capture (`echo "EXIT:$?"`) and re-run, or reduce the row and the
  CONTRIBUTING sentence to what the logs show: `registry:check` OK, `tsc` clean, 0 of 104 entries
  lost. Docs only.

## Nice to fix

**N1. The merge recipe and the add-a-component checklist miss a hand-written per-component
table.** `bench/src/implementations/shared.ts:15-21` (`ROW_HEIGHTS`, keyed by `ComponentName`) is
not in `CONTRIBUTING.md:164` (`bench/src/implementations/*.tsx`), and not in the "Four things are
inputs" list at `:223`.
- **Evidence:** `bench:typecheck` is red on both step-6 parent branches
  (`TS2741: Property 'gauge' is missing`, `/tmp/x3-n5b-gen.log`). The fake controls never added a
  row there, so step 6 never saw this file conflict.
- **Failure scenario:** two benched controls each add a row, so `shared.ts` conflicts. The recipe
  says to take either side, `bench:typecheck` then fails, and nothing in CONTRIBUTING says why.
  Name it as a fifth input.

**N2. Leftovers of the false premise behind M1 of the first review: "nitrogen emits" an
autolinking shape.** Nitrogen writes `nitro.json` only from `init`.
- **Where it survives:** `registry.test.js:621` ("what nitrogen itself emits"), `:683` (test title
  "accepts either shape nitrogen emits"), `:686` ("nitrogen's business"), and the report at `:91`
  and `:102` ("because nitrogen emits either").
- **What is true:** nitrogen *reads* either shape. A hand-written entry, or `nitrogen init`, is
  where an `all` shape would come from. `checkAutolinking`'s own comment already says this
  correctly (`registry-core.mjs`, "A hand-written entry may be…").

**N3. A stray autolinking entry: the test comment and the error message say the wrong thing.**
- **The comment:** `registry.test.js:545` says "`--write` drops it". I added a `NitroUiDeleted`
  entry to `nitro.json` and ran `gen-registry --write`. It refused, named the entry, and left it
  in the file, which is what the test title says. Fix the comment.
- **The message:** `registry-core.mjs:1038` tells the user to "delete the component, or add its
  …component.json". Now that the registry owns the section, a contributor who has just deleted a
  component reads "delete the component" and has nothing left to do. The step they actually need
  is "remove its entry from `nitro.json`".

**N4. Report accuracy and formatting.**
- **Broken table:** the step-6 table is cut by the "The 3-file gap…" paragraph (`:137-140`), so
  rows `:142-145` render as loose text.
- **Duplicated line:** `need --for review` is printed twice (`:257`, `:260`).
- **Stale lease:** the header lease is `X3-rd5ku`, but every fix-round gate ran under `X3-yxfam`
  (`gate.mjs status`).
- **Proof 27's count:** the proof says "eight tests red". Removing `keep` turns ten red for me
  (registry.test.js plus component-coverage.test.js, all ten in registry.test.js).
- **A misplaced citation:** the `livePresentations` sentence is quoted as
  `HybridNitroUiDatePicker.kt:263`. That line is the declaration; the quoted words are at `:1119`.

**N5. Step 6 ran on `c47f859`, not "this branch's tip".** The source is
`/tmp/x3-n5-generated.log:1`. Commits `5f6c189` (sizing refusal, quote-safe strings) and
`6697f1f` (tests) landed after it. Neither can change the counts, but say which commit was
measured.

**N6. Process: the fix round rewrote the round-1 report in place.** It touched the summary, the
step-6 section, the red proofs and the follow-ups, where AGENTS asks for an appended
`## Fix round N` of 200 words or less. The appended section is 198 words. The in-place edits are
mostly the false-claim removals that M3 of the first review asked for, which is defensible, but
the report no longer shows what round 1 claimed. I note it for the orchestrator and do not ask for
a change.

## What I verified

**M1 (nitro.json generated).** `regionsFor` now writes `nitro.json`'s `autolinking` as an anchored,
shipped, block-shaped region. It keeps `NitroUiCore` and `NitroUiHost`, copies existing entries and
moves commas with `jsonSeparator`. `regen` is registry → nitrogen → registry. The scratch-tree test
`--write completes for a component that has no entry in nitro.json yet` passes, and goes red when
the cross-check reads disk. CONTRIBUTING `:180-200` and the header of `registry-core.mjs` now say
that nitrogen only reads the file. Every site the first review named (`.prettierignore`,
`registry-core.mjs:30-32`, CONTRIBUTING `:190`) is corrected.

**M2 (unhostable import).** I reproduced the original failure path. Switch set to
`hostable: false`, its row moved into `UNHOSTABLE_CONTROLS`, then `bun run registry`: the import
stays (`HostChildren.ts:30`) and `tsc` is clean. Reverted.

**M3 (false claims).** The `.g.h` file, the "C++ host children", the `prepare` claim, the brief
SHA and the coverage-hang reason are all gone or corrected. Every SHA the fix round names exists:
`bbc5e0d`, `6ac3bf2`, `d598e47`, `6697f1f`, `2402c0a`, `dc13833`. So do the `/tmp` scripts and
logs it names. "22 regions in 14 files" and "5 anchored shipped files" match `regionsFor`. The
ledger is green for `check` and both harnesses on `40c26c7535df`, which is HEAD's tree.
`git diff 2402c0a..HEAD` over the platform paths is empty, as claimed.

**M4 (new tests go red alone).** One mutation in `registry-core.mjs` at a time, with
registry.test.js and component-coverage.test.js run after each, reverted with
`git checkout -- .`:

| mutation | red (only) |
| --- | --- |
| `if (false && current != null …)` on the shipped copy rule (`:537`) | `an entry already in a shipped region is copied, not re-rendered` |
| stray-entry loop over `[]` (`:1035`) | `names an autolinking entry no manifest declares…` |
| sizing parse refusal disabled (`:919`) | `a sizing table that no longer parses is refused…` |
| autolinking check reads disk, not the plan (`:1273`) | `--write completes for a component that has no entry in nitro.json yet` |
| imports region back to `where('hostable')` (`:666`) | `a control that stops being hostable keeps its import` |
| `quoteSafe` check off (`:229`) | `rejects a label or title the generated line cannot carry` |
| `jsonSeparator` off (`:559`) | `--write completes for a component…` |
| `keep` → `false` (`:643`) | 10 tests (see N4) |

**The N items the fix round claims.**
- **N1:** fixed; covered by the sizing row above.
- **N2:** fixed. The duplicate paragraph is gone, and `nitro.json` and the sizing table are no
  longer `linguist-generated`. The file now points at `nitrogen/generated/.gitattributes`
  (`** linguist-generated=true`), which nitrogen writes (`createGitAttributes.js`).
- **N3:** fixed. `checkSizingTable` is deleted, and `checkRealInputRows`' docstring is corrected.
  `checkRealInputRows` still runs only from `component-coverage.test.js`, which is in `check`;
  that is acceptable.
- **N6:** fixed; CONTRIBUTING `:246-252` attributes the gates.
- **N7:** documented as "set, not order" at `smoke/App.tsx:63` and `smoke/lib.mjs:39`.
- **N8:** fixed.

**`merge=union`.** `.gitattributes` applies `merge=union` only to `nitrogen/generated/**`.
- **It covers only regenerated output:** `bun run nitrogen` (nitrogen plus `patch-nitrogen.mjs`)
  rewrites the tree, and nitrogen removes files it no longer emits
  (`node_modules/nitrogen/lib/index.js:107-112`). `nitrogen-check.mjs` compares the full listing.
  So anything union produces is overwritten or caught.
- **Nothing else is marked:** no shipped anchored file, no JSON file, no region in a hand-written
  shell. The stated reason for leaving the JSON files out, that union drops the comma before an
  appended member, is correct.
- **The recipe:** CONTRIBUTING's "Merging two components" is correct apart from N1. Take either
  side of the generated files, keep both sides of `src/index.ts`, the bench arm,
  `testRealInput<Name>` and `CHECKS`, then run `regen` and `check`. One edge it does not mention:
  if only `nitrogen/generated/**` would have conflicted, git auto-commits the union result. The
  `.gitattributes` comment's "after any merge, run `regen`" plus `nitrogen:check` in CI covers it.

**Byte identity.**
- **Against the merge-base:** `git diff --stat main...HEAD -- $(cat etc/package-files.txt)` shows
  `package.json` only (the `!**/component.json` exclusion and three scripts).
- **Generated shipped files:** `nitro.json`, `nitro-ui.sizing.json`, `HostChildren.ts`,
  `NitroUiPackage.kt`, both `NitroUiDeclaredFallbacks` and `NitroUiDeclaredFallbacksLoader.m` show
  0 diff lines against `main...HEAD` and against `main`'s tip.
- **Against `main`'s tip:** the only extra difference is `README.md`, from `main`'s own commits.

**Regression run.**
- `bun run registry:check`: OK (7 components, 15 files).
- `bun run typecheck`: clean.
- `jest scripts src/__tests__/host.test.tsx src/__tests__/viewConfigs.test.ts`: 430 of 430, 17
  suites.
- After every mutation, `git status` was clean apart from this file.
