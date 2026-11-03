# G17 — SearchField

**Machine:** maintainer-mac-2 (local). **Round cap:** 1 round, plus at most 2 fix rounds (D19). **Devices:** your lease
(`lease.mjs acquire --task G17 --boot`). No `--exclusive`.

## Workspace

- Your own worktree from `origin/main` on branch `task/G17-search-field`; run `bun install` there. On maintainer-mac-1 the
  project checkout is the owner's working copy: don't edit it, switch its branch, stash, reset or clean it, and push
  only your own branch (never `main`, tags or force; no PR).

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING "README
  screenshots" (804/720 px, Storybook, light). README content is for app developers only: no machine names, task IDs
  or DECISIONS references.
- `docs/DECISIONS.md` D17, D29, D32–D38.
- `docs/tasks/Q7-next-components-2.report.md` **Appendix B** — the design to build — and its summary.
- The precedents it names (e.g. TextField for SearchField; DatePicker's popover, Dialog's presenter and D35 for Tooltip).

## Do

1. Build `SearchField` on both platforms to Appendix B (SearchField, its own native view sharing TextField's model (D38 item 2)). Settle anything the design leaves open in your report's
   first section (the final API) before building; stop and ask only on something that changes another component's
   conventions.
2. Do the design's early checks first and report them; a check that fails stops the build with a report.
3. Registry and component.json, conformance rules, example screen and Storybook stories, `docs/components/search-field.md`,
   a README section (Components row with `Since: next`, import line, Usage, both screenshots), a minor changeset.
4. Tests per the design's harness and real-input plan, each shown red first; a bench arm if cheap, otherwise one
   FOLLOWUPS line.
5. Accessibility is verified by automation only (D37 item 4): say in the docs what was and wasn't exercised on a device.

## Gates

`check`, both `harness:*`, both `real-input:*`, then `need --for review`. Report at `docs/tasks/G17-search-field.report.md`,
ledger exported (`gate.mjs export --task G17`).
