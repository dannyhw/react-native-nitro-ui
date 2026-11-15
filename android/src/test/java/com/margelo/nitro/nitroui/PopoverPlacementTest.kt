package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pixel geometry of a 1080x2424 screen: the 16 dp margin is 42 px, the 4 dp gap 11 px. */
class PopoverPlacementTest {
  private val marginPx = 42
  private val spacingPx = 11

  /** Below the status bar. */
  private val frameTopPx = 142

  /** Keyboard hidden; the last 63 px of the screen are the navigation bar. */
  private val frameBottomAway = 2361

  /** Keyboard shown: its top edge. */
  private val frameBottomIme = 1541

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
    // The anchor's bottom plus the gap.
    assertEquals(1763, place(frameBottom = frameBottomAway))
  }

  @Test
  fun anAnchorTheKeyboardLeavesAloneKeepsThatPlacement() {
    assertEquals(
      417,
      place(anchorTop = 300, anchorBottom = 406, frameBottom = frameBottomIme),
    )
  }

  @Test
  fun anAnchorWithNoRoomBelowFlipsAboveItWhileThereIsRoomThere() {
    // Below would end at 2431, past the frame, so the popup goes above the anchor.
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
    // Above the anchor and below it both end behind the keyboard, so the popup rises to the
    // highest edge the frame allows.
    assertEquals(1085, y)
    assertTrue(
      "content from $y sits below the keyboard's own top edge",
      y + contentHeight <= frameBottomIme - marginPx,
    )
  }

  @Test
  fun aKeyboardTakesTheFrameFromBelowRatherThanFromItsTop() {
    // With the keyboard up the frame is already only 1399 px tall: subtracting the 883 px
    // inset from that height counts the keyboard twice.
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
    // The double-subtracted answer.
    assertEquals(60, asAWindowHeight - 883 - marginPx - contentHeight)
  }

  @Test
  fun contentTooTallForTheFrameStartsAtTheFramesTopMargin() {
    // Android gives the popup the height it asked for, so content taller than the frame
    // starts at the frame's top margin.
    assertEquals(
      frameTopPx + marginPx,
      place(contentHeight = 1600, frameBottom = frameBottomIme),
    )
  }

  /**
   * The frame arrives in screen coordinates and the popup is placed in the host window's. The
   * window here is a split-screen one at screen y 1200..2400, so the two differ.
   */
  @Test
  fun theVisibleFrameIsConvertedIntoTheWindowThatHostsThePopover() {
    val windowTopPx = 1200
    val windowLeftPx = 540

    assertEquals(
      PopoverFrame(left = 0, top = 0, right = 540, bottom = 1000),
      PopoverPlacement.windowFrame(
        frameLeft = 540,
        frameTop = 1200,
        frameRight = 1080,
        frameBottom = 2200,
        windowLeft = windowLeftPx,
        windowTop = windowTopPx,
      ),
    )

    val frame =
      PopoverPlacement.windowFrame(
        frameLeft = 0,
        frameTop = 1200,
        frameRight = 1080,
        frameBottom = 2200,
        windowLeft = 0,
        windowTop = windowTopPx,
      )
    assertEquals(
      275,
      PopoverPlacement.placeTop(
        anchorTop = 700,
        anchorBottom = 806,
        contentHeight = contentHeight,
        spacingPx = spacingPx,
        marginPx = marginPx,
        frameTopPx = frame.top,
        frameBottomPx = frame.bottom,
      ),
    )
    // A window at the screen's origin subtracts nothing.
    assertEquals(
      PopoverFrame(0, 142, 1080, 2361),
      PopoverPlacement.windowFrame(
        frameLeft = 0,
        frameTop = 142,
        frameRight = 1080,
        frameBottom = 2361,
        windowLeft = 0,
        windowTop = 0,
      ),
    )
  }

  @Test
  fun thePopupStaysInsideTheFrameHorizontally() {
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
