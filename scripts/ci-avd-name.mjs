#!/usr/bin/env node
/**
 * Prints the AVD name the harness will boot, for a CI step. It reads
 * `example/rn-harness.config.mjs` as text, because importing the config runs
 * its checks and a device lookup. `NITRO_UI_HARNESS_CONFIG` overrides the file.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

const DEFAULT_CONFIG = 'example/rn-harness.config.mjs';

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

// Same precedence as `avd()` in the config: `ANDROID_AVD`, then `AVD`, then the
// constant. An empty override falls through instead of printing an empty line.
const override = [process.env.ANDROID_AVD, process.env.AVD].find(
  (value) => typeof value === 'string' && value.trim() !== ''
);

process.stdout.write(`${override ?? match[1]}\n`);
