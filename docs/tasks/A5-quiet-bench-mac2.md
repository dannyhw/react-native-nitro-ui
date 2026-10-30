# A5 — Quiet bench window on maintainer-mac-2: re-runs against its baselines, and Menu's cells

**Worktree / branch:** named in your delegation message (from `main`). **Machine:** the one labelled
`maintainer-mac-2` (export `NITRO_UI_MACHINE_LABEL`). **Round cap:** 1 round, plus at most 2 fix rounds
(D19). There are no retries of a refused run and no `--force`, ever. Don't push.

The H2a, H2b, G5, G6 and G7a/G7b reports, and README "Performance", quote bench numbers taken on a busy
machine and label them indicative (RECOVERY "Next", step 2; FOLLOWUPS "H2a"). This window replaces them
with quiet numbers. It also gives Menu its first committed baseline cells on this machine, because
G7b's numbers were deliberately not minted.

Read first:
- AGENTS.md;
- `docs/tasks/A3-baselines-mac2.md` and its report (the exclusive-lease, settle and preflight procedure;
  follow it exactly);
- `docs/tasks/A4-ios-baseline-mac2.report.md`;
- CONTRIBUTING "Benchmarks";
- the Bench sections of `H2a-host-more-controls`, `H2b-host-popups`, `G5-datepicker`, `G6-picker` and
  `G7b-menu-finish` (their `.report.md` files).

## Do

1. **Exclusive window:** `node scripts/lease.mjs acquire --task A5 --exclusive`. Settle before each
   platform exactly as A3 2b says, and record load before and after.
2. **Check runs:** `bun bench --platform <p> --plan full --launches 8 --check`, iOS then Android. These
   are the quiet numbers.
   - Paste each run's `machine.loadSamples` summary.
   - A run over the load ceiling is reported as not quiet and not re-run.
   - If `--check` goes red on a cell, report it verbatim. Don't re-mint over it, because a red check
     against this machine's own baseline is a finding.
3. **Menu's cells:** find out from `scripts/bench/run.mjs` and `scripts/bench/report.mjs` how
   `--update-baseline` treats a baseline file that already holds other components' cells. Does a
   `--component menu` run add cells, replace the file, or refuse?
   - If it can add Menu's cells without touching anything else, do that, one commit per file. Show the
     diff touches only `menu` keys, and do the `--check` read-back and doctored-copy red proof from A3
     item 6.
   - If it can't, don't change the runner and don't re-mint the whole file. Stop and ask (Questions),
     with options.
4. **Replace the indicative tables** with the quiet ones, in the five task reports and README
   "Performance". Keep the caveat on any cell whose run wasn't quiet. Change only numbers and their
   labels, never the conclusions, unless a quiet number reverses one. If it does, say so in the
   report and in Questions.
5. **Release the lease** at the end, even if a run fails.

## Gates

`check`, then `need --for review`. The bench runs themselves are reported in their own tables, not
through `gate.mjs`. Report: `docs/tasks/A5-quiet-bench-mac2.report.md`.
