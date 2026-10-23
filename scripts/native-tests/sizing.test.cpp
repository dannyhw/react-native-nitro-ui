//
// sizing.test.cpp
//
// Host unit test for the intrinsic-sizing engine (docs/architecture/sizing.md).
// Compiled and run by `bun run test:native`, with the shipping
// cpp/NitroUiSizingEngine.cpp linked in - the engine has no React Native or
// SwiftUI/Compose dependency by design (core-architecture §1.4), which is what
// makes this possible.
//
// A Fabric `State` is only ever held and handed back here, so a plain struct
// stands in for it; `fakePush` records what the engine would have committed,
// which is exactly the thing the on-device gate counts (extra commits).
//

#include "NitroUiSizingEngine.hpp"
#include "core/NitroUiSizing.hpp"

#include <cmath>
#include <cstdio>
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

  void fakePush(const NitroUiStateRef& state, const NitroUiMeasuredSize& measured, bool immediate) {
    auto* raw = static_cast<const FakeState*>(state.get());
    pushes.push_back(Push{raw->tag, measured.width, measured.height, immediate});
  }

  NitroUiSizingEngine& engine() {
    return NitroUiSizingEngine::shared();
  }

  /// A fresh environment: no cache, no ledger, no registry.
  void resetEngine() {
    engine().invalidateEnvironment();
    pushes.clear();
  }

  /// The test holds states alive the way the shadow tree does, so a case can
  /// control exactly when one dies.
  std::unordered_map<int64_t, NitroUiStateRef> kept_{};

  NitroUiStateRef bind(int64_t instanceId, int tag) {
    auto state = std::make_shared<FakeState>(FakeState{tag});
    NitroUiStateRef ref = state;
    kept_[instanceId] = ref;
    engine().registerInstance(instanceId, NitroUiSizingEngine::componentHash("NitroUiSwitch"), &fakePush, ref);
    return ref;
  }

  NitroUiMeasuredSize measure(int64_t instanceId, const std::string& key, const NitroUiMeasuredSize& fromState = {}) {
    return engine().measure("NitroUiSwitch", instanceId, key, fromState);
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
    engine().report(1, 61, 28, 0);
    check(!engine().flush(), "a report that agrees with the cache commits nothing");
    checkEquals(pushes.size(), size_t{0}, "an exact instance is never pushed");
  }

  void testPrewarmedMountCostsNothing() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(7, 7);

    auto size = measure(7, "Switch|");
    checkSize(size, 61, 28, "a pre-warmed configuration lays out exact");
    engine().report(7, 61, 28, 0);
    check(!engine().flush(), "a pre-warmed instance never pushes");
    checkEquals(pushes.size(), size_t{0}, "pre-warmed means zero extra commits");
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
    check(measure(31, "Switch|").valid(), "warm before the environment moves");

    engine().invalidateEnvironment();
    auto after = measure(31, "Switch|");
    check(!after.valid(), "a new epoch has no cached size");
    checkSize(after, 61, 28, "but the last known size is still the guess");
    engine().report(31, 61, 40, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "and the control corrects it in the new epoch");
  }

  /**
   * `prewarm`: adopt the declared size as this environment's answer for the
   * default configuration (the empty variant), so the first instance costs no
   * correction - and say `false` for a component that declared nothing.
   */
  void testPrewarmMakesTheFirstMountExact() {
    resetEngine();
    check(engine().cachedSizeCount() == 0, "a new epoch starts with no answers");
    check(!engine().prewarm("NitroUiNotLoaded"), "a component that declared nothing is not pre-warmable");

    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    check(engine().prewarm("NitroUiSwitch"), "a declared component is");
    checkEquals(engine().cachedSizeCount(), size_t{1}, "pre-warm puts one answer in the cache");

    bind(71, 71);
    auto laid = measure(71, "");
    check(laid.valid(), "the first instance is laid out from the cache, not a guess");
    checkSize(laid, 52, 48, "with the declared size");
    engine().report(71, 52, 48, 0);
    check(!engine().flush(), "the control agreeing with it needs no correction");
    checkEquals(pushes.size(), size_t{0}, "so the mount costs zero state updates");
  }

  /**
   * The counters an on-device test asserts on: one correction for a cold
   * instance, none for a warm one, and a flush counted as a skipped stale frame.
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
    checkEquals(cold.staleFramesSkipped - before.staleFramesSkipped, int64_t{1}, "one stale frame skipped");
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

    size_t immediatePushes = 0;
    for (const Push& push: pushes) {
      immediatePushes += push.immediate ? 1 : 0;
    }
    checkEquals(immediatePushes, size_t{NitroUiSizingEngine::kImmediateBudgetPerTurn}, "and the flags on the pushes agree");
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
    // Four events for a correction, and that is the whole log: laid out with the
    // guess, corrected, drawn, and laid out again at the real size (the re-layout
    // the correction causes). Three layout passes before the correction cost one
    // event between them, not three.
    checkEquals(events.size(), size_t{4}, "one event per size change, not per layout pass");
    if (events.size() == 4) {
      checkEquals(events[0].stage, NitroUiSizingEngine::kStageLaidOut, "first: laid out with the guess");
      checkSize(NitroUiMeasuredSize{events[0].width, events[0].height, {}, 0}, 52, 48, "which was the fallback");
      checkEquals(events[1].stage, NitroUiSizingEngine::kStageCorrected, "then the correction");
      checkEquals(events[2].stage, NitroUiSizingEngine::kStageDrew, "then what was drawn");
      checkSize(NitroUiMeasuredSize{events[2].width, events[2].height, {}, 0}, 61, 28, "drawn at the real size");
      checkEquals(events[3].stage, NitroUiSizingEngine::kStageLaidOut, "and the re-layout the correction caused");
      checkSize(NitroUiMeasuredSize{events[3].width, events[3].height, {}, 0}, 61, 28, "at the real size too");
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

  void testFillWidthKeepsTheFlag() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Slider|", 200, 20, NitroUiSizingEngine::kFlagFillWidth);
    bind(51, 51);
    auto size = measure(51, "Slider|");
    check((size.flags & NitroUiSizingEngine::kFlagFillWidth) != 0, "the fill-width policy survives the cache");
  }

  void testReportsWithoutAnInstanceAreDropped() {
    resetEngine();
    // Reported before any layout (or after the view died): nothing to correct.
    engine().report(99, 40, 40, 0);
    check(!engine().flush(), "a report with no ledger entry is dropped");

    // Measured, but not bound yet (the mount that binds it has not run): the
    // report is dropped, and the ledger entry is kept so the next one can work.
    measure(99, "Switch|");
    engine().report(99, 40, 40, 0);
    check(!engine().flush(), "an unbound instance commits nothing");
    checkEquals(pushes.size(), size_t{0}, "...and pushes nothing");
    bind(99, 99);
    engine().report(99, 40, 40, 0);
    check(engine().flush(), "once bound, the same report does correct it");
    checkEquals(pushes.size(), size_t{1}, "exactly one commit, late rather than never");
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
  testOneReportCorrectsEveryInstance();
  testKeysAreIndependent();
  testEnvironmentChangeDropsAnswersAndKeepsTheGuess();
  testPrewarmMakesTheFirstMountExact();
  testStatsCountCorrectionsAndDroppedReports();
  testImmediateBudgetCapsOneFlush();
  testTraceRecordsSizeChangesOnce();
  testStateSizeIsUsedWhenItMatchesTheKey();
  testFillWidthKeepsTheFlag();
  testReportsWithoutAnInstanceAreDropped();
  testDeadStateIsPruned();
  testRepeatedReportsKeepTheLastOne();
  testEpsilonTreatsTinyDifferencesAsEqual();

  if (failures == 0) {
    std::printf("  %d checks passed\n", checks);
    return 0;
  }
  std::printf("  %d of %d checks FAILED\n", failures, checks);
  return 1;
}
