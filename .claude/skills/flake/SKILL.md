---
name: flake
description: Handle a red or intermittent nitro-ui gate or test - decide whether it is a flake or a bug, how many reruns are allowed, when to quarantine, and how to fix one without reproducing it on demand. Use when a gate fails, when a test passes on rerun, and before writing or reviewing any flake fix. Plain markdown, for any agent.
---

# Flake

A red gate is a bug or a flake. This says how to tell which, how many reruns are
allowed, when a test is quarantined, and how to fix a flake without making it happen
on demand.

## When a gate goes red

1. **Read the failure before anything else**: `node scripts/gate.mjs logs --failed`
   lists the failed runs' logs. Note the test name and the assertion.
2. **One rerun.** Not two.
3. **Red again with the same failure: it is a bug.** Stop calling it a flake. It is
   deterministic on this tree, so debug it like one.
4. **Green on rerun: it is a flake, and it is now recorded.** A worker puts one line
   under "Follow-ups" in its report: `Flaky: <test name>, <date>, <log path>`. The
   orchestrator copies it to "Flaky tests" in `docs/tasks/FOLLOWUPS.md` at merge and
   counts the sightings. Carry on.

Never loosen an assertion, raise a timeout or add a retry to get to green. Those hide a
failure. A quarantine, below, does the opposite: the test is visibly off and listed.

## When the same flake is seen in a second task

The orchestrator decides, not the worker that hit it:

- If the log shows the test or the driver was at fault (a tap sent before the view
  settled, a read that raced a write, a device that was not ready), **quarantine** it.
  The orchestrator tells the worker of the task that hit it to skip the test on that
  task's branch, with a `QUARANTINED <date>` comment naming the FOLLOWUPS line. A skip
  is a harness test edit, so it runs on both platforms, which that task's merge gates
  do anyway. The orchestrator lists it under "Quarantined tests" in FOLLOWUPS and
  writes one brief to fix it.
- If the library's own observable state was wrong even once, it is not quarantined. It
  is a bug with a low hit rate, and it gets a bugfix task now.

A quarantined test blocks no merge. Its fix is follow-up work and queues behind
components. One that has been quarantined for two weeks goes under "Needs you" once,
with what leaving it off costs.

## Fixing one

**Time box: 30 minutes and two device runs to make it happen.** If it has not, stop
trying. A flake is by definition hard to reproduce.

Then fix it from what you already have:

1. Write three to five causes, ranked. For each, write what the existing logs would show
   if it were true. Cross out the ones the logs contradict.
2. Fix the best survivor. Where a cheap mutation exists, use it: break the code the fix
   guards and show the test goes red.
3. In the report, say plainly that the race itself was not reproduced, which cause you
   fixed, and what evidence chose it.

The time box is for reproducing a race. The red-proof rule in `AGENTS.md` still applies
in full to any test that guards the library's behaviour.

**If two fixes for the same failure have not held, stop writing fixes.** Write down the
one sentence both assumed, and test that sentence directly. The cause is probably not
where both fixes looked.

## Reviewing a flake fix

Do not send it back for lacking an on-demand reproduction. Send it back if the stated
cause does not explain all of the recorded failures, or if it works by waiting longer
or trying again.
