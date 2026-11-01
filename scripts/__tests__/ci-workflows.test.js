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
 * The diagnostics script the Android job's collect step runs, and the step's own call
 * of it. F8 round 2 moved that step's body out of the workflow and into a file, because
 * the body hung for 90 minutes on run 41269235234 and a shell step cannot bound its own
 * commands on a macOS test host (`timeout(1)` is not installed there, and these tests
 * run the step for real). So the thing under test is this file.
 */
const DIAGNOSTICS_SCRIPT = path.join('scripts', 'ci-emulator-diagnostics.mjs');

function diagnosticsScript() {
  return fs.readFileSync(path.join(root, DIAGNOSTICS_SCRIPT), 'utf8');
}

/**
 * A workflow job by id, from `ci.yml`.
 *
 * @param {string} jobId
 */
function ciJob(jobId) {
  const job = readYaml('ci.yml').jobs?.[jobId];
  expect(job).not.toBeUndefined();
  return job;
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

  it('the Android job leaves evidence when the emulator never becomes ready', () => {
    // Both dispatch runs of this job ended identically: `The platform did not
    // become ready within 900000ms`, qemu still alive at cleanup, and the last
    // harness line was `Using cached Android emulator nitroui...` (41230848294,
    // 41234953779). A quarter of an hour produced no words at all, because the
    // harness keeps the emulator's output to itself unless `HARNESS_DEBUG` is set.
    // So the job now asks the machine directly, before and after the run, and
    // uploads what it gets. Without this step the next timeout is again a
    // 900-second shrug, and the GPU-mode question this job's fix turns on stays
    // unanswerable from the log.
    const job = readYaml('ci.yml').jobs['harness-android'];
    const steps = job.steps ?? [];
    const stepNamed = (needle) =>
      steps.find((step) =>
        String(step.name ?? '')
          .toLowerCase()
          .includes(needle.toLowerCase())
      );
    // All three must survive a failing run: `if: always()` on the two that read
    // the machine after the failure, since every later step is skipped by default
    // once the job has one. The preflight runs before the harness, so it only has
    // to exist.
    expect(stepNamed('Show the emulator configuration')).not.toBeUndefined();
    // And it has to *run*. The first version of this step died before it printed
    // a single line: its `AVD_NAME=` helper took file contents where it took a
    // path, so it exited with `ENAMETOOLONG` and the whole preflight — and the
    // evidence it was written to gather — never existed. Reading the YAML cannot
    // find that, so this executes the real prefix of the real step body under the
    // same shell flags Actions uses, and asks it for the name the config declares.
    const preflight = String(stepNamed('Show the emulator configuration').run);
    const lines = preflight.split('\n');
    const through = lines.findIndex((line) =>
      line.includes('avd (from rn-harness.config.mjs)')
    );
    expect(through).toBeGreaterThan(0);
    const ran = spawnSync(
      '/bin/bash',
      [
        '--noprofile',
        '--norc',
        '-eo',
        'pipefail',
        '-c',
        lines.slice(0, through + 1).join('\n'),
      ],
      { cwd: root, encoding: 'utf8' }
    );
    const want = fs
      .readFileSync(path.join(root, 'example', 'rn-harness.config.mjs'), 'utf8')
      .match(/const DEFAULT_AVD = '([^']+)'/u)?.[1];
    expect({
      status: ran.status,
      stderr:
        String(ran.stderr ?? '')
          .split('\n')
          .find(Boolean) ?? '',
      printed: String(ran.stdout ?? '').trim(),
    }).toEqual({
      status: 0,
      stderr: '',
      printed: `avd (from rn-harness.config.mjs): ${want}`,
    });
    for (const needle of [
      'Collect emulator boot diagnostics',
      'Upload emulator boot diagnostics',
    ]) {
      const step = stepNamed(needle);
      expect(step).not.toBeUndefined();
      expect(String(step.if)).toBe('always()');
    }
    // The pre/post hooks are the harness's own, so the timeline of the boot is
    // stamped by the action rather than by a guess at its step boundaries.
    const harness = harnessStep('harness-android');
    expect(String(harness.with.preRunHook)).toContain('pre-run:');
    expect(String(harness.with.afterRunHook)).toContain('HARNESS_EXIT_CODE');
    // And the printout must be the rule the code uses, not a copy of it: a second
    // GPU-mode expression here would drift from `emulator-launch.mjs` silently.
    const show = String(stepNamed('Show the emulator configuration').run);
    expect(show).toContain('emulatorGpuModeForHost');
    expect(show).toContain('accel-check');
    // The AVD's hardware lines must be collected *somewhere* in the job, or moving
    // them out of the preflight would just be losing them. The collect step is a
    // script call now, so the check follows the script.
    const collect = String(stepNamed('Collect emulator boot diagnostics').run);
    const script = diagnosticsScript();
    expect(collect).toContain(DIAGNOSTICS_SCRIPT);
    expect(script).toContain('config.ini');
    // Every step that reads the machine after a failure must be bounded: the whole
    // reason the script exists is that this one hung for 90 minutes.
    expect(
      stepNamed('Collect emulator boot diagnostics')['timeout-minutes']
    ).toBe(5);
    for (const name of ['harness-android', 'harness-ios']) {
      expect(ciJob(name)['timeout-minutes']).toBeGreaterThan(0);
    }
  });

  it('the preflight prints nothing about an AVD that does not exist yet', () => {
    // The other half of the ordering claim, executed. The harness creates or restores
    // the AVD in the step *after* this one, so on a cache miss the AVD directory is
    // empty here and run 41256853746's preflight spent three lines on
    // `grep: …/nitroui.avd/config.ini: No such file or directory` — evidence that
    // reads like a misconfigured AVD, about a file that cannot exist yet. So this
    // runs the whole body on a machine shaped like the runner's first minute — no
    // AVD, `adb` nowhere — and requires that it completes and never mentions the
    // file. Re-adding the read here, or writing it into any other pre-run step, is
    // red.
    const job = readYaml('ci.yml').jobs['harness-android'];
    const step = (job.steps ?? []).find((candidate) =>
      String(candidate.name ?? '').includes('Show the emulator configuration')
    );
    const box = sandbox();
    try {
      const ran = runStepBody(String(step.run), box);
      const out = String(ran.stdout ?? '') + String(ran.stderr ?? '');
      expect({
        status: ran.status,
        mentionsAvdFile: out.includes('config.ini'),
      }).toEqual({
        status: 0,
        mentionsAvdFile: false,
      });
      // And it still says the things the preflight exists to say.
      expect(out).toContain('avd (from rn-harness.config.mjs): nitroui');
      expect(out).toContain('accel: kvm usable');
      expect(out).toContain('gpu mode:');
    } finally {
      box.dispose();
    }
  });

  /* The diagnostics pair, executed. Both of these steps exist only to leave
   * evidence, and both managed not to: run 41256853746's Android job reached them
   * with nothing to explain, and the collect step's last command was
   * `tail -80 "$DIAG"/emulator-*.log`, which exits 1 when the glob matches nothing
   * — so the step that existed to report a failure reported one of its own, on a job
   * whose harness had not even started. Then the upload step, pointed at
   * `.harness-diag`, printed "No files were found with the provided path" while the
   * step before it had listed two files, because `upload-artifact` v4 resolves a path
   * with `omitHidden: include-hidden-files` and that input defaults to false (the
   * run's own log prints `include-hidden-files: false`). A green harness run would
   * have been turned red by the first, and every run's evidence dropped by the
   * second. Reading the YAML cannot see either, so this runs the real bodies. */

  /**
   * Run one step body the way a runner does: `bash -e {0}`, no profile, no rcfile.
   *
   * `-e` and nothing else, because that is what the log of this very job shows
   * (`shell: /usr/bin/bash -e {0}`) — no `pipefail`, which matters: with `pipefail`
   * the `grep | tail` in this step would fail on a quiet emulator, and the test would
   * be asserting a shell the job does not use.
   *
   * @param {string} body the `run:` text, verbatim from the workflow
   * @param {{cwd: string, env: Record<string,string>}} sandbox
   */
  function runStepBody(body, { cwd, env }) {
    return spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', body], {
      cwd,
      env,
      encoding: 'utf8',
    });
  }

  /**
   * A checkout-shaped working directory and a HOME, both throwaway, so a CI step
   * body can be run for real without writing inside the repo.
   *
   * `scripts` and `example` are symlinks to the real ones: the step calls
   * `node scripts/ci-avd-name.mjs`, and that line is part of what is under test, so
   * it reads the real config rather than a copy that could disagree with it.
   *
   * @param {{avd?: boolean, adb?: 'none' | 'path' | 'platform-tools'}} shape what the
   *   machine looks like: whether the harness got as far as creating an AVD, and
   *   where (or whether) `adb` can be found.
   * @returns {{cwd: string, home: string, env: Record<string,string>, androidHome: string,
   *   diag: (name: string) => string, dispose: () => void}}
   */
  function sandbox({
    avd = false,
    adb = 'none',
    hangTools = adb === 'hang',
  } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-ci-diag-'));
    const cwd = path.join(dir, 'checkout');
    const home = path.join(dir, 'home');
    const androidHome = path.join(dir, 'sdk');
    const bin = path.join(dir, 'bin');
    for (const sub of [cwd, home, androidHome, bin]) {
      fs.mkdirSync(sub, { recursive: true });
    }
    for (const link of ['scripts', 'example']) {
      fs.symlinkSync(path.join(root, link), path.join(cwd, link), 'dir');
    }
    // `-accel-check` is the one external binary the preflight needs, and the
    // machine running this test may not have an SDK. The stub says what the real one
    // says on a runner with KVM, so the assertion is about the step plumbing to it.
    const emulatorBin = path.join(androidHome, 'emulator');
    fs.mkdirSync(emulatorBin, { recursive: true });
    fs.writeFileSync(
      path.join(emulatorBin, 'emulator'),
      '#!/bin/sh\nif [ "$1" = "-accel-check" ]; then echo "kvm usable"; fi\n',
      { mode: 0o755 }
    );
    const avdDir = path.join(home, '.android', 'avd', 'nitroui.avd');
    if (avd) {
      fs.mkdirSync(avdDir, { recursive: true });
      // The line this job's GPU change is judged by, and a fixture that cannot
      // coincide with a plausible default (`auto` is what an unpatched AVD says).
      fs.writeFileSync(
        path.join(avdDir, 'config.ini'),
        'hw.gpu.enabled=yes\nhw.gpu.mode=swift_ind\nhw.cpu.ncore=4\nimage.sysdir.1=system-images/android-35/\n'
      );
      fs.writeFileSync(
        path.join(avdDir, 'emulator-5554.log'),
        'emulator: Waiting for the emulator to become ready…\nqemu: FIREFOX_MARKER_LINE\n'
      );
    }
    /**
     * `sudo`, stubbed.
     *
     * The diagnostics step reads the kernel ring buffer with `sudo -n dmesg`, and
     * the sandbox's `PATH` had `/usr/bin` in it — so running that step body *here*
     * ran the real macOS `sudo`: a call into the privilege machinery, on a machine
     * where whether it succeeds depends on the developer's sudoers rather than on
     * anything under test. A runner grants the tool user passwordless sudo; a
     * laptop does not, so the step's exit status doubled as a statement about the
     * person's machine.
     *
     * The stub deliberately does not execute its arguments: it prints what a runner
     * would have printed and exits 0. So `dmesg` never runs either, which is fine —
     * what this job tests is that the step tolerates a missing tool and still writes
     * its log, not the kernel's output. `SANDBOX_SUDO_MARKER` is what the assertions
     * read to know the stub, not the real binary, answered.
     *
     * With `sudo: 'hang'` it is instead a `sudo` that never answers, which is one of
     * the shapes run 41269235234's 90-minute step is thought to have hit: `-n` should
     * refuse rather than prompt, but a `sudo` that prompts reads a tty that never
     * replies. `SANDBOX_SUDO_HANG` is printed *before* it stops answering, so a test can
     * tell "the stub was asked and the script gave up on it" from "the script never got
     * here at all" — without the first, a passing run proves nothing.
     */
    fs.writeFileSync(
      path.join(bin, 'sudo'),
      [
        '#!/bin/sh',
        ...(hangTools
          ? [
              // `/bin/echo`, to stderr: an *external* command's output is its own
              // process's write-and-exit, so the bytes are in the pipe before the shell
              // moves on, and nothing the script does to the shell later — including
              // SIGKILL — can un-write them. The shell builtin's `echo` was tried first
              // and went red inside `check` and green standalone: bash buffers a builtin's
              // stdout, and a killed process's buffer dies with it. A witness that is
              // sometimes missing is worse than no witness, because the green case would
              // then be green for the wrong reason.
              '/bin/echo "SANDBOX_SUDO_HANG ran: $*" >&2',
              // `exec`, so the stub *is* the sleep: killing it leaves no orphan behind,
              // which matters on a machine where other tasks are running emulators.
              'exec sleep 600',
            ]
          : [
              'echo "SANDBOX_SUDO_MARKER ran: $*"',
              'echo "kvm: emulator started with kvm support"',
              'exit 0',
            ]),
        '',
      ].join('\n'),
      { mode: 0o755 }
    );
    /**
     * The `adb` the machine has, if any.
     *
     * The healthy stubs answer what a booted emulator answers. `adb: 'hang'` is the
     * machine the diagnostics step was written for: an emulator that has just died
     * under the harness, where `adb devices` waits on a server that is starting, a
     * `shell` waits on a device that will never arrive, and `logcat` is a stream that
     * does not end even with `-d` — because a device that is gone cannot honour the
     * flag. Every one of those must be survivable, and the only way to show that is to
     * hand the script tools that do it.
     */
    const fakeAdb = [
      '#!/bin/sh',
      'case "$1" in',
      '  devices) echo "List of devices attached"; echo "emulator-5554   device product:sdk_gphone64 model:sdk_gphone64";;',
      '  -e)',
      '    case "$2" in',
      '      shell)',
      '        case "$4" in',
      '          persist.sys.timezone) echo Europe/Lisbon;;',
      '          persist.sys.locale|ro.product.locale) echo en-US;;',
      '          *) echo 1;;',
      '        esac;;',
      '      logcat) echo "I/BootReceiver( 1234): sys.boot_completed=1";;',
      '    esac;;',
      'esac',
      '',
    ].join('\n');
    const hangingAdb = [
      '#!/bin/sh',
      'case "$1" in',
      '  devices) /bin/echo "SANDBOX_ADB_HANG devices" >&2; exec sleep 600;;',
      '  -e)',
      '    case "$2" in',
      '      shell) /bin/echo "SANDBOX_ADB_HANG shell" >&2; exec sleep 600;;',
      '      logcat) /bin/echo "SANDBOX_ADB_HANG logcat" >&2; exec sleep 600;;',
      '    esac;;',
      'esac',
      '/bin/echo "SANDBOX_ADB_HANG other: $*" >&2',
      'exec sleep 600',
      '',
    ].join('\n');
    /**
     * `adb: 'slow'` answers everything, three seconds late. A tool that is *merely
     * slow* is the case a guard with an over-tight budget would break, and the timing
     * fake has to be paired with the real budgets for that reason — the hang case
     * shortens the deadlines to stay fast, and a script that only honoured a small
     * deadline would pass it.
     */
    const slowAdb = [
      '#!/bin/sh',
      'sleep 3',
      'echo "SANDBOX_ADB_SLOW answered: $*"',
      'case "$1" in',
      '  devices) echo "List of devices attached";;',
      '  -e)',
      '    case "$2" in',
      '      shell) case "$4" in',
      '        persist.sys.timezone) echo Europe/Lisbon;;',
      '        *) echo 1;;',
      '      esac;;',
      '      logcat) echo "I/BootReceiver( 1234): sys.boot_completed=1";;',
      '    esac;;',
      'esac',
      '',
    ].join('\n');
    const body = hangTools ? hangingAdb : adb === 'slow' ? slowAdb : fakeAdb;
    if (adb === 'path' || adb === 'slow') {
      fs.writeFileSync(path.join(bin, 'adb'), body, { mode: 0o755 });
    } else if (adb === 'platform-tools' || adb === 'hang') {
      // The runner's own shape for a step body that has not been told where the SDK
      // is: `adb` is on the *harness action's* PATH and nowhere else, so only an
      // `$ANDROID_HOME/platform-tools/adb` candidate can find it. Run 41256853746's
      // host.log is eight "command not found" lines, which is the whole reason this
      // resolution exists. `hang` is the same placement with the hostile behaviour.
      fs.mkdirSync(path.join(androidHome, 'platform-tools'), {
        recursive: true,
      });
      fs.writeFileSync(path.join(androidHome, 'platform-tools', 'adb'), body, {
        mode: 0o755,
      });
    }
    /**
     * Warm the hostile stubs once, so the case measures the script and not the machine.
     *
     * The failing assertion was the *first* stub the script execs, every time, and only
     * under `check`'s load: the first exec of a file that was just written pays for the
     * path lookup, the code-signing check and the vnode work, and under a load average in
     * the tens that alone can outrun a 700 ms budget — so the stub was killed before it
     * had printed anything, and the witness for "this command really was asked" was
     * missing. That is test-setup cost being measured as script behaviour. Running each
     * stub once here, with its output discarded, pays that cost up front; the case's own
     * timing then says something about the script rather than about the file system.
     *
     * The healthy stubs need no warm-up: they exit, and an exiting command is answered
     * however long it took to start.
     *
     * @param {string[]} command
     */
    const warm = (command) =>
      spawnSync(command[0], command.slice(1), {
        // Killed on purpose — these stubs never return. The point is the exec, not the
        // answer, so the deadline only has to outlast process startup.
        timeout: 1000,
        killSignal: 'SIGKILL',
        stdio: 'ignore',
      });
    if (hangTools) {
      warm([path.join(androidHome, 'platform-tools', 'adb'), 'devices']);
      warm([path.join(bin, 'sudo'), '-n', 'dmesg']);
    }
    return {
      cwd,
      home,
      androidHome,
      diag: (file) => path.join(cwd, 'harness-diag', file),
      dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
      env: {
        // Nothing inherited: a CI step body that works only with a developer's
        // `$PATH`/`$HOME` is the thing being tested for. The stub `bin` is always
        // first, so `sudo` resolves to it and never to `/usr/bin/sudo`.
        PATH: [
          bin,
          adb === 'path' ? bin : null,
          path.dirname(process.execPath),
          '/usr/bin',
          '/bin',
        ]
          .filter(Boolean)
          .join(path.delimiter),
        HOME: home,
        ANDROID_HOME: androidHome,
      },
    };
  }

  /**
   * Run the diagnostics script the collect step calls, in a sandbox, and say how long
   * it took.
   *
   * The step body is one line that calls this file, so running the file *is* running the
   * step for everything the step controls — and the timing is the point: run
   * 41269235234's step ran 90 minutes, so a duration is not incidental detail, it is the
   * property under test. `spawnSync` here has its own hard timeout, larger than any
   * budget the script may use, so a script that hangs makes the test fail by *timing
   * out* rather than by hanging the suite.
   *
   * @param {ReturnType<typeof sandbox>} box
   * @param {Record<string,string>} [env] budget overrides for the script
   * @param {number} [killAfterMs]
   */
  function runDiagnostics(box, env = {}, killAfterMs = 180_000) {
    const startedAt = Date.now();
    const ran = spawnSync(
      process.execPath,
      [path.join(root, DIAGNOSTICS_SCRIPT), '--out', 'harness-diag'],
      {
        cwd: box.cwd,
        env: { ...box.env, ...env },
        encoding: 'utf8',
        timeout: killAfterMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    return {
      ...ran,
      elapsedMs: Date.now() - startedAt,
      /** The script's own count line, with the elapsed part it appends removed. */
      countLine:
        String(ran.stdout ?? '')
          .trim()
          .split('\n')
          .slice(-1)[0]
          ?.replace(/ \(elapsed \d+s\)$/u, '') ?? '',
    };
  }

  it('the diagnostics step exits 0 with nothing on the machine to collect', () => {
    // Run 41256853746 exactly: no AVD (the job died in the preflight, so the
    // harness never created one), hence no `emulator-*.log`, and no `logcat.txt`
    // because there was no `adb`. That is the shape the old last line could not
    // survive.
    const step = (ciJob('harness-android').steps ?? []).find((candidate) =>
      String(candidate.name ?? '').includes('Collect emulator boot diagnostics')
    );
    expect(step).not.toBeUndefined();
    // The step is a call into a script, which is what makes it testable at all: a
    // shell body cannot bound its own commands on a host without `timeout(1)`.
    expect(String(step.run)).toContain(DIAGNOSTICS_SCRIPT);
    const box = sandbox();
    try {
      const ran = runDiagnostics(box);
      expect({
        status: ran.status,
        err:
          String(ran.stderr ?? '')
            .split('\n')
            .find(Boolean) ?? '',
        tail: ran.countLine,
      }).toEqual({
        status: 0,
        err: '',
        tail: 'diagnostics: 2 file(s) in harness-diag',
      });
      // `host.log` and `avd.log` are written before anything can fail, which is the
      // whole point of the step: some evidence, whatever else happened.
      expect(fs.existsSync(box.diag('host.log'))).toBe(true);
      // And the tool that is missing is *named* as missing rather than swallowed:
      // "command not found" inside the file is what let the first version of this
      // step look like a healthy report about a machine with no emulator in it.
      expect(fs.readFileSync(box.diag('host.log'), 'utf8')).toContain(
        '== adb ==\nnot found'
      );
      // And the kernel line went through the stub, not through the machine's real
      // `sudo`. Without this the step would be a privilege call whose result
      // depends on who runs the tests, and it would still look green.
      expect(fs.readFileSync(box.diag('host.log'), 'utf8')).toContain(
        'SANDBOX_SUDO_MARKER ran: -n dmesg'
      );
    } finally {
      box.dispose();
    }
  });

  /**
   * The step must finish, on a machine whose every tool is waiting for something that
   * will never arrive.
   *
   * Run 41269235234's harness failed at 03:34–03:46, and the diagnostics step that ran
   * after it did not finish until the run was cancelled, past 05:15. Nothing in that job
   * said which command: the step's log had nothing in it, because a step's stdout is not
   * streamed while it runs, and `host.log` was in an artifact that was never uploaded.
   * A command that never returns is therefore the failure mode this case is about, and
   * the only honest way to test it is to hand the script commands that never return.
   *
   * The budget here is shortened by env, because a test that proved the bound by waiting
   * through the real one would take six minutes per hanging command — and shortening it
   * is only legitimate because the next case runs the *real* budget against a tool that
   * is merely slow.
   */
  it('the diagnostics step returns when every tool it asks would hang', () => {
    const box = sandbox({ avd: true, adb: 'hang' });
    try {
      const ran = runDiagnostics(
        box,
        {
          NITRO_UI_DIAG_COMMAND_TIMEOUT_MS: '700',
          // Comfortably above what the hanging commands add up to (a dozen at 700 ms),
          // so this case proves the *per-command* bound keeps the run moving and every
          // section still gets asked. The overall budget is the second guard, and the
          // case named below exhausts it on purpose. CI's own numbers are 20 s and
          // 240 s against ten-odd commands; the ratios here are the same, at a scale a
          // test can wait through.
          NITRO_UI_DIAG_BUDGET_MS: '60000',
        },
        // Less than the 60 s budget on purpose: a script that ignored its deadlines
        // would still be running when this kills it, which is the red this case wants.
        30_000
      );
      expect({
        status: ran.status,
        countLine: ran.countLine,
        elapsedMs: Math.round(ran.elapsedMs / 1000),
      }).toEqual({
        status: 0,
        countLine: 'diagnostics: 4 file(s) in harness-diag',
        // The assertion the whole case exists for: bounded, not "eventually". Four
        // orders of magnitude short of the 90 minutes this step took on run
        // 41269235234, and the 30 s kill above is what makes "it hung" a failure
        // rather than a stalled suite.
        elapsedMs: expect.any(Number),
      });
      expect(ran.elapsedMs).toBeLessThan(30_000);
      // The hanging tools were really reached, and really given up on: without these
      // lines, a script that quietly skipped adb and sudo would pass the same
      // assertions for the wrong reason.
      const host = fs.readFileSync(box.diag('host.log'), 'utf8');
      expect(host).toContain('SANDBOX_ADB_HANG devices');
      expect(host).toContain('SANDBOX_SUDO_HANG ran: -n dmesg');
      expect(host).toMatch(/timed out after .+s and was killed/u);
      /**
       * The `dmesg` section says so too, rather than reporting an *answer*.
       *
       * A killed command keeps its partial output and appends the reason, so "did it
       * answer" cannot be a prefix test: the first version of this check read the start of
       * the string, saw the stub's own line, concluded the kernel ring had been read, and
       * printed `<nothing mentions kvm or binder>` about a machine whose `sudo` never
       * answered. That is the failure mode this whole step exists to avoid — an evidence
       * file that looks healthy — and it survived a green run until `check` under load
       * reordered the sections and someone read them.
       */
      const dmesgSection = host.slice(
        host.indexOf('== dmesg (kvm) =='),
        host.indexOf('== kernel tail ==')
      );
      expect(dmesgSection).toMatch(/timed out|gave up/u);
      expect(dmesgSection).not.toContain('nothing mentions kvm');
      // And the run says so in its own output, so the artifact is not the only place
      // the truth exists.
      expect(String(ran.stdout)).toContain('incomplete');
      // Evidence survived the hostile machine: the AVD's config was readable, and the
      // AVD's own log copied, even though adb and sudo never answered.
      expect(fs.readFileSync(box.diag('avd.log'), 'utf8')).toContain(
        'hw.gpu.mode=swift_ind'
      );
      expect(fs.existsSync(box.diag('emulator-5554.log'))).toBe(true);
    } finally {
      box.dispose();
    }
  }, 90_000);

  /**
   * The same guarantee at the budget CI actually runs with.
   *
   * Per this repo's own rule about fakes that change timing: the shortened budgets above
   * could be satisfied by a script that only respects a small deadline (a `setTimeout`
   * that races a promise that never settles, say). So one command gets a stub that is
   * merely slow — 3 s, well inside the real 20 s per-command budget and well inside the
   * real overall one — and the run must be green, complete, and carry that command's
   * answer. Fast, and correct, at the numbers that ship.
   */
  it('the real budgets still let a slow-but-alive tool through', () => {
    const box = sandbox({ avd: true, adb: 'slow' });
    try {
      const ran = runDiagnostics(box, {}, 120_000);
      expect(ran.status).toBe(0);
      const host = fs.readFileSync(box.diag('host.log'), 'utf8');
      // Answered, not timed out: the stub is slower than a healthy adb and faster than
      // the budget, which is exactly the case a too-tight guard would break.
      expect(host).toContain('SANDBOX_ADB_SLOW answered');
      expect(host).not.toMatch(/timed out/u);
      // Nothing was skipped, and the real budget was nowhere near spent.
      expect(String(ran.stdout)).not.toContain('incomplete');
      expect(ran.elapsedMs).toBeLessThan(60_000);
    } finally {
      box.dispose();
    }
  }, 90_000); // Six slow commands at the real per-command budget: the point is that they all fit.

  /**
   * The overall budget, as opposed to a single command's.
   *
   * A machine where every command times out is worse than one where a single command does:
   * twelve 20-second timeouts is four minutes of nothing, and the step's own 5 minutes is
   * next. So the script stops asking once its budget is gone, and says which questions it
   * never got to ask. That branch is its own behaviour, and it needs its own case — an
   * untested "gave up" path in a diagnostics tool is exactly the kind of thing that turns
   * out not to work when it matters.
   */
  it('the diagnostics step gives up on its own budget and says what it skipped', () => {
    const box = sandbox({ avd: true, adb: 'hang' });
    try {
      const ran = runDiagnostics(box, {
        // Per-command and overall in the same ratio CI has (20 s and 240 s), taken small:
        // the budget is roughly one command's worth, so everything after the first hang is
        // skipped rather than asked.
        NITRO_UI_DIAG_COMMAND_TIMEOUT_MS: '700',
        NITRO_UI_DIAG_BUDGET_MS: '1500',
      });
      expect(ran.status).toBe(0);
      expect(ran.elapsedMs).toBeLessThan(20_000);
      const host = fs.readFileSync(box.diag('host.log'), 'utf8');
      // Named as skipped, not silently absent.
      expect(host).toContain('skipped, the diagnostics budget is spent');
      expect(String(ran.stdout)).toContain('incomplete');
      // And giving up did not lose the cheap evidence, because the cheap evidence was
      // read first: the AVD's hardware config is still in the artifact.
      expect(fs.readFileSync(box.diag('avd.log'), 'utf8')).toContain(
        'hw.gpu.mode=swift_ind'
      );
    } finally {
      box.dispose();
    }
  });

  it('the diagnostics step still prints what exists, including the AVD config', () => {
    // The other half of "tolerate a missing log while still printing the ones that
    // exist": with a booted emulator, its stderr, its `config.ini` and its
    // properties must all reach the log and the artifact. `config.ini` is here and
    // not in the preflight because the harness creates or restores the AVD in the
    // step after the preflight, where the preflight's read of it could only ever
    // print "No such file" on a cache miss — which is what run 41256853746 showed.
    const box = sandbox({ avd: true, adb: 'platform-tools' });
    try {
      const ran = runDiagnostics(box);
      expect(ran.status).toBe(0);
      const out = String(ran.stdout ?? '');
      // Found through `$ANDROID_HOME/platform-tools`, with `adb` nowhere on PATH.
      expect(fs.readFileSync(box.diag('host.log'), 'utf8')).toContain(
        path.join(box.androidHome, 'platform-tools', 'adb')
      );
      expect(fs.readFileSync(box.diag('host.log'), 'utf8')).toContain(
        'sys.boot_completed=1'
      );
      // And the device's own clock and locale, which is how the Android job's
      // `DST PREMISE MISSING` line becomes readable: the zone is an emulator
      // setting nothing in this repo passes, so the artifact has to carry it.
      expect(fs.readFileSync(box.diag('host.log'), 'utf8')).toContain(
        'persist.sys.timezone='
      );
      // The hardware lines, in the artifact, from the AVD the job really used.
      expect(fs.readFileSync(box.diag('avd.log'), 'utf8')).toContain(
        'hw.gpu.mode=swift_ind'
      );
      // Copied, and printed: a log that exists must be readable in the step's own
      // output, not only in the artifact someone has to download.
      expect(fs.existsSync(box.diag('emulator-5554.log'))).toBe(true);
      expect(out).toContain('qemu: FIREFOX_MARKER_LINE');
      expect(out).toContain('sys.boot_completed=1');
    } finally {
      box.dispose();
    }
  });

  it('uploads a directory the uploader can actually see, and the one the step wrote', () => {
    // Two steps, one path, and a default that bites: `upload-artifact` v4 resolves
    // `path` with hidden entries excluded unless `include-hidden-files: true`, so a
    // dot-directory collects files and uploads nothing, silently, under
    // `if-no-files-found: ignore`. Run 41256853746 is the proof: the collect step
    // listed `host.log` and `logcat.txt`, and the upload step's own input dump shows
    // `include-hidden-files: false` next to "No files were found with the provided
    // path: .harness-diag". So the path must be visible, and must be the same string
    // the collect step writes to — drift between the two is the same bug in a
    // different spelling.
    const job = readYaml('ci.yml').jobs['harness-android'];
    const steps = job.steps ?? [];
    const collect = steps.find((candidate) =>
      String(candidate.name ?? '').includes('Collect emulator boot diagnostics')
    );
    const upload = steps.find((candidate) =>
      String(candidate.name ?? '').includes('Upload emulator boot diagnostics')
    );
    expect(upload).not.toBeUndefined();
    const withs = upload.with ?? {};
    const target = String(withs.path ?? '').replace(/\/+$/u, '');
    expect(target).not.toBe('');
    // Not hidden, in any segment, because the uploader's globber drops a hidden
    // *segment*, not just hidden file names.
    expect(target.split('/').some((segment) => segment.startsWith('.'))).toBe(
      false
    );
    /**
     * The same directory the step writes into, read out of the step body rather than
     * repeated here as a second copy of the answer. The step calls the script with
     * `--out <dir>`, so that argument *is* the answer, and it is the argument the run
     * below actually passes — a test that hardcoded `harness-diag` while the step said
     * something else would leave the artifact empty and still be green.
     */
    const assigned = String(collect.run).match(/--out\s+(\S+)/u)?.[1];
    expect(assigned).toBe(target);
    expect(String(collect.run)).toContain(DIAGNOSTICS_SCRIPT);
    // And "we found nothing" has to be a red step. `ignore` is what made the
    // uploader's silence indistinguishable from a run that needed no diagnostics.
    expect(String(withs['if-no-files-found'])).toBe('error');
    // Behaviourally: after a real run of the body, the uploader's `path` resolves to
    // a directory holding at least one visible file.
    const box = sandbox();
    try {
      expect(runStepBody(String(collect.run), box).status).toBe(0);
      const uploaded = fs
        .readdirSync(path.join(box.cwd, target))
        .filter((name) => !name.startsWith('.'));
      expect(uploaded.length).toBeGreaterThan(0);
    } finally {
      box.dispose();
    }
  });
});

describe('the AVD name CI prints is the name the harness boots', () => {
  /**
   * `scripts/ci-avd-name.mjs` exists because a workflow step cannot import the
   * harness config, and it reads the config as *text* to stay honest about the
   * default. That covers one of the three things `avd()` does: the other two are
   * the `ANDROID_AVD` and `AVD` overrides, and a step that prints the default while
   * the harness boots an override is not reporting what the job is doing. Every
   * leased device on this repo's dev boxes sets `ANDROID_AVD`, which is how this
   * was found: the diagnostics step looked in `~/.android/avd/nitroui.avd` for a
   * run whose emulator lived in `nitroui_a.avd`.
   */
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
    /**
     * An empty override is not a name. `set -a; . <(lease.mjs acquire)` style
     * sourcing produces one, and the harness's own `??` treats `''` as a value — so
     * this is the one place where the two are deliberately *not* identical, in the
     * direction that keeps a report from printing a blank line and looking like a
     * machine with no AVD in it.
     */
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
