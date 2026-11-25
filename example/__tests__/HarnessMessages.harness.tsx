import { describe, expect, it } from 'react-native-harness';

/** The message a failed `expect` throws, or nothing when it passed. */
function failureOf(check: () => void): string {
  try {
    check();
  } catch (error) {
    return String((error as Error).message);
  }
  return '';
}

describe('harness failure messages', () => {
  it('name every element of an array that failed to match', () => {
    // Longer than the 40 characters chai keeps of a value by default.
    const arrived = [
      'conformance-form-item:press',
      'conformance-form-row:press',
    ];
    const message = failureOf(() => {
      expect(arrived).toEqual(['conformance-form-item:press']);
    });
    expect(message).toContain('conformance-form-row:press');
    expect(message).not.toContain('Array(2)');
  });
});
