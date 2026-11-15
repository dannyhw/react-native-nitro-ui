import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, useWindowDimensions, type ColorValue } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { InsideRowContext } from '../../core/useSelfSizing';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import type { NitroUiSheetDetent } from './BottomSheet.nitro';
import { NativeNitroUiBottomSheet } from './NativeNitroUiBottomSheet';

/**
 * A height the sheet can rest at, named as SwiftUI's `PresentationDetent` is.
 *
 * - `'fit'`: as tall as the content, following it while the sheet is up.
 * - `'medium'`: about half the screen. `'large'`: the full sheet height.
 * - `{ height }`: that many points (clamped to the largest the sheet can be).
 * - `{ fraction }`: that share of the largest height, in `(0, 1]`.
 *
 * Android's Material 3 sheet has two rest positions only: `'medium'` is its
 * half-expanded one, and the largest other detent is its expanded one. iOS 15
 * has only `'medium'` and `'large'`, and shows every other kind as `'large'`.
 */
export type BottomSheetDetent =
  'fit' | 'medium' | 'large' | { height: number } | { fraction: number };

/** Props of {@link BottomSheet}. */
export interface BottomSheetProps {
  /**
   * Whether the sheet is presented. Controlled: every close the user causes is
   * reported through `onIsPresentedChange`.
   */
  isPresented: boolean;
  /**
   * Called when the user closes the sheet: a swipe down, a tap outside, the back
   * gesture, or the platform taking it down because its screen went away. Not
   * called when `isPresented` changes because the app changed it.
   *
   * Keep `isPresented` in step with it. A parent that leaves `isPresented` true
   * after a dismissal gets the sheet back (and a dev warning); use
   * `dismissible={false}` to keep a sheet up instead.
   */
  onIsPresentedChange?: ((isPresented: boolean) => void) | undefined;
  /**
   * The sheet's content: anything React Native renders. It is mounted from the
   * moment `isPresented` turns true until the sheet has gone, and laid out at the
   * sheet's width (and, without `'fit'`, its height).
   */
  children?: ReactNode;
  /**
   * Where the sheet can rest, smallest first; the sheet opens at the first.
   * Default: `['fit']`. A dev build throws for an empty list, a repeat or an
   * invalid size.
   */
  detents?: readonly BottomSheetDetent[] | undefined;
  /**
   * Called with the index into `detents` when the user drags the sheet to another
   * detent. The selected detent is reported, not controlled.
   */
  onDetentChange?: ((index: number) => void) | undefined;
  /**
   * Called once the sheet has gone, however it was closed - by the user or by the
   * app. The content unmounts at the same moment.
   */
  onDismiss?: (() => void) | undefined;
  /**
   * Whether a swipe down, a tap outside and the back gesture close the sheet.
   * Default: `true`.
   */
  dismissible?: boolean | undefined;
  /** Whether the grabber (iOS) or drag handle (Android) is drawn. Default: `true`. */
  showsGrabber?: boolean | undefined;
  /** The sheet's top corner radius, in points. Default: the platform's. */
  cornerRadius?: number | undefined;
  /** The sheet's background colour. Default: the platform's. */
  containerColor?: ColorValue | undefined;
  /**
   * What screen readers call the sheet when it opens. Default: none - the content
   * speaks for itself.
   */
  accessibilityLabel?: string | undefined;
  /**
   * Finds the sheet in tests: the presented sheet is `<testID>-sheet`.
   */
  testID?: string | undefined;
  /**
   * Read-only access to the native view, for this library's own tests and
   * benchmarks.
   *
   * @internal Not app API.
   */
  hybridRef?:
    | ((view: {
        readonly presented: boolean;
        readonly mostRecentEventCount: number;
        readonly dismissible: boolean;
        nuiTestStateReport(): string;
        nuiTestDismiss(): void;
        nuiTestSelectDetent(index: number): void;
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks. Benchmark only.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

const DEFAULT_DETENTS: readonly NitroUiSheetDetent[] = Object.freeze([
  Object.freeze({ kind: 'fit', value: 0 }),
]);

function describeDetent(detent: unknown): string {
  try {
    return JSON.stringify(detent) ?? String(detent);
  } catch {
    return String(detent);
  }
}

/** One public detent in native's form, or `null` when it is not a valid detent. */
function toNativeDetent(detent: BottomSheetDetent): NitroUiSheetDetent | null {
  if (detent === 'fit' || detent === 'medium' || detent === 'large') {
    return { kind: detent, value: 0 };
  }
  if (detent != null && typeof detent === 'object') {
    if ('height' in detent) {
      const height = detent.height;
      return typeof height === 'number' && Number.isFinite(height) && height > 0
        ? { kind: 'height', value: height }
        : null;
    }
    if ('fraction' in detent) {
      const fraction = detent.fraction;
      return typeof fraction === 'number' &&
        Number.isFinite(fraction) &&
        fraction > 0 &&
        fraction <= 1
        ? { kind: 'fraction', value: fraction }
        : null;
    }
  }
  return null;
}

/**
 * The detents in native's form, in the app's order so `onDetentChange`'s index
 * is the app's own. A dev build throws for an empty list, an invalid detent or
 * a repeat; a release build drops those and falls back to `['fit']`.
 */
export function toNativeDetents(
  detents: readonly BottomSheetDetent[] | undefined
): NitroUiSheetDetent[] {
  if (detents == null) return DEFAULT_DETENTS as NitroUiSheetDetent[];
  if (__DEV__ && detents.length === 0) {
    throw new Error(
      'react-native-nitro-ui: a BottomSheet needs at least one detent - pass `detents`, or leave it out for `fit`.'
    );
  }
  const seen = new Set<string>();
  const native: NitroUiSheetDetent[] = [];
  for (const detent of detents) {
    const next = toNativeDetent(detent);
    if (next == null) {
      if (__DEV__) {
        throw new Error(
          `react-native-nitro-ui: ${describeDetent(detent)} is not a BottomSheet detent - use 'fit', 'medium', 'large', { height: points > 0 } or { fraction: 0 < f <= 1 }.`
        );
      }
      continue;
    }
    const key = `${next.kind}:${next.value}`;
    if (seen.has(key)) {
      if (__DEV__) {
        throw new Error(
          `react-native-nitro-ui: the BottomSheet detent ${describeDetent(detent)} is listed twice.`
        );
      }
      continue;
    }
    seen.add(key);
    native.push(next);
  }
  if (native.length === 0) return DEFAULT_DETENTS as NitroUiSheetDetent[];
  return native;
}

/**
 * A detent's share of the full height, where it is known without the screen.
 * `fit` and a fixed height depend on the content or the screen, so they are
 * `null` and never reported as out of order.
 */
function shareOf(detent: NitroUiSheetDetent): number | null {
  switch (detent.kind) {
    case 'medium':
      return 0.5;
    case 'large':
      return 1;
    case 'fraction':
      return detent.value;
    default:
      return null;
  }
}

function warnAboutOrder(detents: readonly NitroUiSheetDetent[]): void {
  let previous: number | null = null;
  for (const detent of detents) {
    const share = shareOf(detent);
    if (share == null) continue;
    if (previous != null && share < previous) {
      console.warn(
        'react-native-nitro-ui: list BottomSheet detents from smallest to largest - ' +
          'the sheet opens at the first, and UIKit expects them in that order.'
      );
      return;
    }
    previous = share;
  }
}

function warnAboutAndroidDetents(detents: readonly NitroUiSheetDetent[]): void {
  const expanded = detents.filter((detent) => detent.kind !== 'medium');
  if (expanded.length > 1) {
    console.warn(
      "react-native-nitro-ui: Android's Material 3 sheet has two rest positions - " +
        "'medium' and one expanded height - so only the largest of " +
        `${expanded.map((d) => (d.kind === 'height' || d.kind === 'fraction' ? `${d.kind} ${d.value}` : d.kind)).join(', ')} ` +
        'is used there (docs/components/bottom-sheet.md).'
    );
  }
}

function detentsSignature(detents: readonly NitroUiSheetDetent[]): string {
  return detents.map((d) => `${d.kind}:${d.value}`).join(',');
}

/**
 * The native detents with a stable identity. An inline `detents={[...]}` is a
 * new array every render and props diff by identity, so without this any parent
 * re-render would re-send the array.
 */
function useNativeDetents(
  detents: readonly BottomSheetDetent[] | undefined
): NitroUiSheetDetent[] {
  const next = toNativeDetents(detents);
  const signature = detentsSignature(next);
  const cache = useRef<{
    signature: string;
    detents: NitroUiSheetDetent[];
  } | null>(null);
  const previous = cache.current;
  if (previous != null && previous.signature === signature) {
    return previous.detents;
  }
  if (__DEV__) {
    warnAboutOrder(next);
    if (Platform.OS === 'android') warnAboutAndroidDetents(next);
  }
  cache.current = { signature, detents: next };
  return next;
}

/** The box native reported for the sheet's content, in points. */
type ContentBox = { width: number; height: number };

/**
 * The content's width before native has reported it: the window's on iOS, and
 * Material's 640 dp sheet cap on Android. Laying out at this width in the commit
 * that presents lets a `fit` sheet open at its real height; native's report
 * corrects a wrong guess (an iPad, a landscape safe area).
 */
function estimatedWidth(windowWidth: number): number {
  return Platform.OS === 'android' ? Math.min(windowWidth, 640) : windowWidth;
}

/** A module-level no-op, so an absent handler is always sent with one identity. */
function notProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * A modal bottom sheet with React Native content: UIKit's sheet presentation
 * (`UISheetPresentationController`) on iOS, Material 3's `ModalBottomSheet` on
 * Android.
 *
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <BottomSheet
 *   isPresented={open}
 *   onIsPresentedChange={setOpen}
 *   detents={['medium', 'large']}
 * >
 *   <Text>Anything React Native can render</Text>
 * </BottomSheet>
 * ```
 *
 * The content is laid out at the sheet's width: a `fit` sheet is as tall as its
 * content and follows it, and a sheet without `fit` gives its content the
 * sheet's height. The component takes no space in the screen that renders it.
 */
export function BottomSheet({
  isPresented,
  onIsPresentedChange,
  children,
  detents,
  onDetentChange,
  onDismiss,
  dismissible = true,
  showsGrabber = true,
  cornerRadius,
  containerColor,
  accessibilityLabel,
  testID,
  hybridRef,
  nuiPerfId = null,
}: BottomSheetProps) {
  const presented = isPresented === true;
  // Whether the newest native event was a dismissal, for the refusal check below.
  const lastNativeWasDismissal = useRef(false);
  const controlled = useControlled<boolean>(presented, false, (next) => {
    lastNativeWasDismissal.current = !next;
    onIsPresentedChange?.(next);
  });
  const nativeDetents = useNativeDetents(detents);
  const processedColor = useProcessedColor(containerColor);
  const { width: windowWidth } = useWindowDimensions();

  // The content stays mounted until native says the sheet has gone, so it
  // survives the exit animation.
  const [mounted, setMounted] = useState(presented);
  if (presented && !mounted) {
    setMounted(true);
  }
  const [box, setBox] = useState<ContentBox | null>(null);
  const contentBoxCallback = useStableCallback(
    (width: number, height: number) => {
      setBox((previous) =>
        previous != null &&
        Math.abs(previous.width - width) < 0.5 &&
        Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height }
      );
    }
  ) as NitroCallbackProp<(width: number, height: number) => void>;
  // If the app still says `isPresented` (a refused dismissal, or a close and an
  // open inside one exit), `presented && !mounted` above remounts the content in
  // the render this causes, before anything commits.
  const dismissedCallback = useStableCallback((ended: boolean) => {
    setMounted(false);
    if (ended) onDismiss?.();
  }) as NitroCallbackProp<(ended: boolean) => void>;
  const detentCallback = useStableCallback(
    onDetentChange ?? notProvided
  ) as NitroCallbackProp<(index: number) => void>;
  const hybridRefCallback = useStableCallback(hybridRef);

  // Warns once about a dismissal the app refused. Only a commit whose echoed
  // event count moved is checked.
  const warnedRefusal = useRef(false);
  const echoedAtLastCheck = useRef(0);
  const echoed = controlled.mostRecentEventCount;
  useEffect(() => {
    const echoedNow = echoed !== echoedAtLastCheck.current;
    echoedAtLastCheck.current = echoed;
    if (!__DEV__ || warnedRefusal.current || !echoedNow) return;
    if (lastNativeWasDismissal.current && presented) {
      warnedRefusal.current = true;
      console.warn(
        'react-native-nitro-ui: a BottomSheet was dismissed by the user but `isPresented` ' +
          'is still true, so it is presented again. Update `isPresented` in ' +
          '`onIsPresentedChange`, or pass `dismissible={false}` to keep the sheet up.'
      );
    }
  }, [echoed, presented]);

  const fits = nativeDetents.some((detent) => detent.kind === 'fit');
  // The node is the content's box: absolute at the origin, as wide as the sheet
  // and, unless `fit` lets Yoga size it from the children, as tall. Native moves
  // the view into the sheet, so none of it is in the app's window.
  const contentStyle = mounted
    ? {
        position: 'absolute' as const,
        left: 0,
        top: 0,
        width: box?.width ?? estimatedWidth(windowWidth),
        height: fits ? undefined : box?.height,
      }
    : CLOSED_STYLE;

  return (
    <NativeNitroUiBottomSheet
      presented={presented}
      mostRecentEventCount={controlled.mostRecentEventCount}
      detents={nativeDetents}
      dismissible={dismissible !== false}
      showsGrabber={showsGrabber !== false}
      cornerRadius={cornerRadius ?? null}
      containerColor={processedColor}
      label={accessibilityLabel ?? null}
      testID={testID ?? null}
      nuiPerfId={nuiPerfId}
      onPresentedChange={controlled.onNativeChange}
      onDetentChange={detentCallback}
      onDismissed={dismissedCallback}
      onContentBox={contentBoxCallback}
      hybridRef={hybridRefCallback ?? undefined}
      // The node's own view stays in the app's tree while its content is in the
      // sheet: it must never take a touch meant for the screen under it.
      pointerEvents="box-none"
      style={contentStyle}
    >
      {/* The content is presented in the sheet, so an enclosing `Form.Row`
       * does not lay it out. */}
      <InsideRowContext.Provider value={false}>
        {mounted ? children : null}
      </InsideRowContext.Provider>
    </NativeNitroUiBottomSheet>
  );
}

const CLOSED_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
} as const;
