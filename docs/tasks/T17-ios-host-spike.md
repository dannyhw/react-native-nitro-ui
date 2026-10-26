# T17 — Spike: shared `<Host>` on iOS (Switch + Slider)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T17` (branch `task/T17-ios-host-spike`, from `main`).
**Devices / env:** assigned in the delegation message (bench on the canonical iPhone 17).
**Round cap (D19): one round, no fix rounds.** Spike: code stays on its branch, only the report merges.
Do not push. CI stays off.

## Question

Does an opt-in shared `<Host>` on iOS — every nitro-ui control inside it rendered as SwiftUI children
of **one** hosting controller, the iOS twin of T16's Android Host — beat nitro-ui without a Host, and
match or beat `expo-ui-shared-host`, on mount memory (N=200), mount UI CPU/op, `presented` and
`mounted` (D15)? The human's rule (D23): if the Host is better, nitro-ui ships it.

Background: `docs/tasks/P1-ios-mount-profile.report.md` (iOS mount cost is the synchronous T11 first
measure; the per-instance bytes are host-attributable: ~80 % default heap + ~12–17 % AttributeGraph),
`docs/tasks/T16-host-spike.report.md` (the Android Host and its API, bench arm and contract —
read its code on branch `task/T16-host-spike`, `b93b41b`).

## Scope

1. **Read first:** how `@expo/ui`'s iOS `Host` renders its children inside one SwiftUI hierarchy
   (reference clone `repos/expo_expo`, `packages/expo-ui/ios`; read-only). Summarise what stays per
   child (Fabric node? UIView? ObservableObject?).
2. **Public-API check (P1 caveat):** is there a public `UIHostingView` (or other non-controller
   SwiftUI hosting type) in the iOS 18+/27 SDK? Answer from the SDK headers/swiftinterface, not from
   memory. One paragraph; don't build on it.
3. **Build the minimum:** an iOS `Host` (same JS `<Host>` and `HostProps extends ViewProps` as T16)
   whose `Switch` and `Slider` children render inside the Host's single hosting controller instead of
   creating their own `NitroSwiftUIHost`. Outside a Host both controls behave exactly as today.
   Lay children out the way the `expo-ui-shared-host` iOS bench arm does (like for like). Events and
   the controlled-value handshake must work inside the Host. Say what happens to T11 sizing / D17 for
   a hosted child. Android: untouched (T16's branch is the Android side; don't merge it).
4. **Bench:** add a `nitro-ui-host` arm on iOS for Switch and Slider (mount N=50, memory N=200,
   update). One `quick` plan run on iPhone 17, all arms in the same run: `nitro-ui`, `nitro-ui-host`,
   `expo-ui-shared-host`, `expo-ui-host-per-control`, `rn-core`. Check `uptime` first; if load1 > 7,
   wait in 5-minute steps for at most 30 minutes, then run once regardless and label the load. One
   run (a second only if the runner rejects the first as broken).
5. **Minimum correctness:** a real tap toggles a hosted Switch and a drag moves a hosted Slider
   (real-input runner or screenshot pair); existing iOS Switch + Slider harness suites green;
   `bun run check` green.

## Report (the deliverable) — `docs/tasks/T17-ios-host-spike.report.md`

- Ratio table: `nitro-ui-host` and `nitro-ui` vs `expo-ui-shared-host` (and vs per-control / rn-core),
  per component: mount presented / mounted / UI CPU/op / JS CPU/op / memory, update UI CPU, with load
  and the runner's verdict labels — no "n/v" upgraded to a pass.
- Plain answer per metric: is the Host **better than nitro-ui without it**, and does it match/beat
  Expo's shared host? Plus `vmmap -summary` per-instance bytes at N=200 (as P1 §5) for both arms.
- What is still per child, if it misses.
- Product cost on iOS (same list as T16: interleaving with RN views, `ScrollView`, clip/transform,
  `Modal`, sizing/D17, accessibility order), lines of code, what the other components would need.
- Recommendation: ship iOS `<Host>` in 0.2 (H3) or not, with the same API as Android.
