/**
 * The conformance suite's Android a11y half: one pass over `A11Y_CONTROLS`, run at the
 * end of every `real-input:android` gate.
 *
 * ## Why here, and not somewhere new
 *
 * The rule cannot be stated inside the app: the harness queries match
 * `View.contentDescription`, Compose publishes its control's name on a `SemanticsNode`
 * that is not a `View`, and so a hosted control's name is invisible to a test process no
 * matter what the component does — the gap `Slider.harness.tsx` and
 * `Progress.harness.tsx` each record in a comment. `uiautomator dump` *is* the
 * accessibility tree, so the question "which node does a screen reader get?" is only
 * answerable from outside, on a device, with the app on the right screen.
 *
 * That is already `real-input:android`'s job — it boots the app, walks every tab and
 * reads dumps — so the sweep rides that run instead of becoming a new gate. A new gate is
 * a thing CI has to be told to run and a human has to remember; the brief's "no new gate"
 * is not a restriction, it is the difference between a guardrail and a README.
 *
 * ## Why after the checks, and not inside them
 *
 * A `CHECKS` entry is about one control responding to a real press; this is about one
 * property of the tree per control, with no interaction. Folding it in would double every
 * control's check for a rule that needs no gestures, and a failure would be blamed on
 * whichever press-sequence assertion shared the log. One log line per case, so
 * `gate.mjs`'s failure harvester picks up the `✗` lines on its own.
 *
 * ## Scrolling is part of the rule, not a courtesy
 *
 * `goToScreen` leaves the page at its top, and a control below the fold answers a dump
 * either with no node at all or with a zero-sized box — measured, and already the reason
 * `requireControlOnScreen` scrolls rather than trusting a name (`scrollToTop`'s comment
 * records the Progress bar that came back 0 px wide for exactly this). Reading every
 * control from the top of its screen would report healthy controls as missing, and the
 * first person to see those failures would add an exemption for the wrong reason. So each
 * case scrolls until its control's box is wholly inside the window, or until the page ends,
 * and only then reads.
 *
 * @file Split from `android.mjs` so the pass can be read on its own. The rule it applies
 *       lives in `./a11y.mjs`, is unit-tested against measured dumps in
 *       `scripts/__tests__/real-input-a11y.test.js`, and the pass itself is driven here
 *       against a navigation object rather than a device, so
 *       `scripts/__tests__/conformance.test.js` can prove the scrolling and the reporting
 *       without booting one.
 */

import {
  A11Y_CONTROLS,
  checkControlA11y,
  exemptionsFor,
  staleExemptions,
} from './a11y.mjs';

/** The runner flag that reads one case on its own. */
const A11Y_FLAG = '--a11y';

/** @typedef {import('./a11y.mjs').A11yControl} A11yControl */

/**
 * Swipes a case may take before the page is called endless rather than long.
 *
 * Not a budget for finding a control: the probe stops when the control is wholly on screen
 * or when a swipe leaves the page unmoved. `HostScreen.tsx`, the deepest screen, ends about
 * 2600 px below the window, so even a runner whose swipe moves the page only 80 px stops
 * long before 40. Reaching it means the tree changes on every dump, and the case fails.
 */
const SCROLL_PROBE_LIMIT = 40;

/** The swipe distance per probe, in pixels. */
const SCROLL_PROBE_PX = 320;

/**
 * Run the a11y sweep over every control in the table.
 *
 * @param {(
 *   id: string,
 *   title: string,
 *   options: {rerun: string[]}
 * ) => import('./support.mjs').CheckLog} begin opens a log line for one case, in the
 *   shape the control checks use; `rerun` is the runner arguments that read it again
 * @param {object} navigation what the pass needs from the device, declared rather than
 *   imported so it can be driven by a fake
 * @param {(
 *   screen: import('./a11y.mjs').ScreenId,
 *   log: import('./report.mjs').CheckLog
 * ) => Promise<void>} navigation.goToScreen
 *   gets the case's log, not just the screen. Getting there is a tab press like every
 *   other press in this suite, and on a run that walks the whole table it is *most* of
 *   them: a re-press it does not report is a retry no log carries and no summary counts
 *   (X21, where the sweep's navigations were the silent half of the run's tab taps).
 * @param {() => import('./uiautomator.mjs').UiautomatorNode[]} navigation.dump
 * @param {number} navigation.windowHeight the window's height, in the dump's pixels
 * @param {(pixels: number) => Promise<void>} navigation.scrollPage
 * @param {() => Promise<void>} navigation.scrollToTop
 * @param {ReadonlyArray<A11yControl>} [controls] the cases to run: the whole table unless
 *   the run named cases with `--a11y`
 * @returns {Promise<{covered: string[], matched: string[], stale: string[]}>} what the
 *   run saw, for {@link staleExemptions}, plus the stale rows it found and reported
 */
export async function runA11ySweep(
  begin,
  navigation,
  controls = A11Y_CONTROLS
) {
  /** @type {string[]} */
  const covered = [];
  /** @type {string[]} */
  const matched = [];
  let screen = null;
  for (const control of controls) {
    const log = begin(`a11y:${control.id}`, `${control.component} a11y`, {
      rerun: [A11Y_FLAG, control.id],
    });
    if (screen !== control.screen) {
      await navigation.goToScreen(control.screen, log);
      screen = control.screen;
    }
    const { tree, endless } = await treeShowing(navigation, control.label);
    if (endless) {
      log.check(
        `the page was still moving after ${String(SCROLL_PROBE_LIMIT)} swipes and never ` +
          `showed "${control.label}" wholly on screen, so the sweep stopped scrolling ` +
          'and graded the last dump',
        false
      );
    }
    covered.push(control.id);
    const result = checkControlA11y(control, tree);
    for (const problem of result.known) {
      // Printed, not failed — but through the note channel a check already uses, so the
      // line is in the log and a reader cannot mistake a swept control for an untested
      // one. Debt that is only visible in a source file is debt nobody tracks.
      log.note(problem);
    }
    if (result.exempt) matched.push(control.id);
    // One assertion per case, phrased as the rule: `log.check` prints `✗` plus the
    // description on failure, which is what `gate.mjs` harvests into a run's failure
    // excerpt — so the description has to carry the finding, not a label.
    log.check(
      result.failures.length === 0
        ? result.known.length === 0
          ? `${control.hybridView} is named on one node a person can act on`
          : `${control.hybridView} has no new a11y finding — and no clean pass either: ` +
            `${String(result.known.length)} of its problems match a debt row, printed ` +
            'above, so the rule is answered by the exemption rather than by the dump'
        : result.failures.join(' | '),
      result.failures.length === 0
    );
  }

  // A debt row that matched nothing this run describes a control that has been fixed, and
  // the row has to go with it. Reported as failures of their own, so the run that clears a
  // piece of debt also goes red until the row is deleted — which is what makes the list
  // self-clearing rather than a place things accumulate.
  const stale = staleExemptions(covered, matched);
  if (stale.length > 0) {
    const log = begin(
      'a11y:debt',
      'the a11y debt list still describes this code',
      {
        rerun: covered
          .filter(
            (id) =>
              !matched.includes(id) && exemptionsFor(id, 'android').length > 0
          )
          .flatMap((id) => [A11Y_FLAG, id]),
      }
    );
    for (const line of stale) {
      log.check(line, false);
    }
  }
  return { covered, matched, stale };
}

/**
 * A dump in which `label` has a box wholly inside the window, scrolling to find it.
 *
 * Stops as soon as it has one, so a control near the top costs a single dump, or once a
 * swipe leaves the page where it was. Returns the last tree either way: a name with no box
 * there is a finding the rule has to report, and swallowing it here would turn a failure
 * back into a scroll timeout. `endless` is set only when the page was still moving after
 * {@link SCROLL_PROBE_LIMIT} swipes.
 *
 * @param {{dump: () => any[], scrollPage: (pixels: number) => Promise<void>, scrollToTop: () => Promise<void>, windowHeight: number}} navigation
 * @param {string} label
 * @returns {Promise<{tree: any[], endless: boolean}>}
 */
async function treeShowing(navigation, label) {
  const { windowHeight } = navigation;
  if (!(windowHeight > 0)) {
    throw new TypeError(
      `a11y sweep: the navigation's windowHeight is ${String(windowHeight)}, so no box ` +
        'can be called on screen'
    );
  }
  await navigation.scrollToTop();
  let tree = await navigation.dump();
  for (let probe = 0; probe < SCROLL_PROBE_LIMIT; probe += 1) {
    if (tree.some((node) => whollyInside(node, label, windowHeight))) {
      return { tree, endless: false };
    }
    const before = pageSignature(tree);
    await navigation.scrollPage(SCROLL_PROBE_PX);
    tree = await navigation.dump();
    if (pageSignature(tree) === before) return { tree, endless: false };
  }
  return {
    tree,
    endless: !tree.some((node) => whollyInside(node, label, windowHeight)),
  };
}

/**
 * `uiautomator` clips a box to the window, so a box that ends on the window's bottom edge
 * may be cut off there: only one that ends above it is known to be whole.
 */
function whollyInside(node, label, windowHeight) {
  return (
    node.contentDesc === label &&
    node.bounds.width > 0 &&
    node.bounds.height > 0 &&
    node.bounds.y2 < windowHeight
  );
}

/** Which nodes sit at which boxes: equal before and after a swipe means it moved nothing. */
function pageSignature(tree) {
  return tree
    .map(
      (node) =>
        `${String(node.className)}|${String(node.resourceId)}|${String(node.contentDesc)}@` +
        `${String(node.bounds.x1)},${String(node.bounds.y1)},` +
        `${String(node.bounds.x2)},${String(node.bounds.y2)}`
    )
    .join(';');
}

export { SCROLL_PROBE_LIMIT, SCROLL_PROBE_PX };
