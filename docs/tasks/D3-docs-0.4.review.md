# D3 review — docs pass for 0.4.0

**Verdict: MERGE WITH FIXES.** Wording only. No export or behaviour changed: the `src/` diff is
comments only. The `MenuProps` example compiles (`check` green on `f5fde7b12de3`) and matches D32.
Every brief item is covered, and the smoke ticks are honest. `gh workflow list --all` agrees
(CI/Changeset status/Release/Release tag active, Bench/Smoke `disabled_manually`, 0 runs each).
The Menu bench numbers match G7b's tables. No D25 leaks.

## Must fix

1. **`src/components/Host/HostChildren.ts:49-50,55` is false, and it ships in the tarball.**
   Switch, Slider, Progress and Button were never "said not to be able to hold". "a fourth such
   window" also contradicts README and host.md, which both say Menu is the third. Replace 49–50 with:
   `The H2b three are the ones a \`<Host>\` was said not to be able to hold, because two of them`
   / `(\`Picker\`, \`DatePicker\`) present a popup or a dialog: a window of its own.` On 55 replace
   `a fourth` with `a third`.
2. **`CONTRIBUTING.md:9-10`: "the second comments on a pull request" is false.**
   `changeset-status.yml` prints a warning annotation and stays green. Replace with: `the second
   adds a warning (never a red check) to a pull request that changes library code without a
   changeset`.
3. **`README.md:687-688`: `Changeset status` does not "run the release path".** Replace with:
   `` `Release` and `Release tag` run the release path, and `Changeset status` warns on a pull
   request that has no changeset.`` While there, re-indent the `status`` run…` line under the
   bullet.
4. **`README.md:572-583`: the run count is wrong, and one claim is false.** G7b reports four runs,
   not three. The fix round added an iOS full plan, which carries no `quiet` stamp either
   (5 of 146 samples over the ceiling). And the Android full plan includes `update` at N=50
   (`PLANS` in `scripts/bench/lib.mjs`), so "which nothing has re-measured" is false; G7b just
   doesn't tabulate that cell.
   - On 572–573, replace the runs sentence with: `one quiet \`--plan quick\` run per platform,
     plus a full plan on each`.
   - On 578, replace `the one run of the three that was not quiet` with `a run that was not quiet`.
   - On 583, replace `, which nothing has re-measured.` with `, so that ratio carries no verdict.`

## Should fix

5. **`CONTRIBUTING.md:961`:** `smoke.yml` never had a label trigger. Its git history shows only the
   nightly `cron`. Replace with: `demand; its nightly schedule is off, so it is \`workflow_dispatch\` only`.
6. **`CONTRIBUTING.md:12-13`: wrong rationale and wrong decision cited.** D21 is about harness
   wall-clock gates, not bench or hosted runners, and the workflow files cite D22/D25. The text was
   copied from the existing `:1288-1290`. Replace with: `— hosted runners make device jobs slow
   and noisy, and the device gates that decide a task run locally (D22, D25).` `:1290` has the same
   miscitation (it predates D3, so log it as a follow-up).
7. **`docs/components/host.md:219-220`: "the same three functions in `Picker`'s and `Menu`'s own
   models" overstates.** `placedViewOf` is one top-level `internal fun` in
   `HybridNitroUiPicker.kt:927`. The models only have their own `noteCompositionOrigin` and
   `dropOpenMenu`. Replace with: `and in \`Menu\` by its own \`noteCompositionOrigin\` and
   \`dropOpenMenu\` and the shared \`placedViewOf\``.
8. **Report: two factual errors.**
   - `:98`: the README has **five** ticks, not four.
   - `:4`: "No devices are needed" is not in `docs/tasks/D3-docs-0.4.md`. Cite the delegation
     message if that is where it came from, or drop the quote.

## Nits (optional)

- `README.md:327` and the `readme-examples.tsx` twin: `onSelect={setLast}` reads like the
  other examples (`onValueChange={setEnabled}`).
- `README.md:297`: on iOS the trigger is a SwiftUI `Menu` label styled with Button's
  `.buttonStyle`, not a `Button`. Replace with: `The trigger is drawn like a \`Button\`, with
  \`Button\`'s variants and sizes.`

## Checked and correct

- **Components table and Host paragraphs.** The table row, the Host paragraph, Known limitations
  and the Usage note on D32 are all correct: `onOpen`/`onClose` are Android-only, `onSelect` fires
  before `onClose`, and on Android only does `disabled`-while-open close the menu.
  `systemImage`/`primaryAction` are iOS-only, and a submenu is inline on Android.
- **Bench figures.** 217.9/248.6/0.88×, 77.5/76.3, 64.8/168.9/65.5, 25 of 176, 346.3/262.0/1.32×
  and 3.18× all match G7b's tables. So do the mac-1/mac-2 baseline claims (mac-1 has no `picker`
  keys; neither machine has `menu`) and `ARMS_WITHOUT_COMPONENT`.
- **Smoke.** `SMOKE_CONTROLS` is 8 controls + `host`. The 0.1.0 ticks are from R5b (2026-10-26),
  and no ledger or report has a smoke run since then.
- **CI and Bench.** `ci.yml` triggers three jobs and keeps the device jobs behind
  `workflow_dispatch`. Bench has 0 runs.
- **Changeset.** Patch, and accurate. It rides with `menu-button-anchored` (minor), so 0.4.0.
- **Scope.** The CONTRIBUTING baselines line, `benchmarks.md`, `switch.md`, `example/README.md` and
  the `lib.mjs` comment are all stale-count/workflow fixes, inside "check for more".

## Gates

`check` is green. `need --for review` wants `harness:ios`/`harness:android` only because of
`example/src/readme-examples.tsx`. Nothing in `example/` imports that file (grep), so no app bundle
can contain it, and `check`'s `readme:check` + typecheck cover it. I recommend waiving both rows.
The fixes above are `.md` plus one `src/` comment; `check` must re-run after them.
