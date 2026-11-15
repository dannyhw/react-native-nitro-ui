#!/usr/bin/env node
/**
 * `bun run task-ready`: checks that a task branch is ready to hand in. It runs
 * no builds or gates, and reports every problem instead of the first one.
 *
 *   bun run task-ready                # task id from the branch name
 *   node scripts/task-ready.mjs --task X4
 *   node scripts/task-ready.mjs --task X4 --only coverage,report
 *
 * Checks: the generated registry is current, every manifest has conformance
 * coverage, no `TODO`/`FIXME` sits in a declared fallback or a generated
 * region, every repo path the report cites exists at HEAD, `gate.mjs need
 * --for review` is satisfied, and the report's gate table matches
 * `gate.mjs table`. `--only` runs a subset and says so on the last line.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  checkA11yTable,
  checkCoverage,
  checkFallbackTable,
  checkInAppFixtures,
  checkRecycleNotes,
  checkSharedTableMirror,
  coverageMatrix,
  failingKeys,
  recycleNotes,
  repoManifests,
} from './conformance-core.mjs';
import {
  expandOnly,
  missingReportPaths,
  ONLY_GROUPS,
  reportCandidates,
  slugReportNames,
  taskIdFromBranch,
  taskIdsFromBranch,
  taskFromBranchName,
  reportTableProblems,
  summarise,
  todoFindings,
  unscannedProblem,
} from './task-ready-core.mjs';

const repoRoot = resolve(process.cwd());

function read(path) {
  if (path == null) return null;
  const absolute = join(repoRoot, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

/** A `git` call, or `fallback` when it fails (a missing ref, not a repo). */
function git(args, fallback = null) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? String(result.stdout).trim() : fallback;
}

const argv = process.argv.slice(2);

function arg(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

/** The branch's task suffix and id, from `task/X4-conformance`, `merge/X4` or `refs/heads/...`. */
function branchTask() {
  return taskFromBranchName(git(['rev-parse', '--abbrev-ref', 'HEAD'], ''));
}

/** The task id: `--task` wins; otherwise the leading id of the branch name. */
function taskId(branch) {
  const explicit = arg('--task');
  if (explicit != null) return explicit;
  return taskIdFromBranch(branch);
}

/**
 * The report file names in the tasks directory. An unreadable directory
 * returns nothing.
 */
function taskReportNames() {
  try {
    return readdirSync(join(repoRoot, 'docs', 'tasks'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.report.md'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

const ALL = [
  'registry',
  'coverage',
  'markers',
  'report-paths',
  'need',
  'report-table',
];

const only = expandOnly(
  arg('--only')
    ?.split(',')
    .map((name) => name.trim()) ?? ALL
);
for (const name of only) {
  if (!ALL.includes(name)) {
    const groups = Object.entries(ONLY_GROUPS).map(
      ([group, members]) => `${group} = ${members.join(', ')}`
    );
    console.error(
      `task-ready: --only does not know "${name}". ` +
        `Sections: ${ALL.join(', ')}. Groups: ${groups.join('; ')}`
    );
    process.exit(2);
  }
}

const branch = branchTask().branch;
const id = taskId(branch);
const wantsReport = only.some(
  (name) => name === 'report-paths' || name === 'report-table'
);
if (wantsReport && id == null) {
  // Two ids is a different answer from none: a merge branch names both of its
  // tasks, and checking only the first would call half a merge ready.
  const bothIds = taskIdsFromBranch(branch);
  console.error(
    bothIds.length > 1
      ? `task-ready: the branch names ${bothIds.length} task ids (${bothIds.join(
          ', '
        )}) and the report checks read one report at a time — run it once per task with ` +
          `\`--task ${bothIds[0]}\`, then \`--task ${bothIds[1]}\`. Picking the first and ` +
          'reporting "ready" would leave the other task unreported.'
      : 'task-ready: no task id — pass --task <ID>, or work on a branch whose name ' +
          'starts with one (`task/X4-conformance`, `merge/X4`, `X4-fix1`). The report ' +
          'checks read docs/tasks/<ID>.report.md, docs/tasks/<branch>.report.md and a ' +
          'unique docs/tasks/<ID>-*.report.md, and cannot guess an id from prose.'
  );
  process.exit(2);
}
/** The report to check: whichever candidate exists. */
const taskReports = taskReportNames();
const slugMatches = slugReportNames(id, taskReports);
const candidates = reportCandidates(id, branch, taskReports);
const reportPath =
  candidates.find((path) => existsSync(join(repoRoot, path))) ?? null;

/* ---------------------------------- the checks -------------------------------- */

const sections = {};
const notes = [];

/** 1. The registry and the branch's control set agree. */
sections['registry:check'] = only.includes('registry')
  ? runGenerator()
  : skipped();

/** 2. Every manifest is covered by the conformance suite. */
sections['conformance coverage'] = only.includes('coverage')
  ? coverageProblems()
  : skipped();

/** 3. No TODO/FIXME in a declared fallback or a generated region. */
sections['no TODO/FIXME in generated or fallback code'] = only.includes(
  'markers'
)
  ? markerProblems()
  : skipped();

/** 4-6. The report, which needs the task id. */
sections['report paths exist'] = only.includes('report-paths')
  ? reportPathProblems()
  : skipped();
sections['gate.mjs need --for review'] = only.includes('need')
  ? needProblems()
  : skipped();
sections["report's gate table is the generated one"] = only.includes(
  'report-table'
)
  ? reportTableIsCurrent()
  : skipped();

/* ----------------------------------- output ----------------------------------- */

console.log(`task-ready: ${id ?? '(no task id)'}`);
const { lines, ok } = summarise(sections);
for (const line of lines) console.log(line);
for (const note of notes) console.log(`  note    ${note}`);
console.log(
  only.length === ALL.length
    ? ok
      ? `task-ready: ready — ${String(ALL.length)} checks, none reporting a problem`
      : 'task-ready: not ready — fix the lines above and run it again'
    : `task-ready: PARTIAL — only ${only.join(', ')} ran, so this is not the bar`
);
process.exitCode = ok ? 0 : 1;

/* ---------------------------------- the bodies -------------------------------- */

function skipped() {
  return ['not run (--only)'];
}

/**
 * `node scripts/gen-registry.mjs --check`, with its own output as the message.
 */
function runGenerator() {
  const result = spawnSync(
    process.execPath,
    ['scripts/gen-registry.mjs', '--check'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  if (result.status === 0) return [];
  const out = `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return out.length > 0
    ? out.slice(0, 12)
    : [`gen-registry --check exited ${String(result.status)}`];
}

function coverageProblems() {
  const manifests = repoManifests();
  const sizing = JSON.parse(read('nitro-ui.sizing.json') ?? '{}');
  const harnessText = read('example/__tests__/Conformance.harness.tsx');

  const matrix = coverageMatrix(manifests, {
    sizing,
    failing: failingKeys(),
    recycleNotes: recycleNotes(harnessText),
  });
  return [
    ...checkFallbackTable(manifests, sizing),
    ...checkSharedTableMirror(harnessText ?? ''),
    ...checkInAppFixtures(manifests, harnessText),
    ...checkRecycleNotes(harnessText),
    ...checkA11yTable(manifests, read),
    ...checkCoverage(manifests, matrix),
  ];
}

/**
 * The TODO scan over what the branch touched: the committed diff, unstaged
 * edits and untracked files.
 */
function markerProblems() {
  const base = git(['merge-base', 'main', 'HEAD'], null);
  if (base == null) {
    // A problem, not a note: a scan that read zero files prints the same as one
    // that read them all and found nothing.
    return unscannedProblem(
      'the TODO scan',
      'no merge-base with `main`',
      'Run it on a branch that has one, or point it at a base that does.'
    );
  }
  const paths = new Set();
  for (const args of [
    ['diff', '--name-only', '--no-renames', `${base}...HEAD`],
    ['diff', '--name-only', '--no-renames', base],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    for (const line of (git(args, '') ?? '').split('\n')) {
      if (line.trim() !== '') paths.add(line.trim());
    }
  }
  const files = new Map();
  for (const path of paths) {
    const text = read(path);
    if (text != null) files.set(path, text);
  }
  return todoFindings(files);
}

function reportPathProblems() {
  const text = read(reportPath);
  if (text == null) {
    if (slugMatches.length > 1) {
      // Several reports match the id, and the id alone cannot say which one
      // this branch wrote.
      return [
        `${slugMatches.length} reports start with \`docs/tasks/${id}-\` (` +
          `${slugMatches.map((name) => `docs/tasks/${name}`).join(', ')}), and none is ` +
          `this branch's own \`docs/tasks/${branch}.report.md\`, so the checker cannot ` +
          'pick one and will not guess: name the report after the branch, which wins ' +
          'over the slug rule, or pass --task for an id with one report.',
      ];
    }
    return [
      `${candidates.join(' or ')}: not found. AGENTS.md asks for the report ` +
        'before a round is handed in, and the two report checks below depend on it',
    ];
  }
  // `ls-tree -r HEAD`, not `ls-files`: the index also lists staged files that
  // are in no commit, and the report is read against HEAD.
  const listing = git(['ls-tree', '-r', '--name-only', 'HEAD', '--'], null);
  if (listing == null) {
    return unscannedProblem(
      "the report's citations could not be checked against HEAD",
      'git ls-tree -r HEAD failed',
      'The alternative is calling a tool failure a pass.'
    );
  }
  const existing = new Set(listing.split('\n').filter((line) => line !== ''));
  const touched = new Set(diffPaths());
  return missingReportPaths(text, existing, touched);
}

function needProblems() {
  const result = spawnSync(
    process.execPath,
    ['scripts/gate.mjs', 'need', '--for', 'review'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  if (result.status === 0) return [];
  const out = `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`;
  const missing = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^✗/.test(line));
  const summary = out
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('need:'));
  return [
    ...(missing.length > 0
      ? missing
      : ['`gate.mjs need --for review` exited nonzero']),
    ...(summary == null ? [] : [summary]),
  ];
}

function reportTableIsCurrent() {
  const text = read(reportPath);
  if (text == null) {
    // Not a problem of its own — `report paths exist` already fails for the missing
    // report — but printing `ok` here would claim a comparison that never happened.
    notes.push(
      "report's gate table not compared: no report to read (see above)"
    );
    return [];
  }
  const result = spawnSync(process.execPath, ['scripts/gate.mjs', 'table'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  // `table` exits 1 when the ledger is empty; the table is then on stderr, and there is
  // nothing to compare, which `need` already refuses. Report only the rows it did print.
  const printed = `${String(result.stdout ?? '')}`
    .split('\n')
    .filter((line) => /^\|/.test(line));
  return reportTableProblems(text, printed);
}

/** Paths the branch's diff adds, deletes or modifies, including uncommitted work. */
function diffPaths() {
  const base = git(['merge-base', 'main', 'HEAD'], null);
  if (base == null) return [];
  const paths = new Set();
  for (const args of [
    ['diff', '--name-only', '--no-renames', `${base}...HEAD`],
    ['diff', '--name-only', '--no-renames', base],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    for (const line of (git(args, '') ?? '').split('\n')) {
      if (line.trim() !== '') paths.add(line.trim());
    }
  }
  return [...paths];
}
