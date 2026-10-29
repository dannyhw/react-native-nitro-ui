# F1 — Determinism: tap delivery and the known flaky tests

**Branch:** `task/F1-determinism` (from `main` at `c8ac6dd`) · **Round:** 1 + fix round 1 (cap: 1 + 2, D19) ·
**Lease:** `F1-q325w` (`pair-a`: iPhone Air sim + `emulator-5574`, adb 5043 / Metro 8295) ·
**Machine:** `maintainer-mac-2`

## Summary

**The dropped tap is real, and it is not in our controls.** XCUITest's `tap()` sends a touch with zero
dwell, and on the Switch screen — 200 `switch-list-*` switches in a scroller, plus the hosted ones —
it is **nearly never** delivered: 0/12 and 1/12 presses moved a control's own native `value:` at zero
dwell, calm and loaded (`docs/tasks/F1/dwell-probe.md`). Fix round 1 corrected "never" — the claim
contradicted this project's own `main` run at 23:15Z, where zero-dwell tap 1 flipped
`switch-controlled` and only tap 2 was lost, and X6's 10/10 green with `tap()`. The drop is
**intermittent**, which is precisely why a check that asserts after one un-witnessed press passed for
months and then failed 11 runs in a row. At the time it was measured: `switch-uncontrolled` stayed at
`value: 0` through repeated instant taps over 30 s, and `switch-rejected-count` ("events JS saw")
never moved, so nothing reached JS. The same instant `tap()` *is* delivered to the `js-toggle`
`Pressable` there (3/3) and to `host-switch-0`, and a press held 0.15 s flipped them 4/4 on two
controls. Every iOS tap now goes through `fingerTap` (`pressDwell = 0.15`). Android already delivered,
so it needed the wait, not the dwell. Whether the *product* drops a person's quick tap is now a
measured open question, not a closed one — see `## Questions for orchestrator`.

The suite now proves the touch landed before blaming the control: `pressUntil` retries a press keyed
on the **rendered value**, so one swallowed tap costs a retry and every tap swallowed stays red.
Refusal assertions stay un-retried — retrying those hides the bug they catch. Android mirrors the
shape; there a `uiautomator dump` measures ~2 s, so polling it at 100 ms was itself a race.

Picker's variant test accepted any size differing from the previous one, and four readings that all
mean *not done* satisfy that — a zero ends the wait, and the box assertion then compares a real box
with nothing. It now refuses a missing handle, a zero, and the pre-change size. **The witness had to
be the size, not the handle object**: my first version required a different handle after the
rerender, iOS reuses the same hybrid across a keyed rerender, and that failed a run which had
succeeded. HostPopups asserted `toBe(0)` on a process-wide count, so a previous test's dialog still
mid-disposal was charged to whichever gate read next; gates now earn their baseline, and a window
that will not come down names itself as somebody else's leak. `sweepOrder` closes every popup row it
pressed near — a dialog composes a frame late, so the old loop leaked one per sweep.

Item 4: the `lease.test.js` sleeps are gone, the `gate.mjs` CLI fixtures are guarded by the runtime
the shipped version helper accepts, and signal forwarding has the test FOLLOWUPS 57 asked for. X10's
flaky `wait` test needed nothing — `74f653e` is already an ancestor here, green 3/3 under load.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1113 tests / 42 suites | `55ef6047b9dc` | 2 m 37 s | start 10.2 / med 5.7 / max 11.5 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `55ef6047b9dc` (ios tree) | 2 m 07 s | start 4.0 / med 3.8 / max 4.2 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `55ef6047b9dc` (android tree) | 6 m 14 s | start 3.6 / med 2.0 / max 3.6 |
| `real-input:ios` | **PASS** | — | `55ef6047b9dc` (ios tree) | 10 m 54 s | start 2.0 / med 4.0 / max 17.6 |
| `real-input:android` | **PASS** | — | `55ef6047b9dc` (android tree) | 13 m 23 s | start 2.7 / med 2.3 / max 4.0 |
| `harness:android:HostPopups` | **PASS** | 24 tests / 1 suites | `55ef6047b9dc` (android tree) | 43.0 s | start 3.4 / med 3.0 / max 3.4 |
| `harness:android:HostPopups:--background` | stale | — | f1b38a24acd6 (not this tree) | 0.5 s | start 2.1 / med 2.1 / max 2.1 |
| `harness:android:Picker` | **PASS** | 38 tests / 2 suites | `55ef6047b9dc` (android tree) | 38.4 s | start 6.9 / med 5.8 / max 6.9 |
| `harness:ios:Picker` | **PASS** | 38 tests / 2 suites | `55ef6047b9dc` (ios tree) | 38.7 s | start 5.6 / med 5.0 / max 5.6 |
| `real-input:android:--control:switch` | **PASS** | — | `55ef6047b9dc` (android tree) | 30.4 s | start 1.6 / med 2.4 / max 2.7 |
| `real-input:ios:--control:switch` | **PASS** | — | `55ef6047b9dc` (ios tree) | 33.4 s | start 31.6 / med 23.8 / max 31.6 |

`need --for review`: `need: review is satisfied on this code tree.` (the stale row is the argument-parsing
mistake I made once at 02:54 — `--background` after `--` — recorded under its own name, so it satisfies
nothing.)

The table prints the newest run per gate; the determinism proof is the repeats behind it, all through
`gate.mjs` on this tree: **`real-input:ios --control switch` 10/10 green** (max load1 per run 16.7 →
192.1, four of them forced past 150 — the band where X3's reds were never seen but where the suite
used to be judged at all), **`harness:android:HostPopups` 15/15** (five between load1 19.8 and 39.5,
which brackets the 28.3 that caught the race below), **`harness:ios:Picker` 10/10** (to 30.9),
**`harness:android:Picker` 5/5** (to 7.9). `0.00x0.00` appears in no log, and the full
`real-input:ios` run is green at max load1 17.6 here and 28.3 in round 1.

## Red proofs

- iOS tap delivery -> swallow the Toggle binding's *first* write (`HybridNitroUiSwitch.swift`) -> suite green with `"switch-controlled" answered on tap 2/3` and `host-switch-0` likewise; swallow *every* write -> `3 presses left switch-controlled at 0` — stays red, as it must. **[Superseded in fix round 1: with M3's native-state witness armed, that same mutation is RED on both platforms — see the fix-round proofs. This line records what the round-1 code did, which is exactly the hole M3 closes.]**
- Android tap delivery -> swallow the first press per control (`HybridNitroUiSwitch.kt`) -> suite green with `tap 1/3 … left "off" - tapping again` / `answered on tap 2/3`; swallow every write -> `3 real taps left switch-controlled-value at "off" rather than "on"` — red. **[Superseded in fix round 1: with M3's native-state witness armed, that same mutation is RED on both platforms — see the fix-round proofs. This line records what the round-1 code did, which is exactly the hole M3 closes.]**
- Picker variant re-measure -> pre-fix predicate plus one dropped-host `0x0` read at the rerender -> `variant menu->wheel: menu=72.00x34.67 wheel=0.00x0.00 box=330.00x60.00`, both box assertions fail — the historical signature on demand. Same fixture with the fix: 38/38 green.
- HostPopups sweep leak -> `for (const id of opened)` restored + `popupIsUp` blind to a frame-late dialog -> `follows all seven when two of them trade places: expected 1 to be +0`.
- HostPopups baseline -> revert `livePresentations.decrementAndGet()` so disposal never lands -> `"comes-down-with-its-row" could not earn a zero baseline: 6 DatePicker window(s) were live before it opened anything, and they did not come down when it closed its own` — the leak names itself instead of arriving as a wrong count.
- `lease.test.js` ttl -> `leaseIsLive` returns `true` always -> red: the poll never sees the short lease expire.
- `gate.test.js` Node guard -> guard forced off on Node 25 -> 9 red: the CLI fixtures' fake runner on `PATH` is bypassed, because `gate.mjs` re-execs under a *real* fnm node and `bun run check` then runs against the fixture tree. What the guard actually produces is the shipped module's own line, not a jest count (`node-version.mjs` under Node 25): `reexec-evidence: ran under Node 24 from .nvmrc (this shell is on Node 25.9.0; `fnm use` to match it)`. Guard on, same Node: 19 skipped, 66 passed, plus the named SKIPPED case. (The "391 tests" this line first quoted is the *fake runner's* echo at `gate.test.js:1380`; the real `check` prints 1113 — corrected in fix round 1, N4.)
- `gate.test.js` signal test -> `child.kill(signal)` removed from the forwarder -> `never saw "fake: caught INT"`, both signals red.

## Files changed

- `example/ios/NitroUiExampleUITests/RealInputTests.swift` — `pressUntil` + wrappers, `fingerTap` for every element and coordinate tap, ~20 blind assertions converted.
- `scripts/real-input/android.mjs` — `pressUntil`/`tapUntilValue`/`tapUntilUp`/`tapOptionUntilValue` in `makeContext`, `DUMP_POLL_MS`, every `CHECKS` assertion converted.
- `example/__tests__/Picker.harness.tsx` — `waitForFreshMeasure` for both variant tests.
- `example/__tests__/HostPopups.harness.tsx` — `liveDateBaseline` + `expectDateWindowsAt`, deltas at the four fresh-mount readers, `sweepOrder` closes every popup row, a closed dialog waited for as a pair.
- `example/src/PickerScreen.tsx`, `example/src/HostScreen.tsx` — drop timers long enough that a 2 s dump cannot outrun an app-side close.
- `scripts/__tests__/lease.test.js`, `scripts/__tests__/gate.test.js` — sleeps → `waitFor`, Node-major guard, signal-forwarding test.

## Round 1 addendum — a race the repeats caught in this task's own code

The round-1 determinism proof caught one more race, in code this task had just written: the 3rd
`harness:android:HostPopups` repeat went red at load 28.3 — the same `expected 1 to be +0` the gate
was reworked to stop throwing — on the line that waited for `presented` and *then* read the count.
`presented` is model state and falls with the props batch; the process-wide count falls when Compose
disposes the dialog's subtree, a frame or two later, so that read measured the frame in between — the
mistake the neighbouring gate documents in prose, carried over from the shape it replaced. `98df683`
waits on the pair, which is the direction the rest of the file already waits. 15/15 green after, six
of them at load1 19–39, including above the 28 that caught it. The tree moved, so everything was
re-run on it: the table above and the repeat counts below it are all post-fix.

In `docs/tasks/F1/failures/`, five 04:22Z rows are not test failures: my edit moved the code tree
while that round's last phase was running, and the harness correctly refused the stale APK. The
genuine ones there are the deliberate mutations above and the round-1 HostPopups red.

## Follow-ups

- real-input iOS: `fingerTap`'s 0.15 s dwell is measured, not derived — if XCUITest ships a dwell knob, the constant should become one.
- real-input Android: `uiautomator.mjs` still has no idle-tolerant read path (A2's open item), which is why `DUMP_POLL_MS` is 500 rather than something tight.
- HostPopups: the popup gates that are not fresh-mount readers still assume a zero baseline; only the four Q3 named were converted.
- gate.test.js: the CLI guard skips 19 cases on Node 25+; CI pins `.nvmrc` so CI is unaffected, but a local run on a new Node loses them silently.
- scripts: `check` is ~157 s of which `test` is ~147 s — X10's ceiling note stands, unchanged by this work.

## Questions for orchestrator

**Q1 (fix round 1, M1) — is a quick tap on a hosted Switch in a busy list a product bug?** The brief's
stop condition was: if only a press of ≥ 0.1 s is delivered, stop and ask rather than pick a dwell.
That is what the measurement says. `docs/tasks/F1/dwell-probe.md` presses `switch-uncontrolled` on the
Switch screen and reads *its own* native `value:` (not an echo, which cannot tell a dropped touch from
a lost event):

| Press held | Busy screen, calm | Busy screen, load1 ≈ 25 | Host screen (a dozen controls), calm |
| --- | --- | --- | --- |
| 0 s | 0/12 | 0/12 | 1/12 |
| 0.03 s | 1/12 | 0/12 | 12/12 |
| 0.05 s | 1/12 | 0/12 | 12/12 |
| 0.08 s | 7/12 | 6/12 | 12/12 |
| 0.12 s | 12/12 | 12/12 | — |

A person's tap is measured elsewhere at roughly 40–120 ms, which is inside the band that loses presses
on the busy screen and *not* inside it on the light one, at comparable load. RN's own `Pressable` on the
same screen takes every one of the same zero-dwell presses 3/3, so the event path is alive: what stops
seeing the touch is the hosted control's recogniser on a screen with ~200 controls mounted. The
`switch-disabled` negative control reads 0/12 with the same presses at dwell values the busy screen
delivers, so the witness is not inventing the losses.

Options, with my recommendation:

1. **(Recommended)** Treat it as a real product bug and open a task for it: the two candidate
   mechanisms are `delaysContentTouches`/scroll-view touch delay and hit-test cost with 200 mounted
   rows, and the probe's own footer says the one-line experiment that separates them. F1 should not
   decide it: both fixes change app behaviour, outside a determinism task's scope.
2. Accept it and document that hosted controls want a ≥ 120 ms press — which reads badly as a library
   contract, and this report should not launder a measurement into a promise.
3. Tell me to hold the suite at a dwell below 0.1 s and accept flakiness as the visible symptom of the
   product bug. I would not: it makes every future iOS run's red ambiguous.

`pressDwell` stays **0.15 s** either way — the shortest shape with no observed losses on either machine
state, and the one every green run of this suite used. If Q1's answer changes it, the retry counts now
in every gate log (M2) will show it within a run or two.
