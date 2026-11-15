package com.margelo.nitro.nitroui

import androidx.compose.ui.graphics.vector.ImageVector
import java.io.File
import java.io.FileInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NitroUiIconReleasePathTest {
  /** What the wrapper sends for `example/src/assets/icons/share_24px.xml` in a release build. */
  private val bundledShare = "src_assets_icons_share_24px"

  private val bundledStar = "src_assets_icons_star_24px"

  @Test
  fun aBundledAssetIsLookedUpUnderTheNameMetroFiledItUnder() {
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val model = ButtonModel().apply { androidIcon = bundledShare }

    model.resolveAndroidIcon(artwork)

    assertEquals(
      "the resource table is asked for the name the wrapper built, character for character",
      listOf(bundledShare),
      artwork.asked,
    )
    assertTrue(
      "and the Button draws it",
      model.androidIconContent is NitroUiIconContent.Vector,
    )
  }

  @Test
  fun aCommitThatSendsTheSameIconAgainAsksTheResourceTableOnce() {
    val artwork = FakeArtwork(drawables = setOf(bundledShare, bundledStar))
    val model = ButtonModel()

    model.resolveAndroidIcon(artwork)
    assertEquals("no prop, no lookup", emptyList<String>(), artwork.asked)

    model.androidIcon = bundledShare
    model.resolveAndroidIcon(artwork)
    model.resolveAndroidIcon(artwork)
    model.resolveAndroidIcon(artwork)
    assertEquals(listOf(bundledShare), artwork.asked)

    model.androidIcon = bundledStar
    model.resolveAndroidIcon(artwork)
    model.resolveAndroidIcon(artwork)
    assertEquals(listOf(bundledShare, bundledStar), artwork.asked)
  }

  @Test
  fun aBundledNameThatIsNotInTheTableDrawsNothingAndReservesNothing() {
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val model = ButtonModel().apply { androidIcon = "src_assets_icons_gone_24px" }

    model.resolveAndroidIcon(artwork)

    assertEquals(NitroUiIconContent.Absent, model.androidIconContent)
    assertEquals(
      "a miss is still a question that was asked",
      listOf("src_assets_icons_gone_24px"),
      artwork.asked,
    )
  }

  @Test
  fun aDevServerIconIsNeverAskedOfTheResourceTable() {
    val url = "http://10.0.2.2:8081/src/assets/icons/share_24px.xml?platform=android&hash=abc"
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val model = ButtonModel().apply { androidIcon = "url:$url" }

    model.resolveAndroidIcon(artwork)

    assertEquals(
      "the resource table is not consulted",
      emptyList<String>(),
      artwork.asked,
    )
    assertEquals(
      "the slot is reserved while the file is read",
      NitroUiIconContent.Pending,
      model.androidIconContent,
    )
    assertEquals(listOf(url), artwork.read)
  }

  @Test
  fun aDevLoadFillsTheSlotItReservedAndAnAnswerOfNothingClearsIt() {
    val url = "http://10.0.2.2:8081/a.xml"
    val artwork = FakeArtwork(drawables = emptySet())
    val model = ButtonModel().apply { androidIcon = "url:$url" }

    model.resolveAndroidIcon(artwork)
    assertEquals(NitroUiIconContent.Pending, model.androidIconContent)

    artwork.answerWith(null)
    assertEquals(
      "a 404 is round 1's missing-name answer, not a permanently empty box",
      NitroUiIconContent.Absent,
      model.androidIconContent,
    )

    // A later control is answered from the remembered failure, without a second read.
    artwork.knownBad = setOf(url)
    val second = ButtonModel().apply { androidIcon = "url:$url" }
    second.resolveAndroidIcon(artwork)
    assertEquals(NitroUiIconContent.Absent, second.androidIconContent)
    assertEquals("and it is not read a second time", 1, artwork.read.size)
  }

  @Test
  fun anAnswerToALoadRetiredByRecycleIsDropped() {
    val old = "http://10.0.2.2:8081/old.xml"
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val model = ButtonModel().apply { androidIcon = "url:$old" }
    model.resolveAndroidIcon(artwork)
    assertEquals(NitroUiIconContent.Pending, model.androidIconContent)

    model.reset()
    model.androidIcon = bundledShare
    model.resolveAndroidIcon(artwork)
    assertTrue(model.androidIconContent is NitroUiIconContent.Vector)

    artwork.answerWith(null)
    artwork.answerWith(artwork.image)
    assertTrue(
      "the retired load cannot overwrite the recycled Button's own icon",
      model.androidIconContent is NitroUiIconContent.Vector,
    )
  }

  @Test
  fun anAlreadyReadFileIsDrawnWithoutWaiting() {
    val url = "http://10.0.2.2:8081/cached.xml"
    val artwork = FakeArtwork(drawables = emptySet())
    artwork.cachedUrls = setOf(url)
    val model = ButtonModel().apply { androidIcon = "url:$url" }

    model.resolveAndroidIcon(artwork)

    assertTrue(model.androidIconContent is NitroUiIconContent.Vector)
    assertEquals("no read for something already in hand", emptyList<String>(), artwork.read)
  }

  @Test
  fun noIconAsksForNothing() {
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val model = ButtonModel().apply {
      androidIcon = bundledShare
      resolveAndroidIcon(artwork)
    }

    model.reset()
    model.resolveAndroidIcon(artwork)

    assertNull(model.androidIcon)
    assertEquals(NitroUiIconContent.Absent, model.androidIconContent)
    assertEquals(
      "reset, then the same name written again, is still one lookup",
      listOf(bundledShare),
      artwork.asked,
    )
  }

  @Test
  fun aMenuTriggerResolvesTheNameExactlyAsAButtonDoes() {
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val menu = MenuModel().apply { androidIcon = bundledShare }

    menu.resolveAndroidIcon(artwork)

    assertEquals(listOf(bundledShare), artwork.asked)
    assertTrue(
      "and the trigger has artwork to draw",
      menu.androidIconContent is NitroUiIconContent.Vector
    )

    val missing = MenuModel().apply { androidIcon = bundledStar }
    missing.resolveAndroidIcon(artwork)
    assertEquals(NitroUiIconContent.Absent, missing.androidIconContent)
  }

  @Test
  fun aMenuWithNoIconAsksForNothing() {
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val menu = MenuModel()

    menu.resolveAndroidIcon(artwork)

    assertEquals(NitroUiIconContent.Absent, menu.androidIconContent)
    assertEquals(emptyList<String>(), artwork.asked)
    assertEquals(emptyList<String>(), artwork.read)
  }

  @Test
  fun aMenuRecycleRetiresThePreviousOwnersFileLoad() {
    val old = "http://10.0.2.2:8081/old.xml"
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val menu = MenuModel().apply { androidIcon = "url:$old" }

    menu.resolveAndroidIcon(artwork)
    assertEquals(NitroUiIconContent.Pending, menu.androidIconContent)

    menu.reset()
    menu.androidIcon = bundledShare
    menu.resolveAndroidIcon(artwork)
    assertTrue(menu.androidIconContent is NitroUiIconContent.Vector)

    artwork.answerWith(artwork.image)
    assertTrue(
      "the retired load cannot overwrite the recycled Menu's own glyph",
      menu.androidIconContent is NitroUiIconContent.Vector
    )
    assertEquals(
      "and a recycled Menu clears the prop it was given, like every other field",
      null,
      MenuModel().apply {
        androidIcon = bundledShare
        resolveAndroidIcon(artwork)
        reset()
      }.androidIcon
    )
  }

  private class FakeArtwork(
    private val drawables: Set<String>,
  ) : NitroUiIconArtwork {
    /** The names handed to the resource table, in order, duplicates included. */
    val asked = mutableListOf<String>()

    val read = mutableListOf<String>()

    var knownBad: Set<String> = emptySet()

    /** The URLs this process has already read — [image] stands in for their artwork. */
    var cachedUrls: Set<String> = emptySet()

    private val waiting = mutableListOf<(ImageVector?) -> Unit>()

    /** Real artwork: the same Material Symbols file whose name the wrapper builds. */
    val image: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
      val path =
        listOf(
          "../example/src/assets/icons/share_24px.xml",
          "example/src/assets/icons/share_24px.xml",
        ).map { File(it) }.firstOrNull { it.isFile }
          ?: throw AssertionError("no example asset to build artwork from")
      NitroUiVectorDrawableReader.read(FileInputStream(path)).toImageVector("share")
    }

    override fun forName(
      name: String,
    ): NitroUiIconContent {
      asked += name
      return if (name in drawables) NitroUiIconContent.Vector(image) else NitroUiIconContent.Absent
    }

    override fun cached(
      url: String,
    ): ImageVector? = image.takeIf { url in cachedUrls }

    override fun knownBad(
      url: String,
    ): Boolean = url in knownBad

    override fun read(
      url: String,
      onLoaded: (ImageVector?) -> Unit,
    ) {
      read += url
      waiting += onLoaded
    }

    /** Deliver what a dev server would answer, on the calling thread. */
    fun answerWith(result: ImageVector?) {
      val pending = waiting.toList()
      waiting.clear()
      pending.forEach { it(result) }
    }
  }
}
