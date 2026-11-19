import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  quarantineList,
  recordResults,
} from '../real-input/android-results.mjs';
import { REAL_INPUT_CONTROLS } from '../real-input/controls.mjs';
import { Suite } from '../real-input/report.mjs';
import {
  ledgerLineFromRun,
  planRerunFailed,
  realInputUnitsFromResults,
} from '../gate-core.mjs';

const control = (id) => REAL_INPUT_CONTROLS.find((entry) => entry.id === id);

const SWITCH_FILE = 'real-input/switch.e2e.ts';
const SLIDER_FILE = 'real-input/slider.e2e.ts';

const SWITCH_SOURCE = [
  "import { test } from '@e2e-dev/mobile';",
  '',
  "test('a real tap flips the switch once', async () => {});",
  '',
  '// QUARANTINED 2026-11-18: the second drag reads the tree before it settles.',
  '// Listed in docs/tasks/FOLLOWUPS.md "Quarantined tests".',
  "test.skip('a drag across the switch flips it once', async () => {});",
  '',
  "test.skip('a long press on the switch flips nothing', async () => {});",
  '',
  '// QUARANTINED 2026-11-19: the label tap lands during the ripple.',
  "test.skip('a tap on the label flips the switch', async () => {});",
  '',
  '// The thumb is drawn by the platform, not by the library.',
  "test.skip('the thumb follows the finger', async () => {});",
  '',
  '// QUARANTINED 2026-11-19: skipped from inside its own body.',
  "test('an inline skip', async () => { test.skip(); });",
].join('\n');

const FOLLOWUPS = [
  '# Follow-ups',
  '',
  '## Quarantined tests',
  '',
  'Tests skipped with a `QUARANTINED <date>` comment after a second sighting.',
  '',
  '- `switch.e2e.ts` "a drag across the switch flips it once"',
  '  (Android), quarantined 2026-11-18. It failed twice in a row.',
  '- `switch.e2e.ts` "a long press on the switch flips nothing" (Android).',
  '- `slider.e2e.ts` "a tap on the label flips the switch" (Android), the',
  '  same title in another file.',
  '- `switch.e2e.ts` "the thumb follows the finger" (Android).',
  '- `switch.e2e.ts` "an inline skip" (Android).',
  '- `slider.e2e.ts` "a title long enough to',
  '  wrap onto a second line" (Android).',
  '',
  'Triaged notes follow, with no heading of their own:',
  '',
  '- `switch.e2e.ts` "a tap on the label flips the switch", listed outside the section.',
].join('\n');

function test(file, title, line, status, skip) {
  return {
    kind: 'test',
    file,
    titlePath: [title],
    source: { file, line, column: 1 },
    status,
    ...(skip == null ? {} : { skip }),
    ...(status === 'failed'
      ? { error: { message: 'expected 1 press, saw 2\n  at ...' } }
      : {}),
  };
}

const PASSED = test(
  SWITCH_FILE,
  'a real tap flips the switch once',
  3,
  'passed'
);
const QUARANTINED = test(
  SWITCH_FILE,
  'a drag across the switch flips it once',
  7,
  'skipped',
  { cause: 'explicit', reason: 'skipped' }
);
const NO_COMMENT = test(
  SWITCH_FILE,
  'a long press on the switch flips nothing',
  9,
  'skipped',
  { cause: 'explicit', reason: 'skipped' }
);
const UNLISTED = test(
  SWITCH_FILE,
  'a tap on the label flips the switch',
  12,
  'skipped',
  { cause: 'explicit', reason: 'skipped' }
);
const OTHER_COMMENT = test(
  SWITCH_FILE,
  'the thumb follows the finger',
  15,
  'skipped',
  { cause: 'explicit', reason: 'skipped' }
);

const INLINE_SKIP = test(SWITCH_FILE, 'an inline skip', 18, 'skipped', {
  cause: 'explicit',
  reason: 'skipped',
});

const sources = {
  followups: FOLLOWUPS,
  readTestFile: (file) => (file === SWITCH_FILE ? SWITCH_SOURCE : null),
};

let log;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
});

const printed = () => log.mock.calls.map((call) => String(call[0]));

/** One switch control run against the given report results. */
function runSwitch(results) {
  const suite = new Suite('android', [control('switch')]);
  const passed = recordResults(
    suite,
    [control('switch')],
    { results },
    sources
  );
  return { suite, passed, failures: suite.results[0]?.log?.failures ?? [] };
}

describe('quarantineList', () => {
  it('reads file and title from the section only, across wrapped items', () => {
    expect(quarantineList(FOLLOWUPS)).toEqual([
      {
        file: 'switch.e2e.ts',
        title: 'a drag across the switch flips it once',
      },
      {
        file: 'switch.e2e.ts',
        title: 'a long press on the switch flips nothing',
      },
      { file: 'slider.e2e.ts', title: 'a tap on the label flips the switch' },
      { file: 'switch.e2e.ts', title: 'the thumb follows the finger' },
      { file: 'switch.e2e.ts', title: 'an inline skip' },
      {
        file: 'slider.e2e.ts',
        title: 'a title long enough to wrap onto a second line',
      },
    ]);
    expect(quarantineList(null)).toEqual([]);
    expect(quarantineList('# Follow-ups\n\n- `switch.e2e.ts` "x"\n')).toEqual(
      []
    );
  });
});

describe('recordResults on an Android e2e report', () => {
  it('passes a control whose only skip is quarantined, and prints it as quarantined', () => {
    const { suite, passed, failures } = runSwitch([PASSED, QUARANTINED]);
    expect(passed).toBe(true);
    expect(failures).toEqual([]);
    expect(printed()).toContain(
      '    QUARANTINED a drag across the switch flips it once — skipped, listed in docs/tasks/FOLLOWUPS.md'
    );
    expect(suite.finish({})).toBe(0);
    expect(printed()).toContain('\nQUARANTINED 1 test(s) skipped, not run:');
    expect(suite.units().controls).toEqual([{ id: 'switch', status: 'pass' }]);
  });

  it('fails a skip with no QUARANTINED comment above it, saying so', () => {
    const { passed, failures } = runSwitch([PASSED, NO_COMMENT]);
    expect(passed).toBe(false);
    expect(failures).toEqual([
      'a long press on the switch flips nothing — skipped, which is not a pass: ' +
        'no "// QUARANTINED <YYYY-MM-DD>" comment on the line above its test.skip( ' +
        '(real-input/switch.e2e.ts:9)',
    ]);
  });

  it('does not take a comment without the QUARANTINED date for one', () => {
    const { passed, failures } = runSwitch([PASSED, OTHER_COMMENT]);
    expect(passed).toBe(false);
    expect(failures).toEqual([
      'the thumb follows the finger — skipped, which is not a pass: ' +
        'no "// QUARANTINED <YYYY-MM-DD>" comment on the line above its test.skip( ' +
        '(real-input/switch.e2e.ts:15)',
    ]);
  });

  it('fails a commented skip FOLLOWUPS lists only for another file or outside the section', () => {
    const { passed, failures } = runSwitch([PASSED, UNLISTED]);
    expect(passed).toBe(false);
    expect(failures).toEqual([
      'a tap on the label flips the switch — skipped, which is not a pass: ' +
        '`switch.e2e.ts` "a tap on the label flips the switch" is not listed under ' +
        '"Quarantined tests" in docs/tasks/FOLLOWUPS.md',
    ]);
  });

  it('fails a skip called inside a test body, whose body ran up to it', () => {
    const { passed, failures } = runSwitch([PASSED, INLINE_SKIP]);
    expect(passed).toBe(false);
    expect(failures).toEqual([
      'an inline skip — skipped, which is not a pass: ' +
        'real-input/switch.e2e.ts:18 is not a test.skip( line',
    ]);
  });

  it('fails a listed, commented skip when FOLLOWUPS cannot be read', () => {
    const suite = new Suite('android', [control('switch')]);
    expect(
      recordResults(
        suite,
        [control('switch')],
        { results: [QUARANTINED] },
        {
          ...sources,
          followups: null,
        }
      )
    ).toBe(false);
  });

  it('fails a test the runner skipped, whatever the source and FOLLOWUPS say', () => {
    const { passed, failures } = runSwitch([
      PASSED,
      { ...QUARANTINED, skip: { cause: 'serial-predecessor-failed' } },
    ]);
    expect(passed).toBe(false);
    expect(failures).toEqual([
      'a drag across the switch flips it once — skipped, which is not a pass: ' +
        'it was skipped by the runner (serial-predecessor-failed), not by test.skip',
    ]);
  });

  it('fails a quarantined skip whose report line is not the test.skip( line', () => {
    const { passed, failures } = runSwitch([
      PASSED,
      { ...QUARANTINED, source: { line: 6 } },
    ]);
    expect(passed).toBe(false);
    expect(failures[0]).toMatch(
      /real-input\/switch\.e2e\.ts:6 is not a test\.skip\( line/
    );
  });

  it('still fails a control whose file collected no test', () => {
    const suite = new Suite('android', [control('switch'), control('slider')]);
    const passed = recordResults(
      suite,
      [control('switch'), control('slider')],
      { results: [PASSED, QUARANTINED] },
      sources
    );
    expect(passed).toBe(false);
    expect(suite.units().controls).toEqual([
      { id: 'switch', status: 'pass' },
      { id: 'slider', status: 'missing' },
    ]);
  });
});

describe('--rerun-failed after a run with a quarantined test', () => {
  it('re-runs the control that failed and not the one holding the quarantine', () => {
    const suite = new Suite('android', [control('switch'), control('slider')]);
    recordResults(
      suite,
      [control('switch'), control('slider')],
      {
        results: [
          PASSED,
          QUARANTINED,
          test(SLIDER_FILE, 'a drag moves the thumb', 4, 'failed'),
        ],
      },
      sources
    );
    expect(suite.finish({})).toBe(1);
    const units = realInputUnitsFromResults(suite.units());
    expect(units.results).toEqual({ switch: 'pass', slider: 'fail' });

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
    expect(plan.rerun).toEqual(['slider']);
  });
});
