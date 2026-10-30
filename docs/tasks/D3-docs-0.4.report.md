# D3 — Docs pass for 0.4.0

**Branch:** `task/D3-docs-0.4` (from `main` at `13fd2e9`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none — no device was needed, leased, or booted (brief: "No devices are needed").

## Summary

The README now describes 0.4.0. `Menu` joins the Components table (status `0.4.0`, its
SwiftUI call and its Android composables as the code writes them), the root `import` list,
and a `### Menu` section in Usage whose `tsx name=menu` block is the region in
`example/src/readme-examples.tsx` — nine blocks, `readme:check` green. The example is a
`tonal`/`medium` trigger, a `group` of two actions and a destructive row in a titled
section, and `onSelect`; the `group` is module-scope because an inline object literal
re-describes the rows every render. The paragraph under it names the three splits
(`onOpen`/`onClose` Android-only, `systemImage` and `primaryAction` iOS-only, submenus
nesting on iOS only), with D32 as the reason.

Two claims that were simply wrong are corrected. "The GitHub workflows are disabled"
appeared in the README twice and in CONTRIBUTING's opening: `gh workflow list --all` says
`CI`, `Changeset status`, `Release` and `Release tag` are **active** — each with a recent
green run — and only `Bench` and `Smoke` are off and dispatch-only. CONTRIBUTING,
`benchmarks.md` ("CI (disabled)"), the README and the example README now say that. The
other correction is the smoke table: the app mounts eight controls plus `<Host>` since
G7b, so the sentence says so, and the cells keep their 0.1.0 date with a line naming the
gap — G7b recorded that no device has printed a `menu=WxH` box, and this round ran no
smoke app, so no cell was ticked.

`<Host>` is described as eight hosted controls and **three** windows, in the README,
`docs/components/host.md` (its allowlist bullets, plus a paragraph for the Menu's
`menuAnchor` bound and the four mutants that did not reproduce the mis-anchoring) and the
two source comments that still counted seven (`src/index.ts`, `HostChildren.ts` —
comments only; no export or behaviour changed). `benchmarks.md` and `switch.md` counted
seven too. The Performance section gains Menu's numbers from G7b's own tables — Android
217.9 KiB unhosted, 77.5 KiB in a Host, iOS 346.3 KiB at 1.32× — labelled as numbers
rather than verdicts, since neither machine has a committed `Menu` cell, and it says which
of the three runs was not quiet. The old "Picker and the Android DatePicker were not part
of either baseline run" was stale in both halves, so it now names the real reasons (mac-1
measured no Picker; Android has no `@expo/ui` DatePicker arm at all) and mentions mac-2's
baselines, which do carry Picker.

A patch changeset ships with it because `README.md` is in the tarball.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1165 tests / 45 suites | `f5fde7b12de3` | 2 m 39 s | start 6.5 / med 6.3 / max 9.1 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios, harness:android`
(`check` green; the note is `treated as both platforms (outside the known prefixes):
example/src/readme-examples.tsx`). Both are asked for because of that **one** file, which
is a docs fixture nothing imports — `readme:check` and `typecheck`, both inside `check`,
are what prove it, and the brief rules devices out for this round. The other files are
`.md` (not code) or `scripts/smoke/lib.mjs` and `.changeset/` (tooling). Left for the
orchestrator: waive the two rows, or run them if the fixture's mapping is judged to matter.

The ledger's earlier `check` FAIL (`a7b83b15177d`, `62597c5`) is my own mistake, not a
gate: I killed that background run with `kill` to fold in one comment before it finished,
so the `test` step died on SIGTERM and everything after it was skipped. Nothing in the
tree is involved — the same tree one commit later is the PASS above.

## Red proofs

No new test or gate is added by this round; the one gate my change rides on is
`readme:check`, so it is the one I broke:

- `readme:check` -> changed `variant="tonal"` to `variant="filled"` in the README's `menu`
  block only -> `menu: README and example/src/readme-examples.tsx differ … first
  difference at line 25` (exit 1), restored and green again.

## Files changed

- `README.md` — Menu in the table, imports, Usage and Known limitations; the Host
  paragraphs; the bench table's two missing ratios and the `<Host>` section's Menu numbers;
  the smoke paragraph; Contributing's CI claim.
- `example/src/readme-examples.tsx` — the `menu` region and its `Menu`/`MenuGroup` imports.
- `CONTRIBUTING.md` — the opening paragraph, the smoke ready-line sample, and the two
  "workflow is disabled" lines that are really dispatch-only.
- `docs/components/host.md` — eight hosted controls, three windows, the Menu paragraph.
- `docs/components/switch.md`, `docs/architecture/benchmarks.md`, `example/README.md` —
  the seven-controls/count and the disabled-workflows claims.
- `src/index.ts`, `src/components/Host/HostChildren.ts` — header comments only.
- `scripts/smoke/lib.mjs` — one comment line (eight controls, nine entries).
- `.changeset/docs-readme-0-4.md` — the patch entry.

## Follow-ups

- `scripts/gate-core.mjs`: `example/src/readme-examples.tsx` is unmapped, so any README
  edit owes two harness runs; it and `scripts/readme-examples-check.mjs` prove the same
  thing and the latter is already on the tooling list.
- `example/src/stories/Host.stories.tsx`'s `Popups` story still hosts seven controls and
  says "seven controls, one composition" — a story, not a claim in the shipped docs.
- No consumer smoke run has printed `menu=WxH` (G7b's line, still open); nothing since
  0.1.0 has re-run the four README ticks either, which is what the paragraph now says.
- `bench/baselines/*` have no `menu` cells; G7b's numbers are the only ones, and its
  Android N=200 pair comes from a run that was not quiet.
