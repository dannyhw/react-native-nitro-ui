# T16 — Spike: shared `<Host>` on Android (Switch only)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T16` (branch `task/T16-host-spike`, from `main`).
**Devices / env:** assigned in the delegation message.
**Round cap (D19): one round, no fix rounds.** This is a spike: the code stays on its branch; only
the report is merged (like T13). It answers one question with data.

## Question

Does an opt-in shared container — every nitro-ui control inside it rendered in **one** Compose
composition / one `AbstractComposeView`, Expo's shared-host shape — match or beat
`expo-ui-shared-host` on mount `presented`, mount UI CPU and memory (D15) at N=50 Switches on
Android? Background: `docs/tasks/T12-android-perf.report.md` §P2f (the residual is one Composition +
one `AndroidComposeView` owner + native view tree per control) and
`docs/tasks/T13-compose-view-context.report.md` (owner services are already shared per window).

## Scope

1. **Read how Expo does it first**: `@expo/ui`'s Android `Host` and how its children's composables
   are rendered inside the host's composition (reference clone `repos/expo_expo`,
   `packages/expo-ui/android`; read-only, don't run its scripts). Summarise the mechanism in the
   report (what stays per child: Fabric node? `View`? state object?).
2. **Build the minimum**: an Android `Host` Hybrid View (JS `<Host>` component) whose `Switch`
   children render inside the Host's single composition instead of creating their own
   `NitroComposeHost`. Switch outside a Host must keep working exactly as today. Lay the children
   out the same way the `expo-ui-shared-host` bench arm does, so the comparison is like for like.
   Events and the controlled-value handshake must work for a Switch inside a Host. iOS: not built;
   `<Host>` may be a passthrough there.
3. **Bench**: add a `nitro-ui-host` arm to the Switch mount and update scenarios (N=50; N=200 too if
   it costs nothing extra), and run one quick plan on Android with ART primed to `speed-profile`
   (D18), all arms in the same run: `nitro-ui`, `nitro-ui-host`, `expo-ui-shared-host`,
   `expo-ui-host-per-control`, `rn-core`. Another task may be using the machine: check `uptime`
   first; if load1 > 8, wait in 5-minute steps for at most 30 minutes, then run once regardless and
   label the load. One run only (a second only if the runner rejects the first as broken).
4. **Minimum correctness evidence**: a real tap toggles a Switch inside a Host (real-input runner
   or a screenshot pair), the existing Android Switch harness suite still green, `bun run check`
   green.

## Report (the deliverable)

- Ratio table: `nitro-ui-host` and `nitro-ui` vs `expo-ui-shared-host` (and vs per-control /
  rn-core), mount presented / UI CPU / memory and update UI CPU, with load and the runner's verdict
  labels — no "n/v" upgraded to a pass.
- Plain answer: does a Host match/beat Expo's shared host on Android, per metric?
- Where the remaining cost goes, if it still misses (what is still per child).
- What a Host costs as a product: what a control inside it can't do (interleaving with RN views,
  RN `ScrollView`, ancestor clip/transform, `Modal`), what happens to T11 intrinsic sizing / D17,
  recycling, accessibility order; lines of code added; what every other component would need.
- Estimate (not build) for iOS: one `UIHostingController` with N SwiftUI children — expected effect
  on the iOS memory misses (Slider, Button, Progress).
- Recommendation for 0.2: ship an opt-in `<Host>` or not, and the API shape if yes.
