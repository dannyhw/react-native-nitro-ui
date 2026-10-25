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
 *     bun run test:real-input:android [--control switch|slider|button|segmented-control]
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
  findAllByDescription,
  findByDescription,
  findByTestId,
  findAllByText,
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
  pickerIndex: 'real-input-picker-index',
  pickerEvents: 'real-input-picker-events',
  pickerGone: 'real-input-drop-gone',
};

/** The system Back key, which is how a person dismisses an open popup. */
const KEY_BACK = 4;

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
   * A menu picker: a real tap must open a popup, a real tap on a row must bring the
   * choice back to JS, a refused choice must go away again, and a popup that outlives
   * the view that opened it must not survive it.
   *
   * Two things about a popup decide every assertion here, both measured on
   * `nitroui_t01` rather than assumed:
   *
   *  - While the popup is open, `uiautomator dump` returns *its* tree - the app
   *    window's own `Text`s (the echoes) are not in that dump. So a check reads the
   *    popup's rows while it is open and reads echoes only once it is shut, which is
   *    also how it looks to a person: a menu covers the screen it belongs to.
   *  - The popup is a window of its own (`Window{... u0 Pop-Up Window}` owned by this
   *    activity), so `popupWindowCount()` is a reading that survives the popup leaving
   *    the accessibility tree - the only way to see a popup that leaked.
   */
  'picker': async (t) => {
    // The three titles of `real-input-picker`, spelled as `PickerScreen` spells
    // them. None appears anywhere else on the screen, which is what lets a text
    // match name a popup row.
    const FIRST = 'Onyx';
    const LONGEST = 'A considerably longer mineral name';
    const control = await t.requireControl('Real-input picker');
    const widthBefore = control.bounds.width;

    t.log.checkEquals(
      'the Picker has reported no index before a touch',
      t.requireEcho(ECHO.pickerIndex),
      '-'
    );
    t.log.checkEquals(
      'no change has been reported before a touch',
      t.requireEcho(ECHO.pickerEvents),
      '0'
    );
    t.log.checkEquals(
      'no popup window belongs to the app before a touch',
      t.popupWindowCount(),
      0
    );

    // 1. Opening. A tap on the anchor opens a list - and the control is not
    //    expected to treat that as a choice (asserted after it closes, below).
    await t.tapNode(control);
    t.log.checkEquals(
      'a real tap on the anchor opens the menu as a popup window',
      t.popupWindowCount(),
      1
    );
    // Wait for the dump to carry the menu's rows before asking it about
    // selection - the popup owns the tree only while it is open.
    t.waitForOption(LONGEST, 'the menu to open');
    t.log.check(
      `the open menu marks the current choice ("${FIRST}") selected to TalkBack`,
      t.optionIsSelected(FIRST)
    );

    // 2. Back dismisses without choosing - the platform's own way out of a menu.
    await t.pressBack();
    t.log.checkEquals(
      'Back shuts the popup (no window left behind)',
      t.popupWindowCount(),
      0
    );
    t.log.checkEquals(
      'opening and dismissing reported no selection - a menu is not a choice',
      t.requireEcho(ECHO.pickerEvents),
      '0'
    );
    t.log.checkEquals(
      'and the anchor still shows the title it started with',
      t.anchorTitle('Real-input picker'),
      FIRST
    );

    // 2b. The way out that changes nothing: the row already on show. It closes the
    //       menu and reports no choice. Android suppresses that no-op on purpose,
    //       and G6 measured that iOS reports it unless told not to, so both
    //       platforms carry this check (`HybridNitroUiPicker.swift`).
    await t.tapNode(t.requireControlAt('Real-input picker', control));
    await t.tapNode(
      t.waitForOption(FIRST, 'the menu to show the current choice')
    );
    t.log.checkEquals(
      'tapping the row that is already chosen closes the menu',
      t.popupWindowCount(),
      0
    );
    t.log.checkEquals(
      'and a choice that changed nothing reports nothing',
      t.requireEcho(ECHO.pickerEvents),
      '0'
    );

    // 3. Choosing. The rows are the popup's, so this tap is aimed at a node that
    //    only exists while the menu is open.
    await t.tapNode(t.requireControlAt('Real-input picker', control));
    await t.tapNode(t.waitForOption(LONGEST, 'the menu to open again'));
    t.log.checkEquals(
      'a real tap on a menu row reaches JS as index 2',
      t.waitForEcho(ECHO.pickerIndex, '2', 'a real tap on the row to register'),
      '2'
    );
    t.log.checkEquals(
      'one choice reports one change',
      t.requireEcho(ECHO.pickerEvents),
      '1'
    );
    t.log.checkEquals('choosing closes its own popup', t.popupWindowCount(), 0);

    // 4. The box follows a title that moved with no React render: this picker is
    //    uncontrolled, so nothing told React the title changed, and `nuiSizingKey`
    //    still names the title it was built with. Growing is therefore the host's
    //    own measure signal at work - the same signal `Picker.harness.tsx` cannot
    //    reach, because a harness press never gets into a popup.
    const widthAfter = t.anchorWidth('Real-input picker');
    t.log.checkEquals(
      `the anchor now paints the title that was chosen ("${LONGEST}")`,
      t.anchorTitle('Real-input picker'),
      LONGEST
    );
    t.log.check(
      `the control grew to fit it (${String(widthBefore)} dp -> ` +
        `${String(widthAfter)} dp), with no render to ask for`,
      widthAfter != null && widthAfter > widthBefore + 20
    );

    // 5. A choice the parent refuses. Native paints it first (core.md section 4),
    //    so the second tap is the oracle: it can only be a fresh choice if the
    //    refused one went back to what the parent keeps sending.
    const rejecting = await t.requireControl('Real-input rejecting picker');
    t.log.checkEquals(
      'the refusing parent pins its Picker at index 0',
      t.requireEcho(ECHO.rejectValue),
      '0'
    );
    await t.tapNode(rejecting);
    await t.tapNode(
      t.waitForOption('Ridge', 'the refusing picker menu to open')
    );
    t.log.checkEquals(
      'a real tap on the controlled picker still reaches JS - native paints optimistically',
      t.waitForEcho(ECHO.rejectEvents, '1', 'the controlled tap to register'),
      '1'
    );
    t.log.checkEquals(
      'the parent never accepted the change, so the index it sends is still 0',
      t.requireEcho(ECHO.rejectValue),
      '0'
    );
    t.log.checkEquals(
      "the refused title went away: the anchor shows the parent's title again",
      t.anchorTitle('Real-input rejecting picker'),
      'Summit'
    );
    await t.tapNode(
      t.requireControlAt('Real-input rejecting picker', rejecting)
    );
    await t.tapNode(
      t.waitForOption('Ridge', 'the refusing picker menu to reopen')
    );
    t.log.checkEquals(
      'tapping the refused row again is a fresh choice, which is only true if the refused one was rolled back',
      t.waitForEcho(ECHO.rejectEvents, '2', 'the repeated tap to register'),
      '2'
    );
    t.log.checkEquals('choosing shut that popup too', t.popupWindowCount(), 0);

    // 6. The leak case (B1's shape, for popups): open a menu, then have React take
    //    the view away underneath it, three times. Each cycle ends with no popup
    //    window owned by the app - a popup that survives its view is invisible in
    //    the accessibility tree, so the window table is what is read.
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const dropControl = await t.requireControl('Real-input drop picker');
      const dropButton = t.waitForNode(
        ECHO.pickerGone.replace('-gone', '-button'),
        'the unmount button'
      );
      await t.tapNode(dropButton);
      await t.tapNode(dropControl);
      // Read the window table, not the accessibility dump: `dump` costs around a
      // second under load and can miss a menu that is open for less, while the
      // window table is one cheap query that says the same thing - a popup of this
      // app's is on screen. Steps 1-3 already proved such a popup carries rows.
      t.log.checkEquals(
        `cycle ${String(cycle)}: the drop picker's menu is open as a popup window`,
        t.popupWindowCount(),
        1
      );
      // The unmount is on a timer inside the app (2.5 s), so the menu is definitely
      // open when the view goes away - a second real tap would only have dismissed it.
      t.waitForNode(
        ECHO.pickerGone,
        `cycle ${String(cycle)}: the picker to unmount`
      );
      t.log.checkEquals(
        `cycle ${String(cycle)}: unmounting with the menu open leaves no popup window`,
        t.popupWindowCount(),
        0
      );
      if (cycle < 3) {
        await t.tapNode(
          t.waitForNode(
            ECHO.pickerGone.replace('-gone', '-remount'),
            'the remount button'
          )
        );
      }
    }

    // 7. A disabled picker refuses a real touch. `menuAnchor(enabled = false)`
    //    means the anchor is never asked to open, so the window table is the
    //    witness - and the ordinary picker beside it, tapped the same way, is what
    //    turns "nothing happened" into "this one refused".
    //
    //    The accessibility `enabled` flag is deliberately not *this* witness, because
    //    a flag is a claim about the tree and a refusal is a claim about input:
    //    `menuAnchor(enabled = false)` has to be what stops the pointer, and only a
    //    real tap measures that. What the tree says is checked separately, in step 8
    //    below, from the same dump. (Until M3 these two steps had a worse reason to
    //    be split: the anchor was two nodes, and the one carrying the picker's name
    //    read `enabled=true` on a disabled control. That node sat *inside* the
    //    `EditText`, so it was a Compose semantics node of the anchor and not the
    //    React Native host container - a container cannot nest inside what it
    //    contains - and *why* it answered `enabled=true` was never established. What
    //    it was not is Compose deriving `isEnabled` from unmerged children:
    //    `ui-android-1.11.4` reports `enabled = !config.contains(Disabled)`. Nothing
    //    here depends on the answer now, and step 8 counts the named nodes so a second
    //    one cannot come back unnoticed. See `docs/components/picker.md`.)
    const locked = await t.requireControlOnScreen('Real-input disabled picker');
    await t.tapNode(locked);
    t.log.checkEquals(
      'a real tap on the disabled picker opens no menu',
      t.popupWindowCount(),
      0
    );
    const unlocked = await t.requireControlOnScreen(
      'Real-input enabled picker'
    );
    await t.tapNode(unlocked);
    t.log.checkEquals(
      'the ordinary picker, tapped the same way, opens one - so the line above measured a refusal',
      t.popupWindowCount(),
      1
    );
    await t.pressBack();
    t.log.checkEquals('and that menu goes away again', t.popupWindowCount(), 0);

    // 8. What a screen reader is offered (M3). The dump is the only witness for
    //    this: the accessibility tree is what TalkBack reads, and a name sitting on
    //    a node with no value - or spread over two nodes - misdescribes the control
    //    however well the taps land. These two pickers are used rather than the
    //    first one because they are the ones still on screen after step 7 scrolled
    //    to the bottom, and both pin their title to "Mica", so the value the node
    //    has to carry is known.
    const named = t.nodesNamed('Real-input enabled picker');
    t.log.checkEquals(
      "one node carries the enabled picker's name, so it is announced once",
      named.length,
      1
    );
    t.log.checkEquals(
      'and that same node carries the value it shows',
      named[0]?.text,
      'Mica'
    );
    t.log.checkEquals(
      'it is the node a tap is aimed at, too (the name is not parked on a container)',
      named[0]?.clickable,
      'true'
    );
    // The role: `Role.DropdownList` reaches the dump as the class Compose gives a
    // drop-down, which is how the tree says "list of choices" rather than "text
    // field". Measured on `nitroui_t01` with the anchor's own semantics.
    t.log.checkEquals(
      'the node announces the role of a list of choices',
      named[0]?.className,
      'android.widget.Spinner'
    );
    const lockedNodes = t.nodesNamed('Real-input disabled picker');
    t.log.checkEquals(
      'the disabled picker is one node as well',
      lockedNodes.length,
      1
    );
    t.log.checkEquals(
      'and that node is the one that says it is disabled',
      lockedNodes[0]?.enabled,
      'false'
    );
    // What the fix does *not* claim: that Compose marks this node focusable. It
    // does not (measured), and the honest record of that is here rather than in a
    // comment that quietly stops being true - see `docs/components/picker.md`.
    t.log.note(
      `name node reports focusable=${String(named[0]?.focusable)} - ` +
        'kept as evidence, not asserted'
    );
  },
};

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
   * The screen size in pixels, from `wm size`. A swipe is a pair of absolute
   * coordinates, so a scroll has to know the screen it is scrolling.
   *
   * @returns {{ width: number, height: number }}
   */
  screenSize() {
    const size = this.shell('wm size');
    const match = size.stdout.match(/(\d+)x(\d+)/);
    if (match == null) {
      throw new Error(
        `real-input: \`adb shell wm size\` said nothing useful: ${size.stdout.trim()}`
      );
    }
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  /**
   * @returns {number}
   */
  displayHeight() {
    return this.screenSize().height;
  }

  /**
   * @returns {number}
   */
  displayWidth() {
    return this.screenSize().width;
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
   * The example's three tabs are its only navigation.
   *
   * @param {'switch' | 'slider' | 'button' | 'segmented' | 'picker'} screen
   */
  async goToScreen(screen) {
    const label = {
      switch: 'Switch',
      slider: 'Slider',
      button: 'Button',
      segmented: 'Segments',
      picker: 'Picker',
    }[screen];
    const anchor = {
      switch: ECHO.switchValue,
      slider: ECHO.sliderStart,
      button: ECHO.buttonCount,
      segmented: ECHO.segmentedIndex,
      picker: ECHO.pickerIndex,
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
   * Press a system key, which is the only way to dismiss a popup the way a person
   * does - a synthetic touch outside it would first have to land somewhere that is
   * not the popup, and on Android a back key press is also the case the brief asks
   * the control to handle.
   *
   * @param {number} keyCode e.g. 4 for `KEYCODE_BACK`
   */
  key(keyCode) {
    this.shell(`input keyevent ${String(keyCode)}`);
  }

  /**
   * How many popup windows this app owns.
   *
   * The B1 lesson: nothing per-mount may attach to the Activity or the window
   * without being released, and a popup window is exactly such a thing - a leak is
   * invisible in the accessibility tree once the view that owned it is gone, but a
   * window the app no longer needs is still a window. Measured shape of
   * `dumpsys window windows` on `nitroui_t01`: one Compose popup is
   * `Window #N Window{... u0 Pop-Up Window}:`, whose record names the owning
   * activity (`mActivityRecord=ActivityRecord{... nitroui.example/.MainActivity}`),
   * so counting records that are popups *and* name this app counts this app's
   * popups and nobody else's.
   *
   * @returns {number}
   */
  popupWindowCount() {
    const dump = this.shell('dumpsys window windows').stdout;
    let count = 0;
    let isPopup = false;
    let namesApp = false;
    const flush = () => {
      if (isPopup && namesApp) {
        count += 1;
      }
    };
    for (const line of dump.split('\n')) {
      const header = line.match(/^\s*Window #\d+ Window\{([^}]*)\}/);
      if (header != null) {
        flush();
        isPopup = header[1].includes('Pop-Up');
        namesApp = header[1].includes(this.bundleId);
        continue;
      }
      if (isPopup && !namesApp && line.includes(this.bundleId)) {
        namesApp = true;
      }
    }
    flush();
    return count;
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
     * Scroll the screen until this control is on it, then look it up.
     *
     * `uiautomator dump` lists no off-screen nodes, so a row below the fold is not
     * merely unhittable - it is absent from the tree. Evidence that lives at the
     * bottom of a screen therefore has to be scrolled to, exactly as a person
     * scrolls to it, and this says so instead of failing with "not in the tree".
     *
     * @param {string} description the control's `accessibilityLabel`
     */
    async requireControlOnScreen(description) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const node = findByDescription(harness.hierarchy(), description);
        if (node != null) {
          if (attempt > 0) {
            log.note(
              `"${description}" needed ${String(attempt)} scroll` +
                `${attempt === 1 ? '' : 's'} to come on screen`
            );
          }
          log.note(
            `"${description}" occupies ${node.bounds.x1},${node.bounds.y1} → ` +
              `${node.bounds.x2},${node.bounds.y2}`
          );
          return node;
        }
        const { width, height } = harness.screenSize();
        harness.swipe(width / 2, height * 0.7, width / 2, height * 0.32, 400);
        await sleep(400);
      }
      return this.requireControl(description);
    },

    /**
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     */
    async tapNode(node) {
      harness.tap(node);
      await sleep(250);
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
    /**
     * Look a control up again, and say if it moved.
     *
     * A picker's anchor moves on purpose when the chosen title is wider than the
     * last one, so "it moved" is not a failure here (that is what the growth
     * assertion is for) - but a tap aimed at stale bounds would be, so every
     * second touch on the same control is aimed at the box it has now.
     *
     * @param {string} description the control's `accessibilityLabel`
     * @param {import('./uiautomator.mjs').UiautomatorNode} previous where it was
     */
    requireControlAt(description, previous) {
      const node = this.requireControl(description);
      if (this.boundsText(node) !== this.boundsText(previous)) {
        this.log.note(
          `"${description}" moved from ${this.boundsText(previous)} to ` +
            `${this.boundsText(node)} - the tap is aimed at the new box`
        );
      }
      return node;
    },

    /**
     * Wait for a React Native view with this `testID`, and hand back its node.
     *
     * For the app's own chrome (the buttons on the example's screens), which - unlike
     * a hosted control - is a React Native view and so carries a `resource-id`.
     *
     * @param {string} testID
     * @param {string} description
     */
    waitForNode(testID, description) {
      /** @type {import('./uiautomator.mjs').UiautomatorNode | null} */
      let found = null;
      until(() => {
        found = findByTestId(harness.hierarchy(), testID) ?? null;
        return found != null;
      }, `${description} - no view with testID "${testID}"`);
      return /** @type {import('./uiautomator.mjs').UiautomatorNode} */ (found);
    },

    /**
     * The app's popup windows right now - the leak oracle, explained on
     * `DeviceHarness.popupWindowCount`.
     */
    popupWindowCount() {
      return harness.popupWindowCount();
    },

    /**
     * Press Back.
     */
    async pressBack() {
      harness.key(KEY_BACK);
      await sleep(400);
    },

    /**
     * Wait for an option row of an open popup to be on screen, and hand back the
     * node so a check can tap it.
     *
     * The rows are the popup's own: a Compose popup is a window of its own, and
     * while it is open `uiautomator dump` returns that window's tree, which is why
     * a check may not read an echo (an app-window `Text`) with a menu open and must
     * not - the popup is the only thing on screen a person could be reading either.
     *
     * @param {string} text the option's label
     * @param {string} description what should have happened
     */
    waitForOption(text, description) {
      /** @type {import('./uiautomator.mjs').UiautomatorNode | null} */
      let found = null;
      until(() => {
        found = findAllByText(harness.hierarchy(), text)[0] ?? null;
        return found != null;
      }, `${description} - no popup row labelled "${text}"`);
      return /** @type {import('./uiautomator.mjs').UiautomatorNode} */ (found);
    },

    /**
     * Whether the popup marks this option as the chosen one.
     *
     * The library publishes the selection as a Compose `selected` semantic on the
     * row; measured on the running app, that reaches the accessibility dump as
     * `checked="true"` on a `checkable` row that wraps the option's `Text`. This
     * reads the row the label sits in, so the claim is about the row a screen
     * reader stops on, not about a node the check invented.
     *
     * @param {string} text the option's label
     */
    optionIsSelected(text) {
      const nodes = harness.hierarchy();
      const label = findAllByText(nodes, text)[0];
      if (label == null) {
        return false;
      }
      const { cx, cy } = label.bounds;
      const row = nodes.find(
        (node) =>
          node.checkable === 'true' &&
          node.bounds.x1 <= cx &&
          cx <= node.bounds.x2 &&
          node.bounds.y1 <= cy &&
          cy <= node.bounds.y2
      );
      return row != null && row.checked === 'true';
    },

    /**
     * The title a picker's anchor is showing.
     *
     * Measured on the running app: the Material 3 field that acts as the anchor is
     * an `EditText` node whose bounds are exactly those of the node carrying the
     * control's `content-desc`, and its `text` is the selected option. So this is
     * the only way to ask what the control paints, and it matters most for an
     * uncontrolled picker - whose title moves with no React render behind it.
     *
     * @param {string} description the control's `accessibilityLabel`
     */
    anchorTitle(description) {
      const nodes = harness.hierarchy();
      const control = findByDescription(nodes, description);
      if (control == null) {
        return null;
      }
      // Since M3 the control's own node answers: one node carries the name *and*
      // the value, so the value is read where the name is. The bounds search is
      // kept as the fallback it was - if a Compose or Material change ever splits
      // the node again, this asks the same question instead of reading nothing.
      if (control.text !== '') {
        return control.text;
      }
      const field = nodes.find(
        (node) =>
          node.text !== '' &&
          node.bounds.x1 === control.bounds.x1 &&
          node.bounds.y1 === control.bounds.y1 &&
          node.bounds.x2 === control.bounds.x2 &&
          node.bounds.y2 === control.bounds.y2
      );
      return field == null ? null : field.text;
    },

    /**
     * Every accessibility node that carries this control's name.
     *
     * The count is the point: one node means a screen reader announces the control
     * once, with whatever that node says. More than one means it announces it
     * twice, and only one of those nodes has the value. See `CHECKS.picker` step 8.
     *
     * @param {string} description the control's `accessibilityLabel`
     */
    nodesNamed(description) {
      return findAllByDescription(harness.hierarchy(), description);
    },

    /**
     * The width of a control's box, so a check can say "the control grew to fit the
     * title it now shows" in one number.
     *
     * @param {string} description the control's `accessibilityLabel`
     */
    anchorWidth(description) {
      const node = findByDescription(harness.hierarchy(), description);
      return node == null ? null : node.bounds.width;
    },

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
