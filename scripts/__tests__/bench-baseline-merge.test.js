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
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openBaselineForMerge } from '../bench/baseline.mjs';
import {
  BASELINE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  aggregateRecords,
  baselineBlockers,
  buildBaseline,
  cellsForComponent,
  componentsInBaseline,
  isCompatibleBaseline,
  mergeBaselineProblems,
  mergeComponentBaseline,
  mergeRunProblems,
  missingBaselineProvenanceProblem,
  seededComponentProvenance,
} from '../bench/lib.mjs';

const LAUNCHES = 8;
const ITERATIONS = 20;
const QUIET = [1, 1.01, 0.995, 1.005, 0.998, 1.002, 1.004, 0.997];

const MINE = 'maintainer-mac-1';
const DEVICE_KEY = 'ios27-sim-testdevice';

/** The iOS defaults, so a mint is not refused for the waiting rule (A4). */
const IOS_WAIT = { mountTimeoutMs: 1500, presentedTimeoutMs: 8000 };

/**
 * Records for one arm of one scenario, shaped exactly like the bench app's output.
 * `scenario` is what makes a cell belong to a component (`mount.slider` -> slider).
 */
function armRecords(scenario, implementation, { latency, n = 50 }) {
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
      ...IOS_WAIT,
    },
  ];
  for (let launch = 0; launch < LAUNCHES; launch++) {
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
    loadSamples: null,
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

/** A run of the shape both CLIs read, measuring the scenarios it is handed. */
function makeRun({
  platform = 'ios',
  scenarios = ['mount'],
  nitroUi = 110_000,
  machine = fixtureMachine(platform),
  dependencies = { reactNative: '0.80.0', expoUi: '54.0.0', source: 'fixture' },
  art = null,
  deviceKey = DEVICE_KEY,
  overrides = {},
} = {}) {
  const arms = { 'rn-core': 100_000, 'nitro-ui': nitroUi };
  return {
    schemaVersion: SCHEMA_VERSION,
    platform,
    deviceKey,
    deviceName: 'Fixture Device',
    plan: 'full',
    launches: LAUNCHES,
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
      scenarios.flatMap((scenario) =>
        Object.entries(arms).flatMap(([implementation, latency]) =>
          armRecords(scenario, implementation, { latency })
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

/* ------------------------- why a merge is refused ------------------------- */

describe('a merge is refused before any device is touched', () => {
  const base = makeRun();
  const file = preX14Baseline(base);

  it('refuses when the file already has this component, and counts the cells', () => {
    const out = merge({
      run: base,
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
        run: base,
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
      run: base,
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
      run: base,
      baseline: null,
      exists: false,
      component: 'slider',
    });
    expect(out.problems.join('\n')).toContain('nothing to merge into');
    expect(out.problems.join('\n')).toContain('--plan full --launches 8');
  });

  it('says nothing about a run with no component, which is a full mint', () => {
    const out = merge({
      run: base,
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
      run,
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
      run,
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
      run: android,
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
      run,
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
      run,
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
      run,
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
      run,
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
      run,
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
      run: diagnostic,
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
      run: runAndroid,
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
      run,
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
  const candidate = {
    ...run,
    art: null,
    machine: { ...run.machine, androidImage: null },
  };

  it('reports the unknown halves as deferred when allowed', () => {
    const out = merge({
      run: candidate,
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
      run: candidate,
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
      run,
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
      run: { ...run, machine: { ...run.machine, hostname: label } },
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
      `not a v${String(BASELINE_SCHEMA_VERSION)} ratio baseline`
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

/* ------------------------------ the CLI ---------------------------------- */

/**
 * `report.mjs` over a throwaway tree, so a merge is proven through the same entry
 * point a maintainer types. `bunx` is stubbed: `bench-baseline-format.test.js`
 * already proves the formatting half with the real binary.
 */
describe('report.mjs merges one component', () => {
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
    const child = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'bench', 'report.mjs'), ...args],
      {
        encoding: 'utf8',
        cwd: root,
        timeout: 120_000,
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
    return {
      status: child.status,
      all: `${child.stdout ?? ''}${child.stderr ?? ''}`,
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
   */
  function fixtureTree(ws, { file = null, baselineOverrides = {} } = {}) {
    const founding = makeRun({
      scenarios: ['mount', 'mount.slider'],
      machine: fixtureMachine('ios', { hostname: MINE }),
    });
    const existing = file ?? {
      ...buildBaseline(founding),
      ...baselineOverrides,
    };
    write(ws.root, baselineRel, existing);
    const results = makeRun({
      scenarios: ['mount.button'],
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
        scenarios: ['mount', 'mount.slider'],
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
          scenarios: ['mount.button'],
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
      const resultsFile = write(ws.root, 'again.json', {
        ...makeRun({
          scenarios: ['mount.slider'],
          machine: fixtureMachine('ios', { hostname: MINE }),
        }),
      });
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

  it('refuses when there is no baseline to merge into', () => {
    withTree((ws) => {
      const resultsFile = write(
        ws.root,
        'head.json',
        makeRun({
          scenarios: ['mount.button'],
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
              scenarios: ['mount', 'mount.slider'],
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
          scenarios: ['mount', 'mount.slider', 'mount.button'],
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
