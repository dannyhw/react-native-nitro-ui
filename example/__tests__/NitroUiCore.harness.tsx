import { describe, expect, it } from 'react-native-harness';
import { nitroUiCore } from 'react-native-nitro-ui';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('NitroUiCore', () => {
  it('is autolinked on the platform', async () => {
    // Creating the HybridObject fails if registration/autolinking is broken.
    expect(typeof nitroUiCore.now()).toBe('number');
  });

  it('is monotonic', () => {
    let previous = nitroUiCore.now();
    for (let i = 0; i < 200; i += 1) {
      const current = nitroUiCore.now();
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('advances with wall time, close to performance.now()', async () => {
    const coreStart = nitroUiCore.now();
    const perfStart = performance.now();
    await wait(250);
    const coreDelta = nitroUiCore.now() - coreStart;
    const perfDelta = performance.now() - perfStart;

    expect(coreDelta).toBeGreaterThanOrEqual(200);
    // Same time base, so the two clocks may only disagree by scheduling noise.
    expect(Math.abs(coreDelta - perfDelta)).toBeLessThan(20);
  });

  it('resolves to nanosecond-scale precision', () => {
    const a = nitroUiCore.now();
    const b = nitroUiCore.now();
    expect(b - a).toBeGreaterThanOrEqual(0);
    // Milliseconds with sub-microsecond fractions must survive the round trip.
    expect(a).not.toBe(Math.trunc(a));
  });
});
