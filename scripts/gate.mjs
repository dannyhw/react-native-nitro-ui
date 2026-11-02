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
  isUsageProbe,
  lastLogLine,
  ledgerFileName,
  ledgerLineFromRun,
  ledgerLogCandidates,
  ledgerRelativePath,
  localPathRedactions,
  logNameFor,
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
  renderFailureExcerpt,
  renderGateTable,
  renderStepTimings,
  resolveGate,
  runningBackgroundGates,
  storedLogFailed,
  summarizeGates,
  summarizeLoad,
} from './gate-core.mjs';
import { contentHash, isCodeFile } from './app-stamp-core.mjs';
import {
  SUITE_TIMING_ENV,
  SUITE_TIMING_GATE_ENV,
  formatSuiteTimings,
  readSuiteTiming,
  suiteTimingPath,
} from './harness-suite-timing.mjs';
import { claimDevicesFromEnv } from './device-pool.mjs';
import {
  emulatorSerial,
  isReservedSerial,
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
  '       (NITRO_UI_GATE_DEVICE_FORCE=1 claims a device another live run holds)\n' +
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
  "        list to runs the store's own record says failed (a log it cannot judge is\n" +
  '        reported as unknown, not silently skipped), --all shows every branch, --prune\n' +
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
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * The flags `gate.mjs` itself owns on a gate run, which must never reach the
 * gate's command line. `--background=true` is accepted because `--for=review`
 * style spelling is how the rest of this CLI's flags are written.
 */
const BACKGROUND_FLAGS = ['--background', '--background=true'];

/** Set to run a device gate on a device another live run has claimed (see `runGate`). */
const DEVICE_FORCE_RE = /^(1|true|yes)$/i;

/** Set to start on a Metro port another process is already serving (see `metroPreflight`). */
const METRO_FORCE_RE = /^(1|true|yes)$/i;

/**
 * How long a finished run's output is given to drain before the ledger is written (see the
 * drain in `runGateUnclaimed`). Two seconds because the thing being waited for is the last
 * few kilobytes of a harness summary, and the thing being refused is waiting on a descendant
 * that has already outlived the run it came from.
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
 * pre-X12 log migrated to `<common-dir>/nitro-ui-gates/.gates/logs/<branch>/...` so
 * an old ledger line's relative path resolves unchanged in the new home too.
 *
 * A run's log, its background record and its step timings all go here, and the
 * record says which worktree started the run: the store is shared by every worktree
 * of the clone, so `wait` and `status` need something to tell "my background gate"
 * from another task's (X12 fix round, M1).
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
      // The absolute path of *this* checkout. The store cannot tell two worktrees
      // of one clone apart, and `wait` has to (M1), so every record carries it.
      worktree: repoRoot,
    };
  }
  return store.cached;
}

/** Where one run's log, its background record and its step timings live. */
function storeLogsDir() {
  return store().dir;
}

/**
 * The two paths of one run, decided in one place (review N7).
 *
 * Both halves of a backgrounded gate need them - the launcher opens the file and
 * writes a record naming it, the runner writes into it and the ledger line names it -
 * and they used to be derived twice. The consequence was real: an older launcher
 * points `NITRO_UI_GATE_LOG` at this checkout's `.gates/logs/`, the runner joined
 * that *name* onto the store, and the run wrote `<store>/<name>` while the record and
 * any reader looked for `.gates/logs/<name>`. The log a reader was sent to had never
 * been written.
 *
 * So: the absolute path is the truth, and the ledger's `logPath` is derived from it.
 * A path inside the store is spelled store-relative (the current format); a legacy
 * one keeps its `.gates/logs/...` spelling, which `ledgerLogCandidates` resolves. The
 * record, the ledger line and `wait` therefore cannot point at three different files.
 *
 * @param {{branch: string, gate: string, startedAt: number, fromEnv?: string | null}} run
 * @returns {{logPath: string, absolute: string, recordPath: string, backgrounded: boolean}}
 */
/**
 * The real path of `file`, resolving through symlinks as far as the filesystem can.
 *
 * Two reasons this is not just `fs.realpathSync`: a log that has not been created yet
 * has no realpath, and "cannot resolve" is not a reason to return nothing - so the
 * nearest existing ancestor is resolved and the remainder re-joined. Otherwise a first
 * run in a new directory would compare differently from every later one. The second
 * reason is why any of this exists: on macOS `/var` is a symlink to `/private/var`, so
 * a checkout created under one spelling does not prefix-match the other, and
 * `logPathsFor` decides permission with a prefix test.
 *
 * @param {string} file
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

function logPathsFor({ branch, gate, startedAt, fromEnv = null }) {
  // Resolved, not merely absolutised, and everywhere in this function: on macOS `/var`
  // is a symlink to `/private/var`, so a checkout created under one spelling does not
  // prefix-match the other, and the checks below are prefix tests. Comparing mixed
  // spellings can turn a *legitimate* launcher path into an apparent intrusion.
  const storeDir = realpathOrResolved(storeLogsDir());
  const legacy = realpathOrResolved(path.join(repoRoot, LEDGER_DIR, 'logs'));
  let absolute = null;
  if (fromEnv != null && fromEnv !== '') {
    const candidate = realpathOrResolved(path.resolve(fromEnv));
    const ownBranchDir = path.join(
      storeDir,
      // This branch's own directory in the store: the only place the launcher that
      // sets this variable ever writes (`logPathsFor` with no `fromEnv`).
      ledgerFileName(branch).replace(/\.jsonl$/, '')
    );
    const inside = (dir) => candidate.startsWith(`${dir}${path.sep}`);
    // Narrower than round 1's "anywhere in the store" (review N8): the store is one
    // directory shared by the whole clone, so that rule admitted another worktree's
    // run and another branch's. An inherited or leaked `NITRO_UI_GATE_LOG` would then
    // have this run append its output into *that* log, name it in this branch's ledger
    // line, and mark that run's `.gate.json` done - which is how one task's `wait`
    // ends up returning while its own gate is still running.
    const allowed =
      candidate.endsWith('.log') && (inside(ownBranchDir) || inside(legacy));
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
  const logPath = absolute.startsWith(`${legacy}${path.sep}`)
    ? `${LEDGER_DIR}/logs/${path.relative(legacy, absolute).split(path.sep).join('/')}`
    : path.relative(storeDir, absolute).split(path.sep).join('/');
  return {
    logPath,
    absolute,
    recordPath: backgroundRecordPath(absolute),
    backgrounded,
  };
}

/**
 * Every path a ledger line's log could be at, first existing first. Order and the
 * reasoning behind it are in `ledgerLogCandidates`.
 *
 * The line's own `branch` is passed as the legacy copy's directory: after
 * `git worktree remove` there is no checkout left to ask which worktree wrote a
 * `.gates/logs/...` path, and the branch the line carries is what the migration
 * keyed that directory by.
 */
function resolveLedgerLog(entry) {
  const branch =
    typeof entry?.branch === 'string' && entry.branch !== ''
      ? entry.branch
      : currentBranch();
  // The log name is derivable from the line alone: `ts` *is* the `startedAt` the
  // name was made from. So a line whose `logPath` was spelled by older code - the
  // N7 case, where a legacy launcher's path was joined onto the store and the file
  // was never written - can still be offered its canonical path.
  const startedAt = Date.parse(String(entry?.ts ?? ''));
  const own = logPathsFor({
    branch,
    gate: entry?.gate ?? 'gate',
    startedAt: Number.isFinite(startedAt) ? startedAt : 0,
  });
  return ledgerLogCandidates(entry, {
    storeDir: storeLogsDir(),
    repoRoot,
    logBranch: branch,
    // Offered last: a line whose `logPath` predates this function can name a file
    // that was never written (N7), and the canonical path for that run is worth one
    // more stat before `export` says it found no log.
    extraCandidates: own.absolute,
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
 * Copies a worktree's pre-X12 `.gates/logs/` into the shared store, once per
 * worktree.
 *
 * Migration rather than only fallback-resolution, and the brief lets me choose and
 * say which: *copy*, not move. A run in flight may still hold one of these files
 * open (a `--background` gate started by an older `gate.mjs`), and evidence that
 * vanishes from under a reader is the failure this whole task is about. The copy is
 * idempotent - an existing file of the same name and size is left alone - and it
 * keeps the original's mtime, because a 35-day rule that starts at the copy date
 * would give last month's logs a fresh month of life and sort them as new under the
 * size cap.
 *
 * **Per worktree, not per clone** (review M3): the store is shared, and one marker
 * there meant the first worktree to migrate stopped every other worktree from ever
 * doing so - the other tasks' legacy logs stayed in `.gates/logs/` and died with
 * them, which is the exact loss this task exists to prevent. The marker therefore
 * lives *with the logs it covers*, in the worktree's own `.gates/logs/.migrated`:
 * it is gitignored, it cannot outlive the directory it describes, and it needs no
 * worktree hash to name.
 *
 * The copies land under `<store>/.gates/logs/<branch>/`, keyed by the branch that
 * wrote them: that is the one identity a pre-X12 ledger line still carries after
 * `git worktree remove`, so `ledgerLogCandidates` can find the file from the line
 * alone. Two worktrees cannot check out the same branch, so the key is per worktree
 * in practice; the branch namespacing also stops two worktrees' same-named legacy
 * logs colliding. A genuine same-name-different-bytes conflict leaves the stored
 * copy alone and is counted, rather than overwriting evidence with evidence.
 *
 * The original is left in place: it is gitignored, it is inside a worktree the
 * owner will delete, and deleting someone's files as a side effect of running a
 * gate is not this script's business.
 *
 * @returns {{copied: string[], skipped: number, conflicts: number}}
 */
function migrateWorktreeLogs() {
  const location = store();
  if (!location.shared)
    return { copied: [], skipped: 0, conflicts: 0, stale: 0 };
  const legacy = path.join(repoRoot, LEDGER_DIR, 'logs');
  if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory()) {
    return { copied: [], skipped: 0, conflicts: 0, stale: 0 };
  }
  const copied = [];
  let skipped = 0;
  let conflicts = 0;
  let stale = 0;
  // Anything this old is deleted by retention the moment it lands in the store, so
  // copying it achieves nothing except a delete: before this check, every run
  // re-migrated an expired legacy log, watched retention remove it, and appended two
  // more lines to `.migrated` about having done so (review N7). The age is measured
  // against the same rule retention uses, not a copy of it.
  const retentionCutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const destination = path.join(
    location.dir,
    LEDGER_DIR,
    'logs',
    // The branch keeps two worktrees' legacy logs apart, and it is the one thing an
    // old ledger line still names after its worktree is gone - so the key has to be
    // exactly what `ledgerLogCandidates` can rebuild from the line. Two worktrees
    // cannot check out the same branch, so this is per-worktree in practice; two
    // detached ones are the case the conflict counter below covers.
    currentBranch()
  );
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
      // The `.migrated` note is not evidence, and neither is anything else here.
      if (entry.name === MIGRATION_NOTE) continue;
      // Both the log and its `.gate.json` record: a `wait` on a backgrounded run
      // reads the record from the same directory as the log, so migrating one
      // without the other loses a run mid-flight.
      if (!/\.(log|gate\.json|steps\.json)$/.test(entry.name)) continue;
      try {
        // Expired evidence does not become evidence by being copied.
        if (fs.statSync(absolute).mtimeMs < retentionCutoff) {
          stale += 1;
          continue;
        }
      } catch {
        continue;
      }
      const target = path.join(destination, `${prefix}${entry.name}`);
      try {
        const [from, to] = [fs.statSync(absolute), fs.statSync(target)];
        if (to.size === from.size) {
          skipped += 1;
          continue;
        }
        // Same name, different bytes: two runs that disagree about what happened.
        // Keep the one already in the store and say so - a copy that silently
        // replaces stored evidence is the bug, not the collision.
        conflicts += 1;
        continue;
      } catch {
        /* not there yet - copy it */
      }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(absolute, target);
        // Retention reads mtime, so a migrated log has to keep the one it earned.
        const from = fs.statSync(absolute);
        fs.utimesSync(target, from.atime, from.mtime);
        copied.push(path.relative(location.dir, target));
      } catch {
        // A log we could not copy is still resolvable through the worktree
        // fallback, so this is a note rather than a failure.
        skipped += 1;
      }
    }
  };
  walk(legacy, '');
  // Only a run that moved something has anything to report, so the note cannot grow
  // one line per gate run on a worktree that settled long ago. Expired files counted
  // as *moved* before, which is how `.migrated` grew by two lines per run on a
  // worktree with a legacy log past retention (review N7).
  if (copied.length > 0 || conflicts > 0) {
    writeMigrationNote(
      path.join(legacy, MIGRATION_NOTE),
      repoRoot,
      copied,
      conflicts
    );
  }
  return { copied, skipped, conflicts, stale };
}

/** The name of the provenance note `migrateWorktreeLogs` leaves behind. */
const MIGRATION_NOTE = '.migrated';

/**
 * Appends this run's line to the note inside the directory it just copied.
 *
 * Provenance only - a reader asking "did this worktree's old logs make it?" finds the
 * answer here, beside the files it describes, in a gitignored directory that dies with
 * the worktree exactly when the question stops mattering. It is deliberately *not* read
 * back as a gate on the copy: that is what made the old per-clone marker lose the other
 * worktrees' logs (review M3), and an idempotent copy needs no permission.
 *
 * Tolerant of failure: a note that cannot be written costs a line of history, not
 * evidence.
 */
function writeMigrationNote(file, worktree, copied, conflicts) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      `# migrated ${new Date().toISOString()} from ${worktree}\n` +
        `${copied.map((name) => `# copied ${name}`).join('\n')}${copied.length > 0 ? '\n' : ''}` +
        (conflicts > 0
          ? `# ${String(conflicts)} name conflict(s) left alone\n`
          : '')
    );
  } catch {
    /* provenance, not evidence */
  }
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
 * Applies retention and says out loud what it deleted, for both run paths.
 *
 * Both a foreground run and a backgrounded launch call it, before the log is opened:
 * a store nobody ever prunes is a store that fills a disk during an orchestration.
 * Printing when and only when something went is what makes the rule auditable - a
 * silent `rm` of evidence at the start of an unrelated command is not, and the line
 * is also how a test tells "retention ran here" from "the other half ran it later".
 *
 * @param {string} [context] the prefix, so a caller can read as itself
 * @returns {{removed: Array<{file: string, reason: string}>, scanned: number, bytes: number, kept: number}}
 */
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
 * How long a log is untouchable.
 *
 * Two hours by default, extended to cover the *oldest running background gate*:
 * a 20-minute harness run is inside the grace anyway, but a bench that has run
 * for nine hours is not, and deleting the log of a run that is happening is not a
 * retention win. Reads the records it is about to spare, which is why this is a
 * function rather than a constant.
 *
 * A *foreground* run has no record to read, so it is protected only by its mtime: a
 * run that writes nothing for two hours while the store sits over the cap can have
 * its log swept mid-flight. That is a pathological case (the sweep only runs at the
 * start of a run, and a store over 64 MiB of five-thousand-file age on a machine
 * running gates is not what happens here), so the answer is this sentence rather than
 * a lock file per run.
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
      // The `.gate.json` records travel with their log, `steps.json` with the run that
      // wrote it (X10) and `suites.json` with the harness run that wrote it (X11), so
      // all four are swept together - a directory of orphaned records is not evidence
      // either. Anything named `<log>.<something>.json` that is left out of this list
      // is a file that can never be deleted: it sits in the store forever, growing past
      // the cap retention is supposed to hold.
      if (!/\.(log|gate\.json|steps\.json|suites\.json)$/.test(entry.name))
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
 *   - `adb -s <leased serial> get-state` — the same question for an emulator, asked
 *     of *one* device: the one this run's lease names. Nothing here lists devices.
 *     A host-side `adb devices` reports every emulator the adb server can see, the
 *     maintainer's `emulator-5560` among them, and that output would then be
 *     committed in an excerpt; the whole discipline of X1 is that a script names its
 *     own device and asks nothing about anyone else's;
 *   - the lease list, read from the lease file (no subprocess, no mutation) — which
 *     task holds what, and whether this run's lease is even still live;
 *   - `load1`, beside the samples the ledger already carries;
 *   - Android only: the last ~500 lines of `logcat` for the app's pid, from the
 *     leased serial. A Compose crash, a native exception and an ANR are all in that
 *     buffer and in none of the harness's own output.
 *
 * **The device comes from the lease, not from the environment** (review N6). A
 * leftover `ANDROID_SERIAL` in a shell would otherwise have an iOS failure probe
 * somebody else's emulator, and a gate that never took a lease would probe a device
 * it has no claim on. With no lease there is no device probe: the block says so, in
 * as many words, because "we did not touch a device" is itself the fact a reader
 * needs.
 *
 * Everything here is read-only, capped, and allowed to fail. A gate's verdict is
 * already on disk before any of it runs.
 *
 * @param {{platform: 'ios'|'android', lease: string | null, env?: NodeJS.ProcessEnv, run?: (command: string, args: string[]) => {ok: boolean, text: string} | null, leaseFile?: string | null, devicesFile?: string | null, now?: number}} options
 * @returns {Array<{label: string, ok: boolean, text: string}>}
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
  // adb is asked only of an *Android* gate, and only of the serial this run's lease
  // names. A pair holds an iOS simulator and an emulator together, so without the
  // platform check a failed iOS gate would be probing its pair's emulator too - not
  // another task's device, but still a device this gate never touched.
  const asksAdb = platform === 'android';
  if (!asksAdb) {
    note(
      'adb get-state',
      '(not an Android gate, so no emulator is asked about)'
    );
  } else if (claimed.reason != null) {
    // No lease, an expired lease, or a reserved serial: `claimedDevice` refused and
    // said which, and the sentence is the same for both adb commands.
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
  // One pass over every probe's text, answers and error messages alike, for the
  // identifiers this run does not own (review N6). The questions are host-wide -
  // `simctl list devices booted` answers with every simulator on the Mac, and adb
  // puts a serial in its own error text - so without this the block names another
  // task's device, or the maintainer's, and the block is copied verbatim into a
  // committed excerpt. Done here rather than in `renderDeviceContext` so the *log*
  // is clean as well, since that is what `export` reads.
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
 * The device this run may ask about, from **its own lease record**.
 *
 * `leases.json` names the pair the lease holds and `devices.json` says which serial
 * that pair's emulator has (`emulator-<console port>`, the same derivation
 * `lease.mjs acquire` prints into the env file it hands out), so the answer comes
 * from the same pair of files the lease itself was granted from — never from a shell
 * variable that outlived the task that set it.
 *
 * Deliberately conservative: anything unreadable, unleased or expired means "do not
 * probe", with a sentence explaining which. A probe of a device this run does not
 * own is a hygiene breach; a missing probe is a gap in one log.
 *
 * @returns {{file: string | null, reason: string | null, missing: string, serial: string | null, udid: string | null, entry: object | null}}
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
  // `devices.json` is read here rather than through `normalizeDevices` on purpose:
  // the pool validator refuses a whole file over one bad pair, and a diagnostic probe
  // that loses everything because of an unrelated pair is worse than one that reads
  // the fields it needs and then applies the serial rule itself. The reserved check
  // below is that rule, and it is reachable - which is the point of not pre-validating.
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
  // The reserved serial is refused here, in one place, so every adb command below is
  // covered rather than each checking for itself. It is reachable even though
  // `lease.mjs` refuses to grant such a pair: a `devices.json` can be edited, and a
  // pool file that names the maintainer's emulator is the failure X1 exists for.
  if (isReservedSerial(out.serial)) {
    out.reason = `(refused: ${out.serial} is the maintainer’s reserved emulator, and no gate may address it)`;
    out.serial = null;
  }
  return out;
}

/** Does this lease's record claim a device on the Android side at all? */
function platformWantsAndroid(entry) {
  const platform = String(entry?.platform ?? '');
  return platform === 'android' || platform === 'both';
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
 *
 * The file is named as `<lease file>`, not as an absolute path: this block ends up in
 * a committed excerpt, and `~/.nitro-ui/leases.json` under a maintainer's home is the
 * kind of line D25 keeps out of the repo. A reader on the machine that ran the gate
 * knows where the lease file is.
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
      '  lease file: <lease file>',
      `  this run's lease: ${String(lease ?? 'none')}${lease == null ? '' : mine ? ' (still live)' : ' (no longer live)'}`,
      ...(rows.length === 0 ? ['  (no live leases)'] : rows),
    ].join('\n');
  } catch (error) {
    return `  (could not read the lease file: ${String(error?.message ?? error)})`;
  }
}

/**
 * The block appended to the log, framed by the markers `splitDeviceContext` finds.
 *
 * Starts with the two paths a reader wants and must not have to guess: where this
 * log's full copy is, and which checkout ran it. Both in placeholder form
 * (`<store>/task/X3/check-….log`, `<repo>`) for the same D25 reason as the lease
 * file above — and the store-relative half is the useful half, because it is what a
 * `gate.mjs logs` invocation takes.
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
 * The records `wait` and `status` may consider: this checkout's, still running.
 *
 * Both filters are load-bearing. `foreground` marks a record written by a run that
 * was not backgrounded - the store keeps those so `logs --failed` can name the
 * outcome after the worktree is gone, and they are never something to wait for.
 * `ownBackgroundRecords` then drops the other worktrees' runs (M1).
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
  // The log and the record both live in the clone's log store, so the log outlives
  // `git worktree remove` of the worktree that started the run (X12). They are *not*
  // shared between worktrees in the sense that matters to `wait`: the record names
  // the worktree that started it, and only that worktree waits for it (M1).
  migrateWorktreeLogs();
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
  // The branch subdirectory, not just the store root: this is the process that
  // opens the file, and a first run on a new branch has no directory to write into.
  fs.mkdirSync(path.dirname(absoluteLog), { recursive: true });
  const logHandle = fs.openSync(absoluteLog, 'a');

  // Written *before* the child starts: a `wait` that runs one second later must
  // find a pid, not an empty directory and a mystery. `done: false` is explicit so
  // a reader never has to guess whether a missing field means "running" or "old
  // format". `branch` and `worktree` are what make this record *mine*: the store is
  // shared by every worktree of the clone, and `wait` has to tell my run from the
  // other tasks' runs in the same directory (M1).
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
/**
 * Runs one gate, holding a claim on the device it is about to use (X11).
 *
 * Two rules make this worth a wrapper around the runner:
 *
 *   - a device gate marks its lease's devices *in use* for the duration of the run, so a reap
 *     started by another task cannot power off an emulator mid-suite, and a second gate on the
 *     same device is refused before it spends four minutes building rather than after it fought
 *     over Metro and the screenshots;
 *   - the claim dies with the process whether the run ends well or not, because a claim is a pid
 *     and a reaper treats a dead pid as no claim. No `finally` has to succeed for the device to
 *     become reclaimable - which is why a killed gate cannot wedge a device.
 *
 * Nothing is claimed when the environment names no lease (a plain `bun run check`, CI): the
 * claim is about a machine's pool, not about a run in general. `NITRO_UI_GATE_DEVICE_FORCE=1`
 * claims a device another live run holds, for the one case where that is the point - it is an env
 * var rather than a flag because a backgrounded gate is re-spawned from this command line, and a
 * flag here would need stripping in two places to keep it out of the gate's own argv.
 *
 * Then the Metro pre-flight (X15 item 1), which the claim cannot cover: a claim is a pid in a
 * pool record, and the server on a pair's Metro port can belong to a run whose lease has already
 * ended, so no claim exists to conflict with. That is X4's incident, so the port is asked about
 * directly, before the build rather than after the app has joined a stranger's Metro.
 */
async function runGate(name, resolved, options = {}) {
  let claim = null;
  if (resolved.platform != null) {
    const preflight = metroPreflight();
    // A number, not `{ status }`: reading `.status` off it is `undefined`, which is
    // "not 0", so every device gate would have returned `undefined` here - the run
    // never started, nothing was recorded, and the process exited 0 on the silence.
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
    // Best-effort and never fatal: an unreachable state file must not turn a
    // passing run into a failing one, and the pid rule above already frees the
    // device if this does not happen.
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
 * Does a Metro server belong to the run that has just ended?
 *
 * The one question with a trustworthy answer, because the alternative is killing another
 * task's server — which is the X4 incident this feature exists to prevent, not the thing it
 * permits. Attributing a listener by its environment (`ps eww`, hunting for a lease id) was
 * the other option: `ps` truncates its env block at a width nobody controls, so an id past
 * the cut reads as somebody else's server, and the safe branch there is the leak this is
 * meant to fix. Process groups are not approximated: the gate spawns its child `detached`, so
 * a server the child started (or any descendant's server) reports that group, and a server
 * from any other group is not ours. A pid the kernel will not answer for is not ours either.
 *
 * Best-effort in the direction that matters: never throws, never changes the run's exit code,
 * because a gate that passed must not go red over a janitor. SIGTERM first with a short grace
 * (Metro tidies up on a term; a killed one can leave a lock file), SIGKILL for what ignores
 * it. `groupOf` and `kill` are injected so the rule is testable without a real server.
 *
 * @param {object} options
 * @param {number} options.port the leased port (`METRO_PORT`)
 * @param {number | null} options.leaderPid the run's direct child, which led its own group
 * @param {(pid: number) => number | null} [options.groupOf]
 * @param {(pid: number, signal: NodeJS.Signals) => void} [options.kill]
 * @param {(pid: number) => boolean} [options.isAlive]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<number[]>} the pids it stopped
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
    // Somebody else's Metro on our port. The pre-flight owns the verdict on that state; this
    // function's job is to leave it standing.
    return [];
  }
  for (const pid of owned) {
    try {
      kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  // Bounded, and paid for only by a run that leaked a server. `Atomics.wait` because this is a
  // CLI process at the end of its work: nothing else is waiting on the loop, and a timer would
  // need the unref dance to avoid holding the process open.
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

/**
 * The process group id of `pid`, or null when the kernel will not say.
 *
 * `ps -o pgid=` rather than a syscall binding: no native dependency, and this runs at most
 * once per gate. A dead pid makes `ps` print nothing, which is null - the answer a caller has
 * to treat as "not mine".
 */
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
 * The leased Metro port, asked before the run starts (X15 item 1).
 *
 * Returns an exit code - 0 means "run it". A port someone else serves is a refusal that
 * names the process, because the alternative is the X4 failure: the app joins the other
 * Metro and the suite dies as `The app bridge was replaced by a newer app connection`,
 * three runs later and with an error message that does not mention a port. Nothing is
 * recorded for a refusal, the same way a device-claim refusal records nothing: the run
 * never started, so there is no evidence to log.
 *
 * `NITRO_UI_GATE_METRO_FORCE=1` runs anyway, for the case where the server on the port is
 * this task's own - a Metro started by hand for a debugging session, which the harness
 * then attaches to on purpose.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(command: string, args: string[]) => {ok: boolean, text: string} | null} [run]
 * @returns {number}
 */
function metroPreflight(env = process.env, run) {
  const answer = metroPreflightFromEnv(env, run);
  if (answer.warning != null) {
    // Loud, and still a run: a machine that cannot ask about the port must not be
    // unable to run its gates (CI, a container without `lsof`).
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
  return 1;
}

async function runGateUnclaimed(name, resolved, options = {}) {
  const branch = currentBranch();
  const before = readTrees();
  // A bench says which device it drives (`--platform`) and a lease covers both
  // halves of a pair, so the bench's own answer wins over the environment's guess -
  // which is how A5's iOS bench came to be recorded on an Android serial (X15 item 4).
  // Every other gate passes its platform, or null, which keeps the old reading: no
  // platform of its own means the lease's environment describes the run.
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

  // Logs go in the clone's store, shared by every worktree and untouched by
  // `git worktree remove` (X12). A backgrounded run's log path is the file the
  // launcher opened, passed down as an absolute path, and `logPathsFor` derives the
  // ledger's spelling from it - one function for both, so the record, the ledger line
  // and the file cannot name three things (N7).
  migrateWorktreeLogs();
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
  // Per-suite timings for a harness run (X11, ledger v6). Named from the run's log,
  // which is how X10's review N7 settled this for `check`'s steps: one run's file has
  // one namer, derived from a name the launcher and the runner already agree on, so a
  // reader is never sent to a file that was never written. It therefore lands in the
  // clone's log store and outlives `git worktree remove` like the log does, and
  // retention sweeps it with the log (`listStoredLogs`). It used to be
  // `<repo>/.gates/suite-timing/<gate>-<ts>-<pid>.json` — in the worktree, outside the
  // retention walk, and named by a second function. Nothing in a ledger cites the old
  // path (the line carries the parsed record, not a pointer), so those files die with
  // their worktree instead of needing a migration.
  const suiteTimingFile =
    resolved.platform == null ? null : suiteTimingPath(absoluteLog);
  // Appending for a backgrounded run: the launcher already has that file open in
  // append mode for this process's own stdout/stderr, and truncating it here would
  // erase the lines that explain a crash.
  const logStream = fs.createWriteStream(absoluteLog, {
    flags: backgrounded ? 'a' : 'w',
  });
  let logText = '';
  // A backgrounded run's stdout *is* the log file, so echoing there as well as
  // writing the stream would put every line in the log twice. The ledger parses
  // `logText` rather than the file, so a doubled run would still record correct
  // counts - the damage is to the reader who follows the `gate: log …` line and
  // finds a transcript with every line in it twice. Foreground runs still echo.
  const echo = !backgrounded;
  let logStreamOpen = true;
  /**
   * The gate's own news, in the transcript as well as on the terminal (X15 review 4). What the
   * evidence store keeps is the log file, and a sweep that stopped a server or a signal that
   * was re-raised is exactly the fact a reader needs three days later: on stderr alone it is
   * gone the moment the run scrolls past. Written to both, not moved, because the person
   * watching the run needs it now too.
   */
  const note = (message) => {
    process.stderr.write(message);
    logText += message;
    if (logStreamOpen) logStream.write(message);
  };
  const tee = (chunk, output) => {
    logText += String(chunk);
    // Guarded, because the drain above can end the stream while a descendant of the run is
    // still talking through it - and a write after `end()` throws asynchronously, which on an
    // unhandled stream error is an exit the ledger never records. Better a log missing its
    // tail than a green run reporting nothing at all.
    if (logStreamOpen) logStream.write(chunk);
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

  let childPid = null;
  // The run's output as one question: has *all* of it arrived? Answered by the child's two
  // pipes closing, counted rather than taken from the first `close` to arrive (X15 review 2):
  // stdout and stderr close independently, and treating either one as the end loses the other
  // one's tail - which for a harness run is the test summary the ledger's counts are parsed
  // from. Declared out here because the answer arrives from inside the promise below and is
  // read after it.
  let childStreamsClosed = false;
  let streamsClosedCount = 0;
  let drainNow = null;
  let childStreams = null;
  const exit = await new Promise((resolvePromise) => {
    const child = spawn(resolved.argv[0], resolved.argv.slice(1), {
      cwd,
      // Its own process group, so "what did this run leave behind?" has a kernel answer
      // (X15 review). A gate's Metro is a descendant of this child, and a run that was
      // killed - or a wrapper whose `stopMetro` never ran - leaves it serving the leased
      // port, which the *next* gate's pre-flight then refuses: exactly the merge sequence
      // (`real-input:ios` -> `real-input:android` -> `harness:ios` -> `harness:android`)
      // on one lease. `detached` does not mean ignored; it puts the child in a new group,
      // and the signal handlers below reach that group, so a Ctrl-C still stops the
      // descendants a terminal Ctrl-C used to reach through the shared group.
      detached: true,
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
        // Per-suite timings (X11, ledger v6): the harness's plugin writes durations
        // into the file named from this run's log, and the ledger line below cites the
        // parsed record. Only a harness run can produce them. The gate's own name goes
        // with it because the file's name is a folded spelling of it (`:` -> `+`), and
        // a header that says which gate a timing belongs to should not be approximate.
        if (suiteTimingFile != null) {
          childEnv[SUITE_TIMING_ENV] = suiteTimingFile;
          childEnv[SUITE_TIMING_GATE_ENV] = name;
        }
        return childEnv;
      })(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Remembered for the sweep and the release below: `child` is inside this promise's scope,
    // and both run after it settles.
    childPid = child.pid ?? null;
    childStreams = { out: child.stdout, err: child.stderr };
    let forwarded = null;
    const handlers = FORWARDED_SIGNALS.map((signal) => {
      const handler = () => {
        // The whole group, not just the direct child: the child is detached (above), so a
        // signal that used to reach its Metro through the *shared* group now has to be
        // sent to that group on purpose. Killing only the leader is the regression this
        // avoids - a harness that dies while its bundle server keeps serving the leased
        // port (N4's failure, one level down). The direct child is still the fallback: a
        // platform where the negative pid is refused must not lose its signal entirely.
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
    // Both pipes, counted: see `streamsClosedCount`. A leaked descendant holds *both* open
    // (it inherits them), so waiting for the pair costs nothing in the case the drain exists
    // for, and saves the tail in the ordinary one where the two close a chunk apart.
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
      resolvePromise({ code, signal, failedToStart: false, forwarded });
    });
  });

  // The await above resolves on the child's *exit*, not its `close`, because a run that
  // leaves a Metro up makes the two differ by minutes or forever: the server inherits the
  // child's stdout and stderr, so its end holds both pipes open long after the harness is
  // gone. Resolving on `close` is what hung a gate for its whole timeout, and a leaked
  // server must not be able to do that. So the pipes get a bounded moment to drain - long
  // enough for the tail of a normal run, which is what the test-count parse reads - and
  // whatever is still holding them at the end of that moment is dealt with below: the sweep
  // stops a Metro this run owns, and the release below drops our read ends whatever it is,
  // because a descendant the sweep may not touch is not a reason to stay alive. The drain is
  // a constant rather than a knob: nobody should tune how much of their own log they read.
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
  // The Metro this run started, if it left one behind (X15 review). A device gate's own
  // child may spawn a bundle server and either exit without stopping it (a killed run, a
  // wrapper whose cleanup did not run) or keep it up by design; on one lease that is enough
  // to make the *next* gate in the sequence refuse on its own leftover. Stop exactly what
  // this run owns - the listeners in the child's process group - and say so. Never anything
  // else's Metro: that is the X4 incident, and the whole reason the group is the test.
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
  // Our read ends on the child's output are done with, unconditionally (X15 review 3): the run
  // is recorded and swept, so there is nothing left to read and two ways a held pipe still
  // hurts. A descendant that is not a Metro on the leased port (a real-input server on the
  // 8291 default, with no `METRO_PORT` in the environment to sweep by) is not ours to stop, and
  // holding the read end is what keeps *this* process alive: a lease doing nothing until an
  // orphan decides to close, and `wait` reporting a finished gate as still running. It also
  // holds the tail hostage - the drain ends when both pipes have closed, and a gate that keeps
  // reading after that is reading output it has already written up.
  //
  // `destroy`, not `end`: nothing is left to flush on a read stream, and `end` would wait for
  // the other side.
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
    suiteTimings:
      suiteTimingFile == null ? null : readSuiteTiming(suiteTimingFile),
    logPath,
    startedAt,
    exitCode: exit.code ?? (exit.signal != null ? null : 1),
    signal: exit.signal,
  });
  const file = appendLedgerLine(branch, line);
  // The store's own record of this run, written whether it was backgrounded or not.
  //
  // For a backgrounded run this is the "done" mark `wait` returns on: the ledger line
  // is on disk, so a `wait` that returns on this signal can read the row back and
  // `need` can act on it. Marking it done earlier would report a gate whose evidence
  // is not there yet.
  //
  // For a foreground run it is the only thing the store learns about the run, and
  // that is what makes `logs --failed` answerable after `git worktree remove`: the
  // ledger that says pass or fail goes with the checkout, so pass and fail have to be
  // recorded where the log is (review M2). `foreground: true` keeps these out of
  // `wait`/`status`, which look only for runs that are in progress.
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
    exitCode: exit.code ?? (exit.signal != null ? null : 1),
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
  // Slowest suites first, on the terminal and in the log, because the point of
  // recording them is that somebody reads them at the moment a run looks slow rather
  // than months later. Written to the log as well as the terminal: for a backgrounded
  // run the log is the only place anybody reads this, and `echo` is false there.
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

  // Item 3 (X12): a failed *device* gate appends what the device was doing to the
  // log it just wrote, so the red row arrives with its own context instead of with
  // "re-run it and hope it prints something next time". Keyed on the gate's own
  // platform, not on the environment: a `check` that happens to run with
  // ANDROID_SERIAL set is still not a device gate. The device itself is read from
  // this run's lease record, so a shell variable cannot point the probes at another
  // task's emulator, and a run with no lease probes nothing (review N6). Best-effort
  // by design: the verdict is already recorded and flushed above, so every probe here
  // is allowed to fail and say so in one line.
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
  // Scoped to this checkout, for the same reason `wait` is: another worktree's run
  // is not this branch's run (M1).
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
    // a step row apiece would bury them. Gates with no breakdown print nothing, so
    // this stays `check`'s section in practice without naming it as such.
    const steps = renderStepTimings({ entries, gates: MERGE_GATES });
    if (steps !== '') process.stdout.write(`\n${steps}\n`);
    // Per-suite durations for a harness run (X11, ledger v6), and the two breakdowns
    // are not interchangeable: `check`'s steps say which *stage of the script* was
    // slow, these say which *test file* was. Iterating the reported rows rather than
    // the whole ledger matters - a branch with thirty recorded runs would otherwise
    // print thirty tables - and a row with no timings prints nothing, so the section
    // claims "measured" and never reads as "all fast".
    const rows = summarizeGates({
      entries,
      tree: read.tree,
      trees: read.trees,
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
  // Every path this excerpt could leak into a public commit (D25). The header's
  // store path, the lease file in the device block, and the home path in a jest
  // stack trace all become placeholders, so nothing in `docs/tasks/` says whose
  // machine ran the gate.
  const redactions = localPathRedactions({
    repoRoot,
    storeDir: storeLogsDir(),
    leaseFile: path.join(statePaths(stateHome(process.env)).leases),
    home: os.homedir(),
    hostname: os.hostname(),
    // The bare name, because `$HOME` only gives it as part of a path: `whoami`,
    // `ps -o user`, `ssh <user>@host` and `USER=` print it on its own, and review
    // N5 found all of them in an excerpt that carried no home path at all.
    username: process.env.USER ?? os.userInfo().username,
    // Both spellings of the scratch dir: jest prints resolved paths (`/private/var/…`
    // on macOS) while `os.tmpdir()` returns the symlink, and a log fixture lives
    // under the resolved one.
    tmpDir: [os.tmpdir(), fs.realpathSync(os.tmpdir())],
  });
  // Per-name counter: the excerpt's file name is second-granular, so two failed runs
  // of one gate in the same second have the same name and would share one file - the
  // later export overwriting the earlier excerpt while both ledger lines pointed at
  // it. Counting by the name itself is what makes that impossible (review N2).
  const sequenceByName = new Map();
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
    // Keyed on the *name*, not the raw `ts`: the name is what two runs must not
    // share, and `failureExcerptName` drops the milliseconds that make the ts
    // different. Keying on `ts` (round 1) gave two runs in one second the same
    // sequence, so the second export wrote over the first excerpt and both ledger
    // lines pointed at it (review N2).
    const key = failureExcerptName(entry, 1);
    const sequence = (sequenceByName.get(key) ?? 0) + 1;
    sequenceByName.set(key, sequence);
    const relative = path
      .join(failuresDir, failureExcerptName(entry, sequence))
      .split(path.sep)
      .join('/');
    const excerpt = renderFailureExcerpt({
      entry,
      logText: text,
      // Redacted to `<store>/…` by `redactions`, which is the form worth committing:
      // it says where the original is without saying who the machine belongs to.
      logLocation: found.file,
      redactions,
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
 * Two things the orchestrator's cleanup step depends on, both from review M2:
 *
 *   - a log's branch comes from the **whole relative path**, not from a directory
 *     listing. Branch names nest, so `task/a/b/check-….log` belongs to `task/a/b`;
 *     reading only the store's top-level directories attributed every `task/…` log
 *     to `task`, and `--branch task/a/b` then listed nothing - for a *removed*
 *     worktree, which is the one time anyone asks.
 *   - pass or fail comes from the store's own record for the run, because the ledger
 *     that says it lives in the worktree and `git worktree remove` takes it. When
 *     neither is available the command says it cannot tell rather than printing a
 *     silent "0 log file(s) that failed", which reads as "nothing failed".
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
    // The honest version of a zero: "nothing failed" and "I could not tell" are
    // different answers and the orchestrator acts on the difference.
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
 * Store-relative path -> did that run fail? for every log the store can still say
 * anything about.
 *
 * The record written when the run finished is the primary source and survives
 * `git worktree remove`; the ledger lines in this checkout (and any committed task
 * ledger) are consulted for logs whose record predates the `result` field or is
 * missing. `null` for a log neither can judge, which is why the map's values are
 * `true | false | null` rather than a plain failed-only set.
 */
function outcomeOfStoredLogs(storeDir) {
  const records = listBackgroundRecords(storeDir);
  const byLogPath = new Map();
  const put = (key, value, entry) => {
    if (typeof key !== 'string' || key === '') return;
    const previous = byLogPath.get(key);
    // A judgement beats a gap, and a later record beats an earlier one: a legacy
    // `.gate.json` names the worktree path while the store holds the migrated copy.
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
    // N1: a pre-X12 record names `.gates/logs/<name>`, and its copy in the store is
    // under `.gates/logs/<branch>/<name>`. Both spellings have to reach the verdict.
    put(
      migratedStorePath(record.logPath, record.branch ?? null),
      verdict,
      null
    );
  }
  // A ledger line is evidence about a run even when its record is gone (a run from
  // before this task wrote a record for every gate), so the lines fill the gaps -
  // including the committed task ledgers, which is how an exported branch's logs
  // can still be judged from the main checkout.
  const entriesByLogPath = new Map();
  for (const ledger of [
    ...otherBranchLedgers(null),
    ...committedTaskLedgers(null),
    { entries: readLedger(currentBranch()).entries },
  ]) {
    for (const entry of ledger.entries ?? []) {
      if (typeof entry?.logPath !== 'string' || entry.logPath === '') continue;
      if (!entriesByLogPath.has(entry.logPath)) {
        entriesByLogPath.set(entry.logPath, entry);
      }
      const migrated = migratedStorePath(entry.logPath, entry.branch ?? null);
      if (migrated != null && !entriesByLogPath.has(migrated)) {
        entriesByLogPath.set(migrated, entry);
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
 * The branch a stored log belongs to, from its full relative path.
 *
 * The path *is* the branch: logs are written to `<branch>/<gate>-<time>.log`, git
 * refs are path-safe, and a branch name's slashes are kept in the path. So this is
 * "the longest path that is a ledger directory of this store", not "the first
 * segment" (M2), and it needs no list of known branches - which is exactly why it
 * still works for a branch whose worktree, and whose ledger, is gone.
 *
/**
 * Which branch a store-relative log path belongs to.
 *
 * A migrated pre-X12 log lives at `.gates/logs/<branch>/<name>`, because
 * `migrateWorktreeLogs` files it under the branch it found it on - so the branch
 * *is* in the path, and round 1's claim that it was not was wrong. Reading the
 * `.gates/` prefix as "no branch here" is what made every legacy log invisible to
 * `logs --branch`, which is review N1: A4 and X11 have legacy logs right now.
 *
 * A log still loose in `.gates/logs/` (the fallback layout, or one someone dropped
 * there) has no branch to report and says so.
 *
 * @param {string} relative store-relative path, `/`-separated
 */
function branchOfStoredLog(relative) {
  const normalised = String(relative ?? '')
    .split(path.sep)
    .join('/')
    .replace(/^\.gates\/logs\//, '');
  const segments = normalised.split('/');
  // Everything but the file name: `task/a/b/check-….log` is branch `task/a/b`.
  return segments.length > 1 ? segments.slice(0, -1).join('/') : '(unknown)';
}

/**
 * The path a legacy log's copy has in the store, or null when `logPath` is not
 * legacy spelling.
 *
 * `outcomeOfStoredLogs` keys its judgements by stored path, and a pre-X12 ledger
 * line or `.gate.json` names `.gates/logs/check-….log` - the *worktree's* path,
 * which is not where the migrated copy sits. Without this the store knows the run
 * failed and cannot say which file that was, and `--failed` reports the log as
 * unjudgeable while its own line says `fail` (review N1).
 *
 * @param {string} logPath the path a record or ledger line names
 * @param {string | null} branch the branch that line or record carries
 */
function migratedStorePath(logPath, branch) {
  const prefix = `${LEDGER_DIR}/logs/`;
  const normalised = String(logPath ?? '')
    .split(path.sep)
    .join('/');
  if (!normalised.startsWith(prefix)) return null;
  const name = normalised.slice(prefix.length);
  // Only a loose file migrates to `<branch>/<name>`; anything already in a
  // subdirectory keeps that subdirectory, and this is not the path to guess at it.
  if (name === '' || name.includes('/') || branch == null || branch === '') {
    return null;
  }
  return `${prefix}${branch}/${name}`;
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
  // A usage probe is answered before anything is resolved, launched or recorded. `gate.mjs
  // bench --help` used to resolve as the bench gate with a `--help` filter, launch
  // `scripts/bench/run.mjs --help` - which prints its usage and exits 2 - and append
  // `bench:--help FAIL` to the branch ledger (X16 item 3, twice: G7b's and A6b's tables). A
  // FAIL row is *evidence*: `table` sorts it first, `status` calls the branch red, and
  // `export --task` writes a scrubbed failure excerpt for a command that measured nothing.
  // `rest` is every argument on either side of `--`, which is the point: a probe is the user
  // asking how to spell something, so where they put the flag decides nothing. The answer is
  // this script's own usage, because that is the file they were holding; the runner's own
  // flags come from running the runner.
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
 * The log a detached run was told to write, read from the variable the launcher set.
 *
 * Only the path travels: `logPathsFor` turns it into the ledger's spelling and the
 * record path, so a run launched by an older `gate.mjs` - which points it at
 * `.gates/logs/` - records the file it actually wrote instead of one that was never
 * opened (N7). Validation lives there too, in the one place that knows both roots.
 */
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
