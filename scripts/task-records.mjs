#!/usr/bin/env node
/**
 * Lists the tasks that have records under `docs/tasks` and says which can leave git;
 * `--archive` copies those to the local archive and stages their removal.
 *
 *   node scripts/task-records.mjs             each task, its age, keep or archive, and why
 *   node scripts/task-records.mjs --archive   archive the ones marked archive
 *   node scripts/task-records.mjs --days 30   a different window (default 14)
 *   node scripts/task-records.mjs --json      the same listing as data
 *
 * A task is kept while its records have an uncommitted change, a worktree is on one of
 * its branches, a `task/<ID>-...` branch is not merged into `main`, or the newest commit
 * that touched its records is younger than the window (`scripts/task-records-core.mjs`
 * is the rule). Age is read on the current branch.
 *
 * `--archive` copies a task's tracked records to `~/.nitro-ui/task-archive/<ID>/`,
 * compares every copy with its source, and only then runs `git rm`. The removal is
 * staged, never committed: it rides in the caller's next commit. A copy that fails, or
 * an archive that already holds different bytes under the same name, leaves the task
 * exactly as it was.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { stateHome } from './lease-core.mjs';
import {
  DEFAULT_KEEP_DAYS,
  RECORDS_DIR,
  archivePath,
  classifyTask,
  groupByTask,
  renderRecords,
} from './task-records-core.mjs';
import { parseWorktreeList, taskOfBranch } from './worktrees-core.mjs';

const USAGE =
  'usage: node scripts/task-records.mjs [--archive] [--days N] [--json]\n';

/** @returns {string | null} stdout, or `null` when git failed */
function git(args, cwd) {
  const options = { cwd, encoding: 'utf8', maxBuffer: 2 ** 26 };
  const result = spawnSync('git', args, options);
  return result.status === 0 ? result.stdout : null;
}

const fields = (text, separator) => text.split(separator).filter(Boolean);
const below = (file) => file.slice(RECORDS_DIR.length + 1);
const inRepo = (files) => files.map((file) => `${RECORDS_DIR}/${file}`);

/**
 * Records with an uncommitted change, untracked ones included. A deletion that is
 * already staged (`D ` and nothing in the working tree) is not one: that is what this
 * command leaves behind, and what removing the failure logs left.
 */
function dirtyRecords(root) {
  const status = git(
    ['status', '--porcelain', '-z', '--untracked-files=all', '--', RECORDS_DIR],
    root
  );
  if (status == null) return null;
  return (
    fields(status, '\0')
      .filter((entry) => !entry.startsWith('D  '))
      // A rename's old name follows it as a field of its own, with no status letters.
      .map((entry) => below(/^.. /.test(entry) ? entry.slice(3) : entry))
  );
}

/**
 * Branches that are not merged, here or on a remote. Merged means merged into `main`
 * or into `origin/main`, as `worktrees.mjs` reads it.
 *
 * @returns {string[] | null} `null` when there is no `main` to compare with
 */
function unmergedBranches(root) {
  const lists = ['refs/heads/main', 'refs/remotes/origin/main']
    .map((ref) =>
      git(['branch', '-a', '--format=%(refname)', '--no-merged', ref], root)
    )
    .filter((list) => list != null)
    .map((list) => fields(list, '\n'));
  if (lists.length === 0) return null;
  return lists[0]
    .filter((ref) => lists.every((list) => list.includes(ref)))
    .map((ref) => ref.replace(/^refs\/(heads|remotes\/[^/]+)\//, ''));
}

/** Days since the newest commit on this branch that touched any of these records. */
function ageDaysOf(root, files, nowMs) {
  if (files.length === 0) return null;
  const newest = git(
    ['log', '-1', '--format=%ct', '--', ...inRepo(files)],
    root
  );
  return newest?.trim() ? (nowMs / 1000 - Number(newest)) / 86_400 : null;
}

const sameBytes = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));

/**
 * Copy, compare, then remove. Throws before anything is removed.
 *
 * @returns {string} the archive folder
 */
function archiveTask(root, task, files) {
  const archive = path.join(stateHome(), 'task-archive');
  const pairs = files.map((file) => ({
    file,
    from: path.join(root, RECORDS_DIR, file),
    to: path.join(archive, archivePath(task, file)),
  }));
  for (const { file, from, to } of pairs) {
    if (fs.existsSync(to) && !sameBytes(from, to)) {
      throw new Error(`the archive already holds a different ${file}`);
    }
  }
  for (const { from, to } of pairs) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  for (const { file, from, to } of pairs) {
    if (!sameBytes(from, to)) throw new Error(`the copy of ${file} differs`);
  }
  const removed = spawnSync('git', ['rm', '-q', '--', ...inRepo(files)], {
    cwd: root,
    encoding: 'utf8',
  });
  if (removed.status !== 0) {
    throw new Error(`git refused: ${removed.stderr.trim().split('\n')[0]}`);
  }
  return path.join(archive, task);
}

function main(argv) {
  const args = [...argv];
  let keepDays = DEFAULT_KEEP_DAYS;
  const at = args.indexOf('--days');
  if (at !== -1) {
    const [, value] = args.splice(at, 2);
    keepDays = Number(value);
    if (value == null || !Number.isFinite(keepDays) || keepDays < 0) {
      process.stderr.write(`task-records: --days needs a number\n${USAGE}`);
      return 2;
    }
  }
  const unknown = args.find((arg) => arg !== '--archive' && arg !== '--json');
  if (unknown != null) {
    process.stderr.write(`task-records: unknown argument ${unknown}\n${USAGE}`);
    return 2;
  }

  const root = git(['rev-parse', '--show-toplevel'], process.cwd())?.trim();
  const unmerged = root ? unmergedBranches(root) : null;
  const dirty = root ? dirtyRecords(root) : null;
  if (unmerged == null || dirty == null) {
    process.stderr.write(
      'task-records: needs a git checkout with a `main` to compare branches with\n'
    );
    return 2;
  }
  const listed = git(['ls-files', '-z', '--', RECORDS_DIR], root) ?? '';
  const tracked = groupByTask(fields(listed, '\0').map(below));
  const dirtyByTask = groupByTask(dirty);
  const worktreeBranches = parseWorktreeList(
    git(['worktree', 'list', '--porcelain'], root)
  ).map((record) => record.branch);
  const nowMs = Date.now();

  const tasks = [...new Set([...tracked.keys(), ...dirtyByTask.keys()])];
  const rows = tasks.sort().map((task) => {
    const files = tracked.get(task) ?? [];
    const ageDays = ageDaysOf(root, files, nowMs);
    const ofTask = (branch) => taskOfBranch(branch) === task;
    const verdict = classifyTask({
      dirtyPaths: (dirtyByTask.get(task) ?? []).length,
      worktreeBranch: worktreeBranches.find(ofTask) ?? null,
      unmergedBranch: unmerged.find(ofTask) ?? null,
      ageDays,
      keepDays,
    });
    return { task, files: files.length, ageDays, ...verdict };
  });

  if (args.includes('--archive')) {
    for (const row of rows.filter((each) => each.verdict === 'archive')) {
      // One task failing must not stop the rest, or hide what was already archived.
      try {
        row.archived = archiveTask(root, row.task, tracked.get(row.task));
      } catch (error) {
        row.verdict = 'keep';
        row.reason = `not archived: ${error.message}`;
      }
    }
  }

  if (args.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ keepDays, tasks: rows }, null, 2)}\n`
    );
    return 0;
  }
  const archived = rows.filter((row) => row.archived);
  process.stdout.write(
    `${renderRecords(rows.filter((row) => !row.archived))}\n`
  );
  for (const row of archived) {
    process.stdout.write(`archived  ${row.task}  ->  ${row.archived}\n`);
  }
  if (args.includes('--archive')) {
    process.stdout.write(
      `${archived.length} archived. The removals are staged, not committed.\n`
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
