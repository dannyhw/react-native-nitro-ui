// Releases are cut by Changesets and published from GitHub Actions with npm
// trusted publishing (DECISIONS D27). These assertions keep that setup honest:
// the workspaces that must never be versioned or published stay excluded, the
// release-it scaffold is really gone, and the release workflow still has no
// npm credential to leak.
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
const releaseWorkflow = read('.github/workflows/release.yml');
const statusWorkflow = read('.github/workflows/changeset-status.yml');

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
    // missing, which would make `bun run release:version` un-runnable locally
    // and put a GitHub API call on the release path. Entries link commits.
    expect(config.changelog).toBe('@changesets/changelog-git');
    expect(pkg.devDependencies['@changesets/changelog-github']).toBeUndefined();
  });

  it('lists the library itself as a workspace, which is what makes it versionable', () => {
    // Changesets only versions packages inside the workspace globs; the root
    // package.json is only reported by @manypkg/get-packages when `.` is one of
    // them. Drop the entry and `changeset version` fails with "not in the
    // workspace" — see the R6 report.
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

  it('keeps the hand-written 0.1.0 changelog entry as the base', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toMatch(/^## 0\.1\.0 — /m);
    // New entries are prepended above it, so it must stay the last h2 version.
    const versions = [...changelog.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(versions[0]).toMatch(/^0\.1\.0/);
    expect(versions.length).toBe(1);
  });

  it('ships the changelog inside the package', () => {
    expect(pkg.files).toContain('CHANGELOG.md');
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

  it('has changesets commands instead', () => {
    expect(pkg.devDependencies['@changesets/cli']).toBeDefined();
    expect(pkg.scripts.changeset).toBe('changeset');
    expect(pkg.scripts['release:publish']).toBe('changeset publish');
    expect(pkg.scripts['release:version']).toMatch(/^changeset version\b/);
  });
});

describe('release workflow', () => {
  it('is triggered by main, once at a time', () => {
    expect(releaseWorkflow).toMatch(/on:\n\s+push:\n\s+branches:\n\s+- main/);
    expect(releaseWorkflow).toMatch(/cancel-in-progress: false/);
  });

  it('has exactly the permissions releasing needs', () => {
    expect(releaseWorkflow).toMatch(/contents: write/);
    expect(releaseWorkflow).toMatch(/pull-requests: write/);
    expect(releaseWorkflow).toMatch(/id-token: write/);
  });

  it('publishes with trusted publishing, never a token', () => {
    for (const workflow of [releaseWorkflow, statusWorkflow]) {
      expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
    }
    expect(releaseWorkflow).toMatch(/registry-url/);
    expect(releaseWorkflow).toMatch(/id-token: write/);
  });

  it('runs the gates and the codegen check before publishing', () => {
    expect(releaseWorkflow).toMatch(/bun run check/);
    expect(releaseWorkflow).toMatch(/git diff --exit-code -- nitrogen\//);
    const checksAt = releaseWorkflow.indexOf('bun run check');
    const publishAt = releaseWorkflow.indexOf('changesets/action@');
    expect(checksAt).toBeGreaterThan(-1);
    expect(publishAt).toBeGreaterThan(checksAt);
  });

  it('uses the action line that matches Changesets v3', () => {
    expect(releaseWorkflow).toMatch(/changesets\/action@[0-9a-f]{40} # v2\./);
    // The v2 action takes `*-script` inputs and kebab-case outputs; the v1
    // names are silently ignored, which would silently skip the version step.
    expect(releaseWorkflow).toMatch(
      /\n {10}version-script: bun run release:version/
    );
    expect(releaseWorkflow).toMatch(
      /\n {10}publish-script: bun run release:publish/
    );
    expect(releaseWorkflow).toMatch(
      /steps\.release\.outputs\.published-packages/
    );
    expect(releaseWorkflow).toMatch(/steps\.release\.outputs\.pr-number/);
  });

  it('pins every action by commit sha', () => {
    const shas = [
      ...releaseWorkflow.matchAll(/uses: ([^\s@]+)@([0-9a-f]{40})/g),
    ];
    expect(shas.length).toBeGreaterThanOrEqual(4);
    const unpinned = [
      ...releaseWorkflow.matchAll(/uses: (?!.*[0-9a-f]{40})(\S+)/g),
    ];
    expect(unpinned.map((m) => m[1])).toEqual([]);
  });
});
