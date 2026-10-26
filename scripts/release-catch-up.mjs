#!/usr/bin/env node
// Creates the `vX.Y.Z` tag and GitHub release for a version that is already live.
//
// Nothing creates the tag at publish time, because publishing is not automated: the
// package's trusted publisher allows staged publishing only (DECISIONS D28), so the
// release job stages a tarball and a human approves it on npm. While it is staged the
// version is not live, and a tag at that moment points at a release that does not
// exist yet. Changesets cannot do this either: with `.` in `workspaces` it names tags
// `react-native-nitro-ui@0.1.1` rather than `v0.1.1`.
//
// So this keys on state, not on "did my run publish": when `package.json`'s version is
// on the registry and no `vX.Y.Z` release exists, create it at the commit that bumped
// the version, with that version's `CHANGELOG.md` section as the notes. Every branch
// is a no-op once the work is done, so the scheduled run and a manual one are safe.
//
// It only handles the version currently in `package.json`; a release missed further
// back is created by hand with `gh release create`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/**
 * This file's path when Node was asked to run it, otherwise null. Read from
 * `argv` rather than `import.meta` so the module stays importable: Jest
 * transpiles to CommonJS, where `import.meta` is a syntax error. Comparing
 * realpathed paths also avoids the percent-encoding trap that comparing against
 * `file://` + argv[1] falls into.
 */
function entryPath() {
  const entry = process.argv[1];
  if (!entry) return null;
  try {
    const resolved = realpathSync(resolve(entry));
    return basename(resolved) === 'release-catch-up.mjs' ? resolved : null;
  } catch {
    return null;
  }
}

const entry = entryPath();
const repoRoot = entry ? resolve(dirname(entry), '..') : process.cwd();

/**
 * The `## <version>` section of the changelog, heading text tolerant of the date the
 * hand-written entries carry (`## 0.1.0 — 2026-10-26`).
 */
export function changelogEntry(changelog, version) {
  const lines = changelog.split('\n');
  let from = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!heading) continue;
    const title = heading[1];
    if (title === version || title.startsWith(`${version} `)) {
      from = index;
      break;
    }
  }
  if (from === -1) return null;
  const body = [];
  for (let index = from + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    body.push(lines[index]);
  }
  return `## ${version}\n${body.join('\n').trim()}`;
}

/**
 * The commit that bumped `package.json` to this version: in the history of the file
 * (newest first), the oldest commit of the newest run that carries exactly this
 * version. A later commit that touches `package.json` without changing the version
 * (a dependency bump) must not take the tag.
 */
export function findVersionCommit(commits, version, readVersionAt) {
  let found = null;
  for (const sha of commits) {
    if (readVersionAt(sha) === version) {
      found = sha;
    } else if (found !== null) {
      break;
    }
  }
  return found;
}

/**
 * Decide, and unless `dryRun` perform, the catch-up. Everything external arrives
 * through `exec`, `read` and `log` so the tests can mock npm, `gh` and git.
 */
export async function runCatchUp(options = {}) {
  const {
    env = process.env,
    exec = runCommand,
    read = (relative) => readFileSync(resolve(repoRoot, relative), 'utf8'),
    log = (message) => console.log(message),
    dryRun = false,
  } = options;

  const pkg = JSON.parse(read('package.json'));
  const version = pkg.version;
  const tag = `v${version}`;

  const live = exec(['npm', ['view', `${pkg.name}@${version}`, 'version']]);
  if (live.code !== 0) {
    log(`${pkg.name}@${version} is not on the registry yet — nothing to tag.`);
    return { action: 'skip', reason: 'not-live', tag, version };
  }

  const repository = env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error(
      'GITHUB_REPOSITORY is not set, so there is no release to create.'
    );
  }

  const existing = exec([
    'gh',
    ['release', 'view', tag, '--repo', repository, '--json', 'tagName'],
  ]);
  if (existing.code === 0) {
    log(`${tag} already has a release — nothing to do.`);
    return { action: 'skip', reason: 'release-exists', tag, version };
  }

  const history = exec(['git', ['log', '--format=%H', '--', 'package.json']]);
  const sha = findVersionCommit(
    history.stdout.split('\n').filter(Boolean),
    version,
    (commit) => {
      const shown = exec(['git', ['show', `${commit}:package.json`]]);
      if (shown.code !== 0) return undefined;
      try {
        return JSON.parse(shown.stdout).version;
      } catch {
        return undefined;
      }
    }
  );
  if (!sha) {
    throw new Error(
      `No commit in this checkout sets package.json to ${version}; refusing to guess a target.`
    );
  }

  const section = changelogEntry(read('CHANGELOG.md'), version);
  const notes =
    section ?? `## ${version}\n\nSee CHANGELOG.md at ${sha.slice(0, 7)}.`;

  if (dryRun) {
    log(`dry run: would create ${tag} at ${sha.slice(0, 7)}`);
    return { action: 'dry-run', reason: 'planned', tag, version, sha };
  }

  const created = exec([
    'gh',
    [
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--target',
      sha,
      '--title',
      `${pkg.name} ${version}`,
      '--notes',
      notes,
    ],
  ]);
  if (created.code !== 0) {
    throw new Error(
      `gh release create failed (${created.code}):\n${created.stderr || created.stdout}`
    );
  }
  log(`created ${tag} at ${sha.slice(0, 7)}`);
  return { action: 'released', reason: 'created', tag, version, sha };
}

/** argv arrays only, never a shell: nothing here can be injected. */
function runCommand([command, args]) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

if (entry) {
  runCatchUp({ dryRun: process.argv.includes('--dry-run') }).catch((error) => {
    console.error(`release-catch-up: ${error.message}`);
    process.exitCode = 1;
  });
}
