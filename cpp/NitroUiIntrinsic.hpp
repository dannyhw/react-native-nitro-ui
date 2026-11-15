// The Fabric half of intrinsic sizing: the state, shadow node and component descriptor that
// `scripts/patch-nitrogen.mjs` swaps in for the generated ones.

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

  // Not every translation unit that includes this header already has it.
  using namespace facebook;

  using react::EventQueue;
  using react::LayoutConstraints;
  using react::LayoutContext;
  using react::ShadowNode;
  using react::ShadowNodeFragment;
  using react::Size;
  using react::State;

  // MARK: - State

  /// Nitro's props carrier plus the size native measured for one configuration.
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

    /// Default-constructed means "never measured" (`measured.valid() == false`).
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

    // A pure C++ lookup. It must never call into SwiftUI or Compose, or block: a sync hop to
    // main from a layout pass running under the commit lock deadlocks.
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
     * Re-measure when the configuration or the pushed size changed, not on every props
     * update: the default returns `true`, which throws away Yoga's cached measurement.
     *
     * An instance the engine has already corrected is the exception. React clones its own
     * revision, made before the correction, and `adopt` commits that stale state as the most
     * recent, so without a fresh measure the clone is laid out at the superseded size.
     */
    bool shouldNewRevisionDirtyMeasurement(const ShadowNode& /*sourceShadowNode*/, const ShadowNodeFragment& fragment) const override {
      if (fragment.state != nullptr) {
        // Native pushed a size into state.
        return true;
      }
      if (fragment.props == nullptr) {
        // Only an event emitter, layout metrics or children changed; Yoga
        // invalidates its own measure cache when the constraints move.
        return false;
      }
      // The source node is `*this` here, so compare the incoming props with the ones the state
      // still carries: `adopt` rebuilds the state only after this runs.
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
   * The one place that writes a measured size into Fabric state. It re-reads the most recent
   * state data inside the update callback, so a props update that raced this push is never
   * rolled back, and returns `nullptr` (no commit) when the size already matches.
   */
  template <typename TShadowNode>
  inline void pushMeasuredSize(const NitroUiStateRef& state, const NitroUiMeasuredSize& measured, bool immediate) {
    using ConcreteState = typename TShadowNode::ConcreteState;
    using StateData = typename TShadowNode::ConcreteStateData;

    // The engine stores the state type-erased from `react::State`, so cast back through it:
    // a cast straight from `const void` to the derived type is right only by accident of layout.
    const auto asState = std::static_pointer_cast<const State>(state);
    const auto concrete = std::static_pointer_cast<const ConcreteState>(asState);
    if (concrete == nullptr) {
      return;
    }
    // `measured` is captured by value: an `Asynchronous` update runs later on the JS thread,
    // after the caller has freed the vector this size lives in.
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

  /// Converts a Fabric `State` into the engine's type-erased handle.
  inline NitroUiStateRef eraseFabricState(const std::shared_ptr<const State>& state) {
    // The engine holds this only to keep the `State` alive and to hand it back to
    // `pushMeasuredSize`, which casts it back to the concrete type.
    return NitroUiStateRef{state};
  }

  // MARK: - Component descriptor

  /**
   * `nitro::ViewComponentDescriptor` that carries the measured size across the state rebuild
   * a props update causes; without that the control would jump back to its fallback size.
   * `adopt` runs on iOS too, so `bindMeasuredInstance` can read the instance id from state.
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
    /// Identical to Nitro's: reuses the caching copy constructor on the generated `Props`.
    std::shared_ptr<const react::Props> cloneProps(const react::PropsParserContext& context, const std::shared_ptr<const react::Props>& props,
                                                   react::RawProps rawProps) const override {
      rawProps.parse(this->rawPropsParser_);
      return TShadowNode::Props(context, /* & */ rawProps, props);
    }

    void adopt(react::ShadowNode& shadowNode) const override {
      Base::adopt(shadowNode);

      auto& node = static_cast<TShadowNode&>(shadowNode);
      // Start from the stable shared pointer stored by ShadowNode.
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
