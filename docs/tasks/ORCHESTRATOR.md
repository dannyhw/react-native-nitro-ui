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
3. On the report: check it ran `bun run task-ready` (X4) and paste the line it prints.
   A round that fails it goes back to the same implementer thread **before** a review
   starts — the command reports what a reviewer's first pass used to find (a stale gate
   table, a citation to a file that is not in the tree, a manifest with no conformance
   coverage), and paying a review round for that is the 44 % this task exists to spend
   elsewhere. Then start a review. On FIX ROUND or MERGE WITH FIXES, send the
   M-list **to the same implementer thread**, which saves it re-reading the
   repo. Re-review after a round that changed native code.
4. Round cap (D19): 1 implementation round plus at most 2 fix rounds. Spikes
   get one round. After that, the orchestrator fixes small leftovers itself or
   records them in `FOLLOWUPS.md`.
5. Merge (`git merge --no-ff task/<ID>-…`), confirm `bun run check` on the
   merged tree, push, and update `STATUS.md` / `RECOVERY.md` in the same push.
   "Confirm" is sometimes a look, not a re-run (X10): `need --for merge` accepts
   a `check` whose recorded **`fullTree` equals the merge result's** — git's own
   `rev-parse HEAD^{tree}`, the whole tracked tree, `docs/` and `bench/` and every
   `*.md` included — provided that line was run with a **clean worktree**, its
   commit is an ancestor of the merged `HEAD` (`git merge-base --is-ancestor`),
   and this worktree is clean too. An equal tree hash means a run here would read
   the same bytes, which is the whole rule; there is no list of paths reuse is
   allowed to be blind to, because a hash has no blind spot. The cost is the
   honest one: **any** change since the checked tree — a report, a README, a
   rename — re-owns the 2½-minute run. An earlier version compared the *code*
   digest (which excludes `docs/`, `bench/`, `.github/` and `*.md`) and patched
   that gap with a `docs/**` allowlist plus a drift "proof", and a
   `bench/… → docs/…` rename still read as docs-only, because git reports only a
   rename's destination and no list is told about files that do not exist yet
   (X10 review M1/M2/M3). A dirty worktree disqualifies a line for reuse rather
   than for the other checks: the run saw the tree *plus* unrecorded edits, and
   only the commit's hash is written down, so it cannot say this tree was checked
   on its own.
   Two sources are consulted, and the note says which: the other branches'
   `.gates/*.jsonl` in *this* checkout, and any `docs/tasks/<ID>/gates.jsonl`
   committed by `gate.mjs export`. A committed export names the tree it was
   written on, so if the merge also brings the export commit, the trees differ and
   reuse declines — which is the right answer anyway: a ledger that arrives with
   a merge cannot certify that merge. So the first merge of a task from its
   worktree confirms `check` by running it; a merge in a checkout that already
   holds the branch's `.gates/` line for the tree that merge produces does not.
   The line is marked `PASS (reused)` in `gate.mjs table` with the branch and the
   file named, so the borrow is visible rather than implied. A **squash** merge
   is refused even though the tree matches, because the commit the line names is
   not in this history. The newest line on the tree wins across every ledger, and
   a newer **fail** refuses reuse over an older pass (M2); on an exact timestamp
   tie the fail is the decisive line. What reuse does *not* prove: a ledger line
   is self-attested text — ancestry ties it to history, and an equal tree hash to
   content, but nothing in git signs the line itself, so a determined author could
   write a green row for a tree they never checked. The hash is easy to compute;
   treat a borrowed row as a shortcut for an honest run, not as a substitute for
   one you would not have run. `check` only: a device gate is evidence about a
   binary built on a particular machine and lease, and a review round is evidence
   about its own diff. `--no-reuse` asks the strict question when you do not want
   to take the rule's word for it.

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
Commit on your branch, don't push. Commit with the repo's git config as it is:
never pass `-c user.name`/`-c user.email`, `--author`, or GIT_AUTHOR_*/
GIT_COMMITTER_* variables. End with a short version of the report and the
final SHA.
```

**Cleanup needs no archiving (X12).** Gate logs and the background-gate records live in the clone's
gate log store — `<git-common-dir>/nitro-ui-gates/<branch>/` — which `git worktree remove` does not
touch, so removing a merged worktree no longer loses the evidence a later diagnosis needs. Read them
from any surviving worktree with `node scripts/gate.mjs logs --all` (or `--branch <b> --failed` —
the branch is read from the log's whole path, and pass or fail from the store's own record, so both
work once the worktree and its ledger are gone); they are kept for 35 days, then capped at 64 MiB.
Each record also names the worktree that started the run, so `wait` and `status` follow *your*
background gate rather than the newest run of that gate somewhere else in the store — which matters
because several tasks run `check --background` at once. The per-branch ledger `.gates/<branch>.jsonl`
*is* removed with its worktree, so export it before cleanup (`gate.mjs export --task <ID>` commits
the ledger plus a scrubbed excerpt of each failed run under `docs/tasks/<ID>/failures/`; an excerpt
carries no home path and no credential). Deleting the *clone* deletes its store: archive a store only
when you are about to do that. The orchestrator's own scripts log under `~/.nitro-ui/orchestrator-logs/`,
not `/tmp`.

If an implementer's turn ends early (for example a tool call printed as text
instead of run), check its worktree and resume the same thread with what is and
isn't applied. Don't start a new session.

## Lessons from two machines (2026-10-28)

- A delegated run is done only when its final message carries the SHA **and** the report file
  exists. Apex turns sometimes end mid-step ("Now let me…"); check the worktree and resume the same
  thread with what is and isn't committed. Ask implementers to commit after each item.
- OpenCode Apex stopped early repeatedly (X3, X10, X12 here; F3 twice and T18 once on mac-1).
  Codex Apex (`codex_callstack`, `reasoningEffort: xhigh`) finished T18 and T18b in one run each.
  Prefer it where the provider is enabled.
- After each device run, read `node scripts/lease.mjs list`'s warnings: agents have released leases
  but left the iPhone simulator booted.
- Before merging tooling that behaves per platform (paths, temp dirs, CocoaPods, CI workflows),
  look at CI for the branch or push and watch `main`'s CI right after. X12's tests passed on macOS
  and failed on Linux CI; X9's release lock refresh churned every pod on the runner (X13).
- Tell reviewers to run `check` and tests in the **foreground**. An Opus reviewer ended its turn
  waiting on a background `check`.

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
- Commits use the repo's own `user.name`/`user.email`. An implementer once
  invented an author email that belonged to a stranger's GitHub account, and
  GitHub credited four merged commits to them. Before merging, check
  `git log --format='%ae' main..<branch> | sort -u` shows only the repo's email.
- Process and tooling changes must leave the published package byte-identical
  (`npm pack` file list = `etc/package-files.txt`, same contents).
- Process speed is a priority (owner's call): schedule tooling/process work alongside product
  work, not after it, as long as the published package is unaffected.
- Bounded iteration: keep to the round caps and give experiments a single round. Don't start
  open-ended loops. Releases have no timeline or fixed scope (D31): ship merged work when it's ready.
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
