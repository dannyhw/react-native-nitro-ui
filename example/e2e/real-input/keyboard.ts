/**
 * Keyboard avoidance, measured against the keyboard's own insets.
 *
 * The hardest check in the suite, and both difficulties come from the driver
 * rather than the library:
 *
 * 1. **The driver's keyboard draws nothing.** agent-device installs a headless
 *    test IME on every emulator session so text entry is deterministic
 *    (`com.callstack.agentdevice.imehelper`). It never shows a keyboard, so
 *    `WindowInsets.ime` stays empty: the app has nothing to avoid, and a check
 *    measuring avoidance would pass by measuring nothing. A keyboard check
 *    therefore puts the device's *real* IME back for the length of the gesture
 *    and restores the test IME afterwards. This is the one place the suite
 *    touches device settings, and it is configuration, not driving: the touch is
 *    still e2e's, and so is every read of the tree.
 * 2. **The keyboard's edge is not in the app's own geometry.** The example
 *    activity is `adjustResize`, but React Native on API 35 keeps its content
 *    view full-height and receives insets instead — measured with a real
 *    keyboard on screen, `android:id/content` still read its resting 2282 px. So
 *    the edge comes from the window manager's `ime` `InsetsSource`: the number
 *    the library itself has to honour. Reading it is the job
 *    `scripts/real-input/ime-frame.mjs` was written for, and that file is kept
 *    for this one call: e2e has no route to an `InsetsSource`.
 *
 * `ime-frame.mjs` answers `null` for "this dump never mentioned a visible
 * keyboard" and never for "the keyboard is at the top", and its sample goes into
 * every failure here, so a release that renames the line it parses reddens the
 * gate instead of quietly passing.
 */

import { expect, type Locator } from 'e2e';

import { adbShell as adb } from './device-read';

import {
  imeInsetSample,
  imeInsetTop,
} from '../../../scripts/real-input/ime-frame.mjs';

/** The IME the driver installs for text entry; it never draws a keyboard. */
const TEST_IME_PACKAGE = 'com.callstack.agentdevice.imehelper';

/** What agent-device writes the displaced IME to before it takes over. */
const TEST_IME_RECORD = 'agent_device_ime_helper_previous_ime';

/** How long a keyboard may take to publish its inset, in ms. */
const KEYBOARD_TIMEOUT_MS = 10_000;

/** One setting, read back; `null` for the `null` the settings provider prints. */
function setting(key: string): string | null {
  const value = adb(['settings', 'get', 'secure', key]);
  return value === '' || value === 'null' ? null : value;
}

/** The IME the device would use for the next field it focuses. */
function currentIme(): string | null {
  return setting('default_input_method');
}

/**
 * A keyboard that a person can see: an enabled IME that is not the driver's
 * headless helper.
 *
 * The record the helper leaves behind is preferred, because it is the IME this
 * device had before the driver took over. Failing that, the first enabled IME
 * that is not the helper. Nothing else is acceptable: a keyboard check run
 * against a keyboard-less IME is a check that cannot fail, which is worse than
 * no check.
 */
function realIme(): string {
  const recorded = setting(TEST_IME_RECORD);
  if (recorded != null && !recorded.startsWith(TEST_IME_PACKAGE)) {
    return recorded;
  }
  const enabled = adb(['ime', 'list', '-s'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(TEST_IME_PACKAGE));
  const first = enabled[0];
  if (first == null) {
    throw new Error(
      `real-input: no keyboard IME on this device besides ` +
        `${TEST_IME_PACKAGE} (enabled list: ${enabled.join(', ')}). A keyboard ` +
        'check against a keyboard-less IME cannot fail, so it is not run.'
    );
  }
  return first;
}

/**
 * Switch the device to `component`, and refuse to continue if it did not stick.
 *
 * Not `useIme`: a helper named like a React hook is read as one by the lint rule,
 * and this is a call to `adb ime set` in a device gate, three files away from React.
 */
function selectIme(component: string): void {
  adb(['ime', 'set', component]);
  const now = currentIme();
  if (now !== component) {
    throw new Error(
      `real-input: the keyboard check asked for IME "${component}" and the ` +
        `device answers "${now}" - without a keyboard a person can see, there ` +
        'is nothing for the app to avoid.'
    );
  }
}

/**
 * Run `body` with a real, visible keyboard available.
 *
 * Also lifts `show_ime_with_hard_keyboard`: an emulator reports a hardware
 * keyboard, and Android then keeps the soft one away however focused the field
 * is. Both settings go back the way they were, including when the body fails.
 */
export async function withRealKeyboard<T>(body: () => Promise<T>): Promise<T> {
  const ime = realIme();
  const previousIme = currentIme();
  const previousHardKeyboard = setting('show_ime_with_hard_keyboard');
  if (previousIme !== ime) selectIme(ime);
  if (previousHardKeyboard !== '1') {
    adb(['settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1']);
  }
  try {
    return await body();
  } finally {
    if (previousHardKeyboard !== '1') {
      adb([
        'settings',
        'put',
        'secure',
        'show_ime_with_hard_keyboard',
        previousHardKeyboard ?? '0',
      ]);
    }
    if (previousIme !== ime && previousIme != null) selectIme(previousIme);
  }
}

/** A box, in the two numbers a keyboard-avoidance check compares. */
export type FieldBox = { y: number; height: number };

/** The poll the two rest conditions are read on. */
const REST_POLL_MS = 250;

/** Two readings of one box that a rounding difference cannot tell apart. */
function sameBox(left: FieldBox | null, right: FieldBox | null): boolean {
  if (left == null || right == null) return false;
  return (
    Math.round(left.y) === Math.round(right.y) &&
    Math.round(left.height) === Math.round(right.height)
  );
}

/**
 * The keyboard's top edge, or `null` when the dump carries no visible one.
 *
 * `ime-frame.mjs` answers `null` for "this dump never mentioned a visible keyboard"
 * and never for "the keyboard is at the top", so a `null` here is the window manager
 * saying the keyboard is not up rather than a keyboard sitting at y = 0.
 */
function rawKeyboardTop(): { top: number | null; sample: string } {
  const dump = adb(['dumpsys', 'activity', 'top']);
  return { top: imeInsetTop(dump), sample: imeInsetSample(dump) };
}

/**
 * The keyboard's top edge, failing with the dump's own IME lines.
 *
 * The words are for the case the settle ended with no keyboard at all: a measurement
 * of nothing would otherwise read as a field that avoided it.
 */
function requireKeyboardTop(when: string): number {
  const dump = adb(['dumpsys', 'activity', 'top']);
  const top = imeInsetTop(dump);
  if (top == null) {
    throw new Error(
      `real-input: ${when} there was no visible keyboard to measure; ` +
        `the window manager says: ${imeInsetSample(dump)}`
    );
  }
  return top;
}

/**
 * Put a finger on the field.
 *
 * Split from {@link expectKeyboard} so a test that has its own proof of focus —
 * an echo the app draws when the field takes it — can read that echo between the
 * tap and the keyboard. Without it, "no keyboard appeared" cannot be told apart
 * from "the tap never focused anything", and those two need different fixes.
 */
export async function focusField(field: Locator): Promise<void> {
  await field.tap();
}

/**
 * Wait for the keyboard to actually come up.
 *
 * A check that measures avoidance while nothing is on screen passes by measuring
 * nothing, so the inset itself is the first assertion: the window manager has to
 * report a visible IME source before any claim about the field's position means
 * anything.
 */
export async function expectKeyboard(): Promise<{ keyboardTop: number }> {
  // Waited for by hand rather than with `expect.poll`, because the thing a reader
  // needs on a timeout is the window manager's own words, and a poll's message is
  // fixed before the failure happens.
  const deadline = Date.now() + KEYBOARD_TIMEOUT_MS;
  let top: number | null = null;
  let sample = '';
  while (top == null && Date.now() < deadline) {
    const dump = adb(['dumpsys', 'activity', 'top']);
    top = imeInsetTop(dump);
    sample = imeInsetSample(dump);
    if (top == null) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (top == null) {
    throw new Error(
      'real-input: the focused field brought up no keyboard, so "the field stays ' +
        'above it" cannot be checked: the window manager never reported a ' +
        `visible ime inset. The IME in use is ${currentIme() ?? 'nothing'}, ` +
        `show_ime_with_hard_keyboard=${setting('show_ime_with_hard_keyboard') ?? 'unset'}, and the dump says: ${sample}`
    );
  }
  return { keyboardTop: top };
}

/** Focus a field and prove the keyboard came up with it. */
export async function focusAndExpectKeyboard(
  field: Locator
): Promise<{ keyboardTop: number }> {
  await focusField(field);
  return expectKeyboard();
}

/**
 * The keyboard's edge and the field's box, once both have come to rest.
 *
 * The inset animates in and a popup moves with it, so one read of each measures a
 * keyboard still on its way up and a popup that has not started to move — the
 * recorded failure was a field 431 px below an edge that had not finished arriving.
 * The conditions, in order and inside the deadline {@link expectKeyboard} already
 * allows: the edge equal on two reads, then the field's box different from the box it
 * had before the field was focused (only when a caller names one — a popup has to move
 * clear, a field that was already clear does not), then that box equal on two reads.
 *
 * The placement itself is never polled: a popup passing through a valid spot would
 * settle green. At the deadline the last readings are handed back, so the assertions
 * below still print the same numbers for a layout that never settles.
 */
export async function measureAtRest(
  field: Locator,
  movedFrom: FieldBox | null = null
): Promise<{ keyboardTop: number; fieldBox: FieldBox | null }> {
  const deadline = Date.now() + KEYBOARD_TIMEOUT_MS;
  let edgeAgreements = 0;
  let lastEdge: number | null = null;
  let boxAgreements = 0;
  let lastBox: FieldBox | null = null;
  let hasMoved = movedFrom == null;
  while (Date.now() < deadline) {
    const edge = rawKeyboardTop();
    if (edge.top == null) {
      edgeAgreements = 0;
      lastEdge = null;
      await new Promise((resolve) => setTimeout(resolve, REST_POLL_MS));
      continue;
    }
    edgeAgreements = edge.top === lastEdge ? edgeAgreements + 1 : 0;
    lastEdge = edge.top;
    if (edgeAgreements < 1) {
      await new Promise((resolve) => setTimeout(resolve, REST_POLL_MS));
      continue;
    }
    const read: FieldBox | null = await field.boundingBox();
    if (!hasMoved && movedFrom != null) {
      hasMoved = !sameBox(read, movedFrom);
      if (!hasMoved) {
        lastBox = read;
        boxAgreements = 0;
        await new Promise((resolve) => setTimeout(resolve, REST_POLL_MS));
        continue;
      }
    }
    boxAgreements = sameBox(read, lastBox) ? boxAgreements + 1 : 0;
    lastBox = read;
    if (boxAgreements >= 1 && hasMoved) {
      return { keyboardTop: edge.top, fieldBox: read };
    }
    await new Promise((resolve) => setTimeout(resolve, REST_POLL_MS));
  }
  return {
    keyboardTop:
      lastEdge ??
      requireKeyboardTop('while the focused field was being measured,'),
    fieldBox: lastBox,
  };
}

/**
 * The field stays above the keyboard.
 *
 * What a person gets: the caret and what they have typed are visible. What the
 * defect gave: a field laid out behind the IME, so the app was still
 * taking keystrokes nobody could see.
 */
export async function fieldAboveKeyboard(
  field: Locator,
  movedFrom: FieldBox | null = null
): Promise<void> {
  const { keyboardTop: top, fieldBox: box } = await measureAtRest(
    field,
    movedFrom
  );
  expect(
    box,
    'the focused field has no box to measure against the keyboard'
  ).not.toBeNull();
  if (box != null) {
    expect(
      box.y + box.height,
      `the focused field's bottom (${String(Math.round(box.y + box.height))} px) ` +
        `is below the keyboard's top (${String(Math.round(top))} px): a person is ` +
        'typing into something they cannot see'
    ).toBeLessThanOrEqual(top);
    expect(box.height > 0, 'the focused field is drawn at nothing').toBe(true);
  }
}

export { expect };
