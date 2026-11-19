# FIX22 — Tests wait for the value they read instead of racing it

**Kind:** bugfix (tests only) · **Devices:** both ·
**Budget:** 3 h for round one (three test files, each a small wait change with a red proof)

## Goal

The SearchField clear-button pair, the hosted Picker menu case and the Slider real-drag case pass on
slower machines (GitHub-hosted CI) because each waits for the signal it reads, not a moment that
happens to be long enough locally.

## Why

Triage of CI runs 44504146726, 44512228495, 44520997811, 44554494142 and 44628184641 (logs are on the
run pages; `gh run view <id> --log-failed`). None showed the library's state wrong; each test read a
value before it arrived:
- `example/__tests__/SearchField.harness.tsx` about 498-504, "reports the clear button as one empty
  edit and keeps the focus": waits on the native report (`text === ''`), then reads the JS event log
  at once; both platforms publish the report before sending the event, so the event can arrive later
  (`expected [] to deeply equal ['change:']`, failed in 5 of 5 CI iOS runs and 2 of 5 Android). The
  sibling at about 567-572, "takes no submit from a Return pressed on a query it has just cleared",
  races the same way in reverse (`expected ['change:'] to deeply equal []`).
- `example/__tests__/HostPopups.harness.tsx` about 758 (and 776, 800): reads `picker.selectedIndex`,
  the last value React wrote, before React's `setIndex` reaches native (`expected 1 to be 2`).
- `example/e2e/real-input/slider.e2e.ts` about 37 and 51: reads the value once straight after a swipe
  that took 1.7 s on CI; the screen at failure already showed the moved value.

## Behaviour

1. Each read waits for its own signal: the event log reaching the expected events (or the JS and
   native event counts agreeing), the picker's `selectedIndex` reaching the value, the slider's value
   settling (a sliding-complete count in the example screen, as the "Phases slider" has, or two equal
   reads), and then asserts exactly what it asserted before. Nothing is loosened: the expected values,
   counts and "no other event" checks are unchanged.
2. No library code changes. If a wait shows the library is wrong (an extra event, a value that never
   arrives), stop and report it.

## Proof

- Each changed case shown red once with the mutation it guards (for the clear button, drop the
  clear's change event; for the picker, refuse the write; for the slider, a drag that does not move
  it), one line each in the report.
- `harness:ios`, `harness:android`, `check`, `need --for review`, and
  `node scripts/gate.mjs real-input:android -- --control slider` green.

## Out of scope

- The Menu split-trigger case, the HostPopups "closes when the control is disabled" case, and the
  TextField and SearchField "round-trips" cases that read `'stale'`; list any of these that turn out
  to be the same pattern as a follow-up line, do not change them.
- Library code; `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers
  (`support.ts`, `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`).

## Decided already

- A wait polls for the real signal with the file's usual timeout; never a fixed sleep, a longer
  timeout or a retry.

## Context

The three test files above, and `HybridNitroUiTextField.kt`, `NitroUiTextEditing.swift`,
`HybridNitroUiPicker.kt` for where each value is published.
