# X4 — Conformance suite and `scripts/task-ready.mjs`

**Worktree / branch:** named in your delegation message (from `main`). **Context pack:**
`docs/tasks/X4/context.md`. **Round cap:** 1 implementation round plus at most 2 fix rounds (D19).
**Devices:** from `node scripts/lease.mjs acquire --task X4`. The published package stays
byte-identical.

## Why

`docs/tasks/PROCESS-review-2026-10-26.md` §1 and §4 row 3: fix rounds took 44 % of implementer time,
and the same must-fix classes kept recurring in component reviews:

- the Android accessibility label sat on a different node from the one TalkBack focuses (G5 M2,
  G6 M3);
- a dropped view leaked (B1, H1 M1);
- a declared sizing fallback was missing, or equal to the measured size so a failed correction was
  invisible (G5, G6);
- recycling didn't fully reset a view.

Every control should be checked for these generically, driven by X3's manifests
(`src/components/<Name>/component.json`), so a new control (0.4's Menu, `PLAN-0.4.md`) gets them
without anyone writing them.

## Do

1. **Conformance checks, one parameterised suite** over every manifest (and the hostable ones inside
   `<Host>` where it applies). Each check names the control and the rule when it fails:
   - **a11y name on the focusable node, both platforms.** iOS: the element the accessibility tree
     exposes for the control carries the label and the expected trait. Android: the node TalkBack
     focuses (clickable/focusable) carries the content description or text. The in-app harness can't
     read Android's accessibility tree, so pick where this runs: the host-side uiautomator path
     (`scripts/real-input/uiautomator.mjs`), a harness-side bridge, or another way. Say why. It
     must run as part of an existing gate (`harness:*` or `real-input:*`), not as a new gate nobody
     runs.
   - **No leak on drop:** mount and unmount N instances (reuse `MountChurn.harness.tsx`'s approach)
     and assert the live-instance or hosting counters return to baseline.
   - **Declared fallback:** registered before the first measure, and different from the measured
     size for the test's props (a fixture equal to the right answer hides a failed correction).
   - **Recycle reset:** a recycled view with new props shows none of the old props' state.

   Where today's code fails a rule, don't fix the control. Mark that case `failing` with a link to a
   new FOLLOWUPS line, so the suite lands green and the debt is visible. Show each rule red at least
   once on a real control by mutating it.
2. **`scripts/task-ready.mjs`** (`bun run task-ready`), run by an implementer before handing in. It
   exits non-zero, naming each problem:
   - the branch's control set and registry disagree (`registry:check`), or a manifest has no
     conformance coverage;
   - `TODO`/`FIXME` in a declared fallback or a generated region;
   - **every backticked repo path in `docs/tasks/<ID>.report.md` exists at HEAD**, unless the
     branch's diff adds or deletes it. This catches reports that cite invented files (X3's first
     report did);
   - `gate.mjs need --for review` is satisfied;
   - the report's gate table matches `gate.mjs table`.

   `<ID>` comes from the branch name or `--task`. Unit tests in `scripts/__tests__/`, each shown
   red.
3. **Docs:** CONTRIBUTING "Adding a component" says the conformance suite covers the new control
   automatically and `task-ready` runs before review. `REPORT-TEMPLATE.md` gets one line: run
   `bun run task-ready` before the final commit. `ORCHESTRATOR.md` "The loop" step 3: a round that
   fails `task-ready` goes back before review.

## Out of scope

Fixing any control that fails a rule (FOLLOWUPS lines instead). The `mutations.json` helper. Bench.

## Gates

`check`, then `need --for review` (expect both harnesses, plus real-input if the a11y check lives
there), then run `bun run task-ready` on your own branch. Report:
`docs/tasks/X4-conformance.report.md` (REPORT-TEMPLATE), listing each rule × control as pass,
`failing` (with its FOLLOWUPS link) or not applicable, with the ledger exported. Commit on your
branch, don't push.
