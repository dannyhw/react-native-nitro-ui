import { describe, expect, it } from 'vitest';

import {
  aggregateRecords,
  RATIO_CI_EXCLUDES,
  RATIO_FAIL_THRESHOLD,
} from '../bench/lib.mjs';
import { comparisonSections } from '../bench/render.mjs';
import {
  RELEASE_TAG_PATTERN,
  baseRefDir,
  comparisonOutcome,
  newestReleaseTag,
  planComparison,
  sideOrderForRound,
} from '../bench/compare.mjs';

const LAUNCHES = 4;
const ITERATIONS = 20;

/**
 * One cell, as the app would record it. `launchFactors` scale a whole launch;
 * `wide` spreads the iterations inside every launch instead, which leaves each
 * launch median where it was and widens the bootstrap interval.
 */
function cellRecords({
  implementation,
  mounted,
  presented,
  jsCommit,
  launchFactors = [1, 1, 1, 1],
  wide = false,
}) {
  const records = [
    {
      kind: 'meta',
      scenario: 'mount',
      implementation,
      n: 50,
      launch: 0,
      warmup: 0,
      measured: ITERATIONS,
      platform: 'ios 27.0',
      probeClock: 'CLOCK_UPTIME_RAW',
      mountTimeoutMs: 1_500,
      presentedTimeoutMs: 8_000,
    },
  ];
  for (let launch = 0; launch < LAUNCHES; launch++) {
    const launchFactor = launchFactors[launch] ?? 1;
    for (let index = 0; index < ITERATIONS; index++) {
      // `wide` puts half the iterations below and half above the median, symmetric in
      // the ratio: the launch median does not move, its interval does.
      const jitter = wide
        ? index % 2 === 0
          ? 0.7
          : 1.3
        : 1 + 0.001 * (index % 3);
      const value = (ns) => ns * launchFactor * jitter;
      records.push({
        kind: 'iter',
        scenario: 'mount',
        implementation,
        n: 50,
        launch,
        index,
        warmup: false,
        jsCommitNs: value(jsCommit),
        mountedNs: value(mounted),
        presentedNs: value(presented),
      });
    }
  }
  return records;
}

/**
 * A synthetic side: the control and the gated arm of one cell. `nitroUi` is a
 * multiple of the control, so a comparison of two sides has an exact expected
 * ratio.
 */
function side({ nitroUi = 1.1, launchFactors = [1, 1, 1, 1], wide = false }) {
  const control = { mounted: 100_000, presented: 130_000, jsCommit: 40_000 };
  return {
    platform: 'ios',
    deviceKey: 'ios27-sim-testdevice',
    plan: 'quick',
    launches: LAUNCHES,
    perfMarks: false,
    problems: [],
    machine: { loadavg1: 1.2, cpuCount: 10 },
    cells: aggregateRecords(
      [
        ...cellRecords({ implementation: 'rn-core', ...control }),
        ...cellRecords({
          implementation: 'nitro-ui',
          mounted: control.mounted * nitroUi,
          presented: control.presented * nitroUi,
          jsCommit: control.jsCommit * nitroUi,
          launchFactors,
          wide,
        }),
      ],
      { keepRaw: true }
    ),
  };
}

/** The comparison the runner makes: head is this tree, base is the release. */
function compare({ head, base }) {
  return comparisonSections({
    run: head,
    base,
    label: 'v0.9.0 (measured in this session)',
  });
}

function nitroUiFailure(result, metric = 'mountedNs') {
  return result.failures.find(
    (failure) =>
      failure.implementation === 'nitro-ui' && failure.metric === metric
  );
}

describe('the release comparison rule', () => {
  it('passes when the two sides measure the same thing', () => {
    const section = compare({ head: side({}), base: side({}) });
    expect(section.exitCode).toBe(0);
    expect(section.result.conclusiveFailures).toEqual([]);
    expect(section.markdown).toContain('mount:nitro-ui:50');
  });

  it('passes a cell that is a little slower than the release', () => {
    const section = compare({
      head: side({ nitroUi: 1.21 }),
      base: side({ nitroUi: 1.1 }),
    });
    expect(section.result.failures).toEqual([]);
    expect(section.exitCode).toBe(0);
  });

  it('fails, and names the cell, when one is over 1.20x slower than the release', () => {
    const section = compare({
      head: side({ nitroUi: 1.4 }),
      base: side({ nitroUi: 1.1 }),
    });
    expect(section.exitCode).toBe(1);
    const failure = nitroUiFailure(section.result);
    expect(failure).toBeDefined();
    expect(failure.overThreshold).toBe(true);
    expect(failure.noisy).toBe(false);
    // head(1.4/1.0) / base(1.1/1.0)
    expect(failure.ratio).toBeCloseTo(1.4 / 1.1, 2);
    expect(failure.ci.low).toBeGreaterThan(RATIO_CI_EXCLUDES);
    expect(section.markdown).toContain('mount:nitro-ui:50');
    expect(section.result.conclusiveFailures.map((f) => f.key)).toContain(
      'mount:nitro-ui:50'
    );
  });

  it('will not call a slow cell slower when its own interval includes 1.05', () => {
    // The same 1.27x point estimate, but the iterations inside every launch
    // straddle the median: the launch-to-launch spread is quiet and the
    // interval is wide.
    const section = compare({
      head: side({ nitroUi: 1.4, wide: true }),
      base: side({ nitroUi: 1.1 }),
    });
    const failure = nitroUiFailure(section.result);
    expect(failure).toBeDefined();
    expect(failure.ratio).toBeGreaterThan(RATIO_FAIL_THRESHOLD);
    expect(failure.noisy).toBe(false);
    expect(failure.ci.low).toBeLessThanOrEqual(RATIO_CI_EXCLUDES);
    expect(failure.conclusive).toBe(false);
    expect(section.result.conclusiveFailure).toBe(false);
    expect(section.exitCode).toBe(0);
  });

  it('will not call a cell slower when the cell was bouncing inside its own run', () => {
    // 1.36x on the median, with four launches that disagree by more than the
    // noise bound. Not a wide interval: every launch is over 1.25x, so only the
    // quiet-cell rule applies.
    const section = compare({
      head: side({ nitroUi: 1.2, launchFactors: [1.05, 1.45, 1.15, 1.35] }),
      base: side({ nitroUi: 1.1 }),
    });
    const failure = nitroUiFailure(section.result);
    expect(failure.overThreshold).toBe(true);
    expect(failure.ratio).toBeGreaterThan(RATIO_FAIL_THRESHOLD);
    expect(failure.ci.low).toBeGreaterThan(RATIO_CI_EXCLUDES);
    expect(failure.noisy).toBe(true);
    expect(failure.conclusive).toBe(false);
    expect(section.exitCode).toBe(0);
  });

  it('reports a cell the release never measured instead of passing it quietly', () => {
    const head = side({});
    head.cells['mount:nitro-ui:500'] = head.cells['mount:nitro-ui:50'];
    const section = compare({ head, base: side({}) });
    const row = section.result.rows.find((r) => r.key === 'mount:nitro-ui:500');
    expect(row.status).toBe('missing-base');
    expect(section.markdown).toContain('not measured in base');
  });
});

describe('a comparison whose release side has nothing to compare', () => {
  const PLANNED = ['mount:rn-core:50', 'mount:nitro-ui:50'];

  it('fails, and names every planned cell, when the release side measured nothing', () => {
    // 1.5x, far past the bound: no cell reads FAIL only because there is no
    // release number to divide by.
    const section = comparisonSections({
      run: side({ nitroUi: 1.5 }),
      base: { ...side({}), cells: {} },
      label: 'v0.9.0 (measured in this session)',
      expected: PLANNED,
    });
    expect(section.exitCode).not.toBe(0);
    expect(section.uncompared.map((cell) => cell.key)).toEqual(PLANNED);
    expect(section.uncompared[1].reasons).toEqual(['base has no record']);
    expect(section.result.conclusiveFailures).toEqual([]);
    expect(section.markdown).not.toContain('FAIL');
    expect(section.markdown).toContain('**Not compared** - 2 cell(s)');
    expect(section.markdown).toContain(
      '- `mount:nitro-ui:50`: base has no record'
    );
  });

  it('names the gated cell alone when only that cell is missing from the release', () => {
    const base = side({});
    delete base.cells['mount:nitro-ui:50'];
    const section = comparisonSections({
      run: side({ nitroUi: 1.5 }),
      base,
      label: 'v0.9.0 (measured in this session)',
      expected: PLANNED,
    });
    expect(section.exitCode).not.toBe(0);
    expect(section.uncompared.map((cell) => cell.key)).toEqual([
      'mount:nitro-ui:50',
    ]);
  });

  it('names the control when the release lost the arm every ratio divides by', () => {
    const base = side({});
    delete base.cells['mount:rn-core:50'];
    const section = comparisonSections({
      run: side({ nitroUi: 1.5 }),
      base,
      label: 'v0.9.0 (measured in this session)',
      expected: PLANNED,
    });
    expect(section.uncompared).toEqual([
      { key: 'mount:rn-core:50', reasons: ['base has no record'] },
      {
        key: 'mount:nitro-ui:50',
        reasons: ['base has no record of its rn-core control'],
      },
    ]);
  });

  it('counts a release cell whose launches wrote no sample', () => {
    // The app started and wrote its header, then nothing: a cell that exists and holds
    // no measurement.
    const base = side({});
    base.cells = {
      ...base.cells,
      ...aggregateRecords([
        cellRecords({
          implementation: 'nitro-ui',
          mounted: 1,
          presented: 1,
          jsCommit: 1,
        })[0],
      ]),
    };
    const section = comparisonSections({
      run: side({ nitroUi: 1.5 }),
      base,
      label: 'v0.9.0 (measured in this session)',
      expected: PLANNED,
    });
    expect(section.exitCode).not.toBe(0);
    expect(section.uncompared).toEqual([
      { key: 'mount:nitro-ui:50', reasons: ['base has no samples'] },
    ]);
  });

  it('leaves alone a cell both sides measured and neither can quote', () => {
    // A leak cell whose footprint does not climb has no slope to compare on either
    // side. Both sides ran it, so nothing failed and there is nothing to name.
    const flatLeak = (implementation) =>
      [0, 1, 2].map((cycle) => ({
        kind: 'mem',
        scenario: 'leak',
        implementation,
        n: 200,
        launch: 0,
        phase: `leak${String(cycle)}`,
        footprintBytes: 5_000_000 - cycle,
      }));
    const withLeak = () => {
      const run = side({});
      run.cells = {
        ...run.cells,
        ...aggregateRecords([...flatLeak('rn-core'), ...flatLeak('nitro-ui')]),
      };
      return run;
    };
    const section = comparisonSections({
      run: withLeak(),
      base: withLeak(),
      label: 'v0.9.0 (measured in this session)',
      expected: [...PLANNED, 'leak:rn-core:200', 'leak:nitro-ui:200'],
    });
    const row = section.result.rows.find((r) => r.key === 'leak:nitro-ui:200');
    expect(Object.keys(row.perMetric)).toEqual([]);
    expect(section.uncompared).toEqual([]);
    expect(section.exitCode).toBe(0);
  });

  it('ends a session non-zero for each of its three bad endings, by name', () => {
    const uncompared = [
      { key: 'mount:nitro-ui:50', reasons: ['base has no record'] },
    ];
    const lost = comparisonOutcome({
      ref: 'v0.9.0',
      baseProblems: ['base mount:nitro-ui:50 launch 3/4: no end sentinel'],
    });
    expect(lost.exitCode).toBe(1);
    expect(lost.lines[0]).toBe('1 launch(es) of v0.9.0 did not complete:');
    expect(lost.lines.join('\n')).toContain('launch 3/4: no end sentinel');

    const notCompared = comparisonOutcome({ ref: 'v0.9.0', uncompared });
    expect(notCompared.exitCode).toBe(1);
    expect(notCompared.lines.join('\n')).toContain(
      'mount:nitro-ui:50: base has no record'
    );
    expect(notCompared.lines.join('\n')).toContain('Not compared with v0.9.0');
    expect(notCompared.lines.join('\n')).not.toContain('Slower');

    const slower = comparisonOutcome({
      ref: 'v0.9.0',
      slower: [
        {
          key: 'mount:nitro-ui:50',
          metric: 'mountedNs',
          ratio: 1.31,
          ci: { low: 1.22, high: 1.4 },
        },
      ],
    });
    expect(slower.exitCode).toBe(1);
    expect(slower.lines).toEqual([
      'Slower than v0.9.0 on 1 cell(s):',
      '  - mount:nitro-ui:50 mountedNs: 1.31x (CI 1.22-1.40)',
    ]);

    expect(comparisonOutcome({ ref: 'v0.9.0' })).toEqual({
      exitCode: 0,
      lines: [],
    });
  });
});

function scheduleOf({
  launches,
  cells = [
    ['mount', 'nitro-ui'],
    ['mount', 'rn-core'],
  ],
}) {
  const entries = [];
  for (let launch = 0; launch < launches; launch++) {
    for (const [scenario, implementation] of cells) {
      entries.push({ scenario, implementation, n: 50, launch });
    }
  }
  return entries;
}

function plan(options) {
  return planComparison({
    platform: 'ios',
    plan: 'quick',
    ref: 'v0.9.0',
    repoRoot: '/repo',
    baseDir: '/base/v0.9.0',
    ...options,
  });
}

describe('the release comparison plan', () => {
  it('measures each side first the same number of times', () => {
    // ABBA over four rounds: "base then head" every round would put the
    // session's whole warm-up or cool-down on one side.
    const order = Array.from({ length: 4 }, (_, launch) =>
      sideOrderForRound(launch).join('/')
    );
    expect(order).toEqual(['base/head', 'head/base', 'head/base', 'base/head']);
    const leads = { base: 0, head: 0 };
    for (let launch = 0; launch < 40; launch++) {
      leads[sideOrderForRound(launch)[0]] += 1;
    }
    expect(leads).toEqual({ base: 20, head: 20 });
  });

  it('pays one install per side switch, not one per launch', () => {
    const four = plan({
      launches: 4,
      baseSha: 'aaaa111',
      headSha: 'bbbb222',
      headSchedule: scheduleOf({ launches: 4 }),
      baseSchedule: scheduleOf({ launches: 4 }),
    });
    expect(four.problem).toBeNull();
    expect(four.rounds).toHaveLength(4);
    // base, head | head, base | head, base | base, head = five switches and the
    // first install. A plan that reinstalled per launch would read 16 here.
    expect(four.installs).toBe(6);
    expect(four.totalLaunches).toBe(16);
  });

  it('separates the cells each side can measure from the ones only one can', () => {
    const headSchedule = scheduleOf({ launches: 2 });
    const baseSchedule = scheduleOf({ launches: 2 }).filter(
      (entry) => entry.implementation !== 'rn-core'
    );
    baseSchedule.push({
      scenario: 'mount',
      implementation: 'expo-ui-host-per-control',
      n: 50,
      launch: 0,
    });
    baseSchedule.push({
      scenario: 'mount',
      implementation: 'expo-ui-host-per-control',
      n: 50,
      launch: 1,
    });
    const compared = plan({
      launches: 2,
      baseSha: 'aaaa111',
      headSha: 'bbbb222',
      headSchedule,
      baseSchedule,
    });
    expect(compared.cells.compared).toEqual(['mount:nitro-ui:50']);
    expect(compared.cells.headOnly).toEqual(['mount:rn-core:50']);
    expect(compared.cells.baseOnly).toEqual([
      'mount:expo-ui-host-per-control:50',
    ]);
    expect(compared.warnings.join('\n')).toContain('only in this tree');
    expect(compared.warnings.join('\n')).toContain('v0.9.0');
  });

  it('refuses a ref that is the commit under review', () => {
    // One commit, abbreviated to two lengths - what a 7-character slice and
    // `git rev-parse --short` give in a repository big enough to need 8. The labels
    // differ, so only a comparison of the whole ids can see that this is one commit.
    const commit = '4f2a9c1d7e3b8a6f5c0d9e2b1a4c7f3e8d6b5a90';
    const same = plan({
      launches: 2,
      baseSha: commit.slice(0, 7),
      headSha: commit.slice(0, 8),
      baseCommit: commit,
      headCommit: commit,
      headSchedule: scheduleOf({ launches: 2 }),
      baseSchedule: scheduleOf({ launches: 2 }),
    });
    expect(same.problem).toContain('measures nothing');
    expect(same.rounds).toEqual([]);

    const older = plan({
      launches: 2,
      baseSha: commit.slice(0, 7),
      headSha: commit.slice(0, 7),
      baseCommit: `${commit.slice(0, 7)}0b3e5d7f9a1c2e4f6a8b0c1d3e5f7a9b2`,
      headCommit: commit,
      headSchedule: scheduleOf({ launches: 2 }),
      baseSchedule: scheduleOf({ launches: 2 }),
    });
    expect(older.problem).toBeNull();
  });

  it('refuses rather than promise a side it could not schedule', () => {
    const broken = plan({
      launches: 2,
      baseSha: 'aaaa111',
      headSha: 'bbbb222',
      headSchedule: scheduleOf({ launches: 2 }),
      baseSchedule: null,
      baseProblem: 'unknown option: component',
    });
    expect(broken.problem).toContain('unknown option: component');
    expect(broken.installs).toBe(0);
  });

  it('keeps the release checkout out of the repository it is comparing against', () => {
    // A copy of the library inside the checkout would be walked by lint, tsc, jest and
    // every `git ls-files` check, and found by tools looking for the current one.
    const dir = baseRefDir({
      repoRoot: '/machine/work/nitro-ui',
      ref: 'v0.9.0',
      env: {},
    });
    expect(dir.startsWith('/machine/work/nitro-ui/')).toBe(false);
    expect(dir).toContain('nitro-ui');
    expect(dir.endsWith('v0.9.0')).toBe(true);
    expect(
      baseRefDir({
        repoRoot: '/machine/work/nitro-ui',
        ref: 'feature/old-release',
        env: {},
      }).endsWith('feature-old-release')
    ).toBe(true);
    expect(
      baseRefDir({
        repoRoot: '/machine/work/nitro-ui',
        ref: 'v0.9.0',
        env: { NITRO_UI_BENCH_BASE_DIR: '/scratch/base' },
      })
    ).toBe('/scratch/base/v0.9.0');
  });
});

describe('the newest release tag', () => {
  // git's `--sort=-creatordate` order: the tag made most recently comes first. Both
  // fixtures are shaped so that a name-based answer is a different tag — sorting the
  // list, or sorting it as versions, each picks the wrong one here.
  const trainTags = [
    'v0.10.0',
    'v0.9.11',
    'v0.9.0',
    'v0.10.0-rc.1',
    'bench-old',
  ];
  const hotfixTags = ['v0.9.2', 'v0.10.1', 'v0.10.0'];

  it('picks the tag that shipped last, not the one a sort of the names gives', () => {
    // v0.10.0 is the release that shipped last; the v0.9.11 hotfix is older than it, and
    // `sort()` would put the hotfix first because "9" sorts above "1".
    const answer = newestReleaseTag({ tags: trainTags, headSha: 'cccc333' });
    expect(answer.ref).toBe('v0.10.0');
    expect(answer.problem).toBeNull();
  });

  it('picks a hotfix that shipped after a bigger version was cut', () => {
    // v0.9.2 was released after v0.10.1.
    const answer = newestReleaseTag({ tags: hotfixTags, headSha: 'cccc333' });
    expect(answer.ref).toBe('v0.9.2');
  });

  it('skips a tag that is the commit under review', () => {
    const answer = newestReleaseTag({
      tags: trainTags,
      shaOfTag: { 'v0.10.0': 'cccc333', 'v0.9.11': 'dddd444' },
      headSha: 'cccc333',
    });
    expect(answer.skipped).toEqual(['v0.10.0']);
    expect(answer.ref).toBe('v0.9.11');
  });

  it('ignores names that are not releases', () => {
    const answer = newestReleaseTag({
      tags: ['nightly-2026-11-01', 'v1.0', 'release/0.9'],
      headSha: 'eeee555',
    });
    expect(answer.ref).toBeNull();
    expect(answer.problem).toContain('no release tag');
    expect(answer.problem).toContain('--compare-release <ref>');
  });

  it('takes a tag whose commit it cannot resolve', () => {
    const answer = newestReleaseTag({
      tags: trainTags,
      shaOfTag: { 'v0.9.1': null },
      headSha: 'cccc333',
    });
    expect(answer.ref).toBe('v0.10.0');
    expect(answer.sha).toBeNull();
  });

  it('only calls a name a release when it is one', () => {
    expect(RELEASE_TAG_PATTERN.test('v0.9.0')).toBe(true);
    expect(RELEASE_TAG_PATTERN.test('v10.20.30')).toBe(true);
    expect(RELEASE_TAG_PATTERN.test('v0.9.0-rc.1')).toBe(false);
    expect(RELEASE_TAG_PATTERN.test('0.9.0')).toBe(false);
    expect(RELEASE_TAG_PATTERN.test('v0.9')).toBe(false);
  });
});
