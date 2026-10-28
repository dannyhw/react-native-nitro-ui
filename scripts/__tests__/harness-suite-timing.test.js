/**
 * Per-suite timings for a harness run (X11) — the plugin the harness registers, and the ledger
 * half that reads what it wrote.
 *
 * Each case is here because the failure it prevents is one a wall-clock total hides:
 *
 *   - the row is built from the harness's own numbers, so a file's *tests* and the *restart around
 *     them* are separate columns. That split is the question the brief asks ("app restarts, waits
 *     or test bodies"), and a fixture where they are equal would hide it — the durations below are
 *     deliberately unrelated to each other and to the expected sums;
 *   - the file is written per finished suite, so a run that dies still explains itself;
 *   - the ledger carries `suiteTimings`, and a run that recorded nothing must record `null` rather
 *     than an empty table a reader could mistake for "everything is fast".
 */

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

// `__dirname`, not `import.meta.url`: jest transforms these files to CommonJS (the reason
// `harness-suite-timing.mjs` has no `import.meta` in it either).
const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Two finished files, with numbers that are nothing like each other on purpose: 40.4 s of which
 * 3.2 s is test bodies (a restart-dominated file), and 12.5 s of which 11.9 s is test bodies (a
 * genuinely slow one). A fixture where file duration equalled test-body duration would let a
 * swapped pair pass, which is the exact mistake this split exists to catch.
 */
const SWITCH_FILE = '/work/example/__tests__/Switch.harness.tsx';
const SIZING_FILE = '/work/example/__tests__/Sizing.harness.tsx';

/**
 * The shape `@react-native-harness/bridge` actually reports: a tree of `describe` blocks
 * (`{ name, tests, suites }`), not a flat list. A fixture with a made-up `testResults` field let
 * the first version of the reader return zero tests for every file, and the 455 s run that proved
 * it wrong is the reason this comment is here.
 */
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
    // The number that matters on a red run is still there: the slow suite is the failing one,
    // and a row that only appeared on green would hide exactly the file worth reading.
    expect(row.testBodyMs).toBe(11900);
  });

  it('counts tests nested in describe blocks, not just the top level', () => {
    // Two tests, one of them a level down: a reader that only looked at `result.tests` would
    // report 1, and a reader that looked at a field that does not exist would report 0 - which is
    // what shipped first, and made every row say "37.3s restart, 0.0s tests".
    expect(suiteTimingRow(switchContext)).toMatchObject({
      tests: 2,
      testBodyMs: 3150,
    });
  });

  it('survives the harness handing over nothing', () => {
    // `result: null` is what a file that never reported back looks like, and a row that is
    // missing because the fixture is empty is worse than a row that says "no tests, no time".
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
    // No project root (or a different one) still yields the tail rather than a 90-character path.
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
      // The answer to "where did 455 s go": 402 s of boot, build and bundle, outside every file.
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

  /**
   * A plugin the harness's own validator accepts, checked in a child process.
   *
   * `@react-native-harness/plugins` is ESM-only, so `import()` from here lands in Jest's CommonJS
   * transform and dies on `export`. The child gets the real module, which is the point: the shape
   * is a contract with that package, and re-implementing its check here would be a test that passes
   * when the two disagree.
   */
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
    // Readable *while the run is still going*: the run that would have told you where the time
    // went is sometimes the one that times out, and a file written only at the end says nothing
    // about the run you actually need to read.
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
    // A directory sitting where the file should be: `mkdir -p` succeeds and the write is the part
    // that fails, which is the realistic shape of this. The hand-off is diagnostics, and losing it
    // is not a reason to fail a device run somebody waited four minutes for.
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
    // And a file that is not a timing file at all is not read as one.
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
    // The name is the log's plus a suffix: X10's review N7 is the precedent, one
    // function naming one run's file, derived from a name the launcher and the runner
    // already share. A second namer is how a reader ends up sent to a file that was
    // never written.
    const log = '/store/task/X11/harness+android-2026-10-28T09-00-00.000Z.log';
    expect(suiteTimingPath(log)).toBe(`${log}.suites.json`);
    // Empty in, null out: a caller that has no log must not get `undefined.suites.json`.
    expect(suiteTimingPath('')).toBeNull();
    expect(suiteTimingPath(null)).toBeNull();
  });

  it('recovers the gate from the log-named file, and from an old one', () => {
    const file = suiteTimingPath(
      '/store/task/X11/harness+android-2026-10-28T09-00-00.000Z.log'
    );
    expect(gateFromTimingFile(file)).toBe('harness:android');
    // A filtered run is a different gate name and must survive the round trip. The
    // `+` is what `logNameFor` folds a `:` into, so expanding it is the inverse.
    expect(
      gateFromTimingFile(
        suiteTimingPath(
          '/store/task/X11/harness+android+ColdSizing-2026-10-28T09-00-00.000Z.log'
        )
      )
    ).toBe('harness:android:ColdSizing');
    // Pre-X12 files (`<gate>-<ms>-<pid>.json`) can still be on disk in a worktree that
    // has not been cleaned up, and reading them is still useful.
    expect(
      gateFromTimingFile(
        '/repo/.gates/suite-timing/harness+ios-1730000000000-4242.json'
      )
    ).toBe('harness:ios');
    expect(gateFromTimingFile('nothing-like-a-timing-file.json')).toBeNull();
    // Not a timing file at all, even though it ends in `.json`.
    expect(gateFromTimingFile('check-2026-10-28T09-00-00.000Z.log')).toBeNull();
    // The reconstruction's limit, stated rather than hidden. `canonicalGateName`
    // percent-encodes each filter argument, so a real gate name never carries a
    // folded character and the round trip above is exact for it. A hand-written name
    // that does (a literal `+`) cannot survive a lossy fold, and comes back with that
    // character turned into `:`. This is why the stated name wins.
    expect(
      gateFromTimingFile(
        suiteTimingPath(
          '/store/task/X11/harness+ios+A+B-2026-10-28T09-00-00.000Z.log'
        )
      )
    ).toBe('harness:ios:A:B');
  });

  it('prefers the gate name the caller states over the one it can guess', () => {
    // The file's name is a folded spelling (`[^\w.-]` -> `+`), so a gate name that
    // already contained a folded character cannot round-trip through it. `gate.mjs`
    // therefore passes the real name alongside, and the reconstruction is the fallback.
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
      // With no stated name, the reconstruction from the file's name is used, and a
      // `+` in it is expanded to `:` - the inverse of the folding, not the truth.
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
    // The report renders a row from the ledger; an absent timing must not become an empty table
    // that reads as "no slow suites".
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
    // The table itself stays the same width: the timings are a section of their own, so the
    // committed report's gate table does not change shape for every task that has one.
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
