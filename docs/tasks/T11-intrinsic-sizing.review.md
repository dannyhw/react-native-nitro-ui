# T11 review: intrinsic sizing

Reviewer pass over `git diff main...HEAD` (branch `task/T11-intrinsic-sizing`, 1e931cc). RN internals were checked
against `node_modules/react-native` (0.88.0) and a freshly unpacked `react-native@0.86.3`.

**Verdict: CHANGES-REQUIRED.** The architecture holds up. `measureContent` really is a pure lookup, the engine lock is
never held across a push, R9 is handled correctly, the patch script is solid, and RN 0.86.3 Android builds and runs.
Two things block the merge: a use-after-free on the batched-correction path, and a public `prewarm` whose safety
guarantee is false. Several latent bugs also need fixing before the next self-sizing component lands, and the tests
cannot catch most of them.

What I ran:

- `bun run check`: exit 0.
- `RN=0.86.3 PLATFORM=android bun run smoke:rn-cli` on `nitroui_t03`, port 5574: **PASSED**. The release build
  compiled `react-native-nitro-ui` CMake (arm64), the ready line was seen, and the screenshot shows a correctly sized
  Switch. The emulator was shut down by the script. `emulator-5560` was untouched.

---

## BLOCKING

### B1. Use-after-free: every batched correction reads freed memory

**Where:** `cpp/NitroUiIntrinsic.hpp:258-268`, which captures `[&measured]`.

**Why:**

- `measured` is a reference to `Pending::measured` inside the local `pending` vector in `applyReports`
  (`cpp/NitroUiSizingEngine.cpp:374,460`).
- `ConcreteState::updateState` copies that callback into a `StateUpdate`. RN documents it as "can be called from any
  thread any moment later" (`ConcreteState.h:85-111`).
- For `Asynchronous`, `EventQueue::enqueueStateUpdate` only queues it (`EventQueue.cpp:64-83`). The callback runs
  later on the JS thread, after `applyReports` has returned and the vector is gone.
- The same applies when a later `unstable_Immediate` flushes the queue.

So every correction past the budget of two (198 of 200 in the cold-batch test, 48 of 50 in the bench) reads, and then
pushes into Fabric state, a freed `NitroUiMeasuredSize`. It passes today only because the freed block is usually not
reused yet. ASan would flag it. In production it means a garbage or wrong size committed as "exact", or a crash.

**Fix:**

- Capture by value: `[measured]`. Keep the whole callback free of references.
- Add a host test whose fake push stores the callback and runs it after `flush()` returns.
- Run `sizing.test` under `-fsanitize=address` (and a TSan variant).

### B2. `prewarm` can make a layout permanently wrong; its documented guarantee is false

**Where:**

- `cpp/NitroUiSizingEngine.cpp:468-483`
- `src/NitroUiCore.ts:94-110` ("can never make a layout worse")
- `docs/architecture/sizing.md:249`

**Why:**

- `prewarm` writes the fallback into `cache_` as an authoritative entry.
- `measure` then marks every instance `exact`, and `report()` drops their real measurements
  (`NitroUiSizingEngine.cpp:286-290`).
- The poison test itself proves that a wrong cached size is never corrected.

Concrete failure, the exact case the brief asks T11 to fix: an iOS 26+ app with `UIDesignRequiresCompatibility`.

- The declared fallback is 61×28 (chosen by OS version, `HybridNitroUiSwitch.swift:110-114`). The real control is
  51×31.
- Without `prewarm`, the cold path corrects it.
- With `prewarm` at startup, every Switch stays in a 61×28 box for the whole session. The box is 3 pt too short, so
  you get T10's paint-outside and dead-touch bug.
- The same happens if `prewarm` runs after an environment change: `fallbacks_` holds the previous environment's
  measurement (`applyReports` overwrites it, `:409`).
- With more than one variant it gets worse: any variant's measurement becomes the fallback, so `prewarm` seeds the
  empty key with, say, the "Save" button's size.

**Fix:** make pre-warmed entries **provisional**.

- `measure` answers with the provisional size but records the instance as inexact.
- On the first report, if it matches, promote the entry to exact and clear `needsCorrection_` for that key, without
  pushing. That keeps the zero-correction result.
- If it doesn't match, queue the normal correction.
- Keep the *declared* fallback separate from the last-measured one, and only pre-warm from the declared one.
- Fix both docs.

---

## SHOULD-FIX

### S1. A size-affecting prop change never re-measures

**Where:** `cpp/NitroUiIntrinsic.hpp:219-237`.

**Why:** `YogaLayoutableShadowNode::completeClone` calls `shouldNewRevisionDirtyMeasurement(*this, fragment)`
(0.88 `YogaLayoutableShadowNode.cpp:159`; same in 0.86.3 at `:163`). So `sourceShadowNode` is the node itself, the
`dynamic_cast` succeeds, and the key and id comparison is always equal. The function returns `false` for every props
clone.

The result:

- A `nuiSizingKey` change keeps the old Yoga measurement.
- The old ledger entry stays `exact`, so the host's new report is dropped.
- The node is stuck at the old size.

The report's R9 evidence `storm: measures:0` is this bug showing, not proof of safety. No component has a
size-affecting prop yet (D16 gives that test to G2), but the code is wrong now and the fix is about three lines.

**Fix:** at `completeClone` time the node's `state_` is still the source's state (`adopt` runs afterwards,
`ConcreteComponentDescriptor.h:93-99`). Compare against `this->getStateData().getProps()`, or just return
`fragment.props != nullptr` like `ParagraphShadowNode`. Add a host-level or harness test using a test-only key change.

### S2. An environment change never corrects already-mounted instances

**Where:**

- `NitroUiSizingEngine.cpp:137-153` (`invalidateEnvironment`)
- `NitroUiSizingEngine.cpp:282-285` (the report early return)
- the hosts' `lastReportedSize` guard

**Why:** `invalidateEnvironment` clears `ledger_`. The host re-measures (`invalidateContentSize`) and reports, and
`report()` returns "nothing ever laid out". If RN later re-measures the node (`enableFontScaleChangesUpdatingLayout`,
which is flag-dependent per RN version), it gets the old-environment fallback as inexact. The host never reports again
because its size equals `lastReportedSize`.

So a mounted control whose size depends on the environment stays wrong until it remounts. That is not D16's "one stale
frame", so D16 was accepted on a wrong premise. It is invisible with Switch, which does not resize, and fatal for the
first text-sized control.

**Fix:**

- Keep ledger entries across the bump, mark them inexact, and store the sizing-key string so the key can be recomputed
  for the new epoch.
- Have `report()` queue a correction for a bound instance even with no fresh ledger entry.
- Invalidate once per environment change rather than once per host (iOS: one observer for
  `UIContentSizeCategoryDidChangeNotification`; Android: diff `fontScale`/`densityDpi`/locale, not every
  `onConfigurationChanged`, which also fires on rotation).
- Add a harness test that invalidates *while mounted* and asserts a correction.

### S3. Ledger and registry grow for the whole process

**Where:** `NitroUiSizingEngine.cpp:453-457`, the only prune.

**Why:** entries are removed only when a report or a correction target happens to find an expired state. Warm and
pre-warmed instances never reach that code. So each mount ever made leaves behind:

- a `ledger_` node
- a `registry_` node, whose weak_ptr keeps the `make_shared` State block allocated
- a `lastLaidOut_` entry when tracing
- possibly a `needsCorrection_` entry

A virtualised list of switches leaks for the whole session. Pruning on weak expiry is also the wrong signal: a live
instance whose old `State` died before the rebind would lose its ledger entry.

**Fix:** add an explicit `NitroUiSizing.forget(id)` from host `drop()` and `prepareForRecycle()`. Both platforms already
reset `sizingInstanceId` there. Also add an expired-entry sweep in `flush`. Add a host test with 10k mounts that asserts
the map sizes stay bounded.

### S4. Instance ids are per component and per JS runtime; the engine keys by `int64` only

**Where:** `src/components/Switch/Switch.tsx:98`; the engine maps.

**Why:**

- The next component that copies the documented "module-level counter" (sizing.md §5.3) collides with Switch's ids:
  Button #1 and Switch #1 share `ledger_[1]` and `registry_[1]`, so corrections reach the wrong instance.
- The ids also restart on reload and collide across multiple RN hosts in one process, while the engine is
  process-global.

**Fix:** issue ids from native (an atomic in C++ exposed as a sync `nitroUiCore` call), or key the maps by
`(componentHash, id)` and add a per-runtime salt. Put it in one shared `src/core` hook.

### S5. iOS: every cold mount draws one fallback frame, and the flush relies on an accidental wake-up

**Where:**

- `ios/core/NitroSwiftUIHost.swift:277` (`!bounds.isEmpty` guard)
- `NitroUiSizingEngine.cpp:303`

**Why:** a new view's first `commit()` runs before `updateLayoutMetrics`, so the bounds are empty and nothing is
measured. The first measurement happens in `layoutSubviews`, inside Core Animation's commit (order 2 000 000). That is
*after* the flush observer (1 000 000), so frame 1 always shows the fallback.

Nothing schedules another run-loop pass. The next flush only happens because `markFirstFrameIfNeeded` dispatches a
trace block to the main queue. Remove that block and a correction can wait for the next touch.

Also, sizing.md §4 step 5 ("end of turn") and core.md:253 ("within a turn") overstate what happens.

**Fix:**

- For `intrinsic` policy, measure on the first commit regardless of bounds (`sizeThatFits(.infinity)` does not depend
  on them), so the report lands before the observer in the same turn.
- Call `CFRunLoopWakeUp(CFRunLoopGetMain())` in `report()`.

### S6. Android: corrections beyond the budget still draw a stale frame

**Where:** `NitroUiSizingEngine.cpp:440`; `docs/architecture/sizing.md:70`; report P1 "0 stale frames on Android".

**Why:** `onPreDraw` cancels the frame, but the 198 asynchronous updates land later through the JS thread. The redraw
in between shows the fallback. The claim holds only for the two immediate ones.

**Fix:** either reword the claims ("up to `kImmediateBudgetPerTurn` instances per frame"), or on Android make the pushes
issued from inside the cancelled pre-draw synchronous, and measure the cost.

### S7. A correction can be lost for an instance that isn't bound yet

**Where:** `NitroUiSizingEngine.cpp:414-426` together with `:291-295`.

**Why:** an inexact target with no registry entry is swapped out of `needsCorrection_` and dropped. Its own later
report then matches the now-filled cache, so it returns early without being counted. The instance stays at the
fallback.

**Fix:** put unbound targets back into `needsCorrection_`. In `report()`, only skip when the ledger entry is exact, not
merely when the cache matches.

### S8. The tests cannot fail on the properties they claim

**Where:** `example/__tests__/Sizing.harness.tsx`.

- **Cold single and 200 cold** (`:228-235`, `:340-345`): the fallback equals the real size (and after the earlier
  tests `fallbacks_` holds the measured size), so "every drawn box was right" and "rows 0/99/199 match" pass even if
  every correction failed. This is how B1 got through.
  - **Fix:** seed a wrong fallback (`seedSizingSize` then `invalidateSizingEnvironment`) before the cold-batch test,
    and assert **all 200** boxes after it settles.
- **Poison** (`:485`): asserts `staleFrames <= 1` on both platforms, so an Android regression from 0 to 1 passes.
  - **Fix:** assert 0 on Android.
- **Storm** (`:614`): counts nothing that a broken re-measure (S1) would change.
- **Missing scenarios:**
  - the brief's mount/unmount stress with rapid props;
  - a live environment change on a mounted view (S2);
  - unmount or teardown while a correction is pending;
  - a reload.
- **Native tests** use a synchronous fake push, so they cannot see B1. Add a deferred push and a re-entrant push (fake
  push calls `measure()` and `bind()`) to pin down the "no push under the lock" rule.

---

## NIT

- **N1.** `NitroUiIntrinsic.hpp:254,280` use `static_pointer_cast<const ConcreteState>(shared_ptr<const void>)`, which
  casts `void*` to the derived type from a pointer that was a `State*`. It only works because `State` is the first
  base. Cast to `const react::State` first, then to `ConcreteState`.
- **N2.** `NitroComposeHost.kt:483-494`: `flushScheduled` is never reset in `prepareForRecycle`/`drop`. A listener on
  a floating observer of a view that never attaches leaves it `true` forever, so that recycled host never schedules a
  flush again. Reset it, or use one global flusher (`Choreographer`/root observer).
- **N3.** `NitroUiSizingEngine::shared()` is a function-local static. At process exit it can be destroyed while the
  run-loop observer or a layout thread still calls it. Use a leaked singleton
  (`static auto* e = new NitroUiSizingEngine`).
- **N4.** `kEpsilon` comment (`NitroUiSizingEngine.hpp:153-155`) says "0.9 dp", but the value is 0.5 everywhere (the
  brief said 0.9 dp). Fix either the value or the comment.
- **N5.** `docs/architecture/core.md:273` still says Android records "intrinsic up to the box maximum". T11 switched
  `intrinsic` policy to unbounded `Constraints()`.
  - Also document that `intrinsic` content must tolerate infinite constraints: a scrollable child throws under them.
- **N6.** `sizing.md:161` explains the lost cross-axis stretch as "a correction writes an explicit size". It doesn't:
  measure results never stop a stretch. `alignSelf: 'flex-start'` does, which RN's iOS `Switch` also sets
  (`Switch.js:268`). Reword this and the D16 phrasing.
- **N7.** `patchSizingObjC` should hard-fail if the generated `.mm` already defines `updateState:oldState:` (a future
  nitrogen that adds it would give a duplicate method). Do the same for a second `NitroUiSizing.bind` in Kotlin.
- **N8.** iOS `sizeThatFits` off-window (Modal) measures under the default traits. Fine for Switch; note it as a risk
  for text-sized controls, since such a size gets cached under the current epoch.
- **N9.** Rename `staleFramesSkipped` → `changedFlushes` now. It is in the API report, and D16 already decided it.
- **N10.** `cpp-adapter.cpp` comment says a missing sizing class "lays views out with their fallback". True only
  because `NitroUiSizing.kt` catches `UnsatisfiedLinkError`. Say so.

## Checked and fine

- **`measureContent`:** pure lookup plus a short exclusive lock. No native or JSI calls, and no lock that native holds
  while waiting on JS.
- **Re-entrancy:** pushes happen after the lock is dropped, so the re-entry path (immediate commit → mount →
  `updateState:` → `bind` → `registerInstance`) is safe.
- **Lock order:** no inversion with the ShadowTree commit mutex.
- **Unchanged-size updates:** the update callback returns `nullptr` when nothing changed.
- **Stale props (R9):**
  - The update callback receives the committed node's state (`UIManager::updateState`).
  - `progressState` keeps the node's props, and `adopt` repairs the props in state when they differ.
  - So Android never sees stale props.
- **Android JNI unwrap:** matches nitrogen's own `StateUpdater`. The mounted view's `holder.lastState` keeps the state
  alive, and no global refs are created.
- **Pre-draw loop:** a cancelled pre-draw can't loop, because a corrected ledger entry is exact and later reports are
  dropped.
- **Patch script:** idempotent, anchored with whitespace-tolerant regexes, hard-fails on shape changes (fixtures
  covered), only touches the listed views, and the drift check verifies the marker in all three files.
- **RN 0.86.3 vs 0.88:** `shouldNewRevisionDirtyMeasurement`, `StateWrapperImpl::getState`, `unstable_Immediate`
  semantics and `ConcreteState::updateState` are identical. The Android smoke passed.

---

## Rounds 2–3 verification

Reviewer pass over `git diff 1e931cc..HEAD` (head `0955c10`), checked by reading the code, running the gates, and
mutating the code locally. Every mutation was reverted with `git checkout`, and the tree is clean.

**Verdict: MERGE-AFTER-SMALL-FIXES.** B1, B2 and S1–S8 are fixed in code, and the round-3 iOS fix is correct. One new
memory-safety bug (F1) and two test gaps (F2, F3) need small changes before merge. The list is at the end.

What I ran:

- `bun run check`: exit 0. All 13 steps passed: jest 109/109, `test:native` 147 checks plain and under ASan+UBSan,
  `perf:renders` PASS, the nitrogen/api/manifest checks clean, and the tree clean afterwards.
- `./gradlew :react-native-nitro-ui:compileDebugKotlin`: BUILD SUCCESSFUL. The Kotlin compiles at HEAD, so round 2's
  compile break is fixed.
- I did not re-run the Android harness. The APK on disk (04:50) predates the commits by minutes but not the edits, and
  nothing below needs a device to show. No emulator was started.
- I did not run iOS (per the brief). For on-device iOS behaviour I rely on the round-3 report.
- Standalone host programs (in `/tmp`, not committed) built against `cpp/NitroUiSizingEngine.cpp`, to reproduce F1 and
  to check whether the tests can fail.

### Findings by item

**B1: fixed.** The callback captures `[measured]` by value (`cpp/NitroUiIntrinsic.hpp:288`).

- Gate check by mutation: changing it to `[&measured]` makes `test:native` FAIL through
  `scripts/check-sizing-capture.sh`.
- The ASan "deferred push" test (`scripts/native-tests/sizing.test.cpp:569-598`) does run the callbacks after
  `flush()` returns. But its fake push copies the size itself (`:113-119`), so it cannot see a regression in
  `pushMeasuredSize`, because the host test cannot compile that header.
- So B1 is gated by the grep, not by ASan. That is acceptable, and the test's own comment says so.

**B2: fixed.** Prewarm and seeded entries are provisional (`NitroUiSizingEngine.cpp:418,750-752`). `fallbacks_` holds
only declared values (`:399-426`), and learned sizes are stored per (component, key) in `guesses_` (`:353-360,
:475-477, :632-634`).

- I found no remaining path where a guess becomes authoritative:
  - guesses keep an empty key, so `measure` marks them inexact (`:361-365`);
  - `fromState` counts as exact only when its key equals the live key, and a state can only carry a key after a
    measured push;
  - `cache_` is written as authoritative only from a reported measurement (`:478-487, :627`).
- The provisional flag is now defence in depth. `report()` compares against `laidOut`, not against the cache
  (`:447`), so every instance corrects itself from its own report anyway.
- Consequence: making `prewarm` authoritative (`:752` → `false`) still passes all 147 checks. A two-instance case
  (prewarm, mount A and B, only A reports, expect 2 pushes) does fail under that mutation (1 push), and I checked it
  standalone. Optional (O1).

**S1: fixed in code.** It compares the incoming props with the state's props (`NitroUiIntrinsic.hpp:242-250`). This
is correct: `ShadowNode`'s clone constructor takes `source.getMostRecentState()`, and `adopt` runs after
`completeClone`.

- Host tests cannot compile this header, so the only gate is the device test `Sizing.harness.tsx:900-967`.
- That test can fail: it asserts `corrections == 0` across a warm key change, which only a re-measure can give.

**S2: fixed in code, but not pinned by any test (F2).**

- The fix: `invalidateEnvironment` keeps ledger entries, recomputes their keys and marks them inexact
  (`NitroUiSizingEngine.cpp:177-205`). The signature check coalesces repeated environment callbacks (`:207-221`), on
  both iOS and Android (`NitroComposeHost.kt:531-546`).
- Gap: re-introducing round 1's `ledger_.clear()` still passes all 147 checks. `testEnvironmentChangeCorrectsAMountedInstance`
  (`sizing.test.cpp:351-379`) calls `measure()` again after each bump, and that rebuilds the ledger entry.
- The harness test has the same flaw. Its comment at `Sizing.harness.tsx:1061-1066` says "if the invalidation dropped
  the instance … this test times out". That is not true: the `nuiTestWidth` re-render changes the key, S1 dirties the
  measurement, `measure` re-creates the ledger entry, and the correction arrives.
- The case S2 is about is the host reporting after a trait change with **no** RN re-layout. Standalone check: bind,
  measure, report 60×40, flush; `invalidateEnvironment()`; report 66×44 with **no** `measure`; flush.
  - HEAD: 1 push (correct).
  - With the round-1 mutation: 0 pushes.

**S3: fixed and gated.**

- `forget(id)` is called from `drop()` and `prepareForRecycle()` on both platforms:
  - iOS: `NitroSwiftUIHost.swift:282,295,309-316`. The generated `.mm` routes recycle and (RN ≥ 0.82)
    `invalidate` through `onDropView`, which covers the pool-full path too.
  - Android: `NitroComposeHost.kt:263,279,290-302`, then JNI `nForget`.
- Turning `forget` into a no-op fails 7 checks.
- The expired-entry sweep has its own bug: F1.
- Small residual: ledger entries for instances that Yoga laid out but that never mounted (a revision superseded
  before mount) get no `forget`, and the sweep walks only `registry_`. Rare; O4.

**S4: fixed.** There is one process-global atomic (`NitroUiSizingEngine.cpp:117-122`) behind
`nitroUiCore.nextSizingId()`, used through the shared `src/core/useSizingId.ts`. Ids travel as doubles, which is
exact up to 2^53.

**S5 / S6: resolved as decided.** D17 records them, and the claims are reworded.

**S7: fixed in code, not pinned.**

- Unbound reporters are re-queued at most `kUnboundReportRetries` (4) times (`:604-614`). Unbound targets go back
  into `needsCorrection_` (`:704-706`), and `forget` cleans them up.
- The bounds are fine: retries are counted per report, and the duplicate check stops `pending_` from growing.
- Deleting the requeue of unbound targets still passes all 147 checks. `testUnboundTargetKeepsTheCorrection`
  (`sizing.test.cpp:773-796`) re-measures after `bind`, which fills the cache by itself.
- In practice the instance's own report (laidOut ≠ measured) corrects it anyway. Optional (O1).

**S8: largely done.** The gaps are in F2/O1 above. N1–N10 are verified as done.

### The round-3 iOS fix (`ios/core/NitroSwiftUIHost.swift`): correct

**The mechanism.**

- `commit()` sets `contentUpdatePending` (`:242`).
- `refreshContentSize()` refuses to measure while that flag is set and the host has no window (`:348-354`), and keeps
  `contentSizeNeedsMeasure` set when it refuses.
- `didMoveToWindow()` is the deferred measure point (`:188`).
- `measureFittingSize()` calls `layoutIfNeeded()` once before `sizeThatFits` (`:399-402`).
- This matches RN's mount order. A Create mutation runs props, state, layout metrics and `finalizeUpdates` (→
  `commit()`) before the Insert mutation, so the first commit never has a window. The measure then lands in the Insert
  of the same transaction, before the 1 000 000 flush observer.

**Views off the window.**

- UIKit sends `didMoveToWindow` to every descendant when a subtree joins a window. So the following all get measured
  when they attach:
  - a host inserted under a parent that is not in a window yet;
  - a Modal's content (on presentation);
  - a second surface (on attach).
- A host that never joins a window keeps its guess. That is right: a wrong exact number is worse.
- This change also makes the N8 note mostly obsolete for the mount path (see F3).

**Hot path.** A commit that does not change size costs a flag write plus one `NSLock` read of `contentSize`: no
measure and no layout. A size-affecting change costs one `layoutIfNeeded` plus `sizeThatFits`.

- The host does **not** watch `nuiSizingKey`. A re-measure on a prop change happens only if the component calls
  `noteContentSizeMayHaveChanged()`. Switch does this only for `nuiTestWidth` (`HybridNitroUiSwitch.swift:275`).
- That is cheap, and right for Switch, but it is a contract G2 Button has to follow. Document it (F3).

**Recycling.**

- `prepareForRecycle` resets `contentUpdatePending` and `_contentSize`. The next commit sets the pending flag again,
  and the deferred measure applies the reset model before measuring.
- Clearing `_contentSize` there is redundant but harmless: `drop()` already did it, and it runs first (`.mm`
  `prepareForRecycle` → `notifyOnDropView`). The actual leak was the unapplied `send()`.
- `contentMayHaveChangedSize` is not reset in `prepareForRecycle`/`drop`. It is always consumed in the same
  transaction, so this is hygiene only.

**Main thread.** All the new state is touched only from main-thread entry points: `commit`, `prepareForRecycle`,
`drop`, `invalidateContentSize`, `layoutSubviews`, `didMoveToWindow` and `traitCollectionDidChange`. The first four
assert it. Only `contentSize` crosses threads, under `sizeLock`.

### Do the tests fail when they should? (mutations, all reverted)

| Mutation | `test:native` |
| --- | --- |
| B1: `[measured]` → `[&measured]` | **FAIL** (grep gate) |
| S3: `forget` → no-op | **FAIL** (7 checks) |
| B2: `prewarm` entry authoritative | pass. Not pinned (O1) |
| S2: `invalidateEnvironment` clears `ledger_` again (round-1 bug) | pass. **Not pinned (F2)** |
| S7: drop unbound targets instead of re-queueing | pass. Not pinned (O1) |

### Android cold-batch flush (84–125 ms for 200): a perf risk, not a correctness risk

- **The engine's own work is negligible.** Host microbenchmark with a no-op push:
  - 200 corrections: 0.016 ms at `-O2`, 0.55 ms at `-O0`.
  - 2000 corrections: 0.13 ms at `-O2`, 3.2 ms at `-O0`.
- **The time goes to React Native work inside the pushes.** In RN 0.88, an `unstable_Immediate` update calls
  `EventQueue::flushStateUpdates()` synchronously, and that becomes `UIManager::updateState`, which does a full
  `shadowTree.commit` (clone path, Yoga layout, diff, mount).
  - Each of the 2 immediate updates is therefore a synchronous commit on the UI thread, inside `onPreDraw`.
  - Growing one row of a 200-row container moves every row after it, so each commit costs roughly the size of the
    surface.
  - The other 198 are cheap enqueues.
- **The per-instance cost.** 0.42–0.63 ms averaged over 200 (debug build, emulator). In reality the cost is
  ≈ `kImmediateBudgetPerTurn` × one commit of the surface, and it grows with the size of the surface, not with the
  number of corrections.
- **What caps it.**
  - The immediate budget already caps the synchronous part at 2 commits.
  - Setting it to 1 on Android, or making every push in a flush asynchronous once the flush carries more than K
    corrections (the frame is stale for most of them anyway), bounds the UI-thread stall to about one commit or none.
- **Why it is not a correctness risk.**
  - The ANR threshold is 5 s, so this is far from it.
  - It is about 7 frames of jank once per cold batch, in a debug build, and the frame was being cancelled anyway.
- **The bigger scaling concern is off the UI thread.** `EventQueueProcessor::flushStateUpdates` turns each of the 198
  asynchronous updates into its own commit on the JS thread. A cold batch therefore costs O(N × tree) in commits,
  layout and mount transactions. That is the number to benchmark before a 500-row cold list ships, not the flush.
  Fixing it means batching many families into one commit, which `ConcreteState::updateState` cannot do.

### Must fix before merge

1. **F1. Heap use-after-free in the expired sweep** (`cpp/NitroUiSizingEngine.cpp:306-313`).
   - `sweepExpiredLocked` calls `forgetLocked(id)`, which already does `registry_.erase(instanceId)` (`:265`). It then
     calls `registry_.erase(iterator)` on the node that was just freed.
   - Reproduced under ASan: `heap-use-after-free … sweepExpiredLocked() NitroUiSizingEngine.cpp:309`, freed by
     `forgetLocked … :265`.
   - Setup: 10 expired registrations measured under key `"other"`, plus one live instance that reports under `""`,
     then `flush()`.
   - The shipped `testExpiredStatesAreSweptWithoutForget` (`sizing.test.cpp:498-513`) never reaches this. Its expired
     instances share the reporter's key, so the dead-target path in `applyReports` (`:666-669, :708-710`) forgets them
     before the sweep runs. The script comment claiming ASan covers "the expired sweep" (`scripts/native-tests.sh`)
     is therefore false today.
   - Since `forget` runs on every iOS (≥ 0.82 `invalidate`) and Android teardown, this is reachable mainly when a host
     skips `forget`. That is exactly the case the sweep exists for.
   - Fix: collect the expired ids first, then call `forgetLocked` on each, or erase only through `forgetLocked`. Also
     make the test's expired instances miss the reported key (measure them under another key, or make them exact)
     so ASan actually walks the sweep.
2. **F2. Pin S2.** Add the report-without-`measure` case above to `sizing.test.cpp`. It fails on the round-1 code and
   passes on HEAD. Also correct the claim at `Sizing.harness.tsx:1061-1066`, or make that harness step report without
   a key change.
3. **F3. Docs that round 3 made stale.**
   - `docs/architecture/sizing.md:92-104` (§4 steps 3–5) is wrong in two ways:
     - The iOS first measure is no longer in the first `commit()`: the host has no window at Create, so it happens at
       `didMoveToWindow`, in the Insert of the same transaction.
     - A first report that matches the declared size is now *confirmed* without a state update (`report()` `:449-489`),
       not "one state update, immediate".
   - `sizing.md:334-340` (N8): a detached host no longer measures after a commit. Narrow the note to
     `invalidateContentSize()` called off-window.
   - Document the iOS rule that a size-affecting prop must call `noteContentSizeMayHaveChanged()`. The host does not
     watch `nuiSizingKey`.

### Optional / follow-up (not merge blockers)

- **O1.** Pin B2 and S7 the same way as F2:
  - B2: two prewarmed instances, one report, expect 2 pushes.
  - S7: an unbound target binds without re-measuring, a later report of the same configuration arrives, and the target
    gets its push.
- **O2.** `SwitchModel.reset()` on Android (`HybridNitroUiSwitch.kt:77-90`) does not clear `testWidth`; iOS does.
  It is a test-only prop and Android recycling is off by default, but keep the two platforms symmetric.
- **O3.** `environmentSignature_` starts empty, so the first signature callback in a process always bumps the epoch:
  an Android rotation, or the first trait delivery on iOS.
  - I traced it: no commits result (the guesses carry the same size and confirm), so the waste is one cleared cache.
  - Fix: seed the signature from the first attached host.
- **O4.** Two leak and edge cases:
  - Ledger-only entries (laid out, never mounted) are never forgotten or swept.
  - `report()` returns early when no ledger entry exists yet (`:436-442`), while the host records `lastReportedSize`
    anyway (`NitroSwiftUIHost.swift:379`). If Yoga never called `measure` (explicit `width` and `height`) and the
    style later becomes intrinsic, that instance keeps the guess until a sibling of the same configuration reports.
    This is an edge case.
- **O5.** Android cold batch: benchmark the 198 asynchronous commits (see above) before recommending cold lists of
  more than about 200 rows.
