# X2 — Gate ledger, re-run rules and short reports

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/X2` (branch `task/X2-gate-ledger`, from `main`).
**Round cap (D19):** 1 + 2 fix rounds. No devices needed except one proof run. Do not push. No
personal info (D25). Library package unaffected (`npm pack` identical to main's). From
`docs/tasks/PROCESS-review-2026-10-26.md` §3–4 (items 4 and the report format) — read it first.
X6 (build speed) runs in parallel and edits `scripts/build-app.mjs` and the app build configs: don't
edit those; read the X1 stamp through its existing exports.

1. **`scripts/gate.mjs <gate> [-- args]`** runs a named gate (`check`, `harness:ios`,
   `harness:android`, `real-input:ios`, `real-input:android`, `smoke:*`, `bench:*`, or a single
   harness suite) and appends one JSON line to `.gates/<branch>.jsonl` (gitignored; committed copy
   via step 3): gate, code-tree hash (the X1 stamp's digest — code only, docs excluded), HEAD,
   platform/device/lease id, load samples (start/median/max), duration, result, test counts,
   log path. `gate.mjs status` prints, for the current code tree, which gates are green, red or
   missing; `gate.mjs need --for review|merge` exits non-zero listing what is missing for that
   stage.
2. **Re-run rules** (encode them in `need`): docs-only commits never invalidate a green gate (same
   code-tree hash); a fix round needs `check` + the suites of the platforms its code diff touches
   (derive from paths: `android/` → Android, `ios/` → iOS, `cpp/`/`src/`/`nitrogen/` → both);
   **merge** needs the full set on the final code tree once: `check`, full harness both, real-input
   both. Benches are never required by `need` (they go to the bench host).
3. **Report table:** `gate.mjs table` renders a Markdown gate table from the ledger (gate, result,
   counts, code tree, duration, load) for pasting into a report; `gate.mjs export` writes
   `docs/tasks/<id>/gates.jsonl` so the evidence is committed with the report.
4. **Short report template:** `docs/tasks/REPORT-TEMPLATE.md` — summary ≤ 400 words, the generated
   gate table, red proofs as a list (test → mutation → red line), follow-ups one line each,
   questions; fix rounds append ≤ 200 words. Update `AGENTS.md`'s report section to require it and
   to say "run gates through `scripts/gate.mjs`". Drop the device-hygiene boilerplate requirement
   (leases + scripts enforce it).
5. **Tests** for the ledger, `status`, `need` (docs-only commit keeps green; Android-only diff needs
   only Android; merge needs all) and `table`.

Gates: `bun run check`; one real `gate.mjs harness:android` run (lease `nitroui_t01` / 5570 / adb
5041 / Metro 8293) to show a real ledger line and table. Report using the new template.
