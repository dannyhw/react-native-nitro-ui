/**
 * `app.stamp`: prove a device gate is testing the code in front of it.
 *
 * `scripts/app-stamp-core.mjs` holds the decisions; this is the half that talks
 * to git, the filesystem and a built binary. Two kinds of caller:
 *
 *   - `scripts/build-app.mjs` writes a stamp after a verified build;
 *   - the harness config and the real-input entry scripts call
 *     `assertFreshApp()` and refuse when the stamp no longer matches.
 *
 * See `scripts/app-stamp-core.mjs` for why this gate exists.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  STAMP_BASENAME,
  codeTreeDigest,
  findRepoRoot,
  contentHash,
  countOccurrences,
  decideFreshness,
  dexBlobs,
  isCodeFile,
  parseAndroidComponentNames,
  parseIosComponentNames,
} from './app-stamp-core.mjs';

/**
 * The checkout this call belongs to, found by walking up for a marker rather
 * than from `import.meta.url`: `example/rn-harness.config.mjs`, the real-input
 * scripts and `build-app.mjs` all call in with a different working directory, and
 * a module-level constant computed from one of them would be wrong for the rest.
 * It also keeps this module importable from jest, which rejects `import.meta`.
 */
export function repoRootOf(startDir = process.cwd()) {
  return findRepoRoot({
    startDir: path.resolve(startDir),
    existsSync: (file) => fs.existsSync(file),
    sep: path.sep,
  });
}

/** The iOS product of `scripts/build-app.mjs --platform ios`. */
export function iosAppPath(repoRoot = repoRootOf()) {
  return path.join(
    repoRoot,
    'example',
    'ios',
    'build',
    'Build',
    'Products',
    'Debug-iphonesimulator',
    'NitroUiExample.app'
  );
}

/** The Android product of `scripts/build-app.mjs --platform android`. */
export function androidApkPath(repoRoot = repoRootOf()) {
  return path.join(
    repoRoot,
    'example',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk'
  );
}

/** Both live under a gitignored `build/` directory, per platform. */
export function stampPath({ repoRoot = repoRootOf(), platform }) {
  return platform === 'ios'
    ? path.join(repoRoot, 'example', 'ios', 'build', STAMP_BASENAME)
    : path.join(repoRoot, 'example', 'android', 'app', 'build', STAMP_BASENAME);
}

/** @param {'ios'|'android'} platform */
export function artifactPath({ repoRoot = repoRootOf(), platform }) {
  return platform === 'ios' ? iosAppPath(repoRoot) : androidApkPath(repoRoot);
}

/**
 * The code tree as it stands on disk: tracked files plus untracked ones git is
 * not ignoring. Content-hashed rather than taken from `git write-tree` because
 * the working tree is usually dirty here, and the app was built from *that*.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {{tree: string, head: string, files: number}} [options.cached] reuse
 *   within one process; the harness config and a build both ask more than once
 * @returns {{tree: string, head: string, files: number}}
 */
export function currentCodeTree({
  repoRoot = repoRootOf(),
  cached = null,
} = {}) {
  if (cached != null) return cached;
  const head = git(repoRoot, ['rev-parse', 'HEAD'], '<none>');
  const listing = git(repoRoot, [
    '-c',
    'core.quotepath=false',
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  const entries = {};
  let files = 0;
  for (const file of listing.split('\0')) {
    if (file === '' || !isCodeFile(file)) continue;
    const absolute = path.join(repoRoot, file);
    let stats;
    try {
      stats = fs.lstatSync(absolute);
    } catch {
      // Deleted in the working tree, so it is not in the app: absent from the
      // digest, which is what makes a `git rm` show up as staleness.
      continue;
    }
    if (stats.isSymbolicLink()) {
      entries[file] = contentHash(`link:${fs.readlinkSync(absolute)}`);
    } else if (stats.isFile()) {
      entries[file] = contentHash(fs.readFileSync(absolute));
    } else {
      continue;
    }
    files += 1;
  }
  return { tree: codeTreeDigest(entries, head), head, files };
}

/**
 * @param {string} repoRoot
 * @param {string[]} args
 * @param {string} [fallback] returned instead of throwing when git fails, so a
 *   machine without a `HEAD` (a shallow clone) still gets a tree, not a crash
 * @returns {string} trimmed stdout
 */
function git(repoRoot, args, fallback) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (fallback != null) return fallback;
    throw error;
  }
}

/**
 * The components the app is supposed to register, read from nitrogen's generated
 * sources for that platform - see `parseIosComponentNames` for why generated
 * beats a hand-kept list.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {'ios'|'android'} [options.platform] both when omitted
 * @returns {string[]}
 */
export function registeredComponents({
  repoRoot = repoRootOf(),
  platform = null,
} = {}) {
  const names = new Set();
  if (platform == null || platform === 'ios') {
    const autolinking = path.join(
      repoRoot,
      'nitrogen',
      'generated',
      'ios',
      'NitroUiAutolinking.swift'
    );
    for (const name of parseIosComponentNames(
      fs.readFileSync(autolinking, 'utf8')
    )) {
      names.add(name);
    }
  }
  if (platform == null || platform === 'android') {
    const specs = path.join(
      repoRoot,
      'nitrogen',
      'generated',
      'android',
      'kotlin',
      'com',
      'margelo',
      'nitro',
      'nitroui'
    );
    for (const name of parseAndroidComponentNames(
      fs.existsSync(specs) ? fs.readdirSync(specs) : []
    )) {
      names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * How many times each component's hybrid class appears in the built artifact.
 *
 * On iOS the app's own code is in `NitroUiExample.debug.dylib` (Xcode's debug
 * dylib injection), not in the 40 KB stub executable, so both the executable and
 * the bundle's `.dylib`s are scanned. Frameworks are not: they are RN's, and if
 * a component ever moves there the refusal names the files it looked at.
 *
 * @param {object} options
 * @param {'ios'|'android'} options.platform
 * @param {string} options.artifact
 * @param {string[]} options.components
 * @param {((message: string) => void)} [options.warn]
 * @returns {{counts: Record<string, number>, scanned: string[], missing: string[]}}
 */
export function inspectArtifact({
  platform,
  artifact,
  components,
  warn = (message) => process.stderr.write(`app.stamp: ${message}\n`),
}) {
  const scanned = [];
  const buffers = [];
  if (platform === 'ios') {
    if (!fs.existsSync(artifact)) {
      throw new Error(`${artifact} does not exist - build it first`);
    }
    // Every executable in the bundle root: the `CFBundleExecutable` stub, the
    // `*.debug.dylib` the code actually lives in, and `__preview.dylib`. Read
    // off the mode bits rather than Info.plist, which Xcode writes as a binary
    // plist (parsing it would need `plutil`, i.e. a macOS-only dependency).
    for (const entry of fs.readdirSync(artifact)) {
      const candidate = path.join(artifact, entry);
      let stats;
      try {
        stats = fs.lstatSync(candidate);
      } catch {
        continue;
      }
      // eslint-disable-next-line no-bitwise -- the executable bit is the test.
      if (!stats.isFile() || (stats.mode & 0o111) === 0) continue;
      if (fs.existsSync(candidate)) {
        scanned.push(path.relative(artifact, candidate));
        buffers.push(fs.readFileSync(candidate));
      }
    }
  } else {
    if (!fs.existsSync(artifact)) {
      throw new Error(`${artifact} does not exist - build it first`);
    }
    const { blobs, source } = dexBlobs(fs.readFileSync(artifact), warn);
    scanned.push(`${blobs.length} dex entries (${source})`);
    buffers.push(...blobs);
  }

  const counts = {};
  for (const component of components) {
    const needle = `HybridNitroUi${component}`;
    counts[component] = buffers.reduce(
      (total, buffer) => total + countOccurrences(buffer, needle),
      0
    );
  }
  return {
    counts,
    scanned,
    missing: components.filter((component) => counts[component] === 0),
  };
}

/** @param {string} file @returns {object | null} */
export function readStamp(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (/** @type {{code?: string}} */ (error).code === 'ENOENT') return null;
    throw new Error(`${file} is not readable JSON: ${String(error.message)}`);
  }
}

/**
 * Record what a finished build contained. Called by `build-app.mjs` after it has
 * verified the binary, so a stamp is a claim about a build that passed.
 *
 * @param {object} options
 * @param {string} [options.repoRoot]
 * @param {'ios'|'android'} options.platform
 * @param {string} options.artifact
 * @param {((message: string) => void)} [options.log]
 * @returns {object} the stamp
 */
export function recordBuild({
  repoRoot = repoRootOf(),
  platform,
  artifact,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  const components = registeredComponents({ repoRoot, platform });
  if (components.length === 0) {
    throw new Error(
      `no registered components found in nitrogen/generated for ${platform} - ` +
        'run `bun run nitrogen` (the gate cannot prove anything without them)'
    );
  }
  const { counts, scanned, missing } = inspectArtifact({
    platform,
    artifact,
    components,
  });
  const tree = currentCodeTree({ repoRoot });
  if (missing.length > 0) {
    throw new Error(
      `${path.basename(artifact)} does not contain ${missing.join(', ')} ` +
        `(scanned: ${scanned.join(', ')})`
    );
  }
  const stamp = {
    version: 1,
    platform,
    artifact,
    builtAt: new Date().toISOString(),
    tree: tree.tree,
    head: tree.head,
    files: tree.files,
    counts,
    scanned,
  };
  const file = stampPath({ repoRoot, platform });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(stamp, null, 2)}\n`);
  fs.renameSync(tmp, file);
  log(
    `app.stamp: ${file}\n` +
      `           tree ${tree.tree.slice(0, 12)} (${String(tree.files)} files) ` +
      `head ${tree.head.slice(0, 8) || 'unknown'} · ` +
      `${Object.keys(counts).length} components, ` +
      `${Math.min(...Object.values(counts))}..${Math.max(...Object.values(counts))} mentions`
  );
  return stamp;
}

/** Raised by `assertFreshApp`, so a caller can print it red and stop early. */
export class StaleAppError extends Error {}

/**
 * The gate. Throws `StaleAppError` with the reason and the fix.
 *
 * @param {object} options
 * @param {string} [options.repoRoot]
 * @param {'ios'|'android'} options.platform
 * @param {string} options.artifact the `.app` or `.apk` about to be tested
 * @param {string} [options.command] what is starting, for the message
 * @param {((message: string) => void)} [options.warn]
 * @returns {object} the stamp that was checked
 */
export function assertFreshApp({
  repoRoot = repoRootOf(),
  platform,
  artifact,
  command = 'this run',
  warn = (message) => process.stderr.write(`app.stamp: ${message}\n`),
}) {
  const file = stampPath({ repoRoot, platform });
  const stamp = readStamp(file);
  const components = registeredComponents({ repoRoot, platform });
  if (!fs.existsSync(artifact)) {
    throw new StaleAppError(
      `${command}: ${artifact} does not exist.\n` +
        `       build it: node scripts/build-app.mjs --platform ${platform}`
    );
  }
  const { counts } = inspectArtifact({ platform, artifact, components, warn });
  const decision = decideFreshness({
    stamp,
    current: currentCodeTree({ repoRoot }),
    platform,
    artifact,
    components,
    counts,
  });
  if (decision.ok) return stamp;
  throw new StaleAppError(
    `${command}: refusing to run against a stale app.\n` +
      decision.problems.map((problem) => `       - ${problem}`).join('\n') +
      `\n     ${decision.fix}`
  );
}

/**
 * Red for a refusal, green for a pass - only when the stream is a terminal, so
 * a CI log and a report transcript stay free of escape codes.
 *
 * @param {string} text
 * @param {'red'|'green'} color
 * @param {{isTTY?: boolean}} [stream]
 */
export function colorize(text, color, stream = process.stderr) {
  if (stream?.isTTY !== true) return text;
  return color === 'red'
    ? `\u001B[31m${text}\u001B[0m`
    : `\u001B[32m${text}\u001B[0m`;
}
