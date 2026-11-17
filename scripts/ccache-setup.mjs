/**
 * Finding ccache and the environment every compile needs to use it. Shared by
 * `build-app.mjs` and the iOS real-input build, which compile into the same
 * DerivedData: two builds that disagree on the compiler's environment or the
 * module cache recompile each other's objects.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  ccacheEffectiveForWorktrees,
  ccacheEnv,
  ccacheRequested,
  gradleCcacheArgs,
} from './build-speed-lib.mjs';

/**
 * Where ccache is, or null. Scans `PATH` rather than asking a shell, so the
 * answer does not depend on which shell is configured.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function findCcache(env = process.env) {
  const named = env.CCACHE_PATH ?? env.CCACHE_BINARY_PATH ?? null;
  const candidates =
    named != null && named !== ''
      ? [named]
      : (env.PATH ?? '')
          .split(path.delimiter)
          .filter((dir) => dir !== '')
          .map((dir) => path.join(dir, 'ccache'));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here; try the next PATH entry.
    }
  }
  return null;
}

/**
 * ccache, if this machine has it. Everything ccache-related is conditional on
 * this one lookup, so a machine without it builds as usual.
 *
 * @param {object} options
 * @param {string} options.repoRoot this checkout
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(message: string) => void} [options.warn]
 * @returns {{enabled: boolean, binary: string | null,
 *   env: Record<string, string>, gradleArgs: string[]}}
 */
export function ccacheSetup({
  repoRoot,
  env = process.env,
  warn = (message) => console.warn(message),
}) {
  const binary = ccacheRequested(env) ? findCcache(env) : null;
  if (binary == null) {
    return { enabled: false, binary: null, env: {}, gradleArgs: [] };
  }
  const extra = {
    ...ccacheEnv({ enabled: true, repoRoot, binary }),
    // Read by scripts/gradle-ccache.init.gradle, which is passed with -I only
    // when ccache exists.
    CCACHE_GRADLE_LAUNCHER: binary,
  };
  // ccache ignores an environment variable it does not recognise, so the two
  // settings that make a second worktree a hit are worth reading back once:
  // a wrong name costs every build a cache and says nothing about it.
  const effective = spawnSync(binary, ['--show-config'], {
    env: { ...env, ...extra },
    encoding: 'utf8',
  });
  if (
    effective.status === 0 &&
    !ccacheEffectiveForWorktrees(effective.stdout ?? '')
  ) {
    warn(
      'ccache is missing base_dir/hash_dir - expect a miss in every new ' +
        'worktree (see ccacheEnv in scripts/build-speed-lib.mjs)'
    );
  }
  return {
    enabled: true,
    binary,
    env: extra,
    // The NDK's CMake projects live in the published package's `android/` and
    // in nitro-modules, so the launcher goes in through an init script.
    gradleArgs: gradleCcacheArgs({
      enabled: true,
      initScript: path.join(repoRoot, 'scripts', 'gradle-ccache.init.gradle'),
    }),
  };
}
