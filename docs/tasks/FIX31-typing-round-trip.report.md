# FIX31 — The typing round-trip cases hold on a slow machine

**Branch:** `task/FIX31-typing-round-trip` (from `main` at `4c17d58d`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX31-3gebd` (`emulator-5570` / iOS sim, Metro 9293 android, 8293 iOS)

## Summary

Both Android "round-trips typed text to JS, one event per keystroke" cases read something the
handshake had not finished deciding, and neither needed a library change.

SearchField waited for the field to read `abc` and then read `jsEvents` at once. A keystroke's
echo reaches native in the commit that ran the handler for its event, so native can show all three
keystrokes with the last echo still on its way. The case now reads the report through the file's
existing `reportedWhen`, which waits for `jsEvents` to catch `nativeEvents`, and asserts the same
numbers.

TextField read `lastWrite` after waiting for `jsEvents === 3`, and CI read `stale`. **Decision:
`stale` is correct there, so no library change** — and it is not a claim the case can assert.

- Code: the wrapper echoes the count and the app's `value` in one commit, so a key typed before JS
  answers makes that answer a `value` whose `jsEvents < nativeEvents`, which
  `NitroUiControlledValue.reconcile()` refuses by design (`docs/DESIGN.md` 3.5: dropped, not
  queued, so it cannot overwrite what the user just did). `applyWrite()` records that refusal, and
  the commit that finally carries `abc` is `js == displayed` — no write, so it records nothing and
  `lastWrite` still names the earlier refusal.
- Measurement: with every echo in, the field reads `abc` with both counts at 3 — it does not end on
  a value JS did not ask for, and no write it should take was skipped. On a machine that answers in
  time (this one: keystroke→commit p50 4.0 ms, p95 9.1 ms against a 30 ms key gap) the same case
  ends `none`. So the final `stale`/`none` records how fast JS answered, not what the handshake
  decided, and pinning either would pin the machine.

So the case now types one key and waits for that key's answer before the next — the interleaving
where every write is a no-op — and keeps `lastWrite === 'none'`, which the handshake takes there.
This is the brief's option (a) with the wait moved one step earlier: the write it waits for is the
one the handshake takes, and it is `none` rather than `stale` because the case no longer types
across an unanswered keystroke. The dropped write stays covered by the shared handshake vectors
(`src/__tests__/useControlled.test.tsx`,
`android/src/test/java/com/margelo/nitro/nitroui/core/NitroUiControlledValueTest.kt`,
`scripts/native-tests/handshake.test.swift`) and by the
revert case's `applied`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2231 tests / 103 suites | `0c9c74a3c35d` | 57.9 s | start 10.9 / med 16.0 / max 19.1 |
| `harness:ios` | **PASS** | 621 tests / 30 suites + isolated 6 tests / 3 suites | `0c9c74a3c35d` (harness:ios digest) | 14 m 45 s | start 13.8 / med 4.5 / max 18.1 |
| `harness:android` | **PASS** | 680 tests / 31 suites + isolated 6 tests / 3 suites | `0c9c74a3c35d` (harness:android digest) | 18 m 21 s | start 18.3 / med 4.4 / max 18.3 |
| `real-input:ios` | **PASS** (from `merge/picker-and-searchfield`) | — | `94bf291d225c` (real-input:ios digest) | 44 m 36 s | start 5.0 / med 4.2 / max 34.0 |
| `real-input:android` | **PASS** (from `merge/picker-and-searchfield`) | 76 tests / 28 suites | `94bf291d225c` (real-input:android digest) | 42 m 07 s | start 3.0 / med 3.7 / max 43.7 |
| `harness:android:Field.harness` | stale | 40 tests / 2 suites | 056cd053e459 (not this tree) | 40.8 s | start 4.2 / med 4.0 / max 4.2 |

`need --for review`: need: review is satisfied on this code tree.

## Red proofs

Both cases, on main's shape, with the JS thread held 250 ms inside the case's own controlled
handler — the whole commit carrying an echo lands late, echo and `value` together:

- `SearchField › round-trips typed text to JS, one event per keystroke` -> hold JS 250 ms in that
  case's handler -> `expected 2 to be 3` at `expect(state.jsEvents).toBe(3)`; green after the
  change with the same hold (`33 passed, 7 skipped`, harness:android, filtered).
- `TextField › round-trips typed text to JS, one event per keystroke` -> hold JS 250 ms in that
  case's handler -> `expected 'stale' to be 'none'` at `expect(state.lastWrite).toBe('none')`, with
  `[text, nativeEvents, jsEvents]` already proven to be `['abc', 3, 3]`; green after the change
  with the same hold.
- Delaying only the fixture's `setValue` is not this proof tool: the wrapper has already echoed by
  then, so native correctly applies the older `value` and the field ends on `c` — an artifact of the
  tool, not the CI shape. The hold replaces it.

No library code changed, so no handshake mutation was run.

## Files changed

- `example/__tests__/SearchField.harness.tsx` — the typed round-trip reads through `reportedWhen`.
- `example/__tests__/TextField.harness.tsx` — the typed round-trip types one key per answered
  keystroke, and reads JS's own copy of the value from the echo it waited for.

## Follow-ups

- text-field: a `stale` write is reachable with no timing at all — a test `writers` call made while
  a keystroke's event is in flight. A deterministic case for "dropped, not queued" could sit beside
  the revert case.
