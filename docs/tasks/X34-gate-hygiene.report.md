# X34 — Gate hygiene: a leased shell can run `check`, a detached gate takes its runner with it, and two iOS real-input waits settle on observed state

**Branch:** `task/X34-gate-hygiene` (from `main` at `df7f6835`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X34-vv27s` (pair-b — `nitro-ui B` / iOS 27.0 and `emulator-5570` / API 35, Metro 8293)

## Summary

Four `FOLLOWUPS.md` lines that have each cost another task hours, plus two regressions of my own.

**1. `check` from a leased shell.** Five suites in `scripts/__tests__` spawn device-aware CLIs and
inherited this shell's lease, so `bench-baseline-merge.test.js` died on "ANDROID_SERIAL and
EMULATOR_PORT disagree", the only shell a device task has. They spawn through
`helpers/scrubbed-env.js` now, and `test-env-scrub.test.js` audits every suite that spawns at all:
unscrubbed `process.env` reaching a device-aware `spawn` fails it. The auditor masks strings and
comments first, so a `spawn(` inside fixture source stays data.

**2. A detached gate's runner outlived its gate.** A backgrounded `gate.mjs` whose parent died left
its runner and Metro holding the lease's port with no ledger line. `scripts/gate-runner.mjs` now
leads the group its command — and so Metro — runs in, watches its gate over the stdin pipe with a
(pid, pgid) identity check, and sweeps that group when the gate goes. One that left no note surfaces on
the *next* run as a gate that DIED without a ledger line.

**3. `lease-queue.test.js` polled on a timer**, so a loaded box read the queue before its ticket
landed: red once, green twice. It waits on the ticket now.

**4. Two load-sensitive iOS real-input waits** (X31) decided from one read and a fixed count. Both go
through `GestureSettlement`: act, then decide on two consecutive *agreeing* reads under a deadline,
re-pressing only while the state says nothing has arrived — what stops a slow popover being tapped
shut again. Its properties are proved on the host, not on a slow device.

**Two regressions, each caught by a proof rather than a run.** Adding `GestureSettlement.swift` to
the UI-test target replaced the project lines naming `A11yFrameStability.swift`;
`uitests-sources.test.js` now requires that target's compiled sources to be exactly the Swift files
in its folder, both ways. And when `revealTab` began answering with a settlement outcome,
`reached=\(reached)` printed the struct: the pass passed, printed 23 well-formed-looking lines, and
the report blamed the tab bar for a parser that had read none of them. That print site now carries an
explicit `Bool` — the compiler holding the format, the guard asking for the annotation by name — and
the rule reports an unreadable measurement line as a format drift, not as 23 unreachable tabs. The
same discipline found every `stopGroup` test injects `signal`, so the sign in `process.kill(-group,
…)` — sweeping a run's tree versus orphaning its Metro — was untested.
## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2198 tests / 91 suites | `743434864778` | 2 m 44 s | start 4.8 / med 8.8 / max 10.8 |
| `harness:ios` | **PASS** | 629 tests / 32 suites + isolated 6 tests / 3 suites | `743434864778` (ios tree) | 15 m 10 s | start 10.9 / med 6.7 / max 13.0 |
| `harness:android` | **PASS** | 685 tests / 32 suites + isolated 6 tests / 3 suites | `743434864778` (android tree) | 19 m 01 s | start 4.7 / med 4.8 / max 6.7 |
| `real-input:ios` | **PASS** | — | `743434864778` (ios tree) | 46 m 30 s | start 5.0 / med 6.5 / max 86.0 |
| `real-input:android` | **PASS** | — | `743434864778` (android tree) | 72 m 31 s | start 12.1 / med 4.5 / max 12.1 |
| `real-input:ios:--control:a11y` | stale | — | ffcef98f2b93 (not this tree) | 0.5 s | start 5.6 / med 5.6 / max 5.6 |
| `real-input:ios:--control:popover` | stale | — | 49ecf2f6e24c (not this tree) | 23 m 10 s | start 10.3 / med 6.0 / max 10.9 |

`need --for review`:

```
  ✓ check — green
  ✓ harness:ios — green on the ios code tree
  ✓ harness:android — green on the android code tree
  note: treated as both platforms (outside the known prefixes): scripts/native-tests.sh, scripts/native-tests/gesture-settlement.test.swift, scripts/real-input/ios.mjs, scripts/real-input/tab-targets.mjs
need: review is satisfied on this code tree.
```

`need --for merge`:

```
  ✓ check — green
  ✓ harness:ios — green on the ios code tree
  ✓ harness:android — green on the android code tree
  ✓ real-input:ios — green on the ios code tree
  ✓ real-input:android — green on the android code tree
  note: treated as both platforms (outside the known prefixes): scripts/native-tests.sh, scripts/native-tests/gesture-settlement.test.swift, scripts/real-input/ios.mjs, scripts/real-input/tab-targets.mjs
need: merge is satisfied on this code tree.
```

The two `real-input:ios:--control:*` rows are the round's red proofs rather than its health: each ran
a mutated UITests source under a filter that satisfies nothing but itself, and both read `stale`
because the tree has moved since. The `--control:a11y` row is the filter that does not exist (`a11y`
rides every run), which is itself a finding, in Follow-ups. Nothing else is hidden by a table that
keeps one row per gate: `gate.mjs logs --branch task/X34-gate-hygiene` lists every stored log, and
`gate.mjs export --task X34` commits the ledger with a scrubbed excerpt of each failure — including
the two `harness:ios` runs that refused an app whose `app.stamp` did not match the tree, and the
item-2 kill demo whose run ended `exitCode: 143`. Each `need` block is the tool's own output, minus only the line about whether a `check` row could be borrowed from another ledger — that one quotes a git tree hash and so is always one commit stale.

`real-input:ios` is the run that found the drift, re-taken clean: the same 46 minutes, the same
`max 86.0` load1 spike in one sample, and this time 23 tab lines the parser could read, each with a
box (`tab-switch` 67.7 × 44 pt … `tab-host` 54.7 × 44 pt) instead of 23 accusations. The pass the
failing run blamed for never measuring a tab bar now prints `✓` 23 times.

## Red proofs

`test -> mutation -> the line that went red`. `docs/tasks/X34/mutations.json` carries the same rows
as data, with the `before`/`after` text of each edit. Rows 1-5 are host mutations (a working-tree
edit, the named suite run against it, the file restored); rows 6-10 are the host Swift wait's own
mutations, recorded in the header of the file that catches them; rows 11-13 are reds against the
branch's own shipped state, where the drift *is* the mutation; rows 14-16 are on lease X34-vv27s and
rebuild the mutated UITests source before the clean run.

- `test-env-scrub.test.js` (3 cases) -> `dataMask(source)` -> `const mask = ''` in `scripts/__tests__/helpers/spawn-env-audit.js` -> "does not count a call written inside generated source: - Expected - 1 / + Received + 9", and the audit's own site-walk going red the other way too
- `test-env-scrub.test.js` (4 cases) -> `withoutLeaseEnv` returns its argument -> "really does hand a child a scrubbed environment: Expected \"unset\" / Received \"X16-poision\"" and "scrubs the lease a suite overrides half of: Expected 0 / Received 1" — the exit code that cost X32 and X33 their `check`
- `gate-runner.test.js` -> `gateProcessIsAlive` drops its group half -> "says no for a pid that has been REUSED: Expected false / Received true"
- `gate-runner.test.js` (the new case) -> `process.kill(-value, …)` -> `process.kill(value, …)` -> "- Expected - 1 / + Received + 6" at `scripts/__tests__/gate-runner.test.js:454`: the by-pid escalation ran, so the term had not reached the tree. The same mutation had passed all 35 tests that existed before this case was written
- `lease-queue.test.js` (2 cases) -> `compareWaiters` newest-first -> "hands a freed pair to the older ticket": Expected pattern `/queue\s+1\. X24/`
- `gesture-settlement.test.swift` -> `minReads` -> 1 -> "a read that costs the whole budget still buys the second read (got 1)"
- `gesture-settlement.test.swift` -> agreement dropped -> "a screen that is still moving gets no gesture (got 5 presses)"
- `gesture-settlement.test.swift` -> `mayPress` dropped -> "no gesture is sent while a presentation is up (got 3 presses)"
- `gesture-settlement.test.swift` -> deadline ignored -> "the deadline ends a wait that never agrees (reads 400)"
- `gesture-settlement.test.swift` -> `maxPresses` ignored -> "the sanity cap is a cap (got 9 presses)"
- `real-input-tab-targets.test.js` -> the shipped print site at `d9dcd3c0`, where `reached` inferred `Outcome<TabReveal>` -> "Expected pattern: /let reached: Bool = /" while every literal-string assertion in that case passed
- `real-input-tab-targets.test.js` (2 cases) -> written before `unreadTabTargetLines` existed -> "TypeError: (0 , _tabTargets.unreadTabTargetLines) is not a function", on a fixture that is the real drifted line
- `uitests-sources.test.js` -> the shipped `project.pbxproj` at `16d2bcef` -> `expect(compiled).toEqual(onDisk)` with `- "A11yFrameStability.swift"`
- `real-input:ios:--control:popover` -> `mayPress: { $0.windows == 0 }` -> `{ _ in true }`, plus a read that ignores the presentation -> "9 real taps on the popover's anchor left no popover up at all after 25160 ms … on the evidence here the touch was never delivered" (650.1 s)
- `real-input:ios:--control:popover` -> the reveal drag goes from 70 % of the window to 1 pt -> "the example's tab \"tab-popover\" could not be scrolled wholly into the window in 28 reads and 27 drags over 60427 ms (it is at (1221.0, 68.0, 77.33…, 44.0), hittable: false)" (1389.9 s, `testRealInputA11y` failing at 149.8 s)
- item 2 on lease, twice -> `kill <pid>` on a backgrounded `gate.mjs`, then `kill -9` hard enough to take its supervisor -> soft: ledger `exitCode: 143` and the next gate starts on the same Metro port two minutes later; hard: Metro 13452 left on 8293 with no ledger line, and the next run refused — "this port belongs to a gate that DIED without a ledger line … its supervisor left no note"

## Files changed

- Gate runner: `scripts/gate-runner.mjs` (group ownership, gate-death watch, sweep, sidecar note),
  `scripts/gate.mjs` (background runs start under it; a refused or orphaned port names the dead gate
  and its log), `scripts/gate-core.mjs` (`deadGateBehindPort`), `scripts/lease-core.mjs` (a leased
  Metro port belongs to the pair, not to one platform).
- Suites: `scripts/__tests__/gate-runner.test.js` (new, and where the real-process cases live),
  `scripts/__tests__/gate-check.test.js`, `scripts/__tests__/test-env-scrub.test.js` (new) with
  `scripts/__tests__/helpers/scrubbed-env.js` and `scripts/__tests__/helpers/spawn-env-audit.js`,
  `scripts/__tests__/uitests-sources.test.js` (new), `scripts/__tests__/real-input-tab-targets.test.js`,
  `scripts/__tests__/lease-queue.test.js`, and the five spawning suites
  (`bench-baseline-merge`, `bench-dry-run`, `build-slot`, `lease`, `lease-metro-port`).
- iOS waits: `example/ios/NitroUiExampleUITests/GestureSettlement.swift` (new) and its call sites in
  `example/ios/NitroUiExampleUITests/RealInputTests.swift`, proved on the host by
  `scripts/native-tests/gesture-settlement.test.swift` through `scripts/native-tests.sh`.
- The tab-targets line: `scripts/real-input/tab-targets.mjs` (`unreadTabTargetLines`, and
  `checkTabTargets` now takes `strays`), `scripts/real-input/ios.mjs` (hands them over),
  `example/ios/NitroUiExampleUITests/RealInputTests.swift` (the annotated `Bool`),
  `scripts/__tests__/real-input-tab-targets.test.js`.
- Project file: `example/ios/NitroUiExample.xcodeproj/project.pbxproj` — `A11yFrameStability.swift`
  back in the UI-test target beside `GestureSettlement.swift`.

## Follow-ups

- `check` re-keys on the whole code tree, so a tooling-only commit costs a fresh iOS build plus
  `harness:ios` (~12 min here); `need` already splits by platform half, `check` does not.
- `scripts/real-input/ios.mjs` and `scripts/real-input/tab-targets.mjs` are outside `need`'s path
  mapping, so an iOS-only edit there re-owns the Android half as well; `tab-targets.mjs` genuinely
  is shared, `ios.mjs` is not.
- The iOS tab-reveal deadline is 60 s and this box needed 35 s of drags for one tab at load1 ~6 —
  1.7x, not a margin. Either the bar animates slower than the deadline assumes or the budget wants a
  load term.
- `dataMask`'s `(`-inside-a-comment case is treated as code, which only ever over-reports.
- Nothing prunes jest's per-file `tmpdir()` fixtures while a suite runs; they are the fastest-growing
  thing in `$TMPDIR` during `check`.
- Gate-log retention: this branch's runs pushed the shared store over its 64 MiB cap and retention
  pruned stored logs (oldest first, none under two hours old) — worth knowing before a round exports.
- The `real-input:ios --control a11y` filter does not exist (`a11y` rides every run), so a red proof
  of the tab reveal has to run under another control's gate name.
- `xcrun swiftc -typecheck` over `example/ios/NitroUiExampleUITests/*.swift` finds two pre-existing
  warnings (`RealInputTests.swift:6379` unused `refusing`, `:6462` `var eventsAtBottom` never
  mutated) and takes 11 s — a cheap pre-flight before a 45-minute gate.

## Questions for orchestrator

None blocking. Two for the record, both about this machine rather than the diff.

1. **The volume the bench lives on is full** (971 GB container, 0.9 GB free when the device work
   started, 2.5 GB now). `check` passed, but `build-app.mjs` died in `libtool` with
   `write64() failed … errno=28`, and no device gate could run until space appeared. To get through I
   deleted three rebuildable caches, each named so it can be checked: an orphaned Xcode DerivedData
   for a `/tmp` repro project that no longer exists (2.0 GB, untouched since Sep 26); the CocoaPods
   download cache (3.6 GB, repopulated by the next `pod install`); and one provably idle merged
   task's iOS derived data — `t3-f8c222f1` / `task/G15-checkbox`, 5.7 GB, no file touched since
   Nov 3, no process holding it. ~10 GB freed, already half gone again. The structural number: 55
   worktrees, each carrying 5-8 GB of `example/ios/build`, ~34 GB of it in six worktrees untouched
   for a week or more (liveness checked before the one deletion). **Recommendation:** a
   worktree-prune step for merged tasks' build dirs, or a disk pre-flight in `scripts/doctor.mjs`
   that refuses a device gate below a few GB and says so — an ENOSPC mid-build reads exactly like a
   code failure to the next task that meets it.
2. **`gate.mjs logs --prune` removes nothing** and reports it kept everything "by age, size or
   freshness", while a starting gate reports retention pruning five stored logs at a time. Not wrong,
   just worth knowing before someone looks for a round's evidence and finds it gone.
