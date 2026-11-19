# X59 — the e2e suite reads Android action flags off the released driver

**Kind:** tooling · **Devices:** android · **Budget:** 3 h for round one (X54, a 3 h tooling
task; this one carries a finished trial)

## Goal

The Android real-input suite proves ContextMenu, ButtonGroup and Picker accessibility actions in
its own e2e tests, read off the released driver, instead of in a separate `uiautomator` dump pass.

## Why

`agent-device` 0.21.40 prints `clickable`, `focusable`, `longClickable` and `scrollable` on raw
Android snapshot nodes. A trial on a patched driver (S7) showed the e2e suite making all five
assertions the fallback makes, with the same readings. Its three code commits are already on this
branch, cherry-picked from `task/S7-driver-flags-trial`; its report is in that branch at
`docs/tasks/S7-driver-flags-trial.report.md`. No `@e2e-dev/mobile` release depends on 0.21.40
yet (0.12.8, the newest, pins 0.21.39).

## Behaviour

1. The installed driver is `agent-device` 0.21.40, through a dependency override in the root
   `package.json`, with `bun.lock` updated to match.
2. The e2e tests assert, from the driver's node: an accessible ContextMenu is long-clickable and
   focusable; a ContextMenu that is not `accessible` is neither; each ButtonGroup item title sits
   inside a clickable node within the group's box; the enabled Picker's named node is clickable.
3. Those five assertions are removed from `scripts/real-input/android-tree-checks.mjs`. What it
   checks that e2e cannot (the ContextMenu hold-then-drag in one gesture) stays.
4. `scrollable` comes from the driver; the class-name guess stays only for a node the driver
   leaves the flag off, and nowhere else.
5. A Spinner's own name and the choice it shows stay apart in the e2e tree (the S7 mapping fix).

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- Each of the five e2e assertions shown red once by a mutation (the S7 report lists the ones it
  used; repeat them on 0.21.40), and the `scrollable` fallback shown to apply only when the flag
  is absent.
- `node scripts/gate.mjs real-input:android` (full): `reader.ts` imports `os-tree.ts`, so every
  control's tests read through the changed mapping. A red is completed with `--rerun-failed`.

## Out of scope

- The driver's code and any GitHub activity on its repository.
- Moving to a newer `@e2e-dev/mobile`, unless 0.12.7 refuses to run with driver 0.21.40; then
  take 0.12.8 and say so in the report.
- The accessibility sweep, which still reads a dump.
- How `tree()` reads the driver's output: another task (X58) is changing that in the same file.
  Leave that function's read as it is on `main`.

## Decided already

- Override, not a fork or a patch file.
- iOS real-input does not use this driver, so no iOS gate is owed for the driver change itself;
  run what `need --for review` lists.

## Context

`example/e2e/real-input/os-tree.ts` (`asTreeNode`, `pressableItem`, `actionFlags`),
`example/e2e/real-input/{context-menu,button-group,picker}.e2e.ts`,
`scripts/real-input/android-tree-checks.mjs` (`contextMenuChecks`, `buttonGroupChecks`,
`pickerChecks`, `TREE_CHECKS`).
