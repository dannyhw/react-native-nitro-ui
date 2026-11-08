//
//  NitroUiScrollOffset.hpp
//  react-native-nitro-ui
//
//  The one piece of a `Form`'s scroll correction that is pure arithmetic, and so lives here
//  where the host test suite can run it (`bun run test:native`, under the sanitizers).
//
//  `NitroUiScrollShadow.hpp` is the shadow node that uses it; RN's own graphics headers, which
//  that node needs, pull in vendored `folly` and cannot be compiled here. What can is the
//  reading of the number itself, which is exactly the piece with a choice in it: the prop is
//  `number | null` (`nuiContentOffsetY`, D45 item 3), so a shadow tree that has not been told
//  yet, a `null` from an app that clears the prop, and a non-finite number from a broken
//  layout all have to arrive at the same "no correction".
//
//  The shape rule is the one `NitroUiIntrinsic.hpp` applies to `nuiSizingId`: read whichever
//  arithmetic member the variant has, so the patch does not depend on nitrogen's variant order.
//

#pragma once

#include <cmath>
#include <optional>
#include <type_traits>
#include <variant>

namespace margelo::nitro::nitroui::detail {

  inline double scrollOffsetOf(double value) {
    return std::isfinite(value) ? value : 0.0;
  }

  template <typename... TArgs>
  inline double scrollOffsetOf(const std::variant<TArgs...>& value) {
    double offset = 0.0;
    std::visit([&offset](const auto& member) {
      using Type = std::remove_cvref_t<decltype(member)>;
      if constexpr (std::is_arithmetic_v<Type>) {
        offset = scrollOffsetOf(static_cast<double>(member));
      }
    }, value);
    return offset;
  }

  /// An optional prop (`nuiContentOffsetY?: number`) generates an `optional`, and nitrogen
  /// has moved a nullable union between "variant" and "optional of variant" between
  /// versions. Without this the reader would fail to compile rather than be wrong, which is
  /// loud enough -- but the same shape rule covers it for free, and an absent optional is a
  /// "not told yet" exactly like a `null` is.
  template <typename TValue>
  inline double scrollOffsetOf(const std::optional<TValue>& value) {
    return value.has_value() ? scrollOffsetOf(*value) : 0.0;
  }

} // namespace margelo::nitro::nitroui::detail
