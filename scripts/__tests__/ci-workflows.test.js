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
 * A small evaluator for the subset of Actions expression syntax these workflows
 * use, so the guards can ask what an expression **decides** instead of matching
 * its text.
 *
 * Why this exists: both of F4's concurrency findings were invisible to a text
 * check. Round 1's `if: inputs.package-manager-cache` mentions the input, so a
 * guard that asked only "does the `if` name it?" passed while the release job
 * restored a cache - composite inputs always arrive as strings, and any
 * non-falsy string is true. And `cancel-in-progress: false` reads as "main is
 * safe" while GitHub's one-running-plus-one-pending-per-group rule still drops a
 * queued commit's run. The only test that can catch either is one that evaluates
 * the expression with the values the runner would pass, using Actions' own
 * coercion: the falsy set is `false`, `0`, `-0`, `''`, `null`; `==`/`!=` are
 * loose and case-insensitive on strings; `&&`/`||` return an operand, not a
 * boolean. Unsupported syntax throws rather than being guessed at, so the guard
 * cannot go quietly blind.
 *
 * Supported: `${{ … }}` interpolation inside text, `'string'` and number
 * literals, dotted context access (`github.ref`, `inputs.x`,
 * `steps.id.outputs.name`, `needs.job.outputs.x`), `==` `!=` `<` `<=` `>` `>=`,
 * `&&`, `||`, and parentheses.
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
 * Verbatim from the expression docs: the falsy set is `false`, `0`, `-0`, `''`,
 * `null`; every other value is truthy - which is exactly why the string `'false'`
 * is not the boolean, and the whole of review item 1.
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
  // `cancel-in-progress` is a boolean-typed key, so the runner evaluates the
  // expression rather than stringifying it into text: parse it directly (going
  // through `evaluate`'s interpolation would turn `false` into the string
  // 'false', which is truthy - the exact trap this round is about).
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

  it('gives every push to main its own concurrency group', () => {
    // `cancel-in-progress: false` is only half the rule. GitHub keeps **one
    // running and one pending run per group**, and a newly queued run replaces
    // whatever was pending - a dropped run gets no conclusion at all, which is
    // the exact thing this task exists to prevent. So three quick merges on one
    // branch-level group meant A running, B pending, C arrives, B vanishes. Each
    // commit to `main` now names its own group, and nothing can be displaced.
    const group = readYaml('ci.yml').concurrency.group;
    const first = groupFor(group, { ref: 'refs/heads/main', sha: 'aaa1111' });
    const second = groupFor(group, { ref: 'refs/heads/main', sha: 'bbb2222' });
    expect(first).not.toBe(second);
    // Still one group per workflow per commit: not a group per run attempt, which
    // would stop a re-run of the same sha joining its own group.
    expect(groupFor(group, { ref: 'refs/heads/main', sha: 'aaa1111' })).toBe(
      first
    );
  });

  it('still puts every push to one pull request in the same group', () => {
    // The other half: on a PR the whole point is that the newest push takes over,
    // so a branch's pushes must keep sharing a group. If they did not, three
    // pushes would run three 20-minute suites against the same branch.
    const group = readYaml('ci.yml').concurrency.group;
    expect(groupFor(group, { ref: 'refs/pull/9/merge', sha: 'ccc3333' })).toBe(
      groupFor(group, { ref: 'refs/pull/9/merge', sha: 'ddd4444' })
    );
    expect(
      groupFor(group, { ref: 'refs/heads/task/F4-ci-green', sha: 'eee5555' })
    ).toBe(
      groupFor(group, { ref: 'refs/heads/task/F4-ci-green', sha: 'fff6666' })
    );
    // And the two refs must not share a group with each other, or with main.
    const distinct = new Set([
      groupFor(group, { ref: 'refs/pull/9/merge', sha: 'ccc3333' }),
      groupFor(group, { ref: 'refs/heads/task/F4-ci-green', sha: 'eee5555' }),
      groupFor(group, { ref: 'refs/heads/main', sha: 'aaa1111' }),
    ]);
    expect(distinct.size).toBe(3);
  });

  it('loses no commit when three land on main while the first is still running', () => {
    // The queue model GitHub's own docs describe, applied to the real group
    // expression: one run executes and one waits per group, and a run that is
    // displaced from the pending slot finishes with no conclusion.
    //
    // `concurrency.cancels` says whether a displaced run is *cancelled* by the
    // newcomer or simply dropped from the queue; either way it has no result, so
    // both are counted as lost here. What the test measures is how many of the
    // three pushes end with a conclusion.
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
    // The same queue with the group round 1 shipped (`<workflow>-<ref>`): this is
    // the red proof for the case above, kept as a case so the model cannot be
    // quietly wrong about GitHub's rule - if someone "fixes" the model to lose
    // nothing here, the assertion below is where it surfaces.
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
   * Runs arrive in order; the first is still running when the rest arrive, which is
   * the situation that bit `main` on 31 Oct.
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

  it('CONTRIBUTING states both rules, not just the one a reader would copy', () => {
    // Round 1's doc said "A push to `main` is never cancelled by the next one"
    // and named only `cancel-in-progress`, which is true as far as it goes and
    // still left the reader with a workflow that drops a commit. A sentence about
    // the flag has to be accompanied by the group, so the doc is checked for both
    // expressions it describes.
    const contributing = fs.readFileSync(
      path.join(root, 'CONTRIBUTING.md'),
      'utf8'
    );
    // Anchor on the expression the paragraph is about, not on its first sentence,
    // so rewording the prose cannot make the guard silently match nothing.
    const section =
      /\n[A-Z][^\n]*\n(?:[^\n]*\n)*?[^\n]*cancel-in-progress: \$\{\{[^\n]*(?:\n[^\n]*)*?\n\n/.exec(
        contributing
      );
    expect(section).not.toBe(null);
    const text = section[0];
    expect(text).toContain(
      "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}"
    );
    expect(text).toContain(
      "github.ref == 'refs/heads/main' && github.sha || github.ref"
    );
    // And it may not claim the flag alone is enough.
    expect(text).not.toMatch(/never cancelled by the next one/);
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
    // …and the action has to honour it once the runner has stringified it. That
    // half is asserted in the next case, which is where the bug actually lived.
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
    // `type: boolean` is not a key a composite action input supports, so writing
    // it promises a cast that never happens - the exact mistake that made the
    // first version of this gate restore a cache in the release job.
    expect(input.type).toBeUndefined();

    const steps = cacheSteps(action);
    // Every cache step, evaluated with the input as the runner would pass it.
    // `true` (the default) keeps caching; `'false'` turns both halves off; and an
    // empty string - what a caller gets from an input it never declared - keeps
    // caching rather than silently disabling it, because that is the bug-free
    // direction of the two.
    const skippedWhenOff = steps
      .filter(
        (step) =>
          runsStep(step.if, { 'package-manager-cache': 'false' }) ||
          !runsStep(step.if, { 'package-manager-cache': 'true' })
      )
      .map((step) => String(step.name));
    expect(skippedWhenOff).toEqual([]);
    // And the save step still refuses to write when the restore hit, so the
    // truthiness fix cannot have swallowed the original condition.
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
  it('the claim about an older iOS runtime cites the arm64 manifests that say it', () => {
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
    // Fix round 1's correction: the labels schedule arm64 hosts, so quoting the
    // Intel manifest's image id documented a build nobody runs. The arm64 file
    // names and their image ids are the citation now, and a reader has to be able
    // to find them.
    for (const citation of [
      'macos-26-arm64-Readme.md',
      'macos-15-arm64-Readme.md',
      '20261026.0455.2',
      '20261028.0489.1',
    ]) {
      expect(notes).toContain(citation);
    }
    // And the sentence that round deleted may not come back: `macos-15-arm64`
    // installs iOS 18.5/18.6 next to Xcode 26.x, so "Apple offers no iOS 18
    // runtime for Xcode 26" is contradicted by the manifest on the same page.
    // Matched on whitespace-collapsed text, because the sentence wraps.
    expect(notes.replace(/\s+/g, ' ')).not.toMatch(
      /apple does not offer[^\n]{0,80}?ios 18[^\n]{0,40}?xcode 26/i
    );
    // The doc has to say what is actually unproven, in the paragraph that lists
    // it, or the next person reads the feasibility as a settled fact and files a
    // workflow row nobody tested. Asserted on that paragraph rather than anywhere
    // in the file: "boot" and "macOS 15" appear in prose elsewhere too, and a
    // whole-file regex was satisfied by them while the caveat was gone (the
    // mutant that found this deleted the caveat and stayed green).
    const caveat = (
      notes
        .split(/\n\n+/)
        .join('\n\n')
        .split(/\n\n+/)
        .find((block) => /\bUnproven\b/.test(block)) ?? ''
    ).replace(/\s+/g, ' ');
    expect(caveat).not.toBe('');
    for (const open of [/boot/i, /Xcode 26/i, /macOS 15/i]) {
      expect(caveat).toMatch(open);
    }
    expect(notes).toMatch(/xcode-select/i);

    const contributing = fs.readFileSync(
      path.join(root, 'CONTRIBUTING.md'),
      'utf8'
    );
    expect(contributing).toContain(path.join('docs', 'ci-runner-images.md'));
    expect(contributing).toMatch(/iOS 18|older iOS|older runtime/i);
  });
});
