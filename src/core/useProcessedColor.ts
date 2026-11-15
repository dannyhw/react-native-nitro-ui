import { processColor, type ColorValue } from 'react-native';
import { useMemo } from 'react';

/**
 * `processColor` for a Nitro `number | null` color prop, memoized so a color is
 * converted once per value rather than once per render.
 *
 * @returns the ARGB integer, or `null` for "use the platform default". A color
 * that is not a single integer (for example an iOS dynamic color) also yields
 * `null`, with a warning in development.
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
