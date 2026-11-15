import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  SCHEMA_VERSION,
  aggregateRecords,
  buildSchedule,
  cellKey,
  ARM_SCOPES,
  armScopeCovers,
  ARMS_WITHOUT_COMPONENT,
  comparableMetrics,
  componentOf,
  createLoadSampler,
  gate,
  IMPLEMENTATIONS,
  incompleteMetrics,
  launchPlanString,
  loadOverCeiling,
  loadCeiling,
  scenarioActionOf,
  summarizeLoadSamples,
  MAX_MISSING_SAMPLE_RATIO,
  LOAD_OVER_CEILING_FRACTION,
  LOAD_SAMPLE_INTERVAL_MS,
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
 * The arms a component's cells must carry: every unscoped arm, plus the scoped
 * ones (`ARM_SCOPES`) that render this component, minus the arms with no
 * mountable cell on the named platform (`ARMS_WITHOUT_COMPONENT`). The last
 * only narrows when a platform is named.
 */
function armsFor(component, platform = null) {
  return new Set(
    IMPLEMENTATIONS.filter((name) => {
      const scope = ARM_SCOPES[name];
      if (!armScopeCovers(name, component)) {
        return false;
      }
      if (
        platform != null &&
        ARMS_WITHOUT_COMPONENT.includes(`${platform}:${name}:${component}`)
      ) {
        return false;
      }
      if (scope == null) {
        return true;
      }
      return platform == null || scope.platform === platform;
    })
  );
}

/**
 * Per-launch multipliers. The quiet one is what an idle machine produces; the
 * loud one is a machine doing something else while a cell is measured, which is
 * what the within-run noise guard is supposed to notice.
 */
const QUIET = [1, 1.01, 0.995, 1.005];
const LOUD = [1, 1.7, 0.62, 1.35];

/**
 * Records for one cell. `values` are per-op nanoseconds; latency metrics are
 * written per iteration and CPU as one bracket per launch, as the bench app
 * does.
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
      // The waiting rule this fixture's app reports (iOS's defaults). A run
      // whose app records none is flagged in its problems list, so a fixture
      // has to carry one.
      mountTimeoutMs: 1_500,
      presentedTimeoutMs: 8_000,
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
        // the app records as a missing sample.
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
      mountTimeoutMs: 1_500,
      presentedTimeoutMs: 8_000,
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
 * `makeRun` plus the metadata a results file carries (clean tree, `full` plan,
 * 8 launches, quiet machine).
 */
function measuredRun(overrides = {}) {
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
    // Expo gets twice as slow and nitro-ui does not move.
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
    // `rn-core` 5x slower in head: on its own that is machine state, not a
    // regression...
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

    // A slope fitted over a series that is not climbing is not comparable and
    // cannot gate.
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

  it("labels a reference arm's monotonic climb as reported, not gated (X15)", () => {
    // Only `GATED_IMPLEMENTATIONS` can fail the gate, so a reference arm's
    // climb is labelled as reported.
    const cells = aggregateRecords(
      [
        ...memoryRecords({
          scenario: 'leak',
          implementation: 'nitro-ui',
          leakPerCycle: 9_000,
        }),
        ...memoryRecords({
          scenario: 'leak',
          implementation: 'expo-ui-host-per-control',
          leakPerCycle: 9_000,
        }),
      ],
      { keepRaw: true }
    );
    const detail = detailSections({ platform: 'ios', cells });
    const sectionFor = (implementation) => {
      const start = detail.indexOf(`### leak N=200 - ${implementation}\n`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = detail.indexOf('\n### ', start + 1);
      return detail.slice(start, next === -1 ? undefined : next);
    };
    expect(sectionFor('nitro-ui')).toContain('MONOTONIC (gated as a leak)');
    expect(sectionFor('expo-ui-host-per-control')).toContain(
      'MONOTONIC (reported, not gated)'
    );
    expect(sectionFor('expo-ui-host-per-control')).not.toContain(
      'gated as a leak'
    );
  });

  it('is the same gate behind the standalone reporter (review S11)', () => {
    const noisyHead = makeRun({
      'nitro-ui': { mounted: 220_000, presented: 260_000, spread: true },
    });
    const noisy = comparisonSections({
      run: noisyHead,
      base: makeRun(),
      label: 'base',
    });
    expect(noisy.exitCode).toBe(0);
    expect(noisy.result.conclusiveFailure).toBe(false);

    const clear = comparisonSections({
      run: makeRun({ 'nitro-ui': { mounted: 220_000, presented: 260_000 } }),
      base: makeRun(),
      label: 'base',
    });
    expect(clear.exitCode).toBe(1);
    expect(clear.markdown).toContain('nitro-ui');
  });
});

/**
 * The fixtures never sit on a threshold: the quiet band is 1.6-5.0, the ceiling
 * is 7.0 and the busy band is 8.4-13.6. The two boundary tests are the only
 * places a value touches one.
 */
describe('the idle-machine rule samples the run (R4)', () => {
  const CPU_COUNT = 14;
  const CEILING = loadCeiling(CPU_COUNT);
  /** One noisy minute at the end of an otherwise quiet run. */
  const A1B_SPIKE = 7.6;

  const quiet = (count) =>
    Array.from(
      { length: count },
      (_, index) => 1.6 + (index % 10) * 0.38 // 1.6 .. 4.96
    );
  const busy = (count) =>
    Array.from(
      { length: count },
      (_, index) => 8.4 + (index % 10) * 0.58 // 8.4 .. 13.62
    );

  function sampledRun({ samples, loadavg1 }) {
    const loadSamples = summarizeLoadSamples(samples, { cpuCount: CPU_COUNT });
    const machine = {
      cpuCount: CPU_COUNT,
      loadavg1,
      loadavg5: 4.06,
      loadSamples,
    };
    machine.quiet = loadOverCeiling(machine) === null;
    return { ...measuredRun(), machine };
  }

  it('calls a run that was quiet from start to finish quiet', () => {
    const run = sampledRun({ samples: quiet(180), loadavg1: 2.4 });
    expect(run.machine.loadSamples).toMatchObject({ count: 180, over: 0 });
    expect(run.machine.quiet).toBe(true);
    expect(loadOverCeiling(run.machine)).toBeNull();
  });

  /**
   * The spike is still recorded and still visible in `max`; it cannot condemn
   * the run on its own.
   */
  it('calls the shape that condemned A1b quiet - hours of quiet, a spike at the end', () => {
    const run = sampledRun({
      samples: [...quiet(300), A1B_SPIKE, A1B_SPIKE],
      loadavg1: A1B_SPIKE,
    });
    expect(run.machine.loadSamples).toMatchObject({
      count: 302,
      over: 2,
      max: A1B_SPIKE,
    });
    expect(loadOverCeiling(run.machine)).toBeNull();
    expect(run.machine.quiet).toBe(true);
    expect(
      loadOverCeiling({ cpuCount: CPU_COUNT, loadavg1: A1B_SPIKE })
    ).toContain('load average 7.60');
  });

  it('calls a run busy that was busy for more than half of it', () => {
    const run = sampledRun({
      samples: [...quiet(45), ...busy(55)],
      loadavg1: 3.0, // the last minute was fine; the run was not
    });
    const reason = loadOverCeiling(run.machine);
    expect(reason).toContain('busy for half the run');
    expect(reason).toContain('median load average');
    expect(run.machine.quiet).toBe(false);
  });

  /**
   * The machine settles down again, so the end-of-run load average is quiet,
   * but a seventh of the run was spent over the ceiling.
   */
  it('calls a run busy with more than 10 % of its samples over the ceiling', () => {
    const run = sampledRun({
      samples: [...quiet(88), ...busy(12)],
      loadavg1: 2.9,
    });
    expect(run.machine.loadSamples.overFraction).toBeCloseTo(0.12, 10);
    expect(CEILING).toBeCloseTo(7, 10);
    const reason = loadOverCeiling(run.machine);
    expect(reason).toContain('12 of 100 load samples');
    expect(reason).toContain('12% of the run');
    expect(run.machine.quiet).toBe(false);
  });

  /**
   * Boundary: the allowance is *more than* 10 %, so exactly a tenth is still quiet
   * and the sample after it is not.
   */
  it('allows exactly 10 % of the samples over the ceiling and refuses the next one', () => {
    expect(LOAD_OVER_CEILING_FRACTION).toBeCloseTo(0.1, 10);
    const exactlyTen = loadOverCeiling(
      sampledRun({ samples: [...quiet(90), ...busy(10)], loadavg1: 2.9 })
        .machine
    );
    expect(exactlyTen).toBeNull();
    const eleven = loadOverCeiling(
      sampledRun({ samples: [...quiet(89), ...busy(11)], loadavg1: 2.9 })
        .machine
    );
    expect(eleven).toContain('of the run');
  });

  /**
   * Boundary: "over the ceiling" is strictly over, so a machine sitting exactly on
   * its ceiling for the whole run is still an idle machine.
   */
  it('does not count a sample that sits exactly on the ceiling as over it', () => {
    const run = sampledRun({
      samples: Array.from({ length: 120 }, () => CEILING),
      loadavg1: CEILING,
    });
    expect(run.machine.loadSamples).toMatchObject({ over: 0, median: CEILING });
    expect(loadOverCeiling(run.machine)).toBeNull();
  });

  it('keeps the single-sample rule for files recorded before the sampler', () => {
    expect(
      loadOverCeiling({ cpuCount: CPU_COUNT, loadavg1: A1B_SPIKE })
    ).toContain(
      'the machine was busy: load average 7.60 over 14 cores (ceiling 7.0)'
    );
    expect(loadOverCeiling({ cpuCount: CPU_COUNT, loadavg1: 2.39 })).toBeNull();
    // A file with no load recorded at all still says so, samples or not.
    expect(loadOverCeiling({ cpuCount: CPU_COUNT })).toContain(
      'the run did not record a load average'
    );
    expect(
      loadOverCeiling({
        cpuCount: CPU_COUNT,
        loadavg1: A1B_SPIKE,
        loadSamples: null,
      })
    ).toContain('load average 7.60');
  });

  it('samples the load every 30 s', () => {
    expect(LOAD_SAMPLE_INTERVAL_MS).toBe(30_000);
  });

  it('records one sample per call and ignores a failed read', () => {
    const reads = [2.5, 3.5, Number.NaN, undefined, 4.5];
    let call = 0;
    const sampler = createLoadSampler(() => reads[call++]);
    for (let index = 0; index < reads.length; index += 1) {
      sampler.sample();
    }
    expect(sampler.samples).toEqual([2.5, 3.5, 4.5]);
    expect(sampler.summary({ cpuCount: CPU_COUNT })).toMatchObject({
      count: 3,
      median: 3.5,
      over: 0,
    });
    // Nothing sampled: nothing to judge, so the caller falls back to the old rule.
    expect(
      createLoadSampler(() => Number.NaN).summary({ cpuCount: CPU_COUNT })
    ).toBeNull();
    expect(() => createLoadSampler()).toThrow(TypeError);
  });

  it('summarises a run as count, median, p90, max and the share over', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(summarizeLoadSamples(samples, { cpuCount: 20 })).toMatchObject({
      count: 20,
      ceiling: 10,
      median: 10.5,
      p90: 19,
      max: 20,
      over: 10,
      overFraction: 0.5,
    });
    expect(summarizeLoadSamples([], { cpuCount: 20 })).toBeNull();
    // No core count means no ceiling, which means no sampled verdict.
    expect(summarizeLoadSamples(samples, {})).toBeNull();
  });
});

/**
 * The same verdict through the shipped binary, so the exit code is covered too.
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
   * iOS reports -1 for both heaps, so only an Android-shaped fixture reaches
   * the heap breakdown.
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

describe('a gated arm with no base value', () => {
  /**
   * The first run after a component lands has ratios to `rn-core` but no base
   * ratio to regress against. The gate labels that rather than reporting `ok`.
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
      label: 'v0.9.0',
    }).markdown;
    expect(markdown).toContain('new arm');
    expect(markdown).toContain('rn-core');
  });
});

describe('native perf marks (--perf-marks)', () => {
  /**
   * The marks a `--perf-marks` launch writes: one `perf` record per measured
   * iteration, folded per instance. `propsPerFlip = 2` is what a redundant
   * commit looks like.
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
   * A latency signal that arrives on a minority of the iterations is broken,
   * not slow, and the survivors are not a sample of the cell: such a metric is
   * `n/a` everywhere and ungated.
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
    // The control is missing most of its presenting frames, so a ratio would be
    // a full sample over a survivor.
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
});

/**
 * A component is part of the scenario cell (`mount.button`), and the filter
 * schedules one whole component.
 */
describe('the Button cells (--component button)', () => {
  /**
   * A cell is paired with the `rn-core` control of the same cell. The two
   * controls are far apart (100 us and 200 us) and the arms sit at different
   * ratios over their own control (1.1x and 1.5x), so a crossed pairing reads
   * 3.0x or 0.55x.
   */
  it('divides a Button arm by the Button control, never the Switch control', () => {
    const records = [
      ...cellRecords({ scenario: 'mount', implementation: 'rn-core' }),
      ...cellRecords({
        scenario: 'mount',
        implementation: 'nitro-ui',
        mounted: 110_000,
      }),
      ...cellRecords({
        scenario: 'mount.button',
        implementation: 'rn-core',
        mounted: 200_000,
      }),
      ...cellRecords({
        scenario: 'mount.button',
        implementation: 'nitro-ui',
        mounted: 300_000,
      }),
    ];
    const table = ratioTable({
      platform: 'ios',
      cells: aggregateRecords(records, { keepRaw: true }),
    });
    expect(
      table['mount.button:nitro-ui:50'].metrics.mountedNs.ratio
    ).toBeCloseTo(1.5, 4);
    expect(table['mount:nitro-ui:50'].metrics.mountedNs.ratio).toBeCloseTo(
      1.1,
      4
    );
    expect(table['mount.button:rn-core:50'].metrics.mountedNs.control).toBe(
      true
    );
  });

  it('schedules one complete component per --component, never a mix', () => {
    const button = buildSchedule({ plan: 'quick', component: 'button' });
    // All four arms are there, including the control the ratios are computed
    // against.
    expect([...new Set(button.map((entry) => entry.scenario))]).toEqual([
      'mount.button',
      'update.button',
      'memory.button',
    ]);
    expect(new Set(button.map((entry) => entry.implementation))).toEqual(
      armsFor('button')
    );
    const sw = buildSchedule({ plan: 'quick', component: 'switch' });
    expect(sw.every((entry) => componentOf(entry.scenario) === 'switch')).toBe(
      true
    );
    // `null` stays "every component", which is what a plain `bun bench` runs.
    const all = buildSchedule({ plan: 'quick' });
    const QUICK_COMPONENTS = [
      'switch',
      'slider',
      'button',
      'progress',
      'segmented-control',
      'date-picker',
      'picker',
      'menu',
      'text-field',
      'form',
    ];
    expect(new Set(all.map((entry) => componentOf(entry.scenario)))).toEqual(
      new Set(QUICK_COMPONENTS)
    );
    /**
     * Each component's own plan cells through the four unscoped arms, plus one
     * scoped arm's cells for each component it renders. Summed per component,
     * because a Form is priced at two row counts where every other component is
     * priced at one. The Host arm is scoped to Android, so an iOS schedule must
     * not carry one.
     */
    const unscopedCells = QUICK_COMPONENTS.reduce(
      (total, component) =>
        total +
        buildSchedule({ plan: 'quick', component }).filter(
          (entry) => ARM_SCOPES[entry.implementation] == null
        ).length,
      0
    );
    const iosSwitch = buildSchedule({
      plan: 'quick',
      component: 'switch',
      platform: 'ios',
    });
    expect(
      iosSwitch.some((entry) => entry.implementation === 'nitro-ui-host')
    ).toBe(false);
    const hostCells = buildSchedule({
      plan: 'quick',
      component: 'switch',
    }).filter((entry) => entry.implementation === 'nitro-ui-host').length;
    expect(all.length).toBe(
      unscopedCells + hostCells * ARM_SCOPES['nitro-ui-host'].components.length
    );
  });
});

/**
 * The arms that have no DatePicker cell on Android (`ARMS_WITHOUT_COMPONENT`).
 */
describe('the DatePicker cells (--component date-picker)', () => {
  /**
   * `@expo/ui` has no mountable date field on Android: its only picker form is
   * the inline Material 3 calendar, whose horizontally scrollable month pager
   * cannot be measured by the `matchContents` host with infinite width. A
   * hosted nitro-ui date field does mount there, so `nitro-ui-host` keeps its
   * cells.
   */
  it('omits the Android arms that cannot mount a DatePicker', () => {
    const android = buildSchedule({
      plan: 'quick',
      component: 'date-picker',
      platform: 'android',
    });
    expect(
      [...new Set(android.map((entry) => entry.implementation))].sort()
    ).toEqual(['nitro-ui', 'nitro-ui-host', 'rn-core']);
    expect(android.length).toBe(3 * 3 * 4);
  });

  /** The exclusion is a property of the platform, not of the arm or the cell. */
  it('keeps the DatePicker reference arms everywhere they do mount', () => {
    const ios = buildSchedule({
      plan: 'quick',
      component: 'date-picker',
      platform: 'ios',
    });
    expect(new Set(ios.map((entry) => entry.implementation))).toEqual(
      armsFor('date-picker', 'ios')
    );
    // Switch is a control `@expo/ui` mounts on both platforms, so the same
    // `platform` argument must not narrow any other component's arms.
    const androidSwitch = buildSchedule({
      plan: 'quick',
      component: 'switch',
      platform: 'android',
    });
    expect(new Set(androidSwitch.map((entry) => entry.implementation))).toEqual(
      new Set(IMPLEMENTATIONS)
    );
  });
});

/**
 * The arm composes what a `<Host>` can draw; on iOS `<Host>` is a passthrough
 * rather than a shared composition. A cell outside that scope would be a launch
 * that measures nothing, so such cells are never scheduled.
 */
describe('the shared-Host arm is scheduled only where it renders something', () => {
  const HOST = 'nitro-ui-host';

  /** Every component the quick plan carries, hostable and not. */
  const EVERY_COMPONENT = [
    'switch',
    'slider',
    'button',
    'progress',
    'segmented-control',
    'date-picker',
    'picker',
  ];

  /**
   * `ARM_SCOPES` decides which cells are scheduled, and
   * `bench/src/implementations/index.ts` repeats the list as the arm's
   * `components`. The bench app cannot be imported here (its `@expo/ui` arm is
   * ESM that jest cannot transform), so the second list is read from its
   * source.
   */
  it('keeps its component scope in one place across the two lists', () => {
    const scoped = ARM_SCOPES[HOST].components;
    expect([...scoped].sort()).toEqual([
      'button',
      'date-picker',
      'menu',
      'picker',
      'progress',
      'segmented-control',
      'slider',
      'switch',
    ]);
    const source = readFileSync(
      resolve(__dirname, '../../bench/src/implementations/index.ts'),
      'utf8'
    );
    const listed =
      /name: 'nitro-ui-host',[\s\S]{0,400}?components: \[([^\]]*)\]/.exec(
        source
      );
    expect(listed).not.toBeNull();
    expect(
      listed[1]
        .split('\n')
        // The generated region's markers are comment lines inside this array.
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
        .split(',')
        .map((entry) => entry.trim().replaceAll("'", ''))
        .filter(Boolean)
    ).toEqual(scoped);
  });

  it('schedules a full set of cells for every control a Host can draw', () => {
    for (const component of ARM_SCOPES[HOST].components) {
      const schedule = buildSchedule({
        plan: 'quick',
        component,
        platform: 'android',
      });
      const host = schedule.filter((entry) => entry.implementation === HOST);
      const scenario = component === 'switch' ? '' : `.${component}`;
      expect([...new Set(host.map((entry) => entry.scenario))].sort()).toEqual([
        `memory${scenario}`,
        `mount${scenario}`,
        `update${scenario}`,
      ]);
      // One launch per cell, like every other arm - a ratio needs the same pairing.
      expect(host.length).toBe(3 * 4);
      // And it is paired with the arms it is ratioed against in the same cell.
      expect(new Set(schedule.map((entry) => entry.implementation))).toEqual(
        armsFor(component, 'android')
      );
    }
  });

  /**
   * The arm covers every planned control today, so the loop below walks an
   * empty list, and that is asserted rather than left to pass silently.
   */
  it('schedules no cell of a control a Host refuses', () => {
    const refused = EVERY_COMPONENT.filter(
      (name) => !ARM_SCOPES[HOST].components.includes(name)
    );
    expect(refused).toEqual([]);
    for (const component of refused) {
      expect(ARM_SCOPES[HOST].components.includes(component)).toBe(false);
      for (const platform of ['android', 'ios']) {
        const schedule = buildSchedule({
          plan: 'quick',
          component,
          platform,
        });
        expect(
          schedule.filter((entry) => entry.implementation === HOST)
        ).toEqual([]);
      }
    }
  });

  it.each(ARM_SCOPES[HOST].components)(
    'schedules no %s cell on iOS, where a Host is a passthrough',
    (component) => {
      const schedule = buildSchedule({
        plan: 'quick',
        component,
        platform: 'ios',
      });
      expect(schedule.filter((entry) => entry.implementation === HOST)).toEqual(
        []
      );
      // The other arms keep their cells: the scope is one arm's property.
      expect(new Set(schedule.map((entry) => entry.implementation))).toEqual(
        armsFor(component, 'ios')
      );
    }
  );

  /**
   * An empty schedule exits green, so asking for only the scoped arm on a
   * platform it does not exist on has to be an error.
   */
  it('refuses an --only that the platform leaves nothing to measure', () => {
    for (const component of ARM_SCOPES[HOST].components) {
      expect(() =>
        buildSchedule({
          plan: 'quick',
          component,
          platform: 'ios',
          only: 'nitro-ui-host',
        })
      ).toThrow(/matched no implementation for platform ios/);
    }
  });
});
