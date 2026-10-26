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

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
 * Marks a process that already re-executed itself (see
 * `reexecUnderPinnedNode`), so a machine whose fnm default is the wrong Node
 * cannot loop: the second process refuses instead of re-execing again.
 */
export const REEXEC_FLAG = 'NITRO_UI_NODE_REEXEC';

/**
 * The pinned version in `.nvmrc`, read rather than duplicated so this message
 * cannot drift from the pin.
 *
 * @returns {string | null}
 */
export function pinnedVersion() {
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

/**
 * The `fnm exec --using` argument for `.nvmrc`: the major, so a machine with
 * 24.18 rather than 24.22.1 still gets a run instead of an error. `fnm exec
 * --using 24` is also what the briefs and CONTRIBUTING tell people to type.
 *
 * @returns {string | null}
 */
export function pinnedNodeMajor() {
  // `.nvmrc` is written `v24.22.1`; `parse` wants the bare number.
  const parsed = parse((pinnedVersion() ?? '').replace(/^v/, ''));
  return parsed == null ? null : String(parsed.major);
}

/**
 * Restart this process under the `.nvmrc` Node when the running one is not a
 * version the gates work on, instead of refusing a device run over a shell
 * default. Silent when the runtime is already fine, so entry points call it
 * unconditionally on line 1.
 *
 * Only a process that *is* the gate may call this (a `node script.mjs` entry
 * point, or a wrapper that starts one): it re-runs `process.argv` from scratch,
 * so anything the current process already did happens twice otherwise.
 *
 * `fnm` is looked up on `PATH`, never sourced: a login shell's `fnm env` would
 * mean running a shell profile from a script.
 *
 * @param {object} options
 * @param {string} options.command What is starting, for the refusal message.
 * @param {string[]} [options.argv] `process.argv` to re-run.
 * @param {NodeJS.ProcessEnv} [options.env] Environment to hand over.
 * @param {((file: string, args: string[], options: object) => { status: number | null, error?: Error, signal?: string | null })} [options.spawn]
 * @returns {{ ran: false } | { ran: true, exitCode: number }} `ran` is false
 *   only when there was nothing to re-exec (right Node, no `fnm`, or fnm itself
 *   failed - in the last two cases the caller still gets `assertSupportedNode`).
 */
export function reexecUnderPinnedNode({
  command,
  argv = process.argv,
  env = process.env,
  spawn = spawnSync,
}) {
  if (isSupportedNodeVersion(process.versions.node)) return { ran: false };
  // Already tried: the re-exec'd process is on the wrong Node too (an fnm
  // install without the pinned version). Refusing is the useful answer.
  if (env[REEXEC_FLAG] === '1') return { ran: false };
  const major = pinnedNodeMajor();
  if (major == null) return { ran: false };

  const [, script, ...rest] = argv;
  if (script == null) return { ran: false };

  // `node` is resolved from the PATH fnm exports, so the child gets the pinned
  // runtime; `process.execPath` would re-run the runtime we are rejecting.
  const result = spawn(
    'fnm',
    ['exec', '--using', major, '--', 'node', script, ...rest],
    {
      stdio: 'inherit',
      env: { ...env, [REEXEC_FLAG]: '1' },
    }
  );

  // No fnm on this machine (a CI runner, a fresh box): the caller's
  // `assertSupportedNode` prints the instructions instead of a silent no-op.
  if (result.error != null) {
    process.stderr.write(
      `${command}: could not re-exec under Node ${major} (fnm: ${String(result.error.message)}); continuing with this runtime.\n`
    );
    return { ran: false };
  }

  process.stderr.write(
    `${command}: re-ran under Node ${major} from .nvmrc ` +
      `(this shell is on Node ${process.versions.node}; \`fnm use\` to match it).\n`
  );
  if (result.signal != null) process.kill(process.pid, result.signal);
  return { ran: true, exitCode: result.status ?? 0 };
}

/**
 * The entry-point form: re-exec under the pinned Node if needed and exit with
 * the child's status, or - when that is not possible - throw the refusal so a
 * gate never runs on a runtime that cannot produce evidence.
 *
 * Pass `entryUrl` (`import.meta.url`) from a script that could also be imported:
 * restarting `process.argv` from a module another process is already running
 * would run that process twice, so an imported module only asserts.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string} [options.entryUrl] `import.meta.url` of the calling script.
 */
export function assertSupportedNodeOrReexec({ command, entryUrl }) {
  const isEntry =
    entryUrl == null ||
    pathToFileURL(process.argv[1] ?? '').href === entryUrl ||
    process.argv[1] === fileURLToPath(entryUrl);
  if (isEntry) {
    const reexec = reexecUnderPinnedNode({ command });
    if (reexec.ran) process.exit(reexec.exitCode);
  }
  assertSupportedNode({ command });
}
