// BottomSheet: a UIKit sheet presentation (`UISheetPresentationController`) whose content is React
// Native views.

import NitroModules
import UIKit

private typealias NitroUiBottomSheetPerf = margelo.nitro.nitroui.NitroUiPerf

// MARK: - The touch root

/// React Native's `RCTSurfaceTouchHandler`, made and attached without importing React into Swift. A
/// view outside the surface's own view is outside its touch handler, so without this nothing inside
/// the sheet would become a JS touch (RN's `Modal` does the same). The class is looked up by name
/// and driven through its two public selectors.
enum NitroUiTouchRoot {
  private static let lock = NSLock()
  private static var attachedCount = 0

  /// How many touch roots are attached right now, process-wide (leak check).
  static var attached: Int {
    lock.lock()
    defer { lock.unlock() }
    return attachedCount
  }

  static func attach(to view: UIView) -> UIGestureRecognizer? {
    guard let type = NSClassFromString("RCTSurfaceTouchHandler") as? NSObject.Type,
      let handler = type.init() as? UIGestureRecognizer
    else {
      return nil
    }
    _ = handler.perform(NSSelectorFromString("attachToView:"), with: view)
    lock.lock()
    attachedCount += 1
    lock.unlock()
    return handler
  }

  static func detach(_ handler: UIGestureRecognizer, from view: UIView) {
    _ = handler.perform(NSSelectorFromString("detachFromView:"), with: view)
    lock.lock()
    attachedCount -= 1
    lock.unlock()
  }
}

/// A process-wide count: written on main, read by a test report from the JS thread, which must
/// never wait for main.
final class NitroUiSheetCount {
  private let lock = NSLock()
  private var count = 0

  var value: Int {
    lock.lock()
    defer { lock.unlock() }
    return count
  }

  func add(_ delta: Int) {
    lock.lock()
    count += delta
    lock.unlock()
  }
}

// MARK: - Views

/// The Hybrid View's own view: the React Native children's parent, which the sheet adopts while it
/// is up. The generated component view is patched to mount the children into this view rather than
/// beside it. Hidden whenever it is not in a sheet: Fabric still lays it out in the app's tree, and
/// the children must draw nowhere but in the sheet.
final class NitroUiSheetContentView: UIView {
  /// The content's size changed (a Fabric layout). Main thread.
  var onSizeChange: ((CGSize) -> Void)?
  /// The view moved to a new superview (Nitro's `setContentView:` at init).
  var onSuperviewChange: (() -> Void)?
  private var lastSize = CGSize.zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    noteSize()
  }

  override var frame: CGRect {
    didSet { noteSize() }
  }

  override var bounds: CGRect {
    didSet { noteSize() }
  }

  private func noteSize() {
    let size = bounds.size
    guard abs(size.width - lastSize.width) > 0.25 || abs(size.height - lastSize.height) > 0.25 else {
      return
    }
    lastSize = size
    onSizeChange?(size)
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    onSuperviewChange?()
  }
}

/// A `0 x 0` view left in the Fabric component view while the content is in the sheet. It says when
/// the BottomSheet's place in the app gains or loses a window, which the content view cannot say
/// once it has moved, and it is where the presenter is looked up from.
final class NitroUiSheetAnchorView: UIView {
  var onWindowChange: ((_ hasWindow: Bool) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    backgroundColor = .clear
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    onWindowChange?(window != nil)
  }
}

// MARK: - The sheet's controller

/// How one presentation is configured. Compared before it is re-applied, so a prop
/// batch that changes nothing the sheet shows does not touch UIKit.
struct NitroUiSheetConfig: Equatable {
  var detents: [NitroUiSheetDetent] = [NitroUiSheetDetent(kind: "fit", value: 0)]
  var dismissible = true
  var showsGrabber = true
  var cornerRadius: Double?
  var containerColor: UIColor?
  var label: String?
  var testID: String?

  static func == (lhs: NitroUiSheetConfig, rhs: NitroUiSheetConfig) -> Bool {
    lhs.detentsKey == rhs.detentsKey && lhs.dismissible == rhs.dismissible
      && lhs.showsGrabber == rhs.showsGrabber && lhs.cornerRadius == rhs.cornerRadius
      && lhs.containerColor == rhs.containerColor && lhs.label == rhs.label
      && lhs.testID == rhs.testID
  }

  var detentsKey: String {
    detents.map { "\($0.kind):\($0.value)" }.joined(separator: ",")
  }

  var fits: Bool {
    detents.contains { $0.kind == "fit" }
  }
}

/// The sheet: a plain controller whose view holds the React Native content view. Nothing stored on
/// it may capture it strongly: every callback goes to its owner weakly, and the owner captures the
/// sheet weakly too.
final class NitroUiSheetController: UIViewController, UISheetPresentationControllerDelegate {
  /// How many of these are alive, process-wide (leak check).
  static let alive = NitroUiSheetCount()

  /// Where the content view sits: the sheet's safe area. Fabric owns the content
  /// view's frame (its origin is always the content box's own), so the sheet moves
  /// this host instead.
  let contentHost = UIView()
  private(set) var config: NitroUiSheetConfig
  private(set) var reportedBox = CGSize.zero
  private(set) var boxReports = 0
  private var touchHandler: UIGestureRecognizer?
  /// The sheet has left, and said so (`onGone` runs once).
  private var gone = false
  /// The largest height UIKit says a detent can have here, from the last resolver call.
  private(set) var maximumDetentValue: CGFloat = 0
  /// Whether the exit under way is the user's: a swipe down or a tap outside that UIKit
  /// announced (`presentationControllerWillDismiss`) and that was not abandoned. Read by
  /// the owner when the sheet is gone - UIKit runs `viewDidDisappear` *before*
  /// `presentationControllerDidDismiss`, so the latter is too late to say who closed it.
  private(set) var dismissedByUser = false

  /// The content box changed: `(width, height)`. The JS wrapper writes it into the node's style, so
  /// Yoga lays the children out at the sheet's size.
  var onBox: ((CGSize) -> Void)?
  /// The sheet left the screen, whoever took it (a request, a swipe, a parent's
  /// dismissal). Once.
  var onGone: ((NitroUiSheetController) -> Void)?
  /// The user dragged it to another detent: its index in `config.detents`.
  var onDetent: ((Int) -> Void)?
  /// The content's height for a `fit` detent, in points; read live by its resolver.
  var fitHeight: (() -> CGFloat)?

  init(config: NitroUiSheetConfig) {
    self.config = config
    super.init(nibName: nil, bundle: nil)
    Self.alive.add(1)
    modalPresentationStyle = .pageSheet
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    if let touchHandler, isViewLoaded {
      NitroUiTouchRoot.detach(touchHandler, from: view)
    }
    Self.alive.add(-1)
  }

  override func loadView() {
    let root = UIView()
    root.backgroundColor = config.containerColor ?? .systemBackground
    root.accessibilityViewIsModal = true
    contentHost.backgroundColor = .clear
    root.addSubview(contentHost)
    view = root
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    touchHandler = NitroUiTouchRoot.attach(to: view)
    applyAppearance()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if let label = config.label {
      // The sheet is modal to VoiceOver (`accessibilityViewIsModal`); its name is spoken as the
      // screen changes to it.
      UIAccessibility.post(notification: .screenChanged, argument: label)
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // Gone, not merely covered: a full-screen presentation over the sheet also makes its view
    // disappear, and that is not an exit.
    if isBeingDismissed || presentingViewController == nil {
      noteGone()
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let insets = view.safeAreaInsets
    // The window's bottom inset as well as the view's own: mid-entry, a sheet's view reaches below
    // the window and its safe area is not yet final, so a box reported from it would change again
    // at rest.
    let bottom = max(insets.bottom, view.window?.safeAreaInsets.bottom ?? 0)
    let frame = CGRect(
      x: insets.left,
      y: insets.top,
      width: max(0, view.bounds.width - insets.left - insets.right),
      height: max(0, view.bounds.height - insets.top - bottom)
    )
    if contentHost.frame != frame {
      contentHost.frame = frame
    }
    guard !gone, !isBeingDismissed, frame.width > 0 else { return }
    let box = frame.size
    if abs(box.width - reportedBox.width) > 0.5 || abs(box.height - reportedBox.height) > 0.5 {
      reportedBox = box
      boxReports += 1
      onBox?(box)
    }
  }

  func adopt(_ content: UIView) {
    loadViewIfNeeded()
    if content.superview !== contentHost {
      contentHost.addSubview(content)
    }
    content.isHidden = false
  }

  /// Re-apply what can change while the sheet is up. Detents are re-applied only when they changed,
  /// and never on the way out: React writes every prop on every render, so a close arrives with a
  /// config write, and UIKit drops a dismissal that shares a turn with a sheet layout pass.
  func update(_ next: NitroUiSheetConfig) {
    let previous = config
    config = next
    guard isViewLoaded, next != previous, !isBeingDismissed, !gone else { return }
    view.backgroundColor = next.containerColor ?? .systemBackground
    if let sheet = sheetPresentationController {
      sheet.animateChanges {
        self.applySheet(sheet, detentsChanged: next.detentsKey != previous.detentsKey)
      }
    }
    applyAppearance()
  }

  /// Configure the sheet presentation controller. Called before presenting, after the
  /// style is set - which is when UIKit builds it.
  func configureSheet() {
    loadViewIfNeeded()
    isModalInPresentation = !config.dismissible
    guard let sheet = sheetPresentationController else { return }
    sheet.delegate = self
    applySheet(sheet, detentsChanged: true)
    // Open at the first detent. Set explicitly: UIKit would otherwise pick the smallest it can
    // resolve.
    sheet.selectedDetentIdentifier = Self.identifiers(for: config.detents).first
  }

  private func applySheet(_ sheet: UISheetPresentationController, detentsChanged: Bool) {
    isModalInPresentation = !config.dismissible
    sheet.prefersGrabberVisible = config.showsGrabber
    sheet.preferredCornerRadius = config.cornerRadius.map { CGFloat($0) }
    // Modal: the screen under the sheet is dimmed at every detent.
    sheet.largestUndimmedDetentIdentifier = nil
    sheet.prefersScrollingExpandsWhenScrolledToEdge = true
    if detentsChanged {
      sheet.detents = makeDetents()
    }
  }

  private func applyAppearance() {
    view.accessibilityLabel = config.label
    view.accessibilityIdentifier = config.testID.map { "\($0)-sheet" }
  }

  /// The content's `fit` height changed: ask UIKit to resolve the detents again.
  func invalidateFit() {
    guard config.fits, !isBeingDismissed, !gone, let sheet = sheetPresentationController else {
      return
    }
    if #available(iOS 16.0, *) {
      sheet.animateChanges {
        sheet.invalidateDetents()
      }
    }
  }

  /// Move to the detent at `index` and report it as a drag would (the test seam).
  func select(index: Int) {
    guard let sheet = sheetPresentationController else { return }
    let identifiers = Self.identifiers(for: config.detents)
    guard index >= 0, index < identifiers.count else { return }
    sheet.animateChanges {
      sheet.selectedDetentIdentifier = identifiers[index]
    }
    sheetPresentationControllerDidChangeSelectedDetentIdentifier(sheet)
  }

  /// The detent UIKit has selected, as an index into `config.detents`; `0` while UIKit
  /// has selected none (the smallest).
  var selectedIndex: Int {
    guard let identifier = sheetPresentationController?.selectedDetentIdentifier else {
      return 0
    }
    return Self.identifiers(for: config.detents).firstIndex(of: identifier) ?? 0
  }

  var sheetHeight: CGFloat {
    isViewLoaded ? view.bounds.height : 0
  }

  // MARK: Detents

  private func makeDetents() -> [UISheetPresentationController.Detent] {
    var made: [UISheetPresentationController.Detent] = []
    var seen = Set<String>()
    for (index, detent) in config.detents.enumerated() {
      let identifier = Self.identifier(for: detent, at: index)
      // iOS 15 shows every custom kind as `large`; one `large` is enough.
      guard seen.insert(identifier.rawValue).inserted else { continue }
      made.append(makeDetent(detent, identifier: identifier))
    }
    return made.isEmpty ? [.large()] : made
  }

  private func makeDetent(
    _ detent: NitroUiSheetDetent,
    identifier: UISheetPresentationController.Detent.Identifier
  ) -> UISheetPresentationController.Detent {
    switch detent.kind {
    case "medium":
      return .medium()
    case "large":
      return .large()
    default:
      guard #available(iOS 16.0, *) else { return .large() }
      let kind = detent.kind
      let value = CGFloat(detent.value)
      // `weak self`: the resolver is stored on the sheet's presentation controller,
      // which the sheet owns.
      return .custom(identifier: identifier) { [weak self] context in
        guard let self else { return context.maximumDetentValue }
        self.maximumDetentValue = context.maximumDetentValue
        switch kind {
        case "fit":
          // Read live: the content's height is Yoga's answer and may arrive after the sheet is up.
          // Only the content's height: UIKit adds its own chrome (the home-indicator inset) to a
          // custom detent.
          let height = self.fitHeight?() ?? 0
          return min(max(height, 1), context.maximumDetentValue)
        case "height":
          return min(value, context.maximumDetentValue)
        default:
          return context.maximumDetentValue * min(max(value, 0), 1)
        }
      }
    }
  }

  /// The identifier UIKit uses for each detent, in `config.detents`' order.
  static func identifiers(
    for detents: [NitroUiSheetDetent]
  ) -> [UISheetPresentationController.Detent.Identifier] {
    detents.enumerated().map { identifier(for: $1, at: $0) }
  }

  private static func identifier(
    for detent: NitroUiSheetDetent,
    at index: Int
  ) -> UISheetPresentationController.Detent.Identifier {
    switch detent.kind {
    case "medium":
      return .medium
    case "large":
      return .large
    default:
      if #available(iOS 16.0, *) {
        return UISheetPresentationController.Detent.Identifier("nitroui.detent.\(index)")
      }
      return .large
    }
  }

  // MARK: Leaving

  private func noteGone() {
    guard !gone else { return }
    gone = true
    if let touchHandler {
      // A touch root left attached would outlive the sheet.
      NitroUiTouchRoot.detach(touchHandler, from: view)
      self.touchHandler = nil
    }
    onGone?(self)
  }

  // MARK: UISheetPresentationControllerDelegate

  func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
    config.dismissible
  }

  func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
    // A swipe down or a tap outside, and nothing else: UIKit announces only a dismissal
    // the user caused. A swipe can still be abandoned halfway, so the claim is taken
    // back if the transition is cancelled.
    dismissedByUser = true
    transitionCoordinator?.animate(alongsideTransition: nil) { [weak self] context in
      if context.isCancelled { self?.dismissedByUser = false }
    }
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    // The same exit `viewDidDisappear` reports; `noteGone` runs once.
    dismissedByUser = true
    noteGone()
  }

  /// Take the sheet down as a user's dismissal would (the test seam): the same claim
  /// `presentationControllerWillDismiss` makes, then the dismissal UIKit runs.
  func dismissAsUser() {
    dismissedByUser = true
    dismiss(animated: true)
  }

  func sheetPresentationControllerDidChangeSelectedDetentIdentifier(
    _ sheetPresentationController: UISheetPresentationController
  ) {
    onDetent?(selectedIndex)
  }
}

// MARK: - The Hybrid View

final class HybridNitroUiBottomSheet: HybridNitroUiBottomSheetSpec, RecyclableView {
  static let live = NitroUiPresentationCounter()

  private let container = NitroUiSheetContentView()
  private let anchor = NitroUiSheetAnchorView()
  private let presentation = NitroUiPresentation(counter: HybridNitroUiBottomSheet.live)
  /// The Fabric component view the content view belongs to in the app's tree. Weak:
  /// it owns this object, through the generated component.
  private weak var home: UIView?

  // MARK: Props, stored raw (setters only store; `afterUpdate()` applies)

  private var config = NitroUiSheetConfig()
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var presentedChange: ((_ presented: Bool, _ eventCount: Double) -> Void)?
  private var detentChange: ((_ index: Double) -> Void)?
  private var dismissed: ((_ ended: Bool) -> Void)?
  private var contentBox: ((_ width: Double, _ height: Double) -> Void)?

  /// Whether the sheet is up, behind the event-count handshake.
  private var state = NitroUiControlledValue<Bool>(displayed: false)

  // MARK: What is on screen

  /// The sheet on screen, entering or leaving - or `nil`.
  private var sheet: NitroUiSheetController?
  /// A present is scheduled for the end of this turn (see ``schedulePresent()``).
  private var presentScheduled = false
  /// React asked for a sheet that has not been put up yet (scheduled, waiting for a
  /// window or for a busy chain).
  private var awaitingPresent = false
  /// React asked for the sheet since the wrapper was last told its content can go
  /// (``reportDismissed(ended:)``).
  private var owesDismissal = false
  /// How often the present now being asked for has waited on a busy chain. Reset per request, not
  /// per mount: otherwise a mount that met a busy chain often enough would stop presenting.
  private var presentWaits = 0
  /// How often this mount's presents waited on a busy chain, in all - diagnostics only.
  private var presentWaitsTotal = 0
  /// Whether this mount has ended (`onDropView`).
  private var dropped = false
  /// Bumped per mount, so a deferred step from a dropped mount stands down.
  private var mountGeneration = 0
  /// How many times this mount presented (test read-out).
  private var presentCount = 0
  /// What the app had presented on top when the sheet last presented.
  private var appTopClass = "-"
  /// Whether the last presentation went to a window of its own.
  private var lastOwnWindow = false
  private var lastSelected = 0
  private var userDismissals = 0
  private var unaskedExits = 0
  private var lifetimeDrops = 0
  private var lifetimeRecycles = 0

  private let reportLock = NSLock()
  private var report = ""
  /// How many reports this instance has built. A read returns the last one built and asks main for
  /// the next, so it is one behind: a test that needs fresh state reads `seq`, then waits for a
  /// larger one.
  private var reportSeq = 0

  override init() {
    super.init()
    anchor.onWindowChange = { [weak self] hasWindow in
      self?.windowChanged(hasWindow)
    }
    container.onSuperviewChange = { [weak self] in
      self?.contentMoved()
    }
    container.onSizeChange = { [weak self] _ in
      self?.contentResized()
    }
    publishReport()
  }

  var view: UIView {
    return container
  }

  // MARK: - Props

  var presented: Bool {
    get { state.js ?? false }
    set { state.js = newValue }
  }

  var mostRecentEventCount: Double {
    get { Double(state.jsEvents) }
    set { state.jsEvents = Int(newValue) }
  }

  var detents: [NitroUiSheetDetent] {
    get { config.detents }
    set { config.detents = newValue.isEmpty ? [NitroUiSheetDetent(kind: "fit", value: 0)] : newValue }
  }

  var dismissible: Bool {
    get { config.dismissible }
    set { config.dismissible = newValue }
  }

  var showsGrabber: Bool {
    get { config.showsGrabber }
    set { config.showsGrabber = newValue }
  }

  var cornerRadius: Variant_NullType_Double {
    get { config.cornerRadius.map { .second($0) } ?? .first(.null) }
    set { config.cornerRadius = newValue.asType(Double.self) }
  }

  var containerColor: Variant_NullType_Double {
    get { config.containerColor.map { .second($0.nitroUiARGBValue) } ?? .first(.null) }
    set { config.containerColor = newValue.asType(Double.self).flatMap(UIColor.init(nitroUiARGB:)) }
  }

  var label: Variant_NullType_String {
    get { config.label.map { .second($0) } ?? .first(.null) }
    set { config.label = newValue.asType(String.self) }
  }

  var testID: Variant_NullType_String {
    get { config.testID.map { .second($0) } ?? .first(.null) }
    set { config.testID = newValue.asType(String.self) }
  }

  var nuiPerfId: Variant_NullType_Double {
    get { perfInstanceId >= 0 ? .second(Double(perfInstanceId)) : .first(.null) }
    set { perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
  }

  var onPresentedChange: ((_ presented: Bool, _ eventCount: Double) -> Void)? {
    get { presentedChange }
    set { presentedChange = newValue }
  }

  var onDetentChange: ((_ index: Double) -> Void)? {
    get { detentChange }
    set { detentChange = newValue }
  }

  var onDismissed: ((_ ended: Bool) -> Void)? {
    get { dismissed }
    set { dismissed = newValue }
  }

  var onContentBox: ((_ width: Double, _ height: Double) -> Void)? {
    get { contentBox }
    set { contentBox = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    mark(.propsApplied)
    // The handshake decides whether React's `presented` wins, including a dismissal JS refused,
    // which presents again.
    _ = state.reconcile()
    if let sheet, sheetIsUp(sheet), state.displayed {
      sheet.update(config)
    }
    sync()
    publishReport()
  }

  func prepareForRecycle() {
    lifetimeRecycles += 1
    mark(.recycled)
    // First, before the props reset: an open sheet belongs to the *previous* mount.
    teardown()
    state = NitroUiControlledValue<Bool>(displayed: false)
    config = NitroUiSheetConfig()
    presentedChange = nil
    detentChange = nil
    dismissed = nil
    contentBox = nil
    presentCount = 0
    presentWaits = 0
    presentWaitsTotal = 0
    appTopClass = "-"
    lastOwnWindow = false
    lastSelected = 0
    userDismissals = 0
    unaskedExits = 0
    perfInstanceId = nitroUiPerfNoInstance
    // The next mount starts live: `dropped` belonged to the mount that just ended.
    dropped = false
    publishReport()
  }

  func onDropView() {
    lifetimeDrops += 1
    mark(.dropped)
    dropped = true
    // A presentation must not outlive the mount that opened it. Callbacks go first, so
    // nothing this teardown causes can reach JS for a mount React has finished with.
    presentedChange = nil
    detentChange = nil
    dismissed = nil
    contentBox = nil
    teardown()
    publishReport()
  }

  /// Close whatever this mount has up, without animation, and take the content back.
  private func teardown() {
    mountGeneration += 1
    presentScheduled = false
    awaitingPresent = false
    owesDismissal = false
    state.displayed = false
    if let sheet {
      detach(sheet)
      if presentation.controller === sheet {
        presentation.dismissForTeardown()
        // The dismissal holds the controller itself; the pooled view must not.
        presentation.forgetController()
      }
    }
    sheet = nil
    restoreContent()
  }

  private func detach(_ sheet: NitroUiSheetController) {
    sheet.onBox = nil
    sheet.onGone = nil
    sheet.onDetent = nil
    sheet.fitHeight = nil
  }

  // MARK: - Where the content lives

  /// The content view moved. The first time it lands in something that is not a sheet
  /// - Nitro's component view, at init - that is its home in the app's tree, and the
  /// anchor goes there too.
  private func contentMoved() {
    guard let superview = container.superview else { return }
    if home == nil, !(superview.next is NitroUiSheetController), !(superview.superview?.next is NitroUiSheetController) {
      home = superview
      superview.addSubview(anchor)
      anchor.frame = .zero
    }
  }

  private func restoreContent() {
    container.isHidden = true
    guard let home, container.superview !== home else { return }
    home.insertSubview(container, at: 0)
  }

  private func contentResized() {
    guard let sheet, config.fits else { return }
    sheet.invalidateFit()
    publishReport()
  }

  // MARK: - Presenting

  /// Whether `sheet` is on screen (or on its way) and not leaving.
  private func sheetIsUp(_ sheet: NitroUiSheetController) -> Bool {
    sheet.presentingViewController != nil && !sheet.isBeingDismissed
  }

  /// Make the screen match `state.displayed`.
  private func sync() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      if state.displayed {
        owesDismissal = true
        if let sheet {
          if sheetIsUp(sheet) {
            // Wanted and up. A JS `false` then `true` inside the entry transition left
            // a dismissal waiting for its completion; the newer write wins.
            presentation.cancelPendingDismissal()
          }
          // Leaving: the next sheet presents once this one is gone (`sheetGone`).
          return
        }
        if !awaitingPresent {
          awaitingPresent = true
          presentWaits = 0
        }
        schedulePresent()
      } else {
        presentScheduled = false
        if let sheet, sheetIsUp(sheet) {
          // React asked for it to close: animated, and no event - it was not a native
          // interaction.
          presentation.dismissAnimated()
        } else if sheet == nil, owesDismissal {
          // Withdrawn with nothing on screen: never shown yet, or already gone while
          // React still said `true`.
          awaitingPresent = false
          reportDismissed(ended: false)
        }
      }
    }
  }

  /// Present at the end of this turn. `afterUpdate` runs inside Fabric's mount transaction, before
  /// the layout of the content mounted in the same commit is applied. One turn later the content
  /// view has its real size, so a `fit` sheet's first resolve is its real height.
  private func schedulePresent() {
    guard !presentScheduled else { return }
    presentScheduled = true
    let generation = mountGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self, self.mountGeneration == generation, self.presentScheduled else { return }
      self.presentScheduled = false
      MainActor.assumeIsolated {
        self.presentIfPossible()
      }
    }
  }

  @MainActor
  private func presentIfPossible() {
    guard !dropped, state.displayed, sheet == nil else { return }
    guard let window = anchor.window else {
      // `didMoveToWindow` calls back here when the anchor gets one: a sheet presented
      // at mount opens once its place in the app is on screen.
      return
    }
    let top = NitroUiPresenterChain.appTopController(in: window)
    if let top, NitroUiPresenterChain.isBusy(top) {
      // UIKit silently refuses a presentation from a chain that is mid-transition: no error and no
      // completion. The wait is bounded, so a stuck chain ends as a sheet that never came rather
      // than a retry loop.
      presentWaits += 1
      presentWaitsTotal += 1
      guard presentWaits <= Self.presentWaitBudget else { return }
      let generation = mountGeneration
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
        guard let self, self.mountGeneration == generation else { return }
        MainActor.assumeIsolated { self.presentIfPossible() }
      }
      return
    }
    awaitingPresent = false
    let controller = NitroUiSheetController(config: config)
    controller.modalPresentationStyle = .pageSheet
    controller.configureSheet()
    wire(controller)
    controller.adopt(container)
    sheet = controller
    presentCount += 1
    appTopClass = NitroUiPresenterChain.topPresentedClass(in: window)
    // Present in the app's chain, unless an RN `Modal` is on top: RN closes a `Modal` by dismissing
    // its controller, which with a sheet on it would take the sheet and strand the Modal. Then use
    // a window of its own.
    let onShown: () -> Void = { [weak self, weak controller] in
      guard let self, let controller, controller === self.sheet else { return }
      controller.invalidateFit()
      self.publishReport()
    }
    if let top, NitroUiPresenterChain.isModalHost(top) {
      lastOwnWindow = presentation.presentInOwnWindow(
        controller, over: anchor, animated: true, onShown: onShown)
      if !lastOwnWindow {
        sheet = nil
        restoreContent()
        presentCount -= 1
      }
    } else {
      lastOwnWindow = false
      let presenter = top ?? window.rootViewController
      guard let presenter else {
        sheet = nil
        restoreContent()
        presentCount -= 1
        return
      }
      presentation.present(controller, from: presenter, animated: true, onShown: onShown)
    }
    publishReport()
  }

  private func wire(_ controller: NitroUiSheetController) {
    controller.fitHeight = { [weak self] in
      self?.container.bounds.height ?? 0
    }
    controller.onBox = { [weak self] box in
      self?.contentBox?(Double(box.width), Double(box.height))
      self?.publishReport()
    }
    controller.onDetent = { [weak self] index in
      guard let self else { return }
      self.lastSelected = index
      self.detentChange?(Double(index))
      self.publishReport()
    }
    controller.onGone = { [weak self] controller in
      self?.sheetGone(controller)
    }
  }

  // MARK: - What the user did

  /// The witness: `controller` left the screen. Brings the count down when UIKit took
  /// it down on its own, reports a close nobody else reported (a parent controller
  /// dismissed with the sheet on it), hands the content back and says the presentation
  /// is over.
  private func sheetGone(_ controller: NitroUiSheetController) {
    let asked = presentation.isDismissingOnRequest(controller)
    if !asked {
      presentation.noteClosedByUIKit(controller)
    }
    guard controller === sheet else {
      publishReport()
      return
    }
    detach(controller)
    sheet = nil
    if presentation.controller === controller {
      presentation.forgetController()
    }
    restoreContent()
    if !asked, !dropped {
      if controller.dismissedByUser {
        userDismissals += 1
      } else {
        // Nobody asked, neither the app nor a swipe: a controller under the sheet was dismissed
        // with the sheet on it.
        unaskedExits += 1
      }
      if state.displayed {
        let count = state.user(false)
        presentedChange?(false, Double(count))
      }
    }
    reportDismissed(ended: true)
    if state.displayed {
      // Wanted again before this one finished leaving (a JS `false` then `true`).
      schedulePresent()
    }
    publishReport()
  }

  /// Tell the wrapper its content can go; `ended` when a presentation really ended. The debt is
  /// taken on whenever React asks for the sheet, and settled by a presentation ending or by the
  /// first `false` that finds nothing on screen.
  private func reportDismissed(ended: Bool) {
    owesDismissal = state.displayed
    dismissed?(ended)
  }

  /// The anchor gained or lost its window. Gained: a sheet React wants up is presented now. Lost
  /// while up: one turn later (after an unmount's `onDropView`, or a reparent that puts the view
  /// straight back) the sheet is closed without animation and the close is reported.
  private func windowChanged(_ hasWindow: Bool) {
    if hasWindow {
      sync()
      publishReport()
      return
    }
    guard state.displayed || sheet != nil else { return }
    let generation = mountGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self, self.mountGeneration == generation, !self.dropped,
        self.anchor.window == nil
      else { return }
      // Report the close first, then tear down: a non-animated dismissal can finish inside
      // `dismissForTeardown`.
      if self.state.displayed {
        let count = self.state.user(false)
        self.presentedChange?(false, Double(count))
      }
      if let sheet = self.sheet, self.presentation.controller === sheet {
        self.presentation.dismissForTeardown()
      } else if self.owesDismissal {
        self.awaitingPresent = false
        self.reportDismissed(ended: false)
      }
      self.publishReport()
    }
  }

  // MARK: - Methods

  func nuiTestStateReport() throws -> String {
    // Reports are built only once a test has asked for one. Refresh on main for the next read,
    // never wait for it.
    Self.reportsWanted.add(Self.reportsWanted.value == 0 ? 1 : 0)
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  func nuiTestDismiss() throws {
    runOnMain { [weak self] in
      guard let self, let sheet = self.sheet, self.sheetIsUp(sheet), self.config.dismissible else {
        return
      }
      // What a swipe does: the sheet dismisses itself, marked as the user's dismissal.
      sheet.dismissAsUser()
    }
  }

  func nuiTestSelectDetent(index: Double) throws {
    runOnMain { [weak self] in
      guard let self, let sheet = self.sheet, self.sheetIsUp(sheet) else { return }
      sheet.select(index: Int(index))
    }
  }

  private func runOnMain(_ action: @escaping () -> Void) {
    if Thread.isMainThread {
      action()
    } else {
      DispatchQueue.main.async(execute: action)
    }
  }

  // MARK: - Report

  /// Whether a test has asked for a report. An app never does, so its sheets never pay for the walk
  /// of the app's windows and controllers below.
  static let reportsWanted = NitroUiSheetCount()

  /// How many 50 ms waits one present request may spend on a busy chain (3 s).
  static let presentWaitBudget = 60

  /// Snapshot what is on screen for ``nuiTestStateReport()``. Main thread only, and
  /// only once a report has been asked for.
  private func publishReport() {
    guard Self.reportsWanted.value > 0 else { return }
    reportSeq += 1
    var fields: [String] = ["seq=\(reportSeq)"]
    fields.append("presented=\(state.displayed ? 1 : 0)")
    fields.append("js=\(state.js == true ? 1 : 0)")
    fields.append("live=\(Self.live.value)")
    fields.append("presentCount=\(presentCount)")
    let up = sheet.map(sheetIsUp) ?? false
    fields.append("onScreen=\(up ? 1 : 0)")
    fields.append("detents=\(config.detents.map(\.kind).joined(separator: ","))")
    fields.append("selected=\(sheet?.selectedIndex ?? lastSelected)")
    fields.append("contentW=\(Int(container.bounds.width.rounded()))")
    fields.append("contentH=\(Int(container.bounds.height.rounded()))")
    fields.append("inSheet=\(container.superview?.next is NitroUiSheetController || container.superview?.superview?.next is NitroUiSheetController ? 1 : 0)")
    fields.append("hidden=\(container.isHidden ? 1 : 0)")
    fields.append("children=\(container.subviews.count)")
    if let sheet {
      fields.append("sheetH=\(Int(sheet.sheetHeight.rounded()))")
      fields.append("boxW=\(Int(sheet.reportedBox.width.rounded()))")
      fields.append("boxH=\(Int(sheet.reportedBox.height.rounded()))")
      fields.append("boxReports=\(sheet.boxReports)")
      fields.append("maxDetent=\(Int(sheet.maximumDetentValue.rounded()))")
      fields.append("grabber=\(sheet.sheetPresentationController?.prefersGrabberVisible == true ? 1 : 0)")
      fields.append("modalInPresentation=\(sheet.isModalInPresentation ? 1 : 0)")
      fields.append("label=\(sheet.isViewLoaded ? sheet.view.accessibilityLabel ?? "-" : "-")")
      fields.append("sheetId=\(sheet.isViewLoaded ? sheet.view.accessibilityIdentifier ?? "-" : "-")")
      fields.append("windowLevel=\(Int(sheet.viewIfLoaded?.window?.windowLevel.rawValue ?? -1))")
      fields.append("hit=\(Self.contentTakesHit(container) ? 1 : 0)")
    } else {
      fields.append("sheetH=0")
    }
    fields.append("ownWindow=\(lastOwnWindow ? 1 : 0)")
    fields.append("appTop=\(appTopClass)")
    fields.append("topPresented=\(NitroUiPresenterChain.topPresentedClass(in: anchor.window))")
    fields.append("modalHosts=\(NitroUiPresenterChain.modalHostCount(near: anchor.window))")
    fields.append("windows=\(HybridNitroUiDialog.visibleWindowCount(near: anchor.window))")
    fields.append("controllers=\(NitroUiSheetController.alive.value)")
    fields.append("touchRoots=\(NitroUiTouchRoot.attached)")
    fields.append("userDismissals=\(userDismissals)")
    fields.append("unasked=\(unaskedExits)")
    fields.append("presentWaits=\(presentWaits)")
    fields.append("presentWaitsTotal=\(presentWaitsTotal)")
    fields.append("anchored=\(anchor.window != nil ? 1 : 0)")
    fields.append("drops=\(lifetimeDrops)")
    fields.append("recycles=\(lifetimeRecycles)")
    let line = fields.joined(separator: ";")
    reportLock.lock()
    report = line
    reportLock.unlock()
  }

  /// Whether a touch at the centre of the content would be routed into it, by UIKit's own `hitTest`
  /// on the content's window.
  static func contentTakesHit(_ content: UIView) -> Bool {
    guard let window = content.window, !content.isHidden, content.bounds.height > 0 else {
      return false
    }
    let centre = content.convert(CGPoint(x: content.bounds.midX, y: content.bounds.midY), to: window)
    guard let hit = window.hitTest(centre, with: nil) else { return false }
    // A React Native child, not the content view itself: an empty content view in the
    // sheet takes the hit as well, and would say nothing about where the children are.
    return hit !== content && hit.isDescendant(of: content)
  }

  private func mark(_ kind: NitroUiPerfKind) {
    guard perfInstanceId >= 0 else { return }
    NitroUiBottomSheetPerf.mark(perfInstanceId, kind.rawValue)
  }
}
