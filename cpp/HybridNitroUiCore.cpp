//
//  HybridNitroUiCore.cpp
//  react-native-nitro-ui
//

#include "HybridNitroUiCore.hpp"

#include "core/NitroUiPerf.hpp"

#include <string>
#include <chrono>

namespace margelo::nitro::nitroui {

  double HybridNitroUiCore::now() {
    const auto sinceEpoch = std::chrono::steady_clock::now().time_since_epoch();
    // Nanosecond precision, reported in milliseconds (docs: src/NitroUiCore.nitro.ts).
    return std::chrono::duration<double, std::milli>(sinceEpoch).count();
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

} // namespace margelo::nitro::nitroui
