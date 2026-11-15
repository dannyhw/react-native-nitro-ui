import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiMenuRow } from '../Menu/Menu.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiContextMenuMethods } from './ContextMenu.nitro';
import { NitroUiContextMenuConfig } from './NitroUiContextMenuConfig';

type SelectHandler = (id: string) => void;
type VoidHandler = () => void;
type HybridRefHandler = (view: NitroUiContextMenuHandle) => void;

/**
 * The read side of the native ContextMenu - what a `hybridRef` callback gets.
 *
 * Read-only: a prop written from JS never commits. The methods are test seams;
 * each hops to the UI thread itself, and the report reads a published snapshot,
 * so none of them blocks JS.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiContextMenuHandle {
  readonly disabled: boolean;
  readonly title: string | null;
  readonly previewCornerRadius: number | null;
  /** Test-only. @internal */
  nuiTestSelectRow(id: string): void;
  /** Test-only. @internal */
  nuiTestMenuProbe(): void;
  /**
   * Test-only: samples the open menu's window for `color`; `no popup` and
   * `no pixels` are the refusals. @internal
   */
  nuiTestMenuPixelProbe(color: number): void;
  /** Test-only - what that probe found. @internal */
  nuiTestMenuPixelReport(): string;
  /** Test-only. @internal */
  nuiTestContextMenuReport(): string;
  /** Test-only. @internal */
  nuiTestA11yLongClick(): void;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper.
 *
 * Unlike a leaf control's, these sit beside React Native's own `ViewProps`
 * rather than replacing any: `testID`, `style` and the accessibility props are
 * the wrapper's own, because the wrapper is the view React Native styles.
 */
export interface NativeNitroUiContextMenuProps extends HybridViewProps {
  rows: NitroUiMenuRow[];
  title: string | null;
  disabled: boolean;
  previewCornerRadius: number | null;
  nuiPerfId: number | null;
  onSelect: NitroCallbackProp<SelectHandler>;
  onOpen: NitroCallbackProp<VoidHandler>;
  onClose: NitroCallbackProp<VoidHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiContextMenu` Hybrid View. The cast corrects
 * only the props type.
 */
export const NativeNitroUiContextMenu = getHostComponent<
  NativeNitroUiContextMenuProps,
  NitroUiContextMenuMethods
>(
  'NitroUiContextMenu',
  () => NitroUiContextMenuConfig
) as unknown as ComponentType<ViewProps & NativeNitroUiContextMenuProps>;
