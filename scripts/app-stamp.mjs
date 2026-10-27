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
  // HEAD is read for the stamp's own record ("which commit built this"), not for
  // the digest: see codeTreeDigest. A docs-only commit must not invalidate a
  // build, and it did until review M4.
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
  // No head here: the digest is the files the compiler read (review M4).
  return { tree: codeTreeDigest(entries), head, files };
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
 * A digest of the bytes the gate actually looked at.
 *
 * The stamp has to bind to a file, and the honest way to say "the same file" is
 * the content it was checked against - not its inode, its mtime, or the path
 * string, each of which survives a copy, a `touch` or another worktree. Size
 * goes in as well so a file whose scanned region happens to be unchanged but
 * which grew elsewhere is still a different artifact.
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
 * Record what a finished build contained. Called by `build-app.mjs` after it has
 * verified the binary, so a stamp is a claim about a build that passed.
 *
 * @param {object} options
 * @param {string} [options.repoRoot]
 * @param {'ios'|'android'} options.platform
 * @param {string} options.artifact
 * @param {{tree: string, head: string, files: number}} [options.treeBefore] the
 *   code tree as it was when the build started. A stamp is a claim that this
 *   binary came from these sources, so it can only be made when the sources did
 *   not move while the compiler was reading them.
 * @param {string} [options.abis] the Android ABIs the artifact was built for,
 *   as they were passed to gradle (`arm64-v8a`, or a comma-separated list).
 *   Omitted for iOS and for a stamp that does not know.
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
  // M3: the tree the build started from has to be the tree the stamp describes.
  // A build that ran while files changed proves nothing about either - the most
  // likely shape is a generator (nitrogen, pod install, a second task in the same
  // checkout) writing during the compile, and the most likely outcome is a green
  // stamp over a binary that does not match the sources anyone can see. Checked
  // first, before anything is read out of the artifact: the claim this function
  // is about to make is already broken, and proving that needs no binary. So
  // nothing is written, and the fix is the same build again.
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
    // Version 2: artifactPath and fingerprint bind the stamp to the file it
    // was read from (review M2). A v1 stamp cannot be checked against them, and
    // decideFreshness says so rather than guessing.
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
  // Which ABIs went into an Android artifact (review M1). The stamp path and the
  // APK path are both fixed per worktree, so nothing else in here says whether
  // the file on disk is arm64-v8a, x86_64, or all four - and `build-app.mjs`
  // needs that to decide whether this artifact is the build that was asked for.
  // Left out rather than set to null for iOS, where there is no such thing, and
  // no version bump: a stamp without the field is simply one written before it
  // existed, which the skip reads as "unknown" and builds.
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
 * The absolute, symlink-free path of an artifact, or the input when even that
 * fails. Two checkouts hold the same relative path; `realpath` is what tells
 * them apart (`/tmp` on macOS is itself a symlink, so a resolved path is what
 * two processes on the same file agree on).
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

/** Raised by `assertFreshApp`, so a caller can print it red and stop early. */
export class StaleAppError extends Error {}

/**
 * Decide, without refusing anything: does the artifact at this path really come
 * from this code tree?
 *
 * `assertFreshApp` is the same question with a throw attached, and
 * `scripts/build-app.mjs` needs the answer the other way round - it skips the
 * build when the answer is yes, so a "no" here is a normal sentence in a log,
 * not an error. Both callers go through this one so they can never disagree.
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
  const decision = checkFreshApp({ repoRoot, platform, artifact, warn });
  if (decision.ok) return decision.stamp;
  // The difference matters for the message: a missing artifact is "go build
  // one", anything else is "what you have does not match this tree". Flag, not
  // string match - rewording a problem sentence must not silently change which
  // of the two the gate says.
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
