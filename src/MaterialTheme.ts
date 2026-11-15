import { NitroModules } from 'react-native-nitro-modules';
import { Platform } from 'react-native';

import type { NitroUiMaterialTheme } from './NitroUiMaterialTheme.nitro';

/**
 * The Material 3 theme Android controls are drawn with.
 *
 * - `'expressive'` (the default): Material 3 Expressive, with its spring-based
 *   motion.
 * - `'baseline'`: the baseline Material 3 theme, with its standard motion.
 *
 * Both use the same colours: the device's dynamic colours on Android 12+, the
 * default Material 3 scheme before that, light or dark with the system.
 */
export type MaterialTheme = 'expressive' | 'baseline';

let native: NitroUiMaterialTheme | null = null;

function materialTheme(): NitroUiMaterialTheme | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  if (native == null) {
    native = NitroModules.createHybridObject<NitroUiMaterialTheme>(
      'NitroUiMaterialTheme'
    );
  }
  return native;
}

/**
 * Choose the Material 3 theme every Android control is drawn with. The default
 * is `'expressive'`; pass `'baseline'` for the baseline Material 3 theme.
 *
 * Call it once at startup, before the first screen renders. The choice applies
 * to the whole app: there is no per-control prop. A later call also updates the
 * controls already on screen, and they keep their state.
 *
 * Does nothing on iOS, which has no Material theme.
 */
export function setMaterialTheme(theme: MaterialTheme): void {
  if (theme !== 'expressive' && theme !== 'baseline') {
    throw new Error(
      `setMaterialTheme: expected 'expressive' or 'baseline', got ${JSON.stringify(theme)}`
    );
  }
  const target = materialTheme();
  if (target != null) {
    target.expressive = theme === 'expressive';
  }
}

/**
 * Test-only: the setting and how many theme roots composed under each motion
 * scheme, or `''` on iOS.
 */
export function materialThemeReport(): string {
  return materialTheme()?.composedReport() ?? '';
}
