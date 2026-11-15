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
 * The first version was reviewed before it merged and was wrong where it mattered
 * most: it dated a task by its branch's commits, so a branch three weeks old was
 * archived the day after it merged. The dated cases below are that review.
 *
 * Fixtures do not sit on the answer: the archivable base is 40 days old against a
 * 14-day window, the recent task is 3 days old, a late merge is 20 days of branch and
 * 1 day of `main`, and the edge is tested on both sides.
 */

import { afterAll, describe, expect, it } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_KEEP_DAYS,
  arrivalByReflog,
  classifyTask,
  copyThenRemove,
  groupByTask,
  isUnfinished,
  renderRecords,
  taskOfRecord,
} from '../task-records-core.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';

const ARCHIVABLE = {
  task: 'G24',
  files: ['G24-form.md', 'G24-form.report.md', 'G24/gates.jsonl'],
  symlinks: 0,
  // Another task's edit, and a worktree on another task's branch, are not this task's.
  worktrees: [
    { branch: 'main', dirty: ['X31-flakes.md'] },
    { branch: 'task/X31-flakes', dirty: [] },
  ],
  unmergedBranch: null,
  ageDays: 40,
  since: '2026-10-06 (merge commit)',
  keepDays: 14,
};

describe('classifyTask', () => {
  it('archives an old, finished task nobody is working from', () => {
    expect(classifyTask(ARCHIVABLE)).toEqual({
      verdict: 'archive',
      reason: 'on main since 2026-10-06 (merge commit), no open branch',
    });
  });

  it.each([
    ['a record that is a symbolic link', { symlinks: 1 }, 'symbolic link'],
    [
      'worktrees that could not be read',
      { worktrees: null },
      'could not read the worktrees',
    ],
    [
      'an uncommitted record in a worktree on any branch',
      { worktrees: [{ branch: 'feature/x', dirty: ['G24/gates.jsonl'] }] },
      '1 uncommitted path(s) in the worktree on feature/x',
    ],
    [
      'uncommitted records in a detached worktree',
      { worktrees: [{ branch: null, dirty: ['G24-form.md', 'G24/new.md'] }] },
      '2 uncommitted path(s) in the worktree on a detached head',
    ],
    [
      'a worktree on its branch',
      { worktrees: [{ branch: 'task/G24-fix1', dirty: [] }] },
      'a worktree is on task/G24-fix1',
    ],
    [
      'a branch waiting to merge',
      { unmergedBranch: 'task/G24-fix2' },
      'task/G24-fix2 is not merged',
    ],
    [
      'a brief with no report',
      { files: ['G24-form.md', 'G24-form.review.md', 'G24/gates.jsonl'] },
      'a brief and no report: not done',
    ],
    ['records that are not on main', { ageDays: null }, 'not on main'],
    ['a task merged this week', { ageDays: 3 }, 'kept 14 days'],
    ['a longer window', { keepDays: 60 }, 'kept 60 days'],
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

describe('isUnfinished', () => {
  it.each([
    [['G24-form.md'], true],
    [['G24.md', 'G24/context.md'], true],
    [['G24-form.md', 'G24-form.review.md', 'G24-form.rereview2.md'], true],
    // A report in the task's folder is evidence, not the hand-in.
    [['G24-form.md', 'G24/old.report.md'], true],
    [['G24-form.md', 'G24-form.report.md'], false],
    [['G24-form.md', 'G24.report.md'], false],
    [['A1b-baselines.report.md'], false],
    [['M2/gates.jsonl'], false],
    [['G24-form.review.md', 'G24/shots/a.png'], false],
  ])('%j -> %s', (files, unfinished) => {
    expect(isUnfinished(files)).toBe(unfinished);
  });
});

describe('taskOfRecord and groupByTask', () => {
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
});

describe('arrivalByReflog', () => {
  // main's own line, newest first, and where its reflog saw it: it began on `a`,
  // moved to `b`, then took `c` and `d` in one fast-forward.
  const line = ['d', 'c', 'b', 'a'];
  const reflog = [
    { sha: 'd', seconds: 400 },
    { sha: 'b', seconds: 300 },
    { sha: 'a', seconds: 100 },
  ];

  it('dates a commit by the first moment main held it', () => {
    const arrival = arrivalByReflog(line, reflog);
    expect(arrival('d')).toBe(400);
    // `c` never was the tip: it arrived inside the fast-forward to `d`.
    expect(arrival('c')).toBe(400);
    expect(arrival('b')).toBe(300);
  });

  it('takes the earliest visit when main went back and came again', () => {
    const revisited = [{ sha: 'd', seconds: 900 }, ...reflog];
    expect(arrivalByReflog(line, revisited)('c')).toBe(400);
  });

  it('knows nothing about what was there when the reflog began', () => {
    const arrival = arrivalByReflog(line, reflog);
    expect(arrival('a')).toBeNull();
    expect(arrivalByReflog(line, reflog.slice(0, 2))('a')).toBeNull();
    expect(arrivalByReflog(line, reflog.slice(0, 2))('b')).toBeNull();
    expect(arrivalByReflog(line, [])('d')).toBeNull();
  });

  it('ignores a commit off the line, and an entry off the line', () => {
    expect(arrivalByReflog(line, reflog)('z')).toBeNull();
    const rewritten = [...reflog, { sha: 'gone', seconds: 5 }];
    expect(arrivalByReflog(line, rewritten)('b')).toBe(300);
    expect(arrivalByReflog(line, rewritten)('a')).toBeNull();
  });
});

describe('copyThenRemove', () => {
  const pairs = [
    { file: 'G71-done.md', from: 'src/a', to: 'dst/a' },
    { file: 'G71/gates.jsonl', from: 'src/b', to: 'dst/b' },
  ];

  /** A disk made of a Map, and a log of what was done to it, in order. */
  function fakeDisk(
    initial,
    copy = (bytes, from, to, disk) => disk.set(to, bytes)
  ) {
    const disk = new Map(Object.entries(initial));
    const log = [];
    const io = {
      exists: (file) => disk.has(file),
      same: (a, b) => disk.get(a) === disk.get(b),
      copy: (from, to) => {
        log.push(`copy ${from}`);
        copy(disk.get(from), from, to, disk);
      },
      remove: () => log.push('remove'),
    };
    return { disk, log, io };
  }
  const SOURCES = { 'src/a': 'brief', 'src/b': 'ledger' };

  it('removes once, after every record is copied and compared', () => {
    const { disk, log, io } = fakeDisk(SOURCES);
    copyThenRemove(pairs, io);
    expect(log).toEqual(['copy src/a', 'copy src/b', 'remove']);
    expect(disk.get('dst/b')).toBe('ledger');
  });

  it('removes nothing when a copy does not match its source', () => {
    // A copy that "worked" and left other bytes: a full disk, a bad filesystem.
    const { log, io } = fakeDisk(SOURCES, (bytes, from, to, disk) => {
      disk.set(to, from === 'src/b' ? bytes.slice(0, 3) : bytes);
    });
    expect(() => copyThenRemove(pairs, io)).toThrow(
      'the copy of G71/gates.jsonl differs'
    );
    expect(log).toEqual(['copy src/a', 'copy src/b']);
  });

  it('removes nothing when a later copy fails', () => {
    const { disk, log, io } = fakeDisk(SOURCES, (bytes, from, to, target) => {
      if (from === 'src/b') throw new Error('ENOSPC');
      target.set(to, bytes);
    });
    expect(() => copyThenRemove(pairs, io)).toThrow('ENOSPC');
    expect(log).toEqual(['copy src/a', 'copy src/b']);
    expect(disk.get('dst/a')).toBe('brief');
  });

  it('copies nothing over an archived file that differs', () => {
    const { disk, log, io } = fakeDisk({ ...SOURCES, 'dst/b': 'an earlier' });
    expect(() => copyThenRemove(pairs, io)).toThrow(
      'the archive already holds a different G71/gates.jsonl'
    );
    expect(log).toEqual([]);
    expect(disk.has('dst/a')).toBe(false);
  });

  it('accepts an archived file that is already the same', () => {
    const { log, io } = fakeDisk({ ...SOURCES, 'dst/b': 'ledger' });
    copyThenRemove(pairs, io);
    expect(log[log.length - 1]).toBe('remove');
  });
});

describe('renderRecords', () => {
  const row = (task, verdict, ageDays, files = 2) => ({
    task,
    verdict,
    ageDays,
    files,
    reason: 'x',
  });

  it('prints one line a task and says what the next step is', () => {
    const rows = [
      row('G72', 'keep', 3.4),
      row('G71', 'archive', 40.9),
      row('Q5', 'keep', null, 0),
    ];
    expect(renderRecords(rows).split('\n')).toEqual([
      'keep      G72      3 d     2 file(s)  -  x',
      'archive   G71     40 d     2 file(s)  -  x',
      'keep      Q5         -     0 file(s)  -  x',
      '3 task(s) with records, 2 kept, 1 to archive with `--archive`.',
    ]);
  });

  it('says the removal is staged once something was archived', () => {
    const rows = [row('G72', 'keep', 3), row('G71', 'archived', 40)];
    expect(renderRecords(rows)).toContain(
      '2 task(s) with records, 1 kept, 1 archived: removal staged, not committed.'
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
    // One clock for the fixture's dates and for the dates the cases expect.
    const now = Date.now();
    const dayAgo = (days) =>
      new Date(now - days * 86_400_000).toISOString().slice(0, 10);
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'task-records-'))
    );
    cleanup.push(root);
    const repo = path.join(root, 'repo');
    const home = path.join(root, 'home');
    fs.mkdirSync(repo);
    fs.mkdirSync(home);
    /**
     * Every git command is dated, because dates are what the rule reads: a commit's,
     * a merge's, and the reflog entry a fast-forward leaves.
     */
    const git = (args, daysAgo = OLD) => {
      const date = new Date(now - daysAgo * 86_400_000).toISOString();
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
    /** A finished task: a brief and its report. */
    const done = (id, slug) => {
      write(`${id}-${slug}.md`);
      write(`${id}-${slug}.report.md`);
    };
    const commit = (message, daysAgo = OLD) => {
      git(['add', '-A']);
      git(['commit', '-qm', message], daysAgo);
    };
    /** Commits on a new branch `branchDays` ago and brings it to main `mergeDays` ago. */
    const land = (branch, how, branchDays, mergeDays, fill) => {
      git(['checkout', '-q', '-b', branch]);
      fill();
      commit(`${branch} records`, branchDays);
      git(['checkout', '-q', 'main']);
      const merge =
        how === 'ff' ? ['--ff-only'] : ['--no-ff', '-m', `merge ${branch}`];
      git(['merge', '-q', ...merge, branch], mergeDays);
    };
    git(['init', '-q', '-b', 'main']);
    // The fixture must be this repository and no other.
    expect(fs.realpathSync(git(['rev-parse', '--show-toplevel']))).toBe(repo);
    const run = (args = [], { status = 0, env = {}, json = true } = {}) => {
      const result = spawnSync(
        process.execPath,
        [CLI, ...args, ...(json ? ['--json'] : [])],
        { cwd: repo, encoding: 'utf8', env: { ...childEnv(home), ...env } }
      );
      expect({ status: result.status, stderr: result.stderr }).toMatchObject({
        status,
      });
      const rows = {};
      if (json && result.stdout.startsWith('{')) {
        for (const row of JSON.parse(result.stdout).tasks) rows[row.task] = row;
      }
      return { rows, stderr: result.stderr, stdout: result.stdout };
    };
    const tracked = () => git(['ls-files', '--', 'docs/tasks']).split('\n');
    const archive = path.join(home, 'task-archive');
    return {
      root,
      repo,
      archive,
      dayAgo,
      git,
      record,
      write,
      done,
      commit,
      land,
      run,
      tracked,
    };
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

  /** Two old finished tasks, the standing files, and one task per reason to keep. */
  function makeScenario() {
    const repo = makeRepo();
    for (const name of STANDING) repo.write(name);
    for (const [id, slug] of [
      ['S9', 'spike'],
      ['X8', 'remote'],
      ['F3', 'fix'],
      ['Q4', 'notes'],
      ['D6', 'gone'],
      ['D7', 'staged'],
      ['B2', 'old'],
      ['W5', 'elsewhere'],
      ['W6', 'detached'],
      ['L4', 'link'],
      ['N8', 'late'],
    ]) {
      repo.done(id, slug);
    }
    repo.write('B2/failures/run.log');
    // T3 was briefed and reviewed and never handed in.
    repo.write('T3-started.md');
    repo.write('T3-started.review.md');
    // L4 has a record that points out of the task.
    fs.mkdirSync(repo.record('L4'));
    fs.symlinkSync('../STATUS.md', repo.record('L4/pointer.md'));
    repo.commit('old tasks');

    // G71: merged long ago, branch still there. A file and a file of the same name
    // in its folder, which a flattened archive would make one.
    repo.land('task/G71-done', 'no-ff', OLD + 5, OLD, () => {
      repo.done('G71', 'done');
      repo.write('G71.review.md');
      repo.write('G71/G71-done.md', 'the copy in the folder\n');
      repo.write('G71/gates.jsonl', '{"gate":"check"}\n');
      repo.write(
        'G71/shots/a.png',
        Buffer.from([0x89, 0x50, 0x00, 0xff, 0x0a])
      );
    });
    // G72 is new, and N8 is old except for one file in its folder.
    repo.done('G72', 'new');
    repo.write('N8/late.json');
    repo.commit('this week', RECENT);
    // M1 and F2: three weeks on a branch, on main since yesterday.
    repo.land('task/M1-late', 'no-ff', 20, 1, () => repo.done('M1', 'late'));
    repo.land('task/F2-forward', 'ff', 20, 1, () => repo.done('F2', 'forward'));

    // S9: a local branch that never merged. X8: the same, known only from a remote.
    repo.git(['checkout', '-q', '-b', 'task/S9-spike']);
    fs.writeFileSync(path.join(repo.repo, 'prototype.txt'), 'on a branch\n');
    repo.commit('S9 prototype');
    repo.git(['update-ref', 'refs/remotes/origin/task/X8-remote', 'HEAD']);
    repo.git(['checkout', '-q', 'main']);

    // F3: a worktree on its branch with no commits of its own, which reads as merged.
    // W5 and W6: an edit under their records in worktrees that name no task.
    const tree = (name) => path.join(repo.root, name);
    repo.git([
      'worktree',
      'add',
      '-q',
      tree('f3'),
      '-b',
      'task/F3-fix',
      'main',
    ]);
    repo.git([
      'worktree',
      'add',
      '-q',
      tree('other'),
      '-b',
      'feature/x',
      'main',
    ]);
    fs.appendFileSync(
      path.join(tree('other'), 'docs/tasks/W5-elsewhere.md'),
      'an edit in another checkout\n'
    );
    repo.git(['worktree', 'add', '-q', '--detach', tree('det'), 'main']);
    fs.mkdirSync(path.join(tree('det'), 'docs/tasks/W6'));
    fs.writeFileSync(path.join(tree('det'), 'docs/tasks/W6/notes.md'), 'new\n');

    // Here: Q4 is being edited, Q5 exists only as a draft, D6 lost a file nobody
    // staged, D7 has a staged edit, and one of B2's files is already staged for
    // removal, which is how the failure logs left.
    fs.appendFileSync(repo.record('Q4-notes.md'), 'an edit in progress\n');
    repo.write('Q5-draft.md');
    fs.rmSync(repo.record('D6-gone.report.md'));
    fs.appendFileSync(repo.record('D7-staged.md'), 'a staged edit\n');
    repo.git(['add', '--', 'docs/tasks/D7-staged.md']);
    repo.git(['rm', '-q', '--', 'docs/tasks/B2/failures/run.log']);
    return repo;
  }

  it('lists every task with its verdict and never a standing file', () => {
    const repo = makeScenario();
    const before = repo.git(['status', '--porcelain']);
    const { rows, stderr } = repo.run();
    expect(stderr).toBe('');
    expect(Object.keys(rows).sort()).toEqual(
      'B2 D6 D7 F2 F3 G71 G72 L4 M1 N8 Q4 Q5 S9 T3 W5 W6 X8'.split(' ')
    );
    const kept = (reason) => ({ verdict: 'keep', reason });
    expect(rows.G71).toMatchObject({
      verdict: 'archive',
      files: 6,
      reason: `on main since ${repo.dayAgo(OLD)} (main's reflog), no open branch`,
    });
    expect(rows.B2).toMatchObject({ verdict: 'archive', files: 2 });
    expect(rows.G72).toMatchObject(
      kept(`on main since ${repo.dayAgo(RECENT)} (main's reflog), kept 14 days`)
    );
    expect(rows.S9).toMatchObject(kept('task/S9-spike is not merged'));
    expect(rows.X8).toMatchObject(kept('task/X8-remote is not merged'));
    expect(rows.F3).toMatchObject(kept('a worktree is on task/F3-fix'));
    expect(rows.T3).toMatchObject(kept('a brief and no report: not done'));
    expect(rows.L4).toMatchObject(kept('a record is a symbolic link'));
    // One file of N8 is three days old; its first file is forty.
    expect(Math.floor(rows.N8.ageDays)).toBe(RECENT);
    expect(rows.N8.verdict).toBe('keep');

    const here = 'in the worktree on main';
    expect(rows.Q4).toMatchObject(kept(`1 uncommitted path(s) ${here}`));
    expect(rows.Q5).toMatchObject({ ...kept(rows.Q4.reason), files: 0 });
    // A deletion nobody staged and an edit somebody did are both unfinished work.
    expect(rows.D6).toMatchObject(kept(`1 uncommitted path(s) ${here}`));
    expect(rows.D7).toMatchObject(kept(`1 uncommitted path(s) ${here}`));
    expect(rows.W5).toMatchObject(
      kept('1 uncommitted path(s) in the worktree on feature/x')
    );
    expect(rows.W6).toMatchObject(
      kept('1 uncommitted path(s) in the worktree on a detached head')
    );
    // Listing changes nothing.
    expect(repo.git(['status', '--porcelain'])).toBe(before);
    expect(fs.existsSync(repo.archive)).toBe(false);
  });

  it('dates a task from the day it reached main, not from its commits', () => {
    const repo = makeScenario();
    const { rows } = repo.run();
    // Both branches were committed 20 days ago, past the window, and merged yesterday.
    for (const task of ['M1', 'F2']) {
      expect(rows[task].verdict).toBe('keep');
      expect(Math.floor(rows[task].ageDays)).toBe(1);
      expect(rows[task].reason).toContain(`on main since ${repo.dayAgo(1)}`);
    }
    const { stdout } = repo.run([], { json: false });
    expect(stdout).toMatch(
      /^keep +F2 +1 d +2 file\(s\) {2}- {2}on main since \S+ \(main's reflog\), kept 14 days$/m
    );
  });

  it('says so when only the commits can date a fast-forward', () => {
    const repo = makeScenario();
    // A fresh clone, or a reflog that ran out: nothing recorded the fast-forward.
    repo.git(['reflog', 'expire', '--expire=now', '--all']);
    const { rows } = repo.run();
    expect(rows.M1).toMatchObject({
      verdict: 'keep',
      reason: `on main since ${repo.dayAgo(1)} (merge commit), kept 14 days`,
    });
    expect(rows.F2.reason).toBe(
      `on main since ${repo.dayAgo(20)} (commit date, not a merge), no open branch`
    );
  });

  it('archives the old tasks: copied, removed, staged and not committed', () => {
    const repo = makeScenario();
    const head = repo.git(['rev-parse', 'HEAD']);
    const png = fs.readFileSync(repo.record('G71/shots/a.png'));
    const { rows, stderr } = repo.run(['--archive']);
    expect(stderr).toBe('');

    const { archive } = repo;
    expect(rows.G71).toMatchObject({
      verdict: 'archived',
      archived: path.join(archive, 'G71'),
    });
    // Each record keeps its whole path, so the two `G71-done.md` stay two files.
    const archived = (name) =>
      fs.readFileSync(path.join(archive, name), 'utf8');
    expect(archived('G71/G71-done.md')).toBe('G71-done.md\n');
    expect(archived('G71/G71/G71-done.md')).toBe('the copy in the folder\n');
    expect(archived('G71/G71/gates.jsonl')).toBe('{"gate":"check"}\n');
    expect(fs.readFileSync(path.join(archive, 'G71/G71/shots/a.png'))).toEqual(
      png
    );
    expect(fs.readdirSync(path.join(archive, 'G71')).sort()).toEqual([
      'G71',
      'G71-done.md',
      'G71-done.report.md',
      'G71.review.md',
    ]);
    // Only what was archived, and only tracked files: B2's log was already gone.
    expect(fs.readdirSync(archive).sort()).toEqual(['B2', 'G71']);
    expect(fs.readdirSync(path.join(archive, 'B2')).sort()).toEqual([
      'B2-old.md',
      'B2-old.report.md',
    ]);

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

    // Everything else is where it was, the late merges included.
    for (const name of [
      ...STANDING,
      'G72-new.md',
      'M1-late.md',
      'F2-forward.report.md',
      'S9-spike.md',
      'T3-started.md',
      'L4/pointer.md',
      'N8-late.md',
      'W5-elsewhere.md',
      'Q5-draft.md',
    ]) {
      expect(fs.lstatSync(repo.record(name)).isDirectory()).toBe(false);
    }
    expect(repo.tracked()).toEqual(
      expect.arrayContaining(STANDING.map((name) => `docs/tasks/${name}`))
    );

    // A second run before the commit finds nothing left to do.
    const again = repo.run(['--archive']).rows;
    expect(again.G71).toBeUndefined();
    expect(Object.values(again).filter((row) => row.archived)).toEqual([]);
  });

  it('takes the window from --days, and only a whole number of days', () => {
    const repo = makeScenario();
    expect(repo.run(['--days', '2']).rows.G72.verdict).toBe('archive');
    expect(repo.run(['--days', '60']).rows.G71).toMatchObject({
      verdict: 'keep',
      reason: expect.stringContaining('kept 60 days'),
    });
    // `Number('')` is 0, which read as "archive everything that is not in flight".
    for (const bad of ['', ' ', '0', '-3', '1.5', 'soon', '14d']) {
      const { stderr } = repo.run(['--archive', '--days', bad], { status: 2 });
      expect(stderr).toContain('--days needs a whole number of days');
      expect(stderr).toContain('usage: node scripts/task-records.mjs');
    }
    expect(repo.run(['--days'], { status: 2, json: false }).stderr).toContain(
      'usage:'
    );
    expect(fs.existsSync(repo.archive)).toBe(false);
  });

  it('archives only where HEAD contains main, and warns when it does not', () => {
    const repo = makeRepo();
    repo.done('G71', 'done');
    repo.commit('an old task');
    repo.git(['checkout', '-q', '-b', 'task/K9-stale']);
    repo.git(['checkout', '-q', 'main']);
    repo.done('G72', 'new');
    repo.commit('main moved on', RECENT);
    repo.git(['checkout', '-q', 'task/K9-stale']);

    // From here G71 looks archivable, and what main did since is out of sight.
    const listing = repo.run();
    expect(listing.rows.G71.verdict).toBe('archive');
    expect(listing.stderr).toBe(
      'task-records: HEAD is behind `main`, so a task may be newer than it reads here\n'
    );
    const refused = repo.run(['--archive'], { status: 2 });
    expect(refused.stderr).toContain('HEAD does not contain `main`');
    expect(repo.git(['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(repo.archive)).toBe(false);

    // With main merged in, the same command goes through.
    repo.git(['merge', '-q', '--ff-only', 'main']);
    const { rows, stderr } = repo.run(['--archive']);
    expect(stderr).toBe('');
    expect(rows.G71.verdict).toBe('archived');
  });

  it('reads origin/main where there is no local main', () => {
    const repo = makeRepo();
    repo.done('G71', 'done');
    repo.done('S9', 'spike');
    repo.commit('two old tasks');
    repo.land('task/M1-late', 'no-ff', 20, 1, () => repo.done('M1', 'late'));
    repo.git(['checkout', '-q', '-b', 'task/S9-spike']);
    fs.writeFileSync(path.join(repo.repo, 'prototype.txt'), 'on a branch\n');
    repo.commit('S9 prototype');
    // What a fresh clone on a task branch has: the remote's main and no local one.
    repo.git(['update-ref', 'refs/remotes/origin/main', 'main']);
    repo.git(['checkout', '-q', '-b', 'work', 'main']);
    repo.git(['branch', '-q', '-D', 'main']);

    const { rows, stderr } = repo.run(['--archive']);
    expect(stderr).toBe('');
    expect(rows.G71.verdict).toBe('archived');
    expect(rows.M1).toMatchObject({
      verdict: 'keep',
      reason: `on main since ${repo.dayAgo(1)} (merge commit), kept 14 days`,
    });
    expect(rows.S9).toMatchObject({
      verdict: 'keep',
      reason: 'task/S9-spike is not merged',
    });
  });

  it('needs a main of some kind', () => {
    const repo = makeRepo();
    repo.done('G71', 'done');
    repo.commit('an old task');
    repo.git(['checkout', '-q', '-b', 'work']);
    repo.git(['branch', '-q', '-D', 'main']);
    expect(repo.run([], { status: 2 }).stderr).toContain('with a `main`');
  });

  it('keeps going after one task fails, says which, and exits 1', () => {
    const repo = makeRepo();
    repo.done('B2', 'old');
    repo.done('G71', 'done');
    repo.write('G71/gates.jsonl', 'this round\n');
    repo.done('X8', 'last');
    repo.commit('three old tasks');
    const earlier = path.join(repo.archive, 'G71/G71/gates.jsonl');
    fs.mkdirSync(path.dirname(earlier), { recursive: true });
    fs.writeFileSync(earlier, 'an earlier round\n');

    const { rows, stderr } = repo.run(['--archive'], { status: 1 });
    expect(stderr).toBe(
      'task-records: G71 not archived: the archive already holds a different ' +
        'G71/gates.jsonl\n'
    );
    expect(rows.G71).toMatchObject({ verdict: 'keep', failed: true });
    expect(rows.G71.archived).toBeUndefined();
    // The one before it and the one after it both went.
    expect(rows.B2.verdict).toBe('archived');
    expect(rows.X8.verdict).toBe('archived');
    expect(repo.tracked()).toEqual([
      'docs/tasks/G71-done.md',
      'docs/tasks/G71-done.report.md',
      'docs/tasks/G71/gates.jsonl',
    ]);
    // The earlier file is untouched and nothing was half-copied beside it.
    expect(fs.readFileSync(earlier, 'utf8')).toBe('an earlier round\n');
    expect(fs.readdirSync(path.join(repo.archive, 'G71'))).toEqual(['G71']);
  });

  it('removes nothing of a task whose copy stops half way', () => {
    const repo = makeRepo();
    repo.done('G71', 'done');
    repo.write('G71/gates.jsonl');
    repo.commit('an old task');
    // A file where the task's folder has to go: the brief and the report copy, the
    // ledger cannot.
    fs.mkdirSync(path.join(repo.archive, 'G71'), { recursive: true });
    fs.writeFileSync(path.join(repo.archive, 'G71/G71'), 'in the way\n');

    const { rows, stderr } = repo.run(['--archive'], { status: 1 });
    expect(stderr).toContain('task-records: G71 not archived: ');
    expect(rows.G71.verdict).toBe('keep');
    expect(fs.existsSync(path.join(repo.archive, 'G71/G71-done.md'))).toBe(
      true
    );
    expect(repo.git(['status', '--porcelain'])).toBe('');
    expect(repo.tracked()).toHaveLength(3);
    expect(fs.existsSync(repo.record('G71-done.md'))).toBe(true);
  });

  it('keeps every task when the worktrees cannot be listed', () => {
    const repo = makeRepo();
    repo.done('G71', 'done');
    repo.commit('an old task');
    // A git that fails `worktree list` and is git for everything else.
    const real = spawnSync('which', ['git'], {
      encoding: 'utf8',
    }).stdout.trim();
    const bin = path.join(repo.root, 'fake-bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'git'),
      `#!/bin/sh\nfor arg in "$@"; do\n  [ "$arg" = worktree ] && exit 1\ndone\nexec "${real}" "$@"\n`,
      { mode: 0o755 }
    );
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };

    expect(repo.run().rows.G71.verdict).toBe('archive');
    const { rows } = repo.run(['--archive'], { env });
    expect(rows.G71).toMatchObject({
      verdict: 'keep',
      reason: 'could not read the worktrees',
    });
    expect(repo.git(['status', '--porcelain'])).toBe('');
  });

  it('does not write to the repository when it lists', () => {
    const repo = makeRepo();
    repo.done('G71', 'done');
    repo.commit('an old task');
    // A tracked record whose timestamp no longer matches the index: a plain
    // `git status` would refresh the index and write it back.
    const index = path.join(repo.repo, '.git', 'index');
    const then = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(repo.record('G71-done.md'), then, then);
    fs.utimesSync(index, then, then);

    expect(repo.run().rows.G71.verdict).toBe('archive');
    expect(fs.statSync(index).mtimeMs).toBe(then.getTime());
  });
});
