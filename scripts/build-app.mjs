#!/usr/bin/env node
/**
 * One fresh build of the example app, and the `app.stamp` that proves it.
 *
 *   node scripts/build-app.mjs --platform ios
 *   node scripts/build-app.mjs --platform android [--arch arm64-v8a] [--clean]
 *
 * This is the step `react-native-harness` deliberately does not do, and the two
 * ways it goes wrong are both fixed here (see `scripts/app-stamp-core.mjs`):
 *
 *   1. the artifact is older than the sources, so a green run tests code nobody
 *      wrote - so the build ends by stamping the tree it compiled, and every
 *      device gate refuses when that stamp no longer matches;
 *   2. gradle reports `packageDebug` up-to-date while the dex is missing a
 *      generated hybrid - so the finished APK is inspected per component, and a
 *      missing one re-runs `packageDebug --rerun` instead of trusting the build.
 *
 * Output paths are fixed per worktree (never `~/Library/Developer/Xcode/…`), so
 * a run says which checkout it came from:
 *
 *   ios      example/ios/build            (-derivedDataPath) -> …/Debug-iphonesimulator/NitroUiExample.app
 *   android  example/android/app/build                      -> …/apk/debug/app-debug.apk
 *
 * Both are what `HARNESS_APP_PATH` wants. The stamp is written next to the build
 * directory, and `example/rn-harness.config.mjs` reads it from there, so
 * `bun run harness:ios` needs no environment at all in the usual case.
 *
 * Devices and ports are *not* this script's business: it builds, it does not run
 * anything (AGENTS.md: only touch devices you started).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  StaleAppError,
  artifactPath,
  checkFreshApp,
  colorize,
  currentCodeTree,
  inspectArtifact,
  recordBuild,
  registeredComponents,
  repoRootOf,
  stampPath,
} from './app-stamp.mjs';
import {
  ccacheEnv,
  ccacheRequested,
  ccacheEffectiveForWorktrees,
  decideSkipBuild,
  gradleArchArgs,
  gradleCcacheArgs,
  iosCleanTargets,
  iosModuleCacheArgs,
  POD_INPUTS_RECORD,
  resolveAndroidAbis,
} from './build-speed-lib.mjs';
import {
  DEFAULT_BUILD_WAIT_MINUTES,
  buildSlotState,
  buildTaskName,
  takeBuildSlot,
} from './build-slot-core.mjs';
import { installPods } from './pod-install.mjs';
import { assertSupportedNodeOrReexec } from './node-version.mjs';

/** This checkout, wherever the worktree happens to be. */
const REPO_ROOT = repoRootOf(path.dirname(fileURLToPath(import.meta.url)));

/** Resolved once: ccache is either on this machine or it is not. */
const ccache = ccacheSetup();

const USAGE =
  'usage: node scripts/build-app.mjs --platform ios|android\n' +
  '                                  [--arch <abi[,abi]>] [--clean] [--force] [--no-stamp]\n' +
  '\n' +
  "  --arch   Android ABIs to build. Defaults to this machine's own ABI\n" +
  '           (arm64-v8a on Apple Silicon, x86_64 on Intel), which is what the\n' +
  '           simulator/emulator here runs. NITRO_UI_ANDROID_ARCH does the same\n' +
  '           thing for a whole shell; CI passes x86_64 for its emulators.\n' +
  '  --force  build even when app.stamp already says this tree is built.\n' +
  "  --clean  delete this platform's build state first, and never skip:\n" +
  '             ios     - example/ios/build (DerivedData), plus the record of\n' +
  '                       what the last pod install was shown; Pods/ is kept\n' +
  '             android - example/android/app/build\n' +
  '           (bun run clean is what removes Pods/ and every build directory.)\n' +
  '\n' +
  '  Nothing changed since the last build? The build is skipped and says so.\n' +
  '  ccache, when it is installed, speeds up the C/C++/Objective-C++ compiles\n' +
  '  and shares its cache between worktrees (CONTRIBUTING.md: Build speed).\n' +
  '\n' +
  '  One heavy native build runs at a time per machine: a build waits for its\n' +
  '  slot and prints who is building. The limit is `maxConcurrentBuilds` in\n' +
  '  ~/.nitro-ui/devices.json (default 1); a skipped build takes no slot.';

assertSupportedNodeOrReexec({
  command: 'node scripts/build-app.mjs',
  entryUrl: import.meta.url,
});

function parseArg(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 || index + 1 >= argv.length ? null : argv[index + 1];
}

/**
 * Where ccache is, or null. A scan of `PATH` rather than `command -v` in a shell:
 * this decides whether a build gets a launcher at all, and it must not depend on
 * which shell happens to be configured.
 *
 * @returns {string | null}
 */
function findCcache() {
  const named =
    process.env.CCACHE_PATH ?? process.env.CCACHE_BINARY_PATH ?? null;
  const candidates =
    named != null && named !== ''
      ? [named]
      : (process.env.PATH ?? '')
          .split(path.delimiter)
          .filter((dir) => dir !== '')
          .map((dir) => path.join(dir, 'ccache'));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here; try the next PATH entry.
    }
  }
  return null;
}

/**
 * ccache, if this machine has it. Everything ccache-related is conditional on
 * this one lookup, so a machine without it - a CI runner, a new contributor -
 * builds exactly the way it did before (the no-op the brief asks for).
 */
function ccacheSetup() {
  const binary = ccacheRequested(process.env) ? findCcache() : null;
  if (binary == null) {
    return { enabled: false, binary: null, env: {}, gradleArgs: [] };
  }
  const env = {
    ...ccacheEnv({ enabled: true, repoRoot: REPO_ROOT, binary }),
    // Read by scripts/gradle-ccache.init.gradle: the file is passed with -I
    // only when ccache exists, and it needs the path, not a guess.
    CCACHE_GRADLE_LAUNCHER: binary,
  };
  // ccache ignores an environment variable it does not recognise, so the two
  // settings that make a second worktree a hit are worth reading back once:
  // a wrong name costs every build a cache and says nothing about it.
  const effective = spawnSync(binary, ['--show-config'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (
    effective.status === 0 &&
    !ccacheEffectiveForWorktrees(effective.stdout ?? '')
  ) {
    console.warn(
      'build-app: ccache is missing base_dir/hash_dir - expect a miss in every ' +
        'new worktree (see ccacheEnv in scripts/build-speed-lib.mjs)'
    );
  }
  return {
    enabled: true,
    binary,
    env,
    // The NDK's CMake projects live in `android/` of the published package and
    // in nitro-modules, neither of which this repo may edit for packaging
    // reasons, so the launcher goes in through an init script instead.
    gradleArgs: gradleCcacheArgs({
      enabled: true,
      initScript: path.join(REPO_ROOT, 'scripts', 'gradle-ccache.init.gradle'),
    }),
  };
}

/** The environment every compile in this run sees. */
function buildEnv(extra = {}) {
  return { ...process.env, ...ccache.env, ...extra };
}

function run(command, args, options = {}) {
  const printed = `${command} ${args.join(' ')}`;
  process.stderr.write(`$ ${printed}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error != null) {
    throw new Error(`${printed}: ${String(result.error.message)}`);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `${printed} failed (exit ${String(result.status)})${
        result.signal != null ? ` on signal ${result.signal}` : ''
      }`
    );
  }
  return printed;
}

/** @param {string} dir */
function removeIfPresent(dir, log) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    log(`cleaned ${path.relative(REPO_ROOT, dir)}`);
  } catch (error) {
    throw new Error(
      `--clean could not remove ${dir} (${String(error.message)}). ` +
        'Run `bun run clean`, which deletes every build directory.'
    );
  }
}

/**
 * Where the Pods project records what it was last shown. Inside `Pods/`
 * because that is the thing being kept in step, and gitignored because it is
 * build state. `--clean` deletes it too (see `iosCleanTargets`), which is what
 * makes a clean build mean "show the pods the sources again".
 */
function podInputsFile(iosDir) {
  return path.join(iosDir, 'Pods', POD_INPUTS_RECORD);
}

/** @param {string} file @returns {string | null} */
function readMarker(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** @param {string} file @param {string} value */
function writeMarker(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${value}\n`);
  } catch {
    // A machine that cannot write its own Pods directory will simply reinstall
    // the next time, which is the safe direction.
  }
}

/**
 * A digest of the files CocoaPods reads to build the Pods project: this
 * library's native sources, nitrogen's output, and the Podfile. Path plus size
 * plus mtime, not content - the question is "did the file list move", and a new
 * file is the case that bites. Ignored build output is skipped so a compile
 * cannot make the next build reinstall.
 *
 * @returns {string}
 */
function iosInputFingerprint() {
  const roots = [
    path.join(REPO_ROOT, 'example', 'ios'),
    // The library's own Swift/ObjC sources: a new component file must re-run pods.
    path.join(REPO_ROOT, 'ios'),
    path.join(REPO_ROOT, 'cpp'),
    path.join(REPO_ROOT, 'nitrogen', 'generated'),
  ];
  const skip = new Set([
    'build',
    'Pods',
    'DerivedData',
    'node_modules',
    'Pods.xcodeproj',
  ]);
  const lines = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stats = fs.statSync(full);
        lines.push(
          `${path.relative(REPO_ROOT, full)}:${String(stats.size)}:${Math.round(stats.mtimeMs)}`
        );
      } catch {
        // Vanished mid-walk; the next build will see whatever is there.
      }
    }
  };
  for (const root of roots) walk(root, 0);
  // The Pods project records whether it was told to use ccache, which is a
  // property of *this machine* as much as of these sources: installing ccache
  // after a `pod install` has to re-run it, or the CC build settings would keep
  // naming plain clang and the cache would stay cold forever.
  lines.push(`ccache:${ccache.binary ?? 'none'}`);
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex');
}

function buildIos({ clean, log }) {
  const iosDir = path.join(REPO_ROOT, 'example', 'ios');
  const derivedData = path.join(iosDir, 'build');
  if (clean) {
    // DerivedData *and* the pod-inputs record, so the pod-install decision below
    // is asked again rather than answered from the record this clean was meant
    // to invalidate.
    for (const target of iosCleanTargets({ iosDir })) {
      removeIfPresent(target, log);
    }
  }

  const manifest = path.join(iosDir, 'Pods', 'Manifest.lock');
  const podfileLock = path.join(iosDir, 'Podfile.lock');
  const podsAreStale =
    !fs.existsSync(manifest) ||
    fs.readFileSync(manifest, 'utf8') !== fs.readFileSync(podfileLock, 'utf8');
  // The lock matching the manifest is not the only thing that can make the Pods
  // project wrong. This library's own sources arrive through the podspec's
  // `source_files` globs, so a *new* file under `cpp/` or
  // `nitrogen/generated/ios/` is invisible to an existing Pods project until
  // someone runs pod install - and xcodebuild then builds an app that simply
  // lacks the new component, which the harness reports as a failing test rather
  // than a missing file (review S6). Comparing what the last install saw is what
  // notices.
  const inputs = podInputsFile(iosDir);
  const seen = readMarker(inputs);
  const inputsChanged = seen !== iosInputFingerprint();
  if (podsAreStale || inputsChanged) {
    log(
      podsAreStale
        ? 'pods are out of step with Podfile.lock - installing'
        : `the iOS sources changed since the last pod install (${seen == null ? 'no record' : 'new inputs'})` +
            ' - installing so the Pods project sees them'
    );
    // The repo's one CocoaPods entry point, so the `COCOAPODS:` trailer in a
    // tracked `Podfile.lock` does not become a version-only diff.
    const pods = installPods({ dir: iosDir });
    if (pods.status !== 0) {
      // S8: continuing here builds against whatever headers were there before,
      // and the failure shows up as a compile error or - worse, for a new file -
      // as an app that is missing a component while still exiting green.
      throw new Error(
        `pod install failed with exit code ${String(pods.status)} - the build ` +
          'stopped there rather than compiling against a Pods project that ' +
          'does not match the Podfile.'
      );
    }
    writeMarker(inputs, iosInputFingerprint());
  }

  // The module cache this build writes is the one a ccache build owns: the
  // compiler here has CCACHE_BASEDIR, and clang records what it resolves into
  // the .pcm files, so sharing that directory with a plain xcodebuild hands it
  // two spellings of one module and a fatal error. See iosModuleCacheDir.
  const moduleCacheArgs = iosModuleCacheArgs({
    derivedData,
    ccache: ccache.enabled,
  });
  if (ccache.enabled) {
    log(`module cache ${moduleCacheArgs[0].split('=')[1]}`);
  }

  // M3: this is the "before" tree. It is taken *after* pod install, because pod
  // install legitimately rewrites the tracked Podfile.lock (the CocoaPods stamp)
  // - hashing before it would report the tooling's own bookkeeping as the tree
  // having moved.
  const treeBefore = currentCodeTree();

  run(
    'xcodebuild',
    [
      // The workspace, not the project: with `-project` the CocoaPods targets
      // are not built as dependencies (see scripts/bench/build.mjs).
      '-workspace',
      path.join(iosDir, 'NitroUiExample.xcworkspace'),
      '-scheme',
      'NitroUiExample',
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      derivedData,
      'CODE_SIGNING_ALLOWED=NO',
      ...moduleCacheArgs,
      'build',
    ],
    { cwd: iosDir, env: buildEnv({ CI: '1' }) }
  );
  return { artifact: artifactPath({ platform: 'ios' }), treeBefore };
}

function buildAndroid({ abis, abisFrom, clean, log }) {
  // M3: nothing in this build is expected to write to tracked files (gradle,
  // codegen and the RN autolinker all write under ignored build directories),
  // so the tree at entry is the tree the compiler reads. Verified on the run
  // recorded in docs/tasks/X1-dev-tooling.report.md.
  const treeBefore = currentCodeTree();
  const androidDir = path.join(REPO_ROOT, 'example', 'android');
  const appBuild = path.join(androidDir, 'app', 'build');
  if (clean) removeIfPresent(appBuild, log);

  const gradlew = path.join(
    androidDir,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  );
  const architectures = gradleArchArgs(abis);
  log(`android ABIs: ${abis}${abisFrom === 'host' ? ' (this machine)' : ''}`);
  run(gradlew, [':app:assembleDebug', ...architectures, ...ccache.gradleArgs], {
    cwd: androidDir,
    env: buildEnv(),
  });

  const apk = artifactPath({ platform: 'android' });
  const components = registeredComponents({ platform: 'android' });
  const first = inspectArtifact({
    platform: 'android',
    artifact: apk,
    components,
  });
  if (first.missing.length > 0) {
    log(
      `the APK is missing ${first.missing.join(', ')} although ` +
        'nitrogen registers them - gradle called the dex up-to-date over stale ' +
        'output, re-running packageDebug'
    );
    // `--rerun` skips the up-to-date checks for every task in this graph, which
    // is the documented fix for a generated hybrid that never got dexed. The
    // gradle arguments have to match the build above exactly, init script
    // included: without it the rerun is a different configuration-cache key and
    // a CMake reconfigure with no launcher, so the slowest possible path becomes
    // the one the safety net takes - and it forces the same reconfigure again on
    // the next normal build.
    run(
      gradlew,
      [':app:packageDebug', '--rerun', ...architectures, ...ccache.gradleArgs],
      {
        cwd: androidDir,
        env: buildEnv(),
      }
    );
    const second = inspectArtifact({
      platform: 'android',
      artifact: apk,
      components,
    });
    if (second.missing.length > 0) {
      throw new StaleAppError(
        `even after --rerun, ${path.basename(apk)} is missing ` +
          `${second.missing.join(', ')}.\n` +
          '       that is a codegen or gradle wiring problem, not a stale artifact: ' +
          'run `bun run nitrogen && bun run nitrogen:check`, then build with --clean.'
      );
    }
  }
  return { artifact: apk, treeBefore };
}

/**
 * How long a build may queue for its slot. Overridable for one shell the same
 * way the lease poll interval is, so a test or a machine with a slow queue can
 * name a different number without a code change (X9).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
function buildSlotWaitMinutes(env = {}) {
  const raw = env.NITRO_UI_BUILD_WAIT_MINUTES;
  if (raw == null || raw === '') return DEFAULT_BUILD_WAIT_MINUTES;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0
    ? minutes
    : DEFAULT_BUILD_WAIT_MINUTES;
}

function main(argv) {
  if (argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const platform = parseArg(argv, '--platform');
  if (platform !== 'ios' && platform !== 'android') {
    process.stderr.write(
      platform == null
        ? `--platform ios or --platform android is required\n${USAGE}\n`
        : `--platform must be ios or android (got "${String(platform)}")\n${USAGE}\n`
    );
    return 2;
  }
  const log = (message) => process.stderr.write(`build-app: ${message}\n`);
  const clean = argv.includes('--clean');
  const force = argv.includes('--force');
  const noStamp = argv.includes('--no-stamp');

  // Resolved before the skip decision, not after it: the ABIs are part of what
  // the caller asked for, and an artifact that does not contain them is not the
  // build that was requested even when the code tree matches (review M1).
  const { abis, source: abisFrom } = resolveAndroidAbis({
    flag: parseArg(argv, '--arch'),
    env: process.env,
    hostArch: os.arch(),
  });

  // Nothing changed since the last build, and the artifact still proves it? Then
  // there is nothing to build. The check is the same one the device gates run,
  // so "fresh" cannot mean one thing here and another thing there; anything it
  // cannot confirm, it builds.
  if (!force && !clean && !noStamp) {
    const decision = checkFreshApp({ platform, warn: () => {} });
    const skip = decideSkipBuild({
      force,
      clean,
      noStamp,
      fresh: decision.ok,
      freshReason: decision.ok ? null : decision.problems[0],
      platform,
      abis,
      stampedAbis: decision.stamp?.abis ?? null,
    });
    if (skip.skip) {
      process.stdout.write(
        `${colorize(`\u2713 ${platform} example app is fresh, not rebuilt`, 'green')}\n` +
          `  artifact  ${decision.artifact}\n` +
          `  stamp     ${stampPath({ platform })}\n` +
          `  tree      ${currentCodeTree().tree.slice(0, 12)}\n\n` +
          'Nothing in the code tree or the binary moved since it was built.\n' +
          'Rebuild anyway with --force, or --clean.\n'
      );
      return 0;
    }
    log(`building: ${skip.reason}`);
  }

  // One heavy native build at a time, machine-wide (X9): two app builds plus
  // `check` pushed a 10-core machine to load 13, and the lease pool only limits
  // *device* tasks, because a build needs no device.
  //
  // Taken *after* the stamp-fresh skip above, so a build that has nothing to do
  // takes no slot - the skip is a file read, and a queue of tasks waiting behind
  // a machine that is not compiling would be worse than no queue at all.
  //
  // `--clean` and `--force` still queue: they are slower than a normal build, not
  // exempt from what they do to the machine.
  const slot = buildSlotState(process.env);
  if (slot.note != null) log(slot.note);
  const held = takeBuildSlot({
    task: buildTaskName(process.env),
    platform,
    buildsFile: slot.builds,
    lockFile: slot.lock,
    max: slot.max,
    host: os.hostname(),
    log,
    waitMinutes: buildSlotWaitMinutes(process.env),
  });
  // Timed from here, not from process entry: the wait belongs in its own number,
  // and a 9-minute build that queued for 20 should not read as a 29-minute build.
  const startedAt = Date.now();
  // Release on every exit path, including the throw out of `run()`: a slot that
  // outlives its build would hold the machine until the ttl, and the next task
  // would wait for a compile that already finished.
  process.once('exit', held.release);
  try {
    const { artifact, treeBefore } =
      platform === 'ios'
        ? buildIos({ clean, log })
        : buildAndroid({ abis, abisFrom, clean, log });
    held.release();

    const stamp = noStamp
      ? null
      : recordBuild({
          platform,
          artifact,
          treeBefore,
          abis: platform === 'android' ? abis : null,
          log,
        });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
    const tree = currentCodeTree();
    process.stdout.write(
      `${colorize(`\u2713 ${platform} example app built from this tree`, 'green')}\n` +
        `  artifact  ${artifact}\n` +
        `  stamp     ${stampPath({ platform })}\n` +
        `  tree      ${tree.tree.slice(0, 12)} (${String(tree.files)} code files)` +
        `${stamp == null ? ' (not stamped: --no-stamp)' : ''}\n` +
        `  ${seconds}s` +
        `${held.waitedMs > 1000 ? ` (waited ${String(Math.round(held.waitedMs / 1000))}s for the build slot)` : ''}\n\n` +
        'Point the harness at it:\n' +
        `  export HARNESS_APP_PATH="${artifact}"\n`
    );
    return 0;
  } finally {
    held.release();
  }
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  const message =
    error instanceof StaleAppError
      ? error.message
      : `build-app: ${String(error?.message ?? error)}`;
  process.stderr.write(`${colorize(message, 'red')}\n`);
  process.exit(1);
}
