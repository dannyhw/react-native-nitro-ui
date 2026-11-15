/**
 * The one bench command.
 *
 *   bun bench --platform ios     --plan quick
 *   bun bench --platform android --plan quick
 *   bun bench --platform ios     --plan quick --compare-release
 *   bun bench --platform ios     --plan quick --compare-release v0.9.0
 *   bun bench --platform android --plan quick --component button
 *   node scripts/bench/report.mjs <results.json> --compare <git-ref|results-file>
 *
 * `--compare-release [ref]` is the release check: it measures `ref` (the newest release
 * tag by default) and the working tree **in one session, on one device**, alternating
 * which of the two installed apps is launched, so the two library versions are subject
 * to the same machine at the same moment. It then gates `head(x/rn-core) /
 * base(x/rn-core)` per cell and exits non-zero on a regression (D9). The base side is a
 * second bench app, built from the ref in `bench/base-ref/` (gitignored): one artifact
 * per side, one install swap per launch round (`scripts/bench/compare.mjs`).
 *
 * `--compare <ref|results-file>` stays the offline half: it gates this run against a
 * results file that already exists, measured earlier on this machine.
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
 * Nothing here refuses a run for being busy: the load the session ran at is recorded
 * and printed, and a comparison made inside one session cancels that drift the same way
 * the launch-paired ratio to `rn-core` does.
 *
 * Devices come from the environment (see scripts/bench/devices.mjs) and must be
 * the ones your brief assigned. The runner boots what you point it at and leaves
 * it running, because booting an emulator costs minutes and `quick` plans run
 * back to back; pass `--shutdown` to power off whatever *this* run booted (AGENTS.md:
 * never touch a device you did not start).
 *
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, flag, locateArtifact, REPO_ROOT } from './build.mjs';
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
  buildSchedule,
  createLoadSampler,
  defaultTimeoutsFor,
  LAUNCHES_PER_CELL,
  launchBudgetMs,
  launchPlanString,
  MARK_CAPABLE_IMPLEMENTATIONS,
  parseTimeoutFlags,
  PLANS,
  requestedTimeouts,
  resultsFileName,
  SCHEMA_VERSION,
  summarizeMissingReasons,
  componentOf,
  LOAD_SAMPLE_INTERVAL_MS,
  aggregateRecords,
} from './lib.mjs';
import { collectMachine, runDependencies, tryExec } from './machine.mjs';
import {
  baseRefDir,
  buildBaseSide,
  comparisonPlanLines,
  extractBaseRef,
  installBaseDependencies,
  locateBaseArtifact,
  newestReleaseTag,
  planComparison,
  readBaseSchedule,
} from './compare.mjs';
import { dryRun } from './dry-run.mjs';
import { installedDependenciesProblem } from './deps.mjs';
import { comparisonSections, renderMarkdown, summaryTable } from './render.mjs';
import {
  readJson,
  resolveCompareTarget,
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

/**
 * A git *question*, as opposed to a git step of the build: git answers these with a
 * `fatal:` on stderr as well as a non-zero exit, and the caller here already has an
 * answer for the failure. Without this, a plain `--dry-run` outside a repository prints
 * a git error and a bench refusal, and only one of them is ours.
 */
function gitProbe(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function shortSha() {
  try {
    return gitProbe(['rev-parse', '--short', 'HEAD']);
  } catch {
    return 'unknown';
  }
}

function isGitDirty() {
  try {
    return gitProbe(['status', '--porcelain']).length > 0;
  } catch {
    return false;
  }
}

/**
 * The newest release tag, as `--compare-release` means it when given no ref.
 *
 * git's creatordate order is the answer ("the release that shipped last"), not a sort of
 * the version strings - a patch on an older line released after a newer minor release is
 * still the most recent thing the next release must not be slower than. The filtering
 * and the "that tag is this very commit" skip are `newestReleaseTag`'s, so the rule is
 * one function the unit tests can drive.
 */
function chooseReleaseTag() {
  let tags = [];
  try {
    tags = gitProbe(['tag', '--sort=-creatordate'])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return {
      ref: null,
      problem:
        'no release tag: `git tag` failed, so this checkout cannot name a release to compare against - pass --compare-release <ref>',
    };
  }
  const shaOfTag = {};
  for (const tag of tags.slice(0, 30)) {
    try {
      shaOfTag[tag] = gitProbe(['rev-parse', '--short', `${tag}^{commit}`]);
    } catch {
      shaOfTag[tag] = null;
    }
  }
  const answer = newestReleaseTag({ tags, shaOfTag, headSha: shortSha() });
  return answer.problem == null
    ? { ref: answer.ref, problem: null }
    : { ref: null, problem: answer.problem };
}

function resolveRef(ref) {
  try {
    return gitProbe(['rev-parse', '--short', ref]);
  } catch {
    return ref;
  }
}

/**
 * A flag whose value may be omitted: `--compare-release` alone means "the newest release
 * tag", `--compare-release v0.9.0` means that ref. Anything else that starts a flag is
 * the next flag, not this flag's value - `--compare-release --dry-run` is the common
 * spelling, and a ref that begins with `--` is not a thing git resolves anyway.
 */
function readOptionalFlag(argv, name) {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  const next = argv[at + 1];
  return next == null || next.startsWith('--') ? '' : next;
}

/**
 * Flags the bench used to take and no longer does.
 *
 * An unknown flag is otherwise ignored, and these three were ignored into a *green*:
 * `--check` on today's runner would measure a plain run, print a plain report and exit
 * 0 while its author believed a baseline had been consulted (X36 deleted the committed
 * baselines). Silence is the failure, so each one is answered with what replaced it.
 */
const REMOVED_FLAGS = {
  '--check':
    'the bench no longer carries committed baselines to check against. ' +
    'Use --compare-release [ref] to measure a release in this same session, ' +
    'or --compare <ref|file> to gate this run against results you already have.',
  '--update-baseline':
    'nothing mints a baseline any more. A plain run writes results to bench/results/; ' +
    '--compare-release measures the release you would have minted against, when you need the verdict.',
  '--force':
    'it existed to override a mint refusal (a busy machine, a narrowed plan). ' +
    'There is nothing to override: the load is reported now, and a cell that was noisy ' +
    'inside its own run is not gated.',
};

export function removedFlagProblem(argv) {
  for (const [name, replacement] of Object.entries(REMOVED_FLAGS)) {
    if (argv.includes(name)) {
      return `${name} no longer exists: ${replacement}`;
    }
  }
  return null;
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
function iosTarget(device, appPath, bundleId, labelPrefix = '') {
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
    // The prefix is what tells the two apps of a release comparison apart in the log:
    // same device, same identifier, different artifact.
    label: `${labelPrefix}iOS ${device.name} (${device.udid})`,
    appPath,
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
 * belongs to. A run that ends anywhere else measured the interpreter, and the report
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

function androidTarget(device, apkPath, packageName, labelPrefix = '') {
  const remote = `/sdcard/Android/data/${packageName}/files/bench.ndjson`;
  return {
    label: `${labelPrefix}Android ${device.name} (${device.serial})`,
    apkPath,
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
  // progress line as it happens instead of four hours later, in the report.
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
async function drive({
  targetFor,
  schedule,
  platform,
  sample = () => {},
  tagFor = () => '',
}) {
  const records = [];
  const problems = [];
  for (let index = 0; index < schedule.length; index++) {
    const entry = schedule[index];
    sample();
    const target = await targetFor(entry);
    // Counted within the side: a release comparison drives both sides' launches of one
    // cell in the same array, and "launch 6/8" for the fourth launch of a four-launch
    // plan would read as a plan nobody asked for.
    const launchesOfSide = schedule.filter(
      (other) =>
        other.scenario === entry.scenario &&
        other.implementation === entry.implementation &&
        other.n === entry.n &&
        (other.side ?? null) === (entry.side ?? null)
    ).length;
    const label = `${tagFor(entry)}${launchPlanString(entry)} launch ${String(entry.launch + 1)}/${String(launchesOfSide)}`;
    process.stderr.write(
      `[${String(index + 1)}/${String(schedule.length)}] ${label} ... `
    );
    try {
      const result = await runLaunch(target, entry, platform);
      records.push(
        ...result.records.map((record) => ({
          ...record,
          launch: entry.launch,
          ...(entry.side == null ? {} : { side: entry.side }),
        }))
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
      'usage: bun bench --platform ios|android [--plan quick|full]\n' +
        '           [--compare-release [ref]] [--compare <ref|file>]\n' +
        '           [--skip-build] [--only <impl,impl>]\n' +
        '           [--launches N] [--prebuild] [--shutdown] [--perf-marks]\n' +
        '           [--component <name>] [--dry-run]\n' +
        '\n' +
        '  --compare-release [ref]  measure <ref> (default: the newest release tag) and\n' +
        '             this tree in one session on one device, then gate head/base;\n' +
        '             base is a second bench app, built from that ref.\n' +
        '  --compare <ref|file>     gate this run against results already on disk.\n' +
        '  --dry-run  print what this run would resolve - for --compare-release the\n' +
        '             whole two-sided plan - then stop: no boot, build, or measurement.'
    );
    process.exitCode = 2;
    return;
  }
  // Before anything is resolved or booted: a run that believes it gated something and
  // did not is worse than one that stops.
  const removed = removedFlagProblem(argv);
  if (removed != null) {
    log(removed);
    process.exitCode = 2;
    return;
  }
  const plan = flag(argv, '--plan') ?? 'quick';
  if (PLANS[plan] == null) {
    log(`--plan must be ${Object.keys(PLANS).join(' or ')}`);
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

  const component = flag(argv, '--component');
  const perfMarks = argv.includes('--perf-marks');
  // `--compare-release` takes its ref optionally: bare means "the newest release tag",
  // so a value is only consumed when the next token is not another flag.
  const compareRelease = readOptionalFlag(argv, '--compare-release');
  if (compareRelease != null && perfMarks) {
    log(
      '--compare-release cannot be combined with --perf-marks: marks instrument this tree only, and a comparison needs both sides measured the same way'
    );
    process.exitCode = 2;
    return;
  }
  if (
    compareRelease != null &&
    (timeouts.mountTimeoutMs != null || timeouts.presentedTimeoutMs != null)
  ) {
    log(
      '--compare-release cannot be combined with --timeout-mount/--timeout-presented: each app waits by its own defaults, and a comparison of two different waits is not a comparison'
    );
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

  // Print what this run would resolve - and for `--compare-release`, the whole
  // two-sided plan - then stop: no boot, no build, no measurement
  // (`scripts/bench/dry-run.mjs`).
  if (argv.includes('--dry-run')) {
    process.exitCode = dryRun({
      argv,
      platform,
      plan,
      launches,
      component: flag(argv, '--component'),
      // The two-sided plan, for `--compare-release`. Reading a ref's plan needs its
      // files but nothing else - `scripts/bench/lib.mjs` has no dependencies - so a dry
      // run extracts the ref and asks it, without installing or building anything.
      prepareComparison:
        compareRelease == null
          ? null
          : () => {
              const chosen =
                compareRelease === ''
                  ? chooseReleaseTag()
                  : { ref: compareRelease, problem: null };
              if (chosen.ref == null) {
                return { problem: chosen.problem };
              }
              const baseDir = baseRefDir({
                repoRoot: REPO_ROOT,
                ref: chosen.ref,
              });
              let extracted;
              try {
                extracted = extractBaseRef({
                  repoRoot: REPO_ROOT,
                  baseDir,
                  ref: chosen.ref,
                });
              } catch (error) {
                return {
                  problem: `could not extract ${chosen.ref}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
                };
              }
              const basePlan = readBaseSchedule({
                baseDir,
                platform,
                plan,
                launches,
                filters: {
                  only: flag(argv, '--only'),
                  component: flag(argv, '--component'),
                  scenario: flag(argv, '--scenario'),
                  n: argv.includes('--n') ? Number(flag(argv, '--n')) : null,
                },
              });
              return planComparison({
                platform,
                plan,
                launches,
                ref: chosen.ref,
                baseSha: extracted.sha.slice(0, 7),
                headSha: shortSha(),
                repoRoot: REPO_ROOT,
                baseDir,
                headSchedule: buildSchedule({
                  plan,
                  launches,
                  only: flag(argv, '--only'),
                  perfMarks,
                  component,
                  scenario: flag(argv, '--scenario'),
                  n: argv.includes('--n') ? Number(flag(argv, '--n')) : null,
                  platform,
                }),
                baseSchedule: basePlan.schedule,
                baseProblem: basePlan.problem,
              });
            },
    });
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

  if (perfMarks) {
    log(
      `Perf marks: ON (${MARK_CAPABLE_IMPLEMENTATIONS.join(', ')} only) - diagnostics, not a gated measurement`
    );
  }

  const built = argv.includes('--skip-build')
    ? locateArtifact(platform)
    : build(platform, { prebuildFirst: argv.includes('--prebuild') });
  const target =
    platform === 'ios'
      ? iosTarget(device, built.appPath, built.bundleId)
      : androidTarget(device, built.apkPath, built.packageName);

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
    const rule = defaultTimeoutsFor(platform);
    log(
      `Timeouts:  mount ${String(
        timeouts.mountTimeoutMs ?? rule.mountTimeoutMs
      )} ms, presented ${String(
        timeouts.presentedTimeoutMs ?? rule.presentedTimeoutMs
      )} ms - DIAGNOSTIC: which samples arrive depends on this rule, so its ratios are not comparable with a run measured under the default (launchBudget widens each launch's budget by the extra wait)`
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
  /* ------------------------- the release comparison ------------------------
   *
   * The base side is a second bench app, built by the ref's own `build.mjs` in the
   * ref's own checkout, outside this repository (`~/.nitro-ui/bench-base/...`). Both apps answer to the
   * same app identifier, so exactly one is installed at a time and the session is
   * driven in launch rounds: install a side, drive that round's launches for it, then
   * install the other side for the next round. `sideOrderForRound` decides who goes
   * first, and it is ABBA for the same reason the arms are: a host that drifts across
   * two hours must not land on one library version (scripts/bench/compare.mjs).
   */
  let comparison = null;
  let baseDependencies = null;
  let driveSchedule = schedule;
  const targets = { head: target };
  const installedArt = new Map();
  if (compareRelease != null) {
    const chosen =
      compareRelease === ''
        ? chooseReleaseTag()
        : { ref: compareRelease, problem: null };
    if (chosen.ref == null) {
      log(`--compare-release: ${chosen.problem}`);
      process.exitCode = 2;
      return;
    }
    // The ref the user typed is the label and the directory name; `extractBaseRef`
    // resolves it, and refuses the run on the spot if git cannot.
    const ref = chosen.ref;
    const baseDir = baseRefDir({ repoRoot: REPO_ROOT, ref });
    log(`Base ref:  ${ref} -> ${baseDir}`);
    const extracted = extractBaseRef({ repoRoot: REPO_ROOT, baseDir, ref });
    const basePlan = readBaseSchedule({
      baseDir,
      platform,
      plan,
      launches,
      filters: {
        only: flag(argv, '--only'),
        component,
        scenario: flag(argv, '--scenario'),
        n: argv.includes('--n') ? Number(flag(argv, '--n')) : null,
      },
    });
    comparison = planComparison({
      platform,
      plan,
      launches,
      ref,
      baseSha: extracted.sha.slice(0, 7),
      headSha: shortSha(),
      repoRoot: REPO_ROOT,
      baseDir,
      headSchedule: schedule,
      baseSchedule: basePlan.schedule,
      baseProblem: basePlan.problem,
    });
    for (const line of comparisonPlanLines({
      plan: comparison,
      deviceKey: device.deviceKey,
    })) {
      log(line);
    }
    if (comparison.problem != null) {
      process.exitCode = 2;
      return;
    }
    if (!argv.includes('--skip-build')) {
      installBaseDependencies({ baseDir });
    }
    const baseBuilt = argv.includes('--skip-build')
      ? {
          artifact: locateBaseArtifact({ baseDir, platform }),
          problem: null,
        }
      : buildBaseSide({
          baseDir,
          platform,
          prebuildFirst: argv.includes('--prebuild'),
        });
    if (baseBuilt.problem != null || baseBuilt.artifact == null) {
      log(
        `\nthe base ref ${ref} could not be built into a bench app: ${String(baseBuilt.problem)}`
      );
      process.exitCode = 2;
      return;
    }
    const baseArtifact = baseBuilt.artifact;
    targets.base =
      platform === 'ios'
        ? iosTarget(
            device,
            baseArtifact.appPath,
            baseArtifact.bundleId,
            `${ref}-`
          )
        : androidTarget(
            device,
            baseArtifact.apkPath,
            baseArtifact.packageName,
            `${ref}-`
          );
    baseDependencies = runDependencies({
      lockPath: path.join(baseDir, 'bun.lock'),
      nodeModulesDir: path.join(baseDir, 'node_modules'),
    });
    driveSchedule = [];
    for (const round of comparison.rounds) {
      for (const side of round.order) {
        for (const entry of (side === 'head'
          ? schedule
          : basePlan.schedule
        ).filter((candidate) => candidate.launch === round.launch)) {
          driveSchedule.push({ ...entry, side });
        }
      }
    }
    log(
      `Driving:   ${String(driveSchedule.length)} launches, alternating sides per round`
    );
  }

  /**
   * Install the side a launch belongs to, when it is not the side already on the
   * device. The install is the price of pairing two library versions on one app
   * identifier, and it is paid once per side switch - not once per launch.
   */
  const installedSide = { current: null };
  async function targetFor(entry) {
    const side = entry.side ?? 'head';
    if (comparison != null && installedSide.current !== side) {
      log(`  installing ${side}: ${targets[side].label}`);
      installedArt.set(side, (await targets[side].install()) ?? null);
      installedSide.current = side;
    }
    return targets[side];
  }

  // Android returns the ART state the app is in now that every arm is primed
  // identically; iOS has no such state and contributes null. In a comparison each side
  // is primed by its own install, and both states are recorded.
  // A plain run installs its one app here. A comparison installs on demand inside the
  // drive loop, because which app is on the device changes with the round.
  let art = null;
  if (comparison == null) {
    art = (await target.install()) ?? null;
  }

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
      targetFor,
      schedule: driveSchedule,
      platform,
      sample: () => load.sample(),
      tagFor: (entry) => (entry.side == null ? '' : `${entry.side} `),
    }));
  } finally {
    clearInterval(loadTick);
  }
  const headArt = comparison == null ? art : (installedArt.get('head') ?? null);
  const baseProblems =
    comparison == null
      ? []
      : problems.filter((problem) => problem.startsWith('base '));
  if (comparison != null) {
    problems = problems.filter((problem) => !problem.startsWith('base '));
  }
  const baseRecords = records.filter((record) => record.side === 'base');
  const headRecords =
    comparison == null ? records : records.filter((r) => r.side !== 'base');
  const baseCells =
    comparison == null
      ? null
      : aggregateRecords(baseRecords, { keepRaw: true });
  if (comparison != null) {
    writeRawRecords({
      fileName: resultsFileName(
        comparison.sides[1]?.sha ?? 'unknown',
        platform,
        new Date(started),
        false,
        perfMarks
      ),
      records: baseRecords,
    });
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
  const raw = writeRawRecords({ fileName: resultsName, records: headRecords });
  const cells = aggregateRecords(headRecords, { keepRaw: true });

  // The app versions these numbers belong to (X14). Read from `bun.lock` because
  // that is the version list committed with this commit. The installed packages are
  // recorded beside it because the measured thing is the install, and a stale one
  // is a claim about an app that was never run.
  const dependencies = runDependencies({
    lockPath: path.join(REPO_ROOT, 'bun.lock'),
    nodeModulesDir: path.join(REPO_ROOT, 'node_modules'),
  });
  const installProblem = installedDependenciesProblem({
    resolved: dependencies,
    installed: {
      reactNative: dependencies.installedReactNative,
      expoUi: dependencies.installedExpoUi,
    },
  });
  if (installProblem != null) {
    problems.push(installProblem);
  }

  const run = assembleRun({
    sha: shortSha(),
    dirty: isGitDirty(),
    platform,
    device,
    plan,
    launches,
    perfMarks,
    art: headArt,
    dependencies,
    machine: collectMachine(platform, device, load),
    problems,
    cells,
    started,
  });

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

  /**
   * The release comparison: the base side's cells came from the same session, on the
   * same device, with the other app installed, so this is the one pairing that answers
   * "slower than the last release?" without a committed number to believe
   * (scripts/bench/compare.mjs).
   */
  if (comparison != null) {
    const baseRun = assembleRun({
      sha: comparison.sides[1]?.sha ?? 'unknown',
      dirty: false,
      platform,
      device,
      plan,
      launches,
      perfMarks,
      art: installedArt.get('base') ?? null,
      dependencies: baseDependencies,
      machine: run.machine,
      problems: baseProblems,
      cells: baseCells,
      started,
    });
    const baseWritten = writeReportFiles({
      run: baseRun,
      markdown: renderMarkdown(baseRun),
      fileName: resultsFileName(
        comparison.sides[1]?.sha ?? 'unknown',
        platform,
        new Date(started),
        false,
        perfMarks
      ),
    });
    log(`Base run:  ${path.relative(process.cwd(), baseWritten.json)}`);
    const section = comparisonSections({
      run,
      base: baseRun,
      mode: 'compare',
      label: `${comparison.ref} (measured in this session)`,
    });
    process.stdout.write(`\n${section.markdown}\n`);
    appendSection(written.md, `\n${section.markdown}\n`);
    appendSection(baseWritten.md, `\n${section.markdown}\n`);
    if (section.result.conclusiveFailures.length > 0) {
      log(
        `\nSlower than ${comparison.ref} on ${String(section.result.conclusiveFailures.length)} cell(s):\n${section.result.conclusiveFailures
          .map(
            (failure) =>
              `  - ${failure.key} ${failure.metric}: ${failure.ratio.toFixed(2)}x (CI ${String(failure.ci.low.toFixed(2))}-${String((failure.ci.high ?? failure.ci.low).toFixed(2))})`
          )
          .join('\n')}`
      );
    }
    exitCode = Math.max(exitCode, section.exitCode);
  }

  process.exitCode = exitCode;
}

/**
 * The results-file shape, from the parts a side contributed. Both sides of a release
 * comparison go through this, so the base side is described by exactly the same fields
 * as the head side and `gate()` sees two comparable runs.
 */
function assembleRun({
  sha,
  dirty,
  platform,
  device,
  plan,
  launches,
  perfMarks,
  art,
  dependencies,
  machine,
  problems,
  cells,
  started,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sha,
    dirty,
    platform,
    deviceKey: device.deviceKey,
    deviceName: device.name,
    plan,
    launches,
    perfMarks,
    art,
    dependencies,
    /**
     * The waiting rule this run measured under (A4). Read back from the cells rather
     * than echoed from the flags, so a run whose app binary predates the launch flag
     * cannot claim a timeout it never applied - the problem below compares the two and
     * says so. Zero means "nothing recorded", which is what a run of an app built
     * before the flag looks like, and the problem below says so when that happens.
     */
    timeouts: requestedTimeouts({ cells }),
    clock: Object.values(cells)[0]?.clock ?? null,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    machine,
    problems,
    cells,
  };
}

if (
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
) {
  await main(process.argv.slice(2));
}
