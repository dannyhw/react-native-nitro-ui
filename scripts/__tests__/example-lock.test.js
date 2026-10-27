/**
 * The lockfile must follow the release it belongs to.
 *
 * `example/ios/Podfile.lock` sat on `NitroUi (0.2.0)` through the whole 0.3.x line,
 * so every iOS build rewrote a tracked file: the tree looked dirty forever, and the
 * `app.stamp` a device gate had just recorded was invalidated by the build that
 * produced it. The guard is cheap enough to sit inside `bun run check`, which means
 * it runs on Linux CI where CocoaPods does not exist - so it can only compare the
 * version, and the *repair* has to be a step that runs real CocoaPods.
 *
 * Two traps here are worth the fixtures:
 *
 *   - the lock names the same pod three times, and the other two shapes look like a
 *     version to a careless regex (`- NitroUi (from \`../..\`)` in DEPENDENCIES:).
 *     A guard that reads *that* as the version never fires, which is worse than no
 *     guard: it is a green light nobody earned.
 *   - a refresh that leaves `pod install`'s other writes in the tree publishes them:
 *     the changesets action commits every changed and untracked file it can find.
 */

import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  AMBIGUOUS_LOCK_ENTRY,
  NO_LOCK_ENTRY,
  keepCocoapodsStamp,
  lockSyncProblem,
  lockedVersion,
  readTreeState,
  sideEffectsToUndo,
} from '../example-lock-core.mjs';

const root = resolve(process.cwd());

/**
 * A lock with the four places a real one names this pod.
 *
 * The version is 0.4.1 - not the 0.3.x currently in the repo - so a reader that
 * returned the repo's own version, or a constant, cannot pass.
 */
const LOCK = `PODS:
  - boost (1.84.0)
  - NitroModules (0.32.2):
    - DoubleConversion
  - NitroUi (0.4.1):
    - React-callinvoker
    - React-jsi
    - NitroUi/Core (= 0.4.1)
  - NitroUi/Core (0.4.1):
    - NitroUi
  - React-Core (0.82.1):
    - boost

DEPENDENCIES:
  - NitroUi (from \`../..\`)
  - "react-native-nitro-ui (from \`.\`)"

EXTERNAL SOURCES:
  NitroUi:
    :path: "../.."

SPEC CHECKSUMS:
  NitroUi: 4a89200d3c9d62b351064b022a54cbb9a8bfaf1e
  boost: 8502bfdc46e2804408af2e163049ece181009af4

COCOAPODS: 1.17.0
`;

/** The same lock with one version changed, the way `pod install` writes it. */
const lockAt = (version) =>
  LOCK.replace('- NitroUi (0.4.1):', `- NitroUi (${version}):`);

describe('reading the locked version', () => {
  it('reads the PODS: entry, and nothing else', () => {
    expect(lockedVersion(LOCK)).toBe('0.4.1');
  });

  it('ignores DEPENDENCIES:, EXTERNAL SOURCES: and SPEC CHECKSUMS:', () => {
    // Each of these names `NitroUi` with a parenthesised or colon-terminated suffix.
    // A match that is not scoped to the PODS: section picks one of them up: the
    // ``from `../..` `` reading is the dangerous one, because it is a string that
    // will never equal a version, so the guard would fail on every commit *including*
    // a correct one - or, compared with the same wrong reading, never fire at all.
    const withoutPods = LOCK.replace(/^PODS:$[\s\S]*?^\n/gm, '');
    expect(lockedVersion(withoutPods)).toBe(NO_LOCK_ENTRY);
    // The sub-spec `NitroUi/Core` is a different pod name and must not be read as ours.
    expect(lockedVersion(LOCK, 'NitroUi/Core')).toBe('0.4.1');
  });

  it('stops at the next section header rather than scanning the whole file', () => {
    // A `SPEC REPOS`/`SPEC CHECKSUMS` body is indented too; the header ends the scan.
    const trailing = `${LOCK}  - NitroUi (9.9.9)\n`;
    expect(lockedVersion(trailing)).toBe('0.4.1');
  });

  it('reports no-entry and duplicate-entry as themselves', () => {
    expect(lockedVersion('PODS:\n  - React-Core (0.82.1)\n')).toBe(
      NO_LOCK_ENTRY
    );
    expect(
      lockedVersion('PODS:\n  - NitroUi (0.4.1)\n  - NitroUi (0.4.2)\n')
    ).toBe(AMBIGUOUS_LOCK_ENTRY);
    // No PODS: section at all is not "version 0.0.0".
    expect(lockedVersion('COCOAPODS: 1.17.0\n')).toBe(NO_LOCK_ENTRY);
  });
});

describe('reading the tree well enough to attribute a change', () => {
  /**
   * A throwaway repository, driven by the real git.
   *
   * This is not paranoia about mocking: the bug this catches was a flag that does not
   * exist (`git status --name-only`), which made the reader return null, which the
   * script reported as "git did not answer" while still exiting 0 and leaving a pod
   * user's `.xcode.env.local` in a tree the release job then commits. Only the real
   * binary knows a flag is bogus.
   */
  function scratchRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'nitro-ui-lock-tree-'));
    const at = (args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (r.status !== 0) {
        throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      }
      return r.stdout;
    };
    at(['init', '-q']);
    // No global config assumptions: this repo needs an identity and no signing.
    at(['config', 'user.email', 'test@example.com']);
    at(['config', 'user.name', 'Test']);
    at(['config', 'commit.gpgsign', 'false']);
    mkdirSync(join(dir, 'example/ios'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'example/ios/Podfile.lock'), 'PODS:\n');
    writeFileSync(join(dir, 'example/ios/AppDelegate.swift'), 'a\n');
    writeFileSync(join(dir, 'src/index.ts'), 'b\n');
    writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
    at(['add', '.']);
    at(['commit', '-qm', 'seed']);
    return { dir, at, read: () => readTreeState((args) => at(args)) };
  }

  it('sees an unstaged, a staged and an untracked change, and ignores an ignored file', () => {
    const repo = scratchRepo();
    writeFileSync(join(repo.dir, 'example/ios/AppDelegate.swift'), 'edited\n');
    writeFileSync(join(repo.dir, 'src/index.ts'), 'staged edit\n');
    repo.at(['add', 'src/index.ts']);
    writeFileSync(join(repo.dir, 'example/ios/.xcode.env.local'), 'echo\n');
    writeFileSync(join(repo.dir, 'ignored.txt'), 'nobody\n');

    const state = repo.read();
    expect(state).not.toBeNull();
    expect(state.tracked.sort()).toEqual([
      'example/ios/AppDelegate.swift',
      'src/index.ts',
    ]);
    // The ignored file must not appear: `--exclude-standard` is what stops this
    // command deleting (or reporting) somebody's `Pods/`.
    expect(state.untracked).toEqual(['example/ios/.xcode.env.local']);
  });

  it('reports nothing dirty in a clean tree', () => {
    const repo = scratchRepo();
    expect(repo.read()).toEqual({ tracked: [], untracked: [] });
  });

  it('comes back null when git cannot answer, rather than an empty clean tree', () => {
    // The distinction the caller acts on: "nothing is dirty" and "I could not tell"
    // must not collapse into the same value, because one of them authorises deleting.
    expect(readTreeState(() => null)).toBeNull();
    expect(
      readTreeState((args) => (args[0] === 'status' ? null : 'whatever\n'))
    ).toBeNull();
  });

  it('reads a rename as the file it became', () => {
    const repo = scratchRepo();
    writeFileSync(join(repo.dir, 'example/ios/Renamed.swift'), 'a\n');
    rmSync(join(repo.dir, 'example/ios/AppDelegate.swift'));
    repo.at(['add', '-A']);
    expect(repo.read().tracked).toContain('example/ios/Renamed.swift');
  });
});

describe('the check that runs inside `check`', () => {
  it('says nothing when the lock matches the manifest', () => {
    expect(
      lockSyncProblem({ manifestVersion: '0.4.1', lockText: LOCK })
    ).toBeNull();
  });

  it('fails when they differ, and names the fix', () => {
    const problem = lockSyncProblem({
      manifestVersion: '0.5.0',
      lockText: lockAt('0.4.1'),
    });
    expect(problem).toContain('NitroUi (0.4.1)');
    expect(problem).toContain('0.5.0');
    expect(problem).toContain('node scripts/sync-example-lock.mjs --fix');
    // The other audience: a release whose CI did not refresh it must not be told to
    // install pods on Linux.
    expect(problem).toContain('release.yml');
    expect(problem).toContain('macOS');
  });

  it('fails the same way for a lock it cannot read, with a different instruction', () => {
    const missing = lockSyncProblem({
      manifestVersion: '0.5.0',
      lockText: 'PODS:\n  - React-Core (0.82.1)\n',
    });
    expect(missing).toContain('no `- NitroUi (<version>)` entry');
    expect(missing).not.toContain('while package.json is at');

    const duplicate = lockSyncProblem({
      manifestVersion: '0.5.0',
      lockText: 'PODS:\n  - NitroUi (0.4.1)\n  - NitroUi (0.4.2)\n',
    });
    expect(duplicate).toContain('more than once');

    expect(
      lockSyncProblem({ manifestVersion: '0.5.0', lockText: null })
    ).toContain('does not exist');
  });

  it('does not call a stale lock an absent one', () => {
    // The distinction the reader acts on: "run the sync script" vs "the file is the
    // wrong shape, read the diff".
    const stale = lockSyncProblem({
      manifestVersion: '0.5.0',
      lockText: lockAt('0.4.1'),
    });
    expect(stale).toContain('while package.json is at');
    expect(stale).not.toContain('does not exist');
  });
});

describe('undoing what a lock refresh also wrote', () => {
  const before = {
    tracked: [],
    untracked: [],
  };
  const after = {
    tracked: [
      'example/ios/Podfile.lock',
      'example/ios/NitroUiExample.xcodeproj/project.pbxproj',
      'src/index.ts',
    ],
    untracked: ['example/ios/.xcode.env.local', 'notes.md'],
  };

  it('keeps the lock and restores everything else it touched', () => {
    expect(sideEffectsToUndo({ before, after })).toEqual({
      restore: ['example/ios/NitroUiExample.xcodeproj/project.pbxproj'],
      remove: ['example/ios/.xcode.env.local'],
      leaveAlone: [],
      unknown: false,
    });
  });

  it('never restores outside the example’s iOS directory', () => {
    // A release refresh is not allowed to revert a library source, however it came to
    // be modified: `src/index.ts` is in `after` above and must not be in the output.
    const out = sideEffectsToUndo({ before, after });
    expect(out.restore).not.toContain('src/index.ts');
    expect(out.remove).not.toContain('notes.md');
  });

  it('leaves files that were already dirty, and deletes only new strays', () => {
    const dirty = {
      tracked: ['example/ios/NitroUiExample/AppDelegate.swift'],
      untracked: ['example/ios/scratch.txt'],
    };
    const out = sideEffectsToUndo({
      before: dirty,
      after: {
        tracked: [...dirty.tracked, 'example/ios/Podfile.lock'],
        untracked: [...dirty.untracked, 'example/ios/.xcode.env.local'],
      },
    });
    expect(out.restore).toEqual([]);
    expect(out.leaveAlone).toEqual([
      'example/ios/NitroUiExample/AppDelegate.swift',
    ]);
    // Somebody's scratch file predates the install, so it survives it.
    expect(out.remove).toEqual(['example/ios/.xcode.env.local']);
  });

  it('touches nothing when git did not answer', () => {
    // "I could not tell" must not become "I cleaned it up": deleting an untracked file
    // that predates this run is data loss.
    expect(sideEffectsToUndo({ before: null, after })).toEqual({
      restore: [],
      remove: [],
      leaveAlone: [],
      unknown: true,
    });
  });
});

describe('keeping the CocoaPods trailer out of a release commit', () => {
  it('restores the recorded trailer when the runner wrote a newer one', () => {
    const written = lockAt('0.5.0').replace(
      'COCOAPODS: 1.17.0',
      'COCOAPODS: 1.19.0'
    );
    const kept = keepCocoapodsStamp(written, '1.17.0');
    expect(kept.restored).toBe(true);
    expect(kept.text).toBe(lockAt('0.5.0'));
    expect(kept.from).toBe('1.17.0');
    expect(kept.to).toBe('1.19.0');
  });

  it('leaves the file alone when the trailer already agrees', () => {
    const kept = keepCocoapodsStamp(lockAt('0.5.0'), '1.17.0');
    expect(kept.restored).toBe(false);
    expect(kept.text).toBe(lockAt('0.5.0'));
  });

  it('does not invent a trailer for a lock that had none', () => {
    // Writing one would claim a toolchain nobody chose.
    const noStamp = lockAt('0.5.0').replace('\nCOCOAPODS: 1.17.0\n', '\n');
    expect(keepCocoapodsStamp(noStamp, null)).toEqual({
      text: noStamp,
      restored: false,
      from: null,
      to: null,
    });
    const noNew = keepCocoapodsStamp(noStamp, '1.17.0');
    expect(noNew.restored).toBe(false);
  });
});

/**
 * The CLI, run against this repository.
 *
 * Two things here can only be checked end to end: that `check` mode never reaches for
 * CocoaPods (a Linux runner has none), and that the guard is *green on main* - a
 * guard that ships red is a guard nobody runs. Both are about the real files, so this
 * uses the real tree rather than a copy.
 */
describe('node scripts/sync-example-lock.mjs', () => {
  const script = resolve(root, 'scripts', 'sync-example-lock.mjs');

  const cli = (args = [], env = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      cwd: root,
      timeout: 120_000,
      env: {
        ...process.env,
        // No CocoaPods, on purpose: the default mode must not care.
        COCOAPODS_BIN: '/nonexistent/pod',
        ...env,
      },
    });

  it('passes on the tree as committed, with no CocoaPods needed', () => {
    const out = cli();
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('in step with package.json');
    expect(out.stdout).not.toContain('pod install');
  });

  it('refuses an unknown argument instead of silently checking nothing', () => {
    const out = cli(['--fix-ish']);
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('unknown argument');
  });

  it('is the script `check` runs, and `check` runs it before the expensive steps', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['lock:check']).toBe(
      'node scripts/sync-example-lock.mjs'
    );
    const check = pkg.scripts.check;
    expect(check).toContain('bun run lock:check');
    // A version mismatch costs a string compare, not a ten-minute `prepare`.
    expect(check.indexOf('bun run lock:check')).toBeLessThan(
      check.indexOf('bun run prepare')
    );
  });

  it('is what `changeset version` refreshes the lock with, on the release path', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    // The action runs `version-script` and commits the tree immediately afterwards, so
    // the lock refresh has to be inside that script: a separate step would be
    // committing a tree whose lock is already stale again.
    expect(pkg.scripts['release:version']).toContain(
      'node scripts/sync-example-lock.mjs --fix'
    );
    expect(pkg.scripts['release:version']).toContain('changeset version');
    const release = readFileSync(
      resolve(root, '.github/workflows/release.yml'),
      'utf8'
    );
    // ...and that script needs a macOS runner with CocoaPods, because `--fix` runs the
    // real `pod install`: a path-pod checksum is only reproducible by CocoaPods.
    const version = job(release, 'version');
    expect(version).toMatch(/runs-on: macos-26/);
    expect(version).toMatch(/gem install cocoapods -v/);
    expect(version).toMatch(/version-script: bun run release:version/);
  });
});

/**
 * The body of one job, so a step can be asserted about the job it belongs to.
 *
 * The same helper `changesets.test.js` uses; duplicated rather than imported because
 * a test module is not a library, and the two files assert about different workflows.
 */
function job(workflow, name) {
  const header = `\n  ${name}:\n`;
  const start = workflow.indexOf(header);
  if (start === -1) throw new Error(`the workflow has no "${name}" job`);
  const body = workflow.slice(start + header.length);
  const next = body.search(/\n {2}\S/);
  return next === -1 ? body : body.slice(0, next);
}
