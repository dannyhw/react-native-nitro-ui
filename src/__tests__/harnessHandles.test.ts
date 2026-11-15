import { describe, expect, it } from '@jest/globals';

import { waitForHandle } from '../../example/__tests__/handles';

describe('waitForHandle', () => {
  it('returns the handle as soon as the callback has run', async () => {
    const handle = { measureContent: () => ({ width: 61 }) };
    let delivered: typeof handle | null = null;
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
    // An immediate rejection would also pass the assertion above.
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    const message = await waitForHandle(() => null, {
      what: '"x"',
      timeoutMs: 20,
    }).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(message).toContain('within 20ms');
    expect(message).toContain('the handle being late');
    expect(message).toContain('stopped handing back its state');
  });

  it('does not swallow a handle that is present on the first poll', async () => {
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
