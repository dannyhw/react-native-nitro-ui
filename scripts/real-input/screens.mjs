/**
 * Which example screen file renders each tab.
 *
 * Its own module because the data is needed on both sides of the JS boundary: the
 * host readers (`a11y.mjs`, `android.mjs`) and `scripts/conformance-core.mjs`, which
 * the on-device harness bundle also imports. `a11y.mjs` reads a `uiautomator` dump and
 * therefore pulls in `node:child_process`, so anything the bundle touches has to live
 * where importing it cannot drag the Node-only tree into the app graph.
 *
 * Written out rather than derived from a tab id because a tab is not a file name:
 * `datepicker` renders `DatePickerScreen.tsx` and `host` renders every component into
 * one screen.
 *
 * The other two things a host reader has to know about a screen live here for the same
 * reason: {@link ECHO}, the on-screen testIDs the real-input checks read, and
 * {@link SCREEN_TAB}, the tab it has to press to reach the screen and the echo that
 * proves the press landed.
 *
 * @file
 */

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'menu'|'chip'|'host'|'textfield'|'searchfield'} ScreenId */

/** @type {Readonly<Record<ScreenId, string>>} */
export const SCREEN_FILE = Object.freeze({
  switch: 'example/src/SwitchScreen.tsx',
  slider: 'example/src/SliderScreen.tsx',
  button: 'example/src/ButtonScreen.tsx',
  segmented: 'example/src/SegmentedControlScreen.tsx',
  datepicker: 'example/src/DatePickerScreen.tsx',
  picker: 'example/src/PickerScreen.tsx',
  progress: 'example/src/ProgressScreen.tsx',
  menu: 'example/src/MenuScreen.tsx',
  chip: 'example/src/ChipScreen.tsx',
  host: 'example/src/HostScreen.tsx',
  textfield: 'example/src/TextFieldScreen.tsx',
  searchfield: 'example/src/SearchFieldScreen.tsx',
});

/**
 * The on-screen echoes the real-input checks read (testIDs from `example/src`).
 *
 * Here rather than in `android.mjs`, which used to own this table, because *reaching* a
 * screen needs one of them: {@link SCREEN_TAB} names the echo that proves a screen came
 * up, and an echo testID written in two files is a testID that drifts. The iOS runner
 * keeps its own copy (`Echo` in `RealInputTests.swift`) because Swift cannot read this
 * file — which is why the check-time guard compares each side against the screens
 * rather than against the other.
 */
export const ECHO = Object.freeze({
  switchValue: 'switch-controlled-value',
  buttonCount: 'real-input-count',
  sliderStart: 'slider-start-count',
  sliderChange: 'slider-change-count',
  sliderComplete: 'slider-complete-count',
  sliderValue: 'slider-phase-value',
  sliderControlledValue: 'slider-controlled-value',
  segmentedIndex: 'real-input-segmented-index',
  segmentedEvents: 'real-input-segmented-events',
  rejectEvents: 'real-input-reject-events',
  rejectValue: 'real-input-reject-value',
  dateValue: 'real-input-date-value',
  dateEvents: 'real-input-date-events',
  pickerIndex: 'real-input-picker-index',
  pickerEvents: 'real-input-picker-events',
  pickerGone: 'real-input-drop-gone',
  menuPick: 'real-input-menu-pick',
  menuEvents: 'real-input-menu-events',
  chipValue: 'real-input-chip-value',
  chipEvents: 'real-input-chip-events',
  chipRefusedLast: 'real-input-chip-refused-last',
  chipRefusedEvents: 'real-input-chip-refused-events',
  chipPresses: 'real-input-chip-presses',
  dialogLog: 'dialog-log',
  sheetLog: 'sheet-log',
  hostValue: 'host-controlled-value',
  hostEvents: 'host-events-count',
  hostSliderValue: 'host-slider-value',
  hostButtonPresses: 'host-button-presses',
  hostMixedState: 'host-mixed-state',
  hostSegmentedIndex: 'host-segmented-index',
  hostPickerIndex: 'host-picker-index',
  hostDateValue: 'host-datepicker-value',
  hostDateDropArmed: 'host-datepicker-drop-armed',
  hostDateDropButton: 'host-datepicker-drop',
  hostDateGone: 'host-datepicker-drop-gone',
  hostDateRemount: 'host-datepicker-drop-remount',
  textTyping: 'text-typing-echo',
  textFrozen: 'text-frozen-echo',
  textCapped: 'text-capped-echo',
  textFocus: 'text-focus-echo',
  searchTyping: 'search-typing-echo',
  searchFrozen: 'search-frozen-echo',
  searchCapped: 'search-capped-echo',
  searchFocus: 'search-focus-echo',
});

/**
 * How a host-side runner reaches each example screen, and what proves it arrived.
 *
 * The tab bar is the example's only navigation, and the two platforms cannot read it the
 * same way. iOS taps a tab by its `testID` (`tab-<screen>`, which React Native writes as
 * `accessibilityIdentifier`), so a new screen needs nothing on that side beyond the
 * screen itself. Android has to tap the *label* the tab renders: React Native stores
 * `testID` as a view tag, which never appears in a `uiautomator` dump (see
 * `uiautomator.mjs`). So the label is data this side carries, and a control whose screen
 * has no row here is a control the Android runner cannot get to at all.
 *
 * That is exactly how G17's SearchField failed its first Android run: the screen existed,
 * the tab rendered, and the runner asked the tree for a tab named `undefined` — the row
 * below had not been written when the screen was. `progress` has no row because no check
 * navigates there.
 *
 * @typedef {object} ScreenTab
 * @property {string} label The tab's text, exactly as `example/src/App.tsx` renders it —
 *   `findTab` matches `node.text` and needs exactly one node to match.
 * @property {string} anchor A testID that is on that screen and nowhere else, which the
 *   runner polls to learn the tap landed.
 */
export const SCREEN_TAB = Object.freeze({
  switch: { label: 'Switch', anchor: ECHO.switchValue },
  slider: { label: 'Slider', anchor: ECHO.sliderStart },
  button: { label: 'Button', anchor: ECHO.buttonCount },
  segmented: { label: 'Segments', anchor: ECHO.segmentedIndex },
  datepicker: { label: 'Dates', anchor: ECHO.dateValue },
  picker: { label: 'Picker', anchor: ECHO.pickerIndex },
  menu: { label: 'Menu', anchor: ECHO.menuPick },
  chip: { label: 'Chip', anchor: ECHO.chipValue },
  dialog: { label: 'Dialogs', anchor: ECHO.dialogLog },
  sheet: { label: 'Sheet', anchor: ECHO.sheetLog },
  textfield: { label: 'Text', anchor: ECHO.textTyping },
  searchfield: { label: 'Search', anchor: ECHO.searchTyping },
  host: { label: 'Host', anchor: ECHO.hostValue },
});

/**
 * The tab that has to be pressed to reach `screen`.
 *
 * Throws rather than returning `undefined`, and names the file to fix: a caller is
 * always mid-device-run by now, and the useful failure is the one that says which row is
 * missing instead of sending the runner off to tap a tab called `undefined`.
 *
 * @param {string} screen
 * @returns {ScreenTab}
 */
export function screenTab(screen) {
  const entry = SCREEN_TAB[screen];
  if (entry == null) {
    throw new Error(
      `real-input: screen "${screen}" has no row in SCREEN_TAB ` +
        '(scripts/real-input/screens.mjs), so its screen cannot be reached on ' +
        'Android. Add the label example/src/App.tsx renders for that tab and the ' +
        'echo testID that proves the screen came up.'
    );
  }
  return entry;
}
