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
    /// Flushes that changed a size. On Android it is also exactly the number of
    /// frames that were skipped as stale, because the flusher returns `false`
    /// from `onPreDraw` on those; on iOS it is not (see docs/architecture/sizing.md).
    /// Named for what it counts (DECISIONS D16).
    int64_t flushes = 0;
    int64_t changedFlushes = 0;
    /// Reports that confirmed the size an instance was already laid out with, so
    /// they needed nothing: the pre-warmed case, and the case where the
    /// environment moved and this control's size did not.
    int64_t reportsConfirmed = 0;
    /// Engine time of the last and the worst flush, nanoseconds. Does not include
    /// the re-layout the push causes - that is a Fabric commit, and it is what
    /// the mount benchmarks measure end to end.
    int64_t lastFlushNs = 0;
    int64_t maxFlushNs = 0;
    /// Trace events dropped because the ring wrapped.
    int64_t traceDropped = 0;
    /// Live ledger / registry entries: one per instance the engine knows about.
    /// Mount/unmount churn must keep these flat (review S3) - a list of switches
    /// that scrolls must not grow the engine for the life of the process.
    int64_t ledgerEntries = 0;
    int64_t registryEntries = 0;
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
      /// Two reported sizes closer than this are the same size: 0.5 of a platform
      /// unit on both platforms (0.5 pt on iOS, 0.5 dp on Android). The same role
      /// true-sheet and react-native-screens give a sub-dp epsilon; the brief
      /// asked for 0.9 dp on Android, and 0.5 is what the engine actually uses on
      /// both - measured sizes are exact integers there, so the tighter value
      /// costs nothing and keeps one rule instead of two (review N4).
      static constexpr float kEpsilon = 0.5f;
      /// Immediate Fabric commits one flush may issue by default, like Expo's
      /// `kImmediateSizeUpdateBudgetPerTurn`. The rest go out asynchronously.
      /// A platform whose flush runs inside the frame it is about to cancel wants
      /// fewer than this - see `flush(int32_t)`.
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

      /**
       * The identity to hand a new mounted instance (review S4).
       *
       * Process-global and monotonic, so ids are unique across components,
       * across JS runtimes in one app, and across reloads - which matters
       * because the engine is process-global while a JS runtime is not: ids
       * issued from a module-level counter restart at 1 on reload and would
       * otherwise let a new instance inherit an old one's ledger entry. JS asks
       * once per mount (`nitroUiCore.nextSizingId()`), which is a plain atomic
       * increment on the JS thread - no hop, no lock.
       */
      static int64_t nextInstanceId();

      /**
       * The environment changed (Dynamic Type, density, locale): every cached
       * answer belongs to an environment that no longer exists, so the cache
       * goes. Ledger entries *stay* and become inexact (review S2): a mounted
       * control has to be able to correct itself, and dropping its entry is what
       * made `report` answer "nothing ever laid out". Each entry's key is
       * recomputed for the new epoch, and the component's declared fallback stays
       * as the guess for the first layout in the new environment.
       */
      void invalidateEnvironment();

      /**
       * `invalidateEnvironment`, but only if the environment is not the one this
       * signature already describes (review S2).
       *
       * A platform host reports what it can observe - on iOS the content size
       * category and legibility weight, on Android the font scale, density and
       * locale. Both call this from a per-view callback that fires once per
       * mounted view for one user action, and an epoch bump per view is wasted
       * work that also throws away a cache another control just filled; the
       * signature is what turns N callbacks into one change. An empty signature is
       * "unknown", and always bumps.
       */
      void invalidateEnvironmentIfChanged(const std::string& signature);

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

      /**
       * An instance is gone: the host dropped or recycled its view.
       *
       * Called by both platforms from `onDropView`/`prepareForRecycle`, which is
       * the only moment that *knows* an instance is finished. Waiting for the
       * weak `State` to expire instead (the previous behaviour) leaks every
       * instance a list ever mounted, because a warm or pre-warmed instance never
       * reaches the code that notices (review S3).
       */
      void forget(int64_t instanceId);

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

      /**
       * Whether this instance must be measured again on a props update that does
       * not change its size.
       *
       * A shadow node answers layout from Yoga's per-node measurement cache, and
       * Yoga keeps *every* answer it was ever given for a node it was never
       * dirtied for (FIX2). Once the engine has corrected an instance, an answer
       * from before that correction is a live entry in that cache: the next clean
       * clone can be laid out at the superseded size, and `measure` is never
       * reached again to notice. Such an instance therefore stops trusting the
       * cache and re-asks on every props turn - one lock and one hash lookup,
       * against a box that is wrong for the rest of the mount.
       *
       * An instance whose answer never moved keeps the fast path: a Switch that
       * was laid out at the size the engine already believed costs nothing here.
       */
      bool requiresFreshMeasure(int64_t instanceId) const;

      // MARK: main / UI thread

      /**
       * The size to use for a configuration that was never measured. Components
       * register one (their documented platform size) so a cache miss is a good
       * guess rather than 0x0. Falls back to nothing until the first real
       * measurement, which overwrites it.
       */
      void setFallback(const char* componentName, float width, float height, uint32_t flags);

      /**
       * Put a size in the cache without an instance: `prewarm` (§1.3) and the
       * on-device tests that need a known cold/warm state. It goes in
       * *provisionally* - nobody measured this configuration - so a control that
       * disagrees still corrects it (review B2).
       */
      void seedSize(const char* componentName, const std::string& sizingKey, float width, float height, uint32_t flags);

      /**
       * The host measured itself. Queues the correction; `flush` applies it.
       *
       * Dropped here (no commit at all) when the size is what this instance was
       * already laid out with and nothing else is waiting for that configuration:
       * that is the pre-warmed mount, and the environment change that turned out
       * not to move this control. Otherwise it is queued, and `flush` also corrects
       * every *other* instance that laid out wrong for the same configuration.
       */
      void report(int64_t instanceId, float width, float height, uint32_t flags);

      /**
       * Apply the queued reports as Fabric state updates, spending the default
       * budget of synchronous ones. Returns `true` when at least one size
       * changed, i.e. the layout about to be drawn is stale.
       */
      bool flush();

      /**
       * `flush` with the platform's own budget of synchronous state updates.
       *
       * A synchronous push is a Fabric commit run where `flush` was called, and
       * what that is worth differs by platform. iOS flushes from a run-loop
       * observer below Core Animation's commit observer, so the commit joins the
       * turn that is already on its way: two of them cost 8.5ms for a batch of
       * 200 (T11). Android flushes from an `OnPreDrawListener` that returns
       * `false`, so each synchronous commit is a full re-layout bought inside a
       * frame that never reaches the screen. One is still worth paying - it is the
       * correction D17 asks for, and one instance is what one push is known to
       * carry: the push clones one family, so an untouched sibling keeps the
       * measurement it cached. T12 measured `stale=0` for a 100-instance cold batch
       * at budget 1 against `stale=100` at budget 0, which is a measurement on one
       * device and not a property of the budget - the harness logs the count and
       * does not gate on it. What a second push does buy is nothing measured: on
       * that batch of 200 the first batch in a process cost 38.80ms with two
       * pushes and 36.76ms with one, and the median of three rounds 18.88ms against
       * 12.84ms (-32%; at 500 rows 42.51ms against 26.77ms, -37%), while spending
       * none costs 0.09ms and leaves every instance a wrong-size frame (T12 phase
       * 2). The instance that reported is corrected before the cancelled frame
       * either way, which is the rule D17 actually asks for.
       *
       * Clamped at zero: a platform may spend none.
       */
      bool flush(int32_t immediateBudget);

      /// Whether anything is waiting for `flush`. For the platform schedulers.
      bool hasPendingReports() const;

      /// Number of cached sizes. Diagnostics and tests.
      size_t cachedSizeCount() const;

      /**
       * Adopt a component's declared size as this environment's *provisional*
       * answer for its default configuration (the empty sizing key): the first
       * instance is laid out with it, and the first control that measures either
       * confirms it (no commit) or replaces it with the real size. It can never
       * make a layout worse precisely because it is not authoritative (review B2 -
       * as an authoritative entry it used to freeze a wrong guess for the whole
       * session).
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

      /// Reports that arrived before their instance was bound are retried for this
      /// many flushes before they are given up on.
      static constexpr int32_t kUnboundReportRetries = 4;
      /// Walk the registry for states that died without a `forget` once it has
      /// grown this much since the last walk.
      static constexpr size_t kRegistrySweepStride = 512;

      /// Trace on/off (off by default: `measure` only compares two floats).
      void setTraceEnabled(bool enabled);

      /// Everything traced so far, oldest first, and start over.
      std::vector<NitroUiSizingTraceEntry> drainTrace();

    private:
      struct SizeEntry final {
        NitroUiSizeKey key{};
        NitroUiMeasuredSize size{};
        /**
         * A size nobody measured for this exact configuration: written by
         * `prewarm`/`seedSize`, which only *guess* (review B2). `measure` answers
         * with it so the first frame is close, but the instance stays inexact and
         * the first report either promotes the entry (matching size, no commit)
         * or replaces it with the real size. An entry is authoritative only once
         * a control measured it.
         */
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
        /// The size the engine last told Yoga, empty key = never laid out. What
        /// lets `report` tell "confirms what is on screen" from "needs a
        /// correction", and what an environment change is measured against.
        NitroUiMeasuredSize laidOut{};
        /// The configuration verbatim, so an environment change can recompute
        /// `key` for the new epoch instead of dropping the entry (review S2).
        std::string componentName{};
        std::string sizingKey{};
        /// Has this instance ever been answered for? The first answer is not a
        /// change, whatever the previous `laidOut` looks like ("never measured").
        bool hasMeasured = false;
        /**
         * The size this instance is laid out with has moved under it at least
         * once, so an answer from before the move is still in play (FIX2).
         * Sticky: the engine has no way to learn when Yoga is done with the
         * superseded answer - see `requiresFreshMeasure`.
         */
        bool answerChanged = false;
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
        /// How many flushes this report has been through without finding a bound
        /// instance (review S7). Bounded so an instance that never binds cannot
        /// keep `hasPendingReports()` true forever.
        int32_t unboundTries = 0;
      };

      /// Apply reports queued by `report`; takes the lock itself.
      bool applyReports(std::vector<Report>& reports, int32_t immediateBudget);
      void recordTraceLocked(int64_t instanceId, int32_t stage, float width, float height);

      /// `needsCorrection_` helpers. Caller holds the lock; the id lists are the
      /// instances of one configuration, so linear is the right data structure.
      void addNeedsCorrectionLocked(const NitroUiSizeKey& key, int64_t instanceId);
      void removeNeedsCorrectionLocked(const NitroUiSizeKey& key, int64_t instanceId);
      /// Hash a (component, sizingKey) pair for `guesses_`. Epoch 0 is never a real
      /// epoch, so no live key can collide with a guess key.
      static uint64_t guessHash(const char* componentName, const std::string& sizingKey);
      /// Forget what a component's configurations last measured (a fresh
      /// declaration supersedes the engine's own history). Caller holds the lock.
      void dropGuessesForLocked(uint32_t hash, const char* componentName);

      /// Drop every trace of an instance (see `forget`). Caller holds the lock.
      void forgetLocked(int64_t instanceId);
      /// Walk the registry for states that died without a `forget`. Caller holds
      /// the lock, and it runs rarely on purpose (see `flush`).
      void sweepExpiredLocked();

      /// Append a trace event. Caller holds the lock (hence "Locked"): `measure`
      /// and `applyReports` record from inside it, and taking the lock again
      /// would be the same mistake as pushing Fabric state from under it.

      mutable std::shared_mutex mutex_;
      /// `NitroUiSizeKey::hash` -> entry (the entry re-checks the full key).
      std::unordered_map<uint64_t, SizeEntry> cache_;
      /// What the component *declared* as this OS's size, plus `seedSize`. The only
      /// component-wide guess, and deliberately never written by a measurement:
      /// keyed by component alone, it cannot tell one configuration from another.
      std::unordered_map<uint32_t, NitroUiMeasuredSize> fallbacks_;
      /**
       * The last size each *configuration* measured, kept across an environment
       * bump (the epoch-carrying `cache_` does not survive one).
       *
       * This is what D14 wanted - "the fallback keeps a measured size instead of a
       * made-up default" - without the leak that comes from filing a measurement
       * under the component: a wide variant's 100pt became the guess for the
       * default configuration, so a fresh default mount was laid out 100pt wide.
       * Keyed by (component, sizingKey) with the strings kept for verification, so
       * a hash collision cannot repeat that; consulted only on a cold miss.
       */
      std::unordered_map<uint64_t, GuessEntry> guesses_;
      std::unordered_map<int64_t, LedgerEntry> ledger_;
      /// hash -> instances that last laid out with a size that is not the cache's.
      std::unordered_map<uint64_t, std::vector<int64_t>> needsCorrection_;
      std::unordered_map<int64_t, BoundInstance> registry_;
      std::unordered_map<std::string, NitroUiComponentBinding> components_;
      std::vector<Report> pending_;
      /// Size counters (see `NitroUiSizingCounters`). Guarded by `mutex_` like the
      /// rest, except `traceDropped_`, which is only written while tracing.
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
