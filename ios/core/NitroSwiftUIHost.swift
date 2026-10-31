//
//  NitroSwiftUIHost.swift
//  react-native-nitro-ui
//
//  The one place in this library that hosts SwiftUI. Every component's Hybrid
//  View owns exactly one of these, created with it and never replaced
//  (docs/research/core-architecture.md §2).
//

import ObjectiveC
import SwiftUI
import UIKit

// Perf ring buffer, shared with C++/Kotlin (cpp/core/NitroUiPerf.hpp).
private typealias NitroUiPerf = margelo.nitro.nitroui.NitroUiPerf
// Intrinsic sizing, shared with C++/Kotlin (cpp/core/NitroUiSizing.hpp).
// Not `private`: a component needs it too, to declare its cache-miss
// fallback.
typealias NitroUiSizing = margelo.nitro.nitroui.NitroUiSizing

/// Perf mark kinds, mirroring `NitroUiPerf::KIND_*`.
enum NitroUiPerfKind: Int32 {
  case propsApplied = 0
  case firstFrame = 1
  /// `onDropView` ran: the mount is over (a real unmount, or the recycle front door).
  case dropped = 2
  /// `prepareForRecycle` ran, so the instance entered Fabric's recycle pool. A
  /// `dropped` with no `recycled` after it is a real unmount; the pair is what a
  /// gate counts to show recycling is live on this platform.
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

/// A `UIView` that hosts one concrete SwiftUI `Content` and applies React props to
/// it in batches.
///
/// Lifetime:
/// - `init` creates the `UIHostingController` once. Nothing here ever re-creates
///   it or assigns a new `rootView`, which is the perf contract's main rule.
/// - prop setters on the component only write the model and call ``markDirty()``;
///   ``commit()`` runs once per `afterUpdate` and sends `objectWillChange` once.
/// - ``prepareForRecycle()`` resets for reuse but keeps the controller - it is
///   the expensive part.
/// - ``drop()`` releases what must not outlive a mount. It runs before
///   `prepareForRecycle` too (see the generated `.mm`), so it must stay cheap and
///   reversible.
final class NitroSwiftUIHost<Content: NitroUIContent>: UIView {
  /// The component's state. Never replaced.
  let model: Content.Model
  /// The hosted controller. Never replaced, and its `rootView` is never reassigned.
  private let hostingController: UIHostingController<NitroUiRoot<Content>>
  /// `hostingController.view`, kept non-optional so layout code stays readable.
  private let hostedView: UIView

  /// Set `true` by components that present something (Picker menu, DatePicker,
  /// Menu): they need a view-controller parent for presentation and traits.
  /// Switch, Slider, Button, Progress and SegmentedControl do not.
  var needsContainment = false
  /// Set `true` by components that want ``contentSize`` maintained (T11's sizing,
  /// plus `measureContent()`). Off by default: the measure is a synchronous
  /// SwiftUI layout pass, so it runs once per bounds or trait change - not per
  /// commit. A component whose content changes size without either of those
  /// (a new selection, a shorter label) says so with ``invalidateContentSize()``.
  var wantsContentSize = false
  /// `nuiPerfId` of the owning view, or ``nitroUiPerfNoInstance``.
  var perfInstanceId: Int32 = nitroUiPerfNoInstance
  /// `nuiSizingId` of the owning view, or ``nitroUiSizingNoInstance``.
  ///
  /// The other half of ``wantsContentSize``: measuring is only useful if the
  /// result can be pushed somewhere, and this says which Fabric node it belongs
  /// to (`docs/architecture/sizing.md`). Reset on every recycle, so a reused host
  /// can never report a size into a dead instance's state.
  var sizingInstanceId: Int64 = nitroUiSizingNoInstance
  /// Declared by the component: whether the width comes from Yoga's box.
  var sizingPolicy: NitroUiSizingPolicy = .intrinsic

  /// Last measured content size, in points, or `nil` if never measured.
  ///
  /// Written on the main thread and read from any thread - a Hybrid View's
  /// `measureContent()` runs on JS, which must never call into SwiftUI
  /// (docs/research/core-architecture.md §1.4). A `CGSize?` is not read atomically
  /// on its own, so the lock is what makes that legal. It is only ever taken by
  /// components with ``wantsContentSize``: once per bounds or trait change, plus
  /// each ``invalidateContentSize()``.
  var contentSize: CGSize? {
    sizeLock.lock()
    defer { sizeLock.unlock() }
    return _contentSize
  }

  private var _contentSize: CGSize?
  private let sizeLock = NSLock()

  private var isDirty = true
  private var hasCommitted = false

  /// How many mounts of *this object* have ended, and how many entered Fabric's
  /// recycle pool.
  ///
  /// Deliberately not reset by ``prepareForRecycle()`` - that is the whole point. A
  /// per-mount flag cannot tell a reused instance from a fresh one, and "did the pool
  /// hand this exact view back" is a question about one object's lifetime. The pair a
  /// harness reads: `drops=n recycles=m` with `m >= 1` on a *second* mount is proof
  /// this object was recycled and reused, not merely that a reset ran. The Android
  /// host keeps the same two counters for the same reason.
  private(set) var lifetimeDrops = 0
  private(set) var lifetimeRecycles = 0
  private var suppressesNextAnimation = true
  private var hasMarkedFirstFrame = false
  /// Whether the hosted content needs a measure pass. Starts `true`, and becomes
  /// `true` again on a bounds change, a size-affecting trait change, a recycle, or
  /// ``invalidateContentSize()`` - never on a plain visual commit, which is what
  /// keeps `sizeThatFits` off the hot path.
  private var contentSizeNeedsMeasure = true
  /// Set by ``noteContentSizeMayHaveChanged()``, consumed by ``commit()``.
  private var contentMayHaveChangedSize = false
  /// Whether a `model.objectWillChange.send()` is waiting for SwiftUI to render.
  ///
  /// `send()` only *invalidates* SwiftUI's graph: the body is re-evaluated in
  /// SwiftUI's own update pass, which runs later. A measure taken in the same turn
  /// as the commit that caused it therefore numbers the content *before* the prop
  /// that triggered it - which is how a size-affecting prop could change the
  /// control and never change the size Yoga was told. Set by ``commit()``, consumed
  /// by ``measureFittingSize()``, which applies the update first.
  ///
  /// It survives a measure that could not apply the update: outside a window
  /// SwiftUI has nothing to lay out, so ``refreshContentSize()`` waits for the next
  /// measure point instead of caching a size that describes content which is on
  /// screen no more. A wrong number is worse than a late one - the engine treats a
  /// report as exact and stops asking.
  private var contentUpdatePending = false
  /// The size the sizing engine already has from this host. Compared with an
  /// epsilon, so a measure that wobbles by a fraction of a point does not turn
  /// into a Fabric commit (risk R12).
  private var lastReportedSize: CGSize?
  /// Whether a sizing key has arrived whose box the engine has not answered yet.
  /// Set by ``noteSizingKeyChanged()``, consumed by ``layoutSubviews()``.
  private var sizingKeyChangePending = false
  private weak var containerViewController: UIViewController?

  init(model: Content.Model) {
    nitroUiAssertMainThread()
    let controller = UIHostingController(rootView: NitroUiRoot<Content>(model: model))
    // `UIViewController.view` is optional in Swift even though a hosting
    // controller always has one; load it once and keep it non-optional.
    guard let hosted = controller.view else {
      fatalError("nitro-ui: UIHostingController has no view")
    }
    self.model = model
    self.hostingController = controller
    self.hostedView = hosted
    super.init(frame: .zero)
    backgroundColor = .clear

    hosted.backgroundColor = .clear
    // RN owns the keyboard, and a hosting controller must not reserve safe area
    // for the control; see NitroUiRoot for the pre-16.4 half of this.
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
        // This box is the engine's answer for the key that just arrived, so what the
        // content measures now describes the right configuration - and the epsilon
        // must not compare it with the size reported for the previous one. The
        // measure itself is already armed above, so all that is owed is the reset.
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
      // The other half of ``refreshContentSize()``'s rule: a content update whose
      // host was not in a window yet could not be applied when ``commit()`` asked
      // for a size, and a recycled host whose frame does not change gets no
      // `layoutSubviews` after this one. Here it has a window, so the pending
      // update can be applied and measured - and the guard in
      // ``refreshContentSize()`` costs three bools when nothing is pending.
      refreshContentSize()
    }
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    // Content size category and legibility weight change the control's size.
    if previousTraitCollection?.preferredContentSizeCategory
      != traitCollection.preferredContentSizeCategory
      || previousTraitCollection?.legibilityWeight != traitCollection.legibilityWeight {
      // Every cached size was measured under the old environment, so all of them
      // are suspect now - not just this view's (docs/architecture/sizing.md).
      // This fires once per mounted view for one Dynamic Type change, so the
      // engine decides whether the *environment* actually moved (review S2).
      NitroUiSizing.invalidateEnvironmentIfChanged(environmentSignature)
      invalidateContentSize()
    }
  }

  // MARK: - Updating

  /// Called by prop setters: record that something changed, apply nothing.
  func markDirty() {
    isDirty = true
  }

  /// Apply the batch. Called once, from `afterUpdate()`.
  ///
  /// Components are expected to only ``markDirty()`` when something *rendered*
  /// changed, so bookkeeping props (the controlled value's `js` copy and event
  /// count, the callback) cost zero re-renders on an interaction round-trip.
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

    // Not a measure point: a commit usually changes pixels, not the control's
    // size, and `sizeThatFits` on every commit is a synchronous SwiftUI layout
    // right after the invalidation (review SF5). The one commit that can be the
    // first chance we get at a size is the first one, so ask for that.
    if contentSize == nil || contentMayHaveChangedSize {
      contentMayHaveChangedSize = false
      contentSizeNeedsMeasure = true
    }
    refreshContentSize()
  }

  /// Say "what this hosts can now be a different size", without measuring yet.
  ///
  /// For a component whose props changed in a way that can move the control's
  /// size, where no bounds or trait change would notice. Like ``markDirty()``, it
  /// only sets a flag: the measure happens once, in ``commit()``.
  func noteContentSizeMayHaveChanged() {
    nitroUiAssertMainThread()
    contentMayHaveChangedSize = true
  }

  /// Forget the size the engine already has from this host, so the next measure is
  /// reported even when it matches the last one.
  ///
  /// For a component whose *configuration* changed, where the new configuration may
  /// measure the same size as the old one. The engine has no answer for a key it has
  /// not seen, so it lays the instance out at the component's declared fallback, and
  /// this instance's own report is the only thing that can move the box back. The
  /// epsilon above compares with the size last reported - which belongs to the
  /// configuration being replaced - so without this the correcting report is the one
  /// it skips and the instance stays at the fallback, control centred inside it
  /// (review F1: `filled` -> `elevated` measures the same size on iOS).
  ///
  /// Both halves wait for the `layoutSubviews` that carries the new box. The
  /// measure ``commit()`` runs happens while the engine still holds the *previous*
  /// configuration's box, and reporting into that re-arms the epsilon with the size
  /// the correcting report is going to match again - which is how the fallback stays
  /// stuck. An instance that has never measured has reported nothing, so there is
  /// nothing to reset and its own first measure covers it: that is why the first key
  /// of a mount does not arm this.
  func noteSizingKeyChanged() {
    nitroUiAssertMainThread()
    guard contentSize != nil else { return }
    sizingKeyChangePending = true
  }

  /// Reset for reuse. Keeps the hosting controller and its SwiftUI state.
  func prepareForRecycle() {
    nitroUiAssertMainThread()
    // Before any reset, and unconditionally: a recycled instance keeps its
    // `perfInstanceId` on this platform (the next mount's props set it, and the
    // wrapper always sends `nuiPerfId`), so the mark is attributable. Together with
    // `dropped` this is the pair a gate counts to show recycling really runs here.
    lifetimeRecycles += 1
    mark(.recycled)
    isDirty = true
    suppressesNextAnimation = true
    contentSizeNeedsMeasure = true
    contentUpdatePending = false
    // Drop the previous mount's size as well: until this host is measured again,
    // `measureContent()` must answer "never measured" (0x0) rather than another
    // instance's size, and the engine must not be handed a number that belongs to
    // the view this one replaced.
    sizeLock.lock()
    _contentSize = nil
    sizeLock.unlock()
    // The next mount is a new view as far as measurements go: a recycled host
    // that kept its flag would never report `firstFrame` again.
    hasMarkedFirstFrame = false
    releaseSizingInstance()
    detachFromContainer()
  }

  /// What a harness asks about (F6): what this host object has been through since it
  /// was allocated — `drops=<n> recycles=<m>`.
  ///
  /// Neither counter is cleared by ``prepareForRecycle()``; see ``lifetimeDrops`` for
  /// why that is the entire mechanism.
  func lifetimeReport() -> String {
    return "drops=\(lifetimeDrops) recycles=\(lifetimeRecycles)"
  }

  /// Tear down what must not outlive a mount.
  ///
  /// Note the generated component view calls `onDropView` before
  /// `prepareForRecycle` as well as on a real unmount, so this must not destroy
  /// the hosting controller.
  func drop() {
    nitroUiAssertMainThread()
    // See `prepareForRecycle`: the generated component view calls this before
    // `prepareForRecycle` as well as on a real unmount, so `dropped` with no
    // `recycled` after it is the unmount and the pair is the recycle.
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
  }

  /// Tell the sizing engine this instance is finished, then forget its id.
  ///
  /// The engine's per-instance maps otherwise keep an entry for every mount the
  /// process ever made, which is a leak in any list that scrolls: expiry of the
  /// Fabric `State` is not a signal the engine can wait for (review S3). Called
  /// from both teardown paths, and idempotent.
  private func releaseSizingInstance() {
    let instanceId = sizingInstanceId
    sizingInstanceId = nitroUiSizingNoInstance
    lastReportedSize = nil
    if instanceId != nitroUiSizingNoInstance {
      NitroUiSizing.forget(instanceId)
    }
  }

  // MARK: - Measuring

  /// Throw away the cached ``contentSize`` and measure again, right now.
  ///
  /// For content that changed size with no bounds or trait change to notice -
  /// a `Picker` whose selected title got longer, a label that wrapped
  /// differently. Components that never change size never call this.
  func invalidateContentSize() {
    nitroUiAssertMainThread()
    contentSizeNeedsMeasure = true
    refreshContentSize()
  }

  /// The fitting size of the hosted content, measured on the main thread.
  ///
  /// This is what gets pushed into Fabric state (see ``reportToSizingEngine``);
  /// `measureContent()` and the harness read the same cached number.
  @discardableResult
  private func refreshContentSize() -> CGSize? {
    // An *intrinsic* control's fitting size does not depend on the box at all
    // (`sizeThatFits(.infinity)`), and waiting for a non-empty `bounds` means the
    // first measure happens in `layoutSubviews` - inside Core Animation's commit,
    // after the sizing flusher - so the first frame is always drawn at the
    // fallback (review S5). Measuring in the first `commit()` instead puts the
    // report in the same turn as the mount.
    let boundsIndependent = sizingPolicy == .intrinsic
    // What a `fillWidth` measure may not run without is the box's **width**: it
    // is the half the control is not allowed to invent, and proposing 0 of it
    // asks SwiftUI about a control nobody is laying out. The *height* must not
    // gate it. A `fillWidth` control's height starts out unknown to Yoga - a
    // cold first instance is laid out at 0 tall, because the fallback a
    // component declares lives in its first view, which Fabric creates after
    // that view's shadow node was measured. Refusing to measure at height 0
    // therefore closes the loop the sizing engine exists to break: the report is
    // what turns the 0 into a height, and a measure that waits for a height can
    // never make one. (`docs/architecture/sizing.md` §5; the on-device test is
    // `answers its own height even when the box has none`, which Android
    // answered correctly from the start.)
    guard wantsContentSize, hasCommitted, boundsIndependent || bounds.width > 0, contentSizeNeedsMeasure else {
      // The hot path: three bools, no SwiftUI.
      return contentSize
    }
    if contentUpdatePending, hostedView.window == nil {
      // The content was just changed and cannot be laid out yet, so any number
      // measured now belongs to the content this one replaced. Keep the measure
      // pending: the first `layoutSubviews` after the mount is in a window, and
      // `measureFittingSize()` applies the update there.
      return contentSize
    }
    contentSizeNeedsMeasure = false
    let size = measureFittingSize()
    sizeLock.lock()
    _contentSize = size
    sizeLock.unlock()
    reportToSizingEngine(size)
    return size
  }

  /// Hand the measured size to the sizing engine, which is what decides whether
  /// it deserves a Fabric state update at all.
  ///
  /// Cheap to call: the engine drops a report that agrees with its cache, so a
  /// pre-warmed mount costs nothing. The epsilon here only skips the call.
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

  /// What this view can observe about the environment, as one short string.
  ///
  /// Dynamic Type (bold text included) is what moves a control's size, and the
  /// legibility weight can move on its own; density and locale are iOS-nonexistent
  /// concepts here, so the trait collection is the whole story.
  private var environmentSignature: String {
    "\(traitCollection.preferredContentSizeCategory.rawValue),\(traitCollection.legibilityWeight.rawValue)"
  }

  private func measureFittingSize() -> CGSize {
    // The number has to describe the content as it now is, and after a commit the
    // `send()` above may not have been rendered yet. Laying the hosted view out
    // here makes SwiftUI apply that update, so what follows is the new content's
    // fitting size rather than the previous one's. Only a commit that can move the
    // size gets this far: `refreshContentSize` returns early unless a measure is
    // pending, so this is one layout per size-affecting change - not per commit.
    if contentUpdatePending {
      contentUpdatePending = false
      hostedView.layoutIfNeeded()
    }
    if #available(iOS 16.0, *) {
      let proposal = fittingSizeProposal
      let size = hostingController.sizeThatFits(in: proposal)
      if size.width > 0, size.height > 0 {
        if sizingPolicy == .fillWidth {
          // A `fillWidth` control's width *is* the box; what it was asked for is
          // the answer, not whatever SwiftUI settled on inside it. This is the
          // same thing Android's `NitroUiMeasuredRoot` reports, because a
          // `Placeable`'s size is coerced into its (bounded) constraints.
          return CGSize(width: proposal.width, height: size.height)
        }
        return size
      }
    }
    // iOS 15, or a content view that refused the proposal. Note this answers the
    // *intrinsic* question for both policies - a `fillWidth` control reaching
    // here gets a width the shadow node overrides anyway (its `fillWidth` flag
    // replaces the width with the box's), so the only number that can be wrong
    // is a width nobody uses.
    return hostedView.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
  }

  /// The size proposal ``measureFittingSize()`` hands SwiftUI, per sizing policy.
  ///
  /// The two policies ask two different questions, and one proposal cannot ask
  /// both. `intrinsic` asks the unbounded one - what does this control want to
  /// be? - which is the only useful answer when the control's own size *is* its
  /// size (`docs/architecture/sizing.md`). `fillWidth` has to ask what the control
  /// wants to be **at the width it was given**: proposed unbounded width, a
  /// control like a Slider reports a preferred width nobody asked for, and the
  /// height a *different* width implies.
  ///
  /// The height stays unbounded for both: that is the half a `fillWidth` control
  /// still measures for itself. A caller's `width`/`height`/`flex` still wins
  /// regardless, because the shadow node clamps its answer to the layout
  /// constraints it was given (`cpp/NitroUiIntrinsic.hpp`).
  ///
  /// `bounds` is only usable here because ``refreshContentSize()`` refuses to
  /// measure a `fillWidth` host that has no width yet; the height half of
  /// `bounds` is deliberately not consulted - it is the number being measured.
  /// For `intrinsic` the proposal is never read, so a Switch keeps the exact
  /// question it always asked.
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
    // The box this turn committed, for the sizing trace: `laidOut` already says
    // what Yoga was told, so this is what makes "corrected before the frame was
    // committed" testable rather than argued. Read on the next drain of the main
    // queue, i.e. after UIKit's own `beforeWaiting` observer (order 2 000 000,
    // above the sizing flusher's 1 000 000) has committed this turn's layer
    // changes - reading `bounds` here, mid-layout, would report a box that had
    // not been committed yet. It is a sample of the committed frame, not a
    // per-frame tap: what it cannot see is a correction applied inside the same
    // turn after the commit, and `changedFlushes` covers that on Android.
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
    // A view without `nuiPerfId` records nothing - a plain int compare keeps the
    // disabled path off the C++/JNI call entirely.
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

  /// The view controller this host is contained in, once containment has happened.
  ///
  /// `nil` for every shipped control except the one that presents something: a
  /// component that opens a window of its own needs a view controller to present
  /// from, and `needsContainment` is the flag that makes this one exist. It is
  /// read at present time rather than cached because containment follows the view
  /// in and out of a window (`didMoveToWindow`), so the answer legitimately changes
  /// over an instance's life.
  var containingViewController: UIViewController? {
    containerViewController
  }

  /// Walk the responder chain for the nearest usable view controller.
  ///
  /// Deliberately no `import React`: `reactViewController()` is just this walk,
  /// and navigation/tab controllers cannot host a presentation cleanly, so they
  /// are skipped - unlike Expo, which always contains in the nearest one.
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
