/**
 * The `check` chain as data, and the scheduler `scripts/check.mjs` runs it with.
 * No `import.meta` and no `node:os` here, so Jest can import it.
 */

/**
 * The regions steps declare in `writes`/`reads`. `prepare` (bob) deletes and
 * regenerates `nitrogen/` before it writes `lib/`, and `test` and `perf:renders`
 * share one Jest haste-map cache file that is written without a lock.
 */
export const FINDINGS = Object.freeze({
  generatedDir: 'nitrogen/generated',
  /** Everything under `nitrogen/` that is not the generated tree (specs, config). */
  nitrogenDir: 'nitrogen',
  lib: 'lib',
  jestCache: 'jest-cache',
});

/**
 * The steps of `check`. `needs` is a hard order (the earlier step must have
 * passed), `group` means "never at the same time as another member".
 * `writes`/`reads` are the regions from `FINDINGS`; `findOutputConflicts`
 * enforces them.
 */
export const CHECK_STEPS = Object.freeze([
  {
    name: 'typecheck',
    needs: [],
    group: null,
    writes: [],
    reads: [],
    note: 'tsc --noEmit over src, example/src, example/__tests__, scripts/smoke',
  },
  {
    name: 'lock:check',
    needs: [],
    group: null,
    writes: [],
    reads: [],
    note: 'reads package.json and example/ios/Podfile.lock; --fix is the only writer and check mode never passes it',
  },
  {
    name: 'bench:typecheck',
    needs: [],
    group: null,
    writes: [],
    reads: [],
    note: 'two tsc --noEmit passes over bench/ (its own tsconfigs, paths point at ../src)',
  },
  {
    name: 'lint',
    needs: [],
    group: null,
    writes: [],
    reads: [FINDINGS.nitrogenDir],
    note: 'oxlint over the tree (.oxlintrc.json); ignores lib/ and nitrogen/generated/ but not the rest of nitrogen/',
  },
  {
    name: 'format',
    needs: [],
    group: null,
    writes: [],
    reads: [FINDINGS.nitrogenDir],
    note: 'oxfmt --check; .oxfmtrc.jsonc ignores lib, nitrogen/generated, .turbo, and oxfmt also reads .gitignore - but not nitrogen/ as a whole',
  },
  {
    name: 'test',
    needs: [],
    group: 'jest',
    writes: [FINDINGS.jestCache],
    reads: [FINDINGS.generatedDir],
    note: 'jest; reads nitrogen/generated/shared/json via src/__tests__/viewConfigs.test.ts, ignores lib/',
  },
  {
    name: 'test:native',
    needs: [],
    group: null,
    writes: ['tmp:nitro-ui-native-tests'],
    reads: [],
    note: 'clang/swiftc into $TMPDIR/nitro-ui-native-tests-$$ - the $$ makes it per-process',
  },
  {
    name: 'test:native:android',
    needs: [],
    group: null,
    writes: ['android/build', 'example/android/build'],
    reads: [FINDINGS.generatedDir],
    note: 'gradle :react-native-nitro-ui:testDebugUnitTest - JVM only, so no emulator and no CMake task runs; reads nitrogen/generated/android through the library autolinking, writes android/build (the library module - 215 MB of intermediates and test results) plus example/android/build and the ~/.gradle cache; skips with a reason when neither ANDROID_HOME nor example/android/local.properties exists, and skips in CI unless NITRO_UI_ANDROID_JVM_TESTS=1 says this job owns the run',
  },
  {
    name: 'perf:renders',
    needs: [],
    group: 'jest',
    writes: [FINDINGS.jestCache, '.reassure'],
    reads: [FINDINGS.generatedDir],
    note: 'reassure measure -> jest (--runInBand), writes .reassure/current.perf; its crawl walks nitrogen/',
  },
  {
    name: 'nitrogen:check',
    needs: [],
    group: null,
    writes: ['tmp:nitrogen-check'],
    reads: [FINDINGS.generatedDir],
    note: 'regenerates into mkdtemp and diffs against the committed nitrogen/generated',
  },
  {
    name: 'registry:check',
    needs: [],
    group: null,
    writes: [],
    reads: [],
    note: '--check writes nothing; it reads the manifests and the generated regions, never nitrogen/generated',
  },
  {
    name: 'autolinking:check',
    needs: [],
    group: null,
    writes: [],
    reads: [],
    note: 'regex/RN-CLI detection over android/ sources only',
  },
  {
    name: 'prepare',
    needs: [
      'lock:check',
      'nitrogen:check',
      'test',
      'perf:renders',
      'test:native:android',
      // These two ignore only `nitrogen/generated`, so they read the rest of
      // `nitrogen/`, which this step deletes.
      'lint',
      'format',
    ],
    group: null,
    writes: [FINDINGS.nitrogenDir, FINDINGS.generatedDir, FINDINGS.lib],
    reads: [],
    note: "bob build: deletes and regenerates nitrogen/, then writes lib/. lock:check is a need to keep the old chain's intent (a stale lock costs a string compare, not a build); the other needs read nitrogen/, which this step deletes - lint and format included, because they only ignore nitrogen/generated",
  },
  {
    name: 'api-extractor:check',
    needs: ['prepare'],
    group: null,
    writes: ['.turbo/api-extractor-temp'],
    reads: [FINDINGS.lib],
    note: 'reads lib/typescript/src/index.d.ts and compares etc/react-native-nitro-ui.api.md',
  },
  {
    name: 'publint',
    needs: ['prepare'],
    group: null,
    writes: [],
    reads: [FINDINGS.lib],
    note: 'validates the publish surface, so lib/ has to exist',
  },
  {
    name: 'manifest:check',
    needs: ['prepare'],
    group: null,
    writes: [],
    reads: [FINDINGS.lib, FINDINGS.nitrogenDir],
    note: 'npm pack --dry-run --ignore-scripts: lists the tarball without rebuilding or writing it; the list contains nitrogen/, so it is a reader of the region prepare rewrites',
  },
  {
    name: 'readme:check',
    needs: [],
    group: null,
    writes: [],
    reads: [],
    note: 'compares README.md with example/src/readme-examples.tsx',
  },
]);

export function commandForStep(step) {
  return ['bun', 'run', step.name];
}

/**
 * How many steps may run at once: half the cores, capped at `MAX_DEFAULT_JOBS`,
 * because the heavy steps (Jest, tsc, oxlint) already fan out across cores.
 *
 * @param {number} parallelism `os.availableParallelism()` or `os.cpus().length`
 * @returns {number}
 */
export function defaultJobsFrom(parallelism) {
  if (typeof parallelism !== 'number' || !Number.isFinite(parallelism))
    return 1;
  if (parallelism < 2) return 1;
  return Math.max(2, Math.min(MAX_DEFAULT_JOBS, Math.floor(parallelism / 2)));
}

export const MAX_DEFAULT_JOBS = 4;

/** Hard cap on `--jobs`, so a typo (`--jobs 400`) cannot fork-bomb a machine. */
export const MAX_JOBS = 16;

/**
 * What is wrong with a step list, if anything: duplicate names, a `needs` that
 * names a step that does not exist or comes later, a `group` on no step, or a
 * bad `jobs`. Forward-only `needs` makes a cycle unrepresentable, so the
 * scheduler cannot deadlock on one.
 *
 * @param {object[]} steps
 * @returns {string[]} human-readable problems, empty when the list is usable
 */
export function validateCheckSteps(steps = CHECK_STEPS) {
  const problems = [];
  const seen = new Set();
  steps.forEach((step, index) => {
    const name = typeof step?.name === 'string' ? step.name : null;
    if (name == null || name === '') {
      problems.push(`step ${String(index)} has no name`);
      return;
    }
    if (seen.has(name)) {
      problems.push(`${name}: declared twice`);
      return;
    }
    seen.add(name);
    for (const need of step.needs ?? []) {
      if (!seen.has(need)) {
        const declaredLater = steps.some((other) => other?.name === need);
        problems.push(
          declaredLater
            ? `${name}: needs ${need}, which is declared later (needs may only point back at an earlier step)`
            : `${name}: needs ${need}, which is not a step`
        );
      }
    }
  });
  return problems;
}

/**
 * The transitive closure of `needs` for one step.
 * @param {object} step
 * @param {Map<string, object>} byName
 * @returns {Set<string>}
 */
function ancestorsOf(step, byName) {
  const found = new Set();
  const queue = [...(step.needs ?? [])];
  while (queue.length > 0) {
    const name = queue.pop();
    if (found.has(name)) continue;
    found.add(name);
    const other = byName.get(name);
    if (other != null) queue.push(...(other.needs ?? []));
  }
  return found;
}

/**
 * Pairs of steps that touch the same region with at least one writer, and that
 * neither a `needs` edge nor a shared `group` separates.
 *
 * @param {object[]} steps
 * @returns {Array<{a: string, b: string, region: string, kind: string}>}
 */
export function findOutputConflicts(steps = CHECK_STEPS) {
  const byName = new Map(steps.map((step) => [step.name, step]));
  const closures = new Map(
    steps.map((step) => [step.name, ancestorsOf(step, byName)])
  );
  const conflicts = [];
  for (let i = 0; i < steps.length; i += 1) {
    for (let j = i + 1; j < steps.length; j += 1) {
      const a = steps[i];
      const b = steps[j];
      if (a.group != null && a.group === b.group) continue;
      const aNeedsB = closures.get(a.name)?.has(b.name) === true;
      const bNeedsA = closures.get(b.name)?.has(a.name) === true;
      if (aNeedsB || bNeedsA) continue;
      const writesA = new Set(a.writes ?? []);
      const writesB = new Set(b.writes ?? []);
      const readsA = new Set(a.reads ?? []);
      const readsB = new Set(b.reads ?? []);
      for (const region of writesA) {
        if (readsB.has(region))
          conflicts.push({
            a: a.name,
            b: b.name,
            region,
            kind: `${a.name} writes ${region} while ${b.name} reads it`,
          });
        if (writesB.has(region))
          conflicts.push({
            a: a.name,
            b: b.name,
            region,
            kind: `${a.name} and ${b.name} both write ${region}`,
          });
      }
      for (const region of writesB) {
        if (readsA.has(region))
          conflicts.push({
            a: b.name,
            b: a.name,
            region,
            kind: `${b.name} writes ${region} while ${a.name} reads it`,
          });
      }
    }
  }
  return conflicts;
}

/**
 * Parse `--jobs N` / `--jobs=N` out of an argument list.
 *
 * @param {string[]} argv
 * @returns {{jobs: number | null, problems: string[]}}
 */
export function parseJobsArgument(argv = []) {
  let jobs = null;
  const problems = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let raw = null;
    if (argument === '--jobs') {
      raw = argv[index + 1] ?? null;
      if (raw == null) {
        problems.push('--jobs needs a value: --jobs N');
        continue;
      }
      index += 1;
    } else if (argument.startsWith('--jobs=')) {
      raw = argument.slice('--jobs='.length);
    }
    if (raw == null) continue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_JOBS) {
      problems.push(
        `--jobs needs a whole number from 1 to ${String(MAX_JOBS)} (got ${JSON.stringify(raw)})`
      );
      continue;
    }
    if (jobs != null) problems.push('--jobs given twice');
    jobs = parsed;
  }
  return { jobs, problems };
}

/**
 * The unknown arguments a check run was started with, excluding `--jobs` and its
 * value. The runner refuses them rather than passing them on to every step.
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
export function unknownCheckArguments(argv = []) {
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--jobs') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--jobs=')) continue;
    unknown.push(argument);
  }
  return unknown;
}

/**
 * Every guard the runner refuses to run without.
 *
 * @param {object[]} steps
 * @returns {string[]} problems; empty means the run may start
 */
export function planProblems(steps = CHECK_STEPS) {
  const problems = validateCheckSteps(steps).map(
    (problem) => `step list: ${problem}`
  );
  for (const conflict of findOutputConflicts(steps)) {
    problems.push(
      `shared output: ${conflict.kind} - add a needs edge or a shared group`
    );
  }
  return problems;
}

/**
 * Run the graph.
 *
 * `run(step)` does the work and must resolve with `{ok, log, exitCode, signal}`.
 *
 *   - **no interleaving**: a step's log arrives in one `flush` event, and flushes
 *     go out in declaration order, so the log reads like a serial run's. The
 *     per-step summary line goes out live, when the step ends.
 *   - **fail fast**: the first failure stops new starts; running steps finish, and
 *     everything unstarted is reported as skipped. With `haltOnFailure: false`
 *     steps that do not depend on a failed one still start.
 *   - **groups**: at most one member of a group runs at a time.
 *
 * @param {object} options
 * @param {object[]} [options.steps]
 * @param {number} options.jobs how many steps may run at once
 * @param {(step: object) => Promise<{ok: boolean, log?: string, exitCode?: number | null, signal?: string | null, error?: string}>} options.run
 * @param {(event: object) => void} [options.onEvent] `start`, `done`, `flush`, `skip`
 * @param {() => number} [options.now]
 * @param {boolean} [options.haltOnFailure] stop starting anything after the first
 *   failure (default true)
 * @returns {Promise<{ok: boolean, jobs: number, wallMs: number, results: object[], failures: string[]}>}
 */
export async function runCheckPlan({
  steps = CHECK_STEPS,
  jobs,
  run,
  onEvent = () => {},
  now = () => Date.now(),
  haltOnFailure = true,
}) {
  const problems = validateCheckSteps(steps);
  if (problems.length > 0) {
    throw new Error(
      `the check step list is not usable:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    );
  }
  if (typeof run !== 'function') throw new Error('runCheckPlan needs a run()');
  const slots = Math.max(1, Math.floor(Number(jobs) || 1));

  const records = steps.map((step) => ({
    step,
    phase: 'pending', // pending -> running -> complete
    result: null,
    startedAt: null,
  }));
  const byName = new Map(records.map((record) => [record.step.name, record]));
  const groupsBusy = new Map();
  let active = 0;
  let settled = 0;
  let flushCursor = 0;
  let halted = null;
  let pumping = false;
  let dirty = false;

  const summary = (startedPlan) => {
    const results = records.map((record) => ({
      name: record.step.name,
      needs: [...(record.step.needs ?? [])],
      group: record.step.group ?? null,
      status: record.result?.status ?? 'skipped',
      durationMs: record.result?.durationMs ?? 0,
      exitCode: record.result?.exitCode ?? null,
      signal: record.result?.signal ?? null,
      reason: record.result?.reason ?? null,
    }));
    return {
      ok: results.every((result) => result.status === 'pass'),
      jobs: slots,
      wallMs: now() - startedPlan,
      results,
      failures: results
        .filter((result) => result.status === 'fail')
        .map((result) => result.name),
    };
  };

  return await new Promise((resolve) => {
    const startedPlan = now();

    const flushReady = () => {
      while (flushCursor < records.length) {
        const record = records[flushCursor];
        if (record.phase !== 'complete') return;
        onEvent({
          type: 'flush',
          step: record.step,
          result: record.result,
          index: flushCursor,
          total: records.length,
        });
        flushCursor += 1;
      }
    };

    const finish = (record, result) => {
      record.phase = 'complete';
      record.result = { ...result, durationMs: now() - record.startedAt };
      settled += 1;
      active -= 1;
      if (
        record.step.group != null &&
        groupsBusy.get(record.step.group) === record.step.name
      ) {
        groupsBusy.delete(record.step.group);
      }
      onEvent({ type: 'done', step: record.step, result: record.result });
      if (result.status === 'fail' && halted == null && haltOnFailure) {
        halted = record.step.name;
      }
      pump();
    };

    const start = (record) => {
      record.phase = 'running';
      record.startedAt = now();
      active += 1;
      if (record.step.group != null)
        groupsBusy.set(record.step.group, record.step.name);
      onEvent({ type: 'start', step: record.step, jobs: slots });
      // `run` is called synchronously, so a caller that starts the plan can see
      // what is running without awaiting first.
      let started;
      try {
        started = Promise.resolve(run(record.step));
      } catch (error) {
        finish(record, {
          status: 'fail',
          log: String(error?.stack ?? error),
          exitCode: null,
          signal: null,
          error: String(error?.message ?? error),
          reason: `threw: ${String(error?.message ?? error)}`,
        });
        return;
      }
      started.then(
        (outcome) =>
          finish(record, {
            status: outcome?.ok === true ? 'pass' : 'fail',
            log: typeof outcome?.log === 'string' ? outcome.log : '',
            exitCode: outcome?.exitCode ?? null,
            signal: outcome?.signal ?? null,
            error: outcome?.error ?? null,
            reason:
              outcome?.ok === true
                ? null
                : (outcome?.error ??
                  `exit ${String(outcome?.exitCode ?? 'null')}${outcome?.signal == null ? '' : ` (signal ${outcome.signal})`}`),
          }),
        (error) =>
          finish(record, {
            status: 'fail',
            log: String(error?.stack ?? error),
            exitCode: null,
            signal: null,
            error: String(error?.message ?? error),
            reason: `threw: ${String(error?.message ?? error)}`,
          })
      );
    };

    const pumpInner = () => {
      for (const record of records) {
        if (record.phase !== 'pending') continue;
        if (halted != null) {
          record.phase = 'complete';
          record.result = {
            status: 'skipped',
            log: '',
            exitCode: null,
            signal: null,
            error: null,
            durationMs: 0,
            reason: `not started - ${halted} failed`,
          };
          settled += 1;
          onEvent({ type: 'skip', step: record.step, result: record.result });
          continue;
        }
        if (active >= slots) break;
        const step = record.step;
        if (step.group != null && groupsBusy.has(step.group)) continue;
        const needs = step.needs ?? [];
        const blocked = needs.filter(
          (need) => byName.get(need)?.phase !== 'complete'
        );
        if (blocked.length > 0) continue;
        // A step starts only when every need has passed. Only reachable with
        // `haltOnFailure: false`; otherwise the first failure halts the plan.
        const failedNeeds = needs.filter(
          (need) => byName.get(need)?.result?.status !== 'pass'
        );
        if (failedNeeds.length > 0) {
          record.phase = 'complete';
          record.result = {
            status: 'skipped',
            log: '',
            exitCode: null,
            signal: null,
            error: null,
            durationMs: 0,
            reason: `needs ${failedNeeds.join(', ')}, which did not pass`,
          };
          settled += 1;
          onEvent({ type: 'skip', step: record.step, result: record.result });
          continue;
        }
        start(record);
      }
      flushReady();
      if (settled === records.length) {
        flushReady();
        resolve(summary(startedPlan));
      }
    };

    /**
     * `start` is synchronous, so a step that throws on spawn calls `finish`, and
     * therefore `pump`, from inside the loop that is starting steps. `dirty` means
     * "something changed under the pass in progress, look again".
     */
    const pump = () => {
      if (pumping) {
        dirty = true;
        return;
      }
      pumping = true;
      do {
        dirty = false;
        pumpInner();
      } while (dirty);
      pumping = false;
    };

    pump();
  });
}
