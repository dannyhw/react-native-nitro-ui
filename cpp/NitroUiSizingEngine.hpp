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
       * A correction lands as a new `State`, but React's next props clone is made
       * without `.state` and copies the *previous revision's* state - the one from
       * before the correction, whose Yoga measurement cache and `layoutMetrics_`
       * still hold the old size (FIX2, D20). Our `adopt` mints a fresh,
       * never-obsolete `State` from it on every props change, so RN's
       * `progressState` never re-dirties the node and a clean clone is committed at
       * the superseded size with `measure` never reached to notice. Such an instance
       * therefore stops trusting React's revision and re-asks on every props turn,
       * against a box that is wrong for the rest of the mount.
       *
       * What a flagged props turn pays is not a lookup. It is: this lookup (one
       * shared lock and hash - 11.4 ns on host, and every props turn of every sized
       * instance pays it, flagged or not); `setDirty` on the leaf, which dirties
       * every cloned ancestor through `updateYogaChildren`; a Yoga pass from the
       * root, which RN skips entirely while nothing is dirty (host, RN 0.88's Yoga,
       * -O2: 8.4 us for a 35-node/deep-4 tree, 18.3 us for 99/8, 47.8 us for
       * 316/15 - excluding RN's layout-metrics walk and diff, so 1-3x on a phone);
       * one `measure` (32.5 ns warm); and RN's post-layout walk. A clean tree pays
       * 0 of that last group.
       *
       * An instance whose answer never moved keeps the fast path: a Switch that
       * was laid out at the size the engine already believed costs nothing here.
       * Neither does a re-key by itself raise this flag - only a correction does
       * (see `measure`), and a configuration change dirties the measurement through
       * `shouldNewRevisionDirtyMeasurement` anyway.
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
       * How many entries are on hold for a bind that has not arrived (see
       * {@link lateFilings_}). Diagnostics and tests, and the only number that can
       * answer "did the leak fix move the leak, or bound it?" - `ledgerEntries`
       * cannot, because a hold is deliberately outside the ledger.
       */
      size_t lateFilingCount() const;

      /**
       * How many ledger rows are currently waiting for a bind that has not arrived
       * (see {@link UnboundFiling}). Public for the same reason `lateFilingCount` is:
       * `ledgerEntries` cannot tell a row that is owed a window from one whose instance
       * is bound, and a leak test needs to be able to say which table it is looking at.
       */
      size_t unboundFilingCount() const;

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
      /**
       * How many finished instance ids the engine keeps, to answer "has this id
       * been through?" in O(1). Four KiB (512 slots × 8 bytes), always, whatever
       * an app does.
       *
       * Must be a power of two: {@link forgotten_} is direct-mapped by the id's
       * low bits, and ids are monotonic, so a capacity of 2^n means the last 2^n
       * ids land in 2^n distinct slots and an older one can only be evicted by an
       * id exactly `capacity` newer than it.
       */
      static constexpr size_t kForgottenCapacity = 512;
      /**
       * How long a layout that arrived for a finished id may be held before the
       * engine stops waiting for its bind, and the ceiling on how many are held at
       * once.
       *
       * The window is what bounds the table, and `kLateFilingCapacity` is only the
       * backstop behind it (see below). Together they are the whole cost of the leak
       * rule: at most one second's worth of holds, and never more than the ceiling.
       *
       * The window has to cover the gap between a shadow-tree layout and the mount
       * transaction that binds the same instance: one React commit, so milliseconds
       * in a healthy app. One second, because the two costs are not symmetric —
       * holding too long costs a table entry, releasing too early costs a control
       * its correction for the rest of its life, which is the bug this fix is about
       * — and a saturated runner is where a tight budget gets measured and lost (F8
       * saw load1 380 on 3 cores). It is a monotonic clock, never wall time, so a
       * user changing their clock can neither hold an entry nor release one early.
       */
      static constexpr int64_t kLateFilingGraceNs = 1000000000;
      /**
       * The memory backstop on {@link lateFilings_}, *not* the working bound. What
       * actually bounds that table is {@link kLateFilingGraceNs}: an entry is dropped
       as soon as it can no longer be claimed, and never before.
       *
       * It used to be the working bound, at 256, and that was a cliff. A commit that
       * re-shows 300 hidden controls stages 300 holds in the same millisecond, all of
       * them inside their window, and a capacity of 256 evicted the oldest 44 *for
       * being numerous* — losing 44 corrections in a commit that had done nothing
       * wrong. `kUnboundFilingCapacity`'s overflow lands in the same table, so a
       * first commit of 1,324 views (a real number, from F8's own harness) lost 44
       * corrections the same way. Before F8 neither case lost anything, so capacity
       * eviction of an in-window entry was a regression the leak fix had introduced.
       *
       * So the ceiling is set above any commit this project has measured, not above
       * what a tidy constant looks like. 2,048 rows is about 192 KiB of ledger
       * entries — 1.5x the 1,324-layout commit, which was itself the largest single
       * commit found by asking, and a commit that big is a flat list's first frame,
       * one second of a fast app's scrolling, or nothing.
       *
       * What happens *at* the ceiling: the oldest hold is dropped even though it is
       * still inside its window, so that one control keeps the size it was laid out
       * at and loses the correction it was owed (see `stageLateFilingLocked`). That
       * is the same cost as letting the window close, paid early, and it is the price
       * of the table being finite; it is not a leak in either direction.
       */
      static constexpr size_t kLateFilingCapacity = 2048;
      /**
       * How many rows may be waiting for a bind at once (see {@link UnboundFiling}).
       *
       * Looser than the held table on purpose, because of what one commit does: a commit
       * that mounts N views lays all N out on the shadow thread *before* its mount
       * transaction binds any of them, so a long list's first frame legitimately has N
       * rows in "filed, not bound yet" at the same moment. Overflow is not fatal — a
       * demoted row is claimed back by the bind that follows — but it is not free either:
       * it moves the row into a table whose window is the same one second, so the more
       * rows this drops, the more of them depend on their bind arriving inside it.
       * `testABigFirstCommitKeepsEveryCorrection` lays out a commit bigger than this
       * number, so the number cannot silently become the thing that decides whether a
       * list's first frame is correct.
       */
      static constexpr size_t kUnboundFilingCapacity = 1024;

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
        /**
         * This instance was bound with nothing to its name — see
         * {@link registerInstance}'s debt rule — so its next props turn has to re-ask
         * for a measurement instead of trusting what Yoga is holding. Cleared by the
         * `measure` that answers it.
         */
        bool owesFreshMeasure = false;
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
      /**
       * The size to file in `cache_` / `guesses_` for a size a host reported.
       *
       * A `fillWidth` report's width is a restatement of the box the control was
       * measured at, so it is replaced here with the width the component itself
       * declared; only the height is the control's answer. That is the whole
       * consequence of the policy being taken seriously: the one place a cached
       * `fillWidth` width reaches the screen is a node measured under an *infinite*
       * width constraint (a control in a horizontal scroller), where
       * `measureContent` has no box width to substitute - and filing a report's
       * width there delivered whichever parent a bounded instance had last been
       * measured at (`docs/tasks/Q4-followups-triage.md` row 10). The declared number is
       * what the component publishes for exactly that case, so the cached width is
       * now always the component's own.
       *
       * `intrinsic` reports, and a `fillWidth` component that declared nothing, are
       * filed unchanged: there is no honest replacement to offer for the latter.
       *
       * Caller holds the lock.
       */
      NitroUiMeasuredSize filedSizeLocked(const NitroUiMeasuredSize& reported, const std::string& componentName) const;
      /// Forget what a component's configurations last measured (a fresh
      /// declaration supersedes the engine's own history). Caller holds the lock.
      void dropGuessesForLocked(uint32_t hash, const char* componentName);

      /// Drop every trace of an instance (see `forget`). Caller holds the lock.
      void forgetLocked(int64_t instanceId);

      /**
       * Hold the entry a layout produced for an id the engine has finished, until a
       * bind claims it or the window on it closes. Caller holds the lock. See
       * {@link lateFilings_}.
       */
      void stageLateFilingLocked(int64_t instanceId, const LedgerEntry& entry);
      /**
       * Drop held entries whose window has closed — the ones a bind can no longer
       * claim. Caller holds the lock; `measure` runs it from inside the lock it already
       * holds, and `flush` runs it so a churn that stopped laying out is still reclaimed.
       */
      void pruneLateFilingsLocked();
      /**
       * Close the mount window on ledger rows filed by a layout whose bind never came.
       * Called from `measure`, like the held table's prune, so a trickle leaks no
       * longer than one window.
       */
      void pruneUnboundFilingsLocked();
      /**
       * Note that the row just filed for an unbound id is owed a mount window
       * (see {@link UnboundFiling}). Called from `measure`, on the lock.
       */
      void fileAwaitingBindLocked(int64_t instanceId);
      /**
       * Take one row out of `ledger_` and hand it to the held table, where a late bind
       * can still claim it (see `pruneUnboundFilingsLocked`). Also marks the id
       * forgotten, so later layouts for it are held rather than filed again.
       */
      void demoteUnboundFilingLocked(int64_t instanceId);
      /**
       * Move a held entry into the ledger, and hand back whether there was one.
       * `registerInstance` calls it for the id it binds — the only proof that a
       * held layout was meant for a live instance. Caller holds the lock.
       */
      bool claimLateFilingLocked(int64_t instanceId);

      /// Mark an id finished, so a layout that arrives for it afterwards files
      /// nothing (see {@link forgotten_}). Caller holds the lock.
      void rememberForgottenLocked(int64_t instanceId);
      /// Undo {@link rememberForgottenLocked}: an id that binds again is live.
      /// Caller holds the lock.
      void clearForgottenLocked(int64_t instanceId);
      /// Has this id been forgotten and not re-bound since? Caller holds the lock.
      bool isForgottenLocked(int64_t instanceId) const;
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
      /**
       * The ids `forget` has finished, direct-mapped by their low bits, so "has
       * this id been through?" is one array read under the lock `measure` already
       * holds.
       *
       * Why this exists: a correction is an `Asynchronous` state update, and RN runs
       * its callback later, scheduling a layout pass over the tree revision that
       * carried it. Drop the view in between — which is what a list that scrolls
       * does constantly, and what an iOS `Menu` costs extra because its popup makes
       * the drop land a transaction later — and that pass re-enters
       * `measureContent` for an id whose `onDropView` has already run. `measure`
       * recorded what it laid out in `ledger_` without asking, and nothing ever
       * reclaimed it: the sweep walks `registry_`, and a forgotten instance has no
       * registry row. One orphaned entry per occurrence, for the life of the
       * process. That is F8's `Menu × no-leak-on-drop: 1 ledger entry(ies) survived
       * 50 drops`, in a run whose registry read `0→0` across the same window.
       *
       * What it answers is "was this id finished?", never "is this id live?",
       * because those are not in conflict: `measure` runs *before* `registerInstance`
       * on every real mount (layout is on the shadow thread, the bind is on the mount
       * transaction), so a rule about unbound ids would swallow corrections, which is
       * the failure S7 exists to stop. Being finished is a fact about the past, and
       * {@link lateFilings_} is what makes it survivable.
       *
       * Why the shape is exact: ids come from `nextInstanceId()`, a monotonic counter
       * whose values are never reused, so a slot holding an id answers for that id and
       * no other — a false positive would need an id equal to the one in its own slot.
       * The failure mode is the other one: an id whose slot was taken by the id
       * exactly `kForgottenCapacity` newer is no longer remembered as finished, so a
       * layout arriving *that* late is filed normally and its orphan survives. The
       * window that matters is one layout pass, not five hundred drops.
       */
      std::array<int64_t, kForgottenCapacity> forgotten_{};
      /**
       * The ids whose filing this engine gave up on — a hold it dropped rather than let
       * a bind claim — direct-mapped by their low bits. Same shape, capacity and
       * exactness argument as {@link forgotten_}: ids are monotonic, so a slot answers
       * for its own id and a false positive is impossible; the only failure is a false
       * *negative*, which costs the mild thing described below. It is a ring rather than
       * a set because every id in it is one whose bind may never come (an orphan's never
       * does), so a set would be a leak introduced by a leak fix. Four KiB, forever.
       *
       * What it answers is the one question `registerInstance` cannot ask any other way,
       * for a bind that arrives after both windows have closed (~2 s in the worst
       * ordering): "this id had an entry, this engine threw it away, and it is binding
       * now with nothing to its name". The alternative reading — a fresh mount that was
       * simply never laid out yet — has never had an entry at all and owes nothing. The
       * ring is the whole difference between the two, and its false negative is mild: an
       * id whose slot was taken by one exactly `kForgottenCapacity` newer is charged no
       * debt, which is how every instance behaved before this existed.
       */
      std::array<int64_t, kForgottenCapacity> abandonedFilings_{};
      /**
       * Record that a filing was given up on rather than claimed, so a bind that
       * eventually turns up is owed a second look. Caller holds the lock.
       */
      void markFilingAbandonedLocked(int64_t instanceId);
      /**
       * Read {@link abandonedFilings_} and clear the mark in one step, so the debt it
       * charges can only be paid once. Caller holds the lock.
       */
      bool consumeFilingAbandonedLocked(int64_t instanceId);
      /**
       * An entry a layout produced for a finished id, and when it was put on hold.
       * Same shape as a ledger row because that is exactly what it becomes if the id
       * binds.
       */
      struct HeldFiling final {
        LedgerEntry entry{};
        int64_t stagedAtNs = 0;
      };
      /**
       * A ledger row filed by a layout whose mount has not bound yet: the id, and the
       * moment the row was filed.
       *
       * `measure` is the only place a `ledger_` row is created, and it creates one for
       * any id — including one that is not bound, because layout legitimately runs on
       * the shadow thread before the mount transaction binds (that ordering is what
       * `testALayoutBeforeItsBindStillGetsCorrected` guards, and refusing it would
       * swallow corrections). So a row can be filed for an instance that never arrives:
       * the commit that laid the node out is dropped, no view is created, and *neither*
       * of the engine's reclaimers is ever told. `forget` is called from `onDropView`,
       * and a view that never existed has no drop to call it; `sweepExpiredLocked` walks
       * `registry_`, and an id that never bound has no row there — worse, its gate is
       * `registry_` having grown by a stride, so a row that never binds is precisely a
       * row that cannot move the counter that would ever trigger that walk. That is how
       * CI 41269235234's `Picker × no-leak-on-drop: 1 ledger entry(ies) survived 50
       * drops` stayed leaked with `registry` flat, on a tree that already had the
       * forgotten-id guard.
       *
       * So an unbound row is owed a window, and this is the list of who owes it, oldest
       * filed first. The window is {@link kLateFilingGraceNs}, for the same reasons as
       * the held table's: what it covers is a commit and not a lifetime, and the two
       * failure directions are not symmetric — releasing early costs a mounted control
       * its correction for the rest of its life, letting a row sit costs one ledger
       * entry.
       */
      struct UnboundFiling final {
        int64_t instanceId = 0;
        int64_t filedAtNs = 0;
      };
      /**
       * Entries that arrived for a finished id, held until a bind claims one or the
       * window on it closes.
       *
       * Why not simply refuse them, which is what round 1 of this fix did: the id of
       * a re-shown view is *not* a new id. `useSizingId` mints one per **React**
       * mount, and iOS Fabric creates no native view for a `display: none` node, so
       * hiding a control runs `drop()` -> `forget(X)` while its React mount — and its
       * id — survive. Showing it again lays the new native view out *before* the
       * mount transaction binds it, so refusing that layout left the instance bound
       * with no ledger entry: `report` returns at its first line without one, and
       * `invalidateEnvironment` re-keys `ledger_` and so never sees it. A new `sizingKey`
       * while hidden, or a font-scale change after a re-show, then had nothing left to
       * correct it. Refusing loses corrections; filing loses the leak fix. Holding costs
       * neither, because a hold is not in `ledger_` and no counter counts it.
       *
       * Who claims one: `registerInstance`, and only `registerInstance`. It is the one
       * call that means "this id has a `State` in the shadow tree". `report` must not
       * claim: a report can arrive from a revision that is already gone, and filing an
       * entry for it would be the leak this table exists to prevent, arriving through
       * the fix. (It could not fire anyway: binding claims immediately and `forget`
       * clears both, so no id in `registry_` has a hold.)
       *
       * Who reclaims one: `forget`, which drops the id's hold whenever it is finished
       * again — the exact case, since anything still arriving for a finished id comes
       * from a revision being torn down. And `pruneLateFilingsLocked`, for an orphan,
       * whose `forget` has *already* run by the time its late layout lands: no future
       * call is coming for it, so the window is what reclaims it. An orphan therefore
       * never enters `ledger_`, which is why the on-device leak rule sees zero without
       * a sweep, a cadence, or a race.
       */
      std::unordered_map<int64_t, HeldFiling> lateFilings_{};
      /**
       * The ids in {@link lateFilings_}, oldest hold first: the reclaim order, and
       * the capacity the table is bounded by.
       *
       * A slot outlives its entry when the id is claimed or forgotten, and
       * `pruneLateFilingsLocked` drops such a slot on sight rather than counting it.
       * That is deliberate: removing an arbitrary id from a deque is a scan, and
       * `forget` runs on every dropped view, so the hot path pays nothing and the
       * stale slot costs one compare the next time the queue's front reaches it. The
       * bound still holds, because the queue itself never exceeds
       * {@link kLateFilingCapacity} slots and the map only ever holds ids the queue
       * has slots for.
       */
      std::deque<int64_t> lateFilingQueue_{};
      /**
       * Ids whose ledger row was filed by a layout and is still waiting for its bind
       * (see {@link UnboundFiling}), and the same ids in filed order.
       *
       * Same two-piece shape as {@link lateFilings_} and {@link lateFilingQueue_} for
       * the same reason: the set is the O(1) "is it still owed?" answer that
       * `registerInstance` clears, and the deque is the reclaim order and the capacity.
       * A slot whose id has since bound is left behind and dropped by the prune rather
       * than chased, because removing an arbitrary id from a deque is a scan and a bind
       * happens on every mounted view.
       */
      std::unordered_set<int64_t> waitingForBind_{};
      std::deque<UnboundFiling> unboundQueue_{};
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
