/**
 * Which task records `scripts/task-records.mjs --archive` may take out of git.
 *
 * The cost of being wrong is one-sided, as it is for worktrees. Keeping a task's
 * records a little longer costs nothing; removing the brief or the review of a task
 * that is still in flight takes away what its worker is reading. So every unit case
 * starts from a task that *is* archivable and changes exactly one fact, and each single
 * fact must be enough to keep it. The end-to-end cases run the real command in a
 * throwaway repository, where the same facts come from git rather than from a fixture.
 *
 * Fixtures do not sit on the answer: the archivable base is 40 days old against a
 * 14-day window, the recent task is 3 days old, and the edge is tested on both sides.
 */

import { afterAll, describe, expect, it } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_KEEP_DAYS,
  archivePath,
  classifyTask,
  groupByTask,
  renderRecords,
  taskOfRecord,
} from '../task-records-core.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';

const ARCHIVABLE = {
  dirtyPaths: 0,
  worktreeBranch: null,
  unmergedBranch: null,
  ageDays: 40,
  keepDays: 14,
};

describe('classifyTask', () => {
  it('archives an old task nobody is working from', () => {
    expect(classifyTask(ARCHIVABLE)).toEqual({
      verdict: 'archive',
      reason: 'older than 14 days, no open branch',
    });
  });

  it.each([
    ['an uncommitted record', { dirtyPaths: 1 }, '1 uncommitted path'],
    ['several of them', { dirtyPaths: 3 }, '3 uncommitted paths'],
    [
      'a worktree on its branch',
      { worktreeBranch: 'task/G24-form' },
      'a worktree is on task/G24-form',
    ],
    [
      'a branch waiting to merge',
      { unmergedBranch: 'task/G24-fix2' },
      'task/G24-fix2 is not merged into main',
    ],
    ['an age nobody could read', { ageDays: null }, 'could not read'],
    ['a task merged this week', { ageDays: 3 }, 'younger than 14 days'],
    ['a longer window', { keepDays: 60 }, 'younger than 60 days'],
  ])('keeps %s', (_name, change, reason) => {
    const result = classifyTask({ ...ARCHIVABLE, ...change });
    expect(result.verdict).toBe('keep');
    expect(result.reason).toContain(reason);
  });

  it('keeps a task up to the window and archives it from there', () => {
    const at = (ageDays) => classifyTask({ ...ARCHIVABLE, ageDays }).verdict;
    expect(at(13.99)).toBe('keep');
    expect(at(14)).toBe('archive');
    expect(DEFAULT_KEEP_DAYS).toBe(14);
  });

  it('archives a recent task when the window is shorter than its age', () => {
    expect(
      classifyTask({ ...ARCHIVABLE, ageDays: 3, keepDays: 2 }).verdict
    ).toBe('archive');
  });
});

describe('taskOfRecord', () => {
  it.each([
    ['G24-form.md', 'G24'],
    ['G24-form.report.md', 'G24'],
    ['G24.review.md', 'G24'],
    ['G24/gates.jsonl', 'G24'],
    ['G6-picker/ios-light.png', 'G6'],
    ['F8b-sizing-held-set.md', 'F8b'],
    ['A1c-baselines.report.md', 'A1c'],
    ['FIX2-stale-measure.md', 'FIX2'],
    ['T01/failures/run--01.log', 'T01'],
  ])('%s belongs to a task', (file, task) => {
    expect(taskOfRecord(file)).toBe(task);
  });

  it.each([
    'STATUS.md',
    'RECOVERY.md',
    'FOLLOWUPS.md',
    'ORCHESTRATOR.md',
    'REPORT-TEMPLATE.md',
    'PLAN-0.2.md',
    'HANDOFF-mac1-2026-10-28.md',
    'Q-research-2026-10-27.md',
    'D4merge/gates.jsonl',
    'notes/G24.md',
  ])('%s is not a task record', (file) => {
    expect(taskOfRecord(file)).toBeNull();
  });
});

describe('groupByTask and archivePath', () => {
  it('groups records under their task and drops everything else', () => {
    const groups = groupByTask([
      'G24-form.md',
      'STATUS.md',
      'G2-button.md',
      'G24/gates.jsonl',
      'PLAN-0.4.md',
    ]);
    expect([...groups]).toEqual([
      ['G24', ['G24-form.md', 'G24/gates.jsonl']],
      ['G2', ['G2-button.md']],
    ]);
  });

  it("flattens the task's own folder and keeps every other name", () => {
    expect(archivePath('G24', 'G24/failures/run.log')).toBe(
      'G24/failures/run.log'
    );
    expect(archivePath('G24', 'G24-form.report.md')).toBe(
      'G24/G24-form.report.md'
    );
    expect(archivePath('G6', 'G6-picker/ios-light.png')).toBe(
      'G6/G6-picker/ios-light.png'
    );
    // `G2` must not swallow the start of `G24`.
    expect(archivePath('G2', 'G24/gates.jsonl')).toBe('G2/G24/gates.jsonl');
  });
});

describe('renderRecords', () => {
  it('names the command only when there is something to archive', () => {
    const kept = {
      task: 'G72',
      files: 2,
      ageDays: 3.4,
      verdict: 'keep',
      reason: 'x',
    };
    const old = { ...kept, task: 'G71', ageDays: 40.9, verdict: 'archive' };
    const draft = { ...kept, task: 'Q5', files: 0, ageDays: null };
    expect(renderRecords([kept, old, draft]).split('\n').slice(0, 3)).toEqual([
      'keep     G72      3 d     2 file(s)  -  x',
      'archive  G71     40 d     2 file(s)  -  x',
      'keep     Q5         -     0 file(s)  -  x',
    ]);
    expect(renderRecords([kept])).toContain(
      '1 task(s) with records, none to archive.'
    );
    expect(renderRecords([kept])).not.toContain('--archive');
    expect(renderRecords([kept, old])).toContain(
      '2 task(s) with records, 1 to archive: `node scripts/task-records.mjs --archive`.'
    );
  });
});

/* ------------------------------ the real command ----------------------------- */

describe('task-records.mjs, end to end', () => {
  const CLI = path.join(process.cwd(), 'scripts', 'task-records.mjs');
  const cleanup = [];

  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The environment every child here runs with: no lease, no inherited `GIT_*` (they
   * win over `cwd`, see `worktrees.test.js`), no host git config, and a state home of
   * its own so the archive lands in the fixture.
   */
  function childEnv(home) {
    const env = withoutLeaseEnv(process.env);
    for (const name of Object.keys(env)) {
      if (name.startsWith('GIT_')) delete env[name];
    }
    return {
      ...env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      HOME: home,
      NITRO_UI_HOME: home,
    };
  }

  const OLD = 40;
  const RECENT = 3;

  function makeRepo() {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'task-records-'))
    );
    cleanup.push(root);
    const repo = path.join(root, 'repo');
    const home = path.join(root, 'home');
    fs.mkdirSync(repo);
    fs.mkdirSync(home);
    /** Every commit is dated, because the date is what the rule reads. */
    const git = (args, daysAgo = OLD) => {
      const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      const result = spawnSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...childEnv(home),
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      });
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
      }
      return result.stdout.trim();
    };
    const record = (name) => path.join(repo, 'docs', 'tasks', name);
    const write = (name, text = `${name}\n`) => {
      fs.mkdirSync(path.dirname(record(name)), { recursive: true });
      fs.writeFileSync(record(name), text);
    };
    const commit = (message, daysAgo = OLD) => {
      git(['add', '-A']);
      git(['commit', '-qm', message], daysAgo);
    };
    git(['init', '-q', '-b', 'main']);
    // The fixture must be this repository and no other.
    expect(fs.realpathSync(git(['rev-parse', '--show-toplevel']))).toBe(repo);
    const run = (args = [], status = 0) => {
      const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
        cwd: repo,
        encoding: 'utf8',
        env: childEnv(home),
      });
      expect(result.status).toBe(status);
      if (status !== 0) return result.stderr;
      expect(result.stderr).toBe('');
      const byTask = {};
      for (const row of JSON.parse(result.stdout).tasks) byTask[row.task] = row;
      return byTask;
    };
    const tracked = () => git(['ls-files', '--', 'docs/tasks']).split('\n');
    return { root, repo, home, git, record, write, commit, run, tracked };
  }

  const STANDING = [
    'STATUS.md',
    'RECOVERY.md',
    'FOLLOWUPS.md',
    'ORCHESTRATOR.md',
    'REPORT-TEMPLATE.md',
    'PLAN-0.2.md',
    'D4merge/gates.jsonl',
  ];

  /** One old finished task, the standing files, and one task per reason to keep. */
  function makeScenario() {
    const repo = makeRepo();
    for (const name of STANDING) repo.write(name);
    repo.write('G71-done.md');
    repo.write('G71.review.md');
    repo.write('G71/gates.jsonl', '{"gate":"check"}\n');
    repo.write('G71/shots/a.png', Buffer.from([0x89, 0x50, 0x00, 0xff, 0x0a]));
    for (const name of ['S9-spike.md', 'X8-remote.md', 'F3-fix.md']) {
      repo.write(name);
    }
    repo.write('Q4-notes.md');
    repo.write('B2-old.md');
    repo.write('B2/failures/run.log');
    repo.commit('old tasks');

    // G71 went through a branch that is merged and still exists.
    repo.git(['checkout', '-q', '-b', 'task/G71-done']);
    repo.write('G71-done.report.md');
    repo.commit('G71 report');
    repo.git(['checkout', '-q', 'main']);
    repo.git(['merge', '-q', '--no-ff', '-m', 'merge G71', 'task/G71-done']);

    // S9: a local branch that never merged. X8: the same, known only from a remote.
    repo.git(['checkout', '-q', '-b', 'task/S9-spike']);
    fs.writeFileSync(
      path.join(repo.repo, 'prototype.txt'),
      'kept on a branch\n'
    );
    repo.commit('S9 prototype');
    repo.git(['update-ref', 'refs/remotes/origin/task/X8-remote', 'HEAD']);
    repo.git(['checkout', '-q', 'main']);

    // F3: a worktree on a branch with no commits of its own, which reads as merged.
    repo.git([
      'worktree',
      'add',
      '-q',
      path.join(repo.root, 'f3'),
      '-b',
      'task/F3-fix',
      'main',
    ]);

    repo.write('G72-new.md');
    repo.commit('a task merged this week', RECENT);

    // Q4 is being edited, Q5 exists only as a draft, and one of B2's files is already
    // staged for removal, which is how the failure logs left.
    fs.appendFileSync(repo.record('Q4-notes.md'), 'an edit in progress\n');
    repo.write('Q5-draft.md');
    repo.git(['rm', '-q', '--', 'docs/tasks/B2/failures/run.log']);
    return repo;
  }

  it('lists every task with its verdict and never a standing file', () => {
    const repo = makeScenario();
    const before = repo.git(['status', '--porcelain']);
    const rows = repo.run();
    expect(Object.keys(rows).sort()).toEqual(
      ['B2', 'F3', 'G71', 'G72', 'Q4', 'Q5', 'S9', 'X8'].sort()
    );
    expect(rows.G71).toMatchObject({ verdict: 'archive', files: 5 });
    expect(Math.floor(rows.G71.ageDays)).toBe(OLD);
    expect(rows.B2).toMatchObject({ verdict: 'archive', files: 1 });
    expect(rows.G72).toMatchObject({
      verdict: 'keep',
      reason: 'younger than 14 days',
    });
    expect(Math.floor(rows.G72.ageDays)).toBe(RECENT);
    expect(rows.S9).toMatchObject({
      verdict: 'keep',
      reason: 'task/S9-spike is not merged into main',
    });
    expect(rows.X8).toMatchObject({
      verdict: 'keep',
      reason: 'task/X8-remote is not merged into main',
    });
    expect(rows.F3).toMatchObject({
      verdict: 'keep',
      reason: 'a worktree is on task/F3-fix',
    });
    expect(rows.Q4).toMatchObject({
      verdict: 'keep',
      reason: '1 uncommitted path',
    });
    expect(rows.Q5).toMatchObject({ verdict: 'keep', files: 0 });
    // Listing changes nothing.
    expect(repo.git(['status', '--porcelain'])).toBe(before);
    expect(fs.existsSync(path.join(repo.home, 'task-archive'))).toBe(false);
  });

  it('archives the old tasks: copied, removed, staged and not committed', () => {
    const repo = makeScenario();
    const head = repo.git(['rev-parse', 'HEAD']);
    const png = fs.readFileSync(repo.record('G71/shots/a.png'));
    const rows = repo.run(['--archive']);

    const archive = path.join(repo.home, 'task-archive');
    expect(rows.G71.archived).toBe(path.join(archive, 'G71'));
    expect(fs.readFileSync(path.join(archive, 'G71/shots/a.png'))).toEqual(png);
    expect(fs.readFileSync(path.join(archive, 'G71/gates.jsonl'), 'utf8')).toBe(
      '{"gate":"check"}\n'
    );
    for (const name of [
      'G71/G71-done.md',
      'G71/G71-done.report.md',
      'G71/G71.review.md',
      'B2/B2-old.md',
    ]) {
      expect(fs.existsSync(path.join(archive, name))).toBe(true);
    }
    // Only what was archived, and only tracked files: B2's log was already gone.
    expect(fs.readdirSync(archive).sort()).toEqual(['B2', 'G71']);
    expect(fs.existsSync(path.join(archive, 'B2/failures'))).toBe(false);

    // Gone from the working tree and from the index ...
    expect(fs.existsSync(repo.record('G71'))).toBe(false);
    expect(fs.existsSync(repo.record('G71-done.md'))).toBe(false);
    expect(fs.existsSync(repo.record('B2-old.md'))).toBe(false);
    expect(repo.tracked().filter((file) => /\/(G71|B2)/.test(file))).toEqual(
      []
    );
    // ... as a staged removal, with no commit made.
    expect(repo.git(['rev-parse', 'HEAD'])).toBe(head);
    expect(repo.git(['diff', '--cached', '--name-status'])).toContain(
      'D\tdocs/tasks/G71-done.report.md'
    );

    // Everything else is where it was.
    for (const name of [
      ...STANDING,
      'G72-new.md',
      'S9-spike.md',
      'X8-remote.md',
      'F3-fix.md',
      'Q4-notes.md',
      'Q5-draft.md',
    ]) {
      expect(fs.existsSync(repo.record(name))).toBe(true);
    }
    expect(repo.tracked()).toEqual(
      expect.arrayContaining(STANDING.map((name) => `docs/tasks/${name}`))
    );

    // A second run before the commit finds nothing left to do.
    const again = repo.run(['--archive']);
    expect(again.G71).toBeUndefined();
    expect(Object.values(again).filter((row) => row.archived)).toEqual([]);
  });

  it('takes the window from --days', () => {
    const repo = makeScenario();
    expect(repo.run(['--days', '2']).G72.verdict).toBe('archive');
    expect(repo.run(['--days', '60']).G71).toMatchObject({
      verdict: 'keep',
      reason: 'younger than 60 days',
    });
    expect(repo.run(['--days', 'soon'], 2)).toContain('--days needs a number');
  });

  it('removes nothing when the copy cannot be made', () => {
    const repo = makeRepo();
    repo.write('G71-done.md');
    repo.write('G71/gates.jsonl');
    repo.commit('an old task');
    // A file where the archive folder has to go: every copy fails.
    fs.writeFileSync(path.join(repo.home, 'task-archive'), 'in the way\n');

    const rows = repo.run(['--archive']);
    expect(rows.G71.verdict).toBe('keep');
    expect(rows.G71.reason).toContain('not archived');
    expect(rows.G71.archived).toBeUndefined();
    expect(repo.git(['status', '--porcelain'])).toBe('');
    expect(repo.tracked()).toEqual([
      'docs/tasks/G71-done.md',
      'docs/tasks/G71/gates.jsonl',
    ]);
    expect(fs.existsSync(repo.record('G71/gates.jsonl'))).toBe(true);
  });

  it('never overwrites an archived file that differs', () => {
    const repo = makeRepo();
    repo.write('G71-done.md');
    repo.write('G71/gates.jsonl', 'this round\n');
    repo.commit('an old task');
    const earlier = path.join(repo.home, 'task-archive/G71/gates.jsonl');
    fs.mkdirSync(path.dirname(earlier), { recursive: true });
    fs.writeFileSync(earlier, 'an earlier round\n');

    const rows = repo.run(['--archive']);
    expect(rows.G71.verdict).toBe('keep');
    expect(rows.G71.reason).toContain(
      'the archive already holds a different G71/gates.jsonl'
    );
    expect(fs.readFileSync(earlier, 'utf8')).toBe('an earlier round\n');
    expect(repo.git(['status', '--porcelain'])).toBe('');
    // Nothing was half-copied beside it either.
    expect(fs.readdirSync(path.dirname(earlier))).toEqual(['gates.jsonl']);
  });
});
