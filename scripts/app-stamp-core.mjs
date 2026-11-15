/**
 * The pure half of `app.stamp`: a build records the code tree it was built from and
 * the components its binary contains, and every device gate re-derives and compares.
 */

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/** A path that exists only at the repo root, and only once code is generated. */
export const REPO_MARKER = [
  'nitrogen',
  'generated',
  'ios',
  'NitroUiAutolinking.swift',
];

/**
 * @param {object} options
 * @param {string} options.startDir
 * @param {(file: string) => boolean} options.existsSync
 * @param {string} [options.sep]
 * @returns {string} the nearest ancestor of `startDir` that is a nitro-ui root
 */
export function findRepoRoot({ startDir, existsSync, sep = '/' }) {
  const marker = REPO_MARKER.join(sep);
  let current = startDir.replace(/\/+$/, '');
  for (;;) {
    if (existsSync(`${current}/${marker}`)) return current;
    const parent = current.slice(0, current.lastIndexOf('/'));
    if (parent === '' || parent === current || current === sep) {
      throw new Error(
        `no nitro-ui checkout above ${startDir}: nothing has ` +
          `${marker}, so the app cannot be stamped. Run this from inside ` +
          'the repository.'
      );
    }
    current = parent;
  }
}

export const STAMP_BASENAME = 'app.stamp';

/** Prefixes that never change the app binary. `bench/` is a separate app. */
export const NON_CODE_PREFIXES = ['docs/', 'bench/', '.github/', '.vscode/'];

/**
 * @param {string} file repo-relative path with forward slashes
 * @returns {boolean} whether this file belongs in the code tree hash
 */
export function isCodeFile(file) {
  if (NON_CODE_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  if (file.endsWith('.md')) return false;
  if (file === STAMP_BASENAME || file.endsWith(`/${STAMP_BASENAME}`))
    return false;
  // A build output is a product of the tree, not part of it.
  return !file.split('/').includes('build');
}

/**
 * A stable digest of `path -> content hash`. Sorted, and hashed as text rather
 * than as JSON so two runs of the same tree agree regardless of key order.
 *
 * HEAD is deliberately not mixed in: it would make a docs-only commit invalidate
 * a build whose sources did not move.
 *
 * @param {Record<string, string>} entries path -> content hash (already digested)
 * @returns {string}
 */
export function codeTreeDigest(entries) {
  const hash = createHash('sha256');
  for (const file of Object.keys(entries).sort()) {
    hash.update(`${file}\0${entries[file]}\n`);
  }
  return hash.digest('hex');
}

/** @param {string|Buffer} content @returns {string} */
export function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * The string that means "this component's *hybrid class* is in the binary".
 *
 * The plain `HybridNitroUi<Name>` is not it: every generated `...Spec` name
 * contains it, so an app that registered only the generated interface would
 * pass. Android asks for the JVM class descriptor, whose leading `L` and
 * trailing `;` no spec name has, and iOS for the length-prefixed name Swift's
 * metadata writes, whose prefix differs for the spec.
 *
 * @param {'ios' | 'android'} platform
 * @param {string} name component name, e.g. `Switch`
 * @returns {string}
 */
export function componentNeedle(platform, name) {
  const symbol = `HybridNitroUi${name}`;
  if (platform === 'android') {
    return `Lcom/margelo/nitro/nitroui/${symbol};`;
  }
  return `${symbol.length}${symbol}`;
}

/**
 * The iOS registration list, read out of nitrogen's autolinker: every
 * `createNitroUi<Name>()` there is a hybrid the app can be asked to instantiate.
 *
 * @param {string} source contents of `nitrogen/generated/ios/NitroUiAutolinking.swift`
 * @returns {string[]} component names, e.g. `['Button', 'Switch', ...]`
 */
export function parseIosComponentNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/create(NitroUi[A-Za-z]+)\s*\(\s*\)/g)) {
    names.add(match[1].replace(/^NitroUi/, ''));
  }
  return [...names].sort();
}

/**
 * The Android list, from nitrogen's generated spec files
 * (`HybridNitroUi<Name>Spec.kt`).
 *
 * @param {string[]} fileNames base names in `nitrogen/generated/android/**`
 * @returns {string[]}
 */
export function parseAndroidComponentNames(fileNames) {
  const names = new Set();
  for (const file of fileNames) {
    const match = /HybridNitroUi([A-Za-z]+)Spec\.kt$/.exec(file);
    if (match?.[1]) names.add(match[1]);
  }
  return [...names].sort();
}

/**
 * Hybrid class names are present in a binary as plain text (Swift metadata and
 * the C++ mangled names on iOS; the dex type list on Android), so a byte scan
 * finds them.
 *
 * @param {Buffer} buffer
 * @param {string} needle
 * @returns {number}
 */
export function countOccurrences(buffer, needle) {
  const pattern = Buffer.from(needle, 'utf8');
  if (pattern.length === 0) return 0;
  let count = 0;
  for (
    let at = buffer.indexOf(pattern);
    at !== -1;
    at = buffer.indexOf(pattern, at + 1)
  ) {
    count += 1;
  }
  return count;
}

/**
 * Reads a ZIP archive's entries: a `.dex` is deflate-compressed in some AGP
 * configurations, and a class name cannot be found in compressed bytes. Handles
 * stored and deflated entries, which is all an APK contains.
 *
 * @param {Buffer} buffer
 * @returns {{name: string, method: number, data: Buffer}[]}
 */
export function zipEntries(buffer) {
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const LOCAL_SIGNATURE = 0x04034b50;

  let eocd = -1;
  // The end record is in the last 64 KB (a comment may follow it), scanning back.
  const earliest = Math.max(0, buffer.length - 66_000);
  for (let at = buffer.length - 22; at >= earliest; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1)
    throw new Error('not a ZIP archive: no end-of-central-directory');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(
        `not a ZIP archive: bad central directory entry ${String(index)}`
      );
    }
    const method = buffer.readUInt16LE(offset + 10);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`not a ZIP archive: bad local header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    // Prefer the central directory's sizes: a streaming writer leaves the local
    // header's at zero and puts the real values in a data descriptor.
    const size = buffer.readUInt32LE(offset + 20);
    entries.push({ name, method, data: buffer.subarray(start, start + size) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Every `classes*.dex` in an APK, decompressed, plus how they were obtained.
 *
 * @param {Buffer} apkBuffer
 * @param {((message: string) => void)} [warn]
 * @returns {{blobs: Buffer[], source: 'zip'|'apk-bytes'}}
 */
export function dexBlobs(apkBuffer, warn = () => {}) {
  try {
    const blobs = zipEntries(apkBuffer)
      .filter((entry) => /^classes\d*\.dex$/.test(entry.name))
      .map((entry) =>
        entry.method === 0
          ? Buffer.from(entry.data)
          : inflateRawSync(entry.data)
      )
      .sort((a, b) => a.length - b.length);
    if (blobs.length === 0) throw new Error('no classes*.dex entry');
    return { blobs, source: 'zip' };
  } catch (error) {
    // The bytes of a stored dex are still in the APK, so scan the whole file.
    warn(
      `could not read the APK's dex entries (${String(error.message)}); ` +
        'scanning the APK bytes instead, which misses a compressed dex'
    );
    return { blobs: [apkBuffer], source: 'apk-bytes' };
  }
}

/**
 * Which runner this process is starting, read off the command line: the config
 * module is imported before the harness parses its own arguments, and the gate
 * must refuse before a device boots.
 *
 * @param {string[]} argv `process.argv`
 * @returns {'ios'|'android'|null}
 */
export function runnerFromArgv(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--harnessRunner' || argument === '--runner') {
      const value = argv[index + 1];
      if (value === 'ios' || value === 'android') return value;
      return null;
    }
    const inline = /^--(?:harnessRunner|runner)=(ios|android)$/.exec(argument);
    if (inline?.[1] != null) return inline[1];
  }
  return null;
}

/**
 * The subcommands `harness ci …` answers to, which must match `CI_SUBCOMMANDS` in
 * `@react-native-harness/cli/dist/index.js`. They read the harness config without
 * running a device test.
 */
export const HARNESS_CI_SUBCOMMANDS = Object.freeze([
  'load-config',
  'plan-metro-restore',
  'snapshot-metro',
  'plan-metro-save',
]);

/**
 * Which runner this process is starting, read off the environment the
 * `react-native-harness` GitHub Action sets: `INPUT_RUNNER` for its `ci …` steps,
 * which name no runner on their command line, and `HARNESS_RUNNER` for the test
 * run.
 *
 * @param {Record<string, string | undefined>} env `process.env`
 * @returns {'ios'|'android'|null}
 */
export function runnerFromEnv(env) {
  for (const key of ['HARNESS_RUNNER', 'INPUT_RUNNER']) {
    const value = env[key];
    if (value === 'ios' || value === 'android') return value;
  }
  return null;
}

/**
 * What `example/rn-harness.config.mjs` should test:
 *
 *   - `runner`: the platform, from argv, then the action's environment;
 *   - `ciStep`: whether this read is a `harness ci …` step and not a device run,
 *     so the stamp gate does not refuse it;
 *   - `artifact`: an absolute path. `react-native-harness` resolves
 *     `HARNESS_APP_PATH` from the project root (`example/`), so a relative path
 *     that exists from there wins, then one that exists from the repo root.
 *
 * @param {object} options
 * @param {string[]} options.argv `process.argv`
 * @param {Record<string, string | undefined>} options.env `process.env`
 * @param {(file: string) => boolean} options.existsSync
 * @param {string} [options.cwd] the directory the harness starts the CLI from
 * @param {(platform: 'ios'|'android') => string} options.artifactFor the fixed
 *   product of `scripts/build-app.mjs` for a platform
 * @param {string} [options.parentDir] what a repo-root-relative path hangs off
 * @returns {{runner: 'ios'|'android', artifact: string | null, ciStep: boolean}}
 */
export function selectHarnessApp({
  argv,
  env,
  existsSync,
  cwd = '',
  artifactFor,
  parentDir = null,
}) {
  const runner = runnerFromArgv(argv) ?? runnerFromEnv(env) ?? 'ios';
  // `harness ci <subcommand>`: argv[2] is `ci` because bin.js is argv[1].
  // Anything else, including a test file named `ci`, is a device run.
  const ciStep =
    runnerFromArgv(argv) == null &&
    argv[2] === 'ci' &&
    HARNESS_CI_SUBCOMMANDS.includes(String(argv[3] ?? ''));
  const explicit =
    env.HARNESS_APP_PATH == null ? '' : String(env.HARNESS_APP_PATH);
  if (explicit !== '') {
    return {
      runner,
      artifact: resolveAppPath(explicit, { existsSync, cwd, parentDir }),
      ciStep,
    };
  }
  const built = artifactFor(runner);
  return {
    runner,
    artifact: existsSync(built) ? built : null,
    ciStep,
  };
}

/**
 * @param {string} explicit what `HARNESS_APP_PATH` said
 * @param {object} options
 * @param {(file: string) => boolean} options.existsSync
 * @param {string} options.cwd the directory the harness starts the CLI from
 * @param {string | null} [options.parentDir] what a repo-root-relative path hangs off
 * @returns {string} an absolute path
 */
export function resolveAppPath(
  explicit,
  { existsSync, cwd, parentDir = null }
) {
  if (isAbsolutePath(explicit)) return trimTrailingSlash(explicit);
  const fromCwd = joinPath(cwd, explicit);
  if (existsSync(fromCwd)) return fromCwd;
  if (parentDir != null) {
    const fromParent = joinPath(parentDir, explicit);
    if (existsSync(fromParent)) return fromParent;
  }
  // Neither exists: the project root is where the harness will look.
  return fromCwd;
}

/**
 * Not `node:path`, so a Windows-style argument works on any host.
 *
 * @param {string} file
 * @returns {boolean}
 */
function isAbsolutePath(file) {
  return file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file);
}

/**
 * @param {string} base
 * @param {string} file
 * @returns {string}
 */
function joinPath(base, file) {
  if (isAbsolutePath(file)) return trimTrailingSlash(file);
  return trimTrailingSlash(`${base}/${file}`);
}

/**
 * @param {string} file
 * @returns {string}
 */
function trimTrailingSlash(file) {
  return file.replace(/\/+$/, '');
}

/**
 * @param {string} artifact an `.app` or an `.apk`
 * @returns {'ios'|'android'|null}
 */
export function platformForArtifact(artifact) {
  if (artifact.endsWith('.app')) return 'ios';
  if (artifact.endsWith('.apk')) return 'android';
  return null;
}

/**
 * The gate itself: does `app.stamp` still describe this tree and this binary?
 *
 * @param {object} options
 * @param {{tree?: string, head?: string, artifact?: string, artifactPath?: string, fingerprint?: string, counts?: Record<string, number>} | null} options.stamp
 * @param {{tree: string, head: string, files: number}} options.current
 * @param {string} options.platform
 * @param {string} options.artifact
 * @param {string} [options.artifactPath] the resolved path of the artifact under test
 * @param {string} [options.fingerprint] content digest of what was scanned in it
 * @param {string[]} options.components
 * @param {Record<string, number>} [options.counts] what the binary contains now
 * @param {string} [options.buildCommand] the command that fixes it
 * @returns {{ok: true} | {ok: false, problems: string[], fix: string}}
 */
export function decideFreshness({
  stamp,
  current,
  platform,
  artifact,
  components,
  counts = {},
  buildCommand = `node scripts/build-app.mjs --platform ${platform}`,
  artifactPath = null,
  fingerprint = null,
}) {
  const problems = [];
  if (stamp == null || typeof stamp.tree !== 'string') {
    problems.push(
      `no app.stamp for ${platform} at ${artifact}: nothing proves this binary ` +
        'was built from this checkout'
    );
  } else if (stamp.tree !== current.tree) {
    problems.push(
      'the app was built from a different code tree ' +
        `(stamp ${String(stamp.tree).slice(0, 8)} at ${String(stamp.head ?? 'unknown HEAD')}, ` +
        `now ${current.tree.slice(0, 8)} at ${current.head || 'unknown HEAD'})`
    );
  }

  // The stamp has to describe this file: path and content must both agree, because
  // another worktree has an artifact at the same relative path.
  if (stamp != null && typeof stamp.tree === 'string') {
    const stampedPath =
      typeof stamp.artifactPath === 'string' ? stamp.artifactPath : null;
    const artifactName = String(stamp.artifact ?? artifact ?? 'the app')
      .split('/')
      .pop();
    if (stampedPath == null) {
      problems.push(
        `app.stamp for ${platform} predates the artifact binding and cannot ` +
          `say which ${artifactName} it was written for`
      );
    } else if (
      artifactPath != null &&
      artifactPath !== '' &&
      stampedPath !== artifactPath
    ) {
      problems.push(
        'app.stamp was written for a different file than the one about to be ' +
          `tested (stamped ${stampedPath}, testing ${artifactPath})`
      );
    }
    if (
      typeof stamp.fingerprint === 'string' &&
      fingerprint != null &&
      fingerprint !== '' &&
      stamp.fingerprint !== fingerprint
    ) {
      problems.push(
        `the app changed since app.stamp was written - the binary now at ${artifactName} ` +
          'is not the one that was built and checked (rebuild so the stamp ' +
          'describes it)'
      );
    }
  }

  const missing = components.filter((name) => (counts[name] ?? 0) === 0);
  if (missing.length > 0) {
    problems.push(
      `${missing.length} registered component(s) are not in the binary: ` +
        `${missing.join(', ')} - the suite cannot exercise what the app does not ` +
        'contain (on Android this is gradle calling packageDebug up-to-date over ' +
        'a stale dex)'
    );
  }

  if (problems.length === 0) return { ok: true };
  return {
    ok: false,
    problems,
    fix:
      `rebuild it: ${buildCommand}\n` +
      '       (it writes app.stamp and refuses if the binary is still missing a ' +
      'component; add --clean when an incremental build is the thing that is stuck)',
  };
}
