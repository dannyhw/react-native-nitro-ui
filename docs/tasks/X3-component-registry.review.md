# X3 Review — Component registry

**Branch:** `task/X3-component-registry` at `22913ed` · **Base:** `dc13833` (merge-base with `main`)
**Reviewed:** `git diff main...HEAD` (9 commits); the brief; the report; `registry-core.mjs`,
`gen-registry.mjs`, both new test files, every edited list, CONTRIBUTING, `.gitattributes`.

## Verdict: FIX ROUND

The generator, the drift gate and the coverage tests are mostly well built. I mutated the worktree
and confirmed that a hand edit inside a region, a manifest edited without regenerating, a re-sort, a
dropped terminator, ignored append order, a lost working-copy accumulation and a renamed bench-arm
branch all go red. The shipped package is unchanged except `package.json`: no path in
`etc/package-files.txt` other than `package.json` differs from base. `component.json` is excluded,
and `viewConfigs.test.ts` sits under `__tests__`. I checked this at source level and did not rebuild
the tarball. The ledger agrees: `need --for review` is satisfied on `b3a9b03569f7`.

Four things block a merge:

- The brief requires the generator to write `nitro.json`. The reason given for skipping it is false.
- The `hostable: false` path breaks a shipped file.
- Several claims in the report rest on things that do not exist.
- One headline red proof does not prove what it says.

**Does it meet the goal? Partly.** Step 6 counts 18 conflicted files before and 18 after, and the
report says so honestly. The gain is real but narrower than "cheaper merges". After a merge, the fix
is now mechanical: take either side of each generated file, hand-merge three files, run `regen`.
`registry:check` then proves the result in 0.2 s. Nothing in the design lowers the conflict count,
though. Every list appends at its end, so two branches always collide on the same line. The three
hand-merged files include `nitro.json`, which only needs hand-merging because of M1. See N4 for a
config-free way to actually cut the count.

## Must fix

**M1. `nitro.json` is not generated, and the reason given is false.**
`scripts/registry-core.mjs:30-32`, `:857-860`; `CONTRIBUTING.md:190-192`; report `:25`.
- **The claim:** "nitrogen owns `nitro.json`, rewrites it on every run, orders entries by
  spec-discovery order", so a second writer would fight `nitrogen:check`.
- **Why it is false:** nitrogen never writes `nitro.json`. `node_modules/nitrogen/lib` writes it only
  in `init.js`. `nitrogen-check.mjs:93` passes it as `--config`, an input. And
  `KotlinHybridViewManager.js:16` and `SwiftHybridViewManager.js:16` throw when a view is missing
  from it. CONTRIBUTING contradicts itself: `:217` and `:158` call it an input that nitrogen reads.
- **Why it matters:** brief item 2 lists `nitro.json` `autolinking` first. Because it is not
  generated, step 6 leaves it as one of the three files a human must merge by hand. It lost 3 of 10
  lines on "take either side" in both merge orders.
- **Failure scenario:** two component branches merge, and the human keeps one side of `nitro.json`.
  nitrogen then throws for the other side's view and `regen` stops, which is the follow-up the
  report itself hit.
- **Fix:** generate `autolinking`, appending to it the way the sizing table does. Byte-identity
  holds, since existing entries keep their place. Order `regen` as registry → nitrogen → registry,
  or have the registry write `nitro.json` first. Then correct the three docs sites.

**M2. `hostable: false` makes the generator delete an import a shipped file needs.**
`scripts/registry-core.mjs:388-406` (anchored run) and `:561-570` (the `HostChildren.ts` imports
region).
- **The documented path:** `HostChildren.ts:66-83` says the next control "starts here, refused" in
  `UNHOSTABLE_CONTROLS`, and that needs the component imported.
- **Reproduced:** set Switch to `hostable: false` and move its row into `UNHOSTABLE_CONTROLS`.
  `bun run registry` then removes `import { Switch } from '../Switch/Switch';`, because it sits in
  the anchored run and its key is no longer wanted. After that, `tsc` reports
  `HostChildren.ts(82,4): error TS2552: Cannot find name 'Switch'`.
- **The only workaround:** separate the import from the run with a blank line or comment. That is
  undocumented, and the import sorter or a reviewer may undo it.
- **Fix:** have the imports region want every manifest that appears in either table, or every
  manifest. Then add a test that flips a manifest to `hostable: false`.

**M3. The report and comments rest on files and behaviour that do not exist.** This is the
brief-flagged premise check.
- **A file that does not exist** (report `:130-133`). The follow-up says `hostable: true` fails to
  compile "before nitrogen emits the control in `HybridNitroUiHostChildren.g.h` … the second error
  of proof 21". There is no such file in `nitrogen/`, `cpp/`, `ios/` or `android/`. The proof-21
  log, `/tmp/x3-redproofs.log:459-466`, shows test failures and no compile error.
- **A C++ component that does not exist** (report `:13`). "the C++ host children": no generated
  region is C++. The region is `HostChildren.ts`.
- **A wrong claim about `prepare`** (report `:135`). "`prepare` runs … so `registry:check` fires
  there too". `prepare` is `bob build`. Its custom target runs `nitrogen`, not `registry:check`, and
  `prepare` does not run on a registry install of the package anyway.
- **A SHA the brief does not name** (report `:58`). "dc13833, the SHA the brief names": the brief
  names no SHA. It is the merge-base.
- **An unexplained reason** (report `:12`). The CLI is said to be thin "because node's coverage
  tool hangs on a file that large". Nothing explains or supports this. The file header gives the
  real reason, testability.

**M4. Two guarded behaviours have no test that goes red (AGENTS "Every new test or gate must be
shown to fail").**
- **The copy rule** (`registry-core.mjs:492`). Red proof 5 says re-rendering shipped entries breaks
  `registry.test.js` with drift at `HostChildren.ts:57`. Disabling the rule on its own
  (`if (false) return current.lines;`) passes all 28 tests and `registry:check`. The red in the
  proof script (`/tmp/x3-redproofs-final.sh:36-43`) came from a second mutation that changed the
  render template, and it ran `registry:check`, not `registry.test.js`. The fixture matches the
  right answer: every shipped row equals its render, so the rule is never exercised.
- **The unmanifested-autolinking check** (`registry-core.mjs:914-920`). Replacing the loop with
  `for (const key of [])` also leaves every test green.
- **Fix:** add a fixture where a shipped row differs from its render, plus an autolinking key that
  no manifest declares. Rewrite proof 5 with the honest mutation and the test that goes red. If the
  copy rule cannot be given a real case, delete it: shipped HOSTABLE value edits are already caught
  by `host.test.tsx` (I mutated `[Switch, 'Slider']` and it went red).

## Nice to fix

**N1. A conflicted `nitro-ui.sizing.json` is silently re-sorted** (`registry-core.mjs:822`,
`:1171`). If `regen` runs while conflict markers are still in the file, `parseJson` returns null.
The keys then fall back to manifest-name order, `--write` exits 0, and the shipped table changes
order. A later `registry:check` is OK, because order is accepted. Marker regions already refuse
this case, so refuse here too when the current text does not parse.

**N2. `.gitattributes` contradicts itself.**
- **Duplicate paragraph:** the "Not marked …" paragraph appears twice (`:10-14`, `:25-28`).
- **Marks two shipped files:** it says shipped files are not marked, yet marks `nitro.json`
  (shipped and hand-edited today) and `nitro-ui.sizing.json` (shipped) as `linguist-generated`
  (`:29-30`). That collapses shipped diffs in review.
- **Missing statement:** `nitrogen/generated/**` is covered by nitrogen's own
  `nitrogen/generated/.gitattributes`. Say so instead of implying this file covers it.

**N3. Dead cross-checks with stale docs** (`registry-core.mjs:936`, `:982`). `planRegistry` never
calls `checkSizingTable` or `checkRealInputRows`; only tests do. The docstring at `:978` says
real-input rows "are copied, not re-rendered (byte-identity)". `controls.mjs` is unshipped, so they
are re-rendered: I edited a title and the check went red. Wire the two checks in or delete them, and
fix the comment.

**N4. Design: actually cutting the conflict count.** Git's built-in `merge=union` needs no
per-clone config, so it is within the brief's rule. Two places to apply it:
- **`nitrogen/generated/**`:** `regen` overwrites it and `nitrogen:check` gates it. These files are
  5–7 of each historical merge's conflicts.
- **The unshipped lists:** move them into their own wholly generated files (brief item 3: "Prefer
  moving a list into its own small generated file"). Union then keeps both appended rows, and
  `regen` normalizes the terminators. The entry regexes already accept `;?`.

This would leave conflicts only in the shipped anchored files and the true behaviour files. Worth
an orchestrator decision; see the questions below.

**N5. Step 6 skipped some regions and is a weaker baseline than the brief asked for**
(`/tmp/x3-step6g.mjs:87`, report `:96-120`).
- **What it skipped:** both fakes are `hostable: false, realInput: false`. They never touched the
  `HostChildren.ts` anchored regions, the two host-arm lists, or the multi-line real-input rows,
  which are the riskiest regions and include M2's path.
- **How it was checked:** the merged tree was verified with `registry:check` only, not `check`.
  `host.test.tsx` "has an opinion on every control" would also have needed an `UNHOSTABLE_CONTROLS`
  row.
- **The baseline:** it is the X3 tree with the markers stripped, not `main`'s layout as the brief
  asked. That is a fair approximation, but say so in the table.

**N6. The pre-X3 cost is overstated** (`CONTRIBUTING.md:228-230`, report `:117`). Both claim "the
first thing that can tell you it went wrong is a harness test on a device". Before X3, `check`
already caught several of the lost rows:
- the `viewConfigs.test.ts` copies (its "covers every generated config" test);
- `HOSTABLE_CONTROLS` (`host.test.tsx`);
- smoke `App.tsx` against `lib.mjs` (`smoke-ready-line.test.js`);
- `ComponentName` (`tsc`).

Only the example tabs and switch were truly unguarded.

**N7. Output depends on which side was taken.** The order comes from the file and any permutation
passes, so the two merge orders produce different bytes. `scripts/smoke/App.tsx:63` says its list
"Must match `SMOKE_CONTROLS` in lib.mjs". I swapped two entries in `lib.mjs` only, and
`registry:check` and `jest scripts` (384 tests) stayed green. That is harmless today, because the ready line
is keyed by name, but the comment is now unenforced.

**N8. Rendered strings are not escaped** (`registry-core.mjs:764`, `:793`). An `exampleLabel` or
`realInputTitle` containing `'` produces invalid TS or JS. Add a pattern to the schema, or escape
the value.

**N9. Scope note:** commit `2402c0a`, the `Podfile.lock` change, is byte-identical to `main`'s
`8f75e03`. `git merge-tree` merges it cleanly, so it is harmless, but it is not this task's work.

## Questions for orchestrator

1. Should X3 adopt `merge=union` (N4) for `nitrogen/generated/**` and for the unshipped lists, once
   those move into their own generated files? I recommend it for `nitrogen/generated/**` in this
   fix round, since it is one line and `regen` plus `nitrogen:check` make it safe. The list-file
   move would change roughly 9 files' structure, so it could be a follow-up.

## Verification notes

- `fnm exec --using 24 -- node scripts/gen-registry.mjs --check` → OK. The four related jest
  suites → 94/94 green.
- I ran every mutation in the worktree and reverted it with `git checkout -- .`. `git status` was
  clean at the end, apart from this file.
