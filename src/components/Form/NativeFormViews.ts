import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroCallbackProp } from '../../core/useStableCallback';
import type {
  NitroUiFormAccessory,
  NitroUiFormMethods,
  NitroUiFormRowMethods,
  NitroUiFormSectionMethods,
} from './Form.nitro';
import { NitroUiFormConfig } from './NitroUiFormConfig';
import { NitroUiFormRowConfig } from './NitroUiFormRowConfig';
import { NitroUiFormSectionConfig } from './NitroUiFormSectionConfig';

/**
 * The raw host components of `Form`, `Form.Section` and `Form.Row`.
 *
 * Three Hybrid Views in one file: they are one component to React and none of the three is a
 * shipped standalone control. Every prop is sent, `null` means "not set", callbacks go in
 * Nitro's `{ f: … }` wrapper (D7, D7b), and the props sit *beside* React Native's own
 * `ViewProps` because the wrapper is the view React Native styles.
 *
 * The three configs are copies of nitrogen's `NitroUi<Name>Config.json`, checked against it
 * by `src/__tests__/viewConfigs.test.ts`.
 */

type ContentBoxHandler = (width: number) => void;
type ContentOffsetHandler = (y: number) => void;
type ImeInsetHandler = (inset: number) => void;
type MetricsHandler = (
  headerHeight: number,
  footerHeight: number,
  inset: number,
  gap: number
) => void;
type PlacementHandler = (top: number) => void;
type PressHandler = () => void;

// MARK: - Handles

/**
 * The read side of the native Form - what a `hybridRef` callback gets.
 *
 * Read-only for the reason every handle here is (D14): the props are the write path. The
 * methods are the test seams of `Form.nitro.ts`; each hops to the UI thread itself, so none
 * of them blocks JS.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so `hybridRef` can be
 * typed for this repo's harness and benchmarks.
 */
export interface NitroUiFormHandle {
  /** Whether the Form avoids the keyboard. */
  readonly keyboardAvoidance: boolean;
  /** The scroll offset the shadow node was last told, or `null`. */
  readonly nuiContentOffsetY: number | null;
  /** Test-only - see `NitroUiFormMethods.nuiTestFormReport`. @internal */
  nuiTestFormReport(): string;
  /** Test-only - see `NitroUiFormMethods.nuiTestScrollTo`. @internal */
  nuiTestScrollTo(y: number): void;
  /** Test-only - see `NitroUiFormMethods.nuiTestCommand`. @internal */
  nuiTestCommand(command: string): void;
}

/** The read side of the native `Form.Section`. @internal Not app API (D14). */
export interface NitroUiFormSectionHandle {
  /** The header React sent, or `null`. */
  readonly title: string | null;
  /** The footer React sent, or `null`. */
  readonly footer: string | null;
  /** Test-only - see `NitroUiFormSectionMethods.nuiTestSectionReport`. @internal */
  nuiTestSectionReport(): string;
}

/** The read side of the native `Form.Row`. @internal Not app API (D14). */
export interface NitroUiFormRowHandle {
  /** The trailing accessory React sent. */
  readonly accessory: NitroUiFormAccessory;
  /** Whether this row is selected. */
  readonly selected: boolean;
  /** Whether this row has an `onPress`. */
  readonly pressable: boolean;
  /** Test-only - see `NitroUiFormRowMethods.nuiTestRowReport`. @internal */
  nuiTestRowReport(): string;
  /** Test-only - see `NitroUiFormRowMethods.nuiTestA11yClick`. @internal */
  nuiTestA11yClick(): void;
}

// MARK: - Form

export interface NativeNitroUiFormProps extends HybridViewProps {
  keyboardAvoidance: boolean;
  nuiContentOffsetY: number | null;
  nuiPerfId: number | null;
  onContentBox: NitroCallbackProp<ContentBoxHandler>;
  onContentOffset: NitroCallbackProp<ContentOffsetHandler>;
  onImeInset: NitroCallbackProp<ImeInsetHandler>;
  hybridRef?: NitroCallbackProp<(view: NitroUiFormHandle) => void>;
}

/** The host component for the `NitroUiForm` Hybrid View. @internal */
export const NativeNitroUiForm = getHostComponent<
  NativeNitroUiFormProps,
  NitroUiFormMethods
>('NitroUiForm', () => NitroUiFormConfig) as unknown as ComponentType<
  ViewProps & NativeNitroUiFormProps
>;

// MARK: - Section

export interface NativeNitroUiFormSectionProps extends HybridViewProps {
  title: string | null;
  footer: string | null;
  nuiPerfId: number | null;
  onMetrics: NitroCallbackProp<MetricsHandler>;
  onPlacement: NitroCallbackProp<PlacementHandler>;
  hybridRef?: NitroCallbackProp<(view: NitroUiFormSectionHandle) => void>;
}

/** The host component for the `NitroUiFormSection` Hybrid View. @internal */
export const NativeNitroUiFormSection = getHostComponent<
  NativeNitroUiFormSectionProps,
  NitroUiFormSectionMethods
>(
  'NitroUiFormSection',
  () => NitroUiFormSectionConfig
) as unknown as ComponentType<ViewProps & NativeNitroUiFormSectionProps>;

// MARK: - Row

export interface NativeNitroUiFormRowProps extends HybridViewProps {
  accessory: NitroUiFormAccessory;
  selected: boolean;
  pressable: boolean;
  nuiPerfId: number | null;
  onPress: NitroCallbackProp<PressHandler>;
  hybridRef?: NitroCallbackProp<(view: NitroUiFormRowHandle) => void>;
}

/** The host component for the `NitroUiFormRow` Hybrid View. @internal */
export const NativeNitroUiFormRow = getHostComponent<
  NativeNitroUiFormRowProps,
  NitroUiFormRowMethods
>('NitroUiFormRow', () => NitroUiFormRowConfig) as unknown as ComponentType<
  ViewProps & NativeNitroUiFormRowProps
>;
