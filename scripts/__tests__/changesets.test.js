// Releases are cut by Changesets (DECISIONS D27) and staged on npm (D28). These
// assertions keep that setup honest: the workspaces that must never be versioned
// or published stay excluded, the release-it scaffold is really gone, the
// changelog stays in the shape the release notes are read out of, and the
// workflows keep the rights they need and no more than that.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function readJson(path) {
  return JSON.parse(read(path));
}

const config = readJson('.changeset/config.json');
const pkg = readJson('package.json');
const SOURCES = {
  'release.yml': read('.github/workflows/release.yml'),
  'release-tag.yml': read('.github/workflows/release-tag.yml'),
  'changeset-status.yml': read('.github/workflows/changeset-status.yml'),
  'actions/setup/action.yml': read('.github/actions/setup/action.yml'),
};
const releaseWorkflow = SOURCES['release.yml'];
const tagWorkflow = SOURCES['release-tag.yml'];

/**
 * The body of one job, so a permission or a step can be asserted about the job
 * it belongs to instead of about the whole file. Job names sit at two spaces, so
 * the next key at that indent ends the job.
 */
function job(workflow, name) {
  const header = `\n  ${name}:\n`;
  const start = workflow.indexOf(header);
  if (start === -1) throw new Error(`the workflow has no "${name}" job`);
  const body = workflow.slice(start + header.length);
  const end = body.search(/\n {2}\S+:/);
  return end === -1 ? body : body.slice(0, end);
}

/** Everything a workflow hands to a shell, block scalars and one-liners alike. */
function runBodies(source) {
  const lines = source.split('\n');
  const bodies = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*(\||>)?\s*(.*)$/);
    if (!match) continue;
    const [, indent, block, inline] = match;
    if (!block) {
      bodies.push(inline);
      continue;
    }
    const body = [];
    let next = index + 1;
    for (; next < lines.length; next += 1) {
      const line = lines[next];
      const leading = line.match(/^\s*/)[0].length;
      if (line.trim() !== '' && leading <= indent.length) break;
      body.push(line);
    }
    bodies.push(body.join('\n'));
    index = next - 1;
  }
  return bodies;
}

/** The `## ` headings of a changelog, top to bottom. */
function changelogHeadings(changelog) {
  return [...changelog.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
}

/**
 * `0.1.1`, or `0.1.0 — 2026-10-26`: Changesets writes the bare version, the
 * hand-written entry carries a date. Anything else is not a version heading.
 */
function parseVersion(heading) {
  const match = heading.match(/^(\d+)\.(\d+)\.(\d+)(?:\s+[—-].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function changelogWith(headings) {
  return [
    '# Changelog',
    '',
    ...headings.flatMap((heading) => [`## ${heading}`, 'A note.', '']),
  ].join('\n');
}

/**
 * The changelog invariant the release notes depend on: `0.1.0` stays the last
 * version heading, and above it every heading is a version, newest first —
 * because Changesets prepends, and the catch-up job reads a version's section
 * out of this file. Returns what is wrong, so a test can assert `[]` and see the
 * reason when it is not.
 */
function changelogProblems(changelog) {
  const headings = changelogHeadings(changelog);
  const last = headings.at(-1);
  if (!last || !/^0\.1\.0(?:\s|$)/.test(last)) {
    return [
      `the last version heading must be 0.1.0, found ${JSON.stringify(last)}`,
    ];
  }

  const problems = [];
  let newer = null;
  for (const heading of headings.slice(0, -1)) {
    const version = parseVersion(heading);
    if (!version) {
      problems.push(`${JSON.stringify(heading)} is not a version heading`);
      newer = null;
      continue;
    }
    if (newer && compareVersions(version, newer) >= 0) {
      problems.push(`${heading} is not older than the entry above it`);
    }
    newer = version;
  }
  return problems;
}

describe('changesets configuration', () => {
  it('versions from main and publishes publicly', () => {
    expect(config.baseBranch).toBe('main');
    expect(config.access).toBe('public');
    // Changesets writes package.json and CHANGELOG.md, and `bun run format`
    // checks them afterwards: `prettier` makes it run this repo's prettier with
    // this repo's config instead of its own defaults.
    expect(config.format).toBe('prettier');
  });

  it('writes the changelog without needing a GitHub token', () => {
    // @changesets/changelog-github refuses to run at all when GITHUB_TOKEN is
    // missing. Inside Actions the action exports one, so it would work there —
    // but it would make `bun run release:version` un-runnable on a laptop, and
    // a changelog generator is not worth a token on the release path. The cost:
    // entries carry a plain short sha, which GitHub links in a release body and
    // not in a rendered CHANGELOG.md.
    expect(config.changelog).toBe('@changesets/changelog-git');
    expect(pkg.devDependencies['@changesets/changelog-github']).toBeUndefined();
  });

  it('lists the library itself as a workspace, which is what makes it versionable', () => {
    // Changesets only versions packages inside the workspace globs; the root
    // package.json is only reported by @manypkg/get-packages when `.` is one of
    // them. Drop the entry and `changeset version` fails with "not in the
    // workspace" — see the R6 report. It is also why Changesets would name its
    // tags `react-native-nitro-ui@0.1.1`: with `.` present, manypkg reports the
    // tool as `bun`, and only `root` gets a plain `vX.Y.Z`.
    expect(pkg.workspaces[0]).toBe('.');
    expect(pkg.devDependencies['@changesets/cli']).toMatch(/^\^3/);
  });

  it('ignores every workspace that is not the published package', () => {
    // `.` is the library itself (see the workspace test above); everything else
    // in `workspaces` must be excluded from versioning by name. Being `private`
    // only stops the publish — Changesets would still bump and tag it.
    const workspaceDirs = pkg.workspaces.filter((dir) => dir !== '.');
    expect(workspaceDirs.length).toBeGreaterThan(0);
    expect(pkg.workspaces).toContain('.');

    const ignored = workspaceDirs.map(
      (dir) => readJson(join(dir, 'package.json')).name
    );
    for (const name of ignored) {
      expect(config.ignore).toContain(name);
      expect(name).not.toBe(pkg.name);
    }
    expect([...config.ignore].sort()).toEqual(ignored.sort());

    // Belt and braces: private packages are neither versioned nor tagged.
    expect(config.privatePackages).toEqual({ version: false, tag: false });
  });
});

describe('changelog shape', () => {
  it('keeps the hand-written 0.1.0 entry last, with newer versions above it', () => {
    expect(changelogProblems(read('CHANGELOG.md'))).toEqual([]);
  });

  it('accepts what the first Version Packages merge will write', () => {
    // The old guard asserted 0.1.0 was the *first* heading and the only one, so
    // the first version Changesets ever cut — `## 0.1.1` above `## 0.1.0` —
    // would have failed `bun run check` and blocked the release forever. Nothing
    // runs on that pull request (it is opened with GITHUB_TOKEN), so the post-
    // merge release run is its only gate, and it has to accept this.
    expect(
      changelogProblems(changelogWith(['0.1.1', '0.1.0 — 2026-10-26']))
    ).toEqual([]);
    expect(
      changelogProblems(
        changelogWith(['0.2.0', '0.1.2', '0.1.1', '0.1.0 — 2026-10-26'])
      )
    ).toEqual([]);
  });

  it('rejects a changelog that has lost the order the notes are read from', () => {
    // Oldest on top: the catch-up job would still find the section, but every
    // reader would take the wrong entry for the current release.
    expect(
      changelogProblems(changelogWith(['0.1.0 — 2026-10-26', '0.1.1']))
    ).toEqual([expect.stringContaining('must be 0.1.0')]);
    expect(
      changelogProblems(changelogWith(['0.1.1', '0.1.2', '0.1.0 — 2026-10-26']))
    ).toEqual([expect.stringContaining('not older')]);
    expect(
      changelogProblems(changelogWith(['Unreleased', '0.1.0 — 2026-10-26']))
    ).toEqual([expect.stringContaining('not a version heading')]);
    expect(changelogProblems(changelogWith(['0.1.1']))).toEqual([
      expect.stringContaining('must be 0.1.0'),
    ]);
  });
});

describe('release-it is gone', () => {
  it('removes the dependency, the config and the script', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(
      Object.keys(deps).filter((d) => d.startsWith('@release-it/'))
    ).toEqual([]);
    expect(deps['release-it']).toBeUndefined();
    expect(pkg['release-it']).toBeUndefined();
    expect(pkg.scripts.release).toBeUndefined();
  });

  it('has changesets commands instead, and no way to publish from here', () => {
    expect(pkg.devDependencies['@changesets/cli']).toBeDefined();
    expect(pkg.scripts.changeset).toBe('changeset');
    // `changeset version` touches package.json and CHANGELOG.md only, so the same
    // script also refreshes `example/ios/Podfile.lock` — the action commits the tree
    // straight after this script, so that is the only moment the Version Packages
    // commit can be made internally consistent. `bun run check` then guards it.
    //
    // The `--preflight` first is the part to keep: `changeset version` writes, so a
    // refusal after it leaves a half-versioned tree on a machine that only wanted a
    // preview. `example-lock.test.js` proves the refusal itself writes nothing.
    expect(pkg.scripts['release:version']).toBe(
      'node scripts/sync-example-lock.mjs --preflight && changeset version && ' +
        'node scripts/sync-example-lock.mjs --fix'
    );
    // Publishing is not a thing a checkout can do: CI stages, and a person
    // approves on npmjs.com. `changeset publish` would try `npm publish`, which
    // the trusted publisher rejects, and `npm stage publish` needs an
    // identity a contributor's laptop must not carry.
    expect(pkg.scripts['release:publish']).toBeUndefined();
    for (const script of Object.values(pkg.scripts)) {
      expect(script).not.toMatch(/\bchangeset (publish|tag|release)\b/);
    }
  });
});

describe('release workflow', () => {
  it('is triggered by main and by hand, one run at a time', () => {
    expect(releaseWorkflow).toMatch(/on:\n\s+push:\n\s+branches:\n\s+- main/);
    expect(releaseWorkflow).toMatch(/\n {2}workflow_dispatch:/);
    expect(releaseWorkflow).toMatch(/cancel-in-progress: false/);
  });

  it('gives every job its own rights, with nothing inherited', () => {
    expect(releaseWorkflow).toMatch(/^permissions: \{\}$/m);
    expect(job(releaseWorkflow, 'pack')).toMatch(
      /permissions:\n\s+contents: read/
    );
    expect(job(releaseWorkflow, 'version')).toMatch(/contents: write/);
    expect(job(releaseWorkflow, 'version')).toMatch(/pull-requests: write/);
    expect(job(releaseWorkflow, 'pack')).not.toMatch(/id-token/);
    expect(job(releaseWorkflow, 'version')).not.toMatch(/id-token/);
    expect(job(releaseWorkflow, 'stage')).toMatch(
      /permissions:\n\s+id-token: write/
    );
    // The job that can reach npm holds that and nothing else.
    expect(job(releaseWorkflow, 'stage')).not.toMatch(
      /contents: |pull-requests:/
    );
    expect(releaseWorkflow.match(/id-token: write/g)).toHaveLength(1);
  });

  it('keeps repository code out of the job holding the OIDC token', () => {
    const stage = job(releaseWorkflow, 'stage');
    // The job's own comments say what it leaves out, so assert on the code:
    // the actions it calls and the bodies it hands to a shell.
    const code = [
      ...runBodies(stage),
      ...[...stage.matchAll(/uses: (\S+)/g)].map((match) => match[1]),
    ].join('\n');
    expect(code).not.toMatch(/actions\/checkout/);
    expect(code).not.toMatch(/oven-sh|setup-bun/);
    expect(code).not.toMatch(/\bbun\b/);
    expect(code).not.toMatch(/\.\/\.github\/actions/);
    expect(code).toMatch(/npm install --global npm@/);
    expect(stage).toMatch(
      /node-version: \$\{\{ needs\.pack\.outputs\.node \}\}/
    );
  });

  it('runs the gates before anything that can version or stage', () => {
    const pack = job(releaseWorkflow, 'pack');
    expect(pack).toMatch(/bun run check/);
    expect(pack).toMatch(/git diff --exit-code -- nitrogen\//);
    expect(pack).toMatch(/git status --porcelain/);
    for (const name of ['stage', 'version']) {
      expect(job(releaseWorkflow, name)).toMatch(/\n {4}needs: pack\n/);
    }
  });

  it('hands a checksum-verified tarball from the packing job to the staging job', () => {
    expect(job(releaseWorkflow, 'pack')).toMatch(/npm pack --pack-destination/);
    expect(job(releaseWorkflow, 'pack')).toMatch(/sha256sum/);
    const stage = job(releaseWorkflow, 'stage');
    expect(stage).toMatch(/actions\/download-artifact/);
    expect(stage).toMatch(/sha256sum --check --status/);
    expect(stage).toMatch(/needs\.pack\.outputs\.sha256/);
    expect(releaseWorkflow).toMatch(/actions\/upload-artifact/);
  });

  it('stages instead of publishing, and survives being run again', () => {
    const stage = job(releaseWorkflow, 'stage');
    expect(stage).toMatch(/npm stage publish/);
    expect(stage).not.toMatch(/\bnpm publish\b/);
    // State, not memory: already live means nothing to do, and npm's own
    // "already known" answer is a success rather than a red run.
    expect(stage).toMatch(/npm view "\$PACKAGE@\$VERSION" version/);
    expect(stage).toMatch(/npm stage list/);
    expect(stage).toMatch(
      /cannot publish over the previously published versions/
    );
  });

  it('has the action version the Changesets v3 CLI needs, for versioning only', () => {
    const version = job(releaseWorkflow, 'version');
    expect(version).toMatch(/changesets\/action@[0-9a-f]{40} # v2\./);
    // The v2 action takes `*-script` inputs and kebab-case outputs; the v1 names
    // are silently ignored, which would silently skip the version step.
    expect(version).toMatch(/version-script: bun run release:version/);
    // With no publish-script the action never publishes, which is the point.
    expect(version).not.toMatch(/^\s+publish-script:/m);
    // It would also tag `react-native-nitro-ui@0.1.1` rather than `v0.1.1`.
    expect(version).toMatch(/push-git-tags: 'false'/);
    expect(version).toMatch(/create-github-releases: 'false'/);
    expect(version).toMatch(/steps\.changesets\.outputs\.pr-number/);
    expect(version).toMatch(/steps\.changesets\.outputs\.has-changesets/);
  });

  it('publishes with trusted publishing, never a token', () => {
    for (const [file, source] of Object.entries(SOURCES)) {
      expect({ file, source }).toEqual({
        file,
        source: expect.not.stringMatching(
          /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/
        ),
      });
    }
    expect(releaseWorkflow).toMatch(/registry-url/);
    expect(releaseWorkflow).toMatch(/id-token: write/);
  });

  it('passes values to shells through env, never by interpolation', () => {
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) =>
      runBodies(source)
        .filter((body) => body.includes('${{'))
        .map((body) => `${file}: ${body}`)
    );
    expect(offenders).toEqual([]);
  });

  it('reports even when a step failed', () => {
    expect(releaseWorkflow).toMatch(/if: always\(\)/);
  });
});

describe('release tag workflow', () => {
  it('runs hourly and by hand, with release rights and no npm rights', () => {
    // A comment sits inside the schedule block, explaining the cadence.
    expect(tagWorkflow).toMatch(
      /on:\n\s+schedule:\n(\s*(#.*)?\n)*\s+- cron: '/
    );
    expect(tagWorkflow).toMatch(/\n {2}workflow_dispatch:/);
    expect(tagWorkflow).toMatch(/^permissions: \{\}$/m);
    expect(tagWorkflow).toMatch(/permissions:\n\s+contents: write/);
    expect(tagWorkflow).not.toMatch(/id-token/);
    // The version commit is found by walking package.json's history.
    expect(tagWorkflow).toMatch(/fetch-depth: 0/);
    expect(tagWorkflow).toMatch(/node scripts\/release-catch-up\.mjs/);
    expect(tagWorkflow).toMatch(/GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  });
});

describe('action pins', () => {
  it('pins every action by commit sha, in every workflow', () => {
    for (const [file, source] of Object.entries(SOURCES)) {
      const used = [...source.matchAll(/uses: ([^\s@]+)(?:@([0-9a-f]{40}))?/g)];
      expect({ file, count: used.length }).toEqual({
        file,
        count: expect.any(Number),
      });
      expect(used.length).toBeGreaterThan(0);
      // `uses: ./path` is the repository's own tree, pinned by the commit it
      // came from, so it is the one reference that needs no sha.
      const unpinned = used
        .filter((match) => !match[2] && !match[1].startsWith('./'))
        .map((match) => match[1]);
      expect({ file, unpinned }).toEqual({ file, unpinned: [] });
    }
  });

  it('pins the actions the release pipeline depends on', () => {
    const combined = Object.values(SOURCES).join('\n');
    for (const action of [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'actions/download-artifact',
      'oven-sh/setup-bun',
      'actions/cache/restore',
      'actions/cache/save',
    ]) {
      // Pinned by commit, with the release that commit is named after.
      expect(combined).toMatch(new RegExp(`${action}@[0-9a-f]{40} # v\\d+\\.`));
    }
  });
});
