import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CI_GATE,
  CI_JOB_NAME,
  CI_WORKFLOW_PATH,
  ciArtifactOf,
  ciImportRefusals,
  ciLedgerLine,
  hostedRunRelaxed,
} from '../gate-ci-core.mjs';
import { readUploadedRun } from '../gate-ci.mjs';
import { REAL_INPUT_CONTROLS } from '../real-input/controls.mjs';
import {
  decideNeed,
  gateRowFor,
  planRerunFailed,
  RELAXING_SWITCHES,
  renderGateTable,
  rerunOfUnits,
} from '../gate-core.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';

/*
 * The fixtures are cut from two real hosted runs of the trial job: a green one and
 * one whose `form` keyboard case failed. Each keeps the e2e report's verdict fields,
 * the units the job log printed, and the "Run real input" step's times and exit.
 */
const FIXTURES = path.join(
  process.cwd(),
  'scripts/__tests__/fixtures/ci-android'
);
const green = () => readUploadedRun(path.join(FIXTURES, 'green/full'));
const red = () => readUploadedRun(path.join(FIXTURES, 'red/full'));

const GREEN_SHA = green().record.sha;

/** The controls the fixtures ran, which a full run of their day selected. */
const FIXTURE_CONTROLS = REAL_INPUT_CONTROLS.filter((control) =>
  green().results.selected.includes(control.id)
);

/**
 * An upload as a full run of today's controls: a control added since the fixtures
 * were cut gets a passing test, and one removed since is dropped.
 */
function ofTodaysControls(upload) {
  const today = REAL_INPUT_CONTROLS.map((control) => control.id);
  const added = today.filter((id) => !upload.results.selected.includes(id));
  return {
    ...upload,
    results: {
      ...upload.results,
      selected: today,
      controls: [
        ...upload.results.controls.filter((control) =>
          today.includes(control.id)
        ),
        ...added.map((id) => ({ id, status: 'pass' })),
      ],
    },
    report: {
      ...upload.report,
      run: {
        ...upload.report.run,
        results: [
          ...upload.report.run.results.filter((result) =>
            today.some((id) => result.file === `real-input/${id}.e2e.ts`)
          ),
          ...added.map((id) => ({
            kind: 'test',
            file: `real-input/${id}.e2e.ts`,
            titlePath: [`${id} passes`],
            status: 'passed',
          })),
        ],
      },
    },
  };
}
const RED_SHA = red().record.sha;

/** A run of the suite moved to another commit, record and report alike. */
function ofCommit(run, sha) {
  return {
    ...run,
    record: { ...run.record, sha },
    report:
      run.report == null
        ? null
        : {
            ...run.report,
            run: { ...run.report.run, vcs: { commit: sha, dirty: false } },
          },
  };
}

/**
 * The re-run a completion of the red run asks for: `--control form`, whose report is
 * the green hosted run's `form` tests, on the red run's commit.
 */
function formRerun(overrides = {}) {
  const passed = green();
  const results = red().results;
  return {
    record: {
      ...red().record,
      args: ['--control', 'form'],
      startedAt: '2026-11-25T19:06:00Z',
      finishedAt: '2026-11-25T19:15:00Z',
      exitCode: 0,
      ...overrides,
    },
    results: {
      platform: 'android',
      selected: ['form'],
      controls: [{ id: 'form', status: 'pass' }],
      auxiliary: results.auxiliary.filter((check) =>
        check.id.startsWith('a11y:')
      ),
    },
    report: {
      ...passed.report,
      run: {
        ...passed.report.run,
        vcs: { commit: RED_SHA, dirty: false },
        results: passed.report.run.results.filter(
          (result) => result.file === 'real-input/form.e2e.ts'
        ),
      },
    },
  };
}

const QUARANTINED_TITLE =
  'a drag up on the two-detent header expands the sheet, Back steps down a detent, and a second Back closes it';

/** Stand-ins for the files the one quarantined test is checked against. */
const SOURCES = {
  followups:
    '## Quarantined tests\n\n' +
    `- \`bottom-sheet.e2e.ts\` "${QUARANTINED_TITLE}" — its fix task\n`,
  readTestFile: (file) =>
    file === 'real-input/bottom-sheet.e2e.ts'
      ? `${'\n'.repeat(242)}// QUARANTINED 2026-11-24\ntest.skip('${QUARANTINED_TITLE}', async () => {});\n`
      : null,
};

const TREES = { ios: 'i'.repeat(64), android: 'a'.repeat(64) };
const GATE_TREES = {
  'harness:ios': '1'.repeat(64),
  'harness:android': '2'.repeat(64),
  'real-input:ios': '3'.repeat(64),
  'real-input:android': '4'.repeat(64),
};
const JUDGE = 'j'.repeat(64);
const NOW = {
  tree: 'f'.repeat(64),
  trees: TREES,
  gateTrees: GATE_TREES,
  judge: JUDGE,
};
const SOURCE = {
  kind: 'github-actions',
  runId: 123,
  attempt: 1,
  jobId: 456,
  url: 'https://github.com/o/r/actions/runs/123/job/456',
};

function imported({
  full,
  rerun = null,
  head,
  sources = SOURCES,
  digests = NOW,
}) {
  return ciLedgerLine({
    source: SOURCE,
    head,
    branch: 'task/ci',
    before: digests,
    after: digests,
    full,
    rerun,
    sources,
    controls: FIXTURE_CONTROLS,
  });
}

const rowHere = (line) => gateRowFor({ gate: CI_GATE, list: [line], ...NOW });
const rowElsewhere = (line) =>
  gateRowFor({ gate: CI_GATE, foreign: [line], ...NOW });

/* ------------------------------- which run ------------------------------- */

describe('which run may be imported', () => {
  const RUN = {
    id: 123,
    head_sha: GREEN_SHA,
    status: 'completed',
    path: CI_WORKFLOW_PATH,
    run_attempt: 1,
  };
  const JOBS = [
    { name: 'Checks', status: 'completed' },
    { name: CI_JOB_NAME, status: 'completed', id: 456 },
  ];
  const refusals = (overrides = {}) =>
    ciImportRefusals({
      run: RUN,
      jobs: JOBS,
      head: GREEN_SHA,
      dirty: [],
      ...overrides,
    });

  it('takes a finished run of HEAD from the workflow and job it names', () => {
    expect(refusals()).toEqual([]);
  });

  it('refuses a run of another commit, and names both', () => {
    const reasons = refusals({ head: RED_SHA });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(`ran commit ${GREEN_SHA.slice(0, 12)}`);
    expect(reasons[0]).toContain(`HEAD is ${RED_SHA.slice(0, 12)}`);
  });

  it('refuses uncommitted changes, an unfinished run or job, another workflow, another job', () => {
    expect(refusals({ dirty: [' M src/index.ts'] })[0]).toContain(
      'uncommitted changes ( M src/index.ts)'
    );
    expect(refusals({ run: { ...RUN, status: 'in_progress' } })[0]).toContain(
      'not finished (in_progress)'
    );
    expect(
      refusals({ jobs: [{ name: CI_JOB_NAME, status: 'in_progress' }] })[0]
    ).toContain('is not finished (in_progress)');
    expect(
      refusals({ run: { ...RUN, path: '.github/workflows/release.yml' } })[0]
    ).toContain('is of .github/workflows/release.yml');
    // The trial job ran as a matrix; none of its jobs is this one.
    expect(
      refusals({
        jobs: [
          { name: `${CI_JOB_NAME} 1`, status: 'completed' },
          { name: `${CI_JOB_NAME} 2`, status: 'completed' },
        ],
      })[0]
    ).toContain(`no job(s) named "${CI_JOB_NAME}"`);
  });

  it('refuses an attempt already in the ledger', () => {
    const { line } = imported({ full: green(), head: GREEN_SHA });
    expect(refusals({ entries: [line] })[0]).toContain('already in');
    expect(
      refusals({ entries: [line], run: { ...RUN, run_attempt: 2 } })
    ).toEqual([]);
  });

  it('refuses a job that started before a line already deciding on this code, and says why', () => {
    // A local red run of 18:08:46, then a CI job that started at 16:20 and went green.
    const newerRed = {
      ...imported({ full: red(), head: GREEN_SHA }).line,
      source: null,
    };
    const jobAt = (started_at) => [
      { name: 'Checks', status: 'completed' },
      { name: CI_JOB_NAME, status: 'completed', id: 456, started_at },
    ];
    const reasons = refusals({
      jobs: jobAt('2026-11-25T16:20:00Z'),
      entries: [newerRed],
      digests: NOW,
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(
      'job started at 2026-11-25T16:20:00.000Z, before the red real-input:android run of 2026-11-25T18:08:46.000Z'
    );
    expect(reasons[0]).toContain('importing it would replace newer evidence');
    // Importing it anyway would turn the newer red green on this branch.
    const { line: olderGreen } = imported({ full: green(), head: GREEN_SHA });
    expect(
      gateRowFor({ gate: CI_GATE, list: [newerRed, olderGreen], ...NOW }).state
    ).toBe('green');

    // Re-running only the failed jobs moves the run's start to the new attempt and
    // carries this job over with its old times: the job's start still decides.
    expect(
      refusals({
        run: { ...RUN, run_attempt: 2, run_started_at: '2026-11-25T19:00:00Z' },
        jobs: jobAt('2026-11-25T16:20:00Z'),
        entries: [newerRed],
        digests: NOW,
      })[0]
    ).toContain('importing it would replace newer evidence');

    // A job that started after it, or a line on other code, does not stand in the way.
    expect(
      refusals({
        jobs: jobAt('2026-11-25T18:30:00Z'),
        entries: [newerRed],
        digests: NOW,
      })
    ).toEqual([]);
    expect(
      refusals({
        jobs: jobAt('2026-11-25T16:20:00Z'),
        entries: [newerRed],
        digests: {
          ...NOW,
          gateTrees: { ...GATE_TREES, 'real-input:android': '5'.repeat(64) },
        },
      })
    ).toEqual([]);
    expect(refusals({ entries: [newerRed], digests: NOW })[0]).toContain(
      'does not say when it started'
    );
  });
});

describe("which upload is the imported job's", () => {
  // Attempt 1 ran 16:00-17:00 and uploaded; "Re-run all jobs" made attempt 2,
  // which ran 18:00-18:10 and stopped before the suite.
  const ATTEMPT_1 = {
    id: 901,
    name: 'real-input-android',
    created_at: '2026-11-25T16:59:00Z',
    expired: false,
  };
  const JOB_2 = {
    name: CI_JOB_NAME,
    started_at: '2026-11-25T18:00:00Z',
    completed_at: '2026-11-25T18:10:00Z',
  };

  it('takes the one artifact of that name created while the job ran', () => {
    const attempt2 = {
      ...ATTEMPT_1,
      id: 902,
      created_at: '2026-11-25T18:09:00Z',
    };
    const logs = { ...attempt2, id: 903, name: 'real-input-android-logs' };
    expect(
      ciArtifactOf({ artifacts: [ATTEMPT_1, logs, attempt2], job: JOB_2 })
    ).toEqual({ artifact: attempt2, refusal: null });
  });

  it("refuses an attempt that uploaded nothing, rather than taking another attempt's report", () => {
    const { artifact, refusal } = ciArtifactOf({
      artifacts: [ATTEMPT_1],
      job: JOB_2,
    });
    expect(artifact).toBeNull();
    expect(refusal).toContain(
      'no real-input-android artifact(s) were created while the job ran (2026-11-25T18:00:00.000Z to 2026-11-25T18:10:00.000Z; the run has 1)'
    );
  });

  it('refuses two uploads inside the job, and a job with no times', () => {
    const twice = [
      { ...ATTEMPT_1, id: 902, created_at: '2026-11-25T18:05:00Z' },
      { ...ATTEMPT_1, id: 904, created_at: '2026-11-25T18:09:00Z' },
    ];
    expect(ciArtifactOf({ artifacts: twice, job: JOB_2 }).refusal).toContain(
      '2 real-input-android artifact(s) were created while the job ran'
    );
    expect(
      ciArtifactOf({ artifacts: twice, job: { name: CI_JOB_NAME } }).refusal
    ).toContain('does not say when it ran');
  });
});

/* ------------------------------ the verdict ------------------------------ */

describe('a run is judged from what it uploaded', () => {
  it('the green hosted run is green: every unit passed, and the quarantined test only prints', () => {
    const { line, full } = imported({ full: green(), head: GREEN_SHA });
    expect(line.result).toBe('pass');
    expect(line.exitCode).toBe(0);
    expect(line.completion).toBeNull();
    expect(Object.keys(line.units.results)).toHaveLength(52);
    expect(Object.values(line.units.results).every((s) => s === 'pass')).toBe(
      true
    );
    expect(line.units.everyRun).toEqual({});
    expect(full.quarantined).toEqual([
      expect.stringMatching(/^bottom-sheet: a drag up .* skipped, listed in/),
    ]);
    expect(line.source).toEqual(SOURCE);
    expect(line.command).toBe('node scripts/real-input/android.mjs');
    expect(line.ts).toBe('2026-11-25T16:20:50.000Z');
    expect(line.durationMs).toBe(56 * 60_000 + 37_000);
    expect(line.relaxed).toEqual({});
    expect(line.judge).toBe(JUDGE);
  });

  it('the red hosted run is red on form alone', () => {
    const { line, full } = imported({ full: red(), head: RED_SHA });
    expect(line.result).toBe('fail');
    expect(
      Object.entries(line.units.results).filter(([, s]) => s !== 'pass')
    ).toEqual([['form', 'fail']]);
    expect(full.failures).toEqual([
      'form: a field the keyboard would cover is moved clear of it: failed',
    ]);
  });

  it('a report with a failed control is red even when the job exited 0 and its units say it passed', () => {
    const lying = red();
    lying.record = { ...lying.record, exitCode: 0 };
    lying.results = {
      ...lying.results,
      controls: lying.results.controls.map((control) => ({
        ...control,
        status: 'pass',
      })),
    };
    const { line, full } = imported({ full: lying, head: RED_SHA });
    expect(line.result).toBe('fail');
    expect(line.exitCode).toBe(1);
    expect(line.units.results.form).toBe('fail');
    expect(full.why).toContain(
      'form: the uploaded results say it passed, and the e2e report does not'
    );
  });

  it('a run that exited non-zero is red even when every control passed', () => {
    // The exit code alone carries the whole-run checks: the deadline, an e2e run
    // error, an empty a11y sweep.
    const exited = green();
    exited.record = { ...exited.record, exitCode: 1 };
    const { line, full } = imported({ full: exited, head: GREEN_SHA });
    expect(Object.values(line.units.results).every((s) => s === 'pass')).toBe(
      true
    );
    expect(line.result).toBe('fail');
    expect(full.why).toEqual(['the run exited 1']);
  });

  it('a skip that is not quarantined is red, by the rule a local run uses', () => {
    const { line } = imported({
      full: green(),
      head: GREEN_SHA,
      sources: { ...SOURCES, followups: '' },
    });
    expect(line.result).toBe('fail');
    expect(line.units.results['bottom-sheet']).toBe('fail');
  });

  it('a run whose report or record is of another commit is red', () => {
    const elsewhere = green();
    elsewhere.report = {
      ...elsewhere.report,
      run: { ...elsewhere.report.run, vcs: { commit: RED_SHA, dirty: false } },
    };
    expect(imported({ full: elsewhere, head: GREEN_SHA }).full.why).toContain(
      `the e2e report is of commit ${RED_SHA.slice(0, 12)}, not ${GREEN_SHA.slice(0, 12)}`
    );
    const record = green();
    record.record = { ...record.record, sha: RED_SHA };
    expect(imported({ full: record, head: GREEN_SHA }).line.result).toBe(
      'fail'
    );
  });

  it('an upload of a filtered run is not the full gate, even when everything it ran passed', () => {
    const filtered = formRerun();
    const { line, full } = imported({ full: filtered, head: RED_SHA });
    expect(line.units.results.form).toBe('pass');
    expect(line.result).toBe('fail');
    expect(full.why).toContain(
      'the run was given --control form, so it is not the full suite'
    );
    expect(full.why).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^the run selected 1 of the ${String(FIXTURE_CONTROLS.length)} controls ` +
            '\\(not switch, slider, .*\\), so it is not the full suite$'
        )
      )
    );

    // Given no arguments, and nothing but the a11y cases selected.
    const bare = green();
    bare.record = { ...bare.record, args: [] };
    bare.results = { ...bare.results, selected: [], controls: [] };
    const second = imported({ full: bare, head: GREEN_SHA });
    expect(second.line.result).toBe('fail');
    expect(second.full.why).toEqual([
      expect.stringMatching(
        new RegExp(
          `^the run selected 0 of the ${String(FIXTURE_CONTROLS.length)} controls ` +
            '\\(not switch, .*\\), so it is not the full suite$'
        )
      ),
    ]);
    const unsaid = green();
    delete unsaid.record.args;
    expect(imported({ full: unsaid, head: GREEN_SHA }).full.why).toEqual([
      'the run record does not say what the suite was given, so it is not known to be the full suite',
    ]);
  });

  it('a filtered run in place of the full one is not completed by the re-run', () => {
    const failing = formRerun({ exitCode: 1 });
    failing.results = {
      ...failing.results,
      controls: [{ id: 'form', status: 'fail' }],
    };
    failing.report = red().report;
    const { line, notes } = imported({
      full: failing,
      rerun: formRerun(),
      head: RED_SHA,
    });
    expect(line.completion).toBeNull();
    expect(line.result).toBe('fail');
    expect(notes[0]).toContain(
      "the full run's upload does not stand for a full run"
    );
  });

  it('a run that stopped before its report is red with no units, and no filter names its failure', () => {
    const early = { ...red(), results: null, report: null };
    const { line } = imported({ full: early, head: RED_SHA });
    expect(line.result).toBe('fail');
    expect(line.units).toBeNull();
    expect(
      rerunOfUnits({ gate: CI_GATE, units: line.units }).refusal
    ).toContain('recorded no per-unit results');
  });

  it('records the relaxing switches the job set, less the hosted runner’s own', () => {
    expect(
      hostedRunRelaxed({ CI: 'true', GITHUB_ACTIONS: 'true', PATH: '/bin' })
    ).toEqual({});
    expect(
      hostedRunRelaxed({ CI: 'true', REAL_INPUT_TIMEOUT: '900000' })
    ).toEqual({ REAL_INPUT_TIMEOUT: '900000' });
    // On this machine the hosted ceiling is a relaxing switch like any other.
    expect(RELAXING_SWITCHES).toContain('GITHUB_ACTIONS');
  });
});

/* ------------------------------ the re-run ------------------------------ */

describe('the re-run inside the job', () => {
  it('re-runs what `--rerun-failed` would: only the failed control', () => {
    const { line } = imported({ full: red(), head: RED_SHA });
    expect(rerunOfUnits({ gate: CI_GATE, units: line.units })).toEqual({
      refusal: null,
      rerun: ['form'],
      filterArgs: ['--control', 'form'],
    });
    const plan = planRerunFailed({ gate: CI_GATE, entries: [line], ...NOW });
    expect(plan.filterArgs).toEqual(['--control', 'form']);
  });

  it('a green re-run is recorded as a completion of the red run, in one line', () => {
    const { line, notes } = imported({
      full: red(),
      rerun: formRerun(),
      head: RED_SHA,
    });
    expect(notes).toEqual([]);
    expect(line.result).toBe('pass');
    expect(line.command).toBe(
      'node scripts/real-input/android.mjs --control form'
    );
    expect(line.completion).toMatchObject({
      attempt: 1,
      rerun: ['form'],
      filtered: 'real-input:android:--control:form',
      why: [],
      of: { ts: '2026-11-25T18:08:46.000Z', logPath: null },
    });
    expect(line.ts).toBe('2026-11-25T19:06:00.000Z');
    expect(line.relaxed).toEqual({});
    expect(line.judge).toBe(JUDGE);
    expect(rowHere(line).state).toBe('green');
    expect(rowElsewhere(line).state).toBe('green');
    expect(
      renderGateTable({ entries: [line], ...NOW, required: [CI_GATE] })
    ).toContain(
      '| `real-input:android` | **PASS** (completed: 1 of 52 units re-run, attempt 1; CI run 123) |'
    );
  });

  it('a red re-run is a red completion', () => {
    const failing = formRerun({ exitCode: 1 });
    failing.results = {
      ...failing.results,
      controls: [{ id: 'form', status: 'fail' }],
    };
    failing.report = red().report;
    const { line } = imported({ full: red(), rerun: failing, head: RED_SHA });
    expect(line.result).toBe('fail');
    expect(line.completion.why).toContain('form failed again');
  });

  it('a re-run that exited non-zero is a red completion even when its control passed', () => {
    const { line } = imported({
      full: red(),
      rerun: formRerun({ exitCode: 1 }),
      head: RED_SHA,
    });
    expect(line.units.results.form).toBe('pass');
    expect(line.result).toBe('fail');
    expect(line.completion.why).toEqual(['the re-run exited 1']);
  });

  it('a re-run of anything but what a completion re-runs is not counted', () => {
    const wide = formRerun({
      args: ['--control', 'form', '--control', 'switch'],
    });
    const { line, notes } = imported({
      full: red(),
      rerun: wide,
      head: RED_SHA,
    });
    expect(line.completion).toBeNull();
    expect(line.result).toBe('fail');
    expect(notes[0]).toContain('a completion re-runs --control form');
  });

  it('a completion whose red run would not count elsewhere is not green elsewhere', () => {
    const relaxedRed = red();
    relaxedRed.record = {
      ...relaxedRed.record,
      relaxed: { REAL_INPUT_TIMEOUT: '900000' },
    };
    const { line } = imported({
      full: relaxedRed,
      rerun: formRerun(),
      head: RED_SHA,
    });
    expect(line.relaxed).toEqual({ REAL_INPUT_TIMEOUT: '900000' });
    expect(rowHere(line).state).toBe('green');
    expect(rowElsewhere(line).state).toBe('missing');

    const unsaid = red();
    delete unsaid.record.relaxed;
    const second = imported({
      full: unsaid,
      rerun: formRerun(),
      head: RED_SHA,
    });
    expect(second.line.relaxed).toBeNull();
    expect(rowElsewhere(second.line).state).toBe('missing');
  });
});

/* ---------------------------- where it counts ---------------------------- */

describe('where an imported line counts', () => {
  it('shows as a CI run, and satisfies `need --for merge` like a local run', () => {
    const { line } = imported({ full: green(), head: GREEN_SHA });
    expect(
      renderGateTable({ entries: [line], ...NOW, required: [CI_GATE] })
    ).toContain('| `real-input:android` | **PASS** (CI run 123) |');
    const need = decideNeed({
      entries: [line],
      ...NOW,
      stage: 'merge',
      touchedPlatforms: ['android'],
    });
    expect(need.required.find((row) => row.gate === CI_GATE).state).toBe(
      'green'
    );
  });

  it('counts on another branch with the same digest, and names that branch', () => {
    const { line } = imported({ full: green(), head: GREEN_SHA });
    const row = rowElsewhere(line);
    expect(row.state).toBe('green');
    expect(row.from).toBe('task/ci');
  });

  it("does not count on another branch's digest", () => {
    const { line } = imported({
      full: green(),
      head: GREEN_SHA,
      digests: {
        ...NOW,
        gateTrees: { ...GATE_TREES, 'real-input:android': '5'.repeat(64) },
      },
    });
    expect(rowElsewhere(line).state).toBe('missing');
  });
});

/* ------------------------------ through the CLI ------------------------------ */

const cleanup = [];
afterAll(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

function gitEnv(home) {
  const env = { ...withoutLeaseEnv(process.env) };
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    ...RELAXING_SWITCHES,
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
    HOME: home,
  };
}

function git(dir, args, home) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv(home),
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * A clone on `task/ci` holding the quarantine stand-ins, and a fake `gh` that answers
 * for run 777 of its HEAD from the green fixture, logging every call it gets.
 */
function makeClone() {
  const parent = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ci-'))
  );
  cleanup.push(parent);
  const repo = path.join(parent, 'repo');
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  write('nitrogen/generated/ios/NitroUiAutolinking.swift', '// marker\n');
  write('android/build.gradle', 'v1\n');
  write('docs/tasks/FOLLOWUPS.md', SOURCES.followups);
  write(
    'example/e2e/real-input/bottom-sheet.e2e.ts',
    SOURCES.readTestFile('real-input/bottom-sheet.e2e.ts')
  );
  write('.gitignore', '.gates/\n');
  git(repo, ['init', '-q', '-b', 'main'], parent);
  git(repo, ['add', '-A'], parent);
  git(repo, ['commit', '-qm', 'base'], parent);
  git(repo, ['checkout', '-qb', 'task/ci'], parent);
  const head = git(repo, ['rev-parse', 'HEAD'], parent);

  const gh = path.join(parent, 'gh-data');
  fs.mkdirSync(gh);
  const zipOf = (id, upload) => {
    const dir = path.join(gh, `content-${id}`, 'full');
    fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(upload.record));
    fs.writeFileSync(
      path.join(dir, 'units.json'),
      JSON.stringify(upload.results)
    );
    fs.writeFileSync(
      path.join(dir, 'e2e/report.json'),
      JSON.stringify(upload.report)
    );
    const zipped = spawnSync(
      'zip',
      ['-qr', path.join(gh, `artifact-${id}.zip`), 'full'],
      {
        cwd: path.dirname(dir),
        encoding: 'utf8',
      }
    );
    if (zipped.status !== 0) throw new Error(`zip: ${zipped.stderr}`);
  };
  // Attempt 1 uploaded a red report; attempt 2, the one imported, a green one.
  zipOf(900, ofCommit(ofTodaysControls(red()), head));
  zipOf(901, ofCommit(ofTodaysControls(green()), head));
  const runJson = {
    id: 777,
    head_sha: head,
    status: 'completed',
    conclusion: 'success',
    path: CI_WORKFLOW_PATH,
    run_attempt: 2,
    run_started_at: '2026-11-25T16:10:00Z',
    html_url: 'https://github.com/o/r/actions/runs/777',
  };
  fs.writeFileSync(path.join(gh, 'run.json'), JSON.stringify(runJson));
  fs.writeFileSync(
    path.join(gh, 'jobs.json'),
    JSON.stringify({
      jobs: [
        {
          id: 888,
          name: CI_JOB_NAME,
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-11-25T16:10:05Z',
          completed_at: '2026-11-25T17:20:00Z',
          html_url: 'https://github.com/o/r/actions/runs/777/job/888',
        },
      ],
    })
  );
  const artifacts = [
    {
      id: 900,
      name: 'real-input-android',
      created_at: '2026-11-25T15:30:00Z',
      expired: false,
    },
    {
      id: 901,
      name: 'real-input-android',
      created_at: '2026-11-25T17:18:00Z',
      expired: false,
    },
  ];
  fs.writeFileSync(
    path.join(gh, 'artifacts.json'),
    JSON.stringify({ artifacts })
  );
  const bin = path.join(parent, 'bin');
  fs.mkdirSync(bin);
  const runs = 'repos/{owner}/{repo}/actions/runs/777';
  const zips = 'repos/{owner}/{repo}/actions/artifacts';
  fs.writeFileSync(
    path.join(bin, 'gh'),
    '#!/bin/sh\n' +
      `echo "$*" >> "${gh}/calls.log"\n` +
      'case "$1 $2" in\n' +
      `  "api ${runs}") cat "${gh}/run.json" ;;\n` +
      `  "api ${runs}/attempts/2/jobs?per_page=100") cat "${gh}/jobs.json" ;;\n` +
      `  "api ${runs}/artifacts?per_page=100") cat "${gh}/artifacts.json" ;;\n` +
      `  "api ${zips}/900/zip") cat "${gh}/artifact-900.zip" ;;\n` +
      `  "api ${zips}/901/zip") cat "${gh}/artifact-901.zip" ;;\n` +
      '  *) echo "fake gh: unexpected $*" >&2; exit 1 ;;\n' +
      'esac\n'
  );
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  return { parent, repo, gh, bin, head, runJson };
}

function cli(clone, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: clone.repo,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...gitEnv(clone.parent),
      PATH: `${clone.bin}${path.delimiter}${process.env.PATH}`,
    },
  });
}

const ledgerOf = (clone) => {
  const file = path.join(clone.repo, '.gates/task/ci.jsonl');
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((text) => JSON.parse(text))
    : [];
};

describe('gate.mjs ci-import', () => {
  it('records a green run of HEAD once, shows it as a CI run, and only ever reads from GitHub', () => {
    const clone = makeClone();
    const first = cli(clone, ['ci-import', '--run', '777']);
    expect(first.stderr).toContain(
      'ci-import: real-input:android PASS (CI run 777)'
    );
    expect(first.stdout).toContain('QUARANTINED bottom-sheet: a drag up');
    expect(first.status).toBe(0);
    const [line] = ledgerOf(clone);
    expect(line).toMatchObject({
      gate: CI_GATE,
      result: 'pass',
      head: clone.head,
      source: {
        kind: 'github-actions',
        runId: 777,
        attempt: 2,
        jobId: 888,
        url: 'https://github.com/o/r/actions/runs/777/job/888',
      },
    });
    const table = cli(clone, ['table', '--for', 'merge']);
    expect(table.stdout).toContain(
      '| `real-input:android` | **PASS** (CI run 777) |'
    );
    const need = cli(clone, ['need', '--for', 'merge']);
    expect(need.stdout).toContain(
      '✓ real-input:android — green on its own digest (CI run 777)'
    );

    const again = cli(clone, ['ci-import', '--run', '777']);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('attempt 2 of run 777 is already in');
    expect(ledgerOf(clone)).toHaveLength(1);

    const calls = fs
      .readFileSync(path.join(clone.gh, 'calls.log'), 'utf8')
      .trim()
      .split('\n');
    for (const call of calls) {
      expect(call).toMatch(
        /^api repos\/\{owner\}\/\{repo\}\/actions\/(runs\/777\S*|artifacts\/901\/zip) *$/
      );
    }
  }, 60_000);

  it('refuses a run of another commit, and a worktree with changes, recording nothing', () => {
    const clone = makeClone();
    fs.writeFileSync(
      path.join(clone.gh, 'run.json'),
      JSON.stringify({ ...clone.runJson, head_sha: 'b'.repeat(40) })
    );
    const other = cli(clone, ['ci-import', '--run', '777']);
    expect(other.status).toBe(1);
    expect(other.stderr).toContain(`ran commit ${'b'.repeat(12)}, and HEAD is`);
    expect(other.stderr).toContain('ci-import: nothing recorded');

    fs.writeFileSync(
      path.join(clone.gh, 'run.json'),
      JSON.stringify(clone.runJson)
    );
    fs.writeFileSync(path.join(clone.repo, 'android/build.gradle'), 'v2\n');
    const dirty = cli(clone, ['ci-import', '--run', '777']);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('uncommitted changes');
    expect(ledgerOf(clone)).toEqual([]);
  }, 60_000);
});
