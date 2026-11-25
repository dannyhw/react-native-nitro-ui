# X71 — a fresh launch waits until the activity manager has let the closed app go

**Kind:** tooling · **Devices:** android · **Budget:** 1.5 h for round one (X64)

## Goal

On a slow Android emulator, a test's fresh launch no longer fails with the driver's
"remained foreground after close".

## Why

Hosted runs 45518273041 (job 3) and 45696813933 (job 2) failed the run's first test that way.
The second kept the device's event log. The suite's stop force-stopped the app at 20:50:12.44
and the launcher was resumed by 12.68, so the out-of-front wait returned. But the window
manager's close transition for the app's task was only sent at 15.36, focus entered the
launcher at 15.37, and the app's activity record was removed at 15.41. The driver's open
started at 14.49. Its close polls the foreground app for 2 s from `dumpsys window windows`,
then `dumpsys window`, then `dumpsys activity activities` (markers `mCurrentFocus=Window{`,
`mFocusedApp=AppWindowToken{`, `mResumedActivity:`, `ResumedActivity:`), and it saw the app.

## Behaviour

1. After a stop, the out-of-front wait also waits until `dumpsys activity activities` lists no
   activity record of the app, and names any record left at its deadline.
2. The 30 s deadline and the other two conditions do not change.

## Proof

- Unit tests over a record that outlives the focus move, shown red without the new condition.
- A real `dumpsys activity activities` from the API 35 emulator, before and after a stop, read
  by the new parser.
- `node scripts/gate.mjs real-input:android -- --control bottom-sheet` passes.

## Out of scope

The driver itself, and the Form keyboard locator failure.
