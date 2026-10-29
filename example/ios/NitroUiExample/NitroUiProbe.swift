//
//  NitroUiProbe.swift
//  NitroUiExample
//
//  The F7 dwell probe's "is this ours, React Native's, or the platform's?" arm:
//  the same SwiftUI control, in the same kind of container, in a process that
//  starts no React Native at all.
//
//  `docs/tasks/F1/dwell-probe.md` measures that a 50 ms press reaches a hosted
//  Switch on a screen with a dozen controls and usually does not reach one on a
//  screen with two hundred. Every candidate explanation for that — React
//  Native's touch handler, a `UIScrollView`'s touch delay, the number of
//  hit-test targets — lives at least partly outside this library, so the only way
//  to say whose it is, is to rebuild the shape without the library in it and press
//  it the same way.
//
//  Nothing here runs unless the process is launched with `NUI_PROBE_UI` set, which
//  only the dwell probe does. A normal launch of the example never sees it.
//

import SwiftUI
import UIKit

/// A watchdog that reports how long the main thread goes without running any work.
///
/// The stall arm proves that a *known* block of 80–120 ms loses a 50 ms press. What
/// it cannot say is whether the React Native screen actually blocks that long, which
/// is the last link in the chain: without it, "a busy main thread" is the best
/// available explanation rather than a measured one. This closes the gap without
/// touching the thing under measurement — the probe only reads a log line the app
/// writes itself, so unlike an accessibility query it costs the app's main thread
/// nothing while a press is in flight.
///
/// It works the way a hang detector does: a background timer schedules a block on the
/// main queue and timestamps the moment that block actually runs. The difference
/// between the two is how long the main thread was not free, which is the same
/// quantity the stall arm sets deliberately.
final class ProbeMainThreadWatchdog {
  private let timer: DispatchSourceTimer

  /// - Parameters:
  ///   - interval: how often a probe block is offered to the main queue. Every 20 ms
  ///     is well under the 50 ms press being studied, so a block that hides a gap
  ///     would have to be longer than the thing it measures.
  ///   - threshold: only gaps at least this long are logged, so a healthy 16 ms
  ///     frame does not fill the log. It is below the press length under test on
  ///     purpose: a gap that matters has to be visible.
  ///
  /// Nothing is accumulated here on purpose. Each gap is one log line, and the
  /// runner aggregates the lines; keeping a counter would mean shared mutable state
  /// between the main thread and a background one, in the middle of the measurement,
  /// for a number that is easier and truer to compute from the log.
  init(interval: TimeInterval = 0.02, threshold: TimeInterval = 0.008) {
    let thresholdMs = Int(threshold * 1_000)
    // Announced, so a run reporting no gaps can be told apart from a run where the
    // watchdog never started. The stall arm has a readout for the same reason.
    print("real-input (ios): main-thread-watchdog started threshold=\(thresholdMs)ms")
    let source = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    source.schedule(deadline: .now() + interval, repeating: interval)
    source.setEventHandler {
      let scheduledAt = DispatchTime.now().uptimeNanoseconds
      DispatchQueue.main.async {
        let ranAt = DispatchTime.now().uptimeNanoseconds
        let gapMs = Int((ranAt - scheduledAt) / 1_000_000)
        guard gapMs >= thresholdMs else {
          return
        }
        // Measured on the main thread, logged off it. Writing to stdout from the
        // block whose own latency is being timed would make the log part of the
        // load it reports, and at fifty samples a second that is not small.
        //
        // `NSLog`, not `print`: the app is a separate process from the test runner,
        // and its stdout is not the runner's stdout, so a `print` here is invisible
        // to the log the probe parses. `NSLog` goes through os_log, which shows up
        // both in the runner's output for a simulator launch and in `log show`.
        DispatchQueue.global(qos: .utility).async {
          NSLog("real-input (ios): main-thread-gap %dms", gapMs)
        }
      }
    }
    self.timer = source
    source.resume()
  }

  deinit {
    timer.cancel()
  }
}

/// Builds the probe's root view controller, or returns nil for a normal launch.
enum NitroUiProbe {
  /// Keeps the watchdog alive when a launch turns it on: a dispatch source timer
  /// stops firing the moment it is released, and nothing else owns it.
  private static var watchdog: ProbeMainThreadWatchdog?

  /// Starts the main-thread watchdog when `NUI_PROBE_WATCHDOG` is set.
  ///
  /// Called from both launch paths — the React Native one and the probe's own —
  /// because the number worth having is the app's, not the probe's: the probe arm
  /// already sets its block length deliberately, while the React Native screen is
  /// the one whose stalls have only been inferred.
  static func startWatchdogIfNeeded(environment: [String: String]) {
    guard environment["NUI_PROBE_WATCHDOG"] != nil, watchdog == nil else {
      return
    }
    watchdog = ProbeMainThreadWatchdog()
  }

  /// `NUI_PROBE_UI` names the shape, `NUI_PROBE_ROWS` how many controls it mounts.
  ///
  /// Shapes are one difference apart from each other and from the app's own Switch
  /// screen:
  ///
  /// - `scroll` — a `UIScrollView` left at UIKit's own defaults
  ///   (`delaysContentTouches == true`, `canCancelContentTouches == true`).
  /// - `scroll-rn` — the same scroll view configured the way React Native's
  ///   `RCTScrollViewComponentView` configures its own: it sets
  ///   `delaysContentTouches = NO` in its initialiser.
  /// - `view` — no scroll view at all: the same rows in a plain view, so no pan
  ///   recogniser anywhere and nothing that can delay a touch.
  ///
  /// `NUI_PROBE_STALL=<ms>` additionally blocks the main thread for that long on
  /// every run-loop pass. That is the causal test for the one explanation the
  /// React Native matrix leaves standing: a screen with two hundred mounted
  /// controls keeps its main thread busy, so if "the main thread is busy while the
  /// finger comes up" is what loses a short press, stalling a plain UIKit screen
  /// the same way has to lose it too. If it does not, the stall is not the
  /// mechanism and the explanation is inside React Native's own touch path.
  static func rootViewController(
    environment: [String: String]
  ) -> UIViewController? {
    guard let kind = environment["NUI_PROBE_UI"], !kind.isEmpty else {
      return nil
    }
    let rows = environment["NUI_PROBE_ROWS"].flatMap(Int.init) ?? 200
    let stall = environment["NUI_PROBE_STALL"].flatMap(Int.init) ?? 0
    let rescue = environment["NUI_PROBE_RESCUE"] == "1"
    return ProbeViewController(kind: kind, rows: rows, stallMs: stall, rescue: rescue)
  }
}

/// A screen full of plain SwiftUI `Toggle`s, each in its own
/// `UIHostingController`, with no React Native, no Nitro and none of this
/// library's hosting code in the process.
///
/// Each row is laid out like `SwitchScreen`'s: a label on the left, a control of
/// the Toggle's own fitting size on the right, in a 34 pt row. That is what makes
/// the two comparable — same control, same geometry, same number of mounted
/// targets — rather than merely similar.
///
/// Two things are counted and published as plain numbers at the bottom of the
/// screen: how many times a row's Toggle has flipped, and how many times the
/// positive control has been pressed. A count is the witness the probe's quiet
/// shape needs — press twelve times, read once, the delta is how many arrived —
/// and under a main-thread stall it is the only shape that cannot be misread: a
/// toggling witness that is merely *slow* to report looks exactly like one whose
/// presses were lost.
private final class ProbeViewController: UIViewController {
  /// How the test finds the positive control.
  static let buttonID = "probe-button"

  private let kind: String
  private let rows: Int
  private let stallMs: Int
  /// Witness for the rows: a bare number, because the probe parses it as one.
  private let toggleCountReport = UILabel()
  /// Witness for the positive control, same shape.
  private let buttonCountReport = UILabel()
  /// A UIKit control *inside* the scroll view, for the question the outer one cannot
  /// answer: under a stall, is it SwiftUI's Toggle that loses the press, or any
  /// control that fires on touch-up-inside? A plain `UIButton` answers that only if
  /// it is in the same container as the rows — the outer one deliberately is not.
  private let innerButton = UIButton(type: .system)
  private let innerCountReport = UILabel()
  /// Witness for the rescue experiment: how many times a tap recogniser on a row
  /// fired. Non-zero means UIKit recognised the short press even though the control
  /// beneath it never acted.
  private let rescueCountReport = UILabel()
  /// Says what the stall really blocked for, so a run can prove it stalled instead
  /// of trusting the flag it was given. The stall observer writes it.
  private let stallReport = UILabel()
  /// Held because a child view controller's view is a subview, and the containment
  /// has to outlive `viewDidLoad`.
  private var hosted: [UIHostingController<ProbeToggleRow>] = []
  /// Keeps the stall alive for the life of the screen; see `ProbeMainLoopStall`.
  private var stallSource: ProbeMainLoopStall?
  private var toggleFlips = 0 {
    didSet { toggleCountReport.text = "\(toggleFlips)" }
  }
  private var buttonPresses = 0 {
    didSet { buttonCountReport.text = "\(buttonPresses)" }
  }
  private var innerPresses = 0 {
    didSet { innerCountReport.text = "\(innerPresses)" }
  }
  private var rescueFirings = 0 {
    didSet { rescueCountReport.text = "\(rescueFirings)" }
  }

  /// `NUI_PROBE_RESCUE=1` attaches a `UITapGestureRecognizer` to each row's Toggle
  /// host, with `delaysTouchesEnded` off, and counts how often one fires.
  ///
  /// This is the candidate fix measured before anyone is asked whether to ship it.
  /// The question it answers is narrow and it is the one that decides the task: a
  /// recogniser's own action also runs on the main thread, so if a blocked main
  /// thread discards a short press on its way in, no recogniser can rescue it and
  /// the library has nothing to offer but the workaround. If one does fire, then a
  /// library-side fix exists and shipping it is a product decision rather than a
  /// guess. Counting recogniser firings, rather than having the recogniser flip the
  /// Toggle, keeps this a measurement of the touch path and not of SwiftUI's
  /// response to a programmatic write.
  private let rescue: Bool
  /// Held for the life of the screen, because a recogniser is weakly held by the
  /// view it is attached to.
  private var rescuers: [UITapGestureRecognizer] = []

  init(kind: String, rows: Int, stallMs: Int, rescue: Bool) {
    self.kind = kind
    self.rows = rows
    self.stallMs = stallMs
    self.rescue = rescue
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("nitro-ui: the probe cannot be built from a nib")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 2
    addInnerControl(to: stack)
    mountRows(in: stack)

    if kind == "view" {
      // No scroll view: nothing here has a pan recogniser, and nothing can delay a
      // touch on its way to a control. The rows keep their own heights and simply
      // run past the bottom of the window, which is what keeps the mounted count
      // the same as the scrolled shapes'.
      stack.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(stack)
      NSLayoutConstraint.activate([
        stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
        stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      ])
    } else {
      let scroller = UIScrollView()
      scroller.translatesAutoresizingMaskIntoConstraints = false
      if kind == "scroll-rn" {
        // React Native's configuration. The claim that this is what RN does is read
        // from the source, not guessed: `RCTScrollViewComponentView.mm` sets
        // `delaysContentTouches = NO` in its initialiser.
        scroller.delaysContentTouches = false
        scroller.canCancelContentTouches = false
      }
      view.addSubview(scroller)
      scroller.addSubview(stack)
      // The by-the-book stack-in-scroll-view: the stack's edges against the
      // *content* guide (which is what defines `contentSize`), its width against
      // the *frame* guide (which is what the viewport is). Pinning the top to the
      // scroll view itself would make the content no taller than the viewport and
      // the rows below the fold would not exist in the scroll view's space.
      stack.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        scroller.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
        scroller.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        scroller.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        scroller.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        stack.topAnchor.constraint(equalTo: scroller.contentLayoutGuide.topAnchor),
        stack.leadingAnchor.constraint(equalTo: scroller.contentLayoutGuide.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: scroller.contentLayoutGuide.trailingAnchor),
        stack.bottomAnchor.constraint(equalTo: scroller.contentLayoutGuide.bottomAnchor),
        stack.widthAnchor.constraint(equalTo: scroller.frameLayoutGuide.widthAnchor),
      ])
    }

    // Built last so it is what hit-testing returns in its own band. Being outside
    // the scroll view is the point: it is the baseline that has to answer every
    // shape, so anything the rows lose can be read against it.
    let button = makePositiveControl()
    addReports(below: button)

    if stallMs > 0 {
      let stall = ProbeMainLoopStall(milliseconds: stallMs)
      let asked = stallMs
      // Written from the stall observer itself, on the main thread, from inside the
      // iteration it just blocked: what it reports is the longest block it actually
      // performed, not what it was asked to do.
      stall.onIteration = { [weak self] longestMs, iterations in
        self?.stallReport.text =
          "stall=\(asked)ms measured-max=\(longestMs)ms iterations=\(iterations)"
      }
      stallSource = stall
      stall.start()
    }
  }

  /// A plain UIKit button placed as the stack's first arranged view, so it sits in
  /// exactly the container the rows sit in and is pressed the same way. Under a
  /// stall this says whether *SwiftUI* is what loses the press or whether any
  /// touch-up-inside control does, which is the difference between "host a `UISwitch`
  /// instead" being a fix and being a guess.
  private func addInnerControl(to stack: UIStackView) {
    configure(innerCountReport, identifier: "probe-inner-count", text: "0")
    innerButton.setTitle("Inner UIKit button", for: .normal)
    innerButton.accessibilityIdentifier = "probe-inner-button"
    innerButton.accessibilityLabel = "probe-inner-button"
    innerButton.addTarget(
      self,
      action: #selector(ProbeViewController.innerButtonPressed),
      for: .touchUpInside
    )
    innerButton.translatesAutoresizingMaskIntoConstraints = false
    let row = UIStackView(arrangedSubviews: [innerButton, innerCountReport])
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 8
    stack.addArrangedSubview(row)
    row.heightAnchor.constraint(equalToConstant: 44).isActive = true
  }

  /// The positive control for this arm: a plain UIKit button that reports its own
  /// state back through the accessibility value the probe reads, and counts its
  /// presses for the quiet shape. Without it, a run of drops here could still be
  /// "the app answers nothing at all", which is the thing the React Native arm's
  /// `probe-pressable` row rules out over there.
  private func makePositiveControl() -> UIButton {
    let button = UIButton(type: .system)
    button.setTitle("Probe button", for: .normal)
    button.accessibilityIdentifier = Self.buttonID
    button.accessibilityValue = "off"
    button.accessibilityLabel = "Probe button"
    button.addTarget(
      self,
      action: #selector(ProbeViewController.probeButtonPressed(_:)),
      for: .touchUpInside
    )
    button.translatesAutoresizingMaskIntoConstraints = false
    // Added here, before its constraints are activated: a constraint between the
    // button and the screen's root view cannot be installed while the two have no
    // common ancestor, which is an exception out of Auto Layout, not a warning.
    view.addSubview(button)
    NSLayoutConstraint.activate([
      button.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      button.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      button.heightAnchor.constraint(equalToConstant: 44),
    ])
    return button
  }

  /// The readouts, in a strip under the positive control so none of them can be
  /// under a finger.
  private func addReports(below button: UIButton) {
    configure(toggleCountReport, identifier: "probe-toggle-count", text: "0")
    configure(buttonCountReport, identifier: "probe-button-count", text: "0")
    configure(rescueCountReport, identifier: "probe-rescue-count", text: "0")
    configure(
      stallReport,
      identifier: "probe-stall",
      text: stallMs > 0 ? "stall=\(stallMs)ms (none yet)" : "stall=none"
    )
    let reports = UIStackView(arrangedSubviews: [
      toggleCountReport, buttonCountReport, rescueCountReport, stallReport,
    ])
    // Vertical, not horizontal: the stall readout is a sentence, and a truncated
    // label would be read back truncated by the probe that checks it ran.
    reports.axis = .vertical
    reports.alignment = .leading
    reports.spacing = 2
    reports.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(reports)
    NSLayoutConstraint.activate([
      reports.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      reports.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      reports.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
      button.bottomAnchor.constraint(equalTo: reports.topAnchor, constant: -8),
    ])
  }

  /// A readout label. Deliberately no `accessibilityLabel`: the probe reads these by
  /// identifier and parses the text as a number, and `echoText` prefers a label over
  /// a value, so a friendly name here would be read instead of the count.
  private func configure(_ label: UILabel, identifier: String, text: String) {
    label.accessibilityIdentifier = identifier
    label.text = text
    label.font = .systemFont(ofSize: 10)
    label.textColor = .secondaryLabel
    label.numberOfLines = 1
  }

  /// One row per control: a label and a real SwiftUI Toggle, sized like the app's.
  private func mountRows(in stack: UIStackView) {
    for index in 0..<rows {
      let controller = UIHostingController(
        rootView: ProbeToggleRow(index: index) { [weak self] in
          self?.toggleFlips += 1
        }
      )
      addChild(controller)
      controller.didMove(toParent: self)
      hosted.append(controller)

      let row = UIView()
      let label = UILabel()
      label.text = "row \(index)"
      label.textColor = .secondaryLabel
      label.translatesAutoresizingMaskIntoConstraints = false
      row.addSubview(label)

      let control = controller.view!
      control.backgroundColor = .clear
      control.translatesAutoresizingMaskIntoConstraints = false
      row.addSubview(control)

      // The Toggle's own fitting size — the same unbounded proposal
      // `NitroSwiftUIHost` asks with for an intrinsic control — and a row height
      // matching the app's, so a press aims at the same size target in both apps.
      let fitting = controller.sizeThatFits(in: CGSize(width: 10_000, height: 10_000))
      let width = fitting.width > 0 ? fitting.width : 61
      let height = fitting.height > 0 ? fitting.height : 28
      NSLayoutConstraint.activate([
        row.heightAnchor.constraint(equalToConstant: 34),
        label.leadingAnchor.constraint(equalTo: row.leadingAnchor),
        label.centerYAnchor.constraint(equalTo: row.centerYAnchor),
        control.trailingAnchor.constraint(equalTo: row.trailingAnchor),
        control.centerYAnchor.constraint(equalTo: row.centerYAnchor),
        control.widthAnchor.constraint(equalToConstant: width),
        control.heightAnchor.constraint(equalToConstant: height),
      ])
      stack.addArrangedSubview(row)

      if rescue {
        // Attached to the hosting view, not the row, so it covers the control and
        // nothing else, and `delaysTouchesEnded = false` so it is not the recogniser
        // that holds the up-event back — the point is to see whether UIKit recognises
        // this press at all while the thread is blocked.
        let recogniser = UITapGestureRecognizer(
          target: self,
          action: #selector(ProbeViewController.rescueRecogniserFired)
        )
        recogniser.delaysTouchesEnded = false
        recogniser.cancelsTouchesInView = false
        control.addGestureRecognizer(recogniser)
        rescuers.append(recogniser)
      }
    }
  }

  /// Counts a recogniser firing. Deliberately does not flip the Toggle: whether a
  /// programmatic write would then take effect is a different question from whether
  /// the touch arrived, and conflating them would make this read as a fix.
  @objc private func rescueRecogniserFired() {
    rescueFirings += 1
  }

  /// The positive control's own state, written back as the value the probe reads.
  @objc private func probeButtonPressed(_ button: UIButton) {
    let on = button.accessibilityValue != "on"
    button.accessibilityValue = on ? "on" : "off"
    buttonPresses += 1
  }

  /// The in-scroller UIKit control's press count, published as a bare number.
  @objc private func innerButtonPressed() {
    innerPresses += 1
  }
}

/// One row's control: a real SwiftUI `Toggle` with `.switch` style holding its own
/// state, identifiable the way the app's controls are for the test, and reporting
/// each flip so the screen can publish a count.
///
/// The flip is reported from the binding's setter rather than `.onChange(of:)`,
/// which is iOS 17+ and this target still builds for earlier. A setter works on
/// every version and fires exactly when the Toggle's own state moves, which is the
/// moment the probe cares about.
private struct ProbeToggleRow: View {
  let index: Int
  let onFlip: () -> Void
  @State private var on = false

  var body: some View {
    Toggle(
      "",
      isOn: Binding(
        get: { on },
        set: { next in
          on = next
          onFlip()
        }
      )
    )
    .labelsHidden()
    .toggleStyle(.switch)
    .accessibilityIdentifier("probe-toggle-\(index)")
  }
}

/// Blocks the main thread on every run-loop pass, for as long as a busy React
/// Native screen's would be.
///
/// A `CFRunLoopObserver` at `.beforeSources` fires after the loop has woken and
/// before it runs any timer or input source, and UIKit picks touches up through a
/// source — so blocking there holds the thread across the part of a pass in which
/// the app would have taken the finger. It is the one place that can do this for a
/// known time on every iteration without being a timer of its own, which would be
/// one more thing scheduled whose cadence would then be part of what is measured.
///
/// It stops after a bounded number of iterations. The probe presses for about a
/// minute, so the bound is generous, and it exists because a stall that cannot stop
/// would leave the app permanently unresponsive if a run ever failed to tear the
/// window down.
private final class ProbeMainLoopStall {
  private let microseconds: UInt32
  private var remainingIterations: Int
  private var observer: CFRunLoopObserver?
  /// Called on the main thread from inside the stalled iteration, with the longest
  /// block performed so far and how many iterations have been stalled.
  var onIteration: ((Int, Int) -> Void)?
  private var longestMs = 0
  private var iterations = 0

  init(milliseconds: Int) {
    self.microseconds = UInt32(max(1, milliseconds) * 1_000)
    self.remainingIterations = 4_000
  }

  func start() {
    let observer = CFRunLoopObserverCreateWithHandler(
      nil,
      CFRunLoopActivity.beforeSources.rawValue,
      true,
      0
    ) { [weak self] _, _ in
      guard let self, self.remainingIterations > 0 else {
        return
      }
      self.remainingIterations -= 1
      let startedAt = DispatchTime.now().uptimeNanoseconds
      usleep(self.microseconds)
      let blockedMs = Int(
        (DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
      )
      self.iterations += 1
      if blockedMs > self.longestMs {
        self.longestMs = blockedMs
      }
      self.onIteration?(self.longestMs, self.iterations)
    }
    self.observer = observer
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
  }

  deinit {
    if let observer {
      CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, .commonModes)
    }
  }
}
