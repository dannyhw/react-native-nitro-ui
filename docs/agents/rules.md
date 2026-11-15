# Rules and what enforces them

A rule that a script enforces holds. A rule that is only a sentence depends on being read. When a
prose rule is broken twice, give it an enforcer or delete it. When a rule gains an enforcer,
shorten its sentence in `AGENTS.md` to one line.

## Enforced by a script or a test

| Rule | Enforcer | Reason |
| --- | --- | --- |
| A device gate needs a live lease for its task and devices | `gate.mjs` refuses before the run (`gate-lease-required.test.js`) | Without a lease a run drives whatever device it finds |
| The reserved emulator is never addressed | `lease-core.mjs` refuses the reserved serial and port | It is not part of the pool |
| At most two device tasks hold devices | The lease pool queues the third | A pair is one simulator, one emulator and one Metro port |
| One device gate at a time on one lease | `gate.mjs` Metro pre-flight; a second `real-input` run is refused | Two gates on one Metro port break each other's run |
| A device gate needs 10 GB of free disk | `gate.mjs` refuses before the run | A full disk fails a build partway and stalls every task |
| A device run uses an app built from this tree | `app.stamp` check in the harness runner | A stale binary can pass tests for code it does not contain |
| No inline JSX callbacks, optional view props, AnyMap or JSON-string props | `eslint-rules/` (four rules), run by `check` | They re-send props on every render or crash when a prop is removed |
| Generated Nitro code matches the specs | `nitrogen:check` | A spec change needs regenerated code |
| Per-component lists match the manifests | `registry:check` | The lists are generated, never edited by hand |
| The published package is what `etc/package-files.txt` says | `manifest:check` | Tooling changes must not change what users install |
| A component ships its README row, usage and both screenshots | `readme-components.test.js` | A component is not shipped until it is documented |
| README examples compile | `readme:check` | A copied example that does not build is the first thing a user meets |
| A report cites files that exist and a table that is current | `bun run task-ready`: the worker runs it before hand-in and the orchestrator asks for its line. It is not part of `check` | A report must describe the tree it is handed in with |
| A file listed as check-only tooling is not imported by a device run | `gate-check.test.js` searches for importers of the files it names, not of the whole list | A wrong entry makes a real change look like it needs no device run |
| A worktree is removed only when nothing can be lost and nobody is in it | `worktrees.mjs --prune` and its rule in `worktrees-core.mjs` (`worktrees.test.js`) | A checkout in use must never be removed |

## Watched, not prevented

The watchdog (`scripts/watchdog.mjs`, run hourly from outside the orchestrator) reports these when
they change. Nothing stops them happening.

| Condition | Why it is watched |
| --- | --- |
| The orchestrator's conversation has stalled | A stalled conversation cannot notice itself |
| A delegated task is waiting on a person | It makes no progress until someone answers |
| CI or Release is red on `main` | Local gates can be green while CI is red |
| The published npm version moved | What is said about a release must match the registry |
| Free disk under 40 GB, or removable worktrees | Device gates stop at 10 GB |
| A lease expired without being released | Its task stopped mid-run and still holds devices |
| A new GitHub issue opened by the repository owner | Those issues are the work queue; anyone else's issue is not work |

## Prose only

These depend on an agent reading and obeying. They are the candidates for the next enforcer.

| Rule | Where |
| --- | --- |
| No GitHub write from a task | `AGENTS.md` |
| Never `pkill` or `killall` | `AGENTS.md` |
| Never restart adb on port 5037; always address Android by serial | `AGENTS.md` |
| Commit with the repository's identity | `AGENTS.md` |
| A harness test edit runs on both platforms | `AGENTS.md` |
| The rest of the perf contract (setters, hosting views, recycling, threads) | `AGENTS.md` |
| Run `need --for merge` alone and read it | orchestrate |
| Device tasks in flight never exceed device pairs | orchestrate |
| Review before `real-input` gates | orchestrate |
| Only user-visible bugs, failed gates and wrong docs block a merge | orchestrate |
| A task has a wall-clock budget | brief |
| One rerun; a flake seen twice is quarantined | flake |
| 30 minutes and two device runs to reproduce a flake | flake |
| No tooling task without a measured cost and the owner's yes | orchestrate |
| Process tooling under 10 % of agent hours a week; gate and lease code takes bug fixes only | orchestrate |
| Benchmarks run before a release, not per task | orchestrate |
| No commit on `main` only updates task records | orchestrate |
| A tool or test nothing calls, or that never caught a defect, is removed | working agreements |
| Nothing reaches `main` ungated | orchestrate |
| Look at every screenshot before merge | orchestrate |
| Status lines come from a live query | owner-digest |
