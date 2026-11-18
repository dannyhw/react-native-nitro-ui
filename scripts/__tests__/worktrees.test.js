import { afterAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  RECENT_ACTIVITY_HOURS,
  classifyWorktree,
  liveLeaseTasks,
  parseWorktreeList,
  renderWorktrees,
  taskOfBranch,
} from '../worktrees-core.mjs';

const REMOVABLE = {
  isMain: false,
  isCurrent: false,
  locked: false,
  missing: false,
  branch: 'task/G24-form',
  leasedTasks: ['X31'],
  busyProcesses: 0,
  dirtyPaths: 0,
  merged: true,
  branchMoved: true,
  idleHours: 30,
};

describe('classifyWorktree', () => {
  it('removes a clean, merged, idle task worktree nobody is using', () => {
    expect(classifyWorktree(REMOVABLE)).toEqual({
      verdict: 'remove',
      reason: 'merged into main, idle 30 h',
    });
  });

  it.each([
    ['the main checkout', { isMain: true }, 'the main checkout'],
    ['the worktree it runs in', { isCurrent: true }, 'running in it'],
    ['a locked worktree', { locked: true }, 'locked'],
    ['a directory that is gone', { missing: true }, 'already gone'],
    [
      'a branch that is not a task',
      { branch: 'feature/dogfood' },
      'not a task branch',
    ],
    ['a detached head', { branch: null }, 'not a task branch'],
    [
      'a live lease for its task',
      { leasedTasks: ['G24'] },
      'G24 holds a live device lease',
    ],
    [
      'a process running in it',
      { busyProcesses: 1 },
      '1 process running in it',
    ],
    [
      'several processes in it',
      { busyProcesses: 3 },
      '3 processes running in it',
    ],
    [
      'an unanswerable process check',
      { busyProcesses: null },
      'could not check for processes',
    ],
    ['uncommitted work', { dirtyPaths: 3 }, '3 uncommitted paths'],
    ['one uncommitted path', { dirtyPaths: 1 }, '1 uncommitted path'],
    ['an unreadable status', { dirtyPaths: null }, 'could not read its status'],
    [
      'a branch that is pushed but not merged',
      { merged: false },
      'not merged into main',
    ],
    [
      'a worktree nothing was committed in',
      { branchMoved: false },
      'no commits of its own yet',
    ],
    ['recent use', { idleHours: 2 }, 'used 2 h ago'],
    ['an unreadable age', { idleHours: null }, 'could not read when'],
  ])('keeps %s', (_name, change, reason) => {
    const result = classifyWorktree({ ...REMOVABLE, ...change });
    expect(result.verdict).toBe('keep');
    expect(result.reason).toContain(reason);
  });

  it('draws the idle line at the constant, not near it', () => {
    expect(
      classifyWorktree({ ...REMOVABLE, idleHours: RECENT_ACTIVITY_HOURS - 0.1 })
        .verdict
    ).toBe('keep');
    expect(
      classifyWorktree({ ...REMOVABLE, idleHours: RECENT_ACTIVITY_HOURS })
        .verdict
    ).toBe('remove');
  });

  it('a lease for another task does not protect this one', () => {
    // The task is compared whole, never by prefix.
    expect(
      classifyWorktree({ ...REMOVABLE, leasedTasks: ['G2', 'G240'] }).verdict
    ).toBe('remove');
  });
});

describe('taskOfBranch', () => {
  it.each([
    ['task/X32-merge', 'X32'],
    ['task/X32-review-debt', 'X32'],
    ['task/F8b-sizing-held-set', 'F8b'],
    ['task/G24', 'G24'],
    ['main', null],
    ['feature/X32-thing', null],
    ['task/notes', null],
    [null, null],
  ])('%s -> %s', (branch, task) => {
    expect(taskOfBranch(branch)).toBe(task);
  });
});

describe('liveLeaseTasks', () => {
  const acquiredAt = 1_800_000_000_000;

  it('counts a lease until its own ttl runs out, and not after', () => {
    const leases = [
      { task: 'X33', acquiredAt, ttlMinutes: 240 },
      { task: 'X32', acquiredAt, ttlMinutes: 10 },
      { acquiredAt, ttlMinutes: 240 },
    ];
    expect(liveLeaseTasks(leases, acquiredAt + 11 * 60_000)).toEqual(['X33']);
    expect(liveLeaseTasks(leases, acquiredAt + 9 * 60_000)).toEqual([
      'X33',
      'X32',
    ]);
    expect(liveLeaseTasks(null, acquiredAt)).toEqual([]);
  });

  it('reads a lease the way the pool does, so a hand-edited one still protects', () => {
    // The pool's rule: an ISO date is a date, a missing ttl is the default one,
    // and a date nobody can read counts as alive.
    const oneHourOn = acquiredAt + 60 * 60_000;
    expect(
      liveLeaseTasks(
        [
          {
            task: 'A1',
            acquiredAt: new Date(acquiredAt).toISOString(),
            ttlMinutes: 240,
          },
          { task: 'A2', acquiredAt },
          { task: 'A3', acquiredAt: 'yesterday-ish', ttlMinutes: 1 },
        ],
        oneHourOn
      )
    ).toEqual(['A1', 'A2', 'A3']);
  });
});

describe('parseWorktreeList', () => {
  it('reads branches, detached heads, locks and missing directories', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /trees/G24',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/task/G24-form',
      'locked agent is running',
      '',
      'worktree /trees/detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    expect(parseWorktreeList(porcelain)).toEqual([
      {
        path: '/repo',
        head: '1111111111111111111111111111111111111111',
        branch: 'main',
        detached: false,
        locked: false,
        missing: false,
        bare: false,
      },
      {
        path: '/trees/G24',
        head: '2222222222222222222222222222222222222222',
        branch: 'task/G24-form',
        detached: false,
        locked: true,
        missing: false,
        bare: false,
      },
      {
        path: '/trees/detached',
        head: '3333333333333333333333333333333333333333',
        branch: null,
        detached: true,
        locked: false,
        missing: true,
        bare: false,
      },
    ]);
  });
});

describe('renderWorktrees', () => {
  it('names the command only when there is something to remove', () => {
    const kept = { path: '/a', branch: 'main', verdict: 'keep', reason: 'x' };
    const gone = {
      path: '/b',
      branch: 'task/G24-form',
      verdict: 'remove',
      reason: 'y',
    };
    expect(renderWorktrees([kept])).toContain('1 worktree(s), none removable.');
    expect(renderWorktrees([kept])).not.toContain('--prune');
    expect(renderWorktrees([kept, gone])).toContain(
      '2 worktree(s), 1 removable: `node scripts/worktrees.mjs --prune`.'
    );
  });
});

/* ------------------------------ the real command ----------------------------- */

describe('worktrees.mjs, end to end', () => {
  const CLI = path.join(process.cwd(), 'scripts', 'worktrees.mjs');
  const cleanup = [];
  const children = [];

  afterAll(() => {
    for (const child of children) child.kill();
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The environment every git call here runs with. `GIT_DIR` and its relatives are
   * inherited and win over `cwd`, so they are removed. The global config is nulled
   * so the host's settings cannot change the fixture.
   */
  function gitEnv(home) {
    const env = { ...process.env };
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

  function makeClone() {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'worktrees-'))
    );
    cleanup.push(root);
    const repo = path.join(root, 'repo');
    const home = path.join(root, 'home');
    fs.mkdirSync(repo);
    fs.mkdirSync(home);
    const env = gitEnv(home);
    const git = (cwd, args) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
      }
      return result.stdout.trim();
    };
    git(repo, ['init', '-q', '-b', 'main']);
    // The fixture must be this repository and no other.
    expect(fs.realpathSync(git(repo, ['rev-parse', '--show-toplevel']))).toBe(
      repo
    );
    fs.writeFileSync(path.join(repo, '.gitignore'), '.gates/\nbuild/\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'base']);
    const tree = (name) => path.join(root, name);
    const add = (name, branch) =>
      git(repo, ['worktree', 'add', '-q', tree(name), '-b', branch, 'main']);
    const commitIn = (name, file) => {
      fs.writeFileSync(path.join(tree(name), file), `${file}\n`);
      git(tree(name), ['add', '-A']);
      git(tree(name), ['commit', '-qm', `add ${file}`]);
    };
    /** Merges with `--no-ff`, from the main checkout. */
    const mergeToMain = (branch) =>
      git(repo, ['merge', '-q', '--no-ff', '-m', `merge ${branch}`, branch]);
    /** Makes a worktree look untouched since the start of the month. */
    const age = (name) => {
      const then = new Date('2026-11-01T00:00:00Z');
      const gitDir = git(tree(name), ['rev-parse', '--absolute-git-dir']);
      const files = ['HEAD', 'index', 'logs/HEAD', 'ORIG_HEAD'].map((file) =>
        path.join(gitDir, file)
      );
      files.push(tree(name));
      const gates = path.join(tree(name), '.gates');
      if (fs.existsSync(gates)) {
        files.push(gates);
        for (const entry of fs.readdirSync(gates, { recursive: true })) {
          files.push(path.join(gates, String(entry)));
        }
      }
      for (const file of files) {
        if (fs.existsSync(file)) fs.utimesSync(file, then, then);
      }
    };
    const run = (args = []) => {
      const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
        cwd: repo,
        encoding: 'utf8',
        env,
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      const byBranch = {};
      for (const row of JSON.parse(result.stdout).worktrees) {
        byBranch[row.branch ?? '(detached)'] = row;
      }
      return byBranch;
    };
    return {
      root,
      repo,
      home,
      env,
      git,
      tree,
      add,
      commitIn,
      mergeToMain,
      age,
      run,
    };
  }

  it('removes a merged task worktree, keeps its branch and its gate records', () => {
    const clone = makeClone();
    clone.add('done', 'task/G71-done');
    clone.commitIn('done', 'feature.txt');
    clone.mergeToMain('task/G71-done');
    // What a finished task leaves behind: an ignored build and its gate records.
    fs.mkdirSync(path.join(clone.tree('done'), 'build'));
    fs.writeFileSync(path.join(clone.tree('done'), 'build', 'app.bin'), 'x');
    const gates = path.join(clone.tree('done'), '.gates');
    fs.mkdirSync(path.join(gates, 'task'), { recursive: true });
    fs.mkdirSync(path.join(gates, 'logs'), { recursive: true });
    fs.writeFileSync(
      path.join(gates, 'task', 'G71-done.jsonl'),
      '{"gate":"check"}\n'
    );
    fs.writeFileSync(path.join(gates, 'check-steps.json'), '{"steps":[]}\n');
    fs.writeFileSync(
      path.join(gates, 'logs', 'check.log'),
      'in the shared store too\n'
    );
    // Reflogs expire. A merged task must stay recognisable without one.
    clone.git(clone.repo, [
      'reflog',
      'expire',
      '--expire=now',
      'refs/heads/task/G71-done',
    ]);
    expect(
      clone.git(clone.repo, ['reflog', 'show', 'refs/heads/task/G71-done'])
    ).toBe('');
    clone.age('done');

    // Listing must not make the worktree look used: a `git status` that rewrites
    // the index moves the index's mtime, which is the clock.
    expect(clone.run()['task/G71-done'].verdict).toBe('remove');
    expect(clone.run()['task/G71-done']).toMatchObject({
      verdict: 'remove',
      reason: expect.stringContaining('merged into main, idle'),
    });

    const pruned = clone.run(['--prune']);
    expect(pruned['task/G71-done'].removed).toBe(true);
    expect(fs.existsSync(clone.tree('done'))).toBe(false);
    expect(
      clone.git(clone.repo, ['branch', '--list', 'task/G71-done'])
    ).toContain('task/G71-done');
    const archive = path.join(clone.home, 'gate-archive');
    const [saved] = fs.readdirSync(archive);
    expect(saved.startsWith('task_G71-done-')).toBe(true);
    expect(
      fs.readFileSync(
        path.join(archive, saved, 'task', 'G71-done.jsonl'),
        'utf8'
      )
    ).toBe('{"gate":"check"}\n');
    expect(fs.existsSync(path.join(archive, saved, 'check-steps.json'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(archive, saved, 'logs'))).toBe(false);
  });

  it('keeps every worktree that still holds work or belongs to a live task', () => {
    const clone = makeClone();
    // A task that has only just started: nothing committed, so its head is main's.
    clone.add('fresh', 'task/G72-fresh');
    // A task in review: committed and pushed, not merged.
    clone.add('review', 'task/G73-review');
    clone.commitIn('review', 'wip.txt');
    clone.git(clone.repo, [
      'update-ref',
      'refs/remotes/origin/task/G73-review',
      'refs/heads/task/G73-review',
    ]);
    // Merged, but with a file git was told not to show.
    clone.add('hidden', 'task/G74-hidden');
    clone.commitIn('hidden', 'a.txt');
    clone.mergeToMain('task/G74-hidden');
    clone.git(clone.tree('hidden'), [
      'config',
      'status.showUntrackedFiles',
      'no',
    ]);
    fs.writeFileSync(path.join(clone.tree('hidden'), 'unsaved.ts'), 'work');
    // Merged and clean, with a live lease for its task.
    clone.add('leased', 'task/G75-leased');
    clone.commitIn('leased', 'b.txt');
    clone.mergeToMain('task/G75-leased');
    fs.writeFileSync(
      path.join(clone.home, 'leases.json'),
      JSON.stringify({
        leases: [
          { id: 'l1', task: 'G75', acquiredAt: Date.now(), ttlMinutes: 60 },
        ],
      })
    );
    // Merged and clean, but not a task branch.
    clone.add('other', 'feature/dogfood');
    clone.commitIn('other', 'c.txt');
    clone.mergeToMain('feature/dogfood');
    // The just-started task is kept with its reflog and without it.
    clone.git(clone.repo, [
      'reflog',
      'expire',
      '--expire=now',
      'refs/heads/task/G72-fresh',
    ]);
    for (const name of ['fresh', 'review', 'hidden', 'leased', 'other']) {
      clone.age(name);
    }

    const expected = {
      'task/G72-fresh': 'no commits of its own yet',
      'task/G73-review': 'not merged into main',
      'task/G74-hidden': '1 uncommitted path',
      'task/G75-leased': 'G75 holds a live device lease',
      'feature/dogfood': 'not a task branch',
    };
    const listed = clone.run();
    const pruned = clone.run(['--prune']);
    for (const [branch, reason] of Object.entries(expected)) {
      expect({ branch, row: listed[branch] }).toMatchObject({
        branch,
        row: { verdict: 'keep', reason: expect.stringContaining(reason) },
      });
      expect(pruned[branch].removed).toBeUndefined();
    }
    for (const name of ['fresh', 'review', 'hidden', 'leased', 'other']) {
      expect(fs.existsSync(clone.tree(name))).toBe(true);
    }
    expect(
      fs.readFileSync(path.join(clone.tree('hidden'), 'unsaved.ts'), 'utf8')
    ).toBe('work');
  });

  it('removes a merge worktree that was fast-forwarded onto main', () => {
    // A merge done in a worktree leaves its head on main's line. Its reflog is
    // what shows it did work.
    const clone = makeClone();
    clone.add('train', 'task/G79-merge');
    clone.commitIn('train', 'merged.txt');
    clone.git(clone.repo, ['merge', '-q', '--ff-only', 'task/G79-merge']);
    clone.age('train');
    expect(clone.run()['task/G79-merge']).toMatchObject({ verdict: 'remove' });
  });

  it('keeps a merged, clean, idle worktree while a process is running in it', async () => {
    const clone = makeClone();
    clone.add('busy', 'task/G76-busy');
    clone.commitIn('busy', 'd.txt');
    clone.mergeToMain('task/G76-busy');
    clone.age('busy');
    // Removable right now...
    expect(clone.run()['task/G76-busy'].verdict).toBe('remove');
    // ...until something is working in it. A build writes only ignored files, so the
    // process itself is the evidence.
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        cwd: clone.tree('busy'),
        stdio: 'ignore',
      }
    );
    children.push(child);
    await new Promise((resolve) => child.once('spawn', resolve));
    clone.age('busy');

    const listed = clone.run(['--prune']);
    expect(listed['task/G76-busy']).toMatchObject({
      verdict: 'keep',
      reason: '1 process running in it',
    });
    expect(fs.existsSync(clone.tree('busy'))).toBe(true);
    child.kill();
  });

  it('keeps going when one worktree cannot be archived, and says which', () => {
    const clone = makeClone();
    for (const [name, branch] of [
      ['one', 'task/G77-one'],
      ['two', 'task/G78-two'],
    ]) {
      clone.add(name, branch);
      clone.commitIn(name, `${name}.txt`);
      clone.mergeToMain(branch);
      fs.mkdirSync(path.join(clone.tree(name), '.gates'));
      fs.writeFileSync(
        path.join(clone.tree(name), '.gates', 'x.jsonl'),
        '{}\n'
      );
      clone.age(name);
    }
    // The archive's parent is a file, so nothing can be written under it.
    fs.writeFileSync(path.join(clone.home, 'gate-archive'), 'not a directory');

    const pruned = clone.run(['--prune']);
    for (const [name, branch] of [
      ['one', 'task/G77-one'],
      ['two', 'task/G78-two'],
    ]) {
      expect(pruned[branch]).toMatchObject({
        verdict: 'keep',
        reason: expect.stringContaining('gate records could not be saved'),
      });
      expect(fs.existsSync(clone.tree(name))).toBe(true);
    }
  });
});
