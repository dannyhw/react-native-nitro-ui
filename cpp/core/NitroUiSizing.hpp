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
     * The environment changed (dynamic type, bold text, font scale, density,
     * locale): drop every cached size so all controls measure again.
     */
    static void invalidateEnvironment();

    /// Number of cached sizes. For diagnostics and tests.
    static int64_t cachedSizeCount();
  };

} // namespace margelo::nitro::nitroui
