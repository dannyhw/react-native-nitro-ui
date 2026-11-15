import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LEDGER_VERSION,
  ledgerLineFromRun,
  parseLedger,
  renderGateTable,
} from '../gate-core.mjs';
import {
  SUITE_TIMING_ENV,
  SUITE_TIMING_GATE_ENV,
  SUITE_TIMING_VERSION,
  createSuiteTimingPlugin,
  formatSuiteTimings,
  gateFromTimingFile,
  newSuiteTimingRecord,
  readSuiteTiming,
  relativeName,
  suiteTimingFromEnv,
  suiteTimingPath,
  suiteTimingPluginFromEnv,
  suiteTimingRow,
  suiteTimingTotals,
} from '../harness-suite-timing.mjs';

// `__dirname`, not `import.meta.url`: jest transforms these files to CommonJS.
const REPO_ROOT = join(__dirname, '..', '..');

// The fixtures' file durations and test-body durations differ on purpose, so a swapped
// pair fails.
const SWITCH_FILE = '/work/example/__tests__/Switch.harness.tsx';
const SIZING_FILE = '/work/example/__tests__/Sizing.harness.tsx';

// The shape `@react-native-harness/bridge` reports: a tree of `describe` blocks
// (`{ name, tests, suites }`), not a flat list.
const switchContext = {
  file: SWITCH_FILE,
  projectRoot: '/work/example',
  duration: 40_400,
  status: 'passed',
  result: {
    name: '__tests__/Switch.harness.tsx',
    status: 'passed',
    duration: 40_400,
    tests: [{ name: 'toggles', status: 'passed', duration: 1_250 }],
    suites: [
      {
        name: 'controlled value',
        status: 'passed',
        duration: 1_900,
        tests: [{ name: 'keeps value', status: 'passed', duration: 1_900 }],
        suites: [],
      },
    ],
  },
};

const sizingContext = {
  file: SIZING_FILE,
  projectRoot: '/work/example',
  duration: 12_500,
  status: 'failed',
  result: {
    name: '__tests__/Sizing.harness.tsx',
    status: 'failed',
    duration: 12_500,
    tests: [],
    suites: [
      {
        name: 'cold',
        status: 'failed',
        duration: 11_900,
        tests: [
          { name: 'measures 200 arms', status: 'failed', duration: 11_900 },
        ],
        suites: [],
      },
    ],
  },
};

describe('the suite-timing row', () => {
  it('separates the file wall clock from the test bodies inside it', () => {
    expect(suiteTimingRow(switchContext)).toEqual({
      file: '__tests__/Switch.harness.tsx',
      durationMs: 40400,
      status: 'passed',
      tests: 2,
      failed: 0,
      testBodyMs: 3150,
    });
  });

  it('counts a failed file without dropping its timing', () => {
    const row = suiteTimingRow(sizingContext);
    expect(row).toMatchObject({
      durationMs: 12500,
      failed: 1,
      status: 'failed',
    });
    expect(row.testBodyMs).toBe(11900);
  });

  it('counts tests nested in describe blocks, not just the top level', () => {
    expect(suiteTimingRow(switchContext)).toMatchObject({
      tests: 2,
      testBodyMs: 3150,
    });
  });

  it('survives the harness handing over nothing', () => {
    // `result: null` is what a file that never reported back looks like.
    expect(
      suiteTimingRow({ file: 'x.harness.tsx', duration: 5, status: 'passed' })
    ).toEqual({
      file: 'x.harness.tsx',
      durationMs: 5,
      status: 'passed',
      tests: 0,
      failed: 0,
      testBodyMs: 0,
    });
  });

  it('keeps a name a human can compare', () => {
    expect(relativeName(SIZING_FILE, '/work/example')).toBe(
      '__tests__/Sizing.harness.tsx'
    );
    expect(relativeName(SIZING_FILE, null)).toBe(
      '__tests__/Sizing.harness.tsx'
    );
    expect(relativeName('/somewhere/else/Deep.harness.tsx', null)).toBe(
      'else/Deep.harness.tsx'
    );
  });
});

describe('the totals', () => {
  it('names the time that is not in any file', () => {
    const record = {
      ...newSuiteTimingRecord({ gate: 'harness:android', startedAt: 0 }),
      durationMs: 455_000,
      suites: [suiteTimingRow(switchContext), suiteTimingRow(sizingContext)],
    };
    const totals = suiteTimingTotals(record);
    expect(totals).toMatchObject({
      suiteMs: 52900,
      testBodyMs: 15050,
      overheadMs: 402100,
      files: 2,
      failedFiles: 1,
    });
  });
});

describe('the plugin', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-timing-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const build = (file) =>
    createSuiteTimingPlugin({ file, gate: 'harness:android', startedAt: 1000 });

  // `@react-native-harness/plugins` is ESM-only and jest's CommonJS transform cannot import
  // it, so the package's own validator runs in a child process.
  it('is a plugin the harness itself accepts', () => {
    const file = join(dir, 'run.json');
    const script = `
      const { isHarnessPlugin } = await import('@react-native-harness/plugins');
      const { createSuiteTimingPlugin } = await import('./scripts/harness-suite-timing.mjs');
      const plugin = createSuiteTimingPlugin({ file: '/tmp/x.json', gate: 'harness:ios' });
      process.stdout.write(String(isHarnessPlugin(plugin)));
    `;
    const run = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }
    );
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('true');
    expect(file).not.toBeNull();
  });

  it('writes a readable file after the first finished suite', () => {
    const file = join(dir, 'run.json');
    const plugin = build(file);
    plugin.hooks.testFile.finished(switchContext);

    const read = readSuiteTiming(file);
    expect(read.gate).toBe('harness:android');
    expect(read.suites).toHaveLength(1);
    expect(read.finishedAt).toBeNull();
  });

  it('records every suite, and the run total when the run finishes', async () => {
    const file = join(dir, 'run.json');
    const plugin = build(file);
    await plugin.hooks.run.started({
      testFiles: [SWITCH_FILE, SIZING_FILE],
      runner: { name: 'android' },
      platform: { platformId: 'android' },
    });
    plugin.hooks.testFile.finished(switchContext);
    plugin.hooks.testFile.finished(sizingContext);
    plugin.hooks.run.finished({ duration: 455_000, status: 'failed' });

    const read = readSuiteTiming(file);
    expect(read.suites.map((s) => s.file)).toEqual([
      '__tests__/Switch.harness.tsx',
      '__tests__/Sizing.harness.tsx',
    ]);
    expect(read).toMatchObject({
      durationMs: 455000,
      status: 'failed',
      fileCount: 2,
    });
    expect(existsSync(file)).toBe(true);
  });

  it('re-records a repeated file rather than double-counting it', () => {
    const file = join(dir, 'run.json');
    const plugin = build(file);
    plugin.hooks.testFile.finished(switchContext);
    plugin.hooks.testFile.finished({ ...switchContext, duration: 41_000 });
    expect(readSuiteTiming(file).suites).toHaveLength(1);
    expect(readSuiteTiming(file).suites[0].durationMs).toBe(41000);
  });

  it('never takes a run with it when the file cannot be written', () => {
    // A directory where the file should be: `mkdir -p` succeeds and the write fails.
    const file = join(dir, 'blocked.json');
    mkdirSync(file);
    const written = [];
    const plugin = createSuiteTimingPlugin({
      file,
      gate: 'harness:ios',
      log: (message) => written.push(message),
    });
    expect(() => plugin.hooks.testFile.finished(switchContext)).not.toThrow();
    expect(written.join('\n')).toContain('could not write');
    const junk = join(dir, 'junk.json');
    writeFileSync(junk, 'not json');
    expect(readSuiteTiming(junk)).toBeNull();
  });
});

describe('the env switch', () => {
  it('is off unless the file is named', () => {
    expect(suiteTimingFromEnv({})).toBeNull();
    expect(suiteTimingFromEnv({ [SUITE_TIMING_ENV]: '   ' })).toBeNull();
    expect(suiteTimingFromEnv({ [SUITE_TIMING_ENV]: '/tmp/x.json' })).toEqual({
      file: '/tmp/x.json',
    });
  });

  it('builds nothing when the environment says nothing', () => {
    expect(suiteTimingPluginFromEnv({})).toBeNull();
  });

  it('names the hand-off from the run log, and only that log', () => {
    const log = '/store/task/X11/harness+android-2026-10-28T09-00-00.000Z.log';
    expect(suiteTimingPath(log)).toBe(`${log}.suites.json`);
    expect(suiteTimingPath('')).toBeNull();
    expect(suiteTimingPath(null)).toBeNull();
  });

  it('recovers the gate from the log-named file, and from an old one', () => {
    const file = suiteTimingPath(
      '/store/task/X11/harness+android-2026-10-28T09-00-00.000Z.log'
    );
    expect(gateFromTimingFile(file)).toBe('harness:android');
    // A filtered run's gate name has its `:` folded to `+` in the file name.
    expect(
      gateFromTimingFile(
        suiteTimingPath(
          '/store/task/X11/harness+android+ColdSizing-2026-10-28T09-00-00.000Z.log'
        )
      )
    ).toBe('harness:android:ColdSizing');
    // The older `<gate>-<ms>-<pid>.json` naming is still read.
    expect(
      gateFromTimingFile(
        '/repo/.gates/suite-timing/harness+ios-1730000000000-4242.json'
      )
    ).toBe('harness:ios');
    expect(gateFromTimingFile('nothing-like-a-timing-file.json')).toBeNull();
    expect(gateFromTimingFile('check-2026-10-28T09-00-00.000Z.log')).toBeNull();
    // A literal `+` in a hand-written name cannot survive the fold: it comes back as `:`.
    expect(
      gateFromTimingFile(
        suiteTimingPath(
          '/store/task/X11/harness+ios+A+B-2026-10-28T09-00-00.000Z.log'
        )
      )
    ).toBe('harness:ios:A:B');
  });

  it('prefers the gate name the caller states over the one it can guess', () => {
    const dir = mkdtempSync(join(tmpdir(), 'suite-timing-gate-'));
    try {
      const write = (env) => {
        const file = join(dir, `${env.tag}.suites.json`);
        const plugin = suiteTimingPluginFromEnv({
          [SUITE_TIMING_ENV]: file,
          ...(env.gate == null ? {} : { [SUITE_TIMING_GATE_ENV]: env.gate }),
        });
        plugin.hooks.testFile.finished(switchContext);
        return readSuiteTiming(file).gate;
      };
      expect(
        write({
          tag: 'stated',
          gate: 'harness:ios:ColdSizing',
        })
      ).toBe('harness:ios:ColdSizing');
      expect(
        write({
          tag: 'harness+ios+ColdSizing-2026-10-28T09-00-00.000Z.log',
          gate: null,
        })
      ).toBe('harness:ios:ColdSizing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the file the gate then reads back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'suite-timing-env-'));
    try {
      const file = join(
        dir,
        'harness+ios-2026-10-28T09-00-00.000Z.log.suites.json'
      );
      const plugin = suiteTimingPluginFromEnv({ [SUITE_TIMING_ENV]: file });
      plugin.hooks.testFile.finished(switchContext);
      const read = readSuiteTiming(file);
      expect(read.gate).toBe('harness:ios');
      expect(read.suites[0].file).toBe('__tests__/Switch.harness.tsx');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the ledger half', () => {
  const base = {
    gate: 'harness:android',
    command: 'node ../scripts/harness.mjs --harnessRunner android',
    tree: 'a'.repeat(64),
    head: 'abcdef1',
    branch: 'task/X11',
    startedAt: Date.parse('2026-10-28T09:00:00.000Z'),
    durationMs: 455_000,
    result: 'pass',
  };

  const timings = {
    ...newSuiteTimingRecord({
      gate: 'harness:android',
      platform: 'android',
      startedAt: 0,
    }),
    durationMs: 455_000,
    status: 'passed',
    suites: [suiteTimingRow(switchContext), suiteTimingRow(sizingContext)],
  };

  it('carries the timings through the line and back', () => {
    const line = ledgerLineFromRun({ ...base, suiteTimings: timings });
    expect(line.v).toBe(LEDGER_VERSION);
    expect(line.suiteTimings.suites).toHaveLength(2);
    const parsed = parseLedger(`${JSON.stringify(line)}\n`);
    expect(parsed[0].suiteTimings.suites[0]).toMatchObject({
      file: '__tests__/Switch.harness.tsx',
      durationMs: 40400,
    });
  });

  it('records null when nothing was measured, so the absence is a fact and not a gap', () => {
    const line = ledgerLineFromRun({ ...base });
    expect(line.suiteTimings).toBeNull();
    expect(
      formatSuiteTimings(readSuiteTiming(join('/nonexistent', 'x.json')))
    ).toBe('');
  });

  it('prints slowest first, with the restart column, and truncates what it will not show', () => {
    const text = formatSuiteTimings(timings, { limit: 10 });
    expect(text).toContain('harness:android');
    expect(text).toContain('Restart + handshake');
    const rows = text.split('\n').filter((l) => l.startsWith('| `'));
    expect(rows[0]).toContain('Switch.harness.tsx');
    expect(rows[1]).toContain('Sizing.harness.tsx');
    expect(rows[0]).toContain('37.3s');
    expect(text).toContain('402.1s');
    expect(formatSuiteTimings(timings, { limit: 1 }).split('\n')).toContain(
      '| … 1 more | | | | |'
    );
  });

  it('is written by a harness run and read by `table --full`', () => {
    const line = ledgerLineFromRun({ ...base, suiteTimings: timings });
    const older = ledgerLineFromRun({
      ...base,
      gate: 'harness:ios',
      tree: 'b'.repeat(64),
      startedAt: base.startedAt + 1,
    });
    const table = renderGateTable({
      entries: [line, older],
      tree: null,
      stage: 'review',
    });
    expect(table).toContain('`harness:android`');
    expect(table).not.toContain('Restart + handshake');
  });

  it('reads a version-2 line as "no timings" rather than corrupt', () => {
    const v2 = { ...ledgerLineFromRun({ ...base }), v: 2 };
    delete v2.suiteTimings;
    const [entry] = parseLedger(`${JSON.stringify(v2)}\n`);
    expect(entry.corrupt).toBeUndefined();
    expect(entry.gate).toBe('harness:android');
    expect(entry.suiteTimings).toBeUndefined();
  });
});

describe('the hand-off file', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-timing-file-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a file from another version', () => {
    const file = join(dir, 'stale.json');
    writeFileSync(
      file,
      JSON.stringify({ version: SUITE_TIMING_VERSION + 1, suites: [] })
    );
    expect(readSuiteTiming(file)).toBeNull();
  });

  it('refuses a file whose suites are not a list', () => {
    const file = join(dir, 'junk.json');
    writeFileSync(file, JSON.stringify({ version: SUITE_TIMING_VERSION }));
    expect(readSuiteTiming(file)).toBeNull();
  });
});
