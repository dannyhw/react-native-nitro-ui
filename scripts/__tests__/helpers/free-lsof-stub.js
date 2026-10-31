/**
 * An `lsof` that says "nobody is listening", for suites that are not about ports.
 *
 * Why a suite needs to say this at all: `lease.mjs acquire` asks the kernel whether a
 * pair's Metro port is served (X15 item 1), and a test that inherits the real `lsof`
 * inherits whatever another task happens to be running. That is not hypothetical - a
 * second worktree's harness holds pair-a's Metro for the length of its own run, and every
 * `acquire` in `lease.test.js` and `lease-pool-cli.test.js` then refuses with "Metro port
 * 8295 is served by pid …", for suites that never mention a port. A test whose result
 * depends on what another task is doing is not flaky, it is wrong.
 *
 * The stub gives the *realistic* answer rather than the missing-tool one on purpose: exit
 * 1 with no output is what `lsof` prints for a free port, so a suite exercises the guard's
 * normal path instead of its fail-open branch. Suites that test the guard itself write
 * their own stub and replay a busy port (`lease-metro-port.test.js`).
 *
 * The file is written once per suite module, in the machine's temp directory rather than
 * the repo: a helper that wrote into the checkout would leave a green run with a dirty
 * `git status`, which is the thing the gate ledger checks for.
 */

import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nitro-ui-free-lsof-'));
const bin = join(dir, 'lsof');
writeFileSync(
  bin,
  ['#!/bin/sh', '# Nothing is listening on any port, ever.', 'exit 1', ''].join(
    '\n'
  )
);
chmodSync(bin, 0o755);

/** Spread into a CLI child's env: `{ ...process.env, ...FREE_LSOF }`. */
export const FREE_LSOF = { NITRO_UI_LSOF_BIN: bin };
