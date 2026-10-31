/**
 * The shared "port free" `lsof` stub, checked as an artifact rather than as an import.
 *
 * Two properties matter and neither is visible from a suite that merely uses it:
 *
 *  - **It answers the way the real tool does for a free port** (exit 1, no output), because
 *    suites lean on that to exercise `acquire`'s normal path. If the stub went missing or
 *    stopped being executable, the failure would look like a fail-open guard, not a broken
 *    helper - so the answer is asserted here directly.
 *  - **It is one file, reused**, not one per suite module. Each jest worker evaluates the
 *    helper, and the version this replaced called `mkdtempSync` on every evaluation: a run of
 *    the suite left a directory per worker behind and nothing removed them. The check is
 *    therefore across *processes* - several fresh imports, all of which must name the same
 *    path - which is the only shape that distinguishes a fixed name from a random one.
 */

import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, join } from 'node:path';

import { FREE_LSOF } from './helpers/free-lsof-stub.js';

const HELPER = join(__dirname, 'helpers', 'free-lsof-stub.js');

/**
 * Imports the helper in a fresh process and reports the stub path it made.
 *
 * The helper is ESM in a CommonJS package, which jest transpiles and plain node will not
 * import by its real name, so the probe gets a byte-identical copy under `.mjs`. That is
 * faithful rather than approximate: the helper reads only `node:*` builtins and `TMPDIR`,
 * so nothing about where the file sits can change what it decides.
 *
 * `tmp` aims that `TMPDIR`, which is how a test gets to watch the helper create its directory
 * from nothing. The shared one cannot be deleted to test that, because jest workers run in
 * parallel and another suite's `acquire` would find the stub gone mid-run.
 */
function importInFreshProcess(tmp = null) {
  const dir = mkdtempSync(join(tmpdir(), 'x15-stub-probe-'));
  try {
    copyFileSync(HELPER, join(dir, 'helper.mjs'));
    writeFileSync(
      join(dir, 'probe.mjs'),
      "import { FREE_LSOF } from './helper.mjs';\n" +
        'process.stdout.write(FREE_LSOF.NITRO_UI_LSOF_BIN);\n'
    );
    const run = spawnSync(process.execPath, [join(dir, 'probe.mjs')], {
      encoding: 'utf8',
      env: tmp == null ? process.env : { ...process.env, TMPDIR: tmp },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    return {
      path: run.stdout.trim(),
      dir: tmp == null ? null : join(tmp, 'nitro-ui-free-lsof'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the shared free-port lsof stub', () => {
  it('is where this process and the next one both expect it, and nowhere else', () => {
    const here = FREE_LSOF.NITRO_UI_LSOF_BIN;
    expect(here).toBeTruthy();
    // A fixed directory name: a random suffix is the leak, because it is created again per
    // worker per run. Compared through `relative` so a symlinked or doubled-slash temp dir
    // (`$TMPDIR` often ends in one) cannot fake a match or a mismatch.
    expect(relative(tmpdir(), join(here, '..'))).toBe('nitro-ui-free-lsof');
    expect(join(here, '..')).not.toMatch(/-[A-Za-z0-9]{6}$/);
  });

  it('hands every process the same path, so one run leaves one directory', () => {
    // Four separate processes: jest gives each worker its own module registry, so this is the
    // only honest way to ask "does importing this twice make two directories?" Under
    // `mkdtempSync` these four strings are four different paths and the row goes red.
    const paths = [
      importInFreshProcess().path,
      importInFreshProcess().path,
      importInFreshProcess().path,
      importInFreshProcess().path,
    ];
    for (const p of paths) expect(p).toBe(FREE_LSOF.NITRO_UI_LSOF_BIN);
    expect(new Set(paths).size).toBe(1);
  });

  it('replaces a stub on disk that no longer matches what the helper says', () => {
    // The fixed path is a cache, and a cache that is never validated is how a helper starts
    // lying: if the shipped contents ever change while an old stub sits in the temp directory,
    // every suite keeps getting the old answer. So correctness is decided by content, not by
    // the file existing - and a stale one is repaired on the next import.
    const tmp = mkdtempSync(join(tmpdir(), 'x15-stub-stale-'));
    try {
      const first = importInFreshProcess(tmp);
      writeFileSync(first.path, '#!/bin/sh\nexit 0\n');
      chmodSync(first.path, 0o755);
      const second = importInFreshProcess(tmp);
      expect(second.path).toBe(first.path);
      expect(readFileSync(first.path, 'utf8')).not.toBe('#!/bin/sh\nexit 0\n');
      const run = spawnSync(first.path, ['-nP', '-iTCP', '-sTCP:LISTEN'], {
        encoding: 'utf8',
      });
      expect(run.status).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('answers "nothing is listening" the way the real tool does', () => {
    // Exit 1 with no output: `lsof -iTCP -sTCP:LISTEN` prints nothing and fails when the port
    // is free. An empty stub that exits 0 would read as "no listeners parsed" by accident and
    // a stub that exits 2 exercises the fail-open branch instead of the guard.
    const run = spawnSync(
      FREE_LSOF.NITRO_UI_LSOF_BIN,
      ['-nP', '-iTCP', '-sTCP:LISTEN'],
      {
        encoding: 'utf8',
      }
    );
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
  });

  it('builds itself once in an empty temp directory, and reuses it after', () => {
    // The reuse half of the no-leak property, and the one that cannot be shown against the
    // shared directory without racing another worker out of it. A private `TMPDIR` gets the
    // helper's whole lifecycle: nothing there, one import, then a second import that must not
    // add anything - which is exactly the difference between a fixed name and `mkdtemp`.
    const tmp = mkdtempSync(join(tmpdir(), 'x15-stub-tmp-'));
    try {
      const first = importInFreshProcess(tmp);
      expect(first.path.endsWith('lsof')).toBe(true);
      expect(readFileSync(first.path, 'utf8')).toContain('exit 1');
      const second = importInFreshProcess(tmp);
      expect(second.path).toBe(first.path);
      // One directory, one file: the count is the leak meter. A per-import `mkdtempSync`
      // leaves two directories here and this row goes red.
      expect(readdirSync(first.dir)).toEqual(['lsof']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
