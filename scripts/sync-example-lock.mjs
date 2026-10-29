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
 *   node scripts/sync-example-lock.mjs --preflight   # is CocoaPods usable here?
 *   node scripts/sync-example-lock.mjs --fix    # run pod install, keep the lock only
 *
 * `release:version` is `--preflight && changeset version && --fix`, and the first
 * stage is the whole reason `--preflight` is separate. `changeset version` rewrites
 * `package.json`, `CHANGELOG.md` and `.changeset/`, so a refusal *after* it - even a
 * correct one that says `git checkout -- .` - leaves a half-versioned tree on a machine
 * that only wanted to preview a release. Asking the tool question before anything is
 * touched is the only exit that leaves a tree a person can keep. `--fix` asks again
 * anyway, because it can also be called on its own.
 *
 * The refresh itself runs on the job in `.github/workflows/release.yml` that is on a
 * macOS runner, because it runs real CocoaPods. It treats the lock as the only output
 * that matters: whatever else `pod install` regenerates - the app project, a
 * developer's breakpoint list - is put back, because the changesets action commits every
 * changed and untracked non-ignored file in the tree, and a release commit is not where
 * a pod user's local Xcode state belongs. It keeps the lock's own `COCOAPODS:` trailer,
 * and refuses a lock whose diff is bigger than this pod's version and checksum lines, so
 * a runner that resolved something other than the release fails the job instead of
 * committing churn the next `pod install` quietly reverts.
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
 * The checkout to work on.
 *
 * `NITRO_UI_LOCK_SYNC_ROOT` exists for one reason: the `--fix` glue (the restore,
 * the trailer-keep, the churn guard) is otherwise provable only by running a real
 * `pod install` on a Mac, and the bug that started this lived in exactly that glue -
 * a `git` flag that does not exist, which every test stayed green through. With a
 * root override plus `COCOAPODS_BIN`, a test can drive the whole thing in a throwaway
 * git repo. Nothing in the release path sets it.
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
 * Separate from `rootFrom` because `--preflight` needs it and does not want to
 * recompute the path from a repo root it has already resolved elsewhere; the
 * one expression appearing twice is how a preflight and a fix end up asking
 * about different checkouts.
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
 * Failures come back null rather than throwing: `--fix` can be asked for in a tree
 * where git is unhappy, and the *point* of these calls is hygiene. A hygiene step that
 * cannot see the tree says so and leaves the files alone rather than pretending it
 * cleaned them.
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
 * Asks the tool, not the tree: is CocoaPods usable here?
 *
 * One implementation, two callers - `--preflight` (before `changeset version` touches
 * anything) and `--fix` (which can also be called on its own). Both have to give the
 * same answer, or the stage that asks and the stage that acts disagree.
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
 * `--preflight`: the release path's first stage, and the only one that runs before
 * `changeset version` has written anything.
 *
 * Two questions, and they are genuinely different. *Is CocoaPods here* - a
 * Linux contributor previewing a release has no `pod` at all. And *would the
 * CocoaPods that is here write the lock we have*: X13's release runner had
 * CocoaPods 1.17.0, the exact pin, and still rewrote 87 of 96 checksums, because
 * the `json` gem under its Ruby serialises an empty array two bytes differently
 * (`pod-install-lib.mjs` has the mechanism). A machine can pass the first
 * question and fail the second, and the one that matters is the second.
 *
 * Deliberately blind to whether the two files agree: asking that would make this stage
 * refuse for a reason unrelated to the question, at a point where the tree it would be
 * complaining about is the one at HEAD.
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

  // The X13 question: same CocoaPods version, different `json`, different lock.
  // Asked here because by `--fix` the version has already been bumped, and a
  // refusal there is the half-versioned tree this stage exists to prevent.
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
    // Deliberately no CocoaPods detail in the default mode's output: the CLI test
    // below asserts the check mode never reaches for the tool, and a line naming
    // `pod` is exactly what would make that assertion vacuous.
    say('checking only; pass --fix to refresh the lock.');
    return 1;
  }

  // Refuse before touching a thing. `changeset version` has already run by the time
  // the release path calls this, so anything this script changes is on top of an
  // already-versioned tree - and on a machine with no CocoaPods, letting `pod install`
  // discover that leaves the contributor with a half-applied version and no lock.
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

  // The same second question `--preflight` asks, because `--fix` is also callable on
  // its own and has to give the same answer as the stage that asked for it. Here it
  // is worth refusing over: the tree is already bumped, but a refresh that rewrites
  // 87 checksums is worse than a refusal - the changesets action commits whatever is
  // in the tree, and that lock would be reverted by the next maintainer's install.
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

  const status = installPods({ dir: iosDir, log, strict: true, env }).status;
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

  // The refresh is only allowed to move this pod's version and checksum. Anything
  // else in the diff means the runner resolved something other than the release, and
  // committing it green is how item 2's own bug comes back.
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
