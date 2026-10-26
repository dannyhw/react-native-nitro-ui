/**
 * Keep a committed JSON file prettier-clean.
 *
 * `bench/baselines/*.json` is committed, so `bun run format` (`prettier --check
 * .`) judges it - and `bun bench --update-baseline` writes it with
 * `JSON.stringify(..., 2)`, which is *nearly* prettier's JSON style but not
 * prettier: an object or array that prettier would keep on one line, or a long
 * string it would not wrap, differs. A1b left that as a follow-up: mint a
 * baseline, then hunt for the formatting diff the mint itself created.
 *
 * So the mint formats its own output. It runs the repo's prettier (through
 * `bunx`, like the other gates), and a machine where that fails still gets the
 * file plus a printed instruction rather than a failed 10-minute run.
 *
 * Lives here rather than in `report.mjs` for the reason `render.mjs` documents:
 * the CLI module resolves repo paths through `import.meta`, which jest's
 * CommonJS transform cannot represent. No `import.meta` here, so
 * `scripts/__tests__/bench-baseline-format.test.js` can cover it.
 */

import { spawnSync } from 'node:child_process';

/** The command used to reach prettier - `bunx`, as in the other repo gates. */
const PRETTIER_COMMAND = ['bunx', 'prettier'];

/**
 * @param {string} file absolute path of the file to format in place
 * @param {(message: string) => void} [log]
 * @param {((file: string, args: string[], options: object) => { status: number | null, error?: Error })} [spawn]
 * @returns {{ formatted: boolean, note: string | null }}
 */
export function formatCommittedJsonFile(
  file,
  { log = () => {}, spawn = spawnSync } = {}
) {
  const result = spawn(
    PRETTIER_COMMAND[0],
    [...PRETTIER_COMMAND.slice(1), '--write', file],
    {
      stdio: 'ignore',
      // Prettier picks the repo's config by walking up from the file, so no
      // flags here that could drift from `bun run format`.
      shell: false,
    }
  );

  if (result?.error != null) {
    return {
      formatted: false,
      note: `${PRETTIER_COMMAND.join(' ')} could not run (${String(result.error.message)}); run \`bun run format:write ${file}\` before committing.`,
    };
  }
  if (result?.status !== 0) {
    return {
      formatted: false,
      note: `${PRETTIER_COMMAND.join(' ')} exited ${String(result.status)}; run \`bun run format:write ${file}\` before committing.`,
    };
  }
  log(`formatted ${file}`);
  return { formatted: true, note: null };
}
