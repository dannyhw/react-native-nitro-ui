# X13 — The release's Podfile.lock refresh churns every pod on the CI runner

**Worktree / branch:** named in your delegation message (from `main`). **Round cap:** 1 implementation
round plus at most 2 fix rounds (D19). No devices. No pushes: you can't run CI, so everything here
is reproduced locally.

## What happened

Release run `40789293108` (job "Version Packages pull request", 2026-10-28) failed in
`release:version`.
- X9's lock refresh (`scripts/sync-example-lock.mjs --fix` via `scripts/pod-install.mjs`) ran a real
  `pod install` on the macOS runner after `changeset version` bumped `package.json` to 0.3.2.
- The resulting `example/ios/Podfile.lock` changed the `SPEC CHECKSUMS` of nearly every pod
  (React-Core, RCT-Folly, NitroModules, RNReanimated, …), not just `NitroUi`.
- X9's churn guard refused it: "changed beyond NitroUi's version line".

The same lock is stable on both maintainer Macs. Nothing was published, but no Version Packages PR
can be opened until this is fixed. Read the run with
`gh run view 40789293108 --log-failed` (read-only). The `+ <Pod>: <sha1>` lines are the runner's
checksums.

## Do

1. **Root cause, reproduced locally.** In a scratch copy of the example app (a temp worktree or
   directory, never the main checkout), run `pod install` under candidate environment differences
   until one produces the runner's checksums: at least `React-Core f9dd5e5a…`,
   `RCT-Folly d173e541…` and `NitroModules 57c6bdff…`. Candidates include:
   - `CI` (`true` on Actions; `pod-install.mjs` defaults it to `1`);
   - the React Native prebuild variables (`RCT_USE_RN_DEP`, `RCT_USE_PREBUILT_RNCORE`);
   - `RCT_NEW_ARCH_ENABLED`, `USE_FRAMEWORKS`, `NODE_BINARY`;
   - the Xcode and Ruby versions (the runner's are in the job log);
   - the checkout path.

   State which variable(s) change a pod's evaluated podspec, and why: name the podspec line.
2. **Fix it so CI writes the same lock as a maintainer Mac.**
   - Prefer pinning the environment in `.github/workflows/release.yml`'s version job and/or
     `pod-install.mjs`, so CI and local runs agree by construction. Document every pinned variable
     at the point of use.
   - If the difference can't be removed (for example an Xcode-dependent flag), say so, and propose
     the narrowest correct alternative. One such alternative is splicing only `NitroUi`'s two lines
     from the runner's lock into the committed lock. That's only acceptable if you show `NitroUi`'s
     own checksum is environment-independent; otherwise local builds would rewrite it.
   - Stop and ask (Questions) before weakening the churn guard.
3. **Proof without pushing:**
   - a local reproduction of the runner's churn with the offending environment;
   - a run with the fix that leaves only the `NitroUi` lines changed after a version bump to 0.3.2
     (in your scratch copy);
   - a unit test for any environment pinning in `pod-install.mjs`, shown red.

## Gates

`check`, then `need --for review`. Report: `docs/tasks/X13-release-lock-refresh.report.md`, with the
ledger exported. Commit after each item. Don't push. Git only through `git -C <your worktree>`.
