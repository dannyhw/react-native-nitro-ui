import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { NitroUiSearchFieldConfig } from './NitroUiSearchFieldConfig';
import type {
  NitroUiSearchFieldMethods,
  NitroUiSearchFieldTestState,
} from './SearchField.nitro';

type ValueChangeHandler = (value: string, eventCount: number) => void;
type FocusChangeHandler = (focused: boolean) => void;
type SubmitHandler = (text: string) => void;
type HybridRefHandler = (view: NitroUiSearchFieldHandle) => void;

/**
 * The native SearchField - what a `hybridRef` callback gets.
 *
 * Read-only for props, like `NitroUiTextFieldHandle` (DECISIONS D14): a prop write
 * here would run the native setter on the JS thread and never commit. `focus()` and
 * `blur()` are the component's two imperative methods (the wrapper's `ref` calls
 * them); they hop to the UI thread themselves. The `nuiTest…` members are test seams.
 *
 * @internal Not semver surface; typed for this repo's harness and benchmarks.
 */
export interface NitroUiSearchFieldHandle {
  /** The last `value` React sent, or `null` while uncontrolled. */
  readonly value: string | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): { width: number; height: number };
  /** Focus the field; see `NitroUiSearchFieldMethods.focus`. */
  focus(): void;
  /** Blur the field; see `NitroUiSearchFieldMethods.blur`. */
  blur(): void;
  /** See `NitroUiSearchFieldMethods.nuiTestState`. */
  nuiTestState(): NitroUiSearchFieldTestState;
  /** See `NitroUiSearchFieldMethods.nuiTestClear`. */
  nuiTestClear(): void;
  /** See `NitroUiSearchFieldMethods.nuiTestSubmit`. */
  nuiTestSubmit(): void;
  /** See `NitroUiSearchFieldMethods.nuiTestLifetimeReport`. */
  nuiTestLifetimeReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper (DECISIONS D7). The two sizing props come from
 * `NitroUiIntrinsicProps`.
 */
export interface NativeNitroUiSearchFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  value: string | null;
  defaultValue: string | null;
  mostRecentEventCount: number;
  placeholder: string | null;
  maxLength: number | null;
  editable: boolean;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onValueChange: NitroCallbackProp<ValueChangeHandler>;
  onFocusChange: NitroCallbackProp<FocusChangeHandler>;
  onSubmitEditing: NitroCallbackProp<SubmitHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiSearchField` Hybrid View. The props type is
 * corrected the same way `NativeNitroUiTextField` does it; `onFocus`/`onBlur` are
 * dropped from the base `ViewProps` because the wrapper owns those names.
 */
export const NativeNitroUiSearchField = getHostComponent<
  NativeNitroUiSearchFieldProps,
  NitroUiSearchFieldMethods
>(
  'NitroUiSearchField',
  () => NitroUiSearchFieldConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel' | 'onFocus' | 'onBlur'> &
    NativeNitroUiSearchFieldProps
>;
