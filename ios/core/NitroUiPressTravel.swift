//
//  NitroUiPressTravel.swift
//  react-native-nitro-ui
//
//  How far a finger may travel over a pressable row before the row stops calling the
//  touch its own press. Foundation and CoreGraphics only — no UIKit, no Nitro — so
//  `bun run test:native` compiles this file with the host toolchain and runs the
//  vectors in `scripts/native-tests/press-travel.test.swift` against it.
//
//  Both places that press a row use it: `NitroUiListRowView.pressChanged` (ListItem's
//  own row) and `NitroUiFormRowCell.pressChanged` (a Form row's cell). They need the
//  same rule because they make the same trade: a recogniser that starts at touch-down
//  and recognises alongside the scroll view, which is what makes a quick thumb work at
//  all and also what lets a flick that began on a row reach the row's release.
//

import CoreGraphics
import Foundation

/// Whether a touch a press recogniser has been tracking is still that row's own press.
///
/// The recognisers this serves cannot ask UIKit instead. A tap recogniser would answer
/// the question itself, but it delays the release it hands to React Native's own touch
/// handler and it will not begin alongside a scroll view, which is the pair of
/// properties that makes hosted content inside a row work at all (see
/// `NitroUiFormRowCell.pressGesture` for the measurement). So the row tracks the press
/// from touch-down, and travel is the only thing left that tells a tap from a flick
/// that happened to begin on a row: `.ended` is where a long press with no minimum says
/// "the finger lifted", and a flick lifts a finger too.
struct NitroUiPressTravel {
  /// How far a finger may travel before the row stops calling the touch its own press.
  ///
  /// 10 pt is the order of magnitude UIKit itself gives a tap for slop. It is a
  /// distance, not a duration: the flick that matters here is the one the scroll view
  /// also recognises, and by the time the row's release arrives the finger has moved
  /// hundreds of points.
  static let limit: CGFloat = 10

  /// Where this touch came down. Only read while `tracking`.
  private var origin: CGPoint = .zero
  /// Whether a touch is being tracked at all, so a `.changed` that arrives without a
  /// `.began` (which UIKit does not promise against) cannot answer with an origin of
  /// `CGPoint.zero` and call everything outside the row's top-left a scroll.
  private var tracking = false

  /// Whether the touch has travelled far enough, or left the box, to stop being a press.
  private(set) var hasTravelled = false

  /// The finger came down. Everything about the previous touch is dropped.
  mutating func began(at point: CGPoint) {
    origin = point
    tracking = true
    hasTravelled = false
  }

  /// The finger moved, and the row's own box is `bounds` (the same coordinate space
  /// `point` was read in).
  ///
  /// Returns whether *this* move is the one that stopped the touch being a press, which
  /// is what a row uses to take its highlight back exactly once rather than on every
  /// frame of the flick.
  @discardableResult
  mutating func moved(to point: CGPoint, within bounds: CGRect) -> Bool {
    guard tracking, !hasTravelled else {
      return false
    }
    let travelled = abs(point.x - origin.x) > Self.limit
      || abs(point.y - origin.y) > Self.limit
    guard travelled || !bounds.contains(point) else {
      return false
    }
    hasTravelled = true
    return true
  }

  /// The finger lifted. Returns whether that lift is a press.
  ///
  /// A lift for a touch this never tracked answers no press. UIKit sends `.ended` only
  /// for a touch it told us about, so the case is there to close, not to happen, and
  /// the direction it closes in is the one that presses nobody.
  mutating func ended() -> Bool {
    let isPress = tracking && !hasTravelled
    reset()
    return isPress
  }

  /// The recogniser cancelled or failed: a scroll that turned out to be a scroll.
  mutating func cancelled() {
    reset()
  }

  /// Forget the touch in flight, for a row going back to rest or into the pool.
  mutating func reset() {
    origin = .zero
    tracking = false
    hasTravelled = false
  }
}
