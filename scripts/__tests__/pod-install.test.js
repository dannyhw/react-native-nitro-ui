/**
 * The CocoaPods stamp must not be able to churn.
 *
 * `Podfile.lock` ends with `COCOAPODS: <version>`, which `pod install` rewrites
 * to whichever CocoaPods is on `PATH`. Four tasks (R1, C1, G5, G6) each ended up
 * hand-restoring that one trailer because their machine ran 1.15.2 against a
 * lock recorded at 1.17.0 - a tracked file left dirty by a tool version, which
 * also trips the bench's dirty-tree guard. These are the tests for the single
 * entry point that replaced the bare `pod install` calls, with no pods involved:
 * a stamp-only diff has to be undone, and a *real* lock change has to survive.
 *
 * The "survive" half matters as much as the "undo" half: silently restoring the
 * trailer after a genuine dependency change would hide it from review.
 */

import { describe, expect, it } from '@jest/globals';

import {
  choosePodCommand,
  cocoapodsStamp,
  pinnedCocoapods,
  reconcileCocoapodsStamp,
} from '../pod-install-lib.mjs';

const LOCK_117 = 'PODFILE CHECKSUM: abc123\n\nCOCOAPODS: 1.17.0\n';
const LOCK_115 = 'PODFILE CHECKSUM: abc123\n\nCOCOAPODS: 1.15.2\n';
const LOCK_115_OTHER = 'PODFILE CHECKSUM: deadbeef\n\nCOCOAPODS: 1.15.2\n';

describe('cocoapodsStamp', () => {
  it('reads the trailer', () => {
    expect(cocoapodsStamp(LOCK_117)).toBe('1.17.0');
  });

  it('is null without one (a fresh consumer app has no lock yet)', () => {
    expect(cocoapodsStamp('PODFILE CHECKSUM: abc123\n')).toBeNull();
    expect(cocoapodsStamp(null)).toBeNull();
  });
});

describe('reconcileCocoapodsStamp', () => {
  it('undoes a stamp-only change', () => {
    const outcome = reconcileCocoapodsStamp(LOCK_117, LOCK_115);
    expect(outcome.stampOnly).toBe(true);
    expect(outcome.text).toBe(LOCK_117);
    expect(outcome.from).toBe('1.17.0');
    expect(outcome.to).toBe('1.15.2');
  });

  it('leaves a real lock change alone, stamp and all', () => {
    const outcome = reconcileCocoapodsStamp(LOCK_117, LOCK_115_OTHER);
    expect(outcome.stampOnly).toBe(false);
    expect(outcome.changed).toBe(true);
    expect(outcome.text).toBe(LOCK_115_OTHER);
  });

  it('says nothing when the install changed nothing', () => {
    const outcome = reconcileCocoapodsStamp(LOCK_117, LOCK_117);
    expect(outcome.changed).toBe(false);
    expect(outcome.stampOnly).toBe(false);
  });

  it('does not invent a stamp for a lock that had none', () => {
    const outcome = reconcileCocoapodsStamp(null, LOCK_115);
    expect(outcome.stampOnly).toBe(false);
    expect(outcome.changed).toBe(false);
    expect(outcome.text).toBe(LOCK_115);
  });
});

describe('pinnedCocoapods', () => {
  it('prefers the target lock own stamp', () => {
    expect(
      pinnedCocoapods({ targetLockText: LOCK_115, repoLockText: LOCK_117 })
    ).toBe('1.15.2');
  });

  it('falls back to the repository pin for a generated app', () => {
    expect(
      pinnedCocoapods({ targetLockText: null, repoLockText: LOCK_117 })
    ).toBe('1.17.0');
  });
});

describe('choosePodCommand', () => {
  /** A probe that only accepts the CocoaPods gem version it is told about. */
  const gemOnly = (available) => (cmd) => ({
    ok: cmd[0] === 'pod' && cmd[1] === `_${available}_`,
    version: available,
  });

  it('honours COCOAPODS_BIN, including a multi-word command', () => {
    const choice = choosePodCommand({
      pin: '1.17.0',
      probe: () => ({ ok: false, version: '' }),
      hasGemfile: true,
      override: 'bundle exec pod',
    });
    expect(choice.cmd).toEqual(['bundle', 'exec', 'pod']);
    expect(choice.why).toBe('COCOAPODS_BIN');
  });

  it('prefers the exact pinned gem over a bundler that resolves it', () => {
    const choice = choosePodCommand({
      pin: '1.17.0',
      probe: gemOnly('1.17.0'),
      hasGemfile: true,
    });
    expect(choice.cmd).toEqual(['pod', '_1.17.0_']);
  });

  it('uses bundler only when it resolves the pinned version', () => {
    const bundler = (cmd) =>
      cmd[0] === 'bundle' ? { ok: true, version: '1.17.0' } : { ok: false };
    expect(
      choosePodCommand({ pin: '1.17.0', probe: bundler, hasGemfile: true }).cmd
    ).toEqual(['bundle', 'exec', 'pod']);

    const wrongVersion = (cmd) =>
      cmd[0] === 'bundle' ? { ok: true, version: '1.13.0' } : { ok: false };
    expect(
      choosePodCommand({
        pin: '1.17.0',
        probe: wrongVersion,
        hasGemfile: true,
      }).cmd
    ).toEqual(['pod']);
  });

  it('falls back to plain pod and says the version differs', () => {
    const choice = choosePodCommand({
      pin: '1.17.0',
      probe: () => ({ ok: false, version: '1.15.2' }),
      hasGemfile: false,
    });
    expect(choice.cmd).toEqual(['pod']);
    expect(choice.why).toContain('not 1.17.0');
  });
});
