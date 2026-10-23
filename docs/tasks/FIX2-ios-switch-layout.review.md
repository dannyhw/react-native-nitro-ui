# FIX2 — a props update must not resurrect a superseded measurement · review (D19)

Branch `fix/ios-switch-value-update-layout` @ `82be1be`, from `97fd8d2`. I reviewed
`git diff 97fd8d2..HEAD` against the brief, the report, D19, D20 (on `main`), and the RN 0.88
sources in `node_modules/react-native/ReactCommon`. No simulator or emulator was used. Device
claims come from the implementer's logs in `/tmp/fix2-*.log`, which I read. Everything else was
checked by reading the code, by mutation, or with host probes I wrote and ran in `/tmp/fix2-bench/`
(untracked).

## Verdict: **MERGE-AFTER-SMALL-FIXES**

The fix is correct on both platforms. The harness cases are real regressions, and the T11 S1 fast
path survives for instances that were never corrected. Three statements in the code comments and
docs are false, though, and D20 repeats two of them. Fixing them costs one line of code plus
rewording, or rewording alone. No other change is needed before merge.

## Gate

- **`bun run check`: green** on `82be1be` (`/tmp/fix2-review-check.log`, `CHECK_EXIT=0`).
  `test:native` passed 256 checks, both plain and under ASan. `package-files` matched 205 files.
  The tree was still clean afterwards.
- **`git merge-tree main fix/...`:** conflicts only in `docs/tasks/STATUS.md` and
  `docs/tasks/FOLLOWUPS.md`, both trivial. For STATUS take `main`'s rows; for FOLLOWUPS keep both
  sides' lines. G2 touched no `cpp/` file, and `cpp/`, `scripts/native-tests/` and
  `Sizing.harness.tsx` merge identical to the branch.

## Findings that must be fixed (docs/comments; item 1 has an optional one-line code form)

### 1 — False claim: an instance whose sizing key changes gets the sticky flag without ever being corrected

`measure()` resets `ledger.laidOut` to `{}` on a configuration change
(`cpp/NitroUiSizingEngine.cpp:420-423`). It then compares the new answer with that empty size at
`:446`, so **every** key change sets `answerChanged`, even a warm key whose size is identical.

Host probe (`/tmp/fix2-bench/keychange.cpp`): a Button moves from `…|Save` to `…|Edit`, both
seeded at 80×35. Result: `flag=1 pushes=0 corrections=0`.

That contradicts three statements:

- `docs/architecture/sizing.md:362-364`: "a control the engine never had to correct still costs no
  measure per prop turn".
- `cpp/NitroUiSizingEngine.hpp:286-287`: "An instance whose answer never moved keeps the fast
  path".
- D20 on `main`: "Never-corrected instances keep the zero-cost path".

The flag is also unnecessary here. A key is a JS prop, so the key-change turn is a JS-lineage turn
that is already dirty (`newConfiguration`). React's own revision receives the fresh answer in that
turn's layout. A correction that follows still raises the flag at `:769`.

**Fix (pick one):**

- Make `:446` `if (ledger.hasMeasured && sameConfiguration && !sameSizeForPush(...))`, and add a
  host case built from the probe above. This is one line of native code, so a re-review of only
  that line is enough.
- Reword the three statements to say "never corrected *and* never re-keyed".

Note that no host test covers `:446` today. With it commented out, `test:native` still passes 256
checks; only `:769` is pinned.

### 2 — False cost claim: a flagged instance pays a Yoga pass, not "one lookup"

Two places state the cost too low:

- `sizing.md:364`: "a control it did pays one lookup".
- `NitroUiSizingEngine.hpp:284`: "one lock and one hash lookup".

What a flagged props turn actually does:

1. The engine lookup.
2. `setDirty(true)` on the leaf, which dirties every cloned ancestor through `updateYogaChildren`
   (`YogaLayoutableShadowNode.cpp:380-389`).
3. A Yoga pass from the root. When nothing is dirty, RN skips that pass entirely
   (`RootShadowNode.cpp:22`).
4. One `measure()`.
5. RN's post-layout walk.

See the cost numbers under question 2 below. The report's perf table ("1 measure, 0 corrections")
is accurate. The prose is not. Reword both places.

### 3 — False mechanism text: the stale answer is not "both answers inside its Yoga node"

Where the text appears:

- `cpp/NitroUiSizingEngine.cpp:436-443` ("keeps *both* answers inside its Yoga node").
- `cpp/NitroUiIntrinsic.hpp:222-230`.
- `NitroUiSizingEngine.hpp:278-283`.
- `sizing.md:350-356`.
- D20 ("RN carries it into every clean clone").

The corrected revision was cloned with `.state` and dirtied (`NitroUiIntrinsic.hpp:232-234`), so
Yoga **cleared** its cache (`CalculateLayout.cpp:2669-2683`). That revision holds only the new
answer. What survives is React's own pre-correction revision, and React clones from it:

- `UIManager.cpp:171-177` passes no `.state`, and `ShadowNode.cpp:119` copies the source's state.
- That revision carries its stale Yoga cache and its stale `layoutMetrics_`
  (`LayoutableShadowNode.cpp:32`).
- RN normally heals exactly this through `progressState`. The JS clone's old state is obsolete
  (`ShadowNodeFamily.cpp:156-173`), and RN re-clones it with `.state`
  (`ShadowTree.cpp:109-185, 383-390`), which our override dirties.
- But our `adopt` (`NitroUiIntrinsic.hpp:395-410`) calls `setStateData` on every props change. That
  mints a new, never-obsolete `State` from React's stale one (`ConcreteShadowNode.h:171-175`,
  `State.h:104`). `progressState` therefore skips the node, and the stale state is committed as the
  family's most recent one.

In the test row, nothing else is dirty, and an unchanged style leaves the clone clean
(`YogaLayoutableShadowNode.cpp:399`). So most likely no Yoga pass runs at all, and the box is the
copied pre-correction `layoutMetrics_` (40×20 at x=380). The report's fact 4 (`canUseCachedMeasurement`
reusing a `MaxContent` entry, `Cache.cpp:22-30`) only applies when something else dirties the tree
in the same turn. I inferred this from the sources and did not confirm it on a device.

The remedy is right for both paths: a dirty leaf forces the pass, and `needToVisitNode` drops the
stale cache. Correct the explanation so the next maintainer looks at `adopt` and `progressState`
and not at Yoga's cache.

## Answers to the brief

1. **Root cause.** Facts 1–3 are correct (`LayoutResults.h:45,47`; clone copies `yogaNode_` at
   `YogaLayoutableShadowNode.cpp:100`; cache cleared only under `needToVisitNode` at
   `CalculateLayout.cpp:2669`; `completeClone` dirties only through the override at `:152-160`).
   Fact 4 and "the node keeps both answers" are wrong, as explained in finding 3.

   Dirtying the measurement is **correct**, and it is **minimal in code**: one clause. It is not
   minimal in cost, because the flag is sticky (see question 2).

2. **The sticky flag.**
   - **Clearing.** The ledger entry is erased by `forget` (`NitroUiSizingEngine.cpp:303-309`), so
     the flag goes with drop, recycle, expiry sweep and dead targets. That is pinned by
     `sizing.test.cpp`. `invalidateEnvironment` keeps the flag (`:216-238`). That is right: an
     epoch bump makes React's revision more stale, not less.
   - **Hot controls.** Yes, an instance that was ever flagged pays a measure and a Yoga pass on
     every later props turn for the rest of its mount. That includes every instance in a corrected
     cold batch (the probe flagged all 200) and every re-keyed instance (finding 1). Host numbers on
     an M-series Mac, `-O2`:
     - `requiresFreshMeasure`: **11.4 ns**. Every props turn of every sized instance pays this,
       flagged or not. Before FIX2 the cost was 0.
     - Warm exact `measure()`: **32.5 ns**.
     - The Yoga pass one dirty leaf forces, against **0** for a clean tree:

       | Tree | Nodes, depth | Yoga pass |
       | --- | --- | --- |
       | Small | 35, depth 4 | **8.4 µs** |
       | Settings screen | 99, depth 8 | **18.3 µs** |
       | Large | 316, depth 15 | **47.8 µs** |

       These are RN 0.88's Yoga built from `node_modules` (`/tmp/fix2-bench/yoga_bench.cpp`). They
       are a lower bound: they exclude RN's layout-metrics walk and the diff. Expect 1–3× on phones.
     - A 60 Hz Progress or a Slider drag therefore spends about 0.5–3 ms per second, roughly
       0.05–0.9 % of each 16.7 ms frame. That is what stock RN pays for any `Text` on every props
       turn. It is a perf trade, not a blocker.
   - **Cheaper alternatives.**
     - *Clear the flag once a fresh measure confirms the size*: **incorrect**. The correction's own
       native commit re-measures and confirms 61×28 while React's revision is still stale, so the
       next JS turn would be clean and wrong, which is the exact harness sequence.
     - *Dirty only when the cached Yoga answer differs*: workable, since `yogaNode_` is protected
       (`YogaLayoutableShadowNode.h:110`). It reads Yoga internals, though, and a fill-width or
       clamped box never matches the engine's answer.
     - *Dirty when the clone's state is obsolete*: the cheapest correct option I see, and it is not
       sticky. Return true when `this->getState()->getMostRecentStateIfObsolete() != nullptr`; in
       `completeClone` the state is still the copied source state. This is the signal
       `progressState` would have acted on. It costs one family-mutex read, uses no engine lock,
       and dirties only the first JS turn after each native push. Device-unverified; filed as a
       follow-up.
   - **Thread safety.** The engine call is reached only for props clones. State clones return
     early at `NitroUiIntrinsic.hpp:232-234`, and Yoga's clone callback passes no props, so it
     returns at `:236-240`. Pushes run outside the lock (`NitroUiSizingEngine.cpp:804`), and
     nothing calls clone while holding `mutex_`, so there is no re-entrancy or deadlock. One thing
     is new: an unflagged props clone on the JS thread can now wait on the shared lock while the
     main thread holds it in `report`/`applyReports`. That wait is bounded by the locked part of a
     flush. Follow-up only.

3. **Android.** Covered. Both platforms build on the same shared
   `IntrinsicShadowNode`/`IntrinsicComponentDescriptor`
   (`nitrogen/generated/shared/c++/views/HybridNitroUiSwitchComponent.hpp:111,116`, the Slider's at
   `:123,128`), and `adopt` runs on both. The logs show red on `main` and green on the branch:
   - Red: `/tmp/fix2-android-baseline.log:177,181`, `measurements:0`, box at the guess.
   - Green: `/tmp/fix2-full-android2.log`, 59/60, the only red being the Slider test.

   `adopt` carries React's stale `previous.measured` forward on both platforms. That is harmless
   today: `measure()` prefers `cache_` (`NitroUiSizingEngine.cpp:375-383`), the stale value has no
   matching key, and no host reads `measured` from state.

4. **Do the tests fail without the fix?**
   - Commenting out both `answerChanged = true` lines makes `bun run test:native` fail with exactly
     two failing checks, plain and under ASan, `EXIT=1`. Restored with `git checkout`.
   - Commenting out only `:446` passes all 256. Removing the `requiresFreshMeasure` clause from
     `NitroUiIntrinsic.hpp:262` also passes all 256. The clause itself is gated only by the two
     harness cases, which the report shows red on `main` on both platforms
     (`/tmp/fix2-red-ios.log:68,72,164`; Android baseline above).
   - My reading of the sequence agrees. `seedWrongGuess` leads to a native correction, then a
     JS-only `value` turn clones React's pre-correction revision, which is clean, so the box comes
     back as the guess.

5. **Merge with G2.** Only the two docs conflicts noted under Gate.
   - G2's `noteSizingKeyChanged` / `layoutSubviews` / `remeasureToken` reset is **not** redundant
     under FIX2. It fixes the host's report dedupe after a key change. FIX2 fixes whether the
     shadow node asks. Neither substitutes for the other.
   - FIX2 does close a latent G2 hole: a Button corrected after a cold key would have snapped back
     on its next props turn.

6. **`Slider › finishes a drag that a write from JS lands inside`.** Unrelated to FIX2. It is red
   with `main`'s `cpp/` (`/tmp/fix2-android-baseline.log:93`) and asserts gesture event values. FIX2
   only changes whether a sized node's measurement is dirtied, which cannot move an event value.

## Follow-ups (one line each)

- Replace the sticky flag with the obsolete-state check, so a corrected hot control pays one
  measure per correction, not one per turn; keep both harness cases as the gate.
- Make `adopt` build the new state from the family's most recent state, not React's stale one
  (`NitroUiIntrinsic.hpp:407-409`); it is what defeats `progressState`.
- Take `requiresFreshMeasure` off `mutex_` (an atomic per-ledger flag or a small lock-free set), so
  unflagged props clones never wait on a main-thread flush.
- `Sizing.harness.tsx`: the Slider case restores its seeded fallback only on success; put the
  restore in `finally`, or a failure poisons later tests.
- Add a host case for `:446` (finding 1), which no test pins today.
- G3 Progress: confirm its 60 Hz `value` path is not flagged in the common case, or adopt the
  obsolete-state check first.
