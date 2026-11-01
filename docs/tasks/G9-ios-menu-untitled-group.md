# G9 — iOS Menu drops an untitled destructive group

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. maintainer-mac-2's iOS simulators
can't launch apps until it restarts. **Round cap:** 1 round, plus at most 2 fix rounds (D19). **Devices:** your lease
on this machine (`lease.mjs acquire --task G9 --boot`). Don't use `--exclusive`: the owner may be using the machine.

## Workspace on this machine

- The project checkout here is the owner's own working copy. Don't edit it, switch its branch, stash, reset or
  clean it.
- Make your own worktree from `origin/main` on branch `task/G9-ios-menu-untitled-group`, and run `bun install` there.
- Push only that branch (an owner-approved exception): never `main`, tags or any other branch, and never
  force-push. Don't open a PR; the orchestrator does that.
- Everything else in AGENTS.md applies. Touch no other project on this machine.

## The bug

PR #11's screenshots show it. In the example's Storybook, under Menu → Item Lists, the iOS File menu omits the untitled
destructive "Delete" group, while Android shows it. See `docs/images/components/menu-ios.png` and
`menu-android.png`, and the FOLLOWUPS line "iOS `Menu`, Item Lists story".

## Do

1. Reproduce it on the iOS simulator. Find whether the group is dropped in our model, in the props-to-SwiftUI
   mapping (`ios/components/Menu/`), or by SwiftUI itself (e.g. a `Section` with no header and a destructive
   role).
2. Fix it so iOS shows every group the props describe, with the same items and roles as Android, and keep
   Android's behaviour unchanged.
3. Add a harness test that fails today: assert that every item of an untitled group is present in the menu's
   read-out on iOS. Show it red on `origin/main`.
4. Add a patch changeset if apps can see the change.
5. Re-take `docs/images/components/menu-ios.png` the way PR #11 did (light appearance, cropped to the story
   content), if the fix changes it.
6. Remove the FOLLOWUPS line and point it at your report.

## Gates

`check`, `harness:ios` and `real-input:ios`. This Mac can run them.
- If `harness:android` can run here too, run it, because the harness file changes. If it can't, say so; the
  orchestrator runs Android on maintainer-mac-2.
- Then `need --for review`.
- Report at `docs/tasks/G9-ios-menu-untitled-group.report.md`, with the ledger exported.
