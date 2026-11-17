import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  A11Y_CASES_ENV,
  A11Y_METHOD,
  TAB_METHOD,
  a11yCaseControl,
  describeIosRunPlan,
  iosRunPlan,
  iosTestMethods,
  reportA11yPass,
  reportTabTargets,
} from '../real-input/ios-run.mjs';
import { A11Y_CONTROLS } from '../real-input/a11y.mjs';
import { REAL_INPUT_CONTROLS } from '../real-input/controls.mjs';
import { Suite } from '../real-input/report.mjs';
import { realInputUnitsFromResults } from '../gate-core.mjs';

const ALL_CASES = A11Y_CONTROLS.map((entry) => entry.id);
const APP = readFileSync(join(process.cwd(), 'example/src/App.tsx'), 'utf8');

// The button case as measured, with the name on its hosted element or without it.
const buttonLines = (label) => [
  'real-input a11y case=button kind=anchor id=real-input-enabled x=16.0 y=250.3333282470703 w=99.33333587646484 h=34.33332824707031 nodes=2',
  'real-input a11y case=button kind=node trait="other" enabled=true hittable=true id="real-input-enabled" label="Real-input button" value="" x=16.0 y=250.3333282470703 w=99.33333587646484 h=34.33332824707031',
  `real-input a11y case=button kind=node trait="button" enabled=true hittable=true id="" label="${label}" value="" x=16.0 y=250.3333282470703 w=99.33333333333333 h=34.333333333333314`,
];

// The switch case as the pass printed it on an iPhone 17: passes the rule.
const SWITCH_LINES = [
  'real-input a11y case=switch kind=anchor id=switch-controlled x=325.0 y=233.66666412353516 w=61.0 h=28.0 nodes=3',
  'real-input a11y case=switch kind=node trait="other" enabled=true hittable=true id="switch-controlled" label="Controlled switch" value="" x=325.0 y=233.66666412353516 w=61.0 h=28.0',
  'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="" label="Controlled switch" value="0" x=325.0 y=233.66666412353516 w=61.0 h=28.0',
];

const passed = (method) =>
  `Test Case '-[NitroUiExampleUITests.RealInputTests ${method}]' passed (10.000 seconds).`;

function units(suite) {
  return realInputUnitsFromResults(suite.units());
}

let restore;
beforeEach(() => {
  const original = console.log;
  console.log = () => {};
  restore = () => {
    console.log = original;
  };
});
afterEach(() => restore());

describe('iosRunPlan', () => {
  it('a run with no arguments reads every control, every a11y case and the tab bar', () => {
    const plan = iosRunPlan([]);
    expect(plan.full).toBe(true);
    expect(plan.controls).toHaveLength(REAL_INPUT_CONTROLS.length);
    expect(plan.a11yCases).toEqual(ALL_CASES);
    expect(plan.tabTargets).toBe(true);
    expect(iosTestMethods(plan, ['testRealInputSwitch'])).toEqual([
      'testRealInputSwitch',
      A11Y_METHOD,
      TAB_METHOD,
    ]);
  });

  it('a --control run reads that control and its own a11y case, and no tab bar', () => {
    const plan = iosRunPlan(['--control', 'switch']);
    expect(plan.full).toBe(false);
    expect(plan.controls.map((control) => control.id)).toEqual(['switch']);
    expect(plan.a11yCases).toEqual(['switch']);
    expect(plan.tabTargets).toBe(false);
    expect(iosTestMethods(plan, ['testRealInputSwitch'])).toEqual([
      'testRealInputSwitch',
      A11Y_METHOD,
    ]);
    expect(describeIosRunPlan(plan)).toBe(
      '1 control(s), a11y switch, no tab bar (--tab-targets measures it)'
    );
  });

  it('reads a case whose id is not its control’s through that control', () => {
    expect(iosRunPlan(['--control', 'hosted-mixed']).a11yCases).toEqual([
      'hosted-progress',
    ]);
  });

  it('a control with no a11y case leaves the a11y pass out', () => {
    const plan = iosRunPlan(['--control', 'dialog']);
    expect(plan.a11yCases).toEqual([]);
    expect(iosTestMethods(plan, ['testRealInputDialog'])).toEqual([
      'testRealInputDialog',
    ]);
  });

  it('--a11y and --tab-targets read only what they name, and press nothing', () => {
    const plan = iosRunPlan(['--a11y', 'slider', '--tab-targets']);
    expect(plan.controls).toEqual([]);
    expect(plan.a11yCases).toEqual(['slider']);
    expect(plan.tabTargets).toBe(true);
    expect(iosTestMethods(plan, [])).toEqual([A11Y_METHOD, TAB_METHOD]);
    expect(
      iosRunPlan(['--a11y', 'switch', '--control', 'switch']).a11yCases
    ).toEqual(['switch']);
    expect(iosRunPlan(['--tab-targets']).a11yCases).toEqual([]);
  });

  it('keeps the table order whatever order the arguments come in', () => {
    expect(
      iosRunPlan(['--a11y', 'list-item', '--control', 'slider']).a11yCases
    ).toEqual(['slider', 'list-item']);
  });

  it('refuses what it does not know', () => {
    expect(() => iosRunPlan(['--control', 'nope'])).toThrow(
      /unknown control "nope"/
    );
    expect(() => iosRunPlan(['--a11y', 'nope'])).toThrow(
      /unknown a11y case "nope"/
    );
    expect(() => iosRunPlan(['--a11y'])).toThrow(/needs an a11y case id/);
    expect(() => iosRunPlan(['--a11y', '--tab-targets'])).toThrow(
      /needs an a11y case id/
    );
    expect(() => iosRunPlan(['--fast'])).toThrow(/unknown argument "--fast"/);
  });

  it('reaches every a11y case through some control', () => {
    const ids = new Set(REAL_INPUT_CONTROLS.map((control) => control.id));
    for (const id of ALL_CASES) expect(ids).toContain(a11yCaseControl(id));
  });

  it('hands the Swift pass the variable it reads', () => {
    const swift = readFileSync(
      join(
        process.cwd(),
        'example/ios/NitroUiExampleUITests/RealInputTests.swift'
      ),
      'utf8'
    );
    expect(A11Y_CASES_ENV.startsWith('TEST_RUNNER_')).toBe(true);
    expect(swift).toContain(
      `environment["${A11Y_CASES_ENV.slice('TEST_RUNNER_'.length)}"]`
    );
  });
});

describe('reportA11yPass', () => {
  const report = (log, cases) => {
    const suite = new Suite('ios', []);
    reportA11yPass({ log, suite, status: 0, testLog: 'test.log', cases });
    return suite;
  };

  it('reports the cases the run read and no others, each with what re-reads it', () => {
    const suite = report([...SWITCH_LINES, passed(A11Y_METHOD)].join('\n'), [
      'switch',
    ]);
    expect(suite.units().auxiliary).toEqual([
      { id: 'a11y:switch', passed: true, rerun: ['--a11y', 'switch'] },
    ]);
    expect(units(suite).results).toEqual({ 'a11y:switch': 'pass' });
    expect(units(suite).filters).toEqual({
      'a11y:switch': ['--a11y', 'switch'],
    });
  });

  it('a case the run read and the pass never printed is a failure, not a gap', () => {
    const suite = report([...SWITCH_LINES, passed(A11Y_METHOD)].join('\n'), [
      'switch',
      'slider',
    ]);
    expect(units(suite).results).toEqual({
      'a11y:switch': 'pass',
      'a11y:slider': 'fail',
    });
  });

  it('a case that breaks the rule fails on its own', () => {
    const run = (label) =>
      units(
        report(
          [...SWITCH_LINES, ...buttonLines(label), passed(A11Y_METHOD)].join(
            '\n'
          ),
          ['switch', 'button']
        )
      ).results;
    expect(run('Real-input button')).toEqual({
      'a11y:switch': 'pass',
      'a11y:button': 'pass',
    });
    expect(run('')).toEqual({ 'a11y:switch': 'pass', 'a11y:button': 'fail' });
  });

  it('reports nothing for a run that read no case', () => {
    expect(report(SWITCH_LINES.join('\n'), []).units().auxiliary).toEqual([]);
  });
});

describe('reportTabTargets', () => {
  it('reports under one id that --tab-targets re-runs', () => {
    const suite = new Suite('ios', []);
    reportTabTargets({
      log: passed(TAB_METHOD),
      suite,
      status: 0,
      testLog: 'test.log',
      appSource: APP,
    });
    expect(suite.units().auxiliary).toEqual([
      { id: 'tab-targets', passed: false, rerun: ['--tab-targets'] },
    ]);
  });
});
