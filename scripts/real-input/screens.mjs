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

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'menu'|'chip'|'host'|'textfield'|'searchfield'|'checkbox'|'contextmenu'} ScreenId */

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
  checkbox: 'example/src/CheckboxScreen.tsx',
  contextmenu: 'example/src/ContextMenuScreen.tsx',
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
  checkboxValue: 'real-input-checkbox-value',
  checkboxEvents: 'real-input-checkbox-events',
  checkboxRefusedLast: 'real-input-checkbox-refused-last',
  checkboxRefusedEvents: 'real-input-checkbox-refused-events',
  checkboxDisabledEvents: 'real-input-checkbox-disabled-events',
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
  ctxEcho: 'ctx-echo',
});

/**
 * The echo that proves each example screen came up.
 *
 * The tab bar is the example's only navigation, and the two platforms cannot read it the
 * same way. iOS taps a tab by its `testID` (`tab-<screen>`, which React Native writes as
 * `accessibilityIdentifier`), so a new screen needs nothing on that side beyond the
 * screen itself. Android's accessibility tree carries no testID (React Native stores it
 * as a view tag, which never appears in a `uiautomator` dump — see `uiautomator.mjs`), so
 * X19 reads the tab's **label** and order straight out of the `TABS` array
 * `example/src/App.tsx` renders ({@link exampleTabs} in `tab-targets.mjs`), and scrolls
 * the bar until that tab is wholly on screen. A label duplicated here would be a label
 * that drifts from the app's, so this table carries only the other half: the echo the
 * runner polls to learn the tap landed, which is a testID the screen renders and no
 * other screen does — data only this library's checks know.
 *
 * That split is what G17's SearchField cost to learn the hard way: the screen existed,
 * the tab rendered, and the runner asked the tree for a tab named `undefined` — the row
 * below had not been written when the screen was. `progress` has no row because no check
 * navigates there.
 *
 * @typedef {object} ScreenAnchor
 * @property {string} anchor A testID that is on that screen and nowhere else, which the
 *   runner polls to learn the tap landed.
 */
export const SCREEN_TAB = Object.freeze({
  switch: { anchor: ECHO.switchValue },
  slider: { anchor: ECHO.sliderStart },
  button: { anchor: ECHO.buttonCount },
  segmented: { anchor: ECHO.segmentedIndex },
  datepicker: { anchor: ECHO.dateValue },
  picker: { anchor: ECHO.pickerIndex },
  menu: { anchor: ECHO.menuPick },
  chip: { anchor: ECHO.chipValue },
  checkbox: { anchor: ECHO.checkboxValue },
  contextmenu: { anchor: ECHO.ctxEcho },
  dialog: { anchor: ECHO.dialogLog },
  sheet: { anchor: ECHO.sheetLog },
  textfield: { anchor: ECHO.textTyping },
  searchfield: { anchor: ECHO.searchTyping },
  host: { anchor: ECHO.hostValue },
});

/**
 * The arrival echo for `screen`.
 *
 * Throws rather than returning `undefined`, and names the file to fix: a caller is
 * always mid-device-run by now, and the useful failure is the one that says which row is
 * missing instead of sending the runner off to poll an echo called `undefined`.
 *
 * @param {string} screen
 * @returns {ScreenAnchor}
 */
export function screenTab(screen) {
  const entry = SCREEN_TAB[screen];
  if (entry == null) {
    throw new Error(
      `real-input: screen "${screen}" has no row in SCREEN_TAB ` +
        '(scripts/real-input/screens.mjs), so the runner cannot tell that its ' +
        'screen came up. Add the echo testID that screen renders and nothing else.'
    );
  }
  return entry;
}
