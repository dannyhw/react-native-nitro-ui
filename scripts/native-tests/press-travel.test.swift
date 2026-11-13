//
//  press-travel.test.swift
//
//  Host-side vectors for how far a finger may travel over a pressable row before the
//  row stops calling the touch its own press
//  (ios/core/NitroUiPressTravel.swift — ListItem's row and a Form row's cell).
//
//  The rule is "a release is a press unless the finger went somewhere". The failure it
//  guards is the release that answers `.ended` without looking: a recogniser with
//  `minimumPressDuration = 0` begins at touch-down and recognises alongside the scroll
//  view, so every flick that happens to start on a row ends on it too, and a row that
//  fires anyway takes the person to a screen they only meant to scroll past. G30 found
//  it on ListItem and X32 found the same recognizer, unwritten, on the Form's cell.
//
//  The device half is `real-input`'s drag-from-a-row check, which is the only witness
//  that the recogniser is wired to this rule; what lives here is the geometry — the
//  slop, the bounds, and the fact that a flick does not become a press again on its way
//  back — at every input a device run cannot cheaply aim at.
//
//  Every fixture is chosen so the answer with no travel check differs from the answer
//  the rule gives: the last group asserts exactly that, so this file cannot go green
//  with the check removed by making every vector a tap.
//
import CoreGraphics
import Foundation

@main
struct PressTravelTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  /// The box of a row: 390 pt wide, 44 pt tall, at the origin of its own coordinates —
  /// the space `gesture.location(in: self)` answers in.
  private static let rowBox = CGRect(x: 0, y: 0, width: 390, height: 44)
  /// A point well inside that box, so nothing below trips the bounds rule by accident.
  private static let middle = CGPoint(x: 195, y: 22)

  /// The press a row records for one touch, as the recogniser reports it.
  ///
  /// `.moved` is a list because a flick arrives as several of them, and a row's answer
  /// has to survive the whole series — a check that only looked at the last frame would
  /// pass for a rule that forgot the first one.
  private static func isPress(
    down origin: CGPoint?,
    moved: [CGPoint],
    inside bounds: CGRect = rowBox
  ) -> Bool {
    var travel = NitroUiPressTravel()
    if let origin {
      travel.began(at: origin)
    }
    for point in moved {
      travel.moved(to: point, within: bounds)
    }
    return travel.ended()
  }

  static func main() {
    print("NitroUiPressTravel ==")

    // 1. A tap is a press, and a flick is not.
    check(isPress(down: middle, moved: []), "a tap that never moves is a press")
    check(
      isPress(down: middle, moved: [CGPoint(x: 195, y: 22 + 3)]),
      "a thumb that jitters 3 pt is still a press"
    )
    check(
      !isPress(down: middle, moved: [CGPoint(x: 195, y: 22 + 200)]),
      "a 200 pt flick down the page — the drag real-input aims at a row — is not a press"
    )
    check(
      !isPress(down: middle, moved: [CGPoint(x: 195 + 40, y: 22)]),
      "40 pt sideways is not a press either, whatever it scrolls"
    )

    // 2. The slop itself: the limit is a distance, and the frame either side of it has
    //    to read the right way. `> limit`, not `>=`, so exactly 10 pt is still a tap.
    check(
      isPress(down: middle, moved: [CGPoint(x: middle.x, y: middle.y + NitroUiPressTravel.limit)]),
      "exactly the limit (\(Int(NitroUiPressTravel.limit)) pt) is still a press"
    )
    check(
      !isPress(down: middle, moved: [CGPoint(x: middle.x, y: middle.y + NitroUiPressTravel.limit + 0.5)]),
      "half a point past the limit is not"
    )
    check(
      !isPress(down: middle, moved: [CGPoint(x: middle.x - 90, y: middle.y)]),
      "the limit is on both axes, not only the one a vertical list scrolls"
    )

    // 3. Leaving the row ends it, even without much travel: a finger that slides off
    //    the edge of a short row did not choose that row.
    check(
      !isPress(
        down: CGPoint(x: 195, y: 42),
        moved: [CGPoint(x: 195, y: 47)]
      ),
      "a move that leaves the box is not a press, however short"
    )
    check(
      isPress(down: CGPoint(x: 195, y: 42), moved: [CGPoint(x: 195, y: 43)]),
      "and the bounds rule is not an excuse to drop every press near an edge"
    )

    // 4. A flick that comes back is still a flick. This is the one a per-frame check
    //    gets wrong: the last frame is on the row again, and the row has to remember.
    check(
      !isPress(
        down: middle,
        moved: [
          CGPoint(x: 195, y: 22 + 180),
          CGPoint(x: 195, y: 22 + 60),
          middle,
        ]
      ),
      "a flick that returns to where it started is still not a press"
    )

    // 5. The highlight goes exactly once. `moved` answers whether *this* frame ended
    //    the press, which is what lets a row repaint once rather than every frame.
    var oneShot = NitroUiPressTravel()
    oneShot.began(at: middle)
    check(
      oneShot.moved(to: CGPoint(x: 195, y: 22 + 3), within: rowBox) == false,
      "a frame inside the slop does not end the press"
    )
    check(
      oneShot.moved(to: CGPoint(x: 195, y: 22 + 180), within: rowBox) == true,
      "the frame past the slop is the one that ends it"
    )
    check(
      oneShot.moved(to: CGPoint(x: 195, y: 22 + 240), within: rowBox) == false,
      "and the frames after it do not end it again"
    )
    check(oneShot.ended() == false, "the release after that flick is not a press")

    // 6. A touch nobody began. UIKit may deliver `.changed` without a `.began` for a
    //    recogniser that was disabled mid-gesture; with no origin, an unguarded rule
    //    measures against (0, 0) and calls the middle of the row a 195 pt travel —
    //    which fails the *other* way, by eating real presses.
    var stray = NitroUiPressTravel()
    check(
      stray.moved(to: CGPoint(x: 195, y: 22 + 180), within: rowBox) == false,
      "a `.changed` with no `.began` ends nothing — there is no origin to travel from"
    )
    check(!stray.ended(), "and the release that follows presses nobody")
    stray.began(at: middle)
    check(stray.ended(), "the row's next real touch is a press, stray frame forgotten")

    // 7. A cancel, and the next touch. The pool hands a cell to its next row; a rule
    //    that kept the old touch's travel would refuse that row's real taps.
    var reused = NitroUiPressTravel()
    reused.began(at: middle)
    reused.moved(to: CGPoint(x: 195, y: 22 + 180), within: rowBox)
    reused.cancelled()
    check(!reused.ended(), "a cancelled touch answers no press at all")
    var afterCancel = NitroUiPressTravel()
    afterCancel.began(at: middle)
    afterCancel.moved(to: CGPoint(x: 195, y: 22 + 180), within: rowBox)
    afterCancel.cancelled()
    afterCancel.began(at: middle)
    check(afterCancel.ended(), "the next touch on the same row is a press again")

    // 8. Fixture sanity: with no travel check every vector above reads as a press, so
    //    the ones that must not are the ones that would go green for free.
    check(
      isPress(down: middle, moved: [CGPoint(x: 195, y: middle.y + 200)]) != isPress(down: middle, moved: []),
      "the flick and the tap are different answers (fixture sanity)"
    )
    check(
      isPress(down: CGPoint(x: 195, y: 42), moved: [CGPoint(x: 195, y: 47)]) != isPress(down: middle, moved: []),
      "the off-box move and the tap are different answers (fixture sanity)"
    )

    if failures > 0 {
      print("press-travel.test: \(failures) failure(s)")
      exit(1)
    }
    print("press-travel.test: all passed")
  }
}
