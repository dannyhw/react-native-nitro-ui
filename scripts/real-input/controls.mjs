/**
 * The real-input suite's list of controls - the one table both platforms read.
 *
 * Every entry here is proved with OS-synthesised input (XCUITest on iOS,
 * `adb shell input` on Android) and asserted only through text the app renders
 * on screen. Nothing in the suite reaches for a test hook, a Nitro callback or
 * an in-app tracer, because what the suite has to prove is that a real touch
 * reaches a hosted SwiftUI/Compose control inside a React Native app (the class
 * of bug G2 found when a SwiftUI `Button` rejected the harness's HID-less touch).
 *
 * ## Adding a control
 *
 * Add one entry here, then one check per platform:
 *
 * - iOS: `func testRealInput<Id>` in
 *   `example/ios/NitroUiExampleUITests/RealInputTests.swift`;
 * - Android: one entry in `CHECKS` in `scripts/real-input/android.mjs`.
 *
 * `bun run test:real-input:ios|android` refuses to report success for a control
 * that is listed here but missing on the platform it is running: a suite that
 * silently skips a control reads as green, which is the worst thing a test
 * harness on a shared machine can do.
 *
 * @typedef {object} RealInputControl
 * @property {string} id Lower-case identifier, also the name of the check on
 *   both platforms (`switch` -> `testRealInputSwitch` / `CHECKS.switch`).
 * @property {string} title What the check proves, for the report line.
 * @property {'switch' | 'slider' | 'button' | 'segmented'} screen The example
 *   app's tab to be
 *   on. Must be a tab `example/src/App.tsx` actually renders, and the screen
 *   behind it has to render the on-screen `Text` the checks read.
 */

/** @type {ReadonlyArray<RealInputControl>} */
export const REAL_INPUT_CONTROLS = Object.freeze([
  {
    id: 'switch',
    title: 'real tap flips the Switch and JS sees the new value',
    screen: 'switch',
  },
  {
    id: 'slider',
    title: 'real drag moves the Slider and fires start, change and complete',
    screen: 'slider',
  },
  {
    id: 'button',
    title: 'real tap presses the Button, and a disabled one stays pressed-out',
    screen: 'button',
  },
  {
    id: 'segmented-control',
    title:
      'real tap selects the segment under the finger, and a refused selection snaps back',
    screen: 'segmented',
  },
]);

/**
 * The check name a control must have on iOS.
 *
 * @param {string} id
 * @returns {string} e.g. `testRealInputSwitch`
 */
export function iosCheckName(id) {
  const pascal = id
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join('');
  if (pascal === '') {
    throw new Error(`real-input: control id "${id}" names no check`);
  }
  return `testRealInput${pascal}`;
}

/**
 * Select the controls a run should cover.
 *
 * @param {ReadonlyArray<string>} ids Control ids, or empty for every control.
 * @returns {ReadonlyArray<RealInputControl>}
 */
export function selectControls(ids) {
  if (ids.length === 0) {
    return REAL_INPUT_CONTROLS;
  }
  return ids.map((id) => {
    const control = REAL_INPUT_CONTROLS.find((entry) => entry.id === id);
    if (control == null) {
      const known = REAL_INPUT_CONTROLS.map((entry) => entry.id).join(', ');
      throw new Error(
        `real-input: unknown control "${id}". Known controls: ${known}.`
      );
    }
    return control;
  });
}
