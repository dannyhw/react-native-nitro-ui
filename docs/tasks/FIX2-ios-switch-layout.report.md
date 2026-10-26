# FIX2 — a props update must not resurrect a superseded measurement: report

**Branch:** `fix/ios-switch-value-update-layout` (from `main` at `97fd8d2`) · **Devices:** iPhone Air
`331EF109-21DD-422B-AEF8-DFFFC6998DC3`, AVD `nitroui_t02` (adb server 5042, `emulator-5572`), Metro 8294
(D13) · **Platforms:** both. T15's Finding 1 (`docs/tasks/T15-real-input.report.md:123`).

## Summary

T15's symptom is real and generic, but it is not a Switch bug and not a `value`-prop bug:

> Once the engine has corrected an instance, the answer from **before** that correction is still a live
> entry in that node's Yoga measurement cache. A props-only update clones the shadow node without
> dirtying it (T11's review S1, on purpose), and Yoga will answer layout from any cached entry it is
> allowed to reuse — so the node goes back to the size it was corrected away from, `measureContent` is
> never reached to notice, and the engine — which by then believes the corrected size — drops the host's
> next report as agreement. The wrong box is then permanent for that instance.

`0 × 0` was T15's instance of it only because, on its pre-T14 `main`, the first answer was *no answer at
all* (T14: `docs/tasks/T14-early-fallbacks.report.md`). T14 removed that one way of getting a wrong first
answer; it did not touch what makes a wrong first answer permanent. Any control whose first layout is not
its real size re-opens it — and that is the normal cold path for a control whose declared fallback is a
guess (`docs/architecture/sizing.md` §2, steps 3 and 4).

The fix is 4 fields' worth of state in the ledger and one added clause in the S1 dirty check
(`cpp/NitroUiSizingEngine.{hpp,cpp}`, `cpp/NitroUiIntrinsic.hpp`): when the size an instance is laid out
with moves under it, that instance stops trusting Yoga's cache and re-asks on a props turn. Nothing
Switch-specific, and an instance that was never corrected keeps the old fast path exactly (measured below).

| File | Change |
| --- | --- |
| `cpp/NitroUiSizingEngine.hpp` | `LedgerEntry` gains `hasMeasured` + `answerChanged`; new `requiresFreshMeasure(instanceId)` (§Root cause). |
| `cpp/NitroUiSizingEngine.cpp` | `measure` flags an instance whose answer moved; `applyReports` flags one corrected without a re-measure; `requiresFreshMeasure` reads the flag. |
| `cpp/NitroUiIntrinsic.hpp` | `shouldNewRevisionDirtyMeasurement` returns `newConfiguration \|\| requiresFreshMeasure(instanceId)`. |
| `example/__tests__/Sizing.harness.tsx` | Two new tests (Switch and Slider): a controlled control's laid-out box and its sibling's must survive a JS-only `value` change. |
| `scripts/native-tests/sizing.test.cpp` | Two engine cases: the flag rises for a corrected instance (and is sticky, and is per-instance), and stays down for one that was never corrected. |
| `docs/architecture/sizing.md` | §6 trap + the two prop-turn perf rows, both measured. |

## Does it still reproduce on `main`? (the brief's first question)

**The symptom no longer does; the root cause does.**

- `IOS_UDID=… bun run test:real-input:ios --control switch` on `main`'s `cpp/` — **PASS**
  (`/tmp/fix2-ri-ios-switch-baseline.log`, `switch: PASS`, `1/1 controls passed`). T14's startup fallback
  table means the first answer is now the Switch's real size, so nothing is ever corrected and the stale
  entry is never wrong. T15's measurement was taken before that.
- The root still reproduces on `main`, with `main`'s own files and nothing but a wrong *first* answer.
  Restoring `HybridNitroUiSwitch.declareFallback()` to its pre-T14 timing reproduced T15's frames exactly
  (`/tmp/fix2-syslog1.log`):

  ```
  PROBE mount:                        probe-switch=61.0x28.0@359.0,0.0 | probe-label=347.0x17.0 | corrections=1
  PROBE value=false->true:            probe-switch=0.0x0.0@420.0,0.0   | probe-label=408.0x17.0 | measurements=2 events=[]
  PROBE second Switch mounted:        probe-switch=61.0x28.0@359.0,0.0 | probe-label=347.0x17.0
  ```

  `@420.0` is the right edge of a 420 pt window: laid out with no width, off-screen, and `events=[]` with
  `measurements` unmoved — the engine was never asked again. The label grew 347 → 408, T15's +61 pt. The
  last line is the detail that identifies the mechanism: mounting a *second* Switch — whose correction is
  per configuration, not per instance — healed the first one.
- Then, on **unmodified `main`** (fallback table intact), with the first answer made wrong by the one
  legitimate means a test has (`seedSizingSize`, i.e. a wrong guess — `/tmp/fix2-syslog3.log`):

  ```
  PROBE poison mount:                 poison-switch=61.0x28.0@359.0,0.0 | measurements=2 events=["laidOut:843:40.0x20.0","drew:843:40.0x20.0","corrected:843:61.0x28.0"]
  PROBE poison value=false->true:     poison-switch=40.0x20.0@380.0,0.0 | poison-label=368.0x17.0 | measurements=2 dropped=0 events=[]
  PROBE poison value=true->false:     poison-switch=40.0x20.0@380.0,0.0 | poison-label=368.0x17.0 | measurements=2 dropped=0 events=[]
  ```

  Wrong box, wrong sibling, no trace, no measure, and it does not come back on the next turn either —
  permanent, exactly as T15 described, on today's `main`, with a 40×20 guess instead of a 0×0 one. A
  control whose first answer was right (`probe-switch`) stays fine on the same screen, which is why the
  bug reads as "only the controlled Switch" and only when the row's label can eat the difference.

## Root cause

Four facts, each checked in RN 0.88's sources and on the device:

1. **Yoga keeps every answer it was ever given.** A node's measurement cache is `LayoutResults`
   (`yoga/yoga/node/LayoutResults.h:45` `cachedMeasurements`, `:47` `cachedLayout`), and it belongs to the
   Yoga node.
2. **A clone inherits it, dirty flag and all** — `YogaLayoutableShadowNode`'s clone constructor
   copy-constructs `yogaNode_` (`react/renderer/components/view/YogaLayoutableShadowNode.cpp:95`), and the
   only thing that clears the caches is the node being *dirty* when layout runs
   (`yoga/yoga/algorithm/CalculateLayout.cpp:2669`, which resets `cachedLayout`/`cachedMeasurements`
   solely under `needToVisitNode`).
3. **A props-only update is deliberately not dirty.** `completeClone` dirties only for new children or
   when `shouldNewRevisionDirtyMeasurement` says so (`YogaLayoutableShadowNode.cpp:150`); T11's S1 override
   (`cpp/NitroUiIntrinsic.hpp`) returns false unless the sizing configuration changed, so toggling a
   `value` keeps the node clean — that is what makes 30 prop turns cost 0 measures.
4. **A clean node re-answers from the cache.** `canUseCachedMeasurement`
   (`yoga/yoga/algorithm/Cache.cpp:45`) reuses an old entry when the sizes match or when
   `oldSizeIsMaxContentAndStillFits` (`Cache.cpp:22`) — so a `MaxContent` answer of 40×20 stays "valid"
   for a later `FitContent` question about a control that is 61×28. The *smaller, older* answer is the
   stickier one, which is why a wrong first answer wins over a correct later one.

So on the turn after a correction: nothing dirties, nothing is asked, the node is laid out at the
superseded size, and — because `measure()` is what normally notices — the engine's ledger still holds the
corrected size. The host then reports 61×28, the ledger says "that is what it was laid out with", and
`applyReports` counts it as a confirming report rather than a correction
(`cpp/NitroUiSizingEngine.cpp`, the `agrees`/`reportsConfirmed` path). The counters even look *good*:
`measurements` and `corrections` both 0. Only a control's box got worse.

Three things the brief asked to check, answered:

- **Does `measureContent` see the state or cache entry on a non-size prop change?** It is not called at
  all. That is the bug, not a detail: `events=[]` and a zero `measurements` delta on the value turn, above.
- **Does `updateState:oldState:` or the host report/flush path interfere?** No, and both are correct. The
  host reports the true size; the flush path drops it because the *engine* is right about the instance
  while the *node* is not. Nothing in the report path can fix a node that stops asking, which is why the
  fix is on the dirty-check side.
- **Is `nuiSizingKey` still `""` for Switch?** Yes (`src/components/Switch/Switch.tsx:153` — the key is a
  test-width variant, normally empty), and it stays empty across a `value` change. The configuration check
  correctly sees no change; that is the S1 rule working. The fix deliberately does not widen the key — a
  `value` prop is still not a size — it adds the one exception the cache makes necessary.

Why Android looked unaffected (T15's observation, and it is accurate for what it saw): on Android the
Material 3 Switch's declared fallback is right, so nothing is corrected, so nothing stale is left behind.
The cache behaviour itself is shared — with a wrong first answer, Android fails the same new test with the
same numbers (`40.0x20.19` where `52.19x48.00` is measured, §red below). It also matches the Android
follow-up T14 left in `docs/tasks/FOLLOWUPS.md` ("re-laying out an already-mounted control at a wrong
guess produces no report"); FIX2 closes that from the layout side, by making the node ask again instead of
waiting for a report that agrees with nothing.

## The fix

`NitroUiSizingEngine` already knows, per instance, what it laid that instance out with. It now also knows
whether that has ever moved:

- `measure()` — after computing the answer, before recording it: a previously-measured instance answered
  with a different size sets `answerChanged` (`cpp/NitroUiSizingEngine.cpp:446`). First answer never sets
  it, whatever `laidOut` looked like.
- `applyReports()` — an instance corrected without being measured again (its node may not lay out in that
  turn at all) sets it too (`cpp/NitroUiSizingEngine.cpp:769`).
- `requiresFreshMeasure(instanceId)` — one shared lock and one hash lookup, `false` for `NO_INSTANCE`.
- `shouldNewRevisionDirtyMeasurement` — `return newConfiguration || requiresFreshMeasure(instanceId);`
  (`cpp/NitroUiIntrinsic.hpp:262`).

It is **sticky** and **per instance**. Sticky because nothing can tell the engine when Yoga is finished
with the superseded entry — the node's own cache is not observable from here, and a "clear it once" flag
would be wrong the moment two turns are coalesced. Per instance because that is the granularity at which
the wrongness exists, and it is what preserves the perf contract (below). A control that spends its life
being re-measured once per props turn is a control that was answered wrong at least once; the alternative
is a box that is wrong for the rest of the mount, which is the bug.

Perf, measured on both platforms (same counters the harness logs):

| Case | iOS | Android |
| --- | --- | --- |
| 30 prop turns on a control the engine never had to correct | `measures=0 corrections=0` (`storm:`, unchanged by this fix) | `measures=0 corrections=0` |
| one prop turn on a control that *was* corrected | `measurements=1 corrections=0 flushes=0` | `measurements=1 corrections=0 flushes=0` |

So the exemption is not "dirty on every props turn", and the fix does not buy correctness with commits:
the corrected instance pays a lookup and a measure, and never a state update.

## The tests, shown red first

`example/__tests__/Sizing.harness.tsx` — both mount a control whose first answer is deliberately wrong
(the Switch through `seedWrongGuess()`, the Slider by seeding `100×13` over its declaration), wait for the
correction, then change **only** `value` from JS and re-read both boxes:

- `keeps a mounted Switch laid out when only its value changes` — box still `expectedBox` (61×28 iOS 26+,
  52.19×48 Android), and `sameFrame` for both the Switch and its `flex: 1` label against their pre-change
  frames; `d.corrections === 0` so nobody "fixes" this by pushing state per prop turn. It also asserts
  `hybrid.value === true` first, so an update that never arrived cannot pass.
- `keeps a mounted Slider laid out when only its value changes` — the same on the other host, the other
  policy (`fillWidth`) and the other axis: a `fillWidth` control's height is its own, so the poisoned 13
  must not come back.

**Red on `main`** (`cpp/` at `main`, tests added, task devices only):

| Platform | `value change:` log on `main` | Assertion |
| --- | --- | --- |
| iOS (`/tmp/fix2-red-ios.log`, 2 failed / 24) | `switch=40.00x20.00 at x=380.0 label=368.00x17.00 measured=61.00x28.00 d={…measurements:0, corrections:0}` | `expect(boxMatches(box, expectedBox)).toBe(true)` (`Sizing.harness.tsx:1199`) |
| iOS (same log) | `slider value change: box=420.00x13.00 … measurements:0` | `expect(sameFrame(box, startSlider)).toBe(true)` (`…harness.tsx:1255`) |
| Android (`/tmp/fix2-android-baseline.log`, 4 failed / 45 — 2 are these, 2 are the pre-existing Slider ones below) | `switch=40.00x20.19 at x=371.4 label=359.62x19.43 measured=52.19x48.00 d={…measurements:0}` | same assertion |
| Android (same log) | `slider value change: box=411.43x13.33 … measurements:0` | same assertion |

Both are the bug, not a fixture problem: the box is the *guess*, the label has grown by the difference,
and `measurements: 0` says the engine was not consulted — the same signature the traces have.

**Green with the fix** (captured from the app's console through the log stream / logcat while the suite ran):

```
iOS     value change: switch=61.00x28.00 at x=359.0 label=347.00x17.00 measured=61.00x28.00 d={…measurements:1, corrections:0}
iOS     slider value change: box=420.00x31.00 label=420.00x17.00 d={…measurements:1, corrections:0}
Android value change: switch=52.19x48.00 at x=359.2 label=347.43x19.43 measured=52.19x48.00 d={…measurements:1, corrections:0}
Android slider value change: box=411.43x48.00 label=411.43x19.43 d={…measurements:1, corrections:0}
iOS/Android storm: 30 turns corrections=0 dropped=0 measures=0 queued=0 flushes=0 newCacheEntries=0
```

`scripts/native-tests/sizing.test.cpp` — `testACorrectedInstanceAsksForAFreshMeasure` and
`testAnUncorrectedInstanceKeepsTheMeasurementCache` pin the engine half (the flag rises only for the
corrected instance, is sticky, dies with `forget`, and never rises for an instance answered once). This
test cannot be run against `main` — `requiresFreshMeasure` does not exist there — so it was proven
non-vacuous by mutation instead: with the two `answerChanged = true` assignments removed,
`bun run test:native` fails exactly those two checks and nothing else, twice (plain and under ASan/UBSan):
`FAIL: an instance whose answer moved must re-ask on a props turn`, `FAIL: the flag is sticky: Yoga is
still holding the old answer`, `2 of 256 checks FAILED`, `EXIT=1` (`/tmp/fix2-mutation.log`).

## Why the Sizing suite did not catch this

It had the setup and never looked at the right moment:

1. **Every box assertion in the file reads the box in the same turn as a mount or a correction.**
   `waitForBox`, `waitForTestId` and the first-frame watchers poll until the corrected size *arrives*, then
   assert. Nothing read a box on a turn *after* that. The bug is invisible for the whole life of a mount
   except on the turns after a correction — which is precisely the only turn type the suite's props test
   was not reading.
2. **The props-turn test asserts the wrong thing for this bug.** `takes a storm of prop changes without
   re-sizing` (R9) is the one test that re-renders a mounted control, and what it guards is *cost* —
   `d.corrections === 0` and `cachedSizes` unchanged — with the box logged, not asserted (`box=` in the
   log line). It also picks a control that is answered at its real size, so even before the fix the cache
   it was re-answering from held the right number.
3. **The wrong-guess fixtures existed and were dropped one turn too early.** `seedWrongGuess()`, the
   pre-warm-wrong case and the environment-change cases all create exactly the pre-condition (an instance
   laid out at a size the engine later supersedes), assert the correction lands, and unmount. No test
   stayed for the next turn.
4. **The counters could not reveal it, and one of them reads as success.** `measurements` and `corrections`
   both stay 0, which is the *signature of a healthy* prop turn; the host's true report is not counted as
   a dropped-or-wrong thing at all — it is tallied as `reportsConfirmed`, because by the engine's own
   ledger it agreed. The only signal was geometry, and geometry was asserted one turn too early.
5. **The host engine suite cannot see this class at all.** `scripts/native-tests/sizing.test.cpp` stands
   in for Fabric with `fakePush`, which records what would have been committed; nothing in it re-answers
   layout from a Yoga measurement cache, because that cache is RN's and Yoga's — deliberately outside the
   engine's unit-test boundary (`docs/research/core-architecture.md` §1.4). The new host
   cases cover the *flag*, and the flag is only observable on a device.

That split is why this one needed the real-input runner to find it (T15), and why the new coverage is a
harness test on both platforms plus a mutation-checked host case for the half that is engine state.

## Gate results

- `bun run check`: **green** on the working tree before the docs-only commit
  (`/tmp/fix2-check.log`, `CHECK_EXIT=0`), including `test:native: PASS` (256 checks, plain + ASan/UBSan)
  and `perf:renders` and `package-files: tarball matches … (205 files)`.
- iOS harness, iPhone Air `331EF109…`, Metro 8294, app built from this tree
  (`example/ios/build/…/NitroUiExample.app`):
  - full suite **60 passed / 60** (`/tmp/fix2-full-ios-final.log`); the same run twice earlier
    (`/tmp/fix2-full-ios2.log`) and `Sizing` alone **24 passed / 24** (`/tmp/fix2-ios-sizing3.log`).
- Android harness, `nitroui_t02` / `emulator-5572` / adb server 5042 / Metro 8294, APK built from this tree:
  - full suite **59 passed / 60** (`/tmp/fix2-full-android2.log`, and `/tmp/fix2-full-android.log`), the
    only red being the pre-existing `Slider › finishes a drag that a write from JS lands inside` (§below);
  - `Sizing` **24 passed / 24** inside `Sizing Slider` = **44/45** with that same one red
    (`/tmp/fix2-android-fixed-ss.log`);
  - one Android run also tripped the load-bound flush-ratio gate
    (`Sizing › corrects a cold batch of 200…`, `expected 207.98 to be less than 160.4`,
    `/tmp/fix2-android-sizing2.log`) with a `logcat` stream running on the same loaded machine; the clean
    re-run above is green, and T12's report is explicit that this bar is load-bound, not structural.
- Real-input (`bun run test:real-input:ios|android --control …`), all four on the fixed build:
  - iOS `switch` **PASS** (`/tmp/fix2-ri-ios-switch.log`), iOS `slider` **PASS**
    (`/tmp/fix2-ri-ios-slider.log`, 37.9 s);
  - Android `switch` **PASS** (`/tmp/fix2-ri-android-switch.log`, off → on → off), Android `slider`
    **PASS** (`/tmp/fix2-ri-android-slider.log`, `change=22`, `value=0.726`, controlled echo 0.25 → 0.771).
  - T15's Finding 1 is gone on the platform where it was visible, and the JS-only path (`flip from JS`) is
    covered by the harness test, which never touches the screen.
- Devices: iPhone Air and `nitroui_t02` were started by FIX2 and are shut down at the end; G2's iPhone 17 /
  `nitroui_t01` / adb 5041 / Metro 8293 and `emulator-5560` were not used, and no
  `adb kill-server` was run anywhere.

## `Slider › finishes a drag that a write from JS lands inside` is red on Android on `main`

This is the one red above, and it is not FIX2's. On `nitroui_t02` it fails
`expected 0.5 to be 0.8` at `Slider.harness.tsx:857` — `expect(events.start[before]).toBe(beganFrom)`,
"this gesture began where the last one stopped" — and it fails **identically on `main`**: the same suite
was run against an APK built from `main`'s `cpp/` on the same AVD and produced the same assertion, the
same message (`/tmp/fix2-android-baseline.log`, alongside a second pre-existing Slider red,
`steps to the next legal value when a screen reader asks`, which passed on other runs). Three runs with the
fix and one with `main`, same line each time; iOS is green on it.

The assertion is also the one the test's own comment declines to trust: it writes `0.5` from JS during a
drag toward `0.8`, says out loud that "a write that arrives with nothing pending wins, which is the fight
§11 already documents as the app taking the thumb. Both are legitimate, and both look the same from here" —
and then requires the *next* gesture to begin from the previous gesture's reported release. When the write
wins after the release was reported, the app's own value is `0.5`, and the next drag legitimately starts
there: `expected 0.5 to be 0.8`. That is a test that can be failed by the behaviour it declares legal, so
it is load-sensitive rather than merely flaky. G1's review already called this case
non-discriminating (`docs/tasks/G1-slider.review.md:396-406`) and moved the real gate to
`handshake.test.swift` / `NitroUiControlledValueTest.kt`; this loop assertion was not part of that change.

It is Slider's owner's, not sizing's, and it is filed in `docs/tasks/FOLLOWUPS.md` with the two commands
above. It is not fixed here: it is out of FIX2's scope, it is red on `main`, and "make the gate green by
loosening someone else's assertion" is the wrong way to spend a fix round.

## Follow-ups

- **T14 masked this trigger, not the class.** Any path that answers an instance with something other than
  its real size re-opens it: a stale declared fallback, a `prewarm` size that is provisional
  (`docs/architecture/sizing.md` §8), a `seedSize` from a test, or a font-scale change that clears the
  cache under a control that then moves. Those are all *correct* now (the fix makes the node re-ask); what
  is not covered is a *new* way to be clean-and-stale that does not go through `measure`/`applyReports`.
  The clause lives in one function for that reason.
- **The flag is sticky, which is a trade, not a proof.** An instance that was corrected once re-asks on
  every later props turn for the rest of its mount. If that ever shows up in a bench, the honest fix is a
  way to invalidate Yoga's per-node entries (they are not reachable from here), not a shorter memory.
- `measure()`'s `NO_INSTANCE` early return does not increment `stats_.measurements`
  (`cpp/NitroUiSizingEngine.cpp:362`), so "measurements did not move" is only proof of "not asked" for a
  sized instance. Worth a counter for the ignored case so the diagnostic does not need a trace to be
  readable — found while using the counters as evidence here.
- `scripts/real-input/support.mjs:103` crashes the runner *after* a verdict: `Metro`'s child writes to an
  ended log stream during teardown, `ERR_STREAM_WRITE_AFTER_END`, exit 1. It happened on a run whose own
  output said `switch: PASS / 1/1 controls passed`
  (`/tmp/fix2-ri-ios-switch-baseline.log`), so a green gate can be reported as a failed command. T15's
  runner, one `stream.on('error')` away from fixed.
- The two pre-existing Android Slider reds, above.

## Questions for orchestrator

1. Does the S1 exception need a DECISIONS.md line? `docs/architecture/sizing.md` §6 now carries it and the
   code names it, but S1's "a props turn costs no measure" is stated in T11's report without the
   "…unless this instance was corrected" clause that this fix makes necessary.
2. Is the Android `finishes a drag that a write from JS lands inside` assertion v0.1-blocking? It is red
   on `main` today, which makes "Android harness full suite green" unachievable for any task on this
   machine until Slider's owner revisits it.

## Commits

- `9a914be` — `test(sizing)`: the two harness cases, red on both platforms (`Sizing.harness.tsx`).
- `a4f3933` — `fix(sizing)`: re-measure an instance whose answer moved (`cpp/`, plus the two engine cases
  in `scripts/native-tests/sizing.test.cpp`).
- the one after it — `docs(sizing)`: the superseded-measurement trap and the measured prop-turn rows in
  `docs/architecture/sizing.md`, this report, and the STATUS / FOLLOWUPS lines. It changes no behaviour,
  so the gates above stand: `prettier --check .` is the only step of `bun run check` that reads them.

## Fix round 1

Implemented by Apex (code, tests, wording); the session died on a provider rate limit (429) before
committing, so the orchestrator verified and committed the same tree.

- **Flag only on a real correction:** `cpp/NitroUiSizingEngine.cpp` sets `answerChanged` only when
  `sameConfiguration`; a re-key (even to a cached key of the same size) no longer puts an instance on
  the paying path. New host checks in `scripts/native-tests/sizing.test.cpp`:
  - guard removed → `FAIL: moving to another configuration of the same size is not a correction`
    (1 of 262 checks);
  - flag assignment commented out → `FAIL: the same configuration answered a different size, so it
    must re-ask` (1 of 262 checks); restored → 262/262 plain and ASan.
- **Cost and mechanism wording** in `NitroUiSizingEngine.{hpp,cpp}`, `NitroUiIntrinsic.hpp` and
  `sizing.md` now match D20 (React clones from its pre-correction revision; `adopt` mints a fresh
  State so `progressState` never re-dirties; flagged cost = lookup + measure + Yoga pass up the
  dirtied ancestors, 8–48 µs on host for 35–316 nodes).
- **Gates:** `bun run check` exit 0; Sizing harness iOS 24/24 (iPhone Air) and Android 24/24
  (`nitroui_t02`); real input iOS 3/3 and Android 3/3 (switch, slider, button).

### Follow-ups (from the review, not done)

- Non-sticky alternative: dirty on obsolete state (`getMostRecentStateIfObsolete() != nullptr`).
- Build the new State in `adopt` from the most recent one.
- Take `requiresFreshMeasure` off the shared engine lock.
- Move the Slider harness case's restore into `finally`.
- Check G3 Progress's 60 Hz path against the flagged cost.
