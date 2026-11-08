package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for where the Popover's popup may put its content.
 *
 * The Android half of D44 item 1 is "the content stays above the keyboard", and the number
 * that decides it is arithmetic: the anchor's edges, the composed height, the frame's margins
 * and the frame's own two edges. A device run can only read the result afterwards - the
 * real-input check measures the field's box once the keyboard is already up - so the rule that
 * decides it lives here, where it can be run against the geometry a device produced.
 *
 * The fixtures *are* that geometry, read off a Pixel 9 AVD at 1080x2424 while the real-input
 * popover case ran (G22): the 16 dp margin is 42 px and the 4 dp gap 11 px, the visible frame
 * of the window is [142..2361] with the keyboard away and [142..1541] with
 * `com.google.android.inputmethod.latin` on screen, the anchor of the popover with a field in
 * it is 1646..1752, and the popover's content is composed 578x414.
 *
 * The frame has two edges on purpose. Compose hands a position provider only the frame's
 * *height*, and the first version of [PopoverPlacement] treated that height as the window's
 * and subtracted the keyboard from it - which counted the keyboard twice, because the visible
 * frame has already lost it. That model puts this anchor's popup at 60, where the window
 * manager parks it against the status bar; the frame puts it at 1085, 42 px above the keys and
 * 147 px above the anchor it belongs to.
 */
class PopoverPlacementTest {
  private val marginPx = 42
  private val spacingPx = 11

  /** The status bar: where the frame the popup may use starts. */
  private val frameTopPx = 142

  /** Measured: [142..2361], the last 63 px being the navigation bar. */
  private val frameBottomAway = 2361

  /** Measured with the keyboard up: its own top edge, 883 px of inset. */
  private val frameBottomIme = 1541

  /** The anchor of the example's popover with a `TextInput` in it. */
  private val anchorTop = 1646
  private val anchorBottom = 1752
  private val contentHeight = 414

  private fun place(
    anchorTop: Int = this.anchorTop,
    anchorBottom: Int = this.anchorBottom,
    contentHeight: Int = this.contentHeight,
    frameBottom: Int,
    frameTop: Int = frameTopPx,
  ): Int =
    PopoverPlacement.placeTop(
      anchorTop = anchorTop,
      anchorBottom = anchorBottom,
      contentHeight = contentHeight,
      spacingPx = spacingPx,
      marginPx = marginPx,
      frameTopPx = frameTop,
      frameBottomPx = frameBottom,
    )

  @Test
  fun withTheKeyboardAwayThePopupSitsBelowItsAnchor() {
    // The placement the device produced: anchor's bottom plus the 4 dp gap, and the popup's
    // own bottom 184 px above the navigation bar.
    assertEquals(1763, place(frameBottom = frameBottomAway))
  }

  @Test
  fun anAnchorTheKeyboardLeavesAloneKeepsThatPlacement() {
    // The same popover opened near the top of the screen: the keyboard takes the bottom of
    // the frame and nothing about this placement changes, so it does not move when the field
    // is tapped.
    assertEquals(
      417,
      place(anchorTop = 300, anchorBottom = 406, frameBottom = frameBottomIme),
    )
  }

  @Test
  fun anAnchorWithNoRoomBelowFlipsAboveItWhileThereIsRoomThere() {
    // Keyboard away: 2017 + 414 is 2431, past the frame, so the popup goes above the anchor
    // instead, and stays 1889 there - 430 px above the frame's bottom.
    assertEquals(
      1475,
      place(
        anchorTop = 1900,
        anchorBottom = 2006,
        frameBottom = frameBottomAway,
      ),
    )
  }

  @Test
  fun anAnchorBehindTheKeyboardDoesNotFlipThePopupIntoIt() {
    val y = place(frameBottom = frameBottomIme)
    // Above the anchor would be 1221, whose bottom is 94 px behind the keys; below the anchor
    // is 1763, which is 636 px behind them. Neither is an answer, so the popup rises to the
    // highest edge the frame allows.
    assertEquals(1085, y)
    assertTrue(
      "content from $y sits below the keyboard's own top edge",
      y + contentHeight <= frameBottomIme - marginPx,
    )
  }

  @Test
  fun aKeyboardTakesTheFrameFromBelowRatherThanFromItsTop() {
    // The regression the two-edge frame fixes. The keyboard's inset (883 px) is not a number
    // to subtract from a height: with it up, the frame Compose reports is 1399 px tall, which
    // is already the screen minus the status bar minus the keyboard. Treating that height as
    // the window's answered 60 - above the status bar, so the window manager pinned the popup
    // to 142 with the field 1 px behind the keys and 985 px of room unused.
    val asAWindowHeight = 1399
    val y = place(frameBottom = frameBottomIme)
    assertTrue(
      "the popup must not start above the frame: $y vs $frameTopPx",
      y >= frameTopPx + marginPx,
    )
    assertTrue(
      "and it must not be the double-subtracted answer: $y vs 60",
      y > 60,
    )
    // What the wrong model produced, for the record: the frame's own height minus the
    // keyboard, minus the margin, minus the content's height.
    assertEquals(60, asAWindowHeight - 883 - marginPx - contentHeight)
  }

  @Test
  fun contentTooTallForTheFrameStartsAtTheFramesTopMargin() {
    // Android hands the popup the height it asked for, so nothing moves this content fully
    // into the frame; the top of the frame is the part of it a person can still reach - and
    // not underneath the status bar, which is what a margin measured from 0 would say.
    assertEquals(
      frameTopPx + marginPx,
      place(contentHeight = 1600, frameBottom = frameBottomIme),
    )
  }

  @Test
  fun thePopupStaysInsideTheFrameHorizontally() {
    // The measured case: the anchor is 42 px in, the content 578 wide, the frame 1080.
    assertEquals(
      42,
      PopoverPlacement.placeLeft(
        anchorLeft = 42,
        contentWidth = 578,
        marginPx = marginPx,
        frameLeftPx = 0,
        frameRightPx = 1080,
      ),
    )
    // An anchor near the right edge moves the popup in rather than pushing it off screen.
    assertEquals(
      460,
      PopoverPlacement.placeLeft(
        anchorLeft = 700,
        contentWidth = 578,
        marginPx = marginPx,
        frameLeftPx = 0,
        frameRightPx = 1080,
      ),
    )
    // A frame that does not start at 0 - a window that does not own the whole screen - moves
    // both edges with it.
    assertEquals(
      142,
      PopoverPlacement.placeLeft(
        anchorLeft = 42,
        contentWidth = 578,
        marginPx = marginPx,
        frameLeftPx = 100,
        frameRightPx = 1180,
      ),
    )
  }
}
