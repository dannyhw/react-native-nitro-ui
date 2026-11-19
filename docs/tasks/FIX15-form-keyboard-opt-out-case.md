# FIX15 — Bring back the Android Form keyboard opt-out proof

**Kind:** bugfix · **Devices:** android ·
**Budget:** 3 h for round one (a quarantine fix with one investigation; no similar task finished)

## Goal

`keyboardAvoidance={false}` on an Android `Form` is proven again on every run: the Form keeps its
content height and its scroll offset while the keyboard is up, and the proof does not fail at random.

## Why

`docs/tasks/FOLLOWUPS.md` "Quarantined tests": the real-input case "opting out of keyboard avoidance
leaves the content and its offset alone" failed twice in a row in a full Android run, with the Note
field focused, no keyboard on screen and the field's box gone from the tree, and passed alone. It
was taken out of `form.e2e.ts` because the runner counts a skipped test as a failure; its last
version is `git show 49b84b9d:example/e2e/real-input/form.e2e.ts`. An earlier attempt (FIX10,
`git show task/FIX10-form-keyboard-after-sequence:docs/tasks/FIX10.review.md`) found that blocking
the Form's `requestChildRectangleOnScreen` forward does nothing; that review names what to read at
the failure and proposes the deterministic test below.

## Behaviour

1. A deterministic Android harness case proves the promise without a keyboard: with
   `keyboardAvoidance={false}` and an IME inset reported to the Form, a request to show a row below
   the viewport leaves the Form's scroll offset and content height alone; with the default, the same
   request moves it. It needs test commands through the Form's `nuiTestCommand` (an inset and a
   rectangle request).
2. The real-input case comes back in a form that does not fail at random: either its cause is found
   and fixed (in the library if the Form or a control misbehaves, in the test if it reads something
   it should not trust), or, if the cause is the keyboard or the driver and cannot be fixed here,
   the case is left out and the harness case of item 1 is the Android proof, said in the report.
3. Nothing else about the Form changes.

## Proof

- The harness case of item 1, red with the opt-out ignored (the Form scrolling while opted out), on
  `harness:android`; `harness:ios` green (the file is shared).
- If the real-input case returns: `node scripts/gate.mjs real-input:android -- --control form` green
  three times in a row, and once right after the earlier files of a full run (`bottom-sheet` to
  `dialog`, the sequence it failed after), with the reads the FIX10 review names logged.
- `check` and `need --for review` clean; a patch changeset if library code changed; the
  "Quarantined tests" line updated or removed.

## Out of scope

- iOS's opt-out case (it runs), other Form lines in FOLLOWUPS.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`). If the cause is
  in one of those, stop and report it with the evidence.

## Decided already

- The flake time box (`.claude/skills/flake/SKILL.md`) applies to reproducing the real-input failure.
- No assertion loosened, no wait lengthened, no retry added.

## Context

`android/.../HybridNitroUiForm.kt` (IME inset, `revealFocusedRow`, `nuiTestCommand`,
`nuiTestFormReport`), `src/components/Form/Form.tsx`, `example/__tests__/Form.harness.tsx`,
`example/src/FormScreen.tsx`, `example/e2e/real-input/form.e2e.ts`.
