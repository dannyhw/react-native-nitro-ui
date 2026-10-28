/**
 * The one bench command.
 *
 *   bun bench --platform ios     --plan quick
 *   bun bench --platform android --plan quick
 *   bun bench --platform ios --plan full --check
 *   bun bench --platform ios --plan quick --compare <git-ref|results-file>
 *   bun bench --platform ios --plan quick --update-baseline
 *   bun bench --platform android --plan quick --component button
 *
 * `--component` restricts the run to one component's cells. A component is part
 * of the scenario cell (`mount.button`), so the filter crosses the plan rather
 * than renaming the arms, and every component's ratios still divide by the same
 * `rn-core` control (scripts/bench/lib.mjs `componentOf`).
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
 *
 * `--check` and `--update-baseline` also need `NITRO_UI_MACHINE_LABEL`: a committed
 * baseline is keyed by machine as well as by device
 * (`bench/baselines/<label>/<deviceKey>.json`), and there is no other machine's file
 * to fall back to, so an unusable label is refused before the run starts rather than
 * at the end of a three-hour plan (scripts/bench/baseline.mjs). A plain run, which
 * gates nothing against a baseline, does not need one.
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
  ARMS_WITHOUT_COMPONENT,
  baselineTimeoutsFor,
  LAUNCHES_PER_CELL,
  MARK_CAPABLE_IMPLEMENTATIONS,
  PLANS,
  SCHEMA_VERSION,
  LOAD_SAMPLE_INTERVAL_MS,
  aggregateRecords,
  baselineNoise,
  baselineTable,
  buildSchedule,
  createLoadSampler,
  isCompatibleBaseline,
  launchBudgetMs,
  launchPlanString,
  loadBlocker,
  narrowingProblem,
  parseTimeoutFlags,
  requestedTimeouts,
  resultsFileName,
  summarizeMissingReasons,
  componentOf,
} from './lib.mjs';
import {
  labelPreFlightProblem,
  mintBaselineFileFor,
  openBaselineForCheck,
} from './baseline.mjs';
import { dryRun } from './dry-run.mjs';
import { collectMachine, tryExec } from './machine.mjs';
import { comparisonSections, renderMarkdown, summaryTable } from './render.mjs';
import {
  BASELINES_DIR,
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
/**
 * The wall-clock budget for one launch, by platform and scenario action.
 *
 * A budget has to exceed the most a launch can *legitimately* spend waiting for signals,
 * or a slow arm is killed as "stalled" for a reason the runner itself chose - and a killed
 * launch loses all 20 of its iterations' data, which is strictly worse than the 20 recorded
 * `probe-timeout` reasons it replaces. That ceiling is the platform's default waits times
 * the iterations of a launch: `mount` waits twice per iteration (its own signal, then the
 * teardown's) and once for the presenting frame, so 25 iterations at iOS's 1 500/8 000 ms
 * is 275 000 ms of possible waiting (A4 raised iOS's presented wait from 2 000 ms, at which
 * point 180 000 was no longer enough). Android keeps the pre-A4 table because its waits
 * never changed (review M1): 25 iterations at 1 500/2 000 ms is 125 000 ms, inside 180 000.
 * The `leak` scenario allocates 200 instances per iteration and does not wait for signals at
 * all, so it keeps its own larger allowance for the work rather than the waiting.
 */
const TIMEOUTS = {
  ios: {
    mount: 300_000,
    update: 300_000,
    memory: 300_000,
    leak: 420_000,
  },
  android: {
    mount: 180_000,
    update: 180_000,
    memory: 180_000,
    leak: 300_000,
  },
};

// A machine shared with other emulators or another agent's build can starve a
// launch well past these budgets. Raise the ceiling rather than let a busy
// laptop turn a bench run into a wall of timeouts.
const overrideSeconds = Number(process.env.BENCH_LAUNCH_TIMEOUT_S);
if (Number.isFinite(overrideSeconds) && overrideSeconds > 0) {
  for (const platformBudgets of Object.values(TIMEOUTS)) {
    for (const scenario of Object.keys(platformBudgets)) {
      platformBudgets[scenario] = overrideSeconds * 1000;
    }
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
 * Get the app into the compiled state a device eventually leaves it in, and report
 * what that state turned out to be.
 *
 * Two steps, because neither does the other's job (all measured on API 35 with the
 * bench app):
 *
 * 1. `adb install` only *stores* the merged baseline profile in
 *    `assets/dexopt/baseline.prof`. Nothing consumes it on its own: the status stays
 *    `[status=verify]` after the install, after a `cmd package bg-dexopt-job` pass,
 *    and after a forced compile that runs before the profile has been written - the
 *    compiler reads the app's profile file, not the APK, and quietly falls back to
 *    verify when the file is not there. So ask `androidx.profileinstaller`, through
 *    the `INSTALL_PROFILE` broadcast its `ProfileInstallReceiver` exists for (the
 *    hook the benchmark library uses for the same reason), to write it.
 * 2. `cmd package compile -m speed-profile -f` compiles from it synchronously
 *    instead of waiting for an idle window, which is what produces
 *    `[status=speed-profile]`.
 *
 * `speed-profile` is the filter ART uses for a profile anyway, so this is the state a
 * phone reaches some time after an install; measuring before it means measuring the
 * interpreter. Every implementation shares one APK and one install, so this applies
 * to all of them identically (D9's pairing) and the only thing it can change is what
 * a profile is worth.
 *
 * The status is read back and logged because "the profile did nothing" and "the
 * profile was worth nothing" look identical in a results table. A run whose app has no
 * profileinstaller to ask still measures something - it just says so here.
 *
 * It returns the state it ended in, and the caller persists that in the results: the
 * two ART regimes are not comparable with each other (T12 round 2: the same code's
 * launch-paired ratio to the shared host moved 1.22x -> 0.99x on mount `presented`
 * with no library change at all), so a result file has to say which regime it
 * belongs to. `--update-baseline` refuses anything but `speed-profile` for that
 * reason, and Android numbers published before T12 are `verify` numbers with nothing
 * in the file saying so.
 */
function primeArtProfile(serial, packageName) {
  let status = 'unknown';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // 1. Have the app install its own baseline profile.
    adb(serial, [
      'shell',
      'am',
      'broadcast',
      '-n',
      `${packageName}/androidx.profileinstaller.ProfileInstallReceiver`,
      '-a',
      'androidx.profileinstaller.action.INSTALL_PROFILE',
    ]);
    sleep(1_000);
    // 2. Compile from it now.
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
    const dexopt = adb(serial, ['shell', 'dumpsys', 'package', 'dexopt']);
    const block = dexopt.slice(dexopt.indexOf(`[${packageName}]`));
    status = /\[status=([^\]]+)\]/.exec(block)?.[1] ?? 'unknown';
    log(`ART:       attempt ${String(attempt)}: ${packageName} -> ${status}`);
    if (status === 'speed-profile') {
      return { packageName, status, primed: true, attempts: attempt };
    }
  }
  log(
    'ART:       not speed-profile - this run measures the interpreter, not a baseline profile'
  );
  return { packageName, status, primed: false, attempts: 2 };
}

function androidTarget(device, apkPath, packageName) {
  const remote = `/sdcard/Android/data/${packageName}/files/bench.ndjson`;
  return {
    label: `Android ${device.name} (${device.serial})`,
    async install() {
      adb(device.serial, ['install', '-r', apkPath]);
      return primeArtProfile(device.serial, packageName);
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

async function runLaunch(target, entry, platform) {
  const started = Date.now();
  let deadChecks = 0;
  const handle = await target.run(entry);
  const expected = launchPlanString(entry);
  // Keyed by the *action*, because a scenario cell carries its component
  // (`mount.slider`): the budget belongs to what the launch does, not to which
  // control it mounts - plus any longer signal waits this launch was asked for.
  const budget = launchBudget(entry, platform);
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

/**
 * The wall-clock budget for one launch, widened by whatever signal waits that launch
 * was asked to make.
 *
 * The budgets above assume that platform's default waits: an iteration of `mount` waits
 * up to `mount` + `presented` for its own two signals and again `mount` in the teardown
 * that follows, so 25 iterations already contain 125 s of waiting on Android and 275 s on
 * iOS. Ask for a 40 s presenting wait and the same launch would be killed as *stalled*
 * for a reason the runner itself introduced - and a killed launch becomes a `problem`, a
 * worse record than the slow sample it was chasing. An explicit `BENCH_LAUNCH_TIMEOUT_S`
 * still wins: that override exists precisely to set the budget by hand.
 */
function launchBudget(entry, platform) {
  return launchBudgetMs(entry, {
    platform,
    scenarioBudgets: TIMEOUTS,
    overrideSeconds,
  });
}

function summarize(records) {
  const skipped = records.find((record) => record.kind === 'skip');
  if (skipped != null) {
    return `skipped (${skipped.reason})`;
  }
  const iterations = records.filter(
    (record) => record.kind === 'iter' && !record.warmup
  ).length;
  // Missing signals with their reason codes, so a slow arm shows up in the run's own
  // progress line as it happens instead of four hours later in the mint's refusal.
  const notes = summarizeMissingReasons(records);
  return `${String(iterations)} iterations${notes === '' ? '' : `, ${notes}`}`;
}

/**
 * Run the schedule, sampling the machine as it goes.
 *
 * `sample` is called at every launch boundary: installing, launching and
 * terminating an app is where a busy host shows up in the load, and on a run
 * whose launches each outlast the sampling interval it is the only sampling there
 * is.
 */
async function drive({ target, schedule, platform, sample = () => {} }) {
  const records = [];
  const problems = [];
  for (let index = 0; index < schedule.length; index++) {
    const entry = schedule[index];
    sample();
    const label = `${launchPlanString(entry)} launch ${String(entry.launch + 1)}/${String(schedule.filter((other) => other.scenario === entry.scenario && other.implementation === entry.implementation && other.n === entry.n).length)}`;
    process.stderr.write(
      `[${String(index + 1)}/${String(schedule.length)}] ${label} ... `
    );
    try {
      const result = await runLaunch(target, entry, platform);
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
        '           [--launches N] [--prebuild] [--shutdown] [--perf-marks]\n' +
        '           [--component <name>] [--dry-run]\n' +
        '\n' +
        '  --dry-run  print what this run would resolve and whether it would be\n' +
        '             refused, then stop: no boot, no build, no measurement.'
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

  const timeouts = parseTimeoutFlags(
    argv,
    (name) => flag(argv, name),
    platform
  );
  if (timeouts.problem != null) {
    log(timeouts.problem);
    process.exitCode = 2;
    return;
  }

  // Print what this run would resolve and whether it would be refused, then stop:
  // no boot, no build, no measurement (`scripts/bench/dry-run.mjs`). Placed before
  // the label and load refusals below because answering those questions *is* the
  // job here, so a dry run has to get past them rather than exit on them.
  if (argv.includes('--dry-run')) {
    process.exitCode = dryRun({
      argv,
      platform,
      plan,
      launches,
      component: flag(argv, '--component'),
      baselinesDir: BASELINES_DIR,
    });
    return;
  }

  // A baseline is keyed by machine as well as by device (bench/baselines/README.md),
  // so a run that cannot name its machine has no directory to gate against and none
  // to write one to. Refuse on the same second as the load check below rather than
  // three hours later, when the run would have discovered it. `--force` does not
  // bypass this one: the load and cleanliness guards judge measurement quality, and
  // this is the absence of a path to write to.
  const labelProblem = labelPreFlightProblem(argv);
  if (labelProblem != null) {
    log(`\n${labelProblem}`);
    process.exitCode = 2;
    return;
  }

  // Fail fast on the load the run starts with (R4). A `--update-baseline` run has
  // to stay quiet for hours, so a machine that is already over the ceiling when
  // the command starts has no realistic chance of minting: say so in a second
  // instead of after a three-hour plan. Local feedback runs are not refused -
  // their ratios are same-run pairs, and a busy machine is information there, not
  // a disqualification.
  if (argv.includes('--update-baseline') && !argv.includes('--force')) {
    const preflight = [];
    const blocker = loadBlocker({
      loadavg1: os.loadavg()[0] ?? null,
      cpuCount: os.cpus().length,
    });
    if (blocker != null) {
      preflight.push(blocker);
    }
    // Same fail-fast reasoning for a narrowed schedule: a filtered run cannot mint the
    // table `--check` gates against, and finding that out after three hours of device
    // time is the same waste. Both numbers come from the real builder so arm scopes and
    // any filter added later are counted, not re-derived here.
    const filters = {
      only: flag(argv, '--only'),
      component: flag(argv, '--component'),
      scenario: flag(argv, '--scenario'),
      n: argv.includes('--n') ? Number(flag(argv, '--n')) : null,
    };
    const narrowed = narrowingProblem({
      scheduled: buildSchedule({
        plan,
        launches,
        perfMarks: argv.includes('--perf-marks'),
        platform,
        ...filters,
      }).length,
      wholePlan: buildSchedule({
        plan,
        launches,
        perfMarks: argv.includes('--perf-marks'),
        platform,
      }).length,
      filters,
    });
    if (narrowed != null) {
      preflight.push(narrowed);
    }
    if (preflight.length > 0) {
      log(
        `--update-baseline refused before the run started (pass --force to override):\n${preflight
          .map((reason) => `  - ${reason}`)
          .join('\n')}`
      );
      process.exitCode = 2;
      return;
    }
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

  const component = flag(argv, '--component');
  const componentsInPlan = [
    ...new Set(PLANS[plan].map((cell) => componentOf(cell.scenario))),
  ];
  if (component != null && !componentsInPlan.includes(component)) {
    log(
      `--component must be one of ${componentsInPlan.join(', ')} (plan ${plan})`
    );
    process.exitCode = 2;
    return;
  }

  const schedule = buildSchedule({
    plan,
    launches,
    only: flag(argv, '--only'),
    perfMarks,
    component,
    scenario: flag(argv, '--scenario'),
    n: argv.includes('--n') ? Number(flag(argv, '--n')) : null,
    platform,
    mountTimeoutMs: timeouts.mountTimeoutMs,
    presentedTimeoutMs: timeouts.presentedTimeoutMs,
  });
  if (timeouts.mountTimeoutMs != null || timeouts.presentedTimeoutMs != null) {
    const rule = baselineTimeoutsFor(platform);
    log(
      `Timeouts:  mount ${String(
        timeouts.mountTimeoutMs ?? rule.mountTimeoutMs
      )} ms, presented ${String(
        timeouts.presentedTimeoutMs ?? rule.presentedTimeoutMs
      )} ms - DIAGNOSTIC: which samples arrive depends on this rule, so the run cannot mint a baseline (launchBudget widens each launch's budget by the extra wait)`
    );
  }

  // An arm with no cell for this platform's version of the component is a
  // missing row in the table, not a slow one, so say which rows to expect.
  const omittedArms = ARMS_WITHOUT_COMPONENT.filter(
    (key) =>
      key.startsWith(`${platform}:`) &&
      (component == null || key.endsWith(`:${component}`))
  ).map((key) => key.split(':')[1]);
  if (omittedArms.length > 0) {
    log(
      `Arms:      no ${omittedArms.join(', ')} cell on ${platform} (ARMS_WITHOUT_COMPONENT)`
    );
  }

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
  // Android returns the ART state the app is in now that every arm is primed
  // identically; iOS has no such state and contributes null.
  const art = (await target.install()) ?? null;

  const started = Date.now();
  // Sample the whole run rather than its last minute (R4): on a timer, so a long
  // or stalled launch is still covered, and at each launch boundary from drive().
  const load = createLoadSampler(() => os.loadavg()[0]);
  load.sample();
  const loadTick = setInterval(() => {
    load.sample();
  }, LOAD_SAMPLE_INTERVAL_MS);
  loadTick.unref?.();
  let records;
  let problems;
  try {
    ({ records, problems } = await drive({
      target,
      schedule,
      platform,
      sample: () => load.sample(),
    }));
  } finally {
    clearInterval(loadTick);
  }
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
    art,
    /**
     * The waiting rule this run measured under (A4). Read back from the cells rather
     * than echoed from the flags, so a run whose app binary predates the launch flag
     * cannot claim a timeout it never applied - the check below compares the two and says
     * so. Zero means "nothing recorded", which is what a run of an app built
     * before the flag looks like, and `baselineBlockers()` refuses to mint from it.
     */
    timeouts: requestedTimeouts({ cells }),
    clock: Object.values(cells)[0]?.clock ?? null,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    machine: collectMachine(platform, device, load),
    problems,
    cells,
  };

  /**
   * The runner asked the app to wait longer than the default and no launch reported a
   * timeout, which means the installed binary predates the launch flag: the JS-side
   * parser is what reads `presentedTimeout=`, so an app built before A4 ignores it and
   * every sample would be recorded as a 2 s timeout while the run's own header claimed
   * otherwise. Say so as a problem rather than produce a diagnostic that lies about
   * itself (`--skip-build` is how this happens).
   */
  if (
    (timeouts.mountTimeoutMs != null || timeouts.presentedTimeoutMs != null) &&
    run.timeouts.mountTimeoutMs === 0 &&
    run.timeouts.presentedTimeoutMs === 0
  ) {
    problems.push(
      'the run asked for a signal timeout (--timeout-mount/--timeout-presented) and no launch recorded one, so the installed app does not understand the flag - rebuild the bench app (drop --skip-build) and run it again'
    );
  }

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
    const mint = mintBaselineFileFor({ baselinesDir: BASELINES_DIR, run });
    if (mint.refusal != null) {
      // The pre-flight above normally rules this out; the guard is here because a
      // baseline must never be resolved from anything but the run that made it.
      log(`\n${mint.refusal}`);
      exitCode = Math.max(exitCode, 2);
    } else {
      const file = mint.file;
      const outcome = writeBaseline(file, run, { force });
      if (outcome.written) {
        log(`Baseline written: ${path.relative(process.cwd(), file)}`);
        if (outcome.note != null) {
          log(`  ${outcome.note}`);
        }
        if (force) {
          log('  (written with --force; review the guards below)');
        }
        for (const line of outcome.skippedCellNotes) {
          log(line);
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
  }

  if (argv.includes('--check')) {
    const opened = openBaselineForCheck({
      baselinesDir: BASELINES_DIR,
      run,
      display: (file) => path.relative(process.cwd(), file),
      readJson,
      isCompatibleBaseline,
      schemaVersion: SCHEMA_VERSION,
    });
    if (opened.refusal != null) {
      log(`\n${opened.refusal.message}`);
      exitCode = Math.max(exitCode, 2);
    } else {
      const section = comparisonSections({
        run,
        base: { cells: {} },
        mode: 'check',
        label: `${opened.display} (ratios to rn-core)`,
        baseTable: baselineTable(opened.baseline),
        baseNoise: baselineNoise(opened.baseline),
      });
      process.stdout.write(`\n${section.markdown}\n`);
      appendSection(written.md, `\n${section.markdown}\n`);
      exitCode = Math.max(exitCode, section.exitCode);
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
