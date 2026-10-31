# X15 — Tooling and test hygiene sweep

**Worktree / branch:** named in your delegation message (from `main`). **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task X15 --boot`). F6 holds the other pair.

Seven small items from `docs/tasks/FOLLOWUPS.md`. Each one gets a test or a check that is shown red first
(AGENTS.md). Read the FOLLOWUPS line for each before you start.

## Do

1. **Lease/Metro overlap** (FOLLOWUPS "Lease/Metro hygiene incident").
   - `lease.mjs` must not hand out a pair whose Metro port a live gate process still serves.
   - A device gate must pre-flight its leased Metro port and refuse, naming the process, when someone else serves
     it.
   - Reproduce the incident's shape in a test: a stale gate on the port, then a new lease.
2. **`test:native:android` runs automatically** (FOLLOWUPS "G7a fix round 2 added … `MenuModelTest.kt`").
   - Wire it into `check` if a warm run adds under about 60 s on this machine. Otherwise put it in the Android CI
     job, and say which and why, with the timing.
   - Show it red by breaking `MenuModel.applyPick`'s order.
3. **Menu's hosted iOS read-back race** (FOLLOWUPS "iOS `Menu · inside a Host › reports what React sent…`").
   - At `example/__tests__/Menu.harness.tsx:1855` the test reads the `read-back-fallback` handle once. Wait for it,
     using the harness's existing wait helpers.
   - This is a harness file, so run it on both platforms.
4. **The gate ledger records a bench's platform from the lease, not from `--platform`** (FOLLOWUPS "The gate
   ledger records A5's iOS bench run as `platform: android`"). Record the bench's own platform and device.
5. **`scripts/bench/render.mjs:236`** labels a reference arm's monotonic leak cell "gated as a leak". Only
   `GATED_IMPLEMENTATIONS` gate, so label the others accordingly.
6. **`gate-core.mjs` maps `example/src/readme-examples.tsx` to both platforms.** Nothing in the app imports it, so
   add it to the check-only tooling list.
7. **CONTRIBUTING's CI section** says `macos-latest`, but `ci.yml` uses `macos-26`. Fix the doc.

Remove each FOLLOWUPS line you close, and point it at this report.

## Not in scope

F4–F6 items. Any other FOLLOWUPS line: add new findings as one-line follow-ups.

## Gates

`check`, both `harness:*` (item 3 touches a harness file), then `need --for review`. Report:
`docs/tasks/X15-tooling-sweep.report.md`, with the ledger exported.
