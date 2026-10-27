/**
 * The decisions behind the faster local/agent build (X6), kept free of I/O so
 * they are testable: which Android ABI to build, what ccache needs in the
 * environment, when a build can be skipped, and what a generated Gradle
 * properties file must contain.
 *
 * Nothing here is allowed to change what a *library user* sees. These decisions
 * live in `scripts/`, the example app and the bench app - never in
 * `android/build.gradle`, `NitroUi.podspec`, `src/`, `ios/`, `cpp/` or
 * `nitrogen/`, all of which ship in the npm package.
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
 *
 * `example/android/gradle.properties` keeps the four-ABI default on purpose: it
 * is what a hand-run gradle command and the release build produce. Every script
 * build passes this argument, so the narrowed build is the one agents get.
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
 *   same file in `X6/` and in a fresh worktree hashes the same;
 * - `CCACHE_NOHASHDIR=1` stops the compile-time working directory entering the
 *   hash, which is the other half of that cross-worktree hit. It has no
 *   underscore: `CCACHE_HASH_DIR` is not an environment variable ccache reads,
 *   so writing that leaves `hash_dir` on and every second-worktree compile a
 *   silent miss. `ccacheEffectiveForWorktrees()` is how the build notices.
 *
 * Both are environment variables rather than a config file on purpose. On macOS
 * ccache reads `~/Library/Preferences/ccache/ccache.conf`, and only falls back to
 * `$XDG_CONFIG_HOME/ccache/ccache.conf` when that variable is set - so a file at
 * `~/.config/ccache/ccache.conf` is read for *no* build here, iOS or Android.
 * React Native's `ccache-clang.sh` then points `CCACHE_CONFIGPATH` at *its* own
 * file for the iOS compiles, which replaces the user config entirely. Neither
 * file is something a repo could write anyway without carrying a machine path,
 * and an exported variable outranks whatever is in them.
 *
 * `CCACHE_BINARY` is here for a subtler reason. iOS compiles go through React
 * Native's `ccache-clang.sh`, whose last line is `exec $CCACHE_BINARY clang`,
 * and React Native supplies that path as an Xcode *build setting* - which Xcode
 * does not put in the environment of the compiler it launches. An empty
 * variable there means the wrapper runs plain clang: no error, no cache, no
 * hint. A build that says it uses ccache should have set the variable it is
 * read from, so it is exported here too.
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
 * Did ccache really take both of those settings?
 *
 * `ccache --show-config` prints the effective value of every setting next to
 * where it came from, which is the only way to tell a variable ccache reads from
 * one it quietly ignores. A build with `hash_dir` still on is not broken - it is
 * just slow in a way nobody sees, so this is a warning and never a failure.
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
 * configures (the library's CMake and nitro-modules' - both outside the files
 * this repo may edit for packaging reasons).
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
 * Where an iOS build's compiled modules go, and why a ccache build needs its
 * own copy of that directory.
 *
 * `CCACHE_BASEDIR` does not only shorten what ccache hashes: clang writes the
 * paths it recorded into the `.pcm` files it produces, so a ccache build puts
 * module paths relative to the worktree into the module cache. Xcode's default
 * is one directory per derived data path, and every build that shares that
 * derived data shares it - including a plain `xcodebuild` with no ccache in its
 * environment, which reads those same `.pcm` files and finds `Foundation`
 * defined in both spellings of one path. That is not a cache miss; the compile
 * stops with a fatal error, in a directory the next `pod install` does not
 * clear.
 *
 * So the rule is: whoever sets `CCACHE_BASEDIR` also names its module cache.
 * A plain build is passed the default explicitly rather than inheriting it, so
 * the two are compared as two values instead of one value and an assumption
 * about what Xcode would have chosen.
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

/**
 * Do two ABI lists mean the same build?
 *
 * Compared as sets: `arm64-v8a,x86_64` and `x86_64,arm64-v8a` are one build, so
 * the order gradle was handed them in changes nothing about the APK. A missing
 * or empty list never matches: `null` is a stamp written before ABIs were
 * recorded, which says nothing about what is in the artifact, and "nothing
 * known" is not an agreement with what the caller just asked for.
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
 * Should `build-app.mjs` skip a build?
 *
 * Only when the caller asked for nothing specific: no `--force`, no `--clean`,
 * no `--no-stamp`, and the stamp already proves the artifact at the fixed path
 * was built from this exact code tree. Anything else builds. A build is the safe
 * answer; a skip is the earned one.
 *
 * For Android, "the same code tree" is not the whole question. The artifact path
 * is fixed per worktree, so an `arm64-v8a` APK and an `x86_64` one are the same
 * file, and the code tree is the same whether gradle was asked for one ABI or
 * four. A stamp that did not record the ABIs cannot tell them apart, and
 * guessing serves an `arm64-v8a` APK to a run that asked for `x86_64`: the
 * install then fails with `INSTALL_FAILED_NO_MATCHING_ABIS`, or a multi-ABI
 * request quietly gets a one-ABI artifact. So an Android skip needs the ABIs to
 * match exactly, and a stamp without them means build.
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
    // Two different sentences: "the stamp says something else" is worth reading,
    // "the stamp says nothing" is worth *fixing*, and they look the same in the
    // log if the empty one is printed as a blank ABI list.
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
