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
 * @file
 */

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'host'} ScreenId */

/** @type {Readonly<Record<ScreenId, string>>} */
export const SCREEN_FILE = Object.freeze({
  switch: 'example/src/SwitchScreen.tsx',
  slider: 'example/src/SliderScreen.tsx',
  button: 'example/src/ButtonScreen.tsx',
  segmented: 'example/src/SegmentedControlScreen.tsx',
  datepicker: 'example/src/DatePickerScreen.tsx',
  picker: 'example/src/PickerScreen.tsx',
  progress: 'example/src/ProgressScreen.tsx',
  host: 'example/src/HostScreen.tsx',
});
