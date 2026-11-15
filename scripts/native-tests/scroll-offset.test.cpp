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

  /// The shape nitrogen generates for `nuiContentOffsetY: number | null`, written out because
  /// the generated header needs all of Fabric to compile.
  using OffsetProp = std::variant<NullType, double>;

  void check(double actual, double expected, const std::string& what) {
    checks++;
    // Exact comparison on purpose: an epsilon would hide a reader that returned something close.
    if (actual != expected) {
      failures++;
      std::printf("  FAIL: %s (got %.6f, want %.6f)\n", what.c_str(), actual, expected);
    }
  }

  void testAPosixOffsetIsPassedThrough() {
    check(scrollOffsetOf(137.5), 137.5, "a bare number is the offset");
    check(scrollOffsetOf(OffsetProp{137.5}), 137.5, "the variant form of a number is the offset");
    check(scrollOffsetOf(OffsetProp{-24.25}), -24.25, "an over-scrolled (negative) offset survives");
    check(scrollOffsetOf(OffsetProp{320.0}), 320.0, "a whole-pixel offset is not rounded");
  }

  void testAnUnknownOffsetIsNoCorrection() {
    check(scrollOffsetOf(OffsetProp{null}), 0.0, "an explicit null means no correction");
    check(scrollOffsetOf(OffsetProp{}), 0.0, "a prop that was never provided means no correction");
    check(scrollOffsetOf(std::optional<OffsetProp>{}), 0.0, "an absent optional means no correction");
    check(scrollOffsetOf(std::optional<OffsetProp>{OffsetProp{137.5}}), 137.5, "a present optional is read");
  }

  void testANonFiniteOffsetIsNoCorrection() {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    const double infinity = std::numeric_limits<double>::infinity();
    check(scrollOffsetOf(nan), 0.0, "NaN means no correction");
    check(scrollOffsetOf(infinity), 0.0, "+inf means no correction");
    check(scrollOffsetOf(-infinity), 0.0, "-inf means no correction");
    check(scrollOffsetOf(OffsetProp{nan}), 0.0, "NaN inside the prop means no correction");
    check(scrollOffsetOf(OffsetProp{infinity}), 0.0, "+inf inside the prop means no correction");
  }

  void testTheVariantOrderIsNotAssumed() {
    // Nitrogen has emitted both variant orders.
    using Reversed = std::variant<double, NullType>;
    check(scrollOffsetOf(Reversed{137.5}), 137.5, "a number first in the variant is read");
    check(scrollOffsetOf(Reversed{null}), 0.0, "a null second in the variant is not read as a number");

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
