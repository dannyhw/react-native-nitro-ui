/**
 * Does `waitForHandle` actually wait, and actually fail?
 *
 * The helper exists because `hybridRef` fires on a commit *after* a view is laid
 * out, and CI run 41230848294 turned that gap into `Cannot read property
 * 'nuiSizingId' of undefined` — a message that reads like a product crash and is
 * a fixture that did not wait. It is used by every device suite, and until F8 it
 * had never been run: `example/` is excluded from the host Jest project, so the
 * only executions of it were on a simulator, where the callback is never late and
 * the failure path never fires. A timeout branch that has never been taken is a
 * branch that can be broken without anything going red — which is what F8's
 * review found: with the throw removed, every device suite still passes, because
 * the wait still succeeds.
 *
 * So the two things that matter about it are asserted here, on real timers (the
 * helper polls, and a synchronous stand-in would prove nothing about the poll):
 * it resolves as soon as the handle appears, and when it never does it fails with
 * the sentence a device run needs — naming the control, the duration, and the
 * distinction between "late" and "gone".
 *
 * `example/__tests__/handles.ts` is imported rather than copied: the file is the
 * one the suites use, and a fixture that tests a duplicate of it is the mistake
 * this file exists to prevent.
 */

import { describe, expect, it } from '@jest/globals';

import { waitForHandle } from '../../example/__tests__/handles';

describe('waitForHandle', () => {
  it('returns the handle as soon as the callback has run', async () => {
    const handle = { measureContent: () => ({ width: 61 }) };
    let delivered: typeof handle | null = null;
    // Real timing, one tick late, which is the shape a commit has: the box exists
    // on the first poll and the callback lands on a later one.
    const timer = setTimeout(() => {
      delivered = handle;
    }, 40);
    const resolved = await waitForHandle(() => delivered, {
      what: '"conformance-switch"',
      timeoutMs: 5000,
    });
    clearTimeout(timer);
    expect(resolved).toBe(handle);
  });

  it('fails with the control, the duration and the reason when it never arrives', async () => {
    const started = Date.now();
    await expect(
      waitForHandle(() => null, {
        what: '"conformance-date-picker"',
        timeoutMs: 120,
      })
    ).rejects.toThrow(/no hybridRef handle for "conformance-date-picker"/u);
    // …and it waited: returning the rejection immediately would also satisfy the
    // assertion above, and would mean the helper stops waiting on a device where
    // the callback is merely slow — the exact case it was written for.
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    const message = await waitForHandle(() => null, {
      what: '"x"',
      timeoutMs: 20,
    }).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    );
    // The sentence has to say "late" and "never arrives" separately, because the
    // first is a slow runner and the second is a control that stopped handing back
    // its state, and a reader on a red CI job has to tell them apart.
    expect(message).toContain('within 20ms');
    expect(message).toContain('the handle being late');
    expect(message).toContain('stopped handing back its state');
  });

  it('does not swallow a handle that is present on the first poll', async () => {
    // The fast path is what every device run takes, so it is the one a "simplify"
    // is most likely to break: an unconditional first sleep would add a poll
    // interval to every read in every suite, and a `read()` hoisted above the loop
    // would hang on a handle that arrives later.
    let calls = 0;
    const read = () => {
      calls += 1;
      return { tag: 'switch' };
    };
    const handle = await waitForHandle(read, { what: 'x', timeoutMs: 1000 });
    expect(handle).toEqual({ tag: 'switch' });
    expect(calls).toBe(1);
  });
});
