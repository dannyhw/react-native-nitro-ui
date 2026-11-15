/**
 * Which task records under `docs/tasks` stay in git, decided from facts handed in.
 *
 * A task leaves a brief, a report, reviews and a folder of evidence. They are read
 * while the task is in flight and for a short while after it merges; after that they
 * are history, and in three weeks that history was 2,300 files and 40 MB in a public
 * repository. So a task's records stay in git for a window after their last commit
 * and are then copied to a local archive and removed.
 *
 * The rule is "nobody is still working from it": no uncommitted change, no worktree
 * on its branch, no branch waiting to merge, and older than the window. Anything that
 * does not start with a task ID (`STATUS.md`, `FOLLOWUPS.md`, the report template) is
 * not a task record and is never listed.
 *
 * No process or filesystem access here: `scripts/task-records.mjs` gathers the facts
 * and `scripts/__tests__/task-records.test.js` proves the rule.
 */

import { taskOfBranch } from './worktrees-core.mjs';

/** Where task records live, relative to the repository root. */
export const RECORDS_DIR = 'docs/tasks';

/** Days a task's records stay in git after the last commit that touched them. */
export const DEFAULT_KEEP_DAYS = 14;

/**
 * The task a record belongs to, from its path below `docs/tasks`: `G24-form.report.md`,
 * `G24.review.md` and `G24/gates.jsonl` are all `G24`. A task ID is what a task branch
 * carries, so the branch rule decides and a name it rejects is not a task record.
 *
 * @param {string} relativePath
 * @returns {string | null}
 */
export function taskOfRecord(relativePath) {
  const first = String(relativePath ?? '').split('/')[0];
  return taskOfBranch(`task/${first.replace(/\..*$/, '')}`);
}

/**
 * Records grouped by task, in the order tasks first appear.
 *
 * @param {string[]} relativePaths paths below `docs/tasks`
 * @returns {Map<string, string[]>}
 */
export function groupByTask(relativePaths) {
  const groups = new Map();
  for (const file of relativePaths ?? []) {
    const task = taskOfRecord(file);
    if (task == null) continue;
    if (!groups.has(task)) groups.set(task, []);
    groups.get(task).push(file);
  }
  return groups;
}

/**
 * Where a record goes below `<state home>/task-archive/`. The task's own folder is
 * flattened into the archive folder of the same name, so `G24/gates.jsonl` is
 * `G24/gates.jsonl` and `G24-form.md` sits beside it as `G24/G24-form.md`.
 *
 * @param {string} task
 * @param {string} relativePath path below `docs/tasks`
 * @returns {string}
 */
export function archivePath(task, relativePath) {
  const prefix = `${task}/`;
  const inside = relativePath.startsWith(prefix)
    ? relativePath.slice(prefix.length)
    : relativePath;
  return `${task}/${inside}`;
}

/**
 * Keep or archive one task's records. The first reason to keep wins, ordered from
 * "someone is editing it now" to "not old enough yet".
 *
 * @param {object} facts
 * @param {number} facts.dirtyPaths its records with uncommitted changes, untracked ones
 *   included; a deletion that is already staged is not one
 * @param {string | null} facts.worktreeBranch a `task/<ID>-...` branch of this task that
 *   a worktree is checked out on, merged or not
 * @param {string | null} facts.unmergedBranch a local or remote-tracking `task/<ID>-...`
 *   branch that is not merged into `main`
 * @param {number | null} facts.ageDays since the newest commit that touched its
 *   records; `null` when none could be read
 * @param {number} facts.keepDays the window
 * @returns {{verdict: 'keep' | 'archive', reason: string}}
 */
export function classifyTask({
  dirtyPaths,
  worktreeBranch,
  unmergedBranch,
  ageDays,
  keepDays,
}) {
  const keep = (reason) => ({ verdict: 'keep', reason });
  if (dirtyPaths > 0) {
    return keep(`${dirtyPaths} uncommitted path${dirtyPaths === 1 ? '' : 's'}`);
  }
  if (worktreeBranch != null) {
    return keep(`a worktree is on ${worktreeBranch}`);
  }
  if (unmergedBranch != null) {
    return keep(`${unmergedBranch} is not merged into main`);
  }
  if (ageDays == null) return keep('could not read its last commit');
  if (ageDays < keepDays) return keep(`younger than ${keepDays} days`);
  return {
    verdict: 'archive',
    reason: `older than ${keepDays} days, no open branch`,
  };
}

/**
 * The listing a person or an agent reads.
 *
 * @param {{task: string, files: number, ageDays: number | null, verdict: string,
 *   reason: string}[]} rows
 * @returns {string}
 */
export function renderRecords(rows) {
  const archivable = rows.filter((row) => row.verdict === 'archive');
  const lines = rows.map((row) => {
    const age = row.ageDays == null ? '-' : `${Math.floor(row.ageDays)} d`;
    return (
      `${row.verdict === 'archive' ? 'archive' : 'keep   '}  ${row.task.padEnd(6)}` +
      `${age.padStart(6)} ${String(row.files).padStart(5)} file(s)  -  ${row.reason}`
    );
  });
  lines.push(
    archivable.length === 0
      ? `${rows.length} task(s) with records, none to archive.`
      : `${rows.length} task(s) with records, ${archivable.length} to archive: ` +
          '`node scripts/task-records.mjs --archive`.'
  );
  return lines.join('\n');
}
