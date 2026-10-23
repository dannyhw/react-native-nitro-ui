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
