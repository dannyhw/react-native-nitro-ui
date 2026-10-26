# H2b — Android `<Host>` for SegmentedControl, Picker, DatePicker

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/H2b` (branch `task/H2b-host-popups`, from
`main`). **Devices:** take a lease — `node scripts/lease.mjs acquire --task H2b --platform both
--wait-minutes 60` — and release it when your gates are done; never use a device you did not lease.
**Round cap (D19):** 1 + 2 fix rounds. Do not push. Stay inside this list.

H1 (Switch) and H2a (Slider, Progress, Button) are merged; read `docs/components/host.md`, D24 and
H2a's report (its question 1 is answered here). iOS stays a passthrough (D23 outcome).

**Answer to H2a's question 1.** A Host is meant to host a window owner. A Compose `Popup`, an
`ExposedDropdownMenu` or a `Dialog` opened from the Host's shared composition is a window that
belongs to that composition's `AndroidComposeView`. That is the same thing that happens when a
hosted child opens one in a single-control composition today, and it is what Expo UI's Host
does. "A popup owns a window, a Host owns a rectangle" is not a reason to refuse. A control is
refused only if this task shows a concrete hosted failure that cannot be fixed. If that happens,
the refusal is loud: it throws in dev and sends a `console.error` in release. Writing the refusal
up is part of the deliverable.

1. **SegmentedControl** has no popup. Make it hostable exactly the way H2a made its three controls
   hostable (`isHostable`, `HOSTABLE_CONTROLS`, remove it from the refused list). Cover D24 sizing,
   the controlled handshake, `disabled`, and TalkBack.
2. **Picker** (`ExposedDropdownMenuBox`) hosted:
   - the menu anchors under the hosted anchor's box, including when the Host is scrolled or not
     at the top of the screen;
   - outside tap, back and a pick each close it, and the controlled handshake holds;
   - changing the list while it is open;
   - disabling it while open;
   - removing the child, reordering it, or dropping the Host (`onDropView`) while the menu is open
     leaves no window behind;
   - TalkBack reaches the rows.
3. **DatePicker** (each Android dialog presentation it has) hosted. Cover the same open,
   dismiss, remove, drop and a11y cases as the Picker. Also cover the G5 follow-ups that touch the
   same path: an open dialog not following a programmatic value, and disabling while open. Fix
   them if the fix is local; otherwise record them.
4. **Two popup owners in one Host:** a Picker and a DatePicker in the same Host, opened one after
   the other. Neither may stay stuck open. Add this to the mixed add/remove/reorder/churn cases
   from H2a, which now use all seven controls.
5. **Real-input:** a real tap opens a hosted Picker and picks a row, and a real tap on a hosted
   SegmentedControl segment changes the value. If the harness can't drive a DatePicker dialog
   reliably, say so; don't fake it.
6. **Bench:** extend the `nitro-ui-host` arm to all seven controls. Run one `quick` plan with ART
   `speed-profile`. The machine is shared, so numbers are indicative. Record load the way R4 does,
   label the run, and don't wait for a quiet machine. A quiet re-run is a separate follow-up.
7. **Docs, stories, example:**
   - `host.md` supported list, popup section and the "No `Modal`" wording (a Compose popup is
     fine; an RN `Modal` child still is not);
   - the `HostProps` doc;
   - the README Performance rows;
   - the Storybook Host story and the example Host screen show all seven controls.
8. **Changeset:** `minor` (the user-visible change is that `<Host>` accepts three more controls).

Gates: `bun run check`, Android harness full suite, iOS harness full suite (fresh build, binary
verified, because the JS tables are shared), and real-input on both. Use `scripts/build-app.mjs` /
stamps as AGENTS.md says. Write the report to `docs/tasks/H2b-host-popups.report.md` per
AGENTS.md, with hosted vs unhosted vs `expo-ui-shared-host` per control.
