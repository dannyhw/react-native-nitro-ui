/**
 * Which app versions a measurement belongs to, and where that answer came from.
 *
 * A baseline's ratios divide by `rn-core`, so an `@expo/ui` bump moves the two
 * reference arms and a React Native bump moves every row in the file. That makes
 * both versions a **comparability regime** — the same kind of thing as a simulator
 * runtime or an ART compile state (`docs/architecture/benchmarks.md`) — and a
 * merged baseline can only be checked against one if it says which versions its
 * cells were measured with (X14).
 *
 * Three sources, in order of what they can prove:
 *
 * 1. `bun.lock` — what `bun install` would install for this commit's
 *    `bench/package.json`. Committed, so it is also readable at *another* commit,
 *    which is how a baseline file older than this field still gets its versions
 *    (`resolvedDependenciesAt()`).
 * 2. The workspace manifest — the range the app asks for (`"react-native":
 *    "0.88.0"`). Recorded as the `requested` half so a caret range and an exact
 *    pin are not silently the same claim.
 * 3. The installed package — what Metro actually folded into the bundle. The only
 *    direct evidence about the binary that was measured, and the one an out-of-date
 *    `node_modules` can contradict; `installedDependenciesProblem()` is that check.
 *
 * No `import.meta` here, for the reason `format.mjs` documents: the paths come in
 * as arguments, so `scripts/__tests__/bench-deps.test.js` can hand this a fixture
 * lock file instead of the repo's.
 */

/** The two dependencies a baseline records, and what a run should call them. */
export const TRACKED_DEPENDENCIES = {
  reactNative: 'react-native',
  expoUi: '@expo/ui',
};

/**
 * The version `bun.lock` pins for one package name.
 *
 * The lock's `packages` table maps a name to `["name@version", …]`, with peer
 * resolutions spelled `name@1.2.3(peer@4)` and workspace entries spelled
 * `name@workspace:.`. Only a plain `name@version` counts; anything else is null,
 * because a version this function invented would be a comparison the guard then
 * passed for no reason.
 *
 * @param {any} lock parsed `bun.lock`
 * @param {string} name e.g. `@expo/ui`
 * @returns {string | null}
 */
export function lockedVersion(lock, name) {
  const packages = lock?.packages ?? lock;
  const entry = packages?.[name];
  const spec = Array.isArray(entry) ? entry[0] : entry;
  if (typeof spec !== 'string') {
    return null;
  }
  const withoutPeers = spec.split('(')[0];
  const at = withoutPeers.lastIndexOf('@');
  if (at <= 0) {
    return null;
  }
  const version = withoutPeers.slice(at + 1);
  return /^\d/.test(version) ? version : null;
}

/**
 * The version range `bench/package.json` asks for, or null.
 *
 * @param {any} manifest parsed `bench/package.json`
 * @param {string} name
 */
export function requestedVersion(manifest, name) {
  const deps = manifest?.dependencies;
  const value = deps?.[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads one package's identity out of an install directory.
 *
 * `node_modules/<name>/package.json` is the only record of what was actually
 * bundled, and a package that is not installed at all is null rather than a guess.
 *
 * @param {any} manifest parsed `node_modules/<name>/package.json`
 */
export function installedVersion(manifest) {
  const version = manifest?.version;
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/**
 * The versions a measurement belongs to, from a lock file and a manifest.
 *
 * `reactNative`/`expoUi` are the *resolved* versions — the ones that decide
 * comparability — and `requested*` is what the manifest asked for, kept because a
 * lock that resolved a caret range to something else is exactly the surprise the
 * `source` field exists to make visible.
 *
 * @param {{ lockText: string | null, manifestText: string | null, source: string }} input
 * @returns {{reactNative: string | null, expoUi: string | null, source: string,
 *   requestedReactNative: string | null, requestedExpoUi: string | null, problems: string[]}}
 */
export function resolvedDependencies({ lockText, manifestText, source }) {
  const problems = [];
  let lock = null;
  let manifest = null;
  // Whether the lock itself was unreadable, which is one problem and explains
  // every null in it. Tracked separately from `problems` because a *missing
  // package* also pushes a message that starts with `source`, and testing for
  // that prefix instead suppressed the second package's own complaint.
  let lockUnreadable = false;
  if (lockText == null) {
    lockUnreadable = true;
    problems.push(`${source}: could not be read`);
  } else {
    try {
      lock = JSON.parse(lockText);
    } catch (error) {
      lockUnreadable = true;
      problems.push(
        `${source}: is not JSON (${String(error instanceof Error ? error.message : error)})`
      );
    }
  }
  if (manifestText != null) {
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      // The manifest is the weaker half of the record; a lock still answers the
      // comparability question on its own, so this is not a problem to report.
      manifest = null;
    }
  }
  const out = {
    reactNative: lock == null ? null : lockedVersion(lock, 'react-native'),
    expoUi: lock == null ? null : lockedVersion(lock, '@expo/ui'),
    requestedReactNative:
      manifest == null ? null : requestedVersion(manifest, 'react-native'),
    requestedExpoUi:
      manifest == null ? null : requestedVersion(manifest, '@expo/ui'),
    source,
    problems,
  };
  for (const [key, name] of Object.entries(TRACKED_DEPENDENCIES)) {
    if (out[key] == null && !lockUnreadable) {
      problems.push(`${source}: no resolved version for ${name}`);
    }
  }
  return out;
}

/**
 * Reads `bun.lock` and `bench/package.json` **at a git revision**, for the case
 * where a baseline file is older than this field and its own `sha` is the only
 * record of what app produced it.
 *
 * Read-only (`git show`), and null-ish on any failure — an unreadable revision is
 * a refusal downstream, never a version invented from the working tree, which
 * would be a different app's number wearing the founding commit's name.
 *
 * @param {{ git?: (args: string[]) => string | null, rev: string }} input
 * @returns {{ lockText: string | null, manifestText: string | null }}
 */
export function dependenciesSourceAt({ git, rev }) {
  const show = (file) => {
    if (git == null || rev == null || rev === '') {
      return null;
    }
    try {
      return git(['show', `${rev}:${file}`]);
    } catch {
      return null;
    }
  };
  return {
    lockText: show('bun.lock'),
    manifestText: show('bench/package.json'),
  };
}

/**
 * Why the installed packages do not match the lock the run's own commit names.
 *
 * The numbers come from the binary Metro built, so a stale `node_modules` makes
 * the recorded versions a statement about a file that was never measured. Null
 * means "nothing contradicts the lock" — including the case where nothing is
 * installed to check, which is what a checkout that has not run `bun install`
 * looks like from here.
 *
 * @param {{ resolved: {reactNative: string|null, expoUi: string|null}, installed?: {reactNative: string|null, expoUi: string|null} | null }} input
 * @returns {string | null}
 */
export function installedDependenciesProblem({ resolved, installed }) {
  if (resolved == null || installed == null) {
    return null;
  }
  const differs = [];
  for (const [key, name] of Object.entries(TRACKED_DEPENDENCIES)) {
    if (
      installed[key] != null &&
      resolved[key] != null &&
      installed[key] !== resolved[key]
    ) {
      differs.push(
        `${name}: installed ${installed[key]}, lock ${resolved[key]}`
      );
    }
  }
  if (differs.length === 0) {
    return null;
  }
  return `the bench app's install does not match its lock file (${differs.join(
    '; '
  )}), so the numbers were measured with a different app than this commit's \`bun.lock\` names - run \`bun install\` and measure again`;
}
