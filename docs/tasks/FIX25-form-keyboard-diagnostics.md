# FIX25 — When the Android Form keyboard case fails, it records why

**Kind:** research (tests only) · **Devices:** android ·
**Budget:** 1.5 h for round one (failure-path diagnostics in one test file; no fix)

## Goal

The next time `form.e2e.ts` "a field the keyboard would cover is moved clear of it" fails, the
failure carries the evidence that decides whether a focused Android field loses its keyboard (a
library bug a user would see) or the driver fails to resolve a node that is there.

## Why

It failed once in GitHub-hosted CI run 44653752776 (job 2, line ~167) with `LOCATOR_NOT_FOUND`
for the Note textbox. Its quarantined sibling, the keyboard opt-out case (`docs/tasks/FOLLOWUPS.md`
"Quarantined tests"), failed with the same signature, and two earlier fixes for it found nothing.
At failure: the keyboard had been up and the field had scrolled clear; then no keyboard, `focus
yes`, and the tree still listed a focused textbox with a "Note" group beside it, yet the locator
counted none. The CI artifacts are downloaded under
`/private/tmp/claude-501/-Users-danielwilliams-Workspace-oss-react-native-nitro-ui/0235cded-022d-428f-929d-c40a985c10bc/scratchpad/a2`.

## Behaviour

1. When this case's field read fails, the test records, before failing: the raw accessibility node
   of the focused EditText (bounds, visible-to-user, its children's labels), whether the keyboard is
   up by the device's own report, and the Form's own `ime=`, `scroll=` and focus echo on Android.
   The failure message names the one question: did the keyboard close while the field stayed
   focused?
2. The case passes and asserts exactly what it does today when nothing goes wrong; the extra reads run
   only on the failure path and cost nothing when green.
3. No fix attempt, no library change, no change to the quarantined opt-out case.

## Proof

- Red once with a mutation that hides the field from the locator (for example a label that no
  longer matches), showing the recorded evidence in the failure output; one line in the report.
- `node scripts/gate.mjs real-input:android -- --control form` green; `check` and
  `need --for review` clean.

## Out of scope

- Fixing the cause; the shared e2e helpers (`support.ts`, `os-tree.ts`, `reader.ts`, `keyboard.ts`,
  `device-read.ts`, `press-feedback.ts`) except reading through what they already export;
  `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`.

## Decided already

- Failure-path only: no wait, timeout or retry changes. Do not run `bun install` or
  `bun run nitrogen` while this worktree's `check` is running.

## Context

`example/e2e/real-input/form.e2e.ts` (the keyboard case and `revealLowInPage`), `example/src/FormScreen.tsx`
(`form-list-geometry`, the echo row), `android/.../HybridNitroUiForm.kt` (`nuiTestFormReport`).
