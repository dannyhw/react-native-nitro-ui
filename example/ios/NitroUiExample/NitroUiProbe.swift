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

/// Builds the probe's root view controller, or returns nil for a normal launch.
enum NitroUiProbe {
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
  static func rootViewController(
    environment: [String: String]
  ) -> UIViewController? {
    guard let kind = environment["NUI_PROBE_UI"], !kind.isEmpty else {
      return nil
    }
    let rows = environment["NUI_PROBE_ROWS"].flatMap(Int.init) ?? 200
    return ProbeViewController(kind: kind, rows: rows)
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
private final class ProbeViewController: UIViewController {
  /// How the test finds the positive control.
  static let buttonID = "probe-button"

  private let kind: String
  private let rows: Int
  /// Held because a child view controller's view is a subview, and the containment
  /// has to outlive `viewDidLoad`.
  private var hosted: [UIHostingController<ProbeToggleRow>] = []

  init(kind: String, rows: Int) {
    self.kind = kind
    self.rows = rows
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

    // The positive control for this arm, added last so it is what hit-testing
    // returns in its own band: a plain UIKit button that reports its own state back
    // through the accessibility value the probe reads. Without it, a run of drops
    // here could still be "the app answers nothing at all", which is the thing the
    // React Native arm's `js-toggle` row rules out over there. Being outside the
    // scroll view is the point — it is the baseline that has to answer every shape,
    // so anything the rows lose can be read against it.
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
    view.addSubview(button)
    NSLayoutConstraint.activate([
      button.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      button.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
      button.heightAnchor.constraint(equalToConstant: 44),
    ])
  }

  /// One row per control: a label and a real SwiftUI Toggle, sized like the app's.
  private func mountRows(in stack: UIStackView) {
    for index in 0..<rows {
      let controller = UIHostingController(rootView: ProbeToggleRow(index: index))
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
      let fitting = controller.sizeThatFits(
        in: CGSize(width: 10_000, height: 10_000)
      )
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
    }
  }

  /// The positive control's own state, written back as the value the probe reads.
  @objc private func probeButtonPressed(_ button: UIButton) {
    let on = button.accessibilityValue != "on"
    button.accessibilityValue = on ? "on" : "off"
  }
}

/// One row's control: a real SwiftUI `Toggle` with `.switch` style holding its own
/// state, identifiable the way the app's controls are for the test.
private struct ProbeToggleRow: View {
  let index: Int
  @State private var on = false

  var body: some View {
    Toggle("", isOn: $on)
      .labelsHidden()
      .toggleStyle(.switch)
      .accessibilityIdentifier("probe-toggle-\(index)")
  }
}
