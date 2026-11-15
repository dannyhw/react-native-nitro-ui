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
 * The raw host components of `Form`, `Form.Section` and `Form.Row`. Every prop is always
 * sent, with `null` for "not set": a removed optional prop crashes (nitro#1184).
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
 * What a `hybridRef` callback gets from the native Form. Read-only: props are the write path.
 *
 * @internal
 */
export interface NitroUiFormHandle {
  /** Whether the Form avoids the keyboard. */
  readonly keyboardAvoidance: boolean;
  /** The scroll offset the shadow node was last told, or `null`. */
  readonly nuiContentOffsetY: number | null;
  /** Test-only. @internal */
  nuiTestFormReport(): string;
  /** Test-only. @internal */
  nuiTestScrollTo(y: number): void;
  /** Test-only. @internal */
  nuiTestCommand(command: string): void;
}

/** The read side of the native `Form.Section`. @internal */
export interface NitroUiFormSectionHandle {
  /** The header React sent, or `null`. */
  readonly title: string | null;
  /** The footer React sent, or `null`. */
  readonly footer: string | null;
  /** Test-only. @internal */
  nuiTestSectionReport(): string;
}

/** The read side of the native `Form.Row`. @internal */
export interface NitroUiFormRowHandle {
  /** The trailing accessory React sent. */
  readonly accessory: NitroUiFormAccessory;
  /** Whether this row is selected. */
  readonly selected: boolean;
  /** Whether this row has an `onPress`. */
  readonly pressable: boolean;
  /** Test-only. @internal */
  nuiTestRowReport(): string;
  /** Test-only. @internal */
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
  /** The width this row's cell gives its content, reported per row by the cell. */
  onContentBox: NitroCallbackProp<ContentBoxHandler>;
  hybridRef?: NitroCallbackProp<(view: NitroUiFormRowHandle) => void>;
}

/** The host component for the `NitroUiFormRow` Hybrid View. @internal */
export const NativeNitroUiFormRow = getHostComponent<
  NativeNitroUiFormRowProps,
  NitroUiFormRowMethods
>('NitroUiFormRow', () => NitroUiFormRowConfig) as unknown as ComponentType<
  ViewProps & NativeNitroUiFormRowProps
>;
