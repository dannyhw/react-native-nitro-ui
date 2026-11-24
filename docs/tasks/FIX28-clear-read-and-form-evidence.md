# FIX28 — The SearchField clear test waits for its event; the Form keyboard failure names the field

**Kind:** bugfix (tests only) · **Devices:** both ·
**Budget:** 1.5 h for round one (median of the last two test-read tasks, 1.5 h and 3 h with a fix
round)

## Goal

Two product tests stop costing a guess on slower machines: one waits for the value it reads, and
the other's failure evidence says whether the field it lost is in the driver's tree at all.

## Why

GitHub-hosted CI on main 2ae64754 (run 45383576823):
- iOS `example/__tests__/SearchField.harness.tsx` "reports the clear button as one empty edit and
  keeps the focus" (about line 517) got `[]` where it expects `['change:']`. It waits for the native
  report to read empty text, then reads the JS event log at once: the read-too-early shape that
  `logReached` (same file) fixed for the submit case.
- Android `example/e2e/real-input/form.e2e.ts` "a field the keyboard would cover is moved clear of
  it" failed with the keyboard up and the app's focus and avoidance echoes both yes, yet the
  driver's tree (384 nodes) held one editable, `"(no words)"`, and no "Note" field. The evidence's
  raw dump line (`dumpedField` → `uiautomator dump`) can never succeed while the driver holds the
  device's accessibility connection (`example/e2e/README.md`, "Phase 2").

## Behaviour

1. The SearchField clear case waits, with the file's usual timeout, until the log holds the clear's
   entry after `before`, then asserts exactly what it asserts today. A log that never fills names
   what is missing.
2. The Form keyboard evidence no longer tries the raw dump. Instead it lists every node in the
   driver's own snapshot whose words (text, content description or hint) contain "Note", whatever
   its class or role, with class, role or flags, focus, and bounds. It also says "none" when
   there are none.
3. Nothing else changes: no library code, no other case, no assertion loosened. The passing path of
   the Form case is unchanged.

## Proof

- SearchField: red once with the clear's change event withheld, and the message names it.
- Form: force the failure path once (for example, make the above-keyboard read throw) in a filtered
  `real-input:android -- --control form` run. Quote the new evidence line in the report, then
  restore the code and run it green the same way.
- `harness:ios` and `harness:android` green; `check` and `need --for review` clean.

## Out of scope

- Why the field is missing, and the quarantined sibling "opting out of keyboard avoidance…".
- Other CI reds (HostPopups picker count, iOS Menu split trigger); `scripts/`, `.claude/`,
  `AGENTS.md`, `docs/agents/`, the shared e2e helpers (`support.ts`, `os-tree.ts`, `reader.ts`,
  `device-read.ts`, `keyboard.ts`, `press-feedback.ts`).

## Decided already

- Poll for the signal, never a fixed sleep, a longer timeout or a retry. Reuse `logReached` or its
  pattern; it may take the slice after `before`.
- Remove `dumpedField`, `accessibilityDump` and anything only they use from `form.e2e.ts`.

## Context

The two test files above; `example/e2e/README.md` for phase 1 and phase 2.
