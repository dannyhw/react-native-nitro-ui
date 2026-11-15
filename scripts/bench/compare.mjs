/**
 * The release comparison: measure a git ref and the working tree in one session.
 *
 *   bun bench --platform ios --compare-release            # newest release tag
 *   bun bench --platform ios --compare-release v0.9.0     # an explicit ref
 *
 * The question is "is this slower than the last release?", and the only answer that
 * means anything on a simulator or emulator is a *paired* one: two library versions,
 * one device, one session, alternating. Absolute milliseconds move with whatever else
 * the host is doing (D15), and a committed baseline from another day measures a
 * different machine (X36 removed the committed baselines for that reason).
 *
 * ## How the older ref is measured
 *
 * The ref is extracted into a second checkout outside the repository
 * (`~/.nitro-ui/bench-base/<repo>/<tag>/`), `bun install` runs there, and its **own**
 * `scripts/bench/build.mjs` builds its **own** bench app. That is the whole trick: the base side is the app the last release shipped
 * with, parsed and measured by the code that release contained, so a plan format, a
 * waiting rule or an arm that changed since then cannot make the base side lie about
 * a version it never ran.
 *
 * Both apps are installed on the device under the same identifier, so only one is
 * installed at a time. The session therefore runs in *launch rounds*: for launch N of
 * every cell, the runner installs one side, drives its launches, then installs the
 * other side for the next round. The order per round is the same ABBA the arms use
 * (`sideOrderForRound`), so neither side is always measured first in a round and the
 * host drift inside a session is shared. The cost is one install per side switch
 * (about 20 s each, 6 installs for a 4-launch plan) and one extra app build.
 *
 * ## What is compared
 *
 * Cell keys (`mount.switch:nitro-ui:50`). A cell only the head knows about is reported
 * as `not measured in base` - a new component has no release number to be slower than -
 * and a cell only the base knows about is measured and not gated. The gate itself is
 * `gate()` in `lib.mjs`: the same launch-paired ratio to `rn-core` on each side, the
 * ratio of those ratios, over 1.20 with a CI excluding 1.05 on a cell that was quiet
 * inside its own run (D9).
 *
 * The pure half (`newestReleaseTag`, `planComparison`, `sideOrderForRound`) is what the
 * unit tests read; the gatherer below (`prepareBaseCheckout`, `readBaseSchedule`) is
 * the part that touches git, bun and a build.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Where a base-ref checkout lives: `~/.nitro-ui/bench-base/<repo>/<ref>` by default,
 * `NITRO_UI_BENCH_BASE_DIR` to move it.
 *
 * Deliberately *outside* the checkout. A second copy of the repository inside it would
 * be walked by eslint, `tsc`, jest and every `git ls-files`-driven check in `check`, and
 * a stale copy of the library would be found by tools looking for the current one. The
 * directory is a cache, not an artifact: deleting it costs one extraction, one install
 * and one build.
 */
export const BASE_REF_DIR_ENV = 'NITRO_UI_BENCH_BASE_DIR';

export function baseRefRoot({ repoRoot, env = process.env }) {
  const configured = env[BASE_REF_DIR_ENV]?.trim();
  if (configured != null && configured.length > 0) {
    return configured;
  }
  return path.join(
    os.homedir(),
    '.nitro-ui',
    'bench-base',
    path.basename(repoRoot)
  );
}

/**
 * One directory per ref, reused across runs: the second release comparison of a week
 * costs a build at most, not an extraction and an install as well.
 */
export function baseRefDir({ repoRoot, ref, env = process.env }) {
  return path.join(
    baseRefRoot({ repoRoot, env }),
    ref.replace(/[^\w.+-]/g, '-')
  );
}

/** A release tag is `v<major>.<minor>.<patch>`: what the release workflow writes. */
export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

/**
 * The newest release tag that is worth comparing against.
 *
 * `tags` arrives in git's `--sort=-creatordate` order, which is *when the tag was
 * made*, and that is the answer wanted: a patch released later on an older line
 * (`v0.9.1` after `v0.10.0`) is the thing the next release must not regress against.
 * A lexical or numeric sort of the names would pick a different tag, so the order is
 * the input's and this function only filters.
 *
 * A tag that points at the commit we are standing on is skipped: measuring a tree
 * against itself produces a 1.00 everywhere and a green light that measured nothing.
 *
 * @param {{ tags: string[], shaOfTag?: Record<string, string | null>, headSha?: string | null }} input
 * @returns {{ ref: string | null, sha: string | null, skipped: string[], problem: string | null }}
 */
export function newestReleaseTag({ tags, shaOfTag = {}, headSha = null }) {
  const candidates = tags.filter((tag) => RELEASE_TAG_PATTERN.test(tag));
  const skipped = [];
  for (const tag of candidates) {
    const sha = shaOfTag[tag] ?? null;
    if (sha != null && headSha != null && sha === headSha) {
      skipped.push(tag);
      continue;
    }
    return { ref: tag, sha, skipped, problem: null };
  }
  return {
    ref: null,
    sha: null,
    skipped,
    problem:
      candidates.length === 0
        ? `no release tag (${RELEASE_TAG_PATTERN.source}) in this repository - pass --compare-release <ref>`
        : `every release tag points at this commit (${skipped.join(', ')}) - pass --compare-release <older ref>`,
  };
}

/**
 * Which side runs first in a launch round: ABBA over four rounds, like the arms inside
 * a launch (docs/architecture/benchmarks.md "Protocol"). Over four rounds each side is
 * first twice and last twice, which is the whole reason the order is not "base then
 * head" - a host that warms up or cools down across a session would otherwise show up
 * as a difference between the two library versions.
 *
 * @param {number} launch 0-based launch index
 * @returns {['base' | 'head', 'base' | 'head']}
 */
export function sideOrderForRound(launch) {
  const pattern = [
    ['base', 'head'],
    ['head', 'base'],
    ['head', 'base'],
    ['base', 'head'],
  ];
  return pattern[launch % pattern.length];
}

/** Cell keys a schedule measures, ignoring which launch of them it is. */
function cellKeysOf(schedule) {
  return [
    ...new Set(
      schedule.map(
        (entry) => `${entry.scenario}:${entry.implementation}:${entry.n}`
      )
    ),
  ];
}

/**
 * The whole comparison, before anything is booted or built: two sides, the rounds that
 * interleave them, and what each side can actually measure.
 *
 * @param {{
 *   platform: string,
 *   plan: string,
 *   launches: number,
 *   ref: string,
 *   baseSha: string | null,
 *   headSha: string | null,
 *   repoRoot: string,
 *   baseDir: string,
 *   headSchedule: object[],
 *   baseSchedule: object[] | null,
 *   baseProblem?: string | null,
 * }} input
 * @returns {{
 *   sides: object[], rounds: object[], installs: number, totalLaunches: number,
 *   cells: { compared: string[], headOnly: string[], baseOnly: string[] },
 *   warnings: string[], problem: string | null
 * }}
 */
export function planComparison({
  platform,
  plan,
  launches,
  ref,
  baseSha,
  headSha,
  repoRoot,
  baseDir,
  headSchedule,
  baseSchedule,
  baseProblem = null,
}) {
  const warnings = [];

  if (headSha != null && baseSha != null && headSha === baseSha) {
    return {
      sides: [],
      rounds: [],
      installs: 0,
      totalLaunches: 0,
      cells: { compared: [], headOnly: [], baseOnly: [] },
      warnings: [],
      problem: `--compare-release ${ref} is this commit (${String(baseSha)}): a run against itself measures nothing. Pass an older ref.`,
    };
  }

  const sides = [
    {
      side: 'head',
      root: repoRoot,
      sha: headSha,
      scheduleLength: headSchedule.length,
      scheduleProblem: null,
    },
    {
      side: 'base',
      root: baseDir,
      sha: baseSha,
      scheduleLength: baseSchedule?.length ?? 0,
      scheduleProblem: baseProblem,
    },
  ];
  if (baseProblem != null) {
    return {
      sides,
      rounds: [],
      installs: 0,
      totalLaunches: 0,
      cells: { compared: [], headOnly: [], baseOnly: [] },
      warnings,
      problem: `the base ref ${ref} cannot be planned: ${baseProblem}`,
    };
  }

  const rounds = [];
  for (let launch = 0; launch < launches; launch += 1) {
    rounds.push({ launch, order: sideOrderForRound(launch) });
  }
  let installs = 0;
  let previous = null;
  for (const round of rounds) {
    for (const side of round.order) {
      if (side !== previous) installs += 1;
      previous = side;
    }
  }

  const headKeys = cellKeysOf(headSchedule);
  const baseKeys = cellKeysOf(baseSchedule ?? []);
  const baseSet = new Set(baseKeys);
  const headSet = new Set(headKeys);
  const compared = headKeys.filter((key) => baseSet.has(key));
  const headOnly = headKeys.filter((key) => !baseSet.has(key));
  const baseOnly = baseKeys.filter((key) => !headSet.has(key));
  if (headOnly.length > 0) {
    warnings.push(
      `${String(headOnly.length)} cell(s) exist only in this tree and will read "not measured in base" (a new component has nothing to regress against): ${headOnly.slice(0, 6).join(', ')}${headOnly.length > 6 ? ', …' : ''}`
    );
  }
  if (baseOnly.length > 0) {
    warnings.push(
      `${String(baseOnly.length)} cell(s) exist only in ${ref} - measured, never gated: ${baseOnly.slice(0, 6).join(', ')}${baseOnly.length > 6 ? ', …' : ''}`
    );
  }

  return {
    platform,
    plan,
    launches,
    ref,
    sides,
    rounds,
    installs,
    totalLaunches: headSchedule.length + (baseSchedule?.length ?? 0),
    cells: { compared, headOnly, baseOnly },
    warnings,
    problem: null,
  };
}

/**
 * The plan as text - what `--dry-run --compare-release` prints, and what the live run
 * prints before it starts, so a two-hour session can be read before it is paid for.
 *
 * @param {{ plan: object, deviceKey: string | null }} input
 * @returns {string[]}
 */
export function comparisonPlanLines({ plan, deviceKey }) {
  if (plan.problem != null) {
    return [`Compare:   refused - ${plan.problem}`];
  }
  const lines = [
    `Compare:   ${plan.ref}${plan.sides[1]?.sha == null ? '' : ` (${String(plan.sides[1].sha)})`} vs HEAD${plan.sides[0]?.sha == null ? '' : ` (${String(plan.sides[0].sha)})`}`,
    `  head:    ${plan.sides[0].scheduleLength} launches from ${String(plan.sides[0].root)}`,
    `  base:    ${String(plan.sides[1].scheduleLength)} launches from ${String(plan.sides[1].root)} (built there, installed under the same app id)`,
    `  device:  ${deviceKey ?? 'UNKNOWN'} - both sides, one session`,
    `  rounds:  ${String(plan.rounds.length)}, order ${plan.rounds
      .slice(0, 4)
      .map((round) => round.order.join('/'))
      .join(' ')}${plan.rounds.length > 4 ? ' …' : ''}`,
    `  installs ${String(plan.installs)} (one per side switch), ${String(plan.totalLaunches)} launches total`,
    `  cells:   ${String(plan.cells.compared.length)} compared, ${String(plan.cells.headOnly.length)} head-only, ${String(plan.cells.baseOnly.length)} base-only`,
  ];
  for (const warning of plan.warnings) {
    lines.push(`  note:    ${warning}`);
  }
  return lines;
}

/* --------------------------------- effects -------------------------------- */

/**
 * Extract `ref` into its own directory and install its dependencies.
 *
 * `git archive` rather than `git worktree add`: a worktree registers itself in the
 * clone's metadata, where another task's `worktrees.mjs --prune` could reach it, and
 * nothing about a bench base needs to be a branch. The extraction is read-only with
 * respect to the repository.
 *
 * @param {{ repoRoot: string, baseDir: string, ref: string, quiet?: boolean }} input
 * @returns {{ baseDir: string, reused: boolean }}
 */
export function extractBaseRef({ repoRoot, baseDir, ref }) {
  const stamp = path.join(baseDir, '.bench-base-ref');
  const resolved = execFileSync('git', ['rev-parse', ref], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (
    fs.existsSync(stamp) &&
    fs.readFileSync(stamp, 'utf8').trim() === resolved
  ) {
    return { baseDir, sha: resolved, reused: true };
  }
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.mkdirSync(baseDir, { recursive: true });
  execFileSync('tar', ['-x', '-C', baseDir], {
    input: execFileSync('git', ['archive', '--format=tar', resolved], {
      cwd: repoRoot,
      maxBuffer: 512 * 1024 * 1024,
    }),
    maxBuffer: 8,
  });
  fs.writeFileSync(stamp, `${resolved}\n`);
  return { baseDir, sha: resolved, reused: false };
}

/**
 * Install the extracted ref's own dependencies. Only a build needs this - reading the
 * ref's plan does not, because `scripts/bench/lib.mjs` is dependency-free, which is what
 * lets `--dry-run` print a two-sided plan without installing anything.
 */
export function installBaseDependencies({ baseDir, quiet = false }) {
  if (fs.existsSync(path.join(baseDir, 'node_modules'))) {
    return { installed: false };
  }
  execFileSync('bun', ['install'], {
    cwd: baseDir,
    stdio: quiet ? 'ignore' : 'inherit',
  });
  return { installed: true };
}

/**
 * Ask a checkout's own module for an answer, as JSON on stdout.
 *
 * Used for both halves of the base side - its `build.mjs` builds the app, and its
 * `lib.mjs` says what its plan measures - because the base side must be described by
 * the code that release contained, not by today's tables.
 */
function askCheckout({ baseDir, module, exportName, args = [] }) {
  const modulePath = pathToFileURL(path.join(baseDir, module)).href;
  const script =
    `const mod = await import(${JSON.stringify(modulePath)});\n` +
    `const fn = mod[${JSON.stringify(exportName)}];\n` +
    `if (typeof fn !== 'function') { throw new Error(${JSON.stringify(`${module} does not export ${exportName}()`)}); }\n` +
    'process.stdout.write(JSON.stringify(await fn(...process.argv.slice(1)) ?? null));\n';
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, ...args],
      {
        cwd: baseDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 64 * 1024 * 1024,
      }
    )
  );
}

/**
 * The base checkout's own schedule for the same request.
 *
 * Anything the base plan does not know about (a component added since, an option that
 * did not exist) comes back as a warning or a smaller schedule: the comparison then
 * covers the cells both sides can measure, which is the honest subset.
 *
 * @returns {{ schedule: object[] | null, problem: string | null }}
 */
export function readBaseSchedule({
  baseDir,
  platform,
  plan,
  launches,
  filters = {},
}) {
  const request = { plan, launches, platform, ...filters };
  try {
    const module = path.join(baseDir, 'scripts/bench/lib.mjs');
    const script =
      `const mod = await import(${JSON.stringify(pathToFileURL(module).href)});\n` +
      'const request = JSON.parse(process.argv[1]);\n' +
      'let schedule;\n' +
      'try {\n' +
      '  schedule = mod.buildSchedule(request);\n' +
      '} catch (error) {\n' +
      "  if (error == null || typeof error.message !== 'string' || !/unknown option|not supported|Unknown/.test(error.message)) throw error;\n" +
      '  schedule = mod.buildSchedule({\n' +
      '    plan: request.plan,\n' +
      '    launches: request.launches,\n' +
      '    platform: request.platform,\n' +
      '  });\n' +
      '}\n' +
      'process.stdout.write(JSON.stringify(schedule.map(({ scenario, implementation, n, launch }) => ({ scenario, implementation, n, launch }))));\n';
    const schedule = JSON.parse(
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', script, JSON.stringify(request)],
        {
          cwd: baseDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
          maxBuffer: 16 * 1024 * 1024,
        }
      )
    );
    return { schedule, problem: null };
  } catch (error) {
    return {
      schedule: null,
      problem:
        error instanceof Error ? error.message.split('\n')[0] : String(error),
    };
  }
}

/**
 * Build the base side's bench app with the base checkout's own build script, then ask
 * that script where the artifact and its app identifier are.
 *
 * @returns {{ artifact: object, problem: null } | { artifact: null, problem: string }}
 */
/**
 * Where an already-built base artifact is, without building it (`--skip-build`).
 */
export function locateBaseArtifact({ baseDir, platform }) {
  return askCheckout({
    baseDir,
    module: 'scripts/bench/build.mjs',
    exportName: 'locateArtifact',
    args: [platform],
  });
}

export function buildBaseSide({ baseDir, platform, prebuildFirst = false }) {
  try {
    execFileSync(
      process.execPath,
      [
        'scripts/bench/build.mjs',
        '--platform',
        platform,
        ...(prebuildFirst ? ['--prebuild'] : []),
      ],
      { cwd: baseDir, stdio: 'inherit' }
    );
    return {
      artifact: locateBaseArtifact({ baseDir, platform }),
      problem: null,
    };
  } catch (error) {
    return {
      artifact: null,
      problem:
        error instanceof Error ? error.message.split('\n')[0] : String(error),
    };
  }
}
