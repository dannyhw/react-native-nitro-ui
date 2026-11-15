# Rules, what enforces them, and why they exist

A rule that only exists as a sentence gets broken. Over eighteen days of orchestrated work the
rules that held were the ones a script refused to let anyone break, and the ones that failed twice
were prose (`need --for merge` piped into a chain; "no third device task without a free pair").

So this table is the working list. **When a prose rule is broken a second time, give it an
enforcer or delete it.** When a rule gains an enforcer, shorten its sentence in `AGENTS.md` to one
line, and drop it once nobody can break it. New rules are added here with the incident that
caused them, not as a paragraph in `AGENTS.md`.

## Enforced by a script or a test

| Rule                                                        | Enforcer                                                                     | Why                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A device gate needs a live lease for its task and devices   | `gate.mjs` refuses before the run (`gate-lease-required.test.js`)            | 2026-11-11: two runs from a shell with no lease drove an emulator nobody had leased    |
| The reserved emulator is never addressed                    | `lease-core.mjs` refuses the reserved serial and port                        | It is reserved and not part of the pool                                                         |
| At most two device tasks hold devices                       | The lease pool queues the third                                              | A pair is one simulator, one emulator and one Metro port                           |
| One device gate at a time on one lease                      | `gate.mjs` Metro pre-flight; a second `real-input` run is refused            | 2026-11-13: two harness gates on one Metro port cost an hour                           |
| A device gate needs 10 GB of free disk                      | `gate.mjs` refuses before the run                                            | 2026-11-13: 47 unremoved worktrees (450 GB) filled a disk and stalled all work 34 h    |
| A device run uses an app built from this tree               | `app.stamp` check in the harness runner                                      | A stale binary can pass tests for code it does not contain                              |
| No inline JSX callbacks, optional view props, AnyMap or JSON-string props | `eslint-rules/` (four rules), run by `check` | The patterns in `docs/research/nitro-patterns.md`, as lint |
| Generated Nitro code matches the specs                      | `nitrogen:check`                                                             | A spec change without regenerated code                                             |
| Per-component lists match the manifests                     | `registry:check`                                                             | There were 24 hand-kept lists per control                                        |
| The published package is what `etc/package-files.txt` says  | `manifest:check`                                                             | Tooling changes must not change what users install                                     |
| A component ships its README row, usage and both screenshots | `readme-components.test.js`                                                 | 2026-11-02: the dialogs shipped without screenshots                                              |
| README examples compile                                     | `readme:check`                                                               | A copied example that does not build is the first thing a user meets                   |
| A report cites files that exist and a table that is current | `bun run task-ready`: the worker runs it before hand-in and the orchestrator asks for its line. It is not part of `check` | Reports described trees they no longer matched |
| Exported failure logs carry no secret or machine identity   | The scrubber in `gate.mjs export` (`gate-logs.test.js`)                      | The repo is public                                                                     |
| A file listed as check-only tooling is not imported by a device run | `gate-check.test.js` searches for importers of the files it names, not of the whole list | A wrong entry makes a real change look like it needs no testing |
| A worktree is removed only when nothing can be lost and nobody is in it | `worktrees.mjs --prune` and its rule in `worktrees-core.mjs` (`worktrees.test.js`) | A review of the first version removed a task's checkout mid-run |

## Watched, not prevented

The watchdog (`scripts/watchdog.mjs`, run hourly from outside the orchestrator) reports these when
they change. Nothing stops them happening.

| Condition                                        | Why it is watched                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| The orchestrator's conversation has stalled      | Three stalls of 34 h, 39 h and 6 h, each found by a person                                  |
| A delegated task is waiting on a person          | One sat on an approval prompt for 8 h; a finished one was reported "running" for 38 h        |
| CI or Release is red on `main`                   | Red for 7 h on 2026-10-31 while every local gate was green (shallow checkout on CI)          |
| The published npm version moved                  | "Still waiting for your approval" was reported for hours after a release was live            |
| Free disk under 40 GB, or removable worktrees    | See the disk row above                                                                       |
| A lease expired without being released           | Its task stopped mid-run and still holds devices                                             |
| A new GitHub issue                               | Issues from real apps are the main work queue                                                |

## Prose only

These depend on an agent reading and obeying. They are the candidates for the next enforcer.

| Rule                                                                  | Where          | Broken                                            |
| --------------------------------------------------------------------- | -------------- | ------------------------------------------------- |
| No GitHub write from a task                                           | `AGENTS.md`    | 2026-11-07, an unrequested PR comment             |
| Never `pkill` or `killall`                                            | `AGENTS.md`    | 2026-11-03: `pkill -P 1` powered off every simulator and emulator on the machine and every Metro and Gradle daemon |
| Never restart adb on port 5037; always address Android by serial      | `AGENTS.md`    | 2026-11-10                                        |
| Commit with the repo's identity                                       | `AGENTS.md`    | An invented author email credited four commits to a stranger |
| A harness test edit runs on both platforms                            | `AGENTS.md`    | A test edited for one platform broke the other    |
| The rest of the perf contract (setters, hosting views, recycling, threads) | `AGENTS.md`    | Reviewed by hand                                  |
| Run `need --for merge` alone and read it                              | orchestrate    | 2026-10-31 and 2026-11-11: merged with red or missing gates |
| Device tasks in flight never exceed device pairs                      | orchestrate    | 2026-11-08, 11-10 and 11-11: about 20 h queued    |
| Review before `real-input` gates                                      | orchestrate    | New rule                                          |
| Only user-visible bugs, failed gates and wrong docs block a merge     | orchestrate    | New rule                                          |
| A task has a wall-clock budget                                        | brief          | New rule; single rounds ran 8 to 21 h             |
| One rerun; a flake seen twice is quarantined                          | flake          | New rule; reruns were unlimited                   |
| 30 minutes and two device runs to reproduce a flake                   | flake          | 2026-11-14: about 15 h of device time on four flaky tests |
| No tooling task without a measured cost and the owner's yes           | orchestrate    | New rule, replacing "schedule tooling alongside product work" (2026-10-27); process tooling took 45 % of agent time in its first week |
| Process tooling under 10 % of agent hours a week; gate and lease code takes bug fixes only | orchestrate    | 2026-10-26 week: 69,000 lines of process scripts, 9,600 of library |
| Benchmarks run before a release, not per task                         | orchestrate    | 16 recorded runs, 7 red, none a regression caught by the baseline check |
| No commit on `main` only updates task records                         | orchestrate    | 433 of 478 direct commits on `main` touched only `docs/tasks`, about three per merge |
| Task records leave git 14 days after their task merges (`task-records.mjs --archive`, staged into the next merge commit); failure logs are never committed | orchestrate    | 2026-11-15: after three weeks `docs/tasks` held 2,300 files and 40 MB, 1,643 of them failure logs |
| A tool or test nothing calls, or that never caught a defect, is removed | working agreements | 2026-11-15 audit                                  |
| Nothing reaches `main` ungated                                        | orchestrate    | 2026-11-12: a one-line CI fix cost a 2.5 h re-run |
| Look at every screenshot before merge                                 | orchestrate    | 2026-11-06: a search icon that drew a key shipped |
| Status lines come from a live query                                   | owner-digest   | See the npm row above                             |
