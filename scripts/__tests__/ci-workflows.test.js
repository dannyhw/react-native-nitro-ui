/**
 * Do the workflows still say what CI has to do?
 *
 * `main` was red for about seven hours on 31 Oct and nobody noticed, and the
 * reasons were all in YAML: a depth-1 checkout for a job that reads an earlier
 * commit (`96ad69c`), and a concurrency group that cancelled a push to `main`
 * with the next push to `main`, so a sha can land with no conclusion at all (F4).
 * None of it is visible from `bun run check`, because nothing here ran the
 * workflows.
 *
 * So this reads them as data and asks the questions the failures actually turned
 * on - parsed YAML rather than a grep, so a reformat cannot hide a hole and a
 * reword cannot make a guard pass by not matching anything. The
 * `callstackincubator/react-native-harness` pin is checked against the CLI this
 * repo installs, because the action's first step refuses a project whose CLI
 * predates its own `harness ci` interface: that is a red job with a one-line
 * cause nobody reads.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import yaml from 'js-yaml';

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');

/**
 * Parsed YAML for one workflow file (or a composite action, by repo-relative
 * path). A parse failure names the file, because a guard that cannot read its
 * subject is worse than no guard: it would pass on a file renamed away.
 *
 * @param {string} file `ci.yml`, or a repo-relative path
 * @returns {any}
 */
function readYaml(file) {
  const absolute = file.includes('/')
    ? path.join(root, file)
    : path.join(workflowDir, file);
  return yaml.load(fs.readFileSync(absolute, 'utf8'));
}

/**
 * A workflow's `on:` mapping. YAML 1.1 reads the bare `on` key as the boolean
 * `true`, and the two loaders disagree, so both spellings are accepted here.
 *
 * @param {string} file
 * @returns {any}
 */
function triggers(file) {
  const doc = readYaml(file);
  return doc.on ?? doc[true];
}

/**
 * What a `cancel-in-progress` expression answers for a given ref.
 *
 * The two F4 requirements pull in opposite directions - never cancel on `main`,
 * still cancel a superseded PR - and the only way to test the pair is to ask the
 * expression what it decides rather than pattern-match its text. The grammar is
 * deliberately tiny (a comparison of `github.ref` against a literal, optionally
 * `||`'d), because that is all a concurrency group needs and anything richer
 * should fail loudly here rather than be silently misread.
 *
 * @param {unknown} value the parsed YAML value
 * @param {string} ref e.g. `refs/heads/main`
 * @returns {boolean}
 */
function cancelsFor(value, ref) {
  if (typeof value === 'boolean') return value;
  const expression = String(value)
    .trim()
    .replace(/^\$\{\{|\}\}$/g, '')
    .trim();
  if (expression === '') {
    throw new Error(
      `cannot read a cancel-in-progress decision out of ${value}`
    );
  }
  return expression
    .split('||')
    .some((clause) => evalClause(clause.trim(), ref));
}

/**
 * @param {string} clause e.g. `github.ref != 'refs/heads/main'`
 * @param {string} ref
 * @returns {boolean}
 */
function evalClause(clause, ref) {
  const match = /^github\.ref\s*(===|!==|==|!=)\s*'([^']*)'$/.exec(clause);
  if (match == null) {
    throw new Error(
      `ci.yml's cancel-in-progress uses a shape this test does not understand: ${clause}`
    );
  }
  const [, operator, literal] = match;
  const equal = ref === literal;
  const same = operator === '==' || operator === '===';
  return equal === same;
}

/**
 * @param {string} file repo-relative path
 * @returns {string} '' when the file does not exist
 */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

describe('CI keeps every push to main to a conclusion', () => {
  it('parses what it is about to judge', () => {
    const ci = triggers('ci.yml');
    expect(ci).not.toEqual(null);
    expect(ci.push.branches).toEqual(['main']);
    expect(ci.pull_request.branches).toEqual(['main']);
    expect(readYaml('ci.yml').concurrency).not.toEqual(null);
  });

  it('does not cancel an in-progress run of main', () => {
    // The incident: several pushes to `main` today ended `cancelled`, so the
    // newest commit had no CI result at all, during the same window main was
    // red. A superseded *feature* run is worth cancelling; a superseded main run
    // is the only record that main is green, and the release workflow reads main.
    const value = readYaml('ci.yml').concurrency['cancel-in-progress'];
    expect(cancelsFor(value, 'refs/heads/main')).toBe(false);
  });

  it('still cancels a superseded run on a pull request or feature branch', () => {
    // The other half, so the fix is not "stop cancelling": every branch push used
    // to queue behind every other, and 20-minute jobs on stale commits is what a
    // concurrency group exists to prevent.
    const value = readYaml('ci.yml').concurrency['cancel-in-progress'];
    expect(cancelsFor(value, 'refs/pull/9/merge')).toBe(true);
    expect(cancelsFor(value, 'refs/heads/task/F4-ci-green')).toBe(true);
  });

  it('the release workflows still refuse to cancel a run that may be staging', () => {
    for (const file of ['release.yml', 'release-tag.yml']) {
      const value = readYaml(file).concurrency['cancel-in-progress'];
      // A truthy-but-not-`true` value (`'false'`, an expression) is not the same
      // answer to GitHub, so this is an exact check on purpose.
      expect(value).toBe(false);
    }
  });
});

describe('CI jobs that need history get it', () => {
  it('every job that runs `check` or the catch-up script fetches the full history', () => {
    // `96ad69c` fixed this for the jobs that run `check`: the bench-deps tests
    // read `bun.lock` at an earlier commit, and `HEAD~5` does not exist in a
    // depth-1 checkout. The rule is per job, so a job added tomorrow is covered
    // by the rule rather than by someone remembering the reason.
    const commandsNeedingHistory = ['bun run check', 'release-catch-up.mjs'];
    const problems = [];
    for (const file of ['ci.yml', 'release.yml', 'release-tag.yml']) {
      for (const [id, job] of Object.entries(readYaml(file).jobs)) {
        const steps = job.steps ?? [];
        const run = steps.map((step) => step.run ?? '').join('\n');
        const asked = commandsNeedingHistory.filter((command) =>
          run.includes(command)
        );
        if (asked.length === 0) continue;
        const checkout = steps.find((step) =>
          String(step.uses ?? '').startsWith('actions/checkout@')
        );
        if (checkout?.with?.['fetch-depth'] !== 0) {
          problems.push(`${file} job "${id}" runs ${asked.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the dispatch-only harness jobs are given what the action needs', () => {
  /**
   * The harness action step of a CI job.
   *
   * @param {string} jobId
   */
  function harnessStep(jobId) {
    const job = triggers('ci.yml') && readYaml('ci.yml').jobs[jobId];
    expect(job).not.toBeUndefined();
    const step = (job.steps ?? []).find((candidate) =>
      String(candidate.uses ?? '').startsWith(
        'callstackincubator/react-native-harness@'
      )
    );
    expect(step).not.toBeUndefined();
    return step;
  }

  it('passes an absolute `app:` path, because the CLI only ever existsSync()es it', () => {
    // Q4 row 55 filed this as "the action parsed an empty JSON input", read from
    // a CI log. Reading the pinned `action.yml` (read-only, at 3e3e25b) says the
    // real story: the JSON is `steps.load-config.outputs.config`, written by
    // `harness ci load-config`, and that step imports `example/rn-harness.config
    // .mjs` - whose stamp gate then refused, because the job had built an APK and
    // the config had guessed iOS. The empty input is the consequence; a relative
    // `app:` is the second half of the same bug, and it is what A2 lost three runs
    // to: the platform resolves `HARNESS_APP_PATH` against `projectRoot`
    // (`example/`), so a workflow-relative path names nothing, no app is ever
    // installed, and the run aborts as an opaque `AbortError`.
    for (const jobId of ['harness-android', 'harness-ios']) {
      const app = String(harnessStep(jobId).with.app);
      expect(app).toMatch(/^\$\{\{ github\.workspace \}\}\//);
      expect(app).toMatch(/app-debug\.apk|NitroUiExample\.app/);
    }
  });

  it('the pinned action can talk to the CLI this repo installs', () => {
    // The action's second step resolves `react-native-harness/package.json` and
    // refuses a CLI without `harnessActionProtocol >= 1`. That is a red job whose
    // entire cause is a pin out of sync with a dependency bump.
    const pin = String(harnessStep('harness-android').uses).split('@').pop();
    expect(pin).toHaveLength(40);
    const cli = JSON.parse(
      fs.readFileSync(
        path.join(root, 'node_modules', 'react-native-harness', 'package.json'),
        'utf8'
      )
    );
    const declared =
      JSON.parse(
        fs.readFileSync(path.join(root, 'example', 'package.json'), 'utf8')
      ).devDependencies['react-native-harness'] ??
      JSON.parse(
        fs.readFileSync(path.join(root, 'example', 'package.json'), 'utf8')
      ).dependencies['react-native-harness'];
    expect(declared).toBeDefined();
    // The action runs `node -p require.resolve('react-native-harness/package
    // .json', {paths:[process.cwd()]})` from `example/`, where bun's hoist puts
    // the copy its devDependency names.
    expect(cli.version).toBe(declared);
    // Protocol 1 is the capability the pinned action requires (`REQUIRED_PROTOCOL
    // = 1` in its `action.yml`); a CLI older than that fails in step two.
    expect(Number(cli.harnessActionProtocol ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['harness-android', 'build-app.mjs --platform android'],
    ['harness-ios', 'build-app.mjs --platform ios'],
  ])('%s builds its stamped app before the action runs', (jobId, command) => {
    // rn-harness.config.mjs refuses an artifact it cannot prove was built from
    // this tree, so a raw gradle/xcodebuild step builds the right binary and then
    // fails its own gate (review S1).
    const job = readYaml('ci.yml').jobs[jobId];
    const run = (job.steps ?? [])
      .filter((step) => step.uses == null && step.run != null)
      .map((step) => String(step.run))
      .join('\n');
    expect(run).toContain(command);
  });
});

describe('the release pipeline does not share machine state with a publish', () => {
  /**
   * The `with:` of a job's shared-setup step, or null when the job has none.
   *
   * @param {string} jobId
   */
  function setupWith(jobId) {
    const step = (readYaml('release.yml').jobs[jobId].steps ?? []).find(
      (candidate) =>
        String(candidate.uses ?? '').includes('.github/actions/setup')
    );
    return step == null ? null : (step.with ?? {});
  }

  it('packs the publish artifact without a restored node_modules', () => {
    // npm's own guidance, and the reason `stage` sets `package-manager-cache:
    // false`. `pack` is the job that actually builds the tarball - `prepare` runs
    // builder-bob and nitrogen through this `node_modules` - and a cache key is
    // two lockfiles' hashes, not proof that the directory matches the sources
    // being packed (R6 re-review N-1, row 53).
    expect(setupWith('pack')).not.toBe(null);
    expect(setupWith('pack')['package-manager-cache']).toBe(false);
  });

  it('the composite can install without caching, and every cache step obeys it', () => {
    const action = readYaml('.github/actions/setup/action.yml');
    expect(Object.keys(action.inputs ?? {})).toContain('package-manager-cache');
    expect(action.inputs['package-manager-cache'].default).toBe(true);
    const cacheSteps = (action.runs.steps ?? []).filter((step) =>
      String(step.uses ?? '').startsWith('actions/cache')
    );
    expect(cacheSteps.length).toBeGreaterThan(0);
    // A cache step that ignores the input makes the input a lie, which is worse
    // than not having one: the release job would read as uncached while still
    // restoring whatever the last tree saved.
    const ungated = cacheSteps
      .filter(
        (step) => !String(step.if ?? '').includes('package-manager-cache')
      )
      .map((step) => String(step.name));
    expect(ungated).toEqual([]);
  });

  it('the catch-up cron does not start on the hour', () => {
    // Minute 0 is when every other repository's hourly cron arrives, and a
    // scheduled workflow that cannot get a runner can be skipped outright.
    const crons = (triggers('release-tag.yml').schedule ?? []).map(
      (entry) => entry.cron
    );
    expect(crons.length).toBeGreaterThan(0);
    expect(crons.map((cron) => String(cron).split(/\s+/)[0])).toEqual(
      expect.arrayContaining([expect.not.stringMatching(/^0$/)])
    );
    for (const cron of crons) {
      expect(String(cron).split(/\s+/)[0]).not.toBe('0');
    }
  });

  it('a staged-but-not-approved version is recognised from both npm wordings', () => {
    // The E409 wording is what a re-run during the approval window actually
    // prints (seen 2026-10-29 with 0.3.2); the older one is what an already-live
    // version prints. Matching only the second makes every push during the window
    // a red `Stage on npm` (R6 re-review N-3).
    //
    // The pattern is read out of the `grep -qiE '…'` that guards the branch, not
    // out of the whole step body: the comment above that line *quotes* the E409
    // wording, so a test searching the script would stay green with the guard
    // reduced to one wording. That mutant is what found this.
    const script = (readYaml('release.yml').jobs.stage.steps ?? [])
      .filter((step) => step.run != null)
      .flatMap((step) => String(step.run).split('\n'))
      // Drop shell comments so prose cannot satisfy a check about code.
      .filter((line) => !line.trim().startsWith('#'));
    const guard = script
      .filter((line) => /grep -qiE/.test(line))
      .map((line) => line.match(/grep -qiE '([^']*)'/)?.[1] ?? '')
      .join('|')
      .toLowerCase();
    expect(guard).not.toBe('');
    expect(guard).toContain(
      'cannot publish over the previously published versions'
    );
    expect(guard).toContain('cannot stage previously published version');
  });

  it('only stages from main, so a dispatch from a branch cannot stage a version', () => {
    expect(String(readYaml('release.yml').jobs.stage.if)).toContain(
      'refs/heads/main'
    );
  });
});

describe('release-catch-up tags the commit that bumped the version', () => {
  /**
   * R6's re-review N-2, run against a real scratch git repo: the version bump,
   * then a dependency bump that leaves `package.json` at the same version.
   * `release-catch-up.test.js` covers the walk over a mocked list of shas; this
   * covers the git plumbing that walk is handed (`git log -- package.json`,
   * `git show <sha>:package.json`) and the `--target` the script ends up asking
   * `gh` for - which is where the wrong answer lived.
   *
   * `npm` and `gh` are stubbed on `PATH` so "the version is live" and "no release
   * yet" are states this case sets rather than network calls. The script spawns
   * argv arrays with no shell, so a stub is found through `PATH` and receives
   * exactly the arguments it would in CI - which is also what lets this case read
   * them back.
   */
  function runCatchUpTree() {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-catchup-'));
    const git = (args) =>
      spawnSync('git', args, {
        cwd: scratch,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.invalid',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.invalid',
          HOME: scratch,
        },
      });
    try {
      const writePackage = (data) =>
        fs.writeFileSync(
          path.join(scratch, 'package.json'),
          `${JSON.stringify({ name: 'react-native-nitro-ui', ...data }, null, 2)}\n`
        );

      expect(git(['init', '-q', '-b', 'main']).status).toBe(0);
      writePackage({ version: '0.1.0' });
      git(['add', 'package.json']);
      expect(git(['commit', '-qm', 'previous version']).status).toBe(0);

      writePackage({ version: '0.1.1' });
      git(['add', 'package.json']);
      expect(git(['commit', '-qm', 'Version Packages']).status).toBe(0);
      const versionCommit = git(['rev-parse', 'HEAD']).stdout.trim();

      // A later commit that touches package.json *without* moving the version:
      // the exact thing that used to take the tag.
      writePackage({ version: '0.1.1', devDependencies: { eslint: '9.0.0' } });
      git(['add', 'package.json']);
      expect(git(['commit', '-qm', 'chore(deps): bump eslint']).status).toBe(0);
      const dependencyCommit = git(['rev-parse', 'HEAD']).stdout.trim();
      expect(dependencyCommit).not.toBe(versionCommit);

      const script = path.join(scratch, 'scripts', 'release-catch-up.mjs');
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.copyFileSync(
        path.join(root, 'scripts', 'release-catch-up.mjs'),
        script
      );
      fs.writeFileSync(
        path.join(scratch, 'CHANGELOG.md'),
        '# Changelog\n\n## 0.1.1\n\n### Patch Changes\n\n- a fix\n'
      );

      const calls = path.join(scratch, 'gh-calls');
      const binDir = path.join(scratch, '.bin');
      fs.mkdirSync(binDir, { recursive: true });
      // `npm view <pkg>@<version> version` => the version is on the registry.
      fs.writeFileSync(
        path.join(binDir, 'npm'),
        '#!/bin/sh\nprintf "0.1.1\\n"\nexit 0\n'
      );
      // `gh release view` => 404 (no release yet). `gh release create` => record
      // its arguments and succeed.
      fs.writeFileSync(
        path.join(binDir, 'gh'),
        `#!/bin/sh\nif [ "$2" = "create" ]; then printf '%s\\n' "$*" >> ${JSON.stringify(
          calls
        )}; exit 0; fi\nexit 1\n`
      );
      for (const name of ['npm', 'gh']) {
        fs.chmodSync(path.join(binDir, name), 0o755);
      }

      const result = spawnSync(process.execPath, [script], {
        cwd: scratch,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          HOME: scratch,
          GITHUB_REPOSITORY: 'x/y',
        },
      });

      const args = readIfPresent(calls)
        .split('\n')
        .filter((line) => line !== '')
        .flatMap((line) => line.split(' '));
      const at = args.indexOf('--target');
      return {
        status: result.status,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        args,
        target: at === -1 ? null : args[at + 1],
        versionCommit,
        dependencyCommit,
      };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  it('asks gh for the bump commit, not the newer commit that kept the version', () => {
    const run = runCatchUpTree();
    expect(run.output).toEqual(expect.stringContaining('created v0.1.1'));
    expect(run.args).toContain('--target');
    expect(run.target).toBe(run.versionCommit);
  });

  it('does not name the dependency bump as the release it is tagging', () => {
    const run = runCatchUpTree();
    expect(run.target).not.toBe(run.dependencyCommit);
    expect(run.output).toContain(
      `created v0.1.1 at ${run.versionCommit.slice(0, 7)}`
    );
  });
});

describe('the harness app refusal and its docs agree', () => {
  it('the no-app refusal does not advertise a path the same check then rejects', () => {
    // X1 re-review F3: the message told people to point HARNESS_APP_PATH at "an
    // app built another way", which is precisely what `assertFreshApp` refuses -
    // that app has no stamp. The message and the check are in one file, so a test
    // is the only thing that keeps them from disagreeing again in one edit.
    const config = readIfPresent(
      path.join(root, 'example', 'rn-harness.config.mjs')
    );
    expect(config).not.toBe('');
    const refusal = config.match(
      /`bun run harness:\$\{runner\}: no app to test[\s\S]*?\n  \);/
    );
    expect(refusal).not.toBe(null);
    const text = refusal[0].replace(/\$\{runner\}/g, 'ios');
    expect(text).not.toMatch(
      /point HARNESS_APP_PATH at an app built another way/
    );
    // It has to name the hatch that works, and say what it costs.
    expect(text).toContain('NITRO_UI_ALLOW_UNSTAMPED');
    expect(text).toMatch(/no stamp|refused/i);
  });

  it('CONTRIBUTING documents the escape hatch rather than leaving it in source', () => {
    // The other half of F3's "docs gap": the hatch existed, no document named it,
    // so the only correct answer to "my app was built by Android Studio" was in a
    // config file nobody reads until the run is already red.
    const contributing = fs.readFileSync(
      path.join(root, 'CONTRIBUTING.md'),
      'utf8'
    );
    expect(contributing).toContain('NITRO_UI_ALLOW_UNSTAMPED');
    expect(contributing).toMatch(/refus|not stamp|no stamp/i);
  });
});

describe('the iOS floor CI could test on is written down', () => {
  it('the claim about an older iOS runtime cites a runner manifest that says it', () => {
    // Rows 6/12 of the triage: "one day check the declared fallbacks on iOS 18".
    // That sentence is only useful if some hosted image really has an iOS 18
    // runtime, so the claim and the evidence live together, and this test refuses
    // a doc that says one thing while the manifest note says another.
    const notes = readIfPresent(path.join(root, 'docs', 'ci-runner-images.md'));
    expect(notes).not.toBe('');
    // The two facts that decide the question, each stated where a reader can grep
    // it: what the labels CI uses actually install, and where an iOS 18 runtime
    // does exist. A reworded doc that drops either one should fail here, because
    // the dropped sentence is the whole reason the CI row is not written.
    expect(notes).toMatch(/iOS 26/);
    expect(notes.toLowerCase()).toContain(
      'neither image this repo uses can run an ios 18 simulator'
    );
    expect(notes).toMatch(/`macos-15.*iOS 18|iOS 18[^\n]*`macos-15/s);
    const contributing = fs.readFileSync(
      path.join(root, 'CONTRIBUTING.md'),
      'utf8'
    );
    expect(contributing).toContain(path.join('docs', 'ci-runner-images.md'));
    expect(contributing).toMatch(/iOS 18|older iOS|older runtime/i);
  });
});
