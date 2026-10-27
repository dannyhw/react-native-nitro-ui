#!/usr/bin/env node
/**
 * Keeps `example/ios/Podfile.lock` in step with `package.json`'s version.
 *
 * After the 0.3.x releases the lock still said `NitroUi (0.2.0)`, so every iOS build
 * rewrote it, dirtied the tree, and invalidated the `app.stamp` a device gate had
 * just recorded. The guard has to be cheap enough to sit inside `bun run check` (it
 * reads two files and compares strings), and the repair has to be something a CI
 * runner can actually do - which rules out reproducing the lock by hand: CocoaPods
 * stores a path-pod's `SPEC CHECKSUMS` entry as the sha1 of *its own* evaluation of
 * the podspec (`Pods/Local Podspecs/NitroUi.podspec.json`, gitignored), so the only
 * way to produce a correct post-bump lock is to run CocoaPods. See
 * `scripts/example-lock-core.mjs` for what that means for the guard.
 *
 * Usage:
 *
 *   node scripts/sync-example-lock.mjs          # check only (what `check` runs)
 *   node scripts/sync-example-lock.mjs --fix    # run pod install, keep the lock only
 *
 * `--fix` is the release path's step (`bun run release:version:lock`, on a macOS
 * runner). It treats the lock as the only output that matters: whatever else `pod
 * install` regenerates - the workspace data, the app project, a machine-local
 * `.xcode.env.local` - is put back, because the changesets action commits *everything*
 * in the working tree, and a release commit is not where a pod user's local Xcode
 * state belongs. It also keeps the lock's own `COCOAPODS:` trailer, so a runner on a
 * newer CocoaPods contributes one changed line rather than a toolchain bump nobody
 * reviewed.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  keepCocoapodsStamp,
  lockSyncProblem,
  readTreeState,
  sideEffectsToUndo,
} from './example-lock-core.mjs';
import { installPods } from './pod-install.mjs';
import { cocoapodsStamp } from './pod-install-lib.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..'
);
const IOS_DIR = path.join(REPO_ROOT, 'example', 'ios');
const LOCK_PATH = path.join(IOS_DIR, 'Podfile.lock');
const LOCK_REL = 'example/ios/Podfile.lock';
const IOS_SCOPE = 'example/ios';

/** @param {string} message */
function say(message) {
  process.stdout.write(`example-lock: ${message}\n`);
}

/**
 * Run one git command in the repo and return its stdout.
 *
 * Failures come back null rather than throwing: `--fix` can be asked for in a tree
 * where git is unhappy, and the *point* of these calls is hygiene. A hygiene step that
 * cannot see the tree says so and leaves the files alone rather than pretending it
 * cleaned them.
 *
 * @param {string[]} args
 * @returns {string[] | null}
 */
function git(args) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').filter((line) => line !== '');
}

/** What git says is dirty right now, or null when git did not answer. */
function treeState() {
  return readTreeState((args) => {
    const result = spawnSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return result.status === 0 ? result.stdout : null;
  });
}

/**
 * @param {{fix?: boolean}} options
 * @returns {number} process exit code
 */
export function run({ fix = false } = {}) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
  );
  const readLock = () =>
    fs.existsSync(LOCK_PATH) ? fs.readFileSync(LOCK_PATH, 'utf8') : null;
  const lockText = readLock();
  const problem = lockSyncProblem({
    manifestVersion: manifest.version,
    lockText,
    lockPath: LOCK_REL,
  });

  if (problem == null) {
    say(
      `${LOCK_REL} locks NitroUi (${manifest.version}) - in step with package.json.`
    );
    return 0;
  }

  process.stdout.write(`${problem}\n`);
  if (!fix) {
    say('checking only; pass --fix to run pod install (needs CocoaPods).');
    return 1;
  }

  const before = treeState();
  const stampBefore = cocoapodsStamp(lockText);

  const { status } = installPods({ dir: IOS_DIR });
  if (status !== 0) {
    process.stderr.write(
      `example-lock: pod install exited ${status}, so ${LOCK_REL} was not ` +
        'refreshed. Is CocoaPods installed? (the pinned version is in that file’s ' +
        'COCOAPODS: trailer)\n'
    );
    return 1;
  }

  const afterText = readLock();
  if (afterText == null) {
    process.stderr.write(`example-lock: pod install removed ${LOCK_REL}.\n`);
    return 1;
  }
  const kept = keepCocoapodsStamp(afterText, stampBefore);
  if (kept.restored) {
    fs.writeFileSync(LOCK_PATH, kept.text);
    say(
      `kept COCOAPODS: ${kept.from} (this machine ran ${kept.to}) - a release ` +
        'refresh changes the version line, not the toolchain.'
    );
  }

  // Undo everything the install touched that is not the lock.
  const undo = sideEffectsToUndo({
    before,
    after: treeState() ?? { tracked: [], untracked: [] },
    scope: IOS_SCOPE,
    lockPath: LOCK_REL,
  });
  if (undo.unknown) {
    say(
      'git did not answer, so build by-products were left in place - read the diff ' +
        'before committing.'
    );
  } else {
    if (
      undo.restore.length > 0 &&
      git(['restore', '--', ...undo.restore]) === null
    ) {
      say(`could not restore ${undo.restore.join(', ')} - read the diff.`);
    }
    for (const file of undo.restore) say(`restored ${file}`);
    for (const file of undo.remove) {
      fs.rmSync(path.join(REPO_ROOT, file), { force: true });
      say(`removed untracked ${file} (written by pod install)`);
    }
    for (const file of undo.leaveAlone) {
      say(
        `${file} was already modified before this run and pod install touched it ` +
          'too - left alone.'
      );
    }
  }

  const recheck = lockSyncProblem({
    manifestVersion: manifest.version,
    lockText: readLock(),
    lockPath: LOCK_REL,
  });
  if (recheck != null) {
    process.stderr.write(
      `example-lock: still out of step after pod install:\n${recheck}\n`
    );
    return 1;
  }
  say(`${LOCK_REL} now matches package.json (${manifest.version}).`);
  return 0;
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((arg) => arg !== '--fix' && arg !== '--check');
  if (unknown.length > 0) {
    process.stderr.write(
      `example-lock: unknown argument(s): ${unknown.join(' ')}\n` +
        'usage: node scripts/sync-example-lock.mjs [--check|--fix]\n'
    );
    process.exit(2);
  }
  process.exit(run({ fix: argv.includes('--fix') }));
}
