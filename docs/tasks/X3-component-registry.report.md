# X3 Report — Component registry

**Task:** `X3-component-registry` · **Round:** 1 · **Lease:** `X3-rd5ku`

## Summary

A component used to be recorded in about fifteen hand-maintained lists, so two components in flight
conflicted on every one of them and a wrong merge was invisible. Each control now declares its facts
once, in `src/components/<Name>/component.json`, and `scripts/gen-registry.mjs` writes those lists;
`registry:check` — now part of `bun run check` — fails when they are not what the manifests say. The
schema, the region table and the reasons live in `scripts/registry-core.mjs`; the CLI
(`scripts/gen-registry.mjs`) is the filesystem half, so the rules are unit-testable against fixtures
rather than against the working tree. It owns **22 regions in 14 files** plus `nitro-ui.sizing.json`:
`nitro.json`'s autolinking section, the Host's control imports and hostable set
(`HostChildren.ts`), the Kotlin package and declared fallbacks, the Swift fallbacks, the bench plans
and `ComponentName`, `viewConfigs.test.ts`, the smoke and real-input control lists, and the example's
tabs/screens.

Six of the fifteen files it writes are **shipped** (`etc/package-files.txt`): `nitro-ui.sizing.json`,
which it writes whole, and five whose regions are *anchored* inside a hand-written body — an anchor
line plus an entry shape, entries copied rather than re-rendered and kept where they are, because a
marker comment in a shipped file would itself be a change to the artifact. The anchoring plus the copy
rule are what keep the published bytes unchanged: the registry test runs `--write` over a scratch copy
of the real tree and asserts every shipped file is still byte-identical, and the tarball says the same
end to end (below). The other nine are unshipped and use `@generated` markers. Every new entry is
appended at the end of its list, so two controls never touch the same line.

`src/index.ts` is **cross-checked, not regenerated** — the brief allows this: it exports `<Host>`,
which has no manifest, plus per-component types no manifest names (`SegmentedControlChange`,
`DatePickerVariant`), and its header prose is the statement of what is public. The check catches the
mistake a hand-written file actually makes: a control that exists and cannot be seen downstream.
`nitro.json`, by contrast, *is* generated (its `autolinking` section): nitrogen only reads that file,
so there is no second writer to contend with, and a per-component entry a merge throws away is the
per-item cost the task exists to remove.

Behaviour stayed hand-written, as required — bench arm branches, `CHECKS` in
`scripts/real-input/android.mjs`, `RealInputTests.swift`, the example screens, docs prose — and
`scripts/__tests__/component-coverage.test.js` is the gate that says so when one is missing.

Two decisions worth reviewing: `package.json` excludes `**/component.json` from the tarball (the default
`src/**` plus bob's `lib/**` copy would have published 14 extra files), and `.gitattributes` marks the
registry outputs `linguist-generated`.

## Gate table

`gate.mjs export --task X3` → `docs/tasks/X3/gates.jsonl`.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 516 tests / 27 suites | `b3a9b03569f7` | 2 m 52 s | start 3.9 / med 2.2 / max 3.9 |
| `harness:ios` | **PASS** | 165 tests / 13 suites | `b3a9b03569f7` (ios tree) | 2 m 29 s | start 6.8 / med 51.1 / max 97.3 |
| `harness:android` | **PASS** | 214 tests / 13 suites | `b3a9b03569f7` (android tree) | 7 m 35 s | start 2.1 / med 4.9 / max 8.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`node scripts/gate.mjs need --for review` → **review is satisfied on this code tree.**
`real-input:*` is the merge-stage gate: AGENTS.md runs the full harness plus real-input once, at merge,
and this task changes no control's behaviour — the generated rows are the rows that were already there.

## The published package is unchanged

- File list: `package-files: tarball matches etc/package-files.txt (465 files)`, and both tarballs
  contain the same 465 paths.
- Content: 465 paths, 465 identical, the only difference `package/./package.json` — the three new
  scripts and the `!**/component.json` exclusion. Compared against `dc13833`, which is this branch's
  merge-base with `main`; the brief names no SHA, and `main`'s tip has moved with unrelated commits,
  so the merge-base is the honest comparator.

```
git worktree add -f --detach /tmp/x3-pack/wt <head>      # and again for <base>
(cd /tmp/x3-pack/wt && bun install --frozen-lockfile && bun x react-native-builder-bob build && rm -rf lib/common)
(cd /tmp/x3-pack/wt && bun pm pack --destination /tmp/x3-pack/out --compression gzip)
tar -xzf /tmp/x3-pack/out/<pkg>.tgz -C /tmp/x3-pack/<name>
(cd /tmp/x3-pack/<name>/package && find . -type f | sort | shasum -a 256 -c - --quiet)
```

## Red proofs

`test -> mutation -> the line that went red`. One mutation at a time, reverted between runs.
Round 1: `/tmp/x3-redproofs-final.sh` (log `/tmp/x3-redproofs.log`). Fix round 1: `/tmp/x3-fix-reds.mjs`
(log `/tmp/x3-fix-reds.log`); proofs 22–27 are single-mutation, each going red in exactly one test.

1. `registry:check` -> a generated row edited by hand -> exits 1, `scripts/smoke/lib.mjs line 45: "'switchy'," -> "'slider',"`.
2. `registry:check` -> a manifest edited without regenerating -> exits 1, `example/src/App.tsx line 72`.
3. registry.test.js -> a row deleted from a generated list -> `the tree in front of us is in step with its manifests` (+4).
4. registry.test.js -> shipped files allowed a marker -> `the anchored regions in shipped files are byte-identical to what was there`.
5. registry.test.js -> shipped entries re-rendered instead of copied -> *the round-1 proof was not honest*: its script bundled a second mutation (it also changed the render template) and ran `registry:check` rather than `registry.test.js`, so the red it showed did not isolate the copy rule. Re-proved on its own as 22.
6. registry.test.js -> entries re-sorted instead of kept in place -> `NitroUiPackage.kt:13`, `NitroUiDeclaredFallbacks.kt:7`, `bench/src/implementations/index.ts:72`.
7. registry.test.js -> a region's terminator handling removed -> drift at `bench/src/types.ts:26`.
8. registry.test.js -> the schema ignoring unknown keys -> `rejects a key it knows nothing about, and lists the ones it does` (+1).
9. registry.test.js -> a duplicate id allowed -> `rejects two manifests claiming one id or tab`.
10. registry.test.js -> a cross-check not run -> `the tree in front of us is in step with its manifests` (+4).
11. registry.test.js -> the autolinking language rule reading `all` for iOS -> `accepts either shape nitrogen emits for an autolinking entry`.
12. registry.test.js -> two components' regions of one file no longer merged -> `a component added to the manifests is appended to every list it belongs to` (+5).
13. registry.test.js -> an unmanifested export allowed through -> `the barrel exports every manifest, and an unmanifested export is named` (+5).
14. package.json -> `registry:check` removed from `check` -> `the check script is wired into \`bun run check\``.
15. package.json -> the manifests allowed into the tarball -> `package-files: +lib/module/components/Button/component.json would be published`.
16. component-coverage.test.js -> a bench arm branch renamed -> `bench/src/implementations/nitroUi.tsx handles every component in each of its render paths`.
17. component-coverage.test.js -> an Android `CHECKS` entry renamed -> `picker has a check on both platforms`.
18. component-coverage.test.js -> an iOS check renamed -> `slider has a check on both platforms`.
19. component-coverage.test.js -> a row's screen tab that nothing renders -> `every row names a screen the example app renders`.
20. component-coverage.test.js -> an example screen renamed -> `the example app defines a screen for each tab`.
21. component-coverage.test.js -> a new manifest whose arm branch was forgotten -> `…handles every component in the plan` (4 arms) + `the host arm handles exactly the hostable set the plan asks for`.
22. registry.test.js -> `if (false)` on the shipped-copy rule in `replaceRegion` -> `an entry already in a shipped region is copied, not re-rendered`. The fixture that makes this meaningful is new: the review was right that every shipped row in the tree happens to equal its own render, so the rule was never exercised. `nitro.json` accepts two spellings of an autolinking entry (`checkAutolinking` reads a per-platform pair *or* a shared `all` block, because nitrogen emits either), so a `NitroUiSwitch` entry written in the `all` shape is valid, shipped, and not what `render` would emit — copying is what keeps those bytes still.
23. registry.test.js -> the "entry no manifest declares" loop in `checkAutolinking` emptied -> `names an autolinking entry no manifest declares, and keeps it in the file`.
24. registry.test.js -> the `HostChildren.ts` imports region wants `where('hostable')` again -> `a control that stops being hostable keeps its import` (review M2).
25. registry.test.js -> `sizingTableContent` treats unparseable text as "no current file" -> `a sizing table that no longer parses is refused, not re-sorted from nothing` (review N1).
26. registry.test.js -> the autolinking cross-check reads the file on disk instead of the planned text -> `--write completes for a component that has no entry in nitro.json yet` (review M1: this is the check that would have refused the very run that adds a component).
27. registry.test.js -> the `keep` rule for non-control autolinking entries (`NitroUiCore`, `NitroUiHost`) removed -> eight tests red, starting with `the tree in front of us is in step with its manifests` and `an autolinking entry the registry does not own keeps its bytes and its place`.
28. registry.test.js -> a label or title containing an apostrophe allowed through -> `rejects a label or title the generated line cannot carry` (review N8: it renders inside single quotes).
29. Two of this round's own tests (`a component added to the manifests…`, `the barrel exports every manifest…`, `has a manifest for every component directory…`, `a control that stops being hostable…`) went red **on their own**, before any mutation, when run on a tree that had a second control in it — the step-6 experiment's branches. They hardcoded a component named `Gauge`. Fixed in `6697f1f`; that is the red proof for "tests must not pin the roster", and it is the same class of bug as proof 5.

## Step 6 — two components, and the merge

Two controls, `Gauge` and `Toggle`, each added the way its own layout says to add one, on two
branches, merged in both orders. Both are `hostable: true` and `realInput: true`, which the first
run got wrong: those flags are what pull in the `HostChildren.ts` anchored regions, both
nitro-ui-host arm lists, and the multi-line real-input row.

Two bases, per the brief. **Registry layout** = this branch's tip. **Hand-maintained layout** =
`dc13833`, `main`'s layout — a real pre-X3 checkout, not an approximation. Its branches run nitrogen
as pre-X3 did (nitrogen was always generated) and type the same lines into the hand-maintained lists;
the line set is taken from the registry layout's own diff, so the two layouts differ only in whether
a list is generated or typed.

"Lost" = per control per shared file, the lines its branch added that are absent from the merged
tree, tolerating only a moved `,` / `;`. Files git can merge without help (a control's own new files,
and `nitrogen/generated/**`, which both layouts regenerate) are excluded.

| | registry layout | hand-maintained layout (`dc13833`) |
| --- | --- | --- |
| conflicted files | **19** | **22** (19 + 3 in `nitrogen/generated/**`, which `.gitattributes` now merges with `union` and `regen` rewrites) |
| entries the losing control adds to shared files | 52 | 54 |
| after `take either side` | **36 lost**, in 19 files | **36 lost**, in 19 files |
| after the recipe | **0 of 104 lost** | no recipe: 19 files re-edited by hand, with no gate that can tell whether it was done right |
| `bun run check` after the recipe | `registry:check: OK`, `typecheck` clean, **zero test failures caused by the merge** (see below) | n/a |

Both orders give the same numbers. Per-file losses are identical in both layouts (the only
difference: the pre-X3 `ComponentName` union carries an id twice, 6 lines rather than 4).

`check`, not just `registry:check`, on the merged tree — the first run's weak point. The full suite
after taking either side + the recipe + `regen`: 16 failures. The same 16 minus the merged-away
duplicates are red on the single-control branches too (a fake control with no `expoUi` arm branch and
a two-line config JSON fails the coverage gate *by design*), and the failure set of the merged tree
contains **nothing** that was not already red on a parent: the recipe destroys nothing that a gate
can see. The genuine behaviour edits the recipe puts back are the four the manifest cannot describe:
`src/index.ts`'s export, the bench arm's import and branch, `testRealInput<Name>`, and the `CHECKS`
entry (`nitro.json` is generated now, so it is no longer one of them).

**What says so when a row goes missing** — measured separately, because "no gate" is the claim N6
says is overstated. `Picker`'s rows deleted from the generated lists only, on each base, running the
gates `check` runs:

| | pre-X3 (`dc13833`) | registry layout |
| --- | --- | --- |
| gates red | 9 | 24 |
| pre-existing gates that notice | `typecheck` (an orphaned import), `bench:typecheck`, `nitrogen:check` (`nitro.json`), `viewConfigs.test.ts` (config copies), `host.test.tsx` (hostable set), `smoke-ready-line.test.js`, the shared-Host arm scope | same 9, plus `registry:check` and the bench plan/arm, real-input-table, manifest-parity tests |
| still unguarded pre-X3 | `bench/src/plan.ts`, `bench/src/types.ts` and the arm component lists, `scripts/bench/lib.mjs`, `nitro-ui.sizing.json`, `example/src/App.tsx`'s tab bar, the real-input table | — (all caught) |

So N6 is right that pre-X3 was not unguarded: 7 of 13 generated lists had some gate. X3's gain is the
other 6, plus a check that names the file and line rather than inferring a missing row from a
type error or a red SwiftUI snapshot assertion.

Scripts: `/tmp/x3-n5.mjs` (both layouts), `/tmp/x3-n5b.mjs` (which gate goes red), `/tmp/x3-n6.mjs`
(the row-deletion table). Logs `/tmp/x3-n5-generated.log`, `/tmp/x3-n5-hand.log`,
`/tmp/x3-n5b-gen.log`.

## Follow-ups

- CONTRIBUTING's step-1 checklist used to list the `nitro.json` autolinking entry as a hand edit, which
  made `nitro.json` the one file the merge recipe could not recover: taking either side lost the entry,
  nitrogen then refused to run, and `regen` could not put it back. It is generated now (proof 26), so
  the recipe has no hole left. Round-1's write-up of this was wrong in the other direction — it said
  nitrogen rewrites the file, which is why the fix round's first commit message had to be corrected too.
- X4: the doc table (`docs/components/*.md`, and whatever nav is built from it) is the next such list;
  the manifest has no field for it yet.
- X4: a manifest that says `hostable: true` for a control the native Host cannot yet draw is a
  *runtime* refusal, not a compile error: `HostChildren.ts`'s `UNHOSTABLE_CONTROLS` is the table, and
  `host.test.tsx` exercises the refusal sentence with a stand-in row. Round 1 claimed a C++ header
  (`HybridNitroUiHostChildren.g.h`) had to exist first; no such file exists in this repo, and the log
  it cited shows test failures, not a compile error. Worth a manifest-level guard only if a real
  control needs it.
- `build-app.mjs` rewrites `example/ios/Podfile.lock` (NitroUi 0.2.0 -> 0.3.1) on every iOS build; it is
  committed so the tree stays clean. Pre-existing, not caused by this task.
- `registry:check` is in `bun run check` and nowhere else: `prepare` is `bob build`, whose custom target
  runs `nitrogen`, and a package installed from the registry does not run its own `prepare`. So the
  check costs CI ~0.2 s and consumers nothing. (Round 1 claimed it fired on a consumer install; it
  does not.)
