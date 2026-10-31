# A6 — maintainer-mac-1's Menu baseline cells (first task run on a linked machine)

**Machine:** maintainer-mac-1. This task runs there, delegated from maintainer-mac-2 through a T3 linked
environment. **Round cap:** 1 round, plus at most 2 fix rounds (D19). **Devices:** your lease on this machine, with
`--exclusive` for each mint.

## Workspace on this machine (read before anything else)

- The project checkout here is the owner's own working copy. **Do not edit it, switch its branch, stash, reset or
  clean it.** Read it only to find the repo.
- Make your own worktree from the latest `origin/main`:
  `git -C <checkout> fetch origin && git -C <checkout> worktree add -b task/A6-mac1-menu-cells <checkout>/../nitro-ui-worktrees/A6 origin/main`,
  then `bun install` there. Do all your work in that worktree.
- **One push exception, approved by the owner for this machine only:** you may run
  `git push origin task/A6-mac1-menu-cells`. Never push `main`, any tag or any other branch, and never force-push.
  Don't open a PR; the orchestrator on maintainer-mac-2 fetches the branch and merges it.
- Everything else in AGENTS.md applies: devices only through `scripts/lease.mjs`, never a device you didn't
  lease, never `pkill`/`killall` by name, and address Android by serial. If this machine has a human-owned
  emulator or simulator, leave it alone.
- Touch no other project on this machine.

## Why

X14 made it possible to add one component's cells to a committed baseline, and maintainer-mac-2 has added Menu on
both platforms. `bench/baselines/maintainer-mac-1/{ios27-sim-iphone17,android35-emu-pixel9}.json` still has no
Menu, so Menu's bench gate measures nothing on this machine. Only this machine can mint those cells.

## Do

1. **Pre-flight.**
   - Run `node scripts/doctor.mjs`.
   - Run `node scripts/lease.mjs list`, and say what else is using this machine's devices.
   - If doctor fails, or the pool isn't set up, STOP and report. Don't run `doctor --setup` without asking: it
     creates devices on someone else's machine.
2. **Mint Menu into each of this machine's two files.** Follow CONTRIBUTING "Adding a component to a committed
   baseline", with `NITRO_UI_MACHINE_LABEL=maintainer-mac-1`.
   - Run `--dry-run` first, for each platform.
   - Settle the machine before each mint (A3 brief, item 2b).
   - Acquire the lease with `--exclusive` for each mint, and release it after.
   - Commit each platform's baseline change on its own. Its diff must show only `menu` cells plus the bookkeeping
     CONTRIBUTING lists. This is the first merge into these pre-X14 files, so expect the schema 2 → 3 bump.
   - Run the `--check` read-back for each.
3. **If a refusal fires, STOP and report it with the field and both values.** That covers comparability (Xcode,
   runtime, API/ART, RN, @expo/ui, device key or CPU differing from what the file was founded on), load, a dirty
   tree and the rest. Don't work around it and never `--force`. A comparability break means a full re-mint, which
   is the owner's call.
4. **Run `node scripts/gate.mjs check`, then push the task branch** (the exception above).

## Report

Write `docs/tasks/A6-mac1-menu-cells.report.md` and export the gate ledger. The report must include:
- each platform's bench table, with load stamps, the number of launches and the wall time;
- a **"Linked-machine notes"** section. This is the first task run through a T3 link, and its access level is
  `auto`, not full access. Did any command need an approval, hit a sandbox denial, or fail for lack of
  permissions (xcodebuild, simctl, emulator, gradle, the lease's file locks, `git push`)? What did you have to work
  around? How long did setup take?

Your final message: the branch, its pushed SHA, the two bench summaries and the linked-machine notes.

## Not in scope

Any other component, any re-mint, and anything in maintainer-mac-2's files.

## Gates

`check`. Benches are never required by `need`; the bench tables are the evidence.
