// Reads a `Form`'s scroll offset prop (`nuiContentOffsetY`). Kept free of React Native headers
// so the host-side native tests can compile it.

#pragma once

#include <cmath>
#include <optional>
#include <type_traits>
#include <variant>

namespace margelo::nitro::nitroui::detail {

  // A missing value, a `null` and a non-finite number all read as 0: no correction. The variant
  // overload takes whichever arithmetic member it finds, so nitrogen's variant order does not matter.
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

  /// nitrogen has generated a nullable union both as a variant and as an optional of one.
  template <typename TValue>
  inline double scrollOffsetOf(const std::optional<TValue>& value) {
    return value.has_value() ? scrollOffsetOf(*value) : 0.0;
  }

} // namespace margelo::nitro::nitroui::detail
