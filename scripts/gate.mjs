#!/usr/bin/env node
/**
 * The gate ledger: runs a named gate and records what it proved, keyed to the
 * code tree it ran on.
 *
 *   node scripts/gate.mjs <gate> [--background] [-- <args>]
 *   node scripts/gate.mjs wait [--gate <name>] [--timeout-minutes N]
 *   node scripts/gate.mjs status [--for review|merge]
 *   node scripts/gate.mjs need --for review|merge [--base <ref>]
 *   node scripts/gate.mjs table [--for review|merge] [--full]
 *   node scripts/gate.mjs logs [--branch <b>] [--failed] [--all]
 *   node scripts/gate.mjs ci-import --run <id>
 *
 * Gates: check | harness:<ios|android>[:suite] | real-input:<ios|android> |
 * smoke:<pack|expo|rn-cli> | bench. A filtered run
 * (`harness:android -- ColdSizing`) is recorded as `harness:android:ColdSizing`
 * and does not satisfy the full gate. A device gate reads its device from a
 * sourced `node scripts/lease.mjs acquire`.
 *
 * Each run appends one JSON line to `.gates/<branch>.jsonl`, copies it to
 * `<git-common-dir>/nitro-ui-gate-evidence/<branch>.jsonl` and writes its log to
 * `<git-common-dir>/nitro-ui-gates/<branch>/`; both outlive the worktree.
 * When this branch has no line of its own that decides a gate on the current
 * digest, `status`, `need` and `table` take the newest full run on that digest
 * from the clone-wide record, green or red.
 *
 * `ci-import` records a GitHub Actions run of the Android real-input job as a
 * `real-input:android` line, judged from what the run uploaded. It only reads.
 *
 * Exit codes: a gate run and `wait` exit with the gate's own code; 1 for a gate
 * refused before the run or an unmet `need`; 2 for a usage error; 13 from
 * `wait` while the gate is still running.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { finished } from 'node:stream/promises';

import {
  DEFAULT_WAIT_MINUTES,
  LEDGER_DIR,
  MERGE_GATES,
  PLATFORMS,
  STILL_RUNNING_EXIT,
  WAIT_PROGRESS_INTERVAL_MS,
  backgroundRecordPath,
  changedPathsGitArgs,
  decideNeed,
  decideWait,
  deviceFromEnv,
  deviceGateLeaseRefusal,
  DEVICE_CONTEXT_END,
  DEVICE_CONTEXT_START,
  explainNeedRow,
  formatHow,
  aloneWaitCeilingMs,
  gateEvidenceStoreDir,
  gateLiveStoreDir,
  gateLogStoreDir,
  gateTreesFromEntries,
  gatesTouchedByPaths,
  harnessUnitsFromTimings,
  planRerunFailed,
  completeRerun,
  completionProvenance,
  earlyExitAnswer,
  isolatedSwitchBlock,
  realInputUnitsFromResults,
  isDeviceGate,
  isUsageProbe,
  lastLogLine,
  ledgerFileName,
  judgeDigest,
  ledgerLineFromRun,
  relaxedSwitches,
  formatRelaxed,
  ledgerLogCandidates,
  ledgerRelativePath,
  logNameFor,
  metroPortForGate,
  logRelativePath,
  LOG_RETENTION_DAYS,
  LOG_RETENTION_MAX_BYTES,
  ownBackgroundRecords,
  ownMetroPids,
  parseLedger,
  parseTestCounts,
  parseTestSummaries,
  pidMayBeRunning,
  planLogRetention,
  platformTreesFromEntries,
  platformsOwningFile,
  platformsTouchedByPaths,
  redactForeignDeviceIds,
  renderGateTable,
  renderStepTimings,
  resolveGate,
  runningBackgroundGates,
  storedLogFailed,
  summarizeGates,
  summarizeLoad,
  waitForMachine,
} from './gate-core.mjs';
import {
  GATE_DEATH_EXIT,
  GATE_NAME_ENV,
  GATE_PGID_ENV,
  GATE_PID_ENV,
  RUNNER_LOG_ENV,
  RUNNER_LOG_RELATIVE_ENV,
  RUNNER_RECORD_SUFFIX,
  groupMembers,
  maySweepRunnerGroup,
  stopGroup,
} from './gate-runner.mjs';
import { contentHash, isCodeFile } from './app-stamp-core.mjs';
import {
  SUITE_TIMING_ENV,
  SUITE_TIMING_GATE_ENV,
  formatSuiteTimings,
  readSuiteTiming,
  suiteTimingPath,
} from './harness-suite-timing.mjs';
import { claimDevicesFromEnv } from './device-pool.mjs';
import { REAL_INPUT_UNITS_ENV } from './real-input/report.mjs';
import {
  CI_ARTIFACT,
  CI_FULL_DIR,
  CI_GATE,
  CI_RERUN_DIR,
  ciImportRefusals,
  ciJobOf,
  ciLedgerLine,
} from './gate-ci-core.mjs';
import { checkoutSources, readUploadedRun } from './gate-ci.mjs';
import { diskRefusal, freeDiskGbFrom, isCiRunner } from './doctor-core.mjs';
import {
  emulatorSerial,
  isReservedSerial,
  normalizeDevices,
  metroPreflightFromEnv,
  pidIsAlive,
  portListeners,
  pruneExpired,
  readJson,
  stateHome,
  statePaths,
  writeJsonAtomic,
} from './lease-core.mjs';
import { currentCodeTree, repoRootOf } from './app-stamp.mjs';
import { deadGateBehindPort } from './gate-core.mjs';
import { assertSupportedNodeOrReexec } from './node-version.mjs';

const USAGE =
  'usage: node scripts/gate.mjs <gate> [-- <args>] [--background]\n' +
  '       node scripts/gate.mjs <harness|real-input>:<platform> --rerun-failed [--background]\n' +
  '       node scripts/gate.mjs wait [--gate <name>] [--timeout-minutes N]\n' +
  '       node scripts/gate.mjs status [--for review|merge]\n' +
  '       node scripts/gate.mjs need --for review|merge [--base <ref>]\n' +
  '       node scripts/gate.mjs table [--for review|merge] [--full]\n' +
  '       node scripts/gate.mjs logs [--branch <b>] [--failed] [--all]\n' +
  '       node scripts/gate.mjs ci-import --run <id>\n' +
  '\n' +
  'gates: check | harness:<ios|android>[:suite] | real-input:<ios|android> |\n' +
  '       smoke:<pack|expo|rn-cli> | bench\n' +
  '       (a filtered run is recorded under its own name, eg\n' +
  '        `harness:android -- ColdSizing` -> `harness:android:ColdSizing`, and\n' +
  '        does not satisfy the full gate; `status` and `table` default to the\n' +
  '        stricter review view, `--for merge` shows the merge bar)\n' +
  '       (a device gate reads its device from `node scripts/lease.mjs acquire`;\n' +
  '        a harness/real-input gate needs app.stamp from scripts/build-app.mjs)\n' +
  '\n' +
  '       (NITRO_UI_GATE_DEVICE_FORCE=1 claims a device another live run holds)\n' +
  '       (real-input:ios never runs beside another device gate from this clone:\n' +
  '        whichever starts second waits for the other to end, and gives up after\n' +
  '        NITRO_UI_GATE_ALONE_WAIT_MINUTES, 180 by default)\n' +
  '       (--rerun-failed completes the newest full run of the gate that is red on\n' +
  '        this digest: it re-runs only the units that did not pass and records the\n' +
  '        outcome under the full gate, shown as completed, never as a clean pass)\n' +
  "       (--background is gate.mjs's own flag: beside the gate name or after it, " +
  'never\n' +
  '        after `--`, where the arguments belong to the gate)\n' +
  '       (--background starts a gate detached and returns at once, so waiting\n' +
  '        costs no polling; `wait` then blocks until it ends, prints a progress\n' +
  "        line a minute, and exits with the gate's own code. Exit 13 means\n" +
  '        "still running" - at the --timeout-minutes budget, or on a runner that\n' +
  '        died without recording a result. The ledger line is written by the same\n' +
  '        code either way, so a backgrounded gate is evidence exactly as a\n' +
  '        foreground one is)\n' +
  '\n' +
  '       (`ci-import` reads a GitHub Actions run of the "Real input (Android)" job\n' +
  '        with gh and records it as real-input:android, judged from the report it\n' +
  '        uploaded. It refuses unless the run is finished and of HEAD, and the\n' +
  '        worktree is clean. It never dispatches or writes to GitHub)\n' +
  '\n' +
  "       (`logs` lists this clone's stored gate logs - they live in the git common\n" +
  '        directory, so removing a worktree cannot lose them; --failed limits the\n' +
  "        list to runs the store's own record says failed (a log it cannot judge is\n" +
  '        reported as unknown, not silently skipped), --all shows every branch)\n';

/** Sampled across the whole run, so the ledger's load is not one moment's. */
const LOAD_SAMPLE_INTERVAL_MS = 15_000;

/**
 * Forwarded to the child so it can clean up, then re-raised on this process so
 * the exit status is still the signal.
 */
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** The flags this script owns on a gate run; they never reach the gate. */
const BACKGROUND_FLAGS = ['--background', '--background=true'];
const RERUN_FAILED_FLAG = '--rerun-failed';
const OWN_FLAGS = [...BACKGROUND_FLAGS, RERUN_FAILED_FLAG];

/** `NITRO_UI_GATE_DEVICE_FORCE` values: claim a device another run holds. */
const DEVICE_FORCE_RE = /^(1|true|yes)$/i;

/** `NITRO_UI_GATE_METRO_FORCE` values: start on a Metro port already served. */
const METRO_FORCE_RE = /^(1|true|yes)$/i;

/**
 * How long a finished run's output may drain before the ledger is written:
 * enough for the tail of a test summary, bounded so a leaked descendant holding
 * the pipes cannot keep the run open.
 */
const EXIT_DRAIN_MS = 2_000;

const repoRoot = repoRootOf();

function git(args, fallback = null) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) return fallback;
  return String(result.stdout).trim();
}

function currentBranch() {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], 'HEAD') || 'detached';
}

function ledgerFile(branch) {
  return path.join(repoRoot, ledgerRelativePath(branch));
}

/* ----------------------- the clone's gate log store ----------------------- */

/**
 * Where run logs, background records and step timings live:
 * `<git-common-dir>/nitro-ui-gates/<branch>/<gate>-<started-at>.log`. The git
 * common dir is shared by every worktree and survives `git worktree remove`.
 * Falls back to the worktree's `.gates/` when git cannot be asked.
 * `NITRO_UI_GATE_LOG_STORE` overrides the location, for tests.
 */
function store(env = process.env) {
  if (store.cached == null) {
    const fromEnv = env.NITRO_UI_GATE_LOG_STORE;
    const common =
      fromEnv != null && fromEnv !== ''
        ? path.resolve(fromEnv)
        : git(['rev-parse', '--git-common-dir'], null);
    const commonDir =
      common == null || common === ''
        ? null
        : path.resolve(repoRoot, String(common).trim());
    store.cached = {
      dir:
        commonDir == null
          ? path.join(repoRoot, LEDGER_DIR, 'logs')
          : gateLogStoreDir(commonDir),
      // Whether that is a real shared store or the worktree fallback.
      shared: commonDir != null,
      commonDir,
      // The store is shared by every worktree of the clone, so each record
      // names the checkout that wrote it.
      worktree: repoRoot,
    };
  }
  return store.cached;
}

function storeLogsDir() {
  return store().dir;
}

/**
 * `fs.realpathSync` that also answers for a path that does not exist yet: the
 * nearest existing ancestor is resolved and the rest re-joined. Callers compare
 * by prefix, and on macOS `/var` is a symlink to `/private/var`.
 */
function realpathOrResolved(file) {
  const absolute = path.resolve(file);
  try {
    return fs.realpathSync(absolute);
  } catch {
    /* the file, or a parent of it, does not exist yet */
  }
  let tail = [];
  let cursor = absolute;
  for (;;) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return absolute;
    tail = [path.basename(cursor), ...tail];
    cursor = parent;
    try {
      return path.join(fs.realpathSync(cursor), ...tail);
    } catch {
      /* keep walking */
    }
  }
}

/**
 * The paths of one run: the absolute log, the ledger's store-relative spelling
 * of it and the record beside it. `fromEnv` is the log a background launcher
 * already opened.
 */
function logPathsFor({ branch, gate, startedAt, fromEnv = null }) {
  // Real paths throughout: the checks below are prefix tests.
  const storeDir = realpathOrResolved(storeLogsDir());
  let absolute = null;
  if (fromEnv != null && fromEnv !== '') {
    const candidate = realpathOrResolved(path.resolve(fromEnv));
    const ownBranchDir = path.join(
      storeDir,
      ledgerFileName(branch).replace(/\.jsonl$/, '')
    );
    // Only this branch's own directory, where its launcher writes: the store is
    // shared by the whole clone, and a leaked `NITRO_UI_GATE_LOG` must not make
    // this run append to another run's log and mark that run's record done.
    const allowed =
      candidate.endsWith('.log') &&
      candidate.startsWith(`${ownBranchDir}${path.sep}`);
    if (!allowed) {
      process.stderr.write(
        `gate: ignoring NITRO_UI_GATE_LOG=${fromEnv} - a background gate's log has to be a .log inside ${ownBranchDir}\n`
      );
    } else {
      absolute = candidate;
    }
  }
  const backgrounded = absolute != null;
  if (absolute == null) {
    absolute = path.join(
      storeDir,
      logRelativePath(branch, logNameFor(gate, startedAt))
    );
  }
  const logPath = path.relative(storeDir, absolute).split(path.sep).join('/');
  return {
    logPath,
    absolute,
    recordPath: backgroundRecordPath(absolute),
    backgrounded,
  };
}

function resolveLedgerLog(entry) {
  return ledgerLogCandidates(entry, {
    storeDir: storeLogsDir(),
    repoRoot,
    existsSync: (file) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    },
  });
}

/**
 * Applies the retention rule to the store. A recently written log is never
 * removed, so a run in flight in any worktree keeps its file.
 */
function pruneLogStore(options = {}) {
  const logs = listStoredLogs(storeLogsDir());
  const plan = planLogRetention(logs, {
    protectNewerThan: runningLogGraceMs(),
  });
  const removed = [];
  for (const victim of plan.victims) {
    if (options.dryRun !== true) {
      try {
        fs.rmSync(victim.file, { force: true });
      } catch {
        continue;
      }
    }
    removed.push(victim);
  }
  return {
    removed,
    scanned: logs.length,
    bytes: plan.keptBytes,
    kept: plan.kept,
  };
}

/** Applies retention and reports on stderr what it removed, if anything. */
function pruneStoredLogs(context = 'gate') {
  const pruning = pruneLogStore();
  if (pruning.removed.length > 0) {
    process.stderr.write(
      `${context}: retention removed ${String(pruning.removed.length)} stored log file(s) (${pruning.removed
        .map((victim) => victim.reason)
        .join(
          ', '
        )}) \u2014 ${String(LOG_RETENTION_DAYS)} days, ${formatBytes(LOG_RETENTION_MAX_BYTES)} cap\n`
    );
  }
  return pruning;
}

/**
 * How long a log is untouchable: two hours, extended to cover the oldest
 * running background gate. A foreground run has no record to read, so only its
 * log's mtime protects it.
 */
function runningLogGraceMs() {
  const base = 2 * 60 * 60_000;
  let grace = base;
  for (const record of runningBackgroundGates(
    listBackgroundRecords(storeLogsDir())
  )) {
    if (record.startedAt == null) continue;
    grace = Math.max(grace, Date.now() - record.startedAt + 30 * 60_000);
  }
  return grace;
}

/** Every stored log, with the size and mtime retention reads. */
function listStoredLogs(dir) {
  const found = [];
  const walk = (current) => {
    let names;
    try {
      names = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      // A run's sidecar files are swept with its log. A sidecar suffix missing
      // from this pattern is never deleted and grows the store past its cap.
      if (
        !/\.(log|gate\.json|steps\.json|suites\.json|isolated\.json|runner\.json)$/.test(
          entry.name
        )
      )
        continue;
      try {
        const stats = fs.statSync(absolute);
        found.push({
          file: absolute,
          bytes: stats.size,
          mtimeMs: stats.mtimeMs,
        });
      } catch {
        /* raced with another prune; not on the list */
      }
    }
  };
  walk(dir);
  return found;
}

function readLedger(branch) {
  const file = ledgerFile(branch);
  if (!fs.existsSync(file)) return { entries: [], file, exists: false };
  return {
    entries: parseLedger(fs.readFileSync(file, 'utf8')),
    file,
    exists: true,
  };
}

function appendLedgerLine(branch, line) {
  const file = ledgerFile(branch);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
  appendEvidenceLine(branch, line);
  return file;
}

/** The clone-wide record's directory, or `null` when git has no common dir to give. */
function evidenceDir() {
  const { commonDir } = store();
  return commonDir == null ? null : gateEvidenceStoreDir(commonDir);
}

/**
 * Copies a ledger line into the clone-wide record. A failure costs only the
 * evidence other branches could have used, so it is reported and the run stands.
 */
function appendEvidenceLine(branch, line) {
  const dir = evidenceDir();
  if (dir == null) return;
  const file = path.join(dir, ledgerFileName(branch));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
  } catch (error) {
    process.stderr.write(
      `ledger: could not copy this run to ${file} (${String(error?.message ?? error)}): other branches will not see it\n`
    );
  }
}

/**
 * Every line in the clone-wide record, from every branch including this one.
 * A line's `branch` is taken from the file it is in, which is where it was
 * recorded. Only lines `foreignVerdict` accepts ever decide anything.
 */
function readEvidence() {
  const dir = evidenceDir();
  if (dir == null) return [];
  return ledgersUnder(dir).flatMap(({ branch, entries }) =>
    entries
      .filter((entry) => !entry.corrupt)
      .map((entry) => ({ ...entry, branch }))
  );
}

/**
 * Read-only probes of what a failed device gate was running on: the booted
 * simulators, the leased emulator's state, the lease list, the load and, on
 * Android, the app's logcat tail. The device comes from the lease record, never
 * from the environment, and adb is only ever asked about that one serial.
 */
function collectDeviceContext({
  platform,
  lease,
  env = process.env,
  run = runProbe,
  leaseFile = null,
  devicesFile = null,
  now = Date.now(),
}) {
  const probes = [];
  const note = (label, text) => {
    probes.push({ label, ok: false, text });
  };
  const add = (label, command, args, limit = 40) => {
    if (command == null) {
      note(label, `(no command configured for ${label})`);
      return null;
    }
    const answer = run(command, args);
    if (answer == null || answer.ok !== true) {
      note(
        label,
        `(${command} ${args.join(' ')} gave no answer: ${String(
          answer?.text ?? 'did not run or exited non-zero'
        )})`
      );
      return null;
    }
    const lines = String(answer.text)
      .split('\n')
      .filter((line) => line.trim() !== '');
    const kept = lines.slice(-limit);
    probes.push({
      label: `${label}${lines.length > kept.length ? ` (last ${String(kept.length)} of ${String(lines.length)} lines)` : ''}`,
      ok: true,
      text: kept.join('\n'),
    });
    return kept;
  };

  add(
    'xcrun simctl list devices booted',
    env.NITRO_UI_SIMCTL_BIN ?? 'xcrun',
    ['simctl', 'list', 'devices', 'booted'],
    40
  );

  const claimed = claimedDevice({ lease, env, leaseFile, devicesFile, now });
  const adb = env.NITRO_UI_ADB_BIN ?? adbFromSdk(env);
  const serial = claimed.serial;
  // A leased pair holds a simulator and an emulator, so an iOS gate must not
  // probe the emulator it never touched.
  const asksAdb = platform === 'android';
  if (!asksAdb) {
    note(
      'adb get-state',
      '(not an Android gate, so no emulator is asked about)'
    );
  } else if (claimed.reason != null) {
    note('adb get-state', claimed.reason);
  } else if (serial == null || serial === '') {
    note('adb get-state', `(${claimed.missing})`);
  } else {
    add('adb get-state', adb, ['-s', String(serial), 'get-state'], 10);
  }

  probes.push({
    label: 'leases',
    ok: true,
    text: describeLeases({ lease, leaseFile: claimed.file, now }),
  });
  const load1 = os.loadavg()[0];
  probes.push({
    label: 'load',
    ok: Number.isFinite(load1),
    text: Number.isFinite(load1)
      ? `  load1 at the moment of failure: ${load1.toFixed(2)} (the ledger line carries the samples across the whole run)`
      : '  (os.loadavg() gave no answer)',
  });

  if (platform === 'android') {
    const bundleId = env.NITRO_UI_EXAMPLE_BUNDLE_ID ?? 'nitroui.example';
    if (claimed.reason != null) {
      note('logcat', claimed.reason);
    } else if (serial == null || serial === '') {
      note(
        'logcat',
        `(${claimed.missing}, and an unqualified logcat would read whoever’s device the adb server has)`
      );
    } else {
      const pidAnswer = run(adb, [
        '-s',
        String(serial),
        'shell',
        'pidof',
        bundleId,
      ]);
      const pid = String(pidAnswer?.ok === true ? pidAnswer.text : '')
        .trim()
        .split(/\s+/)[0];
      if (pid == null || pid === '') {
        note(
          `logcat --pid ${bundleId}`,
          `(no ${bundleId} process on ${String(serial)})`
        );
      } else {
        add(
          'logcat',
          adb,
          ['-s', String(serial), 'logcat', '-d', '--pid', pid],
          LOGCAT_TAIL_LINES
        );
      }
    }
  }
  // The probes are host-wide (simctl lists every booted simulator, adb names
  // serials in its error text), so identifiers this run does not own are
  // redacted from every answer.
  const own = deviceFromEnv(env, platform);
  return probes.map((probe) => ({
    ...probe,
    text: redactForeignDeviceIds(String(probe.text), {
      udid: claimed.udid,
      serial: claimed.serial,
      device: own.device,
    }),
  }));
}

/**
 * The device this run may ask about, from its own lease in `leases.json` and
 * that lease's pair in `devices.json`. Anything unreadable, unleased or expired
 * sets `reason`, which means "do not probe".
 */
function claimedDevice({
  lease,
  env = process.env,
  leaseFile = null,
  devicesFile = null,
  now = Date.now(),
}) {
  const paths = statePaths(stateHome(env));
  const file = leaseFile ?? paths.leases ?? null;
  const out = {
    file,
    reason: null,
    missing: 'no serial in the lease record',
    serial: null,
    udid: null,
    entry: null,
  };
  if (lease == null || lease === '') {
    out.reason =
      '(this run holds no lease, so no device is ours to ask — the block records that rather than reading someone else’s emulator)';
    return out;
  }
  let entry = null;
  try {
    const state = pruneExpired(readJson(file, { leases: [] }), now);
    entry = (state.leases ?? []).find((row) => row?.id === lease) ?? null;
  } catch (error) {
    out.reason = `(could not read the lease file: ${String(error?.message ?? error)})`;
    return out;
  }
  if (entry == null) {
    out.reason = `(lease ${lease} is no longer live, so its device is not ours to ask)`;
    return out;
  }
  out.entry = entry;
  const holds = Array.isArray(entry.holds) ? entry.holds : [];
  // Not `normalizeDevices`: it rejects the whole file over one bad pair, and a
  // diagnostic should still read the pair it needs.
  try {
    const config = readJson(devicesFile ?? paths.devices, {});
    for (const pair of Array.isArray(config?.pairs) ? config.pairs : []) {
      if (!holds.includes(pair?.id)) continue;
      if (pair.android?.emulatorPort != null) {
        out.serial = emulatorSerial(pair.android.emulatorPort);
      }
      if (pair.ios?.udid != null) out.udid = pair.ios.udid;
    }
  } catch (error) {
    out.missing = `the lease holds ${holds.join(', ') || 'no pair'}, and devices.json could not be read (${String(error?.message ?? error)})`;
    return out;
  }
  if (out.serial == null && platformWantsAndroid(entry)) {
    out.missing = `the lease holds ${holds.join(', ') || 'no pair'}, which has no emulator serial in devices.json`;
  }
  // Refused here so every adb command is covered. The lease tooling never
  // grants this serial, but `devices.json` can be edited by hand.
  if (isReservedSerial(out.serial)) {
    out.reason = `(refused: ${out.serial} is the maintainer’s reserved emulator, and no gate may address it)`;
    out.serial = null;
  }
  return out;
}

function platformWantsAndroid(entry) {
  const platform = String(entry?.platform ?? '');
  return platform === 'android' || platform === 'both';
}

const LOGCAT_TAIL_LINES = 500;

/**
 * Runs one probe. `ok: false` means "no answer" and its text is an error
 * message, never data: `pidof` output becomes the next command's argument.
 */
function runProbe(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    });
    if (result.status !== 0) {
      const detail = String(result.stderr ?? '')
        .trim()
        .split('\n')
        .slice(0, 3)
        .join(' / ');
      return {
        ok: false,
        text:
          detail === ''
            ? `exited ${String(result.status)}`
            : `${detail} (exited ${String(result.status)})`,
      };
    }
    return { ok: true, text: result.stdout ?? '' };
  } catch (error) {
    return { ok: false, text: String(error?.message ?? error) };
  }
}

/** Where `adb` lives, or the bare name when no SDK root is set. */
function adbFromSdk(env) {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  return sdk != null && fs.existsSync(path.join(sdk, 'platform-tools/adb'))
    ? path.join(sdk, 'platform-tools/adb')
    : 'adb';
}

/** The live leases, and whether this run's own lease is still among them. */
function describeLeases({ lease, leaseFile, now }) {
  try {
    const file =
      leaseFile ?? path.join(statePaths(stateHome(process.env)).leases);
    const state = readJson(file, { leases: [] });
    const live = pruneExpired(state, now).leases ?? [];
    const rows = live.map((entry) => {
      const holds = Array.isArray(entry.holds) ? entry.holds.join(',') : '';
      return `  ${String(entry.id ?? '?').padEnd(24)} ${String(entry.task ?? '?').padEnd(12)} ${String(entry.platform ?? '?').padEnd(8)}${entry.exclusive ? 'exclusive ' : ''.padEnd(10)}${holds}`;
    });
    const mine = live.some((entry) => entry.id === lease);
    return [
      '  lease file: <lease file>',
      `  this run's lease: ${String(lease ?? 'none')}${lease == null ? '' : mine ? ' (still live)' : ' (no longer live)'}`,
      ...(rows.length === 0 ? ['  (no live leases)'] : rows),
    ].join('\n');
  } catch (error) {
    return `  (could not read the lease file: ${String(error?.message ?? error)})`;
  }
}

/**
 * The block appended to a failed run's log, framed by the device-context
 * markers. Paths are written as placeholders (`<store>/…`, `<repo>`).
 */
function renderDeviceContext(probes, { logPath = null } = {}) {
  const lines = [
    DEVICE_CONTEXT_START,
    `gate: log in the store: ${logPath == null ? 'not recorded' : `<store>/${logPath}`} (checkout <repo>)`,
  ];
  for (const probe of probes) {
    lines.push(`gate: ${probe.label}${probe.ok ? '' : ' [unavailable]'}`);
    for (const line of String(probe.text).split('\n')) {
      lines.push(`  | ${line}`);
    }
  }
  lines.push(DEVICE_CONTEXT_END);
  return lines.join('\n');
}

/** A JSON file a run left behind, or null when it is missing or unreadable. */
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The per-step timings `check.mjs` left behind, or null on any problem (no
 * file, unreadable, wrong shape): a missing breakdown is not a failed run.
 */
function readStepTimings(file) {
  if (file == null) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (
    parsed == null ||
    typeof parsed !== 'object' ||
    !Array.isArray(parsed.steps) ||
    parsed.steps.some((step) => typeof step?.name !== 'string')
  ) {
    return null;
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    jobs: typeof parsed.jobs === 'number' ? parsed.jobs : null,
    wallMs:
      typeof parsed.wallMs === 'number' ? Math.round(parsed.wallMs) : null,
    steps: parsed.steps,
  };
}

/* ---------------------------- backgrounded gates --------------------------- */

/**
 * A background gate's record, or null when it is missing or unreadable. `wait`
 * polls this file while another process writes it, so a torn read means "no
 * record yet", not an error.
 */
function readBackgroundRecord(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The records `wait` and `status` consider: this checkout's backgrounded runs.
 * A `foreground` record exists only so `logs --failed` can name an outcome, and
 * is never something to wait for.
 */
function ownRunningGates(records, own) {
  return ownBackgroundRecords(
    (records ?? []).filter((record) => record?.foreground !== true),
    own
  );
}

/** The `{branch, worktree}` pair a record has to match to be ours. */
function ownRecordScope() {
  return { branch: currentBranch(), worktree: store().worktree };
}

/**
 * The lease state a device gate is checked against: the same `leases.json` and
 * `devices.json` that `lease.mjs list` prints. An unreadable device pool is its
 * own refusal (`poolProblem`), not "no lease".
 */
function leaseStoreForGate(env = process.env) {
  const paths = statePaths(stateHome(env));
  let leases = [];
  try {
    // Unpruned, so a refusal can tell a released lease from an expired one.
    leases = readJson(paths.leases, { leases: [] }).leases ?? [];
  } catch (error) {
    // An unreadable lease file is the same as none: every device gate is
    // refused.
    process.stderr.write(
      `gate: could not read ${paths.leases}: ${String(error?.message ?? error)}\n`
    );
  }
  try {
    return {
      leases,
      pairs: normalizeDevices(readJson(paths.devices, {})).pairs,
      poolProblem: null,
    };
  } catch (error) {
    const reason = String(error?.message ?? error)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join(' ')
      .slice(0, 400);
    return {
      leases,
      pairs: null,
      poolProblem: `${reason} (node scripts/doctor.mjs --setup creates the pool)`,
    };
  }
}

/**
 * The refusal message for a device gate that no live lease authorises, or
 * null. Nothing is recorded for a refusal: the run never started, so a red row
 * would be evidence about nothing.
 */
function deviceGateLeaseBlock(resolved, env = process.env) {
  if (!isDeviceGate(resolved)) return null;
  return deviceGateLeaseRefusal({
    env,
    resolved,
    now: Date.now(),
    ...leaseStoreForGate(env),
  });
}

/**
 * The refusal message for a device gate on a disk too full to finish it, or
 * null. Measured on the volume the gate's build, Metro cache and log go to.
 */
function deviceGateDiskBlock(resolved, env = process.env) {
  if (!isDeviceGate(resolved)) return null;
  let measuredGb = null;
  try {
    const stats = fs.statfsSync(process.cwd());
    measuredGb = Math.floor((stats.bavail * stats.bsize) / 2 ** 30);
  } catch {
    // Best effort: an unreadable volume is not a refusal.
  }
  return diskRefusal({
    freeGb: freeDiskGbFrom(env, measuredGb),
    ci: isCiRunner(env),
  });
}

/**
 * Starts a gate detached and returns 0 once it is confirmed running. It re-runs
 * this same command without the flag, with stdout and stderr pointed at the
 * log, so the ledger line is written by the same code as a foreground run.
 */
async function startBackgroundGate(name, resolved) {
  const startedAt = Date.now();
  pruneStoredLogs('gate');
  const logsDir = storeLogsDir();
  fs.mkdirSync(logsDir, { recursive: true });
  const {
    logPath,
    absolute: absoluteLog,
    recordPath,
  } = logPathsFor({
    branch: currentBranch(),
    gate: name,
    startedAt,
  });
  // The branch subdirectory: a first run on a new branch has none yet.
  fs.mkdirSync(path.dirname(absoluteLog), { recursive: true });
  const logHandle = fs.openSync(absoluteLog, 'a');

  // Written before the child starts, so a `wait` run a moment later finds a
  // record. `branch` and `worktree` tell this checkout's runs from the other
  // worktrees' runs in the shared store.
  writeJsonAtomic(recordPath, {
    version: 1,
    gate: name,
    command: resolved.argv.join(' '),
    pid: null,
    startedAt,
    logPath,
    recordPath,
    done: false,
    branch: currentBranch(),
    worktree: store().worktree,
  });

  const childArgs = [
    process.argv[1],
    ...process.argv.slice(2).filter((arg) => !BACKGROUND_FLAGS.includes(arg)),
  ];
  const child = spawn(process.execPath, childArgs, {
    cwd: repoRoot,
    env: { ...process.env, NITRO_UI_GATE_LOG: absoluteLog },
    stdio: ['ignore', logHandle, logHandle],
    detached: true,
  });
  fs.closeSync(logHandle);

  if (child.pid == null) {
    writeJsonAtomic(recordPath, {
      ...readBackgroundRecord(recordPath),
      done: true,
      finishedAt: Date.now(),
      exitCode: 1,
      error: 'could not start the gate process',
    });
    process.stderr.write(`gate: could not start ${name} in the background\n`);
    return 1;
  }

  // Record the pid, but only while the record still says "not done": a gate
  // that finished between the spawn and this write must not be marked running
  // again.
  const before = readBackgroundRecord(recordPath);
  if (before?.done !== true) {
    writeJsonAtomic(recordPath, { ...before, pid: child.pid });
  }
  // A short wait, so a gate that fails to start is reported now and not by
  // `wait` later.
  const earlyExit = await new Promise((resolvePromise) => {
    // The timer and the child stay ref'd until this settles: with both unref'd
    // the event loop empties and Node exits 13 on the pending top-level await.
    const timer = setTimeout(() => resolvePromise(null), 750);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
  child.unref();
  if (earlyExit != null) {
    const answer = earlyExitAnswer({
      name,
      earlyExit,
      record: readBackgroundRecord(recordPath),
      logPath,
      now: Date.now(),
    });
    process.stderr.write(answer.message);
    if (answer.record != null) writeJsonAtomic(recordPath, answer.record);
    return answer.code;
  }

  process.stdout.write(
    `gate: ${name} started in the background (pid ${String(child.pid)})\n` +
      `gate: log    ${logPath}\n` +
      `gate: wait   node scripts/gate.mjs wait --gate ${name}\n`
  );
  return 0;
}

/**
 * Blocks until a backgrounded gate finishes, printing one progress line a
 * minute. Returns the gate's own exit code, or `STILL_RUNNING_EXIT` at the
 * timeout or when the runner died without recording a result.
 */
async function commandWait({ gate, timeoutMinutes }) {
  const timeoutMs = timeoutMinutes * 60_000;
  const startedWaiting = Date.now();
  const logsDir = storeLogsDir();
  const records = ownRunningGates(
    listBackgroundRecords(logsDir),
    ownRecordScope()
  ).filter((record) => gate == null || record.gate === gate);
  if (records.length === 0) {
    process.stderr.write(
      `wait: no background gate${gate == null ? '' : ` named ${gate}`} in ${logsDir}\n` +
        'wait: start one with `node scripts/gate.mjs <gate> --background`\n'
    );
    return 2;
  }
  // Newest first: several runs of one gate on a branch are normal, and `wait`
  // means the latest.
  records.sort((a, b) => Number(b.startedAt ?? 0) - Number(a.startedAt ?? 0));
  const target = records[0];
  const absoluteLog =
    resolveLedgerLog({ logPath: target.logPath }).file ?? 'dev/null';
  process.stderr.write(
    `wait: ${target.gate} (pid ${String(target.pid ?? '?')}) - budget ${String(timeoutMinutes)} min\n`
  );

  let printedAt = 0;
  for (;;) {
    const elapsedMs = Date.now() - startedWaiting;
    const record = readBackgroundRecord(target.recordPath) ?? target;
    // This run's ledger line, matched on its log path: the one field unique to
    // a run. It is the fallback answer when the runner died.
    const ledgerEntry = readLedger(currentBranch()).entries.find(
      (entry) => entry.logPath === target.logPath
    );
    const decision = decideWait({
      record,
      pidAlive:
        record.done === true || pidMayBeRunning(Number(record.pid ?? -1)),
      elapsedMs,
      timeoutMs,
      progress: lastLogLine(
        fs.existsSync(absoluteLog) ? fs.readFileSync(absoluteLog, 'utf8') : ''
      ),
      ledgerEntry: ledgerEntry ?? null,
    });
    const firstOfMinute = elapsedMs - printedAt >= WAIT_PROGRESS_INTERVAL_MS;
    if (decision.kind === 'running') {
      if (printedAt === 0 || firstOfMinute) {
        printedAt = elapsedMs;
        process.stderr.write(`gate: ${decision.message}\n`);
      }
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, Math.min(2_000, WAIT_PROGRESS_INTERVAL_MS))
      );
      continue;
    }
    process.stderr.write(
      `gate: ${decision.message}${decision.kind === 'exit' && decision.exitCode === STILL_RUNNING_EXIT ? '' : ` (${String(Math.round(elapsedMs / 1000))}s)`}\n`
    );
    return decision.exitCode;
  }
}

/**
 * Every background record in the log store. Walks it, because logs sit in
 * per-branch directories and branch names nest.
 */
function listBackgroundRecords(logsDir) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.gate.json')) continue;
      found.push(absolute);
    }
  };
  walk(logsDir);
  return found
    .map((file) => readBackgroundRecord(file))
    .filter((record) => record != null);
}

/**
 * The digests a decision needs: the full code tree and its two platform
 * halves. The file listing and hashing must match `currentCodeTree()`, so a
 * half is the same hash over a subset of the same files.
 */
function readTrees() {
  const full = currentCodeTree({ repoRoot });
  const listing = git(
    [
      '-c',
      'core.quotepath=false',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ],
    ''
  );
  const entries = {};
  for (const file of String(listing).split('\0')) {
    if (file === '' || !isCodeFile(file)) continue;
    // Tooling and docs are in no platform's half.
    if (platformsOwningFile(file).length === 0) continue;
    const absolute = path.join(repoRoot, file);
    let stats;
    try {
      stats = fs.lstatSync(absolute);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      entries[file] = contentHash(`link:${fs.readlinkSync(absolute)}`);
    } else if (stats.isFile()) {
      entries[file] = contentHash(fs.readFileSync(absolute));
    }
  }
  return {
    ...full,
    trees: platformTreesFromEntries(entries),
    gateTrees: gateTreesFromEntries(entries),
    judge: judgeDigest((file) => {
      try {
        return fs.readFileSync(path.join(repoRoot, file));
      } catch {
        return null;
      }
    }),
  };
}

/**
 * The code paths this branch changed against the base: the committed diff,
 * uncommitted tracked edits and untracked new files, which `git diff` misses.
 */
function changedCodePaths({ base }) {
  const mergeBase = git(['merge-base', base, 'HEAD']);
  if (mergeBase == null || mergeBase === '') {
    // No merge-base (a shallow clone, a missing base ref): report unknown, so
    // `need` asks for both platforms instead of reading the diff as empty.
    return { paths: [], base: null, unknown: true };
  }
  const paths = new Set();
  for (const args of changedPathsGitArgs(mergeBase)) {
    const out = git(args, '');
    for (const line of out.split('\n')) {
      if (line.trim() !== '') paths.add(line.trim());
    }
  }
  return { paths: [...paths], base: mergeBase, unknown: false };
}

/** The live-run markers' directory: beside the log store, or the worktree fallback. */
function liveStoreDir() {
  const { commonDir } = store();
  return commonDir == null
    ? path.join(repoRoot, LEDGER_DIR, 'live')
    : gateLiveStoreDir(commonDir);
}

/** Reads, writes and removes the live-run markers, one `<pid>.json` each. */
function liveStoreIo(dir = liveStoreDir()) {
  const fileOf = (marker) =>
    path.join(dir, `${String(Number(marker.pid))}.json`);
  return {
    list() {
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return [];
      }
      return names
        .filter((name) => /^\d+\.json$/.test(name))
        .map((name) => readBackgroundRecord(path.join(dir, name)))
        .filter((marker) => marker != null);
    },
    write(marker) {
      fs.mkdirSync(dir, { recursive: true });
      writeJsonAtomic(fileOf(marker), marker);
    },
    remove(marker) {
      fs.rmSync(fileOf(marker), { force: true });
    },
  };
}

/**
 * Holds a device gate until it may share the machine with every live device gate
 * from this clone, and returns how to give the machine back, or the exit code of
 * a gate that waited to its ceiling. Nothing is recorded for a refusal; a
 * backgrounded run marks its record done, so `wait` returns its code.
 */
async function takeMachine(name, resolved, options = {}) {
  if (!isDeviceGate(resolved)) return { code: 0, leave: () => {} };
  const io = liveStoreIo();
  const me = { pid: process.pid };
  const answer = await waitForMachine({
    gate: name,
    pid: process.pid,
    meta: { branch: currentBranch(), worktree: store().worktree },
    io,
    isAlive: pidMayBeRunning,
    now: Date.now,
    sleep: (ms) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
    ceilingMs: aloneWaitCeilingMs(process.env),
    say: (line) => process.stderr.write(`${line}\n`),
  });
  if (!answer.ok) {
    process.stderr.write(`gate: refused before the run - ${answer.message}\n`);
    if (options.logFile != null) {
      const recordPath = backgroundRecordPath(options.logFile);
      const record = readBackgroundRecord(recordPath);
      if (record != null && record.done !== true) {
        writeJsonAtomic(recordPath, {
          ...record,
          done: true,
          finishedAt: Date.now(),
          exitCode: 1,
          error: answer.message,
        });
      }
    }
    return { code: 1, leave: () => {} };
  }
  const leave = () => {
    process.removeListener('exit', leave);
    try {
      io.remove(me);
    } catch {
      /* a process that is gone counts as ended anyway */
    }
  };
  process.once('exit', leave);
  return { code: 0, leave };
}

async function runGate(name, resolved, options = {}) {
  const machine = await takeMachine(name, resolved, options);
  if (machine.code !== 0) return machine.code;
  try {
    return await runGateOnMachine(name, resolved, options);
  } finally {
    machine.leave();
  }
}

/**
 * Runs one gate while holding a claim on its lease's devices, so a reap cannot
 * power them off mid-run and a second gate on the same device is refused. The
 * claim is a pid: it ends with this process even when the run is killed. The
 * Metro port is checked separately, because a server can outlive the lease
 * that started it and then no claim exists to conflict with.
 */
async function runGateOnMachine(name, resolved, options = {}) {
  let claim = null;
  if (resolved.platform != null) {
    // Everything below, the runner included, reads `METRO_PORT`.
    const port = metroPortForGate(resolved.platform, process.env);
    if (port != null && port !== process.env.METRO_PORT) {
      process.stderr.write(
        `gate: ${name} runs Metro on ${port}, the lease's ${resolved.platform} port\n`
      );
      process.env.METRO_PORT = port;
    }
    const preflight = metroPreflight();
    if (preflight !== 0) return preflight;
    try {
      claim = claimDevicesFromEnv({
        gate: name,
        platform: resolved.platform,
        force: DEVICE_FORCE_RE.test(
          process.env.NITRO_UI_GATE_DEVICE_FORCE ?? ''
        ),
      });
    } catch (error) {
      process.stderr.write(`gate: ${error.message}\n`);
      return 1;
    }
    if (claim != null)
      process.stderr.write(
        `gate: claimed ${claim.keys.join(', ')} for this run\n`
      );
  }
  try {
    return await runGateUnclaimed(name, resolved, options);
  } finally {
    // Best effort: a failed release must not fail the run.
    if (claim != null) {
      try {
        claim.pool.releaseClaim(claim);
      } catch {
        /* the claim expires with this pid */
      }
    }
  }
}

/**
 * Stops a Metro server the run that just ended left on the leased port, and
 * returns the pids it stopped. Only listeners in the run's own process group
 * are touched: the child is spawned detached, so its descendants report that
 * group and no other task's server does. Never throws.
 */
async function stopOwnMetro({
  port,
  leaderPid,
  groupOf = processGroupId,
  kill = (pid, signal) => process.kill(pid, signal),
  isAlive = pidIsAlive,
  log = () => {},
}) {
  const value = Number(port ?? '');
  if (!Number.isInteger(value) || value <= 0 || leaderPid == null) return [];
  let answer;
  try {
    answer = portListeners({ port: value });
  } catch {
    return [];
  }
  if (!answer.checked || answer.listeners.length === 0) return [];
  const owned = ownMetroPids({
    listeners: answer.listeners,
    leaderPid,
    groupOf,
  });
  if (owned.length === 0) {
    // Somebody else's Metro on our port: leave it standing.
    return [];
  }
  // SIGTERM first: Metro tidies up on a term, and a killed one can leave a
  // lock file.
  for (const pid of owned) {
    try {
      kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  // A bounded synchronous wait: nothing else needs the event loop at the end
  // of a run.
  for (let waited = 0; waited < 10; waited += 1) {
    if (owned.every((pid) => !isAlive(pid))) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  for (const pid of owned) {
    if (!isAlive(pid)) continue;
    try {
      kill(pid, 'SIGKILL');
      log(`gate: Metro pid ${String(pid)} ignored SIGTERM and was killed\n`);
    } catch {
      /* gone between the check and the signal */
    }
  }
  return owned;
}

/** The process group id of `pid`, or null when `ps` gives none (a dead pid). */
function processGroupId(pid) {
  try {
    const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (result.status !== 0) return null;
    const group = Number(String(result.stdout ?? '').trim());
    return Number.isInteger(group) && group > 0 ? group : null;
  } catch {
    return null;
  }
}

/**
 * The sidecars `gate-runner.mjs` writes: which process group belongs to which
 * gate run. Scans every branch, because a leftover Metro server can come from
 * any branch's dead gate.
 */
function readRunnerRecords(logsDir) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith(RUNNER_RECORD_SUFFIX)) continue;
      try {
        const record = JSON.parse(fs.readFileSync(absolute, 'utf8'));
        found.push({ ...record, recordFile: absolute });
      } catch {
        // An unreadable sidecar describes a run nobody can attribute.
      }
    }
  };
  walk(logsDir);
  return found;
}

/**
 * The extra warning for a Metro port served by a gate that died without a
 * ledger line, or null when the server belongs to a live run or to none this
 * store knows.
 */
function deadGateHint({
  listeners,
  env = process.env,
  records = () => readRunnerRecords(storeLogsDir()),
  groupOf = processGroupId,
  pidAlive = pidMayBeRunning,
  ledgerLogPaths = () =>
    new Set(
      readLedger(currentBranch()).entries.map((e) => String(e.logPath ?? ''))
    ),
}) {
  if ((listeners ?? []).length === 0) return null;
  let hit = null;
  try {
    hit = deadGateBehindPort({
      records: records(),
      listeners,
      groupOf,
      pidAlive,
      ledgerLogPaths: ledgerLogPaths(),
    });
  } catch {
    return null;
  }
  if (hit == null) return null;
  const { record } = hit;
  const when = Number.isFinite(Number(record.startedAt))
    ? new Date(Number(record.startedAt)).toISOString()
    : 'unknown time';
  const stopped =
    record.stopped == null
      ? // No `stopped` note: the supervisor died before it could report a sweep.
        'its supervisor left no note, so the run was killed hard enough to take that too'
      : `${String(record.stopped.left?.length ?? 0)} process(es) survived its sweep`;
  return (
    `gate: WARN this port belongs to a gate that DIED without a ledger line:\n` +
    `        ${String(record.gate ?? 'gate')} started ${when} (gate pid ${String(
      record.gatePid ?? '?'
    )}, process group ${String(hit.group)}, lease ${String(record.lease ?? env.NITRO_UI_LEASE_ID ?? '?')}) — ${stopped}.\n` +
    `        its log: ${String(record.logPath ?? '?')}\n` +
    `        this run is not that run. Look at that log, then start this one again.`
  );
}

/**
 * Checks the leased Metro port before the run starts and returns an exit code
 * (0 means run). A port another process serves is refused: the app would join
 * that server and the suite would fail later with an error that names no port.
 * `NITRO_UI_GATE_METRO_FORCE=1` runs anyway, for a Metro started by hand.
 */
function metroPreflight(env = process.env, run) {
  const answer = metroPreflightFromEnv(env, run);
  if (answer.warning != null) {
    // Still a run: a machine that cannot inspect the port (CI, a container
    // without `lsof`) must be able to run its gates.
    process.stderr.write(
      `gate: WARN the Metro pre-flight was skipped - ${answer.warning}\n`
    );
    return 0;
  }
  if (answer.reason == null) return 0;
  if (METRO_FORCE_RE.test(env.NITRO_UI_GATE_METRO_FORCE ?? '')) {
    process.stderr.write(
      `gate: WARN Metro port is not free - ${answer.reason}\n` +
        '        running anyway (NITRO_UI_GATE_METRO_FORCE=1)\n'
    );
    return 0;
  }
  process.stderr.write(
    `gate: refused before the run - ${answer.reason}\n` +
      '        wait for that run, or set NITRO_UI_GATE_METRO_FORCE=1 to start on this port anyway.\n' +
      `        (checked because ${env.NITRO_UI_LEASE_ID ?? 'this shell'} exported METRO_PORT=${String(answer.port)})\n`
  );
  // A busy port is either a run still going or a dead run whose server
  // outlived it; the second case gets its own warning.
  const hint = deadGateHint({ listeners: answer.listeners ?? [], env });
  if (hint != null) process.stderr.write(`${hint}\n`);
  return 1;
}

async function runGateUnclaimed(name, resolved, options = {}) {
  const branch = currentBranch();
  // The tree is read before the run and again after it; a run during which it
  // moved is recorded with both and never reads green.
  const before = readTrees();
  const completion = options.completion ?? null;
  if (
    completion != null &&
    before.gateTrees[name] !== completion.base.gateTrees?.[name]
  ) {
    process.stderr.write(
      `gate: refused before the run - the ${name} digest moved since the red run ` +
        `(${String(completion.base.gateTrees?.[name]).slice(0, 12)} then, ` +
        `${before.gateTrees[name].slice(0, 12)} now): run the full gate\n`
    );
    return 1;
  }
  // A lease covers both halves of a pair, so a bench's own `--platform` wins
  // over what the environment suggests.
  const device = deviceFromEnv(
    process.env,
    resolved.platform ?? resolved.benchPlatform ?? null
  );
  const startedAt = Date.now();
  const startedLoad = os.loadavg()[0] ?? null;
  const samples = [startedLoad];
  const sampler = setInterval(() => {
    samples.push(os.loadavg()[0] ?? Number.NaN);
  }, LOAD_SAMPLE_INTERVAL_MS);

  pruneStoredLogs('gate');
  const logsDir = storeLogsDir();
  fs.mkdirSync(logsDir, { recursive: true });
  const backgroundLog = options.logFile ?? null;
  const {
    logPath,
    absolute: absoluteLog,
    backgrounded,
  } = logPathsFor({
    branch,
    gate: name,
    startedAt,
    fromEnv: backgroundLog,
  });
  fs.mkdirSync(path.dirname(absoluteLog), { recursive: true });
  // Per-suite timings for a harness run, named from the run's log so they sit
  // in the store beside it and retention sweeps them together.
  const suiteTimingFile =
    resolved.platform == null ? null : suiteTimingPath(absoluteLog);
  // Which controls a real-input run proved, written by its report.
  const realInputUnitsFile = name.startsWith('real-input:')
    ? `${absoluteLog}.units.json`
    : null;
  // Append for a backgrounded run: the launcher has this file open as this
  // process's stdout and stderr, and truncating would erase those lines.
  const logStream = fs.createWriteStream(absoluteLog, {
    flags: backgrounded ? 'a' : 'w',
  });
  let logText = '';
  // A backgrounded run's stdout is the log file, so echoing would put every
  // line in it twice.
  const echo = !backgrounded;
  let logStreamOpen = true;
  // The gate's own messages go to the log as well as stderr, because the log
  // is what is kept.
  const note = (message) => {
    process.stderr.write(message);
    logText += message;
    if (logStreamOpen) logStream.write(message);
  };
  const tee = (chunk, output) => {
    logText += String(chunk);
    // A descendant of the run can still write after the stream has ended, and
    // a write after `end()` is an unhandled stream error.
    if (logStreamOpen) logStream.write(chunk);
    if (echo) output.write(chunk);
  };

  const cwd =
    resolved.cwd === 'example' ? path.join(repoRoot, 'example') : repoRoot;
  // `check` leaves its per-step timings in a file named from this run's log,
  // so one run cannot read another's breakdown.
  const stepTimingsPath =
    resolved.gate === 'check' ? `${absoluteLog}.steps.json` : null;
  process.stderr.write(
    `gate: ${name}\n` +
      `gate: ${resolved.argv.join(' ')} (cwd ${path.relative(repoRoot, cwd) || '.'})\n` +
      `gate: code tree ${before.tree.slice(0, 12)} at HEAD ${git(['rev-parse', '--short', 'HEAD'], '?')}\n` +
      // The store-relative path the ledger prints, then the absolute one to
      // open.
      `gate: log ${logPath}\n` +
      `gate:       ${absoluteLog}\n`
  );

  let childPid = null;
  // The run's output is complete only when both of the child's pipes have
  // closed: stdout and stderr close independently, and the test summary the
  // ledger's counts are parsed from can be in either tail.
  let childStreamsClosed = false;
  let streamsClosedCount = 0;
  let drainNow = null;
  let childStreams = null;
  // The command runs under `gate-runner.mjs`, which notices when this process
  // is killed and cannot clean up for itself. It starts the command in its own
  // group, so `-child.pid` reaches the harness and the Metro it spawned.
  const exit = await new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [path.join(import.meta.dirname, 'gate-runner.mjs'), ...resolved.argv],
      {
        cwd,
        // Its own process group, so whatever the run leaves behind can be found
        // and stopped by group. The signal handlers below forward to that
        // group, so Ctrl-C still stops the descendants.
        detached: true,
        // `NITRO_UI_GATE_LOG` is for this process only: a nested `gate.mjs`
        // that inherited it would append to this run's log and mark this run's
        // record done with its own exit code.
        env: (() => {
          const childEnv = { ...process.env };
          delete childEnv.NITRO_UI_GATE_LOG;
          if (stepTimingsPath != null) {
            childEnv.NITRO_UI_CHECK_STEPS_FILE = stepTimingsPath;
          }
          if (suiteTimingFile != null) {
            childEnv[SUITE_TIMING_ENV] = suiteTimingFile;
            childEnv[SUITE_TIMING_GATE_ENV] = name;
          }
          delete childEnv[REAL_INPUT_UNITS_ENV];
          if (realInputUnitsFile != null) {
            childEnv[REAL_INPUT_UNITS_ENV] = realInputUnitsFile;
          }
          // The supervisor's instructions, cleared first so they are never
          // inherited from an outer gate. It gets this process's group as well
          // as its pid, because a pid can be reused during a long run.
          for (const supervisorName of [
            GATE_PID_ENV,
            GATE_PGID_ENV,
            GATE_NAME_ENV,
            RUNNER_LOG_ENV,
            RUNNER_LOG_RELATIVE_ENV,
          ]) {
            delete childEnv[supervisorName];
          }
          childEnv[GATE_PID_ENV] = String(process.pid);
          const gatePgid = processGroupId(process.pid);
          if (gatePgid != null) childEnv[GATE_PGID_ENV] = String(gatePgid);
          childEnv[GATE_NAME_ENV] = name;
          childEnv[RUNNER_LOG_ENV] = absoluteLog;
          // The same log in the ledger's store-relative spelling.
          childEnv[RUNNER_LOG_RELATIVE_ENV] = logPath;
          return childEnv;
        })(),
        // stdin is a pipe this process holds open and never writes: its EOF
        // tells the supervisor this gate died, however it died. 'ignore' would
        // give it /dev/null, which reports EOF at once.
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    // Never written to; without a listener a stream error would be an uncaught
    // exception.
    child.stdin?.on('error', () => {});
    childPid = child.pid ?? null;
    childStreams = { out: child.stdout, err: child.stderr };
    let forwarded = null;
    const handlers = FORWARDED_SIGNALS.map((signal) => {
      const handler = () => {
        // The whole group: the child is detached, so its Metro does not share
        // this process's group. The direct child is the fallback where a
        // negative pid is refused.
        forwarded = signal;
        try {
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            /* already gone */
          }
        }
      };
      process.on(signal, handler);
      return [signal, handler];
    });
    const stopListening = () => {
      for (const [signal, handler] of handlers)
        process.removeListener(signal, handler);
    };
    child.stdout.on('data', (chunk) => tee(chunk, process.stdout));
    child.stderr.on('data', (chunk) => tee(chunk, process.stderr));
    child.on('error', (error) => {
      process.stderr.write(
        `gate: could not start ${resolved.argv[0]}: ${error.message}\n`
      );
      stopListening();
      resolvePromise({
        code: 1,
        signal: null,
        failedToStart: true,
        forwarded: null,
      });
    });
    const markClosed = () => {
      streamsClosedCount += 1;
      if (streamsClosedCount < 2) return;
      childStreamsClosed = true;
      drainNow?.();
    };
    child.stdout.on('close', markClosed);
    child.stderr.on('close', markClosed);
    child.on('exit', (code, signal) => {
      stopListening();
      // Drop the stdin pipe: a handle still held keeps the event loop alive.
      child.stdin?.destroy();
      resolvePromise({ code, signal, failedToStart: false, forwarded });
    });
  });

  // The promise resolves on the child's `exit`, not its `close`: a leaked
  // Metro inherits the child's stdout and stderr and can hold them open
  // indefinitely. The pipes get a bounded moment to deliver the tail instead.
  if (!childStreamsClosed) {
    await new Promise((resolveDrain) => {
      const timer = setTimeout(() => {
        drainNow = null;
        resolveDrain();
      }, EXIT_DRAIN_MS);
      timer.unref?.();
      drainNow = () => {
        clearTimeout(timer);
        drainNow = null;
        resolveDrain();
      };
    });
  }

  clearInterval(sampler);
  // A supervisor that died by a signal, or that reported this process dead,
  // may not have stopped the command: it shares the group and can still hold
  // the leased port. So the group is swept from here if it still has members.
  const supervisorDied = exit.signal != null || exit.code === GATE_DEATH_EXIT;
  if (supervisorDied && childPid != null) {
    // Only while the pid still describes this run (pids are recycled) and the
    // supervisor left no note that it already swept.
    const owed = maySweepRunnerGroup({
      runnerPid: childPid,
      recordFile:
        absoluteLog == null ? null : `${absoluteLog}${RUNNER_RECORD_SUFFIX}`,
    });
    if (!owed.sweep) {
      note(`gate: not sweeping group ${String(childPid)} - ${owed.why}\n`);
    } else {
      const left = await groupMembers(childPid);
      if (left.length > 0) {
        note(
          `gate: this run's supervisor left (${String(
            exit.signal ?? `exit ${String(exit.code)}`
          )}) with ${String(left.length)} process(es) still up in group ${String(
            childPid
          )}: ${left.join(', ')}\n`
        );
        const remaining = await stopGroup(childPid, { log: note });
        note(
          remaining.length > 0
            ? `gate: ${String(remaining.length)} process(es) outlived this run: ${remaining.join(
                ', '
              )} - the next gate on this lease will name them\n`
            : `gate: the run’s group is gone with it\n`
        );
      }
    }
  }
  // A Metro this run left on the leased port would make the next gate on the
  // same lease refuse to start.
  const leftover = await stopOwnMetro({
    port: process.env.METRO_PORT,
    leaderPid: childPid,
    log: note,
  });
  if (leftover.length > 0) {
    note(
      `gate: stopped the Metro this run started (${leftover.join(', ')}) on port ${String(
        process.env.METRO_PORT
      )} - the next gate on this lease gets a free port\n`
    );
  }
  // Release our read ends: a descendant the sweep may not stop would
  // otherwise keep this process alive through the open pipes, and `wait`
  // would report a finished gate as still running.
  for (const stream of [childStreams?.out, childStreams?.err]) {
    try {
      stream?.destroy();
    } catch {
      /* already gone */
    }
  }
  samples.push(os.loadavg()[0] ?? Number.NaN);
  const durationMs = Date.now() - startedAt;
  const after = readTrees();
  logStreamOpen = false;
  logStream.end();
  // Wait for the log to reach the disk before a re-raised signal below can
  // kill the process.
  await finished(logStream).catch(() => {});

  const stepTimings = readStepTimings(stepTimingsPath);
  // A `check` that exits 0 with an empty step list ran nothing, and is a fail.
  // A missing breakdown (the runner could not write the file) decides nothing.
  const ranNothing =
    name === 'check' && stepTimings != null && stepTimings.steps.length === 0;
  let result =
    exit.code === 0 && exit.signal == null && !ranNothing ? 'pass' : 'fail';
  const summaries = parseTestSummaries(logText);
  const suiteTimings =
    suiteTimingFile == null ? null : readSuiteTiming(suiteTimingFile);
  let units = null;
  if (realInputUnitsFile != null) {
    units = realInputUnitsFromResults(readJsonFile(realInputUnitsFile));
  } else if (name.startsWith('harness:') && suiteTimingFile != null) {
    units = harnessUnitsFromTimings(
      suiteTimings,
      readSuiteTiming(`${suiteTimingFile}.isolated.json`),
      { isolatedExpected: resolved.gate === name && completion == null }
    );
  }
  let completionRecord = null;
  if (completion != null) {
    const verdict = completeRerun({
      plan: completion,
      childUnits: units,
      exitCode: exit.signal == null ? exit.code : null,
      digestBefore: before.gateTrees[name],
      digestAfter: after.gateTrees[name],
      gate: name,
    });
    result = verdict.result;
    units = verdict.units;
    completionRecord = {
      of: completion.of,
      attempt: completion.attempt,
      rerun: completion.rerun,
      filtered: resolved.gate,
      why: verdict.why,
    };
    for (const line of verdict.why) note(`gate: completion: ${line}\n`);
  }
  // The gate's own code, not the child's alone: a completion or a `check` can fail
  // while the child exits 0, and `wait` returns what is recorded here.
  const exitCode =
    result === 'fail' && exit.code === 0
      ? 1
      : (exit.code ?? (exit.signal != null ? null : 1));
  const line = ledgerLineFromRun({
    // The canonical name from `resolveGate`, never `argv[0]`: a filtered run
    // must not be recorded as the full gate.
    gate: name,
    command: resolved.argv.join(' '),
    tree: before.tree,
    trees: before.trees,
    gateTrees: before.gateTrees,
    treeAfter: after.tree,
    gateTreesAfter: after.gateTrees,
    head: before.head,
    branch,
    platform: device.platform,
    device: device.device,
    lease: device.lease,
    load: summarizeLoad({ start: startedLoad, samples }),
    durationMs,
    result,
    // `counts` is the unit-test summary (for `check`, Jest's and Vitest's unit steps
    // summed), not whichever step printed last; `summaries` holds all of them.
    counts: parseTestCounts(logText) ?? summaries[0] ?? null,
    summaries,
    stepTimings,
    suiteTimings,
    logPath,
    startedAt,
    exitCode,
    signal: exit.signal,
    units,
    completion: completionRecord,
    ...(completion == null
      ? { relaxed: relaxedSwitches(process.env), judge: before.judge }
      : completionProvenance({
          base: completion.base,
          relaxed: relaxedSwitches(process.env),
          judge: before.judge,
        })),
  });
  const file = appendLedgerLine(branch, line);
  // The store's record of this run. For a backgrounded run it is the "done"
  // mark `wait` returns on, so it is written after the ledger line. For a
  // foreground run it is what lets `logs --failed` answer once the worktree
  // and its ledger are gone.
  const recordPath = backgroundRecordPath(absoluteLog);
  writeJsonAtomic(recordPath, {
    version: 1,
    gate: name,
    command: resolved.argv.join(' '),
    pid: process.pid,
    startedAt,
    logPath,
    recordPath,
    branch,
    worktree: store().worktree,
    ...(backgrounded ? {} : { foreground: true }),
    ...readBackgroundRecord(recordPath),
    done: true,
    finishedAt: Date.now(),
    exitCode,
    signal: exit.signal,
    result,
    ledgerLine: line,
  });

  const suffix =
    after.tree === before.tree
      ? ''
      : ` - note: the code tree moved during the run (${after.tree.slice(0, 12)} now), so this line describes ${before.tree.slice(0, 12)}`;
  process.stderr.write(
    `gate: ${name} ${result.toUpperCase()} in ${(durationMs / 1000).toFixed(1)} s` +
      `${exit.signal != null ? ` (signal ${exit.signal})` : ''}${suffix}\n` +
      `gate: recorded in ${path.relative(repoRoot, file)}\n`
  );
  if (ranNothing) {
    process.stderr.write(
      'gate: check reported no steps, so nothing was checked - recording a fail ' +
        'even though the runner exited 0. A check that runs no steps is not a pass;\n' +
        '        run `bun run check` by hand and look for the step list header.\n'
    );
  }
  const timings = line.suiteTimings;
  if (timings != null && timings.suites.length > 0) {
    const table = formatSuiteTimings(timings, { limit: 12 });
    logStream.write(`${table}\n`);
    if (echo) process.stdout.write(`${table}\n`);
  } else if (suiteTimingFile != null) {
    process.stderr.write(
      'gate: no per-suite timings recorded - the harness plugin did not run\n'
    );
  }
  if (result === 'fail' && resolved.bench) {
    process.stderr.write(
      'gate: a bench never blocks `need` - benches go to the bench host (D15).\n'
    );
  }

  // A failed device gate appends the device's state to its log. Keyed on the
  // gate's own platform, not the environment. The verdict is already recorded,
  // so every probe is allowed to fail.
  if (result === 'fail' && resolved.platform != null) {
    const context = collectDeviceContext({
      platform: resolved.platform,
      lease: device.lease,
      env: process.env,
    });
    try {
      fs.appendFileSync(
        absoluteLog,
        `\n${renderDeviceContext(context, { logPath })}\n`
      );
    } catch {
      /* a log we cannot append to is still a log the run wrote */
    }
    process.stderr.write(
      `gate: appended the device context to ${logPath} (${context.length} probe(s))\n`
    );
  }
  if (exit.forwarded != null) {
    // The line is written and the log flushed, so the signal can do its default
    // work and the caller's exit status still says "interrupted".
    process.stderr.write(`gate: re-raising ${exit.forwarded}\n`);
    process.kill(process.pid, exit.forwarded);
    return 1;
  }
  if (exit.signal != null) return 1;
  return exitCode ?? 1;
}

function printCodeTree({ tree, trees, gateTrees, head, files }) {
  process.stderr.write(
    `ledger: code tree ${tree.slice(0, 12)} at HEAD ${String(head ?? '?').slice(0, 7)} (branch ${currentBranch()}, ${String(files)} files)\n`
  );
  process.stderr.write(
    `ledger: platform trees ${PLATFORMS.map((platform) => `${platform} ${String(trees?.[platform] ?? '?').slice(0, 12)}`).join(' ')}\n`
  );
  process.stderr.write(
    `ledger: gate digests ${Object.entries(gateTrees ?? {})
      .map(([gate, digest]) => `${gate} ${String(digest).slice(0, 12)}`)
      .join(' ')}\n`
  );
}

function commandStatus({ stage }) {
  const branch = currentBranch();
  const read = readTrees();
  const { entries, file, exists } = readLedger(branch);
  printCodeTree(read);
  process.stderr.write(
    `ledger: ${exists ? path.relative(repoRoot, file) : `${path.relative(repoRoot, file)} (nothing recorded yet)`}\n`
  );
  process.stderr.write(`ledger: showing the ${stage} view\n`);
  if (entries.some((entry) => entry.corrupt)) {
    process.stderr.write(
      `ledger: ${String(entries.filter((entry) => entry.corrupt).length)} unreadable line(s) - treated as not run\n`
    );
  }
  const rows = summarizeGates({
    entries,
    foreign: readEvidence(),
    tree: read.tree,
    trees: read.trees,
    gateTrees: read.gateTrees,
    judge: read.judge,
    stage,
  });
  for (const row of rows) {
    const entry = row.entry;
    const completion = formatHow(row) ?? '';
    const detail =
      entry == null
        ? ''
        : ` [${String(entry.tree).slice(0, 12)}${row.matched == null ? ' not this tree' : row.matched === 'full' ? '' : row.matched.includes(':') ? ' own digest' : ` ${row.matched} tree`}${formatMaybe(entry.durationMs)}${entry.lease != null ? ` lease ${entry.lease}` : ''}${row.why === 'moved' ? ' tree moved mid-run' : ''}${completion === '' ? '' : ` ${completion}`}]`;
    process.stdout.write(`${row.state.padEnd(7)} ${row.gate}${detail}\n`);
  }
  const green = rows.filter((row) => row.state === 'green').length;
  process.stdout.write(
    `\n${String(green)} green, ${String(rows.filter((r) => r.state === 'red').length)} red, ${String(rows.filter((r) => r.state === 'stale').length)} stale, ${String(rows.filter((r) => r.state === 'missing').length)} missing for this code tree (${stage})\n`
  );
  // A backgrounded gate still in progress would otherwise read as "missing".
  for (const entry of runningBackgroundGates(
    ownRunningGates(listBackgroundRecords(storeLogsDir()), ownRecordScope())
  )) {
    const seconds =
      entry.startedAt == null
        ? '?'
        : String(Math.round((Date.now() - entry.startedAt) / 1000));
    process.stdout.write(
      `running ${entry.gate} (pid ${String(entry.pid)}, ${seconds}s so far) - node scripts/gate.mjs wait --gate ${entry.gate}\n`
    );
  }
  return 0;
}

function formatMaybe(ms) {
  return typeof ms === 'number' ? ` ${(ms / 1000).toFixed(1)}s` : '';
}

/**
 * Every `<branch>.jsonl` under `dir`. Branch names nest, so this walks the
 * directory and recovers each branch from its path.
 */
function ledgersUnder(dir) {
  const found = [];
  const walk = (current, prefix) => {
    let names;
    try {
      names = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.jsonl')) continue;
      let text;
      try {
        text = fs.readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }
      found.push({
        branch: `${prefix}${entry.name.slice(0, -'.jsonl'.length)}`,
        source: absolute,
        entries: parseLedger(text),
      });
    }
  };
  walk(dir, '');
  return found;
}

/** Every branch ledger in this worktree's `.gates/` except `exceptBranch`. */
function otherBranchLedgers(exceptBranch) {
  return ledgersUnder(path.join(repoRoot, LEDGER_DIR))
    .filter(({ branch }) => branch !== exceptBranch)
    .map((ledger) => ({
      ...ledger,
      source: path.relative(repoRoot, ledger.source),
    }));
}

function commandNeed({ stage, base }) {
  const branch = currentBranch();
  const read = readTrees();
  const { entries, exists } = readLedger(branch);
  const diff = changedCodePaths({ base });
  const touched = diff.unknown
    ? { platforms: [...PLATFORMS], unmapped: [], tooling: [] }
    : platformsTouchedByPaths(diff.paths);
  // An unread diff asks for every gate, the way it asks for both platforms.
  const touchedGates = diff.unknown ? null : gatesTouchedByPaths(diff.paths);

  const decision = decideNeed({
    entries,
    foreign: readEvidence(),
    tree: read.tree,
    trees: read.trees,
    gateTrees: read.gateTrees,
    judge: read.judge,
    stage,
    touchedPlatforms: touched.platforms,
    touchedGates,
    unmappedPaths: touched.unmapped,
    toolingPaths: touched.tooling,
    diffUnknown: diff.unknown,
  });

  printCodeTree(read);
  process.stderr.write(
    `need: ${stage} against ${exists ? `.gates/${branch}.jsonl` : 'an empty ledger'}; ` +
      `code diff base ${diff.base == null ? 'unknown' : diff.base.slice(0, 7)}` +
      `${touched.platforms.length > 0 ? ` touches ${touched.platforms.join(' + ')}` : ' touches no platform-specific code'}\n`
  );
  for (const row of decision.required) {
    process.stdout.write(
      `  ${row.state === 'green' ? '✓' : '✗'} ${explainNeedRow(row, read.tree)}\n`
    );
  }
  for (const note of decision.notes) {
    process.stdout.write(`  note: ${note}\n`);
  }
  if (decision.ok) {
    process.stdout.write(`need: ${stage} is satisfied on this code tree.\n`);
    return 0;
  }
  process.stdout.write(
    `need: ${decision.missing.length} gate(s) missing for ${stage}: ${decision.missing.join(', ')}\n`
  );
  return 1;
}

function commandTable({ stage, full }) {
  const branch = currentBranch();
  const read = readTrees();
  const { entries, exists } = readLedger(branch);
  const foreign = readEvidence();
  printCodeTree(read);
  if (!exists && foreign.length === 0) {
    process.stderr.write('table: nothing recorded yet - run a gate first.\n');
    return 1;
  }
  const table = renderGateTable({
    entries,
    foreign,
    tree: read.tree,
    trees: read.trees,
    gateTrees: read.gateTrees,
    judge: read.judge,
    stage,
    required: MERGE_GATES,
    evidence:
      full === true
        ? (entry) =>
            entry.source?.url != null
              ? `CI \`${String(entry.source.url)}\``
              : `log \`${String(entry.logPath ?? '')}\``
        : null,
  });
  process.stdout.write(`${table}\n`);
  if (full === true) {
    const steps = renderStepTimings({ entries, gates: MERGE_GATES });
    if (steps !== '') process.stdout.write(`\n${steps}\n`);
    // Per-suite durations for the reported rows only: the whole ledger would
    // print one table per recorded run.
    const rows = summarizeGates({
      entries,
      foreign,
      tree: read.tree,
      trees: read.trees,
      gateTrees: read.gateTrees,
      judge: read.judge,
      stage,
      required: MERGE_GATES,
    });
    for (const row of rows) {
      const timings = row.entry?.suiteTimings;
      if ((timings?.suites?.length ?? 0) === 0) continue;
      process.stdout.write(`\n${formatSuiteTimings(timings, { limit: 15 })}\n`);
    }
  }
  return 0;
}

/** One `gh` call that only reads, as text, or the reason it failed. */
function ghRead(args) {
  const result = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error != null) {
    return { error: `gh could not start (${result.error.message})` };
  }
  if (result.status !== 0) {
    return {
      error: `gh ${args.slice(0, 2).join(' ')} exited ${String(result.status)}: ${
        String(result.stderr || result.stdout).trim() || 'no output'
      }`,
    };
  }
  return { text: String(result.stdout) };
}

function ghJson(args) {
  const read = ghRead(args);
  if (read.error != null) return read;
  try {
    return { value: JSON.parse(read.text) };
  } catch {
    return { error: `gh ${args.slice(0, 2).join(' ')} printed no JSON` };
  }
}

/**
 * `gate.mjs ci-import --run <id>`: one `real-input:android` line from a GitHub
 * Actions run of this commit, judged from the report the run uploaded. Every
 * refusal records nothing.
 */
function commandCiImport({ runId }) {
  const refuse = (reasons) => {
    for (const reason of reasons) {
      process.stderr.write(`ci-import: refused - ${reason}\n`);
    }
    process.stderr.write('ci-import: nothing recorded\n');
    return 1;
  };
  const branch = currentBranch();
  const before = readTrees();
  const head = git(['rev-parse', 'HEAD'], '');
  const dirty = git(['status', '--porcelain', '--untracked-files=all'], '')
    .split('\n')
    .filter((line) => line.trim() !== '');
  const api = `repos/{owner}/{repo}/actions/runs/${runId}`;
  const run = ghJson(['api', api]);
  if (run.error != null)
    return refuse([`could not read run ${runId}: ${run.error}`]);
  const attempt = Number(run.value?.run_attempt ?? 1);
  const jobs = ghJson([
    'api',
    `${api}/attempts/${String(attempt)}/jobs?per_page=100`,
  ]);
  if (jobs.error != null)
    return refuse([`could not read the jobs of run ${runId}: ${jobs.error}`]);
  const reasons = ciImportRefusals({
    run: run.value,
    jobs: jobs.value?.jobs ?? [],
    head,
    dirty,
    entries: readLedger(branch).entries,
  });
  if (reasons.length > 0) return refuse(reasons);
  const job = ciJobOf(jobs.value.jobs);

  const listed = ghJson(['api', `${api}/artifacts?per_page=100`]);
  if (listed.error != null)
    return refuse([
      `could not list the artifacts of run ${runId}: ${listed.error}`,
    ]);
  const artifact = (listed.value?.artifacts ?? []).find(
    (entry) => entry?.name === CI_ARTIFACT && entry?.expired !== true
  );
  if (artifact == null) {
    return refuse([
      `run ${runId} has no ${CI_ARTIFACT} artifact: the job (${String(job.conclusion)}) ` +
        'ended before the suite started, or the artifact expired',
    ]);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-ci-import-'));
  try {
    const downloaded = ghRead([
      'run',
      'download',
      runId,
      '--name',
      CI_ARTIFACT,
      '--dir',
      scratch,
    ]);
    if (downloaded.error != null)
      return refuse([`could not download ${CI_ARTIFACT}: ${downloaded.error}`]);
    const full = readUploadedRun(path.join(scratch, CI_FULL_DIR));
    if (full == null) {
      return refuse([
        `${CI_ARTIFACT} holds no run record of the full suite: the job never started it`,
      ]);
    }
    const rerun = readUploadedRun(path.join(scratch, CI_RERUN_DIR));
    const after = readTrees();
    const { line, notes, ...judged } = ciLedgerLine({
      source: {
        kind: 'github-actions',
        runId: Number(run.value.id),
        attempt,
        jobId: job.id ?? null,
        url: job.html_url ?? run.value.html_url ?? null,
      },
      head,
      branch,
      before,
      after,
      full,
      rerun,
      sources: checkoutSources(repoRoot),
    });
    const file = appendLedgerLine(branch, line);
    for (const message of [
      ...judged.full.quarantined,
      ...(judged.rerun?.quarantined ?? []),
    ]) {
      process.stdout.write(`QUARANTINED ${message}\n`);
    }
    for (const failure of judged.full.failures) {
      process.stdout.write(`full run: ✗ ${failure}\n`);
    }
    for (const failure of judged.rerun?.failures ?? []) {
      process.stdout.write(`re-run: ✗ ${failure}\n`);
    }
    for (const note of notes) process.stderr.write(`ci-import: ${note}\n`);
    const why = line.completion != null ? line.completion.why : judged.full.why;
    for (const reason of why) process.stderr.write(`ci-import: ${reason}\n`);
    const how = formatHow({ entry: line });
    process.stderr.write(
      `ci-import: ${CI_GATE} ${line.result.toUpperCase()} (${how}) - ${String(line.source.url)}\n` +
        `ci-import: recorded in ${path.relative(repoRoot, file)}\n`
    );
    return line.result === 'pass' ? 0 : 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * `gate.mjs logs`: what is in this clone's log store, newest first. Pass or
 * fail comes from the store's own record of a run, because the ledger goes with
 * the worktree; a log neither can judge is counted as unknown.
 */
function commandLogs({ branch, failedOnly, all }) {
  const storeDir = storeLogsDir();
  const location = store();
  const pruning = pruneLogStore();
  process.stdout.write(
    `logs: store ${storeDir}${location.shared ? '' : ' (fallback: this checkout has no git common dir)'}\n`
  );
  if (pruning.removed.length > 0) {
    process.stdout.write(
      `logs: retention removed ${String(pruning.removed.length)} file(s) ` +
        `(${pruning.removed.map((victim) => victim.reason).join(', ')}) — ` +
        `${String(LOG_RETENTION_DAYS)} days, ${formatBytes(LOG_RETENTION_MAX_BYTES)} cap\n`
    );
  }

  const wanted = branch != null ? [branch] : all ? null : [currentBranch()];
  const outcome = outcomeOfStoredLogs(storeDir);
  const logs = listStoredLogs(storeDir)
    .filter((log) => /\.log$/.test(log.file))
    .sort((a, b) => Number(b.mtimeMs) - Number(a.mtimeMs));

  let shown = 0;
  let unknown = 0;
  for (const log of logs) {
    const relative = path
      .relative(storeDir, log.file)
      .split(path.sep)
      .join('/');
    if (wanted != null && !wanted.includes(branchOfStoredLog(relative)))
      continue;
    if (failedOnly === true) {
      const failed = outcome.get(relative);
      if (failed == null) {
        unknown += 1;
        continue;
      }
      if (!failed) continue;
    }
    process.stdout.write(
      `  ${new Date(log.mtimeMs).toISOString()}  ${formatBytes(log.bytes).padStart(9)}  ${relative}\n`
    );
    shown += 1;
  }
  process.stdout.write(
    `${String(shown)} log file(s) ${wanted == null ? 'from every branch' : `for ${wanted.join(', ')}`}${
      failedOnly ? ' that the store says failed' : ''
    }\n`
  );
  if (failedOnly === true && unknown > 0) {
    // "Nothing failed" and "could not tell" are different answers.
    process.stdout.write(
      `logs: ${String(unknown)} log(s) could not be judged - no record of the run` +
        `${wanted == null ? '' : ` for ${wanted.join(', ')}`} survives, so pass or fail is unknown\n`
    );
  }
  if (shown === 0 && !failedOnly && wanted != null && !all) {
    process.stdout.write(
      'logs: (pass --all to see every branch, or --branch <b> for a specific one)\n'
    );
  }
  return 0;
}

/**
 * Maps each store-relative log path to whether that run failed. The record
 * written when the run finished is the primary source; this checkout's ledger
 * lines fill the gaps. `null` means neither can judge.
 */
function outcomeOfStoredLogs(storeDir) {
  const records = listBackgroundRecords(storeDir);
  const byLogPath = new Map();
  const put = (key, value, entry) => {
    if (typeof key !== 'string' || key === '') return;
    const previous = byLogPath.get(key);
    // A judgement beats a gap.
    byLogPath.set(
      key,
      previous === undefined || previous == null ? value : previous
    );
    if (entry != null && !entriesByLogPath.has(key)) {
      entriesByLogPath.set(key, entry);
    }
  };
  for (const record of records) {
    if (typeof record?.logPath !== 'string' || record.logPath === '') continue;
    const verdict = storedLogFailed(record, null);
    put(record.logPath, verdict, null);
  }
  const entriesByLogPath = new Map();
  for (const ledger of [
    ...otherBranchLedgers(null),
    { entries: readLedger(currentBranch()).entries },
  ]) {
    for (const entry of ledger.entries ?? []) {
      if (typeof entry?.logPath !== 'string' || entry.logPath === '') continue;
      if (!entriesByLogPath.has(entry.logPath)) {
        entriesByLogPath.set(entry.logPath, entry);
      }
    }
  }
  const outcome = new Map();
  for (const [logPath, failed] of byLogPath) {
    outcome.set(
      logPath,
      failed ?? storedLogFailed(null, entriesByLogPath.get(logPath))
    );
  }
  for (const [logPath, entry] of entriesByLogPath) {
    if (!outcome.has(logPath))
      outcome.set(logPath, storedLogFailed(null, entry));
  }
  return outcome;
}

/**
 * The branch a stored log belongs to: its whole directory path, because branch
 * names nest (`task/a/b/check-….log` belongs to `task/a/b`).
 */
function branchOfStoredLog(relative) {
  const segments = String(relative ?? '')
    .split(path.sep)
    .join('/')
    .split('/');
  return segments.length > 1 ? segments.slice(0, -1).join('/') : '(unknown)';
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${String(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

/** `--for review|merge` for the read-only commands, defaulting to `review`. */
function parseStageOption({ rest, command }) {
  let stage = 'review';
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--for') {
      stage = rest[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith('--for=')) {
      stage = argument.slice('--for='.length);
    } else if (argument === '--full' && command === 'table') {
      continue; // read by the caller
    } else {
      process.stderr.write(
        `${command}: unknown argument ${argument}\n${USAGE}`
      );
      return { stage: null };
    }
  }
  if (stage !== 'review' && stage !== 'merge') {
    process.stderr.write(
      `${command}: --for review or --for merge (got ${String(stage)})\n${USAGE}`
    );
    return { stage: null };
  }
  return { stage };
}

async function main(argv) {
  const [command, ...rest] = argv;
  // A usage probe (`<gate> --help`, on either side of `--`) is answered before
  // anything is resolved, launched or recorded: it must not become a red row.
  if (isUsageProbe(command, rest)) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command == null || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === 'status' || command === 'table') {
    const { stage } = parseStageOption({ rest, command });
    if (stage == null) return 2;
    return command === 'status'
      ? commandStatus({ stage })
      : commandTable({ stage, full: rest.includes('--full') });
  }
  if (command === 'need') {
    let stage = null;
    let base = 'main';
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === '--for') {
        stage = rest[index + 1] ?? null;
        index += 1;
      } else if (argument.startsWith('--for=')) {
        stage = argument.slice('--for='.length);
      } else if (argument === '--base') {
        base = rest[index + 1] ?? base;
        index += 1;
      } else if (argument.startsWith('--base=')) {
        base = argument.slice('--base='.length);
      } else {
        process.stderr.write(`need: unknown argument ${argument}\n${USAGE}`);
        return 2;
      }
    }
    if (stage !== 'review' && stage !== 'merge') {
      process.stderr.write(
        `need: --for review or --for merge (got ${String(stage)})\n${USAGE}`
      );
      return 2;
    }
    return commandNeed({ stage, base });
  }
  if (command === 'wait') {
    let gate = null;
    let timeoutMinutes = DEFAULT_WAIT_MINUTES;
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === '--gate') {
        gate = rest[index + 1] ?? null;
        if (gate == null) {
          process.stderr.write(`wait: --gate needs a gate name\n${USAGE}`);
          return 2;
        }
        index += 1;
      } else if (argument === '--timeout-minutes') {
        const raw = rest[index + 1] ?? null;
        timeoutMinutes = Number(raw);
        if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
          process.stderr.write(
            `wait: --timeout-minutes needs a positive number of minutes (got ${String(raw)})\n${USAGE}`
          );
          return 2;
        }
        index += 1;
      } else if (argument.startsWith('--timeout-minutes=')) {
        timeoutMinutes = Number(argument.slice('--timeout-minutes='.length));
        if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
          process.stderr.write(
            `wait: --timeout-minutes needs a positive number\n${USAGE}`
          );
          return 2;
        }
      } else {
        process.stderr.write(`wait: unknown argument ${argument}\n${USAGE}`);
        return 2;
      }
    }
    return await commandWait({ gate, timeoutMinutes });
  }
  if (command === 'ci-import') {
    const at = rest.indexOf('--run');
    const runId = at === -1 ? null : (rest[at + 1] ?? null);
    if (runId == null || !/^\d+$/.test(runId) || rest.length !== 2) {
      process.stderr.write(`ci-import: --run <numeric run id>\n${USAGE}`);
      return 2;
    }
    return commandCiImport({ runId });
  }
  if (command === 'logs') {
    let branch = null;
    let failedOnly = false;
    let all = false;
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === '--branch') {
        branch = rest[index + 1] ?? null;
        if (branch == null) {
          process.stderr.write(`logs: --branch needs a branch name\n${USAGE}`);
          return 2;
        }
        index += 1;
      } else if (argument.startsWith('--branch=')) {
        branch = argument.slice('--branch='.length);
      } else if (argument === '--failed') {
        failedOnly = true;
      } else if (argument === '--all') {
        all = true;
      } else {
        process.stderr.write(`logs: unknown argument ${argument}\n${USAGE}`);
        return 2;
      }
    }
    return commandLogs({ branch, failedOnly, all });
  }

  // A gate is a name `resolveGate` knows, never a shell command passed through.
  // `--background` is this script's own flag: accepted before the separator,
  // a usage error after it.
  const separator = rest.indexOf('--');
  const ownArgs = separator === -1 ? rest : rest.slice(0, separator);
  const background =
    ownArgs.includes('--background') || ownArgs.includes('--background=true');
  const rerunFailed = ownArgs.includes(RERUN_FAILED_FLAG);
  if (
    separator !== -1 &&
    ownArgs.filter((arg) => !OWN_FLAGS.includes(arg)).length > 0
  ) {
    process.stderr.write(
      `gate: arguments before -- are not supported: ${ownArgs
        .filter((arg) => !OWN_FLAGS.includes(arg))
        .join(' ')}\n${USAGE}`
    );
    return 2;
  }
  // Arguments after `--` go to the gate untouched; before it, this script's
  // own flags are taken out.
  const extraArgs =
    separator === -1
      ? ownArgs.filter((arg) => !OWN_FLAGS.includes(arg))
      : rest.slice(separator + 1);
  if (rerunFailed) {
    return await rerunFailedGate({ command, extraArgs, background });
  }
  // `--background` after the separator would reach the gate as an argument
  // and record a red run about nothing, so it is refused before a runner, a
  // log file or a ledger line exists.
  if (separator !== -1) {
    const misplaced = extraArgs.filter((arg) => BACKGROUND_FLAGS.includes(arg));
    if (misplaced.length > 0) {
      const suite = extraArgs.filter((arg) => !BACKGROUND_FLAGS.includes(arg));
      process.stderr.write(
        `gate: ${misplaced.join(', ')} goes with the gate name, not after --: past ` +
          `the separator the arguments belong to the gate's own command line, and ` +
          `no gate has a --background. For a detached run, \`node scripts/gate.mjs ` +
          `${command} --background${
            suite.length > 0 ? ` -- ${suite.join(' ')}` : ''
          }\`.\n${USAGE}`
      );
      return 2;
    }
  }
  let resolved;
  try {
    resolved = resolveGate(command, extraArgs);
  } catch (error) {
    process.stderr.write(`gate: ${String(error?.message ?? error)}\n${USAGE}`);
    return 2;
  }
  // Checked here, not in `runGate`, so a backgrounded gate is refused in the
  // shell that asked for it instead of leaving a record and a log for a run
  // that never started. The disk is asked last: a missing lease is the more
  // useful thing to be told.
  const leaseBlock =
    isolatedSwitchBlock(resolved.gate, process.env) ??
    deviceGateLeaseBlock(resolved, process.env) ??
    deviceGateDiskBlock(resolved, process.env);
  if (leaseBlock != null) {
    process.stderr.write(`gate: refused before the run - ${leaseBlock}\n`);
    return 1;
  }
  if (background) return await startBackgroundGate(resolved.gate, resolved);
  return await runGate(resolved.gate, resolved, backgroundOptions());
}

/**
 * `<gate> --rerun-failed`: completes the newest full run of the gate that is red
 * on this digest, or refuses before anything runs and says why.
 */
async function rerunFailedGate({ command, extraArgs, background }) {
  if (extraArgs.length > 0 || command.split(':').length !== 2) {
    process.stderr.write(
      `gate: --rerun-failed takes the full gate name and no filter (got ` +
        `${[command, ...extraArgs].join(' ')}): it chooses the units itself\n${USAGE}`
    );
    return 2;
  }
  const read = readTrees();
  const plan = planRerunFailed({
    gate: command,
    entries: readLedger(currentBranch()).entries,
    tree: read.tree,
    trees: read.trees,
    gateTrees: read.gateTrees,
  });
  if (plan.refusal != null) {
    process.stderr.write(`gate: refused before the run - ${plan.refusal}\n`);
    return 1;
  }
  let resolved;
  try {
    resolved = resolveGate(command, plan.filterArgs);
  } catch (error) {
    process.stderr.write(`gate: ${String(error?.message ?? error)}\n${USAGE}`);
    return 2;
  }
  const leaseBlock =
    isolatedSwitchBlock(command, process.env) ??
    deviceGateLeaseBlock(resolved, process.env) ??
    deviceGateDiskBlock(resolved, process.env);
  if (leaseBlock != null) {
    process.stderr.write(`gate: refused before the run - ${leaseBlock}\n`);
    return 1;
  }
  process.stderr.write(
    `gate: completing the red ${command} run of ${String(plan.of.ts)} ` +
      `(attempt ${String(plan.attempt)}): re-running ${String(plan.rerun.length)} ` +
      `unit(s) - ${plan.rerun.join(', ')}\n`
  );
  if (background) return await startBackgroundGate(command, resolved);
  return await runGate(command, resolved, {
    ...backgroundOptions(),
    completion: plan,
  });
}

/** The log a detached run was told to write, from its launcher's variable. */
function backgroundOptions(env = process.env) {
  const fromEnv = env.NITRO_UI_GATE_LOG;
  if (fromEnv == null || fromEnv === '') return {};
  return { logFile: path.resolve(fromEnv) };
}

assertSupportedNodeOrReexec({
  command: 'node scripts/gate.mjs',
  entryUrl: import.meta.url,
});

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`gate: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
