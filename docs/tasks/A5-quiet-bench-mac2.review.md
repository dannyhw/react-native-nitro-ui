# A5 review

**Verdict: FIX ROUND** (docs only, fix 1 of 2). The transcription is accurate. Every ratio, range, `--check` count, stamp and leak slope I sampled matches the results. Ratios are `pairedLaunchRatios`, and `n/v` means either arm is noisy against `rn-core`. Several shipped README sentences are false against those numbers, though, and the conclusions that changed were never raised as Questions (brief item 4).

## Must fix

1. **README:576-578**: the direction is wrong. Change "0.05 further from the shared host than the figure above, which is the size of the machine effect." to "0.05 closer to the shared host than the figure above (0.91× against 0.86×); the runs differ in machine, plan and code, so the gap is not attributed."
2. **README:605-608**: Slider memory is 1.02×, the JS clause contradicts itself, and Progress is missing. Change "the memory and UI-thread win holds … where it is 0.62× the shared host —" to "the UI-thread win holds on all four and the memory win on three, `Progress` most of all, `Slider` level at 1.02×; JS costs 1.17× on `Switch` and 1.11× on `Slider`, while `Progress` (0.77×) and `Button` (0.69×) are below the shared host, as unhosted (0.59×, 0.62×) —"
3. **README:624-627**: change "except the unmount ones" to "except the unmount ones and `Progress` memory". Change "the only over-threshold row is" to "the only over-threshold row that is not noisy is", because four noisy rows are also over.
4. **README:632**: change "JS CPU per op unchanged" to "JS CPU per op up 2–11 %".
5. **README:473**: change "0.10× ✓" to "0.10× ✓ `n/v`", as A5's own table has it.
6. **README:479-481, 496-497**: the "row-drawing" cause has no support. Our Picker and Menu are heavy (292.2 and 213.1 KiB); `@expo/ui`'s are heavier (320.0 and 250.4 against 50.6–77.4 KiB for the others). Change "so the bill is … every control pays." to "— not because ours are lighter, but because `@expo/ui`'s Picker and Menu cost 320.0 and 250.4 KiB." Change "which is why the fix is about the row-drawing controls rather than about Compose hosting in general." to "because `@expo/ui`'s Picker and Menu are heavy, not because ours are light." Add `` `n/v` `` after "`Progress` 1.70×".
7. **G5:762-763** contradicts G5:742-744. Change "and none is monotonic, so no leak is claimed." to "and only Android `nitro-ui-host` is monotonic (602 KiB/cycle); no leak is claimed here."
8. **sizing.md:548-550**: hosted Switch UI was never ᴺ, six flags clear, and one verdict reverses. Change the clause from "with two of the ᴺ flags cleared" to its end to "with six ᴺ flags cleared (unhosted `Switch` UI CPU and unmount, unhosted `Button` UI and JS, hosted `Button` JS 0.69x, hosted `Slider` JS 1.11x) and one verdict reversed: unhosted `Slider` JS CPU 1.06x against 0.94x here."
9. **A5 report**: add `## Questions for orchestrator`. List the moved conclusions: Android memory "every", the frame-floor scope, G5's attribution, unhosted Slider JS, and hosted SegmentedControl UI 0.92→1.00. Recommend the scoped wording.

## Should fix

- **Leak finding** (A5:31-35, 211-213; G7b:209-214, 417-421).
  - Define the runner's "monotonic": in all 8 launches, each of `leak0`–`leak10` is ≥ the one before, and ties count (lib.mjs:1289-1294).
  - `heapCollected: true` only means Hermes `gc()` was callable (probe.ts:158). It is true on every leak cell, so it does not set these four apart and does not show that ART collected.
  - The unhosted slopes are larger on slider (845), button (647) and date-picker (933), and `rn-core` is positive too (128–315). In G7b, change "growth rather than drift" to "steady in every launch rather than a wobbling series".
  - Change "a baseline stores no leak slope" to "`nitro-ui-host` is a reference arm that never gates (lib.mjs:72), and a baseline keeps a slope only when its mint's cell was monotonic (lib.mjs:1618-1623)".
- **G5:752-753**: change "so it was not load: the extra bytes came in with the code between those two trees and are still there" to "so the fix-round figure was not load; the quiet run is another device, machine and tree, so it does not attribute the move". **G5:756**: change "the faster machine" to "that run's machine and iPhone Air simulator".
- **H2b:173**: change "The only number that really moves is" to "Two numbers move: `SegmentedControl`'s hosted UI CPU, 0.92x → 1.00x (parity), and".
- **G6:400**: change "the Android `UI CPU/op` miss carries a gate as well as an explanation" to "a regression of its ratio to `rn-core` is gated there; the 1.47× shared-host miss is a same-run reading no baseline stores". **G6:205**: change "0.24× PASS" to "0.24× (nv)", because the per-control arm is noisy.
- **A5:217**: change "1.00× vs 2.48×" to "1.00× vs 2.24×" (both against the shared host).
- **README:595/597, host.md:68**: change "**0.45×** n/v" to "0.45× `n/v`", bold "**0.77×**", and change host.md's "`Progress` 0.45x" to "`Progress` 0.45x (`n/v`)".

## Nits

- A5:204 says "kept for the record", but H2a replaced its tables.
- H2a's cross-reference names the old section header.
- G7b's ÷ per-control column is missing (nv) at N=200 presented and N=1 JS commit.
- README:603: change "lands where" to "lands near".

## Verified

- Item 3, the 815/941 counts, and the iOS floor: only Button sits on it for both arms (16.10/16.13).
- No D25 leaks; docs only.
- `check` and both bench rows are green on `8767d2e1939d`.

**Follow-ups (not A5's):**

- render.mjs:236 labels a reference arm "MONOTONIC (gated as a leak)".
- The ledger records the iOS bench as `platform: android`, `emulator-5574`.
