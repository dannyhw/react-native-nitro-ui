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
 * Read-only for props: a prop written from JS runs the native setter on the JS
 * thread and never commits. `focus()` and `blur()` are the component's two
 * imperative methods (the wrapper's `ref` calls them); they hop to the UI thread
 * themselves. The `nuiTest…` members are test seams.
 *
 * @internal Not semver surface; typed for this repo's harness and benchmarks.
 */
export interface NitroUiSearchFieldHandle {
  /** The last `value` React sent, or `null` while uncontrolled. */
  readonly value: string | null;
  readonly mostRecentEventCount: number;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): { width: number; height: number };
  focus(): void;
  blur(): void;
  nuiTestState(): NitroUiSearchFieldTestState;
  nuiTestClear(): void;
  nuiTestSubmit(): void;
  nuiTestLifetimeReport(): string;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper.
 */
export interface NativeNitroUiSearchFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  value: string | null;
  defaultValue: string | null;
  mostRecentEventCount: number;
  placeholder: string | null;
  keyboardType: string;
  autoCapitalize: string;
  autoCorrect: boolean;
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
 * The host component for the `NitroUiSearchField` Hybrid View. The cast corrects
 * only the props type, which `getHostComponent` intersects with `ViewProps`.
 * `onFocus`/`onBlur` are dropped from `ViewProps` because the wrapper owns those
 * names.
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
