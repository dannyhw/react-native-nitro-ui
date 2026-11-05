/**
 * The example app's tab bar as a set of touch targets, and the rule they answer to.
 *
 * Every harness-free run of the example — both real-input suites, the a11y sweep, the
 * dwell probes — gets to a screen by tapping its tab, so a tab that is too small to tap
 * is a debt every one of them pays. It was paid: with 15 tabs sharing one row, a tab on
 * the lease's Pixel 9 was about 23 × 28 dp (G16's merge measured `tab-picker` at
 * 61 × 74 px), under Android's 48 dp minimum, and every new component shrank them
 * further (X19). The bar now scrolls, each tab keeps its natural width, and this module
 * is what both platforms' suites measure it against:
 *
 * - {@link exampleTabs} reads the tabs `example/src/App.tsx` renders, in order, from the
 *   same `TABS` array `scripts/gen-registry.mjs` writes — so a tab the registry adds is
 *   one this rule measures without anyone editing a list here;
 * - {@link checkTabTargets} decides, per tab, from boxes a suite measured on a device;
 * - {@link parseIosTabTargets} reads the boxes `RealInputTests.testRealInputTabTargets`
 *   prints. The Android suite measures from its own `uiautomator` dump.
 *
 * Pure (no `node:` imports), so `scripts/__tests__/real-input-tab-targets.test.js` can
 * prove each failure red with a fixture.
 *
 * @file
 */

/**
 * The smallest a tab may be, in each platform's layout unit: Android's 48 dp (Material's
 * and the platform accessibility scanner's minimum) and Apple's 44 pt (the Human
 * Interface Guidelines' hit target). `example/src/App.tsx` sizes the tabs from the same
 * two numbers, written there as `minWidth`/`minHeight`.
 *
 * @type {Readonly<{ android: number, ios: number }>}
 */
export const TAB_TARGET_MIN = Object.freeze({ android: 48, ios: 44 });

/**
 * The tabs `example/src/App.tsx` renders, in the order the bar draws them.
 *
 * Read from the `TABS` array — the generated region plus the hand-written `host` entry
 * after it — rather than from the registry's manifests, because the bar is what a person
 * taps: a tab the file lists and no manifest names is still a tab to measure.
 *
 * @param {string | null} appText the contents of `example/src/App.tsx`
 * @returns {{ id: string, label: string }[]}
 */
export function exampleTabs(appText) {
  const text = appText ?? '';
  const start = text.indexOf('const TABS');
  if (start < 0) return [];
  const end = text.indexOf('];', start);
  const body = text.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/\{ id: '([a-z0-9]+)', label: '([^']*)' \}/g)].map(
    (match) => ({ id: match[1], label: match[2] })
  );
}

/**
 * @typedef {object} TabMeasurement
 * @property {number} width in the platform's layout unit (dp / pt)
 * @property {number} height
 * @property {boolean} reached whether the suite brought the whole tab inside the
 *   window before measuring it. A tab that cannot be scrolled fully into view is a tab
 *   a navigator cannot reliably tap, and on Android its box is clipped, so its size is
 *   not a reading at all.
 */

/**
 * The rule: every tab the app renders was measured, was brought wholly on screen, and is
 * at least {@link TAB_TARGET_MIN} in both directions.
 *
 * One layout pixel of slack, because both platforms snap a box to the pixel grid: a
 * 48 dp tab on a 2.625x screen is 126 px, and a rounding that lands it on 125 px is
 * still the 48 dp the app asked for, not a regression. A tab one pixel short is
 * indistinguishable from that; a tab two pixels short is not.
 *
 * @param {object} args
 * @param {'android' | 'ios'} args.platform
 * @param {ReadonlyArray<{ id: string, label: string }>} args.tabs from {@link exampleTabs}
 * @param {ReadonlyMap<string, TabMeasurement>} args.measured by tab id
 * @param {number} args.pixel one device pixel in the layout unit (1 / density)
 * @returns {{ id: string, ok: boolean, line: string }[]} one verdict per tab, in bar
 *   order, plus one for a measured tab the app does not list
 */
export function checkTabTargets({ platform, tabs, measured, pixel }) {
  const min = TAB_TARGET_MIN[platform];
  const unit = platform === 'android' ? 'dp' : 'pt';
  const floor = min - pixel;
  const size = (m) => `${fmt(m.width)} × ${fmt(m.height)} ${unit}`;
  /** @type {{ id: string, ok: boolean, line: string }[]} */
  const verdicts = [];
  if (tabs.length === 0) {
    verdicts.push({
      id: '(none)',
      ok: false,
      line:
        'example/src/App.tsx lists no tabs this rule can read, so nothing was ' +
        'measured — the TABS array has moved or changed shape',
    });
  }
  for (const tab of tabs) {
    const m = measured.get(tab.id);
    const name = `tab "${tab.label}" (tab-${tab.id})`;
    if (m == null) {
      verdicts.push({
        id: tab.id,
        ok: false,
        line: `${name} was never measured, so nothing says a finger can reach it`,
      });
      continue;
    }
    if (!m.reached) {
      verdicts.push({
        id: tab.id,
        ok: false,
        line:
          `${name} could not be brought wholly inside the window (last read ` +
          `${size(m)}), so a navigator cannot rely on tapping it`,
      });
      continue;
    }
    const small = [];
    if (m.width < floor) small.push('narrow');
    if (m.height < floor) small.push('short');
    verdicts.push({
      id: tab.id,
      ok: small.length === 0,
      line:
        small.length === 0
          ? `${name} is ${size(m)}, at least the ${String(min)} ${unit} minimum`
          : `${name} is ${size(m)} — too ${small.join(' and too ')} for the ` +
            `${String(min)} ${unit} minimum touch target`,
    });
  }
  const listed = new Set(tabs.map((tab) => tab.id));
  for (const id of measured.keys()) {
    if (!listed.has(id)) {
      verdicts.push({
        id,
        ok: false,
        line:
          `the app drew a tab "tab-${id}" that example/src/App.tsx's TABS does not ` +
          'list, so this rule and the bar disagree about what is there',
      });
    }
  }
  return verdicts;
}

/**
 * The line `RealInputTests.testRealInputTabTargets` prints for each tab:
 *
 *     real-input tab-target id=tab-switch | frame=4.0,62.0,71.3,44.0 | reached=true
 *
 * `frame` is `XCUIElement.frame` (x, y, width, height in points) after the tab was
 * scrolled into the window and two consecutive reads agreed.
 */
const IOS_LINE =
  /real-input tab-target id=tab-([a-z0-9]+) \| frame=(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+) \| reached=(true|false)/;

/**
 * Every tab box the iOS pass printed, by tab id. A later line for the same tab wins, so
 * a pass that re-measured a tab is read at its last measurement.
 *
 * @param {string} log the xcodebuild test log
 * @returns {Map<string, TabMeasurement>}
 */
export function parseIosTabTargets(log) {
  /** @type {Map<string, TabMeasurement>} */
  const measured = new Map();
  for (const line of log.split('\n')) {
    const match = IOS_LINE.exec(line);
    if (match == null) continue;
    measured.set(match[1], {
      width: Number(match[4]),
      height: Number(match[5]),
      reached: match[6] === 'true',
    });
  }
  return measured;
}

/** @param {number} value */
function fmt(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
