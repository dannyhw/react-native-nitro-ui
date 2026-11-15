#!/usr/bin/env node
/**
 * Lists this clone's worktrees and says which can go; `--prune` removes those.
 *
 *   node scripts/worktrees.mjs            what is here, and why each is kept
 *   node scripts/worktrees.mjs --prune    remove the ones nothing can be lost from
 *   node scripts/worktrees.mjs --json     the same listing as data
 *
 * A worktree is removed only when it is a task worktree (`task/<ID>-...`), its tree is
 * clean, its branch has commits of its own and they are merged into `main`, its task
 * holds no live lease, no process is running inside it, and it has been idle for
 * `RECENT_ACTIVITY_HOURS` (`scripts/worktrees-core.mjs` is the rule). A branch that is
 * pushed but not merged is a task in review, and is kept.
 *
 * Removal is plain `git worktree remove` with no `--force`, so git refuses a tree that
 * changed between the listing and the removal. Branches are never deleted. Ignored
 * files go with the directory - that is the disk being reclaimed - except the gate
 * records under `.gates/`, which are copied to `~/.nitro-ui/gate-archive/` first.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { stateHome } from './lease-core.mjs';
import {
  classifyWorktree,
  liveLeaseTasks,
  parseWorktreeList,
  renderWorktrees,
} from './worktrees-core.mjs';

const USAGE = 'usage: node scripts/worktrees.mjs [--prune] [--json]\n';

/** @returns {string | null} trimmed stdout, or `null` when git failed */
function git(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function realpath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

/** Is the worktree's head commit already in `main`, here or on the remote? */
function mergedIntoMain(head) {
  if (head == null) return false;
  for (const ref of ['refs/heads/main', 'refs/remotes/origin/main']) {
    const merged = spawnSync('git', ['merge-base', '--is-ancestor', head, ref]);
    if (merged.status === 0) return true;
  }
  return false;
}

/**
 * The commits on `main`'s own line: its first-parent history, here and on the remote.
 * A task merged with `--no-ff` joins `main` as a *second* parent, so its tip is not
 * one of these; a worktree nothing was committed in still sits on one.
 *
 * @returns {Set<string>}
 */
function mainLine() {
  const commits = new Set();
  for (const ref of ['refs/heads/main', 'refs/remotes/origin/main']) {
    const list = git(['rev-list', '--first-parent', ref]);
    for (const sha of (list ?? '').split('\n')) if (sha) commits.add(sha);
  }
  return commits;
}

/**
 * Does the branch hold work of its own, or is it only a checkout of `main`?
 *
 * Two signs, either is enough. Its head is off `main`'s own line (see `mainLine`),
 * which needs no history and so survives an expired reflog. Or its reflog has more
 * than the one entry a new branch starts with, which is how a branch that was
 * fast-forwarded onto `main` (a merge worktree) still counts. A head on `main`'s line
 * with no second reflog entry is a task that has not committed yet, and is kept.
 */
function branchMoved(branch, head, line) {
  if (branch == null || head == null) return false;
  if (!line.has(head)) return true;
  const log = git(['reflog', 'show', '--format=%H', `refs/heads/${branch}`]);
  return log != null && log.split('\n').filter(Boolean).length >= 2;
}

/**
 * Hours since anything this worktree records as activity changed: git's own state,
 * the gate records, and the entries of its top directory. Run this *before*
 * `dirtyPathsOf`, and see there for why.
 */
function idleHoursOf(worktreePath, nowMs) {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], worktreePath);
  if (gitDir == null) return null;
  const gates = path.join(worktreePath, '.gates');
  const candidates = [
    worktreePath,
    gates,
    ...['HEAD', 'index', 'logs/HEAD', 'ORIG_HEAD', 'FETCH_HEAD'].map((name) =>
      path.join(gitDir, name)
    ),
  ];
  try {
    for (const entry of fs.readdirSync(gates, { recursive: true })) {
      candidates.push(path.join(gates, String(entry)));
    }
  } catch {
    // No gate has run here.
  }
  let newest = 0;
  for (const file of candidates) {
    try {
      newest = Math.max(newest, fs.statSync(file).mtimeMs);
    } catch {
      // Not every worktree has every file.
    }
  }
  return newest === 0 ? null : (nowMs - newest) / 3_600_000;
}

/**
 * Uncommitted and untracked paths.
 *
 * `--no-optional-locks`: a plain `git status` refreshes the index file, and the
 * index's mtime is one of the things `idleHoursOf` reads, so looking at a worktree
 * would make it look recently used. `--untracked-files=all`: a user config of
 * `status.showUntrackedFiles=no` hides untracked work from both this check and git's
 * own, and the worktree would be removed with the files in it.
 */
function dirtyPathsOf(worktreePath) {
  const status = git(
    ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'],
    worktreePath
  );
  if (status == null) return null;
  return status === '' ? 0 : status.split('\n').length;
}

/**
 * The working directory of every process this user can see, or `null` when the
 * machine offers no way to ask. A build or a gate inside a worktree changes nothing
 * git tracks, so this is the only sign that a clean, merged, "idle" checkout is in use.
 *
 * @returns {string[] | null}
 */
function processWorkingDirectories() {
  const lsof = spawnSync('lsof', ['-a', '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  // lsof exits 1 when *some* process could not be read and still prints the rest.
  if (lsof.error == null && lsof.stdout) {
    return lsof.stdout
      .split('\n')
      .filter((line) => line.startsWith('n/'))
      .map((line) => line.slice(1));
  }
  try {
    const found = [];
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        found.push(fs.readlinkSync(`/proc/${pid}/cwd`));
      } catch {
        // Another user's process, or one that just exited.
      }
    }
    return found;
  } catch {
    return null;
  }
}

function countInside(directories, worktreePath) {
  if (directories == null) return null;
  const root = realpath(worktreePath);
  return directories.filter(
    (dir) => dir === root || dir.startsWith(`${root}${path.sep}`)
  ).length;
}

function readLeases() {
  try {
    const file = path.join(stateHome(), 'leases.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : (parsed.leases ?? []);
  } catch {
    return [];
  }
}

function freeGb() {
  try {
    const stats = fs.statfsSync(process.cwd());
    return Math.floor((stats.bavail * stats.bsize) / 2 ** 30);
  } catch {
    return null;
  }
}

/**
 * Copies the gitignored gate records out before the directory that holds them goes:
 * everything under `.gates/` except `logs/`, which the shared log store already has.
 *
 * @returns {string | null} where they went, or `null` when there were none
 */
function archiveGateRecords(row, nowMs) {
  const gates = path.join(row.path, '.gates');
  if (!fs.existsSync(gates)) return null;
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(gates);
  if (files.length === 0) return null;
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const name = String(row.branch ?? path.basename(row.path)).replace(
    /[^A-Za-z0-9._-]+/g,
    '_'
  );
  const target = path.join(stateHome(), 'gate-archive', `${name}-${stamp}`);
  for (const file of files) {
    const to = path.join(target, path.relative(gates, file));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
  }
  return target;
}

function main(argv) {
  const known = new Set(['--prune', '--json']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    process.stderr.write(`worktrees: unknown argument ${unknown[0]}\n${USAGE}`);
    return 2;
  }
  const prune = argv.includes('--prune');
  const json = argv.includes('--json');

  const listing = git(['worktree', 'list', '--porcelain']);
  if (listing == null) {
    process.stderr.write('worktrees: not inside a git checkout\n');
    return 2;
  }
  const nowMs = Date.now();
  const current = realpath(
    git(['rev-parse', '--show-toplevel']) ?? process.cwd()
  );
  const leasedTasks = liveLeaseTasks(readLeases(), nowMs);
  const workingDirectories = processWorkingDirectories();
  const records = parseWorktreeList(listing).filter((record) => !record.bare);
  const line = mainLine();

  const rows = records.map((record, index) => {
    const exists = !record.missing && fs.existsSync(record.path);
    const facts = {
      // git lists the clone's own checkout first.
      isMain: index === 0,
      isCurrent: realpath(record.path) === current,
      locked: record.locked,
      missing: !exists,
      branch: record.branch,
      leasedTasks,
      busyProcesses: exists
        ? countInside(workingDirectories, record.path)
        : null,
      merged: mergedIntoMain(record.head),
      branchMoved: branchMoved(record.branch, record.head, line),
      // Age first, status second: see `dirtyPathsOf`.
      idleHours: exists ? idleHoursOf(record.path, nowMs) : null,
      dirtyPaths: exists ? dirtyPathsOf(record.path) : null,
    };
    return {
      path: record.path,
      branch: record.branch,
      ...classifyWorktree(facts),
    };
  });

  if (prune) {
    for (const row of rows) {
      if (row.verdict !== 'remove') continue;
      // One row failing must not stop the rest, or hide what was already removed.
      try {
        const archived = archiveGateRecords(row, nowMs);
        const removed = spawnSync('git', ['worktree', 'remove', row.path], {
          encoding: 'utf8',
        });
        if (removed.status === 0) {
          row.removed = true;
          row.reason += archived
            ? `; removed, gate records kept in ${archived}`
            : '; removed';
        } else {
          row.verdict = 'keep';
          row.reason = `git refused: ${removed.stderr.trim().split('\n')[0]}`;
        }
      } catch (error) {
        row.verdict = 'keep';
        row.reason = `not removed, its gate records could not be saved: ${error.message}`;
      }
    }
  }

  const free = freeGb();
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ freeGb: free, worktrees: rows }, null, 2)}\n`
    );
    return 0;
  }
  const removed = rows.filter((row) => row.removed);
  process.stdout.write(
    `${renderWorktrees(rows.filter((row) => !row.removed))}\n`
  );
  for (const row of removed) {
    process.stdout.write(
      `removed  ${row.branch ?? '(detached)'}\n        ${row.path}\n`
    );
  }
  if (prune) process.stdout.write(`${removed.length} removed.\n`);
  if (free != null) process.stdout.write(`${free} GB free.\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
