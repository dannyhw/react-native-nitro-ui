/**
 * The `check` chain as data, and the scheduler `scripts/check.mjs` runs it with.
 *
 * Why (X10): `check` was one long `&&` chain in `package.json`, so every step paid
 * for the one before it whether or not they were related - and a round that
 * touched a doc comment still ran all sixteen. X15 added a seventeenth
 * (`test:native:android`); the steps are the same, in the same
 * order, but expressed here as a dependency graph so independent ones can overlap.
 *
 * Two rules keep this honest:
 *
 *   1. **The step list is the chain.** `serialChainFromSteps(CHECK_STEPS)` must
 *      equal `package.json`'s `scripts["check:serial"]` byte for byte, and
 *      `scripts/__tests__/check-runner.test.js` asserts it. Adding a step to one
 *      side and not the other fails a unit test, which is the only way a
 *      "same steps, faster" claim stays true.
 *   2. **Shared outputs are ordered, not hoped about.** Each step declares the
 *      regions it `writes` and the ones it `reads` (see `FINDINGS` below), and
 *      `findOutputConflicts` returns any pair that neither a `needs` edge nor a
 *      shared `group` separates. That is a structural check, so a new step that
 *      writes into `lib/` without ordering itself after `prepare` is caught here
 *      rather than as a flaky gate three tasks from now.
 *
 * No `import.meta` and no `node:os` here, so `scripts/__tests__/check-runner.test.js`
 * can import it (same reason `gate-core.mjs` exists next to `gate.mjs`).
 */

/**
 * What each step actually touches, as found by reading the scripts rather than by
 * guessing (X10 brief, "find them and serialise them, and say which"):
 *
 * - `prepare` (`bob build`) is the only writer of consequence. Its target list
 *   (`package.json` -> `react-native-builder-bob.targets`) starts with a `custom`
 *   target whose `clean` is `nitrogen/`, so bob **deletes `nitrogen/` and
 *   regenerates it** before it writes `lib/`. Three steps read that directory:
 *   `nitrogen:check` (the whole point of it), `test`
 *   (`src/__tests__/viewConfigs.test.ts` reads
 *   `nitrogen/generated/shared/json/*Config.json`) and `perf:renders` (Jest's
 *   haste-map crawl walks `nitrogen/`). So `prepare` runs *after* all three -
 *   which is also what keeps `nitrogen:check` meaningful: after `prepare` has
 *   regenerated the tree, the drift check could no longer fail.
 * - `lib/` is written by `prepare` and read by `api-extractor:check`
 *   (`lib/typescript/src/index.d.ts`), `publint` (the publish surface) and
 *   `manifest:check` (`npm pack --dry-run --ignore-scripts` lists it;
 *   `--ignore-scripts` is why it does not rebuild, and `--dry-run` why it writes
 *   no tarball). `typecheck` excludes `lib`, and ESLint and Prettier ignore it,
 *   so they are not readers.
 * - **Jest's cache directory is shared by `test` and `perf:renders`.** Reassure
 *   spawns Jest with `--runInBand --testMatch=…` and no `--config`, so both runs
 *   get the same `id` (`jest-config` hashes `rootDir` + config path + project
 *   index) and the same `roots`; `jest-haste-map`'s cache path is `id` + a hash
 *   of those, so they resolve to *one* file - written with a plain
 *   `writeFileSync`, no lock, no temp-and-rename. A torn read is caught and
 *   costs a re-crawl rather than a wrong answer, which is exactly the kind of
 *   race that reads as a flaky gate. The two steps share the `jest` group, so
 *   they never overlap.
 * - `test:native` builds into `$TMPDIR/nitro-ui-native-tests-$$` (per-process, so
 *   it cannot collide) and `nitrogen:check` into `mkdtemp`; each declares its own
 *   region and nobody reads them.
 * - `api-extractor:check` writes `.turbo/api-extractor-temp/` (its report temp
 *   folder, per `etc/api-extractor.json`). Nothing in the chain reads `.turbo`
 *   (`ESLint` and Prettier both ignore it), so it needs no ordering.
 * - **`nitrogen/` itself, not just `nitrogen/generated`, is shared** (X10 review
 *   N5). ESLint and Prettier ignore only `nitrogen/generated`, so `lint` and
 *   `format` walk the rest of that directory too, and `manifest:check`'s pack list
 *   contains `nitrogen/`; all three now declare `reads: nitrogen` and `prepare`
 *   declares writing it. Today the extra region holds nothing checked in (`nitrogen/`
 *   is only `generated/` plus whatever a run leaves behind), so this is a declaration
 *   about a directory that can gain files, not a bug being patched: a dropped `needs`
 *   edge shows up in `findOutputConflicts` rather than in a build that intermittently
 *   formats a half-deleted tree. `prepare` therefore waits on `lint` and `format` as
 *   well as on the `generated/` readers, which costs no wall time - it already waits
 *   behind the ~140 s `test` - and turns "the order happened to work" into the thing
 *   the guard checks. Do not shorten `prepare`'s wait on the assumption that the
 *   ordering is a race: the declaration is what keeps it checked.
 */
export const FINDINGS = Object.freeze({
  generatedDir: 'nitrogen/generated',
  /** Everything under `nitrogen/` that is not the generated tree (specs, config). */
  nitrogenDir: 'nitrogen',
  lib: 'lib',
  jestCache: 'jest-cache',
});

/**
 * The steps of `check`, in the order the old `&&` chain ran them.
 *
 * `needs` is a hard order (the earlier step must have passed), `group` means "never
 * at the same time as another member". `writes`/`reads` are the regions from
 * `FINDINGS`; `findOutputConflicts` is what enforces them.
 *
 * Order is load-bearing for one test, not for correctness: the step names must stay
 * equal to `check:serial`'s, so the declaration order *is* the serial chain's.
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
    note: 'eslint over **/*.{js,mjs,ts,tsx}; ignores lib/ and nitrogen/generated/ but not the rest of nitrogen/',
  },
  {
    name: 'format',
    needs: [],
    group: null,
    writes: [],
    reads: [FINDINGS.nitrogenDir],
    note: 'prettier --check .; .prettierignore covers lib, nitrogen/generated, .turbo, and prettier 3 also reads .gitignore - but not nitrogen/ as a whole',
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
    // X15 item 2: the Kotlin twin of the event-count handshake (`MenuModelTest`,
    // `PickerModelTest`, …) lives in `android/src/test` and ran only by hand, because
    // neither `check` nor CI invoked it (FOLLOWUPS, G7a round 2). A JVM unit test is
    // exactly what `check` is for, and it is cheap on this machine: 1.9 s with
    // everything up to date, 1.2 s after touching a Kotlin file, 11.5 s with
    // `--rerun-tasks`, and 37 s on a first run that has to store its configuration
    // cache. Under the brief's ~60 s bar even at the worst of those. It skips with its
    // reason printed when the machine has no Android SDK, the way `test:native` skips
    // on Linux, and the no-CMake claim is measured rather than assumed: 42 tasks with
    // no `*CMake*` among them.
    name: 'test:native:android',
    needs: [],
    group: null,
    writes: ['example/android/build'],
    // The generated tree, because the library's own build reads it: `android/build.gradle`
    // applies `nitrogen/generated/android/nitroui+autolinking.gradle`, which adds
    // `nitrogen/generated/android/kotlin` to the Kotlin source set. `prepare` deletes
    // that directory, so it waits on this step - the same edge `test` and
    // `nitrogen:check` have, for the same reason.
    reads: [FINDINGS.generatedDir],
    note: 'gradle :react-native-nitro-ui:testDebugUnitTest - JVM only, so no emulator and no CMake task runs; reads nitrogen/generated/android through the library autolinking, writes example/android/build and the ~/.gradle cache; skips with a reason when neither ANDROID_HOME nor example/android/local.properties exists',
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
      // X15 item 2: the Android JVM test compiles the library, and the library's
      // autolinking adds `nitrogen/generated/android/kotlin` to its source set - so
      // this is a reader of the directory this step deletes, like the three above.
      'test:native:android',
      // X10 review N5: these two read `nitrogen/` (they ignore only `nitrogen/generated`), and this
      // step deletes the directory. Before the region was declared the safety came from `prepare`
      // happening to queue behind the ~140 s `test`; a `needs` edge is the same order, and it is the
      // kind that a change to the graph cannot quietly break.
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

/** The command each step runs, spelled the way `package.json`'s chain spelled it. */
export function commandForStep(step) {
  return ['bun', 'run', step.name];
}

/**
 * The serial chain this graph stands in for - i.e. the old `check` script.
 *
 * `check:serial` in `package.json` is this string, kept literal rather than
 * generated at run time so `bun run check:serial` works with no tooling and a
 * person can read the chain. The equality test is what binds the two.
 */
export function serialChainFromSteps(steps = CHECK_STEPS) {
  return steps.map((step) => commandForStep(step).join(' ')).join(' && ');
}

/**
 * The step names a `&&` chain of `bun run <name>` calls runs, in order.
 *
 * Parsing rather than eyeballing, so `check:serial`'s real content is what the
 * equality test compares. Anything in the chain that is *not* a plain
 * `bun run <name>` is returned as a problem rather than skipped: a step that
 * takes an argument (`bun run perf:renders -- --update-baseline`) is exactly the
 * kind of change the runner would have to know about, and quietly dropping it
 * would let the two lists agree while the work differed.
 *
 * @param {string} chain
 * @returns {{names: string[], problems: string[]}}
 */
export function stepsFromSerialChain(chain) {
  const names = [];
  const problems = [];
  for (const raw of String(chain ?? '').split('&&')) {
    const part = raw.trim();
    if (part === '') {
      problems.push('an empty `&&` section');
      continue;
    }
    const match = /^bun run ([A-Za-z0-9:._-]+)$/.exec(part);
    if (match == null) {
      problems.push(`not a plain "bun run <script>": ${JSON.stringify(part)}`);
      continue;
    }
    names.push(match[1]);
  }
  return { names, problems };
}

/**
 * How many steps may run at once, from the machine's core count.
 *
 * Why half the cores, capped at 4: the heavy steps already fan out internally -
 * Jest uses `maxWorkers` = cores-1, and `tsc`, ESLint, Reassure and nitrogen each
 * run their own multi-process work. The runner's parallelism only has to hide the
 * *tails* around the long pole (`test` measured 139.6 s of a 171.7 s chain on a
 * 10-core box, so nothing else can be the critical path), and stacking five
 * internally-parallel processes on ten cores trades that for context-switching
 * and a slower Jest. Half the cores reaches 4 by 8 cores and stops there, which
 * also leaves a core for the parent, the ledger's load sampler, and whatever else
 * shares the machine (device tasks run in parallel on the same box). `--jobs N`
 * overrides it, because the box that knows better should say so.
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

/** @see defaultJobsFrom - the ceiling, not a licence to run more. */
export const MAX_DEFAULT_JOBS = 4;

/** Hard cap on `--jobs`, so a typo (`--jobs 400`) cannot fork-bomb a machine. */
export const MAX_JOBS = 16;

/**
 * What is wrong with a step list, if anything: duplicate names, a `needs` that
 * names a step that does not exist or comes later (which would be a cycle the
 * scheduler would wait on forever), a `group` on no step, or a bad `jobs`.
 *
 * Forward-only `needs` is the cheap way to make cycles unrepresentable: the graph
 * can only ever point back at an earlier step, so `pump` cannot deadlock on one,
 * and the ordering rules stay readable top-to-bottom.
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
 * The transitive closure of `needs` for one step, for the conflict check.
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
 * This is the guard behind "steps that write to shared outputs must not race". It
 * reads the declared regions, so the claim is checkable rather than a comment:
 * drop `prepare`'s `needs` and `test`/`nitrogen:check` show up here, because bob
 * deletes `nitrogen/` while they are reading it.
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
 * value. An argument the runner does not know is refused rather than passed on to
 * every step: `bun run check -- --update-baseline` would otherwise hand a Reassure
 * flag to every step in the chain, and most of them would ignore it.
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
 * Every guard the runner refuses to run without, as one pure function so the unit
 * test can hand it a broken step list and see the refusal (it lives here rather
 * than in `check.mjs` for the same reason the rest of the logic does: jest cannot
 * import a file that uses `import.meta`).
 *
 * The graph is only trustworthy while it *is* the chain, so the runner checks that
 * against `check:serial` before spawning anything: a step added to the chain and
 * not to the graph would otherwise mean `check` proved less than CI and every
 * report say it did, silently, from the day it was merged.
 *
 * @param {object[]} steps
 * @param {string} serialChain `package.json`'s `scripts["check:serial"]`
 * @returns {string[]} problems; empty means the run may start
 */
export function planProblems(steps = CHECK_STEPS, serialChain = '') {
  const problems = validateCheckSteps(steps).map(
    (problem) => `step list: ${problem}`
  );
  for (const conflict of findOutputConflicts(steps)) {
    problems.push(
      `shared output: ${conflict.kind} - add a needs edge or a shared group`
    );
  }
  const parsed = stepsFromSerialChain(serialChain);
  const declared = steps.map((step) => step.name);
  for (const problem of parsed.problems) {
    problems.push(`check:serial: ${problem}`);
  }
  if (
    parsed.problems.length === 0 &&
    parsed.names.join('\n') !== declared.join('\n')
  ) {
    problems.push(
      `the chain and the graph are different steps:\n` +
        `    check:serial runs ${parsed.names.join(', ')}\n` +
        `    the graph runs    ${declared.join(', ')}`
    );
  }
  return problems;
}

/**
 * Run the graph.
 *
 * `run(step)` does the work and must resolve with `{ok, log, exitCode, signal}` -
 * a spawned process in `check.mjs`, a fake in the tests. The engine owns the three
 * things that are easy to get wrong and hard to see:
 *
 *   - **no interleaving**: a step's log arrives in one `flush` event, and flushes
 *     go out in declaration order as they become available. A log's document order
 *     is therefore the same as the serial chain's, which is what lets the ledger
 *     quote the *unit-test* summary rather than whichever Jest finished first
 *     (X2's M3). The per-step summary line goes out live, at the moment the step
 *     ends, so a long first step does not look like a hang.
 *   - **fail fast**: the first failure stops new starts; running steps finish so
 *     their logs are still evidence, and everything unstarted is reported as
 *     skipped rather than silently missing. `runCheckPlan` also takes
 *     `haltOnFailure: false`, which keeps starting steps that do not depend on the
 *     failed one while still never starting one whose `needs` did not pass. The CLI
 *     does not expose it - `bun run check` halts, because that is the gate's
 *     contract - but the scheduler has to be able to say what a `needs` edge means
 *     when halting is not what saves it, so the rule is reachable and tested rather
 *     than dead code with a claim on it (X10 review N3).
 *   - **groups**: at most one member of a group runs at a time, so `test` and
 *     `perf:renders` cannot both write Jest's haste-map cache.
 *
 * @param {object} options
 * @param {object[]} [options.steps]
 * @param {number} options.jobs how many steps may run at once
 * @param {(step: object) => Promise<{ok: boolean, log?: string, exitCode?: number | null, signal?: string | null, error?: string}>} options.run
 * @param {(event: object) => void} [options.onEvent] `start`, `done`, `flush`, `skip`
 * @param {() => number} [options.now]
 * @param {boolean} [options.haltOnFailure] stop starting anything after the first
 *   failure (default true, which is what `scripts/check.mjs` runs with)
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
  // Re-entrancy guard for `pump` (see the comment where it is used).
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
      // `run` is called *synchronously* - a spawn is synchronous, and deferring it
      // a microtask means a caller that starts the plan and looks at what is
      // running has to await first. Everything the step does still lands through
      // the promise handlers below.
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
        // A step starts only when every need has *passed*. With the default
        // fail-fast this branch is defence - `finish` halts the plan on any failure,
        // so nothing is left to start - but `haltOnFailure: false` reaches it for
        // real, and that is the mode where it matters: keep going to collect every
        // failure, while a step that depends on a broken one still never runs.
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
     * `start` is synchronous, so a step that throws on spawn calls `finish` - and
     * therefore `pump` - from inside the loop that is starting steps. Without this
     * guard the outer loop keeps going with state the inner pass already consumed,
     * and a step can be started twice. `dirty` means "something changed under the
     * pass in progress, look again".
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
