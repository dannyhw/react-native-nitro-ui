# X45 — Android real-input: settle what e2e can do, drop what it already asserts

**Kind:** tooling · **Devices:** android · **Budget:** 5 h for round one (the previous round on
this gate took 7 h for a larger scope)

## Goal

Nothing user-visible: the Android real-input gate keeps a `uiautomator` check only where the e2e
suite cannot make it, and this task settles on a device which those are.

## Why

An owner request. A read of the driver's source found that most of
`scripts/real-input/android-tree-checks.mjs` can be e2e tests, that 49 of its assertions repeat
one the e2e suite already makes, and ten questions the source does not settle.

## Behaviour

1. Each of the ten questions in `docs/tasks/X45/context.md` section 3.4 has an answer from a
   device run. The report carries a table: the question, what was run, what was read, the answer.
   Where the device contradicts the context file, the device wins and the report says so.
2. The e2e suite's device reads gain the popup-window count, beside `adbShell`, and its tree read
   can ask the driver for the unmerged tree (context section 3.2, shared work a and b).
3. Every assertion the context file marks "Already asserted in phase 1" is gone from
   `android-tree-checks.mjs`, each only after both sides were read and found to read the same
   thing. One that does not match stays and is listed in the report with the difference.
4. `stepper` and `tooltip` are e2e only: their rows of context section 2.3 are tests in
   `example/e2e/real-input/stepper.e2e.ts` and `tooltip.e2e.ts`, and their blocks are gone from
   `android-tree-checks.mjs`. A row that cannot move stays, with the reason.
5. Helpers and exports nothing calls any more are deleted.

## Proof

- `node scripts/gate.mjs check` passes.
- `node scripts/gate.mjs harness:android` passes on the final tree.
- `node scripts/gate.mjs real-input:android` passes once on the final tree. Iterate with
  `-- --control <id>` runs first. Report the gate's duration beside the 54 minutes it took before.
- Red proofs, one line each (`test -> mutation -> the line that went red`), for every test item 4
  adds. The context file names the cheapest mutation per control.
- The report says how long the two moved controls took, device time included, so the remaining
  seventeen can be sized.

## Out of scope

- Moving any other control. Harness tests. iOS. Changes to the e2e or agent-device packages.
- Editing the body of a check that stays, beyond deleting the assertions item 3 names.
- The gate runner and the platform mapping.

## Decided already

- No retry, no raised timeout: a new test waits on a stated condition, and `retries` stays 0.
- `harness:ios` and the iOS real-input gate run at merge, not here.
- An experiment that needs a setting or environment variable changed is run on a scratch edit and
  reverted; only the answer is committed, in the report.
- The assertion that can never fail (`check(…, true)`, context follow-ups) is deleted.

## Context

`docs/tasks/X45/context.md`: every assertion of the file by line, with a verdict and the evidence
for it, and what the driver offers, by file and line. `example/e2e/README.md` describes the gate.
