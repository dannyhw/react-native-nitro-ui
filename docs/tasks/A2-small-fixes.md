# A2 — Phase A: deferred small fixes

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/A2` (branch `task/A2-small-fixes`, from `main`).
**Devices / env:** assigned in the delegation message.
**Round cap (D19):** 1 + 2 fix rounds. Stay inside this list. Do not push. CI is switched off on
GitHub (the human's call) — don't change or re-enable workflows.

1. **`useSizingId(configuration?)` (G3 re-review):** it mints the new id into a ref during render, so
   a render React discards (transition / Suspense flipping the variant back) can leak one sizing-engine
   entry. Mint per configuration in a way that survives discarded renders (e.g. `useMemo` on the key,
   or key an inner component) and make sure the old id is `forget`-ten exactly once. `Progress.tsx`
   (~:168) must pass the **normalised** variant, the same value the `key` uses. Add the missing unit
   test for the `useSizingId(configuration)` contract (fresh id per configuration, stable across
   re-renders, no leak) and show it red against the current implementation.
2. **Consumer smoke checks each control** (R2 follow-up): today the smoke passes on ready line +
   no crash + screenshot. Make `scripts/smoke/App.tsx` report, in its ready line, that each of the
   five controls laid out with a non-zero size (e.g. per-testID `onLayout` sizes), and make the smoke
   assertions require all five. Show it red (e.g. one control forced to 0×0 or not rendered). Run
   `smoke:expo` and `smoke:rn-cli` (0.88) on both platforms.
3. **Package file count:** `manifest:check` expects 333 files but `npm pack`'s `prepare` rebuild
   ships 332 (`lib/typescript/src/tsdoc-metadata.json` only exists after api-extractor). Make the
   manifest and the real tarball agree regardless of step order, and prove it by running
   `npm pack --dry-run` from a clean `lib/`.
4. **Storybook:** the iOS Button "dark surface" showcase only darkens the background (colour scheme
   stays light), so the disabled button is near-invisible. Make the panel actually render in dark
   mode on both platforms, or drop it. Screenshot before/after.
5. **progress.md / JSDoc leftovers** from `docs/tasks/G3-progress.rereview.md` that R2 did not
   already fix (check each: two wrong cross-refs, speculative `UIProgressView` stripes note, iOS
   indeterminate linear empty track in the `value` JSDoc).

Gates: `bun run check` green; iOS + Android harness full suites green; real-input green both;
smoke as in item 2. Report per AGENTS.md.
