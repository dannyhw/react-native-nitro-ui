# T19 — TextField restart: the measurements that decide go or no-go

**Worktree / branch:** named in your delegation message. **Round cap:** 1 round, plus at most 2 fix rounds (D19).
**Devices:** your lease (`lease.mjs acquire --task T19 --boot`). Another task (G10) uses the other pair on this host,
so record load with every number, and compare arms only within the same run.

Read first:
- `docs/DECISIONS.md` D30 and D31;
- `docs/tasks/Q2-textfield-research.md` §7, the go and no-go thresholds;
- the two spike reports, each with its "Read with the review" note: `task/T18-textfield-spike` (`246495c`) and
  `task/T18b-textfield-followup` (`052b377`).

## Why

0.4 shipped without TextField (D30). D31 says TextField restarts with a measurement task, and the component (G8 in
the old plan) is built only if those measurements clear Q2's thresholds. T18b left these open:
- about 30 MiB retained at N=200;
- composition and X4 rules 1, 3 and 4 unmeasured;
- iOS latency 1.38× as a lower bound only;
- iOS reject one key short;
- iOS focus on the `UITextField` arm flaky;
- P1 failing in 3 of 10 iOS runs.

## Setup

- Branch from `origin/task/T18b-textfield-followup`, then merge `origin/main` into it. `main` has moved a lot since
  then: the sizing engine, recycling, F6/F8. Make the prototype build again.
- This branch is evidence and is never merged. Only your report and ledger are merged, separately.

## Measure (each number load-stamped, with N and method)

1. **iOS keystroke-to-commit latency, in a release build, measured in-app,** against RN `TextInput` in the same run
   with alternating arm order. Report p50 and p95 and the ratio. Go needs p95 ≤ 1.5× `TextInput`; no-go is > 2×.
2. **Android latency with alternating arm order.**
3. **The N=200 retention** (about 30 MiB): find its cause. Is it the prototype, the host, or a measurement artefact?
   Is it reclaimed after a GC or a churn? Go needs N=200 recycle/drop leak-free.
4. **The P1 failures** (3 of 10 iOS runs) and **iOS `UITextField`-arm focus flakiness:** cause, and whether the
   SwiftUI `TextField` arm alone avoids them.
5. **iOS reject "one key short"** at 10 keys/s: cause, and whether it's the oracle or the product.
6. **Composition:** a JS write mid-composition (Japanese IME) and `maxLength` with an emoji, on both platforms.
7. **X4 conformance rules 1, 3 and 4** on the prototype.

## Output

Write `docs/tasks/T19-textfield-measurements.report.md` containing:
- a table of every Q2 go criterion and no-go trigger, each as **met**, **not met** or **unmeasurable**, with the
  evidence;
- an explicit recommendation: build TextField (and which iOS hosting shape), don't build it, or what one more
  measurement would settle;
- under "Questions for orchestrator", any decision that's the owner's.

Commit the report and the exported ledger on your branch. Don't change library code on `main`'s side: the prototype
lives only on this branch.

## Gates

`check` on your branch. Device gates aren't required, because nothing merges to `main` except the report. Record
every measurement run in the ledger (`gate.mjs bench` or harness filters), so the numbers are traceable.
