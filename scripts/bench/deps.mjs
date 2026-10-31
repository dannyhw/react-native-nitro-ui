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
 * Parses a lock file bun actually wrote.
 *
 * `bun.lock` is JSON5-ish, not JSON: bun writes a trailing comma before every
 * `}` and `]` (and allows `//` comments). `JSON.parse` therefore fails on the
 * shipped file — "Expected double-quoted property name" — and a reader that only
 * tries strict JSON resolves *nothing*, on every machine, forever. That is the
 * bug this exists because of: the fixture lock in `bench-deps.test.js` was
 * hand-written strict JSON, so the reader looked fine while the real file made
 * every merge refuse with "could not be read to recover it".
 *
 * Strict JSON is tried first, so a file that is already canonical is never
 * rewritten on the way through. The tolerant pass then walks the text outside
 * string literals: comments are dropped, and a comma whose next non-whitespace
 * token is a closer is dropped. It reuses no dependency, for the reason
 * `format.mjs` documents — this module has to stay importable from the unit
 * tests, which do not install a JSON5 parser.
 *
 * @param {string} text
 * @returns {{ value: any, error: string | null }}
 */
export function parseLockFile(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (strictError) {
    const relaxed = stripJson5Syntax(text);
    try {
      return { value: JSON.parse(relaxed), error: null };
    } catch {
      // Report the strict error: it points at the real text, and the tolerant
      // pass's message would describe characters that are not in the file.
      return {
        value: null,
        error: String(
          strictError instanceof Error ? strictError.message : strictError
        ),
      };
    }
  }
}

/** The above, one pass, single-pass: no rewrite of anything inside a string. */
function stripJson5Syntax(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Keep the escaped character opaque: `\"` is not the end of the string.
        i += 1;
        if (i < text.length) out += text[i];
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === ',' || ch === '}' || ch === ']') {
      // A comma directly before a closer is the trailing one bun writes.
      const tail = out.trimEnd();
      if (ch !== ',' && tail.endsWith(',')) {
        out = tail.slice(0, -1);
      }
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
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
    const parsed = parseLockFile(lockText);
    if (parsed.error != null) {
      lockUnreadable = true;
      problems.push(`${source}: is not JSON (${parsed.error})`);
    } else {
      lock = parsed.value;
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
