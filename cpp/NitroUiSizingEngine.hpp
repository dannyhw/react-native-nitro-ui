// The intrinsic-sizing core: a size cache, a per-instance ledger and a registry of Fabric states,
// behind one lock. No entry point calls into SwiftUI, Compose or the JS runtime.

#pragma once

#include <array>
#include <atomic>
#include <cstdint>
#include <deque>
#include <memory>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace margelo::nitro::nitroui {

  /// A type-erased Fabric `State`, which the engine never dereferences. `void` keeps React Native
  /// headers out of this file, so the engine builds for host tests and Swift can parse the header.
  using NitroUiStateRef = std::shared_ptr<const void>;
  using NitroUiWeakState = std::weak_ptr<const void>;

  /// Identity of one sizing configuration: (component, sizingKey, environment). Two independent
  /// hashes, so a cache hit verifies both and a collision cannot hand one control another's size.
  struct NitroUiSizeKey final {
    uint64_t hash = 0;
    uint64_t check = 0;

    bool operator==(const NitroUiSizeKey&) const = default;
    /// A key of zero means "no configuration", i.e. never measured.
    explicit operator bool() const { return hash != 0; }
  };

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

  /// A component's typed push: builds new state data that keeps the latest props.
  using NitroUiPushFn = void (*)(const NitroUiStateRef&, const NitroUiMeasuredSize& measured, bool immediate);

  /** What a component's generated descriptor registered itself as. */
  struct NitroUiComponentBinding final {
    uint32_t componentHash = 0;
    /// Pull `nuiSizingId` out of the state's props and bind that instance.
    void (*bindInstance)(const NitroUiStateRef& state) = nullptr;
    NitroUiPushFn push = nullptr;
  };

  /// Reported to JS by `nitroUiCore.sizingStats()`.
  struct NitroUiSizingCounters final {
    /// Distinct configurations with a measured size.
    int64_t cachedSizes = 0;
    /// Value of `invalidateEnvironment`'s counter, folded into every key.
    int64_t environmentEpoch = 1;
    /// `measureContent` answers given (every layout pass of every sized node).
    int64_t measurements = 0;
    /// Reports accepted for correction, and reports dropped because the answer already matched.
    int64_t reportsQueued = 0;
    int64_t reportsDropped = 0;
    /// Fabric state updates issued. A correction inside the per-flush budget is synchronous (same
    /// frame); the rest are batched into the next commit.
    int64_t correctionsImmediate = 0;
    int64_t correctionsBatched = 0;
    /// Flushes run, and flushes that changed a size. On Android the latter is also the number of
    /// frames skipped as stale, because the flusher returns `false` from `onPreDraw` on those.
    int64_t flushes = 0;
    int64_t changedFlushes = 0;
    /// Reports that confirmed the size an instance was already laid out with.
    int64_t reportsConfirmed = 0;
    /// Engine time of the last and the worst flush, in nanoseconds. Excludes the re-layout the push
    /// causes.
    int64_t lastFlushNs = 0;
    int64_t maxFlushNs = 0;
    /// Trace events dropped because the ring wrapped.
    int64_t traceDropped = 0;
    /// Live ledger and registry entries, one per instance. Mount/unmount churn must keep these
    /// flat.
    int64_t ledgerEntries = 0;
    int64_t registryEntries = 0;
  };

  /// One sizing trace event. Only size changes are recorded, not every layout pass.
  struct NitroUiSizingTraceEntry final {
    int64_t instanceId = 0;
    /// One of `NitroUiSizingEngine::kStage*`.
    int32_t stage = 0;
    float width = 0;
    float height = 0;
    int64_t timeNs = 0;
  };

  class NitroUiSizingEngine final {
    public:
      /// Bit in `NitroUiMeasuredSize::flags` for the fill-width policy.
      static constexpr uint32_t kFlagFillWidth = 1u << 0;
      /// Two sizes closer than this are the same size: half a platform unit (pt on iOS, dp on
      /// Android).
      static constexpr float kEpsilon = 0.5f;
      /// Synchronous Fabric commits one flush may issue by default; the rest go out asynchronously.
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

      static NitroUiSizeKey keyFor(const char* componentName, const std::string& sizingKey, uint64_t environmentEpoch);

      uint64_t environmentEpoch() const;

      /// The id for a new mounted instance. Process-global and never reused, because the engine
      /// outlives a JS runtime: a counter in JS would restart on reload and let a new instance
      /// inherit an old one's ledger entry.
      static int64_t nextInstanceId();

      /// The environment changed (Dynamic Type, density, locale), so the cache is dropped. Ledger
      /// entries stay, re-keyed for the new epoch and marked inexact, so a mounted control can
      /// still correct itself.
      void invalidateEnvironment();

      /// `invalidateEnvironment`, unless `signature` is the one already in effect. Hosts call this
      /// once per mounted view for a single user action; the signature makes that one bump instead
      /// of N. An empty signature always bumps.
      void invalidateEnvironmentIfChanged(const std::string& signature);

      // MARK: component registry (once per component, at descriptor construction)

      void registerComponent(const char* componentName, NitroUiComponentBinding binding);

      /// Called by the platform whenever a node's state (re)arrives. Registers the instance for
      /// pushes, and re-registers it after a push produces a new `State`.
      void bind(const char* componentName, const NitroUiStateRef& state);

      /// The typed half of `bind`: remember how to push to this instance.
      void registerInstance(int64_t instanceId, uint32_t componentHash, NitroUiPushFn push, const NitroUiStateRef& state);

      /// An instance is gone. Both platforms call this when a view is dropped or recycled, the only
      /// moment that knows an instance is finished.
      void forget(int64_t instanceId);

      // MARK: layout thread

      /// The size to lay out with: cache, then state, then the component's fallback. Records the
      /// answer in the ledger and never calls into native UI. The returned `key` is always this
      /// configuration's key, so the result can go straight into Fabric state.
      NitroUiMeasuredSize measure(const char* componentName, int64_t instanceId, const std::string& sizingKey, const NitroUiMeasuredSize& fromState);

      /// Whether this instance must be re-measured on a props update that leaves its size alone. A
      /// correction arrives as a new `State`, but React clones the next props from the revision
      /// before it, whose Yoga cache holds the old size; unless the node is dirtied, that stale
      /// size is committed. Only a corrected instance pays for this.
      bool requiresFreshMeasure(int64_t instanceId) const;

      // MARK: main / UI thread

      /// The size for a configuration that was never measured: the component's documented platform
      /// size, so a cache miss is a good guess rather than 0x0.
      void setFallback(const char* componentName, float width, float height, uint32_t flags);

      /// Put a size in the cache without an instance. It is provisional: nobody measured it, so a
      /// control that disagrees still corrects it.
      void seedSize(const char* componentName, const std::string& sizingKey, float width, float height, uint32_t flags);

      /// The host measured itself. Dropped when the size is what the instance was already laid out
      /// with and nothing else waits on that configuration; otherwise queued for `flush`, which
      /// also corrects every other instance that laid out wrong for the same configuration.
      void report(int64_t instanceId, float width, float height, uint32_t flags);

      /// Apply the queued reports as Fabric state updates, with the default budget of synchronous
      /// ones. Returns `true` when a size changed, i.e. the layout about to be drawn is stale.
      bool flush();

      /// `flush` with the platform's own budget of synchronous state updates, clamped at zero. A
      /// synchronous push is a Fabric commit run inside this call. On iOS it joins the run-loop
      /// turn already under way; on Android each one is a full re-layout inside a frame that is
      /// then cancelled, so it costs more there.
      bool flush(int32_t immediateBudget);

      /// Whether anything is waiting for `flush`. For the platform schedulers.
      bool hasPendingReports() const;

      /// Number of cached sizes. Diagnostics and tests.
      size_t cachedSizeCount() const;

      /// Entries on hold for a bind that has not arrived (see `lateFilings_`). Held entries are not
      /// in the ledger, so `ledgerEntries` does not count them.
      size_t lateFilingCount() const;

      /// Ledger rows waiting for a bind that has not arrived (see `UnboundFiling`).
      size_t unboundFilingCount() const;

      /// Adopt a component's declared size as the provisional answer for its default configuration
      /// (the empty sizing key). The first control to measure confirms or replaces it. Returns
      /// `false` for a component that declared no size. Non-default sizing keys are not covered.
      bool prewarm(const char* componentName);

      NitroUiSizingCounters stats() const;

      /// Record the box a platform drew an instance at (first frame only).
      void recordDrawnSize(int64_t instanceId, float width, float height);

      /// Reports that arrived before their instance was bound are retried for this
      /// many flushes before they are given up on.
      static constexpr int32_t kUnboundReportRetries = 4;
      /// Walk the registry for states that died without a `forget` once it has
      /// grown this much since the last walk.
      static constexpr size_t kRegistrySweepStride = 512;
      /// How many finished instance ids the engine remembers. Must be a power of two: `forgotten_`
      /// is direct-mapped by the id's low bits.
      static constexpr size_t kForgottenCapacity = 512;
      /// How long a layout that arrived for a finished id is held waiting for its bind. It only has
      /// to cover one React commit (layout on the shadow thread, then the mount transaction that
      /// binds), but it is generous: releasing early costs a control its correction for good,
      /// holding costs one table entry. Measured on the monotonic clock.
      static constexpr int64_t kLateFilingGraceNs = 1000000000;
      /// Memory backstop for `lateFilings_`; the grace window is what normally bounds it. Set above
      /// the largest single commit expected, because at the ceiling the oldest hold is dropped
      /// while still inside its window and that control loses its correction.
      static constexpr size_t kLateFilingCapacity = 2048;
      /// How many ledger rows may wait for a bind at once. A commit lays out all its views before
      /// binding any, so a long list's first frame has that many waiting. Overflow demotes the
      /// oldest row to the held table, where its bind can still claim it within the grace window.
      static constexpr size_t kUnboundFilingCapacity = 1024;

      void setTraceEnabled(bool enabled);

      /// Everything traced so far, oldest first, and start over.
      std::vector<NitroUiSizingTraceEntry> drainTrace();

    private:
      struct SizeEntry final {
        NitroUiSizeKey key{};
        NitroUiMeasuredSize size{};
        /// Nobody measured this exact configuration (`prewarm`/`seedSize` only guess). `measure`
        /// answers with it, but the instance stays inexact until a report confirms or replaces it.
        bool provisional = false;
      };

      /// See `guesses_`.
      struct GuessEntry final {
        std::string componentName{};
        std::string sizingKey{};
        /// Width/height/flags only: an empty key means "a guess, never an answer".
        NitroUiMeasuredSize size{};
      };

      struct LedgerEntry final {
        NitroUiSizeKey key{};
        bool exact = false;
        /// The size the engine last told Yoga; an empty key means never laid out. `report` compares
        /// against it to tell a confirmation from a correction.
        NitroUiMeasuredSize laidOut{};
        /// The configuration verbatim, so an environment change can recompute `key` for the new
        /// epoch.
        std::string componentName{};
        std::string sizingKey{};
        /// Whether this instance has ever been answered. The first answer is not a change.
        bool hasMeasured = false;
        /// The size this instance is laid out with has changed at least once. Sticky: the engine
        /// cannot learn when Yoga is done with the superseded answer (see `requiresFreshMeasure`).
        bool answerChanged = false;
      };

      struct BoundInstance final {
        uint32_t componentHash = 0;
        NitroUiPushFn push = nullptr;
        NitroUiWeakState state{};
        /// Bound after its ledger entry was given up on, so its next props update must re-measure
        /// instead of trusting what Yoga holds. Cleared by the `measure` that answers it.
        bool owesFreshMeasure = false;
      };

      struct Report final {
        int64_t instanceId = 0;
        float width = 0;
        float height = 0;
        uint32_t flags = 0;
        /// Flushes this report has been through without finding a bound instance. Bounded so an
        /// instance that never binds cannot keep `hasPendingReports()` true forever.
        int32_t unboundTries = 0;
      };

      /// Apply reports queued by `report`; takes the lock itself.
      bool applyReports(std::vector<Report>& reports, int32_t immediateBudget);
      void recordTraceLocked(int64_t instanceId, int32_t stage, float width, float height);

      /// `needsCorrection_` helpers. Caller holds the lock.
      void addNeedsCorrectionLocked(const NitroUiSizeKey& key, int64_t instanceId);
      void removeNeedsCorrectionLocked(const NitroUiSizeKey& key, int64_t instanceId);
      /// Hash a (component, sizingKey) pair for `guesses_`. Epoch 0 is never a real
      /// epoch, so no live key can collide with a guess key.
      static uint64_t guessHash(const char* componentName, const std::string& sizingKey);
      /// The size to file for a size a host reported. A `fillWidth` report's width only restates
      /// the box it was measured in, so it is replaced with the width the component declared; that
      /// cached width is what a node measured under an infinite width constraint gets. `intrinsic`
      /// reports, and components that declared nothing, are filed unchanged. Caller holds the lock.
      NitroUiMeasuredSize filedSizeLocked(const NitroUiMeasuredSize& reported, const std::string& componentName) const;
      /// Forget what a component's configurations last measured (a fresh
      /// declaration supersedes the engine's own history). Caller holds the lock.
      void dropGuessesForLocked(uint32_t hash, const char* componentName);

      /// Drop every trace of an instance (see `forget`). Caller holds the lock.
      void forgetLocked(int64_t instanceId);

      /// Hold the entry a layout produced for a finished id until a bind claims it or its window
      /// closes. Caller holds the lock.
      void stageLateFilingLocked(int64_t instanceId, const LedgerEntry& entry);
      /// Drop held entries whose window has closed. Caller holds the lock.
      void pruneLateFilingsLocked();
      /// Demote ledger rows whose bind did not come within the window. Caller holds the lock.
      void pruneUnboundFilingsLocked();
      /// Note that the row just filed for an unbound id is waiting for its bind. Caller holds the
      /// lock.
      void fileAwaitingBindLocked(int64_t instanceId);
      /// Move one row from `ledger_` to the held table, where a late bind can still claim it, and
      /// mark the id forgotten so later layouts for it are held rather than filed. Caller holds the
      /// lock.
      void demoteUnboundFilingLocked(int64_t instanceId);
      /// Move a held entry into the ledger; returns whether there was one. Only `registerInstance`
      /// calls it: a bind is the only proof that a held layout was for a live instance. Caller
      /// holds the lock.
      bool claimLateFilingLocked(int64_t instanceId);

      /// Mark an id finished, so a layout arriving for it afterwards is held, not filed. Caller
      /// holds the lock.
      void rememberForgottenLocked(int64_t instanceId);
      /// Undo `rememberForgottenLocked`: an id that binds again is live. Caller holds the lock.
      void clearForgottenLocked(int64_t instanceId);
      /// Has this id been forgotten and not re-bound since? Caller holds the lock.
      bool isForgottenLocked(int64_t instanceId) const;
      /// Walk the registry for states that died without a `forget`. Caller holds the lock.
      void sweepExpiredLocked();

      /// Guards everything below. Never held across a push: the commit a push causes re-enters
      /// `measure`, and the mutex is not recursive.
      mutable std::shared_mutex mutex_;
      /// `NitroUiSizeKey::hash` -> entry (the entry re-checks the full key).
      std::unordered_map<uint64_t, SizeEntry> cache_;
      /// What each component declared as its size, plus `seedSize`. Never written by a measurement:
      /// keyed by component alone, it cannot tell one configuration from another.
      std::unordered_map<uint32_t, NitroUiMeasuredSize> fallbacks_;
      /// The last size each (component, sizingKey) measured, kept across an environment change,
      /// which empties `cache_`. Consulted only on a cold miss.
      std::unordered_map<uint64_t, GuessEntry> guesses_;
      std::unordered_map<int64_t, LedgerEntry> ledger_;
      /// The ids `forget` has finished, direct-mapped by their low bits. A layout pass can still
      /// arrive for an id after its view was dropped (a correction's layout runs later), and filing
      /// it would leak a ledger entry. Ids are never reused, so a slot answers only for its own id;
      /// an id evicted by one `kForgottenCapacity` newer is simply no longer remembered.
      std::array<int64_t, kForgottenCapacity> forgotten_{};
      /// The ids whose held entry was dropped unclaimed, direct-mapped like `forgotten_`. A bind
      /// that arrives for one afterwards has no ledger entry, so it owes a fresh measure.
      std::array<int64_t, kForgottenCapacity> abandonedFilings_{};
      /// Record that an entry was given up on rather than claimed. Caller holds the lock.
      void markFilingAbandonedLocked(int64_t instanceId);
      /// Read and clear the mark, so the fresh measure it asks for happens once. Caller holds the
      /// lock.
      bool consumeFilingAbandonedLocked(int64_t instanceId);
      /// An entry a layout produced for a finished id, and when it was put on hold.
      struct HeldFiling final {
        LedgerEntry entry{};
        int64_t stagedAtNs = 0;
      };
      /// A ledger row filed by a layout whose mount has not bound yet. Layout runs on the shadow
      /// thread before the mount transaction binds, so this is normal; but if the commit is
      /// dropped, no view is ever created and nothing calls `forget`, so the row needs a deadline
      /// (`kLateFilingGraceNs`).
      struct UnboundFiling final {
        int64_t instanceId = 0;
        int64_t filedAtNs = 0;
      };
      /// Entries that arrived for a finished id, held until a bind claims one or its window closes.
      /// They cannot be refused: hiding a control forgets its id while the React mount keeps it,
      /// and showing it again lays the new view out before the bind. Only `registerInstance` claims
      /// a hold; `forget` and `pruneLateFilingsLocked` drop one.
      std::unordered_map<int64_t, HeldFiling> lateFilings_{};
      /// The ids in `lateFilings_`, oldest hold first. A slot may outlive its entry (claimed or
      /// forgotten); the prune skips such slots, so `forget` never scans the deque.
      std::deque<int64_t> lateFilingQueue_{};
      /// Ids whose ledger row is waiting for its bind, and the same ids in filed order. As with
      /// `lateFilingQueue_`, a slot whose id has since bound is left for the prune to drop.
      std::unordered_set<int64_t> waitingForBind_{};
      std::deque<UnboundFiling> unboundQueue_{};
      /// hash -> instances that last laid out with a size that is not the cache's.
      std::unordered_map<uint64_t, std::vector<int64_t>> needsCorrection_;
      std::unordered_map<int64_t, BoundInstance> registry_;
      std::unordered_map<std::string, NitroUiComponentBinding> components_;
      std::vector<Report> pending_;
      NitroUiSizingCounters stats_{};
      /// Registry size at which the next flush walks it for expired states.
      size_t nextRegistrySweepAt_ = 0;
      std::vector<NitroUiSizingTraceEntry> trace_{};
      std::atomic<bool> traceEnabled_{false};
      /// Folded into every key; bumped by `invalidateEnvironment`.
      uint64_t environmentEpoch_ = 1;
      /// What the last bump was for (`invalidateEnvironmentIfChanged`).
      std::string environmentSignature_{};
  };

} // namespace margelo::nitro::nitroui
