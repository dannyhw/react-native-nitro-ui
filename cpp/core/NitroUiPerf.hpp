// Perf marks for native hosts: when props landed on the UI thread and when the view first drew.
// Every entry point takes plain integers: Swift calls it through C++ interop, Kotlin through JNI.

#pragma once

#include "NitroUiClock.hpp"

#include <array>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <vector>

namespace margelo::nitro::nitroui {

  struct NitroUiPerfMark final {
    int32_t instanceId;
    int32_t kind;
    int64_t timeNs;

    NitroUiPerfMark() = default;
    NitroUiPerfMark(int32_t instanceId, int32_t kind, int64_t timeNs):
      instanceId(instanceId), kind(kind), timeNs(timeNs) {}
  };

  class NitroUiPerf final {
    public:
      /// `instanceId` for a view that never set `nuiPerfId`.
      static constexpr int32_t NO_INSTANCE = -1;
      static constexpr int32_t KIND_PROPS_APPLIED = 0;
      static constexpr int32_t KIND_FIRST_FRAME = 1;
      /// `onDropView` ran: an unmount, or the first step of recycling.
      static constexpr int32_t KIND_DROPPED = 2;
      /// `prepareForRecycle` ran. A `dropped` with no `recycled` after it is a real unmount.
      static constexpr int32_t KIND_RECYCLED = 3;
      /// Ring capacity: once full, the oldest marks are dropped.
      static constexpr size_t CAPACITY = 4096;

    public:
      static inline bool isEnabled() {
        return enabled_.load(std::memory_order_relaxed);
      }

      static inline void setEnabled(bool enabled) {
        const std::lock_guard<std::mutex> lock(mutex_);
        count_ = 0;
        write_ = 0;
        enabled_.store(enabled, std::memory_order_relaxed);
      }

      static inline void mark(int32_t instanceId, int32_t kind) {
        markAt(instanceId, kind, nowNs());
      }

      /// `timeNs` must be in the `nowNs()` time base.
      static inline void markAt(int32_t instanceId, int32_t kind, int64_t timeNs) {
        if (!isEnabled()) {
          return;
        }
        const std::lock_guard<std::mutex> lock(mutex_);
        buffer_[write_] = NitroUiPerfMark(instanceId, kind, timeNs);
        write_ = (write_ + 1) % CAPACITY;
        if (count_ < CAPACITY) {
          count_ += 1;
        }
      }

      static inline int64_t nowNs() {
        return NitroUiClock::nowNs();
      }

      static inline std::vector<NitroUiPerfMark> drain() {
        const std::lock_guard<std::mutex> lock(mutex_);
        std::vector<NitroUiPerfMark> result;
        result.reserve(count_);
        // `write_` is one past the newest entry, so the oldest is `count_` back.
        for (size_t offset = 0; offset < count_; offset += 1) {
          const size_t index = (write_ + CAPACITY - count_ + offset) % CAPACITY;
          result.push_back(buffer_[index]);
        }
        count_ = 0;
        write_ = 0;
        return result;
      }

    private:
      static inline std::atomic<bool> enabled_{false};
      static inline std::mutex mutex_{};
      static inline std::array<NitroUiPerfMark, CAPACITY> buffer_{};
      static inline size_t write_ = 0;
      static inline size_t count_ = 0;
  };

} // namespace margelo::nitro::nitroui
