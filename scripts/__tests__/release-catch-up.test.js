// Gate for scripts/release-catch-up.mjs, which makes the `vX.Y.Z` tag and the
// GitHub release once a version has been approved and is live on npm (DECISIONS
// D28). npm, GitHub and git are mocked here, so the whole decision tree runs in
// process — including the property the hourly schedule depends on: running the
// job again, or after it already worked, changes nothing.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  changelogEntry,
  findVersionCommit,
  runCatchUp,
} from '../release-catch-up.mjs';

const NAME = 'react-native-nitro-ui';
const REPO = 'dannyhw/react-native-nitro-ui';

const FILES = {
  'package.json': JSON.stringify({ name: NAME, version: '0.1.1' }),
  'CHANGELOG.md': [
    '# Changelog',
    '',
    '## 0.1.1',
    '',
    '### Patch Changes',
    '',
    '- a8b0702: Fix the sizing flush request.',
    '',
    '## 0.1.0 — 2026-10-26',
    '',
    'First release.',
    '',
  ].join('\n'),
};

/**
 * The outside world: whether the registry has the version, which releases
 * already exist, and what `package.json` said at each commit in its history
 * (newest first). Every command it is asked to run is recorded, and anything it
 * does not know about fails the test rather than coming back empty.
 */
function world({
  live = true,
  releases = [],
  history = [
    ['c3', '0.1.2'],
    ['c2', '0.1.1'],
    ['c1', '0.1.0'],
  ],
} = {}) {
  const calls = [];
  const existing = new Set(releases);

  const exec = ([command, args]) => {
    calls.push([command, ...args]);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    const fail = (stderr) => ({ code: 1, stdout: '', stderr });

    if (command === 'npm' && args[0] === 'view') {
      return live
        ? ok(`${args[1].split('@').pop()}\n`)
        : fail('npm error code E404');
    }
    if (command === 'gh' && args[0] === 'release' && args[1] === 'view') {
      return existing.has(args[2]) ? ok('{}') : fail('gh: HTTP 404');
    }
    if (command === 'gh' && args[0] === 'release' && args[1] === 'create') {
      existing.add(args[2]);
      return ok('https://github.com/x');
    }
    if (command === 'git' && args[0] === 'log') {
      return ok(`${history.map(([sha]) => sha).join('\n')}\n`);
    }
    if (command === 'git' && args[0] === 'show') {
      const [sha, file] = args[1].split(':');
      const entry = history.find(([value]) => value === sha);
      if (!entry || file !== 'package.json') {
        return fail(`fatal: no ${file} at ${sha}`);
      }
      return ok(JSON.stringify({ name: NAME, version: entry[1] }));
    }
    throw new Error(`unexpected command: ${[command, ...args].join(' ')}`);
  };

  return {
    calls,
    exec,
    existing,
    creates: () => calls.filter((c) => c[2] === 'create' && c[1] === 'release'),
  };
}

function harness(w) {
  return {
    env: { GITHUB_REPOSITORY: REPO },
    exec: w.exec,
    log: () => {},
    read: (relative) => FILES[relative],
  };
}

describe('release catch-up', () => {
  it('waits while the version is only staged, and does not touch GitHub', async () => {
    const w = world({ live: false });
    await expect(runCatchUp(harness(w))).resolves.toEqual({
      action: 'skip',
      reason: 'not-live',
      tag: 'v0.1.1',
      version: '0.1.1',
    });
    expect(w.calls.filter((call) => call[0] === 'gh')).toEqual([]);
  });

  it('leaves an existing release alone', async () => {
    const w = world({ releases: ['v0.1.1'] });
    await expect(runCatchUp(harness(w))).resolves.toMatchObject({
      action: 'skip',
      reason: 'release-exists',
    });
    expect(w.creates()).toEqual([]);
  });

  it('creates the tag at the commit that bumped the version, with changelog notes', async () => {
    const w = world();
    await expect(runCatchUp(harness(w))).resolves.toMatchObject({
      action: 'released',
      tag: 'v0.1.1',
      sha: 'c2',
    });
    // The newest commit is 0.1.2, so the walk has to pass it over: the tag
    // belongs on the commit that set 0.1.1.
    expect(w.creates()).toEqual([
      [
        'gh',
        'release',
        'create',
        'v0.1.1',
        '--repo',
        REPO,
        '--target',
        'c2',
        '--title',
        `${NAME} 0.1.1`,
        '--notes',
        changelogEntry(FILES['CHANGELOG.md'], '0.1.1'),
      ],
    ]);
  });

  it('changes nothing when it runs twice, which is what the schedule needs', async () => {
    const w = world();
    // The hourly run, then the same job an hour later, then a manual re-run.
    await runCatchUp(harness(w));
    await runCatchUp(harness(w));
    await runCatchUp({ ...harness(w), dryRun: true });

    expect(w.creates()).toHaveLength(1);
    expect(w.existing).toEqual(new Set(['v0.1.1']));
  });

  it('catches up as soon as the owner approves, from a run that saw nothing', async () => {
    const w = world({ live: false });
    await expect(runCatchUp(harness(w))).resolves.toMatchObject({
      reason: 'not-live',
    });

    // The approval lands; the next scheduled run sees a live version.
    const after = { ...w, exec: w.exec };
    const approved = world({ live: true });
    await expect(runCatchUp(harness(approved))).resolves.toMatchObject({
      action: 'released',
      sha: 'c2',
    });
    expect(after.creates()).toEqual([]);
  });

  it('plans without writing on a dry run', async () => {
    const w = world();
    await expect(
      runCatchUp({ ...harness(w), dryRun: true })
    ).resolves.toMatchObject({ action: 'dry-run', sha: 'c2' });
    expect(w.creates()).toEqual([]);
  });

  it('refuses to guess a target when no commit carries the version', async () => {
    const w = world({ history: [['c1', '0.1.0']] });
    await expect(runCatchUp(harness(w))).rejects.toThrow(
      /refusing to guess a target/
    );
  });

  it('refuses to run where there is no repository to release', async () => {
    const w = world();
    const withoutRepo = { ...harness(w), env: {} };
    await expect(runCatchUp(withoutRepo)).rejects.toThrow(/GITHUB_REPOSITORY/);
    expect(w.existing.size).toBe(0);
  });

  it('reports a failed release rather than shrugging', async () => {
    const w = world();
    const broken = {
      ...harness(w),
      exec: ([command, args]) =>
        command === 'gh' && args[1] === 'create'
          ? { code: 1, stdout: '', stderr: 'gh: HTTP 422' }
          : w.exec([command, args]),
    };
    await expect(runCatchUp(broken)).rejects.toThrow(
      /gh release create failed/
    );
  });
});

describe('changelog lookup', () => {
  it('takes one version section, tolerating the date on hand-written entries', () => {
    // The body is trimmed, so the heading sits directly above the section it
    // starts — markdown renders that the same, and it keeps the blank lines a
    // changelog accumulates at the end of a section out of the release notes.
    expect(changelogEntry(FILES['CHANGELOG.md'], '0.1.1')).toBe(
      '## 0.1.1\n### Patch Changes\n\n- a8b0702: Fix the sizing flush request.'
    );
    expect(changelogEntry(FILES['CHANGELOG.md'], '0.1.0')).toBe(
      '## 0.1.0\nFirst release.'
    );
    expect(changelogEntry(FILES['CHANGELOG.md'], '9.9.9')).toBeNull();
  });

  it('finds the section for the released version in the real changelog', () => {
    const changelog = readFileSync(
      join(resolve(process.cwd()), 'CHANGELOG.md'),
      'utf8'
    );
    expect(changelogEntry(changelog, '0.1.0')).toContain('First release');
  });
});

describe('version commit lookup', () => {
  it('returns the newest commit carrying the version', () => {
    const versions = new Map([
      ['c5', '0.2.0'],
      ['c4', '0.1.1'],
      ['c3', '0.1.1'],
      ['c2', '0.1.0'],
    ]);
    expect(
      findVersionCommit(['c5', 'c4', 'c3', 'c2'], '0.1.1', (sha) =>
        versions.get(sha)
      )
    ).toBe('c4');
    expect(
      findVersionCommit(['c5', 'c4'], '0.3.0', (sha) => versions.get(sha))
    ).toBeNull();
  });
});
