// The shadow node behind a `Form`'s `measure()`: it reports how far the form's content is
// scrolled. `scripts/patch-nitrogen.mjs` swaps the generated shadow node alias for it.

#pragma once

#include "NitroUiScrollOffset.hpp"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/graphics/Transform.h>
#include <react/renderer/graphics/Vector.h>

namespace margelo::nitro::nitroui {

  // Not every translation unit that includes this header already has it.
  using namespace facebook;

  /**
   * A `ConcreteViewShadowNode` that tells its descendants they are scrolled.
   *
   * `measure` is computed from the shadow tree alone: each ancestor adds its frame origin and
   * its `getContentOriginOffset`. On iOS a `Form`'s rows are `UICollectionView` cells, which
   * scroll without React Native knowing, so the offset arrives as a prop (`nuiContentOffsetY`).
   */
  template <const char* Name, typename TProps, typename TState>
  class ScrollShadowNode final: public react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, TState> {
    using Base = react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, TState>;

   public:
    using Base::Base;

    /**
     * As in `ScrollViewShadowNode`, the offset is in this node's own coordinate space: `measure`
     * wants it transformed, and `findNodeAtPoint` (which passes `false`) wants it untransformed.
     */
    react::Point getContentOriginOffset(bool includeTransform) const override {
      const auto& props = this->getConcreteProps();
      const auto offset = detail::scrollOffsetOf(props.nuiContentOffsetY.get());
      auto point = react::Point{0.0f, static_cast<float>(-offset)};
      if (!includeTransform) {
        return point;
      }
      const auto transformed =
          this->getTransform() * react::Vector{ point.x, point.y, 0.0f, 1.0f };
      return react::Point{transformed.x, transformed.y};
    }
  };

} // namespace margelo::nitro::nitroui
