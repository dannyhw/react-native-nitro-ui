/**
 * Jest's `globalSetup`: this shell's lease is removed from the environment once, before any
 * test file runs.
 *
 * `check` is routinely run from a shell that has sourced a lease, and a lease's variables are
 * instructions to the CLIs the suites spawn (`scrubbed-env.js` has the incident). Jest runs this
 * in its own process before it starts a worker, so the workers inherit an environment with no
 * lease in it - and so does every child a test spawns, whether it builds the child's `env` from
 * `process.env` or passes none at all. A test that means to set one of these names still does:
 * it sets it on the child it spawns.
 *
 * @file Not a test. Named in `package.json`'s `jest.globalSetup`.
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
