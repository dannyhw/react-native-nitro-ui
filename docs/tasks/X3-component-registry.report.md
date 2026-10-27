# X3 Report — Component registry

**Task:** `X3-component-registry` · **Round:** 1 · **Lease:** `X3-rd5ku`

## Summary

A component used to be recorded in about fifteen hand-maintained lists, so two components in flight
conflicted on every one of them and a wrong merge was invisible. Each control now declares its facts
once, in `src/components/<Name>/component.json`, and `scripts/gen-registry.mjs` writes those lists;
`registry:check` — now part of `bun run check` — fails when they are not what the manifests say. The
schema, the region table and the reasons live in `scripts/registry-core.mjs` (the CLI is thin because
node's coverage tool hangs on a file that large). It owns **21 regions in 13 files** plus
`nitro-ui.sizing.json`: the C++ host children, the Kotlin package and declared fallbacks, the Swift
fallbacks, the bench plans and `ComponentName`, `viewConfigs.test.ts`, the smoke and real-input control
lists, and the example's tabs/screens.

Four of those files are **shipped** (`etc/package-files.txt`), so they can carry no marker comment: their
regions are *anchored* — an anchor line plus an entry shape, entries copied rather than re-rendered and
kept where they are. That is what makes the published bytes unchanged: the registry test runs `--write`
over a scratch copy of the real tree and asserts every shipped file is still byte-identical, and the
tarball says the same end to end (below). The other nine are unshipped and use `@generated` markers.
Every new entry is appended at the end of its list, so two controls never touch the same line.

`nitro.json` and `src/index.ts` are **cross-checked, not regenerated** — the brief allows this: nitrogen
owns the first (it rewrites it in spec-discovery order), and the barrel exports `<Host>`, which has no
manifest, plus per-component types no manifest names. Both checks still catch the mistake a hand-written
file makes: a control that exists and cannot be seen downstream.

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
  scripts and the `!**/component.json` exclusion. Compared against base `dc13833`, the SHA the brief
  names, not `main`'s tip, which has moved with unrelated commits.

```
git worktree add -f --detach /tmp/x3-pack/wt <head>      # and again for <base>
(cd /tmp/x3-pack/wt && bun install --frozen-lockfile && bun x react-native-builder-bob build && rm -rf lib/common)
(cd /tmp/x3-pack/wt && bun pm pack --destination /tmp/x3-pack/out --compression gzip)
tar -xzf /tmp/x3-pack/out/<pkg>.tgz -C /tmp/x3-pack/<name>
(cd /tmp/x3-pack/<name>/package && find . -type f | sort | shasum -a 256 -c - --quiet)
```

## Red proofs

`test -> mutation -> the line that went red`. Full output: `/tmp/x3-redproofs.log`; script:
`/tmp/x3-redproofs-final.sh`. All 21 reverted (`git status` clean afterwards).

1. `registry:check` -> a generated row edited by hand -> exits 1, `scripts/smoke/lib.mjs line 45: "'switchy'," -> "'slider',"`.
2. `registry:check` -> a manifest edited without regenerating -> exits 1, `example/src/App.tsx line 72`.
3. registry.test.js -> a row deleted from a generated list -> `the tree in front of us is in step with its manifests` (+4).
4. registry.test.js -> shipped files allowed a marker -> `the anchored regions in shipped files are byte-identical to what was there`.
5. registry.test.js -> shipped entries re-rendered instead of copied -> drift at `src/components/Host/HostChildren.ts:57`.
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

## Step 6 — two components, and the merge

`Fake` and `SliderFake`, each added the way CONTRIBUTING.md says to add one, on two branches, merged
both orders. Measured twice: in this layout, and in the same tree with the generated regions handed
back to a human (same content, markers stripped, nothing to regenerate from). "Lost" counts, per control
per shared file, the lines its branch added that are no longer in the merged file; nitrogen's own output
is excluded, since nitrogen regenerates it in both layouts.

| | registry layout | hand-maintained layout |
| --- | --- | --- |
| conflicted files | 18 | 18 |
| after `take either side` | 12 of 24 shared entries lost | 12 of 24 shared entries lost |
| after the recipe | **0 lost**, `registry:check: OK (9 components, 14 generated files…)` | no recipe exists: 12 files re-edited by hand, with nothing that can say it was done right |

The recipe: take either side of every conflicted generated file, put back the three edits no manifest
describes — `nitro.json`, `src/index.ts`, the bench arm — and run `bun run regen`. Same in both orders.
(`nitrogen/generated/**` conflicts too, but nitrogen rebuilds it from `nitro.json` in either layout, so
it is not counted as lost.)

So X3 does not reduce the conflicts — a control genuinely adds a line in 13 shared files — it makes them
**recoverable and checkable**, which is the cheap merge the brief is after: three lines by hand plus one
command, and `registry:check` then *proves* the result in 0.2 s. Pre-X3 the first proof was a red harness
test after a device build, because `App.tsx`'s tabs and screens merge clean and simply lose a row. The
three files left for a human are exactly the ones where the two sides say different things.

`/tmp/x3-step6g.mjs`, log `/tmp/x3-step6-final.log`.

## Follow-ups

- CONTRIBUTING's step-1 checklist now includes the `nitro.json` autolinking entry: nitrogen runs first
  in `regen` and refuses to generate a Hybrid View that is not in `nitro.json`, so without it the merge
  recipe cannot run at all. Step 6 found this; it is the one hole in the recipe.
- X4: the doc table (`docs/components/*.md`, and whatever nav is built from it) is the next such list;
  the manifest has no field for it yet.
- X4: a manifest must not say `hostable: true` before nitrogen emits the control in
  `HybridNitroUiHostChildren.g.h`, or `check` fails to compile — the second error of proof 21. A manifest
  for that case: `{"name":"Fake","hybridView":"NitroUiFake","implementation":"HybridNitroUiFake","id":"fake","sizing":"intrinsic","hostable":true,"exampleTab":"fake","exampleLabel":"Fake","bench":true,"benchUnsuffixed":false,"smoke":true,"realInput":false}`.
- `build-app.mjs` rewrites `example/ios/Podfile.lock` (NitroUi 0.2.0 -> 0.3.1) on every iOS build; it is
  committed so the tree stays clean. Pre-existing, not caused by this task.
- `prepare` runs on a consumer `npm install`, so `registry:check` fires there too. `nitrogen:check`
  already had that property; the cost is ~0.2 s.
