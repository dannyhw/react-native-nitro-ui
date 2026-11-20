import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  CHECK_STEPS,
  FINDINGS,
  MAX_DEFAULT_JOBS,
  MAX_JOBS,
  commandForStep,
  defaultJobsFrom,
  findOutputConflicts,
  parseJobsArgument,
  planProblems,
  runCheckPlan,
  unknownCheckArguments,
  validateCheckSteps,
} from '../check-steps.mjs';

import { childEnv } from './helpers/scrubbed-env.js';

const root = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);

/** The graph's step names, in declaration order. */
function stepNames(steps = CHECK_STEPS) {
  return steps.map((step) => step.name);
}

describe('the check step list', () => {
  it('`check` in package.json is the runner, and every step is a real script', () => {
    expect(packageJson.scripts.check).toBe('node scripts/check.mjs');
    for (const name of stepNames()) {
      expect(packageJson.scripts[name]).toEqual(expect.any(String));
    }
    expect(stepNames()).toHaveLength(18);
    expect(stepNames().indexOf('prepare')).toBeLessThan(
      stepNames().indexOf('api-extractor:check')
    );
  });

  it('the runner refuses a graph that races over a shared output', () => {
    // `planProblems` is what `check.mjs` checks before spawning anything.
    expect(planProblems(CHECK_STEPS)).toEqual([]);
    const mutated = CHECK_STEPS.map((step) =>
      step.name === 'prepare' ? { ...step, needs: [] } : step
    );
    const problems = planProblems(mutated);
    expect(problems).toEqual(
      expect.arrayContaining([
        'shared output: prepare writes nitrogen/generated while test:library reads it - add a needs edge or a shared group',
      ])
    );
  });

  it('the step names, in order', () => {
    // Spelled out, so adding, dropping or renaming a step has to be done here too.
    expect(stepNames()).toEqual([
      'typecheck',
      'lock:check',
      'bench:typecheck',
      'lint',
      'format',
      'test:library',
      'test:native',
      'test:tooling',
      'test:native:android',
      'perf:renders',
      'nitrogen:check',
      'registry:check',
      'autolinking:check',
      'prepare',
      'api-extractor:check',
      'publint',
      'manifest:check',
      'readme:check',
    ]);
  });

  it('every step runs the script of the same name', () => {
    for (const step of CHECK_STEPS) {
      expect(commandForStep(step)).toEqual(['bun', 'run', step.name]);
    }
  });
});

describe('the step list is usable', () => {
  it('declares no unknown or forward `needs`, and no duplicate names', () => {
    expect(validateCheckSteps(CHECK_STEPS)).toEqual([]);

    expect(
      validateCheckSteps([
        { name: 'a', needs: ['nope'] },
        { name: 'b', needs: [] },
        { name: 'b', needs: [] },
      ])
    ).toEqual(['a: needs nope, which is not a step', 'b: declared twice']);

    // Forward `needs` is what a cycle would look like, and it is unrepresentable:
    // the scheduler could only wait on a step it has not reached yet.
    expect(
      validateCheckSteps([
        { name: 'a', needs: ['b'] },
        { name: 'b', needs: [] },
      ])
    ).toEqual([
      'a: needs b, which is declared later (needs may only point back at an earlier step)',
    ]);
  });

  it('`needs` only ever names an earlier step, so the graph cannot cycle', () => {
    const index = new Map(stepNames().map((name, i) => [name, i]));
    for (const step of CHECK_STEPS) {
      for (const need of step.needs) {
        expect(index.get(need)).toBeLessThan(index.get(step.name));
      }
    }
  });
});

describe('steps that share an output are ordered', () => {
  it('no two steps touch the same region with nothing between them', () => {
    expect(findOutputConflicts(CHECK_STEPS)).toEqual([]);
  });

  it('`prepare` deletes and regenerates nitrogen/, so the readers of it come first', () => {
    const prepare = CHECK_STEPS.find((step) => step.name === 'prepare');
    expect(prepare.writes).toEqual(
      expect.arrayContaining(['nitrogen/generated', 'lib'])
    );
    // builder-bob's `custom` target has `clean: "nitrogen/"`, so `prepare`
    // deletes and rewrites the directory: a concurrent reader can see it gone.
    expect(prepare.needs).toEqual(
      expect.arrayContaining(['nitrogen:check', 'test:library', 'perf:renders'])
    );
  });

  it('removing that edge is the red this guards', () => {
    // The `lib/` readers are not in this list: their own `needs: [prepare]`
    // edge still orders them.
    const mutated = CHECK_STEPS.map((step) =>
      step.name === 'prepare' ? { ...step, needs: [] } : step
    );
    expect(findOutputConflicts(mutated).map((c) => c.kind)).toEqual([
      'prepare writes nitrogen while lint reads it',
      'prepare writes nitrogen while format reads it',
      'prepare writes nitrogen/generated while test:library reads it',
      'prepare writes nitrogen while test:tooling reads it',
      'prepare writes nitrogen/generated while test:tooling reads it',
      // The Android JVM test compiles the library, whose autolinking adds
      // `nitrogen/generated/android/kotlin` to the Kotlin source set.
      'prepare writes nitrogen/generated while test:native:android reads it',
      'prepare writes nitrogen/generated while perf:renders reads it',
      'prepare writes nitrogen/generated while nitrogen:check reads it',
    ]);
  });

  it('`nitrogen/` as a whole is a region, and lint/format are its readers (N5)', () => {
    // The linter and the formatter ignore `nitrogen/generated` only, so they walk the rest
    // of the directory that `prepare` deletes.
    const lint = CHECK_STEPS.find((step) => step.name === 'lint');
    const format = CHECK_STEPS.find((step) => step.name === 'format');
    const prepare = CHECK_STEPS.find((step) => step.name === 'prepare');
    const manifest = CHECK_STEPS.find((step) => step.name === 'manifest:check');
    expect(FINDINGS.nitrogenDir).toBe('nitrogen');
    expect(lint.reads).toContain(FINDINGS.nitrogenDir);
    expect(format.reads).toContain(FINDINGS.nitrogenDir);
    expect(manifest.reads).toContain(FINDINGS.nitrogenDir);
    expect(prepare.writes).toContain(FINDINGS.nitrogenDir);
    expect(prepare.needs).toEqual(expect.arrayContaining(['lint', 'format']));

    const unwaited = CHECK_STEPS.map((step) =>
      step.name === 'prepare'
        ? {
            ...step,
            needs: step.needs.filter((n) => n !== 'lint' && n !== 'format'),
          }
        : step
    );
    expect(findOutputConflicts(unwaited).map((c) => c.kind)).toEqual([
      'prepare writes nitrogen while lint reads it',
      'prepare writes nitrogen while format reads it',
    ]);
    // Dropping the declaration instead of the edge is invisible to the conflict
    // check, which is why `reads` is asserted above.
    const undeclared = CHECK_STEPS.map((step) =>
      step.name === 'lint' ? { ...step, reads: [] } : step
    );
    expect(findOutputConflicts(undeclared).map((c) => c.kind)).not.toContain(
      'prepare writes nitrogen while lint reads it'
    );
  });

  it('a lib reader that stops waiting for the build is the red this guards', () => {
    const mutated = CHECK_STEPS.map((step) =>
      step.name === 'publint' ? { ...step, needs: [] } : step
    );
    expect(findOutputConflicts(mutated).map((c) => c.kind)).toEqual([
      'prepare writes lib while publint reads it',
    ]);
  });

  it('`test:library` and `perf:renders` never both write Jest cache', () => {
    const test = CHECK_STEPS.find((step) => step.name === 'test:library');
    const perf = CHECK_STEPS.find((step) => step.name === 'perf:renders');
    // Reassure spawns Jest with no `--config`, so both runs get the same cache id
    // and the same roots: one haste-map file, written with a plain writeFileSync.
    expect(test.group).toBe('jest');
    expect(perf.group).toBe(test.group);
    expect(test.writes).toContain('jest-cache');
    expect(perf.writes).toContain('jest-cache');

    const ungrouped = CHECK_STEPS.map((step) =>
      step.name === 'perf:renders' ? { ...step, group: null } : step
    );
    expect(findOutputConflicts(ungrouped).map((c) => c.kind)).toEqual([
      'test:library and perf:renders both write jest-cache',
    ]);
  });

  it('says where the Kotlin step writes, and the big half is the library module', () => {
    // The step writes under `android/build`, the library module's directory, and
    // almost nothing under the root project's `example/android/build`.
    const step = CHECK_STEPS.find(
      (entry) => entry.name === 'test:native:android'
    );
    expect(step.writes).toEqual(
      expect.arrayContaining(['android/build', 'example/android/build'])
    );
    // The app module is *not* written by this step, and saying it was would put a phantom
    // conflict on a step that builds the app.
    expect(step.writes).not.toContain('example/android/app/build');
  });

  it('test:tooling declares every nitrogen/ region its tests name', () => {
    // A tooling test that names a path under `nitrogen/` may read the committed tree,
    // which `prepare` deletes and regenerates; an undeclared read hides that from
    // findOutputConflicts. Fixture trees are copied out before use, and this file names
    // regions rather than reading them, so both are skipped.
    const regionOf = (relative) =>
      relative === 'generated' || relative.startsWith('generated/')
        ? FINDINGS.generatedDir
        : FINDINGS.nitrogenDir;
    const named = new Map();
    for (const dir of ['scripts/__tests__', 'eslint-rules/__tests__']) {
      const files = fs
        .readdirSync(path.join(root, dir), { recursive: true })
        .filter(
          (file) =>
            file.endsWith('.js') &&
            file !== 'check-runner.test.js' &&
            !file.split(path.sep).includes('fixtures')
        );
      for (const file of files) {
        const source = fs.readFileSync(path.join(root, dir, file), 'utf8');
        for (const match of source.matchAll(/['"`]nitrogen\/([^'"`\s]*)/g)) {
          const region = regionOf(match[1]);
          if (!named.has(region)) named.set(region, `${dir}/${file}`);
        }
      }
    }
    expect(named.has(FINDINGS.generatedDir)).toBe(true);
    const tooling = CHECK_STEPS.find((step) => step.name === 'test:tooling');
    for (const [region, file] of named) {
      expect(tooling.reads, `${file} names a path under ${region}`).toContain(
        region
      );
    }
  });

  it('the lib readers wait for the build', () => {
    for (const name of ['api-extractor:check', 'publint', 'manifest:check']) {
      expect(CHECK_STEPS.find((step) => step.name === name).needs).toContain(
        'prepare'
      );
    }
  });
});

describe('defaultJobsFrom', () => {
  it('is half the cores, at least 2 and at most 4', () => {
    expect(defaultJobsFrom(1)).toBe(1);
    expect(defaultJobsFrom(2)).toBe(2);
    expect(defaultJobsFrom(4)).toBe(2);
    expect(defaultJobsFrom(8)).toBe(4);
    expect(defaultJobsFrom(10)).toBe(4);
    expect(defaultJobsFrom(32)).toBe(MAX_DEFAULT_JOBS);
  });

  it('a machine it cannot read runs one step at a time', () => {
    expect(defaultJobsFrom(undefined)).toBe(1);
    expect(defaultJobsFrom(Number.NaN)).toBe(1);
  });
});

describe('--jobs', () => {
  it('reads both spellings, and refuses nonsense', () => {
    expect(parseJobsArgument(['--jobs', '2'])).toEqual({
      jobs: 2,
      problems: [],
    });
    expect(parseJobsArgument(['--jobs=3'])).toEqual({ jobs: 3, problems: [] });
    expect(parseJobsArgument([])).toEqual({ jobs: null, problems: [] });
    const bad = [
      ['--jobs', '0'],
      ['--jobs', '1.5'],
      ['--jobs', 'x'],
      ['--jobs'],
      ['--jobs', String(MAX_JOBS + 1)],
    ];
    for (const argv of bad) {
      const parsed = parseJobsArgument(argv);
      expect(parsed.jobs).toBeNull();
      expect(parsed.problems).toHaveLength(1);
    }
    expect(parseJobsArgument(['--jobs', '999']).problems[0]).toContain(
      String(MAX_JOBS)
    );
    expect(parseJobsArgument(['--jobs', '2', '--jobs', '3']).problems).toEqual([
      '--jobs given twice',
    ]);
  });

  it('nothing else is a legal argument', () => {
    expect(unknownCheckArguments(['--jobs', '2'])).toEqual([]);
    expect(unknownCheckArguments(['--jobs=2'])).toEqual([]);
    expect(unknownCheckArguments(['--update-baseline', '--jobs', '2'])).toEqual(
      ['--update-baseline']
    );
  });
});

/**
 * A fake step runner: each step resolves after `ms` of simulated time on a clock
 * the test advances, so ordering assertions do not depend on machine load.
 * `events` records every step's log lines and completion in the order they happened.
 */
function makeDriver({ durations = {}, defaultMs = 1, fail = [] }) {
  let clock = 0;
  /** @type {Array<{step: object, resolve: (value: object) => void, dueAt: number, log: string[]}>} */
  const pending = [];
  const events = [];

  const run = (step) => {
    const ms = durations[step.name] ?? defaultMs;
    const start = clock;
    events.push({ at: start, kind: 'start', step: step.name });
    // Two lines per step, so an interleave is visible as a mixed pair rather than
    // needing three concurrent steps to show up at all.
    const log = [`${step.name}~a`, `${step.name}~b`];
    return new Promise((resolve) => {
      pending.push({
        step,
        resolve,
        dueAt: start + ms,
        log,
        failed: fail.includes(step.name),
      });
    });
  };

  /** Advance to the next scheduled completion (or throw if nothing is pending). */
  const tick = () => {
    if (pending.length === 0) throw new Error('driver: nothing pending');
    const next = Math.min(...pending.map((item) => item.dueAt));
    clock = next;
    const ready = pending.filter((item) => item.dueAt <= next);
    for (let i = 0; i < ready.length; i += 1) {
      const index = pending.indexOf(ready[i]);
      pending.splice(index, 1);
      const item = ready[i];
      events.push({ at: clock, kind: 'end', step: item.step.name });
      item.resolve({
        ok: !item.failed,
        log: `${item.log.join('\n')}\n`,
        exitCode: item.failed ? 2 : 0,
      });
    }
    return true;
  };

  return {
    run,
    tick,
    events,
    hasPending: () => pending.length > 0,
    now: () => clock,
  };
}

/** Drive `runCheckPlan` to completion with the simulated clock. */
async function drive(options) {
  const driver = makeDriver(options);
  const seen = [];
  const promise = runCheckPlan({
    ...options,
    run: driver.run,
    now: driver.now,
    onEvent: (event) => {
      seen.push(event);
      // Only the flush carries a log block: the engine hands the log out once,
      // in one event.
      if (event.type === 'flush') {
        for (const line of (event.result.log ?? '').split('\n')) {
          if (line !== '') seen.push({ type: 'line', at: driver.now(), line });
        }
      }
    },
  });
  let guard = 0;
  while (driver.hasPending()) {
    driver.tick();
    // Let the engine's promise callbacks run before the next tick.
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    guard += 1;
    if (guard > 500)
      throw new Error('the plan never drained: a step never started');
  }
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  const plan = await promise;
  return { plan, seen, events: driver.events };
}

describe('the scheduler', () => {
  it('runs the whole graph, and the summary says so', async () => {
    const { plan } = await drive({ steps: CHECK_STEPS, jobs: 4 });
    expect(plan.ok).toBe(true);
    expect(plan.results.map((r) => r.status)).toEqual(
      stepNames().map(() => 'pass')
    );
    expect(plan.failures).toEqual([]);
  });

  it('never runs more steps at once than --jobs', async () => {
    for (const jobs of [1, 2, 4]) {
      const { events } = await drive({ steps: CHECK_STEPS, jobs });
      let running = 0;
      let peak = 0;
      for (const event of events) {
        if (event.kind === 'start') {
          running += 1;
          peak = Math.max(peak, running);
        } else {
          running -= 1;
        }
      }
      expect(peak).toBeLessThanOrEqual(jobs);
      // With a graph this shallow, a machine with room must use every slot.
      expect(peak).toBe(jobs);
    }
  });

  it('two steps in a group never overlap', async () => {
    // `test:library` and `perf:renders` share the `jest` group, which has one slot.
    const { events } = await drive({
      steps: CHECK_STEPS,
      jobs: 4,
      durations: { 'test:library': 5, 'perf:renders': 5 },
    });
    const inFlight = new Set();
    for (const event of events) {
      if (event.kind === 'start') {
        const step = CHECK_STEPS.find((s) => s.name === event.step);
        if (step.group === 'jest') {
          expect(inFlight.has('jest')).toBe(false);
          inFlight.add('jest');
        }
      } else {
        const step = CHECK_STEPS.find((s) => s.name === event.step);
        if (step.group === 'jest') inFlight.delete('jest');
      }
    }
  });

  it('a step waits for what it needs', async () => {
    const { events } = await drive({
      steps: CHECK_STEPS,
      jobs: 16,
      durations: {
        'nitrogen:check': 5,
        'prepare': 1,
        'api-extractor:check': 1,
      },
    });
    const at = (name, kind) =>
      events.find((e) => e.step === name && e.kind === kind).at;
    expect(at('prepare', 'start')).toBeGreaterThanOrEqual(
      at('nitrogen:check', 'end')
    );
    expect(at('prepare', 'start')).toBeGreaterThanOrEqual(
      at('test:library', 'end')
    );
    expect(at('api-extractor:check', 'start')).toBeGreaterThanOrEqual(
      at('prepare', 'end')
    );
    // ...and a step nobody depends on does not wait for the long pole.
    expect(at('readme:check', 'start')).toBe(0);
  });

  it('a log is printed whole, in declared step order', async () => {
    // Flushes go out in declared order as they become ready, whichever step
    // finishes first.
    const { seen, plan } = await drive({
      steps: CHECK_STEPS,
      jobs: 4,
      durations: { 'readme:check': 1, 'typecheck': 20 },
    });
    expect(plan.ok).toBe(true);
    const flushes = seen
      .filter((e) => e.type === 'flush')
      .map((e) => e.step.name);
    expect(flushes).toEqual(stepNames());

    const lines = seen.filter((e) => e.type === 'line').map((e) => e.line);
    const owners = lines.map((line) => line.split('~')[0]);
    // Each step's two lines are adjacent, and the blocks are in declared order -
    // i.e. nothing interleaved and nothing out of turn.
    expect(owners).toEqual(stepNames().flatMap((name) => [name, name]));
    expect(new Set(owners).size).toBe(CHECK_STEPS.length);
  });

  it('a step that ends late still cannot cut in front of one that ended early', async () => {
    // `test:native` is 7th in the list and the slowest of the first half:
    // everything behind it finishes first and must still print after it.
    const { seen } = await drive({
      steps: CHECK_STEPS,
      jobs: 4,
      durations: { 'test:native': 30 },
    });
    const flushes = seen
      .filter((e) => e.type === 'flush')
      .map((e) => e.step.name);
    const index = flushes.indexOf('test:native');
    expect(index).toBe(6);
    expect(flushes.slice(0, index)).toEqual(stepNames().slice(0, 6));
    expect(flushes.indexOf('perf:renders')).toBeGreaterThan(index);
  });

  it('on the first failure it starts nothing new, lets running steps finish, and says who was skipped', async () => {
    // `typecheck` fails at t=10 while `test:library` (50) is in flight and everything
    // else is queued behind the slots.
    const { plan, seen } = await drive({
      steps: CHECK_STEPS,
      jobs: 4,
      durations: { 'typecheck': 10, 'test:library': 50, 'test:native': 20 },
      defaultMs: 5,
      fail: ['typecheck'],
    });

    const status = Object.fromEntries(
      plan.results.map((r) => [r.name, r.status])
    );
    expect(status.typecheck).toBe('fail');
    // Started before the failure, so it is allowed to finish and its log stands.
    expect(status['test:library']).toBe('pass');
    expect(status['test:native']).toBe('pass');
    expect(status.lint).toBe('pass');
    expect(status['nitrogen:check']).toBe('skipped');
    expect(status['perf:renders']).toBe('skipped');
    expect(status.prepare).toBe('skipped');
    expect(status['manifest:check']).toBe('skipped');
    expect(plan.ok).toBe(false);
    expect(plan.failures).toEqual(['typecheck']);
    // Every step is accounted for: nothing silently missing.
    expect(plan.results).toHaveLength(CHECK_STEPS.length);
    expect(
      seen.filter((e) => e.type === 'skip').map((e) => e.step.name)
    ).toEqual(
      plan.results.filter((r) => r.status === 'skipped').map((r) => r.name)
    );
    // And the skip reason names the failure, so a report can say why.
    expect(seen.find((e) => e.type === 'skip').result.reason).toContain(
      'typecheck failed'
    );
    // Fail-fast is a *stop starting* rule, not a kill: nothing started after t=10.
    const started = seen
      .filter((e) => e.type === 'start')
      .map((e) => e.step.name);
    expect(started).toEqual(
      expect.arrayContaining([
        'typecheck',
        'lock:check',
        'bench:typecheck',
        'lint',
      ])
    );
    expect(started).not.toContain('readme:check');
    // And a skipped step's log is still flushed, whole, so the log has a block for
    // every step in the graph in declared order.
    expect(
      seen.filter((e) => e.type === 'flush').map((e) => e.step.name)
    ).toEqual(stepNames());
  });

  it('a step whose need failed is never started - and that guard has a mode that reaches it', async () => {
    // Fail-fast halts the whole plan, so the `needs` guard is only reachable
    // with `haltOnFailure: false`: keep starting independent work, but never a
    // step whose need did not pass.
    const steps = [
      { name: 'a', needs: [], writes: [], reads: [] },
      { name: 'b', needs: ['a'], writes: [], reads: [] },
      { name: 'c', needs: ['b'], writes: [], reads: [] },
      { name: 'd', needs: [], writes: [], reads: [] },
    ];
    const run = async (step) => {
      if (step.name === 'a') return { ok: false, log: 'no\n', exitCode: 1 };
      return { ok: true, log: '', exitCode: 0 };
    };

    const startedFast = [];
    const halted = await runCheckPlan({
      steps,
      // One slot, so fail-fast is tested as fail-fast rather than as a race: with 4
      // slots `d` is already running when `a` fails, and running steps are allowed to
      // finish, so `d` would pass here for the wrong reason.
      jobs: 1,
      run: async (step) => {
        startedFast.push(step.name);
        return run(step);
      },
    });
    expect(startedFast).toEqual(['a']);
    expect(halted.results.map((r) => [r.name, r.status])).toEqual([
      ['a', 'fail'],
      ['b', 'skipped'],
      ['c', 'skipped'],
      ['d', 'skipped'],
    ]);
    expect(halted.results.find((r) => r.name === 'b').reason ?? '').toContain(
      'a failed'
    );

    const startedWide = [];
    const keptGoing = await runCheckPlan({
      steps,
      jobs: 4,
      haltOnFailure: false,
      run: async (step) => {
        startedWide.push(step.name);
        return run(step);
      },
    });
    // `d` does not depend on `a`, so it runs; `b` and `c` are refused by the guard.
    expect(startedWide.sort()).toEqual(['a', 'd']);
    expect(keptGoing.failures).toEqual(['a']);
    expect(keptGoing.results.find((r) => r.name === 'b').status).toBe(
      'skipped'
    );
    expect(keptGoing.results.find((r) => r.name === 'b').reason).toContain(
      'which did not pass'
    );
    expect(keptGoing.results.find((r) => r.name === 'd').status).toBe('pass');
  });

  it('a step that throws is a failure, not a hang', async () => {
    const steps = [
      { name: 'a', needs: [], writes: [], reads: [] },
      { name: 'b', needs: [], writes: [], reads: [] },
    ];
    const plan = await runCheckPlan({
      steps,
      jobs: 2,
      run: async (step) => {
        if (step.name === 'a') throw new Error('spawn ENOENT');
        return { ok: true, log: '', exitCode: 0 };
      },
    });
    expect(plan.failures).toEqual(['a']);
    expect(plan.results.find((r) => r.name === 'a').reason).toContain(
      'spawn ENOENT'
    );
  });

  it('a step killed by a signal is a failure', async () => {
    const plan = await runCheckPlan({
      steps: [{ name: 'a', needs: [], writes: [], reads: [] }],
      jobs: 1,
      run: async () => ({
        ok: false,
        log: '',
        exitCode: null,
        signal: 'SIGTERM',
      }),
    });
    expect(plan.ok).toBe(false);
    expect(plan.results[0].status).toBe('fail');
    expect(plan.results[0].signal).toBe('SIGTERM');
  });

  it('refuses a step list it cannot schedule, rather than deadlocking', async () => {
    await expect(
      runCheckPlan({
        steps: [
          { name: 'a', needs: ['b'] },
          { name: 'b', needs: [] },
        ],
        jobs: 2,
        run: async () => ({ ok: true }),
      })
    ).rejects.toThrow(/declared later/);
  });
});

/* ------------------------- the runner, really spawned ------------------------ */

/**
 * A fake `bun` that stands in for `bun run <step>`, so the runner is tested against
 * real processes whose output overlaps, without running the checks.
 *
 * `X10_FAKE_STEPS` says what each step does: `{ "lint": { "ms": 300, "exit": 1 } }`.
 * Every step prints twenty numbered lines plus one on stderr, so a log block that
 * is not whole shows up as a foreign line inside it.
 */
const FAKE_BUN = `#!/usr/bin/env node
const fs = require('node:fs');
const step = process.argv[3];
const cfg = JSON.parse(process.env.X10_FAKE_STEPS || '{}')[step] || {};
const trace = process.env.X10_FAKE_TRACE;
const line = (text) => fs.appendFileSync(trace, text + '\\n');
// Wall clock on purpose, and plain arithmetic: the stamps are compared *across*
// processes to see whether two steps overlapped, so a per-process monotonic
// clock would not answer the question, and this fixture stays within the globals
// the repo's lint config gives scripts/.
const nowMs = () => Date.now();
line('start ' + step + ' ' + nowMs() + ' stepsfile=' + (process.env.NITRO_UI_CHECK_STEPS_FILE ? 'set' : 'unset'));
for (let i = 0; i < 20; i += 1) console.log(step + ':' + i);
console.error(step + ':err');
setTimeout(() => {
  line('end ' + step + ' ' + nowMs());
  process.exit(cfg.exit == null ? 0 : cfg.exit);
}, cfg.ms == null ? 40 : cfg.ms);
`;

let scratch = null;

function scratchDir() {
  if (scratch == null) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-runner-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const fake = path.join(bin, 'bun');
    fs.writeFileSync(fake, FAKE_BUN);
    fs.chmodSync(fake, 0o755);
  }
  return scratch;
}

/**
 * Runs the real `scripts/check.mjs` with the fake `bun` in front of it.
 *
 * @param {string[]} argv
 * @param {Record<string, object>} steps what each fake step does
 * @param {string | null} stepsFile where the timing record should go
 */
function runRunner(argv, steps = {}, stepsFile = null) {
  const dir = scratchDir();
  const trace = path.join(
    dir,
    `trace-${Math.random().toString(36).slice(2)}.log`
  );
  fs.writeFileSync(trace, '');
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'check.mjs'), ...argv],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: childEnv({
        PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
        X10_FAKE_STEPS: JSON.stringify(steps),
        X10_FAKE_TRACE: trace,
        ...(stepsFile == null ? {} : { NITRO_UI_CHECK_STEPS_FILE: stepsFile }),
      }),
    }
  );
  return {
    ...result,
    trace: fs
      .readFileSync(trace, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [kind, name, time, ...rest] = line.split(' ');
        return { kind, name, at: Number(time), extra: rest.join(' ') };
      }),
  };
}

/** The step each printed line belongs to, for the `<step>:<n>` fake output. */
function ownersOf(stdout) {
  return stdout
    .split('\n')
    .map((line) => /^([a-z:._-]+):(err|\d+)$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

describe('check.mjs, spawning real steps', () => {
  it('prints each step log whole, in step order, however the children interleave', () => {
    // Every fake step prints at the same time, so a runner that forwarded stdout
    // as it arrived would blend the blocks.
    const slow = Object.fromEntries(
      CHECK_STEPS.map((step, index) => [step.name, { ms: 300 + index * 8 }])
    );
    const run = runRunner(['--jobs', '8'], slow);
    expect(run.status).toBe(0);

    const owners = ownersOf(run.stdout);
    // 20 lines on stdout + 1 on stderr per step, all in one block per step.
    expect(owners).toEqual(
      CHECK_STEPS.flatMap((step) => Array(21).fill(step.name))
    );
    // stderr is part of the same block, not a separate stream in the log.
    expect(run.stdout).toContain('lint:err');

    // The fake steps really did overlap. Otherwise this would only prove that a
    // serial run does not interleave.
    const events = run.trace
      .map((e) => ({ at: e.at, delta: e.kind === 'start' ? 1 : -1 }))
      .sort((a, b) => a.at - b.at);
    let running = 0;
    let peak = 0;
    for (const event of events) {
      running += event.delta;
      peak = Math.max(peak, running);
    }
    expect(run.trace.filter((e) => e.kind === 'start')).toHaveLength(
      CHECK_STEPS.length
    );
    expect(peak).toBeGreaterThan(1);
  }, 60_000);

  it('runs no more steps at once than --jobs, and honours the flag', () => {
    const slow = Object.fromEntries(
      CHECK_STEPS.map((step) => [step.name, { ms: 120 }])
    );
    for (const jobs of [1, 2, 4]) {
      const run = runRunner(['--jobs', String(jobs)], slow);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain(`${jobs} job(s) of`);
      const events = [
        ...run.trace.map((e) => ({
          at: e.at,
          delta: e.kind === 'start' ? 1 : -1,
        })),
      ].sort((a, b) => a.at - b.at);
      let running = 0;
      let peak = 0;
      for (const event of events) {
        running += event.delta;
        peak = Math.max(peak, running);
      }
      expect(peak).toBeLessThanOrEqual(jobs);
      expect(peak).toBe(jobs);
    }
  }, 120_000);

  it('on a failing step: exits non-zero, starts nothing new, and prints that log last', () => {
    // `lock:check` fails while `typecheck` is still in flight and must finish.
    // Everything behind the slots is reported skipped.
    const run = runRunner(['--jobs', '2'], {
      'lock:check': { ms: 100, exit: 3 },
      'typecheck': { ms: 400 },
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('check: failed step(s): lock:check');
    expect(run.stdout).toContain('not started after the first failure');
    expect(run.stdout).toMatch(/lock:check\s+✗\s+fail|✗ lock:check\s+fail/);
    // Skipped steps are named on the summary lines rather than missing.
    expect(run.stdout).toContain('skipped');

    // A failing step's block is withheld from the ordered flush and printed
    // once, at the end.
    const lastRule = run.stdout.lastIndexOf('──────── full log: lock:check');
    expect(lastRule).toBeGreaterThan(-1);
    const tail = run.stdout.slice(lastRule);
    expect(tail).toContain('lock:check:0');
    expect(tail).toContain('lock:check:19');
    // ...and it is the last thing printed, because that is the block a person wants.
    expect(ownersOf(tail)).toEqual(Array(21).fill('lock:check'));

    // Nothing was started after the failure.
    const started = new Set(
      run.trace.filter((e) => e.kind === 'start').map((e) => e.name)
    );
    expect(started.has('lock:check')).toBe(true);
    expect(started.has('readme:check')).toBe(false);
  }, 60_000);

  it('writes the per-step timing record, and does not leak the file variable to the steps', () => {
    const stepsFile = path.join(
      scratchDir(),
      `steps-${Math.random().toString(36).slice(2)}.json`
    );
    const run = runRunner(['--jobs', '3'], {}, stepsFile);
    expect(run.status).toBe(0);
    const payload = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
    expect(payload.version).toBe(1);
    expect(payload.jobs).toBe(3);
    expect(payload.steps.map((step) => step.name)).toEqual(
      CHECK_STEPS.map((step) => step.name)
    );
    expect(payload.steps.every((step) => step.status === 'pass')).toBe(true);
    expect(payload.steps.every((step) => step.durationMs >= 0)).toBe(true);
    expect(payload.wallMs).toBeGreaterThan(0);

    // The variable means "the ledger waiting above me". A step that sees it could
    // answer for its parent - the same rule `NITRO_UI_GATE_LOG` has.
    expect(
      run.trace
        .filter((e) => e.kind === 'start')
        .every((e) => e.extra === 'stepsfile=unset')
    ).toBe(true);

    // A summary line per step, with its duration: the live view of the run.
    for (const step of CHECK_STEPS) {
      expect(run.stdout).toMatch(
        new RegExp(`check: . ${step.name.padEnd(19)} pass\\s+\\d+\\.\\ds`)
      );
    }
  }, 60_000);

  it('refuses an argument it does not know instead of handing it to every step', () => {
    const run = runRunner(['--update-baseline']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('unknown argument');
    expect(run.trace).toEqual([]);
  });

  it('refuses a nonsense --jobs', () => {
    for (const bad of ['0', '-1', 'x', '999']) {
      const run = runRunner(['--jobs', bad]);
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('--jobs');
      expect(run.trace).toEqual([]);
    }
  });

  it('the CI job runs this same runner, under the same name', () => {
    // The `checks` job is the required status the release path waits on, so its
    // name and its command are both pinned here.
    const ci = fs.readFileSync(
      path.join(root, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    const job = /\n {2}checks:\n([\s\S]*?)\n {2}\S/.exec(ci);
    expect(job).not.toBeNull();
    // The exact name: a renamed job would be a new check name, with the old one
    // reported as expected but never run.
    expect(job[1]).toMatch(/^ {4}name: Checks\n/);
    // The exact command line, not a substring. Eight spaces: `run:` is a step
    // key, `name:` above is a job key at four.
    expect(job[1]).toMatch(/^ {8}run: bun run check\n/m);
    // Not a chain of steps, and not forced to a job count: a pinned `--jobs` would
    // make CI's evidence a different experiment from the local one.
    expect(job[1]).not.toMatch(/run: bun run (typecheck|test) &&/);
    expect(job[1]).not.toContain('--jobs');
  });
});

/* ----------------------- the entry guard, in an odd path ---------------------- */

/**
 * The runner decides whether to run by comparing its own URL with `argv[1]`. An ESM
 * URL is percent-encoded and symlink-resolved, so the comparison has to hold for a
 * checkout under a path with a space or reached through a symlink. The guard
 * compares the file that was invoked, hence a copy of the runner in a scratch
 * checkout.
 */
function runnerInScratchCheckout(named) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-entry-'));
  fs.mkdirSync(path.join(dir, named, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, named, 'package.json'),
    JSON.stringify({ name: 'x10-entry-fixture' })
  );
  for (const file of ['check.mjs', 'check-steps.mjs']) {
    fs.copyFileSync(
      path.join(root, 'scripts', file),
      path.join(dir, named, 'scripts', file)
    );
  }
  const bin = path.join(dir, named, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const fakeBun = path.join(bin, 'bun');
  fs.writeFileSync(fakeBun, FAKE_BUN);
  fs.chmodSync(fakeBun, 0o755);
  return {
    dir,
    bin,
    script: path.join(dir, named, 'scripts', 'check.mjs'),
  };
}

describe('the runner runs itself from any path (M3)', () => {
  it('runs steps from a checkout whose path contains a space', () => {
    const { dir, bin, script } = runnerInScratchCheckout('a space');
    const trace = path.join(dir, 'trace.log');
    fs.writeFileSync(trace, '');
    const run = spawnSync(process.execPath, [script, '--jobs', '1'], {
      cwd: path.dirname(script),
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        X10_FAKE_STEPS: '{}',
        X10_FAKE_TRACE: trace,
      },
    });
    // The header is the proof that `main()` ran, and the trace that a step did.
    expect(run.stdout).toContain('steps, 1 job(s) of');
    expect(run.status).toBe(0);
    expect(
      fs
        .readFileSync(trace, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('start ')).length
    ).toBe(CHECK_STEPS.length);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it('runs steps when invoked through a symlink to itself', () => {
    const { dir, bin, script } = runnerInScratchCheckout('real');
    const linkDir = path.join(dir, 'link');
    fs.mkdirSync(path.join(linkDir, 'scripts'), { recursive: true });
    fs.symlinkSync(script, path.join(linkDir, 'scripts', 'check.mjs'));
    const trace = path.join(dir, 'trace.log');
    fs.writeFileSync(trace, '');
    const run = spawnSync(
      process.execPath,
      [path.join(linkDir, 'scripts', 'check.mjs'), '--jobs', '1'],
      {
        cwd: dir,
        encoding: 'utf8',
        timeout: 120_000,
        env: childEnv({
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          X10_FAKE_STEPS: '{}',
          X10_FAKE_TRACE: trace,
        }),
      }
    );
    expect(run.stdout).toContain('steps, 1 job(s) of');
    expect(run.status).toBe(0);
    expect(
      fs
        .readFileSync(trace, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('start ')).length
    ).toBe(CHECK_STEPS.length);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it('a no-op runner is visible: no header and exit 0 is the bug, not a pass', () => {
    // A working runner prints its header, so "printed nothing" is a signal and
    // not a normal-looking outcome.
    const { dir, script } = runnerInScratchCheckout('quiet');
    const trace = path.join(dir, 'trace.log');
    fs.writeFileSync(trace, '');
    const run = spawnSync(process.execPath, [script, '--jobs', 'nope'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, X10_FAKE_TRACE: trace },
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('--jobs');
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
