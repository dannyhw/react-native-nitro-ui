#include "NitroUiSizingEngine.hpp"
#include "core/NitroUiSizing.hpp"

#include <cmath>
#include <cstdio>
#include <functional>
#include <memory>
#include <chrono>
#include <string>
#include <unordered_map>
#include <thread>
#include <vector>

using namespace margelo::nitro::nitroui;

namespace {

  int failures = 0;
  int checks = 0;

  void check(bool condition, const std::string& what) {
    checks++;
    if (!condition) {
      failures++;
      std::printf("  FAIL: %s\n", what.c_str());
    }
  }

  template <typename T>
  void checkEquals(const T& actual, const T& expected, const std::string& what) {
    checks++;
    if (!(actual == expected)) {
      failures++;
      std::printf("  FAIL: %s (got %lld, want %lld)\n", what.c_str(), static_cast<long long>(actual), static_cast<long long>(expected));
    }
  }

  void checkSize(const NitroUiMeasuredSize& size, float width, float height, const std::string& what) {
    check(std::fabs(size.width - width) < 0.001f && std::fabs(size.height - height) < 0.001f,
          what + " (got " + std::to_string(size.width) + "x" + std::to_string(size.height) + ", want " + std::to_string(width) + "x" +
              std::to_string(height) + ")");
  }

  // Stands in for `react::ConcreteState<IntrinsicViewState<Props>>`.
  struct FakeState {
    int tag;
  };

  struct Push {
    int tag;
    float width;
    float height;
    bool immediate;
  };

  std::vector<Push> pushes{};

  /// Holds states alive the way the shadow tree does, so a case controls when one dies.
  std::unordered_map<int64_t, NitroUiStateRef> kept_{};

  NitroUiSizingEngine& engine();

  /// When on, a push is stored and run by the test after `flush()`, the way React
  /// Native runs an asynchronous state update.
  bool deferPushes = false;
  std::vector<std::function<void()>> deferred{};

  /// When on, a push re-lays out and rebinds the instance synchronously, as an
  /// immediate commit does.
  bool reentrantMeasure = false;
  bool reentrantSawSize = false;

  void fakePush(const NitroUiStateRef& state, const NitroUiMeasuredSize& measured, bool immediate) {
    auto* raw = static_cast<const FakeState*>(state.get());
    if (!deferPushes) {
      pushes.push_back(Push{raw->tag, measured.width, measured.height, immediate});
      if (reentrantMeasure && immediate) {
        const int64_t id = raw->tag;
        const NitroUiMeasuredSize seen = engine().measure("NitroUiSwitch", id, "", NitroUiMeasuredSize{});
        reentrantSawSize = std::fabs(seen.width - measured.width) < 0.001f && std::fabs(seen.height - measured.height) < 0.001f;
        auto kept = kept_.find(id);
        if (kept != kept_.end()) {
          engine().registerInstance(id, NitroUiSizingEngine::componentHash("NitroUiSwitch"), &fakePush, kept->second);
        }
      }
      return;
    }
    // Copied: the size lives in a vector the engine frees when `applyReports` returns.
    const NitroUiMeasuredSize copy = measured;
    deferred.emplace_back([raw, copy, immediate] {
      pushes.push_back(Push{raw->tag, copy.width, copy.height, immediate});
    });
  }

  /** Free and reuse heap so a read of freed memory lands on fresh bytes. */
  void churnHeap() {
    for (int round = 0; round < 8; round++) {
      auto* block = new char[512];
      for (int i = 0; i < 512; i++) {
        block[i] = static_cast<char>(0x5a);
      }
      delete[] block;
    }
  }

  void runDeferred() {
    churnHeap();
    for (const auto& push: deferred) {
      push();
    }
    deferred.clear();
  }

  NitroUiSizingEngine& engine() {
    return NitroUiSizingEngine::shared();
  }

  /// Every id this file used, so a case can start from a genuinely empty engine.
  std::vector<int64_t> usedIds{};

  /// A fresh engine. Every id is forgotten first, because `invalidateEnvironment`
  /// keeps mounted instances.
  void resetEngine() {
    for (const int64_t id: usedIds) {
      engine().forget(id);
    }
    usedIds.clear();
    kept_.clear();
    engine().invalidateEnvironment();
    pushes.clear();
    deferred.clear();
    deferPushes = false;
    engine().setTraceEnabled(false);
  }

  NitroUiStateRef bind(int64_t instanceId, int tag) {
    auto state = std::make_shared<FakeState>(FakeState{tag});
    NitroUiStateRef ref = state;
    kept_[instanceId] = ref;
    engine().registerInstance(instanceId, NitroUiSizingEngine::componentHash("NitroUiSwitch"), &fakePush, ref);
    return ref;
  }

  NitroUiMeasuredSize measure(int64_t instanceId, const std::string& key, const NitroUiMeasuredSize& fromState = {}) {
    usedIds.push_back(instanceId);
    return engine().measure("NitroUiSwitch", instanceId, key, fromState);
  }

  size_t countPushes(bool immediate) {
    size_t count = 0;
    for (const Push& push: pushes) {
      count += push.immediate == immediate ? 1 : 0;
    }
    return count;
  }

  void testAFlushWithNothingToApplyStillClosesExpiredMountWindows() {
    using namespace std::chrono_literals;
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    constexpr auto kWindow = std::chrono::nanoseconds(NitroUiSizingEngine::kLateFilingGraceNs);
    constexpr auto kWaitAfterWindow = kWindow + std::chrono::milliseconds(300) > std::chrono::seconds(5)
                                          ? std::chrono::seconds(5)
                                          : kWindow + std::chrono::milliseconds(300);

    for (int64_t cycle = 0; cycle < 10; cycle++) {
      measure(40000 + cycle, "settled");
    }
    checkEquals(engine().stats().ledgerEntries, int64_t{10}, "ten layouts, no mounts");

    std::this_thread::sleep_for(kWaitAfterWindow);
    check(!engine().flush(), "there is genuinely no report to apply");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "and the expired rows are gone anyway");
    checkEquals(engine().unboundFilingCount(), size_t{0}, "with nothing left waiting for a bind");

    // A reclaimed row moves to the held table, which has a window of its own.
    std::this_thread::sleep_for(kWaitAfterWindow);
    check(!engine().flush(), "still nothing to apply");
    checkEquals(engine().lateFilingCount(), size_t{0}, "and the demoted rows are reclaimed by a flush alone");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "with the ledger still empty");
  }

  // MARK: - Cases

  // MARK: - The late-layout orphan

  void testALateLayoutAfterForgetFilesNothing() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    bind(4100, 4100);
    measure(4100, "");
    engine().report(4100, 61, 28, 0);
    engine().flush();
    engine().forget(4100);
    kept_.erase(4100);
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "a dropped instance leaves no ledger entry");

    measure(4100, "");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "a layout arriving after `forget` files nothing");
    checkEquals(engine().stats().registryEntries, int64_t{0}, "and there is no registry row that would let it be reclaimed later");

    for (int64_t cycle = 0; cycle < 50; cycle++) {
      const int64_t id = 4300 + cycle;
      bind(id, static_cast<int>(id));
      measure(id, "");
      engine().report(id, 61, 28, 0);
      engine().flush();
      engine().forget(id);
      kept_.erase(id);
      measure(id, "");
    }
    const NitroUiSizingCounters after = engine().stats();
    checkEquals(after.ledgerEntries, int64_t{0}, "50 drops with a late layout each leave no ledger entry");
    checkEquals(after.registryEntries, int64_t{0}, "and no registry entry");

    // Its own key: the churn above warmed `""`, and a warm mount has nothing to correct.
    bind(4500, 4500);
    measure(4500, "late-live");
    engine().report(4500, 61, 28, 0);
    check(engine().flush(), "a live instance is still corrected after all that");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "with exactly its own entry");
  }

  void testALayoutBeforeItsBindStillGetsCorrected() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    measure(4600, "");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "a mount files its entry before it binds");
    bind(4601, 4601);
    measure(4601, "");
    engine().forget(4601);
    kept_.erase(4601);
    measure(4601, "");

    bind(4600, 4600);
    engine().report(4600, 61, 28, 0);
    check(engine().flush(), "the in-flight mount still gets its correction");
    checkEquals(pushes.size(), size_t{1}, "exactly one push, and it is the live one's");
    const NitroUiSizingCounters stats = engine().stats();
    checkEquals(stats.ledgerEntries, int64_t{1}, "the forgotten id filed nothing while the in-flight one kept its entry");
    checkEquals(stats.registryEntries, int64_t{1}, "and only the live instance is bound");
  }

  void testAnIdThatBindsAgainIsNotTreatedAsFinished() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    bind(4700, 4700);
    measure(4700, "");
    engine().report(4700, 61, 28, 0);
    engine().flush();
    engine().forget(4700);
    kept_.erase(4700);
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "the instance is finished");

    measure(4700, "rebound");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "a finished id files nothing before it rebinds");

    bind(4700, 4700);
    measure(4700, "rebound");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "rebinding clears the mark, so the layout is filed again");

    // `pushes` still holds the first mount's correction, so count from here.
    pushes.clear();
    engine().report(4700, 61, 28, 0);
    check(engine().flush(), "and the re-bound instance still gets its correction");
    checkEquals(pushes.size(), size_t{1}, "one push, for the instance that is live");
    checkEquals(pushes[0].tag, 4700, "and it went to the re-bound instance");
  }

  void testAReshownViewIsStillCorrectedAfterItsLateLayout() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    // `display: none` deletes the native view. Showing it again lays out before it
    // mounts, under the same id.
    bind(4800, 4800);
    measure(4800, "");
    engine().report(4800, 61, 28, 0);
    engine().flush();
    engine().forget(4800);
    kept_.erase(4800);
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "hiding it leaves nothing behind");

    measure(4800, "reshown");

    bind(4800, 4800);
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "a re-shown view has a ledger entry — the layout that arrived first is not thrown away");

    pushes.clear();
    engine().report(4800, 61, 28, 0);
    check(engine().flush(), "and its first measurement is still a correction it can receive");
    checkEquals(pushes.size(), size_t{1}, "exactly one push");
    checkEquals(pushes[0].tag, 4800, "to the re-shown instance");
    checkEquals(pushes[0].width, 61.0f, "with the size the control measured");
  }

  void testAReshownViewIsStillCorrectedByAnEnvironmentChange() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    bind(4900, 4900);
    measure(4900, "");
    engine().report(4900, 61, 28, 0);
    engine().flush();
    engine().forget(4900);
    kept_.erase(4900);

    measure(4900, "");
    bind(4900, 4900);

    engine().invalidateEnvironment();
    pushes.clear();
    engine().report(4900, 74, 33, 0);
    check(engine().flush(), "an environment change still corrects a re-shown view");
    checkEquals(pushes.size(), size_t{1}, "one push for the re-shown instance");
    checkEquals(pushes[0].width, 74.0f, "at the new environment's size, not the old one");
  }

  void testAHeldLateFilingIsBoundedUnderABurstOfDrops() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    int64_t peak = 0;
    for (int64_t cycle = 0; cycle < 1000; cycle++) {
      const int64_t id = 5100 + cycle;
      bind(id, static_cast<int>(id));
      measure(id, "");
      engine().forget(id);
      kept_.erase(id);
      measure(id, "");
      const int64_t held = static_cast<int64_t>(engine().lateFilingCount());
      peak = held > peak ? held : peak;
    }
    check(peak > 0, "the late layouts really were held — otherwise this case proves nothing");
    check(peak <= static_cast<int64_t>(NitroUiSizingEngine::kLateFilingCapacity),
          "the held table stays bounded under a thousand drops");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "and none of it reached the ledger");
    checkEquals(engine().stats().registryEntries, int64_t{0}, "nor the registry");
  }

  void testAHeldLateFilingIsReleasedWhenItsBindMissesTheWindow() {
    using namespace std::chrono_literals;
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    constexpr auto kGrace = std::chrono::nanoseconds(NitroUiSizingEngine::kLateFilingGraceNs);
    constexpr auto kWaitInsideWindow = std::chrono::milliseconds(60);
    // Past the window, clamped so a wrong window fails the test instead of hanging it.
    constexpr auto kWaitAfterWindow = kGrace + std::chrono::milliseconds(300) > std::chrono::seconds(5)
                                          ? std::chrono::seconds(5)
                                          : kGrace + std::chrono::milliseconds(300);

    bind(36000, 36000);
    measure(36000, "");
    engine().forget(36000);
    kept_.erase(36000);
    measure(36000, "reshown");
    checkEquals(engine().lateFilingCount(), size_t{1}, "the late layout is on hold");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "and it is not in the ledger while it is");

    // The neighbour's layout runs the reclaim, which must not take the hold away early.
    std::this_thread::sleep_for(kWaitInsideWindow);
    bind(36001, 36001);
    measure(36001, "");
    checkEquals(engine().lateFilingCount(), size_t{1}, "a bind that is merely slow has not lost its layout");
    bind(36000, 36000);
    checkEquals(engine().lateFilingCount(), size_t{0}, "binding claims it");
    checkEquals(engine().stats().ledgerEntries, int64_t{2}, "as that instance's own row, beside its neighbour's");

    engine().forget(36000);
    kept_.erase(36000);
    measure(36000, "orphaned");
    checkEquals(engine().lateFilingCount(), size_t{1}, "the second late layout is on hold too");
    std::this_thread::sleep_for(kWaitAfterWindow);

    bind(36002, 36002);
    measure(36002, "");
    checkEquals(engine().lateFilingCount(), size_t{0}, "the window releases a hold whose bind never came");
    checkEquals(engine().stats().ledgerEntries, int64_t{2}, "and only that hold — the two live instances are untouched");
  }

  void testALayoutThatNeverBindsIsReclaimedWhenItsMountWindowCloses() {
    using namespace std::chrono_literals;
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    constexpr auto kWindow = std::chrono::nanoseconds(NitroUiSizingEngine::kLateFilingGraceNs);
    // Past the window, clamped so a wrong window fails the test instead of hanging it.
    constexpr auto kWaitAfterWindow = kWindow + std::chrono::milliseconds(300) > std::chrono::seconds(5)
                                          ? std::chrono::seconds(5)
                                          : kWindow + std::chrono::milliseconds(300);

    for (int64_t cycle = 0; cycle < 50; cycle++) {
      measure(37000 + cycle, "");
    }
    checkEquals(engine().stats().ledgerEntries, int64_t{50},
                "a layout for an id that has not bound yet files its entry — the mount may still be on its way");

    bind(37100, 37100);
    measure(37100, "in-flight");
    engine().report(37100, 61, 28, 0);
    check(engine().flush(), "the mount that did arrive is still corrected after the ones that did not were filed");
    checkEquals(pushes.size(), size_t{1}, "exactly one push, and it is the live one's");

    // The reclaim runs from `measure`, so these layouts drive it.
    std::this_thread::sleep_for(kWaitAfterWindow);
    for (int64_t cycle = 0; cycle < 60; cycle++) {
      bind(37200 + cycle, static_cast<int>(37200 + cycle));
      measure(37200 + cycle, "later");
    }
    checkEquals(engine().stats().ledgerEntries, int64_t{61},
                "the fifty layouts that never bound are gone, and only the sixty live ones and the in-flight mount remain");
    checkEquals(engine().stats().registryEntries, int64_t{61}, "and the registry agrees");

    measure(37000, "after");
    checkEquals(engine().stats().ledgerEntries, int64_t{61}, "a layout after the reclaim files nothing");
  }

  void testABigFirstCommitKeepsEveryCorrection() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    const int64_t count = static_cast<int64_t>(NitroUiSizingEngine::kUnboundFilingCapacity) + 200;
    for (int64_t cycle = 0; cycle < count; cycle++) {
      measure(20000 + cycle, "");
    }
    checkEquals(engine().unboundFilingCount(), NitroUiSizingEngine::kUnboundFilingCapacity,
                "the overflow really was reclaimed, rather than the table growing without bound");

    for (int64_t cycle = 0; cycle < count; cycle++) {
      bind(20000 + cycle, static_cast<int>(20000 + cycle));
    }
    checkEquals(engine().stats().ledgerEntries, count,
                "every instance of the commit has a row — a demoted one was claimed back by its bind");
    checkEquals(engine().unboundFilingCount(), size_t{0}, "and nothing is waiting for a bind any more");

    pushes.clear();
    for (int64_t cycle = 0; cycle < count; cycle++) {
      engine().report(20000 + cycle, 61, 28, 0);
    }
    check(engine().flush(), "the whole commit is corrected");
    checkEquals(pushes.size(), size_t{count}, "one push per instance, none swallowed by the reclaim");
  }

  void testABindThatArrivesAfterItsWindowStillClaimsItsRowBack() {
    using namespace std::chrono_literals;
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    constexpr auto kWindow = std::chrono::nanoseconds(NitroUiSizingEngine::kLateFilingGraceNs);
    constexpr auto kWaitAfterWindow = kWindow + std::chrono::milliseconds(300) > std::chrono::seconds(5)
                                          ? std::chrono::seconds(5)
                                          : kWindow + std::chrono::milliseconds(300);

    measure(38000, "slow-mount");
    std::this_thread::sleep_for(kWaitAfterWindow);
    // Something else lays out, which is what runs the walk.
    bind(38001, 38001);
    measure(38001, "neighbour");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "the slow row has left the ledger");
    checkEquals(engine().lateFilingCount(), size_t{1}, "and is held, waiting for the bind it is owed");

    bind(38000, 38000);
    checkEquals(engine().stats().ledgerEntries, int64_t{2}, "and the late bind claims it back");
    checkEquals(engine().lateFilingCount(), size_t{0}, "from the hold");

    engine().report(38000, 61, 28, 0);
    check(engine().flush(), "a control whose mount was a second late is still corrected");
    checkEquals(pushes.size(), size_t{1}, "exactly one push, for the slow instance");
    checkEquals(pushes[0].width, 61.0f, "at the size it reported");
  }

  void testAMountThatFilesBeforeItBindsSurvivesItsOwnWindow() {
    using namespace std::chrono_literals;
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    constexpr auto kWindow = std::chrono::nanoseconds(NitroUiSizingEngine::kLateFilingGraceNs);
    constexpr auto kWaitAfterWindow = kWindow + std::chrono::milliseconds(300) > std::chrono::seconds(5)
                                          ? std::chrono::seconds(5)
                                          : kWindow + std::chrono::milliseconds(300);

    // The ids must stay clear of 5588-6099, which the burst case above leaves marked
    // finished in the 512-slot `forgotten_` ring: a finished id takes the held path
    // and never reaches the unbound row.
    measure(35900, "mounted-in-order");
    checkEquals(engine().unboundFilingCount(), size_t{1},
                "the row was filed on the *unbound* path — if this is 0 the id collided with an earlier forget and this case tests the hold instead");
    bind(35900, 35900);
    checkEquals(engine().unboundFilingCount(), size_t{0}, "binding takes the row out of the waiting set");

    // Other views keep laying out, which drives the walk.
    std::this_thread::sleep_for(kWaitAfterWindow);
    for (int64_t cycle = 0; cycle < 10; cycle++) {
      bind(35910 + cycle, static_cast<int>(35910 + cycle));
      measure(35910 + cycle, "neighbour");
    }
    checkEquals(engine().stats().ledgerEntries, int64_t{11}, "the bound instance kept its row through its own window");

    engine().report(35900, 61, 28, 0);
    check(engine().flush(), "and it is still corrected");
    checkEquals(pushes.size(), size_t{1}, "exactly one push, for the mounted instance");
    checkEquals(pushes[0].width, 61.0f, "at the size it reported");
  }

  void testAPickerShapedChurnOfDroppedAndUnboundMountsLeavesNothingBehind() {
    using namespace std::chrono_literals;
    resetEngine();
    engine().setFallback("NitroUiSwitch", 120, 40, 0);

    constexpr auto kWindow = std::chrono::nanoseconds(NitroUiSizingEngine::kLateFilingGraceNs);
    constexpr auto kWaitAfterWindow = kWindow + std::chrono::milliseconds(300) > std::chrono::seconds(5)
                                          ? std::chrono::seconds(5)
                                          : kWindow + std::chrono::milliseconds(300);

    const int64_t baseline = engine().stats().ledgerEntries;
    // The shape of the keys a Picker's two owners file, differing only in `sel:`.
    const char* const firstOwnersKey = "menu|3|One|Two|Three|sel:One|lbl:";
    const char* const secondOwnersKey = "menu|3|One|Two|Three|sel:Three|lbl:";
    for (int64_t cycle = 0; cycle < 50; cycle++) {
      const int64_t id = 39000 + cycle * 2;
      const std::string key = cycle % 2 == 0 ? firstOwnersKey : secondOwnersKey;
      if (cycle % 2 == 0) {
        // A mount that completes and is dropped, with its layout arriving late.
        bind(id, static_cast<int>(id));
        measure(id, key);
        engine().forget(id);
        kept_.erase(id);
        measure(id, key);
      } else {
        // A mount that never arrives: laid out, and then nothing.
        measure(id, key);
      }
    }
    check(engine().stats().ledgerEntries > baseline,
          "the churn really did leave rows behind to reclaim — otherwise this case proves nothing");

    std::this_thread::sleep_for(kWaitAfterWindow);
    // Other views keep laying out, which drives the reclaim.
    for (int64_t cycle = 0; cycle < 20; cycle++) {
      bind(39200 + cycle, static_cast<int>(39200 + cycle));
      measure(39200 + cycle, "menu|3|One|Two|Three|sel:Two|lbl:");
    }
    const NitroUiSizingCounters after = engine().stats();
    checkEquals(after.ledgerEntries - baseline, int64_t{20},
                "fifty Picker cycles — dropped views with a late layout, and mounts that never arrived — leave nothing but the live instances");
    checkEquals(after.registryEntries, int64_t{20}, "and the registry holds only those");

    // The reclaimed rows moved to the held table, and with nothing laying out only
    // `flush` can empty it.
    std::this_thread::sleep_for(kWaitAfterWindow);
    check(!engine().flush(), "the churn has settled, so there is nothing left to apply");
    checkEquals(engine().lateFilingCount(), size_t{0}, "and a flush with no layouts left clears the holds");
    checkEquals(engine().unboundFilingCount(), size_t{0}, "and everything owed a mount window");
    checkEquals(engine().stats().ledgerEntries - baseline, int64_t{20}, "with only the twenty live instances still on the ledger");
  }

  void testAReshowOfMoreControlsThanTheOldCapacityLosesNoCorrection() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    const int64_t count = 300;
    for (int64_t cycle = 0; cycle < count; cycle++) {
      const int64_t id = 41000 + cycle;
      bind(id, static_cast<int>(id));
      // A cold key per control, and no report: warming the key would make the re-show
      // exact and leave no correction to lose.
      measure(id, "row-" + std::to_string(cycle));
      // Hidden: iOS deletes the native view, which finishes the id.
      engine().forget(id);
      kept_.erase(id);
    }
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "hiding them all leaves the ledger empty");

    for (int64_t cycle = 0; cycle < count; cycle++) {
      measure(41000 + cycle, "row-" + std::to_string(cycle));
    }
    checkEquals(engine().lateFilingCount(), static_cast<size_t>(count),
                "every layout of the re-show is still on hold — one is one lost correction");

    for (int64_t cycle = 0; cycle < count; cycle++) {
      bind(41000 + cycle, static_cast<int>(41000 + cycle));
    }
    checkEquals(engine().stats().ledgerEntries, count, "and each mount claimed its own entry back");

    pushes.clear();
    for (int64_t cycle = 0; cycle < count; cycle++) {
      engine().report(41000 + cycle, 61, 28, 0);
    }
    check(engine().flush(), "the re-shown commit is corrected");
    checkEquals(pushes.size(), static_cast<size_t>(count), "one push per re-shown control, none lost to capacity");
  }

  void testTheHeldTableStillCannotGrowWithoutBound() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    const int64_t capacity = static_cast<int64_t>(NitroUiSizingEngine::kLateFilingCapacity);
    const int64_t count = capacity * 2 + 17;
    int64_t peak = 0;
    for (int64_t cycle = 0; cycle < count; cycle++) {
      const int64_t id = 42000 + cycle;
      bind(id, static_cast<int>(id));
      measure(id, "burst-" + std::to_string(cycle % 7));
      engine().forget(id);
      kept_.erase(id);
      measure(id, "burst-" + std::to_string(cycle % 7));
      const int64_t held = static_cast<int64_t>(engine().lateFilingCount());
      peak = held > peak ? held : peak;
    }
    checkEquals(peak, capacity, "the burst reached the ceiling, and never grew past it");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "and none of it reached the ledger");
    checkEquals(engine().stats().registryEntries, int64_t{0}, "nor the registry");
  }

  void testABindLaterThanBothWindowsIsChargedAFreshMeasure() {
    using namespace std::chrono_literals;
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    constexpr auto kWindow = std::chrono::nanoseconds(NitroUiSizingEngine::kLateFilingGraceNs);
    constexpr auto kWaitAfterWindow = kWindow + std::chrono::milliseconds(300) > std::chrono::seconds(5)
                                          ? std::chrono::seconds(5)
                                          : kWindow + std::chrono::milliseconds(300);

    measure(43000, "very-late-mount");
    checkEquals(engine().unboundFilingCount(), size_t{1}, "filed, and owed a mount window");

    // Window one closes: the row is demoted, not deleted.
    std::this_thread::sleep_for(kWaitAfterWindow);
    bind(43001, 43001);
    measure(43001, "neighbour");
    checkEquals(engine().lateFilingCount(), size_t{1}, "demoted into the held table");

    // Window two closes too: the entry is gone, and nothing else can bring it back.
    std::this_thread::sleep_for(kWaitAfterWindow);
    bind(43002, 43002);
    measure(43002, "neighbour");
    checkEquals(engine().lateFilingCount(), size_t{0}, "the hold is released");

    bind(43000, 43000);
    checkEquals(engine().stats().ledgerEntries, int64_t{2}, "it binds with no row of its own");
    check(engine().requiresFreshMeasure(43000),
          "and is told it owes itself a measure — the entry it was owed is gone");

    // The re-measure the shadow node asks for, which files the row `report` needs.
    measure(43000, "very-late-mount");
    checkEquals(engine().stats().ledgerEntries, int64_t{3}, "the debt is paid by the layout it asked for");
    check(!engine().requiresFreshMeasure(43000), "and it is not asked for twice");

    pushes.clear();
    engine().report(43000, 61, 28, 0);
    check(engine().flush(), "so the control is corrected after all");
    checkEquals(pushes.size(), size_t{1}, "exactly one push, for the very late instance");
    checkEquals(pushes[0].width, 61.0f, "at the size it reported");
  }

  void testTheFreshMeasureDebtIsNotChargedToAnInnocentMount() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    bind(44000, 44000);
    check(!engine().requiresFreshMeasure(44000), "an instance that was never measured asks for nothing");

    // Enough late layouts to overrun the ceiling, which marks the evicted ids as
    // abandoned. The first one is the evictee.
    const int64_t capacity = static_cast<int64_t>(NitroUiSizingEngine::kLateFilingCapacity);
    for (int64_t cycle = 0; cycle < capacity + 4; cycle++) {
      const int64_t id = 45000 + cycle;
      bind(id, static_cast<int>(id));
      measure(id, "debt");
      engine().forget(id);
      kept_.erase(id);
      measure(id, "debt");
    }
    check(!engine().requiresFreshMeasure(44000), "an unrelated live instance is untouched by another id's abandonment");

    // The aliased id: same ring slot as the evicted one, never itself abandoned. It is
    // five capacities newer so it sits outside the burst's own id range.
    const int64_t aliased = 45000 + 5 * static_cast<int64_t>(NitroUiSizingEngine::kForgottenCapacity);
    checkEquals(aliased & (static_cast<int64_t>(NitroUiSizingEngine::kForgottenCapacity) - 1),
                45000 & (static_cast<int64_t>(NitroUiSizingEngine::kForgottenCapacity) - 1),
                "the fixture really does land in the marked slot");
    bind(aliased, static_cast<int>(aliased));
    check(!engine().requiresFreshMeasure(aliased), "and a slot collision charges nobody");

    // The first id of the burst is the one the ceiling evicted, so it does owe a
    // fresh measure.
    bind(45000, 45000);
    check(engine().requiresFreshMeasure(45000),
          "the control the ceiling evicted is charged the second look it is owed");
    engine().forget(45000);

    // Bound but never measured, so not in `usedIds`: `resetEngine` would not forget them.
    engine().forget(44000);
    engine().forget(aliased);
    kept_.erase(44000);
    kept_.erase(aliased);
  }

  void testAFirstCommitWhoseOverflowExceedsTheOldHeldCapKeepsEveryCorrection() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    const int64_t count = static_cast<int64_t>(NitroUiSizingEngine::kUnboundFilingCapacity) + 300;
    for (int64_t cycle = 0; cycle < count; cycle++) {
      measure(47000 + cycle, "");
    }
    checkEquals(engine().unboundFilingCount(), NitroUiSizingEngine::kUnboundFilingCapacity,
                "the valve opened, as it must — this is about where the overflow went, not whether");

    for (int64_t cycle = 0; cycle < count; cycle++) {
      bind(47000 + cycle, static_cast<int>(47000 + cycle));
    }
    checkEquals(engine().stats().ledgerEntries, count,
                "every row of the commit is still there — a demoted one was claimed back by its bind");
    checkEquals(engine().lateFilingCount(), size_t{0}, "and the held table gave them all back");

    pushes.clear();
    for (int64_t cycle = 0; cycle < count; cycle++) {
      engine().report(47000 + cycle, 61, 28, 0);
    }
    check(engine().flush(), "the whole commit is corrected");
    checkEquals(pushes.size(), static_cast<size_t>(count),
                "one push per instance — none of them lost to a table that ran out of room");
  }

  void testAConfirmationCountsReportsAndNeverCostsACommit() {
    resetEngine();
    // Seeded with the size the control will report, so each report is a confirmation.
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    engine().seedSize("NitroUiSwitch", "", 61, 28, 0);
    bind(46000, 46000);
    measure(46000, "");

    const NitroUiSizingCounters before = engine().stats();
    for (int round = 0; round < 3; round++) {
      measure(46000, "");
      engine().report(46000, 61, 28, 0);
      engine().flush();
    }
    const NitroUiSizingCounters after = engine().stats();
    checkEquals(after.reportsConfirmed - before.reportsConfirmed, int64_t{3},
                "one instance confirming three times is three confirmations — reports, not instances");
    checkEquals(after.correctionsImmediate + after.correctionsBatched -
                    (before.correctionsImmediate + before.correctionsBatched),
                int64_t{0},
                "and not one of them cost a state update, which is the promise");
    checkEquals(pushes.size(), size_t{0}, "literally nothing was pushed to the control");

    // Its own key: the instance above made its configuration authoritative, and only
    // a provisional entry reaches the batch walk in `applyReports`.
    engine().seedSize("NitroUiSwitch", "batch", 61, 28, 0);
    for (int64_t cycle = 0; cycle < 5; cycle++) {
      bind(46010 + cycle, static_cast<int>(46010 + cycle));
      measure(46010 + cycle, "batch");
    }
    const NitroUiSizingCounters batchBefore = engine().stats();
    for (int64_t cycle = 0; cycle < 5; cycle++) {
      engine().report(46010 + cycle, 61, 28, 0);
    }
    engine().flush();
    const NitroUiSizingCounters batchAfter = engine().stats();
    checkEquals(batchAfter.correctionsImmediate + batchAfter.correctionsBatched -
                    (batchBefore.correctionsImmediate + batchBefore.correctionsBatched),
                int64_t{0},
                "a batch whose configuration is already right costs no state update");
    checkEquals(pushes.size(), size_t{0}, "and no commit at all, which is what the device rule's budget counts");
    check(batchAfter.reportsConfirmed - batchBefore.reportsConfirmed >= 5,
          "every instance of the configuration was confirmed by the batch's reports");
  }

  void testColdMountFallsBackAndCorrects() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(1, 1);

    auto first = measure(1, "Switch|");
    checkSize(first, 52, 48, "cold mount uses the component fallback");
    check(!first.valid(), "the fallback is a guess, not an answer for this key");

    engine().report(1, 61, 28, 0);
    check(engine().flush(), "flush reports a change");
    checkEquals(pushes.size(), size_t{1}, "a cold mount costs exactly one push");
    check(pushes[0].immediate, "the first correction goes out immediately");

    pushes.clear();
    auto second = measure(1, "Switch|");
    checkSize(second, 61, 28, "the measured size is cached");
    check(second.valid(), "and a measured size is an answer, not a guess");
    engine().report(1, 61, 28, 0);
    check(!engine().flush(), "a report that agrees with the cache commits nothing");
    checkEquals(pushes.size(), size_t{0}, "an exact instance is never pushed");
  }

  void testPrewarmedMountCostsNothing() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(7, 7);

    auto size = measure(7, "Switch|");
    checkSize(size, 61, 28, "a pre-warmed configuration lays out at the seeded size");
    engine().report(7, 61, 28, 0);
    check(!engine().flush(), "a pre-warmed instance never pushes");
    checkEquals(pushes.size(), size_t{0}, "pre-warmed means zero extra commits");

    pushes.clear();
    bind(8, 8);
    auto next = measure(8, "Switch|");
    check(next.valid(), "the confirmed entry is authoritative for the next mount");
    engine().report(8, 61, 28, 0);
    check(!engine().flush(), "which costs nothing either");
    checkEquals(pushes.size(), size_t{0}, "no commits for the second instance");
  }

  void testPrewarmCannotPoisonTheCache() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 61, 28, 0);
    check(engine().prewarm("NitroUiSwitch"), "the declared size is pre-warmable");

    bind(91, 91);
    auto laid = measure(91, "");
    checkSize(laid, 61, 28, "the first layout uses the pre-warmed guess");
    check(laid.valid(), "it is laid out from the cache entry");

    engine().report(91, 51, 31, 0);
    check(engine().flush(), "the real size corrects the guess");
    checkEquals(pushes.size(), size_t{1}, "one correction, like any cold mount");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 51, 31, "corrected to the real size");

    pushes.clear();
    bind(92, 92);
    auto second = measure(92, "");
    checkSize(second, 51, 31, "the next mount is laid out at the real size");
    engine().report(92, 51, 31, 0);
    check(!engine().flush(), "and needs no correction");
    checkEquals(pushes.size(), size_t{0}, "zero commits for the second mount");
  }

  void testAPrewarmLeavesEveryInstanceInexact() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 61, 28, 0);
    check(engine().prewarm("NitroUiSwitch"), "the declared size is pre-warmable");
    bind(93, 93);
    bind(94, 94);
    measure(93, "");
    measure(94, "");
    checkEquals(pushes.size(), size_t{0}, "two pre-warmed mounts cost nothing");

    engine().report(93, 51, 31, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{2}, "both instances are corrected, not just the reporter");
  }

  void testOneReportCorrectsEveryInstance() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    for (int64_t id = 10; id < 20; id++) {
      bind(id, static_cast<int>(id));
      measure(id, "Switch|");
    }
    engine().report(13, 61, 28, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{10}, "one report corrects all ten instances of that key");
    checkEquals(pushes[0].immediate, true, "the first correction is immediate");
    checkEquals(pushes[2].immediate, false, "past the budget, corrections are asynchronous");
    checkEquals(pushes[9].immediate, false, "and the rest stay asynchronous");

    pushes.clear();
    for (int64_t id = 10; id < 20; id++) {
      engine().report(id, 61, 28, 0);
    }
    check(!engine().flush(), "the corrected batch commits nothing a second time");
    checkEquals(pushes.size(), size_t{0}, "no duplicate commits");
  }

  void testKeysAreIndependent() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(21, 21);
    bind(22, 22);

    checkSize(measure(21, "Switch|"), 61, 28, "the warm key is warm");
    auto other = measure(22, "Switch|disabled");
    checkSize(other, 61, 28, "an unknown key still gets the component's last size");
    check(!other.valid(), "but it is not an answer for that key, so it will be corrected");

    engine().report(22, 60, 27, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "only the instance with that key is corrected");
    checkEquals(pushes[0].tag, 22, "and it is the right instance");

    check(engine().cachedSizeCount() == 2, "both configurations are cached");
    check(!(NitroUiSizingEngine::keyFor("NitroUiSwitch", "a", 1) == NitroUiSizingEngine::keyFor("NitroUiSwitch", "", 1)),
          "different keys hash differently");
    check(!(NitroUiSizingEngine::keyFor("NitroUiSwitch", "x", 1) == NitroUiSizingEngine::keyFor("NitroUiSwitchx", "", 1)),
          "the separator keeps component and key from running together");
    check(!(NitroUiSizingEngine::keyFor("NitroUiSwitch", "Switch|", 1) == NitroUiSizingEngine::keyFor("NitroUiSwitch", "Switch|", 2)),
          "the environment epoch changes the key");
  }

  void testEnvironmentChangeDropsAnswersAndKeepsTheGuess() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(31, 31);
    measure(31, "Switch|");
    engine().report(31, 61, 28, 0);
    check(!engine().flush(), "the seeded size was right, so nothing was pushed");

    engine().invalidateEnvironment();
    pushes.clear();
    auto after = measure(31, "Switch|");
    check(!after.valid(), "a new epoch has no cached size");
    checkSize(after, 61, 28, "but the last known size is still the guess");
    engine().report(31, 61, 40, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "and the control corrects it in the new epoch");
  }

  void testEnvironmentChangeCorrectsAMountedInstance() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(35, 35);
    measure(35, "");
    engine().report(35, 60, 40, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "mounted and exact at 60x40");

    pushes.clear();
    engine().invalidateEnvironment();
    checkEquals(pushes.size(), size_t{0}, "the bump itself commits nothing");

    measure(35, "");
    engine().report(35, 60, 40, 0);
    check(!engine().flush(), "an environment change that does not move the control costs nothing");
    checkEquals(pushes.size(), size_t{0}, "no commit for a size it already had");

    engine().invalidateEnvironment();
    measure(35, "");
    engine().report(35, 66, 44, 0);
    check(engine().flush(), "a real size change after the bump is corrected");
    checkEquals(pushes.size(), size_t{1}, "one commit, for the size that moved");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 66, 44, "to the new size");
  }

  void testEnvironmentChangeCorrectsAReportWithNoMeasure() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(36, 36);
    measure(36, "");
    engine().report(36, 60, 40, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "mounted, corrected, and exact at 60x40");

    pushes.clear();
    engine().invalidateEnvironment();
    checkEquals(pushes.size(), size_t{0}, "the bump itself commits nothing");
    engine().report(36, 72, 48, 0);
    check(engine().flush(), "the report is still believed without a re-measure");
    checkEquals(pushes.size(), size_t{1}, "one commit, for the control whose size moved");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 72, 48, "to the size it measured");

    pushes.clear();
    engine().invalidateEnvironment();
    engine().report(36, 72, 48, 0);
    check(!engine().flush(), "a bump that did not move the control leaves nothing to flush");
    checkEquals(pushes.size(), size_t{0}, "and costs no commit");
  }

  void testEnvironmentSignatureCoalescesCallbacks() {
    resetEngine();
    engine().invalidateEnvironmentIfChanged("fontScale=1.0");
    const uint64_t epoch = engine().environmentEpoch();
    engine().invalidateEnvironmentIfChanged("fontScale=1.0");
    engine().invalidateEnvironmentIfChanged("fontScale=1.0");
    checkEquals(engine().environmentEpoch(), epoch, "the same signature seen twice bumps once");
    engine().invalidateEnvironmentIfChanged("fontScale=1.3");
    checkEquals(engine().environmentEpoch(), epoch + 1, "a new signature bumps");
    engine().invalidateEnvironmentIfChanged("");
    check(engine().environmentEpoch() > epoch + 1, "an unknown signature always bumps");
  }

  void testPrewarmMakesTheFirstMountExact() {
    resetEngine();
    check(engine().cachedSizeCount() == 0, "a new epoch starts with no answers");
    check(!engine().prewarm("NitroUiNotLoaded"), "a component that declared nothing is not pre-warmable");

    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    check(engine().prewarm("NitroUiSwitch"), "a declared component is");
    checkEquals(engine().cachedSizeCount(), size_t{1}, "pre-warm puts one entry in the cache");

    bind(71, 71);
    auto laid = measure(71, "");
    checkSize(laid, 52, 48, "the first instance is laid out with the declared size");
    engine().report(71, 52, 48, 0);
    check(!engine().flush(), "the control agreeing with it needs no correction");
    checkEquals(pushes.size(), size_t{0}, "so the mount costs zero state updates");

    const NitroUiSizingCounters confirmed = engine().stats();
    check(confirmed.reportsConfirmed > 0, "and it is counted as a confirmation, not a correction");
  }

  void testStatsCountCorrectionsAndDroppedReports() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    const NitroUiSizingCounters before = engine().stats();

    bind(81, 81);
    measure(81, "");
    engine().report(81, 61, 28, 0);
    check(engine().flush(), "a change is reported to the caller");
    const NitroUiSizingCounters cold = engine().stats();
    checkEquals(cold.correctionsImmediate - before.correctionsImmediate, int64_t{1}, "one correction for a cold instance");
    checkEquals(cold.correctionsBatched - before.correctionsBatched, int64_t{0}, "inside the budget, so it is immediate");
    checkEquals(cold.changedFlushes - before.changedFlushes, int64_t{1}, "one flush changed a size");
    check(cold.measurements > before.measurements, "measurements are counted");
    check(cold.lastFlushNs >= 0, "flush time is recorded");

    const NitroUiSizingCounters warmBefore = cold;
    bind(82, 82);
    auto second = measure(82, "");
    check(second.valid(), "the next instance is warm");
    engine().report(82, 61, 28, 0);
    check(!engine().flush(), "and agreeing with the cache needs nothing");
    const NitroUiSizingCounters warm = engine().stats();
    checkEquals(warm.correctionsImmediate - warmBefore.correctionsImmediate, int64_t{0}, "a warm mount costs zero corrections");
    check(warm.reportsDropped > warmBefore.reportsDropped, "the report is counted as dropped, not queued");
    check(warm.reportsConfirmed > warmBefore.reportsConfirmed, "and as the confirmation it is");
  }

  void testMountUnmountCyclesKeepTheEngineFlat() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    auto cycle = [](int64_t id) {
      bind(id, static_cast<int>(id));
      measure(id, "");
      engine().report(id, 61, 28, 0);
      engine().flush();
      // What a host does in `onDropView` / `prepareForRecycle`.
      engine().forget(id);
      kept_.erase(id);
    };

    for (int64_t id = 300; id < 310; id++) {
      cycle(id);
    }
    const NitroUiSizingCounters warm = engine().stats();
    checkEquals(warm.ledgerEntries, int64_t{0}, "ten mount/unmount cycles leave no ledger entries");
    checkEquals(warm.registryEntries, int64_t{0}, "and no registry entries");

    for (int64_t id = 400; id < 400 + 2000; id++) {
      cycle(id);
    }
    const NitroUiSizingCounters after = engine().stats();
    checkEquals(after.ledgerEntries - warm.ledgerEntries, int64_t{0}, "2000 more cycles still leave the ledger flat");
    checkEquals(after.registryEntries - warm.registryEntries, int64_t{0}, "and the registry flat");
    checkEquals(engine().cachedSizeCount(), size_t{1}, "one configuration is still one cache entry");
  }

  void testTheSweepStillRunsAfterTheRegistryHasShrunk() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    // A screen of views mounted and dropped. The sweep walks only once the registry
    // has grown by a stride since its last walk.
    for (int64_t id = 8000; id < 8000 + 1200; id++) {
      bind(id, static_cast<int>(id));
      measure(id, "screen");
    }
    for (int64_t id = 8000; id < 8000 + 1200; id++) {
      engine().forget(id);
      kept_.erase(id);
    }

    // Instances whose `State` dies with no `forget`, under a key nobody reports, so
    // only the sweep can reclaim them.
    for (int64_t id = 9000; id < 9000 + 600; id++) {
      auto scoped = std::make_shared<FakeState>(FakeState{static_cast<int>(id)});
      engine().registerInstance(id, NitroUiSizingEngine::componentHash("NitroUiSwitch"), &fakePush, NitroUiStateRef(scoped));
      measure(id, "died-unpaired");
    }
    checkEquals(engine().stats().registryEntries, int64_t{600}, "600 instances are registered and already dead");
    bind(9900, 9900);
    measure(9900, "");
    engine().report(9900, 70, 30, 0);
    engine().flush();
    checkEquals(engine().stats().registryEntries, int64_t{1},
                "the sweep still ran after the registry had been emptied — the gate followed the registry down");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "and their ledger entries went with them");
  }

  void testExpiredStatesAreSweptWithoutForget() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    for (int64_t id = 500; id < 500 + 600; id++) {
      // Deliberately no `kept_`: the last strong reference dies on scope exit.
      auto scoped = std::make_shared<FakeState>(FakeState{1});
      engine().registerInstance(id, NitroUiSizingEngine::componentHash("NitroUiSwitch"), &fakePush, NitroUiStateRef(scoped));
      // A configuration the reporter below never reports, so only the sweep sees them.
      measure(id, "expired");
    }
    checkEquals(engine().stats().registryEntries, int64_t{600}, "600 instances are registered");
    bind(1200, 1200);
    measure(1200, "");
    engine().report(1200, 70, 30, 0);
    engine().flush();
    checkEquals(engine().stats().registryEntries, int64_t{1}, "the sweep dropped the states that died without a forget");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "and their ledger entries with them");
  }

  void testInstanceIdsAreMonotonic() {
    const int64_t first = NitroUiSizingEngine::nextInstanceId();
    const int64_t second = NitroUiSizingEngine::nextInstanceId();
    check(second > first, "ids increase");
    check(first > 0, "and 0 stays reserved for NO_INSTANCE");
    bool unique = true;
    int64_t previous = NitroUiSizingEngine::nextInstanceId();
    for (int i = 0; i < 1000; i++) {
      const int64_t next = NitroUiSizingEngine::nextInstanceId();
      unique = unique && next > previous;
      previous = next;
    }
    check(unique, "1000 ids in a row are all different");
  }

  void testImmediateBudgetCapsOneFlush() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    const NitroUiSizingCounters before = engine().stats();

    for (int64_t id = 91; id < 91 + 6; id++) {
      bind(id, static_cast<int>(id));
      measure(id, "");
      engine().report(id, 70, 30, 0);
    }
    check(engine().flush(), "one flush corrects the batch");
    const NitroUiSizingCounters after = engine().stats();
    const int64_t immediate = after.correctionsImmediate - before.correctionsImmediate;
    const int64_t batched = after.correctionsBatched - before.correctionsBatched;
    checkEquals(immediate + batched, int64_t{6}, "every instance got a correction");
    checkEquals(immediate, int64_t{NitroUiSizingEngine::kImmediateBudgetPerTurn}, "at most the budget is immediate");
    checkEquals(pushes.size(), size_t{6}, "one state update per instance");
    checkEquals(countPushes(true), size_t{NitroUiSizingEngine::kImmediateBudgetPerTurn}, "and the flags on the pushes agree");

    pushes.clear();
    for (int64_t id = 191; id < 191 + 6; id++) {
      bind(id, static_cast<int>(id));
      measure(id, "one-at-a-time|");
      engine().report(id, 70, 30, 0);
    }
    check(engine().flush(1), "a flush given one synchronous slot still corrects the batch");
    const NitroUiSizingCounters spentOne = engine().stats();
    checkEquals(spentOne.correctionsImmediate - after.correctionsImmediate, int64_t{1}, "one correction was synchronous");
    checkEquals(spentOne.correctionsBatched - after.correctionsBatched, int64_t{5}, "the other five are batched");
    checkEquals(countPushes(true), size_t{1}, "and the push flags agree with the budget it was given");

    pushes.clear();
    for (int64_t id = 291; id < 291 + 3; id++) {
      bind(id, static_cast<int>(id));
      measure(id, "nothing-synchronous|");
      engine().report(id, 70, 30, 0);
    }
    check(engine().flush(0), "a flush with no synchronous slot still corrects the batch");
    checkEquals(countPushes(true), size_t{0}, "and none of its pushes claims a synchronous commit");
    checkEquals(pushes.size(), size_t{3}, "all three went out asynchronously");
    // A negative budget is a caller bug, and it must still not skip corrections.
    pushes.clear();
    for (int64_t id = 391; id < 391 + 2; id++) {
      bind(id, static_cast<int>(id));
      measure(id, "clamped|");
      engine().report(id, 70, 30, 0);
    }
    check(engine().flush(-4), "a negative budget is clamped, not honoured");
    checkEquals(countPushes(true), size_t{0}, "which means none synchronous");
    checkEquals(pushes.size(), size_t{2}, "and the corrections still go out");
  }

  void testDeferredPushesReadSizesAfterFlush() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    for (int64_t id = 200; id < 200 + 5; id++) {
      bind(id, static_cast<int>(id));
      measure(id, "");
      engine().report(id, 61, 28, 0);
    }

    deferPushes = true;
    check(engine().flush(), "the batch is applied");
    checkEquals(pushes.size(), size_t{0}, "nothing has been committed yet - RN queued it");

    // The flush has freed its vector of sizes: reuse that memory, then run the pushes.
    runDeferred();
    checkEquals(pushes.size(), size_t{5}, "all five corrections arrive");
    bool allRight = true;
    for (const Push& push: pushes) {
      allRight = allRight && std::fabs(push.width - 61) < 0.001f && std::fabs(push.height - 28) < 0.001f;
    }
    check(allRight, "each one carries the size it was queued with");
    checkEquals(countPushes(true), size_t{NitroUiSizingEngine::kImmediateBudgetPerTurn}, "the budget still applies");
    deferPushes = false;
  }

  void testPushMayReEnterMeasureAndBind() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(220, 220);
    measure(220, "");

    reentrantMeasure = true;
    engine().report(220, 61, 28, 0);
    check(engine().flush(), "the correction still happens");
    checkEquals(pushes.size(), size_t{1}, "pushed once");
    check(reentrantSawSize, "and the re-entrant `measure` saw the corrected size in the cache");
    reentrantMeasure = false;
  }

  void testTraceRecordsSizeChangesOnce() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    engine().setTraceEnabled(true);
    bind(101, 101);

    measure(101, "");
    measure(101, "");
    measure(101, "");
    engine().report(101, 61, 28, 0);
    engine().flush();
    engine().recordDrawnSize(101, 61, 28);
    measure(101, "");

    auto events = engine().drainTrace();
    // The re-layout a correction causes is not a fourth event: the push already
    // recorded that size.
    checkEquals(events.size(), size_t{3}, "one event per size change, not per layout pass");
    if (events.size() == 3) {
      checkEquals(events[0].stage, NitroUiSizingEngine::kStageLaidOut, "first: laid out with the guess");
      checkSize(NitroUiMeasuredSize{events[0].width, events[0].height, {}, 0}, 52, 48, "which was the fallback");
      checkEquals(events[1].stage, NitroUiSizingEngine::kStageCorrected, "then the correction");
      checkEquals(events[2].stage, NitroUiSizingEngine::kStageDrew, "then what was drawn");
      checkSize(NitroUiMeasuredSize{events[2].width, events[2].height, {}, 0}, 61, 28, "drawn at the real size");
    }

    engine().setTraceEnabled(false);
    bind(102, 102);
    measure(102, "");
    checkEquals(engine().drainTrace().size(), size_t{0}, "disarmed, nothing is recorded");
  }

  void testStateSizeIsUsedWhenItMatchesTheKey() {
    resetEngine();
    const NitroUiSizeKey key = NitroUiSizingEngine::keyFor("NitroUiSwitch", "Switch|", engine().environmentEpoch());
    bind(41, 41);
    auto size = measure(41, "Switch|", NitroUiMeasuredSize{50, 30, key, 0});
    checkSize(size, 50, 30, "a size native pushed for this key is trusted");
    engine().report(41, 50, 30, 0);
    check(!engine().flush(), "and it needs no correction");

    auto other = measure(41, "Switch|disabled", NitroUiMeasuredSize{50, 30, key, 0});
    check(!other.valid(), "another key does not inherit it");
  }

  void testALearnedSizeBelongsToItsOwnConfiguration() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(51, 51);
    bind(52, 52);

    measure(51, "");
    engine().report(51, 61, 28, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "the default variant measured 61x28");

    pushes.clear();
    auto other = measure(52, "|wide");
    checkSize(other, 52, 48, "a never-measured variant guesses the declared size");
    check(!other.valid(), "and it is a guess, not an answer");

    engine().invalidateEnvironment();
    pushes.clear();
    auto again = measure(51, "");
    checkSize(again, 61, 28, "its own last size is the guess in the new environment");
    engine().report(51, 61, 28, 0);
    check(!engine().flush(), "so confirming it costs no commit");
  }

  void testKeyChangeReMeasuresAndCorrects() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(45, 45);

    measure(45, "");
    engine().report(45, 61, 28, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "mounted at 61x28 for the default variant");

    pushes.clear();
    auto wider = measure(45, "|w20");
    check(!wider.valid(), "the new configuration has no answer of its own");
    checkSize(wider, 52, 48, "guessed from the declared fallback, not the other variant's size");
    engine().report(45, 81, 28, 0);
    check(engine().flush(), "the real size for the new variant is corrected");
    checkEquals(pushes.size(), size_t{1}, "one commit for the new size");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 81, 28, "the wider size");

    pushes.clear();
    auto narrow = measure(45, "");
    checkSize(narrow, 61, 28, "the original variant still has its own answer");
    engine().report(45, 61, 28, 0);
    check(!engine().flush(), "which needs no correction");
    checkEquals(pushes.size(), size_t{0}, "no commits going back");
  }

  void testFillWidthKeepsTheFlag() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Slider|", 200, 20, NitroUiSizingEngine::kFlagFillWidth);
    bind(51, 51);
    auto size = measure(51, "Slider|");
    check((size.flags & NitroUiSizingEngine::kFlagFillWidth) != 0, "the fill-width policy survives the cache");
  }

  /// The box a `fillWidth` node is laid out with: the engine's height and Yoga's
  /// width. The shadow node applies this after `measure` returns; an infinite
  /// constraint width means there is no box width.
  NitroUiMeasuredSize layoutAt(const NitroUiMeasuredSize& measured, float boxWidth) {
    NitroUiMeasuredSize laidOut = measured;
    if ((measured.flags & NitroUiSizingEngine::kFlagFillWidth) != 0 &&
        std::isfinite(boxWidth)) {
      laidOut.width = boxWidth;
    }
    return laidOut;
  }

  void testFillWidthInstancesOfDifferentWidthsCostNothing() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 328, 40, NitroUiSizingEngine::kFlagFillWidth);
    bind(71, 71);

    auto first = measure(71, "");
    checkSize(layoutAt(first, 300), 300, 40, "the first Slider is laid out at its box width");
    engine().report(71, 300, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "a 300-wide report for a 300-wide layout is not a change");
    checkEquals(pushes.size(), size_t{0}, "which costs no commit");

    bind(72, 72);
    auto second = measure(72, "");
    checkSize(second, 328, 40, "the cached answer is the height the control measured, at the declared width");
    checkSize(layoutAt(second, 200), 200, 40, "and the box still owns the width");
    engine().report(72, 200, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "the 200-wide Slider's report is not a change either");
    checkEquals(pushes.size(), size_t{0}, "so the second instance costs nothing");

    bind(73, 73);
    auto third = measure(73, "");
    checkSize(third, 328, 40, "a third Slider reads the control's answer, not the last box");
  }

  void testFillWidthUnderAnInfiniteParentUsesTheDeclaredWidth() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 328, 40, NitroUiSizingEngine::kFlagFillWidth);

    bind(76, 76);
    measure(76, "");
    engine().report(76, 200, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "the bounded instance's report is not a correction");
    checkEquals(pushes.size(), size_t{0}, "which costs nothing");

    // Same configuration, so the engine is warm, and Yoga has no width to give it.
    bind(77, 77);
    auto underInfinity = measure(77, "");
    checkSize(layoutAt(underInfinity, INFINITY), 328, 40,
              "an unbounded parent draws the declared width, not the 200 dp of someone else's box");

    engine().report(77, 328, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "which the unbounded instance confirms rather than corrects");
    checkEquals(pushes.size(), size_t{0}, "and that costs no commit");

    // A configuration's history outlives an environment change, and a cold mount
    // guesses from it.
    engine().invalidateEnvironment();
    bind(78, 78);
    checkSize(measure(78, ""), 328, 40,
              "the configuration's history carries the declared width too");
  }

  void testFillWidthStillCorrectsAWrongHeight() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 328, 33, NitroUiSizingEngine::kFlagFillWidth);
    bind(74, 74);

    auto first = measure(74, "");
    checkSize(layoutAt(first, 300), 300, 33, "the first frame is the guess, at the box width");
    engine().report(74, 300, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(engine().flush(), "a 7 pt wrong height is a change");
    checkEquals(pushes.size(), size_t{1}, "and it is corrected");
    check(std::fabs(pushes[0].height - 40) < 0.001f, "with the measured height");

    pushes.clear();
    bind(75, 75);
    auto second = measure(75, "");
    checkSize(layoutAt(second, 250), 250, 40, "the next Slider is exact on its first frame");
    engine().report(75, 250, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "and its report costs nothing");
    checkEquals(pushes.size(), size_t{0}, "no commit for a warm instance");
  }

  void testUnboundReporterKeepsItsCorrection() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    // Measured, reported, but its state has not arrived yet.
    measure(99, "Switch|");
    engine().report(99, 40, 40, 0);
    check(!engine().flush(), "an unbound instance commits nothing");
    checkEquals(pushes.size(), size_t{0}, "...and pushes nothing");
    check(engine().hasPendingReports(), "but the correction is kept for the next flush");
    bind(99, 99);
    check(engine().flush(), "once bound, the queued report corrects it");
    checkEquals(pushes.size(), size_t{1}, "exactly one commit, late rather than never");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 40, 40, "at the reported size");
  }

  void testUnboundTargetKeepsTheCorrection() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(110, 110);
    measure(110, "Switch|");
    measure(111, "Switch|"); // never bound: its state has not arrived yet
    engine().report(110, 61, 28, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "the bound instance is corrected");

    bind(111, 111);
    auto late = measure(111, "Switch|");
    checkSize(late, 61, 28, "its first layout after binding is already the right size");
    check(late.valid(), "answered from the cache, not from a guess");
    engine().report(111, 61, 28, 0);
    check(!engine().flush(), "and once it measures, the cache is already right");
    checkEquals(pushes.size(), size_t{1}, "so it costs nothing");
  }

  void testAnUnboundTargetIsCorrectedByALaterReport() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(115, 115);
    measure(115, "Switch|");
    measure(116, "Switch|"); // never bound: its state has not arrived yet
    engine().report(115, 61, 28, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "the reachable one is corrected");

    bind(116, 116);
    engine().report(115, 61, 28, 0);
    check(engine().flush(), "a later report of the same configuration still has a target to reach");
    checkEquals(pushes.size(), size_t{2}, "the instance that had been unreachable is corrected");
    checkSize(NitroUiMeasuredSize{pushes[1].width, pushes[1].height, {}, 0}, 61, 28, "at the size it was owed");
  }

  void testReportsWithoutAnInstanceAreDropped() {
    resetEngine();
    engine().report(99, 40, 40, 0);
    check(!engine().flush(), "a report with no ledger entry is dropped");
    check(!engine().hasPendingReports(), "and nothing is queued");
  }

  void testDeadStateIsPruned() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    {
      auto scoped = std::make_shared<FakeState>(FakeState{61});
      // The engine keeps only a weak reference; this scope owns the last strong one.
      engine().registerInstance(61, NitroUiSizingEngine::componentHash("NitroUiSwitch"), &fakePush, NitroUiStateRef(scoped));
      measure(61, "Switch|");
    }
    engine().report(61, 61, 28, 0);
    check(!engine().flush(), "a push to a dead state changes nothing");
    checkEquals(pushes.size(), size_t{0}, "and pushes nothing");
    engine().report(61, 61, 28, 0);
    check(!engine().hasPendingReports(), "the pruned instance reports nothing afterwards");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "and its ledger entry went with it");
  }

  void testForgetDuringPendingCorrection() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(120, 120);
    measure(120, "");
    engine().report(120, 61, 28, 0);
    check(engine().hasPendingReports(), "a correction is queued");

    engine().forget(120);
    kept_.erase(120);
    check(!engine().hasPendingReports(), "forgetting drops what was on its way");
    check(!engine().flush(), "and the flush finds nothing");
    checkEquals(pushes.size(), size_t{0}, "so nothing is pushed");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "with no ledger entry left behind");
  }

  void testRepeatedReportsKeepTheLastOne() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(71, 71);
    measure(71, "Switch|");
    engine().report(71, 10, 10, 0);
    engine().report(71, 20, 20, 0);
    engine().report(71, 61, 28, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "three reports in one turn commit once");
    check(std::fabs(pushes[0].width - 61) < 0.001f, "and it is the last size");
  }

  void testACorrectedInstanceAsksForAFreshMeasure() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 40, 20, 0);
    bind(91, 91);
    bind(93, 93);

    check(!engine().requiresFreshMeasure(91), "an instance that was never measured asks for nothing");
    check(!engine().requiresFreshMeasure(NitroUiSizing::NO_INSTANCE), "and neither does a view sizing ignores");

    measure(91, "Switch|");
    check(!engine().requiresFreshMeasure(91), "a first answer is not a change, even a wrong one");

    engine().report(91, 61, 28, 0);
    check(engine().flush(), "the correction commits");
    check(engine().requiresFreshMeasure(91), "an instance whose answer moved must re-ask on a props turn");
    check(!engine().requiresFreshMeasure(93), "and only that instance - another mount keeps the fast path");

    measure(91, "Switch|");
    check(engine().requiresFreshMeasure(91), "the flag is sticky: Yoga is still holding the old answer");

    engine().forget(91);
    check(!engine().requiresFreshMeasure(91), "a dropped instance carries nothing with it");
  }

  void testAnUncorrectedInstanceKeepsTheMeasurementCache() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(92, 92);
    const NitroUiSizingCounters before = engine().stats();

    for (int turn = 0; turn < 30; turn++) {
      const NitroUiMeasuredSize size = measure(92, "Switch|");
      checkSize(size, 61, 28, "a prop turn is laid out from what the engine believes");
      check(!engine().requiresFreshMeasure(92), "and never has to re-ask");
    }

    const NitroUiSizingCounters after = engine().stats();
    checkEquals(after.correctionsImmediate + after.correctionsBatched - (before.correctionsImmediate + before.correctionsBatched), int64_t{0},
                "a control that agreed with the engine was never corrected");
  }

  void testARekeyIsNotACorrectionButAMovedAnswerIs() {
    // Two configurations of the same size, both warm: a Button going from "Save" to "Edit".
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|Save", 80, 35, 0);
    engine().seedSize("NitroUiSwitch", "Switch|Edit", 80, 35, 0);
    bind(94, 94);
    const NitroUiSizingCounters beforeRekey = engine().stats();

    measure(94, "Switch|Save");
    check(!engine().requiresFreshMeasure(94), "the first answer flags nothing");
    measure(94, "Switch|Edit");
    check(!engine().requiresFreshMeasure(94), "moving to another configuration of the same size is not a correction");

    const NitroUiSizingCounters afterRekey = engine().stats();
    checkEquals(afterRekey.correctionsImmediate + afterRekey.correctionsBatched -
                    (beforeRekey.correctionsImmediate + beforeRekey.correctionsBatched),
                int64_t{0}, "and it corrected nothing");
    checkEquals(pushes.size(), size_t{0}, "and it committed nothing");

    // The same key is answered a different size with no report in between, which
    // only `measure` can see.
    resetEngine();
    engine().setFallback("NitroUiSwitch", 40, 20, 0);
    bind(95, 95);
    measure(95, "Switch|");
    check(!engine().requiresFreshMeasure(95), "a first answer is not a change");
    engine().setFallback("NitroUiSwitch", 61, 28, 0);
    measure(95, "Switch|");
    check(engine().requiresFreshMeasure(95), "the same configuration answered a different size, so it must re-ask");
  }

  void testEpsilonTreatsTinyDifferencesAsEqual() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(81, 81);
    measure(81, "Switch|");
    engine().report(81, 61.2f, 28.3f, 0);
    check(!engine().flush(), "a third of a point is the same size");

    const NitroUiSizeKey key = NitroUiSizingEngine::keyFor("NitroUiSwitch", "Switch|", engine().environmentEpoch());
    NitroUiMeasuredSize a{61, 28, key, 0};
    NitroUiMeasuredSize b{61.4f, 27.6f, key, 0};
    NitroUiMeasuredSize c{62, 28, key, 0};
    check(a.nearlyEquals(b), "nearlyEquals forgives sub-epsilon drift");
    check(!a.nearlyEquals(c), "and still sees a real difference");
  }

} // namespace

int main() {
  std::printf("sizing.test.cpp\n");
  testColdMountFallsBackAndCorrects();
  testPrewarmedMountCostsNothing();
  testPrewarmCannotPoisonTheCache();
  testAPrewarmLeavesEveryInstanceInexact();
  testOneReportCorrectsEveryInstance();
  testKeysAreIndependent();
  testEnvironmentChangeDropsAnswersAndKeepsTheGuess();
  testEnvironmentChangeCorrectsAMountedInstance();
  testEnvironmentChangeCorrectsAReportWithNoMeasure();
  testEnvironmentSignatureCoalescesCallbacks();
  testPrewarmMakesTheFirstMountExact();
  testStatsCountCorrectionsAndDroppedReports();
  testMountUnmountCyclesKeepTheEngineFlat();
  testALateLayoutAfterForgetFilesNothing();
  testALayoutBeforeItsBindStillGetsCorrected();
  testAnIdThatBindsAgainIsNotTreatedAsFinished();
  testAReshownViewIsStillCorrectedAfterItsLateLayout();
  testAReshownViewIsStillCorrectedByAnEnvironmentChange();
  testAHeldLateFilingIsBoundedUnderABurstOfDrops();
  testAHeldLateFilingIsReleasedWhenItsBindMissesTheWindow();
  testALayoutThatNeverBindsIsReclaimedWhenItsMountWindowCloses();
  testAMountThatFilesBeforeItBindsSurvivesItsOwnWindow();
  testABigFirstCommitKeepsEveryCorrection();
  testABindThatArrivesAfterItsWindowStillClaimsItsRowBack();
  testAPickerShapedChurnOfDroppedAndUnboundMountsLeavesNothingBehind();
  testAFirstCommitWhoseOverflowExceedsTheOldHeldCapKeepsEveryCorrection();
  testAConfirmationCountsReportsAndNeverCostsACommit();
  testAReshowOfMoreControlsThanTheOldCapacityLosesNoCorrection();
  testTheHeldTableStillCannotGrowWithoutBound();
  testABindLaterThanBothWindowsIsChargedAFreshMeasure();
  testTheFreshMeasureDebtIsNotChargedToAnInnocentMount();
  testAFlushWithNothingToApplyStillClosesExpiredMountWindows();
  testExpiredStatesAreSweptWithoutForget();
  testTheSweepStillRunsAfterTheRegistryHasShrunk();
  testInstanceIdsAreMonotonic();
  testImmediateBudgetCapsOneFlush();
  testDeferredPushesReadSizesAfterFlush();
  testPushMayReEnterMeasureAndBind();
  testTraceRecordsSizeChangesOnce();
  testStateSizeIsUsedWhenItMatchesTheKey();
  testALearnedSizeBelongsToItsOwnConfiguration();
  testKeyChangeReMeasuresAndCorrects();
  testFillWidthKeepsTheFlag();
  testFillWidthInstancesOfDifferentWidthsCostNothing();
  testFillWidthUnderAnInfiniteParentUsesTheDeclaredWidth();
  testFillWidthStillCorrectsAWrongHeight();
  testUnboundReporterKeepsItsCorrection();
  testUnboundTargetKeepsTheCorrection();
  testAnUnboundTargetIsCorrectedByALaterReport();
  testReportsWithoutAnInstanceAreDropped();
  testDeadStateIsPruned();
  testForgetDuringPendingCorrection();
  testRepeatedReportsKeepTheLastOne();
  testEpsilonTreatsTinyDifferencesAsEqual();
  testACorrectedInstanceAsksForAFreshMeasure();
  testAnUncorrectedInstanceKeepsTheMeasurementCache();
  testARekeyIsNotACorrectionButAMovedAnswerIs();

  if (failures == 0) {
    std::printf("  %d checks passed\n", checks);
    return 0;
  }
  std::printf("  %d of %d checks FAILED\n", failures, checks);
  return 1;
}
