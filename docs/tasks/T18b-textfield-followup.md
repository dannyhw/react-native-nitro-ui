# T18b — TextField follow-up spike: latency and imperative focus (one round)

**Machine:** maintainer-mac-1 (`NITRO_UI_MACHINE_LABEL=maintainer-mac-1`). **Branch:**
`task/T18b-textfield-followup`, from `task/T18-textfield-spike` (T18's spike code is the starting
point). **Round cap:** one round, no fix rounds (spike, D19). **Devices:** one pair from
`node scripts/lease.mjs acquire --task T18b`.

**Why.** T18 (`docs/tasks/T18-textfield-spike.report.md`) returned no-go for 0.4 on two findings.
The owner's call (2026-10-28): 0.4 ships without TextField, and this spike decides whether G8 can
start for 0.5 with a known design. It is evidence on a branch, as T18 was: no public export, no
`component.json`, no docs page, no changeset.

## Do

1. **Android keystroke→commit, measured honestly.** T18's 3.00× (p95 78 vs 26 ms) was a debug
   build with each keystroke inside an `adb shell input text` round trip. Re-measure in a
   **release** build of the example (or the bench app if that is the shorter path; say which),
   timing from the native key/IME event to the JS commit, with RN `TextInput` timed the same way in
   the same run. Do iOS the same way for symmetry. Report p95 and the ratio against Q2 §7's lines
   (go ≤ 1.5×, no-go > 2×), with the raw samples.
2. **If Android is still above 1.5×,** find where the per-keystroke cost goes (T18's gaps put a
   ~31 ms floor per keystroke) with a profile or timestamps per hop, and fix it if the fix fits this
   round. If it doesn't fit, name it with evidence.
3. **Imperative `focus()` / `blur()` on both platforms,** the approach T18's report names:
   the field owns its first responder and is focused from the view, not from the model.
   - iOS: both arms (SwiftUI `TextField` and the hosted `UITextField`), or say which arm the
     report recommends and make that one work.
   - Android: a `FocusRequester` owned by the composable, including the case T18 saw fail
     (a field mounted later in the same suite never fired `onFocus`).
   - Make T18's red `P5 focus latency` test green with a real number, and show it red first.
4. **The report** (`docs/tasks/T18b-textfield-followup.report.md`): the T18 go/no-go table
   re-stated with this round's rows replacing T18's, then **go / no-go for G8 in 0.5** with the
   reason, and the G8 brief's must-haves (prop list, `T | null` per the perf contract, events,
   methods, and the RN keyboard interop list from T18).

## Rules

AGENTS.md applies, including the perf contract and "every new test shown red". Measurements are
labelled with the machine's load at the time. A reading of code is labelled as a reading, never as
a measurement. Quote other documents only with what they actually say. Stay on the leased devices,
and never touch `emulator-5560`. Only that machine's orchestrator pushes, and only this branch.

## Gates

`check` green. The spike's harness suites and the real-input spike controls on the leased devices,
recorded with `gate.mjs`. Say what you ran. Commit on your branch, don't push.
