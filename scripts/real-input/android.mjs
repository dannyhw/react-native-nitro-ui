#!/usr/bin/env node
/**
 * Real-input checks on Android: `adb shell input` delivers the touch, and
 * `uiautomator dump` is the only thing the assertions read.
 *
 * `adb shell input tap/swipe` injects events into the system InputManager, so
 * they travel InputDispatcher → window → React Native's touch handler → the
 * hosted Compose control, exactly as a finger does. That is the point of this
 * suite: `react-native-harness` drives controls through in-app hooks and has
 * never proved that path works (docs/tasks/T15-real-input.md).
 *
 * Nothing here attaches to the app's process or talks to Nitro. Every asserted
 * value is read out of the accessibility tree - what a screen reader, and a
 * person, has.
 *
 * Usage (devices and ports come from the environment, as everywhere else here):
 *
 *   ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=<port> METRO_PORT=<port> \
 *     bun run test:real-input:android [--control <id>]   # ids: controls.mjs
 *
 * The emulator must already be booted: AGENTS.md says only touch devices you
 * started, so this script boots nothing and shuts nothing down.
 */

import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';

import {
  AbortedCheck,
  artifactsDir,
  blockMs,
  chosenControls,
  ensureMetro,
  run,
  sleep,
  Suite,
} from './support.mjs';
import { REAL_INPUT_CONTROLS } from './controls.mjs';
import {
  findByDescription,
  findByTestId,
  findTab,
  parseHierarchy,
} from './uiautomator.mjs';
import { assertSupportedNode } from '../node-version.mjs';

// One Node across every device gate: the harness cannot run on Node 25/26 at
// all, so a real-input run on that runtime is not comparable evidence.
assertSupportedNode({ command: 'bun run test:real-input:android' });

const BUNDLE_ID = 'nitroui.example';
const ACTIVITY = `${BUNDLE_ID}/.MainActivity`;

/** The on-screen echoes the checks read (testIDs from `example/src`). */
const ECHO = {
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
};

/** How long a control gets to react to a gesture it should have answered. */
const REACT_TIMEOUT = Number(process.env.REAL_INPUT_TIMEOUT ?? 8000);
/** How long the first render may take (a cold Metro bundle is slow). */
const READY_TIMEOUT = Number(process.env.REAL_INPUT_READY_TIMEOUT ?? 180000);

/**
 * ## Adding a control
 *
 * Add one entry here, one in `scripts/real-input/controls.mjs`, and one iOS
 * check in `example/ios/NitroUiExampleUITests/RealInputTests.swift`. A control
 * listed in the table but missing here is reported as a failure, never skipped.
 *
 * Each check gets the `t` object from `makeContext`: it is the only way in, so a
 * check cannot reach adb, Nitro or the app process by accident.
 */
const CHECKS = {
  /**
   * A real tap must flip the hosted Material 3 Switch and bring the new value
   * back to React. The echo is React's own render, so it only changes if the
   * touch reached Compose, Compose told Nitro, and Nitro told JS.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'switch': async (t) => {
    const control = await t.requireControl('Controlled switch');
    const before = t.requireEcho(ECHO.switchValue);
    t.log.checkEquals('the Switch starts off', before, 'off');

    await t.tapNode(control);
    const flipped = t.waitForEchoToChange(
      ECHO.switchValue,
      before,
      'a real tap to register'
    );
    t.log.checkEquals(
      'one real tap flips the Switch (React renders "on")',
      flipped,
      'on'
    );

    await t.tapNode(control);
    const back = t.waitForEchoToChange(
      ECHO.switchValue,
      'on',
      'a second real tap to register'
    );
    t.log.checkEquals(
      'a second real tap flips it back (React renders "off")',
      back,
      'off'
    );
  },

  /**
   * A real drag must move the thumb and report every phase.
   *
   * The phases Slider is uncontrolled and counts each callback separately, so a
   * missing `onSlidingStart` cannot hide behind an `onValueChange` that still
   * worked. The controlled Slider is dragged too: there the echo is React's own
   * state, so it proves the whole loop - touch → Compose → Nitro → JS →
   * re-render → value back down to native - with nothing but a finger in it.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'slider': async (t) => {
    const phases = await t.requireControl('Phases slider');
    t.log.checkEquals(
      'no gesture has been reported yet',
      `${t.requireEcho(ECHO.sliderStart)} ${t.requireEcho(
        ECHO.sliderChange
      )} ${t.requireEcho(ECHO.sliderComplete)}`,
      'start=0 change=0 complete=0'
    );

    // Press down a quarter of the way along the track and release three quarters
    // of the way in: both ends are inside the track and away from its rounded
    // caps, where a press can miss the control.
    await t.dragControl(phases, 0.25, 0.75, 800);
    t.waitForEcho(ECHO.sliderComplete, 'complete=1', 'one drag to finish');
    t.log.checkEquals(
      'one drag fires onSlidingStart exactly once',
      t.requireEcho(ECHO.sliderStart),
      'start=1'
    );
    t.log.checkEquals(
      'one drag fires onSlidingComplete exactly once',
      t.requireEcho(ECHO.sliderComplete),
      'complete=1'
    );
    const changeText = t.requireEcho(ECHO.sliderChange);
    t.log.check(
      `a drag reports the way over, not only the end (${changeText})`,
      Number(changeText.replace('change=', '')) >= 2
    );
    const landed = t.value(ECHO.sliderValue);
    t.log.check(
      `the thumb lands right of centre (${t.requireEcho(ECHO.sliderValue)})`,
      landed != null && landed > 0.6
    );

    await t.dragControl(phases, 0.75, 0.25, 800);
    t.waitForEcho(ECHO.sliderComplete, 'complete=2', 'a second drag to finish');
    t.log.checkEquals(
      'a second drag fires both phases again',
      `${t.requireEcho(ECHO.sliderStart)} ${t.requireEcho(ECHO.sliderComplete)}`,
      'start=2 complete=2'
    );
    const backValue = t.value(ECHO.sliderValue);
    t.log.check(
      `dragging back moves the value the other way (${t.requireEcho(
        ECHO.sliderValue
      )})`,
      backValue != null && backValue < 0.4
    );

    const controlled = await t.requireControl('Controlled slider');
    const before = t.value(ECHO.sliderControlledValue);
    t.log.checkEquals('the controlled Slider starts at 0.25', before, 0.25);
    await t.dragControl(controlled, 0.2, 0.8, 800);
    const after = t.waitForValueToRise(
      ECHO.sliderControlledValue,
      before,
      'a real drag to reach React'
    );
    t.log.check(
      `the controlled value echo follows the real drag (${String(before)} → ${String(after)})`,
      after != null && after > before + 0.2
    );
  },

  /**
   * A real tap must reach the hosted Button's `onPress`, and a real tap on a
   * disabled one must not.
   *
   * The two Buttons share one counter, which is what makes the disabled half
   * mean something: `onPress` is passed to it as well, so a library that let a
   * disabled control fire would move the number. The counter is React's own
   * render, so it only moves if the touch reached Compose, Compose told Nitro,
   * and Nitro told JS.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'button': async (t) => {
    const control = await t.requireControl('Real-input button');
    const disabled = await t.requireControl('Real-input disabled button');
    t.log.checkEquals(
      'the Button starts with no presses recorded',
      t.requireEcho(ECHO.buttonCount),
      '0'
    );

    await t.tapNode(control);
    const first = t.waitForEcho(
      ECHO.buttonCount,
      '1',
      'a real tap to reach onPress'
    );
    t.log.checkEquals(
      'one real tap on the enabled Button reaches onPress',
      first,
      '1'
    );

    // The disabled one gets the same tap. Nothing should happen, and the way to
    // say that is to keep watching the same number the enabled Button moves.
    await t.tapNode(disabled);
    const afterDisabled = t.requireEchoToStay(
      ECHO.buttonCount,
      '1',
      'a tap on the disabled Button to be refused'
    );
    t.log.checkEquals(
      'a real tap on the disabled Button does not press it',
      afterDisabled,
      '1'
    );

    // And the counter is still live: without this, the line above could have
    // passed because the app stopped rendering rather than because the disabled
    // Button refused the touch.
    await t.tapNode(control);
    const second = t.waitForEcho(
      ECHO.buttonCount,
      '2',
      'a second real tap to reach onPress'
    );
    t.log.checkEquals(
      'a second real tap presses the enabled Button again',
      second,
      '2'
    );
  },

  /**
   * A real tap must select the segment under the finger, and a selection the app
   * refuses must go back.
   *
   * The uncontrolled half is the plain claim: a touch at the middle of the second
   * segment makes React render `1`, and one at the first makes it render `0`.
   * `SingleChoiceSegmentedButtonRow` gives every segment an equal share of the
   * row, and the options are single digits, so a fraction of the row is a
   * fraction of a segment on both platforms. Both echoes are React's own text, so
   * they only move if the touch reached Compose, Compose told Nitro, and Nitro
   * told JS.
   *
   * The controlled half is the harder one, and its witness is a count. The parent
   * keeps sending `selectedIndex={0}`, so after a tap on segment 2 the control
   * must snap back to segment 1 - and a snapshot of the screen cannot prove that,
   * because the screen looks identical before and after a snap. So the check taps
   * segment 2 *twice*: a control that had stayed on segment 2 would treat the
   * second tap as a tap on the segment that is already chosen and report nothing
   * (Material 3's `SegmentedButton` only calls `onClick` for a change of
   * selection). Two reported changes with the parent's value never moving is
   * therefore the snap-back. This is `RealInputTests.testRealInputSegmentedControl`
   * on the other platform, assertion for assertion.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'segmented-control': async (t) => {
    const control = await t.requireControl('Real-input segmented control');
    const startedAt = t.boundsText(control);
    t.log.checkEquals(
      'the SegmentedControl has reported no index before a touch',
      t.requireEcho(ECHO.segmentedIndex),
      '-'
    );
    t.log.checkEquals(
      'no change has been reported before a touch',
      t.requireEcho(ECHO.segmentedEvents),
      '0'
    );

    await t.tapControlAt(control, 0.5);
    t.log.checkEquals(
      'a real tap on the second segment reaches JS as index 1',
      t.waitForEcho(ECHO.segmentedIndex, '1', 'a real tap to register'),
      '1'
    );
    t.log.checkEquals(
      'one tap reports one change',
      t.requireEcho(ECHO.segmentedEvents),
      '1'
    );

    const moved = await t.requireControl('Real-input segmented control');
    t.log.checkEquals(
      'the control did not move out from under the finger',
      t.boundsText(moved),
      startedAt
    );

    // A different segment, so a second change is owed: a control that reported the
    // same index twice would also satisfy the line above by echoing once.
    await t.tapControlAt(moved, 0.12);
    t.log.checkEquals(
      'a real tap on the first segment reaches JS as index 0',
      t.waitForEcho(ECHO.segmentedIndex, '0', 'a second real tap to register'),
      '0'
    );
    t.log.checkEquals(
      'two taps report two changes',
      t.requireEcho(ECHO.segmentedEvents),
      '2'
    );

    // The refusing parent.
    const rejecting = await t.requireControl(
      'Real-input rejecting segmented control'
    );
    t.log.checkEquals(
      'the refusing parent pins its SegmentedControl at index 0',
      t.requireEcho(ECHO.rejectValue),
      '0'
    );
    t.log.checkEquals(
      'nothing has been reported on the controlled control yet',
      t.requireEcho(ECHO.rejectEvents),
      '0'
    );

    await t.tapControlAt(rejecting, 0.5);
    t.log.checkEquals(
      'a real tap on the controlled control still reaches JS - native paints optimistically (core.md section 4)',
      t.waitForEcho(ECHO.rejectEvents, '1', 'the controlled tap to register'),
      '1'
    );
    t.log.checkEquals(
      'the parent never accepted the change, so the index it sends is still 0',
      t.requireEcho(ECHO.rejectValue),
      '0'
    );

    // The snap-back oracle, explained above: this tap can only be reported if the
    // selection went back to the first segment.
    await t.tapControlAt(rejecting, 0.5);
    t.log.checkEquals(
      'a second tap on segment 2 is a fresh selection, which is only true if the refused one was rolled back',
      t.waitForEcho(ECHO.rejectEvents, '2', 'the repeated tap to register'),
      '2'
    );
    t.log.checkEquals(
      'and the parent should still be refusing',
      t.requireEcho(ECHO.rejectValue),
      '0'
    );
  },

  /**
   * A real tap must open the Material 3 date dialog, a tap on one of its day
   * cells must reach JS as a new instant, and a parent that refuses it has to
   * snap the field back.
   *
   * Two things make this check longer than the Switch's. The dialog is a *second
   * window*, so while it is open the app's own text is simply absent from the
   * tree: the dialog's cells are read, then the echo is read after the dialog
   * closes. And a day cell is a Compose semantics node with no testID - it names
   * itself with a localised date - so the check aims at a cell in the middle of
   * the grid, and retries: the day already showing reports nothing (the
   * same-value rule core.md section 4), which from outside would look exactly
   * like a touch path that does not work.
   *
   * This is `RealInputTests.testRealInputDatePicker` on the other platform,
   * assertion for assertion.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'date-picker': async (t) => {
    t.log.checkEquals(
      'the DatePicker has reported no day before a touch',
      t.requireEcho(ECHO.dateValue),
      '-'
    );
    t.log.checkEquals(
      'no change has been reported before a touch',
      t.requireEcho(ECHO.dateEvents),
      '0'
    );

    // The uncontrolled picker: the parent stores what it is told, so the echo is
    // the pick. Three aims, because a pick of the day the picker already shows is
    // a correct no-op - and Material 3 gives an outside observer no flag to avoid
    // it with (verified against a dialog dump: the selected cell is not marked
    // `selected`, and today's cell only says so in its label).
    const attempts = [0, 7, -7];
    let picked = null;
    for (const offset of attempts) {
      const day = await openAndPick(t, 'Real-input date picker', offset);
      if (t.echoWithin(ECHO.dateEvents, (v) => v === '1') === '1') {
        picked = day;
        break;
      }
    }
    t.log.checkEquals(
      `a real tap on a dialog day (${picked ?? 'no pick reported'}) reaches JS as a change`,
      t.requireEcho(ECHO.dateEvents),
      '1'
    );
    const shown = t.requireEcho(ECHO.dateValue);
    t.log.check(
      `the day JS was told is the day React paints: "${shown}" is Y-M-D, written by ` +
        'hand so that no locale can move the assertion',
      /^\d{4}-\d{2}-\d{2}$/.test(shown)
    );

    // The refusing parent: same touch path, and the two assertions core.md
    // section 4 is about - the pick was reported, and the day did not move.
    const rejecting = 'Real-input rejecting date picker';
    const PINNED = '2024-06-15';
    t.log.checkEquals(
      'the refusing parent pins its DatePicker to one day',
      t.requireEcho(ECHO.rejectValue),
      PINNED
    );
    t.log.checkEquals(
      'nothing has been reported on the controlled control yet',
      t.requireEcho(ECHO.rejectEvents),
      '0'
    );
    for (const offset of attempts) {
      await openAndPick(t, rejecting, offset);
      if (t.echoWithin(ECHO.rejectEvents, (v) => v === '1') === '1') {
        break;
      }
    }
    t.log.checkEquals(
      'a real tap on the controlled control still reaches JS - native paints optimistically (core.md section 4)',
      t.requireEcho(ECHO.rejectEvents),
      '1'
    );
    t.log.checkEquals(
      'the parent never accepted the change, so the day it sends is unchanged',
      t.requireEcho(ECHO.rejectValue),
      PINNED
    );
    // The snap-back oracle, as on the SegmentedControl: another pick is only a
    // fresh selection - so can only report a second change - once the refused one
    // has been rolled back.
    for (const offset of attempts) {
      await openAndPick(t, rejecting, offset);
      if (t.echoWithin(ECHO.rejectEvents, (v) => v === '2') === '2') {
        break;
      }
    }
    t.log.checkEquals(
      'a second pick is a fresh selection, which is only true if the refused one was rolled back',
      t.requireEcho(ECHO.rejectEvents),
      '2'
    );
    t.log.checkEquals(
      'and the parent should still be refusing',
      t.requireEcho(ECHO.rejectValue),
      PINNED
    );

    // The inline calendar's own write guard: a tap back onto the day the model last
    // wrote has to reach JS. The dialog above cannot show this (its selection is
    // provisional and the model is written once, on OK), and `nuiTestSelect` cannot
    // reach it either: the test seam writes through the model, which is exactly what
    // the guard exists to ignore. So it is the inline calendar, tapped for real.
    await tapBackToTheDisplayedDay(t);
  },
};

/**
 * Tap back onto the day an inline calendar is showing, and require that JS is told.
 *
 * `syncDatePicker` remembers the day it last wrote into Material 3's state so that
 * `LaunchedEffect(selected)` can tell the model's own write from a person's tap.
 * Writing that memory only on the branch that *had* to write left it on the day from
 * before an accepted pick - and the next tap, back onto that day, then reads as the
 * model's own write: nothing is emitted, and the calendar snaps forward under the
 * finger. A pick the parent accepted needs no write, which is precisely the case the
 * memory was missing.
 *
 * Aimed by the accessibility tree, asserted only through the app's own hand-written
 * echoes (`change-count`, `controlled-value`): the cells call themselves "Thursday,
 * January 1, 2026", and the only thing read out of that is the day and year at its
 * end, so no locale can move an assertion.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
async function tapBackToTheDisplayedDay(t) {
  const COUNT = 'change-count';
  const VALUE = 'controlled-value';
  // The tab bar is pinned to the top of the window and draws over whatever the page
  // scrolls under it: a "cell" up there is a tab as far as `adb shell input` is
  // concerned, so the band a tap may aim at starts below it.
  const bandTop = 250;

  // The echoes that say what a tap did sit under a calendar taller than the screen,
  // so scroll until they are readable at all...
  for (
    let attempt = 0;
    attempt < 6 && t.nodeByTestId(VALUE) == null;
    attempt += 1
  ) {
    await t.scrollPage(350);
  }
  if (t.nodeByTestId(VALUE) == null) {
    t.log.abort(
      `no "${VALUE}" echo on screen after scrolling the date-picker page - the ` +
        'inline calendar cannot be checked without the text that says what a tap did'
    );
  }
  const baseline = t.requireEcho(VALUE);
  const shown = baseline.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (shown == null) {
    t.log.abort(
      `"${VALUE}" reads "${baseline}", which is not Y-M-D as this screen writes it`
    );
  }
  const shownDay = Number(shown[3]);
  const shownYear = Number(shown[1]);

  // ...then ease back up until the *first* cell of the grid is inside the band. The
  // first cell of a Material 3 page is its 1st, so when that cell is also the day the
  // value names, the grid is on the value's month and `a` is the day to come back to.
  /** @type {{ a: import('./uiautomator.mjs').UiautomatorNode, b: import('./uiautomator.mjs').UiautomatorNode, bDay: number } | null} */
  let aimed = null;
  for (let attempt = 0; attempt < 8 && aimed == null; attempt += 1) {
    const echoNode = t.nodeByTestId(VALUE);
    if (echoNode != null) {
      const cells = t
        .dump()
        .filter(
          (node) =>
            isDayCell(node) &&
            node.bounds.y1 >= bandTop &&
            node.bounds.y2 <= echoNode.bounds.y1
        )
        .sort(
          (left, right) =>
            left.bounds.y1 - right.bounds.y1 || left.bounds.x1 - right.bounds.x1
        );
      const first = cells[0];
      const firstDay = dayNumberAtEnd(first?.text ?? '');
      if (
        first != null &&
        cells.length >= 14 &&
        firstDay === shownDay &&
        yearAtEnd(first.text) === shownYear
      ) {
        const far = cells.find((node) => {
          const day = dayNumberAtEnd(node.text);
          return day != null && Math.abs(day - shownDay) >= 7;
        });
        const last = cells[cells.length - 1];
        const b = far ?? (dayNumberAtEnd(last.text) !== shownDay ? last : null);
        if (b != null) {
          aimed = { a: first, b, bDay: dayNumberAtEnd(b.text) ?? -1 };
        }
      }
      t.log.note(
        `grid: ${String(cells.length)} cells in the band, first = ` +
          `"${first?.text ?? '-'}", value = "${baseline}"`
      );
    }
    if (aimed == null) {
      await t.scrollPage(-250);
    }
  }
  if (aimed == null) {
    t.log.abort(
      `never found a month grid whose first cell is the value's own day ` +
        `("${baseline}") with another day at least a week away on screen`
    );
  }
  const { a, b, bDay } = aimed;

  // The day the control was built with is the day its guard remembers, so tapping it
  // first is the documented no-op - the same instant twice is not a change on either
  // platform. It is also this check's own proof that `a` is the cell the model holds,
  // which is what makes the red below about the fix and not about the aim.
  await t.tapNode(a);
  t.requireEchoToStay(
    COUNT,
    '0',
    'a tap on the day the calendar already shows'
  );

  await t.tapNode(b);
  t.waitForEcho(COUNT, '1', `a real tap on another day (day ${String(bDay)})`);
  const afterB = t.requireEcho(VALUE);
  t.log.check(
    `the tap moved the value it is echoing: "${afterB}" is not "${baseline}"`,
    afterB !== baseline
  );

  // The bug: back onto the day it came from. With the memory written only where a
  // write happened, this emitted nothing and the calendar snapped forward again.
  await t.tapNode(a);
  t.waitForEcho(
    COUNT,
    '2',
    'the tap back onto the previous day - the snap-back leaves this at 1'
  );
  t.log.checkEquals(
    'and the day it accepted is the instant that day echoed before, time of day kept',
    t.requireEcho(VALUE),
    baseline
  );

  // The guard is not simply gone: the pick after the returned one is still a fresh
  // selection, and one write per pick is what the exact counts above say.
  await t.tapNode(b);
  t.waitForEcho(COUNT, '3', 'a pick after the returned one to be fresh');
}

/**
 * The day of month at the end of a Material 3 day cell's own name, or `null`.
 *
 * Cells name themselves with a localised date - "Thursday, January 1, 2026", and
 * "Today, Sunday, October 25, 2026" for today - whose last two numbers are the day
 * and the year in every locale this emulator offers. Only those are read.
 *
 * @param {string} label
 */
function dayNumberAtEnd(label) {
  const match = label.match(/(\d{1,2})\D{0,3}\d{4}\s*$/);
  return match == null ? null : Number(match[1]);
}

/**
 * @param {string} label
 */
function yearAtEnd(label) {
  const match = label.match(/(\d{4})\s*$/);
  return match == null ? null : Number(match[1]);
}

/**
 * Open a `compact` picker's dialog, tap one day cell, and confirm.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} description the field's `accessibilityLabel`
 * @param {number} offset how far from the middle of the grid to aim, for a retry
 * @returns {Promise<string>} what the tapped cell called itself, for the report
 */
async function openAndPick(t, description, offset) {
  const field = await t.requireControl(description);
  await t.tapNode(field);
  const cells = dayGrid(t, description);
  const middle = Math.floor(cells.length / 2);
  const target =
    cells[Math.min(cells.length - 1, Math.max(0, middle + offset))];
  t.log.note(`tapping dialog day "${target.text}"`);
  await t.tapNode(target);
  // The dialog is a window of its own, so the app's text is unreadable until it
  // closes - which is what the confirm button, and nothing else, does.
  const confirm = t.waitForNodes(
    isConfirmLabel,
    "the dialog's OK button",
    1
  )[0];
  await t.tapNode(confirm);
  await t.settle(500);
  return target.text;
}

/**
 * The day cells of an open Material 3 date dialog, in reading order.
 *
 * What the cells actually look like was read out of a dump of the running dialog,
 * not guessed: a cell is a *clickable* node whose own `text` is the localised
 * date ("Sunday, October 4, 2026", and "Today, Sunday, October 25, 2026" for
 * today), and it is square. That filter is what excludes the things in the dialog
 * that also name a date: the headline ("Oct 25, 2026", not clickable), the month
 * toggle ("October 2026", not clickable) and the weekday headers (no year).
 *
 * Cells whose box is `[0,0][0,0]` are Compose's off-screen ones - the tree keeps
 * them, and they cannot be touched - so the box has to be real.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} description what to name in the failure line
 */
function dayGrid(t, description) {
  const cells = t.waitForNodes(
    isDayCell,
    `${description}'s dialog to open with a month grid`,
    14
  );
  // Reading order, so the middle of the list is the middle of the month: furthest
  // from the 1st, the 30th and today, which are the days a picker may be showing.
  return cells.sort(
    (a, b) => a.bounds.y1 - b.bounds.y1 || a.bounds.x1 - b.bounds.x1
  );
}

/**
 * A day cell of Material 3's calendar: clickable, square, and named with a date
 * that carries its year.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 */
function isDayCell(node) {
  const { width, height } = node.bounds;
  return (
    node.clickable === 'true' &&
    node.enabled === 'true' &&
    width >= 24 &&
    Math.abs(width - height) <= 4 &&
    /\d{4}/.test(`${node.text} ${node.contentDesc}`)
  );
}

/**
 * The dialog's confirm affordance.
 *
 * Material 3's dialog button is a clickable box that holds a `TextView` with its
 * label; the label is the node `uiautomator` reports the text on, and a tap on it
 * lands on the button, so the check aims at the label. `OK` is what this emulator
 * says; the alternatives are what other Android builds label the same button, so
 * the check does not hinge on one locale.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 */
function isConfirmLabel(node) {
  return /^(OK|Done|Set|Confirm)$/.test(node.text.trim());
}

async function main() {
  const controls = chosenControls(process.argv.slice(2));
  const suite = new Suite('android', controls);
  const out = artifactsDir('android');
  const metroPort = Number(process.env.METRO_PORT ?? 8291);
  const device = resolveDevice(process.env);
  const apk =
    process.env.HARNESS_APP_PATH ??
    path.resolve(
      repoRoot(),
      'example/android/app/build/outputs/apk/debug/app-debug.apk'
    );

  console.log(
    `real-input (android): ${device.serial} · ${device.avd} · adb server ` +
      `${process.env.ANDROID_ADB_SERVER_PORT ?? 'default'} · Metro ${String(metroPort)}`
  );

  // The shared table and `CHECKS` have to describe one suite. A control with no
  // check is reported as a failure, never skipped; a check with no control would
  // never run at all, which is the same silent gap from the other side. (The
  // comparisons are against the whole table, not the `--control` selection, so a
  // filtered run does not report the controls it left out as rogue.)
  for (const id of Object.keys(CHECKS)) {
    if (!REAL_INPUT_CONTROLS.some((control) => control.id === id)) {
      throw new Error(
        `real-input: android.mjs has a check for "${id}" but no control in ` +
          'scripts/real-input/controls.mjs names it. Add the control to the ' +
          'table (and an iOS check for it) so both platforms cover it.'
      );
    }
  }
  for (const control of controls) {
    if (CHECKS[control.id] == null) {
      suite.markMissing(control.id);
    }
  }
  const toRun = controls.filter((control) => CHECKS[control.id] != null);
  if (toRun.length === 0) {
    return suite.finish();
  }

  const stopMetro = await ensureMetro({
    port: metroPort,
    logFile: path.join(out, 'metro.log'),
  });
  const harness = new DeviceHarness({
    serial: device.serial,
    bundleId: BUNDLE_ID,
    metroPort,
    out,
  });

  try {
    harness.install(apk);
    harness.prepareLaunch();
    harness.launch();
    await harness.waitForReady(READY_TIMEOUT);

    for (const control of toRun) {
      const log = suite.begin(control);
      await harness.goToScreen(control.screen);
      try {
        await CHECKS[control.id](makeContext(harness, log));
      } catch (error) {
        if (!(error instanceof AbortedCheck)) {
          throw error;
        }
      }
    }
  } finally {
    harness.teardown();
    stopMetro();
  }

  return suite.finish();
}

/**
 * @returns {string}
 */
function repoRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
}

/**
 * adb, the accessibility tree and the gestures. Everything a check can do to the
 * device goes through here.
 */
class DeviceHarness {
  /**
   * @param {object} options
   * @param {string} options.serial
   * @param {string} options.bundleId
   * @param {number} options.metroPort
   * @param {string} options.out
   */
  constructor({ serial, bundleId, metroPort, out }) {
    this.serial = serial;
    this.bundleId = bundleId;
    this.metroPort = metroPort;
    this.out = out;
    this.remoteDump = '/sdcard/real-input.xml';
    // The tab bar is the top of the screen; 12% of its height covers the tabs on
    // any density without ever reaching the content below them.
    this.tabBandY = Math.round(this.displayHeight() * 0.12);
  }

  /**
   * @param {ReadonlyArray<string>} args
   */
  adb(args) {
    return run('adb', ['-s', this.serial, ...args]);
  }

  /**
   * @param {string} command
   */
  shell(command) {
    return this.adb(['shell', command]);
  }

  /**
   * @returns {number}
   */
  displayHeight() {
    const size = this.shell('wm size');
    const match = size.stdout.match(/(\d+)x(\d+)/);
    if (match == null) {
      throw new Error(
        `real-input: \`adb shell wm size\` said nothing useful: ${size.stdout.trim()}`
      );
    }
    return Number(match[2]);
  }

  /**
   * @param {string} apk
   */
  install(apk) {
    if (!fs.existsSync(apk)) {
      throw new Error(
        `real-input: no debug APK at ${apk}. Build it first:\n` +
          '  cd example/android && ./gradlew :app:assembleDebug ' +
          '-PreactNativeArchitectures=arm64-v8a'
      );
    }
    const result = this.adb(['install', '-r', '-g', apk]);
    if (result.status !== 0) {
      throw new Error(
        `real-input: installing ${apk} failed:\n${result.stdout}\n${result.stderr}`
      );
    }
    console.log(`  apk: ${apk}`);
  }

  /**
   * Point the debug build at this task's Metro and make that port reachable.
   *
   * `debug_http_host` is the preference the app itself reads for the bundler
   * address, and `adb reverse` maps the device's localhost onto this host, so a
   * non-default Metro port needs both. The preference is written into the app's
   * own private prefs (`run-as` works because this is a debuggable build), which
   * is what react-native-harness does for the same reason.
   *
   * The XML goes over base64 rather than quoted: it has to survive adb's shell
   * *and* the device's `sh -c` inside `run-as`, and nested quotes do not make it
   * through both. A mangled attribute delimiter leaves SharedPreferences ignoring
   * the file, the app then looks for Metro on 8081, and the reason surfaces as an
   * "Unable to load script" RedBox minutes later. Base64 has no shell
   * metacharacters, and reading the file back turns any such surprise into an
   * immediate error here.
   */
  prepareLaunch() {
    const prefs = `shared_prefs/${this.bundleId}_preferences.xml`;
    const xml =
      `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>` +
      `<string name="debug_http_host">localhost:${String(this.metroPort)}</string></map>`;
    const encoded = Buffer.from(xml, 'utf8').toString('base64');
    this.shell(
      `run-as ${this.bundleId} sh -c 'mkdir -p shared_prefs && ` +
        `echo ${encoded} | base64 -d > ${prefs}'`
    );
    const written = this.shell(`run-as ${this.bundleId} cat ${prefs}`);
    if (!written.stdout.includes(`localhost:${String(this.metroPort)}`)) {
      throw new Error(
        `real-input: the app cannot be pointed at Metro on ` +
          `${String(this.metroPort)} - the debug_http_host preference did not ` +
          `stick. ${prefs} reads back as:\n${written.stdout}`
      );
    }
    const reverse = this.adb([
      'reverse',
      `tcp:${String(this.metroPort)}`,
      `tcp:${String(this.metroPort)}`,
    ]);
    if (reverse.status !== 0) {
      throw new Error(
        `real-input: adb reverse tcp:${String(this.metroPort)} failed: ` +
          reverse.stderr.trim()
      );
    }
  }

  launch() {
    this.shell(`am force-stop ${this.bundleId}`);
    const started = this.shell(`am start -W -n ${ACTIVITY}`);
    if (started.status !== 0 || !started.stdout.includes('Status: ok')) {
      throw new Error(
        `real-input: launching ${ACTIVITY} failed:\n${started.stdout}\n${started.stderr}`
      );
    }
  }

  /**
   * @param {number} timeoutMs
   */
  async waitForReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const nodes = this.hierarchy();
      const redbox = nodes.find((node) => node.resourceId.includes('redbox'));
      if (redbox != null) {
        // Fail now instead of waiting out the timeout: a RedBox means the app is
        // up and something inside it is wrong (a broken bundle, an unreachable
        // Metro, a JS exception), and every later check would fail the same way.
        throw new Error(
          'real-input: the app came up showing a JavaScript error rather than ' +
            `the example (Metro is on ${String(this.metroPort)}). Its own log ` +
            `ends:\n${this.tailAppLog()}`
        );
      }
      if (
        findTab(nodes, 'Switch', this.tabBandY) != null &&
        findTab(nodes, 'Slider', this.tabBandY) != null
      ) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          'real-input: the app did not render its tab bar within ' +
            `${String(timeoutMs)}ms. Metro is on ${String(this.metroPort)} ` +
            `(log: ${path.join(this.out, 'metro.log')}). The app's log ends:\n` +
            this.tailAppLog()
        );
      }
      await sleep(1000);
    }
  }

  /**
   * @returns {string}
   */
  tailAppLog() {
    const pid = this.shell(`pidof ${this.bundleId}`)
      .stdout.trim()
      .split(/\s+/)[0];
    if (pid == null || pid === '') {
      return `(no ${this.bundleId} process is running)`;
    }
    // By pid and unfiltered: RN reports the real reason ("Unable to load
    // script", a native crash, a JS exception) under tags no `-s` list names.
    return this.adb(['logcat', '-d', '--pid', pid])
      .stdout.split('\n')
      .filter((line) => line !== '')
      .slice(-25)
      .join('\n');
  }

  /**
   * The example's tabs are its only navigation.
   *
   * @param {'switch' | 'slider' | 'button' | 'segmented' | 'datepicker'} screen
   */
  async goToScreen(screen) {
    const label = {
      switch: 'Switch',
      slider: 'Slider',
      button: 'Button',
      segmented: 'Segments',
      datepicker: 'Dates',
    }[screen];
    const anchor = {
      switch: ECHO.switchValue,
      slider: ECHO.sliderStart,
      button: ECHO.buttonCount,
      segmented: ECHO.segmentedIndex,
      datepicker: ECHO.dateValue,
    }[screen];
    if (findByTestId(this.hierarchy(), anchor) != null) {
      return;
    }
    const tab = findTab(this.hierarchy(), label, this.tabBandY);
    if (tab == null) {
      throw new Error(
        `real-input: no "${label}" tab in the accessibility tree, so the ` +
          'screen this check needs cannot be reached.'
      );
    }
    this.tap(tab);
    const deadline = Date.now() + REACT_TIMEOUT;
    for (;;) {
      if (findByTestId(this.hierarchy(), anchor) != null) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `real-input: tapping the "${label}" tab did not bring up its screen.`
        );
      }
      await sleep(300);
    }
  }

  /**
   * A fresh accessibility tree, also kept on disk as the run's evidence.
   *
   * @returns {import('./uiautomator.mjs').UiautomatorNode[]}
   */
  hierarchy() {
    /** @type {string} */
    let xml = '';
    for (let attempt = 1; attempt <= 4 && xml === ''; attempt += 1) {
      const dumped = this.shell(`uiautomator dump ${this.remoteDump}`);
      const read = this.shell(`cat ${this.remoteDump}`);
      if (dumped.status === 0 && read.stdout.includes('<node')) {
        xml = read.stdout;
        break;
      }
      // A window that is still animating refuses the dump. The checks poll
      // anyway, so retrying for a moment is cheaper than a special case in every
      // check. This blocks the (single) thread of a short-lived CLI process.
      blockMs(500);
    }
    if (xml === '') {
      throw new Error(
        'real-input: `uiautomator dump` returned nothing usable. The device may ' +
          'be asleep or the app may have crashed. The app log ends:\n' +
          this.tailAppLog()
      );
    }
    fs.writeFileSync(path.join(this.out, 'hierarchy.xml'), xml);
    return parseHierarchy(xml);
  }

  /**
   * @param {import('./uiautomator.mjs').UiautomatorNode} node
   */
  tap(node) {
    this.tapAt(node.bounds.cx, node.bounds.cy);
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  tapAt(x, y) {
    this.shell(`input tap ${String(Math.round(x))} ${String(Math.round(y))}`);
  }

  /**
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @param {number} durationMs
   */
  swipe(x1, y1, x2, y2, durationMs) {
    this.shell(
      `input swipe ${String(Math.round(x1))} ${String(Math.round(y1))} ` +
        `${String(Math.round(x2))} ${String(Math.round(y2))} ${String(durationMs)}`
    );
  }

  teardown() {
    this.shell(`am force-stop ${this.bundleId}`);
    this.adb(['reverse', '--remove', `tcp:${String(this.metroPort)}`]);
  }
}

/**
 * The only API a check is written against.
 *
 * @param {DeviceHarness} harness
 * @param {import('./support.mjs').CheckLog} log
 */
function makeContext(harness, log) {
  /**
   * @param {string} testID
   * @returns {string | null}
   */
  const echo = (testID) => {
    const node = findByTestId(harness.hierarchy(), testID);
    return node == null ? null : node.text;
  };

  /**
   * @param {string} testID
   * @returns {number | null}
   */
  const value = (testID) => {
    const raw = echo(testID);
    if (raw == null) {
      return null;
    }
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    return match == null ? null : Number(match[0]);
  };

  /**
   * @param {() => boolean} condition
   * @param {string} description
   */
  const until = (condition, description) => {
    const deadline = Date.now() + REACT_TIMEOUT;
    for (;;) {
      if (condition()) {
        return true;
      }
      if (Date.now() > deadline) {
        log.abort(`timed out waiting for ${description}`);
      }
      blockMs(250);
    }
  };

  return {
    log,

    /**
     * @param {string} testID
     */
    requireEcho(testID) {
      const shown = echo(testID);
      if (shown == null) {
        log.abort(
          `no on-screen text with testID "${testID}" in the accessibility tree`
        );
      }
      return shown;
    },

    /**
     * @param {string} description the control's `accessibilityLabel`
     */
    requireControl(description) {
      const node = findByDescription(harness.hierarchy(), description);
      if (node == null) {
        log.abort(
          `no control with accessibilityLabel "${description}" in the ` +
            'accessibility tree — the hosted control offers nothing a real tap ' +
            'could be aimed at'
        );
      }
      log.note(
        `"${description}" occupies ${node.bounds.x1},${node.bounds.y1} → ` +
          `${node.bounds.x2},${node.bounds.y2}`
      );
      return node;
    },

    /**
     * A fresh accessibility tree, for a check that has to look at several things in
     * one breath - which half of a calendar is on screen, for instance.
     */
    dump() {
      return harness.hierarchy();
    },

    /**
     * The node React Native gives an on-screen `testID`, or `null` when nothing on
     * screen carries it. `requireEcho` reads the same node's text and aborts; this
     * is for scrolling, where "not yet" is the expected answer.
     *
     * @param {string} testID
     */
    nodeByTestId(testID) {
      return findByTestId(harness.hierarchy(), testID);
    },

    /**
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     */
    async tapNode(node) {
      harness.tap(node);
      await sleep(250);
    },

    /**
     * What an echo says right now, or `null` when nothing carries that id.
     *
     * `requireEcho` aborts, which is right for a check's assertions and wrong for
     * a loop that is trying several gestures - a dialog, for instance, is another
     * window, so the app's own text is simply absent until it closes.
     *
     * @param {string} testID
     * @returns {string | null}
     */
    echo(testID) {
      return echo(testID);
    },

    /**
     * @param {number} ms
     */
    async settle(ms) {
      await sleep(ms);
    },

    /**
     * Scroll the page by `pixels` with one swipe (negative scrolls up).
     *
     * The swipe is aimed at the empty strip at the right edge of the window,
     * outside the page's content column. Anywhere else it could start on a day
     * cell, and Material 3's calendar is itself a vertical scroller: a swipe that
     * starts there turns the calendar to another month instead of scrolling the
     * page, which would move the grid the check is about to tap.
     *
     * @param {number} pixels
     */
    async scrollPage(pixels) {
      const nodes = harness.hierarchy();
      const width = Math.max(...nodes.map((node) => node.bounds.x2), 1);
      const height = Math.max(...nodes.map((node) => node.bounds.y2), 1);
      const x = width - 8;
      const from = height * 0.7;
      harness.swipe(x, from, x, from - pixels, 400);
      await sleep(500);
    },

    /**
     * The echo's text, polled until `matches` accepts it or `timeoutMs` passes.
     *
     * `waitForEcho` aborts, which is right for an assertion and wrong for a retry
     * loop that has to be able to notice a no-op and try another cell.
     *
     * @param {string} testID
     * @param {(text: string | null) => boolean} matches
     * @param {number} timeoutMs
     * @returns {string | null} the last text seen, matched or not
     */
    echoWithin(testID, matches, timeoutMs = 2500) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const shown = echo(testID);
        if (matches(shown) || Date.now() > deadline) {
          return shown;
        }
        blockMs(100);
      }
    },

    /**
     * Every node `predicate` accepts, once at least `minCount` of them are on
     * screen - or the run aborts saying what it was waiting for.
     *
     * For the things a check cannot aim at by id: Material 3's calendar day cells
     * belong to Compose, in a dialog window of its own, and name themselves with a
     * localised date rather than a testID.
     *
     * @param {(node: import('./uiautomator.mjs').UiautomatorNode) => boolean} predicate
     * @param {string} why What the check was waiting for, for the failure line.
     * @param {number} minCount How many matches make the tree worth returning.
     */
    waitForNodes(predicate, why, minCount = 1, timeoutMs = REACT_TIMEOUT) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = harness.hierarchy().filter(predicate);
        if (found.length >= minCount) {
          return found;
        }
        if (Date.now() > deadline) {
          log.abort(`timed out waiting for ${why}`);
        }
        blockMs(250);
      }
    },

    /**
     * Bounds as one comparable string, so a check can say "this control did not
     * move" without the report line printing four numbers twice.
     *
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     */
    boundsText(node) {
      const { x1, y1, x2, y2 } = node.bounds;
      return `${String(x1)},${String(y1)} → ${String(x2)},${String(y2)}`;
    },

    /**
     * Tap a control a fraction of the way across its own width.
     *
     * A segmented control needs it: the centre is always the middle segment, and
     * proving that a segment *other* than the middle one answers a touch is half
     * of what the check is for. Fractions stay away from the edges, where the
     * rounded end caps and the dividers between segments live. Mirrors iOS's
     * `XCUIElement.atFraction(_:)`.
     *
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     * @param {number} fraction
     */
    async tapControlAt(node, fraction) {
      harness.tapAt(
        node.bounds.x1 + node.bounds.width * fraction,
        node.bounds.cy
      );
      await sleep(250);
    },

    /**
     * Drag across a control between two fractions of its own width.
     *
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     * @param {number} from
     * @param {number} to
     * @param {number} durationMs
     */
    async dragControl(node, from, to, durationMs) {
      harness.swipe(
        node.bounds.x1 + node.bounds.width * from,
        node.bounds.cy,
        node.bounds.x1 + node.bounds.width * to,
        node.bounds.cy,
        durationMs
      );
      await sleep(400);
    },

    value,

    /**
     * @param {string} testID
     * @param {string} expected
     * @param {string} description
     */
    waitForEcho(testID, expected, description) {
      until(
        () => echo(testID) === expected,
        `${description} (${testID}="${expected}")`
      );
      return echo(testID);
    },

    /**
     * @param {string} testID
     * @param {string} previous
     * @param {string} description
     */
    waitForEchoToChange(testID, previous, description) {
      until(() => {
        const shown = echo(testID);
        return shown !== null && shown !== previous;
      }, `${description} (${testID} away from "${previous}")`);
      return echo(testID);
    },

    /**
     * Read an echo for `settleMs` and require that it never moved. The button
     * check needs the negative: "the disabled control did not answer" is a claim
     * about a period, not about one instant, and a single read could have been
     * taken before the touch was processed.
     *
     * @param {string} testID
     * @param {string} expected
     * @param {string} description
     * @param {number} [settleMs]
     */
    requireEchoToStay(testID, expected, description, settleMs = 1500) {
      const deadline = Date.now() + settleMs;
      /** @type {string | null} */
      let moved = null;
      for (;;) {
        const shown = echo(testID);
        if (shown !== expected && moved == null) {
          moved = shown;
        }
        if (moved != null || Date.now() >= deadline) {
          break;
        }
        blockMs(200);
      }
      if (moved != null) {
        log.abort(
          `${description}: ${testID} went to "${String(moved)}" when it should ` +
            `have stayed "${expected}"`
        );
      }
      return echo(testID);
    },

    /**
     * @param {string} testID
     * @param {number | null} previous
     * @param {string} description
     */
    waitForValueToRise(testID, previous, description) {
      until(
        () => {
          const shown = value(testID);
          return shown != null && previous != null && shown > previous;
        },
        `${description} (${testID} above ${String(previous)})`
      );
      return value(testID);
    },
  };
}

/**
 * @param {string} serial
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function avdName(serial, env) {
  const result = run('adb', ['-s', serial, 'emu', 'avd', 'name'], { env });
  return result.stdout.split('\n')[0]?.trim() ?? '';
}

/**
 * Which emulator to drive, and a refusal to drive any other.
 *
 * Several tasks share this machine and AGENTS.md names a device that belongs to
 * a person rather than to a task, so the serial is never guessed from a device
 * list: a candidate is checked by the AVD it actually runs, and the human's
 * device is refused by name as well.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ serial: string, avd: string }}
 */
function resolveDevice(env) {
  const avd = env.ANDROID_AVD ?? 'nitroui';
  if (/^PR15\d\d/i.test(avd)) {
    throw new Error(
      `real-input: ANDROID_AVD="${avd}" is the device AGENTS.md says belongs ` +
        'to the human. Refusing to touch it.'
    );
  }

  const listed = run('adb', ['devices'], { env });
  if (listed.status !== 0) {
    throw new Error(
      `real-input: \`adb devices\` failed: ` +
        (listed.stderr.trim() === ''
          ? listed.stdout.trim()
          : listed.stderr.trim())
    );
  }
  const serials = listed.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t')[0] ?? '')
    .filter((line) => line.startsWith('emulator-'));

  const wanted = env.ANDROID_SERIAL;
  if (wanted != null && wanted !== '') {
    if (!serials.includes(wanted)) {
      throw new Error(
        `real-input: ANDROID_SERIAL=${wanted} is not connected to adb server ` +
          `${env.ANDROID_ADB_SERVER_PORT ?? 'default'}.`
      );
    }
    if (avdName(wanted, env) !== avd) {
      throw new Error(
        `real-input: ANDROID_SERIAL=${wanted} runs AVD ` +
          `"${avdName(wanted, env)}", not the assigned "${avd}".`
      );
    }
    return { serial: wanted, avd };
  }

  const matching = serials.filter((serial) => avdName(serial, env) === avd);
  if (matching.length === 0) {
    throw new Error(
      `real-input: no running emulator for AVD "${avd}" on adb server ` +
        `${env.ANDROID_ADB_SERVER_PORT ?? 'default'}. Boot it first, e.g.\n` +
        `  ANDROID_ADB_SERVER_PORT=${env.ANDROID_ADB_SERVER_PORT ?? '5042'} ` +
        `emulator -avd ${avd} -port 5572 -gpu host -no-window -no-audio ` +
        '-no-boot-anim -no-snapshot-save'
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `real-input: ${String(matching.length)} emulators run AVD "${avd}" ` +
        `(${matching.join(', ')}). Set ANDROID_SERIAL to pick one.`
    );
  }
  return { serial: matching[0], avd };
}

process.exitCode = await main().catch((error) => {
  console.error(`\nreal-input (android): ${String(error)}`);
  return 1;
});
