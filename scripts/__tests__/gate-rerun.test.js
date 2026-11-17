import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  completeRerun,
  decideNeed,
  decideWait,
  earlyExitAnswer,
  harnessUnitsFromTimings,
  ledgerLineFromRun,
  planRerunFailed,
  realInputUnitsFromResults,
  RELAXING_SWITCHES,
  renderGateTable,
} from '../gate-core.mjs';
import { Suite } from '../real-input/report.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import {
  DEFAULT_PAIR,
  leaseRecord,
  leasedEnv,
  writeLeaseStore,
} from './helpers/lease-store.js';

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

const TREE = 'f'.repeat(64);
const TREES = { ios: 'i'.repeat(64), android: 'a'.repeat(64) };
const GATE_TREES = {
  'harness:ios': '1'.repeat(64),
  'harness:android': '2'.repeat(64),
  'real-input:ios': '3'.repeat(64),
  'real-input:android': '4'.repeat(64),
};
const now = { tree: TREE, trees: TREES, gateTrees: GATE_TREES };

const UNITS = {
  kind: 'real-input',
  results: { switch: 'pass', form: 'fail', stepper: 'not-run' },
  everyRun: { 'tab-targets': 'pass' },
  unnamed: [],
};

function line(overrides = {}) {
  return ledgerLineFromRun({
    gate: 'real-input:ios',
    command: 'node scripts/real-input/ios.mjs',
    tree: TREE,
    trees: TREES,
    gateTrees: GATE_TREES,
    treeAfter: TREE,
    head: 'abc1234',
    branch: 'task/x',
    durationMs: 3_000_000,
    result: 'fail',
    exitCode: 1,
    startedAt: Date.parse('2026-11-16T10:00:00Z'),
    logPath: 'task/x/real-input+ios-a.log',
    units: UNITS,
    ...overrides,
  });
}

/* ------------------------------- a run's units ------------------------------- */

describe('the units a run records', () => {
  it('a real-input control that never began is not run, never passed', () => {
    const units = realInputUnitsFromResults({
      selected: ['switch', 'form', 'stepper'],
      controls: [
        { id: 'switch', status: 'pass' },
        { id: 'form', status: 'fail' },
      ],
      auxiliary: [{ id: 'tab-targets', passed: true }],
    });
    expect(units.results).toEqual({
      switch: 'pass',
      form: 'fail',
      stepper: 'not-run',
    });
  });

  it("a control's own tree check belongs to its unit; the rest ride every run", () => {
    const units = realInputUnitsFromResults({
      selected: ['form', 'switch'],
      controls: [
        { id: 'form', status: 'pass' },
        { id: 'switch', status: 'pass' },
      ],
      auxiliary: [
        { id: 'form (tree)', passed: false },
        { id: 'a11y:switch', passed: false },
      ],
    });
    expect(units.results).toEqual({ form: 'fail', switch: 'pass' });
    expect(units.everyRun).toEqual({ 'a11y:switch': 'fail' });
  });

  it('an auxiliary check that records what re-runs it is a unit of its own', () => {
    const units = realInputUnitsFromResults({
      selected: ['switch'],
      controls: [{ id: 'switch', status: 'pass' }],
      auxiliary: [
        { id: 'a11y:switch', passed: true, rerun: ['--a11y', 'switch'] },
        { id: 'a11y:slider', passed: false, rerun: ['--a11y', 'slider'] },
        { id: 'tab-targets', passed: false, rerun: ['--tab-targets'] },
        { id: 'a11y', passed: false },
      ],
    });
    expect(units.results).toEqual({
      'switch': 'pass',
      'a11y:switch': 'pass',
      'a11y:slider': 'fail',
      'tab-targets': 'fail',
    });
    expect(units.filters).toEqual({
      'a11y:switch': ['--a11y', 'switch'],
      'a11y:slider': ['--a11y', 'slider'],
      'tab-targets': ['--tab-targets'],
    });
    expect(units.everyRun).toEqual({ a11y: 'fail' });
  });

  it('a missing check is a failure', () => {
    const units = realInputUnitsFromResults({
      selected: ['form'],
      controls: [{ id: 'form', status: 'missing' }],
    });
    expect(units.results.form).toBe('fail');
  });

  it('no results file is no units', () => {
    expect(realInputUnitsFromResults(null)).toBeNull();
  });

  it('the report writes what the units are read from', () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'gate-units-')),
      'units.json'
    );
    const controls = [
      { id: 'switch', title: 's', screen: 'switch' },
      { id: 'form', title: 'f', screen: 'form' },
    ];
    const restore = jestSilence();
    try {
      const suite = new Suite('ios', controls);
      suite.begin(controls[0]).check('ok', true);
      suite.beginAuxiliary('tab-targets', 't').check('ok', true);
      suite.finish({ NITRO_UI_REAL_INPUT_UNITS: file });
    } finally {
      restore();
    }
    const units = realInputUnitsFromResults(
      JSON.parse(fs.readFileSync(file, 'utf8'))
    );
    expect(units.results).toEqual({ switch: 'pass', form: 'not-run' });
  });

  it('a harness file the run was given and that never reported is not run', () => {
    const units = harnessUnitsFromTimings(
      {
        files: ['__tests__/A.harness.tsx', '__tests__/B.harness.tsx'],
        suites: [{ file: '__tests__/A.harness.tsx', status: 'failed' }],
      },
      { files: [], suites: [] }
    );
    expect(units.results).toEqual({
      '__tests__/A.harness.tsx': 'fail',
      '__tests__/B.harness.tsx': 'not-run',
    });
    expect(units.unnamed).toEqual([]);
  });

  it('a failed isolated suite, or none reported at all, is a failure no filter names', () => {
    const shared = {
      files: ['__tests__/A.harness.tsx'],
      suites: [{ file: '__tests__/A.harness.tsx', status: 'passed' }],
    };
    expect(
      harnessUnitsFromTimings(shared, {
        files: ['__tests__/isolated/X.harness.tsx'],
        suites: [
          { file: '__tests__/isolated/X.harness.tsx', status: 'failed' },
        ],
      }).unnamed
    ).toHaveLength(1);
    expect(harnessUnitsFromTimings(shared, null).unnamed).toHaveLength(1);
    expect(
      harnessUnitsFromTimings({ files: ['a'], suites: [] }, null, {
        isolatedExpected: false,
      }).unnamed
    ).toEqual([
      'no test file reported: the run stopped before its first suite',
    ]);
  });
});

/* ------------------------------ the re-run plan ------------------------------ */

describe('planRerunFailed', () => {
  it('re-runs every unit that did not pass, including one that never ran', () => {
    const plan = planRerunFailed({
      gate: 'real-input:ios',
      entries: [line()],
      ...now,
    });
    expect(plan.refusal).toBeNull();
    expect(plan.rerun).toEqual(['form', 'stepper']);
    expect(plan.filterArgs).toEqual([
      '--control',
      'form',
      '--control',
      'stepper',
    ]);
    expect(plan.attempt).toBe(1);
    expect(plan.of.durationMs).toBe(3_000_000);
  });

  it('re-reads failed a11y cases and the tab bar by what their checks recorded', () => {
    const plan = planRerunFailed({
      gate: 'real-input:ios',
      entries: [
        line({
          units: {
            kind: 'real-input',
            results: {
              'switch': 'pass',
              'form': 'fail',
              'a11y:switch': 'pass',
              'a11y:slider': 'fail',
              'a11y:ios-debt': 'fail',
              'tab-targets': 'fail',
            },
            filters: {
              'a11y:switch': ['--a11y', 'switch'],
              'a11y:slider': ['--a11y', 'slider'],
              'a11y:ios-debt': ['--a11y', 'slider', '--a11y', 'stepper'],
              'tab-targets': ['--tab-targets'],
            },
            everyRun: {},
            unnamed: [],
          },
        }),
      ],
      ...now,
    });
    expect(plan.refusal).toBeNull();
    expect(plan.rerun).toEqual([
      'form',
      'a11y:slider',
      'a11y:ios-debt',
      'tab-targets',
    ]);
    expect(plan.filterArgs).toEqual([
      '--control',
      'form',
      '--a11y',
      'slider',
      '--a11y',
      'stepper',
      '--tab-targets',
    ]);
  });

  it('names harness files with a pattern that matches only that file', () => {
    const plan = planRerunFailed({
      gate: 'harness:android',
      entries: [
        line({
          gate: 'harness:android',
          units: {
            kind: 'harness',
            results: {
              '__tests__/Host.harness.tsx': 'fail',
              '__tests__/HostControls.harness.tsx': 'pass',
            },
            everyRun: {},
            unnamed: [],
          },
        }),
      ],
      ...now,
    });
    expect(plan.filterArgs).toEqual(['__tests__/Host.harness']);
  });

  it('refuses when the digest has moved since the red run', () => {
    const plan = planRerunFailed({
      gate: 'real-input:ios',
      entries: [line()],
      ...now,
      gateTrees: { ...GATE_TREES, 'real-input:ios': '9'.repeat(64) },
    });
    expect(plan.refusal).toMatch(
      /no full real-input:ios run is red on the current digest/
    );
  });

  it('refuses a gate that is already green, and one never run', () => {
    expect(
      planRerunFailed({
        gate: 'real-input:ios',
        entries: [line(), line({ result: 'pass', exitCode: 0 })],
        ...now,
      }).refusal
    ).toMatch(/already green/);
    expect(
      planRerunFailed({ gate: 'real-input:ios', entries: [], ...now }).refusal
    ).toMatch(/no full real-input:ios run is red/);
  });

  it('refuses a run that stopped before its report, or failed where no filter reaches', () => {
    expect(
      planRerunFailed({
        gate: 'real-input:ios',
        entries: [line({ units: null })],
        ...now,
      }).refusal
    ).toMatch(/a build failure, or a crash before the first unit/);
    expect(
      planRerunFailed({
        gate: 'real-input:ios',
        entries: [
          line({
            units: {
              ...UNITS,
              results: { switch: 'pass' },
              everyRun: { 'a11y:switch': 'fail' },
            },
          }),
        ],
        ...now,
      }).refusal
    ).toMatch(/a11y:switch, which no filter selects/);
    expect(
      planRerunFailed({
        gate: 'harness:ios',
        entries: [
          line({
            gate: 'harness:ios',
            units: {
              kind: 'harness',
              results: {},
              everyRun: {},
              unnamed: ['x'],
            },
          }),
        ],
        ...now,
      }).refusal
    ).toMatch(/no filter can name: x/);
  });

  it('refuses a filtered name and a gate with no units', () => {
    expect(
      planRerunFailed({ gate: 'check', entries: [], ...now }).refusal
    ).toMatch(/is not one/);
    const filtered = 'real-input:ios:--control:form';
    expect(
      planRerunFailed({
        gate: filtered,
        entries: [line({ gate: filtered })],
        ...now,
      }).refusal
    ).toMatch(/is not one/);
  });

  it('a second attempt starts from the first completion and keeps the original run', () => {
    const first = line({
      command:
        'node scripts/real-input/ios.mjs --control form --control stepper',
      units: {
        ...UNITS,
        results: { switch: 'pass', form: 'fail', stepper: 'pass' },
      },
      completion: {
        of: { ts: 'original', logPath: 'orig.log', durationMs: 3_000_000 },
        attempt: 1,
        rerun: ['form', 'stepper'],
      },
      durationMs: 200_000,
    });
    const plan = planRerunFailed({
      gate: 'real-input:ios',
      entries: [line(), first],
      ...now,
    });
    expect(plan.rerun).toEqual(['form']);
    expect(plan.attempt).toBe(2);
    expect(plan.of.ts).toBe('original');
  });
});

/* ---------------------------- the completion verdict ---------------------------- */

describe('completeRerun', () => {
  const plan = planRerunFailed({
    gate: 'real-input:ios',
    entries: [line()],
    ...now,
  });
  const passing = {
    kind: 'real-input',
    results: { form: 'pass', stepper: 'pass' },
    everyRun: { 'tab-targets': 'pass' },
    unnamed: [],
  };
  const digest = GATE_TREES['real-input:ios'];
  const args = {
    plan,
    childUnits: passing,
    exitCode: 0,
    digestBefore: digest,
    digestAfter: digest,
    gate: 'real-input:ios',
  };

  it('passes only with every re-run unit passed on an unmoved digest', () => {
    const verdict = completeRerun(args);
    expect(verdict).toEqual({
      result: 'pass',
      why: [],
      units: {
        ...UNITS,
        results: { switch: 'pass', form: 'pass', stepper: 'pass' },
      },
    });
  });

  it('fails when the digest moved during the re-run or since the red run', () => {
    expect(completeRerun({ ...args, digestAfter: '0'.repeat(64) }).result).toBe(
      'fail'
    );
    expect(
      completeRerun({
        ...args,
        digestBefore: '0'.repeat(64),
        digestAfter: '0'.repeat(64),
      }).why
    ).toContain('the digest moved between the red run and this one');
  });

  it('fails when a re-run unit did not run, or the re-run exited non-zero', () => {
    const verdict = completeRerun({
      ...args,
      childUnits: { ...passing, results: { form: 'pass' } },
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.why).toContain('stepper did not run');
    expect(completeRerun({ ...args, exitCode: 1 }).result).toBe('fail');
  });

  it('fails when a re-read a11y case or the tab bar fails again', () => {
    const red = planRerunFailed({
      gate: 'real-input:ios',
      entries: [
        line({
          units: {
            kind: 'real-input',
            results: {
              'switch': 'pass',
              'a11y:slider': 'fail',
              'tab-targets': 'fail',
            },
            filters: {
              'a11y:slider': ['--a11y', 'slider'],
              'tab-targets': ['--tab-targets'],
            },
            everyRun: {},
            unnamed: [],
          },
        }),
      ],
      ...now,
    });
    expect(red.filterArgs).toEqual(['--a11y', 'slider', '--tab-targets']);
    const child = (slider, tabs) => ({
      kind: 'real-input',
      results: { 'a11y:slider': slider, 'tab-targets': tabs },
      everyRun: {},
      unnamed: [],
    });
    const green = completeRerun({
      ...args,
      plan: red,
      childUnits: child('pass', 'pass'),
    });
    expect(green.result).toBe('pass');
    expect(green.units.results).toEqual({
      'switch': 'pass',
      'a11y:slider': 'pass',
      'tab-targets': 'pass',
    });
    const again = completeRerun({
      ...args,
      plan: red,
      childUnits: child('pass', 'fail'),
    });
    expect(again.result).toBe('fail');
    expect(again.why).toContain('tab-targets failed again');
    expect(
      completeRerun({
        ...args,
        plan: red,
        childUnits: { ...child('fail', 'pass') },
      }).why
    ).toContain('a11y:slider failed again');
    expect(
      completeRerun({
        ...args,
        plan: red,
        childUnits: {
          ...child('pass', 'pass'),
          results: { 'tab-targets': 'pass' },
        },
      }).why
    ).toContain('a11y:slider did not run');
  });

  it('fails when an every-run check that failed before did not pass now', () => {
    const red = planRerunFailed({
      gate: 'real-input:ios',
      entries: [
        line({ units: { ...UNITS, everyRun: { 'tab-targets': 'fail' } } }),
      ],
      ...now,
    });
    expect(
      completeRerun({
        ...args,
        plan: red,
        childUnits: { ...passing, everyRun: {} },
      }).result
    ).toBe('fail');
  });
});

/* ------------------------- a completed run is never a clean one ------------------------- */

describe('wait after a completion that failed while its re-run exited 0', () => {
  const done = {
    gate: 'real-input:ios',
    pid: 1,
    done: true,
    exitCode: 0,
    result: 'fail',
  };
  const asked = {
    pidAlive: false,
    elapsedMs: 1,
    timeoutMs: 60_000,
    progress: null,
  };

  it('reads the stored result, so a fail is never exit 0', () => {
    const decision = decideWait({ record: done, ...asked });
    expect(decision.exitCode).toBe(1);
    expect(decision.message).toContain('real-input:ios failed');
  });

  it('reads the ledger line the same way when the record is not done', () => {
    const decision = decideWait({
      record: { ...done, done: false },
      ...asked,
      ledgerEntry: { gate: 'real-input:ios', exitCode: 0, result: 'fail' },
    });
    expect(decision.exitCode).toBe(1);
  });
});

describe('a background launcher whose gate ends inside the hand-off window', () => {
  const asked = {
    name: 'real-input:ios',
    logPath: 'task/x/real-input+ios-a.log',
    now: 5,
  };

  it("reports the gate's stored exit code, not its process's", () => {
    const answer = earlyExitAnswer({
      ...asked,
      earlyExit: { code: 0, signal: null },
      record: { done: true, exitCode: 1, result: 'fail' },
    });
    expect(answer.code).toBe(1);
    expect(answer.message).toBe(
      'gate: real-input:ios finished before this launcher handed off (exit 1) - see task/x/real-input+ios-a.log\n'
    );
    expect(answer.record).toBeNull();
  });

  it('reads the stored result when the record has no exit code', () => {
    const answer = (result) =>
      earlyExitAnswer({
        ...asked,
        earlyExit: { code: 0, signal: null },
        record: { done: true, exitCode: null, result },
      }).code;
    expect(answer('fail')).toBe(1);
    expect(answer('pass')).toBe(0);
  });

  it('a gate that never recorded a result could not start, and its record is closed', () => {
    const answer = earlyExitAnswer({
      ...asked,
      earlyExit: { code: 2, signal: null },
      record: { done: false, pid: 7 },
    });
    expect(answer.code).toBe(1);
    expect(answer.message).toContain('exited immediately with 2');
    expect(answer.record).toEqual({
      done: true,
      pid: 7,
      finishedAt: 5,
      exitCode: 2,
      signal: null,
      error: 'exited immediately',
    });
  });
});

describe('a completed run in table, status and need', () => {
  const completed = line({
    result: 'pass',
    exitCode: 0,
    durationMs: 240_000,
    units: {
      ...UNITS,
      results: { switch: 'pass', form: 'pass', stepper: 'pass' },
    },
    completion: {
      of: { ts: 'x', logPath: 'x.log', durationMs: 3_000_000 },
      attempt: 1,
      rerun: ['form', 'stepper'],
    },
  });

  it('the table says it was completed, how many units were re-run and which attempt', () => {
    const table = renderGateTable({ entries: [line(), completed], ...now });
    const row = table
      .split('\n')
      .find((text) => text.startsWith('| `real-input:ios`'));
    expect(row).toContain(
      '**PASS** (completed: 2 of 3 units re-run, attempt 1)'
    );
    expect(row).toContain('4 m 00 s + full run 50 m 00 s');
    expect(row).not.toMatch(/\| \*\*PASS\*\* \|/);
  });

  it('it satisfies the full gate; an ordinary filtered run still satisfies nothing', () => {
    const filtered = line({
      gate: 'real-input:ios:--control:form',
      result: 'pass',
      exitCode: 0,
    });
    const without = decideNeed({
      entries: [line(), filtered],
      ...now,
      stage: 'merge',
    });
    expect(without.missing).toContain('real-input:ios');
    const withCompletion = decideNeed({
      entries: [line(), filtered, completed],
      ...now,
      stage: 'merge',
    });
    expect(withCompletion.missing).not.toContain('real-input:ios');
  });
});

/* ------------------------------ end to end, through the CLI ------------------------------ */

const cleanup = [];
afterAll(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function jestSilence() {
  const original = console.log;
  console.log = () => {};
  return () => {
    console.log = original;
  };
}

function gitEnv(dir) {
  const env = { ...withoutLeaseEnv(process.env) };
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    // A switch inherited from the shell, `CI` on a CI runner, would mark every run relaxed.
    ...RELAXING_SWITCHES,
    // Refused for a full harness gate, so one exported in the shell would fail these runs.
    'NITRO_UI_HARNESS_ISOLATED',
  ]) {
    delete env[name];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    HOME: dir,
  };
}

function git(dir, args) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv(dir),
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/**
 * A checkout with an iOS file and a fake `node`: the real-input runner it stands in for
 * prints its arguments, writes the per-control results the gate asked for, and exits with
 * `FAKE_EXIT`.
 */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-rerun-'));
  cleanup.push(dir);
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  write('nitrogen/generated/ios/NitroUiAutolinking.swift', '// marker\n');
  write('ios/core/Core.swift', 'v1\n');
  write('example/package.json', '{"name":"x"}\n');
  write('.gitignore', '.gates/\nfake-bin/\nstate/\n');
  git(dir, ['init', '-q', '-b', 'main']);
  expect(
    fs.realpathSync(git(dir, ['rev-parse', '--show-toplevel']).trim())
  ).toBe(fs.realpathSync(dir));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-qb', 'task/rerun']);
  const bin = path.join(dir, 'fake-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'node'),
    '#!/bin/sh\n' +
      'echo "fake runner: $*"\n' +
      'echo "$*" >> "$FAKE_ARGS_LOG"\n' +
      'if [ -n "$NITRO_UI_REAL_INPUT_UNITS" ]; then printf \'%s\' "$FAKE_UNITS" > "$NITRO_UI_REAL_INPUT_UNITS"; fi\n' +
      'if [ -n "$HARNESS_SUITE_TIMING" ] && [ -n "$FAKE_TIMING" ]; then printf \'%s\' "$FAKE_TIMING" > "$HARNESS_SUITE_TIMING"; fi\n' +
      'if [ -n "$HARNESS_SUITE_TIMING" ] && [ -n "$FAKE_ISOLATED" ]; then printf \'%s\' "$FAKE_ISOLATED" > "$HARNESS_SUITE_TIMING.isolated.json"; fi\n' +
      // Held until the test says so, for a run that must outlast the launcher's hand-off.
      'if [ -n "$FAKE_HOLD_FILE" ]; then i=0; while [ ! -f "$FAKE_HOLD_FILE" ] && [ $i -lt 1200 ]; do sleep 0.05; i=$((i+1)); done; fi\n' +
      'exit ${FAKE_EXIT:-0}\n'
  );
  fs.chmodSync(path.join(bin, 'node'), 0o755);
  // On PATH rather than through `NITRO_UI_LSOF_BIN`, which marks a run relaxed.
  fs.writeFileSync(path.join(bin, 'lsof'), '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(bin, 'lsof'), 0o755);
  return { dir, bin };
}

const LEASE = leaseRecord({ id: 'RERUN-1', task: 'RERUN', platform: 'ios' });

function runCli({ dir, bin }, args, env = {}) {
  const home = path.join(dir, 'state');
  writeLeaseStore(home, { leases: [LEASE] });
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...gitEnv(dir),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      ...leasedEnv({ home, pair: DEFAULT_PAIR, lease: LEASE }),
      FAKE_ARGS_LOG: path.join(dir, 'state', 'args.log'),
      ...env,
    },
  });
}

function ledger(dir) {
  return fs
    .readFileSync(path.join(dir, '.gates', 'task', 'rerun.jsonl'), 'utf8')
    .split('\n')
    .filter((text) => text.trim() !== '')
    .map((text) => JSON.parse(text));
}

const results = (controls) =>
  JSON.stringify({
    selected: Object.keys(controls),
    controls: Object.entries(controls)
      .filter(([, status]) => status !== 'not-run')
      .map(([id, status]) => ({ id, status })),
    auxiliary: [{ id: 'tab-targets', passed: true }],
  });

/** A harness run's per-suite record, as the suite-timing plugin writes it. */
const timing = (suites) =>
  JSON.stringify({
    version: 1,
    files: Object.keys(suites),
    suites: Object.entries(suites)
      .filter(([, status]) => status !== 'not-run')
      .map(([file, status]) => ({ file, status, durationMs: 1000 })),
  });

describe('gate.mjs harness:ios --rerun-failed, end to end', () => {
  it('re-runs only the test files that did not pass, by a pattern for each, and records the full gate', () => {
    const repo = makeRepo();
    const red = runCli(repo, ['harness:ios'], {
      FAKE_EXIT: '1',
      FAKE_TIMING: timing({
        '__tests__/Switch.harness.tsx': 'passed',
        '__tests__/Form.harness.tsx': 'failed',
        '__tests__/Picker.harness.tsx': 'not-run',
      }),
      FAKE_ISOLATED: timing({
        '__tests__/isolated/Cold.harness.tsx': 'passed',
      }),
    });
    expect(red.status).toBe(1);

    const done = runCli(repo, ['harness:ios', '--rerun-failed'], {
      FAKE_TIMING: timing({
        '__tests__/Form.harness.tsx': 'passed',
        '__tests__/Picker.harness.tsx': 'passed',
      }),
    });
    expect(done.stderr).toContain(
      're-running 2 unit(s) - __tests__/Form.harness.tsx, __tests__/Picker.harness.tsx'
    );
    expect(done.status).toBe(0);
    const args = fs
      .readFileSync(path.join(repo.dir, 'state', 'args.log'), 'utf8')
      .trim()
      .split('\n');
    expect(args[1]).toBe(
      '../scripts/harness.mjs --harnessRunner ios __tests__/Form.harness __tests__/Picker.harness'
    );
    const [, completion] = ledger(repo.dir);
    expect(completion.gate).toBe('harness:ios');
    expect(completion.result).toBe('pass');
    const table = runCli(repo, ['table', '--for', 'merge']);
    expect(table.stdout).toContain(
      '| `harness:ios` | **PASS** (completed: 2 of 3 units re-run, attempt 1)'
    );
  }, 120_000);

  it('fails the completion when a re-run file does not report', () => {
    const repo = makeRepo();
    runCli(repo, ['harness:ios'], {
      FAKE_EXIT: '1',
      FAKE_TIMING: timing({
        '__tests__/Switch.harness.tsx': 'passed',
        '__tests__/Form.harness.tsx': 'failed',
      }),
      FAKE_ISOLATED: timing({}),
    });
    const done = runCli(repo, ['harness:ios', '--rerun-failed'], {
      FAKE_TIMING: timing({ '__tests__/Switch.harness.tsx': 'passed' }),
    });
    expect(done.status).toBe(1);
    const [, completion] = ledger(repo.dir);
    expect(completion.result).toBe('fail');
  }, 120_000);
});

describe('gate.mjs real-input:ios --rerun-failed, end to end', () => {
  it('re-runs only what did not pass, records it under the full gate, and the table says so', () => {
    const repo = makeRepo();
    const red = runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: results({ switch: 'pass', form: 'fail', stepper: 'not-run' }),
    });
    expect(red.status).toBe(1);
    expect(ledger(repo.dir)[0].units.results).toEqual({
      switch: 'pass',
      form: 'fail',
      stepper: 'not-run',
    });

    const done = runCli(repo, ['real-input:ios', '--rerun-failed'], {
      FAKE_UNITS: results({ form: 'pass', stepper: 'pass' }),
    });
    expect(done.stderr).toContain('re-running 2 unit(s) - form, stepper');
    expect(done.status).toBe(0);
    const args = fs
      .readFileSync(path.join(repo.dir, 'state', 'args.log'), 'utf8')
      .trim()
      .split('\n');
    expect(args[1]).toBe(
      'scripts/real-input/ios.mjs --control form --control stepper'
    );
    const [, completion] = ledger(repo.dir);
    expect(completion.gate).toBe('real-input:ios');
    expect(completion.result).toBe('pass');
    expect(completion.completion.attempt).toBe(1);

    const table = runCli(repo, ['table', '--for', 'merge']);
    expect(table.stdout).toContain(
      '| `real-input:ios` | **PASS** (completed: 2 of 3 units re-run, attempt 1)'
    );
    const status = runCli(repo, ['status', '--for', 'merge']);
    expect(status.stdout).toMatch(
      /green\s+real-input:ios .*completed: 2 of 3 units re-run, attempt 1/
    );
  }, 120_000);

  it('completes a red run whose only failures are a11y cases and the tab bar, and stays red when they fail again', () => {
    const repo = makeRepo();
    const report = (aux) =>
      JSON.stringify({ selected: [], controls: [], auxiliary: aux });
    const red = runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: JSON.stringify({
        selected: ['switch'],
        controls: [{ id: 'switch', status: 'pass' }],
        auxiliary: [
          { id: 'tab-targets', passed: false, rerun: ['--tab-targets'] },
          { id: 'a11y:switch', passed: true, rerun: ['--a11y', 'switch'] },
          { id: 'a11y:slider', passed: false, rerun: ['--a11y', 'slider'] },
        ],
      }),
    });
    expect(red.status).toBe(1);

    const again = runCli(repo, ['real-input:ios', '--rerun-failed'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: report([
        { id: 'tab-targets', passed: true, rerun: ['--tab-targets'] },
        { id: 'a11y:slider', passed: false, rerun: ['--a11y', 'slider'] },
      ]),
    });
    expect(again.stderr).toContain(
      're-running 2 unit(s) - tab-targets, a11y:slider'
    );
    expect(again.status).toBe(1);
    expect(ledger(repo.dir)[1].result).toBe('fail');

    const done = runCli(repo, ['real-input:ios', '--rerun-failed'], {
      FAKE_UNITS: report([
        { id: 'a11y:slider', passed: true, rerun: ['--a11y', 'slider'] },
      ]),
    });
    expect(done.status).toBe(0);
    const args = fs
      .readFileSync(path.join(repo.dir, 'state', 'args.log'), 'utf8')
      .trim()
      .split('\n');
    // The second attempt re-reads only what the first left red.
    expect(args.slice(1)).toEqual([
      'scripts/real-input/ios.mjs --tab-targets --a11y slider',
      'scripts/real-input/ios.mjs --a11y slider',
    ]);
    const completion = ledger(repo.dir)[2];
    expect(completion.gate).toBe('real-input:ios');
    expect(completion.result).toBe('pass');
    expect(completion.completion.attempt).toBe(2);
  }, 120_000);

  it('a completion whose re-run exits 0 but leaves a unit unreported is stored and waited on as failed', () => {
    const repo = makeRepo();
    runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: results({ switch: 'pass', form: 'fail' }),
    });
    const hold = path.join(repo.dir, 'state', 'release-runner');
    const started = runCli(
      repo,
      ['real-input:ios', '--rerun-failed', '--background'],
      {
        FAKE_EXIT: '0',
        FAKE_UNITS: results({ switch: 'pass' }),
        FAKE_HOLD_FILE: hold,
      }
    );
    // The runner is still held, so the launcher has handed off.
    expect(started.stdout).toContain(
      'real-input:ios started in the background'
    );
    expect(started.status).toBe(0);
    fs.writeFileSync(hold, '');
    const waited = runCli(repo, [
      'wait',
      '--gate',
      'real-input:ios',
      '--timeout-minutes',
      '1',
    ]);
    expect(waited.stderr).toContain('real-input:ios failed with exit 1');
    expect(waited.status).toBe(1);
    const [, completion] = ledger(repo.dir);
    expect(completion.result).toBe('fail');
    expect(completion.exitCode).toBe(1);
  }, 120_000);

  it('the same completion with the runner unheld is failed whichever side of the hand-off it ends on', () => {
    const repo = makeRepo();
    runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: results({ switch: 'pass', form: 'fail' }),
    });
    const started = runCli(
      repo,
      ['real-input:ios', '--rerun-failed', '--background'],
      { FAKE_EXIT: '0', FAKE_UNITS: results({ switch: 'pass' }) }
    );
    // Ended inside the window: the launcher reports the stored failure itself.
    // Ended after it: the launcher handed off, and `wait` reports it below.
    if (started.status === 0) {
      expect(started.stdout).toContain(
        'real-input:ios started in the background'
      );
    } else {
      expect(started.stderr).toContain('handed off (exit 1)');
      expect(started.status).toBe(1);
    }
    const waited = runCli(repo, [
      'wait',
      '--gate',
      'real-input:ios',
      '--timeout-minutes',
      '1',
    ]);
    expect(waited.stderr).toContain('real-input:ios failed with exit 1');
    expect(waited.status).toBe(1);
    const [, completion] = ledger(repo.dir);
    expect(completion.result).toBe('fail');
    expect(completion.exitCode).toBe(1);
  }, 120_000);

  it("a completion carries the red run's relaxing switches and judging digest, never its own clean shell's", () => {
    const repo = makeRepo();
    runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: results({ switch: 'pass', form: 'fail' }),
      NITRO_UI_ALLOW_UNSTAMPED: '1',
    });
    const done = runCli(repo, ['real-input:ios', '--rerun-failed'], {
      FAKE_UNITS: results({ form: 'pass' }),
    });
    expect(done.status).toBe(0);
    const [red, completion] = ledger(repo.dir);
    expect(red.relaxed).toEqual({ NITRO_UI_ALLOW_UNSTAMPED: '1' });
    expect(completion.result).toBe('pass');
    expect(completion.relaxed).toEqual({ NITRO_UI_ALLOW_UNSTAMPED: '1' });
    expect(completion.judge).toBe(red.judge);
  }, 120_000);

  it('a completion of a red run that recorded no switches or judging digest records neither', () => {
    const repo = makeRepo();
    runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: results({ switch: 'pass', form: 'fail' }),
    });
    const file = path.join(repo.dir, '.gates', 'task', 'rerun.jsonl');
    const [red] = ledger(repo.dir);
    const older = { ...red, v: red.v - 1 };
    delete older.relaxed;
    delete older.judge;
    fs.writeFileSync(file, `${JSON.stringify(older)}\n`);
    const done = runCli(repo, ['real-input:ios', '--rerun-failed'], {
      FAKE_UNITS: results({ form: 'pass' }),
    });
    expect(done.status).toBe(0);
    const [, completion] = ledger(repo.dir);
    expect(completion.result).toBe('pass');
    expect(completion.relaxed).toBeNull();
    expect(completion.judge).toBeNull();
  }, 120_000);

  it('refuses after the digest moved, and records nothing', () => {
    const repo = makeRepo();
    runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: results({ switch: 'pass', form: 'fail' }),
    });
    fs.writeFileSync(path.join(repo.dir, 'ios/core/Core.swift'), 'v2\n');
    const refused = runCli(repo, ['real-input:ios', '--rerun-failed'], {
      FAKE_UNITS: results({ form: 'pass' }),
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(
      'refused before the run - no full real-input:ios run is red on the current digest'
    );
    expect(ledger(repo.dir)).toHaveLength(1);
  }, 120_000);

  it('refuses before starting the runner when the digest moves after the plan', () => {
    const repo = makeRepo();
    runCli(repo, ['real-input:ios'], {
      FAKE_EXIT: '1',
      FAKE_UNITS: results({ switch: 'pass', form: 'fail' }),
    });
    // The Metro pre-flight's `lsof` runs between the plan and the run: this one edits
    // an iOS file there, then says the port is free.
    const lsof = path.join(repo.bin, 'lsof-that-edits');
    fs.writeFileSync(
      lsof,
      `#!/bin/sh\nprintf 'v2\\n' > "${path.join(repo.dir, 'ios/core/Core.swift')}"\nexit 1\n`
    );
    fs.chmodSync(lsof, 0o755);
    const refused = runCli(repo, ['real-input:ios', '--rerun-failed'], {
      NITRO_UI_LSOF_BIN: lsof,
      FAKE_UNITS: results({ form: 'pass' }),
    });
    expect(refused.stderr).toContain('re-running 1 unit(s) - form');
    expect(refused.stderr).toContain(
      'refused before the run - the real-input:ios digest moved since the red run'
    );
    expect(refused.status).toBe(1);
    expect(ledger(repo.dir)).toHaveLength(1);
    const args = fs
      .readFileSync(path.join(repo.dir, 'state', 'args.log'), 'utf8')
      .trim()
      .split('\n');
    expect(args).toHaveLength(1);
  }, 120_000);

  it('refuses a filter on the command line: it chooses the units itself', () => {
    const repo = makeRepo();
    for (const args of [
      ['real-input:ios', '--rerun-failed', '--', '--control', 'form'],
      ['real-input:ios:--control:form', '--rerun-failed'],
    ]) {
      const refused = runCli(repo, args);
      expect(refused.stderr).toContain(
        'takes the full gate name and no filter'
      );
      expect(refused.status).toBe(2);
    }
  }, 120_000);

  it('refuses a run that left no per-control results', () => {
    const repo = makeRepo();
    runCli(repo, ['real-input:ios'], { FAKE_EXIT: '1', FAKE_UNITS: '' });
    const refused = runCli(repo, ['real-input:ios', '--rerun-failed']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(
      'a build failure, or a crash before the first unit'
    );
  }, 120_000);
});
