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
 * Read-only for the reason every handle here is (DECISIONS D14). The methods are the
 * test seams of `ContextMenu.nitro.ts`; each hops to the UI thread itself, and the
 * report reads a published snapshot, so none of them blocks JS.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiContextMenuHandle {
  /** Whether the menu is refused. */
  readonly disabled: boolean;
  /** The header React sent, or `null`. */
  readonly title: string | null;
  /** The preview radius React sent, or `null`. */
  readonly previewCornerRadius: number | null;
  /** Test-only - see `NitroUiContextMenuMethods.nuiTestSelectRow`. @internal */
  nuiTestSelectRow(id: string): void;
  /** Test-only - see `NitroUiContextMenuMethods.nuiTestMenuProbe`. @internal */
  nuiTestMenuProbe(): void;
  /** Test-only - see `NitroUiContextMenuMethods.nuiTestContextMenuReport`. @internal */
  nuiTestContextMenuReport(): string;
  /** Test-only - see `NitroUiContextMenuMethods.nuiTestA11yLongClick`. @internal */
  nuiTestA11yLongClick(): void;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper (DECISIONS D7, D7b). `ContextMenu.tsx` is the
 * friendly API.
 *
 * Unlike a leaf control's, these sit *beside* React Native's own `ViewProps` rather
 * than replacing any of them: `testID`, `style` and the accessibility props are the
 * wrapper's own, because the wrapper is the view React Native styles.
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
 * The host component for the `NitroUiContextMenu` Hybrid View. Only the props type is
 * corrected here, as for every other control (`NativeNitroUiMenu.ts`).
 */
export const NativeNitroUiContextMenu = getHostComponent<
  NativeNitroUiContextMenuProps,
  NitroUiContextMenuMethods
>(
  'NitroUiContextMenu',
  () => NitroUiContextMenuConfig
) as unknown as ComponentType<ViewProps & NativeNitroUiContextMenuProps>;
