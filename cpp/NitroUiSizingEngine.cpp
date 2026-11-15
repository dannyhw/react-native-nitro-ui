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

    // FNV-1a, 64 bit: allocation-free, and the same on every platform and compiler.
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

    // Same size, ignoring which configuration it belongs to. After an environment change the size
    // on screen belongs to the old key, and a control whose size did not move must not be pushed
    // again.
    inline bool sameSizeIgnoringKey(const NitroUiMeasuredSize& a, const NitroUiMeasuredSize& b) {
      return a.flags == b.flags && nearlyEqual(a.width, b.width) && nearlyEqual(a.height, b.height);
    }

    // Whether a push would change what is on screen. A `fillWidth` control's width belongs to its
    // Yoga box and each report only restates the box it was measured in, so only the height is
    // compared. An `intrinsic` control compares both.
    inline bool sameSizeForPush(const NitroUiMeasuredSize& a, const NitroUiMeasuredSize& b) {
      if (a.flags != b.flags) {
        return false;
      }
      if ((a.flags & NitroUiSizingEngine::kFlagFillWidth) != 0) {
        return nearlyEqual(a.height, b.height);
      }
      return nearlyEqual(a.width, b.width) && nearlyEqual(a.height, b.height);
    }

#if defined(__APPLE__)
    // One observer on the main run loop, ordered before Core Animation's commit observer (order
    // 2,000,000 on `kCFRunLoopBeforeWaiting`), so every size measured this turn is laid out before
    // the frame commits. Installed on the first report, when the main run loop is certainly
    // running.
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
    // Leaked on purpose: the run-loop observer or a layout thread can still call in at process
    // exit, after a function-local static would have been destroyed.
    static auto* engine = new NitroUiSizingEngine();
    return *engine;
  }

  int64_t NitroUiSizingEngine::nextInstanceId() {
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
    return keyFor(componentName, sizingKey, 0).hash;
  }

  NitroUiMeasuredSize NitroUiSizingEngine::filedSizeLocked(const NitroUiMeasuredSize& reported, const std::string& componentName) const {
    if ((reported.flags & kFlagFillWidth) == 0) {
      return reported;
    }
    auto fallback = fallbacks_.find(componentHash(componentName.c_str()));
    if (fallback == fallbacks_.end()) {
      // Nothing declared, so there is no width to substitute.
      return reported;
    }
    NitroUiMeasuredSize filed = reported;
    filed.width = fallback->second.width;
    return filed;
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
      // Re-key for the new environment and mark the entry inexact, so the instance's next report is
      // compared with the size still on screen instead of being dropped.
      ledger.key = keyFor(ledger.componentName.c_str(), ledger.sizingKey, environmentEpoch_);
      if (ledger.key) {
        ledger.exact = false;
        addNeedsCorrectionLocked(ledger.key, entry.first);
      }
    }
    // The fallbacks stay: components declare them once at process start, and without one the first
    // layout in the new environment would be 0x0. They carry an empty key, so they remain guesses.
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
    // Overwrites: after a push the family has a new `State`, and the platform binds again with it.
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    // A bind proves the id is live, whatever an earlier mount did with it.
    clearForgottenLocked(instanceId);
    // A re-shown view was laid out before this bind and that layout is on hold. Claim it, or
    // `report` has no ledger entry to compare with.
    const bool claimedHold = claimLateFilingLocked(instanceId);
    waitingForBind_.erase(instanceId);
    // Nothing to claim, and the engine dropped this id's entry earlier: the bind arrived after both
    // windows closed. The instance has no ledger row, so its report would be ignored. Make its next
    // props update re-measure, which files the row.
    const bool owedASecondLook = !claimedHold && consumeFilingAbandonedLocked(instanceId);
    registry_[instanceId] = BoundInstance{componentHash, push, state, owedASecondLook};
  }

  void NitroUiSizingEngine::forget(int64_t instanceId) {
    if (instanceId == NitroUiSizing::NO_INSTANCE) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    forgetLocked(instanceId);
  }

  void NitroUiSizingEngine::stageLateFilingLocked(int64_t instanceId, const LedgerEntry& entry) {
    // At capacity, expired holds are pruned first. Only if none are left is a hold that is still
    // inside its window evicted.
    if (lateFilings_.find(instanceId) == lateFilings_.end()) {
      if (lateFilingQueue_.size() >= kLateFilingCapacity) {
        pruneLateFilingsLocked();
      }
      while (lateFilingQueue_.size() >= kLateFilingCapacity) {
        // Memory backstop: the oldest hold is dropped while still in its window, and that control
        // loses its correction.
        const int64_t oldest = lateFilingQueue_.front();
        lateFilingQueue_.pop_front();
        if (lateFilings_.erase(oldest) > 0) {
          markFilingAbandonedLocked(oldest);
        }
      }
      lateFilingQueue_.push_back(instanceId);
    }
    lateFilings_[instanceId] = HeldFiling{entry, NitroUiClock::nowNs()};
    // The needs-correction set is walked for bound instances only, so a held id must not be in it.
    // `claimLateFilingLocked` puts it back.
    if (entry.key && !entry.exact) {
      removeNeedsCorrectionLocked(entry.key, instanceId);
    }
  }

  void NitroUiSizingEngine::pruneLateFilingsLocked() {
    // Oldest staged first. The rule is age, not id distance: a re-shown view keeps the id from its
    // React mount, which can be thousands of ids old. Slots whose entry was claimed or forgotten
    // are skipped.
    const int64_t oldestAllowed = NitroUiClock::nowNs() - kLateFilingGraceNs;
    while (!lateFilingQueue_.empty()) {
      const int64_t instanceId = lateFilingQueue_.front();
      auto held = lateFilings_.find(instanceId);
      if (held == lateFilings_.end()) {
        lateFilingQueue_.pop_front();
        continue;
      }
      if (held->second.stagedAtNs > oldestAllowed) {
        // The queue is in staged order, so everything behind the front is in its window too.
        break;
      }
      lateFilings_.erase(held);
      lateFilingQueue_.pop_front();
      markFilingAbandonedLocked(instanceId);
    }
  }

  void NitroUiSizingEngine::markFilingAbandonedLocked(int64_t instanceId) {
    abandonedFilings_[static_cast<size_t>(instanceId) & (kForgottenCapacity - 1)] = instanceId;
  }

  bool NitroUiSizingEngine::consumeFilingAbandonedLocked(int64_t instanceId) {
    int64_t& slot = abandonedFilings_[static_cast<size_t>(instanceId) & (kForgottenCapacity - 1)];
    if (slot != instanceId) {
      return false;
    }
    slot = NitroUiSizing::NO_INSTANCE;
    return true;
  }

  void NitroUiSizingEngine::pruneUnboundFilingsLocked() {
    // Rows whose bind did not come in time are demoted to the held table, not deleted: layout
    // legitimately runs before the bind, and a late bind can still claim a held row. Deleting would
    // lose that control's correction for the life of its mount.
    const int64_t oldestAllowed = NitroUiClock::nowNs() - kLateFilingGraceNs;
    while (!unboundQueue_.empty()) {
      const UnboundFiling filing = unboundQueue_.front();
      if (filing.filedAtNs > oldestAllowed) {
        break;
      }
      unboundQueue_.pop_front();
      if (waitingForBind_.erase(filing.instanceId) == 0) {
        // Already bound or demoted: a stale slot.
        continue;
      }
      demoteUnboundFilingLocked(filing.instanceId);
    }
  }

  void NitroUiSizingEngine::demoteUnboundFilingLocked(int64_t instanceId) {
    auto ledger = ledger_.find(instanceId);
    if (ledger != ledger_.end()) {
      stageLateFilingLocked(instanceId, ledger->second);
      ledger_.erase(ledger);
    }
    rememberForgottenLocked(instanceId);
  }

  void NitroUiSizingEngine::fileAwaitingBindLocked(int64_t instanceId) {
    if (!waitingForBind_.insert(instanceId).second) {
      // Already waiting; it ages from its original filing time.
      return;
    }
    // At capacity the oldest waiting row is demoted to the held table, where its bind can still
    // claim it.
    while (unboundQueue_.size() >= kUnboundFilingCapacity) {
      const int64_t oldest = unboundQueue_.front().instanceId;
      unboundQueue_.pop_front();
      if (waitingForBind_.erase(oldest) > 0) {
        demoteUnboundFilingLocked(oldest);
      }
    }
    unboundQueue_.push_back(UnboundFiling{instanceId, NitroUiClock::nowNs()});
  }

  bool NitroUiSizingEngine::claimLateFilingLocked(int64_t instanceId) {
    auto held = lateFilings_.find(instanceId);
    if (held == lateFilings_.end()) {
      return false;
    }
    LedgerEntry& ledger = ledger_[instanceId];
    ledger = held->second.entry;
    lateFilings_.erase(held);
    // The queue slot is left behind for the prune to skip, so no deque scan is needed here.
    if (ledger.key && !ledger.exact) {
      addNeedsCorrectionLocked(ledger.key, instanceId);
    }
    return true;
  }

  size_t NitroUiSizingEngine::lateFilingCount() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    return lateFilings_.size();
  }

  size_t NitroUiSizingEngine::unboundFilingCount() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    return waitingForBind_.size();
  }

  void NitroUiSizingEngine::rememberForgottenLocked(int64_t instanceId) {
    forgotten_[static_cast<size_t>(instanceId) & (kForgottenCapacity - 1)] = instanceId;
  }

  void NitroUiSizingEngine::clearForgottenLocked(int64_t instanceId) {
    int64_t& slot = forgotten_[static_cast<size_t>(instanceId) & (kForgottenCapacity - 1)];
    if (slot == instanceId) {
      slot = NitroUiSizing::NO_INSTANCE;
    }
  }

  bool NitroUiSizingEngine::isForgottenLocked(int64_t instanceId) const {
    return forgotten_[static_cast<size_t>(instanceId) & (kForgottenCapacity - 1)] == instanceId;
  }

  void NitroUiSizingEngine::forgetLocked(int64_t instanceId) {
    // First, and even when there is nothing to erase: this mark is what makes a layout that arrives
    // after the drop harmless.
    rememberForgottenLocked(instanceId);
    registry_.erase(instanceId);
    auto ledger = ledger_.find(instanceId);
    if (ledger != ledger_.end() && ledger->second.key) {
      removeNeedsCorrectionLocked(ledger->second.key, instanceId);
    }
    ledger_.erase(instanceId);
    // A hold left by a late layout belongs to a revision that is gone. Its queue slot stays for the
    // prune to skip.
    lateFilings_.erase(instanceId);
    // A finished id has no mount left to re-measure, so clear the abandoned mark too.
    consumeFilingAbandonedLocked(instanceId);
    // A queued correction for an instance that is gone must not be applied later.
    pending_.erase(std::remove_if(pending_.begin(), pending_.end(),
                                  [&](const Report& report) { return report.instanceId == instanceId; }),
                   pending_.end());
    waitingForBind_.erase(instanceId);
    // Re-anchor the sweep threshold to the registry's new size. Otherwise, after many views are
    // dropped at once, the next sweep would wait for the registry to regrow past its old peak.
    nextRegistrySweepAt_ = std::min(nextRegistrySweepAt_, registry_.size() + kRegistrySweepStride);
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
    // `forget` is what keeps these maps bounded. This walk only covers a host that went away
    // without calling it, so it waits until the registry has grown by a full stride.
    if (registry_.size() < nextRegistrySweepAt_) {
      return;
    }
    nextRegistrySweepAt_ = registry_.size() + kRegistrySweepStride;
    // `forgetLocked` erases from `registry_`, so collect the expired ids first rather than erase
    // while iterating.
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
      // Sizing is off for this view: JS never gave it a `nuiSizingId`.
      return NitroUiMeasuredSize{};
    }

    const std::lock_guard<std::shared_mutex> lock(mutex_);
    stats_.measurements += 1;
    // Pruned on every measure, not only on a late filing: a slow trickle of orphans would otherwise
    // never be reclaimed. One branch each when nothing is held or waiting.
    pruneLateFilingsLocked();
    pruneUnboundFilingsLocked();
    const NitroUiSizeKey key = keyFor(componentName, sizingKey, environmentEpoch_);

    NitroUiMeasuredSize result{};
    bool exact = false;

    auto cached = cache_.find(key.hash);
    if (cached != cache_.end() && cached->second.key == key) {
      result = cached->second.size;
      result.key = key;
      // A pre-warmed or seeded entry answers the layout, but the instance stays inexact until a
      // control confirms it.
      exact = !cached->second.provisional;
    } else if (fromState.valid() && fromState.key == key) {
      // Native pushed this size into the state for *this* configuration.
      result = fromState;
      exact = true;
    } else {
      // Cold. Guess from what this configuration last measured (`guesses_` survives an environment
      // change), else from the component's declared size.
      auto guess = guesses_.find(guessHash(componentName, sizingKey));
      if (guess != guesses_.end() && guess->second.componentName == componentName &&
          guess->second.sizingKey == sizingKey) {
        result = guess->second.size;
      } else {
        auto fallback = fallbacks_.find(componentHash(componentName));
        result = fallback != fallbacks_.end() ? fallback->second : NitroUiMeasuredSize{};
      }
      // A guess keeps an empty key: `valid()` is how the rest of the code tells a guess from an
      // answer. The ledger still records the key, so the real size finds this instance.
    }

    // A layout for a finished id is still recorded, but held outside `ledger_` (see
    // `lateFilings_`): a re-shown view is laid out before its bind and needs the entry.
    const bool filedLate = isForgottenLocked(instanceId);

    // Record what this instance laid out with. An `exact` instance never gets a state push, which
    // is why a pre-warmed mount costs no extra commit.
    LedgerEntry& ledger = ledger_[instanceId];
    const bool freshRow = !ledger.key && !ledger.hasMeasured;
    if (ledger.key) {
      removeNeedsCorrectionLocked(ledger.key, instanceId);
    }
    // The configuration or the environment changed: the size on screen no longer belongs to this
    // key.
    const bool sameConfiguration = ledger.key == key;
    if (!sameConfiguration) {
      ledger.laidOut = NitroUiMeasuredSize{};
    }
    ledger.key = key;
    ledger.exact = exact;
    ledger.componentName = componentName;
    ledger.sizingKey = sizingKey;

    if (traceEnabled_.load(std::memory_order_relaxed)) {
      // Only when the answer changed, so repeated layouts at one size are one trace event.
      if (!(ledger.laidOut.width > 0 && sameSizeIgnoringKey(ledger.laidOut, result))) {
        recordTraceLocked(instanceId, kStageLaidOut, result.width, result.height);
      }
    }
    // The answer for this instance changed, so its node must re-measure on later props updates (see
    // `requiresFreshMeasure`). A change of configuration does not count: that update is already
    // dirty and gets the fresh answer in the same layout.
    if (ledger.hasMeasured && sameConfiguration && !sameSizeForPush(ledger.laidOut, result)) {
      ledger.answerChanged = true;
    }
    ledger.hasMeasured = true;
    ledger.laidOut = result;
    if (!exact) {
      addNeedsCorrectionLocked(key, instanceId);
    }
    if (filedLate) {
      stageLateFilingLocked(instanceId, ledger);
      if (freshRow) {
        // This layout created the row and the id is finished: take the row back out, so `ledger_`
        // holds live instances only.
        ledger_.erase(instanceId);
      }
      return result;
    }
    // A new row for an unbound id waits for its bind; not being bound yet is normal while a commit
    // is in flight. A new row for a bound id is the re-measure that instance owed.
    if (freshRow) {
      const auto bound = registry_.find(instanceId);
      if (bound == registry_.end()) {
        fileAwaitingBindLocked(instanceId);
      } else {
        bound->second.owesFreshMeasure = false;
      }
    }
    return result;
  }

  bool NitroUiSizingEngine::requiresFreshMeasure(int64_t instanceId) const {
    if (instanceId == NitroUiSizing::NO_INSTANCE) {
      return false;
    }
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    auto ledger = ledger_.find(instanceId);
    if (ledger != ledger_.end() && ledger->second.answerChanged) {
      return true;
    }
    auto instance = registry_.find(instanceId);
    return instance != registry_.end() && instance->second.owesFreshMeasure;
  }

  void NitroUiSizingEngine::setFallback(const char* componentName, float width, float height, uint32_t flags) {
    if (width <= 0 || height <= 0) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    fallbacks_[componentHash(componentName)] = NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags};
    // A new declaration supersedes what this component's configurations measured before.
    dropGuessesForLocked(componentHash(componentName), componentName);
  }

  void NitroUiSizingEngine::seedSize(const char* componentName, const std::string& sizingKey, float width, float height, uint32_t flags) {
    if (width <= 0 || height <= 0) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    const NitroUiSizeKey key = keyFor(componentName, sizingKey, environmentEpoch_);
    // Provisional: nothing measured this, so a control that disagrees still wins.
    cache_[key.hash] = SizeEntry{key, NitroUiMeasuredSize{width, height, key, flags}, true};
    stats_.cachedSizes = static_cast<int64_t>(cache_.size());
    fallbacks_[componentHash(componentName)] = NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags};
    dropGuessesForLocked(componentHash(componentName), componentName);
    // The seed is also this configuration's history, so an environment change after it still
    // guesses the seeded size.
    guesses_[guessHash(componentName, sizingKey)] = GuessEntry{std::string(componentName), sizingKey,
                                                               NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags}};
  }

  void NitroUiSizingEngine::report(int64_t instanceId, float width, float height, uint32_t flags) {
    if (instanceId == NitroUiSizing::NO_INSTANCE || !std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0) {
      return;
    }
    bool needsFlush = false;
    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      auto ledger = ledger_.find(instanceId);
      if (ledger == ledger_.end() || !ledger->second.key) {
        // Nothing has laid out for this instance yet, so there is nothing to correct. The next
        // `measure` creates its entry and it can report again.
        return;
      }
      const NitroUiSizeKey& key = ledger->second.key;
      const NitroUiMeasuredSize measured{width, height, key, flags};
      const bool agrees = ledger->second.laidOut.width > 0 && sameSizeForPush(ledger->second.laidOut, measured);

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
          // Neither this instance nor any other of its configuration needs a commit. This is where
          // a pre-warmed mount stops costing anything.
          stats_.reportsDropped += 1;
          stats_.reportsConfirmed += 1;
          ledger->second.exact = true;
          removeNeedsCorrectionLocked(key, instanceId);
          // The control confirmed a size for this configuration, so record it as authoritative: the
          // next mount no longer falls back to the declared guess.
          const NitroUiMeasuredSize confirmed =
              filedSizeLocked(measured, ledger->second.componentName);
          guesses_[guessHash(ledger->second.componentName.c_str(), ledger->second.sizingKey)] =
              GuessEntry{ledger->second.componentName, ledger->second.sizingKey,
                         NitroUiMeasuredSize{confirmed.width, confirmed.height, NitroUiSizeKey{}, flags}};
          auto cached = cache_.find(key.hash);
          if (cached != cache_.end() && cached->second.key == key && !cached->second.provisional) {
            // Already authoritative: leave the recorded size alone.
          } else if (cached == cache_.end() || cached->second.key != key) {
            cache_[key.hash] = SizeEntry{key, confirmed, false};
            stats_.cachedSizes = static_cast<int64_t>(cache_.size());
          } else {
            cached->second.provisional = false;
            cached->second.size = confirmed;
          }
          return;
        }
      }

      // This instance, or another one of the same configuration, needs a correction.
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
      // The observer only runs when the run loop reaches that point. Wake the loop, so a correction
      // reported at the end of a turn does not wait for the next event.
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
      // Pruned here as well as in `measure`: a burst of mounts and drops stops laying out when it
      // ends, and the rows it abandoned would otherwise sit until the next layout.
      pruneLateFilingsLocked();
      pruneUnboundFilingsLocked();
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
    int32_t remaining = immediateBudget > 0 ? immediateBudget : 0;
    // Pushes are collected under the lock and run after it is released. A push is a Fabric state
    // update whose commit can re-enter `measure` on this thread, and `std::shared_mutex` is not
    // recursive.
    struct Pending {
      NitroUiPushFn push;
      NitroUiStateRef state;
      NitroUiMeasuredSize measured;
      bool immediate;
    };
    std::vector<Pending> pending{};
    // Reports whose instance has no state to push into yet. Dropping them would leave the control
    // at its fallback size, so they are retried.
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
        // Filed once here, so the cache, the guess, the ledger and the pushed state all get the
        // same size.
        const NitroUiMeasuredSize measured =
            filedSizeLocked({ report.width, report.height, key, report.flags },
                            ledger->second.componentName);

        auto instance = registry_.find(report.instanceId);
        if (instance == registry_.end()) {
          // The report arrived between `measure` and the mount that binds the state: retry for a
          // bounded number of flushes.
          if (report.unboundTries < kUnboundReportRetries) {
            Report retry = report;
            retry.unboundTries += 1;
            requeue.push_back(retry);
          }
          continue;
        }
        auto state = instance->second.state.lock();
        if (state == nullptr) {
          // The shadow tree released this node's state and nobody called `forget`: the instance is
          // gone.
          dead.push_back(report.instanceId);
          continue;
        }

        // Cache first, so the next mount of this configuration is exact on its first layout. A
        // measured size replaces a provisional entry.
        cache_[key.hash] = SizeEntry{key, measured, false};
        stats_.cachedSizes = static_cast<int64_t>(cache_.size());
        const std::string& sizingKey = ledger->second.sizingKey;
        guesses_[guessHash(ledger->second.componentName.c_str(), sizingKey)] =
            GuessEntry{ledger->second.componentName, sizingKey,
                       NitroUiMeasuredSize{measured.width, measured.height, NitroUiSizeKey{}, report.flags}};
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
            // Not bound yet: put it back rather than lose the correction.
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
          if (targetLedger->second.laidOut.width > 0 && sameSizeForPush(targetLedger->second.laidOut, measured)) {
            // Already on screen at this size (the environment changed but this control's size did
            // not), so no commit.
            stats_.reportsConfirmed += 1;
            continue;
          }
          // Recorded here as well as in `measure`, so the host's next report of this size is a
          // confirmation rather than a second correction.
          targetLedger->second.laidOut = measured;
          // The node may not lay out again this turn, so the change is recorded here as well as in
          // `measure`.
          targetLedger->second.answerChanged = true;
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
    // Provisional: this is the declared size, not a measurement, so a control that disagrees still
    // corrects it.
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
