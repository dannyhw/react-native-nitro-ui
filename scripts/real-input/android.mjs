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
  findAllByDescription,
  findByDescription,
  findByTestId,
  findAllByText,
  findTab,
  parseHierarchy,
} from './uiautomator.mjs';
import { assertSupportedNodeOrReexec } from '../node-version.mjs';
import { assertFreshApp, colorize } from '../app-stamp.mjs';
import { checkEmulatorEnv, isReservedSerial } from '../lease-core.mjs';

// One Node across every device gate: the harness cannot run on Node 25/26 at
// all, so a real-input run on that runtime is not comparable evidence. When this
// shell is on the wrong Node, restart under the `.nvmrc` one rather than refusing
// a device run - `bun run test:real-input:*` is a device gate, not a shell test.
assertSupportedNodeOrReexec({
  command: 'bun run test:real-input:android',
  entryUrl: import.meta.url,
});

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
  pickerIndex: 'real-input-picker-index',
  pickerEvents: 'real-input-picker-events',
  pickerGone: 'real-input-drop-gone',
  hostValue: 'host-controlled-value',
  hostEvents: 'host-events-count',
  hostSliderValue: 'host-slider-value',
  hostButtonPresses: 'host-button-presses',
  hostMixedState: 'host-mixed-state',
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
   * A real tap must reach a Switch that React Native drew no view for.
   *
   * Inside a `<Host>` the child's own Android view is laid out at `0 × 0` by the
   * measure gate, so it draws nothing and is nobody's hit target. It is not `GONE` —
   * Fabric re-asserts `VISIBLE` on it in every layout pass, so `GONE` is not what
   * hides it. Nothing under the finger is therefore a React Native view: the only
   * thing that can answer is the Host's own Compose composition, and the only way to
   * aim at it is the accessibility label Compose publishes. The echo is React's own
   * render of the value, so a change can only be touch → Compose → Nitro → JS →
   * re-render.
   *
   * This is a separate control from `switch` because the path is different: here the
   * touch travels through a container that composes somebody else's controls, which is
   * the path a `<Host>` exists to create (H1).
   *
   * The check ends by reading the whole tree for the screen-reader contract (brief
   * item 3, review S6): every hosted control must publish its own label, and the
   * labelled nodes must arrive in mount order between the React Native siblings that
   * surround the `<Host>`. A composition that published its children out of order, or
   * as one anonymous blob, would still tap fine and fail this.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'hosted-switch': async (t) => {
    const control = await t.requireControl('Hosted switch 0');
    const before = t.requireEcho(ECHO.hostValue);
    t.log.checkEquals('the hosted Switch starts off', before, 'off');

    await t.tapNode(control);
    const flipped = t.waitForEchoToChange(
      ECHO.hostValue,
      before,
      'a real tap on a hosted Switch to register'
    );
    t.log.checkEquals(
      'one real tap flips a hosted Switch (React renders "on")',
      flipped,
      'on'
    );

    await t.tapNode(control);
    const back = t.waitForEchoToChange(
      ECHO.hostValue,
      'on',
      'a second real tap to register'
    );
    t.log.checkEquals(
      'a second real tap flips it back, so the check is not one fluke',
      back,
      'off'
    );

    // The taps were answered by the app, not by a lucky render: the screen counts the
    // changes it accepted, and two taps have to be two changes.
    t.log.checkEquals(
      'the Host reported both changes it was asked for',
      t.requireEcho(ECHO.hostEvents),
      '2'
    );

    // What a screen reader is offered (brief item 3, review S6). `uiautomator dump`
    // lists nodes in traversal order, so where a hosted label sits among the plain
    // React Native text nodes around it is the order TalkBack reads them in. The
    // `<Host>` here sits between two `Text`s and holds three labelled Switches, which
    // gives both halves of the claim: one node per child, in mount order, between the
    // RN siblings rather than before or after them.
    const tree = t.dump();
    // Matched without case because the tree carries what is drawn, not what JSX says:
    // this screen's section headings carry `textTransform: 'uppercase'`, so the node
    // reads "THREE SWITCHES, ONE COMPOSITION" and a JSX-exact search finds nothing -
    // which then reads as "the tree has no such node" when it has exactly that node.
    const textOrder = (needle) =>
      tree.findIndex((node) =>
        node.text.toLowerCase().includes(needle.toLowerCase())
      );
    const descOrder = (description) =>
      tree.findIndex((node) => node.contentDesc === description);
    const section = textOrder('Three Switches, one composition');
    const followingNote = textOrder('The Host has a height');
    const hosted = [0, 1, 2].map((index) =>
      descOrder(`Hosted switch ${String(index)}`)
    );

    // A red ordering claim has to say where the tree actually put things, and a
    // missing node has to say what it saw instead: -1 against true would otherwise
    // read as "the order is wrong" when the truth is "this node is not in the tree".
    const where = tree
      .map((node, index) =>
        node.text || node.contentDesc
          ? `${String(index)}:${(node.text || node.contentDesc).slice(0, 22)}`
          : null
      )
      .filter(Boolean)
      .join(' | ');
    t.log.note(
      `tree positions — section=${String(section)}, hosted=${hosted.join(
        '/'
      )}, note=${String(followingNote)}; named nodes: ${where}`
    );

    t.log.checkEquals(
      'the tree carries the RN text above the Host',
      section >= 0,
      true
    );
    t.log.checkEquals(
      'the tree carries the RN note below the Host',
      followingNote >= 0,
      true
    );
    t.log.checkEquals(
      'the tree carries a node for each hosted Switch',
      hosted.map((at) => at >= 0),
      [true, true, true]
    );
    t.log.checkEquals(
      'each hosted Switch is its own labelled node, in mount order',
      hosted,
      [...hosted].sort((left, right) => left - right)
    );
    t.log.checkEquals(
      'the RN text above the Host is read before every hosted Switch',
      hosted.map((at) => at > section),
      [true, true, true]
    );
    t.log.checkEquals(
      'the RN note below the Host is read after every hosted Switch',
      hosted.map((at) => at < followingNote),
      [true, true, true]
    );
  },

  /**
   * A real tap must reach a Button that React Native drew no view for.
   *
   * On Android this is a different question from the unhosted `button` check: inside
   * a `<Host>` the Button has no view of its own to receive anything, so the touch
   * has to land in a composition that belongs to somebody else and be dispatched by
   * Compose. The echo is React's own render, so it moves only if the tap travelled
   * touch to Compose to Nitro to JS to re-render.
   *
   * The two Buttons share one counter and both are given `onPress`, which is what
   * makes the disabled half mean something: a library that let a disabled control
   * answer would move the number, and a screen that had simply stopped rendering is
   * caught by the enabled tap that follows.
   *
   * Both lookups scroll, because this section sits below the fold on a small screen
   * and `uiautomator dump` lists nothing that is off screen - there, "not in the
   * tree" means "not scrolled to", not "not drawn".
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'hosted-button': async (t) => {
    const control = await t.requireControlOnScreen('Hosted button');
    const disabled = await t.requireControlOnScreen('Hosted disabled button');
    t.log.checkEquals(
      'the hosted Buttons start with no presses recorded',
      t.requireEcho(ECHO.hostButtonPresses),
      '0'
    );

    await t.tapNode(control);
    const first = t.waitForEcho(
      ECHO.hostButtonPresses,
      '1',
      'a real tap on a hosted Button to reach onPress'
    );
    t.log.checkEquals(
      'one real tap on a hosted Button reaches onPress',
      first,
      '1'
    );

    // The disabled one gets the same tap at the same kind of offset. Nothing should
    // happen, and the way to say that is to keep watching the number the enabled one
    // moves.
    await t.tapNode(disabled);
    const afterDisabled = t.requireEchoToStay(
      ECHO.hostButtonPresses,
      '1',
      'a tap on the disabled hosted Button to be refused'
    );
    t.log.checkEquals(
      'a real tap on the disabled hosted Button does not press it',
      afterDisabled,
      '1'
    );

    // And the counter is still live: without this, the line above could have passed
    // because the screen stopped rendering rather than because the Button refused.
    // Tap it again - the node is looked up rather than reused because the echo above
    // re-renders the row, and a stale box is how a check starts tapping a neighbour.
    const again = await t.requireControlOnScreen('Hosted button');
    await t.tapNode(again);
    const second = t.waitForEcho(
      ECHO.hostButtonPresses,
      '2',
      'a second real tap to reach onPress'
    );
    t.log.checkEquals(
      'a second real tap presses the hosted Button again',
      second,
      '2'
    );
  },

  /**
   * A real drag must move a Slider that has no view of its own.
   *
   * The drag is aimed at the box the accessibility tree reports for the hosted
   * Slider, which is the box Compose drew - the child's own React Native view is
   * laid out at `0 x 0` by the measure gate, so it is not what the tree is reporting.
   * Dragging along that box and reading the echo React owns is therefore the whole
   * loop: touch, Compose, Nitro, JS, re-render, and the new value back down to native.
   *
   * The width claim is here too, because it is what makes the drag mean what it says:
   * a `fillWidth` control inside a Host fills the Host, not its own style, so the
   * track has to be most of the screen wide. A Slider that had honoured its own
   * decorative frame instead would answer with a fraction of it - and the tree would
   * report that fraction as the node bounds, which is exactly what this reads.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'hosted-slider': async (t) => {
    const control = await t.requireControlOnScreen('Hosted slider');
    const before = t.value(ECHO.hostSliderValue);
    t.log.checkEquals('the hosted Slider starts at 0.40', before, 0.4);

    // The widest node in the tree is a full-width container, so this is the screen:
    // the Host is `width: 100%` of the page minus its padding, and a hosted Slider
    // that had drawn at anything like its own box would be a fraction of it.
    const widest = Math.max(...t.dump().map((node) => node.bounds.width));
    t.log.check(
      `the hosted Slider fills the Host (${String(control.bounds.width)} of ${String(
        widest
      )} px wide)`,
      control.bounds.width > widest * 0.6
    );
    t.log.check(
      'the hosted Slider is a track rather than a square',
      control.bounds.width > control.bounds.height * 3
    );

    await t.dragControl(control, 0.4, 0.9, 800);
    const up = t.waitForValueToRise(
      ECHO.hostSliderValue,
      before,
      'a real drag on a hosted Slider to reach React'
    );
    t.log.check(
      `a real drag moves a hosted Slider and React renders it (${String(
        before
      )} -> ${String(up)})`,
      up != null && up > before + 0.3
    );

    // Back the other way, from wherever the first drag left the thumb - the echo says
    // where that is, because the echo is what a person sees. A control that only ever
    // reported one direction would fail here rather than look fine.
    await t.dragControl(control, 0.9, 0.1, 800);
    const down = t.waitForEchoToChange(
      ECHO.hostSliderValue,
      up,
      'a second drag to move the hosted Slider back'
    );
    const landed = t.value(ECHO.hostSliderValue);
    t.log.check(
      `dragging back moves a hosted Slider the other way (${up} -> ${down}; ${String(
        landed
      )})`,
      landed != null && landed < up - 0.3
    );
  },

  /**
   * Four kinds of control in one `<Host>`, read from the tree a screen reader sees.
   *
   * `hosted-switch` established the contract for one kind (H1). This is the case that
   * a Host is a *container*: a Switch, a Slider, both Progress variants and a Button
   * in one composition, where three things have to hold at once.
   *
   * 1. Each child is its own labelled node, in mount order - not one anonymous blob
   *    that happens to respond to taps somewhere.
   * 2. Each keeps its own geometry rule inside the Host's single `Column` (D24): the
   *    linear controls stretch to the Host, the intrinsic ones do not, so the bar is
   *    as wide as the Slider and the indicator is a small square. A Host that measured
   *    or stretched everything, or one that gave every child the same box, is caught
   *    here rather than in a comment.
   * 3. Pressing one child changes only what it owns: the Button in this Host moves the
   *    press count, and the switch and slider values in the same echo do not move with
   *    it - which is recomposition staying per-child inside a shared composition, the
   *    property a Host exists to preserve.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'hosted-mixed': async (t) => {
    const NAMES = [
      'Mixed switch',
      'Mixed slider',
      'Mixed linear progress',
      'Mixed circular progress',
      'Mixed button',
    ];
    // All five have to be in one breath, so the check scrolls to the last of them
    // first: `uiautomator dump` lists nothing off screen. The readout sits above the
    // box precisely so that it is still on screen at that point, which is what lets
    // the same check read what its own taps did.
    const button = await t.requireControlOnScreen('Mixed button');
    const before = t.requireEcho(ECHO.hostMixedState);
    t.log.checkEquals(
      'the mixed Host starts with nothing answered',
      before,
      'off 0.50 0'
    );
    const tree = t.dump();
    const order = NAMES.map((name) =>
      tree.findIndex((node) => node.contentDesc === name)
    );
    const seen = tree
      .map((node, index) =>
        node.text || node.contentDesc
          ? `${String(index)}:${(node.text || node.contentDesc).slice(0, 22)}`
          : null
      )
      .filter(Boolean)
      .join(' | ');
    t.log.note(`named nodes in the tree: ${seen}`);
    t.log.checkEquals(
      'the mixed Host publishes a node for each of its five children',
      order.map((at) => at >= 0),
      [true, true, true, true, true]
    );
    t.log.checkEquals(
      'each kind of control is its own node, in mount order',
      order,
      [...order].sort((left, right) => left - right)
    );

    const nodeNamed = (name) =>
      tree.find((entry) => entry.contentDesc === name);
    const widthOf = (name) => {
      const node = nodeNamed(name);
      return node == null ? 0 : node.bounds.width;
    };
    const linear = widthOf('Mixed linear progress');
    const circular = widthOf('Mixed circular progress');
    const slider = widthOf('Mixed slider');
    const switcher = widthOf('Mixed switch');
    t.log.note(
      `widths in px - slider=${String(slider)}, bar=${String(
        linear
      )}, indicator=${String(circular)}, switch=${String(switcher)}`
    );
    // Both linear controls fill the Host, so they agree with each other; both
    // intrinsic ones keep their own width, so they are much narrower than the Host.
    t.log.check(
      `the linear bar is as wide as the Slider (${String(linear)} vs ${String(
        slider
      )})`,
      Math.abs(linear - slider) <= Math.max(8, linear * 0.05)
    );
    t.log.check(
      `the circular indicator keeps its own width (${String(
        circular
      )} vs ${String(linear)})`,
      circular > 0 && circular * 3 < linear
    );
    t.log.check(
      `the Switch keeps its own width too (${String(
        switcher
      )} vs ${String(linear)})`,
      switcher > 0 && switcher * 3 < linear
    );
    const indicator = nodeNamed('Mixed circular progress');
    t.log.check(
      `the indicator is drawn as a square, not stretched across the Host (${
        indicator == null
          ? 'no node'
          : `${String(indicator.bounds.width)} x ${String(
              indicator.bounds.height
            )}`
      })`,
      indicator != null &&
        Math.abs(indicator.bounds.width - indicator.bounds.height) <= 8
    );

    // Pressing one child answers for that child only.
    await t.tapNode(button);
    const pressed = t.waitForEcho(
      ECHO.hostMixedState,
      'off 0.50 1',
      'a real tap on the mixed Host Button to reach onPress'
    );
    t.log.checkEquals(
      'the Button in a mixed Host presses, and nothing else in it moved',
      pressed,
      'off 0.50 1'
    );

    await t.tapNode(await t.requireControlOnScreen('Mixed switch'));
    t.log.checkEquals(
      'the Switch in the same Host answers too, and the press count stays',
      t.waitForEcho(
        ECHO.hostMixedState,
        'on 0.50 1',
        'a real tap on the mixed Host Switch to register'
      ),
      'on 0.50 1'
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
  const apk =
    process.env.HARNESS_APP_PATH ??
    path.resolve(
      repoRoot(),
      'example/android/app/build/outputs/apk/debug/app-debug.apk'
    );

  // This suite installs an APK rather than building one, so it is exactly as
  // exposed to a stale artifact as the harness is: `adb install -r` of an old
  // debug build would report green for code that is not here. The stamp says
  // which tree the APK came from and which hybrids its dex contains.
  try {
    assertFreshApp({
      platform: 'android',
      artifact: apk,
      command: 'bun run test:real-input:android',
    });
  } catch (error) {
    // Before `adb` is even asked which devices exist, before Metro, before the
    // emulator: a refusal must not touch a device another task is holding.
    console.error(colorize(String(error?.message ?? error), 'red'));
    throw error;
  }

  const device = resolveDevice(process.env);
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
   * The example's tabs are its only navigation.
   *
   * @param {'switch' | 'slider' | 'button' | 'segmented' | 'datepicker'
   *   | 'picker' | 'host'} screen
   */
  async goToScreen(screen) {
    const label = {
      switch: 'Switch',
      slider: 'Slider',
      button: 'Button',
      segmented: 'Segments',
      datepicker: 'Dates',
      picker: 'Picker',
      host: 'Host',
    }[screen];
    const anchor = {
      switch: ECHO.switchValue,
      slider: ECHO.sliderStart,
      button: ECHO.buttonCount,
      segmented: ECHO.segmentedIndex,
      datepicker: ECHO.dateValue,
      picker: ECHO.pickerIndex,
      host: ECHO.hostValue,
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

  // The lease's rules, applied to whatever it exported (review S5): a reserved
  // serial is refused whichever variable named it, and a serial that disagrees
  // with its own port is refused rather than resolved by whoever reads first.
  // This suite boots nothing, so it is the last place that can still say no
  // before someone else's device receives an `adb -s`.
  const lease = checkEmulatorEnv(env);
  const bootHint =
    `emulator -avd ${avd} -port ${String(lease.port ?? 5572)} ` +
    '-gpu host -no-window -no-audio -no-boot-anim -no-snapshot-save';

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
    .filter((line) => line.startsWith('emulator-'))
    // The reserved serial never becomes a candidate, not even when it runs the
    // AVD this task owns: an emulator booted without `-port` can land there, and
    // an AVD-name match is not a licence to use the person's console.
    .filter((line) => !isReservedSerial(line));

  const wanted = env.ANDROID_SERIAL;
  if (wanted != null && wanted !== '') {
    if (!serials.includes(wanted)) {
      throw new Error(
        `real-input: ANDROID_SERIAL=${wanted} is not connected to adb server ` +
          `${env.ANDROID_ADB_SERVER_PORT ?? 'default'}. If the emulator was ` +
          `booted by hand, it needs the leased console port:\n  ${bootHint}`
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
        bootHint
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
