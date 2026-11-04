# X19 — An example-app navigation that scales with the component count

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. **Round cap:** 1 round, plus at
most 1 fix round. **Devices:** your lease on this machine (`lease.mjs acquire --task X19 --boot`). No `--exclusive`.

## Why

The example app's tab bar holds 16 tabs; on Android each is about 23 × 28 dp (G16 merge report: `tab-picker` was
61 × 74 px on a 1080 px screen), under the 48 dp touch target, and every new component (SearchField, Tooltip next)
shrinks them further. It did not cause G16's failures (those tracked load), but it is a real accessibility and
reliability debt in the app every harness and real-input run drives.

## Workspace on this machine

Your own worktree from `origin/main` on branch `task/X19-example-tab-bar`; `bun install`. The project checkout is the
owner's working copy: don't edit it, switch its branch, stash, reset or clean it. Push only your branch (never
`main`, tags or force; no PR).

## Do

1. Make the example app's navigation scale: every tab target at least 48 dp (Android) / 44 pt (iOS) at any component
   count — e.g. a horizontally scrolling tab bar whose items keep their natural width, or another shape that holds.
2. Make every navigator the harness and real-input use (tab taps by name, `screens.mjs`, the a11y sweep, Storybook
   screenshots if they navigate) reliable with it: scroll a tab into view before tapping, or navigate by a stable test
   hook. Same on both platforms.
3. A check that fails when a tab target is under the minimum (harness or real-input), shown red on the old tab bar.
4. The registry/codegen that generates the tabs keeps working as components are added (the next ones are SearchField
   and Tooltip).

## Gates

All five (`check`, both `harness:*`, both `real-input:*`), then `need --for review`. Report at
`docs/tasks/X19-example-tab-bar.report.md`, ledger exported, branch pushed.
