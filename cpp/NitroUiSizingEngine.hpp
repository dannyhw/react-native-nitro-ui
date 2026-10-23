//
//  NitroUiSizingEngine.hpp
//  react-native-nitro-ui
//
//  The intrinsic-sizing core (docs/architecture/sizing.md, design in
//  docs/research/core-architecture.md §1.3).
//
//  Three pieces of data, one lock:
//   - `cache_`: (component, sizingKey, environment) -> size. Written on the
//     main/UI thread, read by `measureContent` on the layout thread.
//   - The ledger: what each instance last laid out with, and whether that was
//     the real cached size. `measureContent` writes it; it is what lets a native
//     report skip a Fabric commit when there is nothing to correct.
//   - The registry: instance id -> the Fabric `State` of that instance, so a
//     size measured on the main thread can be pushed into the shadow tree.
//
//  `measureContent` must stay a pure C++ lookup (core-architecture §1.4), so
//  every entry point here is a lock plus a hash map, and none of them calls into
//  SwiftUI, Compose, or the JSI runtime.
//

#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace margelo::nitro::nitroui {

  /**
   * A Fabric `State`, type-erased.
   *
   * `const` all the way through: the engine never dereferences it, it keeps a weak
   * reference and hands it back to the component's own typed push function, which
   * casts to a `shared_ptr<const ConcreteState>`. `void` instead of
   * `react::State` is what keeps this header free of React Native headers, so the
   * engine compiles - and is tested - on the host (`bun run test:native`) and
   * never drags Fabric into a header Swift parses.
   */
  using NitroUiStateRef = std::shared_ptr<const void>;
  using NitroUiWeakState = std::weak_ptr<const void>;

  /**
   * Identity of one sizing configuration: (component, sizingKey, environment).
   *
   * Two independent 64-bit hashes rather than the key string, so a cache hit
   * verifies both and a collision cannot silently hand one control another's
   * size - while `measureContent` never compares strings.
   */
  struct NitroUiSizeKey final {
    uint64_t hash = 0;
    uint64_t check = 0;

    bool operator==(const NitroUiSizeKey&) const = default;
    /// A key of zero means "no configuration", i.e. never measured.
    explicit operator bool() const { return hash != 0; }
  };

  /**
   * A size plus the configuration it belongs to. This is what lives in Fabric
   * state, what the cache holds, and what a host reports.
   */
  struct NitroUiMeasuredSize final {
    /// Platform units: iOS points, Android density-independent pixels.
    float width = 0;
    float height = 0;
    NitroUiSizeKey key{};
    /// `NitroUiSizingEngine::kFlag*`.
    uint32_t flags = 0;

    bool operator==(const NitroUiMeasuredSize&) const = default;
    /// A size with no key is "never measured", which is also the default state.
    bool valid() const { return key.hash != 0; }
    /// Same configuration, same size within the epsilon (policies must match).
    bool nearlyEquals(const NitroUiMeasuredSize& other) const;
  };

  /**
   * The push for one concrete component: knows the state type, so it can build
   * new state data that keeps the *latest* props (core-architecture §1.3).
   */
  using NitroUiPushFn = void (*)(const NitroUiStateRef&, const NitroUiMeasuredSize& measured, bool immediate);

  /** What a component's generated descriptor registered itself as. */
  struct NitroUiComponentBinding final {
    uint32_t componentHash = 0;
    /// Pull `nuiSizingId` out of the state's props and bind that instance.
    void (*bindInstance)(const NitroUiStateRef& state) = nullptr;
    NitroUiPushFn push = nullptr;
  };

  /**
   * Counters for the P1 questions: how many corrections a mount cost, and how
   * long a flush took. Reported to JS by `nitroUiCore.sizingStats()`.
   *
   * They are counters and not a sampling profiler on purpose: the exit criterion
   * they serve is a number ("a pre-warmed mount costs zero corrections", "200
   * cold instances flush in well under a frame"), and a counter is cheap enough
   * to leave in forever.
   */
  struct NitroUiSizingCounters final {
    /// Distinct configurations with a measured size.
    int64_t cachedSizes = 0;
    /// Value of `invalidateEnvironment`'s counter, folded into every key.
    int64_t environmentEpoch = 1;
    /// `measureContent` answers given (every layout pass of every sized node).
    int64_t measurements = 0;
    /// Reports accepted for correction, and reports dropped because the answer
    /// already matched (the pre-warmed case: these should outnumber accepts).
    int64_t reportsQueued = 0;
    int64_t reportsDropped = 0;
    /// Fabric state updates actually issued, split by priority: a correction
    /// inside the per-turn budget is `unstable_Immediate` (same frame), the rest
    /// are batched into the next commit.
    int64_t correctionsImmediate = 0;
    int64_t correctionsBatched = 0;
    /// Flushes that changed a size - on Android, exactly the frames that were
    /// skipped because the layout about to be drawn was stale.
    int64_t flushes = 0;
    int64_t staleFramesSkipped = 0;
    /// Engine time of the last and the worst flush, nanoseconds. Does not include
    /// the re-layout the push causes - that is a Fabric commit, and it is what
    /// the mount benchmarks measure end to end.
    int64_t lastFlushNs = 0;
    int64_t maxFlushNs = 0;
    /// Trace events dropped because the ring wrapped.
    int64_t traceDropped = 0;
  };

  /**
   * One entry of the sizing trace - the per-frame layout log P1 asks for.
   *
   * Only size *changes* are recorded, so a mounted control costs two or three
   * events rather than one per layout pass, and the ring cannot fill up.
   */
  struct NitroUiSizingTraceEntry final {
    int64_t instanceId = 0;
    /// One of `STAGE_*` below.
    int32_t stage = 0;
    float width = 0;
    float height = 0;
    int64_t timeNs = 0;
  };

  class NitroUiSizingEngine final {
    public:
      /// Bit in `NitroUiMeasuredSize::flags` for the fill-width policy.
      static constexpr uint32_t kFlagFillWidth = 1u << 0;
      /// Two reported sizes closer than this are the same size (0.5 pt / 0.9 dp,
      /// like true-sheet and react-native-screens).
      static constexpr float kEpsilon = 0.5f;
      /// Immediate Fabric commits one flush may issue, like Expo's
      /// `kImmediateSizeUpdateBudgetPerTurn`. The rest go out asynchronously.
      static constexpr int32_t kImmediateBudgetPerTurn = 2;

      /// Trace stages: the engine laid an instance out with this size, the engine
      /// pushed a correction for it, and the platform drew it at this box size.
      static constexpr int32_t kStageLaidOut = 0;
      static constexpr int32_t kStageCorrected = 1;
      static constexpr int32_t kStageDrew = 2;
      /// Trace capacity; the oldest events drop.
      static constexpr size_t kTraceCapacity = 512;

    public:
      static NitroUiSizingEngine& shared();

      /// Hash of a component name alone (the fallback map is per component).
      static uint32_t componentHash(const char* componentName);

      /// The identity of one sizing configuration (docs/architecture/sizing.md).
      /// Pure, so it can be unit tested without a shadow tree.
      static NitroUiSizeKey keyFor(const char* componentName, const std::string& sizingKey, uint64_t environmentEpoch);

      /// Current environment epoch, folded into every key.
      uint64_t environmentEpoch() const;

      /// The environment changed: drop every cached size and ledger entry.
      void invalidateEnvironment();

      // MARK: component registry (once per component, at descriptor construction)

      void registerComponent(const char* componentName, NitroUiComponentBinding binding);

      /// Called by the platform whenever a node's state (re)arrives: `updateState`
      /// on iOS, `updateState` plus JNI on Android. Registers the instance for
      /// pushes, and re-registers it after our own push produces a new `State`.
      void bind(const char* componentName, const NitroUiStateRef& state);

      /**
       * The typed half of `bind`, called by `bindMeasuredInstance` once the
       * instance id is out of the props: remember how to push to this instance.
       */
      void registerInstance(int64_t instanceId, uint32_t componentHash, NitroUiPushFn push, const NitroUiStateRef& state);

      // MARK: layout thread

      /**
       * What size to lay out with, and record the answer in the ledger.
       * Cache -> state -> per-component fallback, in that order
       * (core-architecture §1.3). Never calls into native UI.
       *
       * Returns a size whose `key` is always the key of this configuration, so
       * the caller can hand it straight to Fabric state.
       */
      NitroUiMeasuredSize measure(const char* componentName, int64_t instanceId, const std::string& sizingKey, const NitroUiMeasuredSize& fromState);

      // MARK: main / UI thread

      /**
       * The size to use for a configuration that was never measured. Components
       * register one (their documented platform size) so a cache miss is a good
       * guess rather than 0x0. Falls back to nothing until the first real
       * measurement, which overwrites it.
       */
      void setFallback(const char* componentName, float width, float height, uint32_t flags);

      /**
       * Put a measured size in the cache without an instance: `prewarm` (§1.3),
       * and the on-device tests that need a known cold/warm state.
       */
      void seedSize(const char* componentName, const std::string& sizingKey, float width, float height, uint32_t flags);

      /**
       * The host measured itself. Queues the correction; `flush` applies it.
       * A report that agrees with the cache, or with what the instance already
       * laid out with, is dropped here - that is what makes a pre-warmed mount
       * cost zero extra commits.
       */
      void report(int64_t instanceId, float width, float height, uint32_t flags);

      /**
       * Apply the queued reports as Fabric state updates. Returns `true` when at
       * least one size changed, i.e. the layout about to be drawn is stale.
       */
      bool flush();

      /// Whether anything is waiting for `flush`. For the platform schedulers.
      bool hasPendingReports() const;

      /// Number of cached sizes. Diagnostics and tests.
      size_t cachedSizeCount() const;

      /**
       * Adopt a component's declared size as this environment's cached answer for
       * its default configuration (the empty sizing key), so the first instance
       * mounted after this is laid out from the cache and costs no correction.
       *
       * Returns `false` for a component that has declared nothing - it is either
       * not loaded or does not size itself, and saying so is the point: silently
       * "pre-warming" nothing would be worse. A configuration with a non-default
       * sizing key is not covered (the engine has no way to know its key), and
       * neither is a control whose real size has never been measured on this
       * device - see the pre-warm section of docs/architecture/sizing.md.
       */
      bool prewarm(const char* componentName);

      /// The counters above, taken under the lock.
      NitroUiSizingCounters stats() const;

      /// Record the box a platform drew an instance at (first frame only).
      void recordDrawnSize(int64_t instanceId, float width, float height);

      /// Trace on/off (off by default: `measure` only compares two floats).
      void setTraceEnabled(bool enabled);

      /// Everything traced so far, oldest first, and start over.
      std::vector<NitroUiSizingTraceEntry> drainTrace();

    private:
      struct SizeEntry final {
        NitroUiSizeKey key{};
        NitroUiMeasuredSize size{};
      };

      struct LedgerEntry final {
        NitroUiSizeKey key{};
        bool exact = false;
      };

      struct BoundInstance final {
        uint32_t componentHash = 0;
        NitroUiPushFn push = nullptr;
        NitroUiWeakState state{};
      };

      struct Report final {
        int64_t instanceId = 0;
        float width = 0;
        float height = 0;
        uint32_t flags = 0;
      };

      /// Apply reports queued by `report`; takes the lock itself.
      bool applyReports(std::vector<Report>& reports);
      void recordTraceLocked(int64_t instanceId, int32_t stage, float width, float height);

      /// Append a trace event. Caller holds the lock (hence "Locked"): `measure`
      /// and `applyReports` record from inside it, and taking the lock again
      /// would be the same mistake as pushing Fabric state from under it.

      mutable std::shared_mutex mutex_;
      /// `NitroUiSizeKey::hash` -> entry (the entry re-checks the full key).
      std::unordered_map<uint64_t, SizeEntry> cache_;
      std::unordered_map<uint32_t, NitroUiMeasuredSize> fallbacks_;
      std::unordered_map<int64_t, LedgerEntry> ledger_;
      /// hash -> instances that last laid out with a size that is not the cache's.
      std::unordered_map<uint64_t, std::vector<int64_t>> needsCorrection_;
      std::unordered_map<int64_t, BoundInstance> registry_;
      std::unordered_map<std::string, NitroUiComponentBinding> components_;
      std::vector<Report> pending_;
      /// Size counters (see `NitroUiSizingCounters`). Guarded by `mutex_` like the
      /// rest, except `traceDropped_`, which is only written while tracing.
      NitroUiSizingCounters stats_{};
      /// The last size each instance was told to lay out with, so the trace
      /// records a change and not every layout pass.
      std::unordered_map<int64_t, NitroUiMeasuredSize> lastLaidOut_{};
      std::vector<NitroUiSizingTraceEntry> trace_{};
      std::atomic<bool> traceEnabled_{false};
      /// Folded into every key; bumped by `invalidateEnvironment`.
      uint64_t environmentEpoch_ = 1;
  };

} // namespace margelo::nitro::nitroui
