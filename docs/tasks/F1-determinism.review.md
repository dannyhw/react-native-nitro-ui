# F1 review: tap delivery and the known flaky tests

**Reviewed:** `task/F1-determinism` at `3c89136` (`git diff main...HEAD`, 10 commits, 27 files).
**Method:** I read the brief, the Q3 diagnosis, the report, the ledger (`docs/tasks/F1/gates.jsonl`, all
105 lines), every committed failure excerpt, the gate log store for this branch, and the diff. I ran the
jest mutations under Node 24.22.1 and reverted each one with `git checkout -- .`. The worktree was clean
afterwards. I ran no devices, builds or harness runs.

## Verdict: FIX ROUND

The harness work holds up: the Picker fresh-measure wait, the HostPopups sweep fix and the scripts work
are all correct. The ledger supports every repeat count the report gives. The tap-delivery half has three
problems:

- The premise it rests on ("a zero-dwell touch is the defect, not the control") has not been measured at
  the dwell a person's tap actually has.
- The iOS half of the brief's "red both ways" proof leaves no evidence, and by construction it can't leave
  any.
- The new retry turns one real product bug green: a Switch that loses its first change event.

All three need devices, so they belong in a fix round, not in fixes at merge.

## What I verified

- **Reproduction on `main`:** this is in the ledger. Both failing runs are at HEAD `c8ac6dd` (the base).
  The `--control switch` run fails on tap 1 (`RealInputTests.swift:142`), and the full run fails on tap 2
  (`:155`).
- **The dwell is test-only.** No file under `ios/`, `android/` or `src/` changed. The two `example/src`
  edits only lengthen the drop timers. `PickerScreen` leaves iOS at 12000 and raises Android from 2500 to
  12000. `HostScreen`'s `POP_DATE_DROP_MS` goes from 9000 to 15000. Neither one weakens a witness, because
  both checks wait for the screen's own "unmounted" echo.
- **Determinism counts, final tree `55ef6047` (HEAD `98df683`, clean):**

  | Repeats | Max load per run |
  | --- | --- |
  | `real-input:ios:--control:switch` 10/10 | 16.7 → 192.1, four at ≥150 |
  | `harness:android:HostPopups` 15/15 | five runs between 19.8 and 39.5 |
  | `harness:ios:Picker` 10/10 | up to 30.9 |
  | `harness:android:Picker` 5/5 | up to 7.9 |

  The five 04:22Z failures and the 03:19Z `harness:ios` failure are `refusing to run against a stale app`,
  as the report says.
- **Picker red proof:** the ledger has it. At 03:09Z the log shows
  `variant menu->wheel: … wheel=0.00x0.00`. Dropping the brief's handle-identity check is justified by the
  03:03Z red, where the same hybrid answered both mounts. The size-based wait still refuses every stale
  state: a dropped host reports 0, and a host that was never re-measured reports the stale size.
- **HostPopups red proofs** are in the ledger. At 02:56:17Z the sweep leak shows `expected 1 to be +0`. At
  02:58:10Z the decrement revert shows `could not earn a zero baseline: 5/6/7 … window(s)`. The fix-round
  red at 04:09Z is genuine and was fixed by `98df683`.
- **Android tap-delivery red proofs** are in the ledger, on a dirty tree. At 03:13Z a swallowed first tap
  turns green after `tapping again`. At 03:14Z every swallowed tap leaves the run red with
  `3 real taps left switch-controlled-value at "off"`.
- **Scripts mutations (mine, jest, Node 24):**
  - Commenting out `child.kill(signal)` in `gate.mjs:1779` sends both signal tests red with
    `never saw "fake: caught INT"` / `"TERM"`.
  - Removing 24 from `SUPPORTED_MAJORS` makes the guard skip 19 tests and show the `SKIPPED` case. With the
    same mutation plus `describeCli = describe`, all 19 go red.
  - Making `leaseIsLive` always return `true` sends the ttl coexistence test red (`waitFor: timed out`).
  - Changing `lease.mjs:443` to always `throw error` sends the lock-retry test red.
  - Baseline with everything reverted: 137/137 green.
- **X10 `wait` test:** `74f653e` is an ancestor of `main`, as the report says.

## Must fix

**M1 — The "zero dwell is the defect, not the control" premise was never measured at a human dwell.**
(`example/ios/NitroUiExampleUITests/RealInputTests.swift:108`, `:2265-2281`)

The brief says to stop if the control "doesn't respond to a delivered tap". The report's own evidence is
that the instant touch *was* delivered to the app: the `js-toggle` `Pressable` on the same screen took it,
and so did `host-switch-0`. Only the hosted Toggles on the 200-switch screen ignore it. Only two points
were measured, 0 s (dropped) and 0.15 s (delivered). The doc comment justifies the dwell as "a person's
tap always lasts tens of milliseconds", but 150 ms is not tens of milliseconds, and ordinary quick taps
are under it.

- **Failure scenario:** on a settings-style list of hosted Switches, a user's 60 ms tap is dropped the
  same way, which is a product bug. The suite now passes because every synthesized press is held 150 ms,
  so nothing will ever show the bug.
- **Hint:** 150 ms is also roughly UIScrollView's touch-delay window, and the Switch screen is a
  `ScrollView`. That is a hypothesis, not a finding, but it is cheap to rule out.
- **Fix:** measure `switch-uncontrolled` on the Switch screen at roughly 0.03, 0.05 and 0.08 s (4 presses
  each) and record the result through a gate run or a committed log. Today the "4 instant taps over 30 s,
  4/4 held" measurement exists only in prose. If a human-scale dwell is delivered, set `pressDwell` to the
  smallest reliable value and cite the measurement. If it isn't, this is a product bug: put it under
  Questions for orchestrator, as the brief requires.

**M2 — The iOS red proof and the iOS retry rate leave no evidence.**
(`scripts/real-input/ios.mjs:181-185`; report `:68`)

`xcodebuild()` forwards only lines matching `Test Case|Test Suite|error:|…`, so `pressUntil`'s
`real-input (ios): … answered on tap n/3` and `tap n/3 left …` lines go only to
`.real-input/ios/xcodebuild-test.log`, and the next run overwrites that file. I checked: none of the 25
iOS real-input logs in the gate store for this branch contains a retry line. No `real-input:ios` ledger
line has a dirty tree, so neither half of the iOS "swallow first / swallow every" proof was run through
`gate.mjs`. The quoted red, `3 presses left switch-controlled at 0`, is not a message the shipped helper
can produce. The helper's message is `… 3 real presses on the controlled Switch (switch-controlled) left
it at "off"`.

- **Failure scenario:** a regression that makes every iOS control need a second press is green in every
  ledger line, and nothing anywhere records it. "10/10" can't distinguish "never retried" from "retried
  every time". Q3 §3 asked for exactly this: keep the `tap 2/3` lines visible.
- **Fix:** add `real-input \(ios\):` to the forwarding regex, or attach the lines as notes in
  `parseTestResults`, which is Q3's follow-up and a one-line change. Then rerun the iOS mutation pair
  through `gate.mjs`, so the ledger and an excerpt hold both halves, and quote the actual lines.

**M3 — The retry passes a Switch that loses its first change event.**
(`RealInputTests.swift:1876-1901`, `scripts/real-input/android.mjs:3018-3050`; the `switch` check on both
platforms)

`tapUntilValue` retries whenever the echo hasn't reached `expected`. It never asks whether the touch
landed natively. Take a control that flips natively and paints optimistically, but whose first `onChange`
never reaches JS:

1. Tap 1: native goes on, the echo stays `off`.
2. Tap 2: native goes off and the event arrives, so the echo is `off`.
3. Tap 3: native goes on, so the echo is `on`, and the check passes. The log says the earlier taps "were
   never delivered".

`hosted-switch` would still go red, because `host-events-count` would read 3 instead of 2. The plain
`switch` check has no event count, so it goes green on both platforms. This is the fault class the
real-input suite exists to catch, and the failure text's claim that this "is not a control that answers
sometimes" holds only for the all-fail path.

**Fix:** before retrying, read the control's own native state. On iOS that is the `switch-controlled`
element's `value`, the same discriminator the report used to diagnose the drop. On Android it is the
Switch node's `checked` attribute in the dump. If the native state already moved while the echo didn't,
fail with "delivered, but the change never reached JS" instead of pressing again. This keeps the brief's
"one swallowed tap goes green via retry", because a swallowed tap leaves native unmoved. Show it red by
mutating the Switch to drop only the first `onChange` send.

## Nice to have

**N1 — `liveDateBaseline` can only return 0** (`example/__tests__/HostPopups.harness.tsx:369-380`). It
returns early on 0, or else waits for `livePresentations === 0` and returns that, or throws. Every
`live0 + 1` / `toBe(live0)` is therefore the constant 1/0 dressed as a delta, and the report's "delta
assertions against an earned baseline" is really "wait for zero, else name the leak". That behavior is
fine and is what Q3 proposed. Rename the helper to something like `waitForNoDateWindows` and drop the
delta arithmetic, or state the invariant in its doc.

**N2 — Disposal is now allowed up to 12 to 40 s** (`HostPopups.harness.tsx:1318-1323`, `:378`, `:405`).
"Comes down with its row" now waits up to the 12 s default for `!presented && live === 0`, where it used
to read the count when `presented` fell. The baseline and fresh-mount readers allow 20 s each.

- **Failure scenario:** a regression where the re-framed row's dialog stays composed for 3 to 10 s, which
  is visibly hanging over the screen, passes. That is H2b's original bug in a slower form.
- **Fix:** keep the pair wait, but bound the second half to a frame-scale tolerance (for example ≤1 s after
  `presented` falls), so "a frame or two" passes and "seconds" doesn't.

**N3 — The report and the doc comment overstate the drop** (report `:9-11`;
`RealInputTests.swift:2267-2269`). "It is never delivered" / "the control never sees it" contradicts the
team's own run at 23:15Z on `main`. There, zero-dwell tap 1 flipped `switch-controlled` and only tap 2 was
lost, and X6 had 10/10 green with `tap()`. The drop is intermittent. Say so; it also bears on M1.

**N4 — The Node-guard red proof cites the fake runner's output as the real one** (report `:74`). "The log
shows the *real* `bun run check` (391 tests)": 391 is what the fake runner echoes
(`scripts/__tests__/gate.test.js:1380`). The real `check` is 1113 tests. Quote whatever actually shows the
re-exec. My Node 24 mutation confirms the guard itself works.

**N5 — The determinism proof is narrower than the brief** (report `:59-64`). `harness:android:Picker` ran
5/5, but the brief asks for 10 of each patched harness test, and `Picker.harness.tsx` runs on Android
too. The iOS repeats are `--control switch` only. The filter is allowed, but `fingerTap` and the retries
changed all 13 iOS controls, and each control has only two full-suite greens, one per tree. Run five more
Android Picker repeats, plus two or three more full `real-input:ios` runs.

**N6 — The lock-retry test can fail as a bare Jest timeout** (`scripts/__tests__/lease.test.js:1189-1223`).
Its `waitFor` defaults to 20 s, but the test has Jest's 5 s default. Under the `lease.mjs` mutation it
failed at 5003 ms with a Jest timeout rather than `waitFor: timed out`. The ttl test got an explicit
`30_000` for exactly this reason; give this one the same.

**N7 — Small comment inaccuracies:**
- `gate.test.js:2323` says the fake "exits on its own after a few seconds", but the loop is 300 × 0.1 s,
  which is 30 s.
- `RealInputTests.swift:1794` says "every attempt waits three whole seconds", but the window is
  `reactTimeout`, which is 8 s.
- The `SKIPPED:` case in `gate.test.js` reports as a *pass*, so "loud rather than silent" holds only in
  verbose output. This is already in the report's follow-ups.

## Summary

**Verdict: FIX ROUND**

- M1: `RealInputTests.swift:108` — the 0.15 s dwell is above a human tap, and no human-scale dwell was measured; it may hide a dropped-quick-tap product bug, the brief's stop condition.
- M2: `scripts/real-input/ios.mjs:181` — iOS retry lines never reach the gate log; the iOS red pair has no ledger/log evidence, and its quoted message doesn't match the helper.
- M3: `RealInputTests.swift:1876` / `android.mjs:3018` — the retry turns a Switch that loses its first `onChange` green on the plain `switch` check; check native state before retrying.
- N1: `HostPopups.harness.tsx:369` — `liveDateBaseline` always returns 0, so the "delta" is a constant; rename it or document that.
- N2: `HostPopups.harness.tsx:1318` — disposal waits of 12 to 40 s let a window that lingers for seconds pass; bound it to frame scale.
- N3: report `:11` / `RealInputTests.swift:2267` — "never delivered" contradicts the 23:15Z run on `main` (tap 1 landed with zero dwell).
- N4: report `:74` — "391 tests" is the fake runner's echo, not the real `check`.
- N5: report `:63` — `harness:android:Picker` ran 5/5, short of the brief's 10; only two full `real-input:ios` greens.
- N6: `lease.test.js:1189` — the lock-retry test needs an explicit timeout above its 20 s `waitFor`.
- N7: `gate.test.js:2323`, `RealInputTests.swift:1794` — comment durations are wrong (30 s, 8 s).
