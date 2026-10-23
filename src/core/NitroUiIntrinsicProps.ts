/**
 * Props every self-sizing component's Hybrid View must carry.
 *
 * Yoga has to know a control's size before the control can be measured -
 * SwiftUI and Compose are main-thread-only, and `measureContent` runs on the
 * layout thread under the commit lock, so the shadow node reads a C++ cache
 * instead of asking native (core-architecture §1.4). These two props are how
 * the cache knows *which* configuration to answer for, and which mounted view
 * a measured size belongs to. See `docs/architecture/sizing.md`.
 *
 * @internal Not semver surface: users never pass these (DECISIONS D14).
 */
export interface NitroUiIntrinsicProps {
  /**
   * The size-affecting props of this instance, serialised by the JS wrapper -
   * for example `""` for a Switch or `"bordered|large|Save"` for a Button.
   * *Variant only*: the engine composes the cache identity itself from the
   * component name, this key, and the environment epoch, so a key never repeats
   * the component name (and `prewarmSizing([name])` can find the default
   * configuration, which is the one with an empty variant).
   *
   * Two instances with the same component and key share one cached size, so the
   * key must cover exactly the size-affecting inputs - anything the environment
   * decides (text size, density, OS control size) is not part of it, because
   * native folds the environment in through an epoch.
   *
   * Non-optional (D7 / nitro#1184): a wrapper that has nothing size-related to
   * send passes `""`, which is a real configuration - not "unset".
   */
  nuiSizingKey: string;
  /**
   * Stable id of this mounted instance, taken from `useSizingId()` (`src/core`).
   * The native host reports its measured size against it, and only the instance
   * that asked gets a Fabric state update.
   *
   * It must come from that hook and not from a counter of the component's own:
   * the engine is process-global and keyed by this number alone, so a per-module
   * counter would collide with every other self-sizing component, with a second
   * JS runtime, and with the previous run after a reload.
   *
   * `0` means "sizing off for this view" (`NitroUiSizing.NO_INSTANCE`), which is
   * what a recycled or not-yet-mounted native view holds.
   */
  nuiSizingId: number;
}
