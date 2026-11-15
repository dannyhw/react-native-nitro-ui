/**
 * An `lsof` that says "nobody is listening", so a suite that is not about ports does not
 * depend on what else is serving a Metro port on the machine.
 */

// One fixed path in the temp directory, shared by every jest worker and never deleted:
// workers finish at different times, and one's cleanup would remove the stub another is
// about to run.

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
// Replaced by rename, never written in place: another worker may be executing the stub,
// and writing to a file under execution fails with `ETXTBSY` or is read half-written.
let current = null;
try {
  current = readFileSync(bin, 'utf8');
} catch {
  /* not created yet */
}
if (current !== contents) {
  const staging = `${bin}.${String(process.pid)}.staged`;
  try {
    writeFileSync(staging, contents, { mode: 0o755 });
    renameSync(staging, bin);
  } finally {
    rmSync(staging, { force: true });
  }
}
chmodSync(bin, 0o755);

/** Spread into a CLI child's env: `{ ...process.env, ...FREE_LSOF }`. */
export const FREE_LSOF = { NITRO_UI_LSOF_BIN: bin };
