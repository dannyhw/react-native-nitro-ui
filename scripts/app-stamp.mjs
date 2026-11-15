/**
 * `app.stamp`: proves a device gate is testing the code in front of it. This is
 * the half that talks to git, the filesystem and a built binary.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  STAMP_BASENAME,
  codeTreeDigest,
  componentNeedle,
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
 * The checkout this call belongs to, found by walking up for a marker: callers
 * run from different working directories, and jest rejects `import.meta`.
 */
export function repoRootOf(startDir = process.cwd()) {
  return findRepoRoot({
    startDir: path.resolve(startDir),
    existsSync: (file) => fs.existsSync(file),
    sep: path.sep,
  });
}

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
 * the app is built from the working tree, which is usually dirty.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {{tree: string, head: string, files: number}} [options.cached] reuse
 *   within one process
 * @returns {{tree: string, head: string, files: number}}
 */
export function currentCodeTree({
  repoRoot = repoRootOf(),
  cached = null,
} = {}) {
  if (cached != null) return cached;
  // HEAD is recorded in the stamp but kept out of the digest, so a docs-only
  // commit does not invalidate a build.
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
      // Deleted in the working tree: leaving it out of the digest is what makes
      // a removed file show up as staleness.
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
  return { tree: codeTreeDigest(entries), head, files };
}

/**
 * @param {string} repoRoot
 * @param {string[]} args
 * @param {string} [fallback] returned instead of throwing when git fails
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
 * sources for that platform.
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
 * On iOS a debug build keeps the app's own code in `NitroUiExample.debug.dylib`,
 * not in the stub executable, so every executable in the bundle root is scanned.
 * Frameworks are not.
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
    // Executables are found by mode bits: Info.plist is a binary plist here.
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
    const needle = componentNeedle(platform, component);
    counts[component] = buffers.reduce(
      (total, buffer) => total + countOccurrences(buffer, needle),
      0
    );
  }
  return {
    counts,
    scanned,
    fingerprint: fingerprintOf({ artifact, scanned, buffers }),
    missing: components.filter((component) => counts[component] === 0),
  };
}

/**
 * A digest of the scanned bytes plus the artifact's size, so a file that
 * changed only outside the scanned region is still a different artifact.
 *
 * @param {object} options
 * @param {string} options.artifact
 * @param {string[]} options.scanned
 * @param {Buffer[]} options.buffers
 * @returns {string}
 */
function fingerprintOf({ artifact, scanned, buffers }) {
  const hash = createHash('sha256');
  hash.update(`size:${String(fs.statSync(artifact).size)}\n`);
  scanned.forEach((name, index) => {
    const buffer = buffers[index];
    if (buffer == null) return;
    hash.update(`${name}: ${contentHash(buffer)}\n`);
  });
  return hash.digest('hex');
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
 * Records what a finished, verified build contained.
 *
 * @param {object} options
 * @param {string} [options.repoRoot]
 * @param {'ios'|'android'} options.platform
 * @param {string} options.artifact
 * @param {{tree: string, head: string, files: number}} [options.treeBefore] the
 *   code tree as it was when the build started; a different tree now throws
 * @param {string} [options.abis] the Android ABIs the artifact was built for,
 *   as they were passed to gradle (`arm64-v8a`, or a comma-separated list).
 *   Omitted for iOS.
 * @param {((message: string) => void)} [options.log]
 * @returns {object} the stamp
 */
export function recordBuild({
  repoRoot = repoRootOf(),
  platform,
  artifact,
  treeBefore = null,
  abis = null,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  // A build that ran while files changed (a generator writing mid-compile) does
  // not prove which sources the binary came from, so no stamp is written.
  const tree = currentCodeTree({ repoRoot });
  if (treeBefore != null && treeBefore.tree !== tree.tree) {
    throw new Error(
      `the code tree changed during the build ` +
        `(before ${treeBefore.tree.slice(0, 12)}, after ${tree.tree.slice(0, 12)}: ` +
        `${String(treeBefore.files)} files when it started, ${String(tree.files)} now). ` +
        'No stamp was written - nothing here proves which sources this binary ' +
        'came from. Run the build again with nothing else writing to the tree.'
    );
  }
  const components = registeredComponents({ repoRoot, platform });
  if (components.length === 0) {
    throw new Error(
      `no registered components found in nitrogen/generated for ${platform} - ` +
        'run `bun run nitrogen` (the gate cannot prove anything without them)'
    );
  }
  const inspected = inspectArtifact({ platform, artifact, components });
  const { counts, scanned, missing } = inspected;
  if (missing.length > 0) {
    throw new Error(
      `${path.basename(artifact)} does not contain ${missing.join(', ')} ` +
        `(scanned: ${scanned.join(', ')})`
    );
  }
  const stamp = {
    // Version 2 adds artifactPath and fingerprint, which bind the stamp to the
    // file it was read from.
    version: 2,
    platform,
    artifact,
    artifactPath: realpath(artifact),
    fingerprint: inspected.fingerprint,
    builtAt: new Date().toISOString(),
    tree: tree.tree,
    head: tree.head,
    files: tree.files,
    counts,
    scanned,
  };
  // The APK path is the same for every ABI set, so the stamp records which one
  // was built. A stamp without the field reads as "unknown".
  if (abis != null && abis !== '') stamp.abis = abis;
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

/**
 * The absolute, symlink-free path of an artifact, or the resolved input when
 * that fails. `/tmp` on macOS is itself a symlink, so only a resolved path is
 * one that two processes on the same file agree on.
 *
 * @param {string} artifact
 * @returns {string}
 */
export function realpath(artifact) {
  try {
    return fs.realpathSync(artifact);
  } catch {
    return path.resolve(artifact);
  }
}

export class StaleAppError extends Error {}

/**
 * Reports, without throwing, whether the artifact at this path was built from
 * this code tree.
 *
 * @param {object} options
 * @param {string} [options.repoRoot]
 * @param {'ios'|'android'} options.platform
 * @param {string} [options.artifact] the `.app` or `.apk` to look at
 * @param {((message: string) => void)} [options.warn]
 * @returns {{ok: boolean, artifact: string, stamp?: object, missing?: boolean,
 *   problems?: string[], fix?: string}}
 */
export function checkFreshApp({
  repoRoot = repoRootOf(),
  platform,
  artifact = artifactPath({ repoRoot, platform }),
  warn = (message) => process.stderr.write(`app.stamp: ${message}\n`),
}) {
  if (!fs.existsSync(artifact)) {
    return {
      ok: false,
      missing: true,
      artifact,
      problems: [`${artifact} does not exist`],
      fix: `build it: node scripts/build-app.mjs --platform ${platform}`,
    };
  }
  const stamp = readStamp(stampPath({ repoRoot, platform }));
  const components = registeredComponents({ repoRoot, platform });
  const { counts, fingerprint } = inspectArtifact({
    platform,
    artifact,
    components,
    warn,
  });
  const decision = decideFreshness({
    stamp,
    current: currentCodeTree({ repoRoot }),
    platform,
    artifact,
    artifactPath: realpath(artifact),
    fingerprint,
    components,
    counts,
  });
  return decision.ok
    ? { ok: true, artifact, stamp }
    : { ...decision, artifact, stamp };
}

/**
 * Throws `StaleAppError` with the reason and the fix when the app is stale.
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
  const decision = checkFreshApp({ repoRoot, platform, artifact, warn });
  if (decision.ok) return decision.stamp;
  if (decision.missing === true) {
    throw new StaleAppError(
      `${command}: ${decision.problems[0]}.\n` +
        `       build it: node scripts/build-app.mjs --platform ${platform}`
    );
  }
  throw new StaleAppError(
    `${command}: refusing to run against a stale app.\n` +
      decision.problems.map((problem) => `       - ${problem}`).join('\n') +
      `\n     ${decision.fix}`
  );
}

/**
 * Colours the text only when the stream is a terminal.
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
