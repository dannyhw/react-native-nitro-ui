/**
 * Decides when a `harness:<platform>` run adds a second app launch for the
 * isolated suites in `example/__tests__/isolated/`. A file goes there when a
 * regression in what it tests would break every file after it in the same app
 * process. Only a full platform run adds the isolated run.
 */

/** The variable `example/jest.harness.config.mjs` reads. */
export const ISOLATED_ENV = 'NITRO_UI_HARNESS_ISOLATED';

/** Where the isolated suites live, relative to `example/`. */
export const ISOLATED_DIR = '__tests__/isolated';

/**
 * Whether these CLI arguments are a full platform run: `--harnessRunner <p>` and
 * nothing that selects files.
 *
 * @param {ReadonlyArray<string>} args the arguments after `harness.mjs`
 * @returns {boolean}
 */
export function isFullPlatformRun(args) {
  const rest = [...args];
  const at = rest.indexOf('--harnessRunner');
  if (at === -1 || rest[at + 1] == null) return false;
  rest.splice(at, 2);
  return rest.length === 0;
}

/**
 * Whether a gate's harness run should add the isolated run.
 *
 * @param {object} options
 * @param {ReadonlyArray<string>} options.args
 * @param {Record<string, string | undefined>} options.env
 * @param {ReadonlyArray<string>} options.isolatedFiles the `*.harness.tsx` files found
 * @returns {boolean}
 */
export function wantsIsolatedRun({ args, env, isolatedFiles }) {
  if (env[ISOLATED_ENV] === '1') return false; // already the isolated run
  return isFullPlatformRun(args) && isolatedFiles.length > 0;
}

/**
 * The gate's exit code from the two runs: the first failure wins, so a red isolated
 * file turns a green shared run red, and the shared run's own failure is not hidden.
 *
 * @param {number} shared
 * @param {number | null} isolated `null` when there was no isolated run
 * @returns {number}
 */
export function combinedExitCode(shared, isolated) {
  if (shared !== 0) return shared;
  return isolated ?? 0;
}
