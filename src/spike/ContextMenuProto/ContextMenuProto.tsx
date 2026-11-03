import type { ComponentType, ReactNode } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiMenuRow } from '../../components/Menu/Menu.nitro';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import type { NitroUiContextMenuProtoMethods } from './ContextMenuProto.nitro';
import { NitroUiContextMenuProtoConfig } from './NitroUiContextMenuProtoConfig';

/** S3 spike only: what a `hybridRef` callback gets. */
export interface ContextMenuProtoHandle {
  nuiTestReport(): string;
  nuiTestA11yLongClick(): void;
  nuiTestSynthHold(fx: number, fy: number, ms: number): void;
}

type SelectHandler = (id: string) => void;
type VoidHandler = () => void;
type TraceHandler = (line: string) => void;
type HybridRefHandler = (view: ContextMenuProtoHandle) => void;

/** Every spec prop, always sent; callbacks in Nitro's `{ f }` wrapper. */
export interface NativeContextMenuProtoProps extends HybridViewProps {
  rows: NitroUiMenuRow[];
  title: string | null;
  disabled: boolean;
  cancelTouches: boolean;
  onSelect: NitroCallbackProp<SelectHandler>;
  onOpen: NitroCallbackProp<VoidHandler>;
  onClose: NitroCallbackProp<VoidHandler>;
  onTrace: NitroCallbackProp<TraceHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

const NativeContextMenuProto = getHostComponent<
  NativeContextMenuProtoProps,
  NitroUiContextMenuProtoMethods
>(
  'NitroUiContextMenuProto',
  () => NitroUiContextMenuProtoConfig
) as unknown as ComponentType<ViewProps & NativeContextMenuProtoProps>;

export interface ContextMenuProtoProps extends ViewProps {
  /** Menu's flattened rows, as data. Keep the array identity stable. */
  rows: NitroUiMenuRow[];
  title?: string;
  disabled?: boolean;
  /** Spike knob: `false` skips the touch cancel at open (the red proof). */
  cancelTouches?: boolean;
  children?: ReactNode;
  onSelect?: SelectHandler;
  onOpen?: VoidHandler;
  onClose?: VoidHandler;
  onTrace?: TraceHandler;
  hybridRef?: HybridRefHandler;
}

function noop(): void {
  // Intentionally empty: always send every callback (D7b).
}

/**
 * S3 spike only (DECISIONS D36): a minimal ContextMenu, never merged. A `View`
 * whose children stay in place and which opens the rows on a long press.
 */
export function ContextMenuProto({
  rows,
  title,
  disabled = false,
  cancelTouches = true,
  onSelect,
  onOpen,
  onClose,
  onTrace,
  hybridRef,
  children,
  ...rest
}: ContextMenuProtoProps) {
  const selectCallback = useStableCallback(
    onSelect ?? noop
  ) as NitroCallbackProp<SelectHandler>;
  const openCallback = useStableCallback(
    onOpen ?? noop
  ) as NitroCallbackProp<VoidHandler>;
  const closeCallback = useStableCallback(
    onClose ?? noop
  ) as NitroCallbackProp<VoidHandler>;
  const traceCallback = useStableCallback(
    onTrace ?? noop
  ) as NitroCallbackProp<TraceHandler>;
  const hybridRefCallback = useStableCallback(hybridRef);
  return (
    <NativeContextMenuProto
      {...rest}
      rows={rows}
      title={title ?? null}
      disabled={disabled}
      cancelTouches={cancelTouches}
      onSelect={selectCallback}
      onOpen={openCallback}
      onClose={closeCallback}
      onTrace={traceCallback}
      hybridRef={hybridRefCallback ?? undefined}
    >
      {children}
    </NativeContextMenuProto>
  );
}
