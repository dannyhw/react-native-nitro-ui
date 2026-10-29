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
 * Two things happen before the install, both of them about *this machine's
 * CocoaPods* rather than the tree: the RN prebuild/codegen/profiling variables
 * are pinned to the values `example/ios/Podfile.lock` resolves with (a variable
 * the caller has deliberately set is kept and named, never overridden), and
 * `pod ipc spec` is asked to serialise one version-less dependency to find out
 * whether this Ruby's `json` writes empty arrays the way the committed lock's
 * checksums were written. That second one is the reason a release run can fail
 * here at all: see `podSerialisationProblem` in `pod-install-lib.mjs`. It is a
 * warning normally and a refusal under `strict`, which is what the release
 * refresh passes - a developer's `pod install` stays usable on a machine set up
 * some other way.
 *
 * The stamp rules, the environment contract and the command choice are in
 * `pod-install-lib.mjs` so they are unit-testable; this file is the part that
 * touches a working tree.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  SERIALISATION_CANARY_PODSPEC,
  choosePodCommand,
  emptyArrayStyleOf,
  pinnedCocoapods,
  podInstallEnvironment,
  podSerialisationProblem,
  reconcileCocoapodsStamp,
} from './pod-install-lib.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..'
);

/** The lock a version pin is read from when the target directory has none. */
const REPO_LOCK = path.join(REPO_ROOT, 'example', 'ios', 'Podfile.lock');

/**
 * How long a probe may take before it is answered "unknown" rather than waited
 * for (M2/N6): 60 seconds.
 *
 * A real `pod ipc spec` measured 0.3-0.4 s on this machine's CocoaPods, so this
 * is ~150x the answer, and the room is for a first-run `pod repo update` or a
 * cold RubyGems on a busy CI Mac. The number matters because preflight is on
 * the release path, where the alternative to a timeout is the job's own
 * 30-minute limit: a `pod` that prompts or a Ruby that hangs would consume all
 * of it with no line saying which step. The other side of the choice is a false
 * refusal, and a false refusal here costs one re-run with a message that names
 * the timeout.
 */
export const PROBE_TIMEOUT_MS = 60_000;

/**
 * @param {string[]} cmd
 * @param {Record<string, string | undefined>} env
 */
function probeVersion(cmd, env) {
  const result = spawnSync(cmd[0], [...cmd.slice(1), '--version'], {
    encoding: 'utf8',
    env,
    timeout: PROBE_TIMEOUT_MS,
  });
  const version = (result.stdout ?? '').trim().split('\n').pop() ?? '';
  // CocoaPods prints just the version; a missing gem version exits non-zero.
  return { ok: result.status === 0 && /^\d+\.\d+/.test(version), version };
}

/**
 * Asks this CocoaPods to serialise one version-less dependency, and reads the
 * answer. `pod ipc spec` costs a third of a second, writes nothing, and needs
 * no project, simulator or network - and it is the *same* `to_pretty_json` call
 * that produces `Pods/Local Podspecs/<Name>.podspec.json`, whose bytes every
 * `SPEC CHECKSUMS` entry hashes. So it answers "would this machine rewrite the
 * lock" by watching the machine do the thing, not by inspecting what it has.
 *
 * It runs with `cwd` set to the directory the install will run in, and only the
 * canary podspec goes in the temp directory (M2). Those are the same decision:
 * a probe measured somewhere else is not measuring this install.
 * `COCOAPODS_BIN='bundle exec pod'` cannot find a Gemfile from a fresh temp
 * directory, so a probe run there reads null on every machine and the release
 * refuses unconditionally on a correctly set-up one; and an rbenv/asdf
 * `.ruby-version` next to the app picks a different Ruby, and so a different
 * `json`, than the global one the probe would have measured. The podspec is
 * passed as an absolute path, so the working directory changes nothing about
 * the question asked - only about which machine answers it.
 *
 * Returns null when the question could not be asked (no such command, a pod
 * that errors, a probe that outlasts PROBE_TIMEOUT_MS), which callers must
 * treat as "unknown", never as "fine".
 *
 * @param {object} options
 * @param {string[]} options.cmd the chosen pod command, e.g. `['pod', '_1.17.0_']`
 * @param {string} options.dir the directory to ask from - the Podfile's own
 * @param {Record<string, string | undefined>} options.env
 * @param {number} [options.timeoutMs] override for PROBE_TIMEOUT_MS, for tests
 * @returns {string | null} the style, or null
 */
export function probeSerialisationStyle({ cmd, dir, env, timeoutMs }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-pod-style-'));
  try {
    const podspec = path.join(tmp, 'NitroUiSerialisationCanary.podspec');
    fs.writeFileSync(podspec, SERIALISATION_CANARY_PODSPEC);
    const result = spawnSync(
      cmd[0],
      [...cmd.slice(1), 'ipc', 'spec', podspec],
      {
        encoding: 'utf8',
        env,
        cwd: dir,
        timeout: timeoutMs ?? PROBE_TIMEOUT_MS,
        // A `pod` that wants to prompt (a plugin, a first-run repo update) would
        // otherwise hang preflight until the job's own limit. stdin is a closed
        // pipe instead, and the timeout is the backstop for whatever still hangs.
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    // Non-zero is "could not ask", whatever it printed: a `pod` that errors
    // halfway can still put a partial spec on stdout, and a partial spec is not
    // evidence about a serialiser.
    if (result.status !== 0) return null;
    return emptyArrayStyleOf(result.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Which CocoaPods would install this directory, and the version the lock pins.
 *
 * Its own function because two callers have to give the same answer: the
 * install below, and `sync-example-lock.mjs --preflight`, which asks whether
 * this machine can write the lock *before* `changeset version` touches the
 * tree. If they resolved the command differently, the stage that asks and the
 * stage that acts could disagree about which Ruby's `json` was measured.
 *
 * @param {object} options
 * @param {string} options.dir the directory holding the Podfile
 * @param {Record<string, string | undefined>} options.env
 * @returns {{ cmd: string[], why: string, pin: string | null }}
 */
export function resolvePodCommand({ dir, env }) {
  const lockPath = path.join(dir, 'Podfile.lock');
  const targetLockText = fs.existsSync(lockPath)
    ? fs.readFileSync(lockPath, 'utf8')
    : null;
  const repoLockText = fs.existsSync(REPO_LOCK)
    ? fs.readFileSync(REPO_LOCK, 'utf8')
    : null;
  const pin = pinnedCocoapods({ targetLockText, repoLockText });

  const hasGemfile = (() => {
    for (let d = path.resolve(dir); ;) {
      if (fs.existsSync(path.join(d, 'Gemfile'))) return true;
      const parent = path.dirname(d);
      if (parent === d) return false;
      d = parent;
    }
  })();

  const { cmd, why } = choosePodCommand({
    pin,
    hasGemfile,
    override: env.COCOAPODS_BIN,
    probe: (probeCmd) => probeVersion(probeCmd, env),
  });
  return { cmd, why, pin };
}

/**
 * Whether the CocoaPods that would install `dir` writes podspecs the way the
 * committed lock's checksums were written.
 *
 * The question `--preflight` asks. It is asked there rather than only inside
 * `installPods` for X9's reason: `release:version` is `--preflight && changeset
 * version && --fix`, and a refusal that only arrives in the last stage leaves a
 * half-versioned tree - `package.json`, `CHANGELOG.md` and `.changeset/` already
 * rewritten - on a machine that only wanted to preview a release.
 *
 * @param {{
 *   dir: string,
 *   env?: Record<string, string | undefined>,
 *   timeoutMs?: number,
 * }} options
 * @returns {{ style: string | null, problem: string | null, cmd: string[] }}
 */
export function podSerialisationCheck({ dir, env = process.env, timeoutMs }) {
  const { cmd } = resolvePodCommand({ dir, env });
  const style = probeSerialisationStyle({ cmd, dir, env, timeoutMs });
  return { style, problem: podSerialisationProblem({ style }), cmd };
}

/**
 * Whether an install in `dir` is the one this repo's lock contract governs.
 *
 * The contract is about one file: `example/ios/Podfile.lock`, the lock whose
 * `SPEC CHECKSUMS` this repo commits and whose byte-compatibility with a
 * maintainer Mac X13 is about. `scripts/smoke/*.sh` calls this same module with
 * `--dir <generated app>/ios`, and that app's lock has never been compared with
 * anything: telling its author "installing here would rewrite
 * `example/ios/Podfile.lock` across almost every pod" is about a file they are
 * not writing (N3). Comparing the resolved paths rather than a directory name
 * is what keeps a `--dir example/ios` from any checkout, including a scratch
 * copy of this repo, reading as the governed install it is.
 *
 * @param {string} dir the directory holding the Podfile
 */
function governsLockHere(dir) {
  try {
    return (
      fs.realpathSync(path.join(dir, 'Podfile.lock')) ===
      fs.realpathSync(REPO_LOCK)
    );
  } catch {
    // No lock on either side: there is nothing to be compatible with.
    return false;
  }
}

/**
 * Run `pod install` in `dir`, keeping the recorded CocoaPods stamp.
 *
 * @param {object} options
 * @param {string} options.dir the directory holding the Podfile
 * @param {string[]} [options.args] extra arguments for `pod install`
 * @param {(message: string) => void} [options.log]
 * @param {(message: string) => void} [options.error]
 * @param {boolean} [options.strict] refuse an install whose machine cannot
 *   write the committed lock's checksums, instead of producing one and letting
 *   a guard downstream notice. The release refresh wants this; a developer's
 *   `pod install` does not, because it must stay usable on a machine set up
 *   some other way.
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string | null} [options.serialStyle] the style a caller has already
 *   probed for this same `dir` (N6). `--fix` asks in order to refuse before it
 *   touches the tree, and asking again here would spend the same third of a
 *   second a second time and, worse, could measure a *different* answer if
 *   something about the environment moved in between - which would mean acting
 *   on the second one while having refused on the first. `undefined` means
 *   nobody has asked yet and this function must.
 * @returns {{ status: number, stampRepaired: boolean, pod: string[] }}
 */
export function installPods({
  dir,
  args = [],
  log = (m) => process.stdout.write(`${m}\n`),
  error = (m) => process.stderr.write(`${m}\n`),
  strict = false,
  serialStyle,
  env = process.env,
}) {
  const lockPath = path.join(dir, 'Podfile.lock');
  const before = fs.existsSync(lockPath)
    ? fs.readFileSync(lockPath, 'utf8')
    : null;
  const { cmd, why, pin } = resolvePodCommand({ dir, env });
  const governed = governsLockHere(dir);

  const { env: installEnv, pinned, deviations } = podInstallEnvironment(env);

  if (pinned.length > 0) {
    log(
      `pod-install: pinned ${pinned.join(', ')} - the values ` +
        (governed
          ? `'${path.relative(process.cwd(), lockPath) || lockPath}' resolves ` +
            'with. Unset here, so React Native would have chosen the same thing; ' +
            'stated so CI and a laptop cannot drift apart.'
          : "React Native's own defaults when these are unset, so the install is " +
            'not at the mercy of a shell profile.')
    );
  }
  for (const deviation of deviations) {
    const expected =
      deviation.expected == null ? 'unset' : `set to ${deviation.expected}`;
    // `NAME=` is what the environment really holds, but printed as
    // `NAME= is in your environment` it reads like a bug in this message.
    const held =
      deviation.value === ''
        ? `${deviation.name}=<set but empty>`
        : `${deviation.name}=${deviation.value}`;
    log(
      `pod-install: ${held} is in your ` +
        `environment and ${
          governed
            ? 'this repo’s lock is resolved with it'
            : 'this repo’s contract has it'
        } ${expected} - kept, ` +
        `because you set it. ${deviation.why}\n` +
        '  Expect a large Podfile.lock diff, and do not commit it on a release.'
    );
  }

  // The json-gem check, for the one lock this repo can make a claim about. See
  // pod-install-lib.mjs for why an empty array's whitespace is a release
  // blocker; this is the part that finds out, here, before anything is written.
  if (governed) {
    const style =
      serialStyle === undefined
        ? probeSerialisationStyle({ cmd, dir, env: installEnv })
        : serialStyle;
    const serialisation = podSerialisationProblem({ style });
    if (serialisation != null) {
      const message = `pod-install: ${serialisation}`;
      if (strict) {
        error(message);
        return { status: 1, stampRepaired: false, pod: cmd };
      }
      log(message);
    }
  }

  log(
    `pod-install: ${[...cmd, 'install', ...args].join(' ')} in ${dir} (${why})`
  );
  const result = spawnSync(cmd[0], [...cmd.slice(1), 'install', ...args], {
    // A pod version this machine does not have is a warning, not a stop: the
    // smoke tests and the bench app must keep working on a machine that has not
    // been set up to the pinned toolchain.
    stdio: 'inherit',
    cwd: dir,
    env: { ...installEnv, CI: installEnv.CI ?? '1' },
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
