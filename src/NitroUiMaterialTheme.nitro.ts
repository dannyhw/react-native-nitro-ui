import type { HybridObject } from 'react-native-nitro-modules';

/**
 * The Android Material theme every nitro-ui control is drawn with (D39).
 *
 * Android-only and implemented in Kotlin: the setting is Compose snapshot state in
 * `core/NitroUiMaterialTheme.kt`, which every composition this library owns reads at
 * its root, so the setter has nothing to do in C++ and nothing at all on iOS. App code
 * reaches it through `setMaterialTheme` (`src/MaterialTheme.ts`), never directly.
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
   * Diagnostics for the harness: the setting, and how many theme roots have composed
   * under each motion scheme since the process started -
   * `setting=<expressive|baseline>;expressive=<n>;baseline=<n>;other=<n>`.
   */
  composedReport(): string;
}
