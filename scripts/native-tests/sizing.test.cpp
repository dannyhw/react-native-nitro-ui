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
    auto* raw = static_cast<FakeState*>(state.get());
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

  void testEnvironmentChangeInvalidatesEverything() {
    resetEngine();
    engine().seedSize("NitroUiSwitch", "Switch|", 61, 28, 0);
    bind(31, 31);
    check(measure(31, "Switch|").valid(), "warm before the environment moves");

    engine().invalidateEnvironment();
    auto after = measure(31, "Switch|");
    check(!after.valid(), "a new epoch has no cached size");
    checkSize(after, 0, 0, "and nothing to fall back to either");
    engine().report(31, 61, 40, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "the control corrects itself after the epoch moves");
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
  testEnvironmentChangeInvalidatesEverything();
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
