import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * Native props of the `NitroUiProgress` Hybrid View.
 *
 * A Progress has **no callbacks and no event-count handshake** (`docs/tasks/
 * G3-progress.md`): nothing on it can be changed by the user, so React's `value`
 * is always the truth and native never holds a newer one. That is what makes a
 * Progress cheap to drive at 60 Hz - one `number` prop per commit, one batch, and
 * no round trip to wait for.
 *
 * Same rules as every other component (DECISIONS D7/D7b): every prop is
 * `T | null` and never optional, and the JS wrapper (`Progress.tsx`) always sends
 * all of them.
 */
export interface NitroUiProgressProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * `'linear'` or `'circular'`.
   *
   * A plain `string` rather than a union because it is also the sizing key (see
   * `nuiSizingKey`), and because a string prop costs one comparison per commit.
   * The wrapper is the only thing that writes it, so the two names it accepts are
   * the only two that reach here; anything else behaves as `'linear'`.
   */
  variant: string;
  /**
   * The fraction shown, 0...1, or `null` for an **indeterminate** indicator.
   *
   * Out-of-range values are clamped natively rather than rejected: progress that
   * arrives from a download callback overshoots, and an indicator that vanished
   * because of it is worse than one that looked full for a frame. `NaN` counts as
   * out of range (to 0), because it is what an unfinished division produces.
   */
  value: number | null;
  /**
   * RN-processed (`processColor`) ARGB colour of the indicator, or `null` for the
   * platform default: SwiftUI `.tint()` / M3 `color`.
   */
  tintColor: number | null;
  /**
   * RN-processed ARGB colour of the track behind the indicator, or `null` for the
   * platform default.
   *
   * Android only today: Material 3 gives every progress indicator a `trackColor`
   * and SwiftUI's `ProgressView` has nothing that addresses its track
   * (`docs/components/progress.md`). It is still a prop on both platforms, as
   * every prop is, so the JS API has one meaning rather than two.
   */
  trackColor: number | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the indicator itself. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
}

export interface NitroUiProgressMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.4).
   *
   * Which half of the answer means something depends on the variant: a linear
   * Progress is `fillWidth` (its height is its own, its width is Yoga's box) and a
   * circular one is `intrinsic` (both halves are its own).
   */
  measureContent(): NitroUiSize;

  /**
   * TEMPORARY, test-only: what the control is **displaying**, as one line.
   *
   * Written where the control is drawn - the SwiftUI body, the Composable - so it
   * is a reading of the hosted control rather than an echo of the prop: a commit
   * that stored the number without repainting the ring fails here and passes on
   * the prop, which is the difference G1 needed a drag for and a control with no
   * gestures does not have. Answers `displayed=<value>` for a determinate
   * indicator (`<value>` is what the drawing code was handed) and
   * `displayed=indeterminate` for an indeterminate one.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can read a
   * progress value out of a hosted control.
   */
  nuiTestDisplayedValue(): string;

  /**
   * TEMPORARY, test-only: whether this control is **allowed to be animating**
   * right now - `true` only for an indeterminate indicator whose view is mounted,
   * in a window, and not recycled.
   *
   * An indeterminate indicator is the only thing in this library that draws
   * itself forever, so "the animation stops when nobody can see it" is a claim
   * with a CPU cost behind it, and it needs something readable to be testable.
   * What exactly backs `true`/`false` is platform-shaped and written down in
   * `HybridNitroUiProgress` on both sides; what the harness asserts is the
   * invariant both platforms share - mounted and on screen answers `true`, and a
   * view that has been dropped, recycled or detached answers `false`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestIsAnimating(): boolean;
}

/**
 * The Hybrid View behind the `Progress` wrapper.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiProgress = HybridView<
  NitroUiProgressProps,
  NitroUiProgressMethods
>;
