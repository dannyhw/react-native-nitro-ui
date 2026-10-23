/**
 * The Node the device gates need, checked where they start.
 *
 * `react-native-harness` collects a `.harness.tsx` file by transforming it with
 * Jest on the host. On Node 25 and 26 that transform dies with
 * `Must use import to load ES Module … react-native/index.js`, which reads like
 * a bug in the test file rather than in the runtime - G1 lost time to it
 * (docs/tasks/G1-slider.report.md). `.nvmrc` pins the version this repo actually
 * runs the gates on, so the entry points say that up front instead.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Major versions the device gates are known to run on. */
const SUPPORTED_MAJORS = new Set([22, 23, 24]);

/** The floor `package.json`'s `engines.node` promises. */
const MIN_MINOR_FOR_22 = 11;

/**
 * @param {string} version A `process.versions.node` value, e.g. `24.11.1`.
 * @returns {{ major: number, minor: number } | null}
 */
function parse(version) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (match == null) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * @param {string} version A `process.versions.node` value.
 * @returns {boolean}
 */
export function isSupportedNodeVersion(version) {
  const parsed = parse(version);
  if (parsed == null) return false;
  if (!SUPPORTED_MAJORS.has(parsed.major)) return false;
  if (parsed.major === 22 && parsed.minor < MIN_MINOR_FOR_22) return false;
  return true;
}

/**
 * The pinned version in `.nvmrc`, read rather than duplicated so this message
 * cannot drift from the pin.
 *
 * @returns {string | null}
 */
function pinnedVersion() {
  for (const dir of [
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
    process.cwd(),
  ]) {
    try {
      const text = fs.readFileSync(path.join(dir, '.nvmrc'), 'utf8').trim();
      if (text !== '') return text;
    } catch {
      // Try the next candidate; a missing pin only weakens the message.
    }
  }
  return null;
}

/**
 * Fail before the harness does, with the reason and the fix.
 *
 * @param {object} options
 * @param {string} options.command What is starting, e.g. `bun run harness:ios`.
 * @param {string} [options.version] Runtime version to check.
 * @param {boolean} [options.isBun] Whether the runtime is bun.
 * @throws {Error} when the runtime is not one the gates run on.
 */
export function assertSupportedNode({
  command,
  version = process.versions.node,
  isBun = process.versions.bun != null,
}) {
  // Bun runs the repo's scripts and reports its own Node compatibility version,
  // so only the runtime that actually transforms the tests decides (below).
  if (isBun) return;
  if (isSupportedNodeVersion(version)) return;

  const pin = pinnedVersion();
  throw new Error(
    `${command} needs Node 22.11 - 24, and this is Node ${version}.\n` +
      `     Node 25 and 26 fail later inside the harness's Jest transform with\n` +
      `     "Must use import to load ES Module … react-native/index.js", which\n` +
      `     looks like a bug in the test file and is not one. Switch to the\n` +
      `     version this repo pins${pin == null ? '' : ` (${pin} in .nvmrc)`} and\n` +
      `     re-run: nvm use            (or: fnm use)\n` +
      `     without leaving your shell: fnm exec --using 24 -- ${command}`
  );
}
