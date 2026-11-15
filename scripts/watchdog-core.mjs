/**
 * What the watchdog says, and when it stays quiet.
 *
 * The orchestrator is one long conversation, so when it stalls nothing inside it can
 * notice. Three stalls cost 78 hours in eighteen days: a full disk (34 h), a network
 * loss nothing resumed from (39 h), and a dead session (6 h). A second process has to
 * look, and it has to be quiet when nothing moved or it will be switched off - the
 * first watch here fired 38 times, found nothing, and was deleted the next morning.
 *
 * So each check is a *fact* with a `state`, and a fact is reported only when its state
 * changes, plus a reminder while it stays at `alert`. `scripts/watchdog.mjs` gathers
 * the facts; this file decides, with no process, clock or filesystem of its own.
 */

import { leaseIsLive } from './lease-core.mjs';

/** An unresolved alert is repeated this often, so one missed message is not the only one. */
export const REMIND_AFTER_HOURS = 6;

export const DISK_WARN_GB = 40;
export const DISK_ALERT_GB = 20;

const LEVELS = ['ok', 'warn', 'alert'];

/**
 * @typedef {{key: string, level: 'ok' | 'warn' | 'alert', state: string, text: string}} Fact
 */

/** @param {number | null} freeGb @returns {Fact | null} */
export function diskFact(freeGb) {
  if (freeGb == null || !Number.isFinite(freeGb)) return null;
  const level =
    freeGb < DISK_ALERT_GB ? 'alert' : freeGb < DISK_WARN_GB ? 'warn' : 'ok';
  return {
    key: 'disk',
    level,
    // The band, not the number: 451 GB becoming 449 GB is not news.
    state: level,
    text:
      level === 'ok'
        ? `${freeGb} GB free`
        : `${freeGb} GB free. Run \`node scripts/worktrees.mjs --prune\`.`,
  };
}

/**
 * @param {{verdict: string, branch: string | null}[] | null} rows `worktrees.mjs --json`
 * @returns {Fact | null}
 */
export function worktreesFact(rows) {
  if (rows == null) return null;
  const removable = rows
    .filter((row) => row.verdict === 'remove')
    .map((row) => row.branch ?? '(detached)')
    .sort();
  return {
    key: 'worktrees',
    level: removable.length > 0 ? 'warn' : 'ok',
    state: removable.join(','),
    text:
      removable.length > 0
        ? `${removable.length} of ${rows.length} worktrees can be removed ` +
          `(${removable.join(', ')}): \`node scripts/worktrees.mjs --prune\`.`
        : `${rows.length} worktrees, none removable`,
  };
}

/**
 * A lease past its ttl that is still in the store: a task that died holding devices.
 * "Past its ttl" is the pool's own rule (`leaseIsLive`), not a second copy of it.
 *
 * @param {{id?: string, task?: string}[] | null} leases
 * @param {number} nowMs
 * @returns {Fact | null}
 */
export function leasesFact(leases, nowMs) {
  if (leases == null) return null;
  const expired = leases
    .filter((lease) => !leaseIsLive(lease, nowMs))
    .map((lease) => String(lease.id ?? lease.task ?? '?'))
    .sort();
  return {
    key: 'leases',
    level: expired.length > 0 ? 'warn' : 'ok',
    state: expired.join(','),
    text:
      expired.length > 0
        ? `expired and never released: ${expired.join(', ')}. ` +
          'Its task probably stopped mid-run.'
        : `${leases.length} lease(s), none expired`,
  };
}

/** Conclusions that say the code is good or bad. Anything else says nothing. */
const CI_GREEN = ['success'];
const CI_RED = ['failure', 'timed_out', 'startup_failure', 'action_required'];

/**
 * For each workflow, the newest finished run on `main` that reached a verdict.
 *
 * A cancelled, skipped or neutral run is not a verdict: `main` cancels a superseded
 * run by design, and reading that as red would raise an alert that fixes itself. The
 * caller asks for each workflow's own recent runs, because one shared list of the
 * last N lets a red run age out behind scheduled runs of another workflow and read
 * as a recovery nobody made.
 *
 * @param {{workflowName: string, status: string, conclusion: string | null,
 *   headSha: string}[] | null} runs newest first within each workflow
 * @returns {Fact | null}
 */
export function ciFact(runs) {
  if (runs == null) return null;
  const verdicts = new Map();
  for (const run of runs) {
    if (run.status !== 'completed' || verdicts.has(run.workflowName)) continue;
    const conclusion = run.conclusion ?? '';
    if (CI_GREEN.includes(conclusion) || CI_RED.includes(conclusion)) {
      verdicts.set(run.workflowName, run);
    }
  }
  const red = [...verdicts.values()]
    .filter((run) => CI_RED.includes(run.conclusion ?? ''))
    .map((run) => `${run.workflowName} (${String(run.headSha).slice(0, 8)})`)
    .sort();
  return {
    key: 'ci',
    level: red.length > 0 ? 'alert' : 'ok',
    state: red.join(','),
    text:
      red.length > 0
        ? `red on main: ${red.join(', ')}`
        : `${verdicts.size} workflow(s) green on main`,
  };
}

/**
 * @param {{published: string | null, local: string | null}} versions
 * @returns {Fact | null}
 */
export function npmFact({ published, local }) {
  if (published == null || published === '') return null;
  return {
    key: 'npm',
    level: 'ok',
    state: published,
    text:
      local != null && local !== published
        ? `npm latest is ${published}; main is at ${local}`
        : `npm latest is ${published}`,
  };
}

/**
 * Only issues the repository owner opened are work: anyone can open one on a public
 * repository. Titles are other people's text and never go into `state`.
 *
 * @param {{number: number, author?: {login?: string}}[] | null} issues
 * @param {string | null} owner the repository owner's login
 * @returns {Fact | null} `null` when the issues or the owner could not be read
 */
export function issuesFact(issues, owner) {
  if (issues == null || !owner) return null;
  const numbers = issues
    .filter((issue) => issue.author?.login === owner)
    .map((issue) => issue.number)
    .sort((a, b) => a - b);
  return {
    key: 'issues',
    level: 'ok',
    state: numbers.join(','),
    text:
      numbers.length > 0
        ? `open issues from the owner: ${numbers.map((number) => `#${number}`).join(', ')}`
        : 'no open issues from the owner',
  };
}

/**
 * @param {{number: number, checks: string[]}[] | null} prs each PR's check conclusions
 * @returns {Fact | null}
 */
export function pullRequestsFact(prs) {
  if (prs == null) return null;
  const failing = prs
    .filter((pr) =>
      pr.checks.some((conclusion) =>
        ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ERROR'].includes(conclusion)
      )
    )
    .map((pr) => `#${pr.number}`)
    .sort();
  return {
    key: 'prs',
    level: failing.length > 0 ? 'warn' : 'ok',
    state: failing.join(','),
    text:
      failing.length > 0
        ? `open PRs with failing checks: ${failing.join(', ')}`
        : `${prs.length} open PR(s), no failing checks`,
  };
}

/**
 * A fact the caller observed itself, as `key=level:state:text`. The scheduled agent
 * uses this for what only it can see: whether the orchestrator's conversation is
 * alive and how many delegated tasks are waiting on a person.
 *
 * `state` is what gets compared between runs, so it is held to a small alphabet: no
 * colon (it would cut the state short and make two different states compare equal),
 * no quote or space (it travels through a shell), and no free text from a thread
 * title, which is someone else's words and would be passed on as if it were ours.
 *
 * @param {string} argument
 * @returns {Fact}
 */
export function parseFactArgument(argument) {
  const match =
    /^([a-z][a-z0-9-]*)=(ok|warn|alert):([A-Za-z0-9_.,#-]*)(?::([\s\S]*))?$/.exec(
      String(argument)
    );
  if (!match) {
    throw new Error(
      '--fact wants key=level:state[:text], level ok|warn|alert, state of ' +
        `letters, digits and _.,#- only; got "${argument}"`
    );
  }
  const [, key, level, state, text] = match;
  return { key, level, state, text: text ?? state };
}

/**
 * What to say now, and what to remember for next time.
 *
 * - a fact seen for the first time is said only if it is not `ok` (the first run of
 *   a healthy machine is silent);
 * - a fact whose `state` or `level` changed is said, recovery included;
 * - an `alert` that has not changed is said again after `REMIND_AFTER_HOURS`;
 * - a fact that could not be read this time (absent from `facts`) keeps its old entry,
 *   so a network blip is neither news nor a recovery.
 *
 * @param {{facts?: Record<string, {level: string, state: string, text: string,
 *   since: number, reportedAt: number | null}>} | null} previous
 * @param {Fact[]} facts
 * @param {number} nowMs
 * @returns {{lines: string[], snapshot: {facts: object, checkedAt: number}}}
 */
export function diffSnapshot(previous, facts, nowMs) {
  const before = previous?.facts ?? {};
  const after = { ...before };
  const reported = [];
  for (const fact of facts) {
    if (!LEVELS.includes(fact.level)) continue;
    const old = before[fact.key];
    // Level as well as state: `warn` becoming `alert` with the same state is news, and
    // so is an alert that returns to `ok` without its state string moving.
    const changed =
      old == null
        ? fact.level !== 'ok'
        : old.state !== fact.state || old.level !== fact.level;
    const overdue =
      !changed &&
      fact.level === 'alert' &&
      nowMs - (old?.reportedAt ?? old?.since ?? nowMs) >=
        REMIND_AFTER_HOURS * 3_600_000;
    let line = null;
    if (changed) {
      const recovered =
        old != null && old.level !== 'ok' && fact.level === 'ok';
      line = recovered
        ? `OK    ${fact.key}: recovered. ${fact.text}`
        : `${label(fact.level)} ${fact.key}: ${fact.text}`;
    } else if (overdue) {
      const hours = Math.round((nowMs - old.since) / 3_600_000);
      line = `ALERT ${fact.key}: still, ${hours} h on. ${fact.text}`;
    }
    if (line != null) reported.push({ level: fact.level, line });
    after[fact.key] = {
      level: fact.level,
      state: fact.state,
      text: fact.text,
      since: old != null && !changed ? old.since : nowMs,
      reportedAt: line != null ? nowMs : (old?.reportedAt ?? null),
    };
  }
  reported.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level));
  return {
    lines: reported.map((entry) => entry.line),
    snapshot: { facts: after, checkedAt: nowMs },
  };
}

/** Every current fact, worst first: what a status message is built from. */
export function renderStatus(facts) {
  return [...facts]
    .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level))
    .map((fact) => `${label(fact.level)} ${fact.key}: ${fact.text}`)
    .join('\n');
}

function label(level) {
  return level === 'alert' ? 'ALERT' : level === 'warn' ? 'WARN ' : 'INFO ';
}
