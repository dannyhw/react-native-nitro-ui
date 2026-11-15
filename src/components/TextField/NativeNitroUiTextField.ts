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
 * What a `hybridRef` callback receives. Props are read-only: a write from JS
 * would run the native setter off the UI thread and never commit. `focus()`
 * and `blur()` hop to the UI thread themselves.
 *
 * @internal
 */
export interface NitroUiTextFieldHandle {
  /** `null` while uncontrolled. */
  readonly value: string | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSize;
  focus(): void;
  blur(): void;
  nuiTestState(): NitroUiTextFieldTestState;
  nuiTestSetMarkedText(text: string): void;
  nuiTestCancelMarkedText(): void;
  nuiTestPaste(text: string, at: number): void;
  nuiTestLifetimeReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
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
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again. `onFocus`/`onBlur` are omitted because the wrapper owns
 * those names.
 */
export const NativeNitroUiTextField = getHostComponent<
  NativeNitroUiTextFieldProps,
  NitroUiTextFieldMethods
>('NitroUiTextField', () => NitroUiTextFieldConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel' | 'onFocus' | 'onBlur'> &
    NativeNitroUiTextFieldProps
>;
