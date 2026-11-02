# X17 — Small tooling follow-ups from X16, G8 and G9

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease on this machine. Don't use `--exclusive`; the owner may be using the
machine.

## Workspace on this machine

- The project checkout here is the owner's own working copy. Don't edit it, switch its branch, stash, reset or
  clean it.
- Make your own worktree from `origin/main` on branch `task/X17-tooling-followups`, and run `bun install` there.
- Push only that branch: never `main`, tags or force, and don't open a PR.
- Touch no other project.

## Do

Each item is a line in `docs/tasks/FOLLOWUPS.md`. Fix each one with a test shown red first, then remove its line.

1. **The stability WARN** fires on any uniform first-read ratio, e.g. 0.8×. Warn only on a named screen scale, and
   add a uniform-0.8 fixture (`scripts/real-input/a11y.mjs` `iosStabilityWarning`).
2. **The `lease.mjs acquire --exclusive` summary** counts a spared device twice. Leave spared keys out of
   `reaped.kept`.
3. **The CONTRIBUTING exclusive-boot doc guard** (`lease-pool-cli.test.js`) skips backslash-continued commands.
   Join continuations before filtering.
4. **`lease-pool-cli.test.js`'s `cli` helper** spreads `process.env` without `withoutLeaseEnv`, so
   `NITRO_UI_LEASE_BOOT=1` in the shell turns 3 cases red. Scrub it the way X16 did the others.
5. **`lease.mjs` `USAGE`** should list `--boot`, and say that `--exclusive --boot` needs `--platform`.
6. **`scripts/real-input/android-calendar.mjs`'s "Why the weekday header" table** quotes invented day-cell widths.
   Replace them with the real dump's numbers (G8 report), or drop the table.
7. **The `Menu.harness.tsx` comment** that says "on either platform's harness" where it means iOS. This is a harness
   file, so run both `harness:*`.

## Gates

`check`, both `harness:*` (item 7), and `real-input:ios` (item 1 touches the iOS real-input summary). Then
`need --for review`. Report at `docs/tasks/X17-tooling-followups.report.md`, with the ledger exported.
