#!/usr/bin/env node
/**
 * The gate ledger: run a named gate, record what it proved, and answer the two
 * questions that used to cost hours per task.
 *
 *   node scripts/gate.mjs check
 *   node scripts/gate.mjs harness:android
 *   node scripts/gate.mjs harness:android -- ColdSizing
 *     ^ records `harness:android:ColdSizing`, which satisfies nothing: a filtered
 *       run is not the platform gate
 *   node scripts/gate.mjs status
 *   node scripts/gate.mjs need --for review
 *   node scripts/gate.mjs need --for merge
 *   node scripts/gate.mjs table
 *   node scripts/gate.mjs export --task X2
 *   node scripts/gate.mjs logs [--branch <b>] [--failed] [--all]
 *
 * Every run appends one JSON line to `.gates/<branch>.jsonl` (gitignored) keyed
 * to the **code tree**, not to HEAD - the digest `app.stamp` already uses
 * (`currentCodeTree()`), which excludes `docs/` and Markdown. That one choice is
 * what removes the re-runs: a docs commit leaves the digest alone, so a green
 * gate is still green, and the process review's "re-ran on the final tree" pass
 * (11 reports) becomes a lookup. See `scripts/gate-core.mjs` for the rules.
 *
 * A run's **log** does not live next to the ledger: it goes in the clone's gate
 * log store - `<git-common-dir>/nitro-ui-gates/<branch>/` - which every worktree
 * of this clone shares and `git worktree remove` never deletes (X12). `.gates/`
 * goes with the checkout, and Q3 could not read the failing runs of a merged
 * branch for exactly that reason. `gate.mjs logs` lists the store; the ledger's
 * `logPath` is relative to it, and old `.gates/logs/...` paths still resolve (and
 * are copied in on the next run). The store is kept to 35 days and 64 MiB.
 *
 * Each line also carries `trees: {ios, android}` - that same digest restricted to
 * the files belonging to each platform. At `review` a device gate is accepted on
 * its own platform's tree, so a fix round that edits only `android/` does not
 * re-owe an iOS run; at `merge` everything is matched on the whole tree. A run
 * that starts a device gate on one tree and ends on another records `treeAfter`
 * and never reads green.
 *
 * A device gate reads its device from the lease (X1), so source the lease first
 * and this file never needs to know a UDID:
 *
 *   set -a; source <(node scripts/lease.mjs acquire --task X2 --platform android); set +a
 *   node scripts/build-app.mjs --platform android
 *   node scripts/gate.mjs harness:android
 *   node scripts/lease.mjs release X2
 *
 * What it refuses: it never claims a gate passed on a tree it did not run on,
 * and `need` exits non-zero with the list of what is missing, so a round can be
 * checked instead of asserted.
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
  DEVICE_CONTEXT_END,
  DEVICE_CONTEXT_START,
  explainNeedRow,
  failureExcerptName,
  findReusableCheck,
  gateLogStoreDir,
  isFailedRunWithLog,
  lastLogLine,
  ledgerLineFromRun,
  ledgerLogCandidates,
  ledgerRelativePath,
  logNameFor,
  logRelativePath,
  LOG_RETENTION_DAYS,
  LOG_RETENTION_MAX_BYTES,
  parseLedger,
  parseTestCounts,
  parseTestSummaries,
  pidMayBeRunning,
  planLogRetention,
  platformTreesFromEntries,
  platformsOwningFile,
  platformsTouchedByPaths,
  renderFailureExcerpt,
  renderGateTable,
  renderStepTimings,
  resolveGate,
  runningBackgroundGates,
  summarizeGates,
  summarizeLoad,
} from './gate-core.mjs';
import { contentHash, isCodeFile } from './app-stamp-core.mjs';
import {
  isReservedSerial,
  pruneExpired,
  readJson,
  stateHome,
  statePaths,
  writeJsonAtomic,
} from './lease-core.mjs';
import { currentCodeTree, repoRootOf } from './app-stamp.mjs';
import { assertSupportedNodeOrReexec } from './node-version.mjs';

const USAGE =
  'usage: node scripts/gate.mjs <gate> [-- <args>] [--background]\n' +
  '       node scripts/gate.mjs wait [--gate <name>] [--timeout-minutes N]\n' +
  '       node scripts/gate.mjs status [--for review|merge]\n' +
  '       node scripts/gate.mjs need --for review|merge [--base <ref>] [--no-reuse]\n' +
  '       node scripts/gate.mjs table [--for review|merge] [--full] [--no-reuse]\n' +
  '       node scripts/gate.mjs export --task <ID> [--out <file>]\n' +
  '       node scripts/gate.mjs logs [--branch <b>] [--failed] [--all] [--prune]\n' +
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
  '       (--background starts a gate detached and returns at once, so waiting\n' +
  '        costs no polling; `wait` then blocks until it ends, prints a progress\n' +
  "        line a minute, and exits with the gate's own code. Exit 13 means\n" +
  '        "still running" - at the --timeout-minutes budget, or on a runner that\n' +
  '        died without recording a result. The ledger line is written by the same\n' +
  '        code either way, so a backgrounded gate is evidence exactly as a\n' +
  '        foreground one is)\n' +
  '\n' +
  "       (at merge, `check` may be satisfied by another branch's ledger when it\n" +
  '        passed on this exact git tree, with a clean worktree, and its commit is\n' +
  '        merged here - the same tree hash means a run here would read the same\n' +
  '        files. Docs included, so a merge that changes anything re-owns the run.\n' +
  '        `check` only: a device gate is evidence about a binary. `--no-reuse` asks\n' +
  '        the strict question instead)\n' +
  '\n' +
  '       (`export --task <ID>` writes docs/tasks/<ID>/gates.jsonl and, for every\n' +
  '        FAILED run, a scrubbed excerpt in docs/tasks/<ID>/failures/ - the failing\n' +
  '        test names, the assertion messages, the last 150 lines, the device\n' +
  '        context and the load at both ends. Passing runs get no file)\n' +
  '\n' +
  "       (`logs` lists this clone's stored gate logs - they live in the git common\n" +
  '        directory, so removing a worktree cannot lose them; --failed limits the\n' +
  '        list to runs the ledger says failed, --all shows every branch, --prune\n' +
  '        applies the 35-day / 64-MiB retention without listing)\n';

/**
 * How often a running gate samples the load average. R4's lesson is that one
 * sample at the end judges a ten-minute run by its last minute, and a harness run
 * on a shared machine is exactly where that matters: the number in the ledger is
 * what lets a reader discount a red row that happened under a Gradle storm.
 */
const LOAD_SAMPLE_INTERVAL_MS = 15_000;

/**
 * Signals to forward to the child. A timeout or a task runner that stops
 * `gate.mjs` by PID used to leave a harness holding the leased device while the
 * ledger recorded nothing; forwarding gives the child its own cleanup, and the
 * signal is re-raised on self afterwards so the exit status is still the signal.
 */
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM'];

/**
 * The flags `gate.mjs` itself owns on a gate run, which must never reach the
 * gate's command line. `--background=true` is accepted because `--for=review`
 * style spelling is how the rest of this CLI's flags are written.
 */
const BACKGROUND_FLAGS = ['--background', '--background=true'];

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

/* ------------------------- the clone's gate log store (X12) ------------------ */

/**
 * The directory that holds one run's log, and why it is not in the worktree.
 *
 * `git rev-parse --git-common-dir` is the shared half of a clone: every linked
 * worktree points at the same one, and `git worktree remove` deletes the worktree's
 * own `.git` file and directory but never this. That is the whole of X12 - logs
 * written under `.gates/` in a worktree died with the worktree, so Q3 could not
 * read the failing runs of the branch it was diagnosing.
 *
 * Layout: `<common-dir>/nitro-ui-gates/<branch>/<gate>-<started-at>.log`, with a
 * pre-X12 log migrated to `<common-dir>/nitro-ui-gates/.gates/logs/...` so an old
 * ledger line's relative path resolves unchanged in the new home too.
 *
 * Falls back to the worktree's own `.gates/` when git cannot be asked (no git
 * binary, a sandbox): losing the move is better than a gate that cannot run, and
 * the fallback keeps the paths under a gitignored directory.
 *
 * `NITRO_UI_GATE_LOG_STORE` overrides the location, which is how a test aims the
 * store at a scratch directory instead of a real clone's common dir. Production
 * never sets it.
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
      // Whether that is a real shared store or the worktree fallback: the
      // difference decides whether the migration below runs at all.
      shared: commonDir != null,
      commonDir,
      // This worktree's own git directory, kept as a last-resort place a log could
      // be (see `ledgerLogCandidates`).
      worktreeGitDir:
        git(['rev-parse', '--absolute-git-dir'], null)?.trim() ?? null,
    };
  }
  return store.cached;
}

/** Where one run's log, its background record and its step timings live. */
function storeLogsDir() {
  return store().dir;
}

/**
 * Where a run's log goes, relative to the store, and its absolute path.
 *
 * `<branch>/<gate>-<started-at>.log`. Branch-keyed because that is the question a
 * reader arrives with ("the logs of that X3 run"), and because a flat directory of
 * five thousand harness logs is unreadable once `logs` has to page through it.
 */
function logPathsFor(branch, gate, startedAt) {
  const relative = logRelativePath(branch, logNameFor(gate, startedAt));
  return {
    logPath: relative,
    absolute: path.join(storeLogsDir(), relative),
  };
}

/**
 * Every path a ledger line's log could be at, first existing first. Order and the
 * reasoning behind it are in `ledgerLogCandidates`.
 */
function resolveLedgerLog(entry) {
  return ledgerLogCandidates(entry, {
    storeDir: storeLogsDir(),
    repoRoot,
    worktreeGitDir: store().worktreeGitDir,
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
 * Copies a worktree's pre-X12 `.gates/logs/` into the shared store, once.
 *
 * Migration rather than only fallback-resolution, and the brief lets me choose and
 * say which: *copy*, not move. A run in flight may still hold one of these files
 * open (a `--background` gate started by an older `gate.mjs`), and evidence that
 * vanishes from under a reader is the failure this whole task is about. The copy is
 * idempotent - an existing file of the same name and size is left alone - and the
 * directory is remembered in `<store>/.migrated` so a normal run costs one stat
 * rather than a walk.
 *
 * The original is left in place: it is gitignored, it is inside a worktree the
 * owner will delete, and deleting someone's files as a side effect of running a
 * gate is not this script's business.
 *
 * @returns {{copied: string[], skipped: number}}
 */
function migrateWorktreeLogs() {
  const location = store();
  if (!location.shared) return { copied: [], skipped: 0 };
  const marker = path.join(location.dir, '.migrated');
  const legacy = path.join(repoRoot, LEDGER_DIR, 'logs');
  if (
    fs.existsSync(marker) ||
    !fs.existsSync(legacy) ||
    !fs.statSync(legacy).isDirectory()
  ) {
    return { copied: [], skipped: 0 };
  }
  const copied = [];
  let skipped = 0;
  const walk = (dir, prefix) => {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, `${prefix}${entry.name}/`);
        continue;
      }
      // Both the log and its `.gate.json` record: a `wait` on a backgrounded run
      // reads the record from the same directory as the log, so migrating one
      // without the other loses a run mid-flight.
      if (!/\.(log|gate\.json|steps\.json)$/.test(entry.name)) continue;
      const target = path.join(
        location.dir,
        LEDGER_DIR,
        'logs',
        `${prefix}${entry.name}`
      );
      try {
        const [from, to] = [fs.statSync(absolute), fs.statSync(target)];
        if (to.size === from.size) {
          skipped += 1;
          continue;
        }
      } catch {
        /* not there yet - copy it */
      }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(absolute, target);
        copied.push(path.relative(location.dir, target));
      } catch {
        // A log we could not copy is still resolvable through the worktree
        // fallback, so this is a note rather than a failure.
        skipped += 1;
      }
    }
  };
  walk(legacy, '');
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(
      marker,
      `migrated ${new Date().toISOString()} from ${legacy}\n${copied.join('\n')}\n`
    );
  } catch {
    /* no marker means next run tries again, which is harmless and idempotent */
  }
  return { copied, skipped };
}

/**
 * Applies the retention rule (35 days, then 64 MiB) to the store.
 *
 * Runs before a gate writes another log, so the directory bounds itself without a
 * cron job nobody sets up. Never touches a log touched in the last two hours - a
 * `check` on a cold machine runs longer than that and a `wait` reading its log
 * would find nothing - and never touches another worktree's in-flight run either,
 * because that run's file is being appended to and is therefore young.
 *
 * @param {{dryRun?: boolean}} [options]
 * @returns {{removed: Array<{file: string, reason: string}>, scanned: number, bytes: number}}
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

/**
 * How long a log is untouchable.
 *
 * Two hours by default, extended to cover the *oldest running background gate*:
 * a 20-minute harness run is inside the grace anyway, but a bench that has run
 * for nine hours is not, and deleting the log of a run that is happening is not a
 * retention win. Reads the records it is about to spare, which is why this is a
 * function rather than a constant.
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
      // The `.gate.json` records travel with their log, and `steps.json` with the
      // run that wrote it, so all three are swept together - a directory of
      // orphaned records is not evidence either.
      if (!/\.(log|gate\.json|steps\.json)$/.test(entry.name)) continue;
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
  return file;
}

/**
 * What a failed device gate was sitting on top of (X12 item 3).
 *
 * Four probes, and a fifth on Android:
 *
 *   - `simctl list devices booted` — which simulators exist on this machine right
 *     now, because "the harness timed out waiting for a boot" is only diagnosable
 *     if you know whether it booted at all;
 *   - `adb -s <leased serial> devices` — the same question for an emulator, asked
 *     *of the leased serial* rather than of the adb server: an unqualified
 *     `adb devices` reports the maintainer's `emulator-5560` as well, and the whole
 *     discipline of X1 is that a script names its own device;
 *   - the lease list, read from the lease file (no subprocess, no mutation) — which
 *     task holds what, and whether this run's lease is even still live;
 *   - `load1`, beside the samples the ledger already carries;
 *   - Android only: the last ~500 lines of `logcat` for the app's pid, from the
 *     leased serial. A Compose crash, a native exception and an ANR are all in that
 *     buffer and in none of the harness's own output.
 *
 * Everything here is read-only, capped, and allowed to fail. A gate's verdict is
 * already on disk before any of it runs.
 *
 * @param {{platform: 'ios'|'android', device: string | null, lease: string | null, env?: NodeJS.ProcessEnv, run?: (command: string, args: string[]) => string | null, leaseFile?: string | null, now?: number}} options
 * @returns {Array<{label: string, ok: boolean, text: string}>}
 */
function collectDeviceContext({
  platform,
  device,
  lease,
  env = process.env,
  run = runProbe,
  leaseFile = null,
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

  // The serial this run was given, if any. `ANDROID_SERIAL` is what the lease
  // exports; `device` is the same string, and both are checked so a hand-set
  // environment cannot smuggle a different one in.
  const serial = env.ANDROID_SERIAL ?? (platform === 'android' ? device : null);
  const adb = env.NITRO_UI_ADB_BIN ?? adbFromSdk(env);
  if (isReservedSerial(serial)) {
    note(
      `adb -s ${String(serial)} devices`,
      '(refused: that serial is the maintainer’s reserved emulator, and no gate may address it)'
    );
  } else if (serial == null || serial === '') {
    note(
      'adb devices',
      '(no serial from the lease, and an unqualified `adb devices` would list devices this task does not own)'
    );
  } else {
    add('adb devices', adb, ['-s', String(serial), 'devices'], 10);
  }

  probes.push({
    label: 'leases',
    ok: true,
    text: describeLeases({ lease, leaseFile, now }),
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
    if (serial == null || serial === '') {
      note(
        'logcat',
        '(refused: no serial from the lease, and an unqualified logcat would read the maintainer’s emulator)'
      );
    } else if (isReservedSerial(serial)) {
      // Checked again, before this second command: a lease can be released and
      // re-handed between the probes, and the reserved serial must not be addressed
      // by a log dump either.
      note('logcat', '(refused: reserved serial)');
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
  return probes;
}

/** How many logcat lines a failure block carries. The brief's "~500". */
const LOGCAT_TAIL_LINES = 500;

/**
 * Runs one probe: `{ok, text}`, where `ok: false` means "no answer".
 *
 * The distinction matters beyond cosmetics. `pidof` output becomes an argument to
 * the *next* command, so a probe that failed and returned its own error text would
 * hand `adb logcat --pid` a paragraph of shell error as a pid - which is how the
 * first version of this function behaved until a test's fake adb tripped it. Every
 * caller treats `ok: false` as a note in the block rather than as data.
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

/** Where `adb` lives, or the bare name when no SDK root is set (as in `lease.mjs`). */
function adbFromSdk(env) {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  return sdk != null && fs.existsSync(path.join(sdk, 'platform-tools/adb'))
    ? path.join(sdk, 'platform-tools/adb')
    : 'adb';
}

/**
 * The lease list, from the lease file.
 *
 * Read rather than `lease.mjs list`, which would shell out to `simctl`/`adb` again
 * and print warnings about devices nobody asked about; and read *without pruning*,
 * because the run that just failed may have been pruned for a ttl it exceeded and
 * that is exactly the fact worth recording.
 */
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
      `  lease file: ${file}`,
      `  this run's lease: ${String(lease ?? 'none')}${lease == null ? '' : mine ? ' (still live)' : ' (no longer live)'}`,
      ...(rows.length === 0 ? ['  (no live leases)'] : rows),
    ].join('\n');
  } catch (error) {
    return `  (could not read the lease file: ${String(error?.message ?? error)})`;
  }
}

/** The block appended to the log, framed by the markers `splitDeviceContext` finds. */
function renderDeviceContext(probes) {
  const lines = [DEVICE_CONTEXT_START];
  for (const probe of probes) {
    lines.push(`gate: ${probe.label}${probe.ok ? '' : ' [unavailable]'}`);
    for (const line of String(probe.text).split('\n')) {
      lines.push(`  | ${line}`);
    }
  }
  lines.push(DEVICE_CONTEXT_END);
  return lines.join('\n');
}

/**
 * The per-step timings `check.mjs` left behind, or null.
 *
 * Null on every problem - no file, unreadable, wrong shape - because the breakdown
 * is a report on the run, not evidence about it: the gate's own exit code decided
 * pass or fail, and a missing timing file must never turn a green `check` red or
 * invent durations for steps that did not run.
 *
 * @param {string | null} file
 * @returns {object | null}
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
 * Reads a background gate's record, or null when it is missing or unreadable.
 *
 * Unreadable is null rather than a throw: `wait` polls this file while another
 * process is writing it, and `writeJsonAtomic` makes a torn read rare but not
 * impossible (a rename is atomic, a reader can still land between the old file
 * leaving and the new one arriving on some filesystems). Treating that as "no
 * record yet" makes `wait` poll again; treating it as an error would turn a
 * 1-in-a-million race into a red gate.
 *
 * @param {string} file
 * @returns {object | null}
 */
function readBackgroundRecord(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Starts a gate detached, and returns straight away.
 *
 * Why (X9): implementers polled background gates with `sleep N; tail` loops, which
 * is both the wrong shape (it cannot see the exit code, so it re-reads the ledger
 * by hand and can misread it) and a waste of a turn per poll. `--background`
 * re-runs *this same command* without the flag, in its own session, with stdout
 * and stderr pointed at the log the ledger will name - so:
 *
 *   - the ledger line is written by the identical code path a foreground run uses
 *     (one implementation of "what a gate run records", not two);
 *   - `wait` has a pid, a log and a record to read, and can therefore report the
 *     gate's real exit code.
 *
 * `detached` plus `unref` is what survives the caller's shell: the gate must not
 * die when the agent's command finishes, and it must not hold the launcher open.
 *
 * @param {string} name
 * @param {object} resolved
 * @returns {number} 0 once the child is confirmed running
 */
async function startBackgroundGate(name, resolved) {
  const startedAt = Date.now();
  // Both halves of the pair live in the clone's log store, so a `wait` from a
  // *different worktree* of the same clone can follow a run, and so the log outlives
  // `git worktree remove` of the one that started it (X12).
  migrateWorktreeLogs();
  pruneLogStore();
  const logsDir = storeLogsDir();
  fs.mkdirSync(logsDir, { recursive: true });
  const { logPath, absolute: absoluteLog } = logPathsFor(
    currentBranch(),
    name,
    startedAt
  );
  // The branch subdirectory, not just the store root: this is the process that
  // opens the file, and a first run on a new branch has no directory to write into.
  fs.mkdirSync(path.dirname(absoluteLog), { recursive: true });
  const recordPath = backgroundRecordPath(absoluteLog);
  const logHandle = fs.openSync(absoluteLog, 'a');

  // Written *before* the child starts: a `wait` that runs one second later must
  // find a pid, not an empty directory and a mystery. `done: false` is explicit so
  // a reader never has to guess whether a missing field means "running" or "old
  // format".
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
  });

  // Re-run *this same command* minus --background, spelled from argv[1] rather
  // than from the caller's own argv: assuming the flag was the last argument would
  // silently drop whatever else happened to sit there.
  const childArgs = [
    process.argv[1],
    ...process.argv.slice(2).filter((arg) => !BACKGROUND_FLAGS.includes(arg)),
  ];
  const child = spawn(process.execPath, childArgs, {
    cwd: repoRoot,
    env: { ...process.env, NITRO_UI_GATE_LOG: absoluteLog },
    // 'ignore' rather than an fd we open ourselves: Node owns and closes it.
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

  // The record is rewritten with the real pid the moment it is known, and the
  // launcher then waits briefly for the child to either start cleanly or fail
  // immediately: a mistyped gate name should be reported now, not discovered by
  // `wait` five minutes later as a corpse.
  //
  // Only while the record still says "not done". A gate that finishes inside the
  // few milliseconds between spawn and this write would otherwise have its own
  // `done: true` record overwritten back to a running one by the parent - a race
  // that turns a passed gate into a phantom. `wait` also cross-checks the ledger,
  // so a resurrected record cannot lie about the result; not creating one is the
  // difference between a guarded race and an unguarded one.
  const before = readBackgroundRecord(recordPath);
  if (before?.done !== true) {
    writeJsonAtomic(recordPath, { ...before, pid: child.pid });
  }
  const earlyExit = await new Promise((resolvePromise) => {
    // Deliberately *not* unref'd, and `child.unref()` happens after this await:
    // unref'd both the timer and the child while still awaiting the child's `exit`
    // event left the event loop empty, so the launcher exited with an unsettled
    // top-level await (Node's own exit code 13) and no answer at all. The handle
    // has to stay live for the window, then go, or the launcher would never return
    // while its detached child runs.
    const timer = setTimeout(() => resolvePromise(null), 750);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
  child.unref();
  if (earlyExit != null) {
    // Two different things can end this early: a gate that could not start at all,
    // and a gate that *finished* inside the launcher's own observation window (a
    // stamp-fresh `check`, or a fixture that exits instantly). The record tells them
    // apart, because only the finished one wrote it. Collapsing the two would report
    // a passed gate as "exited immediately" with a failure code - and, worse, hand
    // back a code that contradicts the ledger line sitting on disk.
    const after = readBackgroundRecord(recordPath);
    if (after?.done === true) {
      const code =
        after.exitCode == null
          ? after.result === 'pass'
            ? 0
            : 1
          : Number(after.exitCode);
      process.stderr.write(
        `gate: ${name} finished before this launcher handed off (exit ${String(code)}) - see ${logPath}\n`
      );
      return code;
    }
    process.stderr.write(
      `gate: ${name} exited immediately with ${String(earlyExit.code ?? earlyExit.signal)} - see ${logPath}\n`
    );
    writeJsonAtomic(recordPath, {
      ...after,
      done: true,
      finishedAt: Date.now(),
      exitCode: earlyExit.code ?? 1,
      signal: earlyExit.signal,
      error: 'exited immediately',
    });
    return 1;
  }

  process.stdout.write(
    `gate: ${name} started in the background (pid ${String(child.pid)})\n` +
      `gate: log    ${logPath}\n` +
      `gate: wait   node scripts/gate.mjs wait --gate ${name}\n`
  );
  return 0;
}

/**
 * Blocks until a backgrounded gate finishes, then exits with *its* code.
 *
 * One progress line a minute (elapsed plus the log's last line) rather than a
 * `sleep; tail` loop the caller has to write: the point is that waiting for a
 * twenty-minute gate costs one blocked command and a predictable exit code.
 *
 * Exit codes: the gate's own, or `STILL_RUNNING_EXIT` for "not finished yet"
 * (timeout, or a runner that died without recording). A caller can branch on that
 * difference, which is the whole reason for the distinct code.
 *
 * @param {object} options
 * @param {string | null} options.gate which gate to wait for (default: the newest)
 * @param {number} options.timeoutMinutes
 */
async function commandWait({ gate, timeoutMinutes }) {
  const timeoutMs = timeoutMinutes * 60_000;
  const startedWaiting = Date.now();
  const logsDir = storeLogsDir();
  const records = listBackgroundRecords(logsDir).filter(
    (record) => gate == null || record.gate === gate
  );
  if (records.length === 0) {
    process.stderr.write(
      `wait: no background gate${gate == null ? '' : ` named ${gate}`} in ${logsDir}\n` +
        'wait: start one with `node scripts/gate.mjs <gate> --background`\n'
    );
    return 2;
  }
  // Newest first: `wait` with no `--gate` means "the thing I just started", and
  // several runs of the same gate name in one branch is normal (a re-run after a
  // fix), so "latest" has to be the tie-break.
  records.sort((a, b) => Number(b.startedAt ?? 0) - Number(a.startedAt ?? 0));
  const target = records[0];
  // Resolved the same way a ledger line's log is: the record names the store-relative
  // path, and this worktree may not be the one that started the run.
  const absoluteLog =
    resolveLedgerLog({ logPath: target.logPath }).file ?? 'dev/null';
  process.stderr.write(
    `wait: ${target.gate} (pid ${String(target.pid ?? '?')}) - budget ${String(timeoutMinutes)} min\n`
  );

  let printedAt = 0;
  for (;;) {
    const elapsedMs = Date.now() - startedWaiting;
    const record = readBackgroundRecord(target.recordPath) ?? target;
    // The ledger line for *this* run, matched on its log path - the one field that
    // is unique per run (a gate name repeats across re-runs on the same branch). It
    // is both the fallback answer when a runner dies and the proof that a
    // backgrounded gate recorded exactly what a foreground one would.
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
 * Every background record in the log store, newest files first.
 *
 * Walks the store rather than reading one directory, because logs are keyed by
 * branch (`<store>/task/X12-…/check-….log`), and a `wait` that only looked at the
 * top level would report "no background gate" for every run anyone started after
 * X12 - the exact wrong answer for a tool whose whole job is not polling.
 *
 * Also reads a worktree's own `.gates/logs/` when it still has one: a run started
 * by an older `gate.mjs` writes its record there, and `wait` may be the next
 * command anyone types after the upgrade.
 *
 * @param {string} logsDir the store root
 * @returns {object[]}
 */
function listBackgroundRecords(logsDir) {
  const roots = [logsDir];
  const legacy = path.join(repoRoot, LEDGER_DIR, 'logs');
  if (logsDir !== legacy) roots.push(legacy);
  const found = [];
  const seen = new Set();
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
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      found.push(absolute);
    }
  };
  for (const root of roots) walk(root);
  return found
    .map((file) => readBackgroundRecord(file))
    .filter((record) => record != null);
}

/**
 * The digests a decision needs: the full code tree, the two platform halves of it,
 * and the two fields merge reuse reads (git's own hash of the tracked tree, and
 * whether the worktree matches it).
 *
 * The halves are built here rather than in `app-stamp.mjs` so the stamp stays
 * what it is (one digest for one binary, X1) and `build-app.mjs` - which task X6
 * is editing right now - is untouched. The file listing and the hashing rules
 * mirror `currentCodeTree()` exactly, including the skip-what-is-deleted and
 * hash-the-link-target cases, so a platform digest is the same hash function over
 * a subset of the same file set and nothing else.
 *
 * `fullTree` is git's answer, not ours: `rev-parse HEAD^{tree}` hashes everything
 * tracked, `docs/` and `bench/` included, which is the blindness `tree` deliberately
 * has and reuse cannot afford. It is null in a repository with no commit, and reuse
 * treats null as "not reusable" rather than as a wildcard.
 *
 * `worktreeClean` is `git status --porcelain --untracked-files=all` coming back empty
 * at the moment this was read. Inside a gate that is genuinely true (every step's
 * output lands in a gitignored path - `lib/`, `.turbo/`, `.reassure/`, `.gates/`), and
 * it is false the moment someone has an unsaved edit, which is exactly when a recorded
 * tree stops describing what was run.
 *
 * @returns {{tree: string, head: string, files: number, trees: Record<string, string>, fullTree: string | null, worktreeClean: boolean}}
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
    // Tooling and docs are in no platform's half; this is what keeps a fix round
    // that edits `scripts/gate.mjs` from re-owing two device runs.
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
    fullTree: git(['rev-parse', 'HEAD^{tree}'], null) || null,
    worktreeClean: gitStatusIsClean(),
  };
}

/**
 * Whether the working tree matches HEAD, untracked files included.
 *
 * One `--porcelain=v1` call, and the answer is `false` whenever git could not be
 * asked: an unknown worktree is not a clean one, and this gates a claim that a tree
 * was checked on its own.
 *
 * @returns {boolean}
 */
function gitStatusIsClean() {
  const status = git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    null
  );
  return status != null && status.trim() === '';
}

/**
 * The code paths this branch changed, against the review base (default `main`).
 *
 * Three sources, because a round is usually part-committed: committed diff,
 * uncommitted tracked edits, and untracked new files. The last one matters most -
 * a new `example/harness/New.harness.tsx` is the reason a suite needs running, and
 * it is invisible to `git diff`.
 *
 * @returns {{paths: string[], base: string | null, unknown: boolean}}
 */
function changedCodePaths({ base }) {
  const mergeBase = git(['merge-base', base, 'HEAD']);
  if (mergeBase == null || mergeBase === '') {
    // No merge-base (a shallow clone, or a base ref that does not exist here).
    // `need` then asks for both platforms and says why: guessing "nothing"
    // would let a diff nobody could read silently satisfy a round.
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

/**
 * Run one gate: tee its output to a log, sample the load while it goes, and
 * record the result against the tree the command actually saw.
 *
 * The tree is read *before* the spawn and again after it. Reading it only before
 * would let an edit that happened during a five-minute run be recorded as if the
 * run had seen it; recording only the starting tree would let a run that started
 * on one tree and finished on another be read as evidence about either. Both are
 * recorded, and a line where they differ is never green (N1).
 */
async function runGate(name, resolved, options = {}) {
  const branch = currentBranch();
  const before = readTrees();
  const device = deviceFromEnv(process.env, resolved.platform);
  const startedAt = Date.now();
  const startedLoad = os.loadavg()[0] ?? null;
  const samples = [startedLoad];
  const sampler = setInterval(() => {
    samples.push(os.loadavg()[0] ?? Number.NaN);
  }, LOAD_SAMPLE_INTERVAL_MS);

  // Logs go in the clone's store, shared by every worktree and untouched by
  // `git worktree remove` (X12). A backgrounded run's log path comes from the record
  // the launcher wrote, so `wait` knows where to read progress from before this
  // process has printed a thing; the path is store-relative either way, which is
  // what the ledger records and what `logs`/`export` resolve it against.
  migrateWorktreeLogs();
  pruneLogStore();
  const logsDir = storeLogsDir();
  fs.mkdirSync(logsDir, { recursive: true });
  const own = logPathsFor(branch, name, startedAt);
  const logPath = options.logPath ?? own.logPath;
  const absoluteLog = path.join(logsDir, logPath);
  fs.mkdirSync(path.dirname(absoluteLog), { recursive: true });
  // Appending for a backgrounded run: the launcher already has that file open in
  // append mode for this process's own stdout/stderr, and truncating it here would
  // erase the lines that explain a crash.
  const logStream = fs.createWriteStream(absoluteLog, {
    flags: options.logPath == null ? 'w' : 'a',
  });
  let logText = '';
  // A backgrounded run's stdout *is* the log file, so echoing there as well as
  // writing the stream would put every line in the log twice. The ledger parses
  // `logText` rather than the file, so a doubled run would still record correct
  // counts - the damage is to the reader who follows the `gate: log …` line and
  // finds a transcript with every line in it twice. Foreground runs still echo.
  const echo = options.logPath == null;
  const tee = (chunk, output) => {
    logText += String(chunk);
    logStream.write(chunk);
    if (echo) output.write(chunk);
  };

  const cwd =
    resolved.cwd === 'example' ? path.join(repoRoot, 'example') : repoRoot;
  // `check` is the one gate long enough that its total is not an actionable
  // number, so the runner is asked to leave its per-step timings somewhere this
  // process can read back (X10). Named from the log so one run cannot read another
  // run's breakdown, and removed from the child env by `check.mjs` itself so a
  // nested check cannot answer for its parent.
  const stepTimingsPath =
    resolved.gate === 'check' ? `${absoluteLog}.steps.json` : null;
  process.stderr.write(
    `gate: ${name}\n` +
      `gate: ${resolved.argv.join(' ')} (cwd ${path.relative(repoRoot, cwd) || '.'})\n` +
      `gate: code tree ${before.tree.slice(0, 12)} at HEAD ${git(['rev-parse', '--short', 'HEAD'], '?')}\n` +
      // Recorded on the line and the thing reuse compares, so "why was my pass not
      // reusable" is answerable from the transcript rather than by reading the code.
      `gate: git tree ${String(before.fullTree ?? '<no commit>').slice(0, 12)}${
        before.worktreeClean ? '' : ' with a DIRTY worktree (not reusable)'
      }\n` +
      // Store-relative, and the absolute path beside it: `logPath` is what the
      // ledger and `table --full` print, and the absolute one is what you actually
      // open - which is no longer inside the worktree you are standing in.
      `gate: log ${logPath}\n` +
      `gate:       ${absoluteLog}\n`
  );

  const exit = await new Promise((resolvePromise) => {
    const child = spawn(resolved.argv[0], resolved.argv.slice(1), {
      cwd,
      // `NITRO_UI_GATE_LOG` is this runner's own instruction and must not go further:
      // a `gate.mjs` nested inside a gate (a check that shells out to one, say) would
      // otherwise append to *this* run's log and mark *this* run's record done with
      // its own exit code. Deleting it here is what makes that variable mean "the log
      // of the background run I am the launcher of", one level, not inherited.
      env: (() => {
        const childEnv = { ...process.env };
        delete childEnv.NITRO_UI_GATE_LOG;
        if (stepTimingsPath != null) {
          childEnv.NITRO_UI_CHECK_STEPS_FILE = stepTimingsPath;
        }
        return childEnv;
      })(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let forwarded = null;
    const handlers = FORWARDED_SIGNALS.map((signal) => {
      const handler = () => {
        // Only the direct child gets it: a signal sent to this PID alone used to
        // orphan a harness that still held the leased device (N4). A Ctrl-C from a
        // terminal reaches the child as well, via the process group.
        forwarded = signal;
        try {
          child.kill(signal);
        } catch {
          /* already gone */
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
    child.on('close', (code, signal) => {
      stopListening();
      resolvePromise({ code, signal, failedToStart: false, forwarded });
    });
  });

  clearInterval(sampler);
  samples.push(os.loadavg()[0] ?? Number.NaN);
  const durationMs = Date.now() - startedAt;
  const after = readTrees();
  logStream.end();
  // Wait for the log to reach the disk before any re-raise below can kill the
  // process: a ledger line pointing at a truncated log is half the evidence.
  await finished(logStream).catch(() => {});

  const stepTimings = readStepTimings(stepTimingsPath);
  // `check` is the one gate whose own exit code can be a lie about doing work (M3).
  // A runner that exits 0 without starting a step - the entry guard not matching, a
  // plan that resolved to nothing - looks exactly like a green run from here, so for
  // this gate a recorded step list is part of the evidence: no steps, no pass. Only
  // when the breakdown exists at all: a runner that could not *write* the file (an
  // unwritable log directory, an older runner) must stay green, which is what the
  // null path below means.
  const ranNothing =
    name === 'check' && stepTimings != null && stepTimings.steps.length === 0;
  const result =
    exit.code === 0 && exit.signal == null && !ranNothing ? 'pass' : 'fail';
  const summaries = parseTestSummaries(logText);
  const line = ledgerLineFromRun({
    // The canonical name from `resolveGate`, never `argv[0]`: one harness suite
    // run with `-- ColdSizing` used to be recorded as the full `harness:android`
    // and then satisfied `need` (M1).
    gate: name,
    command: resolved.argv.join(' '),
    tree: before.tree,
    trees: before.trees,
    treeAfter: after.tree,
    // The pair merge reuse reads, measured at the *start* of the run, which is the
    // tree the child actually began with. Two conservatisms here: if git's tree moved
    // during the run - a docs commit landing mid-flight moves `fullTree` and nothing
    // else - no tree is claimed, because the run spanned two of them; and cleanliness
    // has to hold at both ends, so a line cannot certify a tree that was being edited
    // underneath it (M3).
    fullTree:
      before.fullTree != null && after.fullTree === before.fullTree
        ? before.fullTree
        : null,
    worktreeClean: before.worktreeClean && after.worktreeClean,
    head: before.head,
    branch,
    platform: device.platform,
    device: device.device,
    lease: device.lease,
    load: summarizeLoad({ start: startedLoad, samples }),
    durationMs,
    result,
    // `counts` is the first summary (the unit-test step) and `summaries` all of
    // them, so `check`'s row can report 391 jest tests rather than the 7-test
    // perf step that happened to print last (M3).
    counts: parseTestCounts(logText) ?? summaries[0] ?? null,
    summaries,
    stepTimings,
    logPath,
    startedAt,
    exitCode: exit.code ?? (exit.signal != null ? null : 1),
    signal: exit.signal,
  });
  const file = appendLedgerLine(branch, line);
  // A backgrounded run's record says "done" only now: the ledger line is on disk,
  // so a `wait` that returns on this signal can read the row back and `need` can
  // act on it. Marking it done earlier would report a gate whose evidence is not
  // there yet.
  if (options.recordPath != null) {
    writeJsonAtomic(options.recordPath, {
      ...readBackgroundRecord(options.recordPath),
      done: true,
      finishedAt: Date.now(),
      exitCode: exit.code ?? (exit.signal != null ? null : 1),
      signal: exit.signal,
      result,
      ledgerLine: line,
    });
  }

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
  if (result === 'fail' && resolved.bench) {
    process.stderr.write(
      'gate: a bench never blocks `need` - benches go to the bench host (D15).\n'
    );
  }

  // Item 3 (X12): a failed *device* gate appends what the device was doing to the
  // log it just wrote, so the red row arrives with its own context instead of with
  // "re-run it and hope it prints something next time". Keyed on the gate's own
  // platform, not on the environment: a `check` that happens to run with
  // ANDROID_SERIAL set is still not a device gate, and probing a device it does not
  // own would be wrong. Best-effort by design: the verdict is already recorded and
  // flushed above, so every probe here is allowed to fail and say so in one line.
  if (result === 'fail' && resolved.platform != null) {
    const context = collectDeviceContext({
      platform: resolved.platform,
      device: device.device,
      lease: device.lease,
      env: process.env,
    });
    try {
      fs.appendFileSync(absoluteLog, `\n${renderDeviceContext(context)}\n`);
    } catch {
      /* a log we cannot append to is still a log the run wrote */
    }
    process.stderr.write(
      `gate: appended the device context to ${logPath} (${context.length} probe(s))\n`
    );
  }
  if (exit.forwarded != null) {
    // The line is written and the log is flushed, so the signal can now do its
    // default work and the caller's exit status still says "interrupted".
    process.stderr.write(`gate: re-raising ${exit.forwarded}\n`);
    process.kill(process.pid, exit.forwarded);
    return 1;
  }
  if (exit.signal != null) return 1;
  // The recorded result decides, not the child's status alone: `check` can exit 0
  // having started no steps, and a caller that read that 0 would merge on the fail
  // line written above (M3). A child that failed on its own still reports its code.
  if (result === 'fail') return exit.code === 0 ? 1 : (exit.code ?? 1);
  return exit.code ?? 0;
}

function printCodeTree({ tree, trees, head, files, fullTree, worktreeClean }) {
  process.stderr.write(
    `ledger: code tree ${tree.slice(0, 12)} at HEAD ${String(head ?? '?').slice(0, 7)} (branch ${currentBranch()}, ${String(files)} files)\n`
  );
  process.stderr.write(
    `ledger: platform trees ${PLATFORMS.map((platform) => `${platform} ${String(trees?.[platform] ?? '?').slice(0, 12)}`).join(' ')}\n`
  );
  // The two fields merge reuse reads, printed next to the digest they are not: a
  // reader deciding whether a borrow is owed should see what the rule will see.
  process.stderr.write(
    `ledger: git tree ${String(fullTree ?? '<no commit>').slice(0, 12)} (what reuse compares), worktree ${
      worktreeClean === true ? 'clean' : 'DIRTY - nothing here is reusable'
    }\n`
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
    tree: read.tree,
    trees: read.trees,
    stage,
  });
  for (const row of rows) {
    const entry = row.entry;
    const detail =
      entry == null
        ? ''
        : ` [${String(entry.tree).slice(0, 12)}${row.matched == null ? ' not this tree' : row.matched === 'full' ? '' : ` ${row.matched} tree`}${formatMaybe(entry.durationMs)}${entry.lease != null ? ` lease ${entry.lease}` : ''}${row.why === 'moved' ? ' tree moved mid-run' : ''}]`;
    process.stdout.write(`${row.state.padEnd(7)} ${row.gate}${detail}\n`);
  }
  const green = rows.filter((row) => row.state === 'green').length;
  process.stdout.write(
    `\n${String(green)} green, ${String(rows.filter((r) => r.state === 'red').length)} red, ${String(rows.filter((r) => r.state === 'stale').length)} stale, ${String(rows.filter((r) => r.state === 'missing').length)} missing for this code tree (${stage})\n`
  );
  // A gate started with `--background` is *happening right now*, and a row that
  // says "missing" for it is the most misleading thing this command could print
  // while someone decides whether to start the gate they are already running.
  for (const entry of runningBackgroundGates(
    listBackgroundRecords(storeLogsDir())
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
 * Every branch ledger in `.gates/` except one, for merge reuse.
 *
 * A merge's evidence usually lives on the branch that was merged, so `need --for
 * merge` on `main` has to look outside `main`'s own ledger. Branch names nest
 * (`task/X10-check-throughput` becomes `.gates/task/X10-….jsonl`), which is why
 * this walks rather than globs a flat directory; the name it returns is the branch,
 * recovered from the path, because that is what the note has to cite.
 *
 * @param {string} exceptBranch the branch whose own ledger is not "other"
 * @returns {Array<{branch: string, entries: object[], source: string}>}
 */
function otherBranchLedgers(exceptBranch) {
  const found = [];
  const walk = (dir, prefix) => {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.jsonl')) continue;
      const branch = `${prefix}${entry.name.slice(0, -'.jsonl'.length)}`;
      if (branch === exceptBranch) continue;
      let text;
      try {
        text = fs.readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }
      found.push({
        branch,
        source: path.relative(repoRoot, absolute),
        entries: parseLedger(text),
      });
    }
  };
  walk(path.join(repoRoot, LEDGER_DIR), '');
  return found;
}

/**
 * The ledgers committed beside task reports: `docs/tasks/<ID>/gates.jsonl`.
 *
 * A committed ledger travels; a live one does not, and that is the whole difference. `.gates/` is
 * gitignored, so in the checkout where a merge is confirmed - `main`, often a different worktree
 * altogether - no branch's `.gates/` lines exist; the export from `gate.mjs export --task <ID>` is
 * the copy that arrived with the merge commit. A reuse rule that read only `.gates/` would be right
 * in a test and useless in the flow it was written for.
 *
 * What a committed line proves is narrower than its wording suggests, and the rules know it (X10
 * review N4). Ancestry ties a line to *this history*, and an equal `fullTree` is the actual evidence
 * that the code was checked; neither of them authenticates the file - anyone who can commit can edit
 * a `gates.jsonl` line, give it some ancestor `head` and today's tree hash, and be believed. Two
 * things make that a poor attack: the forger has to commit the same tree they are certifying, so
 * anything they could have gained by lying was already checked by an honest run of the same bytes or
 * not at all; and an export is written by the machine that ran the gate, so a false one is
 * attributable in a way a stale claim in prose is not. Trusting the committed ledger is the
 * alternative to re-running `check` after every merge, which is the cost this rule exists to remove;
 * it is stated plainly in ORCHESTRATOR rather than papered over.
 *
 * @param {string} exceptBranch the branch whose own ledger is not "other"
 * @returns {Array<{branch: string, entries: object[], source: string}>}
 */
function committedTaskLedgers(exceptBranch) {
  const found = [];
  const tasksDir = path.join(repoRoot, 'docs', 'tasks');
  let names;
  try {
    names = fs.readdirSync(tasksDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const file = path.join(tasksDir, entry.name, 'gates.jsonl');
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const entries = parseLedger(text).filter((line) => !line.corrupt);
    if (entries.length === 0) continue;
    // `export` copies one branch's ledger verbatim, so the lines carry their own
    // branch name; the path is the fallback and is also what the note cites.
    const branch =
      entries.find((line) => typeof line.branch === 'string')?.branch ??
      `docs/tasks/${entry.name}/gates.jsonl`;
    if (branch === exceptBranch) continue;
    found.push({
      branch,
      source: path.relative(repoRoot, file),
      entries,
    });
  }
  return found;
}

/**
 * Whether `commit` is in the history of the tree being asked about.
 *
 * This is the difference between "some branch once had this code" and "this
 * evidence came from the work that produced it". A line whose head cannot be
 * resolved here (a squash-merged branch, a different machine) is not evidence, so
 * an unreadable commit is a `false`, not a guess.
 */
function commitIsAncestorOfHead(commit) {
  const sha = String(commit ?? '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  if (git(['cat-file', '-e', `${sha}^{commit}`], null) == null) return false;
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', sha, 'HEAD'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  return result.status === 0;
}

/**
 * The `check` reuse available for this tree, or null. `--no-reuse` turns it off, which is how a
 * reviewer re-derives the strict answer when they do not believe the reuse.
 *
 * Everything git is asked here is a read: the tree hash and worktree state come from `readTrees`,
 * and the only other question is ancestry. There is no diff, because comparing two hashes makes the
 * question redundant - and that is the whole point of the rewrite (X10 round 2): the diff is where
 * the allowlist lived, and the allowlist is what could be fooled.
 *
 * @param {string} branch the branch whose own ledger is already being read
 * @param {{fullTree: string | null, worktreeClean: boolean}} read the caller's `readTrees()` result
 * @param {string[]} [diagnostics] filled with why each candidate was refused, so `need` can print the
 *   reason instead of a shrug
 * @returns {{branch: string, entry: object, source: string} | null}
 */
function reusableCheckFor(branch, read, diagnostics = null) {
  return findReusableCheck({
    ledgers: [...otherBranchLedgers(branch), ...committedTaskLedgers(branch)],
    fullTree: read.fullTree,
    worktreeClean: read.worktreeClean,
    headIsAncestor: commitIsAncestorOfHead,
    diagnostics,
  });
}

function commandNeed({ stage, base, reuse = true }) {
  const branch = currentBranch();
  const read = readTrees();
  const { entries, exists } = readLedger(branch);
  const diff = changedCodePaths({ base });
  const touched = diff.unknown
    ? { platforms: [...PLATFORMS], unmapped: [], tooling: [] }
    : platformsTouchedByPaths(diff.paths);

  // Why reuse was declined, kept to print: "this tree was never checked" is a claim a
  // reviewer can only audit if the reason is on the page (the pass was recorded over a
  // dirty worktree, its commit is not merged, a newer fail outranks it), and silence
  // would look like the reuse rule never fired.
  const reuseRefusals = [];
  const decision = decideNeed({
    entries,
    tree: read.tree,
    trees: read.trees,
    stage,
    touchedPlatforms: touched.platforms,
    unmappedPaths: touched.unmapped,
    toolingPaths: touched.tooling,
    diffUnknown: diff.unknown,
    reusedCheck:
      stage === 'merge' && reuse
        ? reusableCheckFor(branch, read, reuseRefusals)
        : null,
    reuseRefusals: reuseRefusals,
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

function commandTable({ stage, full, reuse = true }) {
  const branch = currentBranch();
  const read = readTrees();
  const { entries, exists } = readLedger(branch);
  printCodeTree(read);
  const reusedCheck =
    stage === 'merge' && reuse ? reusableCheckFor(branch, read) : null;
  if (!exists && reusedCheck == null) {
    // "Nothing recorded yet" is only the whole answer when no other branch's ledger
    // can account for this tree either - on `main` right after a merge, the merge
    // bar is exactly what this table has to show.
    process.stderr.write('table: nothing recorded yet - run a gate first.\n');
    return 1;
  }
  const table = renderGateTable({
    entries,
    tree: read.tree,
    trees: read.trees,
    stage,
    required: MERGE_GATES,
    reusedCheck,
    evidence:
      full === true
        ? (entry) => `log \`${String(entry.logPath ?? '')}\``
        : null,
  });
  process.stdout.write(`${table}\n`);
  if (full === true) {
    // Per-step durations, for the one gate where the total is not the useful
    // number. Under `--full`, because a report's gate table is five device rows and
    // sixteen step rows would bury them. Gates with no breakdown print nothing, so
    // this stays `check`'s section in practice without naming it as such.
    const steps = renderStepTimings({ entries, gates: MERGE_GATES });
    if (steps !== '') process.stdout.write(`\n${steps}\n`);
  }
  return 0;
}

function commandExport({ task, out }) {
  const branch = currentBranch();
  const { entries, file, exists } = readLedger(branch);
  if (!exists) {
    process.stderr.write('export: nothing recorded yet - run a gate first.\n');
    return 1;
  }
  const target =
    out ??
    (task != null ? path.join('docs', 'tasks', task, 'gates.jsonl') : null);
  if (target == null) {
    process.stderr.write(
      `export: name the task (--task X2) or the file (--out <file>).\n${USAGE}`
    );
    return 1;
  }
  const absolute = path.isAbsolute(target)
    ? target
    : path.join(repoRoot, target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  // The evidence has to survive its author: each line is copied **verbatim** rather
  // than re-serialised, so a committed ledger is byte-identical to what ran - a
  // corrupt line in particular stays exactly as corrupt as it was, rather than
  // becoming a plausible-looking object.
  const rawText = fs.readFileSync(file, 'utf8');
  const rawLines = rawText.split('\n').filter((raw) => raw.trim() !== '');

  // Item 2 (X12): a red row in the committed ledger used to arrive with no evidence
  // attached, so the reader had to go to the machine that ran the gate - which is
  // the thing X12 item 1 fixes for the owner and this fixes for everyone else.
  // Written *before* the ledger, because the ledger is about to name these files.
  const failuresDir =
    task != null ? path.join('docs', 'tasks', task, 'failures') : null;
  const { lines, written, missing } = exportFailureExcerpts({
    rawLines,
    entries,
    failuresDir,
  });
  fs.writeFileSync(absolute, `${lines.join('\n')}\n`);
  process.stdout.write(
    `export: ${String(entries.filter((entry) => !entry.corrupt).length)} gate line(s) from ${path.relative(repoRoot, file)} -> ${path.relative(repoRoot, absolute)}\n`
  );
  if (failuresDir != null) {
    const failed = entries.filter(isFailedRunWithLog).length;
    process.stdout.write(
      `export: ${String(written.length)} failure excerpt(s) in ${failuresDir}${
        written.length === 0 ? ' (no failed runs in this ledger)' : ''
      }\n`
    );
    for (const w of written) {
      process.stdout.write(
        `export:   ${w.relative} (${String(w.scrubbed)} value(s) scrubbed${
          w.truncated ? ', truncated' : ''
        })\n`
      );
    }
    for (const m of missing) {
      // Loud, not silent: a red row whose log cannot be found is exactly the hole
      // this feature exists to close, and the reader has to be able to tell "no
      // failure happened" from "we could not find the evidence".
      process.stdout.write(
        `export:   NOTE no log for the failed \`${m.gate}\` run (${String(m.logPath)}); looked in:\n${m.candidates
          .map((candidate) => `export:           ${candidate}`)
          .join('\n')}\n`
      );
    }
    if (failed > 0 && written.length === 0 && failuresDir != null) {
      process.stdout.write(
        `export:   full logs live in ${storeLogsDir()} of the clone that ran them\n`
      );
    }
  }
  return 0;
}

/**
 * Writes one excerpt per **failed** run in the exported ledger, and returns the
 * ledger lines with `failureLogPath` filled in.
 *
 * Passing runs are passed through **byte-verbatim** and get no file (the brief's
 * "never copies a passing run's log"): a directory of green logs is not evidence, it
 * is a disk charge, and re-serialising the other lines would quietly rewrite a
 * corrupt line into a plausible one. Only a failed line is re-emitted, and only to
 * add `failureLogPath` - the run could not know the name of the file that would
 * carry its excerpt.
 *
 * A failed line whose log cannot be found keeps its original text and produces a
 * note instead of a file.
 *
 * @param {{rawLines: string[], entries: object[], failuresDir: string | null}} options
 * @returns {{lines: string[], written: Array<{relative: string, scrubbed: number, truncated: boolean}>, missing: Array<{gate: string, logPath: string, candidates: string[]}>}}
 */
function exportFailureExcerpts({ rawLines, entries, failuresDir }) {
  const lines = [];
  const written = [];
  const missing = [];
  rawLines.forEach((raw, index) => {
    const entry = entries[index];
    if (!isFailedRunWithLog(entry)) {
      lines.push(raw);
      return;
    }
    const found = resolveLedgerLog(entry);
    if (found.file == null) {
      lines.push(raw);
      missing.push({
        gate: String(entry.gate ?? '?'),
        logPath: String(entry.logPath),
        candidates: found.candidates,
      });
      return;
    }
    if (failuresDir == null) {
      // `--out <file>` with no `--task`: nowhere to put an excerpt, and inventing a
      // directory beside someone's chosen file name would be worse than saying so.
      lines.push(raw);
      missing.push({
        gate: String(entry.gate ?? '?'),
        logPath: String(entry.logPath),
        candidates: [
          'no --task, so there is no docs/tasks/<ID>/failures/ to write to',
        ],
      });
      return;
    }
    let text;
    try {
      // Capped: a hung harness run's log can be enormous and an excerpt reads its
      // head and tail, not all of it. See `readLogForExcerpt`.
      text = readLogForExcerpt(found.file);
    } catch (error) {
      lines.push(raw);
      missing.push({
        gate: String(entry.gate ?? '?'),
        logPath: String(entry.logPath),
        candidates: [`unreadable: ${String(error?.message ?? error)}`],
      });
      return;
    }
    const relative = path
      .join(failuresDir, failureExcerptName(entry))
      .split(path.sep)
      .join('/');
    const excerpt = renderFailureExcerpt({
      entry,
      logText: text,
      logLocation: found.file,
    });
    const absolute = path.join(repoRoot, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, excerpt.content);
    written.push({
      relative,
      scrubbed: excerpt.scrubbed,
      truncated: excerpt.truncated,
    });
    lines.push(JSON.stringify({ ...entry, failureLogPath: relative }));
  });
  return { lines, written, missing };
}

/** The largest log an excerpt will read. 200 MiB; see the call site. */
const EXCERPT_MAX_LOG_BYTES = 200 * 1024 * 1024;

function readLogForExcerpt(file) {
  const stats = fs.statSync(file);
  if (stats.size <= EXCERPT_MAX_LOG_BYTES) return fs.readFileSync(file, 'utf8');
  // Head and tail of an over-large log, so a scrubbed excerpt still shows the
  // failure and the end rather than an arbitrary 200 MiB prefix.
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8 * 1024 * 1024);
    fs.readSync(fd, head, 0, head.length, 0);
    const tail = Buffer.alloc(64 * 1024 * 1024);
    fs.readSync(fd, tail, 0, tail.length, stats.size - tail.length);
    return `${head.toString('utf8')}\n… skipped ${String(
      Math.round((stats.size - head.length - tail.length) / 1024 / 1024)
    )} MiB of log …\n${tail.toString('utf8')}`;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * `gate.mjs logs` — what is in this clone's log store, newest first.
 *
 * The command the brief asks for, and the answer to "where are my logs" now that
 * they are not in the worktree: it prints the store's location in its header so a
 * reader who has never seen this change is not left looking in `.gates/logs/`.
 *
 * Filtering by *failure* needs the ledgers, not the store: a log file's name says
 * which branch and gate it was, but only the ledger line knows whether it passed.
 *
 * @param {{branch: string | null, failedOnly: boolean, all: boolean, prune: boolean}} options
 */
function commandLogs({ branch, failedOnly, all, prune }) {
  const storeDir = storeLogsDir();
  const location = store();
  // Listing the store is the moment someone is thinking about disk, so the
  // retention rule is applied here too (as it is on every gate run).
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
  if (prune === true) {
    process.stdout.write(
      `logs: ${String(pruning.scanned)} file(s) scanned, ${String(pruning.removed.length)} removed, ${formatBytes(pruning.bytes)} kept\n`
    );
    return 0;
  }

  const wanted = branch != null ? [branch] : all ? null : [currentBranch()];
  const failedPaths = failedOnly ? failedLogPathsFor(wanted) : null;
  const branches = [
    ...new Set([...listStoredLedgerBranches(), ...listBranchDirs(storeDir)]),
  ];
  const logs = listStoredLogs(storeDir)
    .filter(
      (log) =>
        !log.file.endsWith('.gate.json') && !log.file.endsWith('.steps.json')
    )
    .sort((a, b) => Number(b.mtimeMs) - Number(a.mtimeMs));

  let shown = 0;
  for (const log of logs) {
    const relative = path.relative(storeDir, log.file);
    const owner = branchOfStoredLog(relative, branches);
    if (wanted != null && !wanted.includes(owner)) continue;
    if (
      failedPaths != null &&
      !failedPaths.has(relative) &&
      !failedPaths.has(log.file)
    )
      continue;
    process.stdout.write(
      `  ${new Date(log.mtimeMs).toISOString()}  ${formatBytes(log.bytes).padStart(9)}  ${relative}\n`
    );
    shown += 1;
  }
  process.stdout.write(
    `${String(shown)} log file(s) ${wanted == null ? 'from every branch' : `for ${wanted.join(', ')}`}${
      failedOnly ? ' that the ledger says failed' : ''
    }\n`
  );
  if (shown === 0 && !failedOnly && wanted != null && !all) {
    process.stdout.write(
      'logs: (pass --all to see every branch, or --branch <b> for a specific one)\n'
    );
  }
  return 0;
}

/**
 * Which stored logs belong to a *failed* run, according to the ledgers.
 *
 * Reads the branch ledgers named by the filter (or every branch's, under `--all`),
 * because a log file's name is a hint about its outcome at best.
 */
function failedLogPathsFor(branches) {
  const paths = new Set();
  const names =
    branches == null ? [...new Set(listStoredLedgerBranches())] : branches;
  for (const name of names) {
    for (const entry of readLedger(name).entries) {
      if (!isFailedRunWithLog(entry)) continue;
      paths.add(String(entry.logPath));
      // A pre-X12 line names a worktree path; a migrated copy of the same file is
      // under `.gates/logs/` in the store, so both spellings count.
      paths.add(path.join(storeLogsDir(), String(entry.logPath)));
      paths.add(
        path.join(storeLogsDir(), LEDGER_DIR, 'logs', String(entry.logPath))
      );
    }
  }
  return paths;
}

/** Every branch that has a ledger in this checkout, `main` first-ish. */
function listStoredLedgerBranches() {
  return otherBranchLedgers(null)
    .map((ledger) => ledger.branch)
    .concat([currentBranch()]);
}

/** Branch-named directories directly in the store, for a log with no ledger. */
function listBranchDirs(storeDir) {
  try {
    return fs
      .readdirSync(storeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The branch a stored log belongs to.
 *
 * Longest known branch name that is a prefix of the path wins, because branch names
 * nest: `task/X12-…/check-….log` belongs to `task/X12-…`, not to `task`. A migrated
 * pre-X12 log under `.gates/logs/` has no owner to recover and reads `(unknown)`.
 */
function branchOfStoredLog(relative, branches) {
  const normalised = relative.split(path.sep).join('/');
  if (normalised.startsWith(`${LEDGER_DIR}/`)) return '(unknown)';
  const owner = branches
    .filter((name) => normalised.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length)[0];
  return owner ?? '(unknown)';
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${String(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * `--for review|merge` for the read-only commands, defaulting to `review`.
 *
 * Review is the stricter question about *this* round, and it is the one a report
 * pastes, so it is the default; `--for merge` shows the bar the branch has to
 * clear as a whole. A stale row is never a FAIL and never a PASS in either view.
 */
function parseStageOption({ rest, command }) {
  let stage = 'review';
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--for' || argument === '--stage') {
      stage = rest[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith('--for=')) {
      stage = argument.slice('--for='.length);
    } else if (argument === '--full' && command === 'table') {
      continue; // read by the caller
    } else if (argument === '--no-reuse' && command === 'table') {
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
  if (command == null || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === 'status' || command === 'table') {
    const { stage } = parseStageOption({ rest, command });
    if (stage == null) return 2;
    return command === 'status'
      ? commandStatus({ stage })
      : commandTable({
          stage,
          full: rest.includes('--full'),
          reuse: !rest.includes('--no-reuse'),
        });
  }
  if (command === 'need') {
    let stage = null;
    let base = process.env.NITRO_UI_GATE_BASE ?? 'main';
    let reuse = true;
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === '--for' || argument === '--stage') {
        stage = rest[index + 1] ?? null;
        index += 1;
      } else if (argument.startsWith('--for=')) {
        stage = argument.slice('--for='.length);
      } else if (argument === '--base') {
        base = rest[index + 1] ?? base;
        index += 1;
      } else if (argument.startsWith('--base=')) {
        base = argument.slice('--base='.length);
      } else if (argument === '--no-reuse') {
        reuse = false;
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
    return commandNeed({ stage, base, reuse });
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
  if (command === 'export') {
    let task = process.env.NITRO_UI_TASK ?? null;
    let out = null;
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === '--task') {
        task = rest[index + 1] ?? null;
        index += 1;
      } else if (argument === '--out') {
        out = rest[index + 1] ?? null;
        index += 1;
      } else {
        process.stderr.write(`export: unknown argument ${argument}\n${USAGE}`);
        return 2;
      }
    }
    return commandExport({ task, out });
  }

  if (command === 'logs') {
    let branch = null;
    let failedOnly = false;
    let all = false;
    let prune = false;
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
      } else if (argument === '--prune') {
        prune = true;
      } else {
        process.stderr.write(`logs: unknown argument ${argument}\n${USAGE}`);
        return 2;
      }
    }
    return commandLogs({ branch, failedOnly, all, prune });
  }

  // A gate is a name in this table, not a shell command: passing through whatever
  // arrived would make `gate.mjs rm -rf` a thing that works.
  //
  // `--background` is pulled out before the separator check, so both
  // `harness:android --background -- ColdSizing` and its position after the gate
  // name work; anything *after* `--` is left alone, because past the separator the
  // arguments belong to the gate's own command line and are not ours to eat.
  const separator = rest.indexOf('--');
  const ownArgs = separator === -1 ? rest : rest.slice(0, separator);
  const background =
    ownArgs.includes('--background') || ownArgs.includes('--background=true');
  if (
    separator !== -1 &&
    ownArgs.filter((arg) => !BACKGROUND_FLAGS.includes(arg)).length > 0
  ) {
    process.stderr.write(
      `gate: arguments before -- are not supported: ${ownArgs
        .filter((arg) => !BACKGROUND_FLAGS.includes(arg))
        .join(' ')}\n${USAGE}`
    );
    return 2;
  }
  // Past the separator the arguments belong to the gate's own command line, so they
  // are passed through untouched; before it, the flags this script owns are taken
  // out - leaving `--background` in would reach `check` as an argument of its own,
  // which it rightly refuses.
  const extraArgs =
    separator === -1
      ? ownArgs.filter((arg) => !BACKGROUND_FLAGS.includes(arg))
      : rest.slice(separator + 1);
  let resolved;
  try {
    resolved = resolveGate(command, extraArgs);
  } catch (error) {
    process.stderr.write(`gate: ${String(error?.message ?? error)}\n${USAGE}`);
    return 2;
  }
  if (background) return await startBackgroundGate(resolved.gate, resolved);
  return await runGate(resolved.gate, resolved, backgroundOptions());
}

/**
 * Where a detached run must put its log, read from the variable the launcher set.
 *
 * Validated rather than trusted: an inherited `NITRO_UI_GATE_LOG` from somebody's
 * shell profile would otherwise send a gate's log - which `wait` reads and the
 * ledger names - to a path of its choosing, and `bun run check` inherits the
 * environment of whatever started it. It has to be an absolute path inside the
 * clone's log store (or, pre-X12, this checkout's own `.gates/logs/`), ending in
 * `.log`; otherwise it is ignored and the run behaves exactly like a foreground one.
 *
 * The value it returns is **store-relative**, which is what the ledger records and
 * what `ledgerLogCandidates` resolves, so a background run's line points at the same
 * file `wait` was reading.
 */
function backgroundOptions(env = process.env) {
  const fromEnv = env.NITRO_UI_GATE_LOG;
  if (fromEnv == null || fromEnv === '') return {};
  const absolute = path.resolve(fromEnv);
  const allowedRoots = [
    storeLogsDir(),
    path.join(repoRoot, LEDGER_DIR, 'logs'),
  ];
  const root = allowedRoots.find(
    (dir) =>
      absolute.startsWith(`${path.resolve(dir)}${path.sep}`) &&
      absolute.endsWith('.log')
  );
  if (root == null) {
    process.stderr.write(
      `gate: ignoring NITRO_UI_GATE_LOG=${fromEnv} - a background gate's log has to be inside ${storeLogsDir()}\n`
    );
    return {};
  }
  return {
    logPath: path.relative(path.resolve(root), absolute),
    recordPath: backgroundRecordPath(absolute),
  };
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
