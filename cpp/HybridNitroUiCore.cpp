//
//  HybridNitroUiCore.cpp
//  react-native-nitro-ui
//

#include "HybridNitroUiCore.hpp"

#include "NitroUiSizingEngine.hpp"
#include "core/NitroUiClock.hpp"
#include "core/NitroUiPerf.hpp"

#include <string>

namespace margelo::nitro::nitroui {

  double HybridNitroUiCore::now() {
    // Nanosecond resolution, reported in milliseconds, in the D1 time base
    // (docs: src/NitroUiCore.nitro.ts and cpp/core/NitroUiClock.hpp).
    return NitroUiClock::nowMs();
  }

  void HybridNitroUiCore::setPerfEnabled(bool enabled) {
    NitroUiPerf::setEnabled(enabled);
  }

  std::vector<NitroUiPerfEvent> HybridNitroUiCore::drainPerf() {
    // The `kind` strings are part of the JS-visible contract
    // (`NitroUiPerfEvent.kind`); the ints come from NitroUiPerf.
    static const std::string propsApplied = "propsApplied";
    static const std::string firstFrame = "firstFrame";
    static const std::string unknown = "unknown";

    std::vector<NitroUiPerfEvent> events;
    for (const auto& mark: NitroUiPerf::drain()) {
      const std::string& kind = mark.kind == NitroUiPerf::KIND_PROPS_APPLIED
        ? propsApplied
        : (mark.kind == NitroUiPerf::KIND_FIRST_FRAME ? firstFrame : unknown);
      // `time` is milliseconds in the same base as `now()`.
      events.emplace_back(static_cast<double>(mark.instanceId), kind,
                          static_cast<double>(mark.timeNs) / 1000000.0);
    }
    return events;
  }

  // MARK: - Sizing diagnostics

  NitroUiSizingStats HybridNitroUiCore::sizingStats() {
    const NitroUiSizingCounters engine = NitroUiSizingEngine::shared().stats();
    NitroUiSizingStats stats;
    stats.cachedSizes = static_cast<double>(engine.cachedSizes);
    stats.environmentEpoch = static_cast<double>(engine.environmentEpoch);
    stats.measurements = static_cast<double>(engine.measurements);
    stats.reportsQueued = static_cast<double>(engine.reportsQueued);
    stats.reportsDropped = static_cast<double>(engine.reportsDropped);
    stats.correctionsImmediate = static_cast<double>(engine.correctionsImmediate);
    stats.correctionsBatched = static_cast<double>(engine.correctionsBatched);
    stats.flushes = static_cast<double>(engine.flushes);
    stats.staleFramesSkipped = static_cast<double>(engine.staleFramesSkipped);
    // Nanoseconds in, milliseconds out: the same unit `now()` reports, so a test
    // can compare a flush with a mount duration without converting.
    stats.lastFlushMs = static_cast<double>(engine.lastFlushNs) / 1000000.0;
    stats.maxFlushMs = static_cast<double>(engine.maxFlushNs) / 1000000.0;
    stats.traceDropped = static_cast<double>(engine.traceDropped);
    return stats;
  }

  void HybridNitroUiCore::seedSizingSize(const std::string& componentName, const std::string& sizingKey, double width,
                                         double height) {
    NitroUiSizingEngine::shared().seedSize(componentName.c_str(), sizingKey, static_cast<float>(width),
                                           static_cast<float>(height), 0u);
  }

  void HybridNitroUiCore::invalidateSizingEnvironment() {
    NitroUiSizingEngine::shared().invalidateEnvironment();
  }

  double HybridNitroUiCore::prewarmSizing(const std::vector<std::string>& componentNames) {
    double prewarmed = 0;
    for (const std::string& name: componentNames) {
      if (NitroUiSizingEngine::shared().prewarm(name.c_str())) {
        prewarmed += 1;
      }
    }
    return prewarmed;
  }

  void HybridNitroUiCore::setSizingTraceEnabled(bool enabled) {
    NitroUiSizingEngine::shared().setTraceEnabled(enabled);
  }

  std::vector<NitroUiSizingTraceEvent> HybridNitroUiCore::drainSizingTrace() {
    static const std::string laidOut = "laidOut";
    static const std::string corrected = "corrected";
    static const std::string drew = "drew";
    static const std::string unknown = "unknown";

    std::vector<NitroUiSizingTraceEvent> events;
    for (const auto& entry: NitroUiSizingEngine::shared().drainTrace()) {
      const std::string& stage = entry.stage == NitroUiSizingEngine::kStageLaidOut
        ? laidOut
        : (entry.stage == NitroUiSizingEngine::kStageCorrected
               ? corrected
               : (entry.stage == NitroUiSizingEngine::kStageDrew ? drew : unknown));
      events.emplace_back(static_cast<double>(entry.instanceId), stage, static_cast<double>(entry.width),
                          static_cast<double>(entry.height), static_cast<double>(entry.timeNs) / 1000000.0);
    }
    return events;
  }

} // namespace margelo::nitro::nitroui
