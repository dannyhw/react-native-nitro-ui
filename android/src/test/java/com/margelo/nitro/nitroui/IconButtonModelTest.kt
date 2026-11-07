package com.margelo.nitro.nitroui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * JVM unit test for the two IconButton rules the device cannot see (G23).
 *
 * The first is the recycle reset, for Button's reason two doors up: the wrapper sends
 * every prop on every mount (`IconButton.tsx` has no optional native prop — DECISIONS D7 /
 * nitro#1184), so a recycled control re-receives `variant`, `size`, `shape`, the glyph
 * names and both callbacks anyway, and a line missing from [IconButtonModel.reset]
 * changes nothing the screen can show. `prepareForRecycle` on iOS and this reset are the
 * two copies of that line, and this is the only one a test can reach. What makes the
 * assertion worth writing rather than ceremonial: the reset also zeroes the
 * handshake's **event counts** and the `didApplyDefault` one-shot, and those are *not*
 * props a mount re-sends with a fresh value — a second owner controlled at `false` is
 * refused as stale if they survive (core-architecture §4). `Conformance.harness.tsx`'s
 * `controlledProbe` reads that on a device; the lines here are what say *which* field
 * was missing when it goes red.
 *
 * The second is the ladder. Every container, glyph and corner in the control is read
 * from a Material 3 token through [IconButtonScale], so the one thing this file decides
 * is which rung asks for which token. Get that mapping wrong by one rung and no
 * measurement says "you meant the token above": the control is simply a different size,
 * and `docs/components/icon-button.md`'s table, the screenshots and the fallback all
 * move with it. So the glyph numbers — the half reachable without a composition — are
 * written out beside the rung names.
 */
class IconButtonModelTest {
  @Test
  fun aRecycledModelForgetsTheSelectionTheHandshakeAndTheGlyphNamesWithIt() {
    val model =
      IconButtonModel().apply {
        accessibilityLabel = "Bookmark"
        variant = IconButtonVariant.Outlined
        scale = IconButtonScale.XXLarge
        width = IconButtonWidth.Narrow
        corner = IconButtonCorner.Square
        enabled = false
        isToggle = true
        displayed = true
        tintColor = 0x11223344
        systemImage = "bookmark.fill"
        androidIcon = "nitroui_test_star"
        sizingKey = "outlined|xxlarge|narrow|bookmark.fill|nitroui_test_star"
      }

    // The state a *user* leaves behind, which is the state a reset exists to clear:
    // a selection native chose for itself, one reported event, and the one-shot that
    // stops `defaultChecked` applying twice.
    model.state.user(true)
    model.state.js = false
    model.state.jsEvents = 3
    model.didApplyDefault = true
    // The read-outs a harness reads, dirtied too: they are per-mount claims about
    // *this* control, and `probes` is how a test tells its own accessibility answer
    // from the previous owner's.
    model.recordDrawn("1")
    model.recordAccessibility("desc=Bookmark;checked=true")
    model.publishPixelReport("hits=99")

    model.reset()

    assertEquals(IconButtonVariant.Standard, model.variant)
    assertEquals(IconButtonScale.Medium, model.scale)
    assertEquals(IconButtonWidth.Uniform, model.width)
    assertEquals(IconButtonCorner.Round, model.corner)
    assertEquals(true, model.enabled)
    assertEquals(false, model.isToggle)
    assertEquals(false, model.displayed)
    assertEquals(null, model.tintColor)
    assertEquals(null, model.accessibilityLabel)
    assertEquals(null, model.systemImage)
    // The name is one half of the resolved glyph; the parsed drawable behind it is the
    // other, and the JVM cannot build one (see `NitroUiIconTest`). On a device,
    // `HybridNitroUiIconButton`'s own line clears the slot that holds it, and
    // `Conformance.harness.tsx` is where a recycled control is shown not to draw it.
    assertEquals(null, model.androidIcon)
    assertEquals("", model.sizingKey)
    // The half no prop re-sends. Left behind, the second owner's first write is refused
    // as stale and the control shows the previous app's selection.
    assertEquals(false, model.state.displayed)
    assertEquals(null, model.state.js)
    assertEquals(0, model.state.nativeEvents)
    assertEquals(0, model.state.jsEvents)
    assertEquals(false, model.didApplyDefault)
    // The test read-outs, too: a report is about *this* mount, and `probes` is how a
    // harness tells its own accessibility answer from the previous owner's.
    assertEquals("displayed=none;probes=0;a11y=none", model.stateReport())
    assertEquals("", model.pixelReport)
  }

  /**
   * The rung → token mapping, for the glyph sizes.
   *
   * Material's own icon-button table (Q9 C4), spelled in the library's rung names:
   * `small` is XS and `xxlarge` is XL. `containerSize` is a `@Composable` (the widths
   * are read from the theme), so it is measured on a device —
   * `example/__tests__/IconButton.harness.tsx` measures the laid-out grid.
   */
  @Test
  fun eachRungAsksForMaterialsOwnGlyphSize() {
    assertEquals(IconButtonDefaultsIcon(20), IconButtonScale.Small.iconSize())
    assertEquals(IconButtonDefaultsIcon(24), IconButtonScale.Medium.iconSize())
    assertEquals(IconButtonDefaultsIcon(24), IconButtonScale.Large.iconSize())
    assertEquals(IconButtonDefaultsIcon(32), IconButtonScale.XLarge.iconSize())
    assertEquals(IconButtonDefaultsIcon(40), IconButtonScale.XXLarge.iconSize())
  }

  /**
   * Every wire name has exactly one rung, variant, width and corner, and an
   * unrecognised one falls to the documented default rather than to nothing.
   *
   * The wrapper resolves these too, so a drift between the two is a control that draws
   * one thing on iOS and another on Android — the JS side has its own test for the
   * same table (`src/__tests__/iconButton.test.tsx`).
   */
  @Test
  fun anUnrecognisedNameFallsToTheDocumentedDefault() {
    assertEquals(IconButtonScale.Small, IconButtonScale.from("small"))
    assertEquals(IconButtonScale.Medium, IconButtonScale.from("medium"))
    assertEquals(IconButtonScale.Large, IconButtonScale.from("large"))
    assertEquals(IconButtonScale.XLarge, IconButtonScale.from("xlarge"))
    assertEquals(IconButtonScale.XXLarge, IconButtonScale.from("xxlarge"))
    assertEquals(IconButtonScale.Medium, IconButtonScale.from("huge"))
    assertEquals(IconButtonScale.Medium, IconButtonScale.from(""))

    assertEquals(IconButtonVariant.Filled, IconButtonVariant.from("filled"))
    assertEquals(IconButtonVariant.Tonal, IconButtonVariant.from("tonal"))
    assertEquals(IconButtonVariant.Outlined, IconButtonVariant.from("outlined"))
    assertEquals(IconButtonVariant.Standard, IconButtonVariant.from("text"))

    assertEquals(IconButtonWidth.Narrow, IconButtonWidth.from("narrow"))
    assertEquals(IconButtonWidth.Wide, IconButtonWidth.from("wide"))
    assertEquals(IconButtonWidth.Uniform, IconButtonWidth.from("widest"))

    assertEquals(IconButtonCorner.Square, IconButtonCorner.from("square"))
    assertEquals(IconButtonCorner.Round, IconButtonCorner.from("pill"))
  }

  /** An `IconButton` is a press and an `IconToggleButton` is a toggle: `isToggle` is the switch. */
  @Test
  fun aPressFormHasNoSelectionAndAToggleFormCountsItsOwn() {
    val press = IconButtonModel()
    assertEquals(false, press.isToggle)
    assertEquals("displayed=none;probes=0;a11y=none", press.stateReport())

    val toggle = IconButtonModel()
    toggle.isToggle = true
    // The count is what the handshake refuses a stale write with, so it has to move
    // once per *user* flip and no more.
    assertEquals(1, toggle.state.user(true))
    assertEquals(2, toggle.state.user(false))
    assertEquals(2, toggle.state.nativeEvents)
  }
}

/** One of Material's glyph sizes, spelled so a failure reads as "20 dp, not 24". */
private fun IconButtonDefaultsIcon(value: Int) = value.dp
