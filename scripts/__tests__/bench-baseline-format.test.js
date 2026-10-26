/**
 * A baseline mint must not leave a formatting diff behind.
 *
 * `bench/baselines/*.json` is committed, and `bun run format` judges committed
 * files, but `bun bench --update-baseline` wrote them with
 * `JSON.stringify(value, null, 2)` - which is *not* prettier: prettier collapses
 * an array of scalars onto one line (`"launchRatios": [1]`, the shape every
 * committed cell has) and prints numbers without a leading zero in the exponent.
 * Whoever minted a baseline then found a restyled file in `git status`, which is
 * the A1b follow-up this closes.
 *
 * The injected-spawn cases prove the call and its failure notes; the last case
 * runs the repo's real prettier over a file and requires the bytes to change, so
 * the test cannot pass on argument plumbing alone.
 */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatCommittedJsonFile } from '../bench/format.mjs';

describe('formatCommittedJsonFile', () => {
  it('runs the repo prettier on the file it just wrote', () => {
    const calls = [];
    const spawn = (file, args) => {
      calls.push([file, args]);
      return { status: 0 };
    };
    const outcome = formatCommittedJsonFile('/repo/bench/baselines/k.json', {
      spawn,
    });
    expect(calls).toEqual([
      ['bunx', ['prettier', '--write', '/repo/bench/baselines/k.json']],
    ]);
    expect(outcome.formatted).toBe(true);
    expect(outcome.note).toBeNull();
  });

  it('reports rather than throws when prettier is missing', () => {
    const outcome = formatCommittedJsonFile('/repo/x.json', {
      spawn: () => ({ error: new Error('spawn bunx ENOENT') }),
    });
    expect(outcome.formatted).toBe(false);
    expect(outcome.note).toContain('bun run format:write');
  });

  it('reports a non-zero prettier exit instead of claiming success', () => {
    const outcome = formatCommittedJsonFile('/repo/x.json', {
      spawn: () => ({ status: 2 }),
    });
    expect(outcome.formatted).toBe(false);
    expect(outcome.note).toContain('exited 2');
  });

  it('actually reformats: a JSON.stringify array is not prettier style', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitro-ui-format-'));
    const file = join(dir, 'baseline.json');
    try {
      // Exactly what `writeBaseline` used to write, and exactly two things
      // prettier rewrites: an array of scalars collapses onto one line, and
      // `1e+21` loses the `+` (both survive a JSON round trip).
      writeFileSync(
        file,
        `${JSON.stringify({ launchRatios: [1, 2], noise: 1e21 }, null, 2)}\n`
      );
      const before = readFileSync(file, 'utf8');
      expect(before).toContain('1e+21');

      const outcome = formatCommittedJsonFile(file);
      expect(outcome.formatted).toBe(true);

      const after = readFileSync(file, 'utf8');
      expect(after).not.toBe(before);
      expect(after).toContain('"launchRatios": [1, 2]');
      expect(after).toContain('1e21');
      expect(JSON.parse(after)).toEqual({ launchRatios: [1, 2], noise: 1e21 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
