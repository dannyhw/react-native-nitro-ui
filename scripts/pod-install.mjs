#!/usr/bin/env node
/**
 * The one CocoaPods entry point for this repo. It runs the CocoaPods version the
 * lock records when this machine has it, and otherwise never leaves a diff that
 * is only the lock's `COCOAPODS: <version>` trailer.
 *
 * Usage:
 *
 *   node scripts/pod-install.mjs                     # example/ios
 *   node scripts/pod-install.mjs --dir bench/ios
 *   COCOAPODS_BIN='bundle exec pod' node scripts/pod-install.mjs --dir <app>/ios
 *
 * Search order: `$COCOAPODS_BIN` (may hold a multi-word command), then
 * `pod _<pinned>_`, then `bundle exec pod` when a Gemfile resolves, then plain
 * `pod` with a printed warning.
 *
 * Before the install, the RN prebuild/codegen/profiling variables are pinned to
 * the values `example/ios/Podfile.lock` resolves with (a variable the caller
 * has set is kept and named), and `pod ipc spec` is asked whether this Ruby's
 * `json` writes empty arrays the way the committed lock's checksums were
 * written: a warning normally, a refusal under `strict`.
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
 * How long a probe may take before it is answered "unknown". A real
 * `pod ipc spec` takes under a second; the room is for a first-run
 * `pod repo update` or a cold RubyGems.
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
 * answer. `pod ipc spec` writes nothing and makes the same `to_pretty_json`
 * call that produces the podspec JSON every `SPEC CHECKSUMS` entry hashes.
 *
 * It runs with `cwd` set to the directory the install will run in, because a
 * Gemfile or `.ruby-version` there decides which Ruby, and so which `json`,
 * answers.
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
        // stdin is closed so a `pod` that wants to prompt cannot hang the probe.
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    // Non-zero is "could not ask": a `pod` that errors halfway can still put a
    // partial spec on stdout.
    if (result.status !== 0) return null;
    return emptyArrayStyleOf(result.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Which CocoaPods would install this directory, and the version the lock pins.
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
 * Whether `dir` is this repo's `example/ios`, the one lock whose checksums the
 * repo commits. Resolved paths are compared, so a generated app's `ios`
 * directory is not governed.
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
 *   write the committed lock's checksums, instead of only warning.
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string | null} [options.serialStyle] the style a caller has already
 *   probed for this same `dir`. `undefined` means nobody has asked yet and this
 *   function must.
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

  // The `json` gem check, for the one lock this repo can make a claim about.
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
    // A pod version this machine does not have is a warning, not a stop.
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
