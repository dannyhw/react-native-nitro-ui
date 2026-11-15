/**
 * Which task records under `docs/tasks` stay in git, decided from facts handed in.
 *
 * A task's brief, report and reviews are read while the task is in flight. Once it is
 * merged they are copied to a local archive and removed, so `docs/tasks` holds only
 * what somebody is still working from.
 *
 * Unknown is keep: a worktree list that cannot be read, a symbolic link, a brief with
 * no report. Anything that does not start with a task ID (`STATUS.md`, `FOLLOWUPS.md`,
 * the report template) is not a task record and is never listed.
 *
 * No process or filesystem access here: `scripts/task-records.mjs` gathers the facts.
 */

import { taskOfBranch } from './worktrees-core.mjs';

/** Where task records live, relative to the repository root. */
export const RECORDS_DIR = 'docs/tasks';

/** Days a merged task's records stay in git. Zero: they leave with the merge. */
export const DEFAULT_KEEP_DAYS = 0;

/** An unmerged branch whose tip is older than this no longer keeps its task. */
export const BRANCH_LIVE_DAYS = 14;

/**
 * The task a record belongs to, from its path below `docs/tasks`: `G24-form.report.md`,
 * `G24.review.md` and `G24/context.md` are all `G24`. A task ID is what a task branch
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
 * A brief with no report beside it: the task was started and never handed in.
 * Reviews are neither. A task that only has a report, or only a folder, is not this.
 *
 * @param {string[]} files the task's records, as paths below `docs/tasks`
 */
export function isUnfinished(files) {
  const top = files.filter(
    (file) => !file.includes('/') && file.endsWith('.md')
  );
  const brief = top.some(
    (file) => !/\.(report|(re)?review\d*)\.md$/.test(file)
  );
  return brief && !top.some((file) => file.endsWith('.report.md'));
}

/**
 * When a branch first held a commit of its own line, as its reflog recorded it.
 *
 * A fast-forward leaves no merge commit, so the commits it brought carry the dates
 * they were made. Only the reflog knows when the branch moved onto them, and a commit
 * that was already there when the reflog began has no recorded arrival.
 *
 * @param {string[]} line the branch's first-parent commits, newest first
 * @param {{sha: string, seconds: number}[]} reflog its reflog, newest first
 * @returns {(sha: string) => number | null} seconds since the epoch, or `null`
 */
export function arrivalByReflog(line, reflog) {
  const position = new Map(line.map((sha, index) => [sha, index]));
  const seen = reflog
    .filter((entry) => position.has(entry.sha))
    .map((entry) => ({ at: position.get(entry.sha), seconds: entry.seconds }));
  const began = seen[seen.length - 1];
  return (sha) => {
    const at = position.get(sha);
    if (at == null || began == null || at >= began.at) return null;
    const held = seen.filter((entry) => entry.at <= at);
    return held.length > 0 ? held[held.length - 1].seconds : null;
  };
}

/**
 * Keep or archive one task's records. The first reason to keep wins, ordered from
 * "this cannot be read" through "someone is working on it" to "not merged yet".
 *
 * @param {object} facts
 * @param {string} facts.task
 * @param {string[]} facts.files its tracked records, as paths below `docs/tasks`
 * @param {number} facts.symlinks how many of them are symbolic links
 * @param {{branch: string | null, dirty: string[]}[] | null} facts.worktrees every
 *   worktree of the clone with the records it has uncommitted changes to (untracked
 *   ones included, a deletion that is already staged excluded); `null` when the
 *   worktrees could not be read
 * @param {{branch: string, tipDays: number}[]} facts.openBranches its `task/<ID>-...`
 *   branches, local or remote-tracking, that HEAD does not contain, each with the age
 *   of its tip commit; the branch HEAD is on counts as one
 * @param {number | null} facts.ageDays since its records reached HEAD's own line;
 *   `null` when no commit holds them
 * @param {string | null} facts.since that date and what it was read from
 * @param {number} facts.keepDays the window after the merge
 * @returns {{verdict: 'keep' | 'archive', reason: string}}
 */
export function classifyTask(facts) {
  const { task, worktrees, openBranches, ageDays, keepDays } = facts;
  const keep = (reason) => ({ verdict: 'keep', reason });
  if (facts.symlinks > 0) return keep('a record is a symbolic link');
  if (worktrees == null) return keep('could not read the worktrees');
  for (const { branch, dirty } of worktrees) {
    const count = dirty.filter((file) => taskOfRecord(file) === task).length;
    const where = `the worktree on ${branch ?? 'a detached head'}`;
    if (count > 0) return keep(`${count} uncommitted path(s) in ${where}`);
  }
  const isOpen = (branch) =>
    openBranches.some((open) => open.branch === branch);
  const on = worktrees.find(({ branch }) => isOpen(branch));
  if (on != null) return keep(`a worktree is on ${on.branch}`);
  const live = openBranches.find((open) => open.tipDays < BRANCH_LIVE_DAYS);
  if (live != null) return keep(`${live.branch} is not merged into HEAD`);
  if (isUnfinished(facts.files)) return keep('a brief and no report: not done');
  if (ageDays == null) return keep('its records are not committed');
  const stale = openBranches[0];
  const dated = `${stale ? `${stale.branch} is stale` : 'merged'}, in HEAD since ${facts.since}`;
  if (ageDays < keepDays) return keep(`${dated}, kept ${keepDays} days`);
  return { verdict: 'archive', reason: dated };
}

/**
 * Copy a task's records, compare every copy with its source, and only then remove.
 * Throws before `remove` runs, so a task is archived whole or left whole.
 *
 * @param {{file: string, from: string, to: string}[]} pairs
 * @param {object} io
 * @param {(file: string) => boolean} io.exists
 * @param {(a: string, b: string) => boolean} io.same byte for byte
 * @param {(from: string, to: string) => void} io.copy
 * @param {() => void} io.remove removes every source, staged
 */
export function copyThenRemove(pairs, { exists, same, copy, remove }) {
  for (const { file, from, to } of pairs) {
    if (exists(to) && !same(from, to)) {
      throw new Error(`the archive already holds a different ${file}`);
    }
  }
  for (const { from, to } of pairs) copy(from, to);
  for (const { file, from, to } of pairs) {
    if (!same(from, to)) throw new Error(`the copy of ${file} differs`);
  }
  remove();
}

/**
 * The listing a person or an agent reads.
 *
 * @param {{task: string, files: number, ageDays: number | null, reason: string,
 *   verdict: 'keep' | 'archive' | 'archived'}[]} rows
 * @returns {string}
 */
export function renderRecords(rows) {
  const lines = rows.map((row) => {
    const age = row.ageDays == null ? '-' : `${Math.floor(row.ageDays)} d`;
    return (
      `${row.verdict.padEnd(8)}  ${row.task.padEnd(6)}${age.padStart(6)} ` +
      `${String(row.files).padStart(5)} file(s)  -  ${row.reason}`
    );
  });
  const count = (verdict) =>
    rows.filter((row) => row.verdict === verdict).length;
  const next = count('archived')
    ? `${count('archived')} archived: removal staged, not committed.`
    : `${count('archive')} to archive with \`--archive\`.`;
  lines.push(
    `${rows.length} task(s) with records, ${count('keep')} kept, ${next}`
  );
  return lines.join('\n');
}
