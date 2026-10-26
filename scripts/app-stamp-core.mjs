/**
 * The pure half of `app.stamp` - the freshness gate for the example app.
 *
 * Why (docs/tasks/PROCESS-review-2026-10-26.md §4 rank 8, and G2's
 * `stale app` finding in docs/tasks/G2-button.report.md): `react-native-harness`
 * never builds, so `HARNESS_APP_PATH` happily points at an `.app` from before
 * the last source edit, and a gate then reports green for a binary nobody has.
 * Worse on Android, where gradle can call `packageDebug` up-to-date while the
 * dex is missing a generated hybrid: the suite passes against an APK that does
 * not contain the component under test.
 *
 * So a build records what it contained, and every device gate re-derives that
 * and compares:
 *
 *   app.stamp  { tree, head, artifact, counts: { Switch: 676, ... } }
 *
 * `tree` is a hash over the code that goes into the app - everything git can see
 * except `docs/`, `bench/`, `.github/` and Markdown, so writing a report does not
 * invalidate a build. With a clean working tree it *is* HEAD's code tree.
 * `counts` is how many times each registered component's name appears in the
 * binary, which is what catches the dex case the tree hash cannot.
 *
 * No `import.meta` here, so `scripts/__tests__/app-stamp.test.js` can import it
 * (same reason `scripts/lease-core.mjs` exists next to `scripts/lease.mjs`).
 */

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/**
 * A path that exists only at the repo root *and* is the thing this gate needs:
 * nitrogen's iOS autolinker. Walking up to it is how a caller that may be
 * `example/`, the root, or a `scripts/` entry point finds its checkout - and the
 * search doubles as a check that generated code is present.
 */
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

/** Where a build leaves its stamp, relative to each build directory. */
export const STAMP_BASENAME = 'app.stamp';

/**
 * Prefixes that never change the app binary. `docs/` is the brief's exclusion;
 * `bench/` is a separate Expo app built by `scripts/bench/build.mjs`, and its
 * `results/*.json` grow during a run; `.github/` and Markdown change no build.
 */
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
  // Build outputs are gitignored, so they are never listed; if one ever is, it
  // is a product of the tree and not part of it.
  return !file.split('/').includes('build');
}

/**
 * A stable digest of `path -> content hash`. Sorted, and hashed as text rather
 * than as JSON so two runs of the same tree agree regardless of key order.
 *
 * HEAD is deliberately not mixed in (review M4). It was folded in "so a merge
 * that leaves the working files identical still reads as a different tree", but
 * what it actually did was make every commit invalidate every build: a docs-only
 * commit changes HEAD, so the gate refused an app whose sources had not moved,
 * and a 10-minute rebuild became the price of editing a report. The file hashes
 * are what the compiler reads; HEAD is recorded in the stamp beside the digest,
 * where it answers "which commit produced this" without gating on it. The merge
 * case is not lost either - a merge that brings different code changes the file
 * hashes, and one that does not is the same app.
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
 * The plain `HybridNitroUi<Name>` is not it: on iOS it occurs ~2 200 times per
 * component because every `HybridNitroUi<Name>Spec`, `...SpecBridging` and
 * protocol mention contains it, so an app that registered nothing but the
 * generated interface would pass. Measured on the two artifacts in this repo on
 * 2026-10-26 (`example/android/.../app-debug.apk` and a Debug `.app`):
 *
 *   | needle                                    | Android | iOS  |
 *   | ----------------------------------------- | ------- | ---- |
 *   | `HybridNitroUiSwitch`                      |      61 | 2300 |
 *   | `NitroUiSwitchSpec` (the generated spec)   |      14 | 1365 |
 *   | `Lcom/margelo/nitro/nitroui/HybridNitroUiSwitch;` | 5 |    - |
 *   | `20HybridNitroUiSwitch` (length-prefixed)  |       - |    4 |
 *
 * So Android asks for the JVM class descriptor, whose leading `L` and trailing
 * `;` no spec name can borrow, and iOS for the length-prefixed name that
 * Swift's metadata reflection writes - which the spec name is not, because the
 * spec's length prefix differs (measured: 0 matches).
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
 * Reading the generated file instead of keeping a list here means a new
 * component joins the gate on the commit that adds it, with nothing to remember.
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
 * finds them without `nm`, `dexdump` or `apkanalyzer` - and works the same on a
 * debug dylib and on a stripped release binary.
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
 * Read a ZIP archive's entries.
 *
 * Needed because a `.dex` is deflate-compressed in some AGP configurations, and
 * scanning the raw APK bytes for a class name would then report a component as
 * *missing* - a refusal that blocks a device gate over nothing. Enough of the
 * format to get name + bytes: end-of-central-directory, central directory, local
 * headers. Handles stored and deflated, which is all an APK contains.
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
 * Every `classes*.dex` in an APK, decompressed, plus how they were obtained -
 * recorded in the stamp so a change of packaging shows up in the evidence.
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
    // An APK *is* a ZIP, so the bytes of a stored dex are still in there; scan
    // the whole file rather than refusing when the parse is the thing that failed.
    warn(
      `could not read the APK's dex entries (${String(error.message)}); ` +
        'scanning the APK bytes instead, which misses a compressed dex'
    );
    return { blobs: [apkBuffer], source: 'apk-bytes' };
  }
}

/**
 * Which runner this process is starting, read off the command line.
 *
 * The gate has to know the platform before the harness boots a device (a
 * refusal after a boot would hold someone else's simulator), and the config
 * module is imported before the harness parses its own arguments - so `argv` is
 * the only place it is written.
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
 * Kept as a pure decision so the refusal wording is unit-testable and the
 * callers (harness config, real-input, `build-app.mjs`) all say the same thing.
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

  // The stamp has to describe *this file*. Two worktrees of this repo each have
  // an `example/android/app/build/outputs/apk/debug/app-debug.apk` at the same
  // path with different contents, and a stamp from one made the other's gate
  // read green (review M2). Path and content both have to agree: the path alone
  // is a copy or a symlink, the content alone is another worktree's identical
  // build, and the pair is what makes "this binary came from this tree" mean
  // something.
  if (stamp != null && typeof stamp.tree === 'string') {
    const stampedPath =
      typeof stamp.artifactPath === 'string' ? stamp.artifactPath : null;
    const artifactName = String(stamp.artifact ?? artifact ?? 'the app')
      .split('/')
      .pop();
    if (stampedPath == null) {
      // Written before the binding existed. Nothing about the file can be
      // checked, which is the whole point of the stamp.
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
