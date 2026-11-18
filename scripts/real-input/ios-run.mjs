/**
 * What one iOS real-input run reads, and the report of its two passes that are not
 * controls. Kept free of I/O so both are unit-tested without a device; `ios.mjs` does
 * the building, the installing and the running.
 *
 * A run with no arguments is a full run: every control, every accessibility case and
 * the tab bar. A filtered run reads the accessibility cases of the controls it names
 * and of the cases `--a11y` names, and measures the tab bar only with `--tab-targets`.
 * Every check it reports carries the arguments that re-run it, so `gate.mjs
 * --rerun-failed` can name it.
 */

import { REAL_INPUT_CONTROLS } from './controls.mjs';
import {
  A11Y_CONTROLS,
  a11yCaseControl,
  checkIosControlA11y,
  exemptionsFor,
  parseIosA11yLog,
  parseIosA11yStability,
  reportIosStability,
  staleExemptions,
} from './a11y.mjs';
import { parseTestResults } from './ios-log.mjs';
import {
  checkTabTargets,
  exampleTabs,
  parseIosTabTargets,
  unreadTabTargetLines,
} from './tab-targets.mjs';

export const A11Y_FLAG = '--a11y';
export const TAB_TARGETS_FLAG = '--tab-targets';

/**
 * The accessibility pass's method name. It is not a control: it asserts nothing about a
 * press, and a control's totals have to keep meaning "every control answered a real
 * touch", so it is reported through `Suite.beginAuxiliary`.
 */
export const A11Y_METHOD = 'testRealInputA11y';

/** The tab-bar pass: every example tab measured as a touch target. Not a control either. */
export const TAB_METHOD = 'testRealInputTabTargets';

/** The id the tab-bar pass reports under. */
export const TAB_TARGETS_ID = 'tab-targets';

/**
 * The variable that tells the accessibility pass which cases to read. `xcodebuild`
 * passes a `TEST_RUNNER_`-prefixed variable to the test runner without the prefix.
 */
export const A11Y_CASES_ENV = 'TEST_RUNNER_NITRO_UI_A11Y_CASES';

export { a11yCaseControl };

/**
 * @typedef {object} IosRunPlan
 * @property {boolean} full no filter was given
 * @property {ReadonlyArray<import('./controls.mjs').RealInputControl>} controls
 * @property {string[]} a11yCases the accessibility cases to read, in table order
 * @property {boolean} tabTargets measure the tab bar
 */

/**
 * @param {ReadonlyArray<string>} argv the runner's arguments, without `--help`
 * @param {object} [tables] for the tests
 * @param {ReadonlyArray<import('./controls.mjs').RealInputControl>} [tables.controls]
 * @param {ReadonlyArray<{id: string}>} [tables.cases]
 * @returns {IosRunPlan}
 */
export function iosRunPlan(
  argv,
  { controls = REAL_INPUT_CONTROLS, cases = A11Y_CONTROLS } = {}
) {
  /** @type {string[]} */
  const controlIds = [];
  /** @type {string[]} */
  const caseIds = [];
  let tabTargets = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--control' || arg === A11Y_FLAG) {
      const value = argv[index + 1];
      if (value == null || value.startsWith('--')) {
        throw new Error(
          `real-input: ${arg} needs ${arg === A11Y_FLAG ? 'an a11y case' : 'a control'} id.`
        );
      }
      (arg === A11Y_FLAG ? caseIds : controlIds).push(value);
      index += 1;
    } else if (arg === TAB_TARGETS_FLAG) {
      tabTargets = true;
    } else {
      throw new Error(`real-input: unknown argument "${arg}".`);
    }
  }

  const known = (table, ids, what) =>
    ids.map((id) => {
      const found = table.find((entry) => entry.id === id);
      if (found == null) {
        throw new Error(
          `real-input: unknown ${what} "${id}". Known: ` +
            `${table.map((entry) => entry.id).join(', ')}.`
        );
      }
      return found;
    });
  const full = argv.length === 0;
  const chosen = full
    ? [...controls]
    : [...new Set(known(controls, controlIds, 'control'))];
  known(cases, caseIds, 'a11y case');
  const named = new Set(chosen.map((control) => control.id));
  return {
    full,
    controls: chosen,
    a11yCases: cases
      .map((entry) => entry.id)
      .filter(
        (id) => full || named.has(a11yCaseControl(id)) || caseIds.includes(id)
      ),
    tabTargets: full || tabTargets,
  };
}

/**
 * The XCUITest methods a run selects: the controls' own, then the two passes it reads.
 *
 * @param {IosRunPlan} plan
 * @param {ReadonlyArray<string>} controlMethods the selected controls' method names
 * @returns {string[]}
 */
export function iosTestMethods(plan, controlMethods) {
  return [
    ...controlMethods,
    ...(plan.a11yCases.length > 0 ? [A11Y_METHOD] : []),
    ...(plan.tabTargets ? [TAB_METHOD] : []),
  ];
}

/**
 * What a run says it will read, before it builds.
 *
 * @param {IosRunPlan} plan
 * @returns {string}
 */
export function describeIosRunPlan(plan) {
  const cases =
    plan.a11yCases.length === A11Y_CONTROLS.length
      ? `all ${String(A11Y_CONTROLS.length)} a11y cases`
      : plan.a11yCases.length === 0
        ? 'no a11y case'
        : `a11y ${plan.a11yCases.join(', ')}`;
  return (
    `${String(plan.controls.length)} control(s), ${cases}, ` +
    (plan.tabTargets
      ? 'the tab bar'
      : `no tab bar (${TAB_TARGETS_FLAG} measures it)`)
  );
}

/**
 * @returns {string}
 */
export function iosUsage() {
  return `Usage: bun run test:real-input:ios [--control <id>]... [${A11Y_FLAG} <case>]... [${TAB_TARGETS_FLAG}]

With no arguments: every control, every a11y case and the tab bar.
  --control <id>   press this control and read its a11y cases
  ${A11Y_FLAG} <case>    read this a11y case
  ${TAB_TARGETS_FLAG}    measure every example tab as a touch target

Controls:   ${REAL_INPUT_CONTROLS.map((control) => control.id).join(', ')}
A11y cases: ${A11Y_CONTROLS.map((entry) => entry.id).join(', ')}`;
}

/**
 * The accessibility pass's own section of the report.
 *
 * One auxiliary check per case the run read, decided by the rule in `a11y.mjs` — the
 * same file the Android sweep reads — from the elements the Swift pass printed. Decided
 * here rather than as `XCTAssert` calls because the rule needs the shared table, and a
 * rule decided in a log parser can be shown red with a fixture instead of on a device.
 *
 * Three things fail a case, each reported on its own line:
 *
 * - no elements at all: the pass never reached the screen, and a control nobody
 *   measured is never a pass.
 * - the rule found problems: new ones fail the run; ones that match a debt row are
 *   printed as `known failing`.
 * - a debt row that matched nothing among the cases read, so a fix has to delete its row
 *   rather than let it excuse nothing.
 *
 * @param {object} args
 * @param {string} args.log the xcodebuild test log
 * @param {import('./report.mjs').Suite} args.suite
 * @param {number} args.status xcodebuild's exit status
 * @param {string} args.testLog where that log lives, for the failure message
 * @param {ReadonlyArray<string>} args.cases the case ids this run read
 */
export function reportA11yPass({ log, suite, status, testLog, cases }) {
  if (cases.length === 0) return;
  const outcome = parseTestResults(log).get(A11Y_METHOD);
  const rerunAll = cases.flatMap((id) => [A11Y_FLAG, id]);
  let trees;
  let stabilityByCase;
  try {
    trees = parseIosA11yLog(log);
    stabilityByCase = parseIosA11yStability(log);
  } catch (error) {
    // A line whose box did not parse means the format moved under the parser: a broken
    // measurement, not a control's failure, so it fails the run outright.
    const check = suite.beginAuxiliary(
      'a11y',
      'the accessibility rule (XCUITest)',
      { rerun: rerunAll }
    );
    check.abort(`${String(error?.message ?? error)} — see ${testLog}`);
    return;
  }
  /** @type {string[]} */
  const covered = [];
  /** @type {string[]} */
  const matched = [];
  for (const entry of A11Y_CONTROLS.filter((one) => cases.includes(one.id))) {
    const check = suite.beginAuxiliary(
      `a11y:${entry.id}`,
      `${entry.component} a11y (XCUITest)`,
      { rerun: [A11Y_FLAG, entry.id] }
    );
    const nodes = trees.get(entry.id);
    if (nodes == null || nodes.length === 0) {
      check.check(
        `no elements were printed for ${entry.id}, so this run never read its ` +
          `accessibility tree (the pass reported "${String(
            outcome?.outcome ?? 'nothing'
          )}"; exit ${String(status)}). See ${testLog}`,
        false
      );
      continue;
    }
    covered.push(entry.id);
    // The stability line first, so it reads as the provenance of every box noted below
    // it. The wrapper's box is the one the line's `firstAnchor` describes, so it is looked
    // up by the anchor flag rather than by index.
    reportIosStability(
      check,
      stabilityByCase.get(entry.id),
      nodes.find((element) => element.anchor)?.frame ?? nodes[0]?.frame
    );
    for (const node of nodes) {
      check.note(
        `${node.type} id="${node.id}" label="${node.label}" ` +
          `value="${node.value}" box ${iosBoxText(node.frame)}` +
          `${node.anchor ? ' [the React Native wrapper]' : ''}`
      );
    }
    const result = checkIosControlA11y(entry, nodes);
    for (const problem of result.known) {
      check.note(problem);
    }
    if (result.exempt) matched.push(entry.id);
    // The verdict has to agree with the notes above it: a case answered only by a debt
    // row says so, rather than printing the clean pass's sentence under a finding.
    check.check(
      result.failures.length === 0
        ? result.known.length === 0
          ? `${entry.hybridView} is named on one element, at the control's own box, as ${
              entry.iosTrait == null
                ? 'a control'
                : `the ${entry.iosTrait} it claims to be`
            }`
          : `${entry.hybridView} has no new a11y finding — and no clean pass either: ` +
            `${String(result.known.length)} of its problems match a debt row, printed ` +
            'above, so the rule is answered by the exemption rather than by the tree'
        : result.failures.join(' | '),
      result.failures.length === 0
    );
  }

  const stale = staleExemptions(covered, matched, 'ios');
  if (stale.length > 0) {
    const check = suite.beginAuxiliary(
      'a11y:ios-debt',
      'the iOS a11y debt list still describes this code',
      {
        rerun: covered
          .filter(
            (id) => !matched.includes(id) && exemptionsFor(id, 'ios').length > 0
          )
          .flatMap((id) => [A11Y_FLAG, id]),
      }
    );
    for (const line of stale) check.check(line, false);
  }
}

/**
 * The tab-bar pass's section of the report: one line per tab, decided by
 * `checkTabTargets` from the boxes the Swift pass printed. A pass that printed nothing
 * is a failure, never a quiet pass: every tab then reads "never measured".
 *
 * @param {object} args
 * @param {string} args.log the xcodebuild test log
 * @param {import('./report.mjs').Suite} args.suite
 * @param {number} args.status xcodebuild's exit status
 * @param {string} args.testLog
 * @param {string} args.appSource `example/src/App.tsx`, which lists the tabs
 */
export function reportTabTargets({ log, suite, status, testLog, appSource }) {
  const check = suite.beginAuxiliary(
    TAB_TARGETS_ID,
    'every example tab is a 44 pt touch target (XCUITest)',
    { rerun: [TAB_TARGETS_FLAG] }
  );
  const outcome = parseTestResults(log).get(TAB_METHOD);
  if (outcome?.outcome !== 'passed') {
    check.note(
      `${TAB_METHOD} reported "${String(outcome?.outcome ?? 'nothing')}" ` +
        `(exit ${String(status)}); see ${testLog}`
    );
  }
  // One device pixel of slack, at the lease's @3x simulators.
  for (const verdict of checkTabTargets({
    platform: 'ios',
    tabs: exampleTabs(appSource),
    measured: parseIosTabTargets(log),
    strays: unreadTabTargetLines(log),
    pixel: 1 / 3,
  })) {
    check.check(verdict.line, verdict.ok);
  }
}

/**
 * @param {{x: number, y: number, width: number, height: number}} frame
 */
function iosBoxText(frame) {
  return `(${frame.x}, ${frame.y}, ${frame.width}x${frame.height})`;
}
