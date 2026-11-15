#!/usr/bin/env node
/**
 * Lists the tasks that have records under `docs/tasks` and says which can leave git;
 * `--archive` copies those to the local archive and stages their removal.
 *
 *   node scripts/task-records.mjs             each task, keep or archive, and why
 *   node scripts/task-records.mjs --archive   archive the ones marked archive
 *   node scripts/task-records.mjs --days 7    keep a merged task's records 7 days
 *   node scripts/task-records.mjs --json      the same listing as data
 *
 * A task is merged when HEAD contains every `task/<ID>-...` branch, local or
 * remote-tracking, and its records are archived at once unless `--days` says to wait.
 * A task is kept while any worktree has an uncommitted change to its records or is on
 * a branch of it that HEAD does not contain, while such a branch is live (its tip is
 * younger than 14 days), and while it has a brief and no report. The branch HEAD is on
 * is never merged into itself, so a task is never archived from its own checkout.
 *
 * `--archive` runs only where HEAD contains `main` (the local branch, or `origin/main`
 * without one). It copies a task's tracked records to
 * `~/.nitro-ui/task-archive/<ID>/<path below docs/tasks>`, compares every copy with
 * its source, and only then runs `git rm`. The removal is staged, never committed: it
 * belongs in the merge commit. A task whose copy fails, or whose archive already holds
 * different bytes under the same name, is left exactly as it was, the others still go,
 * and the command exits 1.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { stateHome } from './lease-core.mjs';
import {
  DEFAULT_KEEP_DAYS,
  RECORDS_DIR,
  arrivalByReflog,
  classifyTask,
  copyThenRemove,
  groupByTask,
  renderRecords,
} from './task-records-core.mjs';
import { parseWorktreeList, taskOfBranch } from './worktrees-core.mjs';

const USAGE =
  'usage: node scripts/task-records.mjs [--archive] [--days N] [--json]\n';

/**
 * A git read. `--no-optional-locks` because a plain `git status` rewrites the index,
 * and a listing must not write to the repository.
 *
 * @returns {string | null} stdout, or `null` when git failed
 */
function git(args, cwd) {
  const options = { cwd, encoding: 'utf8', maxBuffer: 2 ** 26 };
  const result = spawnSync('git', ['--no-optional-locks', ...args], options);
  return result.status === 0 ? result.stdout : null;
}

const fields = (text, separator) => text.split(separator).filter(Boolean);
const below = (file) => file.slice(RECORDS_DIR.length + 1);
const inRepo = (files) => files.map((file) => `${RECORDS_DIR}/${file}`);
const dayOf = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * One worktree's records with an uncommitted change, untracked ones included. A
 * deletion that is already staged (`D ` and nothing in the working tree) is not one:
 * that is what this command leaves behind.
 */
function dirtyRecords(worktree) {
  const status = git(
    ['status', '--porcelain', '-z', '-uall', '--', RECORDS_DIR],
    worktree
  );
  if (status == null) return null;
  return (
    fields(status, '\0')
      .filter((entry) => !entry.startsWith('D  '))
      // A rename's old name follows it as a field of its own, with no status letters.
      .map((entry) => below(/^.. /.test(entry) ? entry.slice(3) : entry))
  );
}

/** Every worktree with its branch and dirty records, or `null` when one is unreadable. */
function worktreesOf(root) {
  const listing = git(['worktree', 'list', '--porcelain'], root);
  if (listing == null) return null;
  const found = [];
  for (const worktree of parseWorktreeList(listing)) {
    if (worktree.bare || !fs.existsSync(worktree.path)) continue;
    const dirty = dirtyRecords(worktree.path);
    if (dirty == null) return null;
    found.push({ branch: worktree.branch, dirty });
  }
  return found;
}

/** When the branch HEAD is on first held each commit of its line, by its reflog. */
function arrivalOn(root, current) {
  const line = git(['rev-list', '--first-parent', 'HEAD'], root) ?? '';
  const show = ['reflog', 'show', '--format=%H %gd', '--date=unix'];
  const reflog =
    (current && git([...show, `refs/heads/${current}`], root)) || '';
  const entries = fields(reflog, '\n').map((entry) => ({
    sha: entry.split(' ')[0],
    seconds: Number(/@\{(\d+)\}/.exec(entry)?.[1]),
  }));
  return arrivalByReflog(
    fields(line, '\n'),
    entries.filter((entry) => Number.isFinite(entry.seconds))
  );
}

/**
 * When these records reached HEAD's own line: the newest first-parent commit that
 * changed any of them, dated by the reflog where it knows better.
 *
 * @returns {{seconds: number, by: string} | null} when, and what said so
 */
function reachedHead(root, files, arrival) {
  if (files.length === 0) return null;
  const format = '--format=%H %ct %P';
  const found = git(
    ['log', '-1', '--first-parent', format, 'HEAD', '--', ...inRepo(files)],
    root
  )?.trim();
  if (!found) return null;
  const [sha, committed, ...parents] = found.split(' ');
  const arrived = arrival(sha);
  if (arrived != null) return { seconds: arrived, by: 'reflog' };
  // A fast-forward leaves no commit of its own, and no reflog covered this one.
  const by = parents.length > 1 ? 'merge commit' : 'commit date, not a merge';
  return { seconds: Number(committed), by };
}

/** @returns {string} the task's archive folder; throws before anything is removed */
function archiveTask(root, task, files) {
  const archive = path.join(stateHome(), 'task-archive');
  const pairs = files.map((file) => ({
    file,
    from: path.join(root, RECORDS_DIR, file),
    to: path.join(archive, task, file),
  }));
  copyThenRemove(pairs, {
    exists: fs.existsSync,
    same: (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b)),
    copy: (from, to) => {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    },
    remove: () => {
      const removed = spawnSync('git', ['rm', '-q', '--', ...inRepo(files)], {
        cwd: root,
        encoding: 'utf8',
      });
      if (removed.status !== 0) {
        throw new Error(`git refused: ${removed.stderr.trim().split('\n')[0]}`);
      }
    },
  });
  return path.join(archive, task);
}

function main(argv) {
  const refuse = (message, usage = '') => {
    process.stderr.write(`task-records: ${message}\n${usage}`);
    return 2;
  };
  const args = [...argv];
  let keepDays = DEFAULT_KEEP_DAYS;
  const at = args.indexOf('--days');
  if (at !== -1) {
    const [, value] = args.splice(at, 2);
    if (!/^\d+$/.test(value ?? '')) {
      return refuse('--days needs a whole number of days, 0 or more', USAGE);
    }
    keepDays = Number(value);
  }
  const unknown = args.find((arg) => arg !== '--archive' && arg !== '--json');
  if (unknown != null) return refuse(`unknown argument ${unknown}`, USAGE);
  const archive = args.includes('--archive');

  const root = git(['rev-parse', '--show-toplevel'], process.cwd())?.trim();
  const mainRef = ['refs/heads/main', 'refs/remotes/origin/main'].find(
    (ref) => root && git(['rev-parse', '--verify', '-q', ref], root) != null
  );
  if (mainRef == null) return refuse('needs a git checkout with a `main`');
  if (git(['merge-base', '--is-ancestor', mainRef, 'HEAD'], root) == null) {
    if (archive) {
      return refuse('HEAD does not contain `main`: merge it, then archive');
    }
    process.stderr.write(
      'task-records: HEAD is behind `main`, so a task may be newer than it reads here\n'
    );
  }
  const now = Date.now() / 1000;
  const format = '--format=%(committerdate:unix) %(refname)';
  const branches = git(['branch', '-a', format, '--no-merged', 'HEAD'], root);
  const current = git(['branch', '--show-current'], root)?.trim();
  if (branches == null || current == null) {
    return refuse('could not list the branches');
  }
  // The branch HEAD is on is the work itself, not something merged into it.
  const open = fields(`${branches}\n${now} refs/heads/${current}`, '\n').map(
    (line) => ({
      branch: line.replace(/^\S+ refs\/(heads|remotes\/[^/]+)\//, ''),
      tipDays: (now - Number(line.split(' ')[0])) / 86_400,
    })
  );
  const worktrees = worktreesOf(root);
  const listed = git(['ls-files', '-z', '--', RECORDS_DIR], root) ?? '';
  const tracked = groupByTask(fields(listed, '\0').map(below));
  const dirty = groupByTask((worktrees ?? []).flatMap((each) => each.dirty));
  const arrival = arrivalOn(root, current);

  const tasks = [...new Set([...tracked.keys(), ...dirty.keys()])];
  const rows = tasks.sort().map((task) => {
    const files = tracked.get(task) ?? [];
    const reached = reachedHead(root, files, arrival);
    const ageDays = reached ? (now - reached.seconds) / 86_400 : null;
    const since = reached && `${dayOf(reached.seconds)} (${reached.by})`;
    const where = (file) => path.join(root, RECORDS_DIR, file);
    const isLink = (file) =>
      fs.lstatSync(where(file), { throwIfNoEntry: false })?.isSymbolicLink();
    const verdict = classifyTask({
      task,
      files,
      symlinks: files.filter(isLink).length,
      worktrees,
      openBranches: open.filter((each) => taskOfBranch(each.branch) === task),
      ageDays,
      since,
      keepDays,
    });
    return { task, files: files.length, ageDays, ...verdict };
  });

  if (archive) {
    for (const row of rows.filter((each) => each.verdict === 'archive')) {
      // One task failing must not stop the rest, or hide what was already archived.
      try {
        row.archived = archiveTask(root, row.task, tracked.get(row.task));
        row.verdict = 'archived';
        row.reason = `copied to ${row.archived}`;
      } catch (error) {
        row.verdict = 'keep';
        row.failed = true;
        row.reason = `not archived: ${error.message}`;
        process.stderr.write(`task-records: ${row.task} ${row.reason}\n`);
      }
    }
  }

  const code = rows.some((row) => row.failed) ? 1 : 0;
  if (args.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ keepDays, tasks: rows }, null, 2)}\n`
    );
    return code;
  }
  process.stdout.write(`${renderRecords(rows)}\n`);
  return code;
}

process.exitCode = main(process.argv.slice(2));
