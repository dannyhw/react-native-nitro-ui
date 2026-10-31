/**
 * Merging one component's cells into a committed baseline (X14).
 *
 * A baseline is one machine's table of launch-paired ratios, and until now adding a
 * component meant re-measuring all 231 cells of it - an eleven-hour window on a
 * quiet machine, which is why components go missing from a table. Merging is what
 * removes that cost, and it is only safe if three things hold, each of which has a
 * test below that was shown red first:
 *
 * 1. **Nothing else moves.** Every cell, skipped-cell and founding field the file
 *    already had survives byte-for-byte, so the diff is the component and its
 *    provenance entry and nothing else.
 * 2. **The environment is the same measurement.** Schema version, device key, CPU
 *    model and core count, the OS runtime or Android API and system image, the ART
 *    compile state, the waiting rule, and the react-native and `@expo/ui` versions.
 *    A refusal names the field and both values, because the fix differs per field.
 * 3. **A field the file predates is answered with evidence or with a refusal.**
 *    `bun.lock` at the file's own founding commit for the versions; the platform's
 *    default waiting rule for `timeouts`; nothing at all for a runtime, an image or
 *    an ART state - those are regime changes no commit can vouch for.
 *
 * The fixtures keep values that could coincide with a default *out* of the way:
 * CPU model `Fixture M4 Pro`, API 34, runtime 18.4, versions 0.80.0 / 54.0.0. A
 * guard that read today's constants instead of the file's would not pass by luck.
 */

import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openBaselineForMerge } from '../bench/baseline.mjs';
import {
  BASELINE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  aggregateRecords,
  baselineBlockers,
  baselineTimeoutRecord,
  buildSchedule,
  cellKey,
  buildBaseline,
  cellsContradictingTheirKey,
  cellsForComponent,
  componentProvenance,
  componentsInBaseline,
  isCompatibleBaseline,
  mergeBaselineProblems,
  mergeComponentBaseline,
  mergeRunProblems,
  missingBaselineProvenanceProblem,
  missingComponentCells,
  requestedTimeouts,
  seededComponentProvenance,
} from '../bench/lib.mjs';

const LAUNCHES = 8;
const ITERATIONS = 20;
const QUIET = [1, 1.01, 0.995, 1.005, 0.998, 1.002, 1.004, 0.997];

const MINE = 'maintainer-mac-1';
const DEVICE_KEY = 'ios27-sim-testdevice';

/**
 * The waiting rule each platform's baseline is minted under (A4). Both matter
 * per platform: the `run.mjs` case below compares a pre-flight candidate's rule
 * against the file's, and a fixture that recorded iOS's numbers on an Android
 * baseline would be refused for a reason the test is not about.
 */
const WAIT_BY_PLATFORM = {
  ios: { mountTimeoutMs: 1500, presentedTimeoutMs: 8000 },
  android: { mountTimeoutMs: 1500, presentedTimeoutMs: 2000 },
};

/**
 * Records for one arm of one scenario, shaped exactly like the bench app's output.
 * `scenario` is what makes a cell belong to a component (`mount.slider` -> slider).
 */
function armRecords(
  scenario,
  implementation,
  { latency, n = 50, wait, launches = LAUNCHES }
) {
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
      ...wait,
    },
  ];
  for (let launch = 0; launch < launches; launch++) {
    const factor = QUIET[launch] ?? 1;
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
        jsCommitNs: 40_000 * factor * wiggle,
        mountedNs: latency * factor * wiggle,
        presentedNs: latency * 1.3 * factor * wiggle,
      });
    }
    for (const [phase, scale] of [
      ['mount', 1],
      ['unmount', 0.2],
    ]) {
      records.push({
        kind: 'cpu',
        scenario,
        implementation,
        n,
        launch,
        phase,
        iterations: ITERATIONS,
        jsCpuNs: 20_000 * scale * ITERATIONS,
        mainCpuNs: 15_000 * scale * ITERATIONS,
      });
    }
  }
  return records;
}

/**
 * A load summary that is *not* null, for the same reason the fixtures' CPU model is
 * not `Apple M4 Pro`: `loadSamples: null` is also exactly what a dropped field reads
 * as, so a fixture that carries null can never tell "the run recorded no sampler"
 * from "the provenance writer forgot the field" — and a provenance entry whose load
 * summary vanished is precisely the silent failure that makes a bench number
 * unauditable. The numbers are a real run's shape (X14's menu mint on
 * `maintainer-mac-2`), chosen so none of them is zero or a default.
 */
const LOAD_SAMPLES = {
  count: 352,
  ceiling: 7,
  median: 1.4492,
  p90: 1.8081,
  max: 2.2217,
  over: 0,
  overFraction: 0,
};

/**
 * The machine a fixture run rode, with values chosen so they cannot match this
 * repo's requirements or this host by coincidence.
 */
function fixtureMachine(platform, overrides = {}) {
  const shared = {
    hostname: MINE,
    osPlatform: 'darwin',
    osRelease: '27.0.0',
    osVersion: 'Darwin Kernel Version 27.0.0',
    arch: 'arm64',
    cpuCount: 14,
    cpuModel: 'Fixture M4 Pro',
    loadavg1: 1.5,
    loadavg5: 1.2,
    loadSamples: LOAD_SAMPLES,
    totalMemoryGb: 32,
    xcode: 'Xcode 26.3',
    quiet: true,
  };
  return {
    ...shared,
    ...(platform === 'ios'
      ? { simRuntime: '18.4' }
      : {
          avd: 'nitroui_fixture',
          androidApi: '34',
          androidImage: 'fixture/google_apis/34',
        }),
    ...overrides,
  };
}

/**
 * A run of the shape both CLIs read, measuring the scenarios it is handed.
 *
 * Pass `component` instead of `scenarios` to get a run that measures that component
 * *whole* — every cell and every arm `buildSchedule` would launch for it, which is
 * the only shape a merge accepts. That distinction is the difference between a fixture
 * that tests a comparability field (two arms of one cell is plenty) and one that
 * tests a merge (a partial block is exactly what a merge must refuse, because the
 * rows left out could never be added later — see X14 fix round 1, H1).
 */
function makeRun({
  platform = 'ios',
  scenarios = ['mount'],
  component = null,
  components = null,
  plan = 'full',
  nitroUi = 110_000,
  machine = fixtureMachine(platform),
  dependencies = { reactNative: '0.80.0', expoUi: '54.0.0', source: 'fixture' },
  art = null,
  deviceKey = DEVICE_KEY,
  overrides = {},
} = {}) {
  const wait = WAIT_BY_PLATFORM[platform] ?? WAIT_BY_PLATFORM.ios;
  // The arm latencies a complete run needs. Only `rn-core` and `nitro-ui` are ever
  // compared against a baseline here; the third-party reference arms exist so the
  // schedule is whole, and their absolute cost is not what any of these tests ask.
  const latencies = {
    'rn-core': 100_000,
    'nitro-ui': nitroUi,
    'expo-ui-host-per-control': 120_000,
    'expo-ui-shared-host': 115_000,
    'nitro-ui-host': 105_000,
  };
  const whole = [
    ...(component == null ? [] : [component]),
    ...(components ?? []),
  ];
  // `--force` can shorten a launch group, and a fixture that stands in for a
  // *measured* run has to hold the records that group actually ran, or the shape
  // checks refuse it for measuring too little rather than for what it tests.
  const launches = overrides.launches ?? LAUNCHES;
  let cells = null;
  if (whole.length > 0) {
    cells = [
      ...new Map(
        whole
          .flatMap((name) =>
            buildSchedule({
              plan,
              launches,
              platform,
              component: name,
            })
          )
          .map((entry) => [
            cellKey(entry.scenario, entry.implementation, entry.n),
            entry,
          ])
      ).values(),
    ];
  }
  const arms =
    whole.length > 0 ? null : { 'rn-core': 100_000, 'nitro-ui': nitroUi };
  return {
    schemaVersion: SCHEMA_VERSION,
    platform,
    deviceKey,
    deviceName: 'Fixture Device',
    plan,
    launches,
    perfMarks: false,
    sha: 'dead123',
    dirty: false,
    art,
    dependencies,
    createdAt: '2026-10-28T00:00:00.000Z',
    durationMs: 1000,
    problems: [],
    machine,
    cells: aggregateRecords(
      whole.length > 0
        ? cells.flatMap((entry) =>
            armRecords(entry.scenario, entry.implementation, {
              latency: latencies[entry.implementation] ?? 120_000,
              n: entry.n,
              wait,
              launches,
            })
          )
        : scenarios.flatMap((scenario) =>
            Object.entries(arms).flatMap(([implementation, latency]) =>
              armRecords(scenario, implementation, {
                latency,
                wait,
                launches,
              })
            )
          ),
      { keepRaw: true }
    ),
    ...overrides,
  };
}

/** The versions a pre-X14 file's founding commit pinned, in `resolved` shape. */
function recoveredVersions(run) {
  return {
    'dependencies.reactNative': {
      value: run.dependencies.reactNative,
      why: "bun.lock at the baseline's founding commit dead123",
    },
    'dependencies.expoUi': {
      value: run.dependencies.expoUi,
      why: "bun.lock at the baseline's founding commit dead123",
    },
  };
}

/**
 * A committed v2 baseline: what the four files in `bench/baselines/` look like. No
 * `dependencies`, no `components`, and no `timeouts` unless asked for.
 */
function preX14Baseline(run, { withTimeouts = false } = {}) {
  const built = buildBaseline(run);
  const file = { ...built, schemaVersion: 2 };
  delete file.dependencies;
  delete file.components;
  if (!withTimeouts) {
    delete file.timeouts;
  }
  return file;
}

/** Strips the bookkeeping `mergeComponentBaseline` is allowed to add. */
function strippedOfMerge(file) {
  const { components, dependencies, schemaVersion, ...rest } = file;
  return rest;
}

function merge(input) {
  return mergeBaselineProblems(input);
}

/**
 * The same run as a **pre-flight candidate**: every comparability field, no cells.
 *
 * The file rules these tests are about (does this file already hold the component,
 * does it record the same regime) are answered from the command line before a device
 * is booted, against exactly this shape — `mergeCandidateRun()` has no cells because
 * nothing has been measured yet, and a run that has measured nothing cannot be
 * refused for measuring too little. A merge that asks them of a *measured* record is
 * also asked whether the record is the right shape, and that is tested against
 * fixtures built whole (`makeRun({ component })`) through the CLIs, not here.
 *
 * The waiting rule is copied over explicitly because the fixture carries it inside
 * its records: a real pre-flight gets it from `--timeout-*` or from the platform
 * default (`mergeCandidateRun()`), and dropping it here would have this stand-in
 * refuse for a reason the code under test does not raise.
 */
function candidate(run) {
  const { cells, ...rest } = run;
  return {
    ...rest,
    // The real pre-flight stand-in says so (review F2), and the guards read that
    // rather than inferring it from the record being empty, so the fixture has to.
    candidate: true,
    cells: {},
    timeouts: baselineTimeoutRecord({
      timeouts: run.timeouts ?? requestedTimeouts(run),
    }),
  };
}

/* ------------------------- why a merge is refused ------------------------- */

describe('a merge is refused before any device is touched', () => {
  const base = makeRun();
  const file = preX14Baseline(base);

  it('refuses when the file already has this component, and counts the cells', () => {
    const out = merge({
      run: candidate(base),
      baseline: file,
      exists: true,
      component: 'switch',
      resolved: recoveredVersions(base),
    });
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain('already has');
    expect(out.problems[0]).toMatch(/\d+ `switch` cell\(s\)/);
    // The fix is a full re-mint, and the message has to say so.
    expect(out.problems[0]).toContain('full re-mint');
  });

  it('refuses any other narrowing filter, naming each one', () => {
    for (const [name, value] of [
      ['scenario', 'mount'],
      ['n', 50],
      ['only', 'nitro-ui'],
    ]) {
      const out = merge({
        run: candidate(base),
        baseline: file,
        exists: true,
        component: 'slider',
        filters: { [name]: value },
        resolved: recoveredVersions(base),
      });
      expect([name, out.problems.join('\n')]).toEqual([
        name,
        expect.stringContaining(`--${name} ${String(value)}`),
      ]);
    }
  });

  it('refuses a schedule that does not cover the component whole', () => {
    const out = merge({
      run: candidate(base),
      baseline: file,
      exists: true,
      component: 'slider',
      scheduled: 40,
      componentPlan: 120,
      resolved: recoveredVersions(base),
    });
    expect(out.problems.join('\n')).toContain('40 of the 120 launches');
  });

  it('refuses when there is no file, and says a full run comes first', () => {
    const out = merge({
      run: candidate(base),
      baseline: null,
      exists: false,
      component: 'slider',
    });
    expect(out.problems.join('\n')).toContain('nothing to merge into');
    expect(out.problems.join('\n')).toContain('--plan full --launches 8');
  });

  it('says nothing about a run with no component, which is a full mint', () => {
    const out = merge({
      run: candidate(base),
      baseline: file,
      exists: true,
      component: null,
    });
    expect(out.problems).toEqual([]);
    expect(out.seeded).toBeNull();
  });
});

/* ---------------------------- comparability ------------------------------ */

describe('a merge checks the environment field by field', () => {
  /** iOS by default: the file and the run agree until a test breaks one field. */
  function pair(overrides = {}) {
    const run = makeRun(overrides.run ?? {});
    const baseline =
      overrides.baseline ?? preX14Baseline(run, { withTimeouts: true });
    return { run, baseline };
  }

  function problemsFor({ mutate, component = 'slider', ...rest }) {
    const { run, baseline } = pair(rest);
    const target = mutate == null ? baseline : mutate({ run, baseline });
    return merge({
      run: candidate(run),
      baseline: target,
      exists: true,
      component,
      resolved: recoveredVersions(run),
      ...rest.rest,
    });
  }

  it('accepts a current file that matches on every field it records', () => {
    // A v3 file: it records its versions, its waiting rule and its own provenance
    // block, so nothing has to be recovered or reasoned about and the merge is
    // silent about it.
    const run = makeRun();
    const out = merge({
      run: candidate(run),
      baseline: buildBaseline(run),
      exists: true,
      component: 'slider',
    });
    expect(out.problems).toEqual([]);
    expect(out.note).toBeNull();
    expect(out.seeded).toBeNull();
    expect(out.unverified).toEqual([]);
  });

  it('refuses a different platform, device key, CPU model or core count by name', () => {
    const cases = [
      [(ctx) => ({ ...ctx.baseline, platform: 'android' }), 'platform'],
      [
        (ctx) => ({ ...ctx.baseline, deviceKey: 'ios27-sim-testother' }),
        'ios27-sim-testother',
      ],
      [
        (ctx) => ({
          ...ctx.baseline,
          machine: { ...ctx.baseline.machine, cpuModel: 'Fixture M2 Ultra' },
        }),
        'Fixture M2 Ultra',
      ],
      [
        (ctx) => ({
          ...ctx.baseline,
          machine: { ...ctx.baseline.machine, cpuCount: 10 },
        }),
        '10',
      ],
    ];
    for (const [mutate, needle] of cases) {
      const out = problemsFor({ mutate });
      expect([needle, out.problems.join('\n')]).toEqual([
        needle,
        expect.stringContaining(needle),
      ]);
      // Both sides of the comparison, so the reader can tell which is which.
      expect(out.problems.join('\n')).toContain('this run measured');
    }
  });

  it('refuses a different simulator runtime or Xcode on iOS, and ignores both on Android', () => {
    for (const [mutate, needle] of [
      [
        (ctx) => ({
          ...ctx.baseline,
          machine: { ...ctx.baseline.machine, simRuntime: '18.3.1' },
        }),
        'simulator runtime',
      ],
      [
        (ctx) => ({
          ...ctx.baseline,
          machine: { ...ctx.baseline.machine, xcode: 'Xcode 26.2' },
        }),
        'Xcode',
      ],
    ]) {
      expect(problemsFor({ mutate }).problems.join('\n')).toContain(needle);
    }
    // Android has no iOS runtime, and iOS has no ART: `applies` keeps them out of
    // the check rather than refusing on a field that cannot exist.
    const android = makeRun({
      platform: 'android',
      deviceKey: 'android34-emu-pixel9',
      art: { status: 'speed-profile', primed: true },
    });
    const androidOut = merge({
      run: candidate(android),
      baseline: {
        ...preX14Baseline(android, { withTimeouts: true }),
        deviceKey: 'android34-emu-pixel9',
      },
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(android),
    });
    expect(androidOut.problems).toEqual([]);
  });

  it('refuses a different Android API level, system image or ART state', () => {
    const run = makeRun({
      platform: 'android',
      deviceKey: 'android34-emu-pixel9',
      art: { status: 'speed-profile', primed: true },
    });
    const baseline = preX14Baseline(run, { withTimeouts: true });
    for (const [mutate, needle] of [
      [
        (file) => ({
          ...file,
          machine: { ...file.machine, androidApi: '33' },
        }),
        'Android API level',
      ],
      [
        (file) => ({
          ...file,
          machine: { ...file.machine, androidImage: 'other/google_apis/34' },
        }),
        'Android system image',
      ],
      [
        (file) => ({ ...file, art: { status: 'verify', primed: false } }),
        'ART compile state',
      ],
    ]) {
      const out = merge({
        run,
        baseline: mutate(baseline),
        exists: true,
        component: 'slider',
        resolved: recoveredVersions(run),
      });
      expect([needle, out.problems.join('\n')]).toEqual([
        needle,
        expect.stringContaining(needle),
      ]);
    }
  });

  it('refuses a waiting rule the file was not recorded under', () => {
    const run = makeRun();
    const baseline = preX14Baseline(run, { withTimeouts: true });
    const out = merge({
      run: candidate(run),
      baseline: {
        ...baseline,
        timeouts: { mountTimeoutMs: 1500, presentedTimeoutMs: 2000 },
      },
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(run),
    });
    expect(out.problems.join('\n')).toContain('waiting rule differs');
    expect(out.problems.join('\n')).toContain('2000 ms');
  });

  it('refuses a different react-native or @expo/ui version, naming both', () => {
    const run = makeRun();
    const baseline = preX14Baseline(run, { withTimeouts: true });
    for (const [key, needle] of [
      ['reactNative', '0.81.1'],
      ['expoUi', '55.1.0'],
    ]) {
      const out = merge({
        run,
        baseline: {
          ...baseline,
          dependencies: {
            reactNative: key === 'reactNative' ? '0.81.1' : '0.80.0',
            expoUi: key === 'expoUi' ? '55.1.0' : '54.0.0',
            source: 'fixture',
          },
        },
        exists: true,
        component: 'slider',
        resolved: recoveredVersions(run),
      });
      expect(out.problems.join('\n')).toContain(needle);
      expect(out.problems.join('\n')).toContain('differs');
    }
  });
});

/* ---------------------- fields the file predates ------------------------- */

describe('a field the file predates is answered with evidence, or refused', () => {
  const run = makeRun();

  it('matches pre-X14 app versions against the founding commit, and records the source', () => {
    const out = merge({
      run: candidate(run),
      baseline: preX14Baseline(run),
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(run),
    });
    expect(out.problems).toEqual([]);
    const fields = out.unverified.map((entry) => entry.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'dependencies.reactNative',
        'dependencies.expoUi',
        'timeouts',
      ])
    );
    const dep = out.unverified.find(
      (entry) => entry.field === 'dependencies.expoUi'
    );
    expect(dep.reason).toContain('founding commit dead123');
  });

  it('refuses when the recovered versions contradict the run', () => {
    const out = merge({
      run: candidate(run),
      baseline: preX14Baseline(run),
      exists: true,
      component: 'slider',
      resolved: {
        'dependencies.reactNative': {
          value: '0.80.0',
          why: 'bun.lock at the baseline founding commit',
        },
        'dependencies.expoUi': {
          value: '53.9.9',
          why: 'bun.lock at the baseline founding commit',
        },
      },
    });
    expect(out.problems.join('\n')).toContain('@expo/ui');
    expect(out.problems.join('\n')).toContain('53.9.9');
    expect(out.problems.join('\n')).toContain('54.0.0');
  });

  it('refuses when a version cannot be recovered at all', () => {
    const out = merge({
      run: candidate(run),
      baseline: preX14Baseline(run),
      exists: true,
      component: 'slider',
      resolved: {},
    });
    const text = out.problems.join('\n');
    expect(text).toContain('react-native version is not recorded');
    expect(text).toContain('@expo/ui');
    // The refusal tells the reader how to get an answer, not just that there is none.
    expect(text).toContain('full re-mint');
  });

  it('accepts the platform default waiting rule for a file that records none', () => {
    const out = merge({
      run: candidate(run),
      baseline: preX14Baseline(run),
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(run),
    });
    expect(out.problems).toEqual([]);
    const wait = out.unverified.find((entry) => entry.field === 'timeouts');
    expect(wait.reason).toContain('default rule');
  });

  it('refuses a pre-X14 file when the run waited under a non-default rule', () => {
    // The only way a merge can tell an A4-era iOS raise from a diagnostic run is
    // the rule the launches reported, so anything other than the default has to be
    // a refusal rather than an assumption about which rule the file means.
    const diagnostic = makeRun({
      overrides: {
        timeouts: { mountTimeoutMs: 1500, presentedTimeoutMs: 30000 },
      },
    });
    const out = merge({
      run: candidate(diagnostic),
      baseline: preX14Baseline(makeRun()),
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(diagnostic),
    });
    expect(out.problems.join('\n')).toContain('waiting rule');
  });

  it('refuses an unrecorded runtime, image or ART state rather than assuming one', () => {
    const runAndroid = makeRun({
      platform: 'android',
      deviceKey: 'android34-emu-pixel9',
      art: { status: 'speed-profile', primed: true },
    });
    const bare = preX14Baseline(runAndroid, { withTimeouts: true });
    const stripped = { ...bare };
    delete stripped.machine.androidImage;
    delete stripped.machine.androidApi;
    delete stripped.art;
    const out = merge({
      run: candidate(runAndroid),
      baseline: stripped,
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(runAndroid),
    });
    const text = out.problems.join('\n');
    for (const needle of [
      'Android API level',
      'Android system image',
      'ART compile state',
    ]) {
      expect(text).toContain(needle);
    }
  });
});

/* ------------------------------ schema ---------------------------------- */

describe('the baseline schema version is a regime, with one exception', () => {
  const run = makeRun();

  it('upgrades a readable v2 file and says so, rather than refusing every merge', () => {
    const out = merge({
      run: candidate(run),
      baseline: preX14Baseline(run, { withTimeouts: true }),
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(run),
    });
    expect(out.problems).toEqual([]);
    const upgrade = out.unverified.find(
      (entry) => entry.field === 'schemaVersion'
    );
    expect(upgrade.reason).toContain('v2');
    expect(upgrade.reason).toContain(`v${String(BASELINE_SCHEMA_VERSION)}`);
  });

  it('refuses a version it cannot read at all', () => {
    for (const version of [1, 4]) {
      const out = merge({
        run,
        baseline: {
          ...preX14Baseline(run, { withTimeouts: true }),
          schemaVersion: version,
        },
        exists: true,
        component: 'slider',
        resolved: recoveredVersions(run),
      });
      expect([version, out.problems.join('\n')]).toEqual([
        version,
        expect.stringContaining('baseline schema version differs'),
      ]);
    }
  });

  it('still accepts the four committed v2 files, and rejects pre-D9 v1', () => {
    expect(isCompatibleBaseline(preX14Baseline(run))).toBe(true);
    expect(isCompatibleBaseline({ schemaVersion: 1, cells: {} })).toBe(false);
  });
});

/* --------------------------- deferred fields ----------------------------- */

describe('a pre-flight defers what it cannot measure, and never passes it', () => {
  const run = makeRun({
    platform: 'android',
    deviceKey: 'android34-emu-pixel9',
    art: { status: 'speed-profile', primed: true },
  });
  const file = preX14Baseline(run, { withTimeouts: true });

  /** The candidate: no ART state and no system-image fingerprint yet. */
  const preFlight = {
    ...candidate(run),
    art: null,
    machine: { ...run.machine, androidImage: null },
  };

  it('reports the unknown halves as deferred when allowed', () => {
    const out = merge({
      run: preFlight,
      baseline: file,
      exists: true,
      component: 'slider',
      allowDeferred: true,
      resolved: recoveredVersions(run),
    });
    expect(out.problems).toEqual([]);
    expect(out.deferred.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(['art.status', 'machine.androidImage'])
    );
    expect(out.deferred[0].reason).toContain('after it');
  });

  it('refuses the same candidate when the answers are due', () => {
    const out = merge({
      run: preFlight,
      baseline: file,
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(run),
    });
    const text = out.problems.join('\n');
    expect(text).toContain('ART compile state differs');
    expect(text).toContain('Android system image differs');
    expect(out.deferred).toEqual([]);
  });
});

/* --------------------------- run-level guards ---------------------------- */

describe('the per-run guards a merge keeps', () => {
  it('refuses a quick plan, a thin launch count, perf marks and a dirty tree', () => {
    expect(
      mergeRunProblems({ plan: 'quick', launches: 8 }).join('\n')
    ).toContain('quick-plan numbers are local feedback');
    expect(
      mergeRunProblems({ plan: 'full', launches: 4 }).join('\n')
    ).toContain('at least 8');
    expect(
      mergeRunProblems({ plan: 'full', launches: 8, perfMarks: true }).join(
        '\n'
      )
    ).toContain('perf marks');
    expect(
      mergeRunProblems({ plan: 'full', launches: 8, dirty: true }).join('\n')
    ).toContain('working tree is dirty');
    expect(mergeRunProblems({ plan: 'full', launches: 8 })).toEqual([]);
  });

  it('is the same defect the post-run guard refuses, in a different tense', () => {
    // The pre-flight and `baselineBlockers()` are two call sites of one rule; if
    // they drift, one of them starts refusing a different set of runs.
    const run = makeRun({ overrides: { plan: 'quick', launches: 4 } });
    const before = mergeRunProblems({ plan: 'quick', launches: 4 });
    const after = baselineBlockers(run).join('\n');
    for (const phrase of ['plan "quick"', 'launches per cell']) {
      expect(after).toContain(phrase);
    }
    expect(before).toHaveLength(2);
  });
});

/* ------------------------------ provenance ------------------------------- */

describe('provenance for a file that predates it', () => {
  const run = makeRun();
  const file = preX14Baseline(run);

  it('describes what the file is missing, as a note rather than a refusal', () => {
    const note = missingBaselineProvenanceProblem({ baseline: file });
    expect(note).toContain('predates per-component provenance');
    expect(note).toContain('`dependencies`');
    expect(note).toContain('`timeouts`');
    expect(
      missingBaselineProvenanceProblem({
        baseline: buildBaseline(makeRun()),
      })
    ).toBeNull();
  });

  it('seeds every existing component from the founding run, and marks it', () => {
    const multi = makeRun({ scenarios: ['mount', 'mount.slider'] });
    const seeded = seededComponentProvenance(
      preX14Baseline(multi),
      recoveredVersions(multi) && {
        reactNative: multi.dependencies.reactNative,
        expoUi: multi.dependencies.expoUi,
        source: "bun.lock at the baseline's founding commit dead123",
      }
    );
    expect(Object.keys(seeded)).toEqual(['slider', 'switch']);
    for (const entry of Object.values(seeded)) {
      expect(entry.seededFromFoundingRun).toBe(true);
      expect(entry.sha).toBe('dead123');
      expect(entry.mintedAt).toBe(multi.createdAt);
      expect(entry.launches).toBe(LAUNCHES);
      expect(entry.dependencies.reactNative).toBe('0.80.0');
      expect(entry.dependencies.source).toContain('bun.lock');
    }
    // A seeded entry never claims a cell it does not cover.
    expect(seeded.slider.cellKeys).toEqual(
      Object.keys(
        cellsForComponent(buildBaseline(multi).cells, 'slider')
      ).sort()
    );
  });

  it('seeds nothing for a current file, so its own block is kept', () => {
    const out = merge({
      run: candidate(run),
      baseline: buildBaseline(run),
      exists: true,
      component: 'slider',
      resolved: recoveredVersions(run),
    });
    expect(out.note).toBeNull();
    expect(out.seeded).toBeNull();
  });
});

/* ------------------------------- the merge ------------------------------- */

describe('the merge itself only touches its own component', () => {
  const existing = makeRun({ scenarios: ['mount', 'mount.slider'] });
  const before = buildBaseline(existing);
  const sliderRun = makeRun({ scenarios: ['mount.button'] });
  const built = buildBaseline(sliderRun);

  const result = () =>
    mergeComponentBaseline({
      baseline: before,
      run: sliderRun,
      component: 'button',
      built,
      componentsBase: seededComponentProvenance(before, null),
      dependencies: {
        reactNative: '0.80.0',
        expoUi: '54.0.0',
        source: 'fixture',
      },
      comparabilityNotes: [],
    });

  it('leaves every other cell byte-for-byte identical', () => {
    const { baseline } = result();
    for (const [key, cell] of Object.entries(before.cells)) {
      expect([key, JSON.stringify(baseline.cells[key])]).toEqual([
        key,
        JSON.stringify(cell),
      ]);
    }
    expect(componentsInBaseline(baseline)).toEqual([
      'button',
      'slider',
      'switch',
    ]);
  });

  it('keeps the founding run fields that describe the founding run', () => {
    const { baseline } = result();
    for (const field of [
      'sha',
      'updatedAt',
      'machine',
      'art',
      'deviceName',
      'platform',
      'deviceKey',
    ]) {
      expect([field, JSON.stringify(baseline[field])]).toEqual([
        field,
        JSON.stringify(before[field]),
      ]);
    }
    // The whole point of the split: the top-level `sha` still means the founding
    // run, and the new component's own entry carries the merge run's.
    expect(baseline.components.button.sha).toBe(sliderRun.sha);
    expect(baseline.sha).toBe(before.sha);
  });

  /**
   * `skippedCells` is the one block a merge has to reason about per row rather than
   * carry wholesale: it holds the comparison-arm cells that were measured but came
   * out incomplete, and a row for the component being re-measured must go with its
   * cells (the new run either filled it or did not) while every other row is a
   * finding about a different component and survives verbatim. The committed
   * Android file this task merged into happens to have none, so nothing but a
   * fixture can say what happens to one — and the README promises rows are carried
   * through, which is a claim about this function.
   */
  it("carries the other components' skippedCells rows and drops only its own", () => {
    const withSkips = {
      ...before,
      skippedCells: {
        'mount:rn-core:50': {
          scenario: 'mount',
          implementation: 'rn-core',
          n: 50,
          skipReason: 'presented incomplete',
          skipReasons: ['presented: 160 of 161 samples arrived'],
        },
        'mount.slider:nitro-ui:1': {
          scenario: 'mount.slider',
          implementation: 'nitro-ui',
          n: 1,
          skipReason: 'presented incomplete',
          skipReasons: ['presented: 0 of 160 samples arrived'],
        },
        'mount.button:rn-core:50': {
          scenario: 'mount.button',
          implementation: 'rn-core',
          n: 50,
          skipReason: 'presented incomplete',
          skipReasons: ['presented: 12 of 160 samples arrived'],
        },
      },
    };
    const merged = mergeComponentBaseline({
      baseline: withSkips,
      run: sliderRun,
      component: 'button',
      built,
      componentsBase: seededComponentProvenance(withSkips, null),
      dependencies: {
        reactNative: '0.80.0',
        expoUi: '54.0.0',
        source: 'fixture',
      },
      comparabilityNotes: [],
    }).baseline;
    // The other components' rows, byte for byte.
    for (const key of ['mount:rn-core:50', 'mount.slider:nitro-ui:1']) {
      expect([key, JSON.stringify(merged.skippedCells[key])]).toEqual([
        key,
        JSON.stringify(withSkips.skippedCells[key]),
      ]);
    }
    // The merged component's own row is gone, replaced by whatever this run says.
    expect(merged.skippedCells['mount.button:rn-core:50']).toBeUndefined();
    expect(Object.keys(merged.skippedCells).sort()).toEqual([
      'mount.slider:nitro-ui:1',
      'mount:rn-core:50',
    ]);
  });

  it('appends new cell keys instead of re-sorting the table', () => {
    const { baseline } = result();
    const keys = Object.keys(baseline.cells);
    expect(keys.slice(0, Object.keys(before.cells).length)).toEqual(
      Object.keys(before.cells)
    );
    expect(keys.slice(Object.keys(before.cells).length)).toEqual(
      Object.keys(built.cells)
    );
  });

  /**
   * The write-side filter, on its own.
   *
   * `mergeBaselineProblems()` refuses a run that measured more than the named
   * component, so no CLI path can hand this function a whole run's table any more —
   * which is exactly why the filter is also applied where the cells are copied. The
   * function is exported, and the cost of trusting its caller is another component's
   * measured numbers being replaced by the merged component's, so the guard lives in
   * the copy as well and this test is what keeps it there.
   */
  it('copies only the named component out of a `built` that holds a whole run', () => {
    const wholeRun = makeRun({
      components: ['button', 'slider'],
      nitroUi: 200_000,
    });
    const built = buildBaseline(wholeRun);
    // A comparison-arm row the run measured but skipped, for the *other* component.
    // `skippedCells` is the block a merge has to reason about row by row, and a
    // healthy fixture run has none of its own, so without this the skipped-side
    // filter has nothing to filter and dropping it would go unnoticed.
    const foreignSkip = 'mount.slider:expo-ui-shared-host:50';
    built.skippedCells[foreignSkip] = {
      scenario: 'mount.slider',
      implementation: 'expo-ui-shared-host',
      n: 50,
      skipReason: 'presentedNs incomplete',
      skipReasons: ['presentedNs: 12 of 160 samples arrived'],
    };
    const merged = mergeComponentBaseline({
      baseline: before,
      run: wholeRun,
      component: 'button',
      built,
      componentsBase: seededComponentProvenance(before, null),
      dependencies: null,
      comparabilityNotes: [],
    });
    // The file's own cells (switch, slider) are as they were, even though `built`
    // held slider's numbers at a different cost.
    for (const [key, cell] of Object.entries(before.cells)) {
      expect([key, JSON.stringify(merged.baseline.cells[key])]).toEqual([
        key,
        JSON.stringify(cell),
      ]);
    }
    // And the skipped table gained nothing: `button` has no skipped rows, so the
    // other component's must not have been copied in either.
    expect(Object.keys(merged.baseline.skippedCells).sort()).toEqual(
      Object.keys(before.skippedCells).sort()
    );
    expect(merged.baseline.skippedCells[foreignSkip]).toBeUndefined();
    // And the entry describes 28 button cells, not 56 of two components.
    expect(merged.addedCells).toBe(
      Object.keys(cellsForComponent(buildBaseline(wholeRun).cells, 'button'))
        .length
    );
    expect(
      merged.provenance.cellKeys.every((key) => key.includes('.button'))
    ).toBe(true);
    expect(
      merged.changedCells.some((entry) => !entry.includes('.button'))
    ).toBe(false);
  });

  /**
   * `componentProvenance()` is also what a full mint writes, and a mint is allowed on
   * a plan the merge is not, so this asks the writer directly rather than through a
   * merge that would refuse the run first: the entry must carry the plan and the
   * launch count of the run it describes. A row that said `full` because the code
   * wanted `full` would tell a reader a row is gateable when it was measured on the
   * quick plan, and nothing else in the file would disagree with it.
   */
  it('records the run’s plan and launch count, not the ones a baseline is minted under', () => {
    const thin = makeRun({ overrides: { plan: 'quick', launches: 4 } });
    const entry = componentProvenance(thin, 'slider', [
      'mount.slider:nitro-ui:50',
      'update.slider:nitro-ui:50',
    ]);
    expect([entry.plan, entry.launches]).toEqual(['quick', 4]);
    expect(entry.component).toBe('slider');
    expect(entry.cellKeys).toEqual([
      'mount.slider:nitro-ui:50',
      'update.slider:nitro-ui:50',
    ]);
  });

  /**
   * The completeness question, on its own.
   *
   * `mergeBaselineProblems()` also refuses the plan mismatch outright, which is what a
   * human sees, so a CLI case cannot tell "expected came from the file's plan" from
   * "expected came from the run's" — both refuse. This asks the function directly: the
   * number of rows a component's block needs is a property of **the file** it is
   * joining, because that is the table `--check` gates. A quick-plan run of `menu`
   * holds 12 of the 28 rows the committed files measure per component, and the message
   * has to say 12 of 28: "12 of 12" is what made the partial block look mergeable in
   * the first place.
   */
  it('counts a component block complete against the file’s plan, not the run’s', () => {
    const quick = makeRun({ plan: 'quick', component: 'menu' });
    // Whole for its own plan, which is exactly the trap.
    expect(missingComponentCells({ run: quick, component: 'menu' })).toBeNull();
    const message = missingComponentCells({
      run: quick,
      component: 'menu',
      plan: 'full',
    });
    expect(message).toContain('measured 12 of the 28 cells');
  });

  /**
   * The two empty records, told apart (review F2).
   *
   * A pre-flight candidate and a run whose every launch failed are the same shape —
   * every comparability field, no cells — and the merge has to answer them
   * differently: the first is asking whether it *may* measure, the second has
   * measured nothing and has nothing to write. One flag distinguishes them
   * (`candidate: true`, set where the record is built), so this asserts both halves:
   * without it a startup check would refuse itself, with it a dead run would merge a
   * provenance entry and no numbers.
   */
  it('refuses a measured record with no cells, and defers the pre-flight that has none', () => {
    const run = makeRun({ component: 'menu' });
    expect(
      missingComponentCells({ run: candidate(run), component: 'menu' })
    ).toBeNull();
    expect(
      missingComponentCells({
        run: { ...candidate(run), candidate: false },
        component: 'menu',
      })
    ).toContain('records no cells at all');
  });

  /**
   * Which component a row belongs to, on its own (review F3).
   *
   * The key, always. `cellsForComponent` is what decides whose rows a merge deletes
   * and rewrites, so reading the record's own `scenario` field here is the difference
   * between refusing a hand-edited file and silently replacing `switch`'s measured
   * numbers with something filed under a `menu` claim.
   */
  it('assigns a cell to the component its key names, never its scenario field', () => {
    const forged = {
      'mount:nitro-ui:50': {
        scenario: 'mount.menu',
        implementation: 'nitro-ui',
        n: 50,
      },
      'mount.menu:nitro-ui:50': {
        scenario: 'mount.menu',
        implementation: 'nitro-ui',
        n: 50,
      },
    };
    expect(Object.keys(cellsForComponent(forged, 'menu'))).toEqual([
      'mount.menu:nitro-ui:50',
    ]);
    // Which leaves the lie visible rather than harmless: the key's owner is a switch
    // row, and that is the row a merge would have destroyed.
    expect(cellsContradictingTheirKey(forged)).toEqual([
      {
        key: 'mount:nitro-ui:50',
        keyScenario: 'mount',
        claimed: 'mount.menu',
      },
    ]);
    expect(
      cellsContradictingTheirKey({
        'mount:nitro-ui:50': { scenario: 'mount' },
        'mount.menu:nitro-ui:50': { scenario: 'mount.menu' },
      })
    ).toEqual([]);
  });

  /**
   * Every field of a merged entry's provenance, asserted.
   *
   * The README's "Adding one component" section promises a reader can answer "when
   * were these cells measured, on what, under how many launches, and how loaded was
   * the machine" from the file alone, and each of those is one field of this object.
   * A test that asserted only `sha` let `launches: null` be dropped from the writer
   * unnoticed (review M1), so the assertions are per-field and the fixture's load
   * summary is non-null — a null fixture could not tell a dropped field from a run
   * that recorded no sampler.
   */
  it('writes a provenance entry that says who measured what, when and how quietly', () => {
    const { baseline, provenance } = result();
    const entry = baseline.components.button;
    expect(entry).toEqual(provenance);
    expect(entry.component).toBe('button');
    // The merge run's sha and timestamp, not the founding run's.
    expect(entry.sha).toBe(sliderRun.sha);
    expect(entry.mintedAt).toBe(sliderRun.createdAt);
    expect(entry.launches).toBe(LAUNCHES);
    expect(entry.plan).toBe('full');
    // What the launches actually waited for, in the file's own shape.
    expect(entry.timeouts).toEqual(
      baselineTimeoutRecord({ timeouts: requestedTimeouts(sliderRun) })
    );
    expect(entry.timeouts.presentedTimeoutMs).toBe(
      WAIT_BY_PLATFORM.ios.presentedTimeoutMs
    );
    // The load summary is the *per-component* sampler of the run, copied out of the
    // machine record; the committed files carry real numbers here and a reader judges
    // a component's cells partly by them.
    expect(entry.loadSamples).toEqual(LOAD_SAMPLES);
    expect(entry.loadSamples.count).toBeGreaterThan(0);
    expect(entry.dependencies).toEqual({
      reactNative: '0.80.0',
      expoUi: '54.0.0',
      source: 'fixture',
    });
    // The entry claims exactly the cells it was built from, so a reader can check it
    // against the table instead of trusting the count.
    expect(entry.cellKeys).toEqual(Object.keys(built.cells).sort());
    expect(entry.comparabilityNotes).toEqual([]);
    expect(entry.seededFromFoundingRun ?? false).toBe(false);
  });

  it('keeps the components block the file already had', () => {
    const current = buildBaseline(existing);
    const second = mergeComponentBaseline({
      baseline: current,
      run: sliderRun,
      component: 'button',
      built,
      componentsBase: null,
      dependencies: null,
      comparabilityNotes: [],
    });
    // The file's own entries keep their place, and the merged one is appended:
    // the diff shows one added key rather than a rewritten block.
    expect(Object.keys(second.baseline.components)).toEqual([
      'slider',
      'switch',
      'button',
    ]);
    expect(second.baseline.components.slider).toEqual(
      current.components.slider
    );
  });

  it('records what it could not check, on the entry that could not check it', () => {
    const notes = [{ field: 'timeouts', reason: 'the platform default rule' }];
    const merged = mergeComponentBaseline({
      baseline: before,
      run: sliderRun,
      component: 'button',
      built,
      componentsBase: seededComponentProvenance(before, null),
      dependencies: null,
      comparabilityNotes: notes,
    });
    expect(merged.baseline.components.button.comparabilityNotes).toEqual(notes);
    expect(
      merged.baseline.components.slider.comparabilityNotes ?? null
    ).toBeNull();
  });

  it('reports the cells it changed', () => {
    const { changedCells, addedCells, removedCells } = result();
    expect(removedCells).toBe(0);
    expect(addedCells).toBe(Object.keys(built.cells).length);
    expect(changedCells.every((entry) => entry.startsWith('+'))).toBe(true);
  });

  it('replaces a component of the same name rather than duplicating it', () => {
    // Not reachable through the CLI, which refuses an existing component, but the
    // function has to be honest about what it does if it is ever called that way.
    const replaced = mergeComponentBaseline({
      baseline: before,
      run: makeRun({ scenarios: ['mount.slider'], nitroUi: 120_000 }),
      component: 'slider',
      built: buildBaseline(makeRun({ scenarios: ['mount.slider'] })),
      componentsBase: null,
      dependencies: null,
      comparabilityNotes: [],
    });
    expect(replaced.removedCells).toBeGreaterThan(0);
    expect(replaced.changedCells.some((entry) => entry.startsWith('-'))).toBe(
      true
    );
    expect(componentsInBaseline(replaced.baseline)).toEqual([
      'slider',
      'switch',
    ]);
  });

  it('is the only writer of the new schema version', () => {
    expect(buildBaseline(makeRun()).schemaVersion).toBe(
      BASELINE_SCHEMA_VERSION
    );
    expect(result().baseline.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
  });

  it('does not disturb the founding fields a stripped copy holds', () => {
    // Guards the shape of the merge: if a field other than `components`,
    // `dependencies` and `schemaVersion` were rewritten, the diff would be the
    // whole file and the review would be unable to see what was measured.
    const { baseline } = result();
    expect(Object.keys(strippedOfMerge(baseline)).sort()).toEqual(
      Object.keys(strippedOfMerge(before)).sort()
    );
  });
});

/* ------------------------------ opening it ------------------------------- */

describe('opening a file for a merge', () => {
  const run = makeRun();

  function open({ files, component = 'slider', label = MINE, resolved = {} }) {
    return openBaselineForMerge({
      baselinesDir: 'bench/baselines',
      // A pre-flight candidate: what `run.mjs` hands the opener before the device
      // has measured anything. These cases are about the file (its path, its
      // schema, whose machine it names, what has to be seeded into it); the shape
      // of a *measured* record is the merge's business and is tested below.
      run: { ...candidate(run), machine: { ...run.machine, hostname: label } },
      component,
      isCompatibleBaseline,
      schemaVersion: BASELINE_SCHEMA_VERSION,
      readJson: (file) => JSON.parse(files[file]),
      existsSync: (file) => Object.hasOwn(files, file),
      display: (file) => file,
      resolved,
      mergeProblems: (input) =>
        mergeBaselineProblems({
          ...input,
          resolved: recoveredVersions(run),
        }),
    });
  }

  const at = (label, file) => ({
    [`bench/baselines/${label}/${DEVICE_KEY}.json`]: JSON.stringify(file),
  });

  it('refuses an unlabelled machine before touching the path', () => {
    const out = open({ files: {}, label: 'unlabelled' });
    expect(out.refusal.kind).toBe('unlabelled');
    expect(out.refusal.message).toContain('NITRO_UI_MACHINE_LABEL');
  });

  it('refuses a missing file, and names the full run that creates one', () => {
    const out = open({ files: {} });
    expect(out.refusal.kind).toBe('missing');
    expect(out.refusal.message).toContain('nothing to merge into');
    expect(out.refusal.message).toContain('bench/baselines/maintainer-mac-1');
  });

  it('refuses a pre-D9 file before the merge rules run', () => {
    const out = open({
      files: at(MINE, {
        schemaVersion: 1,
        machine: { hostname: MINE },
        cells: {},
      }),
    });
    expect(out.refusal.kind).toBe('incompatible');
    expect(out.refusal.message).toContain(
      'is not a baseline this version reads'
    );
    // Both halves of the comparison: what was found, and what would have been
    // accepted. A refusal that names only one of them leaves the reader to guess
    // which side is wrong.
    expect(out.refusal.message).toContain('found v1');
    expect(out.refusal.message).toContain('it reads v2 and v3');
    expect(out.refusal.message).toContain(
      `writes v${String(BASELINE_SCHEMA_VERSION)}`
    );
  });

  it('refuses a file copied in from another machine', () => {
    const out = open({
      files: at(MINE, {
        ...buildBaseline(run),
        machine: { ...run.machine, hostname: 'maintainer-mac-9' },
      }),
    });
    expect(out.refusal.kind).toBe('foreign-machine');
    expect(out.refusal.message).toContain('maintainer-mac-9');
  });

  it('hands back the file, its verdict and the provenance to seed', () => {
    const out = open({
      files: at(MINE, preX14Baseline(run)),
      resolved: recoveredVersions(run),
    });
    expect(out.refusal).toBeNull();
    expect(out.problems).toEqual([]);
    expect(out.note).toContain('predates per-component provenance');
    expect(Object.keys(out.seeded)).toEqual(['switch']);
    expect(out.foundingDependencies.expoUi).toBe('54.0.0');
    expect(out.foundingDependencies.source).toContain('founding commit');
  });
});

/* ------------------------------ the CLIs ---------------------------------- */

/** Both CLIs are driven over a throwaway tree, so they both need this repo's `scripts/`. */
function copyScripts(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === '__tests__') {
      continue;
    }
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyScripts(src, dest);
    } else {
      copyFileSync(src, dest);
    }
  }
}

/**
 * `run.mjs`, driven over a throwaway tree, for the one thing only it can prove:
 * that a merge is refused **before** a device is booted, and that `--force` does
 * not talk it out of that.
 *
 * The tree is built so the runner never reaches a device: `ANDROID_HOME` names a
 * directory with no `platform-tools/adb` in it (so the read-only `adb devices`
 * the pre-flight does is a no-op rather than a real call), and the AVD's own
 * `config.ini` is what hands the pre-flight its API level and hardware profile.
 * The run therefore dies in `resolveAndroidDevice()` — which is the proof that
 * the pre-flight let it through, in the case where it should.
 *
 * Two host facts do leak in here, on purpose: the CPU model and core count, which
 * the candidate reports from `os.cpus()` and the fixture reads from the same
 * place. Nothing about another machine is asserted.
 */
describe('run.mjs refuses an incomparable merge before booting', () => {
  const ANDROID_KEY = 'android35-emu-pixel9';

  function tree() {
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'bench-run-'));
    copyScripts(
      path.join(process.cwd(), 'scripts'),
      path.join(root, 'scripts')
    );
    const bin = path.join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'bunx'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(bin, 'bunx'), 0o755);

    // An AVD that exists on disk and is nowhere attached: enough for the
    // pre-flight's device key, not enough for the run itself.
    const avdHome = path.join(root, 'avd');
    mkdirSync(path.join(avdHome, 'nitroui_x.avd'), { recursive: true });
    writeFileSync(
      path.join(avdHome, 'nitroui_x.avd', 'config.ini'),
      [
        'target=android-35',
        'image.sysdir.1=system-images/android-35/google_apis/arm64-v8a/',
        'hw.device.name=pixel_9',
      ].join('\n')
    );
    // An adb that reports nothing attached, so the run answers the device
    // question honestly rather than crashing on a missing binary.
    mkdirSync(path.join(root, 'no-sdk', 'platform-tools'), { recursive: true });
    writeFileSync(
      path.join(root, 'no-sdk', 'platform-tools', 'adb'),
      '#!/bin/sh\necho "List of devices attached"\necho ""\n'
    );
    chmodSync(path.join(root, 'no-sdk', 'platform-tools', 'adb'), 0o755);

    // `bun.lock` for the candidate's version evidence.
    writeFileSync(
      path.join(root, 'bun.lock'),
      `${JSON.stringify(
        {
          workspaces: { '': ['bench'] },
          packages: {
            'react-native': ['react-native@0.88.0', {}],
            '@expo/ui': ['@expo/ui@58.0.22', {}],
          },
        },
        null,
        2
      )}\n`
    );
    mkdirSync(path.join(root, 'bench'), { recursive: true });
    writeFileSync(
      path.join(root, 'bench', 'package.json'),
      `${JSON.stringify(
        { dependencies: { 'react-native': '0.88.0', '@expo/ui': '58.0.22' } },
        null,
        2
      )}\n`
    );
    return { root, bin, avdHome };
  }

  function runCli({ root, bin, avdHome }, args, env = {}) {
    const child = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'bench', 'run.mjs'), ...args],
      {
        encoding: 'utf8',
        cwd: root,
        timeout: 120_000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          NITRO_UI_MACHINE_LABEL: MINE,
          // An SDK whose only adb reports zero attached devices: the pre-flight's
          // read-only `adb devices` answers honestly, and a run that gets past it
          // dies on "no attached emulator" instead of booting or touching a real
          // server that can see someone else's device.
          ANDROID_HOME: path.join(root, 'no-sdk'),
          ANDROID_AVD_HOME: avdHome,
          ANDROID_AVD: 'nitroui_x',
          ANDROID_SERIAL: 'emulator-5599',
          IOS_SIM_UDID: '',
          AVD: '',
          ...env,
        },
      }
    );
    return {
      status: child.status,
      all: `${child.stdout ?? ''}${child.stderr ?? ''}`,
    };
  }

  /** A current v3 baseline for the Android device this fake AVD names. */
  function writeAndroidBaseline({ root }, { androidApi = '35' } = {}) {
    const founding = makeRun({
      platform: 'android',
      deviceKey: ANDROID_KEY,
      scenarios: ['mount'],
      dependencies: {
        reactNative: '0.88.0',
        expoUi: '58.0.22',
        source: 'fixture',
      },
      machine: {
        ...fixtureMachine('android', { hostname: MINE }),
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? null,
        androidApi,
      },
      art: { status: 'speed-profile', primed: true },
    });
    const file = path.join(
      root,
      'bench',
      'baselines',
      MINE,
      `${ANDROID_KEY}.json`
    );
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify(buildBaseline(founding), null, 2)}\n`
    );
    return file;
  }

  it('refuses a thin launch count, and lets --force past it to the device', () => {
    const ws = tree();
    try {
      writeAndroidBaseline(ws);
      const thin = runCli(ws, [
        '--platform',
        'android',
        '--plan',
        'full',
        '--launches',
        '4',
        '--update-baseline',
        '--component',
        'slider',
      ]);
      expect(thin.status).toBe(2);
      expect(thin.all).toContain('launches per cell');

      // Under --force the same run is no longer refused for its own measurement,
      // and gets as far as the emulator that was never attached: proof the
      // overridable half really is overridable, and proof nothing booted here.
      const forced = runCli(ws, [
        '--platform',
        'android',
        '--plan',
        'full',
        '--launches',
        '4',
        '--update-baseline',
        '--component',
        'slider',
        '--force',
      ]);
      expect(forced.all).not.toContain('launches per cell');
      expect(forced.all).toContain('No attached emulator');
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  });

  /**
   * The refusal a contributor actually sees when they forget their lease (L1).
   *
   * A merge's file is named from the device key, so an unresolved device has no path
   * to report. Before this, the merge said "no baseline at
   * `bench/baselines/maintainer-mac-1/null.json` — the first mint for a machine is a
   * full run", which points at an eleven-hour re-mint for what is one unset variable.
   */
  it('names the missing device rather than a null.json path when IOS_SIM_UDID is unset', () => {
    const ws = tree();
    try {
      const out = runCli(
        ws,
        [
          '--platform',
          'ios',
          '--plan',
          'full',
          '--launches',
          '8',
          '--update-baseline',
          '--component',
          'menu',
          // Absolute refusals survive --force, and asking with it proves this one is
          // not a measurement judgement someone could wave through.
          '--force',
        ],
        { IOS_SIM_UDID: '' }
      );
      expect(out.status).toBe(2);
      expect(out.all).toContain('IOS_SIM_UDID is not set');
      expect(out.all).toContain('could not be resolved');
      expect(out.all).not.toContain('null.json');
      expect(out.all).not.toContain('nothing to merge into');
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  });

  it('refuses an API level that differs even under --force, before the device', () => {
    const ws = tree();
    try {
      writeAndroidBaseline(ws, { androidApi: '34' });
      const forced = runCli(ws, [
        '--platform',
        'android',
        '--plan',
        'full',
        '--launches',
        '8',
        '--update-baseline',
        '--component',
        'slider',
        '--force',
      ]);
      expect(forced.status).toBe(2);
      expect(forced.all).toContain('Android API level differs');
      expect(forced.all).toContain('34');
      // The point of asking at startup: the device is never reached, so a
      // mistyped command costs no boot and no measurement.
      expect(forced.all).not.toContain('No attached emulator');
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  });
});

describe('report.mjs merges one component', () => {
  function workspace() {
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'bench-merge-'));
    copyScripts(
      path.join(process.cwd(), 'scripts'),
      path.join(root, 'scripts')
    );
    const bin = path.join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    const stub = path.join(bin, 'bunx');
    writeFileSync(stub, '#!/bin/sh\nexit 0\n');
    chmodSync(stub, 0o755);
    return { root, bin };
  }

  function cli({ root, bin }, args, env = {}) {
    // stdout and stderr go to a **file**, not a pipe. `report.mjs` ends in
    // `process.exit()`, which discards pending async writes, and a pipe caps at
    // 64 KiB: a whole-plan report is bigger than that, so a piped capture would
    // cut off the very `--check` verdict table these tests read. A redirected
    // file is written synchronously and arrives whole.
    const outFile = path.join(
      root,
      `cli-${Math.random().toString(36).slice(2)}.log`
    );
    const fd = openSync(outFile, 'w');
    const child = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'bench', 'report.mjs'), ...args],
      {
        cwd: root,
        timeout: 120_000,
        stdio: ['ignore', fd, fd],
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          NITRO_UI_MACHINE_LABEL: MINE,
          IOS_SIM_UDID: '',
          ANDROID_SERIAL: '',
          ANDROID_AVD: '',
          AVD: '',
          ...env,
        },
      }
    );
    closeSync(fd);
    const all = readFileSync(outFile, 'utf8');
    rmSync(outFile, { force: true });
    return {
      status: child.status,
      all,
    };
  }

  function write(root, rel, value) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  }

  const baselineRel = `bench/baselines/${MINE}/${DEVICE_KEY}.json`;

  function withTree(body) {
    const ws = workspace();
    try {
      return body(ws);
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  }

  /**
   * A file holding switch + slider (v3: it records its own versions) and a results
   * file measuring button.
   *
   * Both sides are built *whole*: the file's founding run measures switch and slider
   * as the plan measures them, and the results file measures button whole. A merge is
   * a transaction over a component's whole block now, so a fixture made of two cells
   * of one scenario is not a merge candidate at all — it is the thing a merge refuses
   * (H1), which has its own cases below.
   */
  function fixtureTree(ws, { file = null, baselineOverrides = {} } = {}) {
    const founding = makeRun({
      components: ['switch', 'slider'],
      machine: fixtureMachine('ios', { hostname: MINE }),
    });
    const existing = file ?? {
      ...buildBaseline(founding),
      ...baselineOverrides,
    };
    write(ws.root, baselineRel, existing);
    const results = makeRun({
      component: 'button',
      machine: fixtureMachine('ios', { hostname: MINE }),
    });
    return {
      existing,
      results,
      resultsFile: write(ws.root, 'head.json', results),
    };
  }

  /** A real git repo, so the founding-commit recovery runs rather than being stubbed. */
  function gitTree(ws, founding) {
    const run = (...args) => {
      const out = spawnSync('git', args, { cwd: ws.root, encoding: 'utf8' });
      if (out.status !== 0) {
        throw new Error(`git ${args.join(' ')}: ${out.stderr}`);
      }
      return out;
    };
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'fixture@example.invalid');
    run('config', 'user.name', 'Fixture');
    // The machine's own config may sign commits; a fixture commit is not a
    // deliverable and must not need a key (`example-lock.test.js` does the same).
    run('config', 'commit.gpgsign', 'false');
    // Objects, not pre-stringified text: `write()` is what serialises them.
    write(ws.root, 'bun.lock', {
      workspaces: { '': ['bench'] },
      packages: {
        'react-native': ['react-native@0.80.0', {}],
        '@expo/ui': ['@expo/ui@54.0.0', {}],
      },
    });
    write(ws.root, 'bench/package.json', {
      dependencies: { 'react-native': '0.80.0', '@expo/ui': '54.0.0' },
    });
    run('add', '-A');
    run('commit', '-q', '-m', 'fixture');
    const sha = run('rev-parse', '--short', 'HEAD').stdout.trim();
    const preX14 = preX14Baseline(founding);
    return { sha, file: { ...preX14, sha } };
  }

  it('merges into a pre-X14 file, recovering its versions from its own commit', () => {
    withTree((ws) => {
      const founding = makeRun({
        components: ['switch', 'slider'],
        machine: fixtureMachine('ios', { hostname: MINE }),
      });
      const { sha, file } = gitTree(ws, founding);
      if (sha === '') {
        throw new Error('fixture git commit produced no sha');
      }
      write(ws.root, baselineRel, file);
      const resultsFile = write(
        ws.root,
        'head.json',
        makeRun({
          component: 'button',
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'button',
      ]);
      if (out.status !== 0) {
        throw new Error(out.all.slice(-2500));
      }
      expect(out.status).toBe(0);

      const after = JSON.parse(
        readFileSync(path.join(ws.root, baselineRel), 'utf8')
      );
      // The recovered versions land in the file, named as a recovery, so the next
      // merge does not have to go back to git for them.
      expect(after.dependencies.reactNative).toBe('0.80.0');
      expect(after.dependencies.expoUi).toBe('54.0.0');
      expect(after.dependencies.source).toContain(sha);
      expect(after.sha).toBe(sha);
      expect(after.components.slider.seededFromFoundingRun).toBe(true);
      expect(after.components.slider.dependencies.source).toContain(sha);
      expect(
        after.components.button.comparabilityNotes.map((e) => e.field)
      ).toEqual(
        expect.arrayContaining(['dependencies.reactNative', 'timeouts'])
      );
    });
  });

  it('merges one component and leaves the rest of the file alone', () => {
    withTree((ws) => {
      const { existing, resultsFile } = fixtureTree(ws);
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'button',
      ]);
      expect(out.all).toContain('Merged baseline');
      expect(out.status).toBe(0);

      const after = JSON.parse(
        readFileSync(path.join(ws.root, baselineRel), 'utf8')
      );
      for (const [key, cell] of Object.entries(existing.cells)) {
        expect([key, JSON.stringify(after.cells[key])]).toEqual([
          key,
          JSON.stringify(cell),
        ]);
      }
      expect(componentsInBaseline(after)).toEqual([
        'button',
        'slider',
        'switch',
      ]);
      expect(after.sha).toBe(existing.sha);
      expect(after.updatedAt).toBe(existing.updatedAt);
      expect(JSON.stringify(after.machine)).toBe(
        JSON.stringify(existing.machine)
      );
      expect(after.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
      // A current file already recorded its versions, so the merge leaves them
      // exactly as they were: only a file that predates the field gets a recovery.
      expect(after.dependencies.source).toBe(existing.dependencies.source);
      expect(after.components.button.seededFromFoundingRun ?? false).toBe(
        false
      );
      // The other components' provenance entries are carried through untouched:
      // the merge says who measured its own cells and nothing about anyone else's.
      expect(JSON.stringify(after.components.slider)).toBe(
        JSON.stringify(existing.components.slider)
      );
    });
  });

  it('refuses a component the file already holds, without writing', () => {
    withTree((ws) => {
      const { existing, results } = fixtureTree(ws);
      const resultsFile = write(
        ws.root,
        'again.json',
        makeRun({
          component: 'slider',
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'slider',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('already has');
      expect(readFileSync(path.join(ws.root, baselineRel), 'utf8')).toBe(
        `${JSON.stringify(existing, null, 2)}\n`
      );
      expect(results.deviceKey).toBe(DEVICE_KEY);
    });
  });

  /**
   * The three shapes of results file that used to corrupt a baseline (H1).
   *
   * `report.mjs` re-reports *any* results file with *any* flags, so the flags say
   * nothing about what the run measured. Before fix round 1 the merge copied every
   * cell the record held into the file, so a full run reported as `--component menu`
   * rewrote all of switch's and slider's measured numbers and filed them under
   * `components.menu` — and a narrowed one landed a partial block that then counted
   * as "menu is present", making the missing rows unaddable. Both are refusals now,
   * asked of the record rather than of the command line.
   */
  it('refuses a full-run results file rather than filing every cell under one component', () => {
    withTree((ws) => {
      const { existing } = fixtureTree(ws);
      // Same plan, same machine, same versions — but switch and slider measured at a
      // *different* nitro-ui cost, so any cell the merge overwrote is visible as a
      // changed number rather than as a coincidence.
      const fullRun = write(
        ws.root,
        'full.json',
        makeRun({
          components: ['switch', 'slider', 'button'],
          nitroUi: 200_000,
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const out = cli(ws, [
        fullRun,
        '--update-baseline',
        '--component',
        'menu',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('of other components');
      // And the completeness half counts *menu's* rows, not the run's: 28 are
      // expected and none were measured. A count taken from the record would tell a
      // human "measured 84 of the 112", which reads like a near-complete merge.
      expect(out.all).toContain(
        'measured 0 of the 28 cells that plan measures'
      );
      // The file as it was written: byte for byte, so nothing under `menu` and no
      // re-measured switch/slider row.
      expect(readFileSync(path.join(ws.root, baselineRel), 'utf8')).toBe(
        `${JSON.stringify(existing, null, 2)}\n`
      );
    });
  });

  it('refuses a results file that measured a different component than the one named', () => {
    withTree((ws) => {
      const { existing } = fixtureTree(ws);
      // A whole `slider` run, reported as `menu`: slider is in the file, so this is
      // not the "already has" rule — it is the record holding a component the merge
      // was not asked to write, which used to mean slider's numbers were replaced.
      const sliderRun = write(
        ws.root,
        'slider.json',
        makeRun({
          component: 'slider',
          nitroUi: 200_000,
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const out = cli(ws, [
        sliderRun,
        '--update-baseline',
        '--component',
        'menu',
      ]);
      expect(out.status).toBe(2);
      // Names the rule and shows a cell of the component that does not belong.
      expect(out.all).toMatch(/of other components \(first: \S*slider/);
      const after = JSON.parse(
        readFileSync(path.join(ws.root, baselineRel), 'utf8')
      );
      expect(after.components.menu).toBeUndefined();
      for (const key of ['mount.slider:nitro-ui:50', 'mount:nitro-ui:50']) {
        expect([key, JSON.stringify(after.cells[key])]).toEqual([
          key,
          JSON.stringify(existing.cells[key]),
        ]);
      }
    });
  });

  it('refuses a results file that measured only part of the named component', () => {
    withTree((ws) => {
      const { existing } = fixtureTree(ws);
      // Every cell here *is* menu's, so the stray rule is satisfied and the other
      // half of the check is what stops it: the plan measures 28 cells for a
      // component and this run holds two of them. Merging would leave the file with
      // a menu block missing rows that `--check` then reports as never measured,
      // with no merge able to add them later because menu now counts as present.
      const partial = write(
        ws.root,
        'partial.json',
        makeRun({
          scenarios: ['mount.menu', 'update.menu'],
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const out = cli(ws, [
        partial,
        '--update-baseline',
        '--component',
        'menu',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('would land incomplete');
      expect(out.all).toContain('cells that plan measures for `menu`');
      const after = JSON.parse(
        readFileSync(path.join(ws.root, baselineRel), 'utf8')
      );
      expect(after.components.menu).toBeUndefined();
      expect(componentsInBaseline(after)).toEqual(
        componentsInBaseline(existing)
      );
    });
  });

  /**
   * F1: `--force` must not buy a partial block (review round 2).
   *
   * A quick-plan run of `menu` holds 12 of the 28 cells the file's plan measures for
   * it. Before the fix, the completeness question was asked against **the run's**
   * plan — so 12 of 12 looked complete — while the rule that refuses a quick-plan
   * mint lives in `baselineBlockers()`, which `--force` skips, and plan is not a
   * comparability field. The result exited 0 and wrote those 12 rows; menu then
   * counted as present, so the other 16 could never be merged in. The plan a
   * component's block has to be complete *for the file*, and mixing plans in one
   * table is a regime break, which is why this refusal is absolute.
   */
  it('refuses a quick-plan results file under --force, because the file is full-plan', () => {
    withTree((ws) => {
      const { existing } = fixtureTree(ws);
      const quickRun = write(
        ws.root,
        'quick.json',
        makeRun({
          plan: 'quick',
          component: 'menu',
          nitroUi: 200_000,
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const forced = cli(ws, [
        quickRun,
        '--update-baseline',
        '--component',
        'menu',
        '--force',
      ]);
      expect(forced.status).toBe(2);
      expect(forced.all).toContain(
        'the `quick` plan and the file holds `full`'
      );
      expect(readFileSync(path.join(ws.root, baselineRel), 'utf8')).toBe(
        `${JSON.stringify(existing, null, 2)}\n`
      );
    });
  });

  /**
   * F2: a measured record with no cells is not the pre-flight's stand-in.
   *
   * The stand-in is empty because nothing has been measured yet; a *real* run is
   * empty because every launch failed. Inferring one from the other let a results
   * file with `cells: {}` reach the file under `--force` and print "Merged … 0
   * cells" while adding a `components.menu` entry — a claim that menu was measured
   * here, with nothing in the table to contradict it, and menu unmergeable from then
   * on. The stand-in now says so explicitly (`candidate: true`), and a merge that
   * would add no cells refuses at the last moment as well.
   */
  it('refuses a results file that measured nothing, under --force too', () => {
    withTree((ws) => {
      const { existing, results } = fixtureTree(ws);
      const empty = write(ws.root, 'empty.json', {
        ...results,
        cells: {},
        // The waiting rule a real run records, so this fails for having no cells
        // and not for a field the merge cannot read.
        timeouts: baselineTimeoutRecord({
          timeouts: requestedTimeouts(results),
        }),
      });
      const forced = cli(ws, [
        empty,
        '--update-baseline',
        '--component',
        'button',
        '--force',
      ]);
      expect(forced.status).toBe(2);
      expect(forced.all).toContain('records no cells at all');
      expect(forced.all).not.toContain('Merged baseline');
      expect(readFileSync(path.join(ws.root, baselineRel), 'utf8')).toBe(
        `${JSON.stringify(existing, null, 2)}\n`
      );
    });
  });

  /**
   * F3: a cell belongs to the component its **key** names.
   *
   * A hand-edited record can carry `scenario: 'mount.menu'` on the key
   * `mount:nitro-ui:50`, which is a `switch` row. Both ownership questions used to
   * read the field, so the cell passed "did this run measure only menu?" and then
   * landed on switch's key and replaced it. The key is what `--check` matches by and
   * what the merge writes, so it is the claim that has to hold, and a record whose
   * two accounts disagree is refused rather than interpreted.
   */
  it('refuses a record whose cell keys and scenarios disagree, and does not overwrite', () => {
    withTree((ws) => {
      const { existing } = fixtureTree(ws);
      const forged = makeRun({
        component: 'menu',
        nitroUi: 200_000,
        machine: fixtureMachine('ios', { hostname: MINE }),
      });
      // Same record, filed under a switch key: 28 menu cells plus this one, so the
      // count still looks like a complete menu block.
      forged.cells['mount:nitro-ui:50'] = {
        ...forged.cells['mount.menu:nitro-ui:50'],
        scenario: 'mount.menu',
      };
      const forgedFile = write(ws.root, 'forged.json', forged);
      const out = cli(ws, [
        forgedFile,
        '--update-baseline',
        '--component',
        'menu',
        // Absolute refusals survive --force, and asking with it is the point: this
        // is not a judgement about the measurement.
        '--force',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('not the one their key stores');
      const after = JSON.parse(
        readFileSync(path.join(ws.root, baselineRel), 'utf8')
      );
      expect(after.components.menu).toBeUndefined();
      // The switch row the forged cell would have replaced, byte for byte.
      expect(JSON.stringify(after.cells['mount:nitro-ui:50'])).toBe(
        JSON.stringify(existing.cells['mount:nitro-ui:50'])
      );
    });
  });

  it('refuses when there is no baseline to merge into', () => {
    withTree((ws) => {
      const resultsFile = write(
        ws.root,
        'head.json',
        makeRun({
          component: 'button',
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'button',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('nothing to merge into');
    });
  });

  it('refuses a results file whose run records no machine, and does not write', () => {
    withTree((ws) => {
      const { existing, results } = fixtureTree(ws);
      const orphan = { ...results };
      delete orphan.machine.hostname;
      const resultsFile = write(ws.root, 'orphan.json', orphan);
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'button',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('no machine label');
      expect(readFileSync(path.join(ws.root, baselineRel), 'utf8')).toBe(
        `${JSON.stringify(existing, null, 2)}\n`
      );
    });
  });

  it('refuses to merge into a file another machine measured, from its own directory', () => {
    withTree((ws) => {
      const { resultsFile } = fixtureTree(ws, {
        file: {
          ...preX14Baseline(
            makeRun({
              components: ['switch', 'slider'],
              machine: fixtureMachine('ios', { hostname: 'maintainer-mac-9' }),
            }),
            { withTimeouts: true }
          ),
        },
      });
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'button',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('maintainer-mac-9');
    });
  });

  it('refuses a file whose runtime differs, naming the field and both values', () => {
    withTree((ws) => {
      const { resultsFile } = fixtureTree(ws, {
        baselineOverrides: {
          machine: fixtureMachine('ios', {
            hostname: MINE,
            simRuntime: '18.3.1',
          }),
        },
      });
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'button',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('simulator runtime differs');
      expect(out.all).toContain('18.3.1');
      expect(out.all).toContain('18.4');
    });
  });

  it('refuses an incomparable file under --force too, but not a thin launch count', () => {
    // `--force` is a human overruling judgements about *their measurement* - the
    // plan, the launch count, the load. It says nothing about whether these numbers
    // belong in this file, so the one guard that is not a measurement judgement has
    // to survive it: without that, one mistyped flag crosses a runtime boundary.
    withTree((ws) => {
      const { existing } = fixtureTree(ws);
      const thin = write(
        ws.root,
        'thin.json',
        makeRun({
          component: 'button',
          machine: fixtureMachine('ios', { hostname: MINE }),
          overrides: { launches: 4 },
        })
      );
      const thinForced = cli(ws, [
        thin,
        '--update-baseline',
        '--component',
        'button',
        '--force',
      ]);
      expect(thinForced.status).toBe(0);
      // And the same thin run without --force is refused for exactly that reason.
      const thinPlain = cli(ws, [
        thin,
        '--update-baseline',
        '--component',
        'button',
      ]);
      expect(thinPlain.status).toBe(2);
      expect(thinPlain.all).toContain('launches per cell');

      // Roll the forced write back so the comparability case starts from the file
      // the test built rather than from the one the force just merged into.
      write(ws.root, baselineRel, existing);
      const runtimeDiffers = write(
        ws.root,
        'head2.json',
        makeRun({
          component: 'button',
          machine: fixtureMachine('ios', {
            hostname: MINE,
            simRuntime: '18.4',
          }),
        })
      );
      writeFileSync(
        path.join(ws.root, baselineRel),
        `${JSON.stringify(
          {
            ...existing,
            machine: { ...existing.machine, simRuntime: '18.3.1' },
          },
          null,
          2
        )}\n`
      );
      const forced = cli(ws, [
        runtimeDiffers,
        '--update-baseline',
        '--component',
        'button',
        '--force',
      ]);
      expect(forced.status).toBe(2);
      expect(forced.all).toContain('simulator runtime differs');
    });
  });

  /**
   * The atomicity of the write (review L2).
   *
   * `writeBaseline` runs prettier on what it wrote, so whoever gets that command
   * wrong — or whose machine has no prettier — reaches the committed file *after*
   * the bytes are already there. The mint now formats a temp file and renames it, so
   * two things hold that did not before: what prettier is handed is not the committed
   * path, and a formatter that damages its input cannot leave a damaged baseline.
   */
  it('formats a temp file, and leaves a readable baseline when the formatter damages it', () => {
    withTree((ws) => {
      const { resultsFile } = fixtureTree(ws);
      // A prettier that scribbles on the file it is handed and fails, which is
      // what a crash or a version-mismatched prettier actually looks like from
      // here. It also records the path it was asked to format, because "did the
      // mint hand prettier the committed file or a scratch copy?" is the whole
      // question, and it is only observable from inside the formatter.
      writeFileSync(
        path.join(ws.bin, 'bunx'),
        [
          '#!/bin/sh',
          `last=""`,
          'for arg in "$@"; do last="$arg"; done',
          `printf '%s\\n' "$last" > "${path.join(ws.root, 'prettier-target')}"`,
          ': > "$last"',
          'echo "prettier died" >&2',
          'exit 1',
          '',
        ].join('\n')
      );
      chmodSync(path.join(ws.bin, 'bunx'), 0o755);
      const out = cli(ws, [
        resultsFile,
        '--update-baseline',
        '--component',
        'button',
      ]);
      expect(out.status).toBe(0);
      expect(out.all).toContain('Merged baseline');

      // 1. Prettier never saw the committed path.
      const target = readFileSync(
        path.join(ws.root, 'prettier-target'),
        'utf8'
      ).trim();
      expect(path.basename(target)).toContain('.tmp.json');
      expect(target).not.toBe(path.join(ws.root, baselineRel));

      // 2. What arrived at the committed path still parses and still holds the
      // merge: the scribble was undone by re-serialising, then renamed in.
      const raw = readFileSync(path.join(ws.root, baselineRel), 'utf8');
      const after = JSON.parse(raw);
      expect(after.components.button.sha).toBe('dead123');
      expect(after.components.button.cellKeys.length).toBeGreaterThan(0);

      // 3. The note tells a human to format the file that *exists*, not the temp
      // name prettier was handed and that no longer exists.
      expect(out.all).toContain('bun run format:write');
      expect(out.all).toContain(path.basename(baselineRel));
      expect(out.all).not.toContain('.tmp.json');

      // 4. And the formatter's scratch file did not stay in the committed dir.
      expect(
        readdirSync(path.dirname(path.join(ws.root, baselineRel))).filter(
          (name) => name.includes('.tmp')
        )
      ).toEqual([]);
    });
  });

  it('names the baseline schema version it wanted when a pre-D9 file is checked', () => {
    // The two schema constants describe two different files (X14), and this is the
    // one line where a reader is told which of them was rejected. Asserting it
    // through the CLI rather than the function is the point: the call site is what
    // can pass the wrong constant, and a unit test of the function never sees it.
    withTree((ws) => {
      fixtureTree(ws);
      writeFileSync(
        path.join(ws.root, baselineRel),
        `${JSON.stringify({ schemaVersion: 1, machine: { hostname: MINE }, cells: {} }, null, 2)}\n`
      );
      const resultsFile = write(
        ws.root,
        'check.json',
        makeRun({
          scenarios: ['mount'],
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const out = cli(ws, [resultsFile, '--check']);
      expect(out.status).toBe(2);
      expect(out.all).toContain('is not a baseline this version reads');
      expect(out.all).toContain('found v1');
      // The results file's own version is also 2, and quoting it here is the bug
      // this asserts away: the reader accepts v2 baselines, so a refusal that said
      // "not a v2 baseline" described a file it had just opened.
      expect(out.all).toContain(`writes v${String(BASELINE_SCHEMA_VERSION)}`);
    });
  });

  it('is gated by --check afterwards, for the merged and the untouched cells', () => {
    withTree((ws) => {
      const { resultsFile } = fixtureTree(ws);
      expect(
        cli(ws, [resultsFile, '--update-baseline', '--component', 'button'])
          .status
      ).toBe(0);

      // A run that measures the whole table sees all three components: the merge
      // added rows, it did not replace the file.
      const fullRun = write(
        ws.root,
        'full.json',
        makeRun({
          components: ['switch', 'slider', 'button'],
          machine: fixtureMachine('ios', { hostname: MINE }),
        })
      );
      const clean = cli(ws, [fullRun, '--check']);
      expect(clean.status).toBe(0);
      expect(clean.all).not.toContain('missing-base');

      /**
       * Multiplies one cell's `presented` base ratio by `factor`, per launch as
       * well: the gate bootstraps over `launchRatios`, so a doctoring that moved
       * only the aggregate would print a 3.00x verdict whose CI covers 1.05, and the
       * run would pass. A *smaller* base ratio is the forgery that matters, because
       * the gate divides head by base.
       */
      const doctorOne = (mutate) => {
        const file = JSON.parse(
          readFileSync(path.join(ws.root, baselineRel), 'utf8')
        );
        mutate(file, (cell, factor) => {
          const metric = cell.metrics.presentedNs;
          metric.ratio *= factor;
          metric.launchRatios = (metric.launchRatios ?? [metric.ratio]).map(
            (value) => value * factor
          );
        });
        writeFileSync(
          path.join(ws.root, baselineRel),
          `${JSON.stringify(file, null, 2)}\n`
        );
      };

      // Doctored *inside* the merged component: a file claiming button's cells were
      // 3x faster than they were has to show up as a FAIL for the next run.
      doctorOne((file, scale) => {
        for (const [key, cell] of Object.entries(file.cells)) {
          if (key.includes('.button')) {
            scale(cell, 1 / 3);
          }
        }
      });
      const mergedBad = cli(ws, [fullRun, '--check']);
      expect(mergedBad.status).toBe(1);
      expect(mergedBad.all).toContain('FAIL');
      expect(mergedBad.all).toContain('mount.button:nitro-ui:50');

      // Button restored (x3) and switch forged the same way: proof the cells a
      // merge never touched are still live rows of a gated table, not text carried
      // along for the ride.
      doctorOne((file, scale) => {
        for (const [key, cell] of Object.entries(file.cells)) {
          if (key.includes('.button')) {
            scale(cell, 3);
          }
          if (!key.includes('.')) {
            scale(cell, 1 / 3);
          }
        }
      });
      const outsideBad = cli(ws, [fullRun, '--check']);
      expect(outsideBad.status).toBe(1);
      expect(outsideBad.all).toContain('FAIL');
      expect(outsideBad.all).toContain('mount:nitro-ui:50');
    });
  });
});
