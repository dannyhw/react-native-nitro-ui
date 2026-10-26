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
 * - `CCACHE_HASH_DIR=false` stops the compile-time working directory entering
 *   the hash, which is the other half of that cross-worktree hit.
 *
 * Both are environment variables rather than a config file on purpose: React
 * Native's `ccache-clang.sh` points `CCACHE_CONFIGPATH` at *its* config file, so
 * a `~/.config/ccache/ccache.conf` is not read for iOS builds, and a repo cannot
 * write either file without carrying a machine path. Environment wins over both
 * config files.
 *
 * @param {object} options
 * @param {boolean} options.enabled ccache was found on this machine
 * @param {string} options.repoRoot this checkout
 * @returns {Record<string, string>} empty when ccache is not installed
 */
export function ccacheEnv({ enabled, repoRoot }) {
  if (!enabled) return {};
  return {
    CCACHE_BASEDIR: repoRoot,
    CCACHE_HASH_DIR: 'false',
  };
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

/**
 * Should `build-app.mjs` skip a build?
 *
 * Only when the caller asked for nothing specific: no `--force`, no `--clean`,
 * no `--no-stamp`, and the stamp already proves the artifact at the fixed path
 * was built from this exact code tree. Anything else builds. A build is the safe
 * answer; a skip is the earned one.
 *
 * @param {object} options
 * @param {boolean} options.force
 * @param {boolean} options.clean
 * @param {boolean} options.noStamp
 * @param {boolean} options.fresh the stamp matches the tree and the artifact
 * @param {string | null} [options.freshReason] why it is not fresh, for the log
 * @returns {{skip: boolean, reason: string}}
 */
export function decideSkipBuild({
  force,
  clean,
  noStamp,
  fresh,
  freshReason = null,
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
