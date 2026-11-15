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
 *    for this one call (audit X35: the check e2e cannot express).
 *
 * `ime-frame.mjs` answers `null` for "this dump never mentioned a visible
 * keyboard" and never for "the keyboard is at the top", and its sample goes into
 * every failure here, so a release that renames the line it parses reddens the
 * gate instead of quietly passing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect, type Locator } from 'e2e';

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

/**
 * Run `adb` against the leased device only, and nothing else.
 *
 * Every call carries the lease's server port and the lease's serial: another
 * person's emulator is visible on the default server, and AGENTS.md is explicit
 * about not reaching it.
 */
function adb(args: readonly string[]): string {
  const env = process.env;
  const serial = env.ANDROID_SERIAL;
  if (serial == null || serial === '') {
    throw new Error(
      'real-input: ANDROID_SERIAL is unset, so the keyboard check has no device ' +
        'it may configure. Source the lease before running the suite.'
    );
  }
  const home = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  const sdkAdb =
    home != null ? path.join(home, 'platform-tools', 'adb') : undefined;
  const binary =
    sdkAdb != null && fs.existsSync(sdkAdb) ? sdkAdb : (env.ADB_BIN ?? 'adb');
  const port = env.ANDROID_ADB_SERVER_PORT;
  try {
    return execFileSync(
      binary,
      [
        ...(port != null && port !== '' ? ['-P', port] : []),
        '-s',
        serial,
        'shell',
        ...args,
      ],
      { encoding: 'utf8', timeout: 30_000 }
    ).trim();
  } catch (error) {
    throw new Error(
      `real-input: adb ${args.join(' ')} failed: ` +
        String((error as Error)?.message ?? error)
    );
  }
}

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

/** The keyboard's top edge, failing with the dump's own IME lines. */
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
 * The field stays above the keyboard.
 *
 * What a person gets: the caret and what they have typed are visible. What the
 * defect gave (G24): a field laid out behind the IME, so the app was still
 * taking keystrokes nobody could see.
 */
export async function fieldAboveKeyboard(field: Locator): Promise<void> {
  const top = requireKeyboardTop('while the focused field was being measured,');
  const box = await field.boundingBox();
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
