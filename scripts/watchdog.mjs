#!/usr/bin/env node
/**
 * Reports on the machine and the project, and speaks only when something changed.
 *
 *   node scripts/watchdog.mjs                 exit 0 and "quiet", or exit 10 and the lines to pass on
 *   node scripts/watchdog.mjs --status        every fact as it is now; remembers nothing
 *   node scripts/watchdog.mjs --fact 'orchestrator=alert:hung:no turn started for 3 h'
 *                                             add a fact the caller observed (repeatable)
 *
 * It writes only `~/.nitro-ui/watchdog.json`, its record of what it said last time. A check
 * it cannot make (no network, no `gh`) is skipped: neither an alert nor a recovery.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { stateHome } from './lease-core.mjs';
import {
  ciFact,
  diffSnapshot,
  diskFact,
  issuesFact,
  leasesFact,
  npmFact,
  parseFactArgument,
  pullRequestsFact,
  renderStatus,
  worktreesFact,
} from './watchdog-core.mjs';

/** Exit code for "there is something to say". */
const SOMETHING_TO_SAY_EXIT = 10;

const USAGE =
  'usage: node scripts/watchdog.mjs [--status] [--fact key=level:state[:text]]...\n';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/** A command's parsed JSON output, or `null` when it could not be had. */
function json(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function freeGb() {
  try {
    const stats = fs.statfsSync(REPO_ROOT);
    return Math.floor((stats.bavail * stats.bsize) / 2 ** 30);
  } catch {
    return null;
  }
}

function leases() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(stateHome(), 'leases.json'), 'utf8')
    );
    return Array.isArray(parsed) ? parsed : (parsed.leases ?? []);
  } catch {
    return null;
  }
}

function packageJson() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
    );
  } catch {
    return {};
  }
}

/**
 * Recent finished runs on `main`, asked of each workflow separately.
 * Push runs only: a scheduled or dispatched run says nothing about the last merge.
 *
 * @returns {object[] | null} `null` when GitHub could not be asked at all
 */
function mainRuns() {
  const workflows = json('gh', ['workflow', 'list', '--json', 'id,name,state']);
  if (workflows == null) return null;
  const runs = [];
  for (const workflow of workflows) {
    if (workflow.state !== 'active') continue;
    const recent = json('gh', [
      'run',
      'list',
      '--workflow',
      String(workflow.id),
      '--branch',
      'main',
      '--event',
      'push',
      '--status',
      'completed',
      '--limit',
      '5',
      '--json',
      'workflowName,status,conclusion,headSha',
    ]);
    // One workflow that cannot be read makes the whole answer unknown, rather than
    // letting a red one drop out and read as a recovery.
    if (recent == null) return null;
    runs.push(...recent);
  }
  return runs;
}

function gatherFacts(nowMs) {
  const pkg = packageJson();
  const published =
    pkg.name == null
      ? null
      : json('npm', ['view', pkg.name, 'version', '--json']);
  const prs = json('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '50',
    '--json',
    'number,statusCheckRollup',
  ]);
  return [
    diskFact(freeGb()),
    worktreesFact(
      json(process.execPath, [path.join(HERE, 'worktrees.mjs'), '--json'])
        ?.worktrees ?? null
    ),
    leasesFact(leases(), nowMs),
    ciFact(mainRuns()),
    npmFact({
      published: typeof published === 'string' ? published : null,
      local: pkg.version ?? null,
    }),
    issuesFact(
      json('gh', [
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,title',
      ])
    ),
    pullRequestsFact(
      prs == null
        ? null
        : prs.map((pr) => ({
            number: pr.number,
            checks: (pr.statusCheckRollup ?? []).map(
              (check) => check.conclusion ?? check.state ?? ''
            ),
          }))
    ),
  ].filter((fact) => fact != null);
}

function main(argv) {
  let status = false;
  const extra = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--status') {
      status = true;
    } else if (arg === '--fact' && index + 1 < argv.length) {
      try {
        extra.push(parseFactArgument(argv[(index += 1)]));
      } catch (error) {
        process.stderr.write(`watchdog: ${error.message}\n`);
        return 2;
      }
    } else {
      process.stderr.write(`watchdog: unknown argument ${arg}\n${USAGE}`);
      return 2;
    }
  }

  const nowMs = Date.now();
  const facts = [...gatherFacts(nowMs), ...extra];
  if (status) {
    process.stdout.write(`${renderStatus(facts)}\n`);
    return 0;
  }

  const file = path.join(stateHome(), 'watchdog.json');
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // First run, or an unreadable file: start from nothing.
  }
  const { lines, snapshot } = diffSnapshot(previous, facts, nowMs);
  // Written beside and renamed, so two runs at once cannot leave half a file.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(partial, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.renameSync(partial, file);
  if (lines.length === 0) {
    process.stdout.write('quiet\n');
    return 0;
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return SOMETHING_TO_SAY_EXIT;
}

process.exitCode = main(process.argv.slice(2));
