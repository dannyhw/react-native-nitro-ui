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

- 11-20 Nothing user-visible: the Android ContextMenu bottom-edge test waits for the device's own
  popup window and holds clear of the system gesture area (FIX24, #121).
- 11-20 Nothing user-visible: the iOS split Menu test waits for the tap's action instead of a fixed
  400 ms (FIX23, #116).
- 11-20 Nothing user-visible: the SearchField clear-button, hosted Picker menu and Slider drag tests
  wait for the value they read, so slower machines no longer race them (FIX22, #115).
- 11-20 Nothing user-visible: the Android real-input gate's tree checks press Back only on a
  window the app owns, so a relaunch on a slow machine no longer closes the app it started
  (X60, #117); `check` no longer runs the tooling tests while `prepare` regenerates `nitrogen/`
  (X61, #118).
- 11-19 An Android `SearchField` with no `placeholder` shows its default prompt and names its clear
  button in the app's own language, including a per-app language, not the device's (FIX21, #114).
- 11-19 An Android `SearchField` with `autoCorrect={false}` asks the keyboard for no suggestion
  strip, as `TextField` does (FIX20, #113).
- 11-19 Nothing user-visible: the Android real-input suite reads the accessibility tree from the
  driver through a file, so a large answer on a loaded machine no longer arrives cut short, and a
  failed read carries the driver's reason (X58, #110). The suite's own e2e tests now check the
  ContextMenu, ButtonGroup and Picker accessibility actions off driver `agent-device` 0.21.40,
  which the separate `uiautomator` pass used to check (X59, #112).
- 11-19 A disabled iOS ButtonGroup keeps the items its row showed while enabled, with its overflow
  control dimmed in place, instead of fitting one more item (FIX18, #109).
- 11-19 On iOS, a `BottomSheet` that UIKit silently refused to present reports
  `onIsPresentedChange(false)` and presents the next time it is asked, instead of staying closed
  for the rest of its mount (FIX17, #108).
- 11-19 Nothing user-visible: an Android real-input test skipped with a `QUARANTINED <date>`
  comment and listed under "Quarantined tests" reads as quarantined instead of turning the gate
  red, and the icon provenance test checks fixtures in subfolders (X57, #107).
- 11-19 Nothing user-visible: Android harness cases prove a Form's `keyboardAvoidance={false}`
  without a keyboard (no content growth, no lift of the focused field); the quarantined real-input
  case stays out with its cause unknown (FIX15, #106).
- 11-19 In development, an Android `androidIcon` from `require()` whose file path holds a space,
  `#` or non-ASCII letters draws; a hand-written icon URL's `#fragment` is still not requested
  (FIX14, #105).
- 11-19 In an iOS `text` ButtonGroup that holds a toggle, every item reserves the same capsule room
  at the group's size, so an unchecked toggle no longer leaves a wider gap than an action item
  (FIX13, #103).
- 11-19 An item that moves into a ButtonGroup's overflow menu keeps its `androidIcon` on Android,
  and an iOS toggle item is drawn in the group's `variant` and `tintColor`, one step quieter while
  unchecked and never grey; checking a toggle in a `text` group no longer clips it (FIX7, #98).
- 11-18 On iOS, a `maxLength` cut made in the middle of a full `TextField` or `SearchField` keeps
  the caret by the kept text instead of the end of the field; on Android, `autoCorrect={false}`
  also hides the keyboard's suggestion strip, as `TextInput` does (FIX8, #100).
- 11-18 A tap on a nitro-ui control inside a `Form.Row` with `onPress` (a `Switch`, say) is the
  control's alone and no longer also presses the row; a `ListItem` inside a row still presses
  it; `keyboardAvoidance={false}` no longer pads an Android Form's content for the keyboard
  (FIX6, #95).
- 11-18 Nothing user-visible: `real-input:android -- --a11y <case>` reads one accessibility
  case and `--rerun-failed` reruns failed ones; `real-input:ios` fails within 5 minutes when no
  test starts, and names a simulator restart as the fix (X54, #97).
- 11-18 Nothing user-visible: a lease carries a note that `lease.mjs list` prints, merge
  branches are named `merge/<name>`, pool emulators and adb servers start outside every
  worktree, a reap never acts through a stale pool row, and the watchdog warns when its
  checkout is behind `origin/main` (X55, #96).
- 11-17 Nothing user-visible: the tooling unit tests run on Vitest, which takes `check` from
  about 89 s to about 60 s; the library tests stay on Jest (X53, #94).
- 11-17 Nothing user-visible: lint runs on oxlint, format on oxfmt and type checks on
  `bun check`, each well under a second where they took 3 to 7; the Android e2e suite starts on
  bun (X52, #93).
- 11-17 Nothing user-visible: an Android Menu is shown to close on one Back or one outside tap
  after a tap on a disabled row, and the row to read as disabled to a screen reader; the Menu
  page says what a disabled row does (FIX5, #92).
- 11-17 0.9.2 released (#83).
- 11-17 Nothing user-visible: a filtered `real-input:ios` run reads only the accessibility cases
  and tab targets it names, from one snapshot per case, and the UI-test build shares the app
  build's compiler cache: a one-control run takes 2 to 3 minutes in place of 14 (X51, #91).
- 11-17 Nothing user-visible: the Android real-input suite no longer waits out a timeout on a
  control that is off screen, 3.7 minutes off a 31-minute run (X49, #90).
- 11-16 Nothing user-visible: a green device gate counts on any branch whose files for that
  gate are the same, and the two harness gates run at the same time (X50, #89).
- 11-16 Nothing user-visible: almost every Android real-input check now runs in the e2e suite,
  which leaves three controls and under 1,000 lines in the `uiautomator` phase (X45, X46, X47,
  #85, #86, #87). Each device gate is keyed to the files its own run reads, a red run is
  completed by re-running only what failed, and an iOS and an Android gate run side by side
  under one lease (X48, #88).
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
- Research and spikes in the window, nothing user-visible: Q5 to Q9, S2, S3, S5, S6, S6b, T19.

## Blocked or waiting

- Release: nothing is staged; npm's latest is 0.9.2. Check `npm view` before saying anything
  about it.
- Records: `node scripts/task-records.mjs` keeps S5, S6 and S6b while their unmerged prototype
  branches are live, and FIX3 and T18 because each has a brief and no report.
  Deleting a branch, or the brief, lets the records be archived.
