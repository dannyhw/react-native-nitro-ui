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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  StaleAppError,
  artifactPath,
  colorize,
  currentCodeTree,
  inspectArtifact,
  recordBuild,
  registeredComponents,
  repoRootOf,
  stampPath,
} from './app-stamp.mjs';
import { installPods } from './pod-install.mjs';
import { assertSupportedNodeOrReexec } from './node-version.mjs';

/** This checkout, wherever the worktree happens to be. */
const REPO_ROOT = repoRootOf(path.dirname(fileURLToPath(import.meta.url)));

const USAGE =
  'usage: node scripts/build-app.mjs --platform ios|android\n' +
  '                                  [--arch <abi>] [--clean] [--no-stamp]';

assertSupportedNodeOrReexec({
  command: 'node scripts/build-app.mjs',
  entryUrl: import.meta.url,
});

function parseArg(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 || index + 1 >= argv.length ? null : argv[index + 1];
}

/** The ABI a simulator/emulator on this machine actually runs. */
function defaultArch() {
  return os.arch() === 'x64' ? 'x86_64' : 'arm64-v8a';
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

function buildIos({ clean, log }) {
  const iosDir = path.join(REPO_ROOT, 'example', 'ios');
  const derivedData = path.join(iosDir, 'build');
  if (clean) removeIfPresent(derivedData, log);

  const manifest = path.join(iosDir, 'Pods', 'Manifest.lock');
  const podfileLock = path.join(iosDir, 'Podfile.lock');
  const podsAreStale =
    !fs.existsSync(manifest) ||
    fs.readFileSync(manifest, 'utf8') !== fs.readFileSync(podfileLock, 'utf8');
  if (podsAreStale) {
    // The repo's one CocoaPods entry point, so the `COCOAPODS:` trailer in a
    // tracked `Podfile.lock` does not become a version-only diff.
    installPods({ dir: iosDir });
  }

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
      'build',
    ],
    { cwd: iosDir, env: { ...process.env, CI: '1' } }
  );
  return artifactPath({ platform: 'ios' });
}

function buildAndroid({ arch, clean, log }) {
  const androidDir = path.join(REPO_ROOT, 'example', 'android');
  const appBuild = path.join(androidDir, 'app', 'build');
  if (clean) removeIfPresent(appBuild, log);

  const gradlew = path.join(
    androidDir,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  );
  const architectures = `-PreactNativeArchitectures=${arch}`;
  run(gradlew, [':app:assembleDebug', architectures], { cwd: androidDir });

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
    // is the documented fix for a generated hybrid that never got dexed.
    run(gradlew, [':app:packageDebug', '--rerun', architectures], {
      cwd: androidDir,
    });
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
  return apk;
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
  const arch = parseArg(argv, '--arch') ?? defaultArch();
  const clean = argv.includes('--clean');

  const startedAt = Date.now();
  const artifact =
    platform === 'ios'
      ? buildIos({ clean, log })
      : buildAndroid({ arch, clean, log });

  const stamp = argv.includes('--no-stamp')
    ? null
    : recordBuild({ platform, artifact, log });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  const tree = currentCodeTree();
  process.stdout.write(
    `${colorize(`\u2713 ${platform} example app built from this tree`, 'green')}\n` +
      `  artifact  ${artifact}\n` +
      `  stamp     ${stampPath({ platform })}\n` +
      `  tree      ${tree.tree.slice(0, 12)} (${String(tree.files)} code files)` +
      `${stamp == null ? ' (not stamped: --no-stamp)' : ''}\n` +
      `  ${seconds}s\n\n` +
      'Point the harness at it:\n' +
      `  export HARNESS_APP_PATH="${artifact}"\n`
  );
  return 0;
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
