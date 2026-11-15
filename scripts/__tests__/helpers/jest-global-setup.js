/**
 * Jest's `globalSetup` (named in `package.json`): removes this shell's device lease from the
 * environment before any test file runs, so no worker or spawned child inherits it.
 */

import process from 'node:process';

import { isLeaseScopedEnvName } from './scrubbed-env.js';

/**
 * Deletes every lease-scoped name from `env`, in place.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]} the names it removed
 */
export function scrubLeaseEnv(env) {
  const removed = Object.keys(env).filter(isLeaseScopedEnvName);
  for (const name of removed) delete env[name];
  return removed;
}

export default function globalSetup() {
  scrubLeaseEnv(process.env);
}
