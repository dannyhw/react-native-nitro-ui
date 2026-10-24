/**
 * The benchmark gate must be able to fail.
 *
 * T02 round 1 shipped a gate that could not: `--check` vetoed the whole run
 * whenever `rn-core`'s *absolute* numbers had moved since the baseline, which
 * between sessions is nearly always, and `--compare` only ever compared
 * `nitro-ui` against nothing. The reviewer proved it from the committed data
 * (docs/tasks/T02-bench.review.md B1). These fixtures are the regression test
 * for that, with no device involved: a synthetic run where a `nitro-ui` arm got
 * twice as slow has to produce a conclusive failure, and the levers that are
 * *not* evidence - control drift, a slow reference arm, a noisy cell - must not
 * suppress or manufacture one.
 *
 * The same `gate()` is used by `run.mjs --check/--compare` and by
 * `report.mjs --compare/--check` (review S11), so covering it covers both.
 */

import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  SCHEMA_VERSION,
  aggregateRecords,
  baselineBlockers,
  baselineNoise,
  baselineTable,
  buildSchedule,
  buildBaseline,
  cellKey,
  comparableMetrics,
  componentOf,
  gate,
  IMPLEMENTATIONS,
  incompleteMetrics,
  launchPlanString,
  scenarioActionOf,
  MAX_MISSING_SAMPLE_RATIO,
  noiseTable,
  ratioTable,
} from '../bench/lib.mjs';
// `comparisonSections()` lives in render.mjs rather than report.mjs so the gate
// can be tested here: report.mjs is the filesystem CLI and resolves repo paths
// through `import.meta`, which jest's CommonJS transform cannot represent.
import {
  comparisonSections,
  detailSections,
  renderMarkdown,
  summaryTable,
} from '../bench/render.mjs';

const LAUNCHES = 4;
const ITERATIONS = 20;

/**
 * Per-launch multipliers. The quiet one is what an idle machine produces; the
 * loud one is a machine doing something else while a cell is measured, which is
 * what the within-run noise guard is supposed to notice.
 */
const QUIET = [1, 1.01, 0.995, 1.005];
const LOUD = [1, 1.7, 0.62, 1.35];

/**
 * Records for one cell.
 *
 * `values` are per-op nanoseconds; latency metrics are written per iteration and
 * CPU as one bracket per launch, exactly like the bench app does.
 */
function cellRecords({
  scenario = 'mount',
  implementation,
  n = 50,
  jsCommit = 40_000,
  mounted = 100_000,
  presented = 130_000,
  jsCpuPerOp = 20_000,
  mainCpuPerOp = 15_000,
  unmountMainCpuPerOp = 8_000,
  spread = false,
  /** Per launch, how many measured iterations never got a presenting frame. */
  missingPresented = 0,
}) {
  const factors = spread ? LOUD : QUIET;
  const records = [
    {
      kind: 'meta',
      scenario,
      implementation,
      n,
      launch: 0,
      warmup: 0,
      measured: ITERATIONS,
      platform: 'ios 27.0',
      probeClock: 'CLOCK_UPTIME_RAW',
    },
  ];

  for (let launch = 0; launch < LAUNCHES; launch++) {
    const factor = factors[launch] ?? 1;
    for (let index = 0; index < ITERATIONS; index++) {
      const wiggle = 1 + 0.002 * ((index % 5) - 2);
      records.push({
        kind: 'iter',
        scenario,
        implementation,
        n,
        launch,
        index,
        warmup: false,
        jsCommitNs: jsCommit * factor * wiggle,
        mountedNs: mounted * factor * wiggle,
        // The Android probe answers `-1` when no frame arrived in time, which
        // the app records as a missing sample (round 4).
        presentedNs:
          index < missingPresented ? null : presented * factor * wiggle,
      });
    }
    records.push({
      kind: 'cpu',
      scenario,
      implementation,
      n,
      launch,
      phase: 'mount',
      iterations: ITERATIONS,
      jsCpuNs: jsCpuPerOp * factor * ITERATIONS,
      mainCpuNs: mainCpuPerOp * factor * ITERATIONS,
    });
    if (scenarioActionOf(scenario) === 'mount') {
      records.push({
        kind: 'cpu',
        scenario,
        implementation,
        n,
        launch,
        phase: 'unmount',
        iterations: ITERATIONS,
        jsCpuNs: jsCpuPerOp * factor * ITERATIONS * 0.2,
        mainCpuNs: unmountMainCpuPerOp * factor * ITERATIONS,
      });
    }
  }
  return records;
}

/** Memory/leak cell: `footprint(phase)` for one launch, in bytes. */
function memoryRecords({
  scenario = 'memory',
  implementation,
  n = 200,
  empty = 120_000_000,
  perInstance = 40_000,
  leakPerCycle = 0,
  wobble = false,
  heaps = null,
}) {
  const records = [
    {
      kind: 'meta',
      scenario,
      implementation,
      n,
      launch: 0,
      warmup: 0,
      measured: 0,
      platform: 'ios 27.0',
      probeClock: 'CLOCK_UPTIME_RAW',
    },
  ];
  const sample = (launch, phase, bytes) => {
    records.push({
      kind: 'mem',
      scenario,
      implementation,
      n,
      launch,
      phase,
      footprintBytes: bytes,
      heapCollected: true,
      nativeHeapBytes:
        heaps == null
          ? null
          : empty + heaps.native * n * (phase === 'full' ? 1 : 0),
      javaHeapBytes:
        heaps == null
          ? null
          : empty + heaps.java * n * (phase === 'full' ? 1 : 0),
    });
  };
  for (let launch = 0; launch < LAUNCHES; launch++) {
    if (scenarioActionOf(scenario) === 'memory') {
      sample(launch, 'empty', empty);
      sample(launch, 'full', empty + perInstance * n);
    } else {
      for (let cycle = 0; cycle <= 10; cycle++) {
        // A wobble is not a leak; a monotonic climb is.
        const drift =
          wobble && cycle % 2 === 1 ? leakPerCycle * 6 : leakPerCycle;
        sample(launch, `leak${cycle}`, empty + drift * cycle);
      }
    }
  }
  return records;
}

/** A whole synthetic run: control + the two reference arms + nitro-ui. */
function makeRun(overrides = {}) {
  const arms = {
    'rn-core': {},
    'expo-ui-host-per-control': { mounted: 210_000 },
    'expo-ui-shared-host': { mounted: 80_000 },
    'nitro-ui': { mounted: 110_000 },
    ...Object.fromEntries(
      Object.entries(overrides).map(([implementation, values]) => [
        implementation,
        values,
      ])
    ),
  };
  const records = [];
  for (const [implementation, values] of Object.entries(arms)) {
    records.push(...cellRecords({ implementation, ...values }));
    records.push(...memoryRecords({ implementation, ...values }));
  }
  return {
    platform: 'ios',
    cells: aggregateRecords(records, { keepRaw: true }),
  };
}

/** A run whose `leak` scenario has per-arm slopes, for the leak gate. */
function leakRun({ rnCore, nitroUi }) {
  const records = [
    ...cellRecords({ implementation: 'rn-core' }),
    ...cellRecords({ implementation: 'nitro-ui' }),
    ...memoryRecords({
      scenario: 'leak',
      implementation: 'rn-core',
      leakPerCycle: rnCore,
    }),
    ...memoryRecords({
      scenario: 'leak',
      implementation: 'nitro-ui',
      leakPerCycle: nitroUi,
    }),
  ];
  return {
    platform: 'ios',
    cells: aggregateRecords(records, { keepRaw: true }),
  };
}

/**
 * `makeRun` plus the metadata `--check` and `--update-baseline` read: a whole
 * run object that is allowed to mint a baseline (clean tree, `full` plan, 8
 * launches, quiet machine).
 */
function baselineRun(overrides = {}) {
  return {
    ...makeRun(overrides),
    platform: 'ios',
    deviceKey: 'ios27-sim-testdevice',
    sha: 'abc1234',
    dirty: false,
    plan: 'full',
    launches: 8,
    perfMarks: false,
    createdAt: '2026-10-23T00:00:00.000Z',
    machine: { loadavg1: 1.5, cpuCount: 14 },
    problems: [],
  };
}

describe('benchmark gate', () => {
  it('is silent when nothing changed', () => {
    const result = gate({ head: makeRun(), base: makeRun() });
    expect(result.failures).toEqual([]);
    expect(result.conclusiveFailure).toBe(false);
  });

  it('fails conclusively when a nitro-ui arm doubles', () => {
    const result = gate({
      head: makeRun({ 'nitro-ui': { mounted: 220_000, presented: 260_000 } }),
      base: makeRun(),
    });
    expect(result.conclusiveFailure).toBe(true);
    const mounted = result.conclusiveFailures.find(
      (failure) => failure.metric === 'mountedNs'
    );
    expect(mounted).toBeDefined();
    expect(mounted.implementation).toBe('nitro-ui');
    // head(x/rn-core) / base(x/rn-core) = (220/100) / (110/100)
    expect(mounted.ratio).toBeCloseTo(2, 1);
    expect(mounted.ci.low).toBeGreaterThan(1.05);
  });

  it('never gates the reference arms', () => {
    // Expo gets twice as slow, nitro-ui does not move. An `@expo/ui` bump must
    // not fail a nitro-ui pull request (review S9).
    const result = gate({
      head: makeRun({
        'expo-ui-host-per-control': { mounted: 420_000 },
        'expo-ui-shared-host': { mounted: 160_000 },
      }),
      base: makeRun(),
    });
    expect(result.conclusiveFailure).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    for (const failure of result.failures) {
      expect(failure.gated).toBe(false);
      expect(failure.implementation).not.toBe('nitro-ui');
    }
  });

  it('is not suppressed by control drift, and not triggered by it either', () => {
    // The exact failure mode of round 1: `rn-core` 5x slower in head. On its own
    // that is machine state, not a regression...
    const drifted = makeRun({
      'rn-core': {
        jsCommit: 200_000,
        mounted: 500_000,
        presented: 650_000,
        jsCpuPerOp: 100_000,
        mainCpuPerOp: 75_000,
      },
    });
    expect(gate({ head: drifted, base: makeRun() }).conclusiveFailure).toBe(
      false
    );

    // ...but it must not be able to excuse a real 2x regression either. Same
    // drift, plus nitro-ui doubled *relative to the drifted control*.
    const driftedAndSlower = makeRun({
      'rn-core': {
        jsCommit: 200_000,
        mounted: 500_000,
        presented: 650_000,
        jsCpuPerOp: 100_000,
        mainCpuPerOp: 75_000,
      },
      'nitro-ui': {
        jsCommit: 80_000,
        mounted: 1_100_000,
        presented: 1_300_000,
        jsCpuPerOp: 40_000,
        mainCpuPerOp: 30_000,
      },
    });
    const result = gate({ head: driftedAndSlower, base: makeRun() });
    expect(result.conclusiveFailure).toBe(true);
    expect(
      result.conclusiveFailures.some(
        (failure) =>
          failure.implementation === 'nitro-ui' &&
          failure.metric === 'mountedNs'
      )
    ).toBe(true);
  });

  it('suppresses a cell that was noisy inside its own run, and only that cell', () => {
    const result = gate({
      // nitro-ui doubled AND bounced around launch to launch; the unmount CPU of
      // the same arm doubled too, quietly, and must stay conclusive.
      head: makeRun({
        'nitro-ui': { mounted: 220_000, presented: 260_000, spread: true },
      }),
      base: makeRun(),
    });
    const mounted = result.failures.find(
      (failure) =>
        failure.implementation === 'nitro-ui' && failure.metric === 'mountedNs'
    );
    expect(mounted).toBeDefined();
    expect(mounted.overThreshold).toBe(true);
    expect(mounted.noisy).toBe(true);
    expect(mounted.conclusive).toBe(false);
    expect(result.conclusiveFailure).toBe(false);

    const noise = noiseTable(
      ratioTable(makeRun({ 'nitro-ui': { spread: true } }))
    );
    expect(noise['mount:nitro-ui:50'].metrics.mountedNs.noisy).toBe(true);
    expect(noise['mount:rn-core:50'].metrics.mountedNs).toBeUndefined();
  });

  it('sees a costlier teardown as its own metric', () => {
    // Review S5: mount and unmount used to share one CPU bracket, so a slower
    // teardown was reported as a slower mount.
    const result = gate({
      head: makeRun({ 'nitro-ui': { unmountMainCpuPerOp: 24_000 } }),
      base: makeRun(),
    });
    expect(result.conclusiveFailure).toBe(true);
    const failure = result.conclusiveFailures[0];
    expect(failure.metric).toBe('unmountMainNsPerOp');
    expect(failure.ratio).toBeCloseTo(3, 1);
  });

  it('gates a monotonic leak climb, and ignores a wobble', () => {
    const leaky = gate({
      head: leakRun({ rnCore: 1_000, nitroUi: 9_000 }),
      base: leakRun({ rnCore: 1_000, nitroUi: 1_000 }),
    });
    expect(leaky.conclusiveFailure).toBe(true);
    expect(
      leaky.conclusiveFailures.some(
        (failure) => failure.metric === 'leakSlopeBytesPerCycle'
      )
    ).toBe(true);

    // A slope fitted over a series that is not climbing is not "a monotonic
    // increase" (§6's wording), so it is not comparable and cannot gate.
    const wobbling = aggregateRecords(
      memoryRecords({
        scenario: 'leak',
        implementation: 'nitro-ui',
        leakPerCycle: 9_000,
        wobble: true,
      }),
      { keepRaw: true }
    )['leak:nitro-ui:200'];
    expect(wobbling.memory.leakMonotonic).toBe(false);
    expect(comparableMetrics(wobbling)).not.toHaveProperty(
      'leakSlopeBytesPerCycle'
    );
  });

  it('is the same gate behind the standalone reporter (review S11)', () => {
    const noisyHead = makeRun({
      'nitro-ui': { mounted: 220_000, presented: 260_000, spread: true },
    });
    const noisy = comparisonSections({
      run: noisyHead,
      base: makeRun(),
      mode: 'compare',
      label: 'base',
    });
    expect(noisy.exitCode).toBe(0);
    expect(noisy.result.conclusiveFailure).toBe(false);

    const clear = comparisonSections({
      run: makeRun({ 'nitro-ui': { mounted: 220_000, presented: 260_000 } }),
      base: makeRun(),
      mode: 'compare',
      label: 'base',
    });
    expect(clear.exitCode).toBe(1);
    expect(clear.markdown).toContain('nitro-ui');
  });

  it('refuses to mint a baseline from a dirty, broken or busy machine', () => {
    const clean = {
      ...makeRun(),
      dirty: false,
      problems: [],
      plan: 'full',
      launches: 8,
      machine: { cpuCount: 14, loadavg1: 2.5, quiet: true },
    };
    expect(baselineBlockers(clean)).toEqual([]);
    expect(
      baselineBlockers({ ...clean, dirty: true }).some((reason) =>
        reason.includes('dirty')
      )
    ).toBe(true);
    expect(
      baselineBlockers({ ...clean, problems: ['launch 2 ended early'] }).length
    ).toBeGreaterThan(0);
    expect(
      baselineBlockers({
        ...clean,
        machine: { cpuCount: 14, loadavg1: 12, quiet: false },
      }).some((reason) => reason.includes('load average'))
    ).toBe(true);
    expect(
      baselineBlockers({ ...clean, machine: { cpuCount: 14 } }).length
    ).toBeGreaterThan(0);
    // A `quick` run at 4 launches is local feedback, not baseline material
    // (docs/DECISIONS.md D9). `report.mjs --update-baseline` reads files from
    // disk, so the guard belongs in the shared blocker list rather than in the
    // runner's flags.
    expect(
      baselineBlockers({ ...clean, plan: 'quick' }).some((reason) =>
        reason.includes('full')
      )
    ).toBe(true);
    expect(
      baselineBlockers({ ...clean, launches: 4 }).some((reason) =>
        reason.includes('launches')
      )
    ).toBe(true);
  });

  /**
   * The ART regime guard (T12 round 2). `speed-profile` and `verify` are two
   * comparability regimes - T12 measured the same code's ratio to the shared host
   * move 1.22x -> 0.99x on mount `presented` across that line - so a baseline may
   * not be minted from an app that is still interpreting. iOS has no ART, so the
   * guard is keyed on the platform, and a pre-T12 results file that recorded no
   * `art` at all is refused rather than assumed compiled.
   */
  it('refuses to mint an Android baseline from an uncompiled app', () => {
    const cleanAndroid = {
      ...makeRun(),
      platform: 'android',
      dirty: false,
      problems: [],
      plan: 'full',
      launches: 8,
      machine: { cpuCount: 14, loadavg1: 2.5, quiet: true },
      art: {
        packageName: 'com.nitroui.bench',
        status: 'speed-profile',
        primed: true,
        attempts: 1,
      },
    };
    expect(baselineBlockers(cleanAndroid)).toEqual([]);
    expect(
      baselineBlockers({
        ...cleanAndroid,
        art: { ...cleanAndroid.art, status: 'verify', primed: false },
      }).some((reason) => reason.includes('verify'))
    ).toBe(true);
    expect(
      baselineBlockers({
        ...cleanAndroid,
        art: { ...cleanAndroid.art, status: 'interpret-only' },
      }).some((reason) => reason.includes('interpreter'))
    ).toBe(true);
    // A run from before the state was recorded: unknown regime, no baseline.
    expect(
      baselineBlockers({ ...cleanAndroid, art: null }).some((reason) =>
        reason.includes('did not record an ART compile state')
      )
    ).toBe(true);
    // iOS is exempt: it has no ART, and must keep minting baselines as before.
    const cleanIos = {
      ...makeRun(),
      dirty: false,
      problems: [],
      plan: 'full',
      launches: 8,
      machine: { cpuCount: 14, loadavg1: 2.5, quiet: true },
    };
    expect(baselineBlockers(cleanIos)).toEqual([]);
  });
});

/**
 * The same verdict through the shipped binary, so the exit code that CI keys on
 * is covered too - `run.mjs` uses the identical `comparisonSections()`.
 */
describe('bench report CLI', () => {
  const script = resolve(process.cwd(), 'scripts/bench/report.mjs');

  function fixture(overrides) {
    const run = makeRun(overrides);
    return {
      schemaVersion: SCHEMA_VERSION,
      platform: 'ios',
      plan: 'quick',
      deviceKey: 'ios27-sim-testdevice',
      startedAt: '2026-10-22T00:00:00.000Z',
      durationMs: 1000,
      problems: [],
      cells: run.cells,
    };
  }

  function report(headOverrides) {
    const dir = mkdtempSync(join(tmpdir(), 'bench-report-'));
    try {
      const headFile = join(dir, 'head.json');
      const baseFile = join(dir, 'base.json');
      writeFileSync(headFile, JSON.stringify(fixture(headOverrides)));
      writeFileSync(baseFile, JSON.stringify(fixture({})));
      const result = spawnSync(
        process.execPath,
        [script, headFile, '--compare', baseFile],
        {
          encoding: 'utf8',
          cwd: process.cwd(),
        }
      );
      return { ...result, markdown: renderMarkdown(fixture(headOverrides)) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 1 when a nitro-ui arm regressed', () => {
    const result = report({
      'nitro-ui': { mounted: 220_000, presented: 260_000 },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('nitro-ui');
    expect(result.stdout).toContain('FAIL');
    expect(result.markdown).toContain('presented');
  });

  it('exits 0 when the same comparison is inside the noise', () => {
    const result = report({
      'nitro-ui': { mounted: 220_000, presented: 260_000, spread: true },
    });
    expect(result.stdout).toContain('noisy');
    expect(result.status).toBe(0);
  });
});

describe('memory aggregation', () => {
  /**
   * Round 2 regression: the Android heap breakdown stored an undefined variable,
   * which killed the runner *after* it had measured 48 launches. iOS reports -1
   * for both heaps, so no iOS run - and no iOS-shaped fixture - ever reached that
   * line. Android has to be in the fixture for that to be worth testing.
   */
  it('folds the Android heap breakdown into per-instance bytes', () => {
    const n = 200;
    const cells = aggregateRecords(
      memoryRecords({
        implementation: 'rn-core',
        n,
        perInstance: 40_000,
        heaps: { native: 3_000, java: 2_000 },
      })
    );
    const memory = cells['memory:rn-core:200'].memory;

    // PSS moved 40 KB per instance, of which 5 KB is attributable to a heap.
    expect(memory.bytesPerInstance).toBeCloseTo(40_000, 0);
    expect(memory.nativeBytesPerInstance).toBeCloseTo(3_000, 0);
    expect(memory.javaBytesPerInstance).toBeCloseTo(2_000, 0);
    expect(memory.heapBreakdownLaunches).toBe(LAUNCHES);
    expect(memory.heapCollected).toBe(true);
  });

  it('leaves the heap breakdown null on iOS, where the probe reports -1', () => {
    const cells = aggregateRecords(
      memoryRecords({ implementation: 'rn-core', n: 200 })
    );
    const memory = cells['memory:rn-core:200'].memory;
    expect(memory.bytesPerInstance).toBeCloseTo(40_000, 0);
    expect(memory.nativeBytesPerInstance).toBeNull();
    expect(memory.javaBytesPerInstance).toBeNull();
  });
});

describe('a gated arm with no baseline value', () => {
  /**
   * The first run after a component lands has ratios to `rn-core` but no ratio to
   * regress against, because the baseline cell was skipped. Silently reporting
   * that as `ok` reads like a pass, so the gate labels it and prints how the arm
   * compares to the control.
   */
  it('is labelled, not silently passed', () => {
    const base = makeRun();
    base.cells['mount:nitro-ui:50'].skipReason = 'no Switch yet';
    base.cells['mount:nitro-ui:50'].metrics = {};
    const result = gate({ head: makeRun(), base });
    const row = result.rows.find(
      (entry) =>
        entry.implementation === 'nitro-ui' &&
        entry.key !== 'memory:nitro-ui:200'
    );
    expect(row?.status).toBe('new-arm');
    expect(row.gated).toBe(true);
    expect(result.conclusiveFailure).toBe(false);

    const markdown = comparisonSections({
      run: { platform: 'ios', cells: makeRun().cells },
      base: { platform: 'ios', cells: base.cells },
      mode: 'check',
      label: 'baseline',
    }).markdown;
    expect(markdown).toContain('new arm');
    expect(markdown).toContain('rn-core');
  });
});

describe('native perf marks (--perf-marks)', () => {
  /**
   * The marks a `--perf-marks` launch writes: one `perf` record per measured
   * iteration, folded per instance. `propsPerFlip = 2` is the interesting case -
   * it is what a redundant commit looks like from the inside.
   */
  function markRecords({
    implementation = 'nitro-ui',
    scenario = 'mount',
    n = 50,
    propsPerFlip = 1,
    firstFrame = 0,
    launch = 0,
  }) {
    const records = [];
    for (let index = 0; index < ITERATIONS; index++) {
      records.push({
        kind: 'perf',
        scenario,
        implementation,
        n,
        launch,
        index,
        propsApplied: n * propsPerFlip,
        firstFrame,
        instances: n,
        propsAppliedNs: 90_000 + index,
        firstFrameNs: firstFrame > 0 ? 120_000 + index : null,
        drawLatencyNs: firstFrame > 0 ? 30_000 : null,
      });
    }
    return records;
  }

  it('folds marks into a summary, including marks per instance', () => {
    const cells = aggregateRecords([
      ...cellRecords({ implementation: 'nitro-ui' }),
      ...markRecords({ propsPerFlip: 2, firstFrame: 50 }),
    ]);
    const marks = cells['mount:nitro-ui:50'].marks;

    expect(marks.iterations).toBe(ITERATIONS);
    expect(marks.launches).toBe(1);
    expect(marks.propsApplied).toBe(100);
    // 100 propsApplied marks over 50 instances = two native commits per flip.
    expect(marks.propsAppliedPerInstance).toBeCloseTo(2, 5);
    expect(marks.firstFrame).toBe(50);
    expect(marks.propsAppliedNs).toBeCloseTo(90_000, -2);
    expect(marks.drawLatencyNs).toBe(30_000);
  });

  it('is null for a clean run, so a normal table says nothing about marks', () => {
    const cells = aggregateRecords(cellRecords({ implementation: 'nitro-ui' }));
    expect(cells['mount:nitro-ui:50'].marks).toBeNull();
    expect(detailSections({ platform: 'ios', cells })).not.toContain(
      'Native perf marks'
    );
  });

  it('prints the marks table when a run has them', () => {
    const cells = aggregateRecords([
      ...cellRecords({ implementation: 'nitro-ui' }),
      ...markRecords({ firstFrame: 50 }),
    ]);
    expect(detailSections({ platform: 'ios', cells })).toContain(
      'Native perf marks'
    );
  });

  it('never gates, so a marks run cannot mint a baseline', () => {
    const reasons = baselineBlockers({
      ...makeRun(),
      dirty: false,
      plan: 'full',
      launches: 8,
      problems: [],
      machine: { loadavg1: 1, cpuCount: 14 },
      perfMarks: true,
    });
    expect(reasons.some((reason) => reason.includes('perf marks'))).toBe(true);
  });

  it('narrows the schedule to the arm that has marks, and keeps :marks out of the cell key', () => {
    const schedule = buildSchedule({ plan: 'quick', perfMarks: true });
    expect([...new Set(schedule.map((entry) => entry.implementation))]).toEqual(
      ['nitro-ui']
    );
    expect(launchPlanString(schedule[0])).toBe('mount:nitro-ui:50:marks');
    expect(cellKey('mount', 'nitro-ui', 50)).toBe('mount:nitro-ui:50');
    // A clean run's launch string carries no flag at all.
    expect(launchPlanString({ ...schedule[0], perfMarks: false })).toBe(
      'mount:nitro-ui:50'
    );
    expect(() =>
      buildSchedule({ plan: 'quick', only: 'rn-core', perfMarks: true })
    ).toThrow(/needs an implementation with marks/);
  });
});

describe('sample completeness (round 4)', () => {
  /**
   * Round 3's Android mount table printed `presented` medians built from 35 of
   * 80 iterations (`rn-core`) and 13 of 80 (`expo-ui-shared-host`), and quoted
   * "1.15x" from them. A signal that arrives on a third of the iterations is
   * broken, not slow, and the survivors are not a sample of the cell (review
   * rounds 2-3, fix 2). Such a metric is now `n/a` everywhere and ungated.
   */
  it('drops a latency metric whose samples are mostly missing', () => {
    const run = makeRun({ 'nitro-ui': { missingPresented: 12 } });
    const cell = run.cells['mount:nitro-ui:50'];
    expect(cell.metrics.presentedNs.reportable).toBe(false);
    expect(comparableMetrics(cell)).not.toHaveProperty('presentedNs');
    expect(ratioTable(run)['mount:nitro-ui:50'].metrics).not.toHaveProperty(
      'presentedNs'
    );
    expect(incompleteMetrics(cell)).toEqual([
      { metric: 'presentedNs', samples: 32, expected: 80 },
    ]);
    // Doubling what is left must not fail the gate: those iterations are not a
    // sample of the cell, they are the ones the probe happened to catch.
    const doubled = makeRun({
      'nitro-ui': { presented: 260_000, missingPresented: 12 },
    });
    const result = gate({ head: doubled, base: makeRun() });
    expect(
      result.conclusiveFailures.some(
        (failure) => failure.metric === 'presentedNs'
      )
    ).toBe(false);
  });

  it('keeps a latency metric that lost only a tenth of its samples', () => {
    const run = makeRun({ 'nitro-ui': { missingPresented: 2 } });
    const cell = run.cells['mount:nitro-ui:50'];
    expect(cell.metrics.presentedNs.samples).toBe(72);
    expect(cell.metrics.presentedNs.reportable).toBe(true);
    expect(comparableMetrics(cell)).toHaveProperty('presentedNs');
    expect(incompleteMetrics(cell)).toEqual([]);
  });

  it('will not divide an arm by an incomplete control', () => {
    // The exact round-3 shape: the arm drew 80 of 80 presenting frames while
    // `rn-core` drew 13, so the ratio was a survivor over a survivor.
    const run = makeRun({ 'rn-core': { missingPresented: 20 } });
    expect(ratioTable(run)['mount:nitro-ui:50'].metrics).not.toHaveProperty(
      'presentedNs'
    );
    expect(ratioTable(run)['mount:nitro-ui:50'].metrics).toHaveProperty(
      'mountedNs'
    );
  });

  it('says why a column is n/a instead of leaving the reader guessing', () => {
    const run = makeRun({ 'nitro-ui': { missingPresented: 12 } });
    const detail = detailSections(run);
    expect(detail).toContain('Not reportable');
    expect(detail).toContain('32 of 80');
    // The summary table prints the withheld column as `n/a` too - a reader who
    // never scrolls to the detail cells still cannot mistake it for a number.
    expect(summaryTable(run)).toContain('n/a');
    expect(MAX_MISSING_SAMPLE_RATIO).toBe(0.1);
  });

  it('never mints a baseline from a cell with an unreportable metric', () => {
    const blockers = baselineBlockers(
      baselineRun({ 'nitro-ui': { missingPresented: 12 } })
    );
    expect(
      blockers.some((reason) => reason.includes('n/a because too few'))
    ).toBe(true);
  });
});

describe('--check against a committed baseline', () => {
  // `--check` reads `bench/baselines/<deviceKey>.json` through
  // `baselineTable()`/`baselineNoise()` rather than a run, and until round 4 no
  // test went down that path - the reviewer had to script it by hand to prove
  // the gate fires there at all.

  it('mints a ratio-only baseline from a clean full-plan run', () => {
    const baseline = buildBaseline(baselineRun());
    expect(baseline.platform).toBe('ios');
    expect(baseline.deviceKey).toBe('ios27-sim-testdevice');
    const cell = baseline.cells['mount:nitro-ui:50'];
    expect(cell.metrics.mountedNs.ratio).toBeCloseTo(1.1, 1);
    // Ratio-only (D9): a baseline stores no absolute nanoseconds at all.
    expect(JSON.stringify(baseline)).not.toContain('launchMedians');
    expect(baselineBlockers(baselineRun())).toEqual([]);
  });

  it('fails a 2x nitro-ui regression against that baseline', () => {
    const baseTable = baselineTable(buildBaseline(baselineRun()));
    const baseNoise = baselineNoise(buildBaseline(baselineRun()));
    const result = gate({
      head: baselineRun({
        'nitro-ui': { mounted: 220_000, presented: 260_000 },
      }),
      base: { cells: {} },
      baseTable,
      baseNoise,
    });
    expect(result.conclusiveFailure).toBe(true);
    const failure = result.conclusiveFailures.find(
      (entry) => entry.metric === 'mountedNs'
    );
    expect(failure.implementation).toBe('nitro-ui');
    expect(failure.ratio).toBeCloseTo(2, 1);
  });

  it('passes the same baseline when nothing moved', () => {
    const baseline = buildBaseline(baselineRun());
    const result = gate({
      head: baselineRun(),
      base: { cells: {} },
      baseTable: baselineTable(baseline),
      baseNoise: baselineNoise(baseline),
    });
    expect(result.conclusiveFailures).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});

/**
 * The Button cells (`bun bench --component button`, task G2).
 *
 * A component is part of the scenario cell (`mount.button`), so the one thing a
 * reviewer cannot see from the schedule alone is whether the gate still pairs a
 * cell with the `rn-core` control of the **same cell**. Cross that wire and every
 * Button ratio is computed against a Switch: a number, a confident one, and
 * meaningless. These fixtures are the case that must not silently happen, and the
 * reason the Button cells are gated at all (D15's targets are per `nitro-ui` arm).
 */
describe('the Button cells (--component button)', () => {
  /**
   * A Button run, plus a Switch run mixed into the same file.
   *
   * Both are here on purpose, and their controls are deliberately far apart
   * (`mount` 100 us, `mount.button` 200 us): a gate that paired a Button arm with
   * the Switch control would read 2.2x or 0.55x instead of 1.1x, so the ratios
   * below are only reachable through the correct pairing.
   */
  function makeMixedRun(overrides = {}) {
    const arms = {
      'rn-core': {},
      'expo-ui-host-per-control': { mounted: 210_000 },
      'expo-ui-shared-host': { mounted: 80_000 },
      'nitro-ui': { mounted: 110_000 },
      ...overrides,
    };
    const records = [];
    for (const [implementation, values] of Object.entries(arms)) {
      for (const scenario of ['mount', 'mount.button']) {
        const scale = scenario === 'mount' ? 1 : 2;
        records.push(
          ...cellRecords({
            scenario,
            implementation,
            mounted: (values.mounted ?? 100_000) * scale,
            presented: (values.presented ?? 130_000) * scale,
          })
        );
      }
      records.push(...memoryRecords({ implementation, ...values }));
      records.push(
        ...memoryRecords({
          scenario: 'memory.button',
          implementation,
          ...values,
        })
      );
    }
    return {
      platform: 'ios',
      cells: aggregateRecords(records, { keepRaw: true }),
    };
  }

  /** `makeMixedRun` restricted to the Button component, as `--component button` runs it. */
  function makeButtonRun(overrides = {}) {
    const run = makeMixedRun(overrides);
    return {
      platform: 'ios',
      cells: Object.fromEntries(
        Object.entries(run.cells).filter(
          ([key, cell]) => componentOf(cell.scenario ?? key) === 'button'
        )
      ),
    };
  }

  it('divides a Button arm by the Button control, never the Switch control', () => {
    const table = ratioTable(makeMixedRun());
    // 220 us over a 200 us control. The Switch arm is also 1.1x over its own
    // control, so a crossed wire shows up as 2.2x / 0.55x on one of these rows.
    expect(
      table['mount.button:nitro-ui:50'].metrics.mountedNs.ratio
    ).toBeCloseTo(1.1, 4);
    expect(table['mount:nitro-ui:50'].metrics.mountedNs.ratio).toBeCloseTo(
      1.1,
      4
    );
    expect(table['mount.button:rn-core:50'].metrics.mountedNs.control).toBe(
      true
    );
  });

  it('is silent when nothing changed', () => {
    const result = gate({ head: makeButtonRun(), base: makeButtonRun() });
    expect(result.failures).toEqual([]);
  });

  it('fails conclusively when the Button arm doubles', () => {
    const result = gate({
      head: makeButtonRun({
        'nitro-ui': { mounted: 440_000, presented: 520_000 },
      }),
      base: makeButtonRun(),
    });
    const mounted = result.failures.find(
      (failure) => failure.metric === 'mountedNs'
    );
    expect(mounted).toBeDefined();
    expect(mounted.implementation).toBe('nitro-ui');
    // The Button cell is the one that moved; the Switch cell of the same arm is
    // absent from a `--component button` run rather than quietly passing.
    expect(mounted.key).toBe('mount.button:nitro-ui:50');
  });

  it('never gates a Button reference arm', () => {
    const result = gate({
      head: makeButtonRun({
        'expo-ui-shared-host': { mounted: 640_000, presented: 780_000 },
      }),
      base: makeButtonRun(),
    });
    expect(
      result.failures.filter((failure) => failure.implementation === 'nitro-ui')
    ).toEqual([]);
  });

  it('schedules one complete component per --component, never a mix', () => {
    const button = buildSchedule({ plan: 'quick', component: 'button' });
    // Every cell is a Button cell, and all four arms are there - including the
    // control, or the ratios would be computed against an arm that is never
    // measured.
    expect([...new Set(button.map((entry) => entry.scenario))]).toEqual([
      'mount.button',
      'update.button',
      'memory.button',
    ]);
    expect(new Set(button.map((entry) => entry.implementation))).toEqual(
      new Set(IMPLEMENTATIONS)
    );
    const sw = buildSchedule({ plan: 'quick', component: 'switch' });
    expect(sw.every((entry) => componentOf(entry.scenario) === 'switch')).toBe(
      true
    );
    // `null` stays "every component", which is what a plain `bun bench` runs.
    // G3's Progress cells are the fourth component, so this list and the count
    // grow with every component that lands - a cell missing from the plan shows
    // up here as a shorter schedule, not a silent skip.
    const all = buildSchedule({ plan: 'quick' });
    expect(new Set(all.map((entry) => componentOf(entry.scenario)))).toEqual(
      new Set(['switch', 'slider', 'button', 'progress', 'segmented-control'])
    );
    // Five components in the quick plan, each with the same three cells.
    expect(all.length).toBe(button.length * 5);
  });
});

/**
 * The SegmentedControl cells (`bun bench --component segmented-control`, task G4).
 *
 * The same three claims the Button block makes, with a third component in the
 * file: a gate that pairs an arm with a *different* component's `rn-core` control
 * still produces confident, meaningless numbers, and G4 is the first component
 * added since that rule was written - so it is the one that has to prove the rule
 * still holds with five components in the plan rather than two.
 */
describe('the SegmentedControl cells (--component segmented-control)', () => {
  /**
   * A run holding Switch, Button and SegmentedControl cells at once.
   *
   * Three components with controls deliberately far apart (`mount` 100 us,
   * `mount.button` 200 us, `mount.segmented-control` 300 us), and every arm
   * exactly 1.1x over the control of *its own* cell. A gate that crossed the
   * pairing would read 3.3x or 0.3x on the rows below, so 1.1 is only reachable
   * through the right one.
   */
  function makeMixedRun(overrides = {}) {
    const arms = {
      'rn-core': {},
      'expo-ui-host-per-control': { mounted: 210_000 },
      'expo-ui-shared-host': { mounted: 80_000 },
      'nitro-ui': { mounted: 110_000 },
      ...overrides,
    };
    const scenarios = [
      ['mount', 1],
      ['mount.button', 2],
      ['mount.segmented-control', 3],
    ];
    const records = [];
    for (const [implementation, values] of Object.entries(arms)) {
      for (const [scenario, scale] of scenarios) {
        records.push(
          ...cellRecords({
            scenario,
            implementation,
            mounted: (values.mounted ?? 100_000) * scale,
            presented: (values.presented ?? 130_000) * scale,
          })
        );
        const action = scenarioActionOf(scenario);
        const suffix = scenario === action ? '' : `.${componentOf(scenario)}`;
        records.push(
          ...memoryRecords({
            scenario: `memory${suffix}`,
            implementation,
            ...values,
          })
        );
      }
    }
    return {
      platform: 'ios',
      cells: aggregateRecords(records, { keepRaw: true }),
    };
  }

  /** `makeMixedRun` restricted to the SegmentedControl component, as `--component segmented-control` runs it. */
  function makeSegmentedRun(overrides = {}) {
    const run = makeMixedRun(overrides);
    return {
      platform: 'ios',
      cells: Object.fromEntries(
        Object.entries(run.cells).filter(
          ([key, cell]) =>
            componentOf(cell.scenario ?? key) === 'segmented-control'
        )
      ),
    };
  }

  it('divides a SegmentedControl arm by the SegmentedControl control', () => {
    const table = ratioTable(makeMixedRun());
    // 330 us over a 300 us control - and *not* 330 over the 100 us Switch
    // control (3.3x) or the 200 us Button one (1.65x).
    expect(
      table['mount.segmented-control:nitro-ui:50'].metrics.mountedNs.ratio
    ).toBeCloseTo(1.1, 4);
    expect(
      table['mount.segmented-control:rn-core:50'].metrics.mountedNs.control
    ).toBe(true);
    // The other two components are still paired with their own controls, so this
    // is a fourth row joining the table rather than a row that moved the others.
    expect(table['mount:nitro-ui:50'].metrics.mountedNs.ratio).toBeCloseTo(
      1.1,
      4
    );
    expect(
      table['mount.button:nitro-ui:50'].metrics.mountedNs.ratio
    ).toBeCloseTo(1.1, 4);
  });

  it('is silent when nothing changed', () => {
    const result = gate({
      head: makeSegmentedRun(),
      base: makeSegmentedRun(),
    });
    expect(result.failures).toEqual([]);
  });

  it('fails conclusively when the SegmentedControl arm doubles', () => {
    const result = gate({
      head: makeSegmentedRun({
        'nitro-ui': { mounted: 440_000, presented: 520_000 },
      }),
      base: makeSegmentedRun(),
    });
    const mounted = result.failures.find(
      (failure) => failure.metric === 'mountedNs'
    );
    expect(mounted).toBeDefined();
    expect(mounted.implementation).toBe('nitro-ui');
    expect(mounted.key).toBe('mount.segmented-control:nitro-ui:50');
  });

  it('never gates a SegmentedControl reference arm', () => {
    const result = gate({
      head: makeSegmentedRun({
        'expo-ui-shared-host': { mounted: 640_000, presented: 780_000 },
      }),
      base: makeSegmentedRun(),
    });
    expect(
      result.failures.filter((failure) => failure.implementation === 'nitro-ui')
    ).toEqual([]);
  });

  it('schedules every segmented cell and every arm', () => {
    const segmented = buildSchedule({
      plan: 'quick',
      component: 'segmented-control',
    });
    expect([...new Set(segmented.map((entry) => entry.scenario))]).toEqual([
      'mount.segmented-control',
      'update.segmented-control',
      'memory.segmented-control',
    ]);
    expect(new Set(segmented.map((entry) => entry.implementation))).toEqual(
      new Set(IMPLEMENTATIONS)
    );
  });
});
