# G5 DatePicker: re-review of fix round 2 (`9a29a3c..d3d5e12`, fix `f45caaa`)

Worktree `~/Developer/oss/nitro-ui-worktrees/G5`, branch `task/G5-datepicker` @ `d3d5e12`.

**What I did.** I read the native diff (`.kt`, `.swift`), the new harness test, the `real-input/android.mjs` addition, the docs, and the report's "Fix round 2". I also checked the cited red logs.

**What I did not run.** No device, Metro, harness or bench was run.

## Verdict: **MERGE**

- N1 and N2 are verified.
- Nothing they touch regressed.
- I found no must-fix.
- One iOS item is worth a follow-up and a comment/report correction. It is not a must-fix: the bounds bucket alone already covers the crash class, and the item's cost is an occasional single extra rebuild. See "Non-blocking" below.

## Gate

`bun run check` on `d3d5e12` is **green** (exit 0). It covers:

- typecheck, lint, format;
- jest, 176/176;
- `test:native`;
- `perf:renders` (262 checks);
- nitrogen, no drift (160 files);
- api-extractor, publint `--strict`;
- package-files (375);
- the README examples.

The log is `/tmp/g5-rereview2-check.log`. `git status` was clean afterwards.

`check` does not compile Kotlin or Swift. For the native changes, the device evidence is the report's logs.

## N1: verified (`HybridNitroUiDatePicker.kt:1287`, `:1327`)

After either effect runs, `pushed` now always equals what the state holds. The `selected` effect either finds `state == wanted` or writes `wanted`, and the `shown` effect sets `pushed` right before every write it makes. The guard's purpose survives this, checked case by case:

- **Programmatic change A→C.** The `shown` effect sets `pushed = C` and writes C. The `selected(C)` effect then sees `picked == pushed`, so there is no echo.
- **Rejected (controlled) pick A→B.**
  1. The tap emits, and `displayed`, `pushed` and the state all become B.
  2. The revert sets `displayed = A`.
  3. The `shown` effect sets `pushed = A` and writes A.
  4. `selected(A)` sees A == A, so nothing is emitted.

  The snap-back still happens. The next tap on B emits again, because `pushed` is A and `displayed` is A.
- **Tap back (the bug).** A→B is emitted and sets `pushed = B`. Tapping A then gives `A != B`, so it emits. Fixed.
- **Tap and programmatic write in the same frame, M3 canonicalisation, and `key` rebuild.** All three behave as before this round. `pushed` is `remember(state)`, so it is re-seeded on a rebuild.
- **Time twin.** It is the same logic. The DST-gap clamp (2:30 resolving to 3:30) writes `pushed` and the state together, so the relaunch for (3,30) does not echo.

**Evidence.** The real-input red against the round-1 apk is genuine (`/tmp/g5-fr4-red-and-n1.log`), and the fixed build is green (`/tmp/g5-fr4-green-and-realinput.log`, with exact counts 0/1/2/3). The clock path is not driven, and the report discloses that.

## N2 Android: verified (`.kt:1056`, `:1116`, `:1361`)

**The key does not change on equal day-bounds.**

- `selectable` is `remember`ed on the bounds' UTC-midnight days, so equal days return the same instance.
- `BoundsSelectableDates` has no `equals`. That is fine here, because `key` sees the identical object.
- `yearRange` is recomputed, but `IntRange` has value equality.

**A genuine change still rebuilds.**

- A day-level move of either bound, or a time zone change, re-keys the `remember`, which gives a new instance and a rebuild.
- A move within a day makes no difference to M3, which only asks `isSelectableDate` with UTC midnights. The model still clamps at instant level.

**Time mode is unaffected.** `rememberTimePickerState` was never keyed on bounds, and the dialog's time step is unchanged.

**The counter is correct.** `noteControlBuild` dedupes on identity, so recompositions do not count.

**Evidence.** The red is real: `expected 4 to be 1`, `/tmp/g5-fr4-red-and-n2final.log`.

## N2 iOS: verified for its purpose (`.swift:225`, `:599`)

**No per-render rebuild for `minimumDate={new Date()}`.** The identity is `min:<local day> max:…` in `date` mode and minute buckets otherwise, so it is stable within a day or minute. Unbounded gives a constant `min:none max:none`.

**Bucketing.** It uses `Calendar.current`, the same calendar and zone the control renders in. Two edge cases are harmless:

- **DST fall-back.** The repeated hour makes two instants an hour apart share a minute bucket. That only means an in-place bound update, which is safe, because the crash needs a cross-day clamp.
- **Eras.** Era-less `year` in the Japanese calendar is theoretical.

**The bucket alone covers the crash class.** A UIKit clamp that lands in another month implies the new bound is on a different day than the old live bound, which means a bucket change and so a fresh control.

**Open popover.** An unrelated render keeps the same bucket and the same escape state, so it gets the same id and no rebuild.

**`|outside` does not flap per render.** While the value stays outside the recorded bounds, the suffix is a constant string, so there is no per-render rebuild. It toggles only when the value crosses the recorded bound.

**Not provable on device.** iOS cannot prove this through the counter, and the report discloses that honestly. See the first non-blocking item for the likely cause.

## Other regressions

There are none.

- **The harness diff only adds.** The 3 removed lines are the doc comment for the widened report format.
- **The report's sixth field is safe for older parsers,** because extra fields are ignored.
- **`real-input/android.mjs` only adds:** a DatePicker step plus `dump`, `nodeByTestId` and `scrollPage` on the context. Other controls' checks are unchanged.
- **Moving `components` to the model** is behaviour-identical.
- **The docs paragraph** now says the rebuild is day- or minute-granular, as N2 asked.

## Must-fix

None.

## Non-blocking (one line each)

- **iOS, `.swift:599-600`.** `.onAppear` sits outside `.id(...)`, so it fires on appearance only (mount or popover open), not on a re-identification. The report itself measured that an `.id` change does not move the counter.
  - **Consequence.** `builtBounds` holds the bounds at appearance, not those of "the control on screen". The code comment (`:206-213`) and the report's claim that "the new control records the bounds it was built from, so the escape stops applying right after" are false.
  - **Effect.** After the bounds widen past the bounds at appearance, a value crossing that old bound (for example, a pick) re-identifies once per crossing. This is not per render, and the crash cover is unaffected.
  - **Follow-up.** Move `.onAppear` before `.id` so that it belongs to the id'd view, and make the suffix sticky, or simply drop the escape, since the bucket already covers cross-day clamps. That would likely also make the iOS rebuild assertion provable.
  - **Now.** Correct the comment and the report sentence.
- **Harness comment.** The comment at `DatePicker.harness.tsx:1053-1060` ("an `.id(_:)` change … was measured not to move it") attributes this to UIKit updating in place. The `onAppear` placement is the more likely cause. Reword it when the item above is done.
- **N1 clock path.** The clock path (`.kt:1327`) is fixed by symmetry only, with no driven test. The report discloses this, and it is acceptable.
