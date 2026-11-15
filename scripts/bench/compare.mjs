/**
 * The release comparison: measures a git ref and the working tree in one session,
 * alternating installs of the two bench apps on one device.
 *
 *   bun bench --platform ios --compare-release            # newest release tag
 *   bun bench --platform ios --compare-release v0.9.0     # an explicit ref
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Overrides where base-ref checkouts live (`~/.nitro-ui/bench-base/<repo>/<ref>` by
 * default). They stay outside the repository, where lint, typecheck and jest would
 * otherwise walk a second copy of it.
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

/** One directory per ref, reused across runs. */
export function baseRefDir({ repoRoot, ref, env = process.env }) {
  return path.join(
    baseRefRoot({ repoRoot, env }),
    ref.replace(/[^\w.+-]/g, '-')
  );
}

/** A release tag is `v<major>.<minor>.<patch>`: what the release workflow writes. */
export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

/**
 * The newest release tag worth comparing against. `tags` must arrive newest-created
 * first (git's `--sort=-creatordate`), and that order is kept rather than re-sorted by
 * version: a patch released later on an older line is the one to compare against.
 * A tag at `headSha` is skipped, because a tree compared with itself measures nothing.
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
 * Which side runs first in a launch round: ABBA over four rounds, so each side is
 * first twice and host drift across the session is shared by both.
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
 *   baseCommit?: string | null,
 *   headCommit?: string | null,
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
  baseCommit = null,
  headCommit = null,
  repoRoot,
  baseDir,
  headSchedule,
  baseSchedule,
  baseProblem = null,
}) {
  const warnings = [];

  // Full object ids: two abbreviations of one commit can differ in length, because
  // git lengthens a short id as the repository grows.
  if (headCommit != null && baseCommit != null && headCommit === baseCommit) {
    return {
      sides: [],
      rounds: [],
      installs: 0,
      totalLaunches: 0,
      cells: { compared: [], headOnly: [], baseOnly: [] },
      warnings: [],
      problem: `--compare-release ${ref} is this commit (${String(baseSha ?? baseCommit)}): a run against itself measures nothing. Pass an older ref.`,
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
 * The plan as text, printed by `--dry-run --compare-release` and before a live run.
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

export function comparisonOutcome({
  ref,
  slower = [],
  uncompared = [],
  baseProblems = [],
}) {
  const lines = [];
  if (slower.length > 0) {
    lines.push(
      `Slower than ${ref} on ${String(slower.length)} cell(s):`,
      ...slower.map(
        (failure) =>
          `  - ${failure.key} ${failure.metric}: ${failure.ratio.toFixed(2)}x (CI ${failure.ci.low.toFixed(2)}-${(failure.ci.high ?? failure.ci.low).toFixed(2)})`
      )
    );
  }
  if (uncompared.length > 0) {
    lines.push(
      `Not compared with ${ref} - ${String(uncompared.length)} cell(s) of the plan have no verdict, which is not a pass:`,
      ...uncompared.map((cell) => `  - ${cell.key}: ${cell.reasons.join('; ')}`)
    );
  }
  if (baseProblems.length > 0) {
    lines.push(
      `${String(baseProblems.length)} launch(es) of ${ref} did not complete:`,
      ...baseProblems.map((problem) => `  - ${problem}`)
    );
  }
  return { exitCode: lines.length > 0 ? 1 : 0, lines };
}

/* --------------------------------- effects -------------------------------- */

/**
 * Extract `ref` into its own directory. `git archive` rather than `git worktree add`:
 * a worktree registers itself in the clone's metadata, where a prune could reach it.
 *
 * @param {{ repoRoot: string, baseDir: string, ref: string, quiet?: boolean }} input
 * @returns {{ baseDir: string, reused: boolean }}
 */
export function extractBaseRef({ repoRoot, baseDir, ref }) {
  const stamp = path.join(baseDir, '.bench-base-ref');
  // An annotated tag is its own object; the commit it names is what gets compared.
  const resolved = execFileSync('git', ['rev-parse', `${ref}^{commit}`], {
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
 * Install the extracted ref's own dependencies. Only a build needs this: reading the
 * ref's plan does not, because `scripts/bench/lib.mjs` is dependency-free.
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
 * Ask a checkout's own module for an answer, as JSON on stdout. The base side must be
 * described by the code that release contained.
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
 * The base checkout's own schedule for the same request. What the base plan does not
 * know about comes back as a warning or a smaller schedule.
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
