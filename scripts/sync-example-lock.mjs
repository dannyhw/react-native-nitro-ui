#!/usr/bin/env node
/**
 * Keeps `example/ios/Podfile.lock` in step with `package.json`'s version.
 *
 * Usage:
 *
 *   node scripts/sync-example-lock.mjs          # check only (what `check` runs)
 *   node scripts/sync-example-lock.mjs --preflight   # is CocoaPods usable here?
 *   node scripts/sync-example-lock.mjs --fix    # run pod install, keep the lock only
 *
 * `--preflight` runs before `changeset version` rewrites anything, so a machine
 * without a usable CocoaPods is refused while the tree is still clean. `--fix`
 * puts back everything `pod install` changed except the lock, keeps the lock's
 * `COCOAPODS:` trailer, and refuses a lock whose diff is bigger than this pod's
 * version and checksum lines.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  cocoaPodsAvailability,
  keepCocoapodsStamp,
  lockChurnProblem,
  lockSyncProblem,
  readTreeState,
  sideEffectsToUndo,
} from './example-lock-core.mjs';
import { installPods, podSerialisationCheck } from './pod-install.mjs';
import { cocoapodsStamp } from './pod-install-lib.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..'
);
const IOS_SCOPE = 'example/ios';
const LOCK_REL = `${IOS_SCOPE}/Podfile.lock`;

/**
 * The checkout to work on. `NITRO_UI_LOCK_SYNC_ROOT` lets a test drive `--fix`
 * in a throwaway git repo; nothing in the release path sets it.
 *
 * @param {Record<string, string | undefined>} env
 */
function rootFrom(env = process.env) {
  const fromEnv = env.NITRO_UI_LOCK_SYNC_ROOT;
  return fromEnv != null && fromEnv.trim() !== ''
    ? path.resolve(fromEnv.trim())
    : REPO_ROOT;
}

/**
 * The directory holding the Podfile, in the checkout `env` points at.
 *
 * @param {Record<string, string | undefined>} env
 */
function iosDirFrom(env) {
  return path.join(rootFrom(env), IOS_SCOPE);
}

/** @param {(message: string) => void} log */
function makeSay(log) {
  return (/** @type {string} */ message) => log(`example-lock: ${message}`);
}

/**
 * A git runner for one checkout: returns stdout, or null when git failed.
 *
 * @param {string} cwd
 */
function gitRunner(cwd) {
  return (/** @type {string[]} */ args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return result.status === 0 ? result.stdout : null;
  };
}

/**
 * Whether CocoaPods is usable here, asked by running the tool.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ok: boolean, why: string}}
 */
function cocoaPodsHere(env) {
  return cocoaPodsAvailability((cmd) => {
    const result = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', env });
    const version = (result.stdout ?? '').trim().split('\n').pop() ?? '';
    return {
      ok: result.status === 0 && /^\d+\.\d+/.test(version),
      version: version.replace(/^v/, ''),
    };
  }, env.COCOAPODS_BIN);
}

/**
 * `--preflight`: the release path's first stage, run before `changeset version`
 * has written anything.
 *
 * Asks whether CocoaPods is here, and whether the one that is here would write
 * the lock we have: the same CocoaPods version can serialise a lock differently
 * under a different `json` gem. It does not ask whether the lock and the
 * manifest agree.
 *
 * @param {{env?: Record<string, string | undefined>, log?: (message: string) => void, error?: (message: string) => void}} [options]
 * @returns {number} process exit code
 */
export function preflight({
  env = process.env,
  log = (message) => process.stdout.write(`${message}\n`),
  error = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const refusal = (detail) => {
    error(
      `example-lock: refusing to start a version bump: ${detail}\n` +
        '  Nothing has been changed. `bun run release:version` refreshes ' +
        `${LOCK_REL} in the same breath as bumping the version, and only CocoaPods ` +
        'can write that lock - so it answers first, rather than leave a half-versioned ' +
        'tree behind.\n' +
        '  Install the CocoaPods the lock records (its COCOAPODS: trailer, or `gem ' +
        'install cocoapods -v <that>`) and run it again. The release job does exactly ' +
        'that, on a macOS runner.'
    );
    return 1;
  };

  const pods = cocoaPodsHere(env);
  if (!pods.ok) return refusal(pods.why);
  makeSay(log)(`CocoaPods is here - ${pods.why}.`);

  const serialisation = podSerialisationCheck({ dir: iosDirFrom(env), env });
  if (serialisation.problem != null) {
    return refusal(serialisation.problem);
  }
  makeSay(log)(
    `CocoaPods serialises podspecs the way ${LOCK_REL} was written.`
  );
  return 0;
}

/**
 * @param {{fix?: boolean, env?: Record<string, string | undefined>, log?: (message: string) => void, error?: (message: string) => void}} options
 * @returns {number} process exit code
 */
export function run({
  fix = false,
  env = process.env,
  log = (message) => process.stdout.write(`${message}\n`),
  error = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const root = rootFrom(env);
  const iosDir = path.join(root, IOS_SCOPE);
  const lockPath = path.join(iosDir, 'Podfile.lock');
  const say = makeSay(log);
  const runGit = gitRunner(root);
  const treeState = () => readTreeState(runGit);
  const readLock = () =>
    fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;

  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
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

  log(problem);
  if (!fix) {
    say('checking only; pass --fix to refresh the lock.');
    return 1;
  }

  // Refuse before touching anything: `changeset version` has already run by the
  // time the release path calls this.
  const pods = cocoaPodsAvailability((cmd) => {
    const result = spawnSync(cmd[0], cmd.slice(1), {
      encoding: 'utf8',
      env,
    });
    const version = (result.stdout ?? '').trim().split('\n').pop() ?? '';
    return {
      ok: result.status === 0 && /^\d+\.\d+/.test(version),
      version: version.replace(/^v/, ''),
    };
  }, env.COCOAPODS_BIN);
  if (!pods.ok) {
    error(
      `example-lock: refusing to refresh ${LOCK_REL}: ${pods.why}. The version in ` +
        'this tree has already been bumped by `changeset version`; the lock has not.\n' +
        `  Restore it with:  git checkout -- .\n` +
        '  Or install CocoaPods at the version the lock records (its COCOAPODS: ' +
        'trailer) and run this again. The release job does that on a macOS runner.'
    );
    return 1;
  }

  // `--fix` is also callable on its own, so it asks the serialisation question
  // itself. The release action commits whatever is in the tree.
  const serialisation = podSerialisationCheck({ dir: iosDir, env });
  if (serialisation.problem != null) {
    error(
      `example-lock: refusing to refresh ${LOCK_REL}: ${serialisation.problem}\n` +
        '  The version in this tree has already been bumped by `changeset version`; ' +
        'the lock has not. Restore it with:  git checkout -- .'
    );
    return 1;
  }

  const before = treeState();
  const stampBefore = cocoapodsStamp(lockText);

  const status = installPods({
    dir: iosDir,
    log,
    strict: true,
    // The answer measured just above, so the install cannot act on a different one.
    serialStyle: serialisation.style,
    env,
  }).status;
  if (status !== 0) {
    error(
      `example-lock: pod install exited ${status}, so ${LOCK_REL} was not ` +
        'refreshed.\n' +
        '  Restore the tree with:  git checkout -- .'
    );
    return 1;
  }

  const afterText = readLock();
  if (afterText == null) {
    error(`example-lock: pod install removed ${LOCK_REL}.`);
    return 1;
  }
  const kept = keepCocoapodsStamp(afterText, stampBefore);
  if (kept.restored) {
    fs.writeFileSync(lockPath, kept.text);
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
      runGit(['restore', '--', ...undo.restore]) === null
    ) {
      say(`could not restore ${undo.restore.join(', ')} - read the diff.`);
    }
    for (const file of undo.restore) say(`restored ${file}`);
    for (const file of undo.remove) {
      fs.rmSync(path.join(root, file), { force: true });
      say(`removed untracked ${file} (written by pod install)`);
    }
    for (const file of undo.leaveAlone) {
      say(
        `${file} was already modified before this run and pod install touched it ` +
          'too - left alone.'
      );
    }
  }

  // The refresh is only allowed to move this pod's version and checksum.
  const churn = lockChurnProblem({
    beforeText: lockText,
    afterText: fs.readFileSync(lockPath, 'utf8'),
    lockPath: LOCK_REL,
  });
  if (churn != null) {
    error(`example-lock: ${churn}`);
    return 1;
  }

  const recheck = lockSyncProblem({
    manifestVersion: manifest.version,
    lockText: readLock(),
    lockPath: LOCK_REL,
  });
  if (recheck != null) {
    error(`example-lock: still out of step after pod install:\n${recheck}`);
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
  const KNOWN = ['--fix', '--check', '--preflight'];
  const unknown = argv.filter((arg) => !KNOWN.includes(arg));
  if (unknown.length > 0) {
    process.stderr.write(
      `example-lock: unknown argument(s): ${unknown.join(' ')}\n` +
        'usage: node scripts/sync-example-lock.mjs [--check|--preflight|--fix]\n'
    );
    process.exit(2);
  }
  if (argv.includes('--preflight')) {
    process.exit(preflight({ env: process.env }));
  }
  process.exit(run({ fix: argv.includes('--fix'), env: process.env }));
}
