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
   "Confirm" is sometimes a look, not a re-run (X10): `need --for merge` accepts
   a `check` that passed on an **identical code tree**, provided that line's
   commit is an ancestor of the merged `HEAD` (`git merge-base --is-ancestor`)
   *and* every path the merge adds beyond that commit is on a small allowlist of
   files no `check` step reads — which today is `docs/**`, minus
   `docs/tasks/*/gates.jsonl`. The allowlist is load-bearing and is proved, not
   asserted: `scripts/check-docs-drift.mjs` asks each of the sixteen steps what
   it reads (its own script graph, the jest run's real `--listTests` graph, and
   prettier/eslint's own ignore answers) and fails `bun run check` if anything
   under `docs/` turns out to be read. The code tree digest deliberately excludes
   `docs/`, `bench/`, `.github/` and every `*.md`, so without that second
   condition a merge that brought in a `bench/` change would reuse a `check` that
   never saw it (X10 review M1). Read together: a merge of **only task docs and
   reports** reuses; one that brought in `bench/`, a README or a CI change does
   not, and the run is owed.
   Two sources are consulted, and the note says which: the other branches'
   `.gates/*.jsonl` in *this* checkout, and any `docs/tasks/<ID>/gates.jsonl`
   committed by `gate.mjs export`. In practice the first is the useful one and
   the second is refused: a task's export is written *after* the `check` line it
   carries, so the merge that brings the export also adds a file `check` reads
   (`gate.mjs` lists `docs/tasks` and opens each ledger), and the rule refuses —
   correctly, because a ledger that arrives with a merge cannot certify that
   merge. So the first merge of a task from its worktree confirms `check` by
   running it; a merge in a checkout that already holds the branch's `.gates/`
   line, or a docs-only merge on top of a confirmed tree, does not.
   The line is marked `PASS (reused)` in `gate.mjs table` with the branch and the
   file named, so the borrow is visible rather than implied. A **squash** merge
   is refused even though the code matches, because the commit the line names is
   not in this history. The newest line on the tree wins across every ledger, and
   a newer **fail** refuses reuse over an older pass (M2). What reuse does *not*
   prove: a ledger line is self-attested text — ancestry ties it to history, and
   tree equality to content, but nothing in git signs the line itself, so a
   determined author could write a green row for a tree they never checked. The
   digest is easy to compute; treat a borrowed row as a shortcut for an honest
   run, not as a substitute for one you would not have run. `check` only: a
   device gate is evidence about a binary built on a particular machine and
   lease, and a review round is evidence about its own diff. `--no-reuse` asks
   the strict question when you do not want to take the rule's word for it.

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
