import { NitroModules } from 'react-native-nitro-modules';
import { Platform } from 'react-native';

import type { NitroUiMaterialTheme } from './NitroUiMaterialTheme.nitro';

/**
 * The Material 3 theme Android controls are drawn with.
 *
 * - `'expressive'` (the default): Material 3 Expressive, Android's design since
 *   Android 16. Today that is its spring-based motion - a Switch's thumb, a
 *   Checkbox's mark, a menu or a sheet opening - and Material ties more to the
 *   Expressive theme with each release.
 * - `'baseline'`: the baseline Material 3 theme, with its standard motion.
 *
 * Both draw with the same colours: the device's dynamic colours on Android 12+, the
 * default Material 3 scheme before that, light or dark with the system.
 */
export type MaterialTheme = 'expressive' | 'baseline';

let native: NitroUiMaterialTheme | null = null;

/** The Kotlin object behind the setting, created on first use, Android only. */
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
 * Choose the Material 3 theme every Android control is drawn with. The default is
 * `'expressive'`; pass `'baseline'` to keep the baseline Material 3 theme.
 *
 * Call it once, at startup - after the imports, before the first screen renders - so
 * no control is ever drawn with the other theme. The choice is the whole app's:
 * every control and every `<Host>` follows it, and there is no per-control prop. A
 * later call still reaches the controls already on screen, which redraw under the
 * new theme.
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
 * The harness's reading of the theme (`nitroUiCore.materialThemeReport()`): the
 * setting and how many theme roots composed under each motion scheme, or `''` on
 * iOS.
 */
export function materialThemeReport(): string {
  return materialTheme()?.composedReport() ?? '';
}
