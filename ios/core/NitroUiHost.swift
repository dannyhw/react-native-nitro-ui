//
//  NitroUiHost.swift
//  react-native-nitro-ui
//
//  The iOS `<Host>` (T17 spike): one hosting controller that renders every
//  nitro-ui control placed directly inside it, instead of one per control. The
//  iOS counterpart of `NitroUiHostView` on branch `task/T16-host-spike`, and the
//  same shape `@expo/ui`'s iOS `HostView` has.
//
//  The other half lives in `NitroSwiftUIHost`: a control decides for itself
//  whether the Host composes it, and builds no hosting controller at all when it
//  does. That is where the memory and the mount time are actually saved.
//

import Combine
import SwiftUI
import UIKit

/// One composed child of a ``NitroUiHostContainerView``: its SwiftUI content, and
/// the box React Native gave it.
fileprivate struct NitroUiHostedEntry: Identifiable {
  let id: ObjectIdentifier
  let content: AnyView
  /// The child's Yoga box, in the container's own coordinates.
  let frame: CGRect
}

/// The Host's SwiftUI state: its children, in RN's mount order.
///
/// A model rather than `@State`, because a Host's children are UIKit subviews -
/// the one thing SwiftUI cannot observe. The container writes this after every
/// change to the child set and sends ``objectWillChange`` once, which is the same
/// seam `NitroSwiftUIHost.commit()` is for a control.
fileprivate final class NitroUiHostModel: ObservableObject {
  /// Manual publisher, as in ``NitroUiModel``: one `send()` per child-set change.
  let objectWillChange = ObservableObjectPublisher()
  var entries: [NitroUiHostedEntry] = []
}

/// Root of a Host's single SwiftUI hierarchy.
fileprivate struct NitroUiHostRoot: View {
  @ObservedObject private var model: NitroUiHostModel

  fileprivate init(model: NitroUiHostModel) {
    self.model = model
  }

  var body: some View {
    // A `ZStack` with each child given **its own Yoga box**, rather than a stack
    // SwiftUI arranges: RN laid those boxes out, they are what a person was
    // already looking at, and a child that has a margin (or is absolutely
    // positioned) is otherwise drawn somewhere else than the row React Native
    // gave it. `@expo/ui`'s iOS `Host` has no equivalent - it puts the whole
    // composition in one `ZStack` and lets `FillAlignmentModifier` decide, which
    // is one of the reasons its children need explicit sizes.
    ZStack(alignment: .topLeading) {
      ForEach(model.entries) { entry in
        entry.content
          .frame(width: entry.frame.width, height: entry.frame.height)
          .position(x: entry.frame.midX, y: entry.frame.midY)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    // As in `NitroUiRoot`: RN owns the keyboard and the safe area, and a control
    // must not be inset because the Host sits under a nav bar. (Deliberately not
    // `NitroUiRoot` itself: `ignoresSafeArea` also makes a view *greedy*, which
    // here would mean every child trying to fill the Host.)
    .ignoresSafeArea(edges: .all)
  }
}

/// The view behind `<Host>`: a container that hosts **one** SwiftUI hierarchy and
/// composes its nitro-ui children into it.
///
/// RN still mounts one Fabric node and one component view per child, and each
/// child keeps its Hybrid View, its model and its prop plumbing - that is what
/// "what is still per child" means in the report. What changes is who renders it:
/// a child under a Host stops hosting SwiftUI itself and is composed here instead,
/// once, in one `UIHostingController`.
///
/// ## Who finds whom
///
/// The *child* asks, not the container. React Native mounts a component view's
/// children into the component view itself (`RCTViewComponentView`'s
/// `currentContainerView` is its own view unless a border, shadow or SwiftUI
/// filter forces a wrapper), and this view - the component view's `contentView` -
/// is mounted beside them. So this class never sees `didAddSubview` for a child it
/// is supposed to compose, and a "two hops up from the control" rule finds the
/// component view rather than this view. Instead ``NitroSwiftUIHost/resolveHosting()``
/// looks for a container among the *siblings of its own component view* and calls
/// ``host(_:shell:)``, and the child set is (re)read from the view tree - the rule
/// T16 states for Android, for the same reason: the view tree is what RN mutates,
/// and a second copy of it could only drift.
final class NitroUiHostContainerView: UIView {
  private let model: NitroUiHostModel
  /// The one hosting controller for every child. Created with the container and
  /// never replaced, which is the perf contract's rule for a hosting view
  /// (`docs/research/core-architecture.md` §2) - and here, the entire point.
  private let hostingController: UIHostingController<NitroUiHostRoot>
  /// `hostingController.view`, non-optional so layout code stays readable.
  private let hostedView: UIView
  /// The view RN mounts this Host's children into, while it has any.
  ///
  /// Usually this container's own superview (RN's component view); read from the
  /// first child that asked to be composed, because that is the only view that is
  /// guaranteed to be right on every RN version (see the class comment).
  private weak var mountRoot: UIView?
  /// The composed children, for teardown. Render order comes from `mountRoot`.
  private var hostedChildren: [NitroUiHostable] = []
  /// Whether a ``rebuildEntries()`` is already queued.
  private var rebuildPending = false
  /// The container's own bounds when the entries were last read.
  private var lastReadBounds = CGRect.zero

  init() {
    let model = NitroUiHostModel()
    let controller = UIHostingController(rootView: NitroUiHostRoot(model: model))
    guard let hosted = controller.view else {
      fatalError("nitro-ui: UIHostingController has no view")
    }
    self.model = model
    self.hostingController = controller
    self.hostedView = hosted
    super.init(frame: .zero)
    backgroundColor = .clear
    hosted.backgroundColor = .clear
    if #available(iOS 16.4, *) {
      controller.safeAreaRegions = []
    }
    addSubview(hosted)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("nitro-ui: NitroUiHostContainerView cannot be built from a nib")
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    if hostedView.frame != bounds, bounds.width > 0, bounds.height > 0 {
      // Frame, not constraints: RN decided this container's box in Yoga, and a
      // Host's box is the only box a Host lays out.
      hostedView.frame = bounds
    }
    if bounds != lastReadBounds {
      // Every child's box is relative to this one, so a Host that is measured
      // later than its children (the usual case - RN lays out a parent after its
      // children report) has to read them again.
      lastReadBounds = bounds
      scheduleRebuild()
    }
  }

  // MARK: - Adoption

  /// Compose `child`, whose RN component view is `shell`.
  ///
  /// Called by the control itself, from ``NitroSwiftUIHost/resolveHosting()``, as
  /// soon as it can see this container in its own mounting view. Idempotent: a
  /// control that already is composed is left alone, which is what makes the
  /// order of the two events (RN mounting the child, the child noticing the Host)
  /// not matter.
  func host(_ child: NitroUiHostable, shell: UIView) {
    nitroUiAssertMainThread()
    guard child.superview === shell, !child.isHosted else {
      return
    }
    mountRoot = shell.superview
    child.hostAdopt(host: self, shell: shell)
    hostedChildren.append(child)
    scheduleRebuild()
  }

  /// A child stopped being composed (recycled, unmounted, or moved out of the
  /// Host). Called by ``NitroUiHostable/hostRelease()``'s owner.
  func childDidRelease(_ child: NitroUiHostable) {
    hostedChildren.removeAll { $0 === child }
    scheduleRebuild()
  }

  /// Queue a read of the child set.
  ///
  /// Coalesced, because a batch mount asks once per child: 200 children mounting
  /// would otherwise invalidate SwiftUI 200 times in one turn, which is a cost the
  /// Host is supposed to remove rather than move.
  private func scheduleRebuild() {
    guard !rebuildPending else {
      return
    }
    rebuildPending = true
    DispatchQueue.main.async { [weak self] in
      self?.rebuildPending = false
      self?.rebuildEntries()
    }
  }

  /// Read the composed children, in mount order, from the view tree.
  private func rebuildEntries() {
    guard let mountRoot else {
      return
    }
    var entries: [NitroUiHostedEntry] = []
    entries.reserveCapacity(hostedChildren.count)
    for subview in mountRoot.subviews {
      if subview === self || subview === hostedView {
        continue
      }
      guard let child = Self.hostable(in: subview), child.isHosted else {
        continue
      }
      let box = convertShellBox(subview)
      entries.append(
        NitroUiHostedEntry(id: ObjectIdentifier(child), content: child.hostedContent, frame: box)
      )
    }
    if Self.sameEntries(entries, as: model.entries) {
      return
    }
    model.entries = entries
    model.objectWillChange.send()
  }

  /// A child's box, in this container's coordinates.
  private func convertShellBox(_ shell: UIView) -> CGRect {
    let size = shell.bounds.size
    let topLeft = shell.convert(CGPoint.zero, to: self)
    return CGRect(origin: topLeft, size: size)
  }

  /// Whether a rebuild describes the same children in the same boxes.
  ///
  /// The identity-only comparison would miss a relayout, and rebuilding SwiftUI's
  /// `ForEach` with equal-but-recreated values is exactly the invalidation this
  /// comparison is here to skip.
  private static func sameEntries(_ next: [NitroUiHostedEntry], as current: [NitroUiHostedEntry]) -> Bool {
    guard next.count == current.count else {
      return false
    }
    for (a, b) in zip(next, current) where a.id != b.id || a.frame != b.frame {
      return false
    }
    return true
  }

  /// The hosted control inside a component view that RN mounted.
  ///
  /// Two hops, exactly: the subview is the child's RN component view, and the
  /// control's host view is that view's content view. Anything deeper is not a
  /// direct child of the Host and is not composed - the same rule that makes an RN
  /// view in the middle of a Host unsupported rather than silently reordered.
  private static func hostable(in view: UIView) -> NitroUiHostable? {
    if let direct = view as? NitroUiHostable {
      return direct
    }
    for subview in view.subviews {
      if let direct = subview as? NitroUiHostable {
        return direct
      }
    }
    return nil
  }

  // MARK: - Teardown

  /// Un-compose every child, so nothing is left hidden and touch-deaf because its
  /// Host went away. Called from the Host's `onDropView`, which runs on every
  /// unmount; a child RN recycles or unmounts on its own releases itself.
  func releaseAllChildren() {
    guard !hostedChildren.isEmpty else {
      return
    }
    let children = hostedChildren
    hostedChildren = []
    for child in children {
      child.hostRelease()
    }
    if !model.entries.isEmpty {
      model.entries = []
      model.objectWillChange.send()
    }
  }
}

/// What a `<Host>` requires of a control it composes.
///
/// `NitroSwiftUIHost` is generic over the control's SwiftUI content, which the
/// Host does not need to know: content arrives as `AnyView`. This protocol is the
/// part that is not generic, so the container can hold children without knowing
/// what they render - and `isHosted` is how the container's walk of the view tree
/// tells a composed control from one that merely happens to be nearby.
protocol NitroUiHostable: UIView {
  /// The control's SwiftUI content, for the Host's hierarchy. Must be stable per
  /// instance: a new `AnyView` per read would re-render the control on every
  /// unrelated change.
  var hostedContent: AnyView { get }
  /// Whether a Host composes this control right now.
  var isHosted: Bool { get }
  /// Stop drawing and stop taking touches; the Host renders this control now.
  func hostAdopt(host: NitroUiHostContainerView, shell: UIView)
  /// Go back to being an RN view of one's own, and tell the Host it is gone.
  func hostRelease()
}

extension NitroSwiftUIHost: NitroUiHostable {}
