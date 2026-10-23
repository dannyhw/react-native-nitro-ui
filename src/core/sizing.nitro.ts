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
   * Every prop that changes the control's size, serialised by the JS wrapper -
   * for example `"Switch|"` or `"Button|bordered|large|Save"`. Two instances
   * with the same component and key share one cached size, so a key must cover
   * exactly the size-affecting inputs (plus anything in the environment, which
   * native folds in itself through an epoch).
   *
   * Non-optional (D7 / nitro#1184): a wrapper that has nothing size-related to
   * send passes `""`, which is a real configuration - not "unset".
   */
  nuiSizingKey: string;
  /**
   * Stable id of this mounted instance, assigned by the JS wrapper from a
   * module-level counter. The native host reports its measured size against it,
   * and only the instance that asked gets a Fabric state update.
   *
   * `0` means "sizing off for this view" (`NitroUiSizing.NO_INSTANCE`), which is
   * what a recycled or not-yet-mounted native view holds.
   */
  nuiSizingId: number;
}
