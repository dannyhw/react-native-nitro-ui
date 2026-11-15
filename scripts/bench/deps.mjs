/**
 * Which React Native and `@expo/ui` versions a bench measurement belongs to: a bump
 * of either moves the ratios, so runs and baselines record them.
 */

export const TRACKED_DEPENDENCIES = {
  reactNative: 'react-native',
  expoUi: '@expo/ui',
};

/**
 * The version `bun.lock` pins for one package name.
 *
 * The lock's `packages` table maps a name to `["name@version", …]`, with peer
 * resolutions spelled `name@1.2.3(peer@4)` and workspace entries spelled
 * `name@workspace:.`. Only a plain `name@version` counts; anything else is null.
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
 * The version an installed package's manifest names, or null.
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
 * `bun.lock` is not strict JSON: bun writes a trailing comma before every `}`
 * and `]` and allows `//` comments, so `JSON.parse` fails on the real file.
 * Strict JSON is tried first; the tolerant pass then drops comments and trailing
 * commas outside string literals.
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

// One linear pass: the scan remembers the last non-whitespace character it emitted
// instead of trimming the output at every closer, which would be quadratic.
function stripJson5Syntax(text) {
  const parts = [];
  let inString = false;
  // Index in `parts` of the last emitted non-whitespace character, or -1.
  let lastMeaningful = -1;
  const emit = (ch) => {
    parts.push(ch);
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      lastMeaningful = parts.length - 1;
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      emit(ch);
      if (ch === '\\') {
        // Keep the escaped character opaque: `\"` is not the end of the string.
        i += 1;
        if (i < text.length) emit(text[i]);
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      emit(ch);
      continue;
    }
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      emit('\n');
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === ',' || ch === '}' || ch === ']') {
      // A comma directly before a closer is the trailing one bun writes.
      if (ch !== ',' && lastMeaningful >= 0 && parts[lastMeaningful] === ',') {
        parts.length = lastMeaningful;
      }
      emit(ch);
      continue;
    }
    emit(ch);
  }
  return parts.join('');
}

/**
 * The versions a measurement belongs to, from a lock file and a manifest.
 *
 * `reactNative`/`expoUi` are the resolved versions, the ones that decide
 * comparability; `requested*` is the range the manifest asked for.
 *
 * @param {{ lockText: string | null, manifestText: string | null, source: string }} input
 * @returns {{reactNative: string | null, expoUi: string | null, source: string,
 *   requestedReactNative: string | null, requestedExpoUi: string | null, problems: string[]}}
 */
export function resolvedDependencies({ lockText, manifestText, source }) {
  const problems = [];
  let lock = null;
  let manifest = null;
  // An unreadable lock is one problem, not one per package missing from it.
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
      // Not reported: the lock alone answers the comparability question.
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
 * Why the installed packages do not match the lock the run's own commit names.
 *
 * Null means nothing contradicts the lock, including when nothing is installed
 * to check.
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
