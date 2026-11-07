import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
  type ViewConfig,
} from 'react-native-nitro-modules';

import type { NitroUiFormAccessory } from './Form.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type {
  NitroUiFormMethods,
  NitroUiFormRowMethods,
  NitroUiFormSectionMethods,
} from './Form.nitro';

/**
 * The `hybridRef` shape of one of the three views.
 *
 * The spike hands out the *methods* interface rather than a read-only handle, because the
 * only consumer is this repo's harness and it reads the test seams anyway. A shipped Form
 * would name a handle per view, as `NitroUiContextMenuHandle` does (D14).
 */
type Ref<View> = NitroCallbackProp<(view: View) => void>;

/**
 * The raw host components of the S6 spike prototype (`Form.nitro.ts`).
 *
 * Three Hybrid Views, one file: they are one component to React and none of them is a
 * shipped control. The shapes are the usual ones for a container that owns React
 * Native's children - every prop is sent, `null` for "not set", callbacks in Nitro's
 * `{ f: … }` wrapper (D7, D7b), and the props sit *beside* React Native's own
 * `ViewProps` because the wrapper is the view React Native styles.
 *
 * The configs are copies of nitrogen's `NitroUi<Name>Config.json`, checked against it by
 * `src/__tests__/viewConfigs.test.ts` (the `<Host>`'s route: no manifest, so the
 * registry writes no row and the entry is hand-written there too).
 */

type ContentBoxHandler = (width: number) => void;
type MetricsHandler = (
  headerHeight: number,
  footerHeight: number,
  inset: number,
  gap: number
) => void;
type PressHandler = () => void;
type FrameMovedHandler = (x: number, y: number) => void;

// MARK: - Form

export interface NativeNitroUiFormProps extends HybridViewProps {
  keyboardAvoidance: boolean;
  nuiPerfId: number | null;
  onContentBox: NitroCallbackProp<ContentBoxHandler>;
  hybridRef?: Ref<NitroUiFormMethods> | undefined;
}

export const NitroUiFormConfig: ViewConfig<NativeNitroUiFormProps> = {
  uiViewClassName: 'NitroUiForm',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    keyboardAvoidance: true,
    nuiPerfId: true,
    onContentBox: true,
    hybridRef: true,
  },
};

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
  hybridRef?: Ref<NitroUiFormSectionMethods> | undefined;
}

export const NitroUiFormSectionConfig: ViewConfig<NativeNitroUiFormSectionProps> =
  {
    uiViewClassName: 'NitroUiFormSection',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      title: true,
      footer: true,
      nuiPerfId: true,
      onMetrics: true,
      hybridRef: true,
    },
  };

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
  onFrameMoved: NitroCallbackProp<FrameMovedHandler>;
  hybridRef?: Ref<NitroUiFormRowMethods> | undefined;
}

export const NitroUiFormRowConfig: ViewConfig<NativeNitroUiFormRowProps> = {
  uiViewClassName: 'NitroUiFormRow',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    accessory: true,
    selected: true,
    pressable: true,
    nuiPerfId: true,
    onPress: true,
    onFrameMoved: true,
    hybridRef: true,
  },
};

export const NativeNitroUiFormRow = getHostComponent<
  NativeNitroUiFormRowProps,
  NitroUiFormRowMethods
>('NitroUiFormRow', () => NitroUiFormRowConfig) as unknown as ComponentType<
  ViewProps & NativeNitroUiFormRowProps
>;
