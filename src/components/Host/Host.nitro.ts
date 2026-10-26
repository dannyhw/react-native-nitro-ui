import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * Native props of the `NitroUiHost` Hybrid View.
 *
 * The Host has **no native props**: it owns no state of its own, it renders
 * nothing of its own, and everything a control inside it needs already travels
 * on that control (T16 spike, `docs/tasks/T16-host-spike.md`). Base `View` props
 * (`style`, layout, testID, a11y) are RN's, applied by the view manager.
 */
export interface NitroUiHostProps extends HybridViewProps {}

/**
 * Methods of the Host. None: the Host takes no imperative calls, and what a
 * control inside it can do (`measureContent()`) stays on that control.
 */
export interface NitroUiHostMethods extends HybridViewMethods {}

/**
 * The Hybrid View behind the `Host` wrapper.
 *
 * Android only in behaviour: `Host.tsx` renders a plain view on iOS, so this
 * Hybrid View is never instantiated there — it exists because nitrogen requires
 * a native implementation on both platforms for a Hybrid View, and
 * `HybridNitroUiHost.swift` is the documented no-op that satisfies it. The iOS
 * passthrough is permanent, not a port pending: T17 built and measured an iOS Host and
 * D23's outcome was not to ship it.
 *
 * Apps render `Host`, not this type; it is exported because this repo's example and
 * bench screens are separate packages and cannot reach a non-exported component.
 */
export type NitroUiHost = HybridView<NitroUiHostProps, NitroUiHostMethods>;
