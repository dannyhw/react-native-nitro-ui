import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
import { CHECK_STEPS } from '../check-steps.mjs';

import { childEnv } from './helpers/scrubbed-env.js';

const root = resolve(process.cwd());

/** The CLI under test, shared by the scratch-repo cases and the real-tree ones. */
const SCRIPT = resolve(root, 'scripts', 'sync-example-lock.mjs');

/**
 * A lock with the four places a real one names this pod. The version is not the
 * repo's own, so a reader that returned that, or a constant, cannot pass.
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

/**
 * What a clean release refresh writes: NitroUi's version, NitroUi's checksum, and
 * the trailer of the machine that ran it. Nothing else.
 */
const CLEAN_REFRESHED_LOCK = lockAt('0.5.0')
  .replace(
    'NitroUi: 4a89200d3c9d62b351064b022a54cbb9a8bfaf1e',
    'NitroUi: af31cfb40ed1503db3c5214526082909d5374acf'
  )
  .replace('COCOAPODS: 1.17.0', 'COCOAPODS: 1.19.0');

/** The same, plus one checksum this pod's release does not explain. */
const CHURNED_REFRESHED_LOCK = CLEAN_REFRESHED_LOCK.replace(
  '  boost: 8502bfdc46e2804408af2e163049ece181009af4',
  '  boost: 8502bfdc46e2804408af2e163049ece181009af4\n  React-Core: 9999999999999999999999999999999999999999'
);

describe('reading the locked version', () => {
  it('reads the PODS: entry, and nothing else', () => {
    expect(lockedVersion(LOCK)).toBe('0.4.1');
  });

  it('ignores DEPENDENCIES:, EXTERNAL SOURCES: and SPEC CHECKSUMS:', () => {
    // Each of these sections names `NitroUi` with a parenthesised or
    // colon-terminated suffix, which a match not scoped to PODS: would pick up.
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
   * A throwaway repository, driven by the real git: only the real binary knows
   * when a flag does not exist.
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
    // The ignored file must not appear: `--exclude-standard` keeps `Pods/` out.
    expect(state.untracked).toEqual(['example/ios/.xcode.env.local']);
  });

  it('reports nothing dirty in a clean tree', () => {
    const repo = scratchRepo();
    expect(repo.read()).toEqual({ tracked: [], untracked: [] });
  });

  it('comes back null when git cannot answer, rather than an empty clean tree', () => {
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
    // A release run must not be told to install pods on Linux.
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
  // The real by-products of an install: `project.pbxproj` is modified every time,
  // and a developer's breakpoint list is untracked and not ignored, so the
  // changesets action would commit it.
  const after = {
    tracked: [
      'example/ios/Podfile.lock',
      'example/ios/NitroUiExample.xcodeproj/project.pbxproj',
      'src/index.ts',
    ],
    untracked: [
      'example/ios/NitroUiExample.xcodeproj/xcdebugger/Breakpoints_v2.xcbkptlist',
      'notes.md',
    ],
  };

  it('keeps the lock and restores everything else it touched', () => {
    expect(sideEffectsToUndo({ before, after })).toEqual({
      restore: ['example/ios/NitroUiExample.xcodeproj/project.pbxproj'],
      remove: [
        'example/ios/NitroUiExample.xcodeproj/xcdebugger/Breakpoints_v2.xcbkptlist',
      ],
      leaveAlone: [],
      unknown: false,
    });
  });

  it('never restores outside the example’s iOS directory', () => {
    // `src/index.ts` is in `after` above and must not be in the output.
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

describe('the two things a refresh must never do', () => {
  /**
   * A scratch checkout, driven by the real git and a fake CocoaPods: a shell
   * script that rewrites the lock the way a real install does (version, checksum,
   * trailer, and some churn).
   */
  function scratchCheckout({ version = '0.4.1' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'nitro-ui-lock-sync-'));
    const at = (args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout;
    };
    at(['init', '-q']);
    at(['config', 'user.email', 'test@example.com']);
    at(['config', 'user.name', 'Test']);
    at(['config', 'commit.gpgsign', 'false']);
    mkdirSync(join(dir, 'example/ios'), { recursive: true });
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    // The CLI under test, copied so it computes its own repo root as this
    // scratch tree.
    for (const name of [
      'sync-example-lock.mjs',
      'example-lock-core.mjs',
      'pod-install.mjs',
      'pod-install-lib.mjs',
    ]) {
      copyFileSync(join(root, 'scripts', name), join(dir, 'scripts', name));
    }
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'react-native-nitro-ui', version: '0.5.0' })
    );
    writeFileSync(join(dir, 'example/ios/Podfile'), '# podfile\n');
    writeFileSync(join(dir, 'example/ios/Podfile.lock'), LOCK);
    // Tracked, and something a real `pod install` does rewrite on this repo (the
    // Podfile's own post_install strips ccache keys out of it).
    writeFileSync(join(dir, 'example/ios/project.pbxproj'), 'PROJECT\n');
    // A developer's breakpoint list: untracked, NOT ignored, so `pod install`
    // leaving it behind means the changesets action commits it.
    writeFileSync(
      join(dir, 'example/ios/Breakpoints_v2.xcbkptlist'),
      'BREAKS\n'
    );
    // Ignored, so it must survive untouched and never be listed as a stray.
    writeFileSync(join(dir, '.gitignore'), 'example/ios/Pods/\n');
    mkdirSync(join(dir, 'example/ios/Pods'), { recursive: true });
    writeFileSync(join(dir, 'example/ios/Pods/something'), 'IGNORED\n');
    at(['add', '.']);
    at(['commit', '-qm', 'seed']);

    // The fake pod: `--version` answers with the pinned version, and `install`
    // copies in a lock that bumps NitroUi's version and checksum, moves the
    // trailer, rewrites the project file and leaves a new stray behind.
    // `FAKE_POD_EXTRA_CHURN` picks the lock with a second pod's checksum changed.
    writeFileSync(join(dir, 'pod-writes-clean.lock'), CLEAN_REFRESHED_LOCK);
    writeFileSync(join(dir, 'pod-writes-churn.lock'), CHURNED_REFRESHED_LOCK);
    const fakePod = join(dir, 'fake-pod.sh');
    writeFileSync(
      fakePod,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "1.17.0"; exit 0; fi
# 'pod ipc spec <file>' is the serialisation probe. It must PRINT and touch
# nothing, the way the real one does, or the hygiene tests below would be
# measuring a fixture that rewrites the tree just to be asked a question.
# FAKE_POD_JSON_STYLE=expanded answers the way a json gem before 2.8.0 does.
if [ "$1" = "ipc" ] && [ "$2" = "spec" ]; then
  # M2: a real "pod ipc spec" answers from wherever it is run, and a
  # "bundle exec pod" can only answer from under the directory holding its
  # Gemfile. So this fixture refuses from anywhere else: that is what turns a
  # probe spawned in a scratch temp directory into "unknown" rather than a
  # quiet pass. $PWD is also where a .ruby-version would be looked up.
  if [ ! -f "$PWD/Podfile" ]; then
    echo "fake-pod: no Podfile in $PWD, cannot answer" >&2
    exit 10
  fi
  printf '%s\n' "$PWD" > "\${FAKE_POD_CWD_RECORD:-/dev/null}"
  # One line per probe asked, so a test can count how many times a single run
  # measures the machine (N6: --fix asks once and passes the answer along).
  printf 'probe\n' >> "\${FAKE_POD_PROBE_LOG:-/dev/null}"
  if [ -n "$FAKE_POD_IPC_FAILS" ]; then
    # N2: an erroring pod that still prints a partial spec. Those bytes look
    # compact; only the exit status says the answer is worthless.
    printf '%s\n' '{' '  "name": "NitroUiSerialisationCanary",' '  "dependencies": {' '    "react-native-nitro-ui": []'
    exit 1
  fi
  if [ "\${FAKE_POD_JSON_STYLE:-compact}" = "expanded" ]; then
    printf '%s\n' '{' '  "name": "NitroUiSerialisationCanary",' '  "dependencies": {' '    "react-native-nitro-ui": [' '' '    ]' '  }' '}'
  else
    printf '%s\n' '{' '  "name": "NitroUiSerialisationCanary",' '  "dependencies": {' '    "react-native-nitro-ui": []' '  }' '}'
  fi
  exit 0
fi
if [ -n "$FAKE_POD_EXTRA_CHURN" ]; then
  src="${dir}/pod-writes-churn.lock"
else
  src="${dir}/pod-writes-clean.lock"
fi
cp "$src" "${dir}/example/ios/Podfile.lock"
echo "REWRITTEN" > "${dir}/example/ios/project.pbxproj"
echo "NEW" > "${dir}/example/ios/new-by-product.txt"
exit 0
`
    );
    chmodSync(fakePod, 0o755);
    // The witness for "did the version bump happen?", used by the release-order test.
    mkdirSync(join(dir, 'bin'), { recursive: true });
    const fakeChangeset = join(dir, 'bin', 'changeset');
    writeFileSync(
      fakeChangeset,
      `#!/bin/sh\nprintf 'changeset %s\\n' "$*" > "${dir}/changeset-ran"\nexit 0\n`
    );
    chmodSync(fakeChangeset, 0o755);
    return {
      dir,
      at,
      fakePod,
      read: (rel) => readFileSync(join(dir, rel), 'utf8'),
      exists: (rel) => existsSync(join(dir, rel)),
      /**
       * What the script left dirty, restricted to the tree it was asked to fix:
       * this test's own fixtures are untracked by design.
       */
      dirty: () =>
        at([
          'status',
          '--porcelain',
          '--',
          'example/ios',
          'package.json',
        ]).trim(),
      status: (args = ['--fix'], env = {}) =>
        spawnSync(process.execPath, [SCRIPT, ...args], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 120_000,
          env: {
            ...process.env,
            NITRO_UI_LOCK_SYNC_ROOT: dir,
            COCOAPODS_BIN: fakePod,
            ...env,
          },
        }),
      /**
       * The same, running the copy of the CLI that lives in this checkout. The
       * copy's `pod-install.mjs` computes its root from its own location, so its
       * serialisation contract applies to this scratch tree's lock.
       */
      statusLocal: (args = ['--fix'], env = {}) =>
        spawnSync(
          process.execPath,
          [
            realpathSync(join(dir, 'scripts', 'sync-example-lock.mjs')),
            ...args,
          ],
          {
            cwd: dir,
            encoding: 'utf8',
            timeout: 120_000,
            env: childEnv({
              NITRO_UI_LOCK_SYNC_ROOT: dir,
              COCOAPODS_BIN: fakePod,
              ...env,
            }),
          }
        ),
      /**
       * Runs a small module against the copied `pod-install.mjs` in this checkout,
       * as a child process: `pod-install.mjs` resolves its repo root from
       * `import.meta.url`, which jest transforms away.
       */
      driver: (source, { env = {}, timeout = 120_000 } = {}) => {
        const file = join(
          dir,
          `driver-${Math.random().toString(36).slice(2)}.mjs`
        );
        writeFileSync(file, source);
        return spawnSync(process.execPath, [file], {
          cwd: dir,
          encoding: 'utf8',
          timeout,
          env: { ...process.env, COCOAPODS_BIN: fakePod, ...env },
        });
      },
      /**
       * Runs a whole `&&` chain, a real `package.json` script, in this checkout.
       * `node` is spelled out as `process.execPath`, and a fake `changeset` on
       * PATH records that it was invoked.
       */
      runRelease: (command, env = {}) =>
        spawnSync(
          'sh',
          ['-c', command.replaceAll('node ', `"${process.execPath}" `)],
          {
            cwd: dir,
            encoding: 'utf8',
            timeout: 180_000,
            env: {
              ...process.env,
              NITRO_UI_LOCK_SYNC_ROOT: dir,
              COCOAPODS_BIN: fakePod,
              PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
              ...env,
            },
          }
        ),
    };
  }

  it('puts the lock right and restores everything else it touched', () => {
    const repo = scratchCheckout();
    const out = repo.status();
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('restored example/ios/project.pbxproj');
    // The trailer the lock recorded, not the one this machine ran.
    expect(repo.read('example/ios/Podfile.lock')).toContain(
      'COCOAPODS: 1.17.0'
    );
    expect(repo.read('example/ios/Podfile.lock')).toContain(
      '- NitroUi (0.5.0):'
    );
    expect(repo.read('example/ios/project.pbxproj')).toBe('PROJECT\n');
    // Both kinds of leftover the changesets action would otherwise commit.
    expect(out.stdout).toContain(
      'removed untracked example/ios/new-by-product'
    );
    expect(repo.exists('example/ios/new-by-product.txt')).toBe(false);
    // ...and nothing outside what this command wrote is touched: the pre-existing
    // breakpoint list and the ignored Pods/ tree both survive.
    expect(repo.read('example/ios/Breakpoints_v2.xcbkptlist')).toBe('BREAKS\n');
    expect(repo.read('example/ios/Pods/something')).toBe('IGNORED\n');
    // The one tracked file left modified is the lock, which is the whole point.
    expect(repo.dirty()).toBe('M example/ios/Podfile.lock');
  });

  it('refuses a lock whose diff is bigger than the release', () => {
    // The same fake pod, but it also rewrote another pod's checksum, as a runner
    // on a different gem set or Xcode would.
    const repo = scratchCheckout();
    const out = repo.status(['--fix'], { FAKE_POD_EXTRA_CHURN: 'churn' });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('changed beyond NitroUi');
    expect(out.stderr).toContain(
      'React-Core: 9999999999999999999999999999999999999999'
    );
  });

  it('asks the probe from the directory the install will run in (M2)', () => {
    // A `COCOAPODS_BIN='bundle exec pod'` can only answer from under the
    // directory holding its Gemfile, and a .ruby-version next to the app selects
    // the Ruby the install will use. The fake pod records $PWD and refuses to
    // answer from a directory with no Podfile.
    const repo = scratchCheckout();
    const recorded = join(repo.dir, 'probe-cwd');
    const { status, stdout } = repo.driver(
      `import { podSerialisationCheck } from './scripts/pod-install.mjs';
const dir = new URL('./example/ios', import.meta.url).pathname;
const { style, cmd } = podSerialisationCheck({ dir });
process.stdout.write('STYLE ' + style + ' CMD ' + cmd.join(' ') + '\\n');
`,
      { env: { FAKE_POD_CWD_RECORD: recorded } }
    );
    expect(status).toBe(0);
    expect(stdout).toContain('STYLE compact');
    // realpath on both sides: a shell sets $PWD through /var -> /private/var.
    expect(realpathSync(readFileSync(recorded, 'utf8').trim())).toBe(
      realpathSync(join(repo.dir, 'example/ios'))
    );
  });

  it('refuses when the probe errors, even though it printed a compact-looking spec (N2)', () => {
    // The fake pod prints a spec that reads as compact and then exits 1, as a
    // `pod` that dies halfway would.
    const repo = scratchCheckout();
    const out = repo.status(['--fix'], { FAKE_POD_IPC_FAILS: '1' });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('could not be read');
    // And not the compact/expanded message, which would say something was measured.
    expect(out.stderr).not.toContain('blank line inside them');
    expect(repo.read('example/ios/Podfile.lock')).toBe(LOCK);
    expect(repo.dirty()).toBe('');
  });

  it('gives up on a probe that hangs rather than waiting for the job (N6)', () => {
    // The pod never exits. The default budget is asserted as an export, and the
    // call below injects a short one so the test does not wait 60 s.
    const repo = scratchCheckout();
    const hang = join(repo.dir, 'hanging-pod.sh');
    // `exec` so the shell is replaced by sleep: spawnSync's timeout signals the
    // direct child, and a sleep left behind as a grandchild would keep the stdout
    // pipe open and hold spawnSync open with it - which is a hang, not a timeout.
    writeFileSync(
      hang,
      '#!/bin/sh\nif [ "$1" = "ipc" ]; then exec sleep 300; fi\nexit 0\n'
    );
    chmodSync(hang, 0o755);
    const start = Date.now();
    const { status, stdout } = repo.driver(
      `import { probeSerialisationStyle, PROBE_TIMEOUT_MS } from './scripts/pod-install.mjs';
const dir = new URL('./example/ios', import.meta.url).pathname;
const style = probeSerialisationStyle({
  cmd: [${JSON.stringify(hang)}],
  dir,
  env: process.env,
  timeoutMs: 1500,
});
process.stdout.write('STYLE ' + style + ' BUDGET ' + PROBE_TIMEOUT_MS + '\\n');
`
    );
    expect(status).toBe(0);
    expect(stdout).toContain('STYLE null');
    expect(stdout).toContain('BUDGET 60000');
    // The lower bound says the probe really waited and was cut off. The upper
    // says it did not wait for the sleep.
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(elapsed).toBeLessThan(30_000);

    // The default is threaded into the spawn, checked at the source because the
    // only other way to see it is to wait 60 s.
    const src = readFileSync(resolve(root, 'scripts/pod-install.mjs'), 'utf8');
    expect(src).toMatch(/timeout: timeoutMs \?\? PROBE_TIMEOUT_MS/);
  });

  it('says nothing about example/ios/Podfile.lock when installing some other app (N3)', () => {
    // scripts/smoke/*.sh installs generated consumer apps through this module,
    // and the serialisation contract is about this repo's lock, not theirs. The
    // scratch tree's copy of pod-install.mjs treats its own
    // example/ios/Podfile.lock as the governed one.
    const repo = scratchCheckout();
    const { status, stdout, stderr } = repo.driver(
      `import { installPods } from './scripts/pod-install.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const dir = new URL('./consumer/ios', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + '/Podfile', '# a generated app\\n');
writeFileSync(dir + '/Podfile.lock', 'PODS:\\n  - SomePod (1.0.0):\\n\\nCOCOAPODS: 1.17.0\\n');
const { status } = installPods({ dir, strict: true });
process.stdout.write('STATUS ' + status + '\\n');
`,
      // An expanded-style pod, which would be refused if the contract applied
      // to this app.
      { env: { FAKE_POD_JSON_STYLE: 'expanded' } }
    );
    expect(status).toBe(0);
    expect(stdout).toContain('STATUS 0');
    expect(stdout + stderr).not.toContain('SPEC CHECKSUMS');
    expect(stdout + stderr).not.toContain('Podfile.lock was written');

    // The control: the same fake pod and style, in the governed directory.
    // Without it, "said nothing" could mean the probe never runs.
    const governedRun = repo.driver(
      `import { installPods } from './scripts/pod-install.mjs';
const dir = new URL('./example/ios', import.meta.url).pathname;
const { status } = installPods({ dir, strict: true });
process.stdout.write('STATUS ' + status + '\\n');
`,
      { env: { FAKE_POD_JSON_STYLE: 'expanded' } }
    );
    expect(governedRun.stdout).toContain('STATUS 1');
    expect(governedRun.stdout + governedRun.stderr).toContain('SPEC CHECKSUMS');
  });

  it('asks the machine once per --fix, not once per stage (N6)', () => {
    // Two probes could disagree, and the run would refuse on one answer and
    // install on the other. The fake pod counts the times it is asked.
    const repo = scratchCheckout();
    const log = join(repo.dir, 'probe-log');
    const out = repo.statusLocal(['--fix'], { FAKE_POD_PROBE_LOG: log });
    expect(out.status).toBe(0);
    process.stderr.write(
      'OUT=' +
        JSON.stringify({
          status: out.status,
          out: out.stdout,
          err: out.stderr,
        }) +
        '\n'
    );
    const asks = readFileSync(log, 'utf8').trim().split('\n');
    expect(asks).toEqual(['probe']);
  });

  it('refuses a refresh on a machine whose json gem would rewrite every checksum', () => {
    // The fake pod answers the serialisation probe the way a `json` gem before
    // 2.8.0 does. Its lock would pass the churn guard, so only the probe can stop
    // it, and the refusal has to name the mechanism.
    const repo = scratchCheckout();
    const out = repo.status(['--fix'], { FAKE_POD_JSON_STYLE: 'expanded' });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('refusing to refresh');
    expect(out.stderr).toContain('blank line inside them');
    expect(out.stderr).toContain('SPEC CHECKSUMS');
    expect(repo.read('example/ios/Podfile.lock')).toBe(LOCK);
    expect(repo.dirty()).toBe('');
  });

  it('refuses at preflight on that machine, before `changeset version` runs', () => {
    // `release:version` asks the serialisation question in `--preflight`, so a
    // runner with the wrong gem leaves no half-versioned tree behind.
    const releaseCommand = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8')
    ).scripts['release:version'];
    const repo = scratchCheckout({ witness: true });
    const out = repo.runRelease(releaseCommand, {
      FAKE_POD_JSON_STYLE: 'expanded',
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain('blank line inside them');
    expect(repo.exists('changeset-ran')).toBe(false);
    expect(repo.read('example/ios/Podfile.lock')).toBe(LOCK);
    expect(repo.dirty()).toBe('');
  });

  it('refuses the install itself when it is asked to be strict', () => {
    // Tested against the module directly: `--fix` and `--preflight` both ask
    // before they reach `installPods`, so its own refusal is not exercised
    // through them.
    const repo = scratchCheckout();
    const driver = join(repo.dir, 'strict-driver.mjs');
    writeFileSync(
      driver,
      `import { installPods } from './scripts/pod-install.mjs';
const { status } = installPods({
  dir: new URL('./example/ios', import.meta.url).pathname,
  strict: true,
  log: () => {},
  error: (m) => process.stdout.write(m + '\\n'),
});
process.stdout.write('STATUS ' + status + '\\n');
`
    );
    const out = spawnSync(process.execPath, [driver], {
      cwd: repo.dir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        COCOAPODS_BIN: repo.fakePod,
        FAKE_POD_JSON_STYLE: 'expanded',
      },
    });
    expect(out.stdout).toContain('STATUS 1');
    expect(out.stdout).toContain('blank line inside them');
    // The fake pod never ran, so the lock is the one that started the test.
    expect(repo.read('example/ios/Podfile.lock')).toBe(LOCK);
  });

  it('refuses up front when CocoaPods is missing, without touching the tree', () => {
    const repo = scratchCheckout();
    const out = repo.status(['--fix'], { COCOAPODS_BIN: '/nonexistent/pod' });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('refusing to refresh');
    expect(out.stderr).toContain('git checkout -- .');
    expect(repo.read('example/ios/Podfile.lock')).toBe(LOCK);
    expect(repo.dirty()).toBe('');
  });

  it('refuses before `changeset version` runs at all, on the real release command', () => {
    // The fake `changeset` on PATH leaves a marker if it is ever invoked, which
    // shows the refusal comes before the version bump.
    const releaseCommand = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8')
    ).scripts['release:version'];

    const withoutPods = scratchCheckout({ witness: true });
    const refused = withoutPods.runRelease(releaseCommand, {
      COCOAPODS_BIN: '/nonexistent/pod',
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('refusing to start a version bump');
    expect(withoutPods.exists('changeset-ran')).toBe(false);
    expect(withoutPods.read('example/ios/Podfile.lock')).toBe(LOCK);
    expect(withoutPods.dirty()).toBe('');

    // The control: the same command with a working CocoaPods gets all the way
    // through.
    const withPods = scratchCheckout({ witness: true });
    const ran = withPods.runRelease(releaseCommand);
    expect(ran.status).toBe(0);
    expect(withPods.exists('changeset-ran')).toBe(true);
    expect(withPods.read('example/ios/Podfile.lock')).toContain(
      '- NitroUi (0.5.0):'
    );
  });
});

/**
 * The CLI, run against this repository: `check` mode must never reach for
 * CocoaPods, and the committed lock must pass.
 */
describe('node scripts/sync-example-lock.mjs', () => {
  const cli = (args = [], env = {}) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
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
    const names = CHECK_STEPS.map((step) => step.name);
    expect(names).toContain('lock:check');
    // `prepare` waits for the cheap check, so a stale lock never starts a build.
    expect(names.indexOf('lock:check')).toBeLessThan(names.indexOf('prepare'));
    const prepare = CHECK_STEPS.find((step) => step.name === 'prepare');
    expect(prepare.needs).toContain('lock:check');
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
 */
function job(workflow, name) {
  const header = `\n  ${name}:\n`;
  const start = workflow.indexOf(header);
  if (start === -1) throw new Error(`the workflow has no "${name}" job`);
  const body = workflow.slice(start + header.length);
  const next = body.search(/\n {2}\S/);
  return next === -1 ? body : body.slice(0, next);
}
