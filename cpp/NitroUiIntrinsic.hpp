//
//  NitroUiIntrinsic.hpp
//  react-native-nitro-ui
//
//  The Fabric half of intrinsic sizing (docs/architecture/sizing.md; design in
//  docs/research/core-architecture.md §1.3).
//
//  `scripts/patch-nitrogen.mjs` swaps three generated aliases for these types:
//
//      using HybridXState               = nitroui::IntrinsicViewState<HybridXProps>;
//      using HybridXShadowNode          = nitroui::IntrinsicShadowNode<Name, HybridXProps>;
//      using HybridXComponentDescriptor = nitroui::IntrinsicComponentDescriptor<HybridXShadowNode>;
//
//  and adds one `bind(...)` line to the generated iOS `.mm` and Kotlin manager so
//  each mounted instance's Fabric `State` reaches the sizing engine.
//
//  The rules this file exists to enforce:
//   - `measureContent` is a pure C++ lookup - it never calls into SwiftUI or
//     Compose, and never blocks (§1.4: a sync hop to main from a layout pass
//     running under the commit lock deadlocks).
//   - the *real* size is measured on the UI thread and pushed into state by the
//     engine; this file only provides the typed push and the state to carry it.
//   - Nitro's prop parsing and its `hasSameProps` identity optimisation are kept
//     exactly as generated.
//

#pragma once

#include "NitroUiSizingEngine.hpp"
#include "core/NitroUiSizing.hpp"

#include <NitroModules/Null.hpp>
#include <NitroModules/RawPropsCompat.hpp>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/graphics/Size.h>

#include <cmath>
#include <memory>
#include <string>
#include <type_traits>
#include <variant>

namespace margelo::nitro::nitroui {

  // Not every translation unit that includes this has it (a generated file does,
  // our own JNI door does not), and this is the same thing Nitro's own headers
  // do - `react::` is a subnamespace of `facebook::`.
  using namespace facebook;

  using react::EventQueue;
  using react::LayoutConstraints;
  using react::LayoutContext;
  using react::ShadowNode;
  using react::ShadowNodeFragment;
  using react::Size;
  using react::State;

  // MARK: - State

  /**
   * Replaces `nitro::ViewPropsHolderState<TProps>`: the same props carrier
   * (Android still hands it to the generated JNI state updater, which only ever
   * calls `getProps()`), plus the size native measured for one configuration.
   */
  template <typename TProps>
  struct IntrinsicViewState final {
  public:
    IntrinsicViewState() = default;
    explicit IntrinsicViewState(std::shared_ptr<const TProps> props):
      _props(std::move(props)) {}
    IntrinsicViewState(std::shared_ptr<const TProps> props, NitroUiMeasuredSize measured):
      _props(std::move(props)), measured(measured) {}

  public:
    /// The generated Android state updater reads this; keep the name.
    [[nodiscard]]
    const std::shared_ptr<const TProps>& getProps() const {
      return _props;
    }

    /// What native pushed, and the configuration it belongs to. Default-
    /// constructed means "never measured" (`measured.valid() == false`).
    NitroUiMeasuredSize measured{};

  public:
#ifdef ANDROID
    /**
     * RN's serializable-state constructor. The incoming `folly::dynamic` is a
     * write *from Java*, and Java never has a real size to give us, so it is
     * dropped: the props and the measured size carry forward.
     */
    IntrinsicViewState(const IntrinsicViewState& previous, folly::dynamic /* data */):
      _props(previous._props), measured(previous.measured) {}

    folly::dynamic getDynamic() const {
      return folly::dynamic::object("width", measured.width)("height", measured.height);
    }

    /// Only used when RN ships state as a MapBuffer; we have nothing to put in
    /// one, and an empty buffer is what `ConcreteState` returns by default.
    react::MapBuffer getMapBuffer() const {
      return react::MapBufferBuilder::EMPTY();
    };
#endif

  private:
    std::shared_ptr<const TProps> _props;
  };

  // MARK: - Reading the sizing props

  namespace detail {

    /// A key of "" is a real configuration (the Switch's is), so the answer for
    /// "prop not provided" must be a stable object, not a dangling temporary.
    inline const std::string& noSizingKey() {
      static const std::string key{};
      return key;
    }

    /**
     * `nuiSizingId` out of whatever type nitrogen generated for it (`number`,
     * `number | null`, `number | undefined`), without assuming the variant order.
     */
    inline int64_t sizingIdOf(double value) {
      return static_cast<int64_t>(value);
    }

    template <typename... TArgs>
    inline int64_t sizingIdOf(const std::variant<TArgs...>& value) {
      int64_t identifier = NitroUiSizing::NO_INSTANCE;
      std::visit([&identifier](const auto& member) {
        using Type = std::remove_cvref_t<decltype(member)>;
        if constexpr (std::is_arithmetic_v<Type>) {
          identifier = static_cast<int64_t>(member);
        }
      },
                 value);
      return identifier;
    }

    template <typename TValue>
    inline int64_t sizingIdOf(const std::optional<TValue>& value) {
      return value.has_value() ? sizingIdOf(*value) : NitroUiSizing::NO_INSTANCE;
    }

    inline const std::string& sizingKeyOf(const std::string& value) {
      return value;
    }

    template <typename... TArgs>
    inline const std::string& sizingKeyOf(const std::variant<TArgs...>& value) {
      const std::string* key = std::get_if<std::string>(&value);
      return key != nullptr ? *key : noSizingKey();
    }

    template <typename TValue>
    inline const std::string& sizingKeyOf(const std::optional<TValue>& value) {
      return value.has_value() ? sizingKeyOf(*value) : noSizingKey();
    }

  } // namespace detail

  // MARK: - Shadow node

  /**
   * A `ConcreteViewShadowNode` that asks the sizing engine how big its hosted
   * control is, instead of being a 0x0 Yoga leaf.
   *
   * `Name` is nitrogen's `HybridXComponentName` char array, so the cache key and
   * the Fabric component name are the same string by construction.
   */
  template <const char* Name, typename TProps>
  class IntrinsicShadowNode final: public react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, IntrinsicViewState<TProps>> {
    using Base = react::ConcreteViewShadowNode<Name, TProps, react::ViewEventEmitter, IntrinsicViewState<TProps>>;

   public:
    using Base::Base;

    /// The props this node was generated for.
    using ConcreteProps = TProps;

    /// The descriptor registers the sizing binding under this name.
    static constexpr const char* SizingComponentName = Name;

    static react::ShadowNodeTraits BaseTraits() {
      auto traits = Base::BaseTraits();
      // The pair RN's own Switch uses: a leaf (our children are SwiftUI/Compose's
      // business, not Yoga's) that can answer for its own content size.
      traits.set(react::ShadowNodeTraits::Trait::LeafYogaNode);
      traits.set(react::ShadowNodeTraits::Trait::MeasurableYogaNode);
      return traits;
    }

    // MARK: LayoutableShadowNode

    Size measureContent(const LayoutContext& /* layoutContext */, const LayoutConstraints& layoutConstraints) const override {
      const auto& props = this->getConcreteProps();
      NitroUiMeasuredSize measured = NitroUiSizingEngine::shared().measure(Name,
                                                                           detail::sizingIdOf(props.nuiSizingId.get()),
                                                                           detail::sizingKeyOf(props.nuiSizingKey.get()),
                                                                           this->getStateData().measured);

      Size size{measured.width, measured.height};
      if ((measured.flags & NitroUiSizingEngine::kFlagFillWidth) != 0 && std::isfinite(layoutConstraints.maximumSize.width)) {
        // A Slider's height is intrinsic and its width is the box's.
        size.width = layoutConstraints.maximumSize.width;
      }
      return layoutConstraints.clamp(size);
    }

   protected:
    /**
     * Re-measure when the configuration or the pushed size changed, and not when
     * a Switch was merely toggled. Without this, every props update would dirty
     * Yoga's measurement of every instance (`YogaLayoutableShadowNode` returns
     * `true` by default) and throw away the cached answer.
     *
     * One prop turn is exempt: an instance the engine has already corrected
     * (FIX2, review S1 against `requiresFreshMeasure`). Yoga keeps every answer it
     * was ever given for a node it was never dirtied for, so the answer from
     * before a correction is still a live entry in the cloned node's measurement
     * cache - `canUseCachedMeasurement` will reuse a `MaxContent` answer of 40x20
     * for a later `FitContent` question about a control that is 61x28 - and a
     * clean clone is then laid out at the superseded size with `measureContent`
     * never reached to notice. Trusting the cache there is what put a controlled
     * Switch's `Toggle` outside the window (T15 Finding 1).
     */
    bool shouldNewRevisionDirtyMeasurement(const ShadowNode& /*sourceShadowNode*/, const ShadowNodeFragment& fragment) const override {
      if (fragment.state != nullptr) {
        // Native pushed a size into state - that is the whole point.
        return true;
      }
      if (fragment.props == nullptr) {
        // Only an event emitter, layout metrics or children changed; Yoga
        // invalidates its own measure cache when the constraints move.
        return false;
      }
      /**
       * `YogaLayoutableShadowNode::completeClone` passes `*this` as the source
       * node, so the node cannot be compared with itself (review S1). What is
       * different is `fragment.props` versus the props the *state* still carries:
       * `adopt` - which rebuilds the state from the new props - runs after this, so
       * the state is still the previous one here.
       */
      // `StateData::getProps()` is typed as the base `Props`, so it needs the same
      // narrowing cast nitrogen's own generated state updater uses: the state of
      // this node always carries this component's props.
      const auto previous = std::static_pointer_cast<const ConcreteProps>(
          this->getStateData().getProps());
      const auto incoming =
          std::static_pointer_cast<const ConcreteProps>(fragment.props);
      if (previous == nullptr || incoming == nullptr) {
        return true;
      }
      const int64_t instanceId = detail::sizingIdOf(incoming->nuiSizingId.get());
      const bool newConfiguration = instanceId != detail::sizingIdOf(previous->nuiSizingId.get()) ||
          detail::sizingKeyOf(incoming->nuiSizingKey.get()) != detail::sizingKeyOf(previous->nuiSizingKey.get());
      return newConfiguration || NitroUiSizingEngine::shared().requiresFreshMeasure(instanceId);
    }
  };

  // MARK: - Push

  /**
   * The one place that writes a measured size into Fabric state.
   *
   * It re-reads the *most recent* state data inside the update callback, so a
   * props update that raced this push is never rolled back (R9), and returns
   * `nullptr` - cancelling the commit entirely - when the size already matches.
   */
  template <typename TShadowNode>
  inline void pushMeasuredSize(const NitroUiStateRef& state, const NitroUiMeasuredSize& measured, bool immediate) {
    using ConcreteState = typename TShadowNode::ConcreteState;
    using StateData = typename TShadowNode::ConcreteStateData;

    // Narrow through `react::State`, which is what the engine was handed: it
    // stores the state type-erased, so a `static_pointer_cast` straight from
    // `const void` to the derived type would only work by accident of the base
    // class layout (review N1).
    const auto asState = std::static_pointer_cast<const State>(state);
    const auto concrete = std::static_pointer_cast<const ConcreteState>(asState);
    if (concrete == nullptr) {
      return;
    }
    /**
     * `measured` is captured **by value**.
     *
     * RN documents the callback as able to run "from any thread any moment later"
     * (`ConcreteState.h`), and for `Asynchronous` it *always* does: it runs on the
     * JS thread after the sizing engine's `applyReports` has returned and freed the
     * vector this size lives in. A `[&measured]` capture is a use-after-free on
     * every correction past the immediate budget - 198 of 200 in a cold batch -
     * that ASan sees and production only sometimes does (review B1).
     */
    concrete->updateState(
        [measured](const StateData& oldData) -> react::StateData::Shared {
          if (oldData.measured.nearlyEquals(measured)) {
            // Nothing to correct: no commit, no re-layout.
            return nullptr;
          }
          // Keep the props that the most recent state carries, not the ones this
          // push was built from.
          return std::make_shared<const StateData>(oldData.getProps(), measured);
        },
        immediate ? EventQueue::UpdateMode::unstable_Immediate : EventQueue::UpdateMode::Asynchronous);
  }

  /**
   * Reads `nuiSizingId` out of a concrete state and registers that instance with
   * the engine, so a size measured on the UI thread can find its way back here.
   */
  template <typename TShadowNode>
  inline void bindMeasuredInstance(const NitroUiStateRef& state) {
    using ConcreteState = typename TShadowNode::ConcreteState;
    using Props = typename TShadowNode::ConcreteProps;

    const auto asState = std::static_pointer_cast<const State>(state);
    const auto concrete = std::static_pointer_cast<const ConcreteState>(asState);
    if (concrete == nullptr) {
      return;
    }
    const std::shared_ptr<const Props>& props = concrete->getData().getProps();
    if (props == nullptr) {
      // Adopt has not run for this node yet (a node created without props).
      return;
    }
    const int64_t instanceId = detail::sizingIdOf(props->nuiSizingId.get());
    if (instanceId == NitroUiSizing::NO_INSTANCE) {
      return;
    }
    NitroUiSizingEngine::shared().registerInstance(instanceId,
                                                   NitroUiSizingEngine::componentHash(TShadowNode::SizingComponentName),
                                                   &pushMeasuredSize<TShadowNode>,
                                                   state);
  }

  /**
   * The one conversion the platform glue needs: a Fabric `State` into the
   * engine's type-erased handle. Used by the `bind` line
   * `scripts/patch-nitrogen.mjs` adds to the generated iOS `.mm` and to the
   * Android JNI unwrap.
   */
  inline NitroUiStateRef eraseFabricState(const std::shared_ptr<const State>& state) {
    // An implicit upcast: the engine only ever holds this to keep the `State`
    // alive and to hand the pointer back to `pushMeasuredSize`, which casts it
    // back to the concrete type.
    return NitroUiStateRef{state};
  }

  // MARK: - Component descriptor

  /**
   * `nitro::ViewComponentDescriptor` with the measured size carried across the
   * state rebuild that a props update causes, on both platforms.
   *
   * Carrying it is the whole reason this exists: without it, the size native
   * pushed would be dropped by the next props update and the control would jump
   * back to the fallback. Running `adopt` on iOS too (not just Android, where
   * Nitro needs it for prop delivery) is what lets `bindMeasuredInstance` read
   * the instance id out of state on both platforms - RN's own
   * `TextInputComponentDescriptor::adopt` does the same thing on both.
   */
  template <typename TShadowNode>
  class IntrinsicComponentDescriptor final: public react::ConcreteComponentDescriptor<TShadowNode> {
    using Base = react::ConcreteComponentDescriptor<TShadowNode>;
    using Props = typename TShadowNode::ConcreteProps;
    using StateData = typename TShadowNode::ConcreteStateData;

   public:
    explicit IntrinsicComponentDescriptor(const react::ComponentDescriptorParameters& parameters):
      Base(parameters, nitro::RawPropsCompat::makePropsParser()) {
      NitroUiSizingEngine::shared().registerComponent(TShadowNode::SizingComponentName,
                                                      NitroUiComponentBinding{
                                                          NitroUiSizingEngine::componentHash(TShadowNode::SizingComponentName),
                                                          &bindMeasuredInstance<TShadowNode>,
                                                          &pushMeasuredSize<TShadowNode>,
                                                      });
    }

   public:
    /**
     * A faster path for cloning props - identical to Nitro's, which reuses the
     * caching copy constructor on the generated `Props`.
     */
    std::shared_ptr<const react::Props> cloneProps(const react::PropsParserContext& context, const std::shared_ptr<const react::Props>& props,
                                                   react::RawProps rawProps) const override {
      rawProps.parse(this->rawPropsParser_);
      return TShadowNode::Props(context, /* & */ rawProps, props);
    }

    void adopt(react::ShadowNode& shadowNode) const override {
      Base::adopt(shadowNode);

      auto& node = static_cast<TShadowNode&>(shadowNode);
      // Start from the stable shared pointer stored by ShadowNode (the same
      // dance Nitro does, for the same reason).
      auto constBaseProps = node.getProps();
      auto constProps = std::static_pointer_cast<const Props>(constBaseProps);
      const StateData& previous = node.getStateData();
      const std::shared_ptr<const Props>& previousProps = previous.getProps();
      if (previousProps != nullptr && constProps->hasSameProps(*previousProps)) {
        // None of the props changed. Keep the existing State identity, so neither
        // Fabric nor the native view is told about an update that did not happen.
        return;
      }
      // New props: rebuild the state, carrying the measured size forward.
      StateData state{std::move(constProps), previous.measured};
      node.setStateData(std::move(state));
    }
  };

} // namespace margelo::nitro::nitroui
