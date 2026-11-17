import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');

/**
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
 * Evaluates the subset of Actions expression syntax these workflows use, with
 * Actions' own coercion, so a test can ask what an expression decides.
 * Unsupported syntax throws.
 *
 * @param {string} source raw YAML value, with or without `${{ … }}`
 * @param {object} ctx the contexts the expression may read
 * @returns {unknown} the evaluated value ('' for a context path that has none)
 */
function evaluate(source, ctx) {
  const text = String(source);
  if (!text.includes('${{')) return text;
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_whole, body) =>
    stringify(parseExpression(body, ctx))
  );
}

/**
 * @param {string} source the inside of one `${{ … }}`
 * @param {object} ctx
 * @returns {unknown}
 */
function parseExpression(source, ctx) {
  const tokens = tokenize(source);
  const state = { tokens, at: 0 };
  const value = parseOr(state, ctx);
  if (state.at < state.tokens.length) {
    throw new Error(
      `unreadable Actions expression (leftover ${JSON.stringify(
        state.tokens.slice(state.at)
      )}): ${source}`
    );
  }
  return value;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function tokenize(source) {
  const tokens = [];
  let rest = source;
  while (rest !== '') {
    const ws = /^\s+/.exec(rest);
    if (ws != null) {
      rest = rest.slice(ws[0].length);
      continue;
    }
    const op = /^(==|!=|<=|>=|&&|\|\||[<>()])/.exec(rest);
    if (op != null) {
      tokens.push(op[1]);
      rest = rest.slice(op[1].length);
      continue;
    }
    const str = /^'([^']*)'/.exec(rest);
    if (str != null) {
      tokens.push(str[0]);
      rest = rest.slice(str[0].length);
      continue;
    }
    const word = /^[\w.$-]+/.exec(rest);
    if (word != null) {
      tokens.push(word[0]);
      rest = rest.slice(word[0].length);
      continue;
    }
    throw new Error(
      `unreadable Actions expression near ${JSON.stringify(rest)}`
    );
  }
  return tokens;
}

/**
 * @param {{tokens: string[], at: number}} state
 * @param {object} ctx
 * @returns {unknown}
 */
function parseOr(state, ctx) {
  let left = parseAnd(state, ctx);
  while (peek(state) === '||') {
    state.at += 1;
    const right = parseAnd(state, ctx);
    left = isActionsTruthy(left) ? left : right;
  }
  return left;
}

/**
 * @param {{tokens: string[], at: number}} state
 * @param {object} ctx
 * @returns {unknown}
 */
function parseAnd(state, ctx) {
  let left = parseComparison(state, ctx);
  while (peek(state) === '&&') {
    state.at += 1;
    const right = parseComparison(state, ctx);
    left = isActionsTruthy(left) ? right : left;
  }
  return left;
}

/**
 * @param {{tokens: string[], at: number}} state
 * @returns {string | undefined}
 */
function peek(state) {
  return state.tokens[state.at];
}

/**
 * @param {{tokens: string[], at: number}} state
 * @param {object} ctx
 * @returns {unknown}
 */
function parseComparison(state, ctx) {
  const left = parsePrimary(state, ctx);
  const operator = peek(state);
  if (['==', '!=', '<', '<=', '>', '>='].includes(String(operator))) {
    state.at += 1;
    return compare(operator, left, parsePrimary(state, ctx));
  }
  return left;
}

/**
 * @param {{tokens: string[], at: number}} state
 * @param {object} ctx
 * @returns {unknown}
 */
function parsePrimary(state, ctx) {
  const token = state.tokens[state.at];
  if (token === undefined) {
    throw new Error('unreadable Actions expression: it ends early');
  }
  state.at += 1;
  if (token === '(') {
    const grouped = parseOr(state, ctx);
    if (state.tokens[state.at] !== ')') {
      throw new Error('unreadable Actions expression: unbalanced parentheses');
    }
    state.at += 1;
    return grouped;
  }
  const literal = /^'([^']*)'$/.exec(token);
  if (literal != null) return literal[1];
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  if (/^[\w.$-]+$/.test(token)) return lookup(token, ctx);
  throw new Error(
    `unreadable Actions expression operand ${JSON.stringify(token)}`
  );
}

/**
 * @param {string} token a dotted context path
 * @param {object} ctx
 * @returns {unknown} null when the path has no value, which is falsy in Actions
 */
function lookup(token, ctx) {
  let value = ctx;
  for (const part of token.split('.')) {
    if (value == null || typeof value !== 'object') return null;
    value = value[part];
  }
  return value === undefined ? null : value;
}

/**
 * @param {string} operator
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function compare(operator, left, right) {
  if (operator === '==') return looseEqual(left, right);
  if (operator === '!=') return !looseEqual(left, right);
  const l = toNumber(left);
  const r = toNumber(right);
  if (Number.isNaN(l) || Number.isNaN(r)) return false;
  if (operator === '<') return l < r;
  if (operator === '<=') return l <= r;
  if (operator === '>') return l > r;
  return l >= r;
}

/**
 * Actions' loose equality: same-type compare, otherwise coerce both to numbers;
 * strings compare case-insensitively.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function looseEqual(left, right) {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }
  if (left === right) return true;
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return isActionsTruthy(left) === isActionsTruthy(right);
  }
  return toNumber(left) === toNumber(right);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (value === true) return 1;
  if (value === false) return 0;
  return Number(value);
}

/**
 * Actions' falsy set is `false`, `0`, `-0`, `''` and `null`. Every other value
 * is truthy, including the string `'false'`.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isActionsTruthy(value) {
  if (value === false || value === null || value === undefined) return false;
  if (value === '' || value === 0 || value === -0) return false;
  return true;
}

/**
 * Actions' stringification, for interpolating a value into text.
 *
 * @param {unknown} value
 * @returns {string}
 */
function stringify(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * What a `cancel-in-progress` value decides for a given ref.
 *
 * @param {unknown} value the parsed YAML value
 * @param {string} ref e.g. `refs/heads/main`
 * @returns {boolean}
 */
function cancelsFor(value, ref) {
  if (typeof value === 'boolean') return value;
  // `cancel-in-progress` is boolean-typed, so the runner evaluates the
  // expression. Interpolating it into text would turn `false` into the truthy
  // string 'false'.
  return isActionsTruthy(parseExpression(inner(value), { github: { ref } }));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function inner(value) {
  return String(value)
    .trim()
    .replace(/^\$\{\{|\}\}$/g, '')
    .trim();
}

/**
 * What `concurrency.group` names a run, for an event.
 *
 * @param {unknown} value the parsed YAML value
 * @param {{ref: string, sha: string, workflow?: string}} event
 * @returns {string}
 */
function groupFor(value, event) {
  return evaluate(value, {
    github: {
      ref: event.ref,
      sha: event.sha,
      workflow: event.workflow ?? 'ci.yml',
    },
  });
}

/**
 * What a step's `if:` (or a `cancel-in-progress:`) decides.
 *
 * An `if:` is evaluated as an expression even when it is written without
 * `${{ … }}`, unlike every other key - so this strips the braces when present
 * and parses the whole thing, then applies Actions' truthiness.
 *
 * @param {unknown} value the parsed YAML value
 * @param {object} ctx the contexts the expression may read
 * @returns {boolean}
 */
function evaluateCondition(value, ctx) {
  if (typeof value === 'boolean') return value;
  return isActionsTruthy(parseExpression(inner(value), ctx));
}

/**
 * What a step's `if:` decides, with composite-action inputs as the runner passes
 * them (strings) and step outputs as strings.
 *
 * @param {unknown} value the parsed `if:` value
 * @param {Record<string, string | boolean>} inputs
 * @param {Record<string, string>} [outputs] keyed `'<step-id>.<output-name>'`
 * @returns {boolean}
 */
function runsStep(value, inputs, outputs = {}) {
  const steps = {};
  for (const [key, output] of Object.entries(outputs)) {
    const [id, name] = key.split('.');
    steps[id] = { outputs: { ...(steps[id]?.outputs ?? {}), [name]: output } };
  }
  return evaluateCondition(value, { inputs, steps, github: {} });
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
    const value = readYaml('ci.yml').concurrency['cancel-in-progress'];
    expect(cancelsFor(value, 'refs/heads/main')).toBe(false);
  });

  it('still cancels a superseded run on a pull request or feature branch', () => {
    const value = readYaml('ci.yml').concurrency['cancel-in-progress'];
    expect(cancelsFor(value, 'refs/pull/9/merge')).toBe(true);
    expect(cancelsFor(value, 'refs/heads/task/F4-ci-green')).toBe(true);
  });

  it('gives every push to main its own concurrency group', () => {
    // GitHub keeps one running and one pending run per group, and a newly queued
    // run replaces the pending one, which then never gets a conclusion.
    const group = readYaml('ci.yml').concurrency.group;
    const first = groupFor(group, { ref: 'refs/heads/main', sha: 'aaa1111' });
    const second = groupFor(group, { ref: 'refs/heads/main', sha: 'bbb2222' });
    expect(first).not.toBe(second);
    // A re-run of the same sha joins the same group.
    expect(groupFor(group, { ref: 'refs/heads/main', sha: 'aaa1111' })).toBe(
      first
    );
  });

  it('still puts every push to one pull request in the same group', () => {
    const group = readYaml('ci.yml').concurrency.group;
    expect(groupFor(group, { ref: 'refs/pull/9/merge', sha: 'ccc3333' })).toBe(
      groupFor(group, { ref: 'refs/pull/9/merge', sha: 'ddd4444' })
    );
    expect(
      groupFor(group, { ref: 'refs/heads/task/F4-ci-green', sha: 'eee5555' })
    ).toBe(
      groupFor(group, { ref: 'refs/heads/task/F4-ci-green', sha: 'fff6666' })
    );
    const distinct = new Set([
      groupFor(group, { ref: 'refs/pull/9/merge', sha: 'ccc3333' }),
      groupFor(group, { ref: 'refs/heads/task/F4-ci-green', sha: 'eee5555' }),
      groupFor(group, { ref: 'refs/heads/main', sha: 'aaa1111' }),
    ]);
    expect(distinct.size).toBe(3);
  });

  it('loses no commit when three land on main while the first is still running', () => {
    const ci = readYaml('ci.yml').concurrency;
    const pushes = [
      { ref: 'refs/heads/main', sha: 'aaa1111' },
      { ref: 'refs/heads/main', sha: 'bbb2222' },
      { ref: 'refs/heads/main', sha: 'ccc3333' },
    ];
    const runs = pushes.map((event) => ({
      event,
      group: groupFor(ci.group, event),
      conclude: true,
    }));
    const withoutConclusion = modelActionsQueue(runs).filter(
      (run) => !run.conclude
    );
    expect(withoutConclusion.map((run) => run.event.sha)).toEqual([]);
  });

  it('and the model says the branch-level group did lose one (so the test can fail)', () => {
    const runs = ['aaa1111', 'bbb2222', 'ccc3333'].map((sha) => ({
      event: { ref: 'refs/heads/main', sha },
      group: 'ci.yml-refs/heads/main',
      conclude: true,
    }));
    const lost = modelActionsQueue(runs).filter((run) => !run.conclude);
    expect(lost.map((run) => run.event.sha)).toEqual(['bbb2222']);
  });

  /**
   * GitHub's per-group queue: one running, one pending, a third arrival displaces
   * the pending run, and a displaced run never produces a conclusion.
   *
   * @param {Array<{group: string, conclude: boolean, event: object}>} runs
   * @returns {Array<{group: string, conclude: boolean, event: object}>} the same
   *   objects, with `conclude` set to false for any run the queue dropped
   */
  function modelActionsQueue(runs) {
    /** @type {Record<string, {running: object | null, pending: object | null}>} */
    const groups = {};
    for (const run of runs) {
      const state = (groups[run.group] ??= { running: null, pending: null });
      if (state.running == null) {
        state.running = run;
      } else if (state.pending == null) {
        state.pending = run;
      } else {
        // The newcomer takes the pending slot; the run that held it is gone.
        state.pending.conclude = false;
        state.pending = run;
      }
    }
    return runs;
  }

  it('the release workflows still refuse to cancel a run that may be staging', () => {
    for (const file of ['release.yml', 'release-tag.yml']) {
      const value = readYaml(file).concurrency['cancel-in-progress'];
      expect(value).toBe(false);
    }
  });
});

describe('CI jobs that need history get it', () => {
  it('every job that runs `check` or the catch-up script fetches the full history', () => {
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
    // The harness resolves `HARNESS_APP_PATH` against `example/`, so a
    // workflow-relative path names nothing and no app is installed.
    for (const jobId of ['harness-android', 'harness-ios']) {
      const app = String(harnessStep(jobId).with.app);
      expect(app).toMatch(/^\$\{\{ github\.workspace \}\}\//);
      expect(app).toMatch(/app-debug\.apk|NitroUiExample\.app/);
    }
  });

  it('the pinned action can talk to the CLI this repo installs', () => {
    // The action's second step refuses a CLI without `harnessActionProtocol >= 1`.
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
    // The action resolves `react-native-harness/package.json` from `example/`.
    expect(cli.version).toBe(declared);
    expect(Number(cli.harnessActionProtocol ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['harness-android', 'build-app.mjs --platform android'],
    ['harness-ios', 'build-app.mjs --platform ios'],
  ])('%s builds its stamped app before the action runs', (jobId, command) => {
    // rn-harness.config.mjs refuses an app it cannot prove was built from this
    // tree, so a raw gradle or xcodebuild step would fail the harness's own check.
    const job = readYaml('ci.yml').jobs[jobId];
    const run = (job.steps ?? [])
      .filter((step) => step.uses == null && step.run != null)
      .map((step) => String(step.run))
      .join('\n');
    expect(run).toContain(command);
  });
});

describe('the AVD name CI prints is the name the harness boots', () => {
  function avdName(env) {
    const ran = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'ci-avd-name.mjs')],
      { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }
    );
    expect(ran.status).toBe(0);
    return ran.stdout.trim();
  }

  it('follows the same precedence as avd(): ANDROID_AVD, AVD, then the default', () => {
    const config = fs.readFileSync(
      path.join(root, 'example', 'rn-harness.config.mjs'),
      'utf8'
    );
    const fallback = /const DEFAULT_AVD = '([^']+)'/u.exec(config)[1];

    expect(avdName({})).toBe(fallback);
    expect(avdName({ AVD: 'avd-override' })).toBe('avd-override');
    expect(avdName({ ANDROID_AVD: 'lease-avd', AVD: 'avd-override' })).toBe(
      'lease-avd'
    );
    // An empty override is not a name here. The harness's own `??` treats `''`
    // as a value, so this is the one place the two differ.
    expect(avdName({ ANDROID_AVD: '', AVD: '' })).toBe(fallback);
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
    // A cache key is two lockfiles' hashes, not proof that `node_modules`
    // matches the sources being packed.
    expect(setupWith('pack')).not.toBe(null);
    expect(setupWith('pack')['package-manager-cache']).toBe(false);
    const action = readYaml('.github/actions/setup/action.yml');
    for (const step of cacheSteps(action)) {
      expect({
        step: String(step.name),
        runs: runsStep(step.if, { 'package-manager-cache': 'false' }),
      }).toEqual({ step: String(step.name), runs: false });
    }
  });

  /**
   * The actions/cache steps of the composite, in run order.
   *
   * @param {any} action parsed `action.yml`
   */
  function cacheSteps(action) {
    const steps = (action.runs.steps ?? []).filter((step) =>
      String(step.uses ?? '').startsWith('actions/cache')
    );
    expect(steps.length).toBeGreaterThan(0);
    return steps;
  }

  it('the composite can install without caching, and every cache step obeys it', () => {
    const action = readYaml('.github/actions/setup/action.yml');
    const input = (action.inputs ?? {})['package-manager-cache'];
    expect(input).toBeDefined();
    // A string default, not `true`: the runner stringifies the default the same
    // way it stringifies a caller's value, and the `if:` compares against `'false'`.
    expect(input.default).toBe('true');
    // A composite action input has no `type:` key, so writing one promises a
    // cast that never happens.
    expect(input.type).toBeUndefined();

    const steps = cacheSteps(action);
    // `'false'` turns both cache steps off. The default and an empty string
    // (what an undeclared input evaluates to) keep caching.
    const skippedWhenOff = steps
      .filter(
        (step) =>
          runsStep(step.if, { 'package-manager-cache': 'false' }) ||
          !runsStep(step.if, { 'package-manager-cache': 'true' })
      )
      .map((step) => String(step.name));
    expect(skippedWhenOff).toEqual([]);
    const save = steps.find((step) => String(step.uses).includes('cache/save'));
    expect(
      runsStep(
        save.if,
        { 'package-manager-cache': 'true' },
        {
          'bun-cache.cache-hit': 'true',
          'bun-cache.cache-primary-key': 'key',
        }
      )
    ).toBe(false);
    expect(
      runsStep(
        save.if,
        { 'package-manager-cache': 'true' },
        {
          'bun-cache.cache-hit': '',
          'bun-cache.cache-primary-key': 'key',
        }
      )
    ).toBe(true);
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
    // npm words a version that is staged and awaiting approval (E409)
    // differently from one that is already live. The guard must match both.
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
   * Runs the script in a scratch git repo where a later commit touches
   * `package.json` without moving the version. `npm` and `gh` are stubbed on
   * `PATH`, so registry and release state are set here instead of fetched.
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

      // A later commit that touches package.json without moving the version.
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
