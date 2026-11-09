//
//  NitroUiScrollShadow.hpp
//  react-native-nitro-ui
//
//  The shadow-node half of a `Form`'s `measure()` (D45 items 3–4).
//
//  `measure`/`measureInWindow` are a shadow-tree computation: per ancestor,
//  `LayoutableShadowNode::computeRelativeLayoutMetrics` adds that ancestor's Yoga
//  `frame.origin` and its `getContentOriginOffset(true)` — and nothing else. No platform
//  view is asked where anything ended up. React Native's own `ScrollViewShadowNode` answers
//  the scrolling half of that by overriding this one hook
//  (`ScrollViewShadowNode.cpp:67`), and a `Form` needs the same answer for a different
//  reason: on iOS its rows are drawn by `UICollectionView` cells, which move without React
//  Native knowing.
//
//  The `Form`'s JS side puts each section at the y the list gave it, so a row's Yoga origin
//  already *is* its position in the list's content; the only thing missing is how far the
//  content is scrolled, which the Form reports at every settle and passes back as
//  `nuiContentOffsetY`. That number lives in the props, so this node needs no state, no
//  descriptor and no push: the props *are* the update path, one per settle for the whole
//  Form rather than one per row.
//
//  `scripts/patch-nitrogen.mjs` swaps one generated alias for this type:
//
//      using HybridNitroUiFormShadowNode =
//          nitroui::ScrollShadowNode<HybridNitroUiFormComponentName,
//                                    HybridNitroUiFormProps,
//                                    HybridNitroUiFormState>;
//

#pragma once

#include "NitroUiScrollOffset.hpp"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/graphics/Transform.h>
#include <react/renderer/graphics/Vector.h>

namespace margelo::nitro::nitroui {

  // Not every translation unit that includes this has it (a generated file does, a native
  // test does not), and this is what Nitro's own headers do.
  using namespace facebook;

  /**
   * A `ConcreteViewShadowNode` that tells its descendants they are scrolled.
   *
   * `Name` is nitrogen's `HybridXComponentName` char array; `TState` is the state nitrogen
   * generated, which this node neither replaces nor reads — the offset is a prop.
   */
  template <const char* Name, typename TProps, typename TState>
  class ScrollShadowNode final: public react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, TState> {
    using Base = react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, TState>;

   public:
    using Base::Base;

    /**
     * The scroll correction every descendant's origin is measured against.
     *
     * `includeTransform` is honoured the way `ScrollViewShadowNode` honours it: the offset
     * is expressed in this node's own coordinate space, so a scaled ancestor must see it
     * transformed too, while `findNodeAtPoint` (which passes `false`) wants the untransformed
     * one. A `Form` is not scaled today; the difference is one multiplication, and getting it
     * wrong is a `measure` that disagrees with a hit-test.
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
