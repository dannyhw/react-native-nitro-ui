# X47 — Android real-input: gesture, sheet and dialog controls move into e2e

**Kind:** tooling · **Devices:** android · **Budget:** 7 h for round one (the first move took
35 minutes of work for 14 assertions, plus a 52-minute gate run)

## Goal

Nothing user-visible: for the controls below, the Android real-input gate asserts through the e2e
suite and no longer through `uiautomator`.

## Why

An owner request: a `uiautomator` check stays only where e2e cannot make it.

## Controls

`context-menu`, `date-picker`, `hosted-date-picker`, `bottom-sheet`, `dialog`, `popover`, `chip`, `checkbox`, `list-item`, `hosted-switch`, `hosted-mixed`.

## Behaviour

1. For each control, every row of `docs/tasks/X45/context.md` section 2.3 marked "E2E today" or
   "E2E with a helper already in this repo" is asserted by a test in that control's file under
   `example/e2e/real-input/`, and is gone from `scripts/real-input/android-tree-checks.mjs`.
2. A row marked "Already asserted in phase 1" is deleted once both sides are read and found to
   read the same thing. One that differs is made to match in e2e, then deleted.
3. A row marked "Better as a harness test" is deleted only where an existing test in
   `example/__tests__` asserts the same observable; the report quotes that test's file, line and
   assertion. Where none does, the row stays and is listed.
4. A row marked "Needs a driver change" stays, and is listed with the capability it waits for.
5. A control with no row left has no entry in the tree checks, and helpers nothing calls are gone.
6. The answers in `docs/tasks/X45-real-input-e2e-first.report.md` are applied: a hold is a 2 px
   swipe held for its duration; tree reads that must match the platform's nodes ask for the
   unmerged tree; "can be acted on" is `hittable` or a present `checked` on that tree.

## Proof

- `node scripts/gate.mjs check` and `node scripts/gate.mjs harness:android` pass on the final tree.
- `node scripts/gate.mjs real-input:android` passes once on the final tree; iterate with
  `-- --control <id>` first. Report its duration.
- One red proof per new test (`test -> mutation -> the line that went red`). The context file's
  section 3.2 names the cheapest mutation per control. Mutations are never committed.

## Out of scope

- Any control not listed. Harness tests. iOS. The accessibility sweep. The e2e and agent-device
  packages. `example/e2e/README.md` and `CONTRIBUTING.md`, which are updated at merge.
- Pickers, menus and button controls: the other task moves them.

## Decided already

- No retry, no raised timeout; `retries` stays 0; a test waits on a stated condition.
- Another task is moving other controls out of the same file at the same time: delete only your
  controls' blocks and touch nothing else in it. `os-tree.ts` `ownerNode` is yours: for a disabled chip and list item it must pick the node the platform's dump calls clickable (the tightest `hittable` node of the unmerged tree), shown red once.
- `harness:ios` and the iOS real-input gate run at merge, not here.
- If the budget ends first, finish the control in hand, leave the rest untouched and list them.

## Context

`docs/tasks/X45/context.md` (each assertion by line with its verdict; the line numbers are from
before the first move, so find a row by its text) and the answers table in
`docs/tasks/X45-real-input-e2e-first.report.md`. `stepper.e2e.ts` and `tooltip.e2e.ts` are the
pattern for a moved control.
