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

  // MARK: - F8: the late-layout orphan

  /**
   * F8: a layout that arrives after the instance was forgotten must file nothing.
   *
   * This is `Menu × no-leak-on-drop: 1 ledger entry(ies) survived 50 drops` from
   * CI run 41256853746, where the registry read `0→0` across the same window.
   * Those two halves together say what survived: a ledger entry with no registry
   * row. And the registry sweep — the only thing in the engine that reclaims an
   * instance whose `State` died without a `forget` — walks `registry_`, so an
   * entry that lives only in `ledger_` is invisible to it for the life of the
   * process. One per occurrence, in an app that scrolls a list.
   *
   * How one gets made: a correction is an `Asynchronous` state update, and RN runs
   * its callback later, scheduling a layout pass over the tree revision that
   * carried it. Drop the view in between — which is what a churn of 50
   * mount/unmount pairs is, and what an iOS `Menu` costs extra because its popup
   * makes the drop land a transaction later — and that pass re-enters
   * `measureContent` for an id whose `onDropView` has already run. `measure`
   * records what it laid out in `ledger_[instanceId]` without asking whether the
   * instance is still bound.
   *
   * It cannot simply refuse an unbound id: `measure` legitimately runs *before*
   * `registerInstance` on a real mount (layout is on the shadow thread, the bind
   * is on the mount transaction), which is the same ordering `applyReports`'s
   * "not bound yet — put it back rather than lose the correction" branch exists
   * for. The rule that holds is narrower — an id this engine has already
   * *forgotten* is finished, and ids are never reused — so that is what the fix
   * enforces, and the case after this one is the guard on it.
   */
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

    // The late layout, from the commit this instance caused before it died.
    measure(4100, "");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "a layout arriving after `forget` files nothing");
    checkEquals(engine().stats().registryEntries, int64_t{0}, "and there is no registry row that would let it be reclaimed later");

    // The same churn the device rule runs, so a fix that only handles one
    // occurrence cannot pass: 50 drops, and nothing left afterwards. Note the
    // registry never rises here — the CI failure's other half, and the reason the
    // sweep was never going to see the survivor.
    for (int64_t cycle = 0; cycle < 50; cycle++) {
      const int64_t id = 4300 + cycle;
      bind(id, static_cast<int>(id));
      measure(id, "");
      engine().report(id, 61, 28, 0);
      engine().flush();
      engine().forget(id);
      kept_.erase(id);
      // The orphaning measure, one cycle late, as an async commit is.
      measure(id, "");
    }
    const NitroUiSizingCounters after = engine().stats();
    checkEquals(after.ledgerEntries, int64_t{0}, "50 drops with a late layout each leave no ledger entry");
    checkEquals(after.registryEntries, int64_t{0}, "and no registry entry");

    // A mounted instance is still correctable afterwards: the guard is about
    // finished ids, not about unbound ones. Its own key, because the churn above
    // warmed `""` and a warm mount has nothing left to be corrected for.
    bind(4500, 4500);
    measure(4500, "late-live");
    engine().report(4500, 61, 28, 0);
    check(engine().flush(), "a live instance is still corrected after all that");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "with exactly its own entry");
  }

  /**
   * The guard on the guard: `measure` before `registerInstance` is the normal
   * ordering for a mount in flight, and an entry filed in that window must
   * survive and still be owed its correction. Dropping entries merely because
   * nothing is bound yet would silently swallow corrections — the failure mode S7
   * was written against — which is worse than the leak it would fix.
   */
  void testALayoutBeforeItsBindStillGetsCorrected() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);

    // Laid out first, bound after: what the shadow thread and the mount
    // transaction really do.
    measure(4600, "");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "a mount files its entry before it binds");
    // Lost in between, and laid out again after — the shape from the case above,
    // so the two rules have to hold at the same time.
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

  /**
   * An id that binds again is alive, whatever the engine was told about it before.
   *
   * `registerInstance` is the engine's only evidence that an id has a `State` in
   * the shadow tree, and `updateState:oldState:` calls it on mount as well as on
   * every later state change — so it is also the seam that would otherwise make the
   * forgotten-id rule permanent for an id the platform decided to use again. Without
   * that line, a re-bound instance answers layouts with a size and files nothing:
   * it is never corrected, never traced, and reports itself as never measured — a
   * silent, per-instance regression that no device rule would attribute to this
   * commit.
   */
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

    // Refused while finished, so the case below cannot pass by accident.
    measure(4700, "rebound");
    checkEquals(engine().stats().ledgerEntries, int64_t{0}, "a finished id files nothing before it rebinds");

    // The rebind: the same id, a fresh `State`, as a mount hands one out.
    bind(4700, 4700);
    measure(4700, "rebound");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "rebinding clears the mark, so the layout is filed again");

    // And it is correctable again: the entry the engine filed is one it will use.
    // `pushes` still holds the first mount's correction, so count from here.
    pushes.clear();
    engine().report(4700, 61, 28, 0);
    check(engine().flush(), "and the re-bound instance still gets its correction");
    checkEquals(pushes.size(), size_t{1}, "one push, for the instance that is live");
    checkEquals(pushes[0].tag, 4700, "and it went to the re-bound instance");
  }

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

  /**
   * Review B2, pinned (review O1): a pre-warmed entry is a *guess*, so every
   * instance laid out from it stays inexact. Two instances take the pre-warm, only
   * one of them measures, and the answer has to reach both. Making the pre-warm
   * authoritative answers the second one "exact" out of the guess and it never
   * hears that the first control measured something else - one push instead of
   * two, and a Switch that stays in a box 10 pt too short for its whole life.
   */
  void testAPrewarmLeavesEveryInstanceInexact() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 61, 28, 0);
    check(engine().prewarm("NitroUiSwitch"), "the declared size is pre-warmable");
    bind(93, 93);
    bind(94, 94);
    measure(93, "");
    measure(94, "");
    checkEquals(pushes.size(), size_t{0}, "two pre-warmed mounts cost nothing");

    // The real control is 51x31 (compat mode), and only one of them measured it.
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
   * Review F2: the S2 correction with no `measure` between the bump and the
   * report, which is what a real host does.
   *
   * A trait change re-lays out the hosted control from the platform side, and the
   * control reports its new size from that layout. Yoga is only asked again if a
   * layout pass needs a number, and a mounted control whose size was believed
   * exact does not need one - so there is no re-measure coming to rescue the
   * report. Round 1 cleared the ledger on every bump, so this report was answered
   * "nothing ever laid out for this instance" and dropped: the control stayed at
   * the old size until something else happened to lay it out again. The case above
   * could not see that because it measured after each bump, which rebuilds the
   * entry by itself.
   */
  void testEnvironmentChangeCorrectsAReportWithNoMeasure() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 52, 48, 0);
    bind(36, 36);
    measure(36, "");
    engine().report(36, 60, 40, 0);
    engine().flush();
    checkEquals(pushes.size(), size_t{1}, "mounted, corrected, and exact at 60x40");

    pushes.clear();
    // Dynamic Type grows. The host re-lays out and reports the bigger size; no
    // layout pass asked Yoga for a number in between.
    engine().invalidateEnvironment();
    checkEquals(pushes.size(), size_t{0}, "the bump itself commits nothing");
    engine().report(36, 72, 48, 0);
    check(engine().flush(), "the report is still believed without a re-measure");
    checkEquals(pushes.size(), size_t{1}, "one commit, for the control whose size moved");
    checkSize(NitroUiMeasuredSize{pushes[0].width, pushes[0].height, {}, 0}, 72, 48, "to the size it measured");

    // The other half of S2, again with no re-measure: an epoch bump that did not
    // move this control must not push it a byte-identical second size.
    pushes.clear();
    engine().invalidateEnvironment();
    engine().report(36, 72, 48, 0);
    check(!engine().flush(), "a bump that did not move the control leaves nothing to flush");
    checkEquals(pushes.size(), size_t{0}, "and costs no commit");
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
   *
   * The expired instances are measured under a *different* sizing key from the
   * instance that reports. Under the same key they sit in the reported
   * configuration's needs-correction set, `applyReports` finds their states dead
   * and forgets them right there, and the sweep then walks an already-clean
   * registry - the case passes without ever running the sweep (review F1, which
   * is where the sweep's own use-after-free had been hiding). On their own key
   * nothing else reaches them, so the sweep is the only thing that can clean up.
   *
   * The registry is only walked once it has grown by a sweep stride since the
   * last walk, which is why there are 600 of them.
   */
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
    // Exactly one entry survives, and it is the live one: the sweep, not
    // `applyReports`, removed the other 600.
    checkEquals(engine().stats().registryEntries, int64_t{1}, "the sweep dropped the states that died without a forget");
    checkEquals(engine().stats().ledgerEntries, int64_t{1}, "and their ledger entries with them");
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

    /**
     * The budget is the platform's, not the engine's (T12 phase 2). Android
     * flushes inside the pre-draw pass it then cancels, so it spends one
     * synchronous push; iOS spends the default two because its pushes join a
     * commit that has not happened yet. The engine only has to honour whatever
     * number it is handed, including none.
     */
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
    // What this pins is that the corrections go out anyway; it is documentation
    // rather than a gate for the clamping arithmetic itself, because a negative
    // `remaining` is already not greater than zero, so removing the clamp in
    // `applyReports` would change nothing observable here. The behaviour worth
    // guarding against is a budget check that returns early, and the two checks
    // below are what would catch that.
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
   * The box a `fillWidth` node is laid out with: the height the engine answered
   * with, and the width Yoga gave it. This mirrors the last lines of
   * `IntrinsicShadowNode::measureContent` (cpp/NitroUiIntrinsic.hpp:205-212) -
   * the engine cannot see the constraints, so the shadow node applies the policy
   * after `measure` returns, and a test of the policy has to apply it too.
   *
   * Including its guard: an infinite constraint width is not a box width, so
   * `INFINITY` means "there is no box width" and the cached width is what draws.
   */
  NitroUiMeasuredSize layoutAt(const NitroUiMeasuredSize& measured, float boxWidth) {
    NitroUiMeasuredSize laidOut = measured;
    if ((measured.flags & NitroUiSizingEngine::kFlagFillWidth) != 0 &&
        std::isfinite(boxWidth)) {
      laidOut.width = boxWidth;
    }
    return laidOut;
  }

  /**
   * A Slider's width belongs to its parent, so two Sliders of one configuration
   * legitimately have different widths - and the engine must see that as nothing
   * to correct. D17: a configuration already exact in the cache lays out exact
   * on its first frame, with 0 corrections, for *every* instance of it.
   *
   * The declared fallback is 328 wide and the real boxes are 300 and 200, so a
   * comparison that looks at the width sees a change on every instance: each
   * report queues a correction, and each correction rewrites the cache to that
   * instance's box width. Measured on the round this was written: two pushes and
   * a cache that answered 200 to a control that had only ever been 300 wide.
   */
  void testFillWidthInstancesOfDifferentWidthsCostNothing() {
    resetEngine();
    // 40 is a stand-in height - the engine is component-agnostic, and the real
    // Slider measures 31 pt on iOS and 48 dp on Android. The guess is right
    // where it can be (D17), so the only difference left is the width.
    engine().setFallback("NitroUiSwitch", 328, 40, NitroUiSizingEngine::kFlagFillWidth);
    bind(71, 71);

    auto first = measure(71, "");
    checkSize(layoutAt(first, 300), 300, 40, "the first Slider is laid out at its box width");
    engine().report(71, 300, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "a 300-wide report for a 300-wide layout is not a change");
    checkEquals(pushes.size(), size_t{0}, "which costs no commit");

    // Warm now: the next instance is exact on its first layout (D17), in a box
    // of a *different* width - which is the ordinary case, not an edge one.
    bind(72, 72);
    auto second = measure(72, "");
    checkSize(second, 328, 40, "the cached answer is the height the control measured, at the declared width");
    checkSize(layoutAt(second, 200), 200, 40, "and the box still owns the width");
    engine().report(72, 200, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "the 200-wide Slider's report is not a change either");
    checkEquals(pushes.size(), size_t{0}, "so the second instance costs nothing");

    // And the cache did not become this instance's box width.
    bind(73, 73);
    auto third = measure(73, "");
    checkSize(third, 328, 40, "a third Slider reads the control's answer, not the last box");
  }

  /**
   * Row 10 of `docs/tasks/FOLLOWUPS.md`: a `fillWidth` control in a parent with no
   * finite width (a horizontal scroller) kept the last cached width, forever.
   *
   * The policy says such a control's width is not its own - `measureContent`
   * replaces it with the box's - so filing a report's width into the cache looked
   * free. It was not free in exactly one case: that replacement is guarded on the
   * constraint width being *finite*, so under an infinite parent the cached width
   * is what draws. Filing the report's width therefore left whichever box a
   * bounded instance had last been measured at, on a control in a different
   * parent, with nothing left that could notice: the report agrees with the cache
   * by height - all the policy allows it to compare - so it is confirmed rather
   * than queued, and no later measure can differ either.
   *
   * What a `fillWidth` entry holds now is the width the component *declared* for
   * this case (328 here, deliberately none of the box widths this test measures,
   * and the number `docs/components/slider.md` already documents as "used only
   * when a parent gives no finite width").
   */
  void testFillWidthUnderAnInfiniteParentUsesTheDeclaredWidth() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 328, 40, NitroUiSizingEngine::kFlagFillWidth);

    // A bounded Slider is measured first: the ordinary shape of a real screen,
    // where a horizontal scroller is not the only `fillWidth` control in the app.
    bind(76, 76);
    measure(76, "");
    engine().report(76, 200, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "the bounded instance's report is not a correction");
    checkEquals(pushes.size(), size_t{0}, "which costs nothing");

    // The scroller's instance: same configuration, so the engine is warm, and Yoga
    // has no width to give it. This is the frame row 10 is about.
    bind(77, 77);
    auto underInfinity = measure(77, "");
    checkSize(layoutAt(underInfinity, INFINITY), 328, 40,
              "an unbounded parent draws the declared width, not the 200 dp of someone else's box");

    // The unbounded instance then measures its own content at the box it was given
    // and reports 328: a confirmation, not a correction, so the width it draws is
    // the width it agreed to and nothing further moves.
    engine().report(77, 328, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "which the unbounded instance confirms rather than corrects");
    checkEquals(pushes.size(), size_t{0}, "and that costs no commit");

    // A control that declared nothing keeps what it measured (there is no honest
    // replacement to offer), so the filing has to be tested against the *other*
    // half the report writes: the configuration's own history, which outlives an
    // environment change while `cache_` does not. A fresh cold mount after a text
    // size change guesses from that history, and a guess is the number an
    // unbounded parent draws just as much as a cache hit is.
    engine().invalidateEnvironment();
    bind(78, 78);
    checkSize(measure(78, ""), 328, 40,
              "the configuration's history carries the declared width too");
  }

  /**
   * The width is what a `fillWidth` control may disagree about; the height is
   * still its own answer and a wrong guess about it must still be corrected.
   * The fallback here is deliberately 33 against a real 40 (fixtures must not
   * coincide with the answer), so a blind comparison shows up as a missing push.
   */
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

    // Warm with the right height: a different box width must not undo it.
    pushes.clear();
    bind(75, 75);
    auto second = measure(75, "");
    checkSize(layoutAt(second, 250), 250, 40, "the next Slider is exact on its first frame");
    engine().report(75, 250, 40, NitroUiSizingEngine::kFlagFillWidth);
    check(!engine().flush(), "and its report costs nothing");
    checkEquals(pushes.size(), size_t{0}, "no commit for a warm instance");
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
   * Review S7, pinned (review O1): the re-queue, not the cache.
   *
   * An instance that could not be reached during a flush goes back on the
   * needs-correction list. Here it binds and is *never measured again*, so the
   * cache cannot rescue it: the next report of its configuration - a sibling
   * measuring the same variant - is the only thing left that can reach it. Dropping
   * the re-queue leaves that control sitting at the guess for as long as it is on
   * screen, and the case above cannot see it because it re-measures after binding.
   */
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

  /**
   * FIX2 (T15 Finding 1, D20). The correction lands as a new `State`, but React's
   * next props clone copies the state of *its own* pre-correction revision, and our
   * `adopt` mints a fresh `State` from it on every props change - so RN's
   * `progressState` never re-dirties the node and a props-only clone stays clean
   * (`shouldNewRevisionDirtyMeasurement`) with that revision's superseded size. Once
   * an instance has been corrected it must stop trusting that revision; this is the
   * flag the shadow node asks for on a props turn.
   */
  void testACorrectedInstanceAsksForAFreshMeasure() {
    resetEngine();
    engine().setFallback("NitroUiSwitch", 40, 20, 0);
    bind(91, 91);
    bind(93, 93);

    check(!engine().requiresFreshMeasure(91), "an instance that was never measured asks for nothing");
    check(!engine().requiresFreshMeasure(NitroUiSizing::NO_INSTANCE), "and neither does a view sizing ignores");

    measure(91, "Switch|");
    check(!engine().requiresFreshMeasure(91), "a first answer is not a change, even a wrong one");

    // Corrected without being measured again: the flag has to come from the
    // report, because a props turn that never re-layouts is exactly the turn
    // that would otherwise lay the control out at the superseded size.
    engine().report(91, 61, 28, 0);
    check(engine().flush(), "the correction commits");
    check(engine().requiresFreshMeasure(91), "an instance whose answer moved must re-ask on a props turn");
    check(!engine().requiresFreshMeasure(93), "and only that instance - another mount keeps the fast path");

    measure(91, "Switch|");
    check(engine().requiresFreshMeasure(91), "the flag is sticky: Yoga is still holding the old answer");

    engine().forget(91);
    check(!engine().requiresFreshMeasure(91), "a dropped instance carries nothing with it");
  }

  /**
   * The other half of the fix: the exemption must not become a measure on every
   * props turn. An instance that was never answered twice keeps review S1's
   * promise that toggling a control costs no measure and no commit.
   */
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

  /**
   * FIX2 fix round 1 (review finding 1). A configuration change is not a
   * correction. `measure` deliberately clears what the instance was last laid out
   * at when its key moves, so comparing the new answer against that cleared size
   * flags *every* re-key - warm keys of the identical size included - and a control
   * whose size never moved is on the paying path for the rest of its mount. Both
   * halves are pinned: a re-key costs nothing, and an answer that really moved
   * under an unchanged configuration still raises the flag. Without the second
   * half the line could simply be deleted.
   */
  void testARekeyIsNotACorrectionButAMovedAnswerIs() {
    // A re-key between two configurations that happen to be the same size: a
    // Button going from "Save" to "Edit". Both answers are warm, nothing was ever
    // corrected, so nothing may be flagged and nothing may be committed.
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

    // The other half: with the configuration unchanged, an answer that moves is
    // still a correction, and this is the line that has to notice it. The instance
    // is laid out before the component's declared size arrives (T14's ordering), so
    // the same key is later answered something else with no report in between - only
    // `measure` can see that.
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
