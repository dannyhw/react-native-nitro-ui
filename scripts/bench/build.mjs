/**
 * Build the release bench app for one platform. A release build embeds its JS
 * bundle, so a bench run needs no Metro.
 *
 *   node scripts/bench/build.mjs --platform ios
 *   node scripts/bench/build.mjs --platform android [--prebuild] [--rebuild]
 *
 *   --prebuild   regenerate the native project with `expo prebuild --clean`
 *                (also done when `bench/ios` or `bench/android` is missing)
 *   --rebuild    build even when the artifact is newer than every source file
 *
 * Prints the build result as JSON. Exits 2 without a valid `--platform`.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { installPods } from '../pod-install.mjs';
import {
  ccacheEnv,
  ccacheRequested,
  iosModuleCacheArgs,
  gradleArchArgs,
  gradleCcacheArgs,
  resolveAndroidAbis,
  withGradleProperties,
} from '../build-speed-lib.mjs';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
export const BENCH_ROOT = path.join(REPO_ROOT, 'bench');

/** Directories a change in must trigger a rebuild (skipping build outputs). */
const SOURCE_DIRS = [
  path.join(BENCH_ROOT, 'app.json'),
  path.join(BENCH_ROOT, 'package.json'),
  path.join(BENCH_ROOT, 'src'),
  path.join(BENCH_ROOT, 'modules'),
  path.join(REPO_ROOT, 'src'),
  path.join(REPO_ROOT, 'ios'),
  path.join(REPO_ROOT, 'android'),
  path.join(REPO_ROOT, 'cpp'),
  path.join(REPO_ROOT, 'nitrogen'),
];

/**
 * What Metro folds into the embedded JS bundle. Compared against the bundle's
 * own mtime, not the artifact's.
 */
const BUNDLE_SOURCES = [
  path.join(BENCH_ROOT, 'index.ts'),
  path.join(BENCH_ROOT, 'src'),
  path.join(BENCH_ROOT, 'modules'),
  path.join(BENCH_ROOT, 'app.json'),
  path.join(BENCH_ROOT, 'package.json'),
  path.join(BENCH_ROOT, 'metro.config.js'),
  path.join(BENCH_ROOT, 'babel.config.js'),
  path.join(REPO_ROOT, 'src'),
];

const SKIPPED_DIRS = new Set([
  'node_modules',
  'build',
  'Pods',
  'DerivedData',
  '.cxx',
  '.gradle',
  '.expo',
  'dist',
  'lib',
]);

function newestMtime(target) {
  if (!fs.existsSync(target)) {
    return 0;
  }
  const stats = fs.statSync(target);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }
  let newest = stats.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) {
      continue;
    }
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

export function readAppConfig() {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(BENCH_ROOT, 'app.json'), 'utf8')
  );
  return {
    bundleId: appJson.expo.ios.bundleIdentifier,
    packageName: appJson.expo.android.package,
    projectName: 'nitrouibench',
  };
}

/**
 * ccache, when it is requested and on PATH.
 *
 * @returns {{enabled: boolean, binary: string | null}}
 */
function findCcache() {
  if (!ccacheRequested(process.env)) return { enabled: false, binary: null };
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue;
    const candidate = path.join(dir, 'ccache');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return { enabled: true, binary: candidate };
    } catch {
      // keep looking
    }
  }
  return { enabled: false, binary: null };
}

const ccache = findCcache();

// `react_native_post_install` reads USE_CCACHE while `pod install` writes the
// Pods project, so CocoaPods has to see it. It is set for that one call only:
// a module-level write to `process.env` would reach every child process of
// whatever imports this module.
const USE_CCACHE = ccache.enabled ? { USE_CCACHE: '1' } : {};

/**
 * Run `fn` with `vars` in `process.env`, then put the environment back. For a
 * callee that spawns with the inherited environment and takes no env argument.
 *
 * @param {Record<string, string>} vars
 * @param {() => T} fn
 * @template T
 * @returns {T}
 */
function withEnv(vars, fn) {
  const before = Object.entries(vars).map(
    ([key]) =>
      /** @type {[string, string | undefined]} */ ([key, process.env[key]])
  );
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Environment for a build: ccache's cache location rules, plus any extras. */
function buildEnv(extra = {}) {
  return {
    ...process.env,
    ...(ccache.enabled
      ? {
          ...ccacheEnv({
            enabled: true,
            repoRoot: REPO_ROOT,
            binary: ccache.binary,
          }),
          // The bench Podfile is generated, so the ccache switch cannot live in
          // it; `react_native_post_install` reads this variable instead.
          USE_CCACHE: '1',
        }
      : {}),
    ...extra,
  };
}

/**
 * `expo prebuild --clean` rewrites the generated `bench/android` tree, so the
 * cache switches are applied to it on every run instead of being committed.
 *
 * @param {'ios'|'android'} platform
 */
function applyBuildSpeedSettings(platform) {
  if (platform !== 'android') return;
  const file = path.join(BENCH_ROOT, 'android', 'gradle.properties');
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8');
  const { text, changed } = withGradleProperties(before, {
    'org.gradle.caching': 'true',
    // Off: the `app/build.gradle` Expo generates starts `node` while it is
    // being configured, which the configuration cache refuses.
    'org.gradle.configuration-cache': 'false',
  });
  if (changed.length > 0) {
    fs.writeFileSync(file, text);
    process.stderr.write(
      `bench: gradle.properties + ${changed.join(', ')} in ` +
        'the generated android tree\n'
    );
  }
}

function run(command, args, options = {}) {
  const { print = true, ...rest } = options;
  if (print) {
    process.stderr.write(`$ ${command} ${args.join(' ')}\n`);
  }
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    ...rest,
  });
}

export function prebuild(platform) {
  run('bunx', ['expo', 'prebuild', '--clean', '--platform', platform], {
    cwd: BENCH_ROOT,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  });
}

function needsRebuild(artifact) {
  if (artifact == null || !fs.existsSync(artifact)) {
    return true;
  }
  const builtAt = fs.statSync(artifact).mtimeMs;
  return SOURCE_DIRS.some((source) => newestMtime(source) > builtAt);
}

/** The embedded JS bundle inside a built `.app`, or null when there is none. */
function embeddedBundle(appPath) {
  if (appPath == null || !fs.existsSync(appPath)) {
    return null;
  }
  const bundles = fs
    .readdirSync(appPath)
    .filter((entry) => entry.endsWith('.jsbundle'))
    .map((entry) => path.join(appPath, entry));
  return bundles[0] ?? null;
}

/**
 * Is the JS inside an iOS `.app` older than the JS it is built from? A relink
 * moves the `.app` directory's mtime past a later JS edit, so the artifact can
 * look fresh while its bundle is stale. Gradle hashes its inputs, so an APK
 * cannot be stale this way.
 */
function isBundleStale(appPath) {
  const bundle = embeddedBundle(appPath);
  if (bundle == null) {
    return true;
  }
  const builtAt = fs.statSync(bundle).mtimeMs;
  return BUNDLE_SOURCES.some((source) => newestMtime(source) > builtAt);
}

export function buildIos({ rebuild = false, prebuildFirst = false } = {}) {
  const { bundleId, projectName } = readAppConfig();
  const iosDir = path.join(BENCH_ROOT, 'ios');
  if (prebuildFirst || !fs.existsSync(iosDir)) {
    prebuild('ios');
  }
  applyBuildSpeedSettings('ios');
  if (!fs.existsSync(path.join(iosDir, 'Pods', 'Manifest.lock'))) {
    const pods = withEnv(USE_CCACHE, () => installPods({ dir: iosDir }));
    if (pods.status !== 0) {
      // Stop here: xcodebuild would compile against the previous Pods project
      // and the bench would measure an app that is not this commit's.
      throw new Error(
        `bench: pod install failed with exit code ${String(pods.status)} in ` +
          iosDir +
          ' - stopping before xcodebuild rather than measuring a stale app.'
      );
    }
  }

  const derivedData = path.join(iosDir, 'build', 'DerivedData');
  const products = path.join(
    derivedData,
    'Build',
    'Products',
    'Release-iphonesimulator'
  );
  const appPath = () => {
    if (!fs.existsSync(products)) {
      return null;
    }
    const apps = fs
      .readdirSync(products)
      .filter((entry) => entry.endsWith('.app'))
      .map((entry) => path.join(products, entry));
    return apps[0] ?? null;
  };

  if (!rebuild && !needsRebuild(appPath()) && !isBundleStale(appPath())) {
    return { appPath: appPath(), bundleId, reused: true };
  }

  run(
    'xcodebuild',
    [
      // Must be the workspace: with `-project` the CocoaPods targets are not
      // built as dependencies and the first Swift compile fails on a pod
      // modulemap that was never produced.
      '-workspace',
      path.join(iosDir, `${projectName}.xcworkspace`),
      '-scheme',
      projectName,
      '-configuration',
      'Release',
      '-sdk',
      'iphonesimulator',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      derivedData,
      'ARCHS=arm64',
      'ONLY_ACTIVE_ARCH=NO',
      'CODE_SIGNING_ALLOWED=NO',
      // This build sets CCACHE_BASEDIR, so it compiles into a module cache of
      // its own: the .pcm files it writes hold worktree-relative paths, and a
      // build without that environment reading them fails on duplicate modules.
      ...iosModuleCacheArgs({ derivedData, ccache: ccache.enabled }),
      'build',
    ],
    { cwd: iosDir, stdio: 'inherit', env: buildEnv({ CI: '1' }) }
  );

  const built = appPath();
  if (built == null) {
    throw new Error(
      `xcodebuild finished but no .app was found under ${products}`
    );
  }
  return { appPath: built, bundleId, reused: false };
}

/**
 * ABIs to build: `BENCH_ABIS` wins, then `NITRO_UI_ANDROID_ARCH`, then this
 * machine's own ABI, which is the one its emulator runs.
 */
function androidArchitectures() {
  return resolveAndroidAbis({
    flag: process.env.BENCH_ABIS ?? null,
    env: process.env,
    hostArch: os.arch(),
  }).abis;
}

export function buildAndroid({ rebuild = false, prebuildFirst = false } = {}) {
  const { packageName } = readAppConfig();
  const androidDir = path.join(BENCH_ROOT, 'android');
  if (prebuildFirst || !fs.existsSync(androidDir)) {
    prebuild('android');
  }
  applyBuildSpeedSettings('android');
  const apk = path.join(
    androidDir,
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release.apk'
  );
  if (!rebuild && !needsRebuild(apk)) {
    return { apkPath: apk, packageName, reused: true };
  }

  const gradlew = path.join(
    androidDir,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  );
  run(
    gradlew,
    [
      ':app:assembleRelease',
      ...gradleArchArgs(androidArchitectures()),
      ...gradleCcacheArgs({
        enabled: ccache.enabled,
        initScript: path.join(
          REPO_ROOT,
          'scripts',
          'gradle-ccache.init.gradle'
        ),
      }),
    ],
    {
      cwd: androidDir,
      stdio: 'inherit',
      env: buildEnv({
        CI: '1',
        ANDROID_HOME:
          process.env.ANDROID_HOME ??
          path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk'),
        CCACHE_GRADLE_LAUNCHER: ccache.binary ?? '',
      }),
    }
  );

  if (!fs.existsSync(apk)) {
    throw new Error(`gradle finished but ${apk} does not exist`);
  }
  return { apkPath: apk, packageName, reused: false };
}

export function build(platform, options = {}) {
  if (platform === 'ios') {
    return buildIos(options);
  }
  if (platform === 'android') {
    return buildAndroid(options);
  }
  throw new Error(
    `--platform must be ios or android (got "${String(platform)}")`
  );
}

/**
 * Locate an already-built release artifact without building anything. Throws
 * when there is none, or when the iOS bundle is older than the JS sources.
 */
export function locateArtifact(platform) {
  if (platform === 'ios') {
    const config = readAppConfig();
    const products = path.join(
      BENCH_ROOT,
      'ios',
      'build',
      'DerivedData',
      'Build',
      'Products',
      'Release-iphonesimulator'
    );
    const apps = fs.existsSync(products)
      ? fs
          .readdirSync(products)
          .filter((entry) => entry.endsWith('.app'))
          .map((entry) => path.join(products, entry))
      : [];
    const appPath = apps[0];
    if (appPath == null) {
      throw new Error(`--skip-build: no Release .app under ${products}`);
    }
    if (isBundleStale(appPath)) {
      const bundle = embeddedBundle(appPath);
      throw new Error(
        `--skip-build: the bundle in ${String(bundle)} predates the JS sources` +
          ' - it measures a different app than the commit the results file ' +
          'names. Run without --skip-build, or with --rebuild, first.'
      );
    }
    return { appPath, bundleId: config.bundleId, reused: true };
  }
  if (platform === 'android') {
    const config = readAppConfig();
    const apkPath = path.join(
      BENCH_ROOT,
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'release',
      'app-release.apk'
    );
    if (!fs.existsSync(apkPath)) {
      throw new Error(`--skip-build: ${apkPath} does not exist`);
    }
    return { apkPath, packageName: config.packageName, reused: true };
  }
  throw new Error(
    `--platform must be ios or android (got "${String(platform)}")`
  );
}

export function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 || index + 1 >= argv.length
    ? null
    : (argv[index + 1] ?? null);
}

if (
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
) {
  const argv = process.argv.slice(2);
  const platform = flag(argv, '--platform');
  if (platform !== 'ios' && platform !== 'android') {
    process.stderr.write(
      'usage: node scripts/bench/build.mjs --platform ios|android [--prebuild] [--rebuild]\n'
    );
    process.exit(2);
  }
  const result = build(platform, {
    rebuild: argv.includes('--rebuild'),
    prebuildFirst: argv.includes('--prebuild'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
