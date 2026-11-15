import type { HybridObject } from 'react-native-nitro-modules';

/**
 * The Android Material theme every control is drawn with. Android only; app code
 * sets it through `setMaterialTheme`, never directly.
 */
export interface NitroUiMaterialTheme extends HybridObject<{
  android: 'kotlin';
}> {
  /**
   * `true` for Material 3 Expressive (the default), `false` for the baseline
   * Material 3 theme. Process-wide; a change recomposes the controls already on
   * screen under the new theme.
   */
  expressive: boolean;

  /**
   * Test diagnostics: the setting, and how many theme roots have composed under
   * each motion scheme since the process started, as
   * `setting=<expressive|baseline>;expressive=<n>;baseline=<n>;other=<n>`.
   */
  composedReport(): string;
}
