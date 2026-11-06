# S5 — Popover spike (React Native content)

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. **Round cap:** 1 round, no fix
rounds (D19's spike rule). **Devices:** your lease on this machine (`lease.mjs acquire --task S5 --boot`). Don't use
`--exclusive`; the owner may be using the machine.

## Workspace on this machine

- The project checkout here is the owner's own working copy. Don't edit it, switch its branch, stash, reset or
  clean it.
- Make your own worktree from `origin/main` on branch `task/S5-popover-spike`, and run `bun install` there.
- Push only that branch: never `main`, tags or force, and don't open a PR. The prototype is never merged; only the
  report and ledger are, separately.

## Read first

- AGENTS.md.
- `docs/DECISIONS.md` D35, D38 (item 1: a platform without the control builds from its real controls) and D41 (Tooltip
  presents from its own window on iOS, and why D35's chain was not used).
- `docs/tasks/Q7-next-components-2.report.md`, especially Appendix C (Tooltip's anchor, the iOS popover) and
  **Appendix F** (Popover: the shape, the mechanism and the five spike questions).
- `docs/components/bottom-sheet.md` and the BottomSheet source for presented React Native content: the
  presented-container shadow node, the iOS content-children patch and `RCTSurfaceTouchHandler`, and the Android
  `ViewGroupManager` root with `JSTouchDispatcher`.
- The Tooltip source and the G18 report (its merge round included) for the anchor and the popover presentation on iOS.
  On Android, note that material3 1.5's `TooltipBox` re-creates its content once the anchor is placed.

## Do

Build the minimal prototype Appendix F describes: `<Popover isPresented onIsPresentedChange anchor={…}>children
</Popover>` on both platforms, with no registry, docs, README or bench.

- **iOS:** a `UIViewController` holding the children, presented `.popover` with `.none` adaptation, from its own window
  as Tooltip does (D41).
- **Android:** a Compose `Popup` holding an M3 `Surface` that contains the React Native root through `AndroidView`.

Answer the five questions with the evidence Appendix F asks for:

| # | Question | Evidence |
| --- | --- | --- |
| 1 | Two-axis `fit`: the first frame shows at its final size | Counts out of 10; frame-by-frame captures or the first-frame size against the final one |
| 2 | An RN `Pressable` inside the popup takes a real tap exactly once | Counts out of 10, by real input |
| 3 | A `TextInput` in the popup brings up the keyboard, and the popup moves above it or is covered | Screenshots |
| 4 | It presents over an RN `Modal`, and when nested, closes cleanly, never stranding the Modal | Real input |
| 5 | Lifetime: 50 present/dismiss cycles, a drop during the entry transition, and a recycle while open each leave `live=0`; no `LifecycleRegistry` growth on Android | Counts |

Questions 1, 2 and 5 on both platforms decide GO; 3 and 4 inform the build's scope.

Real touches: use the real-input tooling (XCUITest on iOS; on Android the lease's adb, by serial). adb on your own
leased emulator is approved for app launch, taps and screenshots, always with `-s <serial>`. Undo any `adb reverse` and
debug-host preference you set, and restore any setting you change (read its value first). Never touch `emulator-5560`.
Never `pkill`/`killall`; kill only PIDs you started.

## Output

`docs/tasks/S5-popover-spike.report.md` must contain:
- a table of the five questions with **met / not met / unmeasurable** and the evidence;
- an explicit **GO / NO-GO** for the build;
- what the build must change from Appendix F's design;
- the API you'd ship (props, `T | null`, events and the handshake);
- "Questions for orchestrator".

Commit the report and the exported ledger (`gate.mjs export --task S5`) on your branch and push it.

## Gates

`check` on your branch. Record every measurement run in the ledger (harness filters or `gate.mjs` runs) so the
numbers are traceable.
