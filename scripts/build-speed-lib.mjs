/**
 * Build-speed decisions, kept free of I/O: which Android ABI to build, what
 * ccache needs in the environment, when a build can be skipped, and what a
 * generated Gradle properties file must contain.
 */

import path from 'node:path';

/** ABIs this repo knows how to build, so a typo fails here rather than in CMake. */
export const KNOWN_ABIS = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];

/**
 * The ABI a machine's own emulator/simulator runs. Apple Silicon and modern
 * Android emulators are arm64; Intel hosts and hosted CI runners are x86_64.
 *
 * @param {string} hostArch something like `process.arch`
 * @returns {string}
 */
export function hostAbi(hostArch) {
  return hostArch === 'x64' ? 'x86_64' : 'arm64-v8a';
}

/**
 * Which ABI a build should produce, and why.
 *
 * Order: `--arch` on the command line, then `NITRO_UI_ANDROID_ARCH`, then the
 * host ABI. A comma-separated list is allowed for the rare run that wants more
 * than one (an emulator and a device in the same APK).
 *
 * @param {object} options
 * @param {string | null} [options.flag] the `--arch` value
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string} options.hostArch
 * @returns {{abis: string, source: 'flag' | 'env' | 'host'}}
 */
export function resolveAndroidAbis({
  flag = null,
  env = {},
  hostArch = 'arm64',
}) {
  const raw = flag ?? env.NITRO_UI_ANDROID_ARCH ?? null;
  if (raw == null || raw === '') {
    return { abis: hostAbi(hostArch), source: 'host' };
  }
  const abis = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const unknown = abis.filter((entry) => !KNOWN_ABIS.includes(entry));
  if (abis.length === 0 || unknown.length > 0) {
    throw new Error(
      `"${raw}" is not a list of Android ABIs - expected some of ` +
        `${KNOWN_ABIS.join(', ')}`
    );
  }
  return {
    abis: abis.join(','),
    source: flag != null && flag !== '' ? 'flag' : 'env',
  };
}

/**
 * The gradle argument that narrows a build to those ABIs.
 * `example/android/gradle.properties` keeps the four-ABI default, which is what
 * a hand-run gradle command and the release build produce.
 *
 * @param {string} abis
 * @returns {string[]}
 */
export function gradleArchArgs(abis) {
  return [`-PreactNativeArchitectures=${abis}`];
}

/**
 * Did the caller ask ccache to stay out of this build?
 *
 * `NITRO_UI_CCACHE=0` is for measuring, debugging a compiler invocation, or
 * reproducing exactly what CI does on a machine that happens to have ccache.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function ccacheRequested(env = {}) {
  return env.NITRO_UI_CCACHE !== '0';
}

/**
 * What ccache needs to be useful across several worktrees of one repo.
 *
 * - `CCACHE_BASEDIR` makes ccache record paths relative to this worktree, so the
 *   same file in two worktrees hashes the same.
 * - `CCACHE_NOHASHDIR=1` keeps the compile-time working directory out of the
 *   hash. No underscore: `CCACHE_HASH_DIR` is not a variable ccache reads.
 * - `CCACHE_BINARY` is what React Native's `ccache-clang.sh` execs for iOS
 *   compiles. Xcode does not pass that build setting to the compiler's
 *   environment, and with it unset the wrapper runs plain clang with no error.
 *
 * Environment variables, not a config file: React Native's wrapper points
 * `CCACHE_CONFIGPATH` at its own file, and an exported variable outranks both.
 *
 * @param {object} options
 * @param {boolean} options.enabled ccache was found on this machine
 * @param {string} options.repoRoot this checkout
 * @param {string} [options.binary] the ccache binary the wrapper should exec
 * @returns {Record<string, string>} empty when ccache is not installed
 */
export function ccacheEnv({ enabled, repoRoot, binary }) {
  if (!enabled) return {};
  return {
    CCACHE_BASEDIR: repoRoot,
    CCACHE_NOHASHDIR: '1',
    ...(binary ? { CCACHE_BINARY: binary } : {}),
  };
}

/**
 * Did ccache really take both of those settings? `ccache --show-config` prints
 * the effective value of every setting, which is the only way to tell a variable
 * ccache reads from one it ignores.
 *
 * @param {string} showConfigOutput stdout of `ccache --show-config`
 * @returns {boolean}
 */
export function ccacheEffectiveForWorktrees(showConfigOutput) {
  const read = (name) => {
    const line = showConfigOutput
      .split('\n')
      .find((entry) => entry.includes(`${name} = `));
    return line ? line.split(' = ').pop().trim() : null;
  };
  return read('hash_dir') === 'false' && Boolean(read('base_dir'));
}

/**
 * gradle arguments that hand the C/C++ launcher to the native builds gradle
 * configures.
 *
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {string} [options.initScript]
 * @returns {string[]}
 */
export function gradleCcacheArgs({ enabled, initScript }) {
  if (!enabled || initScript == null) return [];
  return [`--init-script=${String(initScript)}`];
}

/** What Xcode names its compiled-module cache when nothing overrides it. */
export const PLAIN_MODULE_CACHE_NAME = 'ModuleCache.noindex';

/** The same cache for a build whose compiler was told `CCACHE_BASEDIR`. */
export const CCACHE_MODULE_CACHE_NAME = 'ModuleCache-ccache.noindex';

/**
 * Where an iOS build's compiled modules go. A ccache build needs its own
 * directory: with `CCACHE_BASEDIR` set, clang writes worktree-relative paths
 * into the `.pcm` files, and a plain `xcodebuild` that reads them finds
 * `Foundation` defined under both spellings of one path and stops with a fatal
 * error. A plain build is passed the default name explicitly.
 *
 * @param {object} options
 * @param {string} options.derivedData the `-derivedDataPath` of that build
 * @param {boolean} options.ccache this build set the ccache environment
 * @returns {string}
 */
export function iosModuleCacheDir({ derivedData, ccache }) {
  return path.join(
    String(derivedData),
    ccache ? CCACHE_MODULE_CACHE_NAME : PLAIN_MODULE_CACHE_NAME
  );
}

/**
 * The `xcodebuild` build-setting assignment that pins it.
 *
 * @param {object} options same as `iosModuleCacheDir`
 * @returns {string[]} one entry, to spread into the xcodebuild arguments
 */
export function iosModuleCacheArgs({ derivedData, ccache }) {
  return [`MODULE_CACHE_DIR=${iosModuleCacheDir({ derivedData, ccache })}`];
}

/** Where the example app keeps its iOS DerivedData, relative to `example/ios`. */
export const IOS_BUILD_DIR = 'build';

/**
 * The name of the record of what the last `pod install` was shown. It lives
 * inside `Pods/` and is gitignored, because it is build state.
 */
export const POD_INPUTS_RECORD = '.nitro-ui-pod-inputs';

/**
 * What `--clean` deletes before an iOS build: the DerivedData, and the record of
 * what the last `pod install` was shown, which is how a build notices a stale
 * Pods project. `Pods/` itself stays, because reinstalling it costs minutes.
 *
 * @param {object} options
 * @param {string} options.iosDir the example app's `ios` directory
 * @returns {string[]} what to remove, in the order to remove it
 */
export function iosCleanTargets({ iosDir }) {
  return [
    path.join(String(iosDir), IOS_BUILD_DIR),
    path.join(String(iosDir), 'Pods', POD_INPUTS_RECORD),
  ];
}

/**
 * Do two ABI lists mean the same build? Compared as sets. A missing or empty
 * list never matches: it says nothing about what is in the artifact.
 *
 * @param {string | null | undefined} stampedAbis what the stamp recorded
 * @param {string | null | undefined} requestedAbis what this run asks for
 * @returns {boolean}
 */
export function abisMatch(stampedAbis, requestedAbis) {
  const set = (value) => {
    if (value == null) return null;
    const entries = String(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    return entries.length === 0 ? null : [...new Set(entries)].sort().join(',');
  };
  const stamped = set(stampedAbis);
  const requested = set(requestedAbis);
  return stamped != null && requested != null && stamped === requested;
}

/**
 * Should `build-app.mjs` skip a build? Only with no `--force`, `--clean` or
 * `--no-stamp`, and a stamp that proves the artifact was built from this code
 * tree. On Android the stamp's ABIs must match as well: the artifact path is the
 * same file whichever ABIs gradle was asked for.
 *
 * @param {object} options
 * @param {boolean} options.force
 * @param {boolean} options.clean
 * @param {boolean} options.noStamp
 * @param {boolean} options.fresh the stamp matches the tree and the artifact
 * @param {string | null} [options.freshReason] why it is not fresh, for the log
 * @param {'ios'|'android'} [options.platform] what is being built
 * @param {string | null} [options.abis] the ABIs this run asks for (Android)
 * @param {string | null} [options.stampedAbis] what the stamp recorded
 * @returns {{skip: boolean, reason: string}}
 */
export function decideSkipBuild({
  force,
  clean,
  noStamp,
  fresh,
  freshReason = null,
  platform = 'android',
  abis = null,
  stampedAbis = null,
}) {
  if (force) {
    return { skip: false, reason: '--force' };
  }
  if (clean) {
    return { skip: false, reason: '--clean' };
  }
  if (noStamp) {
    // The caller explicitly wants a build whose stamp is not trusted, which is
    // only ever to debug something, and a skip would debug nothing.
    return { skip: false, reason: '--no-stamp' };
  }
  if (!fresh) {
    return {
      skip: false,
      reason: freshReason == null ? 'no matching app.stamp' : freshReason,
    };
  }
  if (platform === 'android' && !abisMatch(stampedAbis, abis)) {
    // "The stamp says something else" and "the stamp says nothing" get
    // different sentences in the log.
    const saidNothing =
      stampedAbis == null || String(stampedAbis).trim() === '';
    return {
      skip: false,
      reason: saidNothing
        ? `the stamp does not say which ABIs it built, this run asks for ${String(abis)}`
        : `the app was built for ${String(stampedAbis)}, this run asks for ${String(abis)}`,
    };
  }
  return { skip: true, reason: 'app.stamp matches this tree' };
}

/** The block this repo adds to a *generated* gradle.properties. */
export const GRADLE_CACHE_KEYS = [
  'org.gradle.caching',
  'org.gradle.configuration-cache',
];

/**
 * Make sure a gradle.properties has the cache switches on, in place.
 *
 * The bench app's `android/` tree is generated by `expo prebuild`, so a tracked
 * edit there would be wiped by the next prebuild - this is applied after every
 * prebuild instead, and is a no-op once the lines are there.
 *
 * @param {string} text the file as it is now
 * @param {Record<string, string>} settings key -> value, e.g. `{ 'org.gradle.caching': 'true' }`
 * @returns {{text: string, changed: string[]}} `changed` lists the keys it wrote
 */
export function withGradleProperties(text, settings) {
  const changed = [];
  const lines = text.split('\n');
  const endsWithNewline = text.endsWith('\n');
  for (const [key, value] of Object.entries(settings)) {
    const assignment = `${key}=${value}`;
    // Match `key=` and the commented `#key=` / `# key =` forms an Expo or RN
    // template leaves behind, so the switch is set rather than doubled.
    const index = lines.findIndex((line) => {
      const stripped = line.trimStart().replace(/^#\s*/, '');
      const separator = stripped.indexOf('=');
      if (separator === -1) return false;
      return stripped.slice(0, separator).trim() === key;
    });
    if (index === -1) {
      if (endsWithNewline) {
        lines.splice(lines.length - 1, 0, assignment);
      } else {
        lines.push(assignment);
      }
      changed.push(key);
      continue;
    }
    if (lines[index].trim() !== assignment) {
      lines[index] = assignment;
      changed.push(key);
    }
  }
  return { text: lines.join('\n'), changed };
}
