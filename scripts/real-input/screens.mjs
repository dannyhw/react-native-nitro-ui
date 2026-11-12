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

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'menu'|'chip'|'host'|'textfield'|'searchfield'|'checkbox'|'contextmenu'|'iconbutton'|'buttongroup'|'form'|'listitem'} ScreenId */

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
  iconbutton: 'example/src/IconButtonScreen.tsx',
  form: 'example/src/FormScreen.tsx',
  buttongroup: 'example/src/ButtonGroupScreen.tsx',
  stepper: 'example/src/StepperScreen.tsx',
  listitem: 'example/src/ListItemScreen.tsx',
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
  // E5: the three phases in the order the app was told them (`order=SVC`), so a
  // check can prove `start -> change -> complete` rather than three counts that
  // happen to have moved.
  sliderPhaseOrder: 'slider-phase-order',
  segmentedIndex: 'real-input-segmented-index',
  segmentedEvents: 'real-input-segmented-events',
  rejectEvents: 'real-input-reject-events',
  rejectValue: 'real-input-reject-value',
  dateValue: 'real-input-date-value',
  dateEvents: 'real-input-date-events',
  pickerIndex: 'real-input-picker-index',
  pickerEvents: 'real-input-picker-events',
  pickerGone: 'real-input-drop-gone',
  // G29: the `variant="wheel"` drum's own echo. Its rows are in the app's window like
  // the radio group's, but a drum is rolled rather than pressed, so the count matters as
  // much as the index: one settle, one event, whatever rows it passed.
  wheelIndex: 'real-input-wheel-index',
  wheelEvents: 'real-input-wheel-events',
  // G29: the same pair on the `wheel` + `mode="time"` DatePicker, where the value is an
  // instant and the drums are one per field, drawn from Material's own `ScrollField`.
  wheelTimeValue: 'real-input-wheel-time-value',
  wheelTimeEvents: 'real-input-wheel-time-events',
  // G29: the count on the drum whose parent refuses every roll. The time it reports
  // never moves - the parent keeps sending the one it was built with - so this echo is
  // the only thing that says the roll was seen, and the accessibility tree is what says
  // whether the drums rolled back afterwards.
  wheelRefuseEvents: 'real-input-wheel-refuse-events',
  // G26: the `variant="radio"` group's own echo. Its rows are in the app's window,
  // so a real tap goes straight to one and this is what that tap moves.
  radioIndex: 'real-input-radio-index',
  radioEvents: 'real-input-radio-events',
  menuPick: 'real-input-menu-pick',
  menuEvents: 'real-input-menu-events',
  // E3: the split trigger's own history, so the plain Menu's stays a fixed string.
  menuSplitEvents: 'real-input-menu-split-events',
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
  tooltipLog: 'tooltip-log',
  tooltipPresses: 'tooltip-anchor-presses',
  // G22: the events the app received, and the count of real taps that landed inside a
  // popover - "exactly once over 10 opens" is a comparison against this, not a guess.
  popoverLog: 'popover-log',
  popoverPresses: 'popover-inner-presses',
  hostValue: 'host-controlled-value',
  hostEvents: 'host-events-count',
  hostSliderValue: 'host-slider-value',
  // E5: the hosted Slider's `start=N complete=M`. The value echo says where a drag
  // ended, not that it is over, and a drag check that guesses the second from the
  // first has been the flake.
  hostSliderGesture: 'host-slider-gesture',
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
  searchNumber: 'search-number-echo',
  searchEmail: 'search-email-echo',
  searchSwitching: 'search-switching-echo',
  ctxEcho: 'ctx-echo',
  // G23: an IconButton has no text, so every reading of it is one of these rows —
  // the press count, the toggle's state, and the two counters a refused or refused
  // -because-disabled tap would move.
  iconButtonPresses: 'real-input-icon-button-presses',
  iconButtonValue: 'real-input-icon-button-value',
  iconButtonEvents: 'real-input-icon-button-events',
  iconButtonRefusedLast: 'real-input-icon-button-refused-last',
  iconButtonRefusedEvents: 'real-input-icon-button-refused-events',
  iconButtonDisabledEvents: 'real-input-icon-button-disabled-events',
  // The Form screen's counters: each is a <Text> in the echo bar above the list, so a tap
  // can be read back without scrolling the form away to look at the answer.
  formScreenEcho: 'form-screen-echo',
  formRowPresses: 'form-row-presses',
  formInnerPresses: 'form-inner-presses',
  formOutsidePresses: 'form-outside-presses',
  formSwitchChanges: 'form-switch-changes',
  formSwitchValue: 'form-switch-value',
  formFieldFocus: 'form-field-focus',
  formFieldValue: 'form-field-value',
  // iOS only: the keyboard inset the Form's list is reserving, as UIKit told it.
  formKeyboardInset: 'form-keyboard-inset',
  // G20: a ButtonGroup has no single value to echo, so the readings are the press
  // count, the id of the last item that answered `onPress` (the one check that a
  // three-item row fired the *right* item), the toggle's event count and state, and
  // the two counters a refused or refused-because-disabled tap would move.
  buttonGroupPresses: 'button-group-presses',
  buttonGroupPressedId: 'button-group-pressed-id',
  buttonGroupToggleEvents: 'button-group-toggle-events',
  buttonGroupToggleState: 'button-group-toggle-state',
  buttonGroupRefusedLast: 'button-group-refused-last',
  buttonGroupRefusedEvents: 'button-group-refused-events',
  buttonGroupDisabledEvents: 'button-group-disabled-events',
  // G25: a stepper has no text either, so the readings are the value React holds,
  // the number of steps it was told about, and the two counters a refused or
  // disabled tap would move. `…-refused-last` is the snap-back oracle: the value a
  // refused stepper asks for *next* says whether it kept the refused one.
  stepperValue: 'real-input-stepper-value',
  // The hold fixture's own echo: a wide range so a press-and-hold has room to
  // repeat, and one number to read while it does.
  stepperHoldValue: 'real-input-stepper-hold-value',
  stepperEvents: 'real-input-stepper-events',
  stepperRefusedLast: 'real-input-stepper-refused-last',
  stepperRefusedEvents: 'real-input-stepper-refused-events',
  stepperDisabledEvents: 'real-input-stepper-disabled-events',
  // G30: a ListItem has no value to hold, so the readings are the press count, the
  // title of the last row that answered `onPress` (the one check that a tap fired the
  // *right* row), the counter a tap on a disabled item would move, and the counter for
  // the item that lives inside a `Form.Row` — whose press has to reach the leaf through
  // a row that owns the cell's shape and insets (DECISIONS D46 item 2).
  listItemPresses: 'real-input-listitem-presses',
  listItemLast: 'real-input-listitem-last',
  listItemDisabledEvents: 'real-input-listitem-disabled-events',
  listItemFormPresses: 'real-input-listitem-form-presses',
});

/**
 * Read a `start=N complete=M` gesture echo.
 *
 * A drag check has to ask the control whether its gesture is over, and from out
 * here the only answer available is one text node of the accessibility tree — so
 * the parse lives next to {@link ECHO}, the table that names that node, rather
 * than in whichever runner happens to be reading it.
 *
 * A number that is missing is `null` rather than `0`: "the echo has not been
 * drawn yet" and "no gesture has happened" are different answers, and a check that
 * conflates them can settle a drag on an echo it never actually read.
 *
 * @param {string | null} text what the echo draws, or `null` for no such node
 * @returns {{ starts: number | null, completes: number | null }}
 */
export function gestureCounts(text) {
  const read = (name) => {
    const matched =
      text == null ? null : new RegExp(`${name}=(\\d+)`).exec(text);
    return matched == null ? null : Number(matched[1]);
  };
  return { starts: read('start'), completes: read('complete') };
}

/**
 * Whether a gesture echo reports a *new* gesture that has also been closed.
 *
 * The rule is the library's own event contract, read from outside the app: a
 * gesture is over when this touch's `complete` has arrived, and a `complete` with no
 * `start` after it cannot belong to it — that is the previous gesture still on its way
 * to the screen, which is what a value settled on it would be a sample of. Both
 * numbers missing is `false` because "the echo has not been drawn" is not an answer.
 *
 * The two counters are read together rather than one after the other, because the
 * screen lags the app: a `complete` that has advanced is only this gesture's if the
 * echo does not also show a `start` with no `complete` after it. `{1, 0} -> {2, 1}`
 * advances both and still shows a gesture that has not closed — the shape of the
 * retry path, where an injection reported its start and lost its end.
 *
 * `seen` is the same echo read before the gesture was injected; a `null` in it means
 * the echo read zero at the time, not that it was missing, so the pair is compared
 * loosely in that direction only.
 *
 * @param {{ starts: number | null, completes: number | null }} seen before the drag
 * @param {{ starts: number | null, completes: number | null }} now during the drag
 * @returns {boolean}
 */
export function gestureReported(seen, now) {
  const advanced = (previous, current) => {
    if (current == null) {
      return false;
    }
    return previous == null ? current > 0 : current > previous;
  };
  return (
    advanced(seen.starts, now.starts) &&
    advanced(seen.completes, now.completes) &&
    // Every start on the screen is closed, so the `complete` above cannot be an
    // older gesture's: an open one would leave a start with nothing after it.
    now.completes >= now.starts
  );
}

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
  tooltip: { anchor: ECHO.tooltipLog },
  popover: { anchor: ECHO.popoverLog },
  textfield: { anchor: ECHO.textTyping },
  searchfield: { anchor: ECHO.searchTyping },
  iconbutton: { anchor: ECHO.iconButtonValue },
  buttongroup: { anchor: ECHO.buttonGroupPresses },
  stepper: { anchor: ECHO.stepperValue },
  listitem: { anchor: ECHO.listItemPresses },
  host: { anchor: ECHO.hostValue },
  form: { anchor: ECHO.formScreenEcho },
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
