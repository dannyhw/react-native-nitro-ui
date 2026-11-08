package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for where the Popover's popup may put its content.
 *
 * The Android half of D44 item 1 is "the content stays above the keyboard", and the number
 * that decides it is arithmetic: the anchor's edges, the composed height, the window's
 * margins and the keyboard's inset. A device run can only read the result afterwards - the
 * real-input check measures the field's box once the keyboard is already up - so the rule
 * that decides it lives here, where it can be run against the geometry a device produced.
 *
 * The fixtures are that geometry, from a Pixel 9 AVD at 1080x2424 (the 16 dp margin is 42 px
 * and the 4 dp gap 8 px at 420 dpi) with `com.google.android.inputmethod.latin` on screen:
 * its inset is 883 px, so the keyboard's top edge is 1541 and the popup may put nothing below
 * 1499. The anchor is the button that opens the popover with a field in it, which the
 * keyboard covers - the case the first version of [PopoverPlacement] got wrong, because
 * flipping the popup above an anchor that is itself behind the keyboard leaves the popup's
 * lower edge under the keys: 1,228 there put 143 px of content behind them.
 */
class PopoverPlacementTest {
  private val windowHighPx = 2424
  private val marginPx = 42
  private val spacingPx = 8

  /** The measured keyboard: 883 px of inset, so a top edge of 1541. */
  private val imePx = 883

  @Test
  fun theKeyboardMovesTheLowestEdgeThePopupMayUseUpToItsOwnTop() {
    assertEquals(2382, PopoverPlacement.usableBottom(windowHighPx, 0, marginPx))
    assertEquals(1499, PopoverPlacement.usableBottom(windowHighPx, imePx, marginPx))
  }

  @Test
  fun withTheKeyboardAwayThePopupSitsBelowItsAnchor() {
    val y =
      PopoverPlacement.placeTop(
        anchorTop = 300,
        anchorBottom = 400,
        contentHeight = 414,
        spacingPx = spacingPx,
        marginPx = marginPx,
        usableBottom = PopoverPlacement.usableBottom(windowHighPx, 0, marginPx),
      )
    assertEquals(408, y)
  }

  @Test
  fun aKeyboardThatLeavesRoomBelowChangesNothing() {
    // The same anchor high on the screen: 408 + 414 is 822, well above the keyboard's top,
    // so the popup keeps the placement it had without the keyboard.
    val y =
      PopoverPlacement.placeTop(
        anchorTop = 300,
        anchorBottom = 400,
        contentHeight = 414,
        spacingPx = spacingPx,
        marginPx = marginPx,
        usableBottom = PopoverPlacement.usableBottom(windowHighPx, imePx, marginPx),
      )
    assertEquals(408, y)
  }

  @Test
  fun anAnchorWithNoRoomBelowFlipsAboveItWhileThereIsRoomThere() {
    val y =
      PopoverPlacement.placeTop(
        anchorTop = 1900,
        anchorBottom = 2000,
        contentHeight = 414,
        spacingPx = spacingPx,
        marginPx = marginPx,
        usableBottom = PopoverPlacement.usableBottom(windowHighPx, 0, marginPx),
      )
    assertEquals(1478, y)
  }

  @Test
  fun anAnchorBehindTheKeyboardDoesNotFlipThePopupIntoIt() {
    val usableBottom = PopoverPlacement.usableBottom(windowHighPx, imePx, marginPx)
    val y =
      PopoverPlacement.placeTop(
        anchorTop = 1650,
        anchorBottom = 1748,
        contentHeight = 414,
        spacingPx = spacingPx,
        marginPx = marginPx,
        usableBottom = usableBottom,
      )
    // Above the anchor would be 1228 - 143 px of the popup behind the keys. The popup moves
    // further up instead, so the whole content stays above the keyboard's own top edge.
    assertEquals(1085, y)
    assertTrue(
      "content reaching $y-plus-height sits below the keyboard's top edge",
      y + 414 <= usableBottom,
    )
  }

  @Test
  fun contentTooTallToClearTheKeyboardStartsAtTheTopMargin() {
    // Android hands the popup the height it asked for, so nothing moves the content fully
    // clear; top-aligned is the part of it the user can still reach.
    val y =
      PopoverPlacement.placeTop(
        anchorTop = 300,
        anchorBottom = 400,
        contentHeight = 1600,
        spacingPx = spacingPx,
        marginPx = marginPx,
        usableBottom = PopoverPlacement.usableBottom(windowHighPx, imePx, marginPx),
      )
    assertEquals(marginPx, y)
  }
}
