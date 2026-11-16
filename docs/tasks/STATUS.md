# Status

What is open now and what merged in the last 14 days. Everything older is in `git log`. A line
under "In flight" is all that is needed to resume its task after a restart, and it is deleted when
the task merges. Open follow-ups are in `FOLLOWUPS.md`.

## In flight

Name · ID · branch · pull request · next action.

Nothing.

## Recently merged

Newest first: what changed for people using the library, then the task and its pull request. A
pull request number is left out where the records do not carry one.

- 11-16 Nothing user-visible: the Android real-input gate runs an e2e suite and then the
  `uiautomator` checks e2e cannot express, in 54 minutes in place of 72 (X35, X44, #84). The
  watchdog brings its own checkout up to date before it looks.
- 11-15 0.9.1 released (#74).
- 11-15 The package no longer ships a SwiftUI reference Form that only its own tests used;
  harness tests that measured or repeated another suite, and a closed probe, are removed (X37,
  #82). A second comment and documentation pass covers the tests, the example and bench apps and
  the contributor's manual.
- 11-15 Nothing user-visible: tooling and tests that nothing uses removed (W3, #77); the rest
  of the comment sweep (X40, #78); two unused lease-pool features removed (X38, #79); the bench
  compares against the last release in place of committed baselines (X36, #80); task records
  leave git at merge, and ledgers and task screenshots are no longer committed.
- 11-15 Nothing user-visible: short agent rules and skills, a worktree lister, an outside
  watchdog and a disk floor for device gates (W1, #75); one design document, failure logs no
  longer committed (W2, #76); component pages, upstream defects and
  architecture notes rewritten as current fact (X41, #81); a comment sweep over the sources
  (X40, part of #78).
- 11-15 Slider: Android screen-reader steps land on the value that was read out (X33, #72).
- 11-15 Nothing user-visible: gate runner and iOS real-input hygiene (X34, #73).
- 11-14 Form: a flick no longer presses an iOS row; Stepper screen-reader and default-value
  fixes; Checkbox reads a localised "mixed" (X32, #71).
- 11-13 Nothing user-visible: device gates matched per platform, four flaky checks (X30, X31,
  #69, #70).
- 11-12 0.9.0 released (#51), with release notes written for app developers (R09).
- 11-12 Form: iOS rows are laid out at their own cell's width (X29, #68).
- 11-12 Form: no crash when an iOS Form is recycled mid-update (X25, #67).
- 11-12 Picker `wheel` and the DatePicker time wheel are real wheels on Android (G29, #62).
- 11-12 Examples and README screenshots: the caption sits above each control (X27, #66).
- 11-11 ListItem, new (G30, #64). Stepper and Form examples lay out properly (X24).
- 11-11 Checkbox: SF Symbol checkmark styles on iOS, `iosStyle` (G31, #63).
- 11-11 Nothing user-visible: device leases first come, first served, and a device gate needs a
  live lease (X26, #65; X28).
- 11-10 ConfirmationDialog: Material 3 Expressive rows on Android (G28, #61).
- 11-10 SearchField: keyboard props (G27, #58).
- 11-10 Stepper, new (G25, #55). Picker `variant="radio"` (G26, #56).
- 11-10 A recycled Android Form starts at the top (X23, #60). iOS accessibility sweep settled
  (X22, #57, #59).
- 11-09 Form and Section, new (G24, #52). ButtonGroup, new (G20).
- 11-09 `androidIcon` on Menu and ContextMenu rows, the split button and Chip (G21).
- 11-08 IconButton, new (G23). Popover with React Native content, new (G22).
- 11-07 0.8.0 released (#40).
- 11-07 `androidIcon` from Metro assets or drawables, an Expo config plugin for drawables, and
  the `xlarge` and `xxlarge` sizes (G19).
- 11-07 Slider: a real drag start on Android (E5, #46). Progress: `variant="loading"` and
  `appearance="wavy"` (E4).
- 11-07 Android icons come from official Material Symbols files, which fixes the SearchField
  glyph (FIX4).
- 11-07 Nothing user-visible: four recurring device-gate flakes (X21); Form, List and Section
  research (Q10, #48).
- 11-06 0.7.0 released (#32).
- 11-06 SplitButton: Menu's `primaryAction` on Android (E3).
- 11-06 Expressive shapes and sizes for Button, SegmentedControl and Chip (E1, #39).
- 11-06 Menu, ContextMenu and Picker rows: grouped sections, `subtitle`, `checked` (E2, #38).
- 11-06 SearchField, new (G17, #37). Tooltip, new (G18, #36).
- 11-06 Nothing user-visible: a real-input false green and two lease fixes (X20).
- 11-05 React Native 0.88 is the floor; Material 3 Expressive is the default Android theme
  (X18, #34).
- 11-05 Example app only: a scrolling tab bar with full-size touch targets (X19, #35).
- 11-03 0.6.0 released (#30). ContextMenu, new (G16, #33). Checkbox, new (G15, #31).
- 11-03 BottomSheet, new (G14, #28). Chip, new (G12, #27). TextField, new (G13, #26).
- 11-03 README rewritten for people who use the library (D5); every component has iOS and
  Android screenshots, checked (D4, #29).
- 11-02 0.4.3 and 0.5.0 released (#19, #25). AlertDialog and ConfirmationDialog, new (G11, #24).
- 11-02 Android Menu dropdown sizes to its items; the inline DatePicker fits 320 dp (G8, #18).
- 11-02 Slider, Button, Progress and SegmentedControl follow-up fixes (G10, #23). Tooling
  sweeps (X16, #20; X17, #22).
- Research and spikes in the window, nothing user-visible: Q5 to Q9, S2, S3, S5, S6, S6b, T19.

## Blocked or waiting

- Release: one patch changeset is on `main` since 0.9.1 (`x37-harness-trims-form-reference`), and
  the Version Packages pull request is #83. Check `npm view` before saying anything about it.
- Records: `node scripts/task-records.mjs` keeps G12, S2, S3, S5, S6, S6b and T19 while their
  unmerged prototype branches are live, and FIX3 and T18 because each has a brief and no report.
  Deleting a branch, or the brief, lets the records be archived.
