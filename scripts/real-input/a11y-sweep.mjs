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
 * case scrolls until its control has a box, and only then reads.
 *
 * @file Split from `android.mjs` so the pass can be read on its own. The rule it applies
 *       lives in `./a11y.mjs`, is unit-tested against measured dumps in
 *       `scripts/__tests__/real-input-a11y.test.js`, and the pass itself is driven here
 *       against a navigation object rather than a device, so
 *       `scripts/__tests__/conformance.test.js` can prove the scrolling and the reporting
 *       without booting one.
 */

import { A11Y_CONTROLS, checkControlA11y, staleExemptions } from './a11y.mjs';

/** @typedef {import('./a11y.mjs').A11yControl} A11yControl */

/**
 * How far to swipe looking for a control before concluding it is not on the page.
 *
 * Eight swipes of 320 px is 2560 px, more than the longest screen in the example app
 * (`HostScreen.tsx` is the deep one, and every hosted case is on it). A control that needs
 * more than that is not on the screen its table row names, which is a finding, not a
 * scroll budget.
 */
const SCROLL_PROBE_LIMIT = 8;

/** The swipe distance per probe, in pixels. */
const SCROLL_PROBE_PX = 320;

/**
 * Run the a11y sweep over every control in the table.
 *
 * @param {(id: string, title: string) => import('./support.mjs').CheckLog} begin opens a
 *   log line for one case, in the shape the control checks use
 * @param {object} navigation what the pass needs from the device, declared rather than
 *   imported so it can be driven by a fake
 * @param {(screen: import('./a11y.mjs').ScreenId) => Promise<void>} navigation.goToScreen
 * @param {() => import('./uiautomator.mjs').UiautomatorNode[]} navigation.dump
 * @param {(pixels: number) => Promise<void>} navigation.scrollPage
 * @param {() => Promise<void>} navigation.scrollToTop
 * @param {ReadonlyArray<A11yControl>} [controls] the cases to run. Production leaves this
 *   out and runs the whole table — that is the point of the sweep — and a unit test of one
 *   case's scroll behaviour passes a one-entry array rather than the sweep growing a
 *   filter flag nobody would use in production.
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
    const log = begin(`a11y:${control.id}`, `${control.component} a11y`);
    if (screen !== control.screen) {
      await navigation.goToScreen(control.screen);
      screen = control.screen;
    }
    const tree = await treeShowing(navigation, control.label);
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
        ? `${control.hybridView} is named on one node a person can act on`
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
      'the a11y debt list still describes this code'
    );
    for (const line of stale) {
      log.check(line, false);
    }
  }
  return { covered, matched, stale };
}

/**
 * A dump in which `label` has a box, scrolling to find it.
 *
 * Stops as soon as the name appears with one, so a control near the top costs a single
 * dump. Returns the last tree even when the name never had a box: that is a finding the
 * rule has to report (either the control is not on this screen or it is drawn at nothing),
 * and swallowing it here would turn a failure back into a scroll timeout.
 *
 * @param {{dump: () => any[], scrollPage: (pixels: number) => Promise<void>, scrollToTop: () => Promise<void>}} navigation
 * @param {string} label
 */
async function treeShowing(navigation, label) {
  await navigation.scrollToTop();
  let tree = navigation.dump();
  for (let probe = 0; probe < SCROLL_PROBE_LIMIT; probe += 1) {
    const hasBox = tree.some(
      (node) =>
        node.contentDesc === label &&
        node.bounds.width > 0 &&
        node.bounds.height > 0
    );
    if (hasBox) return tree;
    await navigation.scrollPage(SCROLL_PROBE_PX);
    tree = navigation.dump();
  }
  return tree;
}

export { SCROLL_PROBE_LIMIT, SCROLL_PROBE_PX };
