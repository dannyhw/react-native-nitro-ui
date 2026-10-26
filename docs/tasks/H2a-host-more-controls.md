# H2a — Android `<Host>` for Slider, Progress, Button (+ N4)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/H2a` (branch `task/H2a-host-more-controls`, from
`main`). **Devices / env:** assigned in the delegation message. **Round cap (D19):** 1 + 2 fix
rounds. Do not push. CI stays off. Stay inside this list.

H1 shipped `<Host>` for Switch (`docs/tasks/H1-android-host.report.md`, its re-review, D24,
`docs/components/host.md`). H2 is split: **H2a** = Slider, Progress, Button; **H2b** (later) =
SegmentedControl, Picker, DatePicker (popups/dialogs). iOS stays a passthrough (D23 outcome).

1. **Make Slider, Progress and Button hostable**: `isHostable` true on their hosts, added to the JS
   `HOSTABLE_CONTROLS` table and removed from the refused list, following exactly what Switch does.
   Anything control-specific a hosted child needs (Slider drag gestures inside one shared
   composition, indeterminate Progress animation, Button press feedback / `onPress`) is handled and
   tested. SegmentedControl / Picker / DatePicker stay refused.
2. **D24 per control**: what `fillWidth` (Slider, linear Progress) and intrinsic (Button, circular
   Progress) mean inside a Host's `Column` — state it in `docs/architecture/sizing.md` /
   `host.md`, and prove it with harness cases (box widths inside a Host).
3. **N4** (H1 re-review): hosted children still arm a lifecycle observer and a first-frame pre-draw
   listener for a composition they never build. Stop arming them for hosted children without
   changing unhosted behaviour (B1's `strategyArmed` / `drop()` / `PreDrawWatch` contract); show the
   churn gate and the unhosted suites stay green.
4. **H1 follow-ups that touch the same code** (from `docs/tasks/FOLLOWUPS.md`, H1 line): S2 test
   with a value change while `display: 'none'`; F8 assert a hosted child's box after a later Fabric
   layout and correct the `testID` caveat; the dev style warning must not flag `alignSelf`;
   document that `borderWidth` insets the drawing; the bench comment about the `nitro-ui-host` arm
   being gated; leftover "T16 spike" wording in Kotlin headers.
5. **Correctness per control inside a Host**: events + controlled handshake (JS write, user input,
   rejected change snaps back), `disabled`, add/remove/reorder mixed children (Switch + Slider +
   Button + Progress in one Host), Host unmount churn with mixed children, TalkBack order/labels.
   Real-input: a real tap on a hosted Button fires `onPress`; a real drag moves a hosted Slider.
6. **Bench**: extend the `nitro-ui-host` arm to Slider, Progress, Button (the arm must still refuse
   the three not yet hostable). One `quick` plan on your AVD, ART `speed-profile` (D18), all arms.
   Check `uptime` first; if load1 > 7 wait in 5-minute steps up to 30 min, then once regardless,
   labelled. Update README Performance / host.md with the measured per-control rows, JS cost
   included.
7. **Docs/stories/example**: host.md's supported list, the `HostProps` doc comment, the Storybook
   Host story and the example Host screen show the mixed case.

Gates: `bun run check`; Android harness full suite; iOS harness full suite (fresh build, verify the
binary); real-input both. Report in `docs/tasks/H2a-host-more-controls.report.md` per AGENTS.md
with hosted vs unhosted vs `expo-ui-shared-host` per control.
