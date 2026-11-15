/**
 * Decides which task worktrees can be removed, from facts handed in. No process
 * or filesystem access here: `scripts/worktrees.mjs` gathers the facts.
 */

import { leaseIsLive } from './lease-core.mjs';

/** A worktree touched more recently than this may be between two commits of a live task. */
export const RECENT_ACTIVITY_HOURS = 6;

/**
 * `git worktree list --porcelain`, as records.
 *
 * @param {string} porcelain
 * @returns {{path: string, head: string | null, branch: string | null,
 *   detached: boolean, locked: boolean, missing: boolean, bare: boolean}[]}
 */
export function parseWorktreeList(porcelain) {
  const records = [];
  let current = null;
  for (const line of String(porcelain ?? '').split('\n')) {
    if (line.startsWith('worktree ')) {
      current = {
        path: line.slice('worktree '.length),
        head: null,
        branch: null,
        detached: false,
        locked: false,
        missing: false,
        bare: false,
      };
      records.push(current);
    } else if (current == null) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line
        .slice('branch '.length)
        .replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.missing = true;
    }
  }
  return records;
}

/**
 * The task a branch belongs to: `task/X32-merge` and `task/X32-review-debt` are both `X32`.
 *
 * @param {string | null} branch
 * @returns {string | null}
 */
export function taskOfBranch(branch) {
  const match = /^task\/([A-Za-z]+\d+[a-z]?)(?:[-/]|$)/.exec(
    String(branch ?? '')
  );
  return match ? match[1] : null;
}

/**
 * The tasks holding a lease that has not run out, by the pool's own rule.
 *
 * @param {{task?: string}[]} leases
 * @param {number} nowMs
 * @returns {string[]}
 */
export function liveLeaseTasks(leases, nowMs) {
  const tasks = [];
  for (const lease of leases ?? []) {
    if (lease?.task == null) continue;
    if (leaseIsLive(lease, nowMs)) tasks.push(String(lease.task));
  }
  return tasks;
}

/**
 * Keep or remove one worktree. The first reason to keep it wins, and the order is
 * from "never" (the main checkout) to "not yet" (recent activity).
 *
 * - `merged` means merged into `main`: a branch that is only pushed is in review.
 * - `branchMoved` is false for a worktree nothing has been committed in. Its head
 *   is a commit of `main`, so it would otherwise read as merged.
 * - `busyProcesses` covers a build or a gate, which writes ignored files for hours
 *   without touching git's own state.
 *
 * @param {object} facts
 * @param {boolean} facts.isMain the clone's own checkout
 * @param {boolean} facts.isCurrent the worktree this command runs in
 * @param {boolean} facts.locked `git worktree lock`
 * @param {boolean} facts.missing the directory is already gone
 * @param {string | null} facts.branch
 * @param {string[]} facts.leasedTasks tasks with a live lease
 * @param {number | null} facts.busyProcesses processes whose working directory is inside it;
 *   `null` when that could not be asked
 * @param {number | null} facts.dirtyPaths uncommitted or untracked paths; `null` when unreadable
 * @param {boolean} facts.merged its head commit is in `main`
 * @param {boolean} facts.branchMoved its branch has moved since it was created
 * @param {number | null} facts.idleHours since anything it records as activity last changed
 * @returns {{verdict: 'keep' | 'remove', reason: string}}
 */
export function classifyWorktree({
  isMain,
  isCurrent,
  locked,
  missing,
  branch,
  leasedTasks,
  busyProcesses,
  dirtyPaths,
  merged,
  branchMoved,
  idleHours,
}) {
  const keep = (reason) => ({ verdict: 'keep', reason });
  if (isMain) return keep('the main checkout');
  if (isCurrent) return keep('this command is running in it');
  if (missing) return keep('directory already gone (`git worktree prune`)');
  if (locked) return keep('locked');
  const task = taskOfBranch(branch);
  if (task == null) return keep('not a task branch (task/<ID>-...)');
  if ((leasedTasks ?? []).includes(task)) {
    return keep(`${task} holds a live device lease`);
  }
  if (busyProcesses == null) {
    return keep('could not check for processes running in it');
  }
  if (busyProcesses > 0) {
    return keep(
      `${busyProcesses} process${busyProcesses === 1 ? '' : 'es'} running in it`
    );
  }
  if (dirtyPaths == null) return keep('could not read its status');
  if (dirtyPaths > 0) {
    return keep(`${dirtyPaths} uncommitted path${dirtyPaths === 1 ? '' : 's'}`);
  }
  if (!merged) return keep('not merged into main');
  if (!branchMoved) return keep('no commits of its own yet');
  if (idleHours == null) return keep('could not read when it was last used');
  if (idleHours < RECENT_ACTIVITY_HOURS) {
    return keep(`used ${formatHours(idleHours)} ago`);
  }
  return {
    verdict: 'remove',
    reason: `merged into main, idle ${formatHours(idleHours)}`,
  };
}

/** @param {number} hours @returns {string} */
export function formatHours(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * The listing a person or an agent reads.
 *
 * @param {{path: string, branch: string | null, verdict: string, reason: string}[]} rows
 * @returns {string}
 */
export function renderWorktrees(rows) {
  const removable = rows.filter((row) => row.verdict === 'remove');
  const lines = rows.map(
    (row) =>
      `${row.verdict === 'remove' ? 'remove' : 'keep  '}  ` +
      `${row.branch ?? '(detached)'}  -  ${row.reason}\n        ${row.path}`
  );
  lines.push(
    removable.length === 0
      ? `${rows.length} worktree(s), none removable.`
      : `${rows.length} worktree(s), ${removable.length} removable: ` +
          '`node scripts/worktrees.mjs --prune`.'
  );
  return lines.join('\n');
}
