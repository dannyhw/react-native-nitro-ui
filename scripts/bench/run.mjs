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
 * the ones your brief assigned. The runner boots what you point it at and never
 * shuts anything down.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { build, flag, locateArtifact } from './build.mjs';
import {
  adb,
  prepareAndroid,
  resolveAndroidDevice,
  resolveIosDevice,
  simctl,
} from './devices.mjs';
import {
  IMPLEMENTATIONS,
  LAUNCHES_PER_CELL,
  PLANS,
  SCHEMA_VERSION,
  aggregateRecords,
  buildSchedule,
  normaliseToControl,
  planString,
  trimCells,
} from './lib.mjs';
import {
  baselinePath,
  detailSections,
  readJson,
  resultsPath,
  runHeader,
  summaryTable,
  verdict,
  verdictSummary,
  verdictTable,
  writeReportFiles,
} from './report.mjs';

/** Wall-clock budget per launch, by scenario. */
const TIMEOUTS = {
  mount: 180_000,
  update: 180_000,
  memory: 180_000,
  leak: 300_000,
};

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
        planString(entry.scenario, entry.implementation, entry.n),
      ]);
      return file;
    },
    read(file) {
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
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

function androidTarget(device, apkPath, packageName) {
  const remote = `/sdcard/Android/data/${packageName}/files/bench.ndjson`;
  return {
    label: `Android ${device.name} (${device.serial})`,
    async install() {
      adb(device.serial, ['install', '-r', apkPath]);
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
        planString(entry.scenario, entry.implementation, entry.n),
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
  const handle = await target.run(entry);
  const expected = planString(entry.scenario, entry.implementation, entry.n);
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
    const label = `${planString(entry.scenario, entry.implementation, entry.n)} launch ${String(entry.launch + 1)}/${String(schedule.filter((other) => other.scenario === entry.scenario && other.implementation === entry.implementation && other.n === entry.n).length)}`;
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

/* --------------------------------- verdicts -------------------------------- */

/** Baselines are compared as ratios to rn-core, so both sides get normalised. */
function normaliseSide(runOrBaseline) {
  return {
    ...runOrBaseline,
    cells: normaliseToControl(runOrBaseline.cells ?? runOrBaseline),
  };
}

function writeBaseline(file, run) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        platform: run.platform,
        deviceKey: run.deviceKey,
        deviceName: run.deviceName,
        sha: run.sha,
        plan: run.plan,
        updatedAt: run.createdAt,
        cells: trimCells(run.cells),
      },
      null,
      2
    )}\n`
  );
}

function appendSection(markdownFile, section) {
  fs.appendFileSync(markdownFile, section);
}

function renderMarkdown(run) {
  return [
    `# Bench ${run.platform} - ${run.plan}`,
    '',
    runHeader(run),
    `- duration: ${String(Math.round(run.durationMs / 1000))}s`,
    run.problems.length === 0
      ? '- problems: none'
      : `- problems:\n${run.problems.map((problem) => `  - ${problem}`).join('\n')}`,
    '',
    '## Summary (absolute)',
    '',
    summaryTable(run),
    '',
    '## Summary (ratio to rn-core)',
    '',
    summaryTable(run, { vsControl: true }),
    '',
    detailSections(run),
  ].join('\n');
}

/* ----------------------------------- main --------------------------------- */

export async function main(argv) {
  const platform = flag(argv, '--platform');
  if (platform !== 'ios' && platform !== 'android') {
    log(
      'usage: bun bench --platform ios|android [--plan quick|full] [--compare <ref|file>]\n' +
        '           [--check] [--update-baseline] [--skip-build] [--only <impl,impl>] [--launches N]\n' +
        '           [--prebuild]'
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
  if (platform === 'android') {
    prepareAndroid(device);
  }

  const built = argv.includes('--skip-build')
    ? locateArtifact(platform)
    : build(platform, { prebuildFirst: argv.includes('--prebuild') });
  const target =
    platform === 'ios'
      ? iosTarget(device, built.appPath, built.bundleId)
      : androidTarget(device, built.apkPath, built.packageName);

  log(`Device:    ${target.label}`);
  log(
    `App:       ${built.appPath ?? built.apkPath}${built.reused ? ' (reused)' : ''}`
  );
  log(
    `Plan:      ${plan} (${String(PLANS[plan].length)} cells x ${String(IMPLEMENTATIONS.length)} implementations x ${String(launches)} launches)`
  );

  const schedule = buildSchedule({
    plan,
    launches,
    only: flag(argv, '--only'),
  });
  await target.install();

  const started = Date.now();
  const { records, problems } = await drive({ target, schedule });
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
    clock: Object.values(cells)[0]?.clock ?? null,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    problems,
    cells,
  };

  const written = writeReportFiles({ run, markdown: renderMarkdown(run) });
  log(`\nResults: ${path.relative(process.cwd(), written.json)}`);
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
    const baseFile = fs.existsSync(compare)
      ? compare
      : resultsPath(resolveRef(compare), platform);
    if (!fs.existsSync(baseFile)) {
      log(
        `\n--compare: no results file at ${baseFile}. Run the bench once with that revision checked out (results are named after their commit), then pass --compare again.`
      );
      exitCode = Math.max(exitCode, 2);
    } else {
      const result = verdict({ base: readJson(baseFile), head: run });
      const section = `\n## head/base vs ${path.basename(baseFile)}\n\n${verdictTable(result)}\n\n${verdictSummary(result)}\n`;
      process.stdout.write(section);
      appendSection(written.md, section);
      if (result.conclusiveFailure && !result.noisy) {
        exitCode = 1;
      }
    }
  }

  if (argv.includes('--update-baseline')) {
    const file = baselinePath(run.deviceKey);
    writeBaseline(file, run);
    log(`Baseline written: ${path.relative(process.cwd(), file)}`);
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
      const result = verdict({
        base: normaliseSide(baseline),
        head: normaliseSide(run),
        normalised: true,
      });
      // After normalisation the control arm is 1.0 by construction, so drift has
      // to be judged on the absolute numbers instead.
      const absoluteDrift = verdict({ base: baseline, head: run });
      result.drift = absoluteDrift.drift.filter((finding) =>
        finding.key.includes(':rn-core:')
      );
      result.noisy = result.drift.length > 0;
      const section = `\n## Check against ${path.basename(file)} (ratios to rn-core)\n\n${verdictTable(result)}\n\n${verdictSummary(result)}\n`;
      process.stdout.write(section);
      appendSection(written.md, section);
      if (result.conclusiveFailure && !result.noisy) {
        exitCode = 1;
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
