# H1 — Android `<Host>` productionised (Switch)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/H1` (branch `task/H1-android-host`, from `main`).
**Devices / env:** assigned in the delegation message. **Round cap (D19):** 1 + 2 fix rounds.
Do not push. CI stays off. Stay inside this list.

Background: `docs/tasks/T16-host-spike.report.md` (mechanism, product cost, recommendation, API) —
its code is on branch `task/T16-host-spike` (`5601f61`); start from it (cherry-pick / port onto
current main, which now has DatePicker and Picker), don't rewrite it. D23: the Host is opt-in on both
platforms and ships where it is better. iOS is a separate spike (T17); on iOS `<Host>` stays a
documented passthrough `View` in this task.

1. **Port T16's Host onto main** for Switch: `Host` / `HostProps extends ViewProps` exported, the
   Android `NitroUiHost` container, hosted mode in `NitroComposeHost`. Direct nitro-ui children only.
   A non-Switch nitro-ui child or a plain RN child inside a Host must fail loudly in dev
   (clear error naming the child), not render silently wrong. Outside a Host nothing changes.
2. **D17 rule for hosted controls (write it into `docs/DECISIONS.md` as D24 and
   `docs/architecture/sizing.md`):** what a hosted child's box is (the Host lays out its children
   in a `Column` like Expo; the Host itself is sized by RN style, or by its content's measured
   height if it has no height — decide and test), what `fillWidth` means inside a Host, and that
   hosted children report no per-child size to the T11 engine. Harness cases prove the rule.
3. **Correctness:** events and the controlled-value handshake inside a Host (JS write, user tap,
   rejected change snaps back); add/remove/reorder children; Host unmount (no leak — extend
   `MountChurn.harness.tsx` with a hosted cycle); `disabled`, `testID` (harness can find a hosted
   child) and accessibility: TalkBack order of hosted siblings vs surrounding RN views (T16
   follow-up 3), each hosted Switch focusable with its label. Real-input: a real tap toggles a
   hosted Switch.
4. **Bench:** keep the `nitro-ui-host` arm (Switch only; the arm must refuse other components as
   T16 does). One `quick` plan run on your AVD, ART `speed-profile` (D18), all arms. Check `uptime`
   first; if load1 > 7 wait in 5-minute steps up to 30 min, then run once and label the load.
5. **Docs/example:** `docs/components/host.md` (what it is, when to use it, the unsupported list —
   RN views, `ScrollView` inside, clip/transform per child, `Modal`, sizing — in the `HostProps`
   doc comment too), README Performance gets the Host row (win and the JS-thread cost, T16
   condition 3), a Storybook story (`Host` with N Switches, hosted vs not), and replace T16's spike
   `HostScreen` with a proper example screen (keep the tab row usable — it is at seven tabs).

Gates: `bun run check`; Android harness full suite (all components) green; iOS harness full suite
green (Host passthrough must not break iOS); real-input green both; the bench run labelled.
Report per AGENTS.md in `docs/tasks/H1-android-host.report.md`, with the ratio table vs
`expo-ui-shared-host` and vs `nitro-ui` without a Host.
