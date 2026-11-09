//
// scroll-offset.test.cpp
//
// Host unit test for the reading half of a Form's scroll correction
// (cpp/NitroUiScrollOffset.hpp), compiled and run by `bun run test:native` - also
// under ASan + UBSan, like the sizing engine.
//
// The reason this is a host test and not only an on-device one: the correction is
// applied by a Fabric shadow node, so the wrong answer here is a `measure()` that is
// off by the scroll offset on a *simulator*, in a UI test that reads one box. The
// interesting inputs are the ones no device run produces on demand - a shadow tree
// that has not been told yet, an explicit `null`, a NaN from a layout that divided by
// zero - and the failure mode they share is silent: a correction of 0 looks exactly
// like a Form that is not scrolled.
//
// Every "real" offset in here is a nonzero number the fallback could never produce, so
// a reader that simply returns 0.0 - the simplest way to be wrong - cannot pass.
//

#include "NitroUiScrollOffset.hpp"

#include <Null.hpp>

#include <cstdio>
#include <limits>
#include <optional>
#include <string>
#include <variant>

using margelo::nitro::null;
using margelo::nitro::NullType;
using margelo::nitro::nitroui::detail::scrollOffsetOf;

namespace {

  int failures = 0;
  int checks = 0;

  /// The shape nitrogen generates today for `nuiContentOffsetY: number | null`
  /// (`nitrogen/generated/shared/c++/views/HybridNitroUiFormComponent.hpp`), written out
  /// rather than included because the generated header needs all of Fabric to compile.
  using OffsetProp = std::variant<NullType, double>;

  void check(double actual, double expected, const std::string& what) {
    checks++;
    // Exact comparison on purpose: both sides are either an integer-valued double the
    // test wrote itself or a literal 0.0, and an epsilon would hide a reader that
    // returned something merely close.
    if (actual != expected) {
      failures++;
      std::printf("  FAIL: %s (got %.6f, want %.6f)\n", what.c_str(), actual, expected);
    }
  }

  void testAPosixOffsetIsPassedThrough() {
    check(scrollOffsetOf(137.5), 137.5, "a bare number is the offset");
    check(scrollOffsetOf(OffsetProp{137.5}), 137.5, "the variant form of a number is the offset");
    check(scrollOffsetOf(OffsetProp{-24.25}), -24.25, "an over-scrolled (negative) offset survives");
    // Integer values arrive as doubles from JS; a reader that rounded them would be off
    // by up to a point on every settle, which is exactly the error this whole mechanism
    // exists to remove.
    check(scrollOffsetOf(OffsetProp{320.0}), 320.0, "a whole-pixel offset is not rounded");
  }

  void testAnUnknownOffsetIsNoCorrection() {
    // The three ways "nothing has been reported yet" can arrive. All three have to mean
    // "do not correct" - not "the Form is at the top", which happens to be 0 too, and is
    // why a device test at the top of a list can never tell these apart.
    check(scrollOffsetOf(OffsetProp{null}), 0.0, "an explicit null means no correction");
    check(scrollOffsetOf(OffsetProp{}), 0.0, "a prop that was never provided means no correction");
    check(scrollOffsetOf(std::optional<OffsetProp>{}), 0.0, "an absent optional means no correction");
    check(scrollOffsetOf(std::optional<OffsetProp>{OffsetProp{137.5}}), 137.5, "a present optional is read");
  }

  void testANonFiniteOffsetIsNoCorrection() {
    // A NaN reaching a shadow node means upstream arithmetic broke; propagating it into
    // `getContentOriginOffset` would make every descendant's `measure()` NaN, which is a
    // worse failure than no correction at all.
    const double nan = std::numeric_limits<double>::quiet_NaN();
    const double infinity = std::numeric_limits<double>::infinity();
    check(scrollOffsetOf(nan), 0.0, "NaN means no correction");
    check(scrollOffsetOf(infinity), 0.0, "+inf means no correction");
    check(scrollOffsetOf(-infinity), 0.0, "-inf means no correction");
    check(scrollOffsetOf(OffsetProp{nan}), 0.0, "NaN inside the prop means no correction");
    check(scrollOffsetOf(OffsetProp{infinity}), 0.0, "+inf inside the prop means no correction");
  }

  void testTheVariantOrderIsNotAssumed() {
    // Nitrogen has emitted both orders. A reader that used `std::get<1>` would break on
    // the second one, silently, the next time nitrogen changed.
    using Reversed = std::variant<double, NullType>;
    check(scrollOffsetOf(Reversed{137.5}), 137.5, "a number first in the variant is read");
    check(scrollOffsetOf(Reversed{null}), 0.0, "a null second in the variant is not read as a number");

    // An integral member is arithmetic too: reading only `double` would drop it to 0.
    using Integral = std::variant<NullType, int64_t>;
    check(scrollOffsetOf(Integral{320}), 320.0, "an integral member is read");
  }

} // namespace

int main() {
  testAPosixOffsetIsPassedThrough();
  testAnUnknownOffsetIsNoCorrection();
  testANonFiniteOffsetIsNoCorrection();
  testTheVariantOrderIsNotAssumed();

  if (failures == 0) {
    std::printf("  %d checks passed\n", checks);
    return 0;
  }
  std::printf("  %d of %d checks FAILED\n", failures, checks);
  return 1;
}
