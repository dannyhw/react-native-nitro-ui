# Orchestrating nitro-ui tasks

How work on this repo is run when an orchestrator agent drives implementer and
reviewer agents. This is the playbook a new orchestrator session reads first, on
any machine. The live state is in `STATUS.md` (task table) and `RECOVERY.md`
(what is in flight and the next step for each). Decisions are in
`../DECISIONS.md`. Agent rules are in `../../AGENTS.md`.

## Roles

- **Implementer:** works one brief in its own worktree, commits, never pushes,
  and ends with a report (`docs/tasks/<ID>.report.md`, per `REPORT-TEMPLATE.md`).
  Apex at `variant: xhigh` for implementation and fix rounds; `medium` only for
  fully specified doc or mechanical edits (`EFFORT-eval-2026-10-27.md`).
- **Reviewer:** a fresh session given the brief, the diff and the report, never
  the orchestrator's opinion. It writes `docs/tasks/<ID>.review.md` with a
  verdict (MERGE / MERGE WITH FIXES / FIX ROUND) and numbered M (must) and N
  (nice) findings.
  It also checks premises: every file, module or task the report or the new code
  comments rely on must exist at the branch tip (implementers have invented
  plausible files before, e.g. X3's first minutes).
- **Orchestrator:** writes briefs, delegates, sends fix rounds, merges into
  `main`, pushes, and keeps `STATUS.md` / `RECOVERY.md` current. It is the only
  role that pushes.

## The loop

1. Write `docs/tasks/<ID>.md` (short, numbered, with the gates listed), commit
   and push it, then
   `git worktree add ../nitro-ui-worktrees/<ID> -b task/<ID>-<slug> main`.
1b. **Context pack.** If you mapped the code for the brief (an Explore pass, a
   grep table of the files involved), commit it as `docs/tasks/<ID>/context.md`
   with real paths, and point the brief at it. Don't summarise it in prose: an
   implementer anchors on a path list and guesses from a summary.
2. Delegate to the implementer with the worktree path, the brief path and the
   lease command. Name no devices: they come from `scripts/lease.mjs`. Use the
   template below.
3. On the report: start a review. On FIX ROUND or MERGE WITH FIXES, send the
   M-list **to the same implementer thread**, which saves it re-reading the
   repo. Re-review after a round that changed native code.
4. Round cap (D19): 1 implementation round plus at most 2 fix rounds. Spikes
   get one round. After that, the orchestrator fixes small leftovers itself or
   records them in `FOLLOWUPS.md`.
5. Merge (`git merge --no-ff task/<ID>-…`), confirm `bun run check` on the
   merged tree, push, and update `STATUS.md` / `RECOVERY.md` in the same push.

Delegation template (implementer):

```
You are the implementer for task <ID> in the nitro-ui repo.
Worktree (work ONLY here): <abs path>   Branch: <branch> (from main at <sha>).
Read, in order: AGENTS.md, docs/PLAN.md (skim), docs/tasks/<ID>.md, and
docs/tasks/<ID>/context.md if it exists.
Ground yourself before you reason about structure: read the files the brief
names, and `git ls-files <dir>` before you assume a file exists. Other task IDs
exist only as far as `git log` shows them merged.
Environment: bun install; Node 24 via `fnm exec --using 24 --`; Android env from
AGENTS.md; devices only from `node scripts/lease.mjs acquire --task <ID>`.
Commit on your branch, don't push. End with a short version of the report and
the final SHA.
```

If an implementer's turn ends early (for example a tool call printed as text
instead of run), check its worktree and resume the same thread with what is and
isn't applied. Don't start a new session.

## Rules that are easy to break

- Never touch `emulator-5560`, the maintainer's own emulator. Don't name it any
  other way, and never `adb kill-server` on the default port. Never
  `pkill`/`killall` by name, and don't stop processes you didn't start.
- At most 2 device tasks at once (the lease script enforces this). Benches and
  baseline mints use `--exclusive`.
- The repo is public (D25). Never write home paths, emails, hostnames, or the
  names of personal devices or apps into it. Bench files carry
  `NITRO_UI_MACHINE_LABEL`, not a hostname.
- Commit messages and PR descriptions describe the change, not who or what
  wrote it.
- Process and tooling changes must leave the published package byte-identical
  (`npm pack` file list = `etc/package-files.txt`, same contents).
- Process speed is a priority (owner's call): schedule tooling/process work alongside product
  work, not after it, as long as the published package is unaffected.
- Bounded iteration: keep to the round caps, give experiments a single round, and keep a
  release's scope fixed once it is planned. Don't start open-ended loops.
- Releases go through Changesets. Merging the Version Packages PR makes CI
  stage a publish, which the owner approves on npmjs.com (D27/D28). Never
  publish from a machine.

## A new machine

Run `node scripts/doctor.mjs`, fix what it reports, then
`node scripts/doctor.mjs --setup` to create that machine's device pairs and
`~/.nitro-ui/devices.json`. Set `NITRO_UI_MACHINE_LABEL` (for example
`maintainer-mac-2`). Committed bench baselines are per machine. A machine
without its own baselines can't use another machine's for regression gates, so
mint them there (`--exclusive`, idle machine, overnight).
