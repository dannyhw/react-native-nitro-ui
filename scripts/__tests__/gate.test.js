import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  LEDGER_VERSION,
  MERGE_GATES,
  backgroundRecordPath,
  decideNeed,
  deviceFromEnv,
  digestKeyFor,
  countsForDisplay,
  changedPathsGitArgs,
  gatesSeen,
  gateRowFor,
  gateStateFor,
  isToolingPath,
  ledgerFileName,
  ledgerLineFromRun,
  ledgerRelativePath,
  listByGate,
  ownMetroPids,
  parseLedger,
  parseTestCounts,
  parseTestSummaries,
  platformMappingFor,
  platformTreesFromEntries,
  platformsOwningFile,
  platformsTouchedByPaths,
  renderGateTable,
  requiredGatesFor,
  resolveGate,
  summarizeGates,
  summarizeLoad,
  codeTreeDigest,
  contentHash,
  isCodeFile,
  STILL_RUNNING_EXIT,
  decideWait,
  lastLogLine,
  pidMayBeRunning,
  runningBackgroundGates,
} from '../gate-core.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import { FREE_LSOF } from './helpers/free-lsof-stub.js';
import {
  DEFAULT_PAIR,
  OTHER_PAIR,
  leaseRecord,
  leasedEnv,
  serialFor,
  writeLeaseStore,
} from './helpers/lease-store.js';

/**
 * The lease every fixture checkout is run under: a device gate refuses to start
 * without a live lease whose pair matches the device variables in the environment.
 */
const FIXTURE_LEASE = leaseRecord({
  id: 'X2-1',
  task: 'X2',
  platform: 'both',
  holds: [DEFAULT_PAIR.id],
});

/** The lease env for a fixture checkout whose store is at `<dir>/state`. */
function fixtureEnv(dir, lease = FIXTURE_LEASE) {
  return leasedEnv({
    home: path.join(dir, 'state'),
    pair: DEFAULT_PAIR,
    lease,
  });
}

const TREE_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TREE_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function head(short = TREE_A) {
  return short.slice(0, 12);
}

/** A ledger line with every field a test does not name filled in. */
function line({
  gate,
  tree = TREE_A,
  commit = 'commit-1',
  result = 'pass',
  counts = {
    suites: { passed: 11, total: 11 },
    tests: { passed: 162, total: 162 },
  },
  durationMs = 175_300,
  load = { start: 3.1, median: 4.2, max: 9.1, count: 12 },
  lease = null,
  device = null,
  exitCode = result === 'pass' ? 0 : 1,
  logPath = `.gates/logs/${gate}-1.log`,
  trees = null,
  treeAfter = tree,
  summaries = null,
}) {
  return ledgerLineFromRun({
    gate,
    command: `bun run ${gate}`,
    tree,
    trees,
    treeAfter,
    summaries,
    head: commit,
    branch: 'task/X2-gate-ledger',
    platform: gate.includes('ios')
      ? 'ios'
      : gate.includes('android')
        ? 'android'
        : null,
    device,
    lease,
    load,
    durationMs,
    result,
    counts,
    logPath,
    startedAt: Date.parse('2026-10-26T10:00:00Z'),
    exitCode,
  });
}

describe('ledger lines', () => {
  it('writes the fields a report has to cite', () => {
    const entry = line({
      gate: 'harness:android',
      lease: 'X2-abc',
      device: 'emulator-5570',
    });
    expect(entry).toMatchObject({
      v: LEDGER_VERSION,
      gate: 'harness:android',
      tree: TREE_A,
      head: 'commit-1',
      platform: 'android',
      device: 'emulator-5570',
      lease: 'X2-abc',
      durationMs: 175300,
      result: 'pass',
      logPath: '.gates/logs/harness:android-1.log',
      trees: null,
      treeAfter: TREE_A,
      summaries: null,
      signal: null,
    });
    expect(entry.ts).toBe('2026-10-26T10:00:00.000Z');
    expect(entry.load).toEqual({
      start: 3.1,
      median: 4.2,
      max: 9.1,
      count: 12,
    });
  });

  it('survives a JSON round trip, one line per run', () => {
    const text = [line({ gate: 'check' }), line({ gate: 'harness:ios' })]
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    const parsed = parseLedger(`${text}\n`);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((entry) => entry.gate)).toEqual(['check', 'harness:ios']);
  });

  it('keeps an unreadable line visible instead of reading it as a pass', () => {
    // A run killed mid-write leaves half a line.
    const parsed = parseLedger(
      `{"gate":"check","result":"pass"\nnot json at all\n`
    );
    expect(parsed).toHaveLength(2);
    expect(parsed.every((entry) => entry.corrupt === true)).toBe(true);
    expect(
      gateStateFor({ gate: 'check', tree: TREE_A, entry: undefined }).state
    ).toBe('missing');
  });

  it('puts one file per branch under .gates, no separator to collide', () => {
    expect(ledgerRelativePath('task/X2-gate-ledger')).toBe(
      '.gates/task/X2-gate-ledger.jsonl'
    );
    expect(ledgerFileName('main')).toBe('main.jsonl');
    // A detached checkout still gets a file.
    expect(ledgerFileName('HEAD')).toBe('detached.jsonl');
    expect(ledgerFileName('')).toBe('detached.jsonl');
    expect(ledgerFileName('task/a')).not.toBe(ledgerFileName('task+a'));
    expect(ledgerFileName('task?a')).not.toBe(ledgerFileName('task*b'));
  });

  it('refuses a branch string that would escape .gates', () => {
    expect(() => ledgerFileName('../../etc/passwd')).toThrow(
      /not a branch name/
    );
    expect(() => ledgerFileName('/absolute')).toThrow(/not a branch name/);
    expect(() => ledgerFileName('a\u0000b')).toThrow(/not a branch name/);
  });
});

describe('gateStateFor / summarizeGates', () => {
  it('reads green, red, stale and missing apart', () => {
    const ask = { gate: 'check', stage: 'merge', tree: TREE_A };
    expect(gateStateFor({ ...ask, entry: line({ gate: 'check' }) }).state).toBe(
      'green'
    );
    expect(
      gateStateFor({ ...ask, entry: line({ gate: 'check', tree: TREE_B }) })
        .state
    ).toBe('stale');
    expect(
      gateStateFor({
        ...ask,
        entry: line({ gate: 'check', result: 'fail' }),
      }).state
    ).toBe('red');
    // The newest run on the current tree wins over an older green one.
    expect(
      gateRowFor({
        gate: 'check',
        list: [
          line({ gate: 'check' }),
          line({ gate: 'check', result: 'fail' }),
        ],
        ...ask,
      }).state
    ).toBe('red');
    expect(gateStateFor({ ...ask, entry: undefined }).state).toBe('missing');
  });

  it('lists the merge set plus anything else that ran, merge order first', () => {
    const gates = gatesSeen([
      line({ gate: 'harness:android:ColdSizing' }),
      line({ gate: 'bench' }),
    ]);
    expect(gates.slice(0, MERGE_GATES.length)).toEqual(MERGE_GATES);
    expect(gates).toContain('harness:android:ColdSizing');
    expect(gates).toContain('bench');
  });

  it('shows a suite run beside the full harness rather than instead of it', () => {
    const rows = summarizeGates({
      entries: [line({ gate: 'harness:android:ColdSizing' })],
      tree: TREE_A,
    });
    const full = rows.find((row) => row.gate === 'harness:android');
    expect(full.state).toBe('missing');
    expect(
      rows.find((row) => row.gate === 'harness:android:ColdSizing').state
    ).toBe('green');
  });
});

describe('platformsTouchedByPaths', () => {
  it('maps the brief prefixes: android/, ios/, and shared code to both', () => {
    expect(platformsTouchedByPaths(['android/src/main/Ui.kt'])).toEqual({
      platforms: ['android'],
      unmapped: [],
      tooling: [],
    });
    expect(platformsTouchedByPaths(['ios/ui/Switch.swift'])).toEqual({
      platforms: ['ios'],
      unmapped: [],
      tooling: [],
    });
    for (const shared of [
      'cpp/ui/Switch.cpp',
      'src/index.ts',
      'nitrogen/generated/shared/Y.h',
      'nitrogen/types/Config.ts',
    ]) {
      expect(platformsTouchedByPaths([shared]).platforms).toEqual([
        'ios',
        'android',
      ]);
    }
    expect(
      platformsTouchedByPaths(['example/android/app/build.gradle']).platforms
    ).toEqual(['android']);
    expect(platformsTouchedByPaths(['NitroUi.podspec']).platforms).toEqual([
      'ios',
    ]);
  });

  it('asks for both when it cannot tell, and says which paths', () => {
    const decision = platformsTouchedByPaths([
      'patches/react-native-harness.patch',
    ]);
    expect(decision.platforms).toEqual(['ios', 'android']);
    expect(decision.unmapped).toEqual(['patches/react-native-harness.patch']);
  });

  it('asks for nothing from docs, bench files and Markdown, wherever they live', () => {
    expect(
      platformsTouchedByPaths([
        'docs/tasks/X2-gate-ledger.report.md',
        'docs/tasks/X2-gate-ledger/gates.jsonl',
        'README.md',
        'bench/results/abc-android.json',
      ])
    ).toEqual({ platforms: [], unmapped: [], tooling: [] });
  });
});

describe('requiredGatesFor / decideNeed', () => {
  it('review needs check plus the touched platforms, and nothing else', () => {
    expect(
      requiredGatesFor({ stage: 'review', touchedPlatforms: ['android'] })
    ).toEqual(['check', 'harness:android']);
    expect(
      requiredGatesFor({
        stage: 'review',
        touchedPlatforms: ['ios', 'android'],
      })
    ).toEqual(['check', 'harness:ios', 'harness:android']);
    expect(requiredGatesFor({ stage: 'review', touchedPlatforms: [] })).toEqual(
      ['check']
    );
    expect(() => requiredGatesFor({ stage: 'ship' })).toThrow(
      /review and merge/
    );
  });

  it('an android-only diff needs android only', () => {
    const decision = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:android' }),
        line({ gate: 'harness:ios', result: 'fail' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: platformsTouchedByPaths(['android/src/main/Ui.kt'])
        .platforms,
    });
    expect(decision.ok).toBe(true);
    expect(decision.required.map((row) => row.gate)).toEqual([
      'check',
      'harness:android',
    ]);
    expect(decision.required.map((row) => row.gate)).not.toContain(
      'harness:ios'
    );
    expect(decision.missing).toEqual([]);
  });

  it('an android-only diff still needs check, and says so when it is red', () => {
    const decision = decideNeed({
      entries: [
        line({ gate: 'harness:android' }),
        line({ gate: 'check', result: 'fail' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['android'],
    });
    expect(decision.ok).toBe(false);
    expect(decision.missing).toEqual(['check']);
    expect(decision.required.find((row) => row.gate === 'check').state).toBe(
      'red'
    );
  });

  it('a docs-only commit keeps a green gate green (same code tree, new HEAD)', () => {
    const entries = [
      line({ gate: 'check', commit: 'before-docs' }),
      line({
        gate: 'harness:android',
        commit: 'before-docs',
        device: 'emulator-5570',
      }),
    ];
    const docsOnly = platformsTouchedByPaths([
      'docs/tasks/X2-gate-ledger.report.md',
    ]).platforms;
    expect(docsOnly).toEqual([]);
    const decision = decideNeed({
      entries,
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: docsOnly,
    });
    expect(decision.ok).toBe(true);
    expect(decision.missing).toEqual([]);
    expect(decision.notes.join(' ')).toMatch(
      /docs-only commit never invalidates/
    );
  });

  it('a code change makes yesterday green stale, not green', () => {
    const entries = [
      line({ gate: 'check' }),
      line({ gate: 'harness:android' }),
    ];
    const decision = decideNeed({
      entries,
      tree: TREE_B,
      stage: 'review',
      touchedPlatforms: ['android'],
    });
    expect(decision.ok).toBe(false);
    expect(decision.missing).toEqual(['check', 'harness:android']);
    expect(decision.required.every((row) => row.state === 'stale')).toBe(true);
    expect(decision.required.map((row) => row.gate)).not.toContain(
      'harness:ios'
    );
  });

  it('merge needs the whole set on this tree, once', () => {
    const review = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:ios' }),
        line({ gate: 'harness:android' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['ios', 'android'],
    });
    expect(review.ok).toBe(true);

    const merge = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:ios' }),
        line({ gate: 'harness:android' }),
      ],
      tree: TREE_A,
      stage: 'merge',
    });
    expect(merge.ok).toBe(false);
    expect(merge.missing).toEqual(['real-input:ios', 'real-input:android']);

    const complete = decideNeed({
      entries: MERGE_GATES.map((gate) => line({ gate })),
      tree: TREE_A,
      stage: 'merge',
    });
    expect(complete.ok).toBe(true);
    expect(complete.required.map((row) => row.gate)).toEqual(MERGE_GATES);
  });

  it('never asks for a bench, and never accepts one as a substitute', () => {
    const entries = [
      line({ gate: 'bench' }),
      line({ gate: 'bench:quick' }),
      line({ gate: 'check' }),
    ];
    for (const stage of ['review', 'merge']) {
      const decision = decideNeed({
        entries,
        tree: TREE_A,
        stage,
        touchedPlatforms: ['ios', 'android'],
      });
      expect(
        decision.required.some((row) => row.gate.startsWith('bench'))
      ).toBe(false);
    }
    expect(
      decideNeed({ entries, tree: TREE_A, stage: 'merge' }).missing
    ).toEqual([
      'harness:ios',
      'harness:android',
      'real-input:ios',
      'real-input:android',
    ]);
  });

  it('a single suite green does not satisfy the platform harness gate', () => {
    const decision = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:android:ColdSizing' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['android'],
    });
    expect(decision.missing).toEqual(['harness:android']);
  });

  it('says when it could not read the diff instead of asking for nothing', () => {
    const decision = decideNeed({
      entries: [line({ gate: 'check' })],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['ios', 'android'],
      diffUnknown: true,
    });
    expect(decision.missing).toEqual(['harness:ios', 'harness:android']);
    expect(decision.notes.join(' ')).toMatch(/could not be read/);
  });
});

describe('renderGateTable', () => {
  it('renders one row per gate with counts, tree, duration and load', () => {
    const table = renderGateTable({
      entries: [
        line({
          gate: 'check',
          counts: {
            suites: { passed: 21, total: 21 },
            tests: { passed: 344, total: 344 },
          },
          durationMs: 214_000,
        }),
        line({ gate: 'harness:android', device: 'emulator-5570' }),
      ],
      tree: TREE_A,
    });
    const rows = table.split('\n');
    expect(rows[0]).toBe(
      '| Gate | Result | Counts | Code tree | Duration | Load |'
    );
    expect(rows[1]).toBe('| --- | --- | --- | --- | --- | --- |');
    expect(rows.length).toBe(2 + MERGE_GATES.length);
    const check = rows.find((row) => row.includes('`check`'));
    expect(check).toContain('**PASS**');
    expect(check).toContain('344 tests / 21 suites');
    expect(check).toContain(`\`${head(TREE_A)}\``);
    expect(check).toContain('3 m 34 s');
    expect(check).toContain('start 3.1 / med 4.2 / max 9.1');
    expect(rows.find((row) => row.includes('`real-input:ios`'))).toContain(
      'missing'
    );
    expect(rows.find((row) => row.includes('`harness:ios`'))).toContain('—');
  });

  it('will not print PASS for a run from another code tree', () => {
    const table = renderGateTable({
      entries: [line({ gate: 'check', tree: TREE_B })],
      tree: TREE_A,
    });
    const check = table.split('\n').find((row) => row.includes('`check`'));
    expect(check).toContain('stale');
    expect(check).not.toContain('PASS');
    expect(check).toContain('(not this tree)');
  });

  it('shows a failure as a failure, failures first', () => {
    const table = renderGateTable({
      entries: [
        line({
          gate: 'harness:android',
          result: 'fail',
          exitCode: 1,
          counts: {
            suites: { passed: 10, failed: 1, total: 11 },
            tests: { passed: 160, failed: 2, total: 162 },
          },
        }),
      ],
      tree: TREE_A,
    });
    const row = table
      .split('\n')
      .find((line2) => line2.includes('`harness:android`'));
    expect(row).toContain('**FAIL**');
    expect(row).toContain('2 failed of 162 tests');
  });

  it('appends the log path only when asked', () => {
    const plain = renderGateTable({
      entries: [line({ gate: 'check' })],
      tree: TREE_A,
    });
    expect(plain).not.toContain('.gates/logs');
    const full = renderGateTable({
      entries: [line({ gate: 'check' })],
      tree: TREE_A,
      evidence: (entry) => `log \`${entry.logPath}\``,
    });
    expect(full).toContain('log `.gates/logs/check-1.log`');
  });
});

describe('parseTestCounts', () => {
  it('reads the summary a gate exited on', () => {
    expect(
      parseTestCounts(
        'Test Suites: 11 passed, 11 total\nTests: 162 passed, 162 total\n'
      )
    ).toEqual({
      suites: { passed: 11, total: 11 },
      tests: { passed: 162, total: 162 },
    });
    expect(
      parseTestCounts('Tests: 1 failed, 18 passed, 19 total').tests
    ).toEqual({
      failed: 1,
      passed: 18,
      total: 19,
    });
    expect(
      parseTestCounts('Tests: 2 skipped, 12 passed, 14 total').tests
    ).toEqual({
      skipped: 2,
      passed: 12,
      total: 14,
    });
  });

  it('reports the first summary, which is the unit step', () => {
    // `check` prints the unit summary first, then a much smaller one for the
    // perf step.
    const log =
      'Test Suites: 23 passed, 23 total\n' +
      'Tests: 391 passed, 391 total\n' +
      'Test Suites: 7 passed, 7 total\n' +
      'Tests: 7 passed, 7 total';
    expect(parseTestCounts(log).tests.total).toBe(391);
    expect(parseTestCounts(log).suites.total).toBe(23);
    expect(parseTestSummaries(log)).toHaveLength(2);
    expect(parseTestSummaries(log)[1].tests.total).toBe(7);
    expect(
      parseTestCounts(
        'Tests: 12 passed, 14 total\nTest Suites: 2 failed, 12 total'
      ).tests.total
    ).toBe(14);
  });

  it('pairs a `Test Suites` line with the `Tests` line that follows it', () => {
    const [only] = parseTestSummaries('Test Suites: 11 passed, 11 total');
    expect(only).toEqual({ suites: { passed: 11, total: 11 }, tests: null });
  });

  it('returns null rather than inventing counts', () => {
    expect(parseTestCounts('build finished, no tests ran')).toBeNull();
    expect(parseTestCounts('')).toBeNull();
    expect(parseTestCounts(null)).toBeNull();
  });
});

describe('summarizeLoad', () => {
  it('reports start, median and max over the whole run', () => {
    expect(summarizeLoad({ start: 4, samples: [4, 1, 9, 2, 3] })).toEqual({
      start: 4,
      median: 3,
      max: 9,
      count: 5,
      end: 3,
    });
    // An even count takes the mean of the middle two.
    expect(summarizeLoad({ start: 1, samples: [1, 2, 3, 100] })).toMatchObject({
      median: 2.5,
      max: 100,
      count: 4,
    });
  });

  it('does not report a median it never measured', () => {
    expect(summarizeLoad({ start: 2.5, samples: [] })).toEqual({
      start: 2.5,
      median: null,
      max: null,
      count: 0,
      end: null,
    });
    expect(summarizeLoad({ samples: [Number.NaN, 3] }).count).toBe(1);
  });
});

describe('resolveGate', () => {
  it('runs the same commands package.json runs, from the same directory', () => {
    expect(resolveGate('check')).toMatchObject({
      argv: ['bun', 'run', 'check'],
      cwd: 'repo',
      platform: null,
      bench: false,
    });
    // The harness entry point rather than `bun run`, so arguments survive.
    expect(resolveGate('harness:android')).toMatchObject({
      argv: ['node', '../scripts/harness.mjs', '--harnessRunner', 'android'],
      cwd: 'example',
      platform: 'android',
    });
    expect(resolveGate('real-input:ios')).toMatchObject({
      argv: ['node', 'scripts/real-input/ios.mjs'],
      platform: 'ios',
    });
    expect(resolveGate('smoke:rn-cli')).toMatchObject({
      argv: ['bash', 'scripts/smoke/rn-cli.sh'],
    });
  });

  it('appends a suite to a harness gate, in the name or after --', () => {
    expect(resolveGate('harness:android:ColdSizing').argv).toEqual([
      'node',
      '../scripts/harness.mjs',
      '--harnessRunner',
      'android',
      'ColdSizing',
    ]);
    expect(resolveGate('harness:ios', ['ColdSizing']).argv.slice(4)).toEqual([
      'ColdSizing',
    ]);
  });

  it('names a filtered run something other than the full gate (M1)', () => {
    // The name is what the ledger records and what `need` matches on.
    expect(resolveGate('harness:ios', ['ColdSizing']).gate).not.toBe(
      'harness:ios'
    );
    expect(resolveGate('harness:ios', ['ColdSizing']).gate).toBe(
      'harness:ios:ColdSizing'
    );
    expect(resolveGate('harness:android:ColdSizing').gate).toBe(
      'harness:android:ColdSizing'
    );
    expect(
      resolveGate('real-input:android', ['--control', 'switch']).gate
    ).toBe('real-input:android:--control:switch');
    // A recorded name can be pasted back as a command.
    expect(resolveGate('real-input:android:--control:switch').gate).toBe(
      'real-input:android:--control:switch'
    );
    // An argument with a separator in it cannot impersonate two arguments.
    expect(resolveGate('harness:android', ['a:b']).gate).toBe(
      'harness:android:a%3Ab'
    );
    expect(resolveGate('harness:android').gate).toBe('harness:android');
    expect(resolveGate('check').gate).toBe('check');
    expect(() => resolveGate('check', ['--coverage'])).toThrow(
      /check takes no arguments/
    );
  });

  it('routes bench to the bench runner and marks it a bench', () => {
    expect(resolveGate('bench')).toMatchObject({ bench: true, platform: null });
    expect(resolveGate('bench', ['--plan', 'quick']).argv.slice(1)).toEqual([
      'scripts/bench/run.mjs',
      '--plan',
      'quick',
    ]);
  });

  it("takes a bench platform from the bench's own --platform (X15)", () => {
    expect(
      resolveGate('bench', ['--platform', 'ios', '--plan', 'full'])
        .benchPlatform
    ).toBe('ios');
    expect(
      resolveGate('bench', ['--plan', 'quick', '--platform', 'android'])
        .benchPlatform
    ).toBe('android');
    // The colon spelling reaches the bench runner as one argument, which it
    // cannot parse, so no platform is read from it.
    expect(
      resolveGate('bench:--platform:ios:--plan:quick').benchPlatform
    ).toBeNull();
    // `platform` stays null for a bench: it is what claims a device and checks
    // the Metro port, and a bench does neither.
    expect(resolveGate('bench', ['--platform', 'ios']).platform).toBeNull();
    expect(resolveGate('bench', ['--platform', 'ios']).bench).toBe(true);
    expect(resolveGate('bench', ['--plan', 'quick']).benchPlatform).toBeNull();
    expect(
      resolveGate('bench', ['--platform', 'solar']).benchPlatform
    ).toBeNull();
    // A value that is another flag, or another option's value, is not a platform.
    expect(resolveGate('bench', ['--platform']).benchPlatform).toBeNull();
    expect(
      resolveGate('bench', ['--only', '--platform']).benchPlatform
    ).toBeNull();
    expect(
      resolveGate('bench', ['--compare', 'HEAD', '--platform', 'ios'])
        .benchPlatform
    ).toBe('ios');
    // The bench runner does not parse the `--platform=<p>` spelling.
    expect(
      resolveGate('bench', ['--platform=android']).benchPlatform
    ).toBeNull();
  });

  it("records the bench platform's device, not the lease's other side", () => {
    // A bench lease exports both sides of a pair.
    const env = {
      NITRO_UI_LEASE_ID: 'A5-1',
      IOS_SIM_UDID: 'UDID-A',
      IOS_SIM: 'iPhone 17',
      ANDROID_SERIAL: 'emulator-5574',
      ANDROID_AVD: 'nitro-ui-a',
    };
    // With no platform given, the environment's Android side answers.
    expect(deviceFromEnv(env, null).platform).toBe('android');
    const resolved = resolveGate('bench', [
      '--platform',
      'ios',
      '--plan',
      'quick',
    ]);
    expect(deviceFromEnv(env, resolved.benchPlatform)).toEqual({
      platform: 'ios',
      device: 'UDID-A',
      lease: 'A5-1',
    });
  });

  it('refuses a gate name it does not know, rather than running something', () => {
    expect(() => resolveGate('harness:both')).toThrow(
      /harness needs a platform/
    );
    expect(() => resolveGate('smoke:maybe')).toThrow(/smoke is one of/);
    expect(() => resolveGate('deploy')).toThrow(/unknown gate/);
  });
});

describe('ownMetroPids', () => {
  const listeners = (...pids) => pids.map((pid) => ({ pid, command: 'node' }));

  it('claims only the listeners whose group is the run’s own child', () => {
    expect(
      ownMetroPids({
        listeners: listeners(101, 102, 103),
        leaderPid: 100,
        groupOf: (pid) => ({ 101: 100, 102: 77, 103: 100 })[pid] ?? null,
      })
    ).toEqual([101, 103]);
  });

  it('claims nothing when the server is in another group - the case that must not kill', () => {
    expect(
      ownMetroPids({
        listeners: listeners(202),
        leaderPid: 100,
        groupOf: () => 202,
      })
    ).toEqual([]);
  });

  it('claims nothing when the kernel will not answer for the pid', () => {
    // A dead pid also reports no group.
    expect(
      ownMetroPids({
        listeners: listeners(301),
        leaderPid: 100,
        groupOf: () => null,
      })
    ).toEqual([]);
    const throwing = ownMetroPids({
      listeners: listeners(302),
      leaderPid: 100,
      groupOf: () => {
        throw new Error('pid gone');
      },
    });
    expect(throwing).toEqual([]);
  });

  it('never targets the leader pid itself, even when its group matches', () => {
    // The sweep runs after the child has exited, so a listener with the leader's
    // pid is an unrelated process that was handed the recycled number.
    expect(
      ownMetroPids({
        listeners: [{ pid: 100, command: 'node' }],
        leaderPid: 100,
        groupOf: () => 100,
      })
    ).toEqual([]);
  });

  it('ignores nonsense pids and a run with no leader', () => {
    expect(
      ownMetroPids({
        listeners: [
          { pid: 0, command: '' },
          { pid: -1, command: '' },
        ],
        leaderPid: 100,
        groupOf: () => 100,
      })
    ).toEqual([]);
    expect(ownMetroPids({ leaderPid: 100, groupOf: () => 100 })).toEqual([]);
  });

  it('requires a leader pid, so a sweep without one stops nothing', () => {
    expect(
      ownMetroPids({
        listeners: listeners(101),
        leaderPid: null,
        groupOf: () => 100,
      })
    ).toEqual([]);
  });
});

describe('deviceFromEnv', () => {
  it('records the lease id and serial a device gate ran under', () => {
    expect(
      deviceFromEnv(
        {
          NITRO_UI_LEASE_ID: 'X2-kwv6c',
          ANDROID_SERIAL: 'emulator-5570',
          ANDROID_AVD: 'nitroui_t01',
        },
        'android'
      )
    ).toEqual({
      platform: 'android',
      device: 'emulator-5570',
      lease: 'X2-kwv6c',
    });
    expect(
      deviceFromEnv(
        { NITRO_UI_LEASE_ID: 'X2-2', IOS_SIM_UDID: 'UDID-1' },
        'ios'
      )
    ).toEqual({ platform: 'ios', device: 'UDID-1', lease: 'X2-2' });
  });

  it('records nothing device-shaped for check, and no AVD name when there is no serial', () => {
    // Ledger lines are committed, so they carry no device name of this machine
    // beyond the serial a lease exported for the run.
    expect(deviceFromEnv({}, null)).toEqual({
      platform: null,
      device: null,
      lease: null,
    });
    expect(
      deviceFromEnv({ ANDROID_AVD: 'nitroui_t01' }, null).device
    ).toBeNull();
  });
});

/** Maps `path -> content` to `path -> content hash`, for code files only. */
function hashOf(files) {
  const entries = {};
  for (const [file, content] of Object.entries(files)) {
    if (isCodeFile(file)) entries[file] = contentHash(content);
  }
  return entries;
}

function fullTreeOf(files) {
  return codeTreeDigest(hashOf(files));
}

function platformTreesOf(files) {
  return platformTreesFromEntries(hashOf(files));
}

describe('platformMappingFor / tooling class', () => {
  it('maps the platform directories, including the halves N3 left coarse', () => {
    expect(
      platformMappingFor('ios/components/Button/Switch.swift').platforms
    ).toEqual(['ios']);
    expect(platformMappingFor('example/ios/Podfile').platforms).toEqual([
      'ios',
    ]);
    expect(
      platformMappingFor('example/android/app/build.gradle').platforms
    ).toEqual(['android']);
    expect(
      platformMappingFor('nitrogen/generated/ios/Autolink.swift').platforms
    ).toEqual(['ios']);
    expect(
      platformMappingFor('nitrogen/generated/android/Autolink.kt').platforms
    ).toEqual(['android']);
    for (const shared of [
      'nitrogen/generated/shared/Types.hpp',
      'src/index.ts',
      'cpp/ui/Switch.cpp',
    ]) {
      expect(platformMappingFor(shared).platforms).toEqual(['ios', 'android']);
    }
  });

  it('treats the check-only allow-list as no platform at all', () => {
    for (const tooling of [
      'scripts/__tests__/gate.test.js',
      'scripts/gate.mjs',
      'scripts/gate-core.mjs',
      'scripts/bench/run.mjs',
      'scripts/perf/renders.mjs',
      'scripts/smoke/pack.sh',
      'scripts/package-files.mjs',
      'eslint-rules/no-raw-colors.js',
      'etc/package-files.txt',
      '.changeset/config.json',
      '.gitignore',
      '.prettierignore',
      // Under `example/src/`, but nothing in the app imports it: the README check
      // reads it as text.
      'example/src/readme-examples.tsx',
    ]) {
      expect(isToolingPath(tooling)).toBe(true);
      expect(platformsOwningFile(tooling)).toEqual([]);
    }
    expect(
      platformsTouchedByPaths(['scripts/gate.mjs', 'eslint-rules/x.js'])
    ).toEqual({ platforms: [], unmapped: [], tooling: expect.any(Array) });
  });

  it('keeps every path a device run depends on out of the allow-list', () => {
    // Each of these is loaded by the harness config, Metro or the app build.
    for (const deviceRunInput of [
      'scripts/app-stamp.mjs',
      'scripts/app-stamp-core.mjs',
      'scripts/node-version.mjs',
      'scripts/harness-run-state.js',
      'scripts/harness.mjs',
      'scripts/real-input/android.mjs',
      'scripts/build-app.mjs',
      'scripts/pod-install.mjs',
      'scripts/patch-nitrogen.mjs',
    ]) {
      expect(isToolingPath(deviceRunInput)).toBe(false);
      expect(platformsOwningFile(deviceRunInput)).toEqual(['ios', 'android']);
    }

    // The one exception: the harness config imports environment guards from
    // `lease-core.mjs`, but the app is not built from them.
    for (const allocator of ['scripts/lease.mjs', 'scripts/lease-core.mjs']) {
      expect(isToolingPath(allocator)).toBe(true);
      expect(platformsOwningFile(allocator)).toEqual([]);
    }
  });
});

describe('platformTreesFromEntries (the key M2 rests on)', () => {
  const ROUND_ONE = {
    'ios/components/Button/Switch.swift': 'swift-v1',
    'android/src/main/ui/Switch.kt': 'kt-v1',
    'src/ui/Shared.ts': 'ts-v1',
    'scripts/gate.mjs': 'tooling-v1',
  };

  it('puts shared code in both halves and tooling in neither', () => {
    const trees = platformTreesOf(ROUND_ONE);
    const iosOnly = platformTreesFromEntries(
      hashOf({ 'ios/a.swift': 'x', 'example/ios/Podfile': 'y' })
    );
    expect(trees.ios).not.toBe(trees.android);
    expect(iosOnly.android).toBe(
      platformTreesFromEntries(hashOf({})).android,
      'a tree of only iOS files has an empty Android half'
    );
    // A tooling change moves neither half.
    expect(
      platformTreesOf({ ...ROUND_ONE, 'scripts/gate.mjs': 'tooling-v2' })
    ).toEqual(trees);
  });

  it('moves only the Android half when only Android changed', () => {
    const before = platformTreesOf(ROUND_ONE);
    const after = platformTreesOf({
      ...ROUND_ONE,
      'android/src/main/ui/Switch.kt': 'kt-v2',
    });
    expect(after.ios).toBe(before.ios);
    expect(after.android).not.toBe(before.android);
    expect(fullTreeOf(ROUND_ONE)).not.toBe(fullTreeOf(after));
  });

  it('moves both halves when shared code changed', () => {
    const before = platformTreesOf(ROUND_ONE);
    const after = platformTreesOf({
      ...ROUND_ONE,
      'src/ui/Shared.ts': 'ts-v2',
    });
    expect(after.ios).not.toBe(before.ios);
    expect(after.android).not.toBe(before.android);
  });
});

describe('the fix-round rule (M2)', () => {
  const ROUND_ONE = {
    'ios/components/Button/Switch.swift': 'swift-v1',
    'android/src/main/ui/Switch.kt': 'kt-v1',
  };
  const roundOneTree = fullTreeOf(ROUND_ONE);
  const roundOneTrees = platformTreesOf(ROUND_ONE);

  function lineOn(gate, tree, trees, result = 'pass') {
    return line({ gate, tree, trees, result });
  }

  function afterRoundOne() {
    expect(platformsTouchedByPaths(Object.keys(ROUND_ONE)).platforms).toEqual([
      'ios',
      'android',
    ]);
    return [
      lineOn('check', roundOneTree, roundOneTrees),
      lineOn('harness:ios', roundOneTree, roundOneTrees),
      lineOn('harness:android', roundOneTree, roundOneTrees),
    ];
  }

  it('an Android-only fix does not re-owe the iOS run', () => {
    const fixed = { ...ROUND_ONE, 'android/src/main/ui/Switch.kt': 'kt-v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    expect(
      platformsTouchedByPaths(['android/src/main/ui/Switch.kt']).platforms
    ).toEqual(['android']);
    // `need` reads the whole branch diff, which touched both platforms, so iOS
    // stays required; its earlier line still matches the iOS half of the tree.
    const touched = platformsTouchedByPaths(Object.keys(fixed));
    expect(touched.platforms).toEqual(['ios', 'android']);

    const entries = [
      ...afterRoundOne(),
      lineOn('check', tree, trees),
      lineOn('harness:android', tree, trees),
    ];
    const review = decideNeed({
      entries,
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: touched.platforms,
    });
    expect(review.ok).toBe(true);
    expect(review.required.map((row) => row.gate)).toEqual([
      'check',
      'harness:ios',
      'harness:android',
    ]);
    expect(review.missing).toEqual([]);
    const iosRow = review.required.find((row) => row.gate === 'harness:ios');
    expect(iosRow.entry.tree).toBe(roundOneTree);
    expect(iosRow.state).toBe('green');
    expect(iosRow.matched).toBe('ios');

    const merge = decideNeed({ entries, tree, trees, stage: 'merge' });
    expect(merge.missing).not.toContain('harness:ios');
    expect(
      merge.required.find((row) => row.gate === 'harness:ios').matched
    ).toBe('ios');
  });

  it('an iOS-only fix still re-ows Android, because it must', () => {
    const fixed = { ...ROUND_ONE, 'ios/components/Button/Switch.swift': 'v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    const entries = [
      ...afterRoundOne(),
      lineOn('check', tree, trees),
      lineOn('harness:ios', tree, trees),
    ];
    const review = decideNeed({
      entries,
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: platformsTouchedByPaths([
        'ios/components/Button/Switch.swift',
      ]).platforms,
    });
    expect(review.required.map((row) => row.gate)).toEqual([
      'check',
      'harness:ios',
    ]);
    // At merge the earlier Android line still counts: an iOS file is not in the
    // Android half of the tree.
    const merge = decideNeed({ entries, tree, trees, stage: 'merge' });
    expect(merge.missing).not.toContain('harness:android');
    expect(
      merge.required.find((row) => row.gate === 'harness:android').matched
    ).toBe('android');
  });

  it('a shared-code fix re-ows both platforms', () => {
    const fixed = { ...ROUND_ONE, 'src/ui/Shared.ts': 'ts-v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    const touched = platformsTouchedByPaths(['src/ui/Shared.ts']);
    expect(touched.platforms).toEqual(['ios', 'android']);
    const review = decideNeed({
      entries: afterRoundOne(),
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: touched.platforms,
    });
    expect(review.missing).toEqual(['check', 'harness:ios', 'harness:android']);
  });

  it('a tooling-only fix asks for check and nothing else', () => {
    const fixed = { ...ROUND_ONE, 'scripts/gate.mjs': 'tooling-v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    expect(trees).toEqual(roundOneTrees);
    const touched = platformsTouchedByPaths(['scripts/gate.mjs']);
    expect(touched.platforms).toEqual([]);
    const review = decideNeed({
      entries: afterRoundOne(),
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: touched.platforms,
      toolingPaths: touched.tooling,
    });
    expect(review.required.map((row) => row.gate)).toEqual(['check']);
    expect(review.notes.join(' ')).toMatch(/tooling \(check-only\)/);
  });
});

describe('the merge bar keys a device gate on its platform half (X30 item 1)', () => {
  const GATED = {
    'ios/components/Button/Switch.swift': 'swift-v1',
    'android/src/main/ui/Switch.kt': 'kt-v1',
  };
  const gatedTree = fullTreeOf(GATED);
  const gatedTrees = platformTreesOf(GATED);

  function lineOn(gate, tree, trees, result = 'pass') {
    return line({ gate, tree, trees, result });
  }

  function gatedLedger(extra = []) {
    return [
      ...MERGE_GATES.map((gate) => lineOn(gate, gatedTree, gatedTrees)),
      ...extra,
    ];
  }

  it('asks a device gate for its own digest at both stages, and check for the whole', () => {
    for (const stage of ['review', 'merge']) {
      expect(digestKeyFor({ gate: 'harness:ios', stage })).toBe('harness:ios');
      expect(digestKeyFor({ gate: 'real-input:android', stage })).toBe(
        'real-input:android'
      );
      expect(digestKeyFor({ gate: 'harness:android:ColdSizing', stage })).toBe(
        'harness:android'
      );
      expect(digestKeyFor({ gate: 'check', stage })).toBe('full');
      expect(digestKeyFor({ gate: 'smoke:pack', stage })).toBe('full');
      expect(digestKeyFor({ gate: 'bench', stage })).toBe('full');
    }
  });

  it('a tooling-only commit on main re-owns check and no device run', () => {
    const after = {
      ...GATED,
      'scripts/__tests__/gate.test.js': 'fixture-v2',
      'scripts/gate-core.mjs': 'gate-core-v2',
    };
    const tree = fullTreeOf(after);
    const trees = platformTreesOf(after);
    expect(tree).not.toBe(gatedTree); // `check` has to run again...
    expect(trees).toEqual(gatedTrees); // ... and nothing that ran on a device did
    const decision = decideNeed({
      entries: gatedLedger(),
      tree,
      trees,
      stage: 'merge',
    });
    expect(decision.missing).toEqual(['check']);
    for (const gate of ['harness:ios', 'harness:android']) {
      const row = decision.required.find((entry) => entry.gate === gate);
      expect(row.state).toBe('green');
      expect(row.matched).toBe(gate.split(':')[1]);
      expect(row.entry.tree).toBe(gatedTree);
    }
  });

  it('a change in a platform half still re-owns that platform at merge', () => {
    const after = { ...GATED, 'android/src/main/ui/Switch.kt': 'kt-v2' };
    const tree = fullTreeOf(after);
    const trees = platformTreesOf(after);
    expect(trees.ios).toBe(gatedTrees.ios);
    expect(trees.android).not.toBe(gatedTrees.android);
    const decision = decideNeed({
      entries: gatedLedger(),
      tree,
      trees,
      stage: 'merge',
    });
    // `check` reads the whole tree, so it is owed again too.
    expect(decision.missing).toEqual([
      'check',
      'harness:android',
      'real-input:android',
    ]);
    expect(
      decision.required.find((row) => row.gate === 'harness:android').why
    ).toBe('tree');
  });

  it('shared code re-owns both platforms, and an unmapped path re-owns both too', () => {
    // `src/` is in both binaries; `example/src/` is a path the mapping does not
    // claim, and an unknown path counts for both platforms.
    for (const [file, expected] of [
      ['src/ui/Shared.ts', ['harness:ios', 'harness:android']],
      ['example/src/Main.tsx', ['harness:ios', 'harness:android']],
    ]) {
      const after = { ...GATED, [file]: 'v2' };
      const tree = fullTreeOf(after);
      const trees = platformTreesOf(after);
      expect(trees).not.toEqual(gatedTrees);
      const decision = decideNeed({
        entries: gatedLedger(),
        tree,
        trees,
        stage: 'merge',
      });
      expect(
        decision.missing.filter((gate) => expected.includes(gate))
      ).toEqual(expected);
    }
  });

  it("never reads one platform's line as the other platform's evidence", () => {
    // An iOS line records `trees.android` too.
    const entries = [lineOn('harness:ios', gatedTree, gatedTrees)];
    const decision = decideNeed({
      entries,
      tree: gatedTree,
      trees: gatedTrees,
      stage: 'merge',
    });
    expect(
      decision.required.find((row) => row.gate === 'harness:ios').state
    ).toBe('green');
    expect(
      decision.required.find((row) => row.gate === 'harness:android').state
    ).toBe('missing');
  });

  it('a v1 line with no halves is still held to the whole tree', () => {
    const moved = { ...GATED, 'ios/extra/New.swift': 'v2' };
    const stale = gateStateFor({
      gate: 'harness:ios',
      entry: lineOn('harness:ios', gatedTree, null),
      stage: 'merge',
      tree: fullTreeOf(moved),
      trees: platformTreesOf(moved),
    });
    expect(stale.state).toBe('stale');
    const same = gateStateFor({
      gate: 'harness:ios',
      entry: lineOn('harness:ios', gatedTree, null),
      stage: 'merge',
      tree: gatedTree,
      trees: gatedTrees,
    });
    expect(same.state).toBe('green');
    expect(same.matched).toBe('full');
  });

  it('a red on this half is still a red at merge, and a moved tree is still moved', () => {
    const failed = gateStateFor({
      gate: 'harness:ios',
      entry: lineOn('harness:ios', gatedTree, gatedTrees, 'fail'),
      stage: 'merge',
      tree: gatedTree,
      trees: gatedTrees,
    });
    expect(failed.state).toBe('red');
    const moved = gateStateFor({
      gate: 'harness:ios',
      entry: {
        ...lineOn('harness:ios', gatedTree, gatedTrees),
        treeAfter: TREE_B,
      },
      stage: 'merge',
      tree: gatedTree,
      trees: gatedTrees,
    });
    expect(moved.state).toBe('stale');
    expect(moved.why).toBe('moved');
  });
});

describe('a line that is not about this tree (N1, N2)', () => {
  it('is never green when the tree moved while the run went on', () => {
    const moved = line({ gate: 'check', tree: TREE_A, treeAfter: TREE_B });
    expect(
      gateStateFor({
        gate: 'check',
        entry: moved,
        tree: TREE_A,
        stage: 'merge',
      }).state
    ).toBe('stale');
    expect(
      gateStateFor({
        gate: 'check',
        entry: moved,
        tree: TREE_A,
        stage: 'merge',
      }).why
    ).toBe('moved');
    // A run that started and ended on this tree outranks a later one whose tree
    // moved under it.
    const rows = gateRowFor({
      gate: 'check',
      list: [line({ gate: 'check' }), moved],
      tree: TREE_A,
      stage: 'merge',
    });
    expect(rows.state).toBe('green');
    expect(
      gateRowFor({
        gate: 'check',
        list: [moved],
        tree: TREE_A,
        stage: 'merge',
      }).state
    ).toBe('stale');
  });

  it('prefers the latest line for the tree being asked about', () => {
    const entries = [
      line({ gate: 'check', tree: TREE_A, commit: 'c1' }),
      line({ gate: 'check', tree: TREE_B, commit: 'c2', result: 'fail' }),
    ];
    expect(
      gateRowFor({
        gate: 'check',
        list: listByGate(entries).check,
        tree: TREE_A,
      }).state
    ).toBe('green');
    expect(
      gateRowFor({
        gate: 'check',
        list: listByGate(entries).check,
        tree: TREE_B,
      }).state
    ).toBe('red');
  });

  it('prints an older tree as stale, never as FAIL', () => {
    const table = renderGateTable({
      entries: [
        line({ gate: 'harness:android', tree: TREE_A, result: 'fail' }),
      ],
      tree: TREE_B,
      stage: 'merge',
    });
    expect(table).toContain('stale');
    expect(table).not.toContain('**FAIL**');
    expect(table).toContain('(not this tree)');
  });
});

describe('changedPathsGitArgs (M4)', () => {
  it('never follows a rename when asking what a diff touched', () => {
    const [committed, withWorktree] = changedPathsGitArgs('deadbeef');
    for (const args of [committed, withWorktree]) {
      expect(args).toContain('--no-renames');
      expect(args).toContain('--name-only');
    }
    expect(committed.join(' ')).toContain('deadbeef...HEAD');
    expect(withWorktree).not.toContain('deadbeef...HEAD');
  });
});

describe('countsForDisplay (M3)', () => {
  const JEST = {
    suites: { passed: 23, total: 23 },
    tests: { passed: 391, total: 391 },
  };
  const PERF = {
    suites: { passed: 7, total: 7 },
    tests: { passed: 7, total: 7 },
  };

  it('reports the unit step when every step passed', () => {
    const entry = line({
      gate: 'check',
      counts: JEST,
      summaries: [JEST, PERF],
    });
    expect(countsForDisplay(entry)).toEqual(JEST);
    expect(renderGateTable({ entries: [entry], tree: TREE_A })).toContain(
      '391 tests / 23 suites'
    );
  });

  it('sums the failures across steps when any step failed', () => {
    const failingPerf = {
      suites: { passed: 6, failed: 1, total: 7 },
      tests: { passed: 5, failed: 2, total: 7 },
    };
    const entry = line({
      gate: 'check',
      result: 'fail',
      counts: JEST,
      summaries: [JEST, failingPerf],
    });
    const shown = countsForDisplay(entry);
    expect(shown.tests.failed).toBe(2);
    expect(shown.tests.total).toBe(398);
    expect(
      renderGateTable({
        entries: [{ ...entry, result: 'fail' }],
        tree: TREE_A,
      })
    ).toMatch(/2 failed of 398 tests/);
  });

  it('shows a full harness run with its isolated run beside it (G14)', () => {
    const ISOLATED = {
      suites: { passed: 1, total: 1 },
      tests: { passed: 2, total: 2 },
    };
    const passing = line({
      gate: 'harness:ios',
      counts: JEST,
      summaries: [JEST, ISOLATED],
    });
    expect(renderGateTable({ entries: [passing], tree: TREE_A })).toContain(
      '391 tests / 23 suites + isolated 2 tests / 1 suites'
    );
    const red = {
      suites: { passed: 1, failed: 1, total: 2 },
      tests: { passed: 2, failed: 1, total: 3 },
    };
    const failing = line({
      gate: 'harness:android',
      result: 'fail',
      counts: JEST,
      summaries: [JEST, red],
    });
    expect(
      renderGateTable({
        entries: [{ ...failing, result: 'fail' }],
        tree: TREE_A,
      })
    ).toContain(
      '391 tests / 23 suites + isolated 1 failed of 3 tests / 2 suites'
    );
  });

  it('still reports a single step as itself', () => {
    expect(
      countsForDisplay(line({ gate: 'harness:ios', counts: JEST }))
    ).toEqual(JEST);
    expect(countsForDisplay(undefined)).toBeNull();
  });
});

describe('summarizeLoad rounding (N5)', () => {
  it('rounds the start sample like the others', () => {
    const samples = [13.54443359375, 20.4, 31.9];
    const load = summarizeLoad({ start: 13.54443359375, samples });
    expect(load).toEqual({
      start: 13.54,
      median: 20.4,
      max: 31.9,
      count: 3,
      end: 31.9,
    });
    expect(summarizeLoad({ start: 13.54443359375, samples: [] }).start).toBe(
      13.54
    );
    expect(summarizeLoad({ start: null, samples: [] }).count).toBe(0);
  });
});

/**
 * The CLI fixtures put `node` and `bun` shims on `PATH`. On an unsupported Node,
 * `gate.mjs` re-execs itself under a real node and never reaches the shims, so
 * those tests are skipped there. The answer is asked of `node-version.mjs` in a
 * child process: it uses `import.meta`, which jest's CJS transform rejects.
 */
const runtime = (() => {
  const probeFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'x2-gate-node-')),
    'probe.mjs'
  );
  fs.writeFileSync(
    probeFile,
    'import { isSupportedNodeVersion } from ' +
      JSON.stringify(path.join(process.cwd(), 'scripts', 'node-version.mjs')) +
      ';\n' +
      'process.stdout.write(JSON.stringify({' +
      'supported: isSupportedNodeVersion(process.versions.node),' +
      'version: process.versions.node' +
      '}));\n'
  );
  const probe = spawnSync(process.execPath, [probeFile], {
    encoding: 'utf8',
  });
  fs.rmSync(path.dirname(probeFile), { recursive: true, force: true });
  try {
    return JSON.parse(String(probe.stdout));
  } catch {
    return { supported: true, version: process.versions.node };
  }
})();

const describeCli = runtime.supported ? describe : describe.skip;

if (!runtime.supported) {
  describe('gate.mjs (the CLI) cannot be tested on this runtime', () => {
    it(`SKIPPED: the CLI fixtures need the Node the gates run on, and this is ${runtime.version}, where gate.mjs re-execs past the fake runner`, () => {
      expect(runtime.supported).toBe(false);
    });
  });
}

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

function gitIn(dir, args) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      HOME: dir,
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return String(result.stdout).trim();
}

/**
 * @param {Record<string, string>} files path -> contents at the base commit
 * @param {(dir: string) => void} [onBranch] what the task branch then changes
 */
function makeCheckout(files, onBranch = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x2-gate-'));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.mkdirSync(path.join(dir, 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'example/package.json'), '{"name":"x"}\n');
  // Ignored as in the real repo: a ledger, log or lease store counted as code
  // would move the tree while a gate runs and make its own line read stale.
  fs.writeFileSync(
    path.join(dir, '.gitignore'),
    '.gates/\nfake-bin/\nstate/\n'
  );
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-qm', 'base']);
  gitIn(dir, ['checkout', '-qb', 'task/x2-fixture']);
  // The lease store lives in the fixture, so no test reads or writes a real lease.
  writeLeaseStore(path.join(dir, 'state'), {
    pairs: [DEFAULT_PAIR, OTHER_PAIR],
    leases: [FIXTURE_LEASE],
  });
  onBranch(dir);
  return dir;
}

function writeFakeRunner(dir) {
  const bin = path.join(dir, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  // Two cases where a descendant outlives the run and keeps the child's pipes open.
  // Each prints the run's whole output and exits before the default summary, and
  // writes the descendant's pid where the test can find it and clean it up.
  const leakedDescendantCases =
    // Holds both pipes open for 10 s after the run is over.
    'if [ -n "$FAKE_HOLD_OPEN" ]; then\n' +
    '  ( sleep 10 ) &\n' +
    '  echo "$!" > "$FAKE_HOLD_OPEN"\n' +
    '  echo "Test Suites: 1 passed, 1 total"\n' +
    '  echo "Tests: 1 passed, 1 total"\n' +
    '  exit 0\n' +
    'fi\n' +
    // stdout closes when the child exits; the subshell keeps only stderr open for
    // half a second and then writes a second summary into it through fd 4.
    'if [ -n "$FAKE_HOLD_TAIL" ]; then\n' +
    '  echo "Test Suites: 1 passed, 1 total"\n' +
    '  echo "Tests: 1 passed, 1 total"\n' +
    '  ( sleep 0.5; echo "Test Suites: 7 passed, 7 total" >&4; ' +
    'echo "Tests: 7 passed, 7 total" >&4 ) 4>&2 2>/dev/null 1>/dev/null &\n' +
    '  echo "$!" > "$FAKE_HOLD_TAIL"\n' +
    '  exit 0\n' +
    'fi\n';

  const script =
    '#!/bin/sh\n' +
    'echo "fake runner: $0 $*"\n' +
    leakedDescendantCases +
    'echo "Test Suites: 23 passed, 23 total"\n' +
    'echo "Tests: 391 passed, 391 total"\n' +
    'if [ -n "$FAKE_SECOND_SUMMARY" ]; then\n' +
    '  echo "Test Suites: 7 passed, 7 total"\n' +
    '  echo "Tests: 7 passed, 7 total"\n' +
    'fi\n' +
    'if [ -n "$FAKE_PROGRESS" ]; then echo "$FAKE_PROGRESS"; fi\n' +
    // Prints the pool's claims as they are while the run is in flight.
    'if [ -n "$FAKE_SHOW_CLAIMS" ]; then echo "claims-during-run:"; cat "$NITRO_UI_HOME/pool.json"; fi\n' +
    'if [ -n "$FAKE_SHOW_GATE_LOG_ENV" ]; then echo "child sees gate-log env [${NITRO_UI_GATE_LOG-unset}]"; fi\n' +
    // Says it is ready, waits to be signalled, and reports the signal it received.
    'if [ -n "$FAKE_TRAP" ]; then\n' +
    '  trap \'echo "fake: caught $FAKE_TRAP"; exit 3\' "$FAKE_TRAP"\n' +
    '  echo "fake: ready"\n' +
    '  i=0\n' +
    '  while [ "$i" -lt 300 ]; do sleep 0.1; i=$((i+1)); done\n' +
    '  exit 0\n' +
    'fi\n' +
    'if [ -n "$FAKE_SLEEP" ]; then sleep "$FAKE_SLEEP"; fi\n' +
    'if [ -n "$FAKE_PROGRESS_AFTER" ]; then echo "$FAKE_PROGRESS_AFTER"; fi\n' +
    'exit ${FAKE_EXIT:-0}\n';
  for (const name of ['node', 'bun']) {
    const shim = path.join(bin, name);
    fs.writeFileSync(shim, script);
    fs.chmodSync(shim, 0o755);
  }
  return bin;
}

function runCli(dir, args, extraEnv = {}) {
  const bin = writeFakeRunner(dir);
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      // The calling shell's lease is replaced by the fixture's own, and the stub
      // answers "nothing is listening" when the gate checks its Metro port.
      ...withoutLeaseEnv(process.env),
      ...fixtureEnv(dir),
      ...FREE_LSOF,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      ...extraEnv,
    },
  });
}

/** `runCli` without waiting for the exit, for tests that signal the running CLI. */
function spawnCli(dir, args, extraEnv = {}) {
  const bin = writeFakeRunner(dir);
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...withoutLeaseEnv(process.env),
      ...fixtureEnv(dir),
      ...FREE_LSOF,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      ...extraEnv,
    },
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output.stderr += String(chunk);
  });
  return { child, output };
}

/** Resolves when `text` appears in `output`, or rejects with what was seen. */
async function waitUntil(output, text, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (output.stdout.includes(text) || output.stderr.includes(text)) return;
    if (Date.now() > deadline) {
      throw new Error(
        `never saw ${JSON.stringify(text)} in:\n${output.stdout}\n${output.stderr}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Resolves on the child's `close`, or rejects with its output after the timeout.
 * Call it before signalling the child: `close` fires once.
 */
function closed(child, output, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `the gate did not exit within ${timeoutMs} ms. stdout:\n${output.stdout}\nstderr:\n${output.stderr}`
          )
        ),
      timeoutMs
    );
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function ledgerLines(dir) {
  const file = path.join(dir, '.gates', 'task', 'x2-fixture.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((raw) => raw.trim() !== '')
    .map((raw) => JSON.parse(raw));
}

describeCli('gate.mjs (the CLI, in a throwaway checkout)', () => {
  const cleanup = [];

  function checkout(files, onBranch) {
    const dir = makeCheckout(files, onBranch);
    cleanup.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records a filtered run under its own name, and need still wants the gate', async () => {
    const dir = checkout(
      {
        'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
        'ios/components/Button/Switch.swift': 'v1\n',
      },
      (target) => {
        fs.mkdirSync(path.join(target, 'android/src/main/ui'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(target, 'android/src/main/ui/Switch.kt'),
          'v1\n'
        );
        gitIn(target, ['add', '-A']);
        gitIn(target, ['commit', '-qm', 'touch android']);
      }
    );
    const run = runCli(dir, ['harness:android', '--', 'ColdSizing']);
    expect(run.status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].gate).toBe('harness:android:ColdSizing');
    expect(lines[0].result).toBe('pass');
    expect(lines[0].trees.ios).toEqual(expect.any(String));
    expect(lines[0].treeAfter).toBe(lines[0].tree);

    const need = runCli(dir, ['need', '--for', 'review', '--base', 'main']);
    expect(need.status).toBe(1);
    expect(need.stdout).toContain('harness:android — never run on this tree');
    expect(need.stdout).not.toContain('✓ harness:android —');
  }, 60_000);

  it('records the full run under the bare name, and review then passes', async () => {
    const dir = checkout(
      {
        'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
        'android/src/main/ui/Switch.kt': 'v1\n',
      },
      (target) => {
        fs.writeFileSync(
          path.join(target, 'android/src/main/ui/Switch.kt'),
          'v2\n'
        );
        gitIn(target, ['add', '-A']);
        gitIn(target, ['commit', '-qm', 'touch android']);
      }
    );
    expect(runCli(dir, ['check'], { FAKE_SECOND_SUMMARY: '1' }).status).toBe(0);
    expect(runCli(dir, ['harness:android']).status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines.map((entry) => entry.gate)).toEqual([
      'check',
      'harness:android',
    ]);
    expect(lines[0].counts.tests.total).toBe(391);
    expect(lines[0].summaries).toHaveLength(2);
    expect(lines[0].summaries[1].tests.total).toBe(7);

    const need = runCli(dir, ['need', '--for', 'review', '--base', 'main']);
    expect(need.stdout).toContain('need: review is satisfied');
    expect(need.status).toBe(0);
    const table = runCli(dir, ['table']);
    // The fake runner prints the same summary for every gate, so only the
    // `check` row is read.
    const checkRow = table.stdout
      .split('\n')
      .find((row) => row.startsWith('| `check` '));
    expect(checkRow).toContain('**PASS**');
    expect(checkRow).toContain('391 tests / 23 suites');
    const merge = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(merge.status).toBe(1);
    expect(merge.stdout).toContain('real-input:ios');
  }, 60_000);

  it('refuses arguments to check and records nothing', () => {
    const dir = checkout({
      'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
    });
    const run = runCli(dir, ['check', '--', '--coverage']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('check takes no arguments');
    expect(ledgerLines(dir)).toEqual([]);
  });

  it('still asks for iOS when a rename moves a file out of ios/', () => {
    // git follows renames by default, which reports only the new path.
    const dir = checkout(
      {
        'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
        'ios/components/Button/Switch.swift': 'v1\n',
      },
      (target) => {
        fs.mkdirSync(path.join(target, 'bench/attic'), { recursive: true });
        gitIn(target, [
          'mv',
          'ios/components/Button/Switch.swift',
          'bench/attic/Switch.swift',
        ]);
        gitIn(target, ['commit', '-qm', 'move the button out']);
      }
    );
    const need = runCli(dir, ['need', '--for', 'review', '--base', 'main']);
    expect(need.status).toBe(1);
    expect(need.stdout).toContain('harness:ios');
    expect(need.stdout).not.toContain('touches no platform-specific code');
  });
});

describe('decideWait / pidMayBeRunning', () => {
  const running = (overrides = {}) => ({
    pid: 4242,
    done: false,
    gate: 'check',
    ...overrides,
  });

  it('keeps waiting while the record is open and the process is alive', () => {
    const decision = decideWait({
      record: running(),
      pidAlive: true,
      elapsedMs: 30_000,
      timeoutMs: 600_000,
      progress: 'Compiling Switch.swift',
    });
    expect(decision.kind).toBe('running');
    expect(decision.message).toContain('Compiling Switch.swift');
  });

  it('says "still running" at the budget instead of a failure', () => {
    const decision = decideWait({
      record: running(),
      pidAlive: true,
      elapsedMs: 600_001,
      timeoutMs: 600_000,
      progress: null,
    });
    expect(decision.kind).toBe('exit');
    expect(decision.exitCode).toBe(STILL_RUNNING_EXIT);
    expect(decision.message).toContain('still running');
  });

  it('reads a signal-killed gate as a failure, not as exit 0', () => {
    const decision = decideWait({
      record: running({
        done: true,
        exitCode: null,
        signal: 'SIGKILL',
        result: 'fail',
      }),
      pidAlive: false,
      elapsedMs: 1_000,
      timeoutMs: 600_000,
      progress: null,
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.message).toContain('SIGKILL');
  });

  it('passes on a record that says it passed', () => {
    expect(
      decideWait({
        record: running({ done: true, exitCode: 0, result: 'pass' }),
        pidAlive: false,
        elapsedMs: 0,
        timeoutMs: 600_000,
        progress: null,
      }).exitCode
    ).toBe(0);
  });

  it('names the last log line when a runner is gone without a result', () => {
    const decision = decideWait({
      record: running(),
      pidAlive: false,
      elapsedMs: 1_000,
      timeoutMs: 600_000,
      progress: 'Linking nitroui_b',
      ledgerEntry: null,
    });
    expect(decision.exitCode).toBe(STILL_RUNNING_EXIT);
    expect(decision.message).toContain('Linking nitroui_b');
  });

  it('answers from the ledger line when the record lies about being open', () => {
    const failed = decideWait({
      record: running(),
      pidAlive: false,
      elapsedMs: 1_000,
      timeoutMs: 600_000,
      progress: null,
      ledgerEntry: { gate: 'check', result: 'fail', exitCode: 7 },
    });
    expect(failed.exitCode).toBe(7);
    expect(failed.message).toContain('from the ledger line');
    expect(
      decideWait({
        record: running(),
        pidAlive: false,
        elapsedMs: 1_000,
        timeoutMs: 600_000,
        progress: null,
        ledgerEntry: { gate: 'check', result: 'pass', exitCode: 0 },
      }).exitCode
    ).toBe(0);
  });

  it('treats a pid it cannot signal as alive', () => {
    expect(pidMayBeRunning(1, () => true)).toBe(true);
    expect(
      pidMayBeRunning(1, () => {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      })
    ).toBe(false);
    expect(
      pidMayBeRunning(1, () => {
        throw Object.assign(new Error('not ours'), { code: 'EPERM' });
      })
    ).toBe(true);
    expect(pidMayBeRunning(Number(undefined))).toBe(false);
  });

  it('lists only open records with a live pid as running', () => {
    const rows = runningBackgroundGates(
      [
        { gate: 'check', pid: 1, done: false, logPath: 'a.log', startedAt: 5 },
        { gate: 'harness:ios', pid: 2, done: true, logPath: 'b.log' },
        { gate: 'bench', pid: 3, done: false, logPath: 'c.log' },
        null,
      ],
      (pid) => pid === 1
    );
    expect(rows).toEqual([
      { gate: 'check', pid: 1, startedAt: 5, logPath: 'a.log' },
    ]);
  });

  it('takes the last real line of a log as progress, not a blank one', () => {
    expect(lastLogLine('a\nb\n\n')).toBe('b');
    expect(lastLogLine('')).toBeNull();
    expect(lastLogLine(null)).toBeNull();
    expect(lastLogLine(`x${'y'.repeat(300)}`)).toHaveLength(200);
  });
});

describeCli('gate.mjs --background and wait', () => {
  const cleanup = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function checkout(files) {
    const dir = makeCheckout(files);
    cleanup.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** The gate log store, `<git-common-dir>/nitro-ui-gates`. */
  function storeDir(dir) {
    return path.join(dir, '.git', 'nitro-ui-gates');
  }

  /** A ledger line's log path is relative to the store. */
  function logFile(dir, logPath) {
    return path.join(storeDir(dir), logPath);
  }

  /** The one background record in the store; throws unless there is exactly one. */
  function theRecord(dir) {
    const logs = storeDir(dir);
    const found = [];
    const walk = (current) => {
      let names;
      try {
        names = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of names) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.name.endsWith('.gate.json')) found.push(absolute);
      }
    };
    walk(logs);
    if (found.length !== 1) {
      throw new Error(
        `expected exactly one background record, found ${found.length}`
      );
    }
    return JSON.parse(fs.readFileSync(found[0], 'utf8'));
  }

  async function waitForRecordToClose(dir, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const record = theRecord(dir);
      if (record.done === true) return record;
      if (Date.now() > deadline) {
        throw new Error(
          `background record never closed: ${JSON.stringify(record)}`
        );
      }
      await sleep(100);
    }
  }

  async function waitForLog(dir, record, text, timeoutMs = 30_000) {
    const file = logFile(dir, record.logPath);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if (fs.readFileSync(file, 'utf8').includes(text)) return;
      } catch {
        /* not created yet */
      }
      if (Date.now() > deadline) {
        throw new Error(
          `the gate's log never contained ${JSON.stringify(text)}`
        );
      }
      await sleep(50);
    }
  }

  const iosOnly = {
    'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
  };

  it('starts detached, records the same line a foreground run would, and wait reports it', async () => {
    const dir = checkout(iosOnly);
    const startedAt = Date.now();
    const started = runCli(dir, ['harness:android', '--background'], {
      // Long enough that the gate is still mid-run when `wait` first looks.
      FAKE_SLEEP: '20',
      FAKE_PROGRESS: 'Compiling Switch.swift',
    });
    expect(started.status).toBe(0);
    expect(started.stdout).toContain(
      'harness:android started in the background'
    );
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    // The gate's output goes to the log, not to the launcher's terminal.
    expect(started.stdout).not.toContain('fake runner');

    const record = theRecord(dir);
    expect(record.gate).toBe('harness:android');
    expect(record.done).toBe(false);
    expect(typeof record.pid).toBe('number');
    expect(fs.existsSync(logFile(dir, record.logPath))).toBe(true);

    const status = runCli(dir, ['status']);
    expect(status.stdout).toContain('running harness:android');
    expect(status.stdout).toMatch(/pid \d+/);

    // `wait` prints progress once, on its first pass, so the line it is expected
    // to report has to be in the log before `wait` starts.
    await waitForLog(dir, record, 'Compiling Switch.swift');

    const wait = runCli(dir, ['wait', '--gate', 'harness:android']);
    expect(wait.status).toBe(0);
    expect(wait.stderr).toContain('Compiling Switch.swift');
    expect(wait.stderr).toContain('passed');

    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].gate).toBe('harness:android');
    expect(lines[0].result).toBe('pass');
    expect(lines[0].exitCode).toBe(0);
    expect(lines[0].logPath).toBe(record.logPath);
    // A run that echoed its output to the log twice would parse two summaries.
    expect(lines[0].summaries).toHaveLength(1);
    expect(lines[0].counts.tests.total).toBe(391);
    expect(theRecord(dir).done).toBe(true);
  }, 90_000);

  it('exits with the gate’s own failing code, not a generic one', async () => {
    const dir = checkout(iosOnly);
    const started = runCli(dir, ['check', '--background'], {
      FAKE_SLEEP: '1',
      FAKE_EXIT: '7',
    });
    expect(started.status).toBe(0);
    await waitForRecordToClose(dir);
    const wait = runCli(dir, ['wait', '--gate', 'check']);
    expect(wait.status).toBe(7);
    expect(wait.stderr).toContain('failed with exit 7');
    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].result).toBe('fail');
    expect(lines[0].exitCode).toBe(7);
  }, 90_000);

  it('reports "still running" as its own exit code at the timeout, leaving the gate alone', async () => {
    const dir = checkout(iosOnly);
    const started = runCli(dir, ['check', '--background'], { FAKE_SLEEP: '8' });
    expect(started.status).toBe(0);
    // About 1.2 s of budget against an 8 s gate.
    const wait = runCli(dir, [
      'wait',
      '--gate',
      'check',
      '--timeout-minutes',
      '0.02',
    ]);
    expect(wait.status).toBe(13);
    expect(wait.stderr).toContain('still running');
    const record = theRecord(dir);
    expect(record.done).toBe(false);
    let alive = true;
    try {
      process.kill(Number(record.pid), 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(true);
    await waitForRecordToClose(dir);
  }, 120_000);

  it('reports a gate whose process is gone as "no result", without burning the timeout', async () => {
    const dir = checkout(iosOnly);
    // A record left behind by a run that was killed hard: not `done`, and its
    // process is gone.
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    const logPath = 'task/x2-fixture/ghost-check.log';
    fs.mkdirSync(path.dirname(logFile(dir, logPath)), { recursive: true });
    fs.writeFileSync(logFile(dir, logPath), 'gate: check\nmid-compile\n');
    fs.writeFileSync(
      backgroundRecordPath(logFile(dir, logPath)),
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: deadPid,
        startedAt: Date.now(),
        logPath,
        done: false,
      })
    );
    const started = Date.now();
    const wait = runCli(dir, [
      'wait',
      '--gate',
      'check',
      '--timeout-minutes',
      '10',
    ]);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(wait.status).toBe(13);
    expect(wait.stderr).toContain('gone without recording a result');
    expect(wait.stderr).toContain('mid-compile');
    expect(ledgerLines(dir)).toEqual([]);
  }, 60_000);

  it('trusts the ledger line when a finished run’s record still says running', () => {
    const dir = checkout(iosOnly);
    // A gate can finish so fast that the launcher's "here is my pid" write lands
    // after the run's "done" write, leaving a record that says it is still open.
    expect(runCli(dir, ['check']).status).toBe(0);
    const recorded = ledgerLines(dir)[0];
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    const recordPath = backgroundRecordPath(logFile(dir, recorded.logPath));
    fs.writeFileSync(
      recordPath,
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: deadPid,
        startedAt: Date.now(),
        logPath: recorded.logPath,
        done: false,
      })
    );
    const wait = runCli(dir, ['wait', '--gate', 'check']);
    expect(wait.status).toBe(0);
    expect(wait.stderr).toContain('from the ledger line');
  }, 60_000);

  it('refuses to wait for a gate that was never started', () => {
    const dir = checkout(iosOnly);
    const wait = runCli(dir, ['wait']);
    expect(wait.status).toBe(2);
    expect(wait.stderr).toContain('no background gate');
    expect(runCli(dir, ['wait', '--gate', 'bench']).stderr).toContain(
      'named bench'
    );
    const bad = runCli(dir, ['wait', '--timeout-minutes', '0']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('positive number');
  }, 60_000);

  it('writes a background log the reader can read once, and keeps its log path out of the gate', async () => {
    const dir = checkout(iosOnly);
    const started = runCli(dir, ['check', '--background'], {
      FAKE_SHOW_GATE_LOG_ENV: '1',
    });
    expect(started.status).toBe(0);
    expect(runCli(dir, ['wait', '--gate', 'check']).status).toBe(0);
    const [record] = ledgerLines(dir);
    const log = fs.readFileSync(logFile(dir, record.logPath), 'utf8');
    // A backgrounded run's stdout is this file, so each line must appear once.
    const summaries = log
      .split('\n')
      .filter((entry) => entry.includes('Tests: 391 passed'));
    expect(summaries).toHaveLength(1);
    expect(
      log.split('\n').filter((e) => e.startsWith('fake runner:'))
    ).toHaveLength(1);
    // A nested `gate.mjs` that inherited the launcher's log path would append to
    // this log and mark this run done with its own exit code.
    expect(log).toContain('child sees gate-log env [unset]');
  }, 90_000);

  it('passes a filtered run through to the gate, recorded under its own name', async () => {
    const dir = checkout(iosOnly);
    const started = runCli(dir, [
      'harness:android',
      '--background',
      '--',
      'ColdSizing',
    ]);
    expect(started.status).toBe(0);
    const wait = runCli(dir, ['wait', '--gate', 'harness:android:ColdSizing']);
    expect(wait.status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].gate).toBe('harness:android:ColdSizing');
    // The fake runner echoes its argv into the log, where a `--background` that
    // leaked into the gate's own command line would show.
    const log = fs.readFileSync(logFile(dir, lines[0].logPath), 'utf8');
    expect(log).toContain('fake runner:');
    expect(log).not.toContain('--background');
    expect(log).toContain('ColdSizing');
  }, 90_000);

  it('exits with its code when a leaked descendant holds the pipes open', async () => {
    // The descendant holds stdout and stderr for 10 s after the gate's child has
    // exited; the gate stops draining them after about 2 s.
    const dir = checkout(iosOnly);
    const holder = path.join(dir, 'holder.pid');
    const startedAt = Date.now();
    let run = null;
    try {
      run = runCli(dir, ['check'], { FAKE_HOLD_OPEN: holder });
      const elapsed = Date.now() - startedAt;
      expect(run.status).toBe(0);
      expect(elapsed).toBeLessThan(8_000);
      const lines = ledgerLines(dir);
      expect(lines.map((row) => [row.gate, row.result, row.exitCode])).toEqual([
        ['check', 'pass', 0],
      ]);
      expect(lines[0].counts.tests.total).toBe(1);
    } finally {
      // The fake runner wrote the pid of the process it left behind.
      try {
        process.kill(Number(fs.readFileSync(holder, 'utf8').trim()), 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, 90_000);

  it('keeps the tail written after the run exits, when it arrives on the slower pipe', async () => {
    // A child's two pipes close at different moments: stdout when it exits,
    // stderr when the last holder lets go. The second summary arrives on stderr
    // half a second after the child is gone.
    const dir = checkout(iosOnly);
    const tail = path.join(dir, 'tail.pid');
    let run = null;
    try {
      run = runCli(dir, ['check'], { FAKE_HOLD_TAIL: tail });
      expect(run.status).toBe(0);
      const [record] = ledgerLines(dir);
      const log = fs.readFileSync(logFile(dir, record.logPath), 'utf8');
      expect(log).toContain('Tests: 1 passed, 1 total');
      expect(log).toContain('Tests: 7 passed, 7 total');
      expect(record.counts.tests.total).toBe(1);
      expect(record.summaries.map((entry) => entry.tests.total)).toEqual([
        1, 7,
      ]);
    } finally {
      try {
        process.kill(Number(fs.readFileSync(tail, 'utf8').trim()), 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, 90_000);

  it("records a bench's platform and device from its own --platform", async () => {
    const dir = checkout(iosOnly);
    // The lease exports both halves of a pair, so the environment has an Android
    // serial during an iOS bench.
    const a5 = leaseRecord({ id: 'A5-1', task: 'A5', platform: 'both' });
    const home = writeLeaseStore(path.join(dir, 'state'), {
      pairs: [DEFAULT_PAIR, OTHER_PAIR],
      leases: [a5],
    });
    const run = runCli(dir, ['bench', '--', '--platform', 'ios'], {
      ...leasedEnv({ home, pair: DEFAULT_PAIR, lease: a5 }),
    });
    expect(run.status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].platform).toBe('ios');
    expect(lines[0].device).toBe(DEFAULT_PAIR.ios.udid);
    expect(lines[0].device).not.toBe(serialFor(DEFAULT_PAIR));
    expect(lines[0].lease).toBe('A5-1');
    const log = fs.readFileSync(logFile(dir, lines[0].logPath), 'utf8');
    expect(log).toContain('--platform ios');
  }, 90_000);

  it('records nothing for a usage probe, on either side of --', async () => {
    // The fake runner exits 2 here, as the real bench runner's `--help` does, so
    // a probe that reached it would be recorded as a failed run.
    const dir = checkout(iosOnly);
    for (const args of [
      ['bench', '--help'],
      ['bench', '--', '--help'],
      ['bench', '-h'],
      ['harness:android', '--help'],
      ['check', '--help'],
    ]) {
      const probe = runCli(dir, args, { FAKE_EXIT: '2' });
      expect({ args, status: probe.status }).toEqual({ args, status: 0 });
      expect(probe.stdout).toContain('usage: node scripts/gate.mjs');
      expect(ledgerLines(dir)).toEqual([]);
    }
    // A real run of the same gate still records.
    expect(runCli(dir, ['bench', '--', '--platform', 'ios']).status).toBe(0);
    expect(ledgerLines(dir).map((entry) => entry.gate)).toEqual([
      'bench:--platform:ios',
    ]);
  }, 90_000);
});

describeCli('gate.mjs claims the device it runs on', () => {
  const IOS_ONLY = {
    'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
  };

  const cleanup = [];

  /** A checkout plus a `NITRO_UI_HOME` holding a lease for one pair of devices. */
  function leasedCheckout({ claimedBy = null } = {}) {
    const dir = makeCheckout(IOS_ONLY);
    const home = path.join(dir, 'state');
    writeLeaseStore(home, {
      pairs: [DEFAULT_PAIR, OTHER_PAIR],
      leases: [leaseRecord({ id: 'X11-1', task: 'X11', platform: 'both' })],
    });
    if (claimedBy != null) {
      fs.writeFileSync(
        path.join(home, 'pool.json'),
        JSON.stringify(
          {
            version: 1,
            devices: [
              {
                key: 'avd:nitro-ui-a',
                kind: 'android',
                id: 'nitro-ui-a',
                leaseId: 'X11-1',
                serial: 'emulator-5574',
                adbPort: 5043,
                bootedAtMs: Date.now(),
                lastUsedMs: Date.now(),
                idleShutdownMinutes: 30,
                claims: [
                  {
                    // A claim counts only while its pid is alive; this process is.
                    pid: process.pid,
                    id: 'other',
                    gate: claimedBy,
                    at: Date.now(),
                  },
                ],
              },
            ],
          },
          null,
          2
        )
      );
    }
    cleanup.push(dir);
    return {
      dir,
      home,
      env: leasedEnv({
        home,
        pair: DEFAULT_PAIR,
        lease: leaseRecord({ id: 'X11-1', task: 'X11', platform: 'both' }),
      }),
    };
  }

  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  const readPool = (home) => {
    const file = path.join(home, 'pool.json');
    if (!fs.existsSync(file)) return { devices: [] };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };

  it('claims the platform it runs on, and releases it when the run ends', async () => {
    const { dir, home, env } = leasedCheckout();
    const run = runCli(dir, ['harness:android'], env);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('claimed avd:nitro-ui-a');
    // An Android gate claims the emulator only, not the lease's simulator.
    const devices = readPool(home).devices;
    expect(devices.map((x) => x.key)).toEqual(['avd:nitro-ui-a']);
    expect(devices[0].serial).toBe('emulator-5574');
    expect(devices[0].claims).toEqual([]);
  }, 90_000);

  it('refuses a device another live run holds, before the run starts', async () => {
    const { dir, home, env } = leasedCheckout({
      claimedBy: 'real-input:android',
    });
    const run = runCli(dir, ['harness:android'], env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('real-input:android');
    expect(run.stderr).toContain('NITRO_UI_GATE_DEVICE_FORCE=1');
    expect(ledgerLines(dir)).toEqual([]);
    expect(readPool(home).devices[0].claims).toHaveLength(1);
  }, 90_000);

  it('runs anyway under NITRO_UI_GATE_DEVICE_FORCE=1', async () => {
    const { dir, env } = leasedCheckout({ claimedBy: 'real-input:android' });
    const run = runCli(dir, ['harness:android'], {
      ...env,
      NITRO_UI_GATE_DEVICE_FORCE: '1',
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('NITRO_UI_GATE_DEVICE_FORCE=1');
    expect(ledgerLines(dir)).toHaveLength(1);
  }, 90_000);

  // The fake runner prints `pool.json` from inside the run: a parent that reads
  // it only afterwards cannot tell when the claim was taken or released.
  it('has the claim live while the run is in flight', async () => {
    const { dir, env } = leasedCheckout();
    const run = runCli(dir, ['harness:android'], {
      ...env,
      FAKE_SHOW_CLAIMS: '1',
    });
    expect(run.status).toBe(0);
    const during = run.stdout.slice(run.stdout.indexOf('claims-during-run:'));
    const claimed = JSON.parse(during.slice(during.indexOf('{')));
    expect(claimed.devices.map((d) => d.key)).toEqual(['avd:nitro-ui-a']);
    const claims = claimed.devices[0].claims;
    expect(claims).toHaveLength(1);
    expect(claims[0].gate).toBe('harness:android');
    // The pool reads a claim whose pid has died as no claim.
    expect(typeof claims[0].pid).toBe('number');
    expect(claims[0].pid).toBeGreaterThan(0);
    expect(readPool(path.join(dir, 'state')).devices[0].claims).toEqual([]);
  }, 90_000);

  it('claims nothing when the environment names no lease', async () => {
    const dir = makeCheckout(IOS_ONLY);
    cleanup.push(dir);
    const run = runCli(dir, ['check'], {
      NITRO_UI_HOME: path.join(dir, 'state'),
    });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('claimed');
    expect(fs.existsSync(path.join(dir, 'state', 'pool.json'))).toBe(false);
  }, 90_000);
});

describeCli(
  'gate.mjs forwards a signal to the gate it started (FOLLOWUPS 57)',
  () => {
    const cleanup = [];
    const IOS_ONLY = {
      'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
    };

    afterAll(() => {
      for (const dir of cleanup)
        fs.rmSync(dir, { recursive: true, force: true });
    });

    // SIGHUP too: the gate's child is detached into its own process group, so a
    // terminal hangup reaches only `gate.mjs`.
    for (const [signal, trap] of [
      ['SIGINT', 'INT'],
      ['SIGTERM', 'TERM'],
      ['SIGHUP', 'HUP'],
    ]) {
      it(`forwards ${signal} to the running gate, re-raises it, and still writes the ledger`, async () => {
        const dir = makeCheckout(IOS_ONLY);
        cleanup.push(dir);
        const { child, output } = spawnCli(dir, ['check'], { FAKE_TRAP: trap });
        // Listen for `close` before waiting on anything: it fires once, and the
        // gate can be gone before its output has been read.
        const ended = closed(child, output, 20_000);
        // Marks the promise handled, so a timeout that fires while `waitUntil` is
        // still polling is reported at the `await` below, not as an unhandled
        // rejection in another test.
        ended.catch(() => {});
        try {
          await waitUntil(output, 'fake: ready', 20_000);
          child.kill(signal);
          // Only the gate's own output can show that the signal reached it.
          await waitUntil(output, `fake: caught ${trap}`, 20_000);
          const end = await ended;
          expect(end.signal).toBe(signal);
          const lines = ledgerLines(dir);
          expect(lines.map((row) => [row.gate, row.result])).toEqual([
            ['check', 'fail'],
          ]);
        } finally {
          child.kill('SIGKILL');
        }
      }, 90_000);
    }
  }
);

describeCli('gate.mjs refuses a misplaced --background (X30 item 3)', () => {
  /** `gate.mjs` finds the repo root by this file, and exits without it. */
  const CHECKOUT = {
    'nitrogen/generated/ios/NitroUiAutolinking.swift': '// x\n',
  };
  const cleanup = [];
  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  function misplaced(args) {
    const dir = makeCheckout({ ...CHECKOUT, 'ios/a.swift': 'v1' });
    cleanup.push(dir);
    const run = runCli(dir, args);
    return { run, ledger: ledgerLines(dir) };
  }

  it('says so, for a device gate, without running anything', () => {
    const { run, ledger } = misplaced([
      'harness:android',
      '--',
      '--background',
    ]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('goes with the gate name, not after --');
    expect(run.stderr).toContain(
      'node scripts/gate.mjs harness:android --background'
    );
    expect(run.stdout).not.toContain('fake runner');
    expect(ledger).toEqual([]);
  });

  it('does the same for the `=true` spelling, and rewrites what to type instead', () => {
    for (const [args, suggestion] of [
      [['check', '--', '--background=true'], 'check --background'],
      [
        ['harness:ios', '--', '--background', 'ColdSizing'],
        'harness:ios --background -- ColdSizing',
      ],
    ]) {
      const { run, ledger } = misplaced(args);
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('goes with the gate name');
      expect(run.stderr).toContain(suggestion);
      expect(run.stdout).not.toContain('fake runner');
      expect(ledger).toEqual([]);
    }
  });

  it('still accepts the flag where it belongs, filter and all', () => {
    const dir = makeCheckout({ ...CHECKOUT, 'ios/a.swift': 'v1' });
    cleanup.push(dir);
    const run = runCli(dir, [
      'harness:ios',
      '--background',
      '--',
      'ColdSizing',
    ]);
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('goes with the gate name');
    const waited = runCli(dir, ['wait', '--gate', 'harness:ios:ColdSizing']);
    expect(waited.status).toBe(0);
    expect(ledgerLines(dir).map((entry) => entry.gate)).toEqual([
      'harness:ios:ColdSizing',
    ]);
  });
});

describeCli('gate.mjs prints its whole usage (X30 fix 1)', () => {
  /** `gate.mjs` finds the repo root by this file, and exits without it. */
  const CHECKOUT = {
    'nitrogen/generated/ios/NitroUiAutolinking.swift': '// x\n',
  };
  const cleanup = [];
  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  // The usage text is a chain of string literals joined with `+`. A `;` where a
  // `+` belongs is valid syntax that silently drops the rest, so the tail is
  // what these tests assert.
  it('the help runs to the last paragraph, not the first stray semicolon', () => {
    const dir = makeCheckout({ ...CHECKOUT, 'ios/a.swift': 'v1' });
    cleanup.push(dir);
    const help = runCli(dir, ['--help']).stdout;
    for (const section of [
      'never\n        after `--`, where the arguments belong to the gate',
      '--background starts a gate detached and returns at once',
      "(`logs` lists this clone's stored gate logs",
    ]) {
      expect(help).toContain(section);
    }
    expect(help).toContain('node scripts/gate.mjs logs [--branch <b>]');
    expect(help.trimEnd().endsWith('--all shows every branch)')).toBe(true);
  });

  it('and the refusal for a misplaced --background carries all of it', () => {
    const dir = makeCheckout({ ...CHECKOUT, 'ios/a.swift': 'v1' });
    cleanup.push(dir);
    const run = runCli(dir, ['harness:android', '--', '--background']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('goes with the gate name, not after --');
    expect(run.stderr).toContain('--background starts a gate detached');
    expect(run.stderr).toContain('--all shows every branch)');
  });

  it('and eslint is set to catch the shape of the bug itself', () => {
    const config = fs.readFileSync(
      path.join(process.cwd(), 'eslint.config.mjs'),
      'utf8'
    );
    expect(config).toContain("'no-unused-expressions': [");
  });
});
