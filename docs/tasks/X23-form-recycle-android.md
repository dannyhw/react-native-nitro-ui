# X23 — Android: a recycled Form doesn't always start at the top

**Worktree / branch:** named in your delegation message (`task/X23-form-recycle-android`). **Round cap:** 1 round,
plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X23 --boot`). Export
the lease's environment before any device gate.

## The problem

`example/__tests__/Form.harness.tsx`, "starts a recycled Form at the top of its own content" (G24), fails on Android
with `expected 200 to be less than or equal to 1` (line ~1266): the recycled Form reports a scroll offset of 200
where it should be at the top. It passes when Form's suite runs alone and fails after other suites run first
(G27 reproduced it after Switch alone), and it failed in G26's and G27's full `harness:android` runs while passing in
G24's and X22's. Evidence: `node scripts/gate.mjs logs --branch task/G27-search-field-keyboard --failed` and
`--branch task/G26-fix1 --failed`; G27's report (`origin/task/G27-search-field-keyboard`,
`docs/tasks/G27-search-field-keyboard.report.md`) has the bisect.

## Do

1. **Decide whether this is a product bug or a test bug.** An app that recycles a scrolled Form must get it back at
   the top on Android, whatever ran before. Find what earlier suites leave behind that changes it (view recycling
   pool state, a pooled `RecyclerView`/`LazyColumn` state, a scroll position restored by Compose's saveable state, an
   async reset racing the read).
2. **Fix it at the cause.** A product bug is fixed in Form's Android code with a red proof that reproduces the order
   dependency on purpose (run the case after a suite that triggers it, or recycle twice). A test bug is fixed in the
   test, without loosening what it checks (the offset must still be at the top).
3. The full `harness:android` must pass with Form after other suites, twice in a row.

## Not in scope

iOS (unless the cause is shared and the fix belongs in shared code), and anything else, which goes as one FOLLOWUPS
line.

## Gates

`check`, `harness:android` (twice), and `harness:ios` and `real-input:android` if you touch Form's code. Then
`need --for review`. Report at `docs/tasks/X23-form-recycle-android.report.md`, cause first. Export the ledger with
`gate.mjs export --task X23`.
