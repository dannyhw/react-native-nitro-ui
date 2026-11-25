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
    const message = failureOf(() => {
      expect(['form-item:press', 'form-row:press']).toEqual([
        'form-item:press',
      ]);
    });
    expect(message).toContain('form-row:press');
    expect(message).not.toContain('Array(2)');
  });
});
