import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiSearchFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** `null` while uncontrolled: native then keeps the text the user typed. */
  value: string | null;
  defaultValue: string | null;
  /** Native ignores a `value` sent with a count behind its own. */
  mostRecentEventCount: number;
  /** `null` for the platform's own. */
  placeholder: string | null;
  /**
   * In UTF-16 code units (`string.length`), or `null` for no limit. Never
   * splits a grapheme cluster, and is not enforced during an IME composition.
   */
  maxLength: number | null;
  /**
   * `'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' |
   * 'phone-pad' | 'url'`. Anything else is `'default'`.
   */
  keyboardType: string;
  /** `'none' | 'sentences' | 'words' | 'characters'`. */
  autoCapitalize: string;
  autoCorrect: boolean;
  /** `false`: the field shows its text and takes no focus and no input. */
  editable: boolean;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  /** Called for every user edit, the clear button's included. */
  onValueChange?: (value: string, eventCount: number) => void;
  /**
   * One callback for focus and blur, so its name cannot collide with the base
   * view's own `onFocus` / `onBlur` events.
   */
  onFocusChange?: (focused: boolean) => void;
  /** An empty field never submits, and the field blurs after a submit. */
  onSubmitEditing?: (text: string) => void;
}

/** @internal The native field's state as applied, for tests. */
export interface NitroUiSearchFieldTestState {
  text: string;
  focused: boolean;
  composing: boolean;
  nativeEvents: number;
  /** The `mostRecentEventCount` native has seen. */
  jsEvents: number;
  /** The last `value` write: `applied`, `stale`, `composing` or `none`. */
  lastWrite: string;
  editable: boolean;
  /** `-1` for none. */
  maxLength: number;
  /** `''` for none. */
  placeholder: string;
  /** `''` for none. */
  accessibilityLabel: string;
  returnKeyType: string;
  keyboardType: string;
  autoCapitalize: string;
  autoCorrect: boolean;
  /** Android only, and always `false`: the search bar is held collapsed. */
  expanded: boolean;
  canClear: boolean;
}

export interface NitroUiSearchFieldMethods extends HybridViewMethods {
  /** Reads a cached size; safe to call from the JS thread. */
  measureContent(): NitroUiSize;
  /** Returns at once; `onFocusChange(true)` says when focus landed. */
  focus(): void;
  blur(): void;
  /** @internal Test-only. Reads a snapshot; never waits for the UI thread. */
  nuiTestState(): NitroUiSearchFieldTestState;
  /** @internal Test-only: runs the control's own clear button. */
  nuiTestClear(): void;
  /** @internal Test-only: presses the keyboard's Search key. */
  nuiTestSubmit(): void;
  /** @internal Test-only: `drops=<n> recycles=<m>` for this native object. */
  nuiTestLifetimeReport(): string;
}

/** @internal Exported for this repo's apps and tests; not semver surface. */
export type NitroUiSearchField = HybridView<
  NitroUiSearchFieldProps,
  NitroUiSearchFieldMethods
>;
