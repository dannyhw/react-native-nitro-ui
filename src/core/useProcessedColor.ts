import { processColor, type ColorValue } from 'react-native';
import { useMemo } from 'react';

/**
 * `processColor` for a Nitro `number | null` color prop, memoized.
 *
 * Nitro specs carry colors as the ARGB integer RN's `processColor` produces, so
 * it stays off the native side and every color conversion happens once per
 * value, not once per render.
 *
 * @returns the processed color, or `null` for "use the platform default". A
 * dynamic/rounded color that cannot be represented as a single integer (for
 * example an iOS dynamic provider) also yields `null`, with a warning in the
 * debug build.
 */
export function useProcessedColor(
  color: ColorValue | undefined | null
): number | null {
  return useMemo(() => {
    if (color == null) {
      return null;
    }
    const processed = processColor(color);
    if (typeof processed === 'number') {
      return processed;
    }
    if (__DEV__) {
      console.warn(
        `react-native-nitro-ui: could not process the color ${JSON.stringify(color)}. ` +
          'Pass a plain color string or hex value; dynamic colors are not supported yet.'
      );
    }
    return null;
  }, [color]);
}
