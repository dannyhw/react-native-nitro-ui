/**
 * Where a committed baseline lives, and which machine may gate against it.
 *
 * A baseline is a measurement of *one* machine's simulator or emulator. The gate
 * divides by `rn-core` measured in the same run, which cancels drift *inside* that
 * machine and nothing beyond it (`docs/tasks/PROCESS-review-2026-10-26.md` SS5), so
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
      '        Baselines live at bench/baselines/<label>/<deviceKey>.json, and a run labels itself with NITRO_UI_MACHINE_LABEL - export NITRO_UI_MACHINE_LABEL=maintainer-mac-<n> in the shell that runs the bench (`node scripts/doctor.mjs` checks it) and measure again, so the results file says which machine produced it. See bench/baselines/README.md.'
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
  const problem = machineLabelProblem(machineLabel, { flag: 'baselinePath' });
  if (problem != null) {
    throw new Error(problem);
  }
  return path.join(baselinesDir, machineLabel, `${deviceKey}.json`);
}

/**
 * Why the file at this machine's own path is not this machine's baseline, or null.
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
