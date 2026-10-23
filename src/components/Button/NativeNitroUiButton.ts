import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiButtonConfig } from './NitroUiButtonConfig';
import type { NitroUiButtonMethods, NitroUiButtonSize } from './Button.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PressHandler = () => void;
type HybridRefHandler = (view: NitroUiButtonHandle) => void;

/**
 * The read side of the native Button - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14): writing `view.title = …` from JS runs
 * the native setter on the JS thread, mutates model state the UI thread owns,
 * and never commits, so the write would silently do nothing (and, for a
 * size-affecting prop, desync the size Yoga was told). Every prop goes through
 * React. Methods that only read a cache (`measureContent()`) are safe from any
 * thread, which is why that one is here.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiButtonHandle {
  /** The last title React sent. */
  readonly title: string;
  /** The resolved variant (`'filled'` for anything unrecognised). */
  readonly variant: string;
  /** The resolved size. */
  readonly size: string;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The SF Symbol name, or `null`. */
  readonly systemImage: string | null;
  /** The control's accessibility label, or `null` when it falls back to `title`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiButtonSize;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Button.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). The two callbacks are the D7b
 * exception, and `Button.tsx` always sends an `onPress`.
 *
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts). For a Button
 * `nuiSizingKey` is not decoration: `title`, `variant` and `size` all change the
 * control's size, so the key is what makes two different buttons get two
 * different cached sizes (`docs/architecture/sizing.md`).
 */
export interface NativeNitroUiButtonProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  title: string;
  variant: string;
  size: string;
  disabled: boolean;
  tintColor: number | null;
  systemImage: string | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onPress: NitroCallbackProp<PressHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiButton` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
 */
export const NativeNitroUiButton = getHostComponent<
  NativeNitroUiButtonProps,
  NitroUiButtonMethods
>('NitroUiButton', () => NitroUiButtonConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiButtonProps
>;
