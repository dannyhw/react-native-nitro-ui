// The one place in this library that hosts SwiftUI. Every component's Hybrid View owns exactly one
// host, created with it and never replaced.

import ObjectiveC
import SwiftUI
import UIKit

private typealias NitroUiPerf = margelo.nitro.nitroui.NitroUiPerf
// Not `private`: components declare their sizing fallback through it.
typealias NitroUiSizing = margelo.nitro.nitroui.NitroUiSizing

/// Perf mark kinds, mirroring `NitroUiPerf::KIND_*`.
enum NitroUiPerfKind: Int32 {
  case propsApplied = 0
  case firstFrame = 1
  /// `onDropView` ran: an unmount, or the first step of recycling.
  case dropped = 2
  /// `prepareForRecycle` ran. A `dropped` with no `recycled` after it is a real unmount.
  case recycled = 3
}

/// `nuiPerfId` of a view that never set one.
let nitroUiPerfNoInstance: Int32 = -1

/// How a component decides its size, mirroring `NitroUiSizing::POLICY_*`.
enum NitroUiSizingPolicy: Int32 {
  /// The control's fitting size *is* its size: Switch, Button, SegmentedControl.
  case intrinsic = 0
  /// Height is intrinsic, width is Yoga's box: Slider, linear Progress.
  case fillWidth = 1
}

/// `nuiSizingId` of a view that never set one; mirrors `NitroUiSizing::NO_INSTANCE`.
let nitroUiSizingNoInstance: Int64 = 0

/// A view that is a hosted nitro-ui control rather than a container's plain content.
///
/// Nothing else tells a control apart from plain content at a touch point — React Native's own
/// views claim a touch the same way a plain `View` does — so a `Form.Row` that answers presses
/// gives its press up only to a view carrying this marker.
protocol NitroUiHostedControl: UIView {
  /// Whether a `Form.Row`'s cell owns this view's press, which makes the view the row's content
  /// and its box the row's. A control that answers its own taps does not.
  var pressOwnedByRow: Bool { get }
}

extension NitroUiHostedControl {
  var pressOwnedByRow: Bool { false }
}

/// A `UIView` that hosts one concrete SwiftUI `Content` and applies React props to it in batches.
/// The `UIHostingController` is created once in `init` and never replaced. Prop setters only write
/// the model and call `markDirty()`; `commit()` applies the batch once per `afterUpdate`.
final class NitroSwiftUIHost<Content: NitroUIContent>: UIView {
  let model: Content.Model
  private let hostingController: UIHostingController<NitroUiRoot<Content>>
  private let hostedView: UIView

  /// Set `true` by components that present something (Picker, DatePicker, Menu): they need a
  /// view-controller parent for presentation and traits.
  var needsContainment = false
  /// Set `true` by components that want `contentSize` maintained. The measure is a synchronous
  /// SwiftUI layout pass, so it runs once per bounds or trait change, not per commit; content that
  /// changes size without either calls `invalidateContentSize()`.
  var wantsContentSize = false
  /// `nuiPerfId` of the owning view, or ``nitroUiPerfNoInstance``.
  var perfInstanceId: Int32 = nitroUiPerfNoInstance
  /// `nuiSizingId` of the owning view, or `nitroUiSizingNoInstance`: the Fabric node a measured
  /// size is reported for. Reset on every recycle, so a reused host never reports into a dead
  /// instance.
  var sizingInstanceId: Int64 = nitroUiSizingNoInstance
  /// Declared by the component: whether the width comes from Yoga's box.
  var sizingPolicy: NitroUiSizingPolicy = .intrinsic

  /// Last measured content size, in points, or `nil` if never measured. Written on the main thread
  /// and read from any thread (`measureContent()` runs on the JS thread and must not call into
  /// SwiftUI), hence the lock.
  var contentSize: CGSize? {
    sizeLock.lock()
    defer { sizeLock.unlock() }
    return _contentSize
  }

  private var _contentSize: CGSize?
  private let sizeLock = NSLock()

  private var isDirty = true
  private var hasCommitted = false

  /// How many mounts of this object have ended, and how many entered Fabric's recycle pool. Never
  /// reset by `prepareForRecycle()`: they count over the object's lifetime, so a test can tell a
  /// reused instance from a fresh one.
  private(set) var lifetimeDrops = 0
  private(set) var lifetimeRecycles = 0
  private var suppressesNextAnimation = true
  private var hasMarkedFirstFrame = false
  /// Whether the hosted content needs a measure pass: after a bounds change, a size-affecting trait
  /// change, a recycle or `invalidateContentSize()`, never after a plain visual commit.
  private var contentSizeNeedsMeasure = true
  /// Set by ``noteContentSizeMayHaveChanged()``, consumed by ``commit()``.
  private var contentMayHaveChangedSize = false
  /// Whether a `model.objectWillChange.send()` is waiting for SwiftUI to render. `send()` only
  /// invalidates; the body is re-evaluated in a later update pass, so a measure in the same turn
  /// would describe the content before the change. `measureFittingSize()` applies the update first.
  /// Outside a window nothing can be laid out, so the flag survives until the next measure.
  private var contentUpdatePending = false
  /// The size the sizing engine already has from this host. Compared with an epsilon, so a
  /// sub-point wobble does not become a Fabric commit.
  private var lastReportedSize: CGSize?
  /// Whether a sizing key has arrived whose box the engine has not answered yet.
  /// Set by ``noteSizingKeyChanged()``, consumed by ``layoutSubviews()``.
  private var sizingKeyChangePending = false
  /// Set by ``holdSizingReports()``: what is measured until ``releaseSizingReports`` belongs to a
  /// configuration React has not keyed yet.
  private var sizingReportsHeld = false
  /// The size measured during a hold, which ``releaseSizingReports(heldSizeBelongsToBatch:)``
  /// either files or drops.
  private var heldContentSize: CGSize?
  private weak var containerViewController: UIViewController?

  init(model: Content.Model) {
    nitroUiAssertMainThread()
    let controller = UIHostingController(rootView: NitroUiRoot<Content>(model: model))
    guard let hosted = controller.view else {
      fatalError("nitro-ui: UIHostingController has no view")
    }
    self.model = model
    self.hostingController = controller
    self.hostedView = hosted
    super.init(frame: .zero)
    backgroundColor = .clear

    hosted.backgroundColor = .clear
    // A hosting controller must not reserve safe area for the control. `NitroUiRoot` covers systems
    // before iOS 16.4.
    if #available(iOS 16.4, *) {
      controller.safeAreaRegions = []
    }
    addSubview(hosted)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("nitro-ui: NitroSwiftUIHost cannot be built from a nib")
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    if hostedView.frame != bounds, bounds.width > 0, bounds.height > 0 {
      // Frame, not Auto Layout constraints: RN already decided our size in Yoga.
      hostedView.frame = bounds
      // A different box can produce a different fitting size for the content.
      contentSizeNeedsMeasure = true
      if sizingKeyChangePending {
        // This box is the engine's answer for the new sizing key, so the next measure must not be
        // compared with the size reported for the previous key.
        sizingKeyChangePending = false
        lastReportedSize = nil
      }
    }
    markFirstFrameIfNeeded()
    refreshContentSize()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detachFromContainer()
    } else {
      markFirstFrameIfNeeded()
      attachToContainerIfNeeded()
      // A content update committed before the host had a window could not be measured, and a
      // recycled host whose frame does not change gets no `layoutSubviews`. Measure now.
      refreshContentSize()
    }
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    // Content size category and legibility weight change the control's size.
    if previousTraitCollection?.preferredContentSizeCategory
      != traitCollection.preferredContentSizeCategory
      || previousTraitCollection?.legibilityWeight != traitCollection.legibilityWeight {
      // Every cached size was measured under the old environment. This fires once per mounted view
      // for one Dynamic Type change; the engine dedupes by signature.
      NitroUiSizing.invalidateEnvironmentIfChanged(environmentSignature)
      invalidateContentSize()
    }
  }

  // MARK: - Updating

  func markDirty() {
    isDirty = true
  }

  /// Apply the batch. Called once, from `afterUpdate()`. Components only `markDirty()` when
  /// something rendered changed, so bookkeeping props cost no re-render.
  func commit() {
    nitroUiAssertMainThread()
    let visual = isDirty
    isDirty = false
    mark(.propsApplied)
    guard visual else {
      return
    }
    // First mount and the first commit after a recycle must not animate, so a
    // recycled Toggle does not slide from the previous row's value.
    let disableAnimations = !hasCommitted || suppressesNextAnimation
    suppressesNextAnimation = false
    hasCommitted = true

    if disableAnimations {
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        model.objectWillChange.send()
      }
    } else {
      model.objectWillChange.send()
    }
    contentUpdatePending = true

    // A commit usually changes pixels, not size, and `sizeThatFits` is a synchronous SwiftUI
    // layout, so only the first commit or a flagged one measures.
    if contentSize == nil || contentMayHaveChangedSize {
      contentMayHaveChangedSize = false
      contentSizeNeedsMeasure = true
    }
    refreshContentSize()
  }

  /// Flag that the content may now be a different size where no bounds or trait change would
  /// notice. The measure happens once, in `commit()`.
  func noteContentSizeMayHaveChanged() {
    nitroUiAssertMainThread()
    contentMayHaveChangedSize = true
  }

  /// Forget the size the engine already has from this host, so the next measure is reported even
  /// when it matches the last one. A new sizing key is laid out at the declared fallback until this
  /// instance reports, and the epsilon would otherwise skip a report equal to the old key's size.
  /// The reset waits for the `layoutSubviews` that carries the new box.
  func noteSizingKeyChanged() {
    nitroUiAssertMainThread()
    guard contentSize != nil else { return }
    sizingKeyChangePending = true
  }

  /// Stop filing size reports, for a change to the content that React has not keyed yet. Call it
  /// where native changes the content itself — a Picker's pick — whose width then follows before
  /// React has sent the sizing key naming it: the engine files a report under the key of its last
  /// layout, which is the one this change just left.
  ///
  /// Nothing measures here, because a control's content changes inside its own layout pass and
  /// `sizeThatFits` in one re-enters it. The measure that follows applies this content update
  /// first, as it does after a ``commit()``.
  func holdSizingReports() {
    nitroUiAssertMainThread()
    sizingReportsHeld = true
    heldContentSize = nil
    contentSizeNeedsMeasure = true
    contentUpdatePending = true
  }

  /// End the hold, from `afterUpdate()` once the batch's setters have run. Files the size measured
  /// during the hold only when `heldSizeBelongsToBatch` says that batch keys the content the hold
  /// was armed for; a batch that has not seen the change keys what the change replaced, and its
  /// size is dropped rather than waited for. The size is filed as measured, not taken again: the
  /// batch's own ``commit()`` has not applied its props yet, so a measure here answers for the
  /// content before them.
  func releaseSizingReports(heldSizeBelongsToBatch: Bool) {
    nitroUiAssertMainThread()
    guard sizingReportsHeld else { return }
    sizingReportsHeld = false
    let held = heldContentSize
    heldContentSize = nil
    guard heldSizeBelongsToBatch, let held else { return }
    // The dedupe below holds the size filed for the previous configuration; an equal size filed
    // for a new one must still reach the engine.
    lastReportedSize = nil
    reportToSizingEngine(held)
  }

  /// Reset for reuse. Keeps the hosting controller and its SwiftUI state.
  func prepareForRecycle() {
    nitroUiAssertMainThread()
    lifetimeRecycles += 1
    mark(.recycled)
    isDirty = true
    suppressesNextAnimation = true
    contentSizeNeedsMeasure = true
    contentUpdatePending = false
    sizingReportsHeld = false
    heldContentSize = nil
    // Until this host is measured again, `measureContent()` must answer "never measured" rather
    // than the previous mount's size.
    sizeLock.lock()
    _contentSize = nil
    sizeLock.unlock()
    // Otherwise a recycled host would never report `firstFrame` again.
    hasMarkedFirstFrame = false
    releaseSizingInstance()
    detachFromContainer()
  }

  func lifetimeReport() -> String {
    return "drops=\(lifetimeDrops) recycles=\(lifetimeRecycles)"
  }

  /// Tear down what must not outlive a mount. The generated component view calls `onDropView`
  /// before `prepareForRecycle` as well as on a real unmount, so this must not destroy the hosting
  /// controller.
  func drop() {
    nitroUiAssertMainThread()
    lifetimeDrops += 1
    mark(.dropped)
    detachFromContainer()
    hasMarkedFirstFrame = false
    releaseSizingInstance()
    sizeLock.lock()
    _contentSize = nil
    sizeLock.unlock()
    contentSizeNeedsMeasure = true
    contentUpdatePending = false
    sizingKeyChangePending = false
    sizingReportsHeld = false
    heldContentSize = nil
  }

  /// Tell the sizing engine this instance is finished, then forget its id. Without it the engine
  /// keeps an entry for every mount ever made. Idempotent.
  private func releaseSizingInstance() {
    let instanceId = sizingInstanceId
    sizingInstanceId = nitroUiSizingNoInstance
    lastReportedSize = nil
    if instanceId != nitroUiSizingNoInstance {
      NitroUiSizing.forget(instanceId)
    }
  }

  // MARK: - Measuring

  /// Throw away the cached `contentSize` and measure again now. For content that changed size with
  /// no bounds or trait change, such as a Picker whose selected title got longer.
  func invalidateContentSize() {
    nitroUiAssertMainThread()
    contentSizeNeedsMeasure = true
    refreshContentSize()
  }

  @discardableResult
  private func refreshContentSize() -> CGSize? {
    // An intrinsic control's fitting size does not depend on the box, so it is measured in the
    // first `commit()`. Waiting for `layoutSubviews` would be inside Core Animation's commit, after
    // the sizing flush, and the first frame would draw at the fallback.
    let boundsIndependent = sizingPolicy == .intrinsic
    // A `fillWidth` measure needs the box's width but must not wait for a height: a cold first
    // instance is laid out 0 tall, and this measure's report is what gives it a height.
    guard wantsContentSize, hasCommitted, boundsIndependent || bounds.width > 0, contentSizeNeedsMeasure else {
      // The hot path: three bools, no SwiftUI.
      return contentSize
    }
    if contentUpdatePending, hostedView.window == nil {
      // The content just changed and cannot be laid out outside a window, so a measure now would
      // describe the old content. Keep it pending for the first `layoutSubviews` in a window.
      return contentSize
    }
    contentSizeNeedsMeasure = false
    let size = measureFittingSize()
    sizeLock.lock()
    _contentSize = size
    sizeLock.unlock()
    if sizingReportsHeld {
      heldContentSize = size
    } else {
      reportToSizingEngine(size)
    }
    return size
  }

  /// Hand the measured size to the sizing engine, which drops a report that agrees with its cache.
  /// The epsilon here only skips the call.
  private func reportToSizingEngine(_ size: CGSize) {
    guard sizingInstanceId != nitroUiSizingNoInstance else {
      return
    }
    if let last = lastReportedSize,
      abs(last.width - size.width) < 0.5,
      abs(last.height - size.height) < 0.5
    {
      return
    }
    lastReportedSize = size
    NitroUiSizing.report(sizingInstanceId, Double(size.width), Double(size.height), sizingPolicy.rawValue)
  }

  /// What can change a control's size on iOS, as one string: Dynamic Type and legibility weight.
  private var environmentSignature: String {
    "\(traitCollection.preferredContentSizeCategory.rawValue),\(traitCollection.legibilityWeight.rawValue)"
  }

  private func measureFittingSize() -> CGSize {
    // After a commit the `send()` may not have rendered yet. Laying the hosted view out makes
    // SwiftUI apply the update, so the size measured is the new content's.
    if contentUpdatePending {
      contentUpdatePending = false
      hostedView.layoutIfNeeded()
    }
    if #available(iOS 16.0, *) {
      let proposal = fittingSizeProposal
      let size = hostingController.sizeThatFits(in: proposal)
      if size.width > 0, size.height > 0 {
        if sizingPolicy == .fillWidth {
          // A `fillWidth` control's width is the box, so report the proposed width, not what
          // SwiftUI settled on inside it.
          return CGSize(width: proposal.width, height: size.height)
        }
        return size
      }
    }
    // iOS 15, or content that refused the proposal. A `fillWidth` width from here is unused: the
    // shadow node replaces it with the box's width.
    return hostedView.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
  }

  /// The size proposal for `measureFittingSize()`. `intrinsic` asks what the control wants
  /// unbounded. `fillWidth` asks at the width it was given: proposed an unbounded width, a Slider
  /// reports a preferred width nobody asked for and the height that width implies. Height is
  /// unbounded for both.
  private var fittingSizeProposal: CGSize {
    switch sizingPolicy {
    case .intrinsic:
      return CGSize(width: CGFloat.infinity, height: CGFloat.infinity)
    case .fillWidth:
      return CGSize(width: bounds.width, height: CGFloat.infinity)
    }
  }

  // MARK: - Perf

  private func markFirstFrameIfNeeded() {
    guard !hasMarkedFirstFrame, !bounds.isEmpty, window != nil else {
      return
    }
    hasMarkedFirstFrame = true
    mark(.firstFrame)
    // Record the drawn box for the sizing trace on the next main-queue turn, after UIKit has
    // committed this turn's layer changes: `bounds` read mid-layout may not be committed yet.
    let instanceId = sizingInstanceId
    if instanceId != nitroUiSizingNoInstance {
      DispatchQueue.main.async { [weak self] in
        guard let self, self.window != nil else {
          return
        }
        NitroUiSizing.recordDrawnSize(instanceId, Double(self.bounds.width), Double(self.bounds.height))
      }
    }
  }

  private func mark(_ kind: NitroUiPerfKind) {
    // A view without `nuiPerfId` records nothing, and skips the C++ call.
    guard perfInstanceId >= 0 else {
      return
    }
    NitroUiPerf.mark(perfInstanceId, kind.rawValue)
  }

  // MARK: - View controller containment

  private func attachToContainerIfNeeded() {
    guard needsContainment, containerViewController == nil else {
      return
    }
    guard let parent = findContainerViewController() else {
      return
    }
    parent.addChild(hostingController)
    hostingController.didMove(toParent: parent)
    containerViewController = parent
  }

  private func detachFromContainer() {
    guard let parent = containerViewController else {
      return
    }
    hostingController.willMove(toParent: nil)
    hostingController.removeFromParent()
    containerViewController = nil
  }

  /// The view controller this host is contained in, or `nil` without `needsContainment`. Read it at
  /// present time: containment follows the view in and out of a window.
  var containingViewController: UIViewController? {
    containerViewController
  }

  /// Walk the responder chain for the nearest usable view controller. Navigation and tab
  /// controllers are skipped because they cannot host a presentation cleanly.
  private func findContainerViewController() -> UIViewController? {
    var responder: UIResponder? = next
    while let current = responder {
      if let controller = current as? UIViewController {
        if !(controller is UINavigationController) && !(controller is UITabBarController) {
          return controller
        }
      }
      responder = current.next
    }
    return nil
  }
}

extension NitroSwiftUIHost: NitroUiHostedControl {
  var pressOwnedByRow: Bool { model.pressOwnedByRow }
}
