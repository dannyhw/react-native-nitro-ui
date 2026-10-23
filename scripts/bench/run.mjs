/**
 * The one bench command.
 *
 *   bun bench --platform ios     --plan quick
 *   bun bench --platform android --plan quick
 *   bun bench --platform ios --plan full --check
 *   bun bench --platform ios --plan quick --compare <git-ref|results-file>
 *   bun bench --platform ios --plan quick --update-baseline
 *
 * Per cell of the matrix (scenario x implementation x N) the protocol is a
 * **fresh process**, a 1 s settle, 5 warmup + 20 measured iterations, and
 * `LAUNCHES_PER_CELL` passes over the whole matrix in alternating order so no
 * implementation always runs last (docs/research/setup-decisions.md SS6).
 *
 * Results come back as NDJSON from inside the app container; a launch counts as
 * complete when its `end` sentinel is there. `--skip-build` reuses the installed
 * artifact instead of rebuilding.
 *
 * Devices come from the environment (see scripts/bench/devices.mjs) and must be
 * the ones your brief assigned. The runner boots what you point it at and leaves
 * it running, because booting an emulator costs minutes and `quick` plans run
 * back to back; pass `--shutdown` to power off whatever *this* run booted (AGENTS.md:
 * never touch a device you did not start).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, flag, locateArtifact } from './build.mjs';
import {
  adb,
  prepareAndroid,
  resolveAndroidDevice,
  resolveIosDevice,
  restoreAndroidAnimations,
  shutdownDevice,
  simctl,
} from './devices.mjs';
import {
  LAUNCHES_PER_CELL,
  MARK_CAPABLE_IMPLEMENTATIONS,
  PLANS,
  SCHEMA_VERSION,
  UNQUIET_LOAD_RATIO,
  aggregateRecords,
  baselineNoise,
  baselineTable,
  buildSchedule,
  isCompatibleBaseline,
  launchPlanString,
  resultsFileName,
} from './lib.mjs';
import { comparisonSections, renderMarkdown, summaryTable } from './render.mjs';
import {
  baselinePath,
  readJson,
  resolveCompareTarget,
  writeBaseline,
  writeReportFiles,
  writeRawRecords,
} from './report.mjs';

/**
 * Wall-clock budget per launch, by scenario. Generous on an idle machine, so
 * hitting it means something is wrong, not that the component is slow.
 */
const TIMEOUTS = {
  mount: 180_000,
  update: 180_000,
  memory: 180_000,
  leak: 300_000,
};

// A machine shared with other emulators or another agent's build can starve a
// launch well past these budgets. Raise the ceiling rather than let a busy
// laptop turn a bench run into a wall of timeouts.
const overrideSeconds = Number(process.env.BENCH_LAUNCH_TIMEOUT_S);
if (Number.isFinite(overrideSeconds) && overrideSeconds > 0) {
  for (const scenario of Object.keys(TIMEOUTS)) {
    TIMEOUTS[scenario] = overrideSeconds * 1000;
  }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function shortSha() {
  try {
    return git(['rev-parse', '--short', 'HEAD']);
  } catch {
    return 'unknown';
  }
}

function isGitDirty() {
  try {
    return git(['status', '--porcelain']).length > 0;
  } catch {
    return false;
  }
}

function resolveRef(ref) {
  try {
    return git(['rev-parse', '--short', ref]);
  } catch {
    return ref;
  }
}

function tryExec(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Who ran this, on what, and how busy they were (T02 review S10, D9).
 *
 * A baseline is only meaningful if it says so: the load average decides whether
 * the run may mint one at all, and the OS runtime is part of the device key
 * because a runtime change breaks comparability sooner than a device change.
 */
function collectMachine(platform, device) {
  const loadavg = os.loadavg();
  const cpuCount = os.cpus().length;
  const machine = {
    hostname: os.hostname(),
    osPlatform: os.platform(),
    osRelease: os.release(),
    osVersion: os.version(),
    arch: os.arch(),
    cpuCount,
    // D15: device keys stay class-level, so the CPU model is what tells two
    // machines claiming the same `android35-emu-pixel9` / `ios27-sim-iphone17`
    // key apart when a baseline is being compared across desks or with CI.
    cpuModel: os.cpus()[0]?.model ?? null,
    loadavg1: loadavg[0] ?? null,
    loadavg5: loadavg[1] ?? null,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    xcode: tryExec('xcodebuild', ['-version'])?.split('\n')[0] ?? null,
  };
  machine.quiet =
    isNumberLike(machine.loadavg1) &&
    machine.loadavg1 <= cpuCount * UNQUIET_LOAD_RATIO;
  if (platform === 'ios') {
    machine.simRuntime = device.runtime ?? null;
  } else {
    machine.avd = device.avd ?? null;
    machine.androidApi = device.sdk ?? null;
    machine.androidImage = device.image ?? null;
  }
  return machine;
}

function isNumberLike(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* --------------------------------- targets -------------------------------- */

/**
 * One app install on one device. `run()` starts a launch and returns a handle
 * the poller can read; the handle is a path inside the app container (iOS) or
 * on external storage (Android - `run-as` needs a debuggable build, and this is
 * a release build).
 */
function iosTarget(device, appPath, bundleId) {
  const appBinaryName = path.basename(appPath, '.app');
  const ndjsonPath = () => {
    const container = simctl([
      'get_app_container',
      device.udid,
      bundleId,
      'data',
    ]).trim();
    return path.join(container, 'Documents', 'bench.ndjson');
  };

  return {
    label: `iOS ${device.name} (${device.udid})`,
    async install() {
      simctl(['install', device.udid, appPath]);
    },
    async run(entry) {
      const file = ndjsonPath();
      if (fs.existsSync(file)) {
        fs.rmSync(file);
      }
      simctl([
        'launch',
        '--terminate-running-process',
        device.udid,
        bundleId,
        '-benchPlan',
        launchPlanString(entry),
      ]);
      return file;
    },
    read(file) {
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    /**
     * 'alive' | 'dead' | 'unknown' - see the note on `liveness` below.
     *
     * `ps` is asked for the process table and matched here, so a failed `ps`
     * reads as 'unknown' (keep waiting) rather than as a dead app.
     */
    liveness() {
      const ps = tryExec('xcrun', [
        'simctl',
        'spawn',
        device.udid,
        '/bin/ps',
        '-ax',
        '-o',
        'comm=',
      ]);
      if (ps == null) {
        return 'unknown';
      }
      return ps.includes(appBinaryName) ? 'alive' : 'dead';
    },
    crashHint() {
      const dir = path.join(
        os.homedir(),
        'Library',
        'Logs',
        'DiagnosticReports'
      );
      const reports = fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((name) => name.startsWith(`${appBinaryName}-`))
            .map((name) => ({
              name,
              mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs,
            }))
            .sort((a, b) => b.mtimeMs - a.mtimeMs)
        : [];
      const newest = reports[0];
      if (newest == null || Date.now() - newest.mtimeMs > 120_000) {
        return null;
      }
      return `~/Library/Logs/DiagnosticReports/${newest.name}`;
    },
    async terminate() {
      try {
        simctl(['terminate', device.udid, bundleId]);
      } catch {
        // already gone
      }
    },
  };
}

/**
 * Make ART compile the app now, from the profile it was installed with.
 *
 * `adb install` only *stores* a baseline profile; the compiler that consumes it
 * normally runs later, in `BackgroundDexOptService`, so whether a measured launch
 * ran AOT-compiled code would depend on how long the device had been idle since
 * the install. That is fine for a library that ships no profile (every arm is in
 * the same position) and unforgivable for one that does: the benefit could land
 * before, after or between the launches being compared. Forcing the compile here
 * is what puts a library `baseline-prof.txt` on trial - the arms still share one
 * APK and one install, so the command applies to every implementation equally
 * (D9's pairing), and the only thing it can change is the profile's own effect.
 *
 * `speed-profile` is the filter ART would reach for anyway once it had compiled
 * this profile; `-f` is what makes it ignore the "already compiled" state the
 * install left behind.
 */
function applyArtProfile(serial, packageName) {
  adb(serial, [
    'shell',
    'cmd',
    'package',
    'compile',
    '-m',
    'speed-profile',
    '-f',
    packageName,
  ]);
}

function androidTarget(device, apkPath, packageName) {
  const remote = `/sdcard/Android/data/${packageName}/files/bench.ndjson`;
  return {
    label: `Android ${device.name} (${device.serial})`,
    async install() {
      adb(device.serial, ['install', '-r', apkPath]);
      applyArtProfile(device.serial, packageName);
    },
    async run(entry) {
      // Benign when the file (or, on API 33+, its not-yet-created parent dir)
      // is missing: FUSE reports that as EACCES rather than ENOENT. A stale
      // file from an earlier launch is caught by the plan check in runLaunch.
      try {
        adb(device.serial, ['shell', 'rm', '-f', remote]);
      } catch {
        // ignore
      }
      adb(device.serial, [
        'shell',
        'am',
        'start',
        '-S',
        '-n',
        `${packageName}/.MainActivity`,
        '--es',
        'benchPlan',
        launchPlanString(entry),
      ]);
      return remote;
    },
    read(file) {
      try {
        const out = adb(device.serial, ['exec-out', 'cat', file], {
          stdio: ['ignore', 'pipe', 'ignore'],
          // The file does not exist until the app has finished a launch, and
          // `cat` failing on that is normal polling, not an error.
          timeout: 20_000,
        });
        return typeof out === 'string' ? out : '';
      } catch {
        return '';
      }
    },
    /**
     * `pidof` prints nothing and succeeds when the app is not running, which is
     * the only reliable "dead" signal; a failed adb call is 'unknown'.
     */
    liveness() {
      const out = tryExec('adb', [
        '-s',
        device.serial,
        'shell',
        'pidof',
        packageName,
      ]);
      if (out == null) {
        return 'unknown';
      }
      return out.trim().length > 0 ? 'alive' : 'dead';
    },
    crashHint: () =>
      'adb logcat -d -s ReactNativeViewManager NITRO_BENCH AndroidRuntime',
    async terminate() {
      adb(device.serial, ['shell', 'am', 'force-stop', packageName]);
    },
  };
}

/* ---------------------------------- drive --------------------------------- */

function parseNdjson(text) {
  const records = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // A torn line from a killed process. The `end` sentinel is what makes a
      // launch usable, so a torn tail is simply not read.
    }
  }
  return records;
}

async function runLaunch(target, entry) {
  const started = Date.now();
  let deadChecks = 0;
  const handle = await target.run(entry);
  const expected = launchPlanString(entry);
  const budget = TIMEOUTS[entry.scenario] ?? 180_000;
  for (;;) {
    const text = target.read(handle);
    if (text.includes('"kind":"end"')) {
      const records = parseNdjson(text);
      // Every record names the cell it came from, so a file that survived the
      // clear above can never be mistaken for this launch's results.
      const mismatched = records.filter(
        (record) =>
          record.scenario !== entry.scenario ||
          record.implementation !== entry.implementation ||
          record.n !== entry.n
      );
      if (mismatched.length > 0) {
        return {
          records: [],
          ms: Date.now() - started,
          error: `results are not for ${expected} (stale file on device?)`,
        };
      }
      return { records, ms: Date.now() - started };
    }
    if (Date.now() - started > budget) {
      return {
        records: parseNdjson(text),
        ms: Date.now() - started,
        error: `no end sentinel within ${String(Math.round(budget / 1000))}s`,
      };
    }
    // A crashed app writes nothing, so the old behaviour was to burn the whole
    // budget per launch and print a timeout. Three consecutive "dead" answers
    // (and never an 'unknown') stop that in a couple of seconds and say where
    // the crash log is, which is the difference between a 5 second diagnosis and
    // a 7 minute one.
    if (
      target.liveness != null &&
      Date.now() - started > 10_000 &&
      text.length === 0
    ) {
      if (target.liveness() === 'dead') {
        deadChecks += 1;
        if (deadChecks >= 3) {
          const hint = target.crashHint?.() ?? null;
          return {
            records: [],
            ms: Date.now() - started,
            error:
              `${expected}: the app exited before writing any results` +
              (hint == null ? '.' : ` - look at ${hint}`),
          };
        }
      } else {
        deadChecks = 0;
      }
    }
    await sleep(500);
  }
}

function summarize(records) {
  const skipped = records.find((record) => record.kind === 'skip');
  if (skipped != null) {
    return `skipped (${skipped.reason})`;
  }
  const iterations = records.filter(
    (record) => record.kind === 'iter' && !record.warmup
  ).length;
  const blind = records.filter(
    (record) => record.kind === 'iter' && record.mountedNs == null
  ).length;
  return `${String(iterations)} iterations${blind > 0 ? `, ${String(blind)} without a mount signal` : ''}`;
}

async function drive({ target, schedule }) {
  const records = [];
  const problems = [];
  for (let index = 0; index < schedule.length; index++) {
    const entry = schedule[index];
    const label = `${launchPlanString(entry)} launch ${String(entry.launch + 1)}/${String(schedule.filter((other) => other.scenario === entry.scenario && other.implementation === entry.implementation && other.n === entry.n).length)}`;
    process.stderr.write(
      `[${String(index + 1)}/${String(schedule.length)}] ${label} ... `
    );
    try {
      const result = await runLaunch(target, entry);
      records.push(
        ...result.records.map((record) => ({ ...record, launch: entry.launch }))
      );
      process.stderr.write(
        `${summarize(result.records)} (${String(Math.round(result.ms / 100) / 10)}s)\n`
      );
      if (result.error != null) {
        problems.push(`${label}: ${result.error}`);
        log(`  ! ${result.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${label}: ${message.split('\n')[0]}`);
      process.stderr.write(`failed: ${message.split('\n')[0]}\n`);
    }
    await target.terminate();
    await sleep(300);
  }
  return { records, problems };
}

function appendSection(markdownFile, section) {
  fs.appendFileSync(markdownFile, section);
}

/* ----------------------------------- main --------------------------------- */

export async function main(argv) {
  const platform = flag(argv, '--platform');
  if (platform !== 'ios' && platform !== 'android') {
    log(
      'usage: bun bench --platform ios|android [--plan quick|full] [--compare <ref|file>]\n' +
        '           [--check] [--update-baseline] [--force] [--skip-build] [--only <impl,impl>]\n' +
        '           [--launches N] [--prebuild] [--shutdown] [--perf-marks]'
    );
    process.exitCode = 2;
    return;
  }
  const plan = flag(argv, '--plan') ?? 'quick';
  if (PLANS[plan] == null) {
    log(`--plan must be ${Object.keys(PLANS).join(' or ')}`);
    process.exitCode = 2;
    return;
  }
  const launches = Number(
    flag(argv, '--launches') ?? String(LAUNCHES_PER_CELL)
  );
  if (!Number.isInteger(launches) || launches < 1) {
    log('--launches must be a positive integer');
    process.exitCode = 2;
    return;
  }

  const device =
    platform === 'ios' ? resolveIosDevice() : resolveAndroidDevice();
  let previousAnimations = {};
  if (platform === 'android') {
    previousAnimations = prepareAndroid(device) ?? {};
  }

  // Restore what the run changed on a shared device, on every exit path, and
  // only power off a device this run booted when asked to (AGENTS.md).
  const shouldShutdown = argv.includes('--shutdown');
  process.on('exit', () => {
    if (platform === 'android') {
      restoreAndroidAnimations(device, previousAnimations);
    }
    if (shouldShutdown) {
      shutdownDevice(device);
    }
  });

  const perfMarks = argv.includes('--perf-marks');
  if (perfMarks) {
    log(
      `Perf marks: ON (${MARK_CAPABLE_IMPLEMENTATIONS.join(', ')} only) - diagnostics, not a gated measurement`
    );
  }

  const force = argv.includes('--force');
  const built = argv.includes('--skip-build')
    ? locateArtifact(platform)
    : build(platform, { prebuildFirst: argv.includes('--prebuild') });
  const target =
    platform === 'ios'
      ? iosTarget(device, built.appPath, built.bundleId)
      : androidTarget(device, built.apkPath, built.packageName);

  const schedule = buildSchedule({
    plan,
    launches,
    only: flag(argv, '--only'),
    perfMarks,
  });

  // Counted from the schedule itself: `--only` narrows the implementation
  // dimension, and the progress counter below is `schedule.length`.
  const dimension = (pick) => new Set(schedule.map(pick)).size;
  log(`Device:    ${target.label}`);
  log(
    `App:       ${built.appPath ?? built.apkPath}${built.reused ? ' (reused)' : ''}`
  );
  log(
    `Plan:      ${plan} (${String(dimension((e) => `${e.scenario}:${e.n}`))} cells x ${String(
      dimension((e) => e.implementation)
    )} implementations x ${String(dimension((e) => e.launch))} launches = ${String(
      schedule.length
    )} launches)`
  );
  await target.install();

  const started = Date.now();
  const { records, problems } = await drive({ target, schedule });
  const resultsName = resultsFileName(
    shortSha(),
    platform,
    new Date(started),
    isGitDirty(),
    perfMarks
  );
  // Persist the raw pull *before* aggregating: re-aggregating is free, another
  // device run is not, so a bug in the maths must not cost the measurement.
  const raw = writeRawRecords({ fileName: resultsName, records });
  const cells = aggregateRecords(records, { keepRaw: true });

  const run = {
    schemaVersion: SCHEMA_VERSION,
    sha: shortSha(),
    dirty: isGitDirty(),
    platform,
    deviceKey: device.deviceKey,
    deviceName: device.name,
    plan,
    launches,
    perfMarks,
    clock: Object.values(cells)[0]?.clock ?? null,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    machine: collectMachine(platform, device),
    problems,
    cells,
  };

  const written = writeReportFiles({
    run,
    markdown: renderMarkdown(run),
    fileName: resultsName,
  });
  log(`\nResults: ${path.relative(process.cwd(), written.json)}`);
  log(`Raw:     ${path.relative(process.cwd(), raw)}`);
  log(`Report:  ${path.relative(process.cwd(), written.md)}`);
  process.stdout.write(
    `\n${summaryTable(run)}\n\nRatio to rn-core:\n\n${summaryTable(run, { vsControl: true })}\n`
  );

  let exitCode = problems.length > 0 ? 1 : 0;
  if (problems.length > 0) {
    log(
      `\n${String(problems.length)} launch(es) did not complete - see the problems list.`
    );
  }

  const compare = flag(argv, '--compare');
  if (compare != null) {
    let comparisonTarget;
    try {
      comparisonTarget = resolveCompareTarget(resolveRef(compare), platform);
    } catch (error) {
      log(`\n${error instanceof Error ? error.message : String(error)}`);
      exitCode = Math.max(exitCode, 2);
    }
    if (comparisonTarget != null) {
      const section = comparisonSections({
        run,
        base: readJson(comparisonTarget.file),
        mode: 'compare',
        label: comparisonTarget.label,
      });
      process.stdout.write(`\n${section.markdown}\n`);
      appendSection(written.md, `\n${section.markdown}\n`);
      exitCode = Math.max(exitCode, section.exitCode);
    }
  }

  if (argv.includes('--update-baseline')) {
    const file = baselinePath(run.deviceKey);
    const outcome = writeBaseline(file, run, { force });
    if (outcome.written) {
      log(`Baseline written: ${path.relative(process.cwd(), file)}`);
      if (force) {
        log('  (written with --force; review the guards below)');
      }
    } else {
      log(
        `\n--update-baseline refused (pass --force to override):\n${outcome.blockers
          .map((reason) => `  - ${reason}`)
          .join('\n')}`
      );
      exitCode = Math.max(exitCode, 2);
    }
  }

  if (argv.includes('--check')) {
    const file = baselinePath(run.deviceKey);
    if (!fs.existsSync(file)) {
      log(
        `\n--check: no baseline at ${file}. Create one with --update-baseline.`
      );
      exitCode = Math.max(exitCode, 2);
    } else {
      const baseline = readJson(file);
      if (!isCompatibleBaseline(baseline)) {
        log(
          `\n--check: ${file} is not a v${SCHEMA_VERSION} ratio baseline (found v${String(baseline?.schemaVersion)}).\n` +
            '        The pre-D9 baseline gated on absolute rn-core drift and could never fire; re-record it with --update-baseline on a clean, quiet commit.'
        );
        exitCode = Math.max(exitCode, 2);
      } else {
        const section = comparisonSections({
          run,
          base: { cells: {} },
          mode: 'check',
          label: `${path.relative(process.cwd(), file)} (ratios to rn-core)`,
          baseTable: baselineTable(baseline),
          baseNoise: baselineNoise(baseline),
        });
        process.stdout.write(`\n${section.markdown}\n`);
        appendSection(written.md, `\n${section.markdown}\n`);
        exitCode = Math.max(exitCode, section.exitCode);
      }
    }
  }

  process.exitCode = exitCode;
}

if (
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
) {
  await main(process.argv.slice(2));
}
