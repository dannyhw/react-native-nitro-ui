/**
 * The Node the device gates need, checked where they start. On Node 25 and 26
 * react-native-harness's host-side Jest transform dies with `Must use import to
 * load ES Module … react-native/index.js`.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SUPPORTED_MAJORS = new Set([22, 23, 24]);

/** The Node 22 floor (22.11). */
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
 * Marks a process that already re-executed itself, so a machine whose fnm
 * default is the wrong Node refuses instead of looping.
 */
export const REEXEC_FLAG = 'NITRO_UI_NODE_REEXEC';

/**
 * The pinned version in `.nvmrc`.
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
  // Bun reports its own Node compatibility version; only the runtime that
  // transforms the tests decides.
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
 * a different 24.x still gets a run instead of an error.
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
 * version the gates work on. Silent when the runtime is already fine.
 *
 * Only an entry point may call this: it re-runs `process.argv` from scratch, so
 * anything the current process already did would happen twice.
 *
 * `fnm` is looked up on `PATH`, never sourced through a shell profile.
 *
 * @param {object} options
 * @param {string} options.command What is starting, for the refusal message.
 * @param {string[]} [options.argv] `process.argv` to re-run.
 * @param {NodeJS.ProcessEnv} [options.env] Environment to hand over.
 * @param {string} [options.currentVersion] `process.versions.node`.
 * @param {((file: string, args: string[], options: object) => { status: number | null, error?: Error, signal?: string | null, stdout?: string })} [options.spawn]
 * @returns {{ ran: false } | { ran: true, exitCode: number }} `ran` is false
 *   when there was nothing to re-exec (right Node) or the pinned toolchain could
 *   not be proven (no `fnm`, fnm has no such version, fnm could not start).
 *   `ran: true` means the gate ran under the pinned runtime and this is its exit
 *   code.
 */
export function reexecUnderPinnedNode({
  command,
  argv = process.argv,
  env = process.env,
  spawn = spawnSync,
  currentVersion = process.versions.node,
}) {
  if (isSupportedNodeVersion(currentVersion)) return { ran: false };
  // Already tried: the re-exec'd process is on the wrong Node too.
  if (env[REEXEC_FLAG] === '1') return { ran: false };
  const major = pinnedNodeMajor();
  if (major == null) return { ran: false };

  const [, script, ...rest] = argv;
  if (script == null) return { ran: false };

  // Ask fnm which node it would run first: `fnm exec --using 24` on a machine
  // with no node@24 exits 1 having started nothing.
  const probe = spawn(
    'fnm',
    ['exec', '--using', major, '--', 'node', '--version'],
    { encoding: 'utf8', env: { ...env, [REEXEC_FLAG]: '1' } }
  );
  const pinned = pinnedVersion() ?? major;
  const found = String(probe?.stdout ?? '').trim();
  if (probe?.error == null && probe?.status !== 0) {
    const complaint =
      String(probe.stderr ?? '')
        .split('\n')
        .find((line) => line.trim() !== '') ?? 'no output from fnm';
    process.stderr.write(
      `${command}: fnm has no Node ${major} (${complaint}). .nvmrc pins ` +
        `${pinned}; install it with: fnm install ${major}\n`
    );
    return { ran: false };
  }
  if (
    probe?.error == null &&
    probe?.status === 0 &&
    !found.startsWith(`v${major}.`)
  ) {
    process.stderr.write(
      `${command}: fnm exec --using ${major} reported ` +
        `${found || '(no version)'}, not the pinned ${pinned}. Refusing to run ` +
        'a gate on an unproven runtime.\n'
    );
    return { ran: false };
  }

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

  // No fnm on this machine: the caller's `assertSupportedNode` refuses instead.
  if (result.error != null) {
    process.stderr.write(
      `${command}: could not re-exec under Node ${major} (fnm: ${String(result.error.message)}); continuing with this runtime.\n`
    );
    return { ran: false };
  }

  process.stderr.write(
    `${command}: ` +
      (result.status === 0
        ? `ran under Node ${major} from .nvmrc (this shell is on Node ${currentVersion}; \`fnm use\` to match it).`
        : `exited ${String(result.status)} under fnm exec --using ${major}, which is where .nvmrc ` +
          `pins it (${pinned}). This shell is on Node ${currentVersion}.`) +
      '\n'
  );
  if (result.signal != null) process.kill(process.pid, result.signal);
  return { ran: true, exitCode: result.status ?? 0 };
}

/**
 * The entry-point form: re-exec under the pinned Node if needed and exit with
 * the child's status, or throw the refusal when that is not possible.
 *
 * Pass `entryUrl` (`import.meta.url`) from a script that could also be imported:
 * an imported module only asserts, because re-running `process.argv` would run
 * the importing process twice.
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
