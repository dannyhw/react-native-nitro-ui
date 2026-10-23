//
//  NitroUiSizing.hpp
//  react-native-nitro-ui
//
//  The native host's door into the intrinsic-sizing core (docs/architecture/sizing.md).
//
//  Deliberately primitive and dependency-free, exactly like `NitroUiPerf.hpp`:
//  this header is `public_header_files` in the podspec, so Swift's C++ interop
//  parses it, and it must therefore not include a single React Native header.
//  Everything is plain integers, and the implementation lives in
//  `cpp/NitroUiSizingEngine.cpp`.
//

#pragma once

#include <cstdint>

namespace margelo::nitro::nitroui {

  /**
   * Sizing policies. The native control declares one when it reports a size, and
   * the shadow node applies it (docs/research/core-architecture.md §1.3).
   * A plain int32 so Swift and Kotlin can pass it without importing a C++ enum.
   */
  struct NitroUiSizing final {
    /// `nuiSizingId` of a view that never set one (sizing off for that view).
    static constexpr int64_t NO_INSTANCE = 0;
    /// The control's intrinsic size is its size: Switch, Button, SegmentedControl.
    static constexpr int32_t POLICY_INTRINSIC = 0;
    /// Width comes from the Yoga box when it is finite, height stays intrinsic:
    /// Slider, linear Progress, wheel Picker.
    static constexpr int32_t POLICY_FILL_WIDTH = 1;

    /**
     * Report the size the hosted control measured on the main/UI thread.
     *
     * Never blocks and never touches Fabric from here: the report is queued and
     * applied by `flush()`, which the platform runs at the end of the turn
     * (iOS: a run-loop observer ordered below Core Animation's commit observer;
     * Android: an `OnPreDrawListener`). `instanceId` is the view's `nuiSizingId`.
     */
    static void report(int64_t instanceId, double width, double height, int32_t policy);

    /**
     * Apply every queued report as one batch of Fabric state updates.
     * Returns `true` when at least one size actually changed, i.e. the layout
     * that is about to be drawn is stale and the caller should skip the frame.
     */
    static bool flush();

    /**
     * `flush` with the platform's own budget of synchronous state updates, which
     * is what a platform pays per one: on Android a synchronous push is a commit
     * inside the pre-draw pass that this flush cancels anyway. The Android host
     * spends one; iOS spends the default two (`docs/architecture/sizing.md` §3).
     */
    static bool flush(int32_t immediateBudget);

    /**
     * The environment changed (dynamic type, bold text, font scale, density,
     * locale): drop every cached size so all controls measure again.
     */
    static void invalidateEnvironment();

    /**
     * `invalidateEnvironment` only if the environment this signature describes is
     * not the last one seen.
     *
     * Both platforms call this from a *per-view* callback (`traitCollectionDidChange`
     * and `onConfigurationChanged` fire once per mounted view for one user action),
     * and the signature is what makes one user action one epoch bump: pass
     * something like `category=XL,legibility=0` or `fontScale=1.3,densityDpi=420,
     * locale=en-US`, and an unchanged signature costs one string compare
     * (review S2). A rotation, which is a configuration change that moves no size,
     * therefore invalidates nothing. Pass `nullptr`/empty to force a bump.
     */
    static void invalidateEnvironmentIfChanged(const char* signature);

    /**
     * Declare the size to lay a component's first instance out with, before
     * anything has been measured - the platform's documented control size.
     *
     * A component calls this once, from its own native type, because only it
     * knows what it hosts (and, on iOS, which OS's control size applies). The
     * first real measurement overwrites it, so this is only ever the first
     * frame's guess - but it has to be a good one: giving SwiftUI or Compose a
     * box smaller than the control makes it paint outside it.
     */
    static void setFallback(const char* componentName, double width, double height, int32_t policy);

    /**
     * Record the box an instance was actually drawn at, once, on its first
     * frame. Sizing never reads this: it is the trace that lets an on-device
     * test assert that the first *drawn* frame had the right box, which is the
     * difference between "Yoga was corrected" and "nobody saw a wrong size".
     *
     * `width`/`height` are in platform units, and `NO_INSTANCE` records nothing.
     */
    static void recordDrawnSize(int64_t instanceId, double width, double height);

    /// Number of cached sizes. For diagnostics and tests.
    static int64_t cachedSizeCount();

    /**
     * The instance is finished: its host is dropping or recycling the view.
     *
     * Both platforms call this from `onDropView`/`prepareForRecycle`, next to
     * where they clear their own `sizingInstanceId`. It is what keeps the engine's
     * per-instance maps from growing for the life of the process - a list that
     * scrolls mounts and unmounts the same control hundreds of times, and waiting
     * for the Fabric `State` to expire instead never notices an instance that was
     * never pushed to (review S3). Idempotent, and `NO_INSTANCE` does nothing.
     */
    static void forget(int64_t instanceId);
  };

} // namespace margelo::nitro::nitroui
