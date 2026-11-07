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
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import {
  artifactsDir,
  blockMs,
  chosenControls,
  ensureMetro,
  run,
  runCheck,
  sleep,
  Suite,
} from './support.mjs';
import { REAL_INPUT_CONTROLS } from './controls.mjs';
import { ECHO, gestureCounts, gestureReported, screenTab } from './screens.mjs';
import {
  findAllByDescription,
  findByDescription,
  findByTestId,
  findAllByText,
  findTab,
  parseHierarchy,
  tabTarget,
} from './uiautomator.mjs';
import { checkTabTargets, exampleTabs } from './tab-targets.mjs';
import { nativeChecked, nativeEnabled } from './android-tree.mjs';
import { decodePng, pixelAt } from './png-pixel.mjs';
import {
  CALENDAR_WIDE_MIN_DP,
  calendarGridProblems,
  expectedColumnDp,
  measureCalendarGrid,
} from './android-calendar.mjs';
import { runA11ySweep } from './a11y-sweep.mjs';
import { assertSupportedNodeOrReexec } from '../node-version.mjs';
import { assertFreshApp, colorize } from '../app-stamp.mjs';
import { checkEmulatorEnv, isReservedSerial } from '../lease-core.mjs';
import { emulatorLaunchCommand } from '../emulator-launch.mjs';

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

/** The Enter key, which a single-line field takes as its editor action (submit). */
const KEY_ENTER = 66;

/** The system Back key, which is how a person dismisses an open popup. */
const KEY_BACK = 4;

/** How long a control gets to react to a gesture it should have answered. */
const REACT_TIMEOUT = Number(process.env.REAL_INPUT_TIMEOUT ?? 8000);

/**
 * How apart the reads of a *gesture in flight* are spaced, in ms.
 *
 * Every read this suite makes is a `uiautomator dump`, and a dump is not free for
 * the app being watched: answering it walks the control tree on the app's own UI
 * thread. Reading at 250-300 ms is right for "has React drawn my tap yet", where
 * the app is otherwise idle. During a drag it is the opposite — the app is trying
 * to run a gesture, and each dump competes with the frames that gesture needs,
 * which is half of why a stalled echo was ever mistaken for a finished drag (see
 * {@link makeContext.dragControl}). A gesture-end question is coarse — has the
 * finger left — so it is worth asking less than twice a second.
 */
const GESTURE_POLL_MS = 700;

/**
 * How many times a drag may be injected before the run calls it broken.
 *
 * Two: one to be affected by whatever the machine was doing, and one to find out
 * whether that was the machine. Anything higher hides a control that never
 * answers, which is the failure mode a drag check exists to catch.
 */
const DRAG_ATTEMPTS = 2;

/**
 * How often to poll a witness that is read out of `uiautomator dump`.
 *
 * A dump costs about two seconds on this machine's loaded emulator (measured: three
 * back-to-back dumps at 1.96-2.00 s), so polling one at `pressUntil`'s default 100 ms
 * spends the entire attempt on readings - and, worse, spends it *inside* whatever
 * timer inside the app the check is racing. The drop-picker cycles arm an unmount on
 * a timer of their own, and a witness loop that needs four dumps to find what it is
 * looking for arrives after the view has gone. The reading cannot be made cheaper
 * from out here, so the poll matches it.
 */
const DUMP_POLL_MS = 500;
/** How long the first render may take (a cold Metro bundle is slow). */
const READY_TIMEOUT = Number(process.env.REAL_INPUT_READY_TIMEOUT ?? 180000);

/**
 * How tall a node's box has to be for `requireControlOnScreen` to treat it as
 * arrived. Below this the box is what a scroll left of a row rather than the row:
 * a Host clips its own children, and a hosted row sitting on the screen's fold is
 * reported with a box one or two pixels tall whose centre a tap can only miss.
 * Nothing this suite presses is shorter than a touch target.
 */
const MIN_PRESSABLE_PX = 16;

/**
 * ## Adding a control
 *
 * Add one entry here, one in `scripts/real-input/controls.mjs`, and one iOS
 * check in `example/ios/NitroUiExampleUITests/RealInputTests.swift`. A control
 * listed in the table but missing here is reported as a failure, never skipped.
 *
 * Each check gets the `t` object from `makeContext`: it is the only way in, so a
 * check cannot reach adb, Nitro or the app process by accident.
 *
 * One control's check reads a screenshot rather than the tree, because a box's
 * corners are the one thing about it that `uiautomator` cannot see; that is the
 * `screencap` method on `DeviceHarness`, still the only adb entry point.
 */

/**
 * How far (per channel, 0-255) a pixel has to be from the page to be *ink*.
 *
 * Half of the measured gap between Material's light `outline` stroke and the page
 * this control sits on (162 at the run that fixed the number): antialiasing on a
 * 1 dp stroke is a blend, and this is the loosest reading that is still certainly
 * not the page. The page is sampled from the same screenshot rather than assumed,
 * so the number only has to separate a border from a background, not name either.
 */
const MIN_STROKE_INK_DISTANCE = 40;

const CHECKS = {
  /**
   * A real tap must flip the hosted Material 3 Switch and bring the new value
   * back to React. The echo is React's own render, so it only changes if the
   * touch reached Compose, Compose told Nitro, and Nitro told JS.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'switch': async (t) => {
    const before = t.requireEcho(ECHO.switchValue);
    t.log.checkEquals('the Switch starts off', before, 'off');

    // Each tap is confirmed by the value it should produce before the next one is
    // made, so a delivery the InputManager dropped costs a retry instead of reading
    // as a Switch that refuses a finger (`FOLLOWUPS.md:58`, and the same fault iOS
    // reproduces on this machine's runs). `waitForEchoToChange` alone would accept
    // *any* movement and then be asserted against `on`, so it is not a safe thing to
    // repeat; keying on the value is the same wait, made repeatable.
    t.log.checkEquals(
      'one real tap flips the Switch (React renders "on")',
      await t.tapUntilValue(
        () => t.requireControl('Controlled switch'),
        ECHO.switchValue,
        'on',
        'the first real tap',
        { nativeLabel: 'Controlled switch' }
      ),
      'on'
    );

    t.log.checkEquals(
      'a second real tap flips it back (React renders "off")',
      await t.tapUntilValue(
        () => t.requireControl('Controlled switch'),
        ECHO.switchValue,
        'off',
        'the second real tap',
        { nativeLabel: 'Controlled switch' }
      ),
      'off'
    );
    // No "every press at a short dwell arrives" counterpart here, unlike iOS:
    // `adb shell input tap` injects a fixed-duration press and has no dwell knob,
    // so there is no press length for this suite to hold still. F7 measured the
    // question separately with `input swipe` at zero distance (a press whose length
    // the caller sets) and Android delivered 12/12 at 5, 20, 50 and 100 ms — see
    // docs/tasks/F7/probe-android-busy-hosted.json and the report's Android table.
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
    const before = t.requireEcho(ECHO.hostValue);
    t.log.checkEquals('the hosted Switch starts off', before, 'off');

    t.log.checkEquals(
      'one real tap flips a hosted Switch (React renders "on")',
      await t.tapUntilValue(
        () => t.requireControl('Hosted switch 0'),
        ECHO.hostValue,
        'on',
        'the first real tap on a hosted Switch',
        { nativeLabel: 'Hosted switch 0' }
      ),
      'on'
    );

    t.log.checkEquals(
      'a second real tap flips it back, so the check is not one fluke',
      await t.tapUntilValue(
        () => t.requireControl('Hosted switch 0'),
        ECHO.hostValue,
        'off',
        'the second real tap',
        { nativeLabel: 'Hosted switch 0' }
      ),
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
    await t.requireControlOnScreen('Hosted button');
    const disabled = await t.requireControlOnScreen('Hosted disabled button');
    t.log.checkEquals(
      'the hosted Buttons start with no presses recorded',
      t.requireEcho(ECHO.hostButtonPresses),
      '0'
    );

    // The node is looked up on every attempt rather than reused: the echo re-renders
    // the row, and a stale box is how a check starts tapping a neighbour.
    t.log.checkEquals(
      'one real tap on a hosted Button reaches onPress',
      await t.tapUntilValue(
        () => t.requireControlOnScreen('Hosted button'),
        ECHO.hostButtonPresses,
        '1',
        'the first real tap on a hosted Button'
      ),
      '1'
    );

    // The disabled one gets the same tap at the same kind of offset. Nothing should
    // happen, and the way to say that is to keep watching the number the enabled one
    // moves. Deliberately not retried: this assertion is about a period in which the
    // count must not move, and pressing again is the one thing that would move it.
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
    t.log.checkEquals(
      'a second real tap presses the hosted Button again',
      await t.tapUntilValue(
        () => t.requireControlOnScreen('Hosted button'),
        ECHO.hostButtonPresses,
        '2',
        'the second real tap on a hosted Button'
      ),
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
   * Its echo row is `host-slider-gesture` (`start=N complete=M`), and a drag of this
   * control has to be waited for through it: the value echo says where a drag ended,
   * never whether one is still going, and that gap is the flake this check used to be
   * the only source of. See [dragAndSettle].
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

    // The drag, ended by the control rather than by a stopwatch: `dragAndSettle`
    // waits for `host-slider-gesture` to report both phases of *this* gesture before
    // it lets the value be read. That echo is the whole reason this check stopped
    // being the one that fails alone - see [dragAndSettle].
    const up = await t.dragAndSettle(control, 0.4, 0.9, 800, {
      gesture: ECHO.hostSliderGesture,
      value: ECHO.hostSliderValue,
      description: 'a real drag on a hosted Slider to reach React',
    });
    t.log.check(
      `a real drag moves a hosted Slider and React renders it (${String(
        before
      )} -> ${String(up)})`,
      up != null && up > before + 0.3
    );
    // Every gesture the control reported has been closed, so nothing here is reading
    // a drag that is still open. Compared rather than matched against `start=1
    // complete=1`, because a drag the run had to inject twice is a fact the retry
    // count carries, not a reason this line goes red.
    const gestures = gestureCounts(t.requireEcho(ECHO.hostSliderGesture));
    t.log.check(
      `the hosted Slider closed the gesture it opened (${t.requireEcho(
        ECHO.hostSliderGesture
      )})`,
      gestures.starts != null &&
        gestures.starts >= 1 &&
        gestures.completes === gestures.starts
    );

    // Back the other way, from wherever the first drag left the thumb - the echo says
    // where that is, because the echo is what a person sees. A control that only ever
    // reported one direction would fail here rather than look fine.
    // The same rule for the way back. The first drag is the one that used to be
    // believed at 0.43; a check that only got the second drag right would still have
    // the flake.
    const landed = await t.dragAndSettle(control, 0.9, 0.1, 800, {
      gesture: ECHO.hostSliderGesture,
      value: ECHO.hostSliderValue,
      description: 'a second drag on the hosted Slider',
    });
    t.log.check(
      `dragging back moves a hosted Slider the other way (${up} -> ${String(landed)})`,
      landed != null && landed < up - 0.3
    );

    // A drag the machine has stretched out - which is what the flake actually was.
    //
    // Its samples arrive 1400 ms apart instead of in an 800 ms burst, so the value
    // sits perfectly still for longer than the 1200 ms the old settle needed to
    // believe a drag was over. Halfway through that drag the old code read a thumb a
    // fraction of the way along, which is the `0.43` of a drag aimed at `0.9` that
    // made this the control that failed alone on several branches; waiting for the
    // control cannot be fooled by a pause. It is also the reason this assertion is
    // here: if the settle ever goes back to a stopwatch, this line goes red on an idle
    // machine, with no load to wait for.
    const stretched = await t.dragAndSettle(control, 0.2, 0.85, 0, {
      gesture: ECHO.hostSliderGesture,
      value: ECHO.hostSliderValue,
      description: 'a stretched-out drag on the hosted Slider',
      stepMs: 1400,
    });
    t.log.check(
      `a drag the machine stretches out still lands where the finger left it (${String(
        landed
      )} -> ${String(stretched)})`,
      stretched != null && stretched > 0.75
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
    await t.requireControlOnScreen('Mixed button');
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
    t.log.checkEquals(
      'the Button in a mixed Host presses, and nothing else in it moved',
      await t.tapUntilValue(
        () => t.requireControlOnScreen('Mixed button'),
        ECHO.hostMixedState,
        'off 0.50 1',
        'a real tap on the mixed Host Button to reach onPress'
      ),
      'off 0.50 1'
    );

    t.log.checkEquals(
      'the Switch in the same Host answers too, and the press count stays',
      await t.tapUntilValue(
        () => t.requireControlOnScreen('Mixed switch'),
        ECHO.hostMixedState,
        'on 0.50 1',
        'a real tap on the mixed Host Switch to register'
      ),
      'on 0.50 1'
    );
  },

  /**
   * A real tap must select a segment of a `SegmentedControl` that lives inside a
   * `<Host>`.
   *
   * H2b's three popup-era controls are the first ones a Host has ever held that are
   * not `fillWidth`, so the question this answers is the plainest one: does a control
   * drawn by somebody else's composition still take a finger? The `SegmentedControl`
   * owns no window, which is what makes it the clean case of the three - a hit that
   * lands on the wrong row would show up here as the wrong index rather than as a
   * popup in the wrong place.
   *
   * The echo is React's own render (`HostScreen`'s `popSegmented`), so it moves only
   * if the touch reached the Host's Compose column, Compose told Nitro, Nitro told JS,
   * and JS rendered. A second, different segment is owed because a control that echoed
   * once and then froze would satisfy the first line alone.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'hosted-segmented': async (t) => {
    const control = await t.requireControlOnScreen('Hosted segmented');
    const startedAt = t.boundsText(control);
    t.log.checkEquals(
      'the hosted SegmentedControl shows the index JS gave it',
      t.requireEcho(ECHO.hostSegmentedIndex),
      '0'
    );
    t.log.checkEquals(
      'no window belongs to the app before a touch',
      t.popupWindowCount(),
      0
    );

    // The control is re-found for each press: a hosted SegmentedControl keeps its box
    // (asserted below), but a check that aimed every attempt at a stale node would be
    // aiming at the wrong place wherever that is not true.
    t.log.checkEquals(
      'a real tap on the middle segment of a hosted SegmentedControl reaches JS as index 1',
      await t.tapUntilValue(
        () => t.requireControlAt('Hosted segmented', control),
        ECHO.hostSegmentedIndex,
        '1',
        'a real tap on a hosted segment to register',
        { aim: (node) => t.tapControlAt(node, 0.5) }
      ),
      '1'
    );

    const moved = await t.requireControl('Hosted segmented');
    t.log.checkEquals(
      'the drawing did not move out from under the finger',
      t.boundsText(moved),
      startedAt
    );

    t.log.checkEquals(
      'a real tap on the last segment reaches JS as index 2',
      await t.tapUntilValue(
        () => t.requireControlAt('Hosted segmented', control),
        ECHO.hostSegmentedIndex,
        '2',
        'a second real tap to register',
        { aim: (node) => t.tapControlAt(node, 0.9) }
      ),
      '2'
    );
    t.log.checkEquals(
      'and a SegmentedControl opens no window of its own, hosted or not',
      t.waitForPopupCount(
        0,
        'the hosted SegmentedControl to own no window of its own'
      ),
      0
    );
  },

  /**
   * A real tap must open a hosted `Picker`'s menu, and a real tap on one of its rows
   * must reach JS.
   *
   * This is the claim H2b exists to make: a Compose popup opened from a Host's shared
   * composition is a window that belongs to that composition, so it opens under the row
   * the Host drew - not under the decorative React Native frame, and not at the top of
   * the screen - and closes to the same outside tap, back gesture or row it always had.
   *
   * Three things are read, in the order a person would meet them:
   *
   * 1. Opening costs a window (`popupWindowCount` 0 -> 1) and the menu's first row sits
   *    below the top of the anchor the Host drew. The Host screen is scrolled before
   *    this check runs, so the anchor is nowhere near the top of the screen: a menu
   *    anchored to the RN frame instead of the drawing would land elsewhere, and this
   *    is where that shows up.
   * 2. A row is a choice - it closes the menu and reports its index, and the row already
   *    chosen is marked selected to TalkBack.
   * 3. Back closes it and reports nothing, and no window is left behind.
   *
   * While the menu is open the app's own `Text` is a different window's business, so no
   * echo is read until the popup is down - the same rule `CHECKS['picker']` follows.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'hosted-picker': async (t) => {
    // The three choices of the popup Host, spelled as `HostScreen` spells them. `Beta`
    // is the index JS starts the control at (1), `Gamma` is the one this check picks.
    // None of the three appears anywhere else on the screen, which is what lets a text
    // match name a popup row.
    const CHOSEN = 'Beta';
    const PICK = 'Gamma';

    const anchor = await t.requireControlOnScreen('Hosted picker');
    t.log.checkEquals(
      'the hosted Picker shows the index JS gave it',
      t.requireEcho(ECHO.hostPickerIndex),
      '1'
    );
    t.log.checkEquals(
      'no popup window belongs to the app before a touch',
      t.popupWindowCount(),
      0
    );

    // 1. Open. The rows exist only while the menu is open, which is also the witness
    //    that the hosted anchor answered a touch at all.
    t.log.checkEquals(
      'a real tap on the hosted anchor opens the menu as a popup window',
      await t.tapUntilUp(
        () => t.requireControlAt('Hosted picker', anchor),
        'a real tap on the hosted anchor to open a popup window',
        () => t.popupWindowCount()
      ),
      '1'
    );
    const row = t.waitForOption(PICK, 'the hosted menu to open');
    t.log.note(
      `menu row "${PICK}" at ${String(row.bounds.x1)},${String(
        row.bounds.y1
      )} -> ${String(row.bounds.x2)},${String(
        row.bounds.y2
      )}; hosted anchor at ${String(anchor.bounds.x1)},${String(
        anchor.bounds.y1
      )} -> ${String(anchor.bounds.x2)},${String(anchor.bounds.y2)}`
    );
    t.log.check(
      'the menu opens below the top of the box the Host drew, not at the top of the screen',
      row.bounds.y1 >= anchor.bounds.y1
    );
    t.log.check(
      `the hosted menu marks the current choice ("${CHOSEN}") selected to TalkBack`,
      t.optionIsSelected(CHOSEN)
    );

    // 2. A row is a choice.
    t.log.checkEquals(
      'and the row reaches JS as index 2',
      await t.tapOptionUntilValue(
        PICK,
        ECHO.hostPickerIndex,
        '2',
        'a pick from the hosted menu to reach JS'
      ),
      '2'
    );
    t.log.checkEquals(
      'a real tap on a hosted menu row closes the popup',
      t.waitForPopupCount(
        0,
        'a pick from the hosted menu to take its window down'
      ),
      0
    );

    // 3. The way out that changes nothing. Aim again: choosing a row widens the title
    //    the anchor paints, so the box this check has may be stale.
    await t.tapUntilUp(
      () => t.requireControlAt('Hosted picker', anchor),
      'a real tap that reopens the hosted menu',
      () => t.popupWindowCount()
    );
    t.waitForOption(PICK, 'the hosted menu to reopen');
    await t.pressBack();
    t.log.checkEquals(
      'Back shuts the hosted popup (no window left behind)',
      t.waitForPopupCount(0, 'the back gesture to take the hosted popup down'),
      0
    );
    t.log.checkEquals(
      'opening and dismissing reported no selection - a menu is not a choice',
      t.requireEcho(ECHO.hostPickerIndex),
      '2'
    );
  },

  /**
   * A real tap must open a `Menu`'s popup, a real tap on a row must reach JS as a
   * pick, and a disabled row must take none.
   *
   * Why the harness cannot cover it (`Menu.harness.tsx` covers the same shapes): a
   * Compose popup is a window of its own, and the harness's touch injector reaches the
   * React Native window, so nothing there has ever pressed the trigger or a row. The
   * harness reaches a pick through `nuiTestSelectRow`, which is the model's pick path
   * and not the popup's. Here the presses come from `adb shell input`, and the only
   * witnesses are the window table and the text the app renders — which is the pair
   * that can see D32: Android reports `open`, then `select`, then `close` for one
   * pick, and a pick that did not arrive must not be retried into a second one.
   *
   * Two things worth naming before the steps:
   *
   * - **The echo cannot be read with the popup open.** The dump returns the popup's
   *   tree while it is up, so every reading of `real-input-menu-*` happens after a
   *   dismissal, and the accessibility claims about the *trigger* are taken before the
   *   first tap. That is the same rule the `picker` check follows.
   * - **The F1 native-state guard cannot be armed for a pick.** `pressUntil` wants a
   *   reading of what the control itself holds; a Menu publishes its expanded state as
   *   a Compose `stateDescription`, which `uiautomator dump` does not carry, and its
   *   row has no `checked` state to read either. What *is* armed is the delivery
   *   witness for the press that opens the popup — the window table, which is the
   *   control's own state as far as out here is concerned — and for the pick,
   *   `tapOptionUntilValue`'s rule that a row which has gone is not pressed again, so
   *   a retry can never land a second choice.
   *
   * iOS has no `open`/`close` in any of these readings because a SwiftUI `Menu` keeps
   * its presentation to itself (D32); the same echo reads `select bravo` there.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  /**
   * A ContextMenu under a real finger (G16): a quick tap is the child's, a still hold
   * opens the menu at the finger and cancels the child's touch, a pick reports select
   * then close, a drag scrolls and opens nothing, the innermost of two nested menus
   * wins, a disabled one leaves the hold to its child, Back and an outside tap close it,
   * and an accessible one is a single long-clickable node. The measurements are S3's
   * (`docs/tasks/S3-contextmenu-spike.report.md`, questions 1, 2 and 5), made here on
   * the shipped component; `contextMenuCheck` below says what each step reads.
   */
  'context-menu': async (t) => contextMenuCheck(t),
  'menu': async (t) => {
    // The three titles of `real-input-menu`, spelled as `MenuScreen` spells them.
    // None appears anywhere else on the screen, which is what lets a text match name a
    // popup row; `Locked row` is the disabled one.
    const PICK = 'Bravo';
    const TWIN = 'Alpha';
    const LOCKED = 'Locked row';
    // The checkable row: a `CheckableDropdownMenuItem`, whose pick goes through
    // `onCheckedChange` rather than `onClick` - the wiring step 6 exists for.
    const CHECKED = 'Checked row';

    // 1. Before any touch: the echoes, the window table, and what a screen reader is
    //    offered. The trigger's node is read here rather than later because a popup
    //    owns the dump while it is up.
    const control = await t.requireControlOnScreen('Real-input menu');
    // The one node behind this label, and the text it paints. Compose merges the
    // trigger's semantics into a single node (the `clearAndSetSemantics` fix
    // `HybridNitroUiMenu.kt` records), so name, value and role all land there — and
    // `requireControlOnScreen` would happily hand back the first of several. Counting
    // here is what makes the readings below claims about *one* announcement rather
    // than about whichever node the dump happened to write first.
    const named = t.nodesNamed('Real-input menu');
    t.log.checkEquals(
      "one node carries the trigger's name, so TalkBack announces it once",
      named.length,
      1
    );
    t.log.checkEquals(
      'and that same node carries the title it paints as its value',
      named[0]?.text,
      'Actions'
    );
    // The role `Role.DropdownList` reaches the dump as the class Compose gives a
    // drop-down — the same reading `CHECKS.picker` step 8 makes for a Picker.
    t.log.checkEquals(
      'the node announces the role of a list of choices',
      named[0]?.className,
      'android.widget.Spinner'
    );
    t.log.checkEquals(
      'the Menu has reported no pick before a touch',
      t.requireEcho(ECHO.menuPick),
      '-'
    );
    t.log.checkEquals(
      'and no event of any kind',
      t.requireEcho(ECHO.menuEvents),
      'none'
    );
    t.log.checkEquals(
      'no popup window belongs to the app before a touch',
      t.popupWindowCount(),
      0
    );

    // 2. Opening. The window is the witness that the press arrived, so the trigger is
    //    tapped until one is up.
    t.log.checkEquals(
      'a real tap on the trigger opens the menu as a popup window',
      await t.tapUntilUp(
        () => t.requireControlAt('Real-input menu', control),
        'a real tap on the trigger',
        () => t.popupWindowCount(),
        { pollMs: DUMP_POLL_MS }
      ),
      '1'
    );
    t.waitForOption(PICK, 'the menu to open');
    // The row vocabulary, read from the popup's own tree. The count is asserted; the
    // attributes are printed rather than pinned, because what the tree says about a
    // *disabled* row is not what this check assumed: the first real run read
    // `enabled="true"` on the row the group disables, while the pick that check refuses
    // is refused by the control (step 5 measures that with the twin as its barrier). So
    // the numbers go in the log, the refusal is asserted where a finger proves it, and
    // what a screen reader is told about a disabled row is a question for the library
    // rather than a claim invented here.
    const rows = t
      .dump()
      .filter(
        (node) => [PICK, TWIN, LOCKED].includes(node.text) && node.text !== ''
      );
    t.log.checkEquals(
      'the popup carries all three rows in the accessibility tree',
      rows.length,
      3
    );
    for (const node of rows) {
      t.log.note(
        `row "${node.text}": enabled=${node.enabled} clickable=${node.clickable} ` +
          `checkable=${node.checkable} selected=${node.selected} ` +
          `class=${node.className}`
      );
    }

    // 3. The way out that changes nothing. Back is the platform's own, and a dismissal
    //    must not be mistaken for a pick or counted as a second open.
    await t.pressBack();
    t.log.checkEquals(
      'Back shuts the popup (no window left behind)',
      t.waitForPopupCount(0, 'the back gesture to take the popup down'),
      0
    );
    t.log.checkEquals(
      'opening and dismissing reported no pick',
      t.requireEcho(ECHO.menuPick),
      '-'
    );
    // D32: opening is a thing that happens on Android, so it is reported - once, and
    // with a close to match. An echo that read `open > open` would be the anchor and
    // `menuAnchor`'s own handling both reporting one gesture.
    t.log.checkEquals(
      'and the pair the platform does report: one open, one close',
      t.requireEcho(ECHO.menuEvents),
      'open > close'
    );

    // 4. A pick. Aim again: the first dismissal leaves the trigger where it was, and
    //    `requireControlAt` says so if it has moved.
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input menu', control),
      'a real tap that reopens the menu',
      () => t.popupWindowCount(),
      { pollMs: DUMP_POLL_MS }
    );
    t.log.checkEquals(
      `a real tap on the row "${PICK}" reaches JS`,
      await t.tapOptionUntilValue(
        PICK,
        ECHO.menuPick,
        'bravo',
        'a pick from the menu to reach JS'
      ),
      'bravo'
    );
    t.log.checkEquals(
      'a pick closes its own popup',
      t.waitForPopupCount(0, 'the pick to take that popup down'),
      0
    );
    // The ordering D32 rules on, asserted as the WHOLE echo rather than a tail of it.
    // A three-event tail also matches `open > open > select bravo > close`, which is
    // exactly what a retried tap or double-reporting anchor produces - the duplicate
    // step 3's `open > close` check can only see from the front. The full string pins
    // this suite's own steps (tap, Back, tap, pick), which is the point: the run has a
    // deterministic shape and anything else in it, in any order, is a finding.
    t.log.checkEquals(
      'one pick reports open, then select, then close - in that order',
      t.requireEcho(ECHO.menuEvents),
      'open > close > open > select bravo > close'
    );

    // 5. The disabled row. A tap on it must report no pick.
    //
    //    Three things this step does not assert, each because the first real run
    //    measured the library doing something the check had invented:
    //
    //    - **Whether the popup stays up.** It does, on every run so far: the disabled row
    //      swallows the tap and leaves the window standing. That is not asserted either
    //      way here, because the refusal is the claim about the control and the window's
    //      fate is Compose's.
    //    - **How the popup comes down, once it has to.** Neither of a person's two ways
    //      is dependable after that tap: the scrim tap left it up at 30 Oct 00:35:09Z
    //      and closed it at 01:49:39Z, and one run's Back press timed out with the
    //      window still standing (29 Oct 23:33:43Z). The sequence below - scrim, then
    //      Back if the scrim left it up - is what gets the screen back, and the log
    //      says which one did. All measured, none asserted.
    //    - **What the tree says about the row itself.** Printed in step 2. The row this
    //      check refuses read `enabled="true"` in the dump while the control refused it,
    //      so the announcement and the behaviour are different questions - see the
    //      report's follow-ups. Asserting the refusal on the *echo* is the honest form.
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input menu', control),
      'a real tap that opens the menu to reach the disabled row',
      () => t.popupWindowCount(),
      { pollMs: DUMP_POLL_MS }
    );
    await t.tapNode(
      t.waitForOption(LOCKED, 'the menu to show the disabled row')
    );
    const afterLockedTap = t.popupWindowCount();
    t.log.note(
      `the disabled row's tap left popup windows = ${String(afterLockedTap)}`
    );
    // Put the popup away before reading an echo, because a popup owns the dump: with a
    // window up, the app's own `Text` nodes are not in the tree and every echo reads as
    // missing. Both of the two dismissals a person has are tried, and which one worked is
    // logged rather than asserted - the claim under test is what the control *reported*,
    // not which of Compose's own rules ended the gesture.
    if (afterLockedTap > 0) {
      await t.tapScrim();
      let closedBy = 'the scrim tap';
      if (t.popupWindowCount() > 0) {
        await t.pressBack();
        closedBy = 'the back gesture, after a scrim tap left it up';
      }
      t.log.note(
        `that popup came down on ${closedBy}; popup windows now ` +
          String(t.popupWindowCount())
      );
    }
    t.log.checkEquals(
      'a tap on the disabled row reports no pick',
      t.requireEchoToStay(ECHO.menuPick, 'bravo', 'a tap on the disabled row'),
      'bravo'
    );
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input menu', control),
      'a real tap that reopens the menu for the twin row',
      () => t.popupWindowCount(),
      { pollMs: DUMP_POLL_MS }
    );
    t.log.checkEquals(
      `the enabled row "${TWIN}", tapped the same way, does report a pick`,
      await t.tapOptionUntilValue(
        TWIN,
        ECHO.menuPick,
        'alpha',
        'the twin pick to reach JS'
      ),
      'alpha'
    );
    t.log.checkEquals(
      'so the line above measured a refusal, not a dead screen',
      t.waitForPopupCount(0, 'the twin pick to take its popup down'),
      0
    );
    // And the whole history again, now that the last two gestures are in it. The
    // reopen before the disabled-row tap fires an `open` and the dismissal after it
    // fires the matching `close`, with no pick in between, and the twin pick is one
    // more open/close pair around its own select. This is the strictest form of D32's
    // promise on Android: every open has exactly one close, a dismissal of a disabled
    // row still counts as a close, and nothing the suite performs is reported twice or
    // out of order. The shape is measured green on 30 Oct at 02:06:15Z; under the M1
    // mutation (01:49:39Z) every doubled `open` shows up in it.
    t.log.checkEquals(
      'the whole echo pairs every open with a close, in the order the gestures happened',
      t.requireEcho(ECHO.menuEvents),
      'open > close > open > select bravo > close > open > close > open > select alpha > close'
    );

    // 6. The checked row. Its pick is a different handler from every row above
    //    (`onCheckedChange`, `MenuRows.kt`), and the harness never reaches it:
    //    `nuiTestSelectRow` calls the model's pick directly. So a finger presses it here.
    //    `tapOptionUntilValue` re-presses only while the row is still up, so a retry
    //    cannot land a second pick; the echo below is what proves exactly one arrived.
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input menu', control),
      'a real tap that reopens the menu for the checked row',
      () => t.popupWindowCount(),
      { pollMs: DUMP_POLL_MS }
    );
    const checkedRow = t.waitForOption(
      CHECKED,
      'the menu to show the checked row'
    );
    t.log.note(
      `row "${CHECKED}": enabled=${checkedRow.enabled} clickable=${checkedRow.clickable} ` +
        `checkable=${checkedRow.checkable} checked=${checkedRow.checked} ` +
        `class=${checkedRow.className}`
    );
    t.log.checkEquals(
      `a real tap on the checked row "${CHECKED}" reaches JS as its id`,
      await t.tapOptionUntilValue(
        CHECKED,
        ECHO.menuPick,
        'checked',
        'a pick of the checked row to reach JS'
      ),
      'checked'
    );
    t.log.checkEquals(
      'a pick of the checked row closes its own popup',
      t.waitForPopupCount(0, 'the checked-row pick to take its popup down'),
      0
    );
    const finalEvents = t.requireEcho(ECHO.menuEvents);
    t.log.checkEquals(
      'the checked row reported exactly one select',
      finalEvents.split(' > ').filter((said) => said === 'select checked')
        .length,
      1
    );
    t.log.checkEquals(
      'and the whole echo ends with one more open > select checked > close',
      finalEvents,
      'open > close > open > select bravo > close > open > close > open > select alpha > close' +
        ' > open > select checked > close'
    );

    // 7. The split trigger (E3): the same `primaryAction` prop, drawn as two hit
    //    targets.
    //
    //    Everything above is the plain trigger, where a tap can only mean "open". The
    //    screen's second Menu hands the same prop a leading half that acts and a
    //    trailing half that opens, and the only out-of-process witnesses are the two
    //    accessibility nodes and the control's own echo - so this step reads the tree
    //    the dump gives (two announcement sites, side by side), then presses each one
    //    where it is and asserts the echo order the two halves have to keep.
    //
    //    The accessibility half is worth naming as a claim in its own right. The
    //    library bundles no string catalogue (D40 item 2), so the trailing half's name
    //    is written in `MenuSplitButton.kt` as "More options"; asserting it here, from
    //    the dump, is what keeps "the second half is reachable and says what it does"
    //    from meaning "the second half exists somewhere".
    const SPLIT_ACTION = 'Real-input split menu';
    const SPLIT_LIST = 'More options';
    await t.requireControlOnScreen(SPLIT_ACTION);
    const halves = t.splitTrigger(SPLIT_ACTION, SPLIT_LIST);
    t.log.checkEquals(
      'the action half is one node, named by the control it belongs to',
      halves.actions.length,
      1
    );
    t.log.checkEquals(
      "the list half is one node in the action half's band, named for the options it opens",
      halves.list.length,
      1
    );
    if (halves.list.length !== 1) {
      t.log.abort(
        `the split trigger gives ${String(halves.list.length)} list halves to the ` +
          'band the action half is in, so a real tap has nothing to aim at - the ' +
          'boxes printed above are the evidence'
      );
    }
    const leading = halves.action;
    const trailing =
      /** @type {import('./uiautomator.mjs').UiautomatorNode} */ (
        halves.list[0]
      );
    t.log.note(
      `split halves: action ${t.boundsText(leading)} list ${t.boundsText(trailing)}`
    );
    // Every later press re-reads the pair rather than reusing these boxes: a dump taken
    // before a scroll or a popup aims a real finger at a box that no longer exists,
    // which is the failure this step had.
    const listHalf = () => {
      const again = t.splitTrigger(SPLIT_ACTION, SPLIT_LIST);
      if (again.list.length !== 1) {
        t.log.abort(
          `a fresh dump gives ${String(again.list.length)} list halves in the ` +
            "action half's band, so the press has nothing to aim at"
        );
      }
      return /** @type {import('./uiautomator.mjs').UiautomatorNode} */ (
        again.list[0]
      );
    };
    // Two targets, not one target with a chevron painted on it: side by side, the same
    // band, and neither one a sliver a finger could miss.
    t.log.checkEquals(
      'the two halves sit side by side without overlapping',
      leading.bounds.x2 <= trailing.bounds.x1 + 1 &&
        trailing.bounds.x1 > leading.bounds.x1,
      true
    );
    t.log.checkEquals(
      'and they are the same height, so they read as one control',
      leading.bounds.height === trailing.bounds.height &&
        leading.bounds.y1 === trailing.bounds.y1,
      true
    );
    t.log.checkEquals(
      'the split trigger has reported nothing before a touch',
      t.requireEcho(ECHO.menuSplitEvents),
      'none'
    );

    // The action half: an echo and no window. Reading the echo costs a dump - about
    // two seconds - which is the wait under "and it opened nothing": a popup that this
    // press had caused would be up and counted by the time the tree came back.
    await t.tapNode(leading);
    t.log.checkEquals(
      'a real tap on the action half runs the primary action',
      t.requireEcho(ECHO.menuSplitEvents),
      'action'
    );
    t.log.checkEquals(
      'and raises no list - no window, and no open in the echo either',
      `${String(t.popupWindowCount())} | ${t.requireEcho(ECHO.menuSplitEvents)}`,
      '0 | action'
    );

    // The list half: a window, and one open that Back answers with one close.
    await t.tapUntilUp(
      listHalf,
      'a real tap on the list half of the split trigger',
      () => t.popupWindowCount(),
      { pollMs: DUMP_POLL_MS }
    );
    await t.pressBack();
    t.log.checkEquals(
      'the list half shuts on Back',
      t.waitForPopupCount(0, 'the split list to come down'),
      0
    );
    t.log.checkEquals(
      'one press of the list half is one open and one close',
      t.requireEcho(ECHO.menuSplitEvents),
      'action > open > close'
    );

    // And a row, pressed for real through the window that half opened - the pick that
    // `nuiTestSelectRow` only imitates, on the trigger whose other half is an action.
    await t.tapUntilUp(
      listHalf,
      'a real tap that reopens the split list',
      () => t.popupWindowCount(),
      { pollMs: DUMP_POLL_MS }
    );
    t.log.checkEquals(
      // The pick and its own close, not the pick alone: this echo carries every event
      // the control reports, so `close` follows `select` within the same frame, and an
      // expectation that stops at the select is a race the reader usually loses. The
      // plain trigger above can ask for the pick alone because its echo only carries
      // picks.
      `a real tap on the row "${PICK}" of the split list reaches JS and closes its own list`,
      await t.tapOptionUntilValue(
        PICK,
        ECHO.menuSplitEvents,
        'action > open > close > open > select bravo > close',
        'a pick from the split list to reach JS'
      ),
      'action > open > close > open > select bravo > close'
    );
    t.log.checkEquals(
      'a pick from the split list closes its own popup',
      t.waitForPopupCount(0, 'the split pick to take its popup down'),
      0
    );
    // The whole history, in the order the fingers did it - which is the shape E3 has to
    // keep: an action that does not open, a list that opens once per press, and the
    // control-wide promise from step 3 that every open has exactly one close.
    t.log.checkEquals(
      'the split trigger pairs every open with a close, action included',
      t.requireEcho(ECHO.menuSplitEvents),
      'action > open > close > open > select bravo > close'
    );
  },

  /**
   * A real tap must open a hosted `DatePicker`'s dialog, and every way out of that
   * dialog has to work there too.
   *
   * Why this case exists (`HostPopups.harness.tsx` cannot cover it): the dialog is a
   * window of its own, and the harness's touch injector reaches the React Native window.
   * So every hosted-dialog gate in the harness opens it with a test seam and closes it by
   * disabling the control — nothing there has ever pressed the field, a day cell, OK,
   * Cancel or Back. `adb shell input` goes through the window manager, which is where
   * those presses can land, and the unhosted `date-picker` case has driven this same
   * Material dialog that way on every gate run. A regression in how the Host's
   * composition routes a press to the hosted field, or the dialog's OK click back to
   * `applyUserSelection`, passes every harness gate and dies here.
   *
   * Four things are read:
   *
   * 1. **The press.** A real tap on the field the Host drew opens a month grid — and the
   *    grid's presence in the accessibility tree *is* the a11y witness: the day cells are
   *    clickable, square and named with their date, which is what TalkBack reads, and the
   *    app's own echoes are absent from the same dump while it is up. The dialog opens on
   *    the day JS gave the field, which is a fact about the Host's drawing rather than a
   *    default.
   * 2. **The dismissals**, which come before the pick because a dialog is another window:
   *    while it is up, the app's own echoes are not in the dump and no echo can be read.
   *    Back closes it and reports nothing; Cancel closes it and reports nothing. That is the
   *    witness and not an inconvenience — `waitForDialogGone` waits for the month grid to
   *    leave the tree and the app's text to come back into it.
   * 3. **The pick.** A day cell plus OK reaches JS as a new day (a pick of the day already
   *    showing is a correct no-op, so the day is aimed at by offset and retried — exactly the
   *    unhosted case's reasoning), and OK is what makes the pick checkable at all: "the app
   *    text came back" and "OK closed the dialog" are the same event from out here.
   * 4. **The teardown.** Removing *only* that child from the Host while the dialog is up
   *    leaves no window behind, with the app unmounting it on a timer because a second
   *    real tap would only have dismissed the dialog (`PickerScreen`'s drop picker uses
   *    the same shape for a menu).
   *
   * What closes a dialog is witnessed by the month grid leaving the accessibility tree
   * plus the app's own text becoming readable again, not by `popupWindowCount()`: that
   * counts `Pop-Up Window`s, which is what a `Picker` menu is and what a `Dialog` is not.
   *
   * iOS has no counterpart because there is nothing hosted to drive — `<Host>` is the
   * passthrough there (D23), so the case for this control is `date-picker`.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'hosted-date-picker': async (t) => {
    // `HostScreen` seeds the popup Host's DatePicker at 2026-05-17 and echoes what JS
    // holds. Written by hand rather than formatted, so no locale moves the assertion.
    const SEEDED = '2026-05-17';
    await t.requireControlOnScreen('Hosted date picker');
    t.log.checkEquals(
      'the hosted DatePicker shows the day JS gave it',
      t.requireEcho(ECHO.hostDateValue),
      SEEDED
    );

    // 1. A real press on the field the Host drew. The month grid is both the witness
    //    that the press arrived and the accessibility tree this case has to cover: 14+
    //    clickable, square, date-named cells is a calendar a screen reader can use.
    await t.tapUntilUp(
      () => t.requireControlOnScreen('Hosted date picker'),
      'a real tap on the hosted DatePicker field to open its dialog',
      () => t.dump().filter(isDayCell).length,
      { pollMs: DUMP_POLL_MS }
    );
    const cells = dayGrid(t, 'the hosted DatePicker');
    t.log.check(
      `the hosted dialog's day cells are in the accessibility tree (${String(
        cells.length
      )} of them, clickable and named with a year)`,
      cells.length >= 14
    );
    t.log.check(
      'the dialog opens on the month the Host is drawing, not on a default',
      t
        .dump()
        .some((node) => /May 2026/.test(`${node.text} ${node.contentDesc}`))
    );
    t.log.check(
      "while the hosted dialog is up it is a window of its own - the app's own echo is " +
        'not in the same dump',
      t.nodeByTestId(ECHO.hostDateValue) == null
    );

    // 3a. Back, first, because it is the dismissal that has to happen before anything can
    // be read again: while the dialog is up its window owns the screen, so the app's own
    // text is not in the dump - which the check just above asserted. A case that asks for
    // an echo here fails on the app doing its job, and the first version of this case did
    // exactly that. Back is also the dismissal the harness cannot reach: it comes from the
    // window manager, not from the React Native window.
    await t.pressBack();
    await waitForDialogGone(
      t,
      'the back gesture to take the hosted dialog down'
    );
    t.log.checkEquals(
      'Back closes the hosted dialog and reports no day',
      t.requireEcho(ECHO.hostDateValue),
      SEEDED
    );
    t.log.check(
      'and the app text is readable again once the dialog is gone',
      t.nodeByTestId(ECHO.hostDateValue) != null
    );

    // 3b. Cancel: closes it and reports nothing. The witness is the grid leaving.
    await t.tapUntilUp(
      () => t.requireControlOnScreen('Hosted date picker'),
      'a real tap on the hosted DatePicker field to open its dialog again',
      () => t.dump().filter(isDayCell).length,
      { pollMs: DUMP_POLL_MS }
    );
    dayGrid(t, 'the hosted DatePicker');
    await t.pressUntil({
      what: "the dialog's Cancel button",
      waitingFor: 'a real tap on Cancel to take the hosted dialog down',
      press: async () => {
        await t.tapNode(
          t.waitForNodes(isCancelLabel, "the dialog's Cancel button", 1)[0]
        );
      },
      reading: () => String(t.dump().filter(isDayCell).length),
      raised: (current) => current === '0',
      pollMs: DUMP_POLL_MS,
    });
    await waitForDialogGone(t, 'Cancel to take the hosted dialog down');
    t.log.checkEquals(
      'Cancel closes the hosted dialog and reports no day',
      t.requireEcho(ECHO.hostDateValue),
      SEEDED
    );

    // 2. A day, then OK - last, because OK is what makes a pick readable at all: the new
    // day is app text, and app text is another window's business while the dialog is up.
    // The day is aimed at by offset because a pick of the day the field already shows is a
    // correct no-op, indistinguishable from a broken touch path from out here.
    let reported = SEEDED;
    let picked = null;
    for (const offset of [0, 7, -7]) {
      const day = await openAndPick(t, 'Hosted date picker', offset);
      const now = t.requireEcho(ECHO.hostDateValue);
      if (now !== reported) {
        picked = day;
        reported = now;
        break;
      }
    }
    t.log.check(
      `a real tap on a dialog day ("${picked ?? 'no pick reported'}") reaches JS through ` +
        'the Host as a new day',
      /^\d{4}-\d{2}-\d{2}$/.test(reported) && reported !== SEEDED
    );
    t.log.check(
      'and OK closed it: the app text is readable again',
      t.nodeByTestId(ECHO.hostDateValue) != null
    );
    t.log.checkEquals(
      'and no popup window of any kind is left owned by the app',
      t.popupWindowCount(),
      0
    );

    // 4. Remove only this child, while its dialog is up. The unmount is armed by a real
    // tap and lands on a timer inside the app for the reason `PickerScreen` states: a
    // second tap while a dialog is open is an outside tap, which dismisses the dialog
    // instead of pressing anything.
    // The arm's own echo is the witness, for the same reason `PickerScreen` gives for
    // its own: a press that never landed leaves nothing scheduled, and the field's
    // survival afterwards would read as the library leaking a dialog.
    await t.pressUntil({
      what: 'the unmount-the-field button',
      waitingFor: 'a real tap to arm the unmount',
      press: async () => {
        await t.tapNode(
          t.waitForNode(ECHO.hostDateDropButton, 'the unmount-the-field button')
        );
      },
      reading: () =>
        t.nodeByTestId(ECHO.hostDateDropArmed) == null ? '0' : '1',
      raised: (current) => current === '1',
      pollMs: DUMP_POLL_MS,
    });
    t.waitForNode(ECHO.hostDateDropArmed, 'the unmount to be armed');
    await t.tapUntilUp(
      () => t.requireControlOnScreen('Hosted date picker'),
      'a real tap on the hosted field to open its dialog before the unmount',
      () => t.dump().filter(isDayCell).length,
      { pollMs: DUMP_POLL_MS }
    );
    dayGrid(t, 'the hosted DatePicker');
    // The app's own echo is the witness that the unmount happened, so wait for it rather
    // than for a guessed delay: the timer is the app's, not this loop's, and a settle that
    // comes up short reads a dialog that was still open as one that outlived its child.
    // Only then is it meaningful to ask whether the window came down with it.
    t.waitForNode(ECHO.hostDateGone, 'the field to be unmounted');
    await waitForDialogGone(
      t,
      'the removed child to take its open dialog down with it'
    );
    t.log.check(
      'removing only the hosted DatePicker child leaves no dialog window behind',
      t.dump().filter(isDayCell).length === 0
    );
    t.log.checkEquals(
      'a teardown is not a choice - the day JS holds is the one it was given',
      t.requireEcho(ECHO.hostDateValue),
      reported
    );

    // Leave the screen as this check found it: the next control reads the same Host.
    // The witness is the label, not the testID. A hosted control's React Native view is
    // the `0 x 0` decorative one (D24) and uiautomator drops a node with no box, so the
    // only thing this screen offers of a hosted field is the box the Host drew and named.
    // Every other press in this case is aimed the same way.
    await t.pressUntil({
      what: 'the remount-the-field button',
      waitingFor: 'a real tap to mount the hosted field again',
      press: async () => {
        await t.tapNode(
          t.waitForNode(ECHO.hostDateRemount, 'the remount-the-field button')
        );
      },
      reading: () =>
        t.dump().some((node) => node.contentDesc === 'Hosted date picker')
          ? '1'
          : '0',
      raised: (current) => current === '1',
      pollMs: DUMP_POLL_MS,
    });
    await t.requireControlOnScreen('Hosted date picker');
  },

  /**
   * A real tap toggles a Material 3 FilterChip, a toggle the parent refuses snaps back,
   * an AssistChip presses, and a disabled chip of either kind takes nothing (G12).
   * `RealInputTests.testRealInputChip` on the other platform, assertion for assertion.
   *
   * The chip's own state is read from the tree as well as from the echo: Compose
   * publishes a FilterChip's `selected` as `checkable`/`checked` (the same mapping the
   * Picker's rows reach the dump through), so `nativeChecked` is both the a11y read of
   * "selected" and the witness that tells a dropped tap from a lost event.
   *
   * The refusing chip's oracle is SegmentedControl's: the parent keeps `selected={false}`,
   * so every tap asks for `true`. A chip that kept the refused selection would ask for
   * `false` on the second tap.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'chip': async (t) => {
    const named = (label) => t.requireControl(label);
    t.log.checkEquals(
      'the filter chip starts unselected',
      t.requireEcho(ECHO.chipValue),
      'off'
    );
    t.log.checkEquals(
      "the filter chip's own node starts not checked",
      t.nativeChecked('Real-input chip'),
      'off'
    );

    // 1. On, then off.
    t.log.checkEquals(
      'one real tap selects the filter chip (React renders "on")',
      await t.tapUntilValue(
        () => named('Real-input chip'),
        ECHO.chipValue,
        'on',
        'the real tap that selects the chip',
        { nativeLabel: 'Real-input chip' }
      ),
      'on'
    );
    t.log.checkEquals(
      "the selected chip's node says it is checked",
      t.nativeChecked('Real-input chip'),
      'on'
    );
    t.log.checkEquals(
      'a second real tap deselects it (React renders "off")',
      await t.tapUntilValue(
        () => named('Real-input chip'),
        ECHO.chipValue,
        'off',
        'the real tap that deselects the chip',
        { nativeLabel: 'Real-input chip' }
      ),
      'off'
    );
    t.log.checkEquals(
      'two taps report two changes',
      t.requireEcho(ECHO.chipEvents),
      '2'
    );
    t.log.checkEquals(
      "the deselected chip's node stops saying it is checked",
      t.nativeChecked('Real-input chip'),
      'off'
    );

    // 2. The refusing parent: two requests, both for `true`, and the chip's node still
    //    unchecked after each.
    for (const request of ['1', '2']) {
      t.log.checkEquals(
        `refused request ${request} reaches onSelectedChange`,
        await t.tapUntilValue(
          () => named('Real-input refusing chip'),
          ECHO.chipRefusedEvents,
          request,
          `refused request ${request}`
        ),
        request
      );
      t.log.checkEquals(
        `refused request ${request} asks for true (a chip that kept the refused ` +
          'selection would ask for false on the second tap)',
        t.requireEcho(ECHO.chipRefusedLast),
        'true'
      );
      await t.settle(500);
      t.log.checkEquals(
        `the refused chip snaps back to unchecked after request ${request}`,
        t.nativeChecked('Real-input refusing chip'),
        'off'
      );
    }

    // 3. The assist chip presses once per tap.
    t.log.checkEquals(
      'one real tap on the assist chip reaches onPress once',
      await t.tapUntilValue(
        () => named('Real-input assist chip'),
        ECHO.chipPresses,
        '1',
        'the real tap on the assist chip'
      ),
      '1'
    );

    // 4. Neither disabled chip takes a tap. Each is wired to its enabled twin's
    //    counter, so a stray delivery is a number that moved. Not retried: the claim
    //    is about a period in which nothing may move.
    const disabledFilter = named('Real-input disabled chip');
    const disabledAssist = named('Real-input disabled assist chip');
    // Read off the clickable touch target around the label, not the labelled node:
    // `nativeEnabled` says why (the labelled node reports enabled either way).
    t.log.checkEquals(
      'the disabled filter chip announces itself not enabled',
      t.nativeEnabled('Real-input disabled chip'),
      'false'
    );
    t.log.checkEquals(
      'the disabled assist chip announces itself not enabled',
      t.nativeEnabled('Real-input disabled assist chip'),
      'false'
    );
    t.log.checkEquals(
      'its enabled twin announces itself enabled (so the reads above can say true)',
      t.nativeEnabled('Real-input assist chip'),
      'true'
    );
    await t.tapNode(disabledFilter);
    t.log.checkEquals(
      'a real tap on the disabled filter chip is refused',
      t.requireEchoToStay(
        ECHO.chipEvents,
        '2',
        'a tap on the disabled filter chip to be refused'
      ),
      '2'
    );
    await t.tapNode(disabledAssist);
    t.log.checkEquals(
      'a real tap on the disabled assist chip is refused',
      t.requireEchoToStay(
        ECHO.chipPresses,
        '1',
        'a tap on the disabled assist chip to be refused'
      ),
      '1'
    );

    // 5. The barrier: the enabled twin, tapped the same way, still presses. At
    //    least once more, not exactly once: a tap that stalls past the window lands
    //    with its retry (G12: 1 -> 3), and "presses once per tap" is item 3's claim.
    const barrier = await t.tapUntilValue(
      () => named('Real-input assist chip'),
      ECHO.chipPresses,
      '2',
      'the barrier tap on the assist chip',
      { atLeast: true }
    );
    t.log.check(
      'the enabled assist chip still presses after the refused taps — expected ' +
        `at least 2, saw ${barrier}`,
      Number(barrier) >= 2
    );
  },

  /**
   * A real tap checks a Material 3 Checkbox and the new value comes back to React, a
   * change the parent refuses snaps back, and a disabled box takes nothing (G15).
   * `RealInputTests.testRealInputCheckbox` on the other platform, assertion for
   * assertion.
   *
   * The box's own state is read from the tree as well as from the echo, and for a
   * Checkbox that read is its role: the library gives the box `Role.Checkbox` so
   * TalkBack is offered a toggleable node, and `nativeChecked` answers only for a node
   * with `checkable="true"` that carries the labelled control (`android-tree.mjs`). An
   * `'off'` below is therefore both "the box says unchecked" and "the box publishes a
   * toggle at all" — a control that published a name and no state reads null, goes red
   * here, and then aborts inside `tapUntilValue`'s native-state guard rather than being
   * tapped until some reading looks green (F1 M3).
   *
   * The refusing parent's oracle is the Chip's and SegmentedControl's: `checked` stays
   * `false`, so every tap asks for `true` again, and a box that had kept a refused
   * change would ask for `false` on the second tap.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'checkbox': async (t) => {
    const named = (label) => t.requireControl(label);
    const BOX = 'Real-input checkbox';
    const REFUSING = 'Real-input refusing checkbox';
    const DISABLED = 'Real-input disabled checkbox';

    // 1. Before any touch: the three echoes at rest, and the box's own state. The
    //    native read is the one a stale render cannot fake.
    t.log.checkEquals(
      'the checkbox starts unchecked (React renders "off")',
      t.requireEcho(ECHO.checkboxValue),
      'off'
    );
    t.log.checkEquals(
      'the checkbox has reported no change before a touch',
      t.requireEcho(ECHO.checkboxEvents),
      '0'
    );
    t.log.checkEquals(
      'the counter the disabled checkbox reports into starts at zero, so a stray ' +
        'delivery is a number that moved rather than a callback nobody saw',
      t.requireEcho(ECHO.checkboxDisabledEvents),
      '0'
    );
    t.log.checkEquals(
      'the box publishes a toggleable state, and it says unchecked',
      t.nativeChecked(BOX),
      'off'
    );
    // The raw flags of the node that carries the name, as evidence: the `class=`
    // Compose writes for `Role.Checkbox` has not been measured on a device the way the
    // Spinner class the Picker and Menu checks assert has, so it is recorded rather than
    // guessed at, the way the Menu's popup rows are. The toggle itself is asserted
    // above, where the reading is the library's own.
    for (const node of t.nodesNamed(BOX)) {
      t.log.note(
        `name node "${node.contentDesc}": checkable=${node.checkable} ` +
          `checked=${node.checked} enabled=${node.enabled} ` +
          `clickable=${node.clickable} class=${node.className}`
      );
    }

    // 2. Checked: one tap, one change, and the box agrees. Each tap is confirmed by the
    //    value it should produce before the next one is made (as in `switch`), and
    //    carries the box's own state as the witness that tells a dropped delivery from a
    //    lost change event.
    t.log.checkEquals(
      'one real tap checks the checkbox (React renders "on")',
      await t.tapUntilValue(
        () => named(BOX),
        ECHO.checkboxValue,
        'on',
        'the real tap that checks the box',
        { nativeLabel: BOX }
      ),
      'on'
    );
    t.log.checkEquals(
      "the checked box's node says it is checked",
      t.nativeChecked(BOX),
      'on'
    );
    t.log.checkEquals(
      'one real tap reports one change',
      t.requireEcho(ECHO.checkboxEvents),
      '1'
    );

    // 3. Unchecked again. This is the assertion that catches a native box which only
    //    ever asks for `true`: the tap above would have lit the "on" echo all the same,
    //    so the echo back at "off", the node back at unchecked and the counter at
    //    exactly 2 are what say a second tap asked for `false`.
    t.log.checkEquals(
      'a second real tap unchecks it (React renders "off")',
      await t.tapUntilValue(
        () => named(BOX),
        ECHO.checkboxValue,
        'off',
        'the real tap that unchecks the box',
        { nativeLabel: BOX }
      ),
      'off'
    );
    t.log.checkEquals(
      'the unchecked box reports it back',
      t.nativeChecked(BOX),
      'off'
    );
    t.log.checkEquals(
      'two taps report two changes, one per tap',
      t.requireEcho(ECHO.checkboxEvents),
      '2'
    );

    // 4. The refusing parent: two requests, both for `true`, and its node still
    //    unchecked after either. No `nativeLabel` on these taps, unlike the pair above:
    //    that guard reads a box whose state moves while the echo sits still, and a
    //    refused box is meant to be pushed back — asserting its node below is what says
    //    it went back, and the guard would only call a dropped press a lost event.
    for (const request of ['1', '2']) {
      t.log.checkEquals(
        `refused request ${request} reaches onCheckedChange`,
        await t.tapUntilValue(
          () => named(REFUSING),
          ECHO.checkboxRefusedEvents,
          request,
          `refused request ${request}`
        ),
        request
      );
      t.log.checkEquals(
        `refused request ${request} asks for true — a checkbox that kept the refused ` +
          'change would ask for false on the second tap',
        t.requireEcho(ECHO.checkboxRefusedLast),
        'true'
      );
      // The wait is the Chip's: Compose paints a tapped toggle before React has pushed
      // the refused value back down, so reading the node the instant the echo moves can
      // catch the flip the app is about to undo and report a snap-back that stuck.
      await t.settle(500);
      t.log.checkEquals(
        `the refused checkbox snaps back to unchecked after request ${request}`,
        t.nativeChecked(REFUSING),
        'off'
      );
    }

    // 5. The disabled box takes nothing. It is drawn from the enabled one's value and
    //    reports into a counter of its own, so a delivery that should not have happened
    //    is a number or a word that moved — and the enabled one's counter staying put is
    //    also what says the press was refused where it landed rather than aimed one row
    //    too high.
    const disabledBox = named(DISABLED);
    t.log.note(
      `disabled box node: enabled=${disabledBox.enabled} ` +
        `checkable=${disabledBox.checkable} class=${disabledBox.className} — kept as ` +
        'evidence, not asserted, for the reason given above'
    );
    await t.tapNode(disabledBox);
    t.log.checkEquals(
      'a real tap on the disabled checkbox reports no change',
      t.requireEchoToStay(
        ECHO.checkboxDisabledEvents,
        '0',
        'a tap on the disabled checkbox to be refused'
      ),
      '0'
    );
    t.log.checkEquals(
      'and nothing reached the enabled checkbox either',
      t.requireEchoToStay(
        ECHO.checkboxEvents,
        '2',
        'the enabled checkbox to be left alone by a tap on the disabled one'
      ),
      '2'
    );
    t.log.checkEquals(
      'the refused tap leaves the value echo where it was',
      t.requireEcho(ECHO.checkboxValue),
      'off'
    );

    // 6. The barrier: the same press on the enabled box still lands, so the silence
    //    above was a refusal and not a screen that had stopped answering.
    t.log.checkEquals(
      'the enabled checkbox, tapped the same way, still answers',
      await t.tapUntilValue(
        () => named(BOX),
        ECHO.checkboxValue,
        'on',
        'the barrier tap on the enabled checkbox',
        { nativeLabel: BOX }
      ),
      'on'
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
      )} ${t.requireEcho(ECHO.sliderComplete)} ${t.requireEcho(
        ECHO.sliderPhaseOrder
      )}`,
      'start=0 change=0 complete=0 order=none'
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
    // The three counters say how many; only the order can say `start` came before
    // the values and `complete` after them. A `V` stands for a run of value changes
    // rather than for one of them, because a gesture's samples are coalesced to one
    // per frame and the string has to stay readable.
    t.log.checkEquals(
      'one drag reports start, then the value changes, then complete',
      t.requireEcho(ECHO.sliderPhaseOrder),
      'order=SVC'
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
    t.log.checkEquals(
      'the two drags report two gestures in the same order',
      t.requireEcho(ECHO.sliderPhaseOrder),
      'order=SVCSVC'
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

    // A real touch that never moves the thumb is a gesture, too.
    //
    // This is the case Material 3 reports nothing for: its tap path calls
    // `onValueChange` only when the value it computed differs from the one the
    // control already had, and `onSlidingStart` used to be inferred from that call,
    // while `onSlidingComplete` was guarded on a drag having started. A finger going
    // down on the thumb and lifting again - the most obvious thing a person can do to
    // a Slider - was therefore silent on Android.
    //
    // The same point is pressed twice, and that is what makes it provable without
    // knowing where the thumb is: the first press is allowed to move the value to
    // wherever the finger landed, so the second press computes the value the control
    // already holds, and nothing changes. Deriving the point from the value instead
    // would put the check at the mercy of thumb padding it does not own.
    const pressX = phases.bounds.x1 + phases.bounds.width * 0.42;
    const pressY = phases.bounds.cy;
    const countOf = (testID, prefix) =>
      Number(t.requireEcho(testID).replace(prefix, ''));
    const startsBefore = countOf(ECHO.sliderStart, 'start=');
    const completesBefore = countOf(ECHO.sliderComplete, 'complete=');

    await t.holdAt(pressX, pressY, 700);
    // Both echoes below are React's render of the first press, and the second press
    // is only "the one that changed nothing" once that render has happened: the
    // control's own value moved the instant the finger lifted, but the text a check
    // compares against is one React frame behind it. Awaiting the hold and settling
    // before reading is what says the number below is the first press's answer rather
    // than a snapshot taken while it was still on its way.
    await t.settle(600);
    const changesMid = countOf(ECHO.sliderChange, 'change=');
    const valueMid = t.requireEcho(ECHO.sliderValue);
    await t.holdAt(pressX, pressY, 700);
    await t.settle(600);

    t.log.check(
      `two still presses each report a gesture (start ${String(
        startsBefore
      )} -> ${String(countOf(ECHO.sliderStart, 'start='))}, complete ${String(
        completesBefore
      )} -> ${String(countOf(ECHO.sliderComplete, 'complete='))})`,
      countOf(ECHO.sliderStart, 'start=') === startsBefore + 2 &&
        countOf(ECHO.sliderComplete, 'complete=') === completesBefore + 2
    );
    // The value half of the claim, and deliberately separate from the gesture half
    // below: this line says the second press selected the value the control already
    // had, which is what makes it the "changed nothing" press the other two are
    // about. Reverted on its own it stays green - which is exactly why the two lines
    // beside it count phases rather than trust this one.
    t.log.check(
      `the second press selected the value the control already had (${
        ECHO.sliderChange
      } stayed ${String(changesMid)}, ${valueMid})`,
      countOf(ECHO.sliderChange, 'change=') === changesMid &&
        t.requireEcho(ECHO.sliderValue) === valueMid
    );
    // `S` then `C`, with no `V` between them: the shape of the answer, not just that
    // two more numbers moved.
    t.log.check(
      `a touch with no value change in it reads as "SC" (${t.requireEcho(
        ECHO.sliderPhaseOrder
      )})`,
      t.requireEcho(ECHO.sliderPhaseOrder).endsWith('SC')
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
    await t.requireControl('Real-input button');
    const disabled = await t.requireControl('Real-input disabled button');
    t.log.checkEquals(
      'the Button starts with no presses recorded',
      t.requireEcho(ECHO.buttonCount),
      '0'
    );

    t.log.checkEquals(
      'one real tap on the enabled Button reaches onPress',
      await t.tapUntilValue(
        () => t.requireControl('Real-input button'),
        ECHO.buttonCount,
        '1',
        'a real tap to reach onPress'
      ),
      '1'
    );

    // The disabled one gets the same tap. Nothing should happen, and the way to
    // say that is to keep watching the same number the enabled Button moves.
    // Deliberately not retried: the assertion is about a period in which the count
    // must not move, and pressing again is the one thing that would move it.
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
    t.log.checkEquals(
      'a second real tap presses the enabled Button again',
      await t.tapUntilValue(
        () => t.requireControl('Real-input button'),
        ECHO.buttonCount,
        '2',
        'a second real tap to reach onPress'
      ),
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

    t.log.checkEquals(
      'a real tap on the second segment reaches JS as index 1',
      await t.tapUntilValue(
        () => t.requireControlAt('Real-input segmented control', control),
        ECHO.segmentedIndex,
        '1',
        'a real tap to register',
        { aim: (node) => t.tapControlAt(node, 0.5) }
      ),
      '1'
    );
    t.log.checkEquals(
      'one tap reports one change',
      t.requireEcho(ECHO.segmentedEvents),
      '1'
    );

    // E1: the Expressive redraw kept the two things the API promises.
    //
    // **The semantics.** The row is now a connected button group, and Material's
    // `ToggleButton` publishes `Role.Checkbox` from its own semantics lambda, which
    // an outer modifier cannot outvote - so the item is a node this file draws, with
    // `selectable(role = Role.RadioButton)` on it (`HybridNitroUiSegmentedControl.kt`
    // explains the trade). What a screen reader is offered is still
    // `docs/components/segmented-control.md`'s sentence: one radio-class node per
    // option, inside one group, each with its own label and the selection.
    //
    // Each of those three lives on a different entry, and that is Compose's doing,
    // not this control's: a selectable item is published to `uiautomator` as the
    // item itself - a node at the segment's box carrying `checkable`/`checked`, which
    // is Compose's mapping of the toggleable state and what TalkBack reads as
    // "selected" - with the `Role` on its own `RadioButton` node at that same box and
    // the label as a child `TextView`. So an assertion that one node carries all
    // three ("the node whose text is the label is the radio button") describes a tree
    // this row does not have; each claim is read where it actually is, and the note
    // below prints all three boxes so a red line can be read without re-running.
    //
    // **The geometry.** A connected group is one row whose items sit
    // `ButtonGroupDefaults.ConnectedSpaceBetween` (2 dp) apart. The library cannot see
    // Compose's item bounds from JS - the control is one Fabric node - so the bounds
    // in the accessibility tree are the only place a run can measure the gap, and a
    // group that had silently turned into three separate buttons (or a stretch row
    // with a hole in it) shows up here and nowhere else. The item nodes are the
    // segment boxes, which is what that measurement wants.
    const box = await t.requireControl('Real-input segmented control');
    const tree = t.dump();
    const insideBox = (node) =>
      node.bounds.x1 >= box.bounds.x1 - 1 &&
      node.bounds.x2 <= box.bounds.x2 + 1 &&
      node.bounds.y1 >= box.bounds.y1 - 1 &&
      node.bounds.y2 <= box.bounds.y2 + 1;
    const centreInside = (node, box2) =>
      (node.bounds.x1 + node.bounds.x2) / 2 >= box2.bounds.x1 - 1 &&
      (node.bounds.x1 + node.bounds.x2) / 2 <= box2.bounds.x2 + 1 &&
      (node.bounds.y1 + node.bounds.y2) / 2 >= box2.bounds.y1 - 1 &&
      (node.bounds.y1 + node.bounds.y2) / 2 <= box2.bounds.y2 + 1;
    const boundsText = (node) =>
      `${String(node.bounds.x1)},${String(node.bounds.y1)} \u2192 ` +
      `${String(node.bounds.x2)},${String(node.bounds.y2)}`;
    // The item node is the one that answers for the selection.
    const items = tree
      .filter((node) => node.checkable === 'true' && insideBox(node))
      .sort((a, b) => a.bounds.x1 - b.bounds.x1);
    const radios = tree
      .filter(
        (node) =>
          node.className === 'android.widget.RadioButton' && insideBox(node)
      )
      .sort((a, b) => a.bounds.x1 - b.bounds.x1);
    // Where the tree actually put each of the three parts of a segment, so a red
    // line below can be read without re-running the run.
    items.forEach((node, index) => {
      const radio = radios.find((candidate) => centreInside(candidate, node));
      const label = tree.find(
        (candidate) =>
          candidate.text === String(index + 1) && insideBox(candidate)
      );
      t.log.note(
        `segment ${String(index + 1)}: item ${node.className.split('.').pop()} ` +
          `[${boundsText(node)}] checked=${node.checked}; role ` +
          `${radio == null ? 'MISSING' : `[${boundsText(radio)}]`}; label ` +
          `${label == null ? 'MISSING' : `[${boundsText(label)}]`}`
      );
    });
    t.log.checkEquals(
      'the group still has one node per option',
      items.length,
      3
    );
    t.log.checkEquals(
      'the group publishes one radio node per option',
      radios.length,
      3
    );
    items.forEach((node, index) => {
      t.log.checkEquals(
        `segment ${String(index + 1)} of ${String(items.length)} is still a radio button`,
        radios.some((candidate) => centreInside(candidate, node)),
        true
      );
      t.log.checkEquals(
        `segment ${String(index + 1)} is announced with its own label`,
        tree.some(
          (candidate) =>
            candidate.text === String(index + 1) &&
            centreInside(candidate, node)
        ),
        true
      );
      t.log.checkEquals(
        `segment ${String(index + 1)} reports the selection the control has (index 1)`,
        node.checked,
        index === 1 ? 'true' : 'false'
      );
    });
    t.log.checkEquals(
      'the three items are one row, not a stack',
      new Set(
        items.map(
          (node) => `${String(node.bounds.y1)}-${String(node.bounds.y2)}`
        )
      ).size,
      1
    );
    const connectedGapPx = Math.round(2 * t.density()) + 1;
    for (let index = 1; index < items.length; index += 1) {
      const gap = items[index].bounds.x1 - items[index - 1].bounds.x2;
      t.log.check(
        `segment ${String(index + 1)} is within the connected gap of its neighbour ` +
          `(=${String(gap)}px, at most ${String(connectedGapPx)}px = 2dp)`,
        gap >= 0 && gap <= connectedGapPx
      );
    }

    // **The corner.** A row of pills has the same box, the same 2 dp gap and the
    // same tree as a connected group, so every line above passes for both - and the
    // line that would tell them apart cannot come from the tree, because the tree
    // says where a box is and never how its corners were clipped. Material's own
    // answer rests each item on `RoundedCornerShape(cornerFull, cornerValueSmall,
    // cornerValueSmall, cornerFull)`: round at the end that faces the window edge,
    // cut to 8 dp at the end that faces a neighbour. Handing
    // `connectedLeadingButtonShapes` the control's own stadium instead - the shape
    // `ButtonDefaults.shapesFor` answers with for the height - keeps everything else
    // and rests the item on a full pill, which is what this probe is for.
    //
    // It reads the segment's own 1 dp border (`SegmentedButtonDefaults.BorderWidth`),
    // because that is the only ink an unselected segment has: `SegmentedButtonDefaults
    // .colors()` gives it a *transparent* container, so its interior is the page
    // whatever the corner is. Along the top edge, at 10 dp in from the segment's
    // right:
    //
    //   - connected: the inner corner's arc is over 2 dp earlier, so the border runs
    //     straight here and is flush with the box - pixels (x2 - 10dp, y1) and
    //     (y1 + 1px) are on the stroke;
    //   - pill: a percentage corner is 50 % of the *shorter* side, and a segment is
    //     38 x 48 dp, so its radius is 19 dp and the arc never reaches a straight top
    //     edge at all. At 10 dp in it is 19 - sqrt(19^2 - 9^2) = 2.3 dp down, past a
    //     1 dp stroke, so those two pixels are page. (Read from the height the radius
    //     would be 24 dp and the drop 4.5 dp; the arithmetic is written out so a red
    //     line can be checked against the geometry rather than against a guess.)
    //
    // The two drawings therefore disagree at every inset between the inner corner's
    // 8 dp and half the box's width. 10 dp leaves the connected border 2 dp of
    // straight run and puts the pill's arc 2.3 dp out of reach of the pixels.
    //
    // Both are read against a third pixel that is page by definition: inside segment 1
    // itself, 6 dp from its left edge and mid-height, past any corner and clear of the
    // label. The 2 dp gap is not a place a run can sample - it is Compose's own
    // padding, and the measured gap between two item nodes is 0 px, because the item
    // node is the box inside that padding. So the assertion compares two pixels of one
    // screenshot instead of trusting a colour this file does not own: a theme change
    // moves both halves together, and a decoder that misread the file could not make
    // the stroke and the page agree.
    const screen = t.screencap();
    const density = t.density();
    const segmentOne = items[0];
    if (segmentOne == null) {
      t.log.abort(
        'the corner probe has no first segment to probe (the tree line above is the reason)'
      );
    }
    // Refuse to read a selected segment, rather than read it wrongly.
    //
    // The whole probe rests on the reference pixel being the page: an *unselected*
    // segment's container is transparent, so a pixel inside it is the page whatever
    // the corner is. A selected segment paints Material's filled container there, so
    // the reference would be ink, the two probe pixels would be ink too, and a row of
    // pills would pass - the exact thing this line exists to catch. The tree line
    // above does assert segment 1 is unselected, but `t.log.checkEquals` records a
    // failure and carries on, and a probe that reads a wrong reference reports a pass.
    // So the precondition is checked, not assumed - and it is "says unchecked", not
    // "does not say checked", because a node that publishes no checkable state at all
    // tells the probe nothing about what is painted under its own corners.
    //
    // It goes through `t.log.abort`, not a bare `throw new AbortedCheck`: the runner
    // used to swallow that error to move on to the next control, so a bare throw
    // silenced the line and still reported the run green. `runCheck` now fails an
    // abort the log never recorded (X20 item 1), but only `abort` says *why* on the
    // control's own line, where the reader of a red run looks. A probe that stopped reading
    // has to be as loud as a probe that read wrong, or the day the fixture starts on
    // segment 1 nobody notices the guard swallowed the only corner check there is.
    if (segmentOne.checked !== 'false') {
      t.log.abort(
        `the corner probe will not read segment 1 while it is not plainly unselected ` +
          `(checked=${segmentOne.checked}) - a selected segment's interior is the fill, ` +
          `not the page, so the reference pixel would be ink and the two probe pixels ` +
          `would read as stroke against it: this line passes for a pill. The segment ` +
          `lines above name the selection.`
      );
    }
    const probeX = segmentOne.bounds.x2 - Math.round(10 * density);
    const probeTop = segmentOne.bounds.y1;
    const probeInk = [probeTop, probeTop + 1].map((y) =>
      screen.pixel(probeX, y)
    );
    const pagePixel = screen.pixel(
      segmentOne.bounds.x1 + Math.round(6 * density),
      segmentOne.bounds.y1 + Math.round(24 * density)
    );
    const rgb = (pixel) => pixel.slice(0, 3).join(',');
    const inkDistance = (pixel) =>
      Math.max(
        ...pixel
          .slice(0, 3)
          .map((channel, at) => Math.abs(channel - (pagePixel[at] ?? 0)))
      );
    // The map the next person reads from a red line: the box the probe sits in, the
    // two pixels themselves, and the page it compares them with.
    t.log.note(
      `corner probe: segment 1 [${boundsText(segmentOne)}], pixels ` +
        `(${String(probeX)}, ${String(probeTop)}) = rgb(${rgb(probeInk[0] ?? [0, 0, 0])}) and ` +
        `(${String(probeX)}, ${String(probeTop + 1)}) = rgb(${rgb(probeInk[1] ?? [0, 0, 0])}) ` +
        `against segment 1's own interior at rgb(${rgb(pagePixel)})`
    );
    const onStroke = probeInk.some(
      (pixel) => inkDistance(pixel) >= MIN_STROKE_INK_DISTANCE
    );
    t.log.check(
      `segment 1 is drawn with its connected corner: the border is still on the top edge ` +
        `10dp inside the corner (a pill's arc is 2.3dp below the edge there) - ` +
        `rgb(${rgb(probeInk[0] ?? [0, 0, 0])}) / rgb(${rgb(probeInk[1] ?? [0, 0, 0])}) ` +
        `vs page rgb(${rgb(pagePixel)})`,
      onStroke
    );

    const moved = await t.requireControl('Real-input segmented control');
    t.log.checkEquals(
      'the control did not move out from under the finger',
      t.boundsText(moved),
      startedAt
    );

    // A different segment, so a second change is owed: a control that reported the
    // same index twice would also satisfy the line above by echoing once.
    t.log.checkEquals(
      'a real tap on the first segment reaches JS as index 0',
      await t.tapUntilValue(
        () => t.requireControlAt('Real-input segmented control', control),
        ECHO.segmentedIndex,
        '0',
        'a second real tap to register',
        { aim: (node) => t.tapControlAt(node, 0.12) }
      ),
      '0'
    );
    t.log.checkEquals(
      'two taps report two changes',
      t.requireEcho(ECHO.segmentedEvents),
      '2'
    );

    // The refusing parent.
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

    t.log.checkEquals(
      'a real tap on the controlled control still reaches JS - native paints optimistically (core.md section 4)',
      await t.tapUntilValue(
        () => t.requireControl('Real-input rejecting segmented control'),
        ECHO.rejectEvents,
        '1',
        'the controlled tap to register',
        { aim: (node) => t.tapControlAt(node, 0.5) }
      ),
      '1'
    );
    t.log.checkEquals(
      'the parent never accepted the change, so the index it sends is still 0',
      t.requireEcho(ECHO.rejectValue),
      '0'
    );

    // The snap-back oracle, explained above: this tap can only be reported if the
    // selection went back to the first segment.
    t.log.checkEquals(
      'a second tap on segment 2 is a fresh selection, which is only true if the refused one was rolled back',
      await t.tapUntilValue(
        () => t.requireControl('Real-input rejecting segmented control'),
        ECHO.rejectEvents,
        '2',
        'the repeated tap to register',
        { aim: (node) => t.tapControlAt(node, 0.5) }
      ),
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
  'dialog': async (t) => {
    // The titles `DialogScreen` gives its dialogs. None appears anywhere else on the
    // screen, so a text match names one window: `Locked action` and `Locked share` are
    // the disabled ones. A Compose `Dialog` (and a `ModalBottomSheet`, which is one)
    // is a window of its own that is not a `Pop-Up Window`, and while it is up
    // `uiautomator dump` returns its tree rather than the app's - so the echo is read
    // only with every dialog down, and "up" is read as the dialog's own title.
    const ALERT = 'Delete the draft?';
    const STICKY = 'Back and outside do nothing';
    const SHEET_ROW = 'Copy link';
    const upCount = (text) => () =>
      t.dump().filter((node) => node.text === text).length;
    const opener = (testID) => () => {
      const node = t.nodeByTestId(testID);
      if (node == null) {
        t.log.abort(`no opener with testID "${testID}" on the Dialogs screen`);
      }
      return node;
    };
    const waitGone = async (text, description) => {
      const deadline = Date.now() + REACT_TIMEOUT;
      while (upCount(text)() > 0) {
        if (Date.now() > deadline) {
          t.log.abort(`timed out waiting for ${description}`);
        }
        await t.settle(250);
      }
    };
    const open = async (testID, witness, description) => {
      await t.tapUntilUp(opener(testID), description, upCount(witness), {
        pollMs: DUMP_POLL_MS,
      });
      t.waitForOption(witness, description);
    };
    // The node a person acts on is not the label's own: measured on this screen, each
    // action is a clickable `View` whose child `TextView` carries the text, and that
    // child reads `enabled="true"` whatever the action is (a disabled one's `View` reads
    // `enabled="false" focusable="false"`). So this reads the innermost clickable node
    // that contains the label's centre - the one TalkBack stops on and a tap lands on.
    const actionNodeOf = (text) => {
      const nodes = t.dump();
      const label = nodes.find((node) => node.text === text);
      if (label == null) return undefined;
      const { cx, cy } = label.bounds;
      return nodes
        .filter(
          (node) =>
            node.clickable === 'true' &&
            node.bounds.x1 <= cx &&
            cx <= node.bounds.x2 &&
            node.bounds.y1 <= cy &&
            cy <= node.bounds.y2
        )
        .sort(
          (a, b) =>
            a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height
        )[0];
    };
    const enabledOf = (text) => actionNodeOf(text)?.enabled;

    // 1. Before a touch: nothing reported, nothing up.
    t.log.checkEquals(
      'no dialog has reported anything before a touch',
      t.requireEcho(ECHO.dialogLog),
      'none'
    );
    t.log.checkEquals('no alert is up before a touch', upCount(ALERT)(), 0);

    // 2. A real tap opens the alert; JS opened it, so it reports nothing (read once
    //    it is down again, in step 5's whole-log comparison).
    await open('dialog-open-alert', ALERT, 'the real tap that opens the alert');
    // 3. The disabled action is disabled in the accessibility tree too, and its twin
    //    is not. The text node sits inside the button Compose merges it into, so the
    //    node's own `enabled` is the button's.
    t.log.checkEquals(
      'a disabled action is a node that is not enabled',
      enabledOf('Locked action'),
      'false'
    );
    t.log.checkEquals(
      'and an ordinary action is enabled',
      enabledOf('Delete draft'),
      'true'
    );

    // 4. A real tap on the disabled action takes nothing and leaves the alert up. One
    //    press: the right outcome is silence; step 5 is its barrier.
    await t.tapNode(t.waitForOption('Locked action', 'the disabled action'));
    await t.settle(1500);
    t.log.checkEquals(
      'a real tap on a disabled action leaves the alert up',
      upCount(ALERT)(),
      1
    );

    // 5. The action that reports, before the close it causes (D32).
    t.log.checkEquals(
      'a real tap on an action reports its id, then the close - once each, in order',
      await t.tapOptionUntilValue(
        'Delete draft',
        ECHO.dialogLog,
        'action:delete > presented:false',
        'the real tap on "Delete draft"'
      ),
      'action:delete > presented:false'
    );
    await waitGone(ALERT, 'the action to take the alert down');

    // 6. Back and a tap outside close a dismissible alert, and report the close alone.
    await open(
      'dialog-open-alert',
      ALERT,
      'the real tap that reopens the alert'
    );
    await t.pressBack();
    await waitGone(ALERT, 'Back to take the dismissible alert down');
    await open('dialog-open-alert', ALERT, 'the real tap that opens it again');
    await t.tapScrim();
    await waitGone(ALERT, 'a tap outside to take the dismissible alert down');
    t.log.checkEquals(
      'Back and a tap outside each closed the alert with one close and no action',
      t.requireEcho(ECHO.dialogLog),
      'action:delete > presented:false > presented:false > presented:false'
    );

    // 7. Neither closes a dialog that only an action may close.
    await open(
      'dialog-open-sticky',
      STICKY,
      'the real tap that opens the sticky alert'
    );
    await t.pressBack();
    await t.settle(1000);
    t.log.checkEquals('Back leaves the sticky alert up', upCount(STICKY)(), 1);
    await t.tapScrim();
    await t.settle(1000);
    t.log.checkEquals('and so does a tap outside', upCount(STICKY)(), 1);
    t.log.checkEquals(
      'its one action closes it, reporting the action first',
      await t.tapOptionUntilValue(
        'Understood',
        ECHO.dialogLog,
        'action:delete > presented:false > presented:false > presented:false > ' +
          'action:ok > presented:false',
        'the real tap on "Understood"'
      ),
      'action:delete > presented:false > presented:false > presented:false > ' +
        'action:ok > presented:false'
    );
    await waitGone(STICKY, 'the action to take the sticky alert down');

    // 8. The confirmation dialog is a Material bottom sheet of rows: its disabled row
    //    is disabled, Back closes it with the close alone, and a row reports.
    await open(
      'dialog-open-sheet',
      SHEET_ROW,
      'the real tap that opens the confirmation sheet'
    );
    t.log.checkEquals(
      'the sheet shows the title the app asked to be visible',
      upCount('Share the photo')(),
      1
    );
    t.log.checkEquals(
      "the sheet's disabled row is not enabled",
      enabledOf('Locked share'),
      'false'
    );
    await t.pressBack();
    await waitGone(SHEET_ROW, 'Back to take the sheet down');
    await open(
      'dialog-open-sheet',
      SHEET_ROW,
      'the real tap that reopens the sheet'
    );
    const tail =
      'presented:false > presented:false > action:ok > presented:false > ' +
      'presented:false > action:copy > presented:false';
    t.log.checkEquals(
      "a sheet's row reports its id, then the close; Back before it reported a close alone",
      await t.tapOptionUntilValue(
        SHEET_ROW,
        ECHO.dialogLog,
        `action:delete > presented:false > ${tail}`,
        `the real tap on "${SHEET_ROW}"`
      ),
      `action:delete > presented:false > ${tail}`
    );
    await waitGone(SHEET_ROW, 'the row to take the sheet down');
  },

  'tooltip': async (t) => {
    // The rich tooltip `TooltipScreen` opens around its star. Its message and its
    // action's title appear nowhere else on the screen, so a text match names the
    // popup. Material's popup is a window of its own, and while it is up the dump can
    // be that window's tree rather than the app's - so the log is read only with the
    // tooltip down, and "up" is read as the tooltip's own message.
    const MESSAGE = 'Tap the star to keep this search.';
    const TITLE = 'Saved searches';
    const ACTION = 'Got it';
    const upCount = () =>
      t.dump().filter((node) => node.text === MESSAGE).length;
    const opener = () => {
      const node = t.nodeByTestId('tooltip-open-rich');
      if (node == null) {
        t.log.abort('no "tooltip-open-rich" opener on the Tooltip screen');
      }
      return node;
    };
    const open = async (description) => {
      await t.tapUntilUp(opener, description, upCount, {
        pollMs: DUMP_POLL_MS,
      });
      t.waitForOption(MESSAGE, description);
    };
    const waitGone = async (description) => {
      const deadline = Date.now() + REACT_TIMEOUT;
      while (upCount() > 0) {
        if (Date.now() > deadline) {
          t.log.abort(`timed out waiting for ${description}`);
        }
        await t.settle(250);
      }
    };
    // One real tap on the star, confirmed by its own count. The anchor is the app's
    // `Pressable`; the tooltip's overlay is behind it and takes no touch.
    const pressAnchor = async (expected, description) => {
      const { delivered, shown } = await t.pressUntil({
        what: 'the star the tooltip points at (tooltip-anchor)',
        waitingFor: description,
        attempts: 1,
        press: async () => {
          await t.tapTestId('tooltip-anchor');
        },
        reading: () => t.echo(ECHO.tooltipPresses),
        raised: (current) => current === expected,
      });
      if (!delivered) {
        t.log.abort(
          `${description}: the star's count says "${String(shown)}", not "${expected}"`
        );
      }
      return shown;
    };
    // Outside: the log line, a `Text` with no press of its own, well above the popup
    // that hangs over the star. Found while the tooltip is down (an open popup's window
    // can be all the dump holds), and tapped where it was. A fixed fraction of the
    // screen could land on a tab, or on a button a passed-through touch would press.
    const logNode = t.nodeByTestId(ECHO.tooltipLog);
    if (logNode == null) {
      t.log.abort('no "tooltip-log" on the Tooltip screen to tap outside on');
    }
    const tapOutside = async () => {
      await t.tapNode(logNode);
      await t.settle(400);
    };

    // 1. Before a touch: nothing reported, nothing up, and a closed tooltip leaves a
    //    real tap on its anchor to the anchor - once.
    t.log.checkEquals(
      'no tooltip has reported anything before a touch',
      t.requireEcho(ECHO.tooltipLog),
      'none'
    );
    t.log.checkEquals('no tooltip is up before a touch', upCount(), 0);
    t.log.checkEquals(
      'a real tap on the anchor of a closed tooltip presses the anchor once',
      await pressAnchor('star presses: 1', 'the real tap on the star'),
      'star presses: 1'
    );
    await t.settle(800);
    t.log.checkEquals(
      'and opens nothing, reports nothing',
      `${String(upCount())} up, log ${String(t.requireEcho(ECHO.tooltipLog))}`,
      '0 up, log none'
    );

    // 2. A real tap on a plain RN button opens it, with its title and its action. JS
    //    opened it, so it reports nothing (read once it is down, in step 3).
    await open('the real tap that opens the rich tooltip');
    t.log.checkEquals(
      'the tooltip shows its title and its action',
      `${String(t.dump().filter((n) => n.text === TITLE).length)} title, ` +
        `${String(t.dump().filter((n) => n.text === ACTION).length)} action`,
      '1 title, 1 action'
    );

    // 3. A tap outside closes it, and reports the close alone.
    await tapOutside();
    await waitGone('a tap outside to take the tooltip down');
    t.log.checkEquals(
      'a tap outside closes the tooltip and reports the close alone',
      t.requireEcho(ECHO.tooltipLog),
      'presented:false'
    );

    // 4. Back closes a tooltip with an action - Material makes that one focusable.
    await open('the real tap that reopens the rich tooltip');
    await t.pressBack();
    await waitGone('Back to take the tooltip down');
    t.log.checkEquals(
      'Back closes it and reports the close alone',
      t.requireEcho(ECHO.tooltipLog),
      'presented:false > presented:false'
    );

    // 5. Its action reports, before the close it causes (D32).
    await open('the real tap that opens it again');
    const afterAction =
      'presented:false > presented:false > action:ok > presented:false';
    t.log.checkEquals(
      'a real tap on its action reports the id, then the close - once each, in order',
      await t.tapOptionUntilValue(
        ACTION,
        ECHO.tooltipLog,
        afterAction,
        `the real tap on "${ACTION}"`
      ),
      afterAction
    );
    await waitGone('the action to take the tooltip down');

    // 6. Closed again, the anchor's taps are its own.
    t.log.checkEquals(
      'once it is closed, a real tap on the anchor presses it once more',
      await pressAnchor('star presses: 2', 'the second real tap on the star'),
      'star presses: 2'
    );
    await t.settle(800);
    t.log.checkEquals(
      'and opens nothing, reports nothing',
      `${String(upCount())} up, log ${String(t.requireEcho(ECHO.tooltipLog))}`,
      `0 up, log ${afterAction}`
    );
  },

  'bottom-sheet': async (t) => {
    // The texts `BottomSheetScreen` gives its sheets' content. Each appears nowhere
    // else, so a text match names one sheet. A Material sheet is a `Dialog` window of
    // its own, and while it is up `uiautomator dump` returns its tree - the React
    // Native content is in there, which is half of what this check proves - so the
    // screen's log is read only with every sheet down, and the sheet's own echo
    // (`Pressed N times`) while it is up.
    const FIT = 'Press inside the sheet';
    const FIT_TITLE = 'As tall as this';
    const STICKY = 'Close the sticky sheet';
    const STICKY_TITLE = 'Swipe, back and outside do nothing';
    const TWO = 'Drag this up for large';
    const upCount = (text) => () =>
      t.dump().filter((node) => node.text === text).length;
    const opener = (testID) => () => {
      const node = t.nodeByTestId(testID);
      if (node == null) {
        t.log.abort(`no opener with testID "${testID}" on the Sheet screen`);
      }
      return node;
    };
    const waitGone = async (text, description) => {
      const deadline = Date.now() + REACT_TIMEOUT;
      while (upCount(text)() > 0) {
        if (Date.now() > deadline) {
          t.log.abort(`timed out waiting for ${description}`);
        }
        await t.settle(250);
      }
    };
    const open = async (testID, witness, description) => {
      await t.tapUntilUp(opener(testID), description, upCount(witness), {
        pollMs: DUMP_POLL_MS,
      });
      t.waitForOption(witness, description);
      // The entry animation: a gesture during it lands on a moving sheet.
      await t.settle(700);
    };
    const log = (expected, what) =>
      t.log.checkEquals(what, t.requireEcho(ECHO.sheetLog), expected);

    // 0. Before a touch: nothing reported, and the content is not mounted.
    log('none', 'no sheet has reported anything before a touch');
    t.log.checkEquals(
      "the sheet's content is not mounted before it is presented",
      upCount(FIT)(),
      0
    );

    // 1. A real tap opens the fit sheet; its React Native content is in its window, and
    //    the sheet itself carries `<testID>-sheet` for a test or a11y tool to find.
    await open('sheet-open-fit', FIT, 'the real tap that opens the fit sheet');
    t.log.checkEquals(
      'the presented sheet is the node named sheet-fit-sheet',
      t.nodeByTestId('sheet-fit-sheet') != null,
      true
    );

    // 2. A real tap on the Pressable inside the sheet reaches JS through the sheet's
    //    own touch root: the sheet's echo moves.
    const pressed = await t.pressUntil({
      what: 'the Pressable inside the sheet',
      waitingFor: 'the real tap inside the sheet to reach JS',
      press: async (attempt) => {
        if (attempt > 1 && upCount('Pressed 1 times')() > 0) return;
        await t.tapNode(t.waitForOption(FIT, 'the Pressable to be up'));
      },
      reading: () =>
        upCount('Pressed 1 times')() > 0 ? 'Pressed 1 times' : '-',
      raised: (shown) => shown === 'Pressed 1 times',
      pollMs: DUMP_POLL_MS,
    });
    t.log.checkEquals(
      'a real tap inside the sheet presses its Pressable once',
      pressed.shown,
      'Pressed 1 times'
    );

    // 2a. A real tap on a TextInput inside the sheet. `ReactEditText` disallows its
    //     parents' interception on touch-down, so the tap's UP reaches JS only because
    //     the sheet's root keeps intercepting regardless (RN's `ReactRootView` rule);
    //     without it JS sees the press go in and never come out.
    const touches = await t.pressUntil({
      what: 'the TextInput inside the sheet',
      waitingFor: 'a real tap on the TextInput to reach JS, in and out',
      press: async (attempt) => {
        if (attempt > 1 && upCount('Input touches: in 0 out 0')() === 0) return;
        const input = t.nodeByTestId('sheet-input');
        if (input == null) t.log.abort('no TextInput sheet-input in the sheet');
        await t.tapNode(input);
      },
      reading: () =>
        t.dump().find((node) => node.text.startsWith('Input touches:'))?.text ??
        '-',
      raised: (shown) => shown === 'Input touches: in 1 out 1',
      pollMs: DUMP_POLL_MS,
    });
    t.log.checkEquals(
      "a real tap on the sheet's TextInput reaches JS as a whole press",
      touches.shown,
      'Input touches: in 1 out 1'
    );

    // 2b. A horizontal drag on the list inside the sheet: the ScrollView disallows its
    //     parents' interception for that gesture. The sheet's root must still see the
    //     gesture's end (RN's `ReactRootView` rule), or JS keeps a touch that never
    //     ended - and the next press on the Pressable is lost.
    const chipBefore = t.waitForOption('Chip 1', 'the first chip of the list');
    await t.swipeAcross(chipBefore, 0.9, 0.1, 400);
    const chipAfter = findAllByText(t.dump(), 'Chip 1')[0] ?? null;
    t.log.checkEquals(
      'a horizontal drag scrolls the list inside the sheet (Chip 1 moved left or out)',
      chipAfter == null || chipAfter.bounds.x1 < chipBefore.bounds.x1,
      true
    );
    t.log.checkEquals('and leaves the sheet up', upCount(FIT)(), 1);
    const pressedAgain = await t.pressUntil({
      what: 'the Pressable inside the sheet, after the scroll',
      waitingFor: 'a real tap after the horizontal scroll to reach JS',
      press: async (attempt) => {
        if (attempt > 1 && upCount('Pressed 2 times')() > 0) return;
        await t.tapNode(t.waitForOption(FIT, 'the Pressable to be up'));
      },
      reading: () =>
        upCount('Pressed 2 times')() > 0 ? 'Pressed 2 times' : '-',
      raised: (shown) => shown === 'Pressed 2 times',
      pollMs: DUMP_POLL_MS,
    });
    t.log.checkEquals(
      'the Pressable still takes a real tap after the scroll',
      pressedAgain.shown,
      'Pressed 2 times'
    );

    // 3. Back closes it; then a tap outside; then a drag down on its content.
    await t.pressBack();
    await waitGone(FIT, 'Back to take the fit sheet down');
    await open(
      'sheet-open-fit',
      FIT,
      'the real tap that reopens the fit sheet'
    );
    await t.tapAtFraction(0.5, 0.12);
    await waitGone(FIT, 'a tap outside to take the fit sheet down');
    await open('sheet-open-fit', FIT, 'the real tap that opens it again');
    await t.swipeFrom(
      t.waitForOption(FIT_TITLE, 'the fit sheet title'),
      Math.round(600 * t.density()),
      250
    );
    await waitGone(
      FIT,
      'a drag down on the content to take the fit sheet down'
    );
    log(
      'press:1 > press:2 > presented:false > dismiss > presented:false > dismiss > ' +
        'presented:false > dismiss',
      'Back, a tap outside and a drag down each reported the close, then the dismissal'
    );

    // 4. None of the three closes a sticky sheet; its own button does, and that close
    //    is the app's (no presented:false).
    await open(
      'sheet-open-sticky',
      STICKY,
      'the real tap that opens the sticky sheet'
    );
    await t.pressBack();
    await t.settle(1000);
    t.log.checkEquals('Back leaves the sticky sheet up', upCount(STICKY)(), 1);
    await t.tapAtFraction(0.5, 0.12);
    await t.settle(1000);
    t.log.checkEquals('and so does a tap outside', upCount(STICKY)(), 1);
    await t.swipeFrom(
      t.waitForOption(STICKY_TITLE, 'the sticky sheet title'),
      Math.round(600 * t.density()),
      250
    );
    await t.settle(1200);
    t.log.checkEquals('and so does a drag down', upCount(STICKY)(), 1);
    await t.tapUntilUp(
      () => t.waitForOption(STICKY, 'the sticky sheet button'),
      'the real tap on the sticky sheet button to close it',
      () => (upCount(STICKY)() === 0 ? 1 : 0),
      { pollMs: DUMP_POLL_MS }
    );
    await waitGone(STICKY, 'the sticky sheet button to take it down');
    log(
      'press:1 > press:2 > presented:false > dismiss > presented:false > dismiss > ' +
        'presented:false > dismiss > close > dismiss',
      'only the sticky sheet button closed it'
    );

    // 5. The two-detent sheet opens half expanded; a drag up on its header expands it,
    //    which reports detent 1.
    await open(
      'sheet-open-two',
      TWO,
      'the real tap that opens the two-detent sheet'
    );
    const header = t.waitForOption(TWO, 'the two-detent header');
    const halfTop = header.bounds.y1;
    await t.swipeFrom(header, -Math.round(halfTop * 0.8), 400);
    await t.settle(800);
    const expandedTop = t.waitForOption(TWO, 'the header after the drag').bounds
      .y1;
    t.log.note(
      `bottom-sheet: the two-detent header moved from y=${String(halfTop)} to y=${String(expandedTop)}`
    );
    t.log.checkEquals(
      'a drag up on the header expands the sheet (its top moves up by more than a third)',
      halfTop - expandedTop > halfTop / 3,
      true
    );
    // Material's Back steps down a detent before it closes: from expanded it returns to
    // the half-expanded one (reported as detent 0), and only the next Back closes it.
    await t.pressBack();
    await t.settle(1200);
    t.log.checkEquals(
      'Back from the expanded detent leaves the sheet up, half expanded',
      upCount(TWO)(),
      1
    );
    await t.pressBack();
    await waitGone(TWO, 'a second Back to take the two-detent sheet down');
    // The screen keeps its last twelve entries, so the first press has scrolled off.
    log(
      'presented:false > dismiss > presented:false > dismiss > presented:false > ' +
        'dismiss > close > dismiss > detent:1 > detent:0 > presented:false > dismiss',
      'a drag up reported detent 1, Back stepped down to detent 0, and Back closed it'
    );
  },

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

    // And the thing no press can see: that the calendar in the README's 320 dp box is
    // laid out as a week rather than as six columns and a sliver.
    await checkInlineCalendarGrids(t);
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
  /**
   * Real keystrokes into a Compose `BasicTextField`, from outside the app: `adb shell
   * input text` injects key events into the focused window, so they travel
   * InputDispatcher → the field → Nitro → JS → re-render (Q2's Android oracle,
   * orchestrator answer 2). `input text` has no target, so every burst is preceded by a
   * real tap that has to have focused the field - which is also the focus check.
   *
   * What each part proves, on the app's own `Text` and the field's own accessibility
   * text (the string Compose publishes for an editable node):
   * - **typing**: the keys reach React as the field's text;
   * - **a refused edit reverts**: the frozen field reports every key and keeps showing
   *   `frozen` - the handshake's revert, driven by a keyboard rather than a write;
   * - **`maxLength`**: seven keys into a cap of five leave five;
   * - **focus and blur**: a tap focuses, Enter submits the text and blurs (RN's
   *   single-line default), and the screen's own `ref.focus()` / `ref.blur()` buttons,
   *   pressed for real, move it again.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'text-field': async (t) => {
    t.log.checkEquals(
      'the typing field starts empty',
      t.requireEcho(ECHO.textTyping),
      'typed:  (0)'
    );
    // Lowest field first: once a keyboard is up it covers the lower half of the
    // screen, and every later tap is aimed higher than the one before it.
    await t.tapNode(await t.requireControlOnScreen('Capped field'));
    await t.type('abcdefg');
    t.log.checkEquals(
      'maxLength 5 keeps five of seven keys',
      t.waitForEcho(ECHO.textCapped, 'capped: abcde (5)', 'the capped text'),
      'capped: abcde (5)'
    );
    t.log.checkEquals(
      'and the field holds the same five',
      t.fieldText('Capped field'),
      'abcde'
    );

    await t.tapNode(await t.requireControlOnScreen('Frozen field'));
    await t.type('xy');
    t.log.checkEquals(
      'every key into the frozen field is reported to JS',
      t.waitForEcho(
        ECHO.textFrozen,
        'frozen: 2 edits refused',
        'two refused edits'
      ),
      'frozen: 2 edits refused'
    );
    t.log.checkEquals(
      'and each one is reverted: the field still shows what JS kept',
      t.fieldText('Frozen field'),
      'frozen'
    );

    await t.tapNode(await t.requireControlOnScreen('Typing field'));
    await t.type('abc12');
    t.log.checkEquals(
      'real keystrokes reach the field, and React sees its text',
      t.waitForEcho(ECHO.textTyping, 'typed: abc12 (5)', 'the typed text'),
      'typed: abc12 (5)'
    );
    t.log.checkEquals(
      'the field shows what React was told',
      t.fieldText('Typing field'),
      'abc12'
    );

    await t.tapNode(await t.requireControlOnScreen('Focus field'));
    t.log.checkEquals(
      'a real tap focuses the field (onFocus)',
      t.waitForEcho(
        ECHO.textFocus,
        'focus: 1 blur: 0 submitted: -',
        'the focus'
      ),
      'focus: 1 blur: 0 submitted: -'
    );
    await t.type('go');
    t.key(KEY_ENTER);
    t.log.checkEquals(
      'Enter submits the text and then blurs the field',
      t.waitForEcho(
        ECHO.textFocus,
        'focus: 1 blur: 1 submitted: go',
        'the submit and blur'
      ),
      'focus: 1 blur: 1 submitted: go'
    );
    await t.tapTestId('text-focus-js');
    t.log.checkEquals(
      'a real tap on a button that calls ref.focus() focuses it',
      t.waitForEcho(
        ECHO.textFocus,
        'focus: 2 blur: 1 submitted: go',
        'focus from JS'
      ),
      'focus: 2 blur: 1 submitted: go'
    );
    await t.tapTestId('text-blur-js');
    t.log.checkEquals(
      'and one that calls ref.blur() blurs it',
      t.waitForEcho(
        ECHO.textFocus,
        'focus: 2 blur: 2 submitted: go',
        'blur from JS'
      ),
      'focus: 2 blur: 2 submitted: go'
    );
    // Leave no keyboard up for the next check.
    await t.hideKeyboard();
  },

  /**
   * Real keystrokes into Material 3's search input, plus the two things a *search*
   * field does that a text field does not: the Search key refuses an empty query, and
   * the field grows a clear button that takes the query out without losing focus.
   *
   * Four assertions here are not in `CHECKS['text-field']`, and each is the out-of-app
   * half of a claim the component makes:
   *
   * - **the Search key with nothing in the field reports nothing**: the rule
   *   `HybridNitroUiSearchField.kt`'s `onSearch` enforces, driven by a real key rather
   *   than by a call. iOS states the same rule with `enablesReturnKeyAutomatically`.
   * - **the Search key submits the query and then blurs**, as a single-line field does.
   * - **the clear button empties the field** — aimed at from the tree, so a clear that
   *   only *looks* tappable goes red.
   * - **clearing keeps focus**: the blur counter does not move, so a clear that also
   *   dismissed the keyboard — what `clearFocus()` beside `clearText()` would do — is
   *   caught.
   *
   * The clear button is found by geometry, not by name: its label is the framework's own
   * localized "clear query" string (`SearchFieldStrings`), which this script has no
   * business spelling out in English. What *is* asserted is that the node it taps is
   * named, because an unnamed button is one TalkBack cannot describe.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  'search-field': async (t) => {
    /**
     * The editable node inside the named field's box.
     *
     * `fieldText` requires the *same* box, which is how `HybridNitroUiTextField`
     * publishes its name; a search bar names the whole input row and holds the text in
     * a node inset by its own leading icon, so containment is the right relation here.
     *
     * @param {string} description
     */
    const queryText = (description) => {
      const nodes = t.dump();
      const named = nodes.find(
        (node) => node.contentDesc === description && node.bounds.width > 0
      );
      if (named == null) {
        t.log.abort(`no search field named "${description}" on screen`);
      }
      const held = nodes.filter(
        (node) =>
          node.className === 'android.widget.EditText' &&
          node.bounds.x1 >= named.bounds.x1 &&
          node.bounds.y1 >= named.bounds.y1 &&
          node.bounds.x2 <= named.bounds.x2 &&
          node.bounds.y2 <= named.bounds.y2
      );
      if (held.length !== 1) {
        t.log.abort(
          `"${description}" holds ${String(held.length)} editable nodes in its box - ` +
            'a check cannot say which one a keystroke reached'
        );
      }
      return held[0].text;
    };

    /**
     * The clear affordance of a focused field: the clickable node the field owns inside
     * its own box, on the side away from the search glyph.
     *
     * @param {import('./uiautomator.mjs').UiautomatorNode} field
     */
    const clearButtonIn = (field) => {
      const candidates = t
        .dump()
        .filter(
          (node) =>
            node.clickable === 'true' &&
            node.bounds.cx > field.bounds.cx &&
            node.bounds.cx < field.bounds.x2 &&
            node.bounds.cy > field.bounds.y1 &&
            node.bounds.cy < field.bounds.y2 &&
            node.bounds.width > 0 &&
            node.bounds.width < field.bounds.width * 0.6 &&
            !(
              node.bounds.x1 === field.bounds.x1 &&
              node.bounds.x2 === field.bounds.x2
            )
        );
      if (candidates.length !== 1) {
        t.log.abort(
          `the focused search field offers ${String(candidates.length)} ` +
            'clickable nodes on its trailing side — expected exactly the clear ' +
            'button, so a tap cannot be aimed at it'
        );
      }
      const clear = candidates[0];
      t.log.note(
        `the clear button is "${clear.contentDesc}" at ` +
          `${String(clear.bounds.x1)},${String(clear.bounds.y1)} → ` +
          `${String(clear.bounds.x2)},${String(clear.bounds.y2)}`
      );
      return clear;
    };

    t.log.checkEquals(
      'the search field starts empty',
      t.requireEcho(ECHO.searchTyping),
      'query:  (0)'
    );
    t.log.checkEquals(
      'and nothing has been focused, blurred or submitted yet',
      t.requireEcho(ECHO.searchFocus),
      'focus: 0 blur: 0 submitted: -'
    );
    t.log.check(
      'a placeholder nobody chose still draws a word for search',
      t
        .dump()
        .some((node) => node.text.includes('earch') && node.text.length > 0)
    );
    t.log.check(
      'and a placeholder that was chosen is drawn too',
      t.dump().some((node) => node.text === 'Search recipes')
    );

    // Lowest field first: once a keyboard is up it covers the lower half of the
    // screen, and every later tap is aimed higher than the one before it.
    await t.tapNode(await t.requireControlOnScreen('Capped search field'));
    await t.type('abcdefg');
    t.log.checkEquals(
      'maxLength 5 keeps five of seven keys',
      t.waitForEcho(ECHO.searchCapped, 'capped: abcde (5)', 'the capped query'),
      'capped: abcde (5)'
    );
    t.log.checkEquals(
      'and the field holds the same five',
      queryText('Capped search field'),
      'abcde'
    );

    await t.tapNode(await t.requireControlOnScreen('Frozen search field'));
    await t.type('xy');
    t.log.checkEquals(
      'every key into the frozen field is reported to JS',
      t.waitForEcho(
        ECHO.searchFrozen,
        'frozen: 2 edits refused',
        'two refused edits'
      ),
      'frozen: 2 edits refused'
    );
    t.log.checkEquals(
      'and each one is reverted: the field still shows what JS kept',
      queryText('Frozen search field'),
      'frozen'
    );

    await t.tapNode(await t.requireControlOnScreen('Typing search field'));
    await t.type('latte');
    t.log.checkEquals(
      'real keystrokes reach the field, and React sees the query',
      t.waitForEcho(ECHO.searchTyping, 'query: latte (5)', 'the typed query'),
      'query: latte (5)'
    );
    t.log.checkEquals(
      'the field shows what React was told',
      queryText('Typing search field'),
      'latte'
    );

    // 1. Focus, and the key that must not answer.
    await t.tapNode(await t.requireControlOnScreen('Focus search field'));
    t.log.checkEquals(
      'a real tap focuses the field (onFocus)',
      t.waitForEcho(
        ECHO.searchFocus,
        'focus: 1 blur: 0 submitted: -',
        'the focus'
      ),
      'focus: 1 blur: 0 submitted: -'
    );
    t.key(KEY_ENTER);
    t.log.checkEquals(
      'the Search key with an empty query submits nothing and blurs nobody',
      t.requireEchoToStay(
        ECHO.searchFocus,
        'focus: 1 blur: 0 submitted: -',
        'an empty Search key to stay silent'
      ),
      'focus: 1 blur: 0 submitted: -'
    );

    // 2. The clear button: one edit, focus kept.
    await t.type('go');
    t.log.checkEquals(
      'the field holds the query before anything clears it',
      queryText('Focus search field'),
      'go'
    );
    const focused = await t.requireControlOnScreen('Focus search field');
    const clear = clearButtonIn(focused);
    t.log.check(
      'the clear button names itself, so TalkBack can say what it does',
      clear.contentDesc.length > 0
    );
    await t.tapNode(clear);
    t.log.checkEquals(
      'a real tap on the clear button empties the field',
      queryText('Focus search field'),
      ''
    );
    t.log.checkEquals(
      'and clearing keeps focus: no blur, no submit',
      t.requireEchoToStay(
        ECHO.searchFocus,
        'focus: 1 blur: 0 submitted: -',
        'the clear button to hold focus'
      ),
      'focus: 1 blur: 0 submitted: -'
    );

    // 3. The key that must answer, and the two imperative handles.
    await t.type('go');
    t.key(KEY_ENTER);
    t.log.checkEquals(
      'the Search key submits the query and then blurs the field',
      t.waitForEcho(
        ECHO.searchFocus,
        'focus: 1 blur: 1 submitted: go',
        'the submit and blur'
      ),
      'focus: 1 blur: 1 submitted: go'
    );
    await t.tapTestId('search-focus-js');
    t.log.checkEquals(
      'a real tap on a button that calls ref.focus() focuses it',
      t.waitForEcho(
        ECHO.searchFocus,
        'focus: 2 blur: 1 submitted: go',
        'focus from JS'
      ),
      'focus: 2 blur: 1 submitted: go'
    );
    await t.tapTestId('search-blur-js');
    t.log.checkEquals(
      'and one that calls ref.blur() blurs it',
      t.waitForEcho(
        ECHO.searchFocus,
        'focus: 2 blur: 2 submitted: go',
        'blur from JS'
      ),
      'focus: 2 blur: 2 submitted: go'
    );
    // Leave no keyboard up for the next check.
    await t.hideKeyboard();
  },

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
    //    expected to treat that as a choice (asserted after it closes, below). The
    //    window is the witness that the tap arrived, so it is tapped until one is up.
    t.log.checkEquals(
      'a real tap on the anchor opens the menu as a popup window',
      await t.tapUntilUp(
        () => t.requireControlAt('Real-input picker', control),
        'a real tap on the anchor to open a popup window',
        () => t.popupWindowCount()
      ),
      '1'
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
      t.waitForPopupCount(0, 'the back gesture to take the popup down'),
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
    //       The row tap stays blind on purpose: its correct outcome is that *nothing*
    //       is reported, so there is no witness to wait for, and a retry would press a
    //       closing menu a second time. What the helper guarantees is only that the
    //       menu this tap lands in was really opened by a touch.
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input picker', control),
      'a real tap that reopens the menu',
      () => t.popupWindowCount()
    );
    await t.tapNode(
      t.waitForOption(FIRST, 'the menu to show the current choice')
    );
    t.log.checkEquals(
      'tapping the row that is already chosen closes the menu',
      t.waitForPopupCount(
        0,
        'a pick of the row already chosen to take the menu down'
      ),
      0
    );
    t.log.checkEquals(
      'and a choice that changed nothing reports nothing',
      t.requireEcho(ECHO.pickerEvents),
      '0'
    );

    // 3. Choosing. The rows are the popup's, so this tap is aimed at a node that
    //    only exists while the menu is open. The row is re-found each attempt and the
    //    echoed index is the witness, so a tap that never landed stops being the
    //    first explanation offered for "the menu will not pick".
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input picker', control),
      'a real tap that opens the menu again',
      () => t.popupWindowCount()
    );
    t.log.checkEquals(
      'a real tap on a menu row reaches JS as index 2',
      await t.tapOptionUntilValue(
        LONGEST,
        ECHO.pickerIndex,
        '2',
        'a real tap on the row to register'
      ),
      '2'
    );
    t.log.checkEquals(
      'one choice reports one change',
      t.requireEcho(ECHO.pickerEvents),
      '1'
    );
    t.log.checkEquals(
      'choosing closes its own popup',
      t.waitForPopupCount(0, 'the pick to take that popup down'),
      0
    );

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
    await t.tapUntilUp(
      () => t.requireControl('Real-input rejecting picker'),
      'a real tap on the controlled picker to open its menu',
      () => t.popupWindowCount()
    );
    t.log.checkEquals(
      'a real tap on the controlled picker still reaches JS - native paints optimistically',
      await t.tapOptionUntilValue(
        'Ridge',
        ECHO.rejectEvents,
        '1',
        'the controlled tap to register'
      ),
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
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input rejecting picker', rejecting),
      'a real tap that reopens the refusing picker menu',
      () => t.popupWindowCount()
    );
    t.log.checkEquals(
      'tapping the refused row again is a fresh choice, which is only true if the refused one was rolled back',
      await t.tapOptionUntilValue(
        'Ridge',
        ECHO.rejectEvents,
        '2',
        'the repeated tap to register'
      ),
      '2'
    );
    t.log.checkEquals(
      'choosing shut that popup too',
      t.waitForPopupCount(0, 'the second pick to take its popup down'),
      0
    );

    // 6. The leak case (B1's shape, for popups): open a menu, then have React take
    //    the view away underneath it, three times. Each cycle ends with no popup
    //    window owned by the app - a popup that survives its view is invisible in
    //    the accessibility tree, so the window table is what is read.
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      // Brings the row into the dump; every press below re-finds its own target.
      await t.requireControl('Real-input drop picker');
      // The arm has its own echo on this row (`real-input-drop-armed`, written by
      // `PickerScreen` for exactly this reason), so the press that arms the unmount is
      // retried until it shows. Pressing it blind is how a dropped tap came to read as
      // the library leaking a menu: nothing was ever scheduled, the Picker survived,
      // and the popup count stayed 0 for the wrong reason. Each extra press is the
      // same press on a row that is not a counter, so it cannot overscore anything.
      await t.pressUntil({
        what: 'the unmount button',
        waitingFor: `cycle ${String(cycle)}: a real tap to arm the unmount`,
        attempts: 2,
        // Both readings here are accessibility dumps, and a dump costs about two
        // seconds on this box, so the poll is as slow as the reading can be. Reading
        // at 100 ms would spend the whole window on readings and arrive at the press
        // that opens the menu after the app's own unmount timer had fired - which is
        // the race this cycle has always had, made worse by the witness.
        windowMs: 4000,
        pollMs: 500,
        press: async () => {
          await t.tapNode(
            t.waitForNode(
              ECHO.pickerGone.replace('-gone', '-button'),
              'the unmount button'
            )
          );
        },
        reading: () =>
          t.nodeByTestId('real-input-drop-armed') == null ? '0' : '1',
        raised: (current) => current === '1',
      });
      // And the menu is opened by a press that is repeated until its window shows up.
      await t.tapUntilUp(
        () => t.requireControl('Real-input drop picker'),
        `cycle ${String(cycle)}: a real tap to open the drop picker's menu`,
        () => t.popupWindowCount(),
        2,
        4000
      );
      // Read the window table, not the accessibility dump: `dump` costs around a
      // second under load and can miss a menu that is open for less, while the
      // window table is one cheap query that says the same thing - a popup of this
      // app's is on screen. Steps 1-3 already proved such a popup carries rows.
      t.log.checkEquals(
        `cycle ${String(cycle)}: the drop picker's menu is open as a popup window`,
        t.waitForPopupCount(
          1,
          `cycle ${String(cycle)}'s menu to open as a popup window`
        ),
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
        t.waitForPopupCount(
          0,
          `cycle ${String(cycle)}: the unmount to take the open popup down`
        ),
        0
      );
      if (cycle < 3) {
        // The remount's witness is the Picker's own node coming back, so a dropped
        // press on the button cannot come round the loop as "no drop picker on screen".
        await t.pressUntil({
          what: 'the remount button',
          waitingFor: `cycle ${String(cycle)}: a real tap to mount the picker again`,
          press: async () => {
            await t.tapNode(
              t.waitForNode(
                ECHO.pickerGone.replace('-gone', '-remount'),
                'the remount button'
              )
            );
          },
          reading: () =>
            t
              .dump()
              .some((node) => node.contentDesc === 'Real-input drop picker')
              ? '1'
              : '0',
          raised: (value) => value === '1',
        });
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
      t.waitForPopupCount(0, 'a tap on the disabled picker to open nothing'),
      0
    );
    await t.tapUntilUp(
      () => t.requireControlOnScreen('Real-input enabled picker'),
      'a real tap on the enabled picker to open its menu',
      () => t.popupWindowCount()
    );
    t.log.checkEquals(
      'the ordinary picker, tapped the same way, opens one - so the line above measured a refusal',
      t.popupWindowCount(),
      1
    );
    await t.pressBack();
    t.log.checkEquals(
      'and that menu goes away again',
      t.waitForPopupCount(0, 'the back gesture to take that menu down'),
      0
    );

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

// ---------------------------------------------------------------------------
// ContextMenu (G16). Every reading is the screen's own echo (`ctx-echo`, React's
// counters in a fixed header outside the ScrollView) or the popup's window in the
// dump. With a popup up, `uiautomator dump` holds the popup's window only, so every
// echo is read before a hold or after the close.
// ---------------------------------------------------------------------------

/** The `ctx-echo` line as numbers. @param {ReturnType<typeof makeContext>} t */
function contextEcho(t) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const part of (t.echo('ctx-echo') ?? '').split(';')) {
    const [key, value] = part.split('=');
    if (key != null && value != null && /^-?\d+$/.test(value)) {
      out[key] = Number(value);
    }
  }
  return out;
}

/**
 * Poll the echo until `ok` accepts it or `timeoutMs` passes; the last reading either way.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {(echo: Record<string, number>) => boolean} ok
 */
async function contextEchoWhen(t, ok, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let echo = contextEcho(t);
  while (!ok(echo) && Date.now() < deadline) {
    await sleep(250);
    echo = contextEcho(t);
  }
  return echo;
}

/**
 * The open popup's window and its rows, or `null` while the app's own window is on top.
 * The popup is the `android:id/content` that is not the whole display (S3's reading).
 *
 * @param {ReturnType<typeof makeContext>} t
 */
function contextPopup(t) {
  const nodes = t.dump();
  const width = t.displayWidth();
  const height = t.displayHeight();
  const content = nodes.find(
    (node) =>
      node.resourceId === 'android:id/content' &&
      !(
        node.bounds.x1 === 0 &&
        node.bounds.y1 === 0 &&
        node.bounds.x2 === width &&
        node.bounds.y2 === height
      )
  );
  if (content == null) return null;
  return {
    bounds: content.bounds,
    rows: nodes.filter((node) => node.text !== '').map((node) => node.text),
    nodes,
  };
}

/** @param {ReturnType<typeof makeContext>} t */
async function contextPopupWithin(t, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const popup = contextPopup(t);
    if (popup != null || Date.now() > deadline) return popup;
    await sleep(250);
  }
}

/**
 * The point `fx`, `fy` of the way across a node, px.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode['bounds']} bounds
 * @param {number} fx
 * @param {number} fy
 */
function pointIn(bounds, fx, fy) {
  return {
    x: Math.round(bounds.x1 + (bounds.x2 - bounds.x1) * fx),
    y: Math.round(bounds.y1 + (bounds.y2 - bounds.y1) * fy),
  };
}

/**
 * Close whatever popup is up with Back, and wait for its window to go.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
async function contextClose(t) {
  if (contextPopup(t) == null) return;
  await t.pressBack();
  t.waitForPopupCount(0, 'Back to close the context menu');
  await sleep(300);
}

/**
 * The node with this testID, scrolled wholly inside `ctx-scroll` with slow drags on the
 * right-edge strip (no fling, and no ContextMenu under the finger).
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} testID
 */
async function contextReveal(t, testID) {
  const edge = t.displayWidth() - 8;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const view = t.nodeByTestId('ctx-scroll')?.bounds;
    const node = t.nodeByTestId(testID)?.bounds;
    if (view == null) t.log.abort('the ContextMenu screen has no ctx-scroll');
    if (node != null && node.y1 >= view.y1 + 8 && node.y2 <= view.y2 - 8) {
      return node;
    }
    // Absent from the dump means scrolled out of sight, and everything here is below.
    const down = node == null || node.y2 > view.y2 - 8;
    const from = Math.round((view.y1 + view.y2) / 2);
    await t.swipePx(edge, from, edge, down ? from - 350 : from + 350, 900);
  }
  const last = t.nodeByTestId(testID);
  if (last == null) t.log.abort(`no "${testID}" on the ContextMenu screen`);
  return last.bounds;
}

/** @param {ReturnType<typeof makeContext>} t */
async function contextTop(t) {
  const edge = t.displayWidth() - 8;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((contextEcho(t).scrollY ?? 0) <= 0) return;
    const view = t.nodeByTestId('ctx-scroll')?.bounds;
    if (view == null) return;
    const from = Math.round(view.y1 + (view.y2 - view.y1) * 0.3);
    await t.swipePx(edge, from, edge, from + 700, 300);
    await sleep(500);
  }
}

/** @param {ReturnType<typeof makeContext>} t */
async function contextReset(t) {
  await contextClose(t);
  await contextTop(t);
  await t.tapTestId('ctx-reset');
  await contextEchoWhen(t, (echo) => echo.press === 0 && echo.opens === 0);
}

/** @param {ReturnType<typeof makeContext>} t */
async function contextMenuCheck(t) {
  const { log } = t;
  await contextReset(t);
  const density = t.density();
  const target = t.nodeByTestId('ctx-target')?.bounds;
  if (target == null) log.abort('no ctx-target on the ContextMenu screen');
  // Off-centre on purpose: the press point is the anchor, and a menu anchored to the
  // view's centre or corner would read tens of dp off here (S3: 329/48/141 px).
  const at = pointIn(target, 0.3, 0.4);

  // 1. Quick taps are the child's: one onPress each, no menu.
  let quick = 0;
  for (let i = 0; i < 3; i += 1) {
    const before = contextEcho(t);
    await t.tapPx(at.x, at.y);
    const after = await contextEchoWhen(t, (e) => e.press === before.press + 1);
    await sleep(500);
    if (
      contextEcho(t).press === before.press + 1 &&
      after.opens === before.opens
    ) {
      quick += 1;
    }
  }
  log.checkEquals(
    'a quick tap presses the child once and opens nothing (of 3)',
    quick,
    3
  );
  t.waitForPopupCount(0, 'no popup after the quick taps');

  // 2. A still hold opens the menu at the finger, with no onPress; a row picks, select
  //    then close; the next tap presses once.
  const anchors = [];
  let opened = 0;
  let pressAfterOpen = 0;
  let picked = 0;
  let fresh = 0;
  const orders = [];
  for (let i = 0; i < 3; i += 1) {
    const before = contextEcho(t);
    await t.holdAt(at.x, at.y, 1000);
    const popup = await contextPopupWithin(t);
    if (popup == null || !popup.rows.includes('Copy text')) {
      log.note(`hold ${String(i + 1)}: no popup with "Copy text"`);
      await contextClose(t);
      continue;
    }
    opened += 1;
    anchors.push({ dx: popup.bounds.x1 - at.x, dy: popup.bounds.y1 - at.y });
    const row = popup.nodes.find((node) => node.text === 'Copy text');
    if (row != null) await t.tapPx(row.bounds.cx, row.bounds.cy);
    t.waitForPopupCount(0, 'the pick to take the popup down');
    const mid = await contextEchoWhen(t, (e) => e.closes === before.closes + 1);
    pressAfterOpen += mid.press - before.press;
    if (mid.selects === before.selects + 1) picked += 1;
    orders.push(
      (t.echo('ctx-order') ?? '')
        .replace('order=', '')
        .split(',')
        .slice(-3)
        .join('>')
    );
    await t.tapPx(at.x, at.y);
    const after = await contextEchoWhen(t, (e) => e.press === mid.press + 1);
    await sleep(400);
    if (after.press === mid.press + 1) fresh += 1;
  }
  log.note(
    `popup top-start minus the press point, px at density ${String(density)}: ` +
      anchors.map((a) => `${String(a.dx)},${String(a.dy)}`).join(' | ')
  );
  log.checkEquals('a still hold opens the menu (of 3)', opened, 3);
  log.checkEquals(
    'and the child is never pressed by a hold that opened it',
    pressAfterOpen,
    0
  );
  log.checkEquals('a row picks (of 3)', picked, 3);
  log.checkEquals(
    'a pick reports select before close, every time',
    orders.filter((order) => order === 'open>select:copy>close').length,
    3
  );
  log.checkEquals('a fresh tap after each menu presses once (of 3)', fresh, 3);
  log.checkEquals(
    "the popup's top-start is the finger, within 1 dp (of 3)",
    anchors.filter(
      (a) => Math.abs(a.dx) <= density && Math.abs(a.dy) <= density
    ).length,
    3
  );

  // 3. A drag that starts on the ContextMenu scrolls the page and opens nothing.
  let scrolled = 0;
  let openedByDrag = 0;
  for (let i = 0; i < 3; i += 1) {
    const from = pointIn(
      t.nodeByTestId('ctx-target')?.bounds ?? target,
      0.5,
      0.5
    );
    const before = contextEcho(t);
    await t.swipePx(from.x, from.y, from.x, from.y - 500, 250);
    await sleep(900);
    const after = contextEcho(t);
    if (after.scrollY !== before.scrollY) scrolled += 1;
    openedByDrag += after.opens - before.opens;
    if (contextPopup(t) != null) {
      openedByDrag += 1;
      await contextClose(t);
    }
    await contextTop(t);
  }
  log.checkEquals(
    'a drag starting on the ContextMenu scrolls the page (of 3)',
    scrolled,
    3
  );
  log.checkEquals('and opens no menu', openedByDrag, 0);

  // 4. Hold, then drag in the same gesture: the menu is up and the page stays still.
  //    Back closes it.
  {
    const from = pointIn(
      t.nodeByTestId('ctx-target')?.bounds ?? target,
      0.4,
      0.5
    );
    const before = contextEcho(t);
    await t.holdThenDrag(from.x, from.y, -400);
    const popup = await contextPopupWithin(t, 2000);
    log.check('a hold then a drag opens the menu', popup != null);
    await t.pressBack();
    t.waitForPopupCount(0, 'Back to close the menu');
    const after = await contextEchoWhen(
      t,
      (e) => e.closes === before.closes + 1
    );
    log.checkEquals(
      'and the page under it did not move (scrollY)',
      after.scrollY,
      before.scrollY
    );
    log.checkEquals(
      'Back closes it, reported once',
      after.closes - before.closes,
      1
    );
  }

  // 5. A horizontal ScrollView inside pans and opens nothing.
  {
    const strip = t.nodeByTestId('ctx-hscroll')?.bounds;
    if (strip == null) log.abort('no ctx-hscroll on the ContextMenu screen');
    const from = pointIn(strip, 0.8, 0.5);
    const to = pointIn(strip, 0.2, 0.5);
    const before = contextEcho(t);
    await t.swipePx(from.x, from.y, to.x, to.y, 300);
    await sleep(800);
    const after = contextEcho(t);
    log.check('the inner horizontal ScrollView pans', after.hX !== before.hX);
    log.checkEquals('and opens no menu', after.opens - before.opens, 0);
    await t.swipePx(to.x, to.y, from.x, from.y, 300);
    await sleep(600);
  }

  // 6. An outside tap closes the menu and presses nothing below it.
  {
    const below = t.nodeByTestId('ctx-below')?.bounds;
    if (below == null) log.abort('no ctx-below on the ContextMenu screen');
    const belowAt = pointIn(below, 0.85, 0.5);
    const before = contextEcho(t);
    await t.holdAt(at.x, at.y, 1000);
    const popup = await contextPopupWithin(t);
    log.check('the hold before the outside tap opens the menu', popup != null);
    await t.tapPx(belowAt.x, belowAt.y);
    t.waitForPopupCount(0, 'the outside tap to close the menu');
    const after = await contextEchoWhen(
      t,
      (e) => e.closes === before.closes + 1
    );
    await sleep(400);
    log.checkEquals(
      'an outside tap closes the menu',
      after.closes - before.closes,
      1
    );
    log.checkEquals(
      'and the press under it never lands',
      contextEcho(t).below - before.below,
      0
    );
  }

  // 7. Nested: the innermost ContextMenu opens, the outer does not.
  {
    const before = contextEcho(t);
    const inner = await contextReveal(t, 'ctx-inner');
    const innerAt = pointIn(inner, 0.5, 0.5);
    await t.holdAt(innerAt.x, innerAt.y, 1000);
    const popup = await contextPopupWithin(t);
    log.check(
      `a hold on the inner ContextMenu opens the inner menu (rows ${popup == null ? '-' : popup.rows.join('/')})`,
      popup != null &&
        popup.rows.includes('Inner action') &&
        !popup.rows.includes('Outer action')
    );
    await contextClose(t);
    const after = await contextEchoWhen(t, (e) => e.inner === before.inner + 1);
    log.checkEquals(
      'the inner reports the open',
      after.inner - before.inner,
      1
    );
    log.checkEquals('the outer does not', after.outer - before.outer, 0);
  }

  // 8. Disabled: no menu, and the hold is the child's (a Pressable with no onLongPress
  //    presses on release).
  {
    const before = contextEcho(t);
    const child = await contextReveal(t, 'ctx-disabled-target');
    const childAt = pointIn(child, 0.5, 0.5);
    await t.holdAt(childAt.x, childAt.y, 1000);
    const popup = await contextPopupWithin(t, 1500);
    await contextClose(t);
    const after = await contextEchoWhen(
      t,
      (e) => e.dPress === before.dPress + 1
    );
    log.check('a disabled ContextMenu opens nothing on a hold', popup == null);
    log.checkEquals('and reports no open', after.dOpens - before.dOpens, 0);
    log.checkEquals(
      'the child keeps the gesture: one press on release',
      after.dPress - before.dPress,
      1
    );
  }

  // 9. An accessible ContextMenu is one node with the label, long-clickable: what
  //    TalkBack offers its double-tap-and-hold on. (The a11y sweep grades its name.)
  {
    await contextReveal(t, 'ctx-accessible');
    const named = t
      .dump()
      .filter((node) => node.contentDesc === 'Message from Grace');
    log.checkEquals('one node carries "Message from Grace"', named.length, 1);
    log.checkEquals(
      'and it is long-clickable',
      named[0]?.longClickable,
      'true'
    );
    log.checkEquals('and focusable', named[0]?.focusable, 'true');
    // And one that is not `accessible`, around Text only, is a `View` to TalkBack: a
    // long-clickable node is an actionable stop, which would read its Text as one stop
    // the app never asked for (D36 item 1 makes the element opt-in).
    const plain = t.nodeByTestId('ctx-bottom');
    log.checkEquals(
      'a ContextMenu that is not accessible offers TalkBack no long-click',
      plain?.longClickable,
      'false'
    );
    log.checkEquals('and is not focusable', plain?.focusable, 'false');
  }

  // 10. At the bottom edge the popup opens above the finger. Last, from the top of the
  //     page, because the bottom row sits outside the ScrollView.
  {
    await contextTop(t);
    const bottom = t.nodeByTestId('ctx-bottom')?.bounds;
    if (bottom == null) log.abort('no ctx-bottom on the ContextMenu screen');
    const low = pointIn(bottom, 0.3, 0.5);
    const before = contextEcho(t);
    await t.holdAt(low.x, low.y, 1000);
    const popup = await contextPopupWithin(t);
    log.note(
      `bottom edge: press=${String(low.x)},${String(low.y)} popup=` +
        (popup == null ? '-' : t.boundsText({ bounds: popup.bounds }))
    );
    log.check(
      'near the bottom edge the popup opens above the finger',
      popup != null && popup.bounds.y2 <= low.y
    );
    await contextClose(t);
    const after = await contextEchoWhen(
      t,
      (e) => e.bottom === before.bottom + 1
    );
    log.checkEquals(
      'and that ContextMenu reported the open',
      after.bottom - before.bottom,
      1
    );
  }
}

/**
 * `adb shell input text`'s argument form.
 *
 * The string is parsed twice - by the device's shell and by the `input` tool - so a
 * space travels as `%s`. Anything outside a safe set is refused rather than escaped
 * by guesswork: a check that typed the wrong string and asserted on it is worse than
 * one that says it cannot type that string. `input text` cannot type an emoji at
 * all, which is why the emoji half of `maxLength` is the harness's
 * (`TextField.harness.tsx`).
 *
 * @param {string} text
 * @returns {string}
 */
function encodeInputText(text) {
  let encoded = '';
  for (const char of text) {
    if (char === ' ') {
      encoded += '%s';
    } else if (/^[A-Za-z0-9._\-@:/]$/.test(char)) {
      encoded += char;
    } else {
      throw new Error(
        `real-input: cannot type "${char}" with \`input text\` (outside the set it ` +
          'accepts after being parsed twice)'
      );
    }
  }
  return encoded;
}

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
  // concerned, so the band a tap may aim at starts below it - measured, because the
  // bar's height is the tabs' touch target plus the status bar, not a constant.
  const bandTop = t.tabBarBottom() + 16;

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

  // Each cell below is re-tapped until the count moves. A second tap on a cell that
  // has just been chosen is the correct no-op the line above measures, so retrying a
  // dropped delivery costs nothing here; a count that arrives *late* would be
  // overtapped, which shows up as the check's own count assertion naming a number
  // past the one it wanted.
  await t.tapUntilValue(
    () => b,
    COUNT,
    '1',
    `a real tap on another day (day ${String(bDay)})`
  );
  const afterB = t.requireEcho(VALUE);
  t.log.check(
    `the tap moved the value it is echoing: "${afterB}" is not "${baseline}"`,
    afterB !== baseline
  );

  // The bug: back onto the day it came from. With the memory written only where a
  // write happened, this emitted nothing and the calendar snapped forward again.
  await t.tapUntilValue(
    () => a,
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
  await t.tapUntilValue(
    () => b,
    COUNT,
    '3',
    'a pick after the returned one to be fresh'
  );
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
  // The dialog's own confirm button is the witness that the dialog is up. The month
  // grid cannot be: the date-picker page has an inline calendar in its own dump, so
  // "some day cells on screen" is true before the field is ever pressed - a witness
  // that answers before the press is worse than none, and this run's first attempt
  // read it as a dialog that had opened.
  await t.tapUntilUp(
    () => t.requireControl(description),
    `a real tap on "${description}" to open its dialog`,
    () => t.dump().filter(isConfirmLabel).length,
    { pollMs: DUMP_POLL_MS }
  );
  const cells = dayGrid(t, description);
  const middle = Math.floor(cells.length / 2);
  const target =
    cells[Math.min(cells.length - 1, Math.max(0, middle + offset))];
  t.log.note(`tapping dialog day "${target.text}"`);
  // A day cell is a *selection*, and the dialog shows it: the headline above the
  // calendar names the chosen day, and while the dialog is up its window owns the
  // accessibility tree, so that headline is the only reading a day tap moves. Without
  // a witness, a tap dropped on the way to a cell is reported by the check's own count
  // assertion as a pick that changed nothing.
  //
  // Two cases have no witness and stay blind on purpose. A dialog in another locale
  // headlines its date in another shape, so there is nothing to read. And a cell that
  // *is* the headline's own day is the documented no-op this check's own caller probes
  // for - it moves nothing however many times it is pressed, so pressing it twice
  // would only buy a wait.
  const headline = dialogHeadline(t);
  const sameDay =
    headline != null &&
    headline.day === dayNumberAtEnd(target.text) &&
    headline.year === yearAtEnd(target.text);
  if (headline == null || sameDay) {
    t.log.note(
      headline == null
        ? 'no dialog headline to watch - the day tap stays blind'
        : `"${target.text}" is the day the dialog already shows - the tap is the ` +
            'documented no-op, and nothing moves to wait for'
    );
    await t.tapNode(target);
  } else {
    await t.pressUntil({
      what: `dialog day "${target.text}"`,
      waitingFor: 'a real tap on a dialog day to select it',
      attempts: 2,
      // The headline is Compose's own state, not a JS echo, so it repaints on the
      // dialog's next frame: one second is a generous window for a real selection.
      windowMs: 2000,
      pollMs: DUMP_POLL_MS,
      press: async () => {
        const cell = t
          .dump()
          .filter(isDayCell)
          .find((node) => node.text === target.text);
        if (cell == null) {
          // The dialog is not up any more: the earlier tap closed it, which a day
          // cell must not do. Nothing to press; let the wait below notice.
          return;
        }
        await t.tapNode(cell);
      },
      reading: () => {
        const now = dialogHeadline(t);
        return now == null ? null : `${now.day}/${String(now.year)}`;
      },
      raised: (current) =>
        current !== `${headline.day}/${String(headline.year)}`,
    });
  }
  // The dialog is a window of its own, so the app's text is unreadable until it
  // closes - which is what the confirm button, and nothing else, does. The button
  // going away with it is the witness that the OK tap arrived. (Not "no day cells
  // left": the date-picker page has an inline calendar of its own in the same dump
  // once the dialog goes down, and that reading never reaches zero there - the first
  // run of this helper measured exactly that, `left "10"` after a closed dialog.)
  await t.pressUntil({
    what: "the dialog's OK button",
    waitingFor: 'a real tap on OK to take the dialog down',
    attempts: 3,
    press: async () => {
      const label = t.dump().find(isConfirmLabel);
      if (label == null) {
        return;
      }
      await t.tapNode(label);
    },
    reading: () => String(t.dump().filter(isConfirmLabel).length),
    raised: (current) => current === '0',
    pollMs: DUMP_POLL_MS,
  });
  await t.settle(500);
  return target.text;
}

/**
 * The date an open date dialog's headline is showing, or `null` when none is.
 *
 * Material 3 names the chosen day above the calendar ("Oct 25, 2026"). The month
 * toggle ("October 2026") and the day cells ("Sunday, October 25, 2026") are excluded
 * by shape, so the reading is the headline's own. Only the day and year are returned:
 * the month arrives abbreviated here and spelled out in the cells, and a comparison
 * that read it would be a comparison with a locale.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
function dialogHeadline(t) {
  const found = t
    .dump()
    .find((node) => /^[A-Z][a-z]{2,8} \d{1,2}, \d{4}$/.test(node.text.trim()));
  if (found == null) {
    return null;
  }
  const match = found.text.trim().match(/^[A-Za-z]+ (\d{1,2}), (\d{4})$/);
  if (match == null) {
    return null;
  }
  return { day: Number(match[1]), year: Number(match[2]) };
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

/**
 * The dialog's Cancel affordance, labelled the way `android.R.string.cancel` labels it.
 *
 * The alternatives are what other Android builds say for the same button, so the check
 * does not hinge on one locale — the same reason `isConfirmLabel` lists four words.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 */
function isCancelLabel(node) {
  return /^(Cancel|Close|Dismiss|Back)$/.test(node.text.trim());
}

/**
 * The two inline calendars whose grid the box is supposed to decide, both measured.
 *
 * The rule is in `./android-calendar.mjs`, and the reason it lives outside the app is
 * there too: an `inline` picker is a `fillWidth` control, so `measureContent()` answers
 * the box's width whether or not the calendar fits inside it, and the weekday cells are
 * Compose nodes the in-app queries cannot reach. The dump is the only thing that can see
 * the columns, and this is the only gate that takes one on a known screen.
 *
 * Two fixtures, because the control now makes a decision rather than applying one size:
 * a 320 dp box, the width the README story uses, which is too narrow for Material's 48 dp
 * grid and must have come out at the 40 dp day cell; and a calendar stretched past 360 dp
 * by the page's own edges, which has to still be laying itself out at 48 dp. A calendar
 * that asked for 40 dp everywhere - which is what this fix first did - is caught by the
 * wide row, and one that never asks at all is caught by the narrow one.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
async function checkInlineCalendarGrids(t) {
  const density = t.density();

  /** The two rows `DatePickerScreen` draws for this, and what each box should produce. */
  const wanted = [
    { label: 'Wide inline calendar', wide: true, grid: null, box: null },
    { label: 'Narrow inline calendar', wide: false, grid: null, box: null },
  ];
  let namedWithNoBox = 0;

  // The search is for a *measurable* grid, not merely for a control's name. Two reasons,
  // both measured on this page: these rows are only reachable by scrolling, and a
  // calendar whose name is in the dump can still have no columns in it - Compose keeps
  // naming a scrolled-past node and reports it with `bounds=[0,0][0,0]`, and the header
  // row itself is ~470 px below the top of a calendar whose box is 1344 px tall, so a box
  // clipped to the bottom of the screen is a box with no header in it. Stopping at "the
  // name has a box" is what made this abort on a run where the calendar was partly on
  // screen and perfectly measurable two swipes later.
  //
  // One dump per throw, and the page is scrolled down: the wide row sits directly above
  // the narrow one, so one downward pass can collect both and down stays monotonic. 600
  // px a throw, twelve throws - more than the distance from the top of this page to the
  // foot of the narrow row.
  for (
    let attempt = 0;
    attempt < 12 && wanted.some((want) => want.grid == null);
    attempt += 1
  ) {
    const tree = t.dump();
    for (const want of wanted) {
      if (want.grid != null) {
        continue;
      }
      const node = tree.find(
        (candidate) => candidate.contentDesc === want.label
      );
      if (node == null) {
        continue;
      }
      if (node.bounds.width <= 0 || node.bounds.height <= 0) {
        namedWithNoBox += 1;
        continue;
      }
      const grid = measureCalendarGrid(tree, node.bounds, density);
      if (grid != null) {
        want.grid = grid;
        want.box = node.bounds;
      }
    }
    if (wanted.some((want) => want.grid == null)) {
      await t.scrollPage(600);
    }
  }

  if (namedWithNoBox > 0) {
    t.log.note(
      `an inline calendar was named with a zero-sized box ${String(namedWithNoBox)} ` +
        'time before its columns came on screen'
    );
  }

  for (const want of wanted) {
    if (want.grid == null) {
      t.log.abort(
        `"${want.label}" never showed a weekday header row, scrolling to the end of ` +
          'the page - the calendar is either not laid out at all or is drawn without one'
      );
    }
    const widthDp = (want.box.x2 - want.box.x1) / density;
    const expectedDp = expectedColumnDp(widthDp);
    // The premise of each row, asserted rather than assumed: a fixture that quietly
    // stopped being wide (or narrow) would still be *measurable*, and the rule below
    // would then measure it against the other row's floor and agree with whatever the
    // control did. `wideBox`'s negative margins are what make one row wide at all.
    t.log.check(
      `"${want.label}" is laid out in a ${widthDp.toFixed(0)} dp box, ` +
        `${want.wide ? 'at' : 'under'} the ${String(CALENDAR_WIDE_MIN_DP)} dp ` +
        'width that decides the touch target',
      want.wide
        ? widthDp >= CALENDAR_WIDE_MIN_DP
        : widthDp < CALENDAR_WIDE_MIN_DP
    );
    const problems = calendarGridProblems(want.grid, {
      minColumnDp: expectedDp,
    });
    t.log.check(
      `the ${widthDp.toFixed(0)} dp inline calendar lays a whole week out on ` +
        `${String(expectedDp)} dp targets: ${want.grid.detail} ` +
        `(narrowest ${want.grid.minWidthDp.toFixed(1)} dp)` +
        `${problems.length === 0 ? '' : ` - ${problems.join('; ')}`}`,
      problems.length === 0
    );
  }
}

/**
 * Wait for a dialog's month grid to leave the accessibility tree.
 *
 * This is what "the dialog is closed" means on Android for this control: a `Dialog` is
 * not a `Pop-Up Window`, so `popupWindowCount()` stays 0 whether the dialog leaked or
 * not, and the app's own text is unreadable while it is up. The grid going away is the
 * reading that survives both.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} description what to name in the failure line
 */
async function waitForDialogGone(t, description) {
  const deadline = Date.now() + REACT_TIMEOUT;
  for (;;) {
    if (t.dump().filter(isDayCell).length === 0) {
      return;
    }
    if (Date.now() > deadline) {
      t.log.abort(`timed out waiting for ${description}`);
    }
    await t.settle(250);
  }
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

    // Before the controls, because every one of them gets to its screen through a tab:
    // a tab too small to tap is the first thing that would make a control's check
    // flaky, and it is cheapest to read while the app is fresh on its first screen.
    // Auxiliary, like the a11y sweep, so the control totals keep meaning "every control
    // answered a real touch", and on every run, filtered or not.
    reportTabTargets(
      suite.beginAuxiliary(
        'tab-targets',
        'every example tab is a 48 dp touch target (uiautomator)'
      ),
      await harness.measureTabs(),
      harness.tabs,
      1 / harness.density()
    );

    for (const control of toRun) {
      const log = suite.begin(control);
      await harness.goToScreen(control.screen);
      // `runCheck` moves on after an abort the log recorded, and fails the control for one
      // it did not (X20 item 1): swallowing every `AbortedCheck` here is how a bare throw
      // reported PASS on a check that never ran.
      await runCheck(log, () => CHECKS[control.id](makeContext(harness, log)));
    }

    // The a11y sweep, after the checks rather than among them: it needs no gestures and a
    // failure is about the tree rather than about a press, so sharing a control's log line
    // would misattribute it. `a11y-sweep.mjs` says why this gate is where the rule lives —
    // no in-app query can see a Compose control's name, and a dedicated gate is a gate
    // nobody runs.
    await runA11ySweep((id, title) => suite.beginAuxiliary(id, title), {
      goToScreen: (screen) => harness.goToScreen(screen),
      dump: () => harness.hierarchy(),
      scrollToTop: () => harness.scrollToTop(),
      scrollPage: async (pixels) => {
        const width = harness.displayWidth();
        const height = harness.displayHeight();
        // Aimed at the empty strip at the right edge, for the reason on `scrollPage`:
        // anywhere else the swipe can start on Material 3's own calendar scroller and
        // turn the month instead of moving the page.
        harness.swipe(
          width - 8,
          Math.round(height * 0.7),
          width - 8,
          Math.round(height * 0.7) - pixels,
          400
        );
        await sleep(500);
      },
    });
  } finally {
    harness.teardown();
    stopMetro();
  }

  return suite.finish();
}

/**
 * The tab-target rule's verdicts, one line per tab.
 *
 * @param {import('./support.mjs').CheckLog} check
 * @param {Map<string, import('./tab-targets.mjs').TabMeasurement>} measured
 * @param {{ id: string, label: string }[]} tabs
 * @param {number} pixel one device pixel in dp
 */
function reportTabTargets(check, measured, tabs, pixel) {
  for (const verdict of checkTabTargets({
    platform: 'android',
    tabs,
    measured,
    pixel,
  })) {
    check.check(verdict.line, verdict.ok);
  }
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
    // The tabs, in bar order, from the array the registry writes: the order is what
    // tells `revealTab` which way to scroll for a tab that is not on screen.
    this.tabs = exampleTabs(
      fs.readFileSync(path.join(repoRoot(), 'example/src/App.tsx'), 'utf8')
    );
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
   * The screen as the emulator shows it, with a `pixel(x, y)` over it.
   *
   * `exec-out screencap -p` rather than `shell screencap`: `shell` puts the pty in
   * text mode and rewrites every `0x0a` in a PNG into two bytes, and the decode
   * then fails somewhere that has nothing to do with the control being checked.
   *
   * The pixels are the *screen*, which is what a check that has to prove what is
   * painted wants - the accessibility tree says where a box is, never what colour
   * its corners were clipped to. `png-pixel.mjs` decodes it without a dependency,
   * and refuses a PNG whose header it cannot describe rather than guessing.
   *
   * @returns {{ width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number] }}
   */
  screencap() {
    const result = spawnSync(
      'adb',
      ['-s', this.serial, 'exec-out', 'screencap', '-p'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, env: process.env }
    );
    if (result.error != null) {
      throw new Error(
        `real-input: screencap could not run: ${String(result.error)}`
      );
    }
    if (result.status !== 0 || result.stdout == null) {
      throw new Error(
        `real-input: screencap exited ${String(result.status)}: ${String(result.stderr ?? '')}`
      );
    }
    const image = decodePng(Buffer.from(result.stdout));
    return {
      width: image.width,
      height: image.height,
      pixel: (x, y) => pixelAt(image, x, y),
    };
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
   * The device's density — how many pixels one React Native point (one dp) is.
   *
   * Read from the device rather than assumed, for the same reason `wm size` is: every
   * geometry assertion this suite makes is in pixels, and the ones that want to say
   * something about a *design* number ("40 dp", "320 dp") can only do it by converting.
   *
   * `wm density` answers a **dpi** — "Physical density: 420" on the lease's Pixel 9
   * profile — and one dp is 160 dpi, so this returns 2.625. The factor is also what
   * `PixelRatio.get()` answers inside the app, which is what makes a dp measured here
   * and a dp measured by a harness test the same number.
   *
   * An `Override density:` line wins when it is there: `wm density -d` and the
   * developer-option override both write one, and a device whose density is overridden
   * lays its controls out at the override.
   *
   * @returns {number}
   */
  density() {
    const out = this.shell('wm density');
    const override = out.stdout.match(/Override density:\s*(\d+(?:\.\d+)?)/);
    const physical = out.stdout.match(/Physical density:\s*(\d+(?:\.\d+)?)/);
    const dpi = Number(override?.[1] ?? physical?.[1]);
    if (!Number.isFinite(dpi) || dpi <= 0) {
      throw new Error(
        `real-input: \`adb shell wm density\` said nothing useful: ${out.stdout.trim()}`
      );
    }
    return dpi / 160;
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
   * The two halves of that sentence come from two places, which is the point. The **tab**
   * is looked up by id in {@link exampleTabs} — the label and order `example/src/App.tsx`
   * renders, read from the array the registry writes — so a tab the registry adds is
   * reachable without an edit here, and {@link DeviceHarness.revealTab} scrolls the
   * scrolling bar (X19) until that tab is wholly on screen before tapping it. The
   * **arrival echo** is `screenTab(screen).anchor`: a testID only this repo's checks
   * know, kept with every other echo in `screens.mjs` rather than in a map here, because
   * a control whose screen has no row there is a control whose screen this runner cannot
   * tell it has reached. G17's SearchField arrived after both maps existed and was sent
   * off to poll an echo called `undefined`; iOS never noticed, because it taps a tab by
   * its `testID`, which Android's accessibility tree does not carry.
   *
   * @param {import('./screens.mjs').ScreenId | 'dialog' | 'sheet' | 'tooltip'} screen
   */
  async goToScreen(screen) {
    const { anchor } = screenTab(screen);
    const tab = this.tabs.find((entry) => entry.id === screen);
    if (tab == null) {
      throw new Error(
        `real-input: no example tab "${screen}" in example/src/App.tsx's TABS, ` +
          'so the screen this check needs cannot be reached.'
      );
    }
    // Asked from wherever the last control left the scroll, an echo that is scrolled
    // out of sight is simply not in the tree, and this would go looking for a tab to
    // tap while standing on it. So ask from the top.
    await this.scrollToTop();
    if (findByTestId(this.hierarchy(), anchor) != null) {
      return;
    }
    const target = await this.revealTab(tab);
    if (target == null) {
      throw new Error(
        `real-input: the "${tab.label}" tab could not be scrolled wholly onto the ` +
          'screen, so the screen this check needs cannot be reached reliably.'
      );
    }
    this.tap(target);
    const deadline = Date.now() + REACT_TIMEOUT;
    for (;;) {
      if (findByTestId(this.hierarchy(), anchor) != null) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `real-input: tapping the "${tab.label}" tab did not bring up its screen.`
        );
      }
      await sleep(300);
    }
  }

  /**
   * Scroll the tab bar until one tab is wholly on screen, and answer with its target.
   *
   * The bar scrolls sideways (X19), and `uiautomator` leaves a node that is scrolled out
   * of sight out of the dump - and reports one that is half out at its *clipped* box.
   * So "wholly on screen" is the target's box clear of both window edges, which the
   * bar's own 4 dp end padding makes true of a tab scrolled fully into view. A tab not
   * in the dump at all is placed by bar order against the tabs that are.
   *
   * Swipes are half a window and slow, so the bar barely flings; a swipe that
   * overshoots is corrected by the next look, which is why this loops on the dump
   * rather than computing one distance.
   *
   * @param {{ id: string, label: string }} tab
   * @returns {Promise<import('./uiautomator.mjs').UiautomatorNode | null>} the tab's
   *   target, or null if 10 swipes did not bring it wholly on screen
   */
  async revealTab(tab) {
    const width = this.displayWidth();
    const order = this.tabs.findIndex((entry) => entry.id === tab.id);
    for (let attempt = 0; ; attempt += 1) {
      const nodes = this.hierarchy();
      const target = tabTarget(nodes, tab, this.tabBandY);
      if (target != null && target.bounds.x1 > 0 && target.bounds.x2 < width) {
        return target;
      }
      if (attempt === 10) return null;
      const visible = this.tabs
        .map((entry, index) => ({
          index,
          node: tabTarget(nodes, entry, this.tabBandY),
        }))
        .filter((entry) => entry.node != null);
      if (visible.length === 0) {
        throw new Error(
          'real-input: no tab of the example is in the accessibility tree, so ' +
            `the "${tab.label}" tab cannot be scrolled to.`
        );
      }
      // +1: the tab is to the right of the window, so the content moves left.
      const towards =
        target != null
          ? target.bounds.x2 >= width
            ? 1
            : -1
          : order > visible[visible.length - 1].index
            ? 1
            : -1;
      const y = visible[0].node.bounds.cy;
      const from = Math.round(width * (towards > 0 ? 0.75 : 0.25));
      this.swipe(from, y, from - towards * Math.round(width * 0.5), y, 600);
      await sleep(500);
    }
  }

  /**
   * The bottom of the tab bar, in pixels: the lowest tab target on screen. Falls back
   * to the band the tabs are looked for in, which is never above the bar.
   *
   * @returns {number}
   */
  tabBarBottom() {
    const nodes = this.hierarchy();
    const bottoms = this.tabs
      .map((tab) => tabTarget(nodes, tab, this.tabBandY))
      .filter((node) => node != null)
      .map((node) => node.bounds.y2);
    return bottoms.length > 0 ? Math.max(...bottoms) : this.tabBandY;
  }

  /**
   * Every tab, scrolled wholly on screen and measured: the boxes `checkTabTargets`
   * decides from, in dp, by tab id.
   *
   * @returns {Promise<Map<string, import('./tab-targets.mjs').TabMeasurement>>}
   */
  async measureTabs() {
    const density = this.density();
    /** @type {Map<string, import('./tab-targets.mjs').TabMeasurement>} */
    const measured = new Map();
    for (const tab of this.tabs) {
      const target = await this.revealTab(tab);
      const last = target ?? tabTarget(this.hierarchy(), tab, this.tabBandY);
      if (last == null) continue;
      measured.set(tab.id, {
        width: last.bounds.width / density,
        height: last.bounds.height / density,
        reached: target != null,
      });
    }
    return measured;
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
   * Whether the soft keyboard is on screen, as the input method service says.
   *
   * @returns {boolean}
   */
  imeShown() {
    return /mInputShown=true/.test(this.shell('dumpsys input_method'));
  }

  /**
   * Type real characters through `adb shell input text`: key events injected into the
   * focused window, the same InputManager path `input tap` uses. No target argument,
   * so the field must already have focus. See {@link encodeInputText} for what it can
   * and cannot type.
   *
   * @param {string} text
   */
  typeText(text) {
    this.shell(`input text ${encodeInputText(text)}`);
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

  /**
   * One raw touch event: `input motionevent DOWN|MOVE|UP x y`. A gesture that has to
   * change shape mid-way - a hold that becomes a drag - is three of these in one stream.
   *
   * @param {'DOWN'|'MOVE'|'UP'} action
   * @param {number} x
   * @param {number} y
   */
  motion(action, x, y) {
    this.shell(
      `input motionevent ${action} ${String(Math.round(x))} ${String(Math.round(y))}`
    );
  }

  /**
   * Bring the current screen back to the top of its scroll.
   *
   * A React Native ScrollView keeps its offset when the app leaves the tab and comes
   * back to it, and a node scrolled far enough out of one is not in the accessibility
   * tree at all. "That node is not in the tree" therefore cannot mean "we are not on
   * that screen" - which is exactly the question [goToScreen] asks, and the reason one
   * run spent its whole timeout tapping a tab it was already standing on. The same
   * thing is how another run measured a Progress bar 0 px wide: a node outside the
   * visible area answers with nothing to measure.
   *
   * Navigation is the one place a known offset is worth paying for, so each control
   * starts at the top of its screen. The swipe is aimed at the empty strip at the right
   * edge for the reason given on `scrollPage`, and the loop stops when the content
   * stops moving, so a screen already at its top costs one swipe.
   */
  async scrollToTop(maxSwipes = 8) {
    const width = this.displayWidth();
    const height = this.displayHeight();
    const x = width - 8;
    const from = Math.round(height * 0.25);
    const to = from + Math.round(height * 0.5);
    const signature = () =>
      this.hierarchy()
        .filter((node) => node.bounds.y1 > this.tabBandY + 8)
        .slice(0, 4)
        .map((node) => `${String(node.bounds.x1)},${String(node.bounds.y1)}`)
        .join(';');
    let previous = signature();
    for (let attempt = 0; attempt < maxSwipes; attempt += 1) {
      this.swipe(x, from, x, to, 400);
      await sleep(400);
      const now = signature();
      if (now === previous) {
        return;
      }
      previous = now;
    }
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

  /**
   * Inject a drag across a node, between two fractions of its own width.
   *
   * Input only, and deliberately dumb: this is what a finger is. Reading the answer
   * is [dragAndSettle], which is where the Android drag flake lived.
   *
   * @param {import('./uiautomator.mjs').UiautomatorNode} node
   * @param {number} from
   * @param {number} to
   * @param {number} durationMs
   * @param {number | null} [stepMs] space the samples this far apart instead of
   *   letting `input swipe` pace them - a drag the machine has stretched out
   */
  /**
   * One raw touch event, injected without waiting for the tool to come back.
   *
   * Only the stretched-out drag needs this. `adb shell input` blocks the runner
   * until it has injected the whole gesture, and a check that cannot run while the
   * runner is blocked cannot ask a question about a gesture that is still going -
   * which is precisely the blind spot that made a slow drag indistinguishable from
   * a finished one. Everything else in this suite shells out synchronously on
   * purpose; a gesture in flight is the one place where waiting for the tool means
   * the thing being measured never happens.
   *
   * @param {'DOWN' | 'MOVE' | 'UP'} action
   * @param {number} x
   * @param {number} y
   * @returns {Promise<void>}
   */
  const motionAsync = (action, x, y) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        'adb',
        [
          '-s',
          harness.serial,
          'shell',
          'input',
          'motionevent',
          action,
          String(Math.round(x)),
          String(Math.round(y)),
        ],
        { stdio: 'ignore', env: process.env }
      );
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(`input motionevent ${action} exited ${String(code)}`)
            )
      );
    });

  /**
   * Inject a drag across a node, between two fractions of its own width.
   *
   * Input only, and deliberately dumb: this is what a finger is. Reading the answer
   * is [dragAndSettle], which is where the Android drag flake lived.
   *
   * Left un-awaited by its caller when `stepMs` is given, so the gesture is still
   * being injected while that caller waits: DOWN, six MOVEs `stepMs` apart in one
   * pointer stream, then UP there (`input motionevent`, as in [holdThenDrag]). That
   * is what a loaded machine does to an 800 ms swipe by itself - `adb shell input`
   * sleeps between its steps, and under load every sleep runs longer than it asked
   * for - so this is the flake reproduced on demand instead of one hoped for. The
   * spacing is what makes the reproduction bite: wider than the 1200 ms the old
   * value-settle needed to be convinced, and a gesture that sparse always looked
   * finished to it halfway along.
   *
   * @param {import('./uiautomator.mjs').UiautomatorNode} node
   * @param {number} from
   * @param {number} to
   * @param {number} durationMs
   * @param {number | null} [stepMs] stretch the gesture out, this far between samples
   * @returns {Promise<void>} resolves when the whole gesture has been injected
   */
  const drag = async (node, from, to, durationMs, stepMs = null) => {
    const x1 = node.bounds.x1 + node.bounds.width * from;
    const x2 = node.bounds.x1 + node.bounds.width * to;
    const y = node.bounds.cy;
    if (stepMs == null) {
      harness.swipe(x1, y, x2, y, durationMs);
      // Not a settle: this only lets the injection's last events reach the app
      // before the next read dumps the tree on top of them. Whether the gesture
      // ended is answered by the control, not by this pause.
      await sleep(400);
      return;
    }
    await motionAsync('DOWN', x1, y);
    for (let step = 1; step <= 6; step += 1) {
      await sleep(stepMs);
      await motionAsync('MOVE', x1 + ((x2 - x1) * step) / 6, y);
    }
    await sleep(stepMs);
    await motionAsync('UP', x2, y);
    await sleep(400);
  };

  /** How long [drag] takes when it stretches a gesture out, in ms. */
  const stretchedInjectionMs = (stepMs) => stepMs * 7 + 5000;

  /**
   * Wait for a control to report that the gesture it is in has ended.
   *
   * "Is the drag over?" has exactly one honest answer available from out here: the
   * control said `onSlidingComplete` and the app drew it. A stopwatch on the value
   * cannot give that answer — see [dragAndSettle] for what pretending otherwise cost.
   *
   * Both phases have to advance, and in that order: a `complete` with no `start` is
   * the *previous* gesture still on its way to the screen, and settling on that is
   * how a check reads a value the current touch never produced.
   *
   * Deliberately not [until]: a gesture whose end never came is the case the caller
   * has a plan for, and aborting here would take the rest of the control's checks
   * down with it.
   *
   * @param {string} testID a `start=N complete=M` echo ([gestureCounts])
   * @param {{ starts: number | null, completes: number | null }} seen the same echo
   *   read *before* the gesture was injected
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>} whether this gesture reported both of its phases
   */
  const waitForGestureEnd = async (testID, seen, timeoutMs = REACT_TIMEOUT) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (gestureReported(seen, gestureCounts(echo(testID)))) {
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      // Asynchronous, unlike the other waits in this file: a stretched-out gesture
      // is injected by a coroutine of this same process, and [blockMs] parks the
      // event loop - the gesture would stop mid-way and the answer would be a
      // question about the runner rather than about the control.
      await sleep(GESTURE_POLL_MS);
    }
  };

  /**
   * Read a numeric echo until it holds still, and return what it settled on.
   *
   * A drag is a stream of `onValueChange` events and React renders each one, so the
   * first echo that differs from the previous value is a reading taken *inside* the
   * gesture rather than the result of it. Measured on `nitroui_t03`: a real drag
   * that ended at `0.13` first read `0.83`, and a check that believed the first
   * change saw a Slider that had barely moved. The fix is the wait, not the
   * assertion - the value has to stop moving before anything is read off it.
   *
   * "Holds still" is `quietMs` of reads that agree, which cannot settle early on a
   * control that never answered: it returns the unchanged value, and whatever is
   * being asserted about the move goes red on it.
   *
   * What it cannot say is that a *gesture* has ended, and E5 is the run that lost
   * a control to the difference: a drag that is merely slow has the value hold
   * still for as long as a finished one, so this must be asked after the control
   * has reported its end ([waitForGestureEnd]), not instead of it.
   *
   * @param {string} testID
   * @param {string} description what is being waited for
   * @param {number} [quietMs] how long the value must hold still
   */
  const waitForValueToSettle = (testID, description, quietMs = 1200) => {
    const deadline = Date.now() + REACT_TIMEOUT;
    /** @type {number | null} */
    let last = value(testID);
    let quietSince = Date.now();
    for (;;) {
      blockMs(300);
      const shown = value(testID);
      if (shown !== last) {
        last = shown;
        quietSince = Date.now();
      } else if (shown != null && Date.now() - quietSince >= quietMs) {
        return shown;
      }
      if (Date.now() > deadline) {
        log.abort(
          `timed out after ${String(REACT_TIMEOUT)}ms waiting for ` +
            `${description} - ${testID}="${String(last)}" was still moving`
        );
      }
    }
  };

  /**
   * Drag a control and return the value it lands on, where "lands on" means *after*
   * the app has reported the end of that gesture.
   *
   * This is the fix for the one real-input check that has failed alone across
   * branches, and the cause was the wait rather than the threshold:
   *
   * - `adb shell input swipe` returns once it has *injected* the gesture, which is
   *   not when the app has finished with it. On a loaded machine the touch sits in a
   *   queue behind everything else the app is doing, and the frames that would draw
   *   the next value are the last thing to get scheduled.
   * - `host-slider` answered "is the drag over?" with "has the number stopped
   *   moving for 1200 ms", and a drag that is merely slow answers that exactly like
   *   a finished one. The `E4` run reported a thumb at `0.43` of a drag aimed at
   *   `0.9`, still long enough for the stopwatch to believe it, and every other drag
   *   in that same run passed — which is what made it look like a loose threshold
   *   instead of a wrong wait.
   * - The old loop was also self-inflicted: every read is a `uiautomator dump`, and
   *   a dump walks the control tree on the *app's* UI thread, so polling three times
   *   a second through a gesture is part of what stops the gesture being drawn
   *   ([GESTURE_POLL_MS]).
   *
   * The drag now ends when the *control* says it has, and only then is the value
   * read. That is the shape `slider:` has always had — it waits on `complete=1` — and
   * the reason that check never flaked while this one did. The value is still
   * settled afterwards, because React rendering the last sample is its own race;
   * what changed is that a settle can no longer be answered by a gesture that is
   * merely in flight.
   *
   * A drag whose end never arrived is injected once more, reported the way a retried
   * press is ([CheckLog.retried], counted by [Suite.finish]) so "21/22 passed" cannot
   * quietly mean "and half of those needed two touches". The retry is not the fix;
   * it is what stops a single truncated injection costing a run now that the reason
   * it was truncated is no longer mistaken for the answer.
   *
   * @param {import('./uiautomator.mjs').UiautomatorNode} node
   * @param {number} from
   * @param {number} to
   * @param {number} durationMs
   * @param {object} options
   * @param {string} options.gesture the control's `start=N complete=M` echo
   * @param {string} options.value the numeric echo to return
   * @param {string} options.description what is being waited for
   * @param {number} [options.stepMs] inject the drag stretched out, with `stepMs` of
   *   stillness between its samples (see [drag])
   * @returns {Promise<number | null>}
   */
  const dragAndSettle = async (node, from, to, durationMs, options) => {
    const { gesture, value: valueTestID, description, stepMs = null } = options;
    if (echo(gesture) == null) {
      // Loud on purpose: a control with no phase echo cannot have a drag of it told
      // apart from one that never ended, and guessing from a timer is precisely the
      // behaviour this function exists to remove.
      log.abort(
        `${description}: ${gesture} is not drawn on this screen, so a drag of ` +
          'it cannot be told from one that never ended'
      );
    }
    for (let attempt = 1; ; attempt += 1) {
      const seen = gestureCounts(echo(gesture));
      // Started, not awaited. A stretched-out gesture is still being injected while
      // the wait below runs, and that is the point: the question has to be asked of
      // a control that is mid-gesture, which is the only state in which the two
      // answers - "the value is quiet" and "the finger has left" - differ.
      let injectionFailure = null;
      const injecting = drag(node, from, to, durationMs, stepMs).catch(
        (error) => {
          injectionFailure = error;
        }
      );
      const ended = await waitForGestureEnd(
        gesture,
        seen,
        stepMs == null
          ? REACT_TIMEOUT
          : REACT_TIMEOUT + stretchedInjectionMs(stepMs)
      );
      // Never leave touch events in flight past this drag - the next control's
      // gesture would inherit them.
      await injecting;
      if (injectionFailure != null) {
        log.abort(
          `${description}: the drag could not be injected - ${String(
            injectionFailure
          )}`
        );
      }
      if (ended) {
        return waitForValueToSettle(valueTestID, description);
      }
      const shown = echo(gesture);
      if (attempt >= DRAG_ATTEMPTS) {
        log.abort(
          `${description}: ${String(DRAG_ATTEMPTS)} drags and ${gesture} still ` +
            `reads "${String(shown)}" - the control never reported the end of a ` +
            'gesture, so any value read here would be a sample taken mid-drag'
        );
      }
      log.retried(
        `${description}: reported no finished gesture ` +
          `(${gesture}="${String(shown)}"), dragged it again`
      );
    }
  };

  return {
    log,

    /** The bottom of the example's tab bar, in pixels ([DeviceHarness.tabBarBottom]). */
    tabBarBottom: () => harness.tabBarBottom(),

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
      if (node.bounds.width === 0 || node.bounds.height === 0) {
        log.abort(
          `accessibilityLabel "${description}" is named in the tree with no box - ` +
            'it is composed outside the scroll clip, so no real tap can be aimed ' +
            'at it. Scroll it into view first (`requireControlOnScreen`).'
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
     * The device's density: how many pixels one dp is.
     *
     * A check that wants to say "40 dp" about a dump's pixels needs this, and needs it
     * from the device rather than from a comment: the widths the calendar rules were
     * measured at belong to the lease's Pixel 9 profile at 2.625, and a device at
     * another density gets the same rules in its own pixels.
     *
     * @returns {number}
     */
    density() {
      return harness.density();
    },

    /**
     * A screenshot of the screen, for the few checks that can only be answered by
     * what is painted. See `DeviceHarness.screencap`.
     */
    screencap() {
      return harness.screencap();
    },

    /**
     * Scroll the screen until this control is on it, then look it up.
     *
     * Evidence that lives at the bottom of a screen has to be scrolled to, exactly
     * as a person scrolls to it, and this says so instead of failing with "not in
     * the tree". "On the screen" is answered by the **box**, not by the name:
     * React Native drops a view that has been scrolled out of the window, so an RN
     * control is simply absent until it comes back, but a `<Host>` is one Compose
     * tree and Compose keeps naming children it has composed even when the scroll
     * has them outside its clip - measured on `nitroui_t03`, a hosted Picker below
     * the fold is in the dump with `bounds=[0,0][0,0]`. A check that stops at the
     * name taps the top-left corner of the window and then reports that a real
     * touch opens nothing, which is a story about the check, not about the control.
     *
     * The box has to be a *pressable* one, not merely a drawn one. Compose clips a
     * Host row to whatever the scroll leaves of it, so a row sitting on the fold is
     * named with a box a pixel tall: `hosted-date-picker` measured
     * `42,2423 → 386,2424` on a 1080x2424 window, the tap landed on the middle of
     * that sliver, and the field never opened - which reads as "a real press does
     * not open a hosted dialog", the exact opposite of what this case exists to
     * find. So the centre has to be inside the window and the box tall enough to
     * hold a finger, and a row that never comes round is said out loud rather than
     * handed back as if it were tappable.
     *
     * @param {string} description the control's `accessibilityLabel`
     */
    async requireControlOnScreen(description) {
      let namedOffScreen = 0;
      let clipped = 0;
      /** @type {import('./uiautomator.mjs').UiautomatorNode | null} */
      let lastClipped = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const node = findByDescription(harness.hierarchy(), description);
        const { width, height } = harness.screenSize();
        if (node != null && node.bounds.width > 0 && node.bounds.height > 0) {
          const centreX = (node.bounds.x1 + node.bounds.x2) / 2;
          const centreY = (node.bounds.y1 + node.bounds.y2) / 2;
          const pressable =
            node.bounds.height >= MIN_PRESSABLE_PX &&
            centreX > 0 &&
            centreX < width &&
            centreY > 0 &&
            centreY < height;
          if (pressable) {
            if (attempt > 0) {
              log.note(
                `"${description}" needed ${String(attempt)} scroll` +
                  `${attempt === 1 ? '' : 's'} to come on screen` +
                  (namedOffScreen > 0
                    ? ` - after ${String(namedOffScreen)} naming` +
                      `${namedOffScreen === 1 ? '' : 's'} with no box (composed ` +
                      'outside the clip)'
                    : '') +
                  (clipped > 0
                    ? `, and ${String(clipped)} with a box clipped to ` +
                      `${String(MIN_PRESSABLE_PX)} px or less`
                    : '')
              );
            }
            log.note(
              `"${description}" occupies ${node.bounds.x1},${node.bounds.y1} → ` +
                `${node.bounds.x2},${node.bounds.y2}`
            );
            return node;
          }
          clipped += 1;
          lastClipped = node;
        } else if (node != null) {
          namedOffScreen += 1;
        }
        harness.swipe(width / 2, height * 0.7, width / 2, height * 0.32, 400);
        await sleep(400);
      }
      if (lastClipped != null) {
        log.abort(
          `"${description}" is named with a box ${String(
            lastClipped.bounds.height
          )} px tall on the window edge (${String(clipped)} scrolls, still ` +
            'clipped) - the row never came far enough on screen to press'
        );
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
     * Press, then wait for the witness that the press *arrived*, and retry the press
     * until the witness shows or the attempts run out.
     *
     * `adb shell input` injects into the system InputManager, and a synthesised
     * injection can be dropped - the same fault iOS has (`FOLLOWUPS.md:58`; the
     * H2b review records `testRealInputSwitch` on Android missing "one real tap",
     * the same class), and the same fault with the same consequence: a check that
     * taps and then waits for the answer reports a lost delivery as a control that
     * refuses a finger. `picker` already retries the aim of each day cell for
     * exactly that reason; this is the preconditions of every other check.
     *
     * The witness has to be something a touch causes, and the retry only happens
     * while it is still absent, so a retry cannot manufacture a result. What it can
     * do is overt tap an echo that arrives *late* rather than never, which shows up
     * as the note below quoting a reading past what was expected.
     *
     * @param {object} options
     * @param {string} options.what what is being pressed, for the log line
     * @param {string} options.waitingFor what this press was meant to do
     * @param {(attempt: number) => Promise<void>} options.press delivers the touch.
     *   Told which attempt it is, so a press that needs something on screen (a popup
     *   row) can re-find it, or give up pressing when it has gone.
     * @param {() => string | null} options.reading the witness right now; cheap and
     *   non-fatal, since a missing node mid-retry is still a reading.
     * @param {(shown: string | null) => boolean} options.raised whether it arrived
     * @param {() => string | null} [options.nativeState] what the *control itself*
     *   holds (`nativeChecked`), for the controls that publish their state. The
     *   witness is React's render, so its absence means either that the touch never
     *   arrived or that the control changed and lost the event on the way to JS, and
     *   an attempt's window expiring cannot tell those apart. Retrying is right for
     *   the first and wrong for the second: a third press would land the event, the
     *   echo would arrive, and a lost change would read as a dropped tap (F1 M3).
     *   When this moves while the witness has not, the helper stops and says so.
     * @param {number} [options.attempts]
     * @param {number} [options.windowMs] how long one press gets to show its
     *   witness. The default is `REACT_TIMEOUT`, the budget `waitForEcho` already
     *   gave the same control, so a check gets that wait *plus* the retries rather
     *   than three attempts sharing what used to be one wait.
     * @param {number} [options.pollMs] how often to take a reading. The default
     *   suits an echo, which is one cheap query. A reading that dumps the
     *   accessibility tree costs about two seconds each on its own, and polling
     *   one at 100 ms spends the entire wait on readings - which is how a retry
     *   helper came to lose a race against a timer inside the app it is watching.
     * @returns {Promise<{delivered: boolean, shown: string | null}>}
     */
    async pressUntil({
      what,
      waitingFor,
      press,
      reading,
      raised,
      nativeState,
      attempts = 3,
      windowMs = REACT_TIMEOUT,
      pollMs = 100,
    }) {
      /** @type {string | null} */
      let shown = null;
      const echoStart = reading();
      // Read once, before any press: "did it move" is what the comparison needs,
      // and a witness that costs two seconds must not be polled.
      const stateStart = nativeState == null ? null : nativeState();
      if (nativeState != null && stateStart == null) {
        // A witness that reads nothing can never report a change, so passing it
        // would be worse than passing nothing: every retry would be attributed to
        // a dropped touch, and a lost event would still go green. Say that the
        // guard is not armed rather than pretending it is.
        log.abort(
          `${waitingFor}: ${what} was given a native-state witness and it read ` +
            'nothing, so a delivered touch could not be told from a lost event. The ' +
            'control publishes no state to read, or the label names the wrong node.'
        );
      }
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await press(attempt);
        const deadline = Date.now() + windowMs;
        for (;;) {
          shown = reading();
          if (raised(shown)) {
            if (attempt > 1) {
              log.retried(
                `${waitingFor}: ${what} answered on tap ${String(attempt)}/${String(
                  attempts
                )} - the earlier tap(s) were never delivered`
              );
            }
            return { delivered: true, shown };
          }
          if (Date.now() > deadline) {
            break;
          }
          blockMs(pollMs);
        }
        // Not answered. Before pressing again, ask the control whether it moved.
        // Only when the echo has not moved at all: an echo that moved to the
        // wrong value proves JS heard something, and "the event never reached
        // JS" would be a false accusation about it.
        if (nativeState != null) {
          const moved = nativeState();
          if (
            moved != null &&
            stateStart != null &&
            moved !== stateStart &&
            shown === echoStart
          ) {
            // Not a retry: no press. "The event never reached JS" is only safe once
            // the echo has had a second window to arrive, because a JS thread that is
            // merely very slow - a cold bundle on a busy machine - looks exactly like
            // a lost event from here. A dropped event still fails, one window later.
            const graceDeadline = Date.now() + windowMs;
            for (;;) {
              shown = reading();
              if (raised(shown)) {
                log.note(
                  `${waitingFor}: ${what} answered ${String(windowMs)}ms after its ` +
                    'press, late enough that the control had already changed - a slow ' +
                    'JS thread, not a lost event'
                );
                return { delivered: true, shown };
              }
              if (Date.now() > graceDeadline) {
                break;
              }
              blockMs(pollMs);
            }
            log.abort(
              `${waitingFor}: ${what} took the touch and lost the event - the control's ` +
                `own state moved from "${stateStart}" to "${moved}" and its echo is ` +
                `still "${String(shown)}", the value it had before any press, ${String(
                  windowMs * 2
                )}ms later. Not retried: a further press would land the event and make a ` +
                'lost change look like a dropped tap.'
            );
          }
        }
        log.note(
          `${waitingFor}: tap ${String(attempt)}/${String(attempts)} on ${what} left ` +
            `"${String(shown)}" - tapping again`
        );
      }
      return { delivered: false, shown };
    },

    /**
     * See `nativeChecked` in `android-tree.mjs`, which is where this lives and
     * where the tests are: a witness whose failure mode is silence needs a fixture,
     * and this file cannot be imported without a device.
     *
     * @param {string} description the control's `accessibilityLabel`
     * @returns {string | null} `"on"` / `"off"`, or null when no node answers
     */
    nativeChecked(description) {
      return nativeChecked(harness.hierarchy(), description);
    },

    /**
     * See `nativeEnabled` in `android-tree.mjs`: the clickable node's `enabled`,
     * which is where Compose puts a disabled control's state.
     *
     * @param {string} description the control's `accessibilityLabel`
     * @returns {string | null} `"true"` / `"false"`, or null when nothing answers
     */
    nativeEnabled(description) {
      return nativeEnabled(harness.hierarchy(), description);
    },

    /**
     * Tap a control until the on-screen *value* it should change says so.
     *
     * The value, not merely a change: `waitForEchoToChange` is satisfied by any
     * movement of the echo, and a check that then asserts the new value is one
     * dropped tap away from reporting a control that refuses a finger. Each flip
     * this suite waits for is unreachable without a delivered touch, so waiting for
     * the value is the same wait, made safe to repeat.
     *
     * When no attempt landed, this aborts naming both readings and both possible
     * faults, because that is the distinction a blind tap could not make - and the
     * reason a retry is not simply a road to green.
     *
     * @param {() => Promise<import('./uiautomator.mjs').UiautomatorNode> | import('./uiautomator.mjs').UiautomatorNode} lookUp the control to press, re-read each attempt: a control that moved must be aimed at where it is now
     * @param {string} testID the echo whose value proves the press arrived
     * @param {string} expected what the echo has to say
     * @param {string} waitingFor what this tap was meant to do
     * @param {{aim?: (node: import('./uiautomator.mjs').UiautomatorNode) => Promise<void>, attempts?: number, nativeLabel?: string, atLeast?: boolean}} [options]
     *   `aim` - how to press it, for the taps that aim at a fraction of the control.
     *   `atLeast` - the echo is a counter and any count from `expected` up passes.
     *   For a barrier, whose claim is "a press still arrives": a tap that stalled
     *   past the window can land together with the retry, and the counter then
     *   skips `expected` (G12: 1 -> 3), which proves the claim twice rather than
     *   failing it. Not for a check that counts presses per tap.
     *   `nativeLabel` - the control's `accessibilityLabel` when it publishes its own
     *   state, which for a Switch it does: `pressUntil` then refuses to retry a press
     *   whose touch clearly landed (F1 M3). Pass it for every single-value control
     *   whose native state can be read, because without it a lost change event is
     *   exactly what a retry turns green.
     */
    async tapUntilValue(lookUp, testID, expected, waitingFor, options = {}) {
      // Fail loudly on a mis-shaped option rather than reading it as "no aim":
      // this helper's fifth argument changed from a positional `aim` to an
      // options object, and a callsite left behind would keep tapping the
      // middle of the control - which is a wrong-place tap, not a dropped one,
      // and it showed up as two segmented checks going red for the wrong reason.
      const known = ['aim', 'attempts', 'nativeLabel', 'atLeast'];
      const unknown = Object.keys(options).filter((k) => !known.includes(k));
      if (typeof options === 'function' || unknown.length > 0) {
        log.abort(
          `${waitingFor}: tapUntilValue was given ${
            typeof options === 'function'
              ? 'a positional aim function (it is now { aim })'
              : `unknown option(s) ${unknown.join(', ')} - the fifth argument is ` +
                '{ aim, attempts, nativeLabel, atLeast }'
          }. Refusing to tap: an ignored aim presses the middle of the control, ` +
            'which fails a segment check and blames delivery.'
        );
      }
      const { aim, attempts = 3, nativeLabel, atLeast = false } = options;
      const target = Number(expected);
      if (atLeast && !Number.isInteger(target)) {
        log.abort(
          `${waitingFor}: atLeast needs a counter, and "${expected}" is not one`
        );
      }
      const { delivered, shown } = await this.pressUntil({
        what: `"${testID}"`,
        waitingFor,
        attempts,
        press: async (attempt) => {
          const node = await lookUp();
          if (nativeLabel != null && attempt === 1) {
            // A label that does not name the pressed control would consult somebody
            // else's state, so the option is checked rather than trusted. Done on the
            // way in, because a witness must not cost an extra dump of its own.
            if (node.contentDesc !== nativeLabel) {
              log.abort(
                `${waitingFor}: nativeLabel "${nativeLabel}" does not name the control ` +
                  `being pressed ("${node.contentDesc}") - the native-state witness ` +
                  'would read the wrong control'
              );
            }
          }
          if (aim == null) {
            await this.tapNode(node);
          } else {
            await aim(node);
          }
        },
        reading: () => echo(testID),
        nativeState:
          nativeLabel == null
            ? undefined
            : () => this.nativeChecked(nativeLabel),
        raised: (current) =>
          atLeast
            ? current != null && Number(current) >= target
            : current === expected,
      });
      if (!delivered) {
        log.abort(
          `${waitingFor}: ${String(attempts)} real taps left ${testID} at "${String(
            shown
          )}" rather than ${atLeast ? 'at least ' : ''}"${expected}" - either the taps were never delivered ` +
            '(FOLLOWUPS.md:58) or the control ignores a real touch. One delivered ' +
            'tap was enough to pass, so this is not a control that answers sometimes.'
        );
      }
      return /** @type {string} */ (shown);
    },

    /**
     * Tap the field of a `compact` control until its dialog or popup is really up.
     *
     * A popup is the only witness while it is open (nothing else on that screen can
     * be read from the dump), so this is the same lesson with a different witness:
     * without it, `dayGrid`'s "timed out waiting for the dialog to open with a
     * month grid" is the first thing said about a tap that never arrived.
     *
     * @param {() => Promise<import('./uiautomator.mjs').UiautomatorNode>} lookUp
     * @param {string} waitingFor
     * @param {() => number} countUp what is up right now (popup windows, day cells)
     * @param {{attempts?: number, windowMs?: number, pollMs?: number}} [options]
     *   passed through to `pressUntil`. Pass them when `countUp` reads the
     *   accessibility tree: a dump costs about two seconds here, and polling one at
     *   the default 100 ms spends the whole window on readings.
     */
    async tapUntilUp(lookUp, waitingFor, countUp, options = {}) {
      const { delivered, shown } = await this.pressUntil({
        what: 'its window',
        waitingFor,
        ...options,
        press: async () => {
          await this.tapNode(await lookUp());
        },
        reading: () => String(countUp()),
        raised: (current) => current !== '0',
      });
      if (!delivered) {
        const attempts = String(options.attempts ?? 3);
        log.abort(
          `${waitingFor}: ${attempts} real taps opened nothing - either the taps ` +
            'were never delivered (FOLLOWUPS.md:58) or the control cannot present. ' +
            'The dump above is the screen a finger would have found.'
        );
      }
      return shown;
    },

    /**
     * Tap an open menu's row until the *value* it should report arrives.
     *
     * The row is re-found each attempt, which is exactly when it can still be found: a
     * pick that travelled closes the menu and moves the value, so the loop has already
     * returned, and a pick that never arrived leaves the menu open with that row still
     * in the tree. Keying on the value rather than on the popup count leaving zero is
     * what keeps a tap that opened nothing from reading as a choice: `waitForPopupCount
     * (0, …)` is satisfied by the *absence* of a window, so when the first tap never
     * landed, the row tap has nothing to press, the count is already 0, and the check
     * reports a dropped delivery as a Picker that cannot pick.
     *
     * A later attempt presses only while the row is still up. If it has gone, the
     * earlier tap travelled and the echo is merely slow, and pressing where the menu
     * was would aim at whatever the closed menu left behind - so that attempt waits out
     * its window instead.
     *
     * @param {string} option the menu row's label
     * @param {string} testID the echo the pick has to move
     * @param {string} expected what the echo has to say
     * @param {string} waitingFor what this tap was meant to do
     */
    async tapOptionUntilValue(
      option,
      testID,
      expected,
      waitingFor,
      attempts = 3
    ) {
      const { delivered, shown } = await this.pressUntil({
        what: `menu row "${option}"`,
        waitingFor,
        attempts,
        press: async (attempt) => {
          if (
            attempt > 1 &&
            findAllByText(harness.hierarchy(), option).length === 0
          ) {
            return;
          }
          await this.tapNode(
            this.waitForOption(option, 'the menu row to still be up')
          );
        },
        reading: () => echo(testID),
        raised: (current) => current === expected,
      });
      if (!delivered) {
        log.abort(
          `${waitingFor}: ${String(attempts)} real taps on "${option}" left ${testID} ` +
            `"${String(shown)}" rather than "${expected}" - either the taps were never ` +
            'delivered (FOLLOWUPS.md:58) or the row ignores a real touch.'
        );
      }
      return /** @type {string} */ (shown);
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
     * Type into the focused field, then give React a moment to render the echo.
     *
     * @param {string} text
     */
    async type(text) {
      harness.typeText(text);
      await sleep(300);
    },

    /**
     * Press a hardware key (`input keyevent`).
     *
     * @param {number} keyCode
     */
    key(keyCode) {
      harness.key(keyCode);
    },

    /**
     * Take the soft keyboard down if it is up, and leave focus where it is.
     *
     * Only when it is up: Back is offered to the IME first, but with no keyboard it is
     * the app's Back, which sends a React Native root to the background - and every
     * later check then finds the launcher.
     */
    async hideKeyboard() {
      if (harness.imeShown()) {
        harness.key(KEY_BACK);
        await sleep(500);
      }
    },

    /**
     * The text a Compose field holds, as its editable node publishes it.
     *
     * The node that carries a `TextField`'s `accessibilityLabel` is a child of the
     * `EditText` node, with the same box (`HybridNitroUiTextField.kt`), and only the
     * `EditText` carries the text - so this finds the label, then the editable node
     * whose box it shares.
     *
     * @param {string} description the field's `accessibilityLabel`
     * @returns {string}
     */
    fieldText(description) {
      const nodes = harness.hierarchy();
      const named = findByDescription(nodes, description);
      if (named == null) {
        log.abort(
          `no field with accessibilityLabel "${description}" on screen`
        );
      }
      const same = (a, b) =>
        a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
      const editable = nodes.find(
        (node) =>
          node.className === 'android.widget.EditText' &&
          same(node.bounds, named.bounds)
      );
      if (editable == null) {
        log.abort(`"${description}" has no editable node in its box`);
      }
      return editable.text;
    },

    /**
     * Tap the React Native view carrying `testID`, or abort naming it.
     *
     * @param {string} testID
     */
    async tapTestId(testID) {
      const node = findByTestId(harness.hierarchy(), testID);
      if (node == null) {
        log.abort(`no view with testID "${testID}" on screen to tap`);
      }
      harness.tap(node);
      await sleep(250);
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
     * Inject a drag across a control, between two fractions of its own width.
     *
     * Input only, and deliberately still dumb: this is what a finger is. Reading the
     * answer is [dragAndSettle], which is where the Android drag flake lived.
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
      // Not a settle: this only lets the injection's last events reach the app
      // before the next read dumps the tree on top of them. Whether the gesture
      // ended is answered by the control, not by this pause.
      await sleep(400);
    },

    waitForGestureEnd,

    dragAndSettle,

    waitForValueToSettle,

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
     * Wait for the app's popup windows to become `expected`, and say how long the
     * device took to get there.
     *
     * A popup comes down on the app's next frame and then on WindowManager's own
     * schedule, so reading the count in the moment after a touch races both. Measured
     * on the first run of the hosted-Picker check: the pick had reached JS - index 2
     * was echoed - while `dumpsys window` still listed the window that pick had
     * closed, and the check read a correct close as a leak.
     *
     * This waits for a number, not for a hope: a window the app never gives up still
     * ends this check, and says what it counted. The absence reads that follow no
     * touch stay immediate - nothing is in flight at those.
     *
     * @param {number} expected
     * @param {string} description what should have happened
     */
    waitForPopupCount(expected, description) {
      const startedAt = Date.now();
      let count = harness.popupWindowCount();
      while (count !== expected) {
        if (Date.now() - startedAt > REACT_TIMEOUT) {
          log.abort(
            `timed out after ${String(REACT_TIMEOUT)}ms waiting for ${description} - ` +
              `popup windows ${String(count)}, expected ${String(expected)}`
          );
        }
        blockMs(100);
        count = harness.popupWindowCount();
      }
      const waitedMs = Date.now() - startedAt;
      if (waitedMs > 250) {
        log.note(
          `popup windows reached ${String(expected)} after ${String(waitedMs)}ms`
        );
      }
      return count;
    },

    /**
     * Press Back.
     */
    async pressBack() {
      harness.key(KEY_BACK);
      await sleep(400);
    },

    /**
     * A still hold at one point, `durationMs` long: `input swipe` at zero distance, which
     * InputDispatcher delivers as a DOWN, a finger that does not move, and an UP.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} [durationMs]
     */
    async holdAt(x, y, durationMs = 1000) {
      harness.swipe(x, y, x, y, durationMs);
      await sleep(300);
    },

    /**
     * A hold that turns into a drag in the same gesture: DOWN, `holdMs` still, then five
     * MOVEs to `dyPx` and the UP there (`input motionevent`, one touch stream).
     *
     * @param {number} x
     * @param {number} y
     * @param {number} dyPx
     * @param {number} [holdMs]
     */
    async holdThenDrag(x, y, dyPx, holdMs = 900) {
      harness.motion('DOWN', x, y);
      await sleep(holdMs);
      for (let step = 1; step <= 5; step += 1) {
        harness.motion('MOVE', x, y + (dyPx * step) / 5);
      }
      harness.motion('UP', x, y + dyPx);
      await sleep(300);
    },

    /**
     * One swipe between two screen points, px.
     *
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @param {number} durationMs
     */
    async swipePx(x1, y1, x2, y2, durationMs) {
      harness.swipe(x1, y1, x2, y2, durationMs);
      await sleep(300);
    },

    /**
     * One tap at a screen point, px.
     *
     * @param {number} x
     * @param {number} y
     */
    async tapPx(x, y) {
      harness.tapAt(x, y);
      await sleep(250);
    },

    /** The display's width, px. */
    displayWidth() {
      return harness.displayWidth();
    },

    /** The display's height, px. */
    displayHeight() {
      return harness.displayHeight();
    },

    /**
     * Drag a finger vertically from the centre of a node - a sheet's content, its
     * header - by `dyPx` pixels (positive is down). One `adb shell input swipe`, so
     * the drag travels the same InputDispatcher path a finger does.
     *
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     * @param {number} dyPx
     * @param {number} [durationMs]
     */
    async swipeFrom(node, dyPx, durationMs = 300) {
      harness.swipe(
        node.bounds.cx,
        node.bounds.cy,
        node.bounds.cx,
        Math.max(
          0,
          Math.min(harness.displayHeight() - 1, node.bounds.cy + dyPx)
        ),
        durationMs
      );
      await sleep(600);
    },

    /**
     * Drag a finger horizontally across a node, between two fractions of the display's
     * width, at the node's own height.
     *
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     * @param {number} fromFx
     * @param {number} toFx
     * @param {number} [durationMs]
     */
    async swipeAcross(node, fromFx, toFx, durationMs = 400) {
      const width = harness.displayWidth();
      harness.swipe(
        Math.round(width * fromFx),
        node.bounds.cy,
        Math.round(width * toFx),
        node.bounds.cy,
        durationMs
      );
      await sleep(600);
    },

    /**
     * Tap a point given as fractions of the display - above a sheet, say, where its
     * scrim is.
     *
     * @param {number} fx
     * @param {number} fy
     */
    async tapAtFraction(fx, fy) {
      harness.tapAt(
        Math.round(harness.displayWidth() * fx),
        Math.round(harness.displayHeight() * fy)
      );
      await sleep(400);
    },

    /**
     * Press the empty part of the screen that an open popup's scrim covers.
     *
     * This is the other dismissal a person has. The trigger is *under* this control's
     * popup (measured in G7b: the list is drawn over its own button), so a second press
     * there lands on a row instead of on the button. The point chosen is a fifth of the
     * screen's height above the bottom edge, which on this suite's screens is below the
     * control under test and outside a list that hangs from a trigger near the top.
     *
     * Measured, not assumed, that it works: after a tap on a *disabled* row this tap
     * left the popup standing (30 Oct 00:35:09Z), and so did the Back press that
     * followed it on the run before (29 Oct 23:33:43Z). The Menu check therefore treats
     * it as one attempt out of several and logs which dismissal actually cleared the
     * window. A popup that survives both is a real finding, recorded in
     * `docs/tasks/FOLLOWUPS.md`, not something this helper papered over.
     */
    async tapScrim() {
      const height = harness.displayHeight();
      const width = harness.displayWidth();
      harness.tapAt(Math.round(width / 2), Math.round(height * 0.8));
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
     * The two halves of one split trigger, read out of a single dump.
     *
     * A trailing half's name is written in the library (`MENU_MORE_OPTIONS_LABEL`), and
     * the example's Menu screen mounts two split triggers, so that name is not a handle
     * for one control: it belongs to both, and a search by name alone answers with
     * whichever half composes higher on the page. That is how a check aimed at one
     * control ends up pressing the other, and why a full-suite run can fail where a
     * single-control run passed — the second split trigger is only in the tree once the
     * screen has been scrolled to it. The halves of ONE control share a vertical band,
     * so the band is what pairs them. Every node carrying the name is printed with its
     * box, because a half whose box is wrong is exactly what those numbers show.
     *
     * @param {string} actionLabel the leading half's `accessibilityLabel`
     * @param {string} listLabel the name the library gives every trailing half
     */
    splitTrigger(actionLabel, listLabel) {
      const nodes = harness.hierarchy();
      const box = (
        /** @type {import('./uiautomator.mjs').UiautomatorNode} */ node
      ) => {
        const { x1, y1, x2, y2 } = node.bounds;
        return `${String(x1)},${String(y1)} → ${String(x2)},${String(y2)}`;
      };
      const actions = findAllByDescription(nodes, actionLabel);
      const action = actions[0];
      if (action == null) {
        log.abort(
          `no node named "${actionLabel}" in the accessibility tree - the split ` +
            'trigger offers nothing a real tap could be aimed at'
        );
      }
      const named = findAllByDescription(nodes, listLabel);
      for (const node of named) {
        log.note(
          `"${listLabel}" at ${box(node)} while "${actionLabel}" is at ${box(action)}`
        );
      }
      return {
        actions,
        action,
        named,
        list: named.filter(
          (node) =>
            node.bounds.y1 === action.bounds.y1 &&
            node.bounds.y2 === action.bounds.y2 &&
            node.bounds.x2 > action.bounds.x1
        ),
      };
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
  // The shared launch config rather than a hand-typed line: this string is what a
  // person pastes when a lease names a device that is not up, so it has to be the
  // same command the harness and the pool run - same port, same GPU mode, same
  // snapshot flags. The hand-written version here had drifted already (`-no-audio`,
  // which is not an emulator flag at all).
  const bootHint = emulatorLaunchCommand({
    avd,
    port: lease.port ?? null,
    snapshot: 'cold',
  });

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
