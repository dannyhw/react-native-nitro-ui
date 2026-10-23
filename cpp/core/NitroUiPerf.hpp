//
//  NitroUiPerf.hpp
//  react-native-nitro-ui
//
//  Minimal perf marks for native hosts (docs/architecture/core.md). Black-box
//  frame measurements are T02's BenchProbe; this only answers "when did props
//  land on the UI thread, and when did the view first draw".
//
//  Header-only and deliberately primitive: Swift reaches it through C++ interop
//  (`margelo.nitro.nitroui.NitroUiPerf`) and Kotlin through JNI, so every entry
//  point takes plain integers. When marks are disabled - the default - a host
//  pays one relaxed atomic load per mark site and nothing else. When enabled it
//  is a plain mutex, not a lock-free queue: marks are diagnostics (a benchmark
//  turns them on for one run), a mark site is a handful per commit at most, and
//  a lock-free ring would buy nothing measurable while being much harder to
//  prove correct. Disabled hosts never touch it.
//

#pragma once

#include "NitroUiClock.hpp"

#include <array>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <vector>

namespace margelo::nitro::nitroui {

  /**
   * A single mark. `kind` is one of `KIND_*` below; kept as a plain int32 so
   * Swift and Kotlin can pass it without importing a C++ enum.
   */
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
      /// Props from React were applied to the native model and committed.
      static constexpr int32_t KIND_PROPS_APPLIED = 0;
      /// The hosted content drew its first frame.
      static constexpr int32_t KIND_FIRST_FRAME = 1;
      /// Marks fit in the ring until someone drains it; then the oldest drop.
      static constexpr size_t CAPACITY = 4096;

    public:
      /// Whether marks are being recorded (relaxed load - free on the hot path).
      static inline bool isEnabled() {
        return enabled_.load(std::memory_order_relaxed);
      }

      /// Turn recording on or off, and throw away anything buffered before.
      static inline void setEnabled(bool enabled) {
        const std::lock_guard<std::mutex> lock(mutex_);
        count_ = 0;
        write_ = 0;
        enabled_.store(enabled, std::memory_order_relaxed);
      }

      /// Record a mark at `nowNs()`. No-op unless enabled.
      static inline void mark(int32_t instanceId, int32_t kind) {
        markAt(instanceId, kind, nowNs());
      }

      /// Record a mark with an explicit timestamp (same base as `nowNs()`).
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
        // Once the ring wraps, `drain` starts one past the newest write, so the
        // oldest marks fall out instead of the buffer growing.
      }

      /// Monotonic nanoseconds, the same base as `HybridNitroUiCore::now()`
      /// (`CLOCK_UPTIME_RAW` / `CLOCK_MONOTONIC`, DECISIONS D1 - so marks are
      /// directly comparable with `CADisplayLink` and `Choreographer` times).
      static inline int64_t nowNs() {
        return NitroUiClock::nowNs();
      }

      /// Take every buffered mark, oldest first, and clear the buffer.
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
