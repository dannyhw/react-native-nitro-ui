//
//  NitroUiSizingEngine.cpp
//  react-native-nitro-ui
//
//  Implementation of the intrinsic-sizing core. See `NitroUiSizingEngine.hpp`
//  for the three data structures and `docs/architecture/sizing.md` for the flow.
//

#include "NitroUiSizingEngine.hpp"

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
    static NitroUiSizingEngine engine;
    return engine;
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

  void NitroUiSizingEngine::invalidateEnvironment() {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    environmentEpoch_ += 1;
    cache_.clear();
    // Every ledger entry was computed for an environment that no longer exists,
    // so none of them may suppress a correction any more. The fallbacks go too:
    // a Switch measured at the default text size is not a fallback at AX5.
    fallbacks_.clear();
    ledger_.clear();
    needsCorrection_.clear();
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

  NitroUiMeasuredSize NitroUiSizingEngine::measure(const char* componentName, int64_t instanceId, const std::string& sizingKey,
                                                   const NitroUiMeasuredSize& fromState) {
    if (instanceId == NitroUiSizing::NO_INSTANCE) {
      // Sizing is off for this view (JS never gave it a `nuiSizingId`), or it is
      // a plain Yoga leaf like every view before this one: measure nothing.
      return NitroUiMeasuredSize{};
    }

    const std::lock_guard<std::shared_mutex> lock(mutex_);
    const NitroUiSizeKey key = keyFor(componentName, sizingKey, environmentEpoch_);

    NitroUiMeasuredSize result{};
    bool exact = false;

    auto cached = cache_.find(key.hash);
    if (cached != cache_.end() && cached->second.key == key) {
      result = cached->second.size;
      result.key = key;
      exact = true;
    } else if (fromState.valid() && fromState.key == key) {
      // Native pushed this size into the state for *this* configuration.
      result = fromState;
      exact = true;
    } else {
      auto fallback = fallbacks_.find(componentHash(componentName));
      result = fallback != fallbacks_.end() ? fallback->second : NitroUiMeasuredSize{};
      // The fallback keeps an empty key on purpose: it is a *guess* for this
      // configuration, and `valid()` is how the rest of the code tells a guess
      // from an answer. The ledger still records the key, so the real size
      // reported later finds this instance and corrects it.
    }

    // Record what this instance laid out with, and whether that is the answer we
    // already believe. `exact` instances never get a state push, which is what
    // makes a pre-warmed mount cost zero extra commits.
    auto previous = ledger_.find(instanceId);
    if (previous != ledger_.end() && previous->second.key) {
      auto needs = needsCorrection_.find(previous->second.key.hash);
      if (needs != needsCorrection_.end()) {
        auto& ids = needs->second;
        ids.erase(std::remove(ids.begin(), ids.end(), instanceId), ids.end());
        if (ids.empty()) {
          needsCorrection_.erase(needs);
        }
      }
    }
    ledger_[instanceId] = LedgerEntry{key, exact};
    if (!exact) {
      needsCorrection_[key.hash].push_back(instanceId);
    }
    return result;
  }

  void NitroUiSizingEngine::setFallback(const char* componentName, float width, float height, uint32_t flags) {
    if (width <= 0 || height <= 0) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    fallbacks_[componentHash(componentName)] = NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags};
  }

  void NitroUiSizingEngine::seedSize(const char* componentName, const std::string& sizingKey, float width, float height, uint32_t flags) {
    if (width <= 0 || height <= 0) {
      return;
    }
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    const NitroUiSizeKey key = keyFor(componentName, sizingKey, environmentEpoch_);
    cache_[key.hash] = SizeEntry{key, NitroUiMeasuredSize{width, height, key, flags}};
    fallbacks_[componentHash(componentName)] = NitroUiMeasuredSize{width, height, NitroUiSizeKey{}, flags};
  }

  void NitroUiSizingEngine::report(int64_t instanceId, float width, float height, uint32_t flags) {
    if (instanceId == NitroUiSizing::NO_INSTANCE || !std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0) {
      // A control that measured nothing has not measured anything.
      return;
    }
    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      auto ledger = ledger_.find(instanceId);
      if (ledger == ledger_.end() || !ledger->second.key) {
        // Nothing ever laid out for this instance, so there is nothing to correct.
        return;
      }
      if (ledger->second.exact) {
        // It already laid out with the size we now measured. The whole point of
        // the ledger: this is where a pre-warmed mount stops costing anything.
        return;
      }
      auto cached = cache_.find(ledger->second.key.hash);
      if (cached != cache_.end() && cached->second.key == ledger->second.key && nearlyEqual(cached->second.size.width, width) &&
          nearlyEqual(cached->second.size.height, height) && (cached->second.size.flags & kFlagFillWidth) == (flags & kFlagFillWidth)) {
        return;
      }
      // Last report of the turn wins for this instance.
      pending_.erase(std::remove_if(pending_.begin(), pending_.end(),
                                    [&](const Report& existing) { return existing.instanceId == instanceId; }),
                     pending_.end());
      pending_.push_back(Report{instanceId, width, height, flags});
    }
#if defined(__APPLE__)
    installFlushObserverIfNeeded();
#else
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
    std::vector<Report> reports{};
    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      if (pending_.empty()) {
        return false;
      }
      reports.swap(pending_);
    }
    return applyReports(reports);
  }

  bool NitroUiSizingEngine::applyReports(std::vector<Report>& reports) {
    bool changed = false;
    // Registry entries whose state has died (an unmounted or recycled node).
    std::vector<int64_t> dead{};
    int32_t remaining = kImmediateBudgetPerTurn;

    {
      const std::lock_guard<std::shared_mutex> lock(mutex_);
      for (const auto& report: reports) {
        auto instance = registry_.find(report.instanceId);
        if (instance == registry_.end()) {
          // Never bound: the report arrived between `measure` and the mount that
          // binds the state, or the view was dropped before it mounted. Drop the
          // report but keep the ledger entry, so the *next* report of this
          // instance can still correct it - guessing it is gone would be how a
          // control gets stuck at the wrong size.
          continue;
        }
        auto state = instance->second.state.lock();
        if (state == nullptr) {
          // The shadow tree let this node's state go: the instance is gone, so
          // its ledger entry goes with it (that is what bounds the ledger).
          dead.push_back(report.instanceId);
          continue;
        }
        auto ledger = ledger_.find(report.instanceId);
        if (ledger == ledger_.end() || !ledger->second.key || ledger->second.exact) {
          continue;
        }
        const NitroUiSizeKey key = ledger->second.key;
        const NitroUiMeasuredSize measured{report.width, report.height, key, report.flags};

        // The cache entry is what makes the *next* mount of this configuration
        // exact on its first layout, so it goes in before any push.
        cache_[key.hash] = SizeEntry{key, measured};
        // A measured size is a better guess for the component than a declared
        // default, and it is the only way a component's fallback stays honest on
        // an OS whose control is a different size (D14).
        fallbacks_[instance->second.componentHash] = NitroUiMeasuredSize{report.width, report.height, NitroUiSizeKey{}, report.flags};

        // Every instance that laid out with a wrong size for this key gets the
        // same correction, not only the one that reported.
        auto needs = needsCorrection_.find(key.hash);
        std::vector<int64_t> targets{};
        if (needs != needsCorrection_.end()) {
          targets.swap(needs->second);
          needsCorrection_.erase(needs);
        } else {
          targets.push_back(report.instanceId);
        }

        for (const int64_t target: targets) {
          auto targetInstance = registry_.find(target);
          if (targetInstance == registry_.end()) {
            continue;
          }
          auto targetState = targetInstance->second.state.lock();
          if (targetState == nullptr) {
            dead.push_back(target);
            continue;
          }
          auto targetLedger = ledger_.find(target);
          if (targetLedger == ledger_.end() || targetLedger->second.exact) {
            continue;
          }
          // Marked before the push: the new layout this push causes will re-enter
          // `measure`, find the cache full, and record `exact` itself.
          targetLedger->second.exact = true;
          changed = true;
          const bool immediate = remaining > 0;
          remaining -= 1;
          targetInstance->second.push(targetState, measured, immediate);
        }
      }
      for (const int64_t instanceId: dead) {
        registry_.erase(instanceId);
        ledger_.erase(instanceId);
      }
    }
    return changed;
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

  void NitroUiSizing::invalidateEnvironment() {
    NitroUiSizingEngine::shared().invalidateEnvironment();
  }

  int64_t NitroUiSizing::cachedSizeCount() {
    return static_cast<int64_t>(NitroUiSizingEngine::shared().cachedSizeCount());
  }

} // namespace margelo::nitro::nitroui
