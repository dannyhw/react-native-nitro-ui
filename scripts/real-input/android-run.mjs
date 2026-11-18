/**
 * What one Android real-input run reads. Kept free of I/O so it is unit-tested without a
 * device; `android.mjs` does the installing and the running.
 *
 * A run with no arguments is a full run: every control, and the accessibility sweep over
 * every case. `--control` narrows the controls and leaves the sweep whole. `--a11y`
 * narrows the sweep to the cases it names and the cases of the controls named with it,
 * so `--a11y <case>` alone reads that case and runs nothing else. Every sweep case
 * carries the arguments that re-run it, so `gate.mjs --rerun-failed` can name it.
 */

import { REAL_INPUT_CONTROLS } from './controls.mjs';
import { A11Y_CONTROLS, a11yCaseControl } from './a11y.mjs';

export const A11Y_FLAG = '--a11y';

/**
 * @typedef {object} AndroidRunPlan
 * @property {boolean} full no filter was given
 * @property {ReadonlyArray<import('./controls.mjs').RealInputControl>} controls
 * @property {ReadonlyArray<import('./a11y.mjs').A11yControl>} a11yCases the sweep's
 *   cases, in table order
 * @property {boolean} a11yNamed `--a11y` was given, so the sweep reads only what the
 *   filters name
 */

/**
 * @param {ReadonlyArray<string>} argv the runner's arguments, without `--help`
 * @param {object} [tables] for the tests
 * @param {ReadonlyArray<import('./controls.mjs').RealInputControl>} [tables.controls]
 * @param {ReadonlyArray<import('./a11y.mjs').A11yControl>} [tables.cases]
 * @returns {AndroidRunPlan}
 */
export function androidRunPlan(
  argv,
  { controls = REAL_INPUT_CONTROLS, cases = A11Y_CONTROLS } = {}
) {
  /** @type {string[]} */
  const controlIds = [];
  /** @type {string[]} */
  const caseIds = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--control' && arg !== A11Y_FLAG) {
      throw new Error(`real-input: unknown argument "${arg}".`);
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(
        `real-input: ${arg} needs ${arg === A11Y_FLAG ? 'an a11y case' : 'a control'} id.`
      );
    }
    (arg === A11Y_FLAG ? caseIds : controlIds).push(value);
    index += 1;
  }

  const known = (table, ids, what) =>
    ids.map((id) => {
      const found = table.find((entry) => entry.id === id);
      if (found == null) {
        throw new Error(
          `real-input: unknown ${what} "${id}". Known: ` +
            `${table.map((entry) => entry.id).join(', ')}.`
        );
      }
      return found;
    });
  const full = argv.length === 0;
  const chosen = full
    ? [...controls]
    : [...new Set(known(controls, controlIds, 'control'))];
  known(cases, caseIds, 'a11y case');
  const a11yNamed = caseIds.length > 0;
  const named = new Set(chosen.map((control) => control.id));
  return {
    full,
    controls: chosen,
    a11yCases: a11yNamed
      ? cases.filter(
          (entry) =>
            caseIds.includes(entry.id) || named.has(a11yCaseControl(entry.id))
        )
      : [...cases],
    a11yNamed,
  };
}

/**
 * @returns {string}
 */
export function androidUsage() {
  return `Usage: bun run test:real-input:android [--control <id>]... [${A11Y_FLAG} <case>]...

With no arguments: every control and every a11y case.
  --control <id>   run this control's e2e file and tree check; the sweep stays whole
  ${A11Y_FLAG} <case>    read only this a11y case, and those of the controls named with it

Controls:   ${REAL_INPUT_CONTROLS.map((control) => control.id).join(', ')}
A11y cases: ${A11Y_CONTROLS.map((entry) => entry.id).join(', ')}`;
}
