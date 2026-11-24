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
} from './support';
import { actsOnOneNamedNode } from './reader';
import { adbShell } from './device-read';
import { tree, type TreeNode } from './os-tree';
import {
  expectKeyboard,
  fieldAboveKeyboard,
  focusField,
  withRealKeyboard,
} from './keyboard';
import {
  imeInsetSample,
  imeInsetTop,
} from '../../../scripts/real-input/ime-frame.mjs';

const ROW = 'Row with onPress';

/** A row with `onPress` that has a hosted `Switch` in it. */
const ROW_AND_SWITCH = 'Row with onPress and a switch';
const SWITCH_IN_ROW = 'Switch in a pressed row';

/** The same pair with React Native's own `Pressable` in place of the switch. */
const ROW_AND_PRESSABLE = 'Row with onPress and a pressable';
const PRESSABLE_IN_ROW = 'Pressable inside a pressed row';

/** A row with `onPress` whose content is a nitro-ui wrapper around React Native text. */
const ROW_AND_CONTEXT_MENU = 'Row with onPress and a context menu';
const CONTEXT_MENU_IN_ROW = 'form-row-context-menu';

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
    try {
      await fieldAboveKeyboard(field);
    } catch (failure) {
      throw withKeyboardEvidence(
        failure,
        await keyboardEvidence(screen, field)
      );
    }
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

test('a tap on a nitro-ui wrapper of React Native content inside a pressing row is the row’s', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW_AND_CONTEXT_MENU);
  const wrapper = screen.getByTestId(CONTEXT_MENU_IN_ROW);
  const presses = 'form-row-context-presses';
  const opens = 'form-row-context-opens';
  await reveal(screen, row, { reads: [wrapper] });

  // The tap has to land on the nitro-ui view rather than in the row's own padding: a
  // point the row holds alone is green whatever it makes of a wrapper's children.
  const wrapperBox = await boxOf(wrapper);
  const rowBox = await boxOf(row);
  if (wrapperBox == null || rowBox == null) {
    throw new Error(
      `real-input: the context menu or its row has no box to aim at: menu ` +
        `${JSON.stringify(wrapperBox)}, row ${JSON.stringify(rowBox)}.`
    );
  }
  const onMenu = {
    x: wrapperBox.x + wrapperBox.width / 2,
    y: wrapperBox.y + wrapperBox.height / 2,
  };
  expect(
    onMenu.x > rowBox.x &&
      onMenu.x < rowBox.x + rowBox.width &&
      onMenu.y > rowBox.y &&
      onMenu.y < rowBox.y + rowBox.height,
    `the point meant for the context menu ${JSON.stringify(
      onMenu
    )} is not inside the row's box ${JSON.stringify(
      rowBox
    )}, so this tap would not be a tap on the row at all`
  ).toBe(true);

  await screen.tapAt(onMenu);
  // One press for one tap, and no menu: a tap that opened the menu answered with a
  // popup, not with the row.
  await expect(screen.getByTestId(presses)).toHaveText('1');
  await staysAt(screen, opens, '0');
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

/**
 * The failure-path reads of the keyboard case.
 *
 * `fieldAboveKeyboard` fails with what the *locator* could not resolve, which is not the
 * same claim as "the field sits under the keyboard". The two come apart exactly as this
 * case cannot tell them apart on its own: a keyboard can go away while the app still
 * echoes a focused field, and a focused field can be there in the accessibility tree and
 * still be one the driver will not name. The device's own keyboard reads and the driver's
 * own tree answer that, so they are read here — and only once a read has already failed.
 * A `uiautomator dump` is not among them: while this run holds the device's
 * accessibility connection, that read cannot answer.
 */

/** The class that holds a caret, in the tree's own words. */
const EDITABLE_CLASS = /EditText/;

/** How many nodes the failure prints below the field, or naming it. */
const EVIDENCE_NODES = 10;

/** The title of the field this case cannot read, as the app announces it. */
const FIELD_TITLE = 'Note';

/** One failure-path read, or the reason it has no answer. */
async function evidenceLine(
  what: string,
  read: () => string | Promise<string>
): Promise<string> {
  try {
    return `- ${what}: ${await read()}`;
  } catch (error) {
    const reason = String((error as Error)?.message ?? error).split('\n')[0];
    return `- ${what}: this read failed - ${reason ?? 'nothing said'}`;
  }
}

/**
 * The device's own account of the keyboard, from two places that disagree usefully.
 *
 * The inset is the number the app is told and the one this case measures against; the
 * input method service's `mInputShown` is whether a person can see a keyboard. A keyboard
 * that closed while the field stayed focused reads differently in the two than a keyboard
 * that never went away does.
 */
function deviceKeyboardEvidence(): string[] {
  const activity = adbShell(['dumpsys', 'activity', 'top']);
  const inset = imeInsetTop(activity);
  return [
    `- keyboard, the window manager's ime inset for this app: ${
      inset == null
        ? 'no visible keyboard to measure'
        : `top at ${String(Math.round(inset))} px`
    }; the dump says "${imeInsetSample(activity)}"`,
    `- keyboard, the input method service says: ${inputMethodServiceSays()}`,
  ];
}

/** The keys of the service's own state that say what it is showing, and to whom. */
const SERVICE_STATE = /\b(mInputShown|mInputEditorInfo|visibleTopInsets)\b/;

/**
 * The service's own lines, printed rather than parsed.
 *
 * The harness reads these, but the typed bridge in front of those readers carries the
 * inset alone; a failure gets the dump's words, so a renamed line shows up as a line that
 * is simply missing instead of a wrong answer.
 */
function inputMethodServiceSays(): string {
  const lines = adbShell(['dumpsys', 'input_method'])
    .split('\n')
    .filter((line) => SERVICE_STATE.test(line))
    .map((line) => line.trim());
  if (lines.length === 0) {
    return 'nothing: the dump carries no mInputShown or mInputEditorInfo line';
  }
  return lines.slice(0, 4).join(' / ').slice(0, 400);
}

/**
 * Every node of the driver's own snapshot whose words carry the missing field's title,
 * whatever class or role it has - the read that answers whether the field is in the tree
 * the driver resolves at all.
 *
 * A hint is one of those words: the driver prints an empty field's hint as the label it
 * is announced with, which lands on `text` or on `contentDesc` depending on whether the
 * node also carries a value.
 */
function notedNodes(): string {
  const nodes = tree({ unmerged: true });
  const named = nodes.filter((node) => carriesTheTitle(node));
  const head =
    `its snapshot holds ${String(nodes.length)} node(s), ` +
    `${String(named.length)} of them carrying "${FIELD_TITLE}" in its words`;
  if (named.length === 0) return `${head}: none`;
  return (
    `${head}: ${named
      .slice(0, EVIDENCE_NODES)
      .map((node) => `\n    ${noteLine(node)}`)
      .join('')}` +
    (named.length > EVIDENCE_NODES
      ? `\n    … and ${String(named.length - EVIDENCE_NODES)} more`
      : '')
  );
}

/** Whether this node's own words - text, content description or hint - name the field. */
function carriesTheTitle(node: TreeNode): boolean {
  const words = `${node.text} ${node.contentDesc}`.toLowerCase();
  return words.includes(FIELD_TITLE.toLowerCase());
}

/** One node the driver can see, with the flags and the box it would answer with. */
function noteLine(node: TreeNode): string {
  return (
    `${node.className || 'no class'} ` +
    `focusable=${node.focusable || 'not written'} ` +
    `hittable=${node.hittable || 'not written'} ` +
    `enabled=${node.enabled} ` +
    `text="${node.text}" announced="${node.contentDesc}" ` +
    `bounds=[${String(node.bounds.x1)},${String(node.bounds.y1)}]` +
    `[${String(node.bounds.x2)},${String(node.bounds.y2)}]`
  );
}

/** The editable nodes the driver itself can see, with the boxes it would answer with. */
function driverTree(): string {
  const nodes = tree({ unmerged: true });
  const editable = nodes.filter((node) => EDITABLE_CLASS.test(node.className));
  const shown = editable
    .slice(0, EVIDENCE_NODES)
    .map(
      (node) =>
        `${node.className} "${node.contentDesc || node.text || '(no words)'}" ` +
        `focusable=${node.focusable || 'not written'} ` +
        `bounds=[${String(node.bounds.x1)},${String(node.bounds.y1)}]` +
        `[${String(node.bounds.x2)},${String(node.bounds.y2)}]`
    )
    .join('; ');
  return (
    `its snapshot holds ${String(nodes.length)} node(s), ` +
    `${String(editable.length)} of them editable` +
    (shown === '' ? '' : `: ${shown}`)
  );
}

/** What the app and the device say while the field cannot be read. */
async function keyboardEvidence(
  screen: Screen,
  field: Locator
): Promise<string> {
  return [
    'Did the keyboard close while the field stayed focused? These are the reads that ' +
      'answer it, taken while the field could not be read:',
    ...deviceKeyboardEvidence(),
    await evidenceLine("the app's focus echo", () =>
      textOf(screen, 'form-field-focus')
    ),
    await evidenceLine("the app's avoidance echo", () =>
      textOf(screen, 'form-avoid-echo')
    ),
    await evidenceLine('what the driver resolves now', async () => {
      const named = String(await field.count());
      const any = String(await screen.getByRole('textbox').count());
      return `the field this case reads: ${named} node(s); every textbox on the screen: ${any} node(s)`;
    }),
    await evidenceLine("the driver's own tree", () => driverTree()),
    await evidenceLine(
      `the driver's nodes whose words carry "${FIELD_TITLE}"`,
      () => notedNodes()
    ),
  ].join('\n');
}

/**
 * The evidence on the failure itself, so the driver's own verdict stays the first line.
 *
 * The error object goes back unchanged - its code is what the run's trace headlines with.
 */
function withKeyboardEvidence(failure: unknown, evidence: string): Error {
  const message = String((failure as Error | null)?.message ?? failure);
  const error = failure instanceof Error ? failure : new Error(message);
  error.message = `${message}\n\n${evidence}`;
  return error;
}
