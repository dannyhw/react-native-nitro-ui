# F2 — Follow-ups sweep (small, mostly docs and comments)

**Machine:** maintainer-mac-1. **Worktree / branch:** named in your delegation message (from `main`).
**Round cap:** 1 implementation round plus at most 2 fix rounds (D19). **Devices:** only if an item
changes a harness test or app code, from that machine's lease (`--boot`).

Do the F2 group in `docs/tasks/FOLLOWUPS.md`'s header. Each item's evidence (file:line) is in
`docs/tasks/Q4-followups-triage.md` (rows 9, 18, 19, 25, 31, 43, 50 and 54); re-check every line
against the current tree first, because some may have moved or been fixed since.

- comment and doc fixes, and `slider.md`'s thumb-only drags;
- sizing.md's "prospective" line;
- C1's N1–N5;
- the bench `nitro-ui-host` comment;
- H1's S2 case and the leftover `0 x 0` comment;
- X1's doc table (20 → 19);
- the always-true assertion (make it able to fail, shown red);
- platform-correct `harness:*` labels;
- `--clean` also dropping the pod-input record (with a test, shown red);
- the three fake dark cards in the Switch, Progress and SegmentedControl stories;
- the S1 report's unverifiable `real-input:android` PASS row (annotate it; don't rewrite history).

For each item done, remove or shorten its FOLLOWUPS line. If an item turns out larger than a small
fix, write one line in Follow-ups and skip it. Any harness test file you change is run on both
platforms (AGENTS.md).

## Gates

`check`, then `need --for review`, plus harnesses if app or test code changed. Report:
`docs/tasks/F2-followups-sweep.report.md`, with the ledger exported. Commit after each item. Don't push.
