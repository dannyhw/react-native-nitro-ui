# G3 Progress: fix round 1 re-review (D19, narrow)

Worktree `~/Developer/oss/nitro-ui-worktrees/G3`, branch `task/G3-progress`, `7928021..9e939a7`.
Scope: the fix commits `6ce334b`, `7fbba69`, `7664340`, `bef4ef0` and `9e939a7`, plus the conflict
check on merge `5a06cd8`. No devices were used. The red and green device runs in the report are
taken on trust; I checked from the code that each one is plausible.

## Verdict: **MERGE**

There is no new must-fix. Both native fixes (F1 and F2) are correct for the paths the library
actually takes. F3's deviation is justified and is documented where users will read it. The
non-blocking items below are small and can go to FOLLOWUPS or a later touch.

## Gate

`bun run check` on `9e939a7` exited 0, all steps:
- typecheck, bench typecheck, eslint and format;
- jest 118/118 in 8 suites;
- `test:native` 262 checks;
- `perf:renders` 4/4;
- nitrogen no drift (118 files);
- autolinking, `bob build`, api-extractor and `publint --strict`;
- manifest 290 files.

The tree was clean afterwards (`git status --short` is empty).

## Per finding

- **F1: verified.** `HybridNitroUiProgress.kt:301` uses `semantics.fillMaxWidth()` on both linear
  branches. The circular branch is untouched.
  - A linear bar always asks the fill-width question (`NitroComposeHost.kt` `NitroUiMeasuredRoot`).
    With a bounded box the child is measured with `minWidth=0, maxWidth=box`, so `fillMaxWidth`
    gives box width.
  - With an unbounded width, the `else` arm asks `Constraints()`. `fillMaxWidth` is a no-op on an
    infinite max, so the bar stays at M3's 240 dp and `layout()` returns `measuredWidth`. No
    infinite or maximum width is claimed.
  - The reported width is now the box width. The engine ignores a `fillWidth` width in
    `sameSizeForPush` (`NitroUiSizingEngine.cpp:103`), so there are no new corrections and no
    cache pollution.
  - Test: `Progress.harness.tsx:293` asserts `|linearMeasured.width - 300| < 1`. This is the
    drawn width from `measureContent()`, not Yoga's box.
- **F2: verified.**
  - **Mints once per configuration, not per render.** `useSizingId(configuration?)` mints only when
    `configuration` differs from the last one stored. `Progress` keys the native view on the
    variant, so the result is one id per native mount.
  - **No leak, no wrong `forget`.** The old view's drop calls `forget(X)` on its own id; the new
    mount files and reports under Y.
  - **Switch, Slider and Button are unaffected.** They call `useSizingId()` with no argument, so
    `undefined === undefined` and the id is minted once, as before.
  - **The new test is real.** The 137×23 seed is not the answer, the poll target is native's own
    `measureContent()`, and the final asserts compare against the `CIRCULAR_SIZE` constant.
    `handles.delete` stops the poll from reading the dying view.
- **F3: verified as a justified deviation.**
  - The Swift code is unchanged.
  - The `Gauge` rejection is reasoned: 58 pt against 20 pt breaks D20's box stability, and it
    needs iOS 16 against a 15.1 floor.
  - The limit is in `progress.md` (API table, mapping table, gate section, Limits) and in both
    `value` JSDocs (`Progress.tsx`, `Progress.nitro.ts`), which is where users will see it.
  - The indeterminate-linear question is answered as measured.
  - The report's mirror and gate claims are corrected.
- **F4: verified.** The 0.09× claim is retracted at both sites, with the cause stated. Run A's
  `mounted` verdict is withdrawn (`presentedBeforeMount=25`), and the bench follow-up is added.
- **F5: verified.** The test settles for 500 ms after the 20th write and asserts
  `expect(applied.length).toBe(updates)`. The reported red is `expected 40 to be 20` on both
  platforms.
- **F6: verified.** The `beforeAll` is gone, along with its import. The first test has its own
  `{ timeout: 20000 }`.
- **F7: verified.**
  - The report says 40 instances.
  - The memory explanation no longer blames the observer.
  - `progress.md` no longer claims that a hidden indicator "costs no frames". It says what the
    test measures, and the CPU measurement is a follow-up.
- **D21: verified.** The only wall-clock number (40-instance mount) goes through
  `expectTimingBudget()`. Nothing else uses `now()` except poll deadlines.
- **Merge `5a06cd8`: clean.** No file was changed on both sides since the merge base `52823a9`.
  `--remerge-diff` is empty. The R1 files (`scripts/real-input/support.mjs`, `timingGate.ts`, the
  harness suites, `metro.config.js`, `rn-harness.config.mjs`) are byte-identical to main.
  `NitroSwiftUIHost.mm` was not touched.

## New must-fix

None.

## Non-blocking (one line each)

- `src/core/useSizingId.ts:34-38` writes a ref during render. If a concurrent render is thrown away (a transition, or Suspense, with a variant toggled back), the ref keeps the abandoned configuration. The next commit then mints a new id for a native view that was *not* remounted, and the native setters (`HybridNitroUiProgress.swift:409`, `.kt:516`) overwrite `sizingInstanceId` without `forget`ting the old id, so one ledger entry leaks. Using `useMemo(() => nitroUiCore.nextSizingId(), [key])`, or moving the `key` onto an inner component that calls `useSizingId()`, avoids this.
- `Progress.tsx:168` passes the raw `variant`, but the `key` is normalised (`isCircular ? 'circular' : 'linear'`). Pass the normalised key so that an invalid JS string cannot mint an id without a remount.
- No jest unit test covers `useSizingId(configuration)` (same id across re-renders with the same configuration, a new id on change). It would be a cheap host-side guard for a shared-core contract.
- `docs/components/progress.md:166` says "(next bullet)", but the next item is the "What we do not do" heading; it should point to Limits. `:220` says "the next bullet rules out", but the next bullet is now the indeterminate-linear one, not "No size or thickness control".
- `progress.md:228-230` guesses that "`UIProgressView`'s indeterminate stripes need more height". iOS `UIProgressView` has no indeterminate mode, so the likelier cause is that iOS draws no animated indeterminate linear style at all. State the measured fact without the guess.
- The `value` JSDoc in `Progress.tsx` and `Progress.nitro.ts` covers the iOS circular limit but not the iOS indeterminate-linear empty track. A one-line addition would put both iOS limits in the IDE tooltip.
