/**
 * The release comparison: one session, two library versions, one device.
 *
 * X36 removed the committed baselines. What replaced them is a *paired* measurement:
 * `bun bench --compare-release [ref]` builds the ref's own bench app and the working
 * tree's, installs one at a time under the same app identifier, and alternates them
 * launch round by launch round. Two things can make that answer meaningless, and the
 * blocks below guard exactly those two:
 *
 *   - the *plan*: a side that is never measured first would absorb any drift in the
 *     host, and a ref that resolves to the commit under review measures nothing;
 *   - the *rule*: the same D9 gate the old `--check` had (ratio over 1.20, bootstrap CI
 *     excluding 1.05, cell quiet inside its own run), reached here through the same
 *     `comparisonSections()` that `run.mjs` calls, so this file cannot pass while the
 *     command it describes is broken.
 *
 * No device is involved: the runs are synthetic, and the numbers are chosen so that a
 * wrong rule reads differently — the boundary is 1.20 and the fixtures sit at 1.10 and
 * 1.25, never on 1.20 itself.
 */

import { describe, expect, it } from '@jest/globals';

import {
  aggregateRecords,
  RATIO_CI_EXCLUDES,
  RATIO_FAIL_THRESHOLD,
} from '../bench/lib.mjs';
import { comparisonSections } from '../bench/render.mjs';
import {
  RELEASE_TAG_PATTERN,
  baseRefDir,
  newestReleaseTag,
  planComparison,
  sideOrderForRound,
} from '../bench/compare.mjs';

const LAUNCHES = 4;
const ITERATIONS = 20;

/**
 * One cell, as the app would record it.
 *
 * `mounted`/`presented`/`jsCommit` are per-iteration nanoseconds for launch 0;
 * `launchFactors` scale a whole launch (that is the axis the within-run noise guard
 * reads), and `wide` spreads the iterations inside every launch instead — which leaves
 * each launch median where it was and makes the bootstrap interval honest about how
 * little a stable median proves.
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
 * A synthetic side: the control and the gated arm of one cell.
 *
 * `nitroUi` is a multiple of the control, so a comparison of two of these runs has an
 * exact expected ratio — the fixture cannot agree with the answer by accident.
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
    // The same fixture on both sides is the only green that proves nothing on its own,
    // so the row has to show that the cell was actually compared.
    expect(section.markdown).toContain('mount:nitro-ui:50');
  });

  it('passes a cell that is a little slower than the release', () => {
    // 1.10x: under the 1.20 bound, and the distance from the bound is the point — a
    // threshold tightened to "any movement" is the mistake this fixture catches.
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
    // The answer a human gets is the cell, not a count.
    expect(section.markdown).toContain('mount:nitro-ui:50');
    expect(section.result.conclusiveFailures.map((f) => f.key)).toContain(
      'mount:nitro-ui:50'
    );
  });

  it('will not call a slow cell slower when its own interval includes 1.05', () => {
    // Same 1.27x point estimate, but the iterations inside every launch straddle the
    // median: the launch-to-launch spread is quiet, the interval is not. Without the CI
    // half of the rule a single wide measurement would fail a release.
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
    // 1.36x on the median, and the four launches disagree by more than the noise bound
    // - a busy minute on one side of the session. Deliberately *not* a wide interval:
    // every launch is over 1.25x, so the interval excludes 1.05 and the quiet-cell rule
    // is the only thing standing between this measurement and a failed release.
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
    // A component added since the tag: nothing to be slower than, and "ok" would be a
    // claim that it was checked.
    const head = side({});
    head.cells['mount:nitro-ui:500'] = head.cells['mount:nitro-ui:50'];
    const section = compare({ head, base: side({}) });
    const row = section.result.rows.find((r) => r.key === 'mount:nitro-ui:500');
    expect(row.status).toBe('missing-base');
    expect(section.markdown).toContain('not measured in base');
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
    // ABBA over four rounds, like the arms inside a launch. "base then head" every
    // round would put the whole warm-up-or-cool-down of the session on one library.
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
    // Both asymmetries are said out loud: a head-only cell is a new component, and a
    // base-only cell is measured and then not gated.
    expect(compared.warnings.join('\n')).toContain('only in this tree');
    expect(compared.warnings.join('\n')).toContain('v0.9.0');
  });

  it('refuses a ref that is the commit under review', () => {
    const same = plan({
      launches: 2,
      baseSha: 'same111',
      headSha: 'same111',
      headSchedule: scheduleOf({ launches: 2 }),
      baseSchedule: scheduleOf({ launches: 2 }),
    });
    expect(same.problem).toContain('measures nothing');
    expect(same.rounds).toEqual([]);

    // The same plan with a genuinely older base is plannable: the refusal is about the
    // two shas being one commit, not about the shape of the run.
    const older = plan({
      launches: 2,
      baseSha: 'older11',
      headSha: 'same111',
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
    // v0.9.2 was released after v0.10.1: the question is "slower than what?", and what
    // is running in the world is the thing that shipped last, not the biggest number.
    const answer = newestReleaseTag({ tags: hotfixTags, headSha: 'cccc333' });
    expect(answer.ref).toBe('v0.9.2');
  });

  it('skips a tag that is the commit under review', () => {
    // The shape of "release branch cut, tag pushed, still tagging": measuring HEAD
    // against HEAD produces 1.00 everywhere and a gate that cannot fail.
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
    // `git rev-parse` failing for one tag is a reason to say less about it, not a
    // reason to refuse the comparison.
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
