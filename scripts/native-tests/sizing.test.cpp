//
// sizing.test.cpp
//
// Host unit test for the intrinsic-sizing engine (docs/architecture/sizing.md).
// Compiled and run by `bun run test:native`, with the shipping
// cpp/NitroUiSizingEngine.cpp linked in - the engine has no React Native or
// SwiftUI/Compose dependency by design (core-architecture §1.4), which is what
// makes this possible. `scripts/native-tests.sh` also runs this whole file a
// second time under ASan + UBSan.
//
// A Fabric `State` is only ever held and handed back here, so a plain struct
// stands in for it; `fakePush` records what the engine would have committed,
// which is exactly the thing the on-device gate counts (extra commits). It can
// also defer a push, which is what React Native really does with an
// asynchronous state update (see `testDeferredPushesReadSizesAfterFlush`).
//

#include "NitroUiSizingEngine.hpp"
#include "core/NitroUiSizing.hpp"

#include <cmath>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
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

  /// The test holds states alive the way the shadow tree does, so a case can
  /// control exactly when one dies. Up here because `fakePush` re-enters with it
  /// (see `reentrantMeasure`).
  std::unordered_map<int64_t, NitroUiStateRef> kept_{};

  NitroUiSizingEngine& engine();

  /**
   * When on, a push does not happen during `flush()` - it is stored and run by
   * the test afterwards, like RN's `EventQueue::enqueueStateUpdate` does for an
   * `Asynchronous` update. Anything the engine hands a push must therefore
   * outlive the call, which is the contract review B1 found broken in the host.
   */
  bool deferPushes = false;
  std::vector<std::function<void()>> deferred{};

  /**
   * When on, a push also does what a real immediate commit does synchronously:
   * re-layout (`measure`) and rebind the instance with the new state. Used to
   * prove the engine never holds its lock across a push.
   */
  bool reentrantMeasure = false;
  bool reentrantSawSize = false;

  void fakePush(const NitroUiStateRef& state, const NitroUiMeasuredSize& measured, bool immediate) {
    auto* raw = static_cast<const FakeState*>(state.get());
    if (!deferPushes) {
      pushes.push_back(Push{raw->tag, measured.width, measured.height, immediate});
      if (reentrantMeasure && immediate) {
        // `applyReports` has dropped the lock by now, so this may come back in:
        // the commit re-layouts, and the new `State` re-registers the instance.
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
    // Copy, exactly as `pushMeasuredSize` in cpp/NitroUiIntrinsic.hpp must: the
    // size lives in a vector the engine frees when `applyReports` returns.
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

  /**
   * A fresh engine: no cache, no ledger, no registry.
   *
   * `invalidateEnvironment` alone is no longer enough - since review S2 an
   * environment change *keeps* mounted instances so it can correct them, which
   * is the opposite of what a test reset wants. So every id the file handed out
   * is forgotten first, the way a host forgets a view it drops.
   */
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

  // MARK: - Cases

  void testColdMountFallsBackAndCorrects() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(1, 1);

    auto first = measure(1, "Switch|");
    checkSize(first, 52, 48, "cold mount uses the component fallback");
    check(!first.valid(), "the fallback is a guess, not an answer for this key");

    // The control measured a different size: one correction, one commit.
    engine().report(1, 61, 28, 0);
    check(engine().flush(), "flush reports a change");
    checkEquals(pushes.size(), size_t{1}, "a cold mount costs exactly one push");
    check(pushes[0].immediate, "the first correction goes out immediately");

    // Now the cache knows: the same configuration is exact on its first layout.
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

    // Confirming it must have made the entry authoritative, so the *next*
    // instance is answered from an answer rather than from another guess.
    pushes.clear();
    bind(8, 8);
    auto next = measure(8, "Switch|");
    check(next.valid(), "the confirmed entry is authoritative for the next mount");
    engine().report(8, 61, 28, 0);
    check(!engine().flush(), "which costs nothing either");
    checkEquals(pushes.size(), size_t{0}, "no commits for the second instance");
  }

  /**
   * Review B2, the case that made `prewarm` dangerous: the library guesses a
   * size, the control is a different size, and the guess is on screen. iOS 26
   * apps running with `UIDesignRequiresCompatibility` are exactly this - the
   * declared 61x28 laid over a 51x31 control, leaving every Switch in a box
   * that was 3 pt too short for the whole session.
   */
  void testPrewarmCannotPoisonTheCache() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 61, 28, 0);
    check(engine().prewarm("NitroUiSwitch"), "the declared size is pre-warmable");

    bind(91, 91);
    auto laid = measure(91, "");
    checkSize(laid, 61, 28, "the first layout uses the pre-warmed guess");
    check(laid.valid(), "it is laid out from the cache entry");

    // The real control is 51x31 (compat mode). The guess must not survive it.
    engine().report(91, 51, 31, 0);
    check(engine().flush(), "the real size corrects the guess");
    checkEquals(pushes.size(), size_t{1}, "one correction, like any cold mount");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 51, 31, "corrected to the real size");

    // The whole point: the poison is gone, so the *next* instance is right.
    pushes.clear();
    bind(92, 92);
    auto second = measure(92, "");
    checkSize(second, 51, 31, "the next mount is laid out at the real size");
    engine().report(92, 51, 31, 0);
    check(!engine().flush(), "and needs no correction");
    checkEquals(pushes.size(), size_t{0}, "zero commits for the second mount");
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

    // Every one of them is exact now, so a second round of reports is free.
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

    // The two keys must not share a cache slot.
    check(engine().cachedSizeCount() == 2, "both configurations are cached");
    check(!(NitroUiSizingEngine::keyFor("NitroUiSwitch", "a", 1) == NitroUiSizingEngine::keyFor("NitroUiSwitch", "", 1)),
          "different keys hash differently");
    check(!(NitroUiSizingEngine::keyFor("NitroUiSwitch", "x", 1) == NitroUiSizingEngine::keyFor("NitroUiSwitchx", "", 1)),
          "the separator keeps component and key from running together");
    check(!(NitroUiSizingEngine::keyFor("NitroUiSwitch", "Switch|", 1) == NitroUiSizingEngine::keyFor("NitroUiSwitch", "Switch|", 2)),
          "the environment epoch changes the key");
  }

  /**
   * The environment moving (text size, density, OS control size) must drop every
   * *answer* but keep a *guess*: a component declares its fallback once per
   * process, so clearing it would leave the first instance of the new epoch laid
   * out at 0x0 - invisible for a frame - instead of at roughly the right size.
   */
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

  /**
   * Review S2: an environment change has to be able to correct a control that is
   * *already mounted*, which means the bump must keep its ledger entry (so the
   * report is not answered "nothing ever laid out") and must not push a control
   * whose size did not actually move.
   */
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

    // Same environment result after all: the host re-measures, gets the old size
    // back, and that must not cost a commit.
    measure(35, "");
    engine().report(35, 60, 40, 0);
    check(!engine().flush(), "an environment change that does not move the control costs nothing");
    checkEquals(pushes.size(), size_t{0}, "no commit for a size it already had");

    // Now it really does move (a larger Dynamic Type on a text-sized control).
    engine().invalidateEnvironment();
    measure(35, "");
    engine().report(35, 66, 44, 0);
    check(engine().flush(), "a real size change after the bump is corrected");
    checkEquals(pushes.size(), size_t{1}, "one commit, for the size that moved");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 66, 44, "to the new size");
  }

  /**
   * `invalidateEnvironmentIfChanged` turns N per-view callbacks into one bump:
   * the first view with a new signature bumps, the rest of them - and a rotation
   * - do not.
   */
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

  /**
   * `prewarm`: adopt the declared size as this environment's provisional answer
   * for the default configuration (the empty variant), so the first instance
   * costs no correction when the guess is right - and say `false` for a
   * component that declared nothing.
   */
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

  /**
   * The counters an on-device test asserts on: one correction for a cold
   * instance, none for a warm one, and a flush that changed a size.
   */
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

    // A second instance of the same configuration: the cache has the answer now.
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

  /**
   * Review S3: mounting and unmounting must not grow the engine. A virtualised
   * list of switches recycles views for the life of a session; the ledger and
   * the registry have to follow the view, not the process.
   */
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
    // One configuration, one cached size, however many instances saw it.
    checkEquals(engine().cachedSizeCount(), size_t{1}, "one configuration is still one cache entry");
  }

  /**
   * A host that dies without calling `forget` (a crash in a new platform glue, a
   * view torn down off the recycle path) must not leak either: the sweep in
   * `flush` catches states the shadow tree released.
   */
  void testExpiredStatesAreSweptWithoutForget() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    for (int64_t id = 500; id < 500 + 600; id++) {
      // Deliberately no `kept_`: the last strong reference dies on scope exit.
      auto scoped = std::make_shared<FakeState>(FakeState{1});
      engine().registerInstance(id, NitroUiSizingEngine::componentHash("NitroUiSwitch"), &fakePush, NitroUiStateRef(scoped));
      measure(id, "");
    }
    check(engine().stats().registryEntries > 0, "600 instances are registered");
    bind(1200, 1200);
    measure(1200, "");
    engine().report(1200, 70, 30, 0);
    engine().flush();
    check(engine().stats().registryEntries < 100, "the sweep dropped the states that died without a forget");
  }

  /**
   * Review S4: ids are issued by the engine, because it is process-global and a
   * JS runtime is not. Uniqueness is what stops two components (or two runs)
   * sharing one ledger entry.
   */
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

  /**
   * The per-turn budget (R2/R4): the first corrections of a flush go out as
   * `unstable_Immediate` state updates, the rest are batched, so 200 cold
   * instances cannot each force a synchronous commit.
   */
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
  }

  /**
   * Review B1/S8: RN runs an asynchronous state update later, on the JS thread,
   * after the flush that queued it has returned. So everything a push receives
   * must be a value, not a reference into the engine's own batch buffer. The
   * host does this in `pushMeasuredSize` (cpp/NitroUiIntrinsic.hpp), which needs
   * React Native headers and so cannot be compiled here - what this pins is the
   * engine-side half of the contract: nothing a push may read is alive after
   * `flush()` returns, and a deferred consumer that copies gets the right sizes.
   */
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

    // The flush is over: its vector of sizes is freed. Reuse that memory, then
    // run the updates the way the JS thread would.
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

  /**
   * A push can come back around synchronously: an immediate update re-layouts,
   * `measureContent` calls `measure`, and the resulting state rebinds the
   * instance. None of that may happen under the engine's lock, so a fake push
   * that does all three is the regression test for the "no lock across a push"
   * rule (a deadlock here is loud, which is the point).
   */
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

  /**
   * The trace: laid out, corrected, drew - and only on *changes*, so a control
   * laid out a hundred times is not a hundred events.
   */
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
    // Three events for a correction, and that is the whole log: laid out with the
    // guess, corrected, drawn. The re-layout the correction causes is not a
    // fourth event, because the push already recorded the size the instance is
    // being laid out with. Three layout passes before the correction cost one
    // event between them, not three.
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

    // The same state data under a different key is a different answer.
    auto other = measure(41, "Switch|disabled", NitroUiMeasuredSize{50, 30, key, 0});
    check(!other.valid(), "another key does not inherit it");
  }

  /**
   * A configuration change (a new `nuiSizingKey`) must re-measure, which means
   * the instance's old size does not carry over into the new configuration and
   * the report for the new size is not dropped as "already correct". Review S1:
   * this used to be unreachable because the dirty check compared a node with
   * itself - see `shouldNewRevisionDirtyMeasurement`.
   */
  /**
   * A learned size belongs to the configuration that measured it (review B2's
   * other half): `fallbacks_` is keyed by component alone, so a measurement filed
   * there lets one variant become another variant's guess. Reproduced on a device
   * as a fresh default Switch mounting 100pt wide after a 100pt variant reported,
   * and reproduced here in milliseconds.
   */
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

    // The configuration that measured 61x28 keeps that as its own history, even
    // across an environment bump (which is what keeps such a mount free).
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

    // The size-affecting prop moved: a new variant, laid out again.
    pushes.clear();
    auto wider = measure(45, "|w20");
    check(!wider.valid(), "the new configuration has no answer of its own");
    /**
     * The guess is the component's *declared* 52x48, not the other variant's
     * measured 61x28. Filing a measurement under the component (what this used to
     * do) made one configuration answer another one's size: on a device a fresh
     * default mount came back 100pt wide because a 100pt variant had reported last.
     */
    checkSize(wider, 52, 48, "guessed from the declared fallback, not the other variant's size");
    engine().report(45, 81, 28, 0);
    check(engine().flush(), "the real size for the new variant is corrected");
    checkEquals(pushes.size(), size_t{1}, "one commit for the new size");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 81, 28, "the wider size");

    // And back again: each variant keeps its own answer.
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

  /**
   * Review S7: a correction for an instance that is not bound yet must be kept,
   * not dropped - both for the instance that reported and for another instance
   * of the same configuration waiting for the answer.
   */
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

    // The instance that could not be reached is still waiting, and the answer is
    // already in the cache by the time it binds and measures.
    bind(111, 111);
    auto late = measure(111, "Switch|");
    checkSize(late, 61, 28, "its first layout after binding is already the right size");
    check(late.valid(), "answered from the cache, not from a guess");
    engine().report(111, 61, 28, 0);
    check(!engine().flush(), "and once it measures, the cache is already right");
    checkEquals(pushes.size(), size_t{1}, "so it costs nothing");
  }

  /**
   * Reports that arrive before *any* layout for an instance are dropped, and do
   * not leave anything behind.
   */
  void testReportsWithoutAnInstanceAreDropped() {
    resetEngine();
    // Reported before any layout (or after the view died): nothing to correct.
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
    // The dead instance is pruned with its ledger entry, so it cannot hold a
    // later instance's correction hostage.
    engine().report(61, 61, 28, 0);
    check(!engine().hasPendingReports(), "the pruned instance reports nothing afterwards");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "and its ledger entry went with it");
  }

  /**
   * Teardown while a correction is in flight (the harness case S8 asks for): the
   * host forgot the instance, so the flush must do nothing at all rather than
   * push into a state that may already be gone.
   */
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

  void testEpsilonTreatsTinyDifferencesAsEqual() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(81, 81);
    measure(81, "Switch|");
    engine().report(81, 61.2f, 28.3f, 0);
    check(!engine().flush(), "a third of a point is the same size");

    // A state that differs by less than the epsilon must not commit either.
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
  testOneReportCorrectsEveryInstance();
  testKeysAreIndependent();
  testEnvironmentChangeDropsAnswersAndKeepsTheGuess();
  testEnvironmentChangeCorrectsAMountedInstance();
  testEnvironmentSignatureCoalescesCallbacks();
  testPrewarmMakesTheFirstMountExact();
  testStatsCountCorrectionsAndDroppedReports();
  testMountUnmountCyclesKeepTheEngineFlat();
  testExpiredStatesAreSweptWithoutForget();
  testInstanceIdsAreMonotonic();
  testImmediateBudgetCapsOneFlush();
  testDeferredPushesReadSizesAfterFlush();
  testPushMayReEnterMeasureAndBind();
  testTraceRecordsSizeChangesOnce();
  testStateSizeIsUsedWhenItMatchesTheKey();
  testALearnedSizeBelongsToItsOwnConfiguration();
  testKeyChangeReMeasuresAndCorrects();
  testFillWidthKeepsTheFlag();
  testUnboundReporterKeepsItsCorrection();
  testUnboundTargetKeepsTheCorrection();
  testReportsWithoutAnInstanceAreDropped();
  testDeadStateIsPruned();
  testForgetDuringPendingCorrection();
  testRepeatedReportsKeepTheLastOne();
  testEpsilonTreatsTinyDifferencesAsEqual();

  if (failures == 0) {
    std::printf("  %d checks passed\n", checks);
    return 0;
  }
  std::printf("  %d of %d checks FAILED\n", failures, checks);
  return 1;
}
