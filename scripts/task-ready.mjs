#!/usr/bin/env node
/**
 * `bun run task-ready` — the bar a round has to clear before it hands in.
 *
 * AGENTS.md defines the definition of done in prose: `check` passes, the gates are green,
 * the report's table is the generated one, no invented files. Prose is what reviews find
 * later, and a review finding is the 44 % of implementer time `PROCESS-review-2026-10-26.md`
 * §1 measures. This is the same list as a command, run by the implementer instead of by the
 * reviewer.
 *
 * ## What it checks, and why each one is here
 *
 * 1. `registry:check` — the branch's control set and the generated registry agree. Called
 *    rather than reimplemented: the generator is the only thing that knows what it generates.
 * 2. Conformance coverage — every manifest has a case in the suite, and every `failing`
 *    cell cites a `FOLLOWUPS.md` line that exists. The same functions
 *    `component-coverage.test.js` runs, so the two cannot disagree about the bar.
 * 3. `TODO` / `FIXME` in a declared fallback or inside a generated region — a decision
 *    nobody made, or one the next `regen` will overwrite.
 * 4. Every backticked repo path in the report exists at HEAD, unless the branch's diff adds
 *    or deletes it. X3's first report cited files that were never in the tree.
 * 5. `gate.mjs need --for review` is satisfied, run as a subprocess so the answer comes
 *    from the ledger rather than from a reimplementation of what a stage needs.
 * 6. The report's gate table matches `gate.mjs table` for this code tree — a stale row is a
 *    claim, the ledger row is evidence.
 *
 * ## What it deliberately does not do
 *
 * It does not run anything: no builds, no gates, no `check`. Those take minutes and belong
 * to `gate.mjs`, whose ledger is what #5 and #6 read. This is the last thing you run, not a
 * replacement for the things before it.
 *
 * It reports every problem rather than the first one, because the point is to hand in once.
 *
 * And a check it could not run is a problem, not a note: a scan blocked by git state (no
 * merge-base to diff, `git ls-tree` refusing) reads zero files, which prints exactly like a
 * scan that read a thousand and found nothing. `unscannedProblem` is how each one says so.
 *
 * ## Usage
 *
 *   bun run task-ready                # task id from the branch name
 *   node scripts/task-ready.mjs --task X4
 *   node scripts/task-ready.mjs --task X4 --only coverage,report
 *
 * `--only` runs a subset, for a round that is iterating on one thing; the full list is the
 * bar, and `--only` says so on the last line so a partial pass cannot be read as a pass.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  checkA11yTable,
  checkCoverage,
  checkFallbackTable,
  checkInAppFixtures,
  checkSharedTableMirror,
  coverageMatrix,
  failingKeys,
  followupsResolver,
  repoManifests,
} from './conformance-core.mjs';
import {
  expandOnly,
  missingReportPaths,
  ONLY_GROUPS,
  reportCandidates,
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

/** The branch's task suffix: `task/X4-conformance` -> `X4-conformance`, or null. */
function branchSuffix() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], '');
  const match = /^task\/([A-Za-z0-9._-]+)$/.exec(branch);
  return match == null ? null : match[1];
}

/** The task id: `--task`, or the leading id of the branch name (`X4-conformance` -> `X4`). */
function taskId(branch) {
  const explicit = arg('--task');
  if (explicit != null) return explicit;
  if (branch == null) return null;
  return /^([A-Za-z0-9]+)-/.exec(branch)?.[1] ?? branch;
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

const branch = branchSuffix();
const id = taskId(branch);
const wantsReport = only.some(
  (name) => name === 'report-paths' || name === 'report-table'
);
if (wantsReport && id == null) {
  console.error(
    'task-ready: no task id — pass --task <ID> or name the branch task/<ID>. ' +
      'The report checks read docs/tasks/<ID>.report.md and cannot guess it.'
  );
  process.exit(2);
}
/**
 * The report to check: whichever candidate exists.
 *
 * `reportCandidates` explains why there is more than one spelling; `reportPathProblems`
 * names every candidate when none of them is there, so a missing report is still an
 * unambiguous failure rather than a guess.
 */
const candidates = reportCandidates(id, branch);
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
 *
 * The generator is the only thing that knows which files it writes and what it writes in
 * them, so this shells out rather than importing `regionsFor` and comparing by hand — an
 * implementation that drifted from the generator would report a green registry on a tree
 * that cannot build.
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
  const followups = read('docs/tasks/FOLLOWUPS.md');

  const matrix = coverageMatrix(manifests, {
    sizing,
    failing: failingKeys(),
  });
  return [
    ...checkFallbackTable(manifests, sizing),
    ...checkSharedTableMirror(harnessText ?? ''),
    ...checkInAppFixtures(manifests, harnessText),
    ...checkA11yTable(manifests, read),
    ...checkCoverage(manifests, matrix, followupsResolver(followups)),
  ];
}

/**
 * The TODO scan, over what the branch touched.
 *
 * Three sources, the same three `gate.mjs` reads, because a round is usually part-committed:
 * committed diff, unstaged edits, untracked new files. An untracked generated file with a
 * `TODO` in it is exactly the thing worth catching before it is committed.
 */
function markerProblems() {
  const base = git(['merge-base', 'main', 'HEAD'], null);
  if (base == null) {
    // A problem, not a note (X4 review N8). As a note this printed and the run still said
    // `ready`, which is the one outcome the tool exists to refuse: the scan read zero files
    // and reported zero markers, and the two are indistinguishable in its output. Whether a
    // branch has no merge-base is not something this can fix, so the line says what to pass.
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
    return [
      `${candidates.join(' or ')}: not found. AGENTS.md asks for the report ` +
        'before a round is handed in, and the two report checks below depend on it',
    ];
  }
  // `ls-tree -r HEAD`, not `ls-files` (X4 review N7). `ls-files` reads the *index*, so a
  // `git add` of a file that is not in any commit makes its citations pass a check whose own
  // sentence says "exists at HEAD" — and the report is reviewed from HEAD, where the file is
  // not. The index is also dirty in the middle of a round in exactly the way that flatters:
  // half-staged work-in-progress files exist for the scan and not for the reviewer.
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
