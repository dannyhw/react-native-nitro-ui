#!/usr/bin/env node
/**
 * The gate ledger: run a named gate, record what it proved, and answer the two
 * questions that used to cost hours per task.
 *
 *   node scripts/gate.mjs check
 *   node scripts/gate.mjs harness:android -- ColdSizing
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

import {
  LEDGER_DIR,
  MERGE_GATES,
  decideNeed,
  deviceFromEnv,
  explainNeedRow,
  ledgerLineFromRun,
  ledgerRelativePath,
  parseLedger,
  parseTestCounts,
  platformsTouchedByPaths,
  renderGateTable,
  resolveGate,
  summarizeGates,
  summarizeLoad,
} from './gate-core.mjs';
import { currentCodeTree, repoRootOf } from './app-stamp.mjs';
import { assertSupportedNodeOrReexec } from './node-version.mjs';

const USAGE =
  'usage: node scripts/gate.mjs <gate> [-- <args>]\n' +
  '       node scripts/gate.mjs status\n' +
  '       node scripts/gate.mjs need --for review|merge [--base <ref>]\n' +
  '       node scripts/gate.mjs table [--full]\n' +
  '       node scripts/gate.mjs export --task <ID> [--out <file>]\n' +
  '\n' +
  'gates: check | harness:<ios|android>[:suite] | real-input:<ios|android> |\n' +
  '       smoke:<pack|expo|rn-cli> | bench\n' +
  '       (a device gate reads its device from `node scripts/lease.mjs acquire`;\n' +
  '        a harness/real-input gate needs app.stamp from scripts/build-app.mjs)\n';

/**
 * How often a running gate samples the load average. R4's lesson is that one
 * sample at the end judges a ten-minute run by its last minute, and a harness run
 * on a shared machine is exactly where that matters: the number in the ledger is
 * what lets a reader discount a red row that happened under a Gradle storm.
 */
const LOAD_SAMPLE_INTERVAL_MS = 15_000;

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
  for (const args of [
    ['diff', '--name-only', `${mergeBase}...HEAD`],
    ['diff', '--name-only', mergeBase],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
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
 * The tree is read *before* the spawn. Reading it afterwards would let an edit
 * that happened during a five-minute run be recorded as if the run had seen it -
 * the same mistake `build-app.mjs` fixed by hashing before and after (X1 review
 * M3), and the reason `status` is honest about a concurrent edit.
 */
async function runGate(name, resolved) {
  const branch = currentBranch();
  const before = currentCodeTree({ repoRoot });
  const device = deviceFromEnv(process.env, resolved.platform);
  const startedAt = Date.now();
  const startedLoad = os.loadavg()[0] ?? null;
  const samples = [startedLoad];
  const sampler = setInterval(() => {
    samples.push(os.loadavg()[0] ?? Number.NaN);
  }, LOAD_SAMPLE_INTERVAL_MS);

  const logsDir = path.join(repoRoot, LEDGER_DIR, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logName = `${name.replaceAll(/[^\w.-]+/g, '+')}-${new Date(startedAt).toISOString().replaceAll(':', '-')}.log`;
  const logPath = path.join(LEDGER_DIR, 'logs', logName);
  const logStream = fs.createWriteStream(path.join(repoRoot, logPath));
  let logText = '';
  const tee = (chunk, output) => {
    logText += String(chunk);
    logStream.write(chunk);
    output.write(chunk);
  };

  const cwd =
    resolved.cwd === 'example' ? path.join(repoRoot, 'example') : repoRoot;
  process.stderr.write(
    `gate: ${name}\n` +
      `gate: ${resolved.argv.join(' ')} (cwd ${path.relative(repoRoot, cwd) || '.'})\n` +
      `gate: code tree ${before.tree.slice(0, 12)} at HEAD ${git(['rev-parse', '--short', 'HEAD'], '?')}\n` +
      `gate: log ${logPath}\n`
  );

  const exit = await new Promise((resolvePromise) => {
    const child = spawn(resolved.argv[0], resolved.argv.slice(1), {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => tee(chunk, process.stdout));
    child.stderr.on('data', (chunk) => tee(chunk, process.stderr));
    child.on('error', (error) => {
      process.stderr.write(
        `gate: could not start ${resolved.argv[0]}: ${error.message}\n`
      );
      resolvePromise({ code: 1, signal: null, failedToStart: true });
    });
    child.on('close', (code, signal) =>
      resolvePromise({ code, signal, failedToStart: false })
    );
  });

  clearInterval(sampler);
  samples.push(os.loadavg()[0] ?? Number.NaN);
  const durationMs = Date.now() - startedAt;
  const after = currentCodeTree({ repoRoot });
  logStream.end();

  const result = exit.code === 0 && exit.signal == null ? 'pass' : 'fail';
  const line = ledgerLineFromRun({
    gate: name,
    command: resolved.argv.join(' '),
    // Record the tree the run *started* on, and say so when the tree moved under
    // it: that line is still evidence about the code it read, and the reader has
    // to be told it may not be the code in front of them now.
    tree: before.tree,
    head: before.head,
    branch,
    platform: device.platform,
    device: device.device,
    lease: device.lease,
    load: summarizeLoad({ start: startedLoad, samples }),
    durationMs,
    result,
    counts: parseTestCounts(logText),
    logPath,
    startedAt,
    exitCode: exit.code ?? (exit.signal != null ? null : 1),
  });
  const file = appendLedgerLine(branch, line);

  const suffix =
    after.tree === before.tree
      ? ''
      : ` - note: the code tree moved during the run (${after.tree.slice(0, 12)} now), so this line describes ${before.tree.slice(0, 12)}`;
  process.stderr.write(
    `gate: ${name} ${result.toUpperCase()} in ${(durationMs / 1000).toFixed(1)} s` +
      `${exit.signal != null ? ` (signal ${exit.signal})` : ''}${suffix}\n` +
      `gate: recorded in ${path.relative(repoRoot, file)}\n`
  );
  if (result === 'fail' && resolved.bench) {
    process.stderr.write(
      'gate: a bench never blocks `need` - benches go to the bench host (D15).\n'
    );
  }
  return exit.signal != null ? 1 : (exit.code ?? 1);
}

function printCodeTree(tree) {
  process.stderr.write(
    `ledger: code tree ${tree.tree.slice(0, 12)} at HEAD ${git(['rev-parse', '--short', 'HEAD'], '?')} (branch ${currentBranch()}, ${String(tree.files)} files)\n`
  );
}

function commandStatus() {
  const branch = currentBranch();
  const tree = currentCodeTree({ repoRoot });
  const { entries, file, exists } = readLedger(branch);
  printCodeTree(tree);
  process.stderr.write(
    `ledger: ${exists ? path.relative(repoRoot, file) : `${path.relative(repoRoot, file)} (nothing recorded yet)`}\n`
  );
  if (entries.some((entry) => entry.corrupt)) {
    process.stderr.write(
      `ledger: ${String(entries.filter((entry) => entry.corrupt).length)} unreadable line(s) - treated as not run\n`
    );
  }
  const rows = summarizeGates({ entries, codeTree: tree.tree });
  for (const row of rows) {
    const entry = row.entry;
    const detail =
      entry == null
        ? ''
        : ` [${String(entry.tree).slice(0, 12)}${entry.tree === tree.tree ? '' : ' not this tree'} ${formatMaybe(entry.durationMs)}${entry.lease != null ? ` lease ${entry.lease}` : ''}]`;
    process.stdout.write(`${row.state.padEnd(7)} ${row.gate}${detail}\n`);
  }
  const green = rows.filter((row) => row.state === 'green').length;
  process.stdout.write(
    `\n${String(green)} green, ${String(rows.filter((r) => r.state === 'red').length)} red, ${String(rows.filter((r) => r.state === 'stale').length)} stale, ${String(rows.filter((r) => r.state === 'missing').length)} missing for this code tree\n`
  );
  return 0;
}

function formatMaybe(ms) {
  return typeof ms === 'number' ? ` ${(ms / 1000).toFixed(1)}s` : '';
}

function commandNeed({ stage, base }) {
  const branch = currentBranch();
  const tree = currentCodeTree({ repoRoot });
  const { entries, exists } = readLedger(branch);
  const diff = changedCodePaths({ base });
  const touched = diff.unknown
    ? { platforms: ['ios', 'android'], unmapped: [] }
    : platformsTouchedByPaths(diff.paths);

  const decision = decideNeed({
    entries,
    codeTree: tree.tree,
    stage,
    touchedPlatforms: touched.platforms,
    unmappedPaths: touched.unmapped,
    diffUnknown: diff.unknown,
  });

  printCodeTree(tree);
  process.stderr.write(
    `need: ${stage} against ${exists ? `.gates/${branch}.jsonl` : 'an empty ledger'}; ` +
      `code diff base ${diff.base == null ? 'unknown' : diff.base.slice(0, 7)}` +
      `${touched.platforms.length > 0 ? ` touches ${touched.platforms.join(' + ')}` : ' touches no platform-specific code'}\n`
  );
  for (const row of decision.required) {
    process.stdout.write(
      `  ${row.state === 'green' ? '✓' : '✗'} ${explainNeedRow(row, tree.tree)}\n`
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

function commandTable({ full }) {
  const branch = currentBranch();
  const tree = currentCodeTree({ repoRoot });
  const { entries, exists } = readLedger(branch);
  printCodeTree(tree);
  if (!exists) {
    process.stderr.write('table: nothing recorded yet - run a gate first.\n');
    return 1;
  }
  process.stdout.write(
    `${renderGateTable({
      entries,
      codeTree: tree.tree,
      required: MERGE_GATES,
      evidence:
        full === true
          ? (entry) => `log \`${String(entry.logPath ?? '')}\``
          : null,
    })}\n`
  );
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

async function main(argv) {
  const [command, ...rest] = argv;
  if (command == null || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === 'status') return commandStatus();
  if (command === 'table') {
    return commandTable({ full: rest.includes('--full') });
  }
  if (command === 'need') {
    let stage = null;
    let base = process.env.NITRO_UI_GATE_BASE ?? 'main';
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
  const separator = rest.indexOf('--');
  const extraArgs = separator === -1 ? rest : rest.slice(separator + 1);
  if (separator !== -1 && rest.slice(0, separator).length > 0) {
    process.stderr.write(
      `gate: arguments before -- are not supported: ${rest.slice(0, separator).join(' ')}\n${USAGE}`
    );
    return 2;
  }
  let resolved;
  try {
    resolved = resolveGate(command, extraArgs);
  } catch (error) {
    process.stderr.write(`gate: ${String(error?.message ?? error)}\n${USAGE}`);
    return 2;
  }
  return await runGate(command, resolved);
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
