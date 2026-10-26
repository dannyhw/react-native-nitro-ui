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
    // The changelog it writes is checked by `bun run format`, so it must be
    // written with this repo's prettier.
    expect(config.format).toBe('prettier');
  });

  it('ignores every workspace that is not the published package', () => {
    const workspaces = pkg.workspaces;
    expect(workspaces.length).toBeGreaterThan(0);

    const names = workspaces.map((dir) => readJson(join(dir, 'package.json')));
    const publishable = names.filter((entry) => !entry.private);
    expect(publishable).toEqual([]);

    // `ignore` is by package name, and it must cover every workspace: a
    // workspace that is only `private` would still be versioned and tagged.
    for (const entry of names) {
      expect(config.ignore).toContain(entry.name);
      expect(entry.private).toBe(true);
    }
    // Nothing else in the repo may be left out by accident.
    expect(config.ignore.sort()).toEqual(
      names.map((entry) => entry.name).sort()
    );

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
