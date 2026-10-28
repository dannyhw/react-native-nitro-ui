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
 *
 * Every run appends one JSON line to `.gates/<branch>.jsonl` (gitignored) keyed
 * to the **code tree**, not to HEAD - the digest `app.stamp` already uses
 * (`currentCodeTree()`), which excludes `docs/` and Markdown. That one choice is
 * what removes the re-runs: a docs commit leaves the digest alone, so a green
 * gate is still green, and the process review's "re-ran on the final tree" pass
 * (11 reports) becomes a lookup. See `scripts/gate-core.mjs` for the rules.
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
  explainNeedRow,
  findReusableCheck,
  lastLogLine,
  ledgerLineFromRun,
  ledgerRelativePath,
  parseLedger,
  parseTestCounts,
  parseTestSummaries,
  pidMayBeRunning,
  platformTreesFromEntries,
  platformsOwningFile,
  platformsTouchedByPaths,
  renderGateTable,
  renderStepTimings,
  resolveGate,
  runningBackgroundGates,
  summarizeGates,
  summarizeLoad,
} from './gate-core.mjs';
import { contentHash, isCodeFile } from './app-stamp-core.mjs';
import { writeJsonAtomic } from './lease-core.mjs';
import { currentCodeTree, repoRootOf } from './app-stamp.mjs';
import { assertSupportedNodeOrReexec } from './node-version.mjs';

const USAGE =
  'usage: node scripts/gate.mjs <gate> [-- <args>] [--background]\n' +
  '       node scripts/gate.mjs wait [--gate <name>] [--timeout-minutes N]\n' +
  '       node scripts/gate.mjs status [--for review|merge]\n' +
  '       node scripts/gate.mjs need --for review|merge [--base <ref>] [--no-reuse]\n' +
  '       node scripts/gate.mjs table [--for review|merge] [--full] [--no-reuse]\n' +
  '       node scripts/gate.mjs export --task <ID> [--out <file>]\n' +
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
  '        passed on this exact code tree and its commit is merged here - the merge\n' +
  '        changed no code, so it is not re-owed. `check` only: a device gate is\n' +
  '        evidence about a binary. `--no-reuse` asks the strict question instead)\n';

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
  const logsDir = path.join(repoRoot, LEDGER_DIR, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logName = `${name.replaceAll(/[^\w.-]+/g, '+')}-${new Date(startedAt).toISOString().replaceAll(':', '-')}.log`;
  const logPath = path.join(LEDGER_DIR, 'logs', logName);
  const absoluteLog = path.join(repoRoot, logPath);
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
  const logsDir = path.join(repoRoot, LEDGER_DIR, 'logs');
  const records = listBackgroundRecords(logsDir).filter(
    (record) => gate == null || record.gate === gate
  );
  if (records.length === 0) {
    process.stderr.write(
      `wait: no background gate${gate == null ? '' : ` named ${gate}`} in ${path.relative(repoRoot, logsDir) || '.'}\n` +
        'wait: start one with `node scripts/gate.mjs <gate> --background`\n'
    );
    return 2;
  }
  // Newest first: `wait` with no `--gate` means "the thing I just started", and
  // several runs of the same gate name in one branch is normal (a re-run after a
  // fix), so "latest" has to be the tie-break.
  records.sort((a, b) => Number(b.startedAt ?? 0) - Number(a.startedAt ?? 0));
  const target = records[0];
  const absoluteLog = path.join(repoRoot, target.logPath ?? 'dev/null');
  process.stderr.write(
    `wait: ${target.gate} (pid ${String(target.pid ?? '?')}) - budget ${String(timeoutMinutes)} min\n`
  );

  let printedAt = 0;
  for (;;) {
    const elapsedMs = Date.now() - startedWaiting;
    const record = readBackgroundRecord(target.recordPath) ?? target;
    // The ledger line for *this* run, matched on its log path - the one field that
    // is unique per run (a gate name repeats across re-runs on the same tree). It
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
 * Every background record in the logs directory, newest files first.
 *
 * @param {string} logsDir
 * @returns {object[]}
 */
function listBackgroundRecords(logsDir) {
  let names = [];
  try {
    names = fs.readdirSync(logsDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.gate.json'))
    .map((name) => readBackgroundRecord(path.join(logsDir, name)))
    .filter((record) => record != null);
}

/**
 * The three digests a decision needs: the full code tree and the two platform
 * halves of it.
 *
 * The halves are built here rather than in `app-stamp.mjs` so the stamp stays
 * what it is (one digest for one binary, X1) and `build-app.mjs` - which task X6
 * is editing right now - is untouched. The file listing and the hashing rules
 * mirror `currentCodeTree()` exactly, including the skip-what-is-deleted and
 * hash-the-link-target cases, so a platform digest is the same hash function over
 * a subset of the same file set and nothing else.
 *
 * @returns {{tree: string, head: string, files: number, trees: Record<string, string>}}
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
  return { ...full, trees: platformTreesFromEntries(entries) };
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

  const logsDir = path.join(repoRoot, LEDGER_DIR, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  // A backgrounded run's log path comes from the record the launcher wrote, so
  // `wait` knows where to read progress from before this process has printed a
  // thing. Foreground runs still name their own log.
  const logName = `${name.replaceAll(/[^\w.-]+/g, '+')}-${new Date(startedAt).toISOString().replaceAll(':', '-')}.log`;
  const logPath = options.logPath ?? path.join(LEDGER_DIR, 'logs', logName);
  // Appending for a backgrounded run: the launcher already has that file open in
  // append mode for this process's own stdout/stderr, and truncating it here would
  // erase the lines that explain a crash.
  const logStream = fs.createWriteStream(path.join(repoRoot, logPath), {
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
    resolved.gate === 'check'
      ? path.join(repoRoot, `${logPath}.steps.json`)
      : null;
  process.stderr.write(
    `gate: ${name}\n` +
      `gate: ${resolved.argv.join(' ')} (cwd ${path.relative(repoRoot, cwd) || '.'})\n` +
      `gate: code tree ${before.tree.slice(0, 12)} at HEAD ${git(['rev-parse', '--short', 'HEAD'], '?')}\n` +
      `gate: log ${logPath}\n`
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

function printCodeTree({ tree, trees, head, files }) {
  process.stderr.write(
    `ledger: code tree ${tree.slice(0, 12)} at HEAD ${String(head ?? '?').slice(0, 7)} (branch ${currentBranch()}, ${String(files)} files)\n`
  );
  process.stderr.write(
    `ledger: platform trees ${PLATFORMS.map((platform) => `${platform} ${String(trees?.[platform] ?? '?').slice(0, 12)}`).join(' ')}\n`
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
    listBackgroundRecords(path.join(repoRoot, LEDGER_DIR, 'logs'))
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
 * review N4). Ancestry ties a line to *this history*, and tree equality is the actual evidence that
 * the code was checked; neither of them authenticates the file - anyone who can commit can edit a
 * `gates.jsonl` line, give it some ancestor `head` and today's tree, and be believed. Two things
 * make that a poor attack: the same diff has to change what `check` does, or the claim was true
 * anyway, and reuse now also demands that nothing else the merge adds is a file `check` reads (M1),
 * which a forged line cannot arrange on its own. Trusting the committed ledger is the alternative to
 * re-running `check` after every merge, which is the cost this rule exists to remove; it is stated
 * plainly in ORCHESTRATOR rather than papered over.
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
 * The paths that differ between `commit` and the tree standing here now: the committed diff plus
 * anything uncommitted or untracked in the working tree (M1).
 *
 * Reuse asks whether `check` would see anything new if it ran here instead of on that commit, so the
 * answer has to be *everything* that differs, and `check` reads untracked files: jest, tsc and
 * prettier take the directory as they find it, so an untracked `.ts` in `src/` is a file the next run
 * compiles. That is also why this refuses to fall back to the committed diff when git cannot be
 * asked - an unknown working tree is not a clean one, and `null` here means "do not reuse".
 *
 * Rename and delete entries come back as plain paths (`-z`, no rename detection), which is what the
 * allowlist wants: both sides of a rename are asked about, and a path that stopped existing is a path
 * `check` reads differently.
 *
 * @param {string} commit
 * @returns {string[] | null}
 */
function pathsChangedSince(commit) {
  const sha = String(commit ?? '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  if (git(['cat-file', '-e', `${sha}^{commit}`], null) == null) return null;
  const diff = spawnSync('git', ['diff', '--name-only', '-z', `${sha}..HEAD`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (diff.status !== 0) return null;
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (status.status !== 0) return null;
  const found = new Set(
    String(diff.stdout ?? '')
      .split('\0')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  );
  const fields = String(status.stdout ?? '').split('\0');
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === '') continue;
    if (field.startsWith('r') || field.startsWith('c')) {
      // A rename/copy entry names its source here and its destination in the next field.
      found.add(field.slice(3));
      if (fields[i + 1] != null && fields[i + 1] !== '')
        found.add(fields[i + 1]);
      i += 1;
      continue;
    }
    found.add(field.slice(3));
  }
  return [...found].sort();
}

/**
 * The `check` reuse available for this tree, or null. `--no-reuse` turns it off, which is how a
 * reviewer re-derives the strict answer when they do not believe the reuse.
 *
 * @param {string} branch the branch whose own ledger is already being read
 * @param {string | null} tree
 * @param {string[]} [diagnostics] filled with why each candidate was refused, so `need` can print the
 *   reason instead of a shrug
 * @returns {{branch: string, entry: object, source: string, changedPaths: string[]} | null}
 */
function reusableCheckFor(branch, tree, diagnostics = null) {
  return findReusableCheck({
    ledgers: [...otherBranchLedgers(branch), ...committedTaskLedgers(branch)],
    tree,
    headIsAncestor: commitIsAncestorOfHead,
    changedSince: pathsChangedSince,
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

  // Why reuse was declined, kept to print: the M1 rule asks a question with an answer
  // a reviewer can check ("the merge adds bench/src/Main.tsx, check reads that"), and
  // silence would look like the reuse rule never fired.
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
        ? reusableCheckFor(branch, read.tree, reuseRefusals)
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
    stage === 'merge' && reuse ? reusableCheckFor(branch, read.tree) : null;
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
  // The evidence has to survive its author: copy the lines verbatim rather than
  // re-serialise them, so a committed ledger is byte-identical to what ran.
  fs.copyFileSync(file, absolute);
  process.stdout.write(
    `export: ${String(entries.filter((entry) => !entry.corrupt).length)} gate line(s) from ${path.relative(repoRoot, file)} -> ${path.relative(repoRoot, absolute)}\n`
  );
  return 0;
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
 * environment of whatever started it. It has to be an absolute path inside this
 * checkout's own `.gates/logs/`, or it is ignored and the run behaves exactly like
 * a foreground one.
 */
function backgroundOptions(env = process.env) {
  const fromEnv = env.NITRO_UI_GATE_LOG;
  if (fromEnv == null || fromEnv === '') return {};
  const absolute = path.resolve(fromEnv);
  const logsDir = path.join(repoRoot, LEDGER_DIR, 'logs');
  if (
    !absolute.startsWith(`${logsDir}${path.sep}`) ||
    !absolute.endsWith('.log')
  ) {
    process.stderr.write(
      `gate: ignoring NITRO_UI_GATE_LOG=${fromEnv} - a background gate's log has to be inside ${path.relative(repoRoot, logsDir)}\n`
    );
    return {};
  }
  return {
    logPath: path.relative(repoRoot, absolute),
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
