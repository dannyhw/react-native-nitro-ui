/**
 * Keyboard avoidance, measured from the app's own content view.
 *
 * The example app's activity is `adjustResize`, so the window reports the
 * keyboard by handing the app a shorter content view: the bottom of
 * `android:id/content` *is* the top of the keyboard. That makes the check
 * expressible without reading `dumpsys` — and it is the same measurement the
 * two real defects in this class were found by (G24: a focused field left
 * behind the keyboard; G22: a popup placed under it, then past it).
 */
import { expect, type Locator, type Screen } from 'e2e';

/** The Android view React Native's content is drawn into. */
const CONTENT_ROOT = 'android:id/content';

/** The keyboard's top edge: the bottom of the resized content view. */
export async function keyboardTop(screen: Screen): Promise<number> {
  const box = await screen.getByTestId(CONTENT_ROOT).boundingBox();
  if (box == null) {
    throw new Error('real-input: the content view has no box to measure.');
  }
  return box.y + box.height;
}

/** The content view's bottom with no keyboard up, as the baseline. */
export async function restingBottom(screen: Screen): Promise<number> {
  return keyboardTop(screen);
}

/**
 * Focus a field and prove the keyboard actually came up.
 *
 * A check that measures avoidance while nothing is on screen passes by
 * measuring nothing, so the inset itself is an assertion: the content view has
 * to get measurably shorter before any claim about the field's position means
 * anything.
 */
export async function focusAndExpectKeyboard(
  screen: Screen,
  field: Locator
): Promise<{ resting: number; keyboardTop: number }> {
  const resting = await restingBottom(screen);
  await field.tap();
  await expect
    .poll(() => keyboardTop(screen), {
      timeout: 10_000,
      message:
        `the keyboard did not shrink the content view (its bottom was ` +
        `${String(Math.round(resting))} px before the tap): there is no keyboard ` +
        'to avoid, so a check that the field is above it would prove nothing',
    })
    .toBeLessThan(resting - 40);
  return { resting, keyboardTop: await keyboardTop(screen) };
}

/**
 * The field stays above the keyboard.
 *
 * What a person gets: the caret and what they have typed are visible. What the
 * defect gave: a field scrolled or laid out behind the IME, so the app was
 * still accepting keystrokes nobody could see.
 */
export async function fieldAboveKeyboard(
  screen: Screen,
  field: Locator
): Promise<void> {
  const top = await keyboardTop(screen);
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
    expect(
      box.height > 0,
      'the focused field is drawn at nothing'
    ).toBe(true);
  }
}

export { expect };
