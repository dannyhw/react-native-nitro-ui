# X2 — Gate ledger: review (round 1)

**Reviewed:** `task/X2-gate-ledger` at `0ace332` against `main` at `cdcd6a8`. Read the brief, the
report, `gates.jsonl`, `gate-core.mjs`, `gate.mjs`, `gate.test.js`, the `AGENTS.md` /
`REPORT-TEMPLATE.md` changes and X1's `app-stamp*.mjs`. `bun run check` was not re-run: the
ledger's `check` pass is on the current code tree (verified, `currentCodeTree()` = `f4fccfdabe6f`,
504 files), and only docs were committed after it. No devices were used. I reproduced the findings
in a throwaway detached worktree, using a fake `node`/`bun` on `PATH` that prints a jest summary
and exits 0. That worktree and its probe branches have been removed.

## Verdict: FIX ROUND

The core is sound. The ledger is keyed to the X1 code tree, and docs commits really do leave a green
gate green (I verified this on the live tree). A red result after a pass reads red, a pass on
another tree reads stale and never green, benches are never required, and the generated table
will not print PASS for another tree. Unmapped paths counting as both platforms is the right call.
The package is untouched: `npm pack --dry-run` lists 465 files, identical to
`etc/package-files.txt`, and the diff touches no packed path. I found no personal info.

There are two real problems. First, `need` can be satisfied by a filtered run (M1). Second, the
fix-round rule, which is the payoff the brief exists for, does not happen for any task that touched
both platforms (M2). Both are bounded fixes, and M3 and M4 are small enough to go in the same
round.

## Must fix

**M1 — A filtered harness or real-input run is recorded under the full gate name and satisfies
`need`.** `gate.mjs:446-461` passes everything after `--` (or every argument, when there is no
`--`) to `resolveGate`, which appends it to the command (`gate-core.mjs:594`, `:618`). The run is
then recorded as `command`, the bare gate name (`runGate(command, …)` at `gate.mjs:461`, written at
`:216`). The file's own usage example (`gate.mjs:7`) is exactly this form.
*Reproduced:* `gate.mjs harness:android -- ColdSizing` writes
`{"gate":"harness:android","command":"node ../scripts/harness.mjs --harnessRunner android ColdSizing",…,"result":"pass"}`.
Likewise, `gate.mjs real-input:android -- --control switch` writes `"gate":"real-input:android"`.
Both rows then show as green in `need --for review|merge` and print `**PASS**` in the table. This
is the "single suite does not satisfy the platform gate" rule the tests claim
(`gate.test.js:448`). It holds only for the `harness:android:ColdSizing` spelling.
*Fix:* `resolveGate` should return a canonical `gate` name that includes any filter:
`harness:<p>:<args…>` and `real-input:<p>:<args…>`. A bare platform name should be possible only
with no extra arguments. Reject extra arguments to `check`, which today silently drops them
(`gate-core.mjs:578-585`). Record the name `resolveGate` returns, not `argv[0]`. Add a test that
`resolveGate('harness:ios', ['ColdSizing']).gate !== 'harness:ios'`, plus the same for
real-input.

**M2 — A fix round re-runs every platform the *branch* touched, not the platforms the *fix*
touched.** `changedCodePaths` diffs against the merge-base with `main` (`gate.mjs:126-146`), and
`gateStateFor` accepts only an exact full-tree match (`gate-core.mjs:238-244`). Any fix-round
edit changes the tree. So for a branch whose round 1 touched `ios/` and `android/`, an Android-only
fix leaves `harness:ios` stale, and `need --for review` asks for it again. That also means an
iOS rebuild, because the stamp is now stale too.
*Reproduced:* round 1 touched one `.kt` and one `.swift` file, and `check`, `harness:ios` and
`harness:android` were all green. Then the fix appended one line to the `.kt` file, and `check` and
`harness:android` were re-run green. Result: `✗ harness:ios — passed on tree 620eb485d166 …, which
is not this code tree: re-run it`, and `need: 1 gate(s) missing for review: harness:ios`.
The brief (item 2) and the process review (§3: "fix rounds run the touched platform and suites
only, plus `bun run check`") ask for the opposite. `AGENTS.md:76` now tells agents that it already
works this way. The test *an android-only diff needs android only* (`gate.test.js:295`) passes only
because it injects `touchedPlatforms`; nothing exercises a both-platform branch with a
one-platform fix.
*Fix (suggested):* record per-platform digests next to `tree`. `trees.ios` and `trees.android`
would each be `codeTreeDigest` over the code files whose `platformsTouchedByPaths` mapping includes
that platform (shared and unmapped files go in both). Build them in `gate.mjs` from
`git ls-files` plus `isCodeFile` / `contentHash` / `codeTreeDigest` from `app-stamp-core.mjs`, so
neither `build-app.mjs` nor `app-stamp.mjs` changes. At `review`, a passing `harness:<p>` is green
when `trees[p]` matches. `check` and the whole `merge` stage keep the full-tree match, so merge
still needs every gate once on the final tree. Add a test of the reproduced scenario, and correct
`AGENTS.md:76` if the rule ends up different.

**M3 — `check`'s counts cell reports the perf step, and the new rules forbid correcting it by
hand.** `parseTestCounts` keeps the last summary (`gate-core.mjs:479-496`), so the table says
`check | PASS | 7 tests / 7 suites` (from `perf:renders`). The unit-test step in the same log
actually ran 391 tests / 23 suites. Meanwhile `AGENTS.md:81` says "do not write a gate result into
a report that the table does not print". The result is that the one number a reviewer uses to
notice a deleted or skipped unit-test suite is gone, and the report is told not to add it back.
*Fix:* store every summary in order (`counts: [{suites, tests}, …]`, or `counts` plus `steps`),
and render the first one for `check` (jest runs before perf). Sum the failures across steps so a
red row still leads with them. The implementer already lists this as a follow-up; it is a few
lines and belongs in this round.

**M4 — Rename detection hides a removal from a platform directory.** `git diff --name-only`
follows renames by default and prints only the destination (`gate.mjs:136-137`).
*Reproduced:* `git mv ios/components/Button/HybridNitroUiButton.swift bench/attic/` produces
`need: … touches no platform-specific code`, with only `check` required. The commit removes an
iOS source, but no iOS gate is asked for. The same happens for a move into `docs/` or any other
non-code path.
*Fix:* pass `--no-renames` to both `git diff` calls, and add a test, which needs the diff
arguments to move into core or a temp-repo test (see N6).

## Nice to have / follow-up

- **N1 — A run whose tree moved mid-run still counts for the starting tree**
  (`gate.mjs:211-240`). Metro serves the edited JS, and jest reads files lazily. So an edit made
  during a run, then reverted, leaves a green result for code the run did not entirely see. Record
  `treeAfter`, and make a line non-green when it differs from `tree`. Today the only sign is a
  stderr note.
- **N2 — Taking the latest line per gate regardless of tree blocks more than it should**
  (`gate-core.mjs:217-224`). A pass on T1, then a fail on T2, then a revert to T1 reads `red`,
  even though the latest result on T1 is a pass. Prefer the latest line whose tree is the current
  one, and fall back to the latest overall only for display. This cannot create a false green: a
  later fail on T1 still wins. It also covers the implementer's "FAIL row has no (not this tree)
  marker" follow-up (`gate-core.mjs:418-423`). Today a red from an older tree prints `**FAIL**`,
  which reads as "the current code fails".
- **N3 — The platform map is coarser than the paths allow** (`gate-core.mjs:104-122`).
  `example/ios/**` (Podfile, Podfile.lock, the Xcode project) falls through to both platforms,
  while `example/android/**` maps to Android only. `nitrogen/generated/{ios,android}/**` maps to
  both. Mapping these to their own platform is free precision, and `nitrogen/generated/shared/**`
  stays both.
- **N4 — Signals are not forwarded** (`gate.mjs:189-206`). If a timeout or the task runner sends
  SIGTERM to the `gate.mjs` PID, the parent dies without a line, which is correct. But the harness
  or real-input child is orphaned while it still holds the leased device. Forward SIGINT and
  SIGTERM to the child before exiting.
- **N5 — `summarizeLoad` rounds `median` and `max` but not `start`** (`gate-core.mjs:448-464`), so
  the committed lines carry `"start":13.54443359375`. This is cosmetic.
- **N6 — No test reaches `gate.mjs`.** M1 and M4 both live in the CLI layer (argument parsing to
  gate name, and the diff command), which the 36 core tests cannot see. Moving the gate-name
  canonicalisation and the diff argument lists into `gate-core.mjs` would put them under the same
  tests. Alternatively, one temp-git-repo test of `changedCodePaths` would do.
- **N7 — The fix-round template leaves the summary's gate table stale**
  (`REPORT-TEMPLATE.md:17`). "Append ≤ 200 words" plus "do not re-report gates" means the only
  table in the report is round 1's. Since the table is generated and not prose, say "paste a fresh
  `gate.mjs table` in the fix-round section", and put the `need --for review` line beside it.
- **N8 — The report's "Files changed" bullet for the test file is a paragraph,** while the template
  says "Paths, not narratives" (`REPORT-TEMPLATE.md:52`). This is minor. Otherwise the report fits
  the template: the summary is 355 words, the table is generated, and red proofs are one line each.

## Rules, docs and tests

- **The `need` rules against the brief.** `merge` (check, full harness on both, real-input on both,
  on one tree) is right. Benches are never required, and suites and smoke runs are never a
  substitute for the full set. The review rule, check plus the touched platforms, is right in
  shape but wrong in its baseline (M2). Counting unmapped code as both platforms is the correct
  deviation. A ledger that asks for nothing when `patches/` or `example/src/` moved would be a
  machine-made false claim. The cost is only on tooling diffs (see the answer below).
- **`AGENTS.md` / `REPORT-TEMPLATE.md`.** Both are clear and short. They require the template, send
  gates through `gate.mjs`, and replace the hygiene boilerplate with "report an incident, else the
  lease id". The evidence a reviewer needs survives: the committed `gates.jsonl` carries the
  command, HEAD, lease, serial and log path per run. The table shows result, counts, tree,
  duration and load. Two things undercut this. The `check` counts (M3) and the filtered-run naming
  (M1) are the two places where "paste the table, don't type" currently prints the wrong thing.
  And `AGENTS.md:76` describes the fix-round behaviour M2 says is missing.
- **Tests.** The tests are good on the decisions: the four gate states, append order over clock,
  both stages, bench exclusion, the table refusing PASS for a stale tree, counts and load parsing,
  ledger path collisions, and lease and serial recording without an AVD name. The listed
  mutations line up with the tests that should catch them. The gaps are the ones above. The CLI
  layer is untested (N6). *Appends a suite … after `--`* checks argv but not the recorded name,
  which is exactly M1. And the fix-round test injects its platform list instead of deriving it
  (M2).
- **Ledger robustness.** Ledgers are per worktree (`<worktree>/.gates/`), so two worktrees never
  share a file. Two gates run in parallel in one worktree each do a single `O_APPEND` write of one
  short line, which is safe on a local disk. If `gate.mjs` itself is killed, it appends nothing, so
  the previous word on that tree stands, which is correct. A process that fails to start, or a
  child killed by a signal, is recorded as `fail`. A half-written line parses as `corrupt` and
  shows up in `status`. Load sampling (one at start, every 15 s, one at the end, median and max) is
  what R4 asked for.

## Answer to the implementer's question

> Is a round 2 for a `tooling` path class plus keying `check`'s counts to its jest step worth it?

Yes, but as part of the fix round that M1–M4 already require, not as a round of its own. Counts
are M3. Make the tooling class an **explicit allow-list, not `scripts/` wholesale**. Device runs
import a lot of `scripts/`:

- `example/rn-harness.config.mjs` imports `app-stamp*.mjs`, `lease-core.mjs`, `node-version.mjs`
  and `harness-timing-gate.js`.
- `example/metro.config.js` requires `harness-timing-gate.js`.
- `scripts/real-input/**` is the real-input gate itself.
- `scripts/harness.mjs`, `build-app.mjs`, `pod-install*.mjs` and `patch-nitrogen.mjs` shape the
  binary or the run.

Those must keep asking for both platforms. Reasonable "check only" members are:
`scripts/__tests__/**`, `scripts/gate*.mjs`, `scripts/bench/**`, `scripts/perf/**`,
`scripts/smoke/**`, `scripts/{nitrogen-check,readme-examples-check,package-files,release-catch-up,check-autolinking}.mjs`,
`eslint-rules/**`, `etc/**`, `.changeset/**`, `.gitignore` and `.prettierignore`. Anything else
stays unmapped and counts as both. With M2's per-platform digests, tooling files simply stay out of
both platform digests, so the two changes fit together. X2's own diff would then need only `check`
at review. Whether X2 needs the device pair at merge is a call for the orchestrator. Under the
brief's merge rule it does, and nothing in this diff reaches an app binary.
