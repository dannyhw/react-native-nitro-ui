//
//  NitroUiSizingEngine.cpp
//  react-native-nitro-ui
//
//  Implementation of the intrinsic-sizing core. See `NitroUiSizingEngine.hpp`
//  for the three data structures and `docs/architecture/sizing.md` for the flow.
//

#include "NitroUiSizingEngine.hpp"

#include "core/NitroUiClock.hpp"
#include "core/NitroUiSizing.hpp"

#include <algorithm>
#include <cmath>
#include <mutex>
#include <utility>

#if defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#endif

namespace margelo::nitro::nitroui {

  namespace {

    /**
     * FNV-1a, 64 bit. Small, allocation-free, and stable across platforms and
     * compilers, which matters because the value is a cache identity written on
     * one thread and read on another (a randomised `std::hash` would be worse,
     * not better).
     */
    constexpr uint64_t kFnvOffset = 14695981039346656037ULL;
    constexpr uint64_t kFnvPrime = 1099511628211ULL;

    inline void fnvFeed(uint64_t& hash, uint64_t byte) {
      hash ^= byte & 0xff;
      hash *= kFnvPrime;
    }

    inline void fnvFeedString(uint64_t& hash, const char* text, size_t length) {
      for (size_t i = 0; i < length; i++) {
        fnvFeed(hash, static_cast<unsigned char>(text[i]));
      }
    }

    /// A second, independent mix over the same bytes (see `NitroUiSizeKey`).
    inline void fnvFeedReversed(uint64_t& hash, const char* text, size_t length) {
      for (size_t i = length; i > 0; i--) {
        fnvFeed(hash, static_cast<unsigned char>(text[i - 1]));
      }
    }

    inline bool nearlyEqual(float a, float b) {
      return std::fabs(a - b) <= NitroUiSizingEngine::kEpsilon;
    }

    /**
     * Same size, ignoring which configuration it belongs to.
     *
     * Used wherever the question is "would a push change what is on screen", and
     * the key is deliberately not part of that: after an environment change the
     * size on screen belongs to the old key, and a control whose size did not move
     * must not be pushed a byte-identical second size just because the epoch did.
     */
    inline bool sameSizeIgnoringKey(const NitroUiMeasuredSize& a, const NitroUiMeasuredSize& b) {
      return a.flags == b.flags && nearlyEqual(a.width, b.width) && nearlyEqual(a.height, b.height);
    }

#if defined(__APPLE__)
    /**
     * iOS: one observer on the main run loop, ordered *before* Core Animation's
     * commit observer (UIKit's is registered at order 2 000 000 on
     * `kCFRunLoopBeforeWaiting`), so every size measured this turn is in the
     * shadow tree and laid out before Core Animation commits the frame.
     *
     * Installed lazily on the first report, which can only happen once a hosted
     * control exists, i.e. once the main run loop is running.
     */
    void installFlushObserverIfNeeded() {
      static std::once_flag installed;
      std::call_once(installed, [] {
        static CFRunLoopObserverContext context = {0, nullptr, nullptr, nullptr, nullptr};
        CFRunLoopObserverRef observer = CFRunLoopObserverCreate(
            kCFAllocatorDefault,
            kCFRunLoopBeforeWaiting,
            true, // every iteration, not one-shot
            1000000, // below UIKit's commit observer
            [](CFRunLoopObserverRef, CFRunLoopActivity, void*) {
              NitroUiSizing::flush();
            },
            &context);
        if (observer != nullptr) {
          CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
          CFRelease(observer);
        }
      });
    }
#endif

  } // namespace

  bool NitroUiMeasuredSize::nearlyEquals(const NitroUiMeasuredSize& other) const {
    return key == other.key && flags == other.flags && nearlyEqual(width, other.width) && nearlyEqual(height, other.height);
  }

  NitroUiSizingEngine& NitroUiSizingEngine::shared() {
    // Deliberately leaked (review N3): a function-local static is destroyed at
    // process exit, and the run-loop observer, a layout thread or a host teardown
    // can still be calling in at that point - the observer is never removed.
    // The engine owns nothing that has to be released (no file handles, no JS
    // references), so never running its destructor is the safe answer.
    static auto* engine = new NitroUiSizingEngine();
    return *engine;
  }

  int64_t NitroUiSizingEngine::nextInstanceId() {
    // `std::atomic<int64_t>` of a trivially destructible type: no exit-order
    // problem here either, and ids are never reused.
    static std::atomic<int64_t> counter{0};
    return counter.fetch_add(1, std::memory_order_relaxed) + 1;
  }

  uint32_t NitroUiSizingEngine::componentHash(const char* componentName) {
    uint64_t hash = kFnvOffset;
    fnvFeedString(hash, componentName, std::char_traits<char>::length(componentName));
    hash ^= hash >> 32;
    return static_cast<uint32_t>(hash);
  }

  NitroUiSizeKey NitroUiSizingEngine::keyFor(const char* componentName, const std::string& sizingKey, uint64_t environmentEpoch) {
    const size_t nameLength = std::char_traits<char>::length(componentName);
    NitroUiSizeKey key{};

    key.hash = kFnvOffset;
    fnvFeed(key.hash, environmentEpoch >> 56);
    fnvFeed(key.hash, environmentEpoch >> 40);
    fnvFeed(key.hash, environmentEpoch >> 24);
    fnvFeed(key.hash, environmentEpoch >> 8);
    fnvFeed(key.hash, environmentEpoch);
    fnvFeedString(key.hash, componentName, nameLength);
    // A separator, so ("Switch", "x") and ("Switchx", "") cannot collide.
    fnvFeed(key.hash, '|');
    fnvFeedString(key.hash, sizingKey.c_str(), sizingKey.size());

    // Independent second pass: reversed order, inverted epoch.
    key.check = kFnvOffset ^ 0x9e3779b97f4a7c15ULL;
    fnvFeed(key.check, ~environmentEpoch);
    fnvFeed(key.check, environmentEpoch >> 32);
    fnvFeedReversed(key.check, sizingKey.c_str(), sizingKey.size());
    fnvFeed(key.check, '|');
    fnvFeedReversed(key.check, componentName, nameLength);
    return key;
  }

  uint64_t NitroUiSizingEngine::environmentEpoch() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    return environmentEpoch_;
  }

  uint64_t NitroUiSizingEngine::guessHash(const char* componentName, const std::string& sizingKey) {
    // Epoch 0 is not a real epoch (`environmentEpoch_` starts at 1), so this can
    // never collide with a live `NitroUiSizeKey`.
    return keyFor(componentName, sizingKey, 0).hash;
  }

  void NitroUiSizingEngine::dropGuessesForLocked(uint32_t hash, const char* /*componentName*/) {
    for (auto iterator = guesses_.begin(); iterator != guesses_.end();) {
      if (NitroUiSizingEngine::componentHash(iterator->second.componentName.c_str()) == hash) {
        iterator = guesses_.erase(iterator);
      } else {
        ++iterator;
      }
    }
  }

  void NitroUiSizingEngine::invalidateEnvironment() {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    environmentEpoch_ += 1;
    cache_.clear();
    needsCorrection_.clear();
    for (auto& entry: ledger_) {
      LedgerEntry& ledger = entry.second;
      if (ledger.componentName.empty()) {
        continue;
      }
      // The key belonged to the environment that just went away; recompute it for
      // this one and mark the entry inexact, so a mounted instance's next report
      // finds something to correct instead of being dropped (review S2). An entry
      // that was exact still has the old size on screen, which is exactly the
      // thing the next report has to be measured against.
      ledger.key = keyFor(ledger.componentName.c_str(), ledger.sizingKey, environmentEpoch_);
      if (ledger.key) {
        ledger.exact = false;
        addNeedsCorrectionLocked(ledger.key, entry.first);
      }
    }
    // The fallbacks deliberately stay. A component declares its fallback once, at
    // process start, and nothing re-declares it - clearing it here would leave a
    // cache miss in the new environment with *no* guess at all, so the first
    // instance would be laid out at 0x0 and be invisible for a frame. A guess
    // from the old environment is not exact (it carries an empty key, so the
    // ledger still marks the instance inexact and the real measurement still
    // corrects it), it is just better than nothing.
  }

  void NitroUiSizingEngine::invalidateEnvironmentIfChanged(const std::string& signature) {
    bool changed = false;
    {
      const std::shared_lock<std::shared_mutex> lock(mutex_);
      changed = signature.empty() || signature != environmentSignature_;
    }
    if (!changed) {
      return;
    }
    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      environmentSignature_ = signature;
    }
    invalidateEnvironment();
  }

  void NitroUiSizingEngine::registerComponent(const char* componentName, NitroUiComponentBinding binding) {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    components_.insert_or_assign(std::string(componentName), binding);
  }

  void NitroUiSizingEngine::bind(const char* componentName, const NitroUiStateRef& state) {
    if (componentName == nullptr || state == nullptr) {
      return;
    }
    NitroUiComponentBinding binding{};
    {
      const std::shared_lock<std::shared_mutex> lock(mutex_);
      auto iterator = components_.find(std::string(componentName));
      if (iterator == components_.end() || iterator->second.bindInstance == nullptr) {
        return;
      }
      binding = iterator->second;
    }
    // Outside the lock: it calls back into `registerInstance`, which takes it.
    binding.bindInstance(state);
  }

  void NitroUiSizingEngine::registerInstance(int64_t instanceId, uint32_t componentHash, NitroUiPushFn push,
                                             const NitroUiStateRef& state) {
    if (instanceId == NitroUiSizing::NO_INSTANCE || push == nullptr || state == nullptr) {
      return;
    }
    // Overwrite: after our own push the family has a new `State` object, and the
    // platform calls this again with it from the resulting `updateState`.
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    registry_[instanceId] = BoundInstance{componentHash, push, state};
  }

  void NitroUiSizingEngine::forget(int64_t instanceId) {
    if (instanceId == NitroUiSizing::NO_INSTANCE) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    forgetLocked(instanceId);
  }

  void NitroUiSizingEngine::forgetLocked(int64_t instanceId) {
    registry_.erase(instanceId);
    auto ledger = ledger_.find(instanceId);
    if (ledger != ledger_.end() && ledger->second.key) {
      removeNeedsCorrectionLocked(ledger->second.key, instanceId);
    }
    ledger_.erase(instanceId);
    // A correction on its way to an instance that is gone must not be applied
    // later, when some other code may have taken over the id (`unboundTries`
    // aside, the ledger check in `applyReports` is the second guard).
    pending_.erase(std::remove_if(pending_.begin(), pending_.end(),
                                  [&](const Report& report) { return report.instanceId == instanceId; }),
                   pending_.end());
  }

  void NitroUiSizingEngine::addNeedsCorrectionLocked(const NitroUiSizeKey& key, int64_t instanceId) {
    std::vector<int64_t>& ids = needsCorrection_[key.hash];
    if (std::find(ids.begin(), ids.end(), instanceId) == ids.end()) {
      ids.push_back(instanceId);
    }
  }

  void NitroUiSizingEngine::removeNeedsCorrectionLocked(const NitroUiSizeKey& key, int64_t instanceId) {
    auto needs = needsCorrection_.find(key.hash);
    if (needs == needsCorrection_.end()) {
      return;
    }
    std::vector<int64_t>& ids = needs->second;
    ids.erase(std::remove(ids.begin(), ids.end(), instanceId), ids.end());
    if (ids.empty()) {
      needsCorrection_.erase(needs);
    }
  }

  void NitroUiSizingEngine::sweepExpiredLocked() {
    // `forget` is the path that keeps these maps bounded; this walk is only there
    // for a host that went away without calling it, so it costs nothing until the
    // registry has grown by a full stride since the last walk.
    if (registry_.size() < nextRegistrySweepAt_) {
      return;
    }
    nextRegistrySweepAt_ = registry_.size() + kRegistrySweepStride;
    // `forgetLocked` erases the registry node itself, so it must never be called
    // from a loop holding an iterator into `registry_` - the loop here used to read
    // the node it had just freed (review F1, reproduced under ASan). Collect the
    // expired ids first, then forget each one.
    std::vector<int64_t> expired{};
    for (const auto& entry: registry_) {
      if (entry.second.state.expired()) {
        expired.push_back(entry.first);
      }
    }
    for (const int64_t instanceId: expired) {
      forgetLocked(instanceId);
    }
  }

  NitroUiMeasuredSize NitroUiSizingEngine::measure(const char* componentName, int64_t instanceId, const std::string& sizingKey,
                                                   const NitroUiMeasuredSize& fromState) {
    if (instanceId == NitroUiSizing::NO_INSTANCE) {
      // Sizing is off for this view (JS never gave it a `nuiSizingId`), or it is
      // a plain Yoga leaf like every view before this one: measure nothing.
      return NitroUiMeasuredSize{};
    }

    const std::lock_guard<std::shared_mutex> lock(mutex_);
    stats_.measurements += 1;
    const NitroUiSizeKey key = keyFor(componentName, sizingKey, environmentEpoch_);

    NitroUiMeasuredSize result{};
    bool exact = false;

    auto cached = cache_.find(key.hash);
    if (cached != cache_.end() && cached->second.key == key) {
      result = cached->second.size;
      result.key = key;
      // A pre-warmed or seeded entry answers the layout - that is the point of
      // pre-warming - but it is not an *answer* until a control confirmed it, so
      // the instance stays inexact and its report either promotes the entry or
      // replaces it (review B2).
      exact = !cached->second.provisional;
    } else if (fromState.valid() && fromState.key == key) {
      // Native pushed this size into the state for *this* configuration.
      result = fromState;
      exact = true;
    } else {
      /**
       * Cold for this configuration in this environment. The guess comes from what
       * *this* configuration last measured (`guesses_`, which survives an epoch
       * bump), and only falls back to the component's declared number when this
       * configuration has never been measured at all. Filing the last measurement
       * under the component instead is what let one variant's size become another's
       * guess.
       */
      auto guess = guesses_.find(guessHash(componentName, sizingKey));
      if (guess != guesses_.end() && guess->second.componentName == componentName &&
          guess->second.sizingKey == sizingKey) {
        result = guess->second.size;
      } else {
        auto fallback = fallbacks_.find(componentHash(componentName));
        result = fallback != fallbacks_.end() ? fallback->second : NitroUiMeasuredSize{};
      }
      // The fallback keeps an empty key on purpose: it is a *guess* for this
      // configuration, and `valid()` is how the rest of the code tells a guess
      // from an answer. The ledger still records the key, so the real size
      // reported later finds this instance and corrects it.
    }

    // Record what this instance laid out with, and whether that is the answer we
    // already believe. `exact` instances never get a state push, which is what
    // makes a pre-warmed mount cost zero extra commits.
    LedgerEntry& ledger = ledger_[instanceId];
    if (ledger.key) {
      removeNeedsCorrectionLocked(ledger.key, instanceId);
    }
    // The instance moved configuration (or the environment moved under it): what
    // it is on screen with no longer belongs to this key.
    const bool sameConfiguration = ledger.key == key;
    if (!sameConfiguration) {
      ledger.laidOut = NitroUiMeasuredSize{};
    }
    ledger.key = key;
    ledger.exact = exact;
    ledger.componentName = componentName;
    ledger.sizingKey = sizingKey;

    if (traceEnabled_.load(std::memory_order_relaxed)) {
      // Only when the answer for this instance changed: a control that is laid
      // out a hundred times at one size is not a hundred trace events.
      if (!(ledger.laidOut.width > 0 && sameSizeIgnoringKey(ledger.laidOut, result))) {
        recordTraceLocked(instanceId, kStageLaidOut, result.width, result.height);
      }
    }
    ledger.laidOut = result;
    if (!exact) {
      addNeedsCorrectionLocked(key, instanceId);
    }
    return result;
  }

  void NitroUiSizingEngine::setFallback(const char* componentName, float width, float height, uint32_t flags) {
    if (width <= 0 || height <= 0) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    fallbacks_[componentHash(componentName)] = NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags};
    // A re-declaration means the history this component's configurations had is
    // about the environment or build that this number replaces.
    dropGuessesForLocked(componentHash(componentName), componentName);
  }

  void NitroUiSizingEngine::seedSize(const char* componentName, const std::string& sizingKey, float width, float height, uint32_t flags) {
    if (width <= 0 || height <= 0) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    const NitroUiSizeKey key = keyFor(componentName, sizingKey, environmentEpoch_);
    // Provisional: nothing measured this, so a control that disagrees still wins
    // (review B2). This is also what makes the on-device tests able to fail.
    cache_[key.hash] = SizeEntry{key, NitroUiMeasuredSize{width, height, key, flags}, true};
    stats_.cachedSizes = static_cast<int64_t>(cache_.size());
    fallbacks_[componentHash(componentName)] = NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags};
    dropGuessesForLocked(componentHash(componentName), componentName);
    // The seed is also this configuration's new history, so an epoch bump after it
    // still guesses the seeded number rather than an older measurement.
    guesses_[guessHash(componentName, sizingKey)] = GuessEntry{std::string(componentName), sizingKey,
                                                               NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags}};
  }

  void NitroUiSizingEngine::report(int64_t instanceId, float width, float height, uint32_t flags) {
    if (instanceId == NitroUiSizing::NO_INSTANCE || !std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0) {
      // A control that measured nothing has not measured anything.
      return;
    }
    bool needsFlush = false;
    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      auto ledger = ledger_.find(instanceId);
      if (ledger == ledger_.end() || !ledger->second.key) {
        // Nothing ever laid out for this instance, so there is nothing to correct.
        // It gets its ledger entry from the next `measure`, and can report again
        // then; that is the order a mount actually happens in.
        return;
      }
      const NitroUiSizeKey& key = ledger->second.key;
      const NitroUiMeasuredSize measured{width, height, key, flags};
      // Does this agree with what the instance is already laid out with? (The key
      // is not part of that question - see `sameSizeIgnoringKey`.)
      const bool agrees = ledger->second.laidOut.width > 0 && sameSizeIgnoringKey(ledger->second.laidOut, measured);

      if (agrees) {
        bool othersPending = false;
        auto needs = needsCorrection_.find(key.hash);
        if (needs != needsCorrection_.end()) {
          for (const int64_t other: needs->second) {
            if (other != instanceId) {
              othersPending = true;
              break;
            }
          }
        }
        if (!othersPending) {
          // Nothing on this instance needs a commit: neither does anything else
          // with the same configuration. Confirm it and stop here - this is where
          // a pre-warmed mount, and an environment change that did not move this
          // control, stop costing anything at all.
          stats_.reportsDropped += 1;
          stats_.reportsConfirmed += 1;
          ledger->second.exact = true;
          removeNeedsCorrectionLocked(key, instanceId);
          // The control confirmed a size for *this* configuration, so this
          // configuration now has an authoritative answer - whether the cache had
          // a provisional guess that agreed, a provisional guess that this control
          // happens to match by luck, or nothing at all. Filling the entry here is
          // what keeps the next mount from falling back to the component's declared
          // guess again; only the guess being *wrong* may cost a correction (B2).
          guesses_[guessHash(ledger->second.componentName.c_str(), ledger->second.sizingKey)] =
              GuessEntry{ledger->second.componentName, ledger->second.sizingKey,
                         NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags}};
          auto cached = cache_.find(key.hash);
          if (cached != cache_.end() && cached->second.key == key && !cached->second.provisional) {
            // Already authoritative: leave the recorded size alone.
          } else if (cached == cache_.end() || cached->second.key != key) {
            cache_[key.hash] = SizeEntry{key, measured, false};
            stats_.cachedSizes = static_cast<int64_t>(cache_.size());
          } else {
            cached->second.provisional = false;
            cached->second.size = measured;
          }
          return;
        }
      }

      // Something to correct - either this instance's size, or another instance of
      // the same configuration waiting for the answer this control measured.
      ledger->second.exact = false;
      // Last report of the turn wins for this instance.
      pending_.erase(std::remove_if(pending_.begin(), pending_.end(),
                                    [&](const Report& existing) { return existing.instanceId == instanceId; }),
                     pending_.end());
      pending_.push_back(Report{instanceId, width, height, flags, 0});
      stats_.reportsQueued += 1;
      needsFlush = true;
    }
#if defined(__APPLE__)
    if (needsFlush) {
      installFlushObserverIfNeeded();
      // The observer only runs when the run loop next gets to that point, and
      // nothing else guarantees another pass: without this, a correction that
      // lands at the end of a turn waits for the next touch. Waking the loop costs
      // nothing when it is already awake, and a block on the main queue (the trace
      // sample used to be the accidental reason this worked) is not a design.
      CFRunLoopWakeUp(CFRunLoopGetMain());
    }
#else
    (void) needsFlush;
    // Android flushes from an `OnPreDrawListener`, which returns `false` to skip
    // the frame the reports would have made wrong.
#endif
  }

  bool NitroUiSizingEngine::hasPendingReports() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    return !pending_.empty();
  }

  size_t NitroUiSizingEngine::cachedSizeCount() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    return cache_.size();
  }

  bool NitroUiSizingEngine::flush() {
    return flush(kImmediateBudgetPerTurn);
  }

  bool NitroUiSizingEngine::flush(int32_t immediateBudget) {
    std::vector<Report> reports{};
    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      if (pending_.empty()) {
        return false;
      }
      reports.swap(pending_);
      stats_.flushes += 1;
    }
    const int64_t startedAt = NitroUiClock::nowNs();
    const bool changed = applyReports(reports, immediateBudget);
    const int64_t elapsed = NitroUiClock::nowNs() - startedAt;
    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      stats_.lastFlushNs = elapsed;
      stats_.maxFlushNs = std::max(stats_.maxFlushNs, elapsed);
      if (changed) {
        // Renamed for what it counts (DECISIONS D16).
        // What this counts is "a flush changed at least one size", and what that
        // is worth depends on the platform. Android's `OnPreDrawListener` returns
        // `false` on exactly these flushes, so here the count is also the number
        // of frames that never reached the screen. iOS flushes from a run-loop
        // observer below Core Animation's commit observer, so a correction that
        // arrives *within* a turn is committed in that same turn - but a size can
        // only be corrected once the native side has measured it, and when that is
        // a later turn the frame the turn started with is already on screen. The
        // T11 harness measures that case (one stale frame in `poison`), so this is
        // not evidence of a skipped frame on iOS; the trace's `drew` samples are.
        stats_.changedFlushes += 1;
      }
      sweepExpiredLocked();
    }
    return changed;
  }

  bool NitroUiSizingEngine::applyReports(std::vector<Report>& reports, int32_t immediateBudget) {
    bool changed = false;
    // Registry entries whose state has died (an unmounted or recycled node).
    std::vector<int64_t> dead{};
    // What this flush may spend synchronously - the platform's call, see
    // `flush(int32_t)`.
    int32_t remaining = immediateBudget > 0 ? immediateBudget : 0;
    /**
     * The pushes to issue, collected under the lock and run after it is dropped.
     *
     * A push is a Fabric state update, and a state update can reach this file
     * again on the same thread: the resulting commit re-layouts, `measureContent`
     * calls `measure`, and `std::shared_mutex` is not recursive - holding the lock
     * across a push is a deadlock waiting for the layout to be synchronous.
     */
    struct Pending {
      NitroUiPushFn push;
      NitroUiStateRef state;
      NitroUiMeasuredSize measured;
      bool immediate;
    };
    std::vector<Pending> pending{};
    // Reports whose instance has no state to push into yet, and instances that are
    // waiting for this configuration but cannot be reached yet. Both mean "not
    // now", and dropping them outright is how a control ends up stuck at the
    // fallback size (review S7).
    std::vector<Report> requeue{};

    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      for (const auto& report: reports) {
        auto ledger = ledger_.find(report.instanceId);
        if (ledger == ledger_.end() || !ledger->second.key) {
          // Never laid out, or forgotten: nothing to correct, and nothing will be.
          continue;
        }
        const NitroUiSizeKey key = ledger->second.key;
        const NitroUiMeasuredSize measured{report.width, report.height, key, report.flags};

        auto instance = registry_.find(report.instanceId);
        if (instance == registry_.end()) {
          // Never bound: the report arrived between `measure` and the mount that
          // binds the state. Try again for a bounded number of flushes; the ledger
          // entry stays either way, so a later report works normally.
          if (report.unboundTries < kUnboundReportRetries) {
            Report retry = report;
            retry.unboundTries += 1;
            requeue.push_back(retry);
          }
          continue;
        }
        auto state = instance->second.state.lock();
        if (state == nullptr) {
          // The shadow tree let this node's state go and nobody called `forget`:
          // the instance is gone, so everything filed under it goes with it.
          dead.push_back(report.instanceId);
          continue;
        }

        // The cache entry is what makes the *next* mount of this configuration
        // exact on its first layout, so it goes in before any push. A size a
        // control measured is authoritative: it replaces a provisional entry that
        // disagreed, which is the other half of review B2.
        cache_[key.hash] = SizeEntry{key, measured, false};
        stats_.cachedSizes = static_cast<int64_t>(cache_.size());
        // Same configuration, so it is this configuration's history - filed by
        // (component, sizingKey), never by component alone.
        const std::string& sizingKey = ledger->second.sizingKey;
        guesses_[guessHash(ledger->second.componentName.c_str(), sizingKey)] =
            GuessEntry{ledger->second.componentName, sizingKey,
                       NitroUiMeasuredSize{report.width, report.height, NitroUiSizeKey{}, report.flags}};
/**
         * The measured size deliberately does **not** become the component's
         * fallback. `fallbacks_` is keyed by component alone, so writing the last
         * measurement into it lets one configuration become another one's guess:
         * a 100-wide variant was measured, and the next cold mount of the default
         * configuration was laid out 100 wide (reproduced on the host: a fresh
         * default mount answered 100x28 after a wide variant reported). A guess
         * belongs to the configuration it came from, which is what `cache_` is
         * for; the declared fallback stays the only component-wide guess, and it
         * is exactly the number the component declared for this OS (D14).
         */
        // Every instance that laid out with a wrong size for this key gets the
        // same correction, not only the one that reported.
        auto needs = needsCorrection_.find(key.hash);
        std::vector<int64_t> targets{};
        if (needs != needsCorrection_.end()) {
          targets.swap(needs->second);
          needsCorrection_.erase(needs);
        }
        if (std::find(targets.begin(), targets.end(), report.instanceId) == targets.end()) {
          targets.push_back(report.instanceId);
        }

        std::vector<int64_t> waiting{};
        for (const int64_t target: targets) {
          auto targetInstance = registry_.find(target);
          if (targetInstance == registry_.end()) {
            // Not bound yet - put it back rather than lose the correction (S7).
            waiting.push_back(target);
            continue;
          }
          auto targetState = targetInstance->second.state.lock();
          if (targetState == nullptr) {
            dead.push_back(target);
            continue;
          }
          auto targetLedger = ledger_.find(target);
          if (targetLedger == ledger_.end() || targetLedger->second.exact || !(targetLedger->second.key == key)) {
            continue;
          }
          // Marked before the push: the new layout this push causes will re-enter
          // `measure`, find the cache full, and record `exact` itself.
          targetLedger->second.exact = true;
          if (targetLedger->second.laidOut.width > 0 && sameSizeIgnoringKey(targetLedger->second.laidOut, measured)) {
            // It is already on screen at this size (an environment change that
            // moved the epoch and not the control). Confirming it must not cost a
            // commit - or the epoch bump would push every mounted control a size it
            // already has.
            stats_.reportsConfirmed += 1;
            continue;
          }
          // What the instance is now being told to lay out with. Recording it here
          // (rather than only in `measure`, which runs when the commit lands) is
          // what makes the host's next report of the same size a confirmation
          // instead of a second correction.
          targetLedger->second.laidOut = measured;
          changed = true;
          const bool immediate = remaining > 0;
          remaining -= 1;
          if (immediate) {
            stats_.correctionsImmediate += 1;
          } else {
            stats_.correctionsBatched += 1;
          }
          if (traceEnabled_.load(std::memory_order_relaxed)) {
            recordTraceLocked(target, kStageCorrected, measured.width, measured.height);
          }
          pending.push_back(Pending{targetInstance->second.push, targetState, measured, immediate});
        }
        for (const int64_t target: waiting) {
          addNeedsCorrectionLocked(key, target);
        }
      }
      for (const int64_t instanceId: dead) {
        forgetLocked(instanceId);
      }
      for (const auto& report: requeue) {
        bool duplicate = false;
        for (const auto& existing: pending_) {
          if (existing.instanceId == report.instanceId) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) {
          pending_.push_back(report);
        }
      }
    }

    for (const auto& entry: pending) {
      entry.push(entry.state, entry.measured, entry.immediate);
    }
    return changed;
  }

  // MARK: - Pre-warm, stats and the trace

  bool NitroUiSizingEngine::prewarm(const char* componentName) {
    if (componentName == nullptr) {
      return false;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    auto fallback = fallbacks_.find(componentHash(componentName));
    if (fallback == fallbacks_.end()) {
      // Nothing declared: this component is not loaded, or does not size itself.
      return false;
    }
    const NitroUiSizeKey key = keyFor(componentName, "", environmentEpoch_);
    // Provisional, never authoritative (review B2): this is the library's own
    // guess at what the control is, not a measurement of it. An app that
    // pre-warms must be able to be wrong without freezing a wrong layout for the
    // session - the case that used to bite iOS 26 apps running with
    // `UIDesignRequiresCompatibility`, where the declared 61x28 was laid over a
    // 51x31 control and every Switch kept a box 3 pt too short.
    cache_[key.hash] = SizeEntry{key, NitroUiMeasuredSize{fallback->second.width, fallback->second.height, key,
                                                         fallback->second.flags},
                                 true};
    stats_.cachedSizes = static_cast<int64_t>(cache_.size());
    return true;
  }

  NitroUiSizingCounters NitroUiSizingEngine::stats() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    NitroUiSizingCounters stats = stats_;
    stats.cachedSizes = static_cast<int64_t>(cache_.size());
    stats.environmentEpoch = static_cast<int64_t>(environmentEpoch_);
    stats.ledgerEntries = static_cast<int64_t>(ledger_.size());
    stats.registryEntries = static_cast<int64_t>(registry_.size());
    return stats;
  }

  void NitroUiSizingEngine::recordDrawnSize(int64_t instanceId, float width, float height) {
    if (instanceId == NitroUiSizing::NO_INSTANCE || !traceEnabled_.load(std::memory_order_relaxed)) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    recordTraceLocked(instanceId, kStageDrew, width, height);
  }

  void NitroUiSizingEngine::setTraceEnabled(bool enabled) {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    traceEnabled_.store(enabled, std::memory_order_relaxed);
    trace_.clear();
    stats_.traceDropped = 0;
  }

  std::vector<NitroUiSizingTraceEntry> NitroUiSizingEngine::drainTrace() {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    std::vector<NitroUiSizingTraceEntry> events{};
    events.swap(trace_);
    return events;
  }

  void NitroUiSizingEngine::recordTraceLocked(int64_t instanceId, int32_t stage, float width, float height) {
    if (trace_.size() >= kTraceCapacity) {
      trace_.erase(trace_.begin());
      stats_.traceDropped += 1;
    }
    trace_.push_back(NitroUiSizingTraceEntry{instanceId, stage, width, height, NitroUiClock::nowNs()});
  }

  // MARK: - The host-facing entry points (cpp/core/NitroUiSizing.hpp)

  void NitroUiSizing::report(int64_t instanceId, double width, double height, int32_t policy) {
    NitroUiSizingEngine::shared().report(instanceId,
                                         static_cast<float>(width),
                                         static_cast<float>(height),
                                         policy == POLICY_FILL_WIDTH ? NitroUiSizingEngine::kFlagFillWidth : 0u);
  }

  bool NitroUiSizing::flush() {
    return NitroUiSizingEngine::shared().flush();
  }

  bool NitroUiSizing::flush(int32_t immediateBudget) {
    return NitroUiSizingEngine::shared().flush(immediateBudget);
  }

  void NitroUiSizing::invalidateEnvironment() {
    NitroUiSizingEngine::shared().invalidateEnvironment();
  }

  void NitroUiSizing::invalidateEnvironmentIfChanged(const char* signature) {
    NitroUiSizingEngine::shared().invalidateEnvironmentIfChanged(signature != nullptr ? std::string(signature) : std::string());
  }

  void NitroUiSizing::setFallback(const char* componentName, double width, double height, int32_t policy) {
    NitroUiSizingEngine::shared().setFallback(componentName,
                                              static_cast<float>(width),
                                              static_cast<float>(height),
                                              policy == POLICY_FILL_WIDTH ? NitroUiSizingEngine::kFlagFillWidth : 0u);
  }

  void NitroUiSizing::recordDrawnSize(int64_t instanceId, double width, double height) {
    NitroUiSizingEngine::shared().recordDrawnSize(instanceId,
                                                  static_cast<float>(width),
                                                  static_cast<float>(height));
  }

  int64_t NitroUiSizing::cachedSizeCount() {
    return static_cast<int64_t>(NitroUiSizingEngine::shared().cachedSizeCount());
  }

  void NitroUiSizing::forget(int64_t instanceId) {
    NitroUiSizingEngine::shared().forget(instanceId);
  }

} // namespace margelo::nitro::nitroui
