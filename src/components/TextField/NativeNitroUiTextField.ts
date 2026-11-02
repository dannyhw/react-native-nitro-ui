import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiSize } from '../Switch/Switch.nitro';
import { NitroUiTextFieldConfig } from './NitroUiTextFieldConfig';
import type {
  NitroUiTextFieldMethods,
  NitroUiTextFieldTestState,
} from './TextField.nitro';

type ValueChangeHandler = (value: string, eventCount: number) => void;
type FocusChangeHandler = (focused: boolean) => void;
type SubmitHandler = (text: string) => void;
type HybridRefHandler = (view: NitroUiTextFieldHandle) => void;

/**
 * The native TextField - what a `hybridRef` callback gets.
 *
 * Read-only for props, like `NitroUiSwitchHandle` (DECISIONS D14): a prop
 * write here would run the native setter on the JS thread and never commit.
 * `focus()` and `blur()` are the component's two imperative methods (the
 * wrapper's `ref` calls them); they hop to the UI thread themselves. The
 * `nuiTest…` members are test seams.
 *
 * @internal Not semver surface; typed for this repo's harness and benchmarks.
 */
export interface NitroUiTextFieldHandle {
  /** The last `value` React sent, or `null` while uncontrolled. */
  readonly value: string | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSize;
  /** Focus the field; see `NitroUiTextFieldMethods.focus`. */
  focus(): void;
  /** Blur the field; see `NitroUiTextFieldMethods.blur`. */
  blur(): void;
  /** See `NitroUiTextFieldMethods.nuiTestState`. */
  nuiTestState(): NitroUiTextFieldTestState;
  /** See `NitroUiTextFieldMethods.nuiTestSetMarkedText`. */
  nuiTestSetMarkedText(text: string): void;
  /** See `NitroUiTextFieldMethods.nuiTestLifetimeReport`. */
  nuiTestLifetimeReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper (DECISIONS D7). The two sizing props
 * come from `NitroUiIntrinsicProps`.
 */
export interface NativeNitroUiTextFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  value: string | null;
  defaultValue: string | null;
  mostRecentEventCount: number;
  placeholder: string | null;
  multiline: boolean;
  keyboardType: string;
  autoCapitalize: string;
  autoCorrect: boolean;
  secureTextEntry: boolean;
  maxLength: number | null;
  returnKeyType: string;
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
 * The host component for the `NitroUiTextField` Hybrid View. The props type is
 * corrected the same way `NativeNitroUiSwitch` does it; `onFocus`/`onBlur`
 * are dropped from the base `ViewProps` because the wrapper owns those names.
 */
export const NativeNitroUiTextField = getHostComponent<
  NativeNitroUiTextFieldProps,
  NitroUiTextFieldMethods
>('NitroUiTextField', () => NitroUiTextFieldConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel' | 'onFocus' | 'onBlur'> &
    NativeNitroUiTextFieldProps
>;
