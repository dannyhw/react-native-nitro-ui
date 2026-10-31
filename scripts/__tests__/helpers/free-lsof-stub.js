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
 * It lives in the machine's temp directory rather than the repo: a helper that wrote into the
 * checkout would leave a green run with a dirty `git status`, which is the thing the gate
 * ledger checks for. The directory is a fixed name, not `mkdtemp`, because this module is
 * evaluated once per jest worker and each evaluation would otherwise leave another directory
 * behind - a run of this suite used to litter the temp directory with a dozen near-identical
 * ones that nothing ever removed. Deleting on teardown is not an option either: the workers
 * finish at different times and share the path, so one worker's cleanup would take the stub
 * out from under another's `acquire`. Same path plus same contents means the write is
 * idempotent, so there is exactly one of these per machine and it costs nothing to reuse.
 */

import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = join(tmpdir(), 'nitro-ui-free-lsof');
const bin = join(dir, 'lsof');
const contents = [
  '#!/bin/sh',
  '# Nothing is listening on any port, ever.',
  'exit 1',
  '',
].join('\n');
mkdirSync(dir, { recursive: true });
// Rewriting unconditionally would truncate the file a sibling worker is executing through,
// which is an `ETXTBSY` or a half-read shebang depending on the moment. So: write once.
if (!statSync(bin, { throwIfNoEntry: false })?.isFile()) {
  writeFileSync(bin, contents);
}
chmodSync(bin, 0o755);

/** Spread into a CLI child's env: `{ ...process.env, ...FREE_LSOF }`. */
export const FREE_LSOF = { NITRO_UI_LSOF_BIN: bin };
