#!/usr/bin/env node
/**
 * The AVD name the harness will boot, printed for a CI step that cannot import
 * the config it comes from.
 *
 * `example/rn-harness.config.mjs` is the single source, but loading it runs the
 * Node-version check, the `app.stamp` gate and a simulator/AVD lookup — all of
 * which are exactly what a preflight step is trying to find out about. So this
 * reads the file as text and takes the one literal, and prints nothing but the
 * name so a workflow can `$(…)` it.
 *
 * Fails loudly rather than printing empty: the step that reads this is the one
 * that reports what a job is about to boot, and an empty name there would show
 * up as "no such AVD directory" two lines later. The previous shape of this was
 * a shell one-liner whose helper took file *contents* where it took a path, and
 * it died of `ENAMETOOLONG` — see `scripts/__tests__/ci-workflows.test.js`, which
 * runs the workflow's own line rather than reading it.
 *
 * `NITRO_UI_HARNESS_CONFIG` overrides the file, for that test.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

const DEFAULT_CONFIG = 'example/rn-harness.config.mjs';

/** The declaration this reads, kept as a pattern so the script cannot drift silently. */
const DECLARATION = /const DEFAULT_AVD = '([^']+)'/u;

const file = process.env.NITRO_UI_HARNESS_CONFIG || DEFAULT_CONFIG;

let text;
try {
  text = readFileSync(file, 'utf8');
} catch (error) {
  console.error(
    `avd-name: cannot read ${file}: ${String(error?.message ?? error)}`
  );
  process.exit(1);
}

const match = DECLARATION.exec(text);
if (match == null) {
  console.error(
    `avd-name: ${file} has no \`const DEFAULT_AVD = '<name>'\`. The harness \`avd()\` ` +
      'helper reads that constant, so this script and it would disagree about what ' +
      'to print rather than about what to boot.'
  );
  process.exit(1);
}

process.stdout.write(`${match[1]}\n`);
