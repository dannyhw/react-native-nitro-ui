/**
 * Baselines are per machine: `bench/baselines/<label>/<deviceKey>.json`.
 *
 * A ratio to `rn-core` cancels drift inside the machine that measured it and
 * nothing beyond it, so gating `maintainer-mac-1`'s run against another machine's
 * file is not a conservative check - it is a verdict nobody measured. The layout
 * carries that, and the gate has to enforce it: a run resolves its own directory
 * from the `machine.hostname` it recorded, and refuses rather than reading anywhere
 * else.
 *
 * The fixtures keep the labels apart on purpose - the run is `maintainer-mac-1`, the
 * tempting file is `maintainer-mac-9` - and every tempting file holds a *doubled*
 * nitro-ui table, so a fallback that is supposed to be gone would show up as a
 * confident FAIL instead of as a passing test. The old top-level path gets the same
 * treatment: it exists in these fixtures and must never be read.
 *
 * Device and lease free, like the rest of the bench tests: `scripts/bench/baseline.mjs`
 * is pure, and the two CLIs are driven over a throwaway tree.
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

import {
  MACHINE_LABEL_PATTERN,
  UNLABELLED_MACHINE,
  baselineFileFor,
  baselineProvenanceProblem,
  machineLabelFromEnv,
  machineLabelOf,
  machineLabelProblem,
  openBaselineForCheck,
} from '../bench/baseline.mjs';
import {
  SCHEMA_VERSION,
  aggregateRecords,
  buildBaseline,
} from '../bench/lib.mjs';

/** Same shape as `bench-gate.test.js`: 4 quiet launches x 20 measured iterations. */
const LAUNCHES = 4;
const ITERATIONS = 20;
const QUIET = [1, 1.01, 0.995, 1.005];

/** The device key these fixtures measure, deliberately not a committed one. */
const DEVICE_KEY = 'ios27-sim-testdevice';

/** The machine the run under test belongs to, and another machine entirely. */
const MINE = 'maintainer-mac-1';
const OTHER = 'maintainer-mac-9';

/**
 * Mount records for one arm: a `meta`, then per launch 20 iterations plus the CPU
 * brackets, exactly as the bench app writes them.
 */
function mountRecords(implementation, { mounted, n = 50 }) {
  const records = [
    {
      kind: 'meta',
      scenario: 'mount',
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
    const factor = QUIET[launch] ?? 1;
    for (let index = 0; index < ITERATIONS; index++) {
      const wiggle = 1 + 0.002 * ((index % 5) - 2);
      records.push({
        kind: 'iter',
        scenario: 'mount',
        implementation,
        n,
        launch,
        index,
        warmup: false,
        jsCommitNs: 40_000 * factor * wiggle,
        mountedNs: mounted * factor * wiggle,
        presentedNs: mounted * 1.3 * factor * wiggle,
      });
    }
    for (const [phase, scale] of [
      ['mount', 1],
      ['unmount', 0.2],
    ]) {
      records.push({
        kind: 'cpu',
        scenario: 'mount',
        implementation,
        n,
        launch,
        phase,
        iterations: ITERATIONS,
        jsCpuNs: 20_000 * factor * ITERATIONS * scale,
        mainCpuNs: 15_000 * factor * ITERATIONS * scale,
      });
    }
  }
  return records;
}

/**
 * A run of the shape both CLIs read.
 *
 * `nitroUi` is the arm's mount cost over a 100 us control: 110 us is parity with a
 * baseline minted from the same fixture, 220 us is the 2x regression that must be
 * visible in every table - which is what makes reading the wrong file *legible* in
 * the output rather than merely wrong.
 */
function makeRun({ label = MINE, deviceKey = DEVICE_KEY, nitroUi = 110_000 }) {
  const arms = { 'rn-core': 100_000, 'nitro-ui': nitroUi };
  return {
    schemaVersion: SCHEMA_VERSION,
    platform: 'ios',
    deviceKey,
    deviceName: 'Test Simulator',
    plan: 'full',
    launches: 8,
    perfMarks: false,
    sha: 'abc1234',
    dirty: false,
    art: null,
    createdAt: '2026-10-26T00:00:00.000Z',
    durationMs: 1000,
    problems: [],
    machine: { hostname: label, cpuCount: 14, loadavg1: 1.5 },
    cells: aggregateRecords(
      Object.entries(arms).flatMap(([implementation, mounted]) =>
        mountRecords(implementation, { mounted })
      ),
      { keepRaw: true }
    ),
  };
}

/** A committed baseline for a machine, holding one run's ratios. */
function makeBaseline(run) {
  return buildBaseline(run);
}

/* --------------------------------- the unit -------------------------------- */

describe('the per-machine baseline path', () => {
  const dir = path.join('repo', 'bench', 'baselines');

  it('keys the file by machine label, then device key', () => {
    expect(
      baselineFileFor({
        baselinesDir: dir,
        deviceKey: 'ios27-sim-iphone17',
        machineLabel: MINE,
      })
    ).toBe(path.join(dir, 'maintainer-mac-1', 'ios27-sim-iphone17.json'));
    // The same device class on another machine is a different file, not an overwrite.
    expect(
      baselineFileFor({
        baselinesDir: dir,
        deviceKey: 'ios27-sim-iphone17',
        machineLabel: OTHER,
      })
    ).not.toBe(
      baselineFileFor({
        baselinesDir: dir,
        deviceKey: 'ios27-sim-iphone17',
        machineLabel: MINE,
      })
    );
  });

  it('reads the label a run recorded, not the one in the environment now', () => {
    expect(machineLabelOf(makeRun({ label: OTHER }))).toBe(OTHER);
    expect(machineLabelOf({ machine: {} })).toBeNull();
    expect(machineLabelOf(null)).toBeNull();
  });

  it('labels a run from the environment, and calls an unset one unlabelled', () => {
    expect(machineLabelFromEnv({ NITRO_UI_MACHINE_LABEL: MINE })).toBe(MINE);
    expect(machineLabelFromEnv({})).toBe(UNLABELLED_MACHINE);
    // An all-whitespace export is a mistake, not a label: it reads as unlabelled,
    // which is the message that names the fix, rather than as a name that happens
    // to be blank.
    expect(machineLabelFromEnv({ NITRO_UI_MACHINE_LABEL: '   ' })).toBe(
      UNLABELLED_MACHINE
    );
    expect(
      machineLabelFromEnv({ NITRO_UI_MACHINE_LABEL: ' maintainer-mac-1 ' })
    ).toBe(MINE);
  });

  it('refuses a missing or unlabelled machine, and names the fix', () => {
    for (const flag of ['--check', '--update-baseline']) {
      for (const label of [null, UNLABELLED_MACHINE]) {
        const problem = machineLabelProblem(label, { flag });
        expect(problem).toContain(flag);
        expect(problem).toContain('NITRO_UI_MACHINE_LABEL');
        expect(problem).toContain('bench/baselines/<label>/<deviceKey>.json');
      }
    }
    expect(machineLabelProblem(MINE, { flag: '--check' })).toBeNull();
  });

  it('refuses a label that is not one safe path segment', () => {
    for (const label of [
      'Maintainer-Mac-1',
      'maintainer mac 1',
      'maintainer_mac_1',
      '-mac-1',
      'mac/../evil',
      '../outside',
      'mac-1.local',
      'ün-labelled',
      `m${'a'.repeat(63)}`,
    ]) {
      expect([label, MACHINE_LABEL_PATTERN.test(label)]).toEqual([
        label,
        false,
      ]);
      const problem = machineLabelProblem(label, { flag: '--update-baseline' });
      expect(problem).toContain('--update-baseline');
      expect(problem).toContain('NITRO_UI_MACHINE_LABEL');
    }
    // The pattern's own boundaries.
    expect(MACHINE_LABEL_PATTERN.test('m')).toBe(true);
    expect(MACHINE_LABEL_PATTERN.test(`m${'a'.repeat(62)}`)).toBe(true);
    expect(MACHINE_LABEL_PATTERN.test('0-first-is-a-digit')).toBe(true);
  });

  it('refuses an all-whitespace label as unlabelled, not as a blank name', () => {
    // `NITRO_UI_MACHINE_LABEL=" "` is a mistake rather than a name, and it must be
    // refused with the message that says so.
    const problem = machineLabelProblem(
      machineLabelFromEnv({ NITRO_UI_MACHINE_LABEL: '  ' }),
      {
        flag: '--check',
      }
    );
    expect(problem).toContain('no machine label');
    expect(problem).toContain('NITRO_UI_MACHINE_LABEL');
  });

  it('will not build a path from a label it would refuse', () => {
    expect(() =>
      baselineFileFor({
        baselinesDir: 'bench/baselines',
        deviceKey: DEVICE_KEY,
        machineLabel: UNLABELLED_MACHINE,
      })
    ).toThrow(/NITRO_UI_MACHINE_LABEL/);
    expect(() =>
      baselineFileFor({
        baselinesDir: 'bench/baselines',
        deviceKey: DEVICE_KEY,
        machineLabel: '../outside',
      })
    ).toThrow(/safe path segment/);
  });

  it('says so when a file records a machine other than its directory', () => {
    expect(
      baselineProvenanceProblem({
        machineLabel: MINE,
        baseline: makeBaseline(makeRun({ label: OTHER })),
        display: 'bench/baselines/maintainer-mac-1/x.json',
      })
    ).toContain('records machine.hostname "maintainer-mac-9"');
    expect(
      baselineProvenanceProblem({
        machineLabel: MINE,
        baseline: { schemaVersion: SCHEMA_VERSION, cells: {} },
        display: 'bench/baselines/maintainer-mac-1/x.json',
      })
    ).toContain('records no machine');
    expect(
      baselineProvenanceProblem({
        machineLabel: MINE,
        baseline: makeBaseline(makeRun({ label: MINE })),
        display: 'bench/baselines/maintainer-mac-1/x.json',
      })
    ).toBeNull();
  });
});

describe('opening a machine baseline for --check', () => {
  /** Reads through injected fakes, so nothing here touches the real tree. */
  function open({ run, files }) {
    return openBaselineForCheck({
      baselinesDir: 'bench/baselines',
      run,
      display: (file) => file,
      readJson: (file) => JSON.parse(files[file]),
      existsSync: (file) => Object.hasOwn(files, file),
      isCompatibleBaseline: (baseline) =>
        baseline?.schemaVersion === SCHEMA_VERSION && baseline.cells != null,
      schemaVersion: SCHEMA_VERSION,
    });
  }

  const baselineAt = (label, run = makeRun({ label })) => ({
    [`bench/baselines/${label}/${DEVICE_KEY}.json`]: JSON.stringify(
      makeBaseline(run)
    ),
  });

  it('reads this machine file and nothing else', () => {
    const opened = open({
      run: makeRun({ label: MINE }),
      files: baselineAt(MINE),
    });
    expect(opened.refusal).toBeNull();
    expect(opened.display).toBe(`bench/baselines/${MINE}/${DEVICE_KEY}.json`);
    expect(opened.baseline.machine.hostname).toBe(MINE);
  });

  it('refuses an unlabelled run before looking', () => {
    const opened = open({
      run: makeRun({ label: UNLABELLED_MACHINE }),
      files: baselineAt(UNLABELLED_MACHINE),
    });
    expect(opened.refusal.kind).toBe('unlabelled');
    expect(opened.refusal.message).toContain('NITRO_UI_MACHINE_LABEL');
    expect(opened.file).toBeNull();
  });

  it('says no baseline when only another machine has one', () => {
    const opened = open({
      run: makeRun({ label: MINE }),
      files: {
        ...baselineAt(OTHER, makeRun({ label: OTHER, nitroUi: 220_000 })),
        ...baselineAt('maintainer-mac-3'),
      },
    });
    expect(opened.refusal.kind).toBe('missing');
    expect(opened.refusal.message).toContain(
      `no baseline at bench/baselines/${MINE}/${DEVICE_KEY}.json`
    );
    expect(opened.refusal.message).toContain('--update-baseline');
  });

  it('refuses a file that records another machine', () => {
    const opened = open({
      run: makeRun({ label: MINE }),
      files: baselineAt(MINE, makeRun({ label: OTHER })),
    });
    expect(opened.refusal.kind).toBe('foreign-machine');
    expect(opened.refusal.message).toContain('"maintainer-mac-9"');
    expect(opened.refusal.message).toContain('--compare');
  });

  it('refuses a pre-D9 baseline before the provenance check', () => {
    const opened = open({
      run: makeRun({ label: MINE }),
      files: {
        [`bench/baselines/${MINE}/${DEVICE_KEY}.json`]: JSON.stringify({
          schemaVersion: 1,
          machine: { hostname: MINE },
          cells: {},
        }),
      },
    });
    expect(opened.refusal.kind).toBe('incompatible');
    expect(opened.refusal.message).toContain('not a v2 ratio baseline');
  });

  it('refuses a baseline that records no machine at all', () => {
    const orphan = makeBaseline(makeRun({ label: MINE }));
    delete orphan.machine;
    const opened = open({
      run: makeRun({ label: MINE }),
      files: {
        [`bench/baselines/${MINE}/${DEVICE_KEY}.json`]: JSON.stringify(orphan),
      },
    });
    expect(opened.refusal.kind).toBe('foreign-machine');
    expect(opened.refusal.message).toContain('records no machine');
  });
});

/**
 * The two CLIs, over a throwaway tree.
 *
 * `scripts/` is copied next to a `bench/baselines/` of fixtures (`report.mjs` derives
 * its repo root from the copy it was launched from), so a test that mints a baseline
 * mints it in the temp tree. `bunx` is stubbed on PATH: a mint formats its own output
 * with prettier, which `bench-baseline-format.test.js` already proves with the real
 * one.
 */
describe('the bench CLIs on a per-machine baseline', () => {
  /** `scripts/` into a temp tree, minus the jest suites living in it. */
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
    const root = mkdtempSync(
      // Realpath first: on macOS `tmpdir()` is a symlink, and `report.mjs` only runs
      // its CLI when its own resolved path is the one argv names - through
      // `/var -> /private/var` that check silently says no, and the child exits 0
      // having done nothing.
      path.join(realpathSync(tmpdir()), 'bench-machine-')
    );
    copyScripts(
      path.join(process.cwd(), 'scripts'),
      path.join(root, 'scripts')
    );
    // A `bunx` that does nothing, first on the child's PATH.
    const bin = path.join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    const stub = path.join(bin, 'bunx');
    writeFileSync(stub, '#!/bin/sh\nexit 0\n');
    chmodSync(stub, 0o755);
    return { root, bin };
  }

  function writeBaselineFile(root, label, run) {
    const dir = path.join(root, 'bench', 'baselines', label);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${run.deviceKey}.json`);
    writeFileSync(file, `${JSON.stringify(makeBaseline(run), null, 2)}\n`);
    return file;
  }

  function writeResults(root, run, name = 'head.json') {
    const file = path.join(root, name);
    writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
    return file;
  }

  function cli({ root, bin }, script, args, env = {}) {
    const child = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'bench', script), ...args],
      {
        encoding: 'utf8',
        cwd: root,
        timeout: 120_000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          NITRO_UI_MACHINE_LABEL: MINE,
          ...env,
        },
      }
    );
    return {
      status: child.status,
      all: `${child.stdout ?? ''}${child.stderr ?? ''}`,
    };
  }

  function withWorkspace(body) {
    const ws = workspace();
    try {
      return body(ws);
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  }

  function baselinesDirOf({ root }) {
    return path.join(root, 'bench', 'baselines');
  }

  it('mints into the machine directory, creating it', () => {
    withWorkspace((ws) => {
      const results = writeResults(ws.root, makeRun({ label: MINE }));
      const out = cli(ws, 'report.mjs', [results, '--update-baseline']);
      expect(out.all).toContain(`bench/baselines/${MINE}/${DEVICE_KEY}.json`);
      expect(out.status).toBe(0);
      const minted = JSON.parse(
        readFileSync(
          path.join(baselinesDirOf(ws), MINE, `${DEVICE_KEY}.json`),
          'utf8'
        )
      );
      expect(minted.machine.hostname).toBe(MINE);
      expect(minted.deviceKey).toBe(DEVICE_KEY);
      // Nothing landed at the old top-level path.
      expect(readdirSync(baselinesDirOf(ws)).sort()).toEqual([MINE]);
    });
  });

  it('mints a second machine beside the first instead of overwriting it', () => {
    withWorkspace((ws) => {
      const first = writeResults(
        ws.root,
        makeRun({ label: MINE }),
        'mine.json'
      );
      const second = writeResults(
        ws.root,
        makeRun({ label: OTHER, nitroUi: 130_000 }),
        'theirs.json'
      );
      expect(cli(ws, 'report.mjs', [first, '--update-baseline']).status).toBe(
        0
      );
      expect(cli(ws, 'report.mjs', [second, '--update-baseline']).status).toBe(
        0
      );
      expect(readdirSync(baselinesDirOf(ws)).sort()).toEqual([MINE, OTHER]);
      expect(
        JSON.parse(
          readFileSync(
            path.join(baselinesDirOf(ws), MINE, `${DEVICE_KEY}.json`),
            'utf8'
          )
        ).machine.hostname
      ).toBe(MINE);
    });
  });

  it('checks against its own file, and that file gates', () => {
    withWorkspace((ws) => {
      writeBaselineFile(ws.root, MINE, makeRun({ label: MINE }));
      const steady = writeResults(
        ws.root,
        makeRun({ label: MINE }),
        'steady.json'
      );
      const passed = cli(ws, 'report.mjs', [steady, '--check']);
      expect(passed.status).toBe(0);
      expect(passed.all).toContain(
        `bench/baselines/${MINE}/${DEVICE_KEY}.json`
      );

      const regressed = writeResults(
        ws.root,
        makeRun({ label: MINE, nitroUi: 220_000 }),
        'regressed.json'
      );
      const failed = cli(ws, 'report.mjs', [regressed, '--check']);
      expect(failed.status).toBe(1);
      expect(failed.all).toContain('FAIL');
      expect(failed.all).toContain('nitro-ui');
    });
  });

  it('refuses a file whose hostname is another machine, without gating on it', () => {
    withWorkspace((ws) => {
      // A baseline whose arm is twice as fast as the run below: read, it would
      // report a 2x regression, so a provenance check that stopped firing would
      // change the verdict rather than just the wording.
      writeBaselineFile(
        ws.root,
        MINE,
        makeRun({ label: OTHER, nitroUi: 55_000 })
      );
      const results = writeResults(ws.root, makeRun({ label: MINE }));
      const out = cli(ws, 'report.mjs', [results, '--check']);
      expect(out.status).toBe(2);
      expect(out.all).toContain('records machine.hostname "maintainer-mac-9"');
      expect(out.all).toContain('copied or moved');
      expect(out.all).not.toContain('FAIL');
    });
  });

  it('never falls back to another machine file or to the old top-level path', () => {
    withWorkspace((ws) => {
      // Both tempting files exist and both are twice-as-fast tables, so either one
      // read would FAIL the parity run below. The only correct answer is "no
      // baseline for this machine", exit 1, and no verdict.
      writeBaselineFile(
        ws.root,
        OTHER,
        makeRun({ label: OTHER, nitroUi: 55_000 })
      );
      writeFileSync(
        path.join(baselinesDirOf(ws), `${DEVICE_KEY}.json`),
        `${JSON.stringify(
          makeBaseline(makeRun({ label: MINE, nitroUi: 55_000 })),
          null,
          2
        )}\n`
      );
      const results = writeResults(ws.root, makeRun({ label: MINE }));
      const out = cli(ws, 'report.mjs', [results, '--check']);
      expect(out.all).toContain(
        `no baseline at bench/baselines/${MINE}/${DEVICE_KEY}.json`
      );
      expect(out.all).toContain('--update-baseline');
      expect(out.all).not.toContain('FAIL');
      expect(out.status).toBe(1);
    });
  });

  it('refuses to resolve a path at all for an unlabelled or unusable label', () => {
    withWorkspace((ws) => {
      writeBaselineFile(ws.root, MINE, makeRun({ label: MINE }));
      for (const [label, phrase] of [
        [UNLABELLED_MACHINE, 'no machine label'],
        ['Lab 1', 'not a single safe path segment'],
        ['maintainer_mac_1', 'not a single safe path segment'],
      ]) {
        const results = writeResults(ws.root, makeRun({ label }));
        for (const flag of ['--check', '--update-baseline']) {
          const out = cli(ws, 'report.mjs', [results, flag]);
          expect([label, flag, out.status]).toEqual([label, flag, 2]);
          expect(out.all).toContain(phrase);
          expect(out.all).toContain('NITRO_UI_MACHINE_LABEL');
        }
      }
      // An unusable label cannot mint anywhere, so no directory appeared for it.
      expect(readdirSync(baselinesDirOf(ws)).sort()).toEqual([MINE]);
    });
  });

  it('run.mjs refuses an unlabelled --update-baseline before the run starts', () => {
    withWorkspace((ws) => {
      const out = cli(
        ws,
        'run.mjs',
        ['--platform', 'ios', '--plan', 'full', '--update-baseline'],
        { NITRO_UI_MACHINE_LABEL: '', IOS_SIM_UDID: '' }
      );
      expect(out.status).toBe(2);
      expect(out.all).toContain('--update-baseline');
      expect(out.all).toContain('NITRO_UI_MACHINE_LABEL');
      // It never got as far as the device it would otherwise boot, let alone the
      // three-hour plan behind that (the R4 load check below it is also untouched).
      expect(out.all).not.toContain('No iOS simulator');
      expect(out.all).not.toContain('Device:');
      expect(out.all).not.toContain('Plan:');
    });
  });

  it('run.mjs refuses an unusable label for --check too, and not for a plain run', () => {
    withWorkspace((ws) => {
      const checked = cli(
        ws,
        'run.mjs',
        ['--platform', 'ios', '--plan', 'quick', '--check'],
        { NITRO_UI_MACHINE_LABEL: 'Mac One' }
      );
      expect(checked.status).toBe(2);
      expect(checked.all).toContain('not a single safe path segment');
      expect(checked.all).not.toContain('No iOS simulator');

      // A local feedback run that gates nothing still runs - here, as far as
      // complaining about the simulator its environment does not name.
      const plain = cli(
        ws,
        'run.mjs',
        ['--platform', 'ios', '--plan', 'quick'],
        { NITRO_UI_MACHINE_LABEL: '', IOS_SIM_UDID: '' }
      );
      expect(plain.all).toContain('No iOS simulator');
      expect(plain.all).not.toContain('machine label');
    });
  });
});

/**
 * The rule the layout is supposed to encode, checked where it is claimed.
 *
 * A device-key-only lookup resurrected in one call site would read the neighbouring
 * machine's table and never say so, so the shape of the call sites and of the
 * committed tree is asserted here: every baseline path takes a machine label, and
 * every committed baseline sits in the directory of the machine it records.
 */
describe('nothing looks a baseline up by device key alone', () => {
  const benchDir = path.join(process.cwd(), 'scripts', 'bench');

  it('every baselinePath call site passes a machine label', () => {
    for (const name of ['run.mjs', 'report.mjs']) {
      const source = readFileSync(path.join(benchDir, name), 'utf8');
      const calls = [...source.matchAll(/baselinePath\(([^)]*)\)/g)].map(
        (match) => match[1]
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) {
        expect([name, args]).toEqual([
          name,
          expect.stringContaining('machine'),
        ]);
      }
      expect(source).toContain('openBaselineForCheck');
    }
  });

  it('only baseline.mjs joins a baselines directory with a device key', () => {
    for (const name of readdirSync(benchDir)) {
      if (!name.endsWith('.mjs') || name === 'baseline.mjs') {
        continue;
      }
      const source = readFileSync(path.join(benchDir, name), 'utf8');
      expect([name, /path\.join\(\s*BASELINES_DIR/.test(source)]).toEqual([
        name,
        false,
      ]);
    }
  });

  it('the committed baselines sit in their machine directory', () => {
    const dir = path.join(process.cwd(), 'bench', 'baselines');
    const entries = readdirSync(dir, { withFileTypes: true });
    // The two machine-independent files stay at the top level: the render counts,
    // and the README that explains the layout.
    expect(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['README.md', 'renders.json']);
    const machines = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(machines).toContain('maintainer-mac-1');
    expect(machines.length).toBeGreaterThan(0);
    for (const machine of machines) {
      expect([machine, MACHINE_LABEL_PATTERN.test(machine)]).toEqual([
        machine,
        true,
      ]);
      for (const name of readdirSync(path.join(dir, machine))) {
        const baseline = JSON.parse(
          readFileSync(path.join(dir, machine, name), 'utf8')
        );
        expect([machine, name, baseline.machine?.hostname]).toEqual([
          machine,
          name,
          machine,
        ]);
        // And the key inside still matches the file name it is stored under.
        expect(baseline.deviceKey).toBe(name.replace(/\.json$/, ''));
      }
    }
  });
});
