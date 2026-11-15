import { describe, expect, it } from '@jest/globals';

import { gestureCounts, gestureReported } from '../real-input/screens.mjs';

describe('gestureCounts', () => {
  it('reads both phases out of the order the echo draws them in', () => {
    expect(gestureCounts('start=2 complete=12')).toEqual({
      starts: 2,
      completes: 12,
    });
  });

  it('reads both phases when complete comes first', () => {
    expect(gestureCounts('complete=7 start=3')).toEqual({
      starts: 3,
      completes: 7,
    });
  });

  it('reports a phase it cannot see as null, not as zero', () => {
    expect(gestureCounts(null)).toEqual({ starts: null, completes: null });
    expect(gestureCounts('order=SC')).toEqual({
      starts: null,
      completes: null,
    });
    expect(gestureCounts('start=4')).toEqual({ starts: 4, completes: null });
  });

  it('does not read a digit out of a neighbouring number', () => {
    expect(gestureCounts('start=1 complete=1').completes).toBe(1);
    expect(gestureCounts('started=9 complete=2').starts).toBeNull();
  });
});

describe('gestureReported', () => {
  it('accepts a gesture whose start and complete both arrived', () => {
    expect(
      gestureReported({ starts: 1, completes: 1 }, { starts: 2, completes: 2 })
    ).toBe(true);
  });

  it('refuses a complete with no start after it', () => {
    expect(
      gestureReported({ starts: 1, completes: 1 }, { starts: 1, completes: 2 })
    ).toBe(false);
  });

  it('refuses a start that has not been closed yet', () => {
    expect(
      gestureReported({ starts: 1, completes: 1 }, { starts: 2, completes: 1 })
    ).toBe(false);
  });

  it('refuses a start ahead of every complete on the screen', () => {
    // Both counters advanced, but the only `complete` drawn belongs to the
    // previous gesture: this touch's has not arrived.
    expect(
      gestureReported({ starts: 1, completes: 0 }, { starts: 2, completes: 1 })
    ).toBe(false);
  });

  it('refuses the same gesture read twice', () => {
    expect(
      gestureReported({ starts: 2, completes: 2 }, { starts: 2, completes: 2 })
    ).toBe(false);
  });

  it('counts a first gesture against an echo that read zero', () => {
    expect(
      gestureReported({ starts: 0, completes: 0 }, { starts: 1, completes: 1 })
    ).toBe(true);
    expect(
      gestureReported({ starts: 0, completes: 0 }, { starts: 0, completes: 1 })
    ).toBe(false);
  });

  it('refuses an echo that has not been drawn at all', () => {
    expect(
      gestureReported(
        { starts: 0, completes: 0 },
        { starts: null, completes: null }
      )
    ).toBe(false);
  });
});
