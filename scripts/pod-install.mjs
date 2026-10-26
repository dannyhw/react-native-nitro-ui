#!/usr/bin/env node
/**
 * The one CocoaPods entry point for this repo.
 *
 * `Podfile.lock` ends with a `COCOAPODS: <version>` trailer that `pod install`
 * rewrites to whichever CocoaPods is on `PATH`. R1, C1, G5 and G6 each lost time
 * to that: a machine on 1.15.2 touching a lock committed at 1.17.0 leaves a
 * tracked file dirty for no reason, which makes a dirty-tree check (the bench
 * baseline guard) fire and turns a "restore it before committing" chore into a
 * per-task habit.
 *
 * So: run the version the lock already records when this machine has it, and
 * when it does not, never leave a *version-only* diff behind. A real lock change
 * (a pod version, a checksum) is left exactly as `pod` wrote it - that diff is
 * the point of the file.
 *
 * Usage:
 *
 *   node scripts/pod-install.mjs                     # example/ios
 *   node scripts/pod-install.mjs --dir bench/ios
 *   COCOAPODS_BIN='bundle exec pod' node scripts/pod-install.mjs --dir <app>/ios
 *
 * `COCOAPODS_BIN` wins over the search below and may hold a multi-word command.
 * It is how a caller with its own Gemfile (the React Native template's, say)
 * keeps using the CocoaPods that Gemfile resolves instead of this repo's pin.
 *
 * Search order: `$COCOAPODS_BIN`, then `pod _<pinned>_` (a Ruby gem version -
 * exact, no shell profile involved), then `bundle exec pod` when a Gemfile
 * resolves, then plain `pod` with a printed warning.
 *
 * The stamp rules and the command choice are in `pod-install-lib.mjs` so they
 * are unit-testable; this file is the part that touches a working tree.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  choosePodCommand,
  pinnedCocoapods,
  reconcileCocoapodsStamp,
} from './pod-install-lib.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..'
);

/** The lock a version pin is read from when the target directory has none. */
const REPO_LOCK = path.join(REPO_ROOT, 'example', 'ios', 'Podfile.lock');

/** @param {string[]} cmd */
function probeVersion(cmd) {
  const result = spawnSync(cmd[0], [...cmd.slice(1), '--version'], {
    encoding: 'utf8',
    env: process.env,
  });
  const version = (result.stdout ?? '').trim().split('\n').pop() ?? '';
  // CocoaPods prints just the version; a missing gem version exits non-zero.
  return { ok: result.status === 0 && /^\d+\.\d+/.test(version), version };
}

/**
 * Run `pod install` in `dir`, keeping the recorded CocoaPods stamp.
 *
 * @param {object} options
 * @param {string} options.dir the directory holding the Podfile
 * @param {string[]} [options.args] extra arguments for `pod install`
 * @param {(message: string) => void} [options.log]
 * @returns {{ status: number, stampRepaired: boolean, pod: string[] }}
 */
export function installPods({
  dir,
  args = [],
  log = (m) => process.stdout.write(`${m}\n`),
}) {
  const lockPath = path.join(dir, 'Podfile.lock');
  const before = fs.existsSync(lockPath)
    ? fs.readFileSync(lockPath, 'utf8')
    : null;
  const repoLock = fs.existsSync(REPO_LOCK)
    ? fs.readFileSync(REPO_LOCK, 'utf8')
    : null;
  const pin = pinnedCocoapods({
    targetLockText: before,
    repoLockText: repoLock,
  });

  const gemfileUp = (() => {
    for (let d = path.resolve(dir); ;) {
      if (fs.existsSync(path.join(d, 'Gemfile'))) return true;
      const parent = path.dirname(d);
      if (parent === d) return false;
      d = parent;
    }
  })();

  const { cmd, why } = choosePodCommand({
    pin,
    hasGemfile: gemfileUp,
    override: process.env.COCOAPODS_BIN,
    probe: probeVersion,
  });

  log(
    `pod-install: ${[...cmd, 'install', ...args].join(' ')} in ${dir} (${why})`
  );
  const result = spawnSync(cmd[0], [...cmd.slice(1), 'install', ...args], {
    // A pod version this machine does not have is a warning, not a stop: the
    // smoke tests and the bench app must keep working on a machine that has not
    // been set up to the pinned toolchain.
    stdio: 'inherit',
    cwd: dir,
    env: { ...process.env, CI: process.env.CI ?? '1' },
  });

  let stampRepaired = false;
  if (fs.existsSync(lockPath)) {
    const after = fs.readFileSync(lockPath, 'utf8');
    const relative = path.relative(process.cwd(), lockPath) || lockPath;
    const { text, changed, stampOnly, from, to } = reconcileCocoapodsStamp(
      before,
      after
    );
    if (stampOnly) {
      fs.writeFileSync(lockPath, text);
      stampRepaired = true;
      log(
        `pod-install: restored COCOAPODS: ${from} in ${relative} - this machine` +
          ` ran ${to}, which only changes that trailer.`
      );
    } else if (changed) {
      log(
        `pod-install: ${relative} changed beyond the CocoaPods stamp (ran` +
          ` ${to ?? 'unknown'}${pin == null ? '' : `, recorded ${pin}`}); review` +
          ' the diff.'
      );
    }
  }

  if (pin != null && cmd.length === 1 && cmd[0] === 'pod') {
    log(
      `pod-install: note - CocoaPods on PATH is not ${pin}, the version this` +
        ` repo's Podfile.lock records. Install it (gem install cocoapods -v` +
        ' ${pin}) to keep locks byte-identical across machines.'
    );
  }

  return { status: result.status ?? 1, stampRepaired, pod: cmd };
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const dirIndex = argv.indexOf('--dir');
  if (dirIndex !== -1 && argv[dirIndex + 1] == null) {
    process.stderr.write('pod-install: --dir needs a path\n');
    process.exit(2);
  }
  const dir =
    dirIndex === -1
      ? path.join(REPO_ROOT, 'example', 'ios')
      : path.resolve(argv[dirIndex + 1]);
  const extra =
    dirIndex === -1
      ? argv
      : [...argv.slice(0, dirIndex), ...argv.slice(dirIndex + 2)];
  const { status } = installPods({ dir, args: extra });
  process.exit(status);
}
