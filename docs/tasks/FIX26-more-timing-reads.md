# FIX26 — Two more tests wait for the value they read

**Kind:** bugfix (tests only) · **Devices:** both ·
**Budget:** 1.5 h for round one (two small waits in two harness files; the last such task took 3 h
for three, including a fix round)

## Goal

"SearchField › submits on the Search key, then blurs" and "HostPopups › opens two popup owners in
one Host" pass on slower machines because each waits for the signal it reads.

## Why

The last CI triage named both as the same read-too-early shape as the three tests just fixed
(`docs/tasks/FOLLOWUPS.md`, "Harness reads that race the value they read"):
- `example/__tests__/SearchField.harness.tsx` about line 566: waits for the native blur, then reads
  the JS event log at once. GitHub-hosted CI run 44504146726 saw it two events short
  (`expected ['focus', 'change:t', …(2)] to deeply equal ['focus', 'change:t', …(4)]`). No event
  counter covers submit and blur, so the wait has to be on the log itself.
- `example/__tests__/HostPopups.harness.tsx` about line 911: reads `picker.selectedIndex` right
  after a pick, the read the last task fixed in three sibling places with `indexReached`.

## Behaviour

1. The SearchField case polls the event log, with the file's usual timeout, until it holds as many
   events as it expects, then asserts exactly the list it asserts today; a log that never fills
   fails saying which events are missing.
2. The HostPopups read goes through the file's existing `indexReached`, then asserts as today.
3. Nothing else changes: no library code, no other case, no assertion loosened.

## Proof

- Red once each: drop the submit event (SearchField), refuse the index write (HostPopups).
- `harness:ios` and `harness:android` green, `check` and `need --for review` clean.

## Out of scope

- Every other case; `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, the shared e2e helpers.

## Decided already

- Poll for the signal with the file's usual timeout; never a fixed sleep, a longer timeout or a retry.

## Context

The two harness files above; `HybridNitroUiTextField.kt` and `NitroUiTextEditing.swift` for when
submit and blur reach JS.
