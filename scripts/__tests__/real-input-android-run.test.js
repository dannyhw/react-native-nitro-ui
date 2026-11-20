import { describe, expect, it, vi } from 'vitest';

import { A11Y_FLAG, androidRunPlan } from '../real-input/android-run.mjs';
import { runA11ySweep } from '../real-input/a11y-sweep.mjs';
import { A11Y_CONTROLS } from '../real-input/a11y.mjs';
import { REAL_INPUT_CONTROLS } from '../real-input/controls.mjs';
import { Suite } from '../real-input/report.mjs';
import {
  ledgerLineFromRun,
  planRerunFailed,
  realInputUnitsFromResults,
} from '../gate-core.mjs';

const ALL_CASES = A11Y_CONTROLS.map((entry) => entry.id);
const ids = (entries) => entries.map((entry) => entry.id);

describe('androidRunPlan', () => {
  it('runs every control and every a11y case with no arguments', () => {
    const plan = androidRunPlan([]);
    expect(plan.full).toBe(true);
    expect(ids(plan.controls)).toEqual(ids(REAL_INPUT_CONTROLS));
    expect(ids(plan.a11yCases)).toEqual(ALL_CASES);
    expect(plan.a11yNamed).toBe(false);
  });

  it('reads one named a11y case and runs nothing else', () => {
    const plan = androidRunPlan([A11Y_FLAG, 'hosted-date-picker']);
    expect(plan.full).toBe(false);
    expect(plan.controls).toEqual([]);
    expect(ids(plan.a11yCases)).toEqual(['hosted-date-picker']);
    expect(plan.a11yNamed).toBe(true);
  });

  it('keeps the whole sweep on a run that names only controls', () => {
    const plan = androidRunPlan(['--control', 'switch']);
    expect(ids(plan.controls)).toEqual(['switch']);
    expect(ids(plan.a11yCases)).toEqual(ALL_CASES);
    expect(plan.a11yNamed).toBe(false);
  });

  it('repeats, and combines with --control by reading the named controls’ cases too', () => {
    const plan = androidRunPlan([
      A11Y_FLAG,
      'hosted-date-picker',
      '--control',
      'hosted-mixed',
      A11Y_FLAG,
      'slider',
      '--control',
      'switch',
    ]);
    expect(ids(plan.controls)).toEqual(['hosted-mixed', 'switch']);
    // Table order, and `hosted-progress` because `hosted-mixed` is the control that reads it.
    expect(ids(plan.a11yCases)).toEqual([
      'switch',
      'slider',
      'hosted-date-picker',
      'hosted-progress',
    ]);
  });

  it('refuses an unknown case, naming the known ones', () => {
    expect(() => androidRunPlan([A11Y_FLAG, 'hosted-datepicker'])).toThrow(
      new RegExp(
        `unknown a11y case "hosted-datepicker"\\. Known: ${ALL_CASES.join(', ')}\\.`
      )
    );
  });

  it('refuses an unknown control, a flag with no value and a stray argument', () => {
    expect(() => androidRunPlan(['--control', 'nope'])).toThrow(
      /unknown control "nope"/
    );
    expect(() => androidRunPlan([A11Y_FLAG])).toThrow(
      /--a11y needs an a11y case id/
    );
    expect(() => androidRunPlan([A11Y_FLAG, '--control', 'switch'])).toThrow(
      /--a11y needs an a11y case id/
    );
    expect(() => androidRunPlan(['--tab-targets'])).toThrow(
      /unknown argument "--tab-targets"/
    );
  });
});

/* ------------------------ completing a red Android run ------------------------ */

describe('a full Android run whose only failure is one a11y case', () => {
  /** A dump that names a control on one actionable node. */
  function node(contentDesc) {
    return {
      contentDesc,
      className: 'android.view.View',
      clickable: 'true',
      checkable: 'false',
      focusable: 'true',
      scrollable: 'false',
      bounds: {
        x1: 0,
        y1: 0,
        x2: 100,
        y2: 40,
        cx: 50,
        cy: 20,
        width: 100,
        height: 40,
      },
    };
  }

  /**
   * The run as `android.mjs` reports it: one control that passed, then the sweep over
   * the switch case, which the dump answers, and the hosted DatePicker case, which it
   * does not.
   */
  async function redRun() {
    const control = REAL_INPUT_CONTROLS.find((entry) => entry.id === 'switch');
    const suite = new Suite('android', [control]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      suite.begin(control).check('the switch answered a real tap', true);
      await runA11ySweep(
        (id, title, options) => suite.beginAuxiliary(id, title, options),
        {
          goToScreen: async () => {},
          scrollToTop: async () => {},
          scrollPage: async () => {},
          dump: () => [node('Controlled switch')],
          windowHeight: 2424,
        },
        A11Y_CONTROLS.filter((entry) =>
          ['switch', 'hosted-date-picker'].includes(entry.id)
        )
      );
      expect(suite.finish({})).toBe(1);
    } finally {
      log.mockRestore();
    }
    return suite.units();
  }

  it('re-reads that case alone, and the re-run runs no control', async () => {
    const units = realInputUnitsFromResults(await redRun());
    expect(units.results).toEqual({
      'switch': 'pass',
      'a11y:switch': 'pass',
      'a11y:hosted-date-picker': 'fail',
    });
    expect(units.everyRun).toEqual({});

    const tree = 'f'.repeat(64);
    const gateTrees = {
      'harness:ios': '1'.repeat(64),
      'harness:android': '2'.repeat(64),
      'real-input:ios': '3'.repeat(64),
      'real-input:android': '4'.repeat(64),
    };
    const trees = { ios: 'i'.repeat(64), android: 'a'.repeat(64) };
    const plan = planRerunFailed({
      gate: 'real-input:android',
      entries: [
        ledgerLineFromRun({
          gate: 'real-input:android',
          command: 'node scripts/real-input/android.mjs',
          tree,
          trees,
          gateTrees,
          treeAfter: tree,
          head: 'abc1234',
          branch: 'task/x',
          durationMs: 2_400_000,
          result: 'fail',
          exitCode: 1,
          startedAt: Date.parse('2026-11-18T10:00:00Z'),
          logPath: 'task/x/real-input+android-a.log',
          units,
        }),
      ],
      tree,
      trees,
      gateTrees,
    });
    expect(plan.refusal).toBeNull();
    expect(plan.rerun).toEqual(['a11y:hosted-date-picker']);
    expect(plan.filterArgs).toEqual([A11Y_FLAG, 'hosted-date-picker']);

    const rerun = androidRunPlan(plan.filterArgs);
    expect(rerun.controls).toEqual([]);
    expect(ids(rerun.a11yCases)).toEqual(['hosted-date-picker']);
  });
});
