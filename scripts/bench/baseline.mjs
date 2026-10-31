/**
 * Where a committed baseline lives, and which machine may gate against it.
 *
 * A baseline is a measurement of *one* machine's simulator or emulator. The gate
 * divides by `rn-core` measured in the same run, which cancels drift *inside* that
 * machine and nothing beyond it (`docs/tasks/PROCESS-review-2026-10-26.md` §5), so
 * the committed file is keyed by machine as well as by device class:
 *
 *   bench/baselines/<machine-label>/<deviceKey>.json
 *
 * Two machines that mint the same device class therefore write different files
 * instead of overwriting each other, and a machine gates only against its own
 * directory: there is no lookup that falls back to another machine's file, and none
 * to the pre-per-machine top-level path.
 *
 * The label is the run's own `machine.hostname` - written by the run, never re-read
 * from the environment afterwards - so `run.mjs` (a live run) and `report.mjs`
 * (re-reporting a results file) resolve the same file for the same run. It comes
 * from `NITRO_UI_MACHINE_LABEL`, never `os.hostname()` (D25: these files are
 * committed to a public repo), which is why an unset label is a refusal that names
 * the fix rather than a directory called `unlabelled`.
 *
 * No `import.meta` here, for the reason `format.mjs` documents: jest imports this,
 * so the path and every refusal are testable without a device.
 */

import fs from 'node:fs';
import path from 'node:path';

import { dependenciesSourceAt, resolvedDependencies } from './deps.mjs';
import { foundingDependencyRecord } from './lib.mjs';

/** What a run records when nobody told it which machine it ran on (D25). */
export const UNLABELLED_MACHINE = 'unlabelled';

/**
 * A machine label is one path segment and nothing else: lowercase letters, digits
 * and hyphens, starting with a letter or digit, at most 63 characters. That is
 * `maintainer-mac-1`, and it is also what stops a label from naming a directory
 * somewhere else (`..`, a slash, an absolute path).
 */
export const MACHINE_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * The label the environment assigns to this machine, as `collectMachine` will write
 * it into a run. The single source for that rule, so the `--update-baseline`
 * pre-flight refusal and the run itself cannot disagree about the label.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} the label, or `unlabelled` when the environment says nothing
 */
export function machineLabelFromEnv(env = process.env) {
  const label = env.NITRO_UI_MACHINE_LABEL?.trim();
  return label == null || label.length === 0 ? UNLABELLED_MACHINE : label;
}

/**
 * The machine a run was measured on, as that run recorded it.
 *
 * Deliberately not the environment read now: re-reporting last week's results file
 * has to resolve the directory that produced it, and a live run recorded the same
 * value from the same environment moments ago.
 *
 * @param {{ machine?: { hostname?: string | null } | null } | null} [run]
 * @returns {string | null} the label, or null when the run records none
 */
export function machineLabelOf(run) {
  const label = run?.machine?.hostname;
  return typeof label === 'string' && label.length > 0 ? label : null;
}

/**
 * Why this label cannot name a baseline directory, or null when it can.
 *
 * @param {string | null} label the run's `machine.hostname`
 * @param {{ flag: string }} options which flag is asking, so the message names the
 *   command that produced it
 * @returns {string | null} the refusal, naming the fix
 */
export function machineLabelProblem(label, { flag }) {
  if (label == null || label === UNLABELLED_MACHINE) {
    return (
      `${flag}: this run has no machine label, so there is no per-machine baseline to gate against.\n` +
      '        Baselines live at bench/baselines/<label>/<deviceKey>.json, and a run labels itself with NITRO_UI_MACHINE_LABEL - export NITRO_UI_MACHINE_LABEL=maintainer-mac-<n> in the shell that runs the bench, and measure again, so the results file says which machine produced it. See bench/baselines/README.md.'
    );
  }
  if (!MACHINE_LABEL_PATTERN.test(label)) {
    return (
      `${flag}: machine label "${label}" is not a single safe path segment (it has to match ${MACHINE_LABEL_PATTERN.source}: lowercase letters, digits and hyphens, starting with a letter or digit, at most 63 characters), so it cannot name a baseline directory.\n` +
      '        Set NITRO_UI_MACHINE_LABEL to a label of that shape, for example maintainer-mac-1, and measure again. See bench/baselines/README.md.'
    );
  }
  return null;
}

/**
 * The one path a run's baseline can live at.
 *
 * Throws rather than guessing when the label is unusable - the alternative would be
 * reading or writing another machine's file, or the old top-level path. Callers
 * refuse first with `machineLabelProblem()`; this is the guard behind them.
 *
 * @param {object} options
 * @param {string} options.baselinesDir the `bench/baselines` directory
 * @param {string} options.deviceKey e.g. `ios27-sim-iphone17`
 * @param {string | null} options.machineLabel the run's machine label
 * @returns {string} `<baselinesDir>/<machineLabel>/<deviceKey>.json`
 */
export function baselineFileFor({ baselinesDir, deviceKey, machineLabel }) {
  const problem = machineLabelProblem(machineLabel, {
    flag: 'baselineFileFor',
  });
  if (problem != null) {
    throw new Error(problem);
  }
  return path.join(baselinesDir, machineLabel, `${deviceKey}.json`);
}

/**
 * Why the flags in `argv` cannot work on the machine described by `env`, or null.
 *
 * The pre-flight `run.mjs` runs before it boots a device. A baseline is keyed by
 * machine, so a run that cannot name its machine has no directory to gate against
 * and none to write one to: discovering that at the end of a `--plan full` run
 * throws away three hours, which is the same reason R4 refuses a busy machine up
 * front. A plain run - no `--check`, no `--update-baseline` - compares nothing
 * against a committed file, so it needs no label and is not refused.
 *
 * `--force` does not bypass this, unlike the load and cleanliness guards: those are
 * judgements about measurement quality, and this is the absence of a path to write
 * to.
 *
 * @param {string[]} argv the runner's arguments
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null} the refusal, naming the fix
 */
export function labelPreFlightProblem(argv, env = process.env) {
  const minting = argv.includes('--update-baseline');
  if (!minting && !argv.includes('--check')) {
    return null;
  }
  return machineLabelProblem(machineLabelFromEnv(env), {
    flag: minting ? '--update-baseline' : '--check',
  });
}

/**
 * The file `--update-baseline` would write for this run, or the reason it cannot.
 *
 * Takes the run rather than a label, and reads nothing from the environment: the run
 * being minted decides its own directory, so a runner that recorded one machine and
 * then resolved against whatever the shell says now cannot land its baseline in
 * another machine's file. Both CLIs call this, which is what keeps `run.mjs` (a live
 * run) and `report.mjs` (a re-report) writing the same path for the same results.
 *
 * @param {object} options
 * @param {string} options.baselinesDir the `bench/baselines` directory
 * @param {any} options.run the run doing the minting
 * @returns {{ file: string | null, machineLabel: string | null, refusal: string | null }}
 */
export function mintBaselineFileFor({ baselinesDir, run }) {
  const machineLabel = machineLabelOf(run);
  const refusal = machineLabelProblem(machineLabel, {
    flag: '--update-baseline',
  });
  if (refusal != null) {
    return { file: null, machineLabel, refusal };
  }
  return {
    file: baselineFileFor({
      baselinesDir,
      deviceKey: run.deviceKey,
      machineLabel,
    }),
    machineLabel,
    refusal: null,
  };
}

/**
 * The file `--component <name> --update-baseline` would merge into, and whether it
 * may (X14).
 *
 * The merge question is a label question, a path question and a *contents*
 * question, and all three have to be answered before a device is touched — the
 * point of the feature is that adding a component costs one component's cells
 * rather than an eleven-hour window, so a refusal that arrives after the run is
 * worth nothing. The path comes from the run's own `machine.hostname` through the
 * one resolver, exactly as `--update-baseline` and `--check` resolve it: a merge
 * never targets another machine's file, and there is no old top-level path.
 *
 * Unlike `openBaselineForCheck()`, the schema question here is not a yes/no gate:
 * a v2 file is a complete ratio table, and `mergeBaselineProblems()` compares the
 * writing run's `BASELINE_SCHEMA_VERSION` against the file's recorded
 * `schemaVersion` field by field with the rest of the regime, so a v2 file can
 * take a merge and a pre-D9 v1 file cannot. It *does* run the provenance check
 * twice over: `isCompatibleBaseline()` rejects the pre-D9 shape, and a file that
 * records a different machine is refused, because a merge writes into this
 * machine's file and a copied table must not be extended.
 *
 * @param {{
 *   baselinesDir: string,
 *   run: any,
 *   component: string,
 *   readJson?: (file: string) => any,
 *   existsSync?: (file: string) => boolean,
 *   isCompatibleBaseline: (baseline: any) => boolean,
 *   schemaVersion?: number,
 *   mergeProblems: (input: any) => any, `mergeBaselineProblems()` from `lib.mjs`,
 *     injected for the same reason `openBaselineForCheck()` injects its predicate
 *   display?: (file: string) => string,
 *   resolved?: Record<string, {value: unknown, why: string} | null> |
 *     ((baseline: any) => Record<string, {value: unknown, why: string} | null>),
 *     what the caller can recover for fields the file does not record — for a
 *     pre-X14 file's app versions, `foundingDependencies()` reads `bun.lock` at the
 *     commit the file's own `sha` names. A function is passed the file once it has
 *     been read, so the recovery is always about *this* file.
 *   filters?: Record<string, unknown>, scheduled?: number, componentPlan?: number,
 *   allowDeferred?: boolean,
 *     the pre-flight's half of `mergeBaselineProblems`: the filters and schedule
 *     lengths only the command line knows, and permission to report a field the
 *     candidate cannot measure yet as deferred. The write-time call passes neither,
 *     which is what makes the second check the authoritative one.
 * }} options
 * @returns {{ file: string | null, display: string | null, baseline: any | null,
 *   machineLabel: string | null, problems: string[], unverified: Array, note: string | null,
 *   seeded: object, foundingDependencies: any,
 *   refusal: { kind: string, message: string } | null }}
 */
export function openBaselineForMerge({
  baselinesDir,
  run,
  component,
  readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
  existsSync = (file) => fs.existsSync(file),
  isCompatibleBaseline,
  schemaVersion,
  mergeProblems,
  display = (file) => file,
  resolved = {},
}) {
  const machineLabel = machineLabelOf(run);
  const labelProblem = machineLabelProblem(machineLabel, {
    flag: '--update-baseline',
  });
  if (labelProblem != null) {
    return mergeRefusal(null, null, null, 'unlabelled', labelProblem);
  }

  const file = baselineFileFor({
    baselinesDir,
    deviceKey: run.deviceKey,
    machineLabel,
  });
  const shown = display(file);
  if (!existsSync(file)) {
    return {
      ...mergeRefusal(
        file,
        shown,
        machineLabel,
        'missing',
        `--update-baseline --component ${String(component)}: no baseline at ${shown} for machine ${machineLabel}, so there is nothing to merge into.\n        The first mint for a machine is a full run: \`--plan full --launches 8 --update-baseline\` with no \`--component\` (bench/baselines/README.md).`
      ),
      file,
    };
  }

  const baseline = readJson(file);
  if (!isCompatibleBaseline(baseline)) {
    return {
      ...mergeRefusal(
        file,
        shown,
        machineLabel,
        'incompatible',
        `--update-baseline --component ${String(component)}: ${shown} is not a v${String(
          schemaVersion
        )} ratio baseline (found v${String(baseline?.schemaVersion)}).\n        The pre-D9 baseline gated on absolute rn-core drift and could never fire; re-record it with a full --update-baseline on a clean, quiet commit.`
      ),
      file,
    };
  }
  const provenance = baselineProvenanceProblem({
    machineLabel,
    baseline,
    display: shown,
  });
  if (provenance != null) {
    return mergeRefusal(
      file,
      shown,
      machineLabel,
      'foreign-machine',
      provenance.replace(/^--check:/, '--update-baseline:')
    );
  }

  const decided = mergeProblems({
    run,
    baseline,
    exists: true,
    component,
    resolved:
      typeof resolved === 'function' ? (resolved(baseline) ?? {}) : resolved,
  });
  return {
    file,
    display: shown,
    baseline,
    machineLabel,
    problems: decided.problems ?? [],
    unverified: decided.unverified ?? [],
    note: decided.note ?? null,
    seeded: decided.seeded ?? {},
    foundingDependencies: decided.foundingDependencies ?? null,
    refusal: null,
  };
}

function mergeRefusal(file, display, machineLabel, kind, message) {
  return {
    file,
    display,
    baseline: null,
    machineLabel,
    problems: [],
    unverified: [],
    note: null,
    seeded: {},
    foundingDependencies: null,
    refusal: { kind, message },
  };
}

/**
 * The versions a baseline file's founding run measured, recovered from git.
 *
 * The four committed baselines predate X14's `dependencies` block, so the file
 * itself cannot say which `@expo/ui` its cells were measured with — but its own
 * `sha` names a commit, and `bun.lock` is committed, so the answer is in history
 * rather than in an assumption (X14). `git` is injected and read-only (`git
 * show`): an invented version would be a comparison this guard then passes for no
 * reason, so an unreadable revision or lock comes back as nulls and the merge is
 * refused with the name of what could not be read.
 *
 * @param {{
 *   baseline: any,
 *   git?: ((args: string[]) => string | null) | null,
 * }} input
 * @returns {{ 'dependencies.reactNative'?: {value: string|null, why: string},
 *   'dependencies.expoUi'?: {value: string|null, why: string},
 *   dependencies: any, problems: string[] }}
 */
export function foundingDependencies({ baseline, git = null }) {
  const out = { dependencies: null, problems: [] };
  if (git == null) {
    return out;
  }
  if (baseline?.dependencies != null) {
    return out;
  }
  const sha = typeof baseline?.sha === 'string' ? baseline.sha : null;
  if (sha == null) {
    out.problems.push(
      'the baseline records no founding `sha`, so its app versions cannot be recovered from git'
    );
    return out;
  }
  const source = `bun.lock at the baseline's founding commit ${sha}`;
  const resolved = resolvedDependencies({
    ...dependenciesSourceAt({ git, rev: sha }),
    source,
  });
  for (const problem of resolved.problems ?? []) {
    out.problems.push(problem);
  }
  out.dependencies = foundingDependencyRecord({
    reactNative: resolved.reactNative,
    expoUi: resolved.expoUi,
    source,
  });
  out['dependencies.reactNative'] = {
    value: resolved.reactNative,
    why: source,
  };
  out['dependencies.expoUi'] = {
    value: resolved.expoUi,
    why: source,
  };
  return out;
}

/**
 * Whether a committed baseline was measured on the machine whose directory holds it.
 *
 * The directory *is* the lookup, so a file inside it that records another hostname
 * got here by `cp` or by a `git mv`. That file is still a plausible table of ratios,
 * which is what makes it dangerous: it gates green or red for reasons nobody
 * measured on this hardware.
 *
 * Only `--check` asks - `--update-baseline` writes this machine's own file, so there
 * is nothing to verify.
 *
 * @param {object} options
 * @param {string} options.machineLabel the run's label
 * @param {any} options.baseline what was read from that path
 * @param {string} options.display the path as the message should print it
 * @returns {string | null} the refusal, naming the fix
 */
export function baselineProvenanceProblem({ machineLabel, baseline, display }) {
  const recorded = machineLabelOf(baseline);
  if (recorded == null) {
    return (
      `--check: ${display} records no machine, so this run (${machineLabel}) cannot tell whose hardware these ratios came from.\n` +
      "        Mint this machine's own baseline here with --update-baseline: a committed baseline always says which machine measured it."
    );
  }
  if (recorded !== machineLabel) {
    return (
      `--check: ${display} sits in ${machineLabel}'s directory but records machine.hostname "${recorded}" - it was copied or moved here.\n` +
      "        A machine gates only against the baselines it measured itself: the ratio to rn-core cancels drift inside one machine, not between two. Use --compare <ref> for another machine's numbers, or mint this machine's own baseline with --update-baseline."
    );
  }
  return null;
}

/**
 * Open this machine's baseline for `--check`, with every refusal decided here so
 * `run.mjs` and `report.mjs` cannot drift (the same reason `comparisonSections()`
 * exists).
 *
 * The refusal carries a `kind` rather than an exit code: the two CLIs have always
 * exited differently for a missing baseline (`report.mjs` 1, `run.mjs` 2) and every
 * new refusal is a 2.
 *
 * @param {object} options
 * @param {string} options.baselinesDir the `bench/baselines` directory
 * @param {any} options.run the run being checked
 * @param {(file: string) => string} [options.display] how to print a path
 * @param {(file: string) => any} [options.readJson]
 * @param {(file: string) => boolean} [options.existsSync]
 * @param {(baseline: any) => boolean} options.isCompatibleBaseline from `lib.mjs`
 * @param {number} [options.schemaVersion]
 * @returns {{ file: string | null, display: string | null, baseline: any | null,
 *   machineLabel: string | null, refusal: { kind: string, message: string } | null }}
 */
export function openBaselineForCheck({
  baselinesDir,
  run,
  display = (file) => file,
  readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
  existsSync = (file) => fs.existsSync(file),
  isCompatibleBaseline,
  schemaVersion,
}) {
  const machineLabel = machineLabelOf(run);
  const labelProblem = machineLabelProblem(machineLabel, { flag: '--check' });
  if (labelProblem != null) {
    return {
      file: null,
      display: null,
      baseline: null,
      machineLabel,
      refusal: { kind: 'unlabelled', message: labelProblem },
    };
  }

  const file = baselineFileFor({
    baselinesDir,
    deviceKey: run.deviceKey,
    machineLabel,
  });
  const shown = display(file);
  if (!existsSync(file)) {
    return {
      file,
      display: shown,
      baseline: null,
      machineLabel,
      refusal: {
        kind: 'missing',
        message: `--check: no baseline at ${shown} for machine ${machineLabel}. Create it with --update-baseline - \`--plan full --launches 8\` on a clean tree and an idle machine (bench/baselines/README.md).`,
      },
    };
  }

  const baseline = readJson(file);
  if (!isCompatibleBaseline(baseline)) {
    return {
      file,
      display: shown,
      baseline: null,
      machineLabel,
      refusal: {
        kind: 'incompatible',
        message: `--check: ${shown} is not a v${String(schemaVersion)} ratio baseline (found v${String(baseline?.schemaVersion)}).\n        The pre-D9 baseline gated on absolute rn-core drift and could never fire; re-record it with --update-baseline on a clean, quiet commit.`,
      },
    };
  }

  const provenance = baselineProvenanceProblem({
    machineLabel,
    baseline,
    display: shown,
  });
  if (provenance != null) {
    return {
      file,
      display: shown,
      baseline: null,
      machineLabel,
      refusal: { kind: 'foreign-machine', message: provenance },
    };
  }

  return { file, display: shown, baseline, machineLabel, refusal: null };
}
