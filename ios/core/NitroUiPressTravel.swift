// How far a finger may travel over a pressable row before the touch stops being the row's press.
// Foundation and CoreGraphics only, so the host toolchain can compile and unit-test this file.

import CoreGraphics
import Foundation

/// Whether a touch a press recogniser has been tracking is still that row's own press. The rows
/// track a press from touch-down alongside the scroll view (a tap recogniser would delay the
/// release React Native's touch handler sees), so travel is the only thing that tells a tap from a
/// flick that began on a row.
struct NitroUiPressTravel {
  /// 10 pt is about the slop UIKit gives a tap.
  static let limit: CGFloat = 10

  /// Where this touch came down. Only read while `tracking`.
  private var origin: CGPoint = .zero
  /// Whether a touch is being tracked, so a `.changed` without a `.began` is not measured from an
  /// origin of `.zero`.
  private var tracking = false

  /// Whether the touch has travelled far enough, or left the box, to stop being a press.
  private(set) var hasTravelled = false

  mutating func began(at point: CGPoint) {
    origin = point
    tracking = true
    hasTravelled = false
  }

  /// `bounds` must be in the same coordinate space as `point`. Returns whether this move is the one
  /// that stopped the touch being a press, so a row can drop its highlight exactly once.
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

  /// The finger lifted. Returns whether that lift is a press; a touch that was never tracked is
  /// not.
  mutating func ended() -> Bool {
    let isPress = tracking && !hasTravelled
    reset()
    return isPress
  }

  mutating func cancelled() {
    reset()
  }

  mutating func reset() {
    origin = .zero
    tracking = false
    hasTravelled = false
  }
}
