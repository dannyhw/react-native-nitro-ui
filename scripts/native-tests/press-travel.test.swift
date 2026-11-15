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

  private static let rowBox = CGRect(x: 0, y: 0, width: 390, height: 44)
  private static let middle = CGPoint(x: 195, y: 22)

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

    // UIKit can deliver `.changed` with no `.began` when a recogniser is disabled
    // mid-gesture, so there is no origin to measure travel from.
    var stray = NitroUiPressTravel()
    check(
      stray.moved(to: CGPoint(x: 195, y: 22 + 180), within: rowBox) == false,
      "a `.changed` with no `.began` ends nothing — there is no origin to travel from"
    )
    check(!stray.ended(), "and the release that follows presses nobody")
    stray.began(at: middle)
    check(stray.ended(), "the row's next real touch is a press, stray frame forgotten")

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
