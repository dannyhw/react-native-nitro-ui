import { test } from '@e2e-dev/mobile';
import { expect, type Locator, type Screen } from 'e2e';

import {
  boxOf,
  centreOf,
  drag,
  editableField,
  flick,
  openScreen,
  reveal,
  tapBand,
  textOf,
  type Box,
  type Point,
} from './support';
import { actsOnOneNamedNode } from './reader';
import {
  expectKeyboard,
  fieldAboveKeyboard,
  focusField,
  withRealKeyboard,
} from './keyboard';

const ROW = 'Row with onPress';

/** A row with `onPress` that has a hosted `Switch` in it. */
const ROW_AND_SWITCH = 'Row with onPress and a switch';
const SWITCH_IN_ROW = 'Switch in a pressed row';

/** The same pair with React Native's own `Pressable` in place of the switch. */
const ROW_AND_PRESSABLE = 'Row with onPress and a pressable';
const PRESSABLE_IN_ROW = 'Pressable inside a pressed row';

/** The Android view React Native draws the app's content into. */
const CONTENT_ROOT = 'android:id/content';

/**
 * A row near the end of the Form — the ruler the keyboard opt-out check measures.
 *
 * Not the very last row: at the end of the list that one sits flush with the bottom of
 * the viewport, where the tree stops reporting it, and a box read on a node the tree
 * does not report costs the driver its whole action timeout.
 */
const CONTENT_RULER = 'Cache';

/** How long a counter or a box is watched for a second value or a second move. */
const SETTLE_MS = 500;

test('a real tap on a Form row presses it once', async ({ app, screen }) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW);
  const presses = screen.getByTestId('form-row-presses');
  await reveal(screen, row);

  // The row's name has to sit on the clickable node itself, so a reader and a
  // finger agree about which node the row is.
  await actsOnOneNamedNode(screen, { name: ROW, state: 'enabled' });
  await expect(presses).toHaveText('0');

  await row.tap();
  await expect(presses).toHaveText('1');
});

test('a flick across a Form row scrolls the list and presses nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW);
  const presses = screen.getByTestId('form-row-presses');
  await reveal(screen, row);

  // A drag that starts on the row and ends 700 px above it is what "scroll" looks
  // like to a recogniser. The row's box is read again afterwards to prove the list
  // really moved: a flick that did nothing would leave the count alone for nothing.
  const before = await boxOf(row);
  if (before == null) {
    throw new Error('real-input: the Form row has no box to flick over.');
  }
  await flick(screen, {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  });

  const after = await boxOf(row);
  const moved =
    after == null ||
    Math.abs(after.y - before.y) > 40 ||
    (await row.count()) === 0;
  expect(moved, 'the flick did not move the list at all').toBe(true);
  await expect(presses).toHaveText('0');
});

test('a row that was not given a press stays unpressed, however it is touched', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW);
  const plain = screen.getByLabel('Row with no onPress');
  const outside = screen.getByLabel('Outside the form');
  const presses = screen.getByTestId('form-row-presses');
  const outsidePresses = screen.getByTestId('form-outside-presses');
  await reveal(screen, row);
  await expect(presses).toHaveText('0');

  // A thumb that wanders along a row and lifts did not choose it. Nothing here is a
  // scrolling list that could cancel the touch — the finger never leaves the row — so
  // the only thing between this gesture and `onPress` is the row's own slop rule.
  const box = await boxOf(row);
  if (box == null) {
    throw new Error('real-input: the Form row has no box to drag along.');
  }
  await drag(
    screen,
    { x: box.x + box.width * 0.25, y: box.y + box.height / 2 },
    { x: box.x + box.width * 0.75, y: box.y + box.height / 2 }
  );
  await expect(presses).toHaveText('0');

  // A row with no handler is inert, and the controls beside it answer straight after, so
  // the silence is that row’s own. The taps are aimed at the row’s box because a row
  // nobody can press has no touch point of its own.
  await reveal(screen, plain);
  for (let tap = 1; tap <= 3; tap += 1) {
    await screen.tapAt(await centreOf(plain));
  }
  await expect(presses).toHaveText('0');
  await outside.tap();
  await expect(outsidePresses).toHaveText('1');
  await row.tap();
  await expect(presses).toHaveText('1');
});

test('a field the keyboard would cover is moved clear of it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const field = editableField(screen, 'Note');
  const focus = screen.getByTestId('form-field-focus');
  await revealLowInPage(screen, field);

  // The claim is only worth making about a field that had somewhere to be covered, so
  // the row is parked at the bottom of the page and the premise is asserted below.
  // The measurement is the window manager's own `ime` inset, under a real keyboard.
  const beforeFocus = await boxOf(field);
  if (beforeFocus == null) {
    throw new Error(
      'real-input: the Note field has no box to place under a keyboard.'
    );
  }
  await expect(focus).toHaveText('no');
  await withRealKeyboard(async () => {
    await focusField(field);
    const focused = await textOf(screen, 'form-field-focus');
    expect(
      focused,
      'a real tap on the Note field did not focus it: the app still echoes ' +
        `"${focused}" (the field's box is ` +
        `${JSON.stringify(await boxOf(field))})`
    ).toBe('yes');
    const { keyboardTop } = await expectKeyboard();
    expect(
      beforeFocus.y + beforeFocus.height,
      `the premise of this check is missing: the field's bottom sat at ` +
        `${String(Math.round(beforeFocus.y + beforeFocus.height))} px, above the ` +
        `keyboard's top at ${String(Math.round(keyboardTop))} px, so nothing was ` +
        'ever covered and "it stayed above the keyboard" would be true of a Form ' +
        'that does nothing at all'
    ).toBeGreaterThan(keyboardTop);
    await fieldAboveKeyboard(field);
  });
});

test('a tap on a control inside a pressing row is the control’s, and a tap beside it is the row’s', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW_AND_SWITCH);
  const control = screen.getByLabel(SWITCH_IN_ROW);
  const presses = 'form-row-switch-presses';
  const changes = 'form-row-switch-changes';
  const value = screen.getByTestId('form-row-switch-value');
  await reveal(screen, row, { reads: [control] });

  // The row is asked to answer first: a row that never pressed at all would keep its
  // counter still for a tap on its switch too, and that silence is not the promise.
  const rowBox = await boxOf(row);
  const switchBox = await boxOf(control);
  if (rowBox == null || switchBox == null) {
    throw new Error(
      `real-input: the pressing row or its switch has no box to aim at: row ` +
        `${JSON.stringify(rowBox)}, switch ${JSON.stringify(switchBox)}.`
    );
  }
  const beside = { x: rowBox.x + 24, y: rowBox.y + rowBox.height / 2 };
  expect(
    beside.x < switchBox.x - 8,
    `the point meant for the row (${String(Math.round(beside.x))} px) is not clear ` +
      `of the switch's box ${JSON.stringify(switchBox)}, so the two taps would be ` +
      'the same tap'
  ).toBe(true);

  await screen.tapAt(beside);
  await expect(screen.getByTestId(presses)).toHaveText('1');
  await expect(screen.getByTestId(changes)).toHaveText('0');
  await expect(value).toHaveText('off');

  // The switch's own tap: the flip and its one change report are the whole answer.
  await screen.tapAt(await centreOf(control));
  await expect(value).toHaveText('on');
  await expect(screen.getByTestId(changes)).toHaveText('1');
  await staysAt(screen, presses, '1');

  // The row answers again after its content did: the rule is "whosever touch this
  // was", not a latch that swallows every row press after the first control tap.
  await screen.tapAt(beside);
  await expect(screen.getByTestId(presses)).toHaveText('2');
  await staysAt(screen, changes, '1');

  await screen.tapAt(await centreOf(control));
  await expect(value).toHaveText('off');
  await expect(screen.getByTestId(changes)).toHaveText('2');
  await staysAt(screen, presses, '2');
});

test('a tap on React Native content inside a pressing row is answered by both, and the row keeps answering its own', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW_AND_PRESSABLE);
  const control = screen.getByLabel(PRESSABLE_IN_ROW);
  const rowPresses = 'form-row-inner-presses';
  const innerPresses = 'form-row-inner-inner-presses';
  await reveal(screen, row, { reads: [control] });

  // The documented limit of the rule: a row gives its press up to a hosted control,
  // and React Native content cannot be told apart from plain content in the row's
  // box, so a `Pressable` inside a pressing row answers alongside the row. One tap,
  // both counters — the reading that would be wrong is either control alone.
  await screen.tapAt(await centreOf(control));
  await expect(screen.getByTestId(innerPresses)).toHaveText('1');
  await staysAt(screen, rowPresses, '1');

  // And the row is not harmed by it: its own tap, aimed beside the `Pressable` rather
  // than at the middle of the row, still presses the row and nothing inside it.
  const rowBox = await boxOf(row);
  const pressableBox = await boxOf(control);
  if (rowBox == null || pressableBox == null) {
    throw new Error(
      `real-input: the pressing row or its pressable has no box to aim at: row ` +
        `${JSON.stringify(rowBox)}, pressable ${JSON.stringify(pressableBox)}.`
    );
  }
  const beside = {
    x: rowBox.x + rowBox.width - 24,
    y: rowBox.y + rowBox.height / 2,
  };
  expect(
    beside.x > pressableBox.x + pressableBox.width + 8,
    `the point meant for the row (${String(Math.round(beside.x))} px) is not clear ` +
      `of the pressable's box ${JSON.stringify(pressableBox)}, so the two taps would ` +
      'be the same tap'
  ).toBe(true);

  await screen.tapAt(beside);
  await expect(screen.getByTestId(rowPresses)).toHaveText('2');
  await staysAt(screen, innerPresses, '1');
});

test('opting out of keyboard avoidance leaves the content and its offset alone', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const field = editableField(screen, 'Note');
  const focus = screen.getByTestId('form-field-focus');
  const avoid = screen.getByTestId('form-avoid-echo');
  const ruler = screen.getByText(CONTENT_RULER);

  // The toggle is tapped first, while the page is still at its top: this check travels to
  // the end of a long form twice, so it starts no further down it than it has to.
  await screen.getByLabel('Keyboard avoidance').tap();
  await expect(avoid).toHaveText('no');

  // The end of the list is where a reservation shows: content that grows under the last
  // row is content that moved. Both readings are taken there, once with no keyboard and
  // once with one.
  await reveal(screen, field);
  const path = await endDragPath(screen);
  const atEnd = await restingBoxAtEnd(screen, ruler, path);
  // Back to the field, and its box is taken once it is in reach: this is where it has
  // to stay, whatever the keyboard does to the content below it.
  await reveal(screen, field);
  const parked = await boxIfPresent(field);
  if (parked == null) {
    throw new Error(
      'real-input: the Note field has no box to watch for a move.'
    );
  }
  await expect(focus).toHaveText('no');

  await withRealKeyboard(async () => {
    await focusField(field);
    expect(
      await textOf(screen, 'form-field-focus'),
      'a real tap on the Note field did not focus it, so a Form that does nothing ' +
        'would look like a Form that opted out'
    ).toBe('yes');
    const { keyboardTop } = await expectKeyboard();
    const band = await tapBand(screen);
    expect(
      band.bottom - keyboardTop,
      `the premise of this check is missing: the keyboard is only ` +
        `${String(Math.round(band.bottom - keyboardTop))} px tall, so padding room ` +
        'for it would not be a change anything could see'
    ).toBeGreaterThan(120);

    // The field is where it was parked: no scroll for a keyboard the Form was told to
    // leave alone. Read again after the list has been travelled below, so a late scroll
    // has had half a minute to arrive.
    const afterFocus = await boxIfPresent(field);
    if (afterFocus == null) {
      throw new Error(
        `real-input: the focused Note field left the tree; it was parked at ` +
          `${JSON.stringify(parked)}.`
      );
    }
    expect(
      Math.abs(afterFocus.y - parked.y),
      `focusing the field left it ${String(
        Math.round(Math.abs(afterFocus.y - parked.y))
      )} px from where it was parked (${String(Math.round(parked.y))} px, now ` +
        `${String(Math.round(afterFocus.y))} px) with keyboard avoidance off: the Form ` +
        'scrolled for a keyboard it was told to leave alone'
    ).toBeLessThanOrEqual(2);

    const stillUp = await expectKeyboard();
    const after = await restingBoxAtEnd(screen, ruler, path);
    expect(
      Math.abs(after.y - atEnd.y),
      `the Form's content sits ${String(
        Math.round(atEnd.y - after.y)
      )} px higher at the end of its list with the keyboard up (top ` +
        `${String(Math.round(stillUp.keyboardTop))} px) than with no keyboard, which ` +
        "is what padding the bottom of its scroll content by the keyboard's own " +
        'height does to it'
    ).toBeLessThanOrEqual(12);
  });
});

/**
 * Read a counter, wait, and read it again.
 *
 * A press that arrives late is still a second press, and `toHaveText` is satisfied
 * by the first correct reading it sees.
 */
async function staysAt(
  screen: Screen,
  testId: string,
  text: string
): Promise<void> {
  await expect(screen.getByTestId(testId)).toHaveText(text);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  expect(
    await textOf(screen, testId),
    `"${testId}" moved off "${text}" while the screen was watched`
  ).toBe(text);
}

/**
 * A node's box, or `null` at once when it is not in the tree.
 *
 * `boundingBox` waits for a node to appear, and a row the list has recycled away never
 * does, so a scroll search that reads it blind pays the action timeout per read.
 */
async function boxIfPresent(locator: Locator): Promise<Box | null> {
  if ((await locator.count()) === 0) return null;
  return boxOf(locator);
}

/**
 * The drag that pulls the list to its end, measured while nothing is above it.
 *
 * The path cannot be read once a keyboard is up: the IME's own window carries the
 * same `android:id/content` id, so the content view is two nodes by then. The travel
 * stays in the top half of the band, where a keyboard cannot be.
 */
async function endDragPath(
  screen: Screen
): Promise<{ from: Point; to: Point }> {
  const content = await boxOf(screen.getByTestId(CONTENT_ROOT));
  const band = await tapBand(screen);
  if (content == null) {
    throw new Error('real-input: the content view has no box to drag along.');
  }
  const span = band.bottom - band.top;
  const from = {
    x: content.x + content.width * 0.05,
    y: band.top + span * 0.5,
  };
  return { from, to: { x: from.x, y: band.top + span * 0.1 } };
}

/**
 * Where a row comes to rest when the list is dragged to its end.
 *
 * Two drags that move the row no further is the end of the content: it is the one
 * reading of "the list cannot travel" that does not need the last row to be somewhere
 * the keyboard is not standing in.
 */
async function restingBoxAtEnd(
  screen: Screen,
  ruler: Locator,
  path: { from: Point; to: Point }
): Promise<{ y: number; height: number }> {
  const { from, to } = path;
  let last: { y: number; height: number } | null = null;
  let unmoved = 0;
  for (let dragNumber = 1; dragNumber <= 14; dragNumber += 1) {
    await drag(screen, from, to, 500);
    const box = await boxIfPresent(ruler);
    if (box == null) {
      unmoved = 0;
      last = null;
      continue;
    }
    unmoved = last != null && Math.abs(box.y - last.y) <= 1 ? unmoved + 1 : 0;
    last = box;
    if (unmoved >= 2) return box;
  }
  throw new Error(
    'real-input: the list never came to rest on its end within 14 drags; the ' +
      `"${CONTENT_RULER}" row reads ${JSON.stringify(last)}.`
  );
}

/**
 * Park a control low in its page, where the keyboard will reach it.
 *
 * A control parked in the middle of the band is already clear of a keyboard that only
 * occupies the bottom of the screen, which would make an avoidance check vacuous.
 */
async function revealLowInPage(
  screen: Parameters<typeof reveal>[0],
  locator: Parameters<typeof reveal>[1]
): Promise<void> {
  await reveal(screen, locator);
  for (let nudge = 0; nudge < 6; nudge += 1) {
    const box = await boxOf(locator);
    const band = await tapBand(screen);
    if (box == null) return;
    if (box.y + box.height > band.top + (band.bottom - band.top) * 0.8) return;
    // The finger travels down, which is what carries the row down towards the
    // bottom edge; a fling would overshoot and lift it out of the band instead.
    await drag(
      screen,
      { x: box.x + box.width / 2, y: box.y },
      { x: box.x + box.width / 2, y: box.y + 160 }
    );
  }
}
