# X25 — iOS Form crashes the bench app in `readoptRowlessCells()`

**Worktree / branch:** named in your delegation message (`task/X25-form-ios-bench-crash`). **Round cap:** 1 round,
plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X25 --boot`). Export
the lease's environment before any device gate or bench run.

## The problem

X24's bench run found that `mount.form` crashes the bench app on iOS on `main`'s own code, 8 of 8 launches, in
`HybridNitroUiForm.readoptRowlessCells()` (`ios/components/Form/HybridNitroUiForm.swift`, around line 594: a deferred
`snapshot.reconfigureItems(ids)` + `dataSource.apply`). The harness and real-input gates never mount a Form the way
the bench does (N = 20/50 rows, mounted and torn down in a loop), so nothing else has caught it. An app with a large
Form, or one that mounts and unmounts Forms quickly, may crash the same way. Evidence: X24's report
(`origin/task/X24-fix1`, `docs/tasks/X24-stepper-form-examples.report.md`, its bench section and follow-ups) and the
gate/bench logs it names.

## Do

1. **Reproduce** on the simulator with the bench (`scripts/bench/run.mjs --plan quick --component form --only
   nitro-ui`, or the narrowest cell that crashes), and capture the exception and stack. X24 also found bench
   infrastructure problems (a `bench/assets` path bug that stops the bench app bundling, and Android's
   `:app:createBundleReleaseJsAndAssets` not seeing library sources). Fix whatever stands between you and a reproducible
   iOS run, and note the rest as one line each.
2. **Find the cause** (for example: an apply on a data source whose list is being torn down, identifiers that are no
   longer in the snapshot, duplicate identifiers, an apply racing another apply, a `weak self` that outlives the view
   in a recycled state) and **fix it in the component**.
3. **A test that reproduces it in the harness**, red first: mount a Form with enough rows, trigger the readopt path,
   and unmount or recycle it in the same turn (or whatever the cause needs), on iOS. If Android has an equivalent
   path, check it too.
4. Run the iOS `mount.form` bench to completion and put its numbers in the report, with the Android numbers beside
   them.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/X25-form-ios-bench-crash.report.md`, cause first. Export the ledger with `gate.mjs export --task X25`.
