package com.margelo.nitro.nitroui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

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

    // State a user leaves behind, which no prop re-sends on the next mount.
    model.state.user(true)
    model.state.js = false
    model.state.jsEvents = 3
    model.didApplyDefault = true
    // Test read-outs are per mount, so dirty them too.
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
    assertEquals(null, model.androidIcon)
    assertEquals("", model.sizingKey)
    // Not re-sent by any prop: left behind, the next owner's first write is refused as stale.
    assertEquals(false, model.state.displayed)
    assertEquals(null, model.state.js)
    assertEquals(0, model.state.nativeEvents)
    assertEquals(0, model.state.jsEvents)
    assertEquals(false, model.didApplyDefault)
    assertEquals("displayed=none;probes=0;a11y=none", model.stateReport())
    assertEquals("", model.pixelReport)
  }

  /** The library's `small` is Material's XS and `xxlarge` is its XL. */
  @Test
  fun eachRungAsksForMaterialsOwnGlyphSize() {
    assertEquals(IconButtonDefaultsIcon(20), IconButtonScale.Small.iconSize())
    assertEquals(IconButtonDefaultsIcon(24), IconButtonScale.Medium.iconSize())
    assertEquals(IconButtonDefaultsIcon(24), IconButtonScale.Large.iconSize())
    assertEquals(IconButtonDefaultsIcon(32), IconButtonScale.XLarge.iconSize())
    assertEquals(IconButtonDefaultsIcon(40), IconButtonScale.XXLarge.iconSize())
  }

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

  @Test
  fun aPressFormHasNoSelectionAndAToggleFormCountsItsOwn() {
    val press = IconButtonModel()
    assertEquals(false, press.isToggle)
    assertEquals("displayed=none;probes=0;a11y=none", press.stateReport())

    val toggle = IconButtonModel()
    toggle.isToggle = true
    assertEquals(1, toggle.state.user(true))
    assertEquals(2, toggle.state.user(false))
    assertEquals(2, toggle.state.nativeEvents)
  }

  /** The read is answered with real artwork: a failed read would also end on `Absent`. */
  @Test
  fun aRecycledModelHandsOnAnEmptyGlyphSlotAndRetiresThePreviousOwnersRead() {
    val leaving = WaitingArtwork()
    val model =
      IconButtonModel().apply {
        // A URL this process has not read yet, so the slot is left pending.
        androidIcon = "url:http://localhost:8081/assets/star_24px"
        resolveAndroidIcon(leaving)
      }
    assertEquals(NitroUiIconContent.Pending, model.androidIconContent)

    model.reset()

    assertEquals(
      "a recycled control draws nothing until its own owner resolves",
      NitroUiIconContent.Absent,
      model.androidIconContent,
    )
    assertEquals(
      "and the slot forgets which source that artwork was for",
      null,
      model.iconSlot.resolved,
    )
    // The previous owner's read is still in flight and must not paint after the reset.
    leaving.answerWith(artwork)
    assertEquals(
      "a retired read cannot paint the next owner's control",
      NitroUiIconContent.Absent,
      model.androidIconContent,
    )

    val staying = WaitingArtwork()
    val kept =
      IconButtonModel().apply {
        androidIcon = "url:http://localhost:8081/assets/star_24px"
        resolveAndroidIcon(staying)
      }
    staying.answerWith(artwork)
    assertEquals(
      "the fixture can draw: a read that was not retired does paint",
      true,
      kept.androidIconContent is NitroUiIconContent.Vector,
    )
  }
}

/** An [artwork] whose reads wait for the test to answer them, like a network file does. */
private class WaitingArtwork : NitroUiIconArtwork {
  private var waiting: ((androidx.compose.ui.graphics.vector.ImageVector?) -> Unit)? = null

  override fun forName(name: String): NitroUiIconContent = NitroUiIconContent.Absent

  override fun cached(url: String): androidx.compose.ui.graphics.vector.ImageVector? = null

  override fun knownBad(url: String): Boolean = false

  override fun read(
    url: String,
    onLoaded: (androidx.compose.ui.graphics.vector.ImageVector?) -> Unit,
  ) {
    waiting = onLoaded
  }

  fun answerWith(image: androidx.compose.ui.graphics.vector.ImageVector) {
    waiting?.invoke(image)
    waiting = null
  }
}

/** Artwork the callback can hand back: an empty vector is enough to be *something*. */
private val artwork: androidx.compose.ui.graphics.vector.ImageVector =
  androidx.compose.ui.graphics.vector.ImageVector.Builder(
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
  ).build()

private fun IconButtonDefaultsIcon(value: Int) = value.dp
