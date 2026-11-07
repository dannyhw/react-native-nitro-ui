package com.margelo.nitro.nitroui

import androidx.compose.ui.graphics.vector.ImageVector
import java.io.File
import java.io.FileInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The release path of `androidIcon`, decided where it can be decided (G19 fix
 * round 1, DECISIONS D43 item 2).
 *
 * In a release build, `require('./icons/share_24px.xml')` is not a file anybody
 * reads. The bundler copies the `.xml` into the APK as an ordinary drawable and
 * renames it after its path in the app, so what native is *sent* is that name —
 * `src_assets_icons_share_24px` — and the whole of the release path is two steps:
 *
 *  1. parse the string as a [NitroUiIconSource.Name] rather than a URL, which
 *     `NitroUiIconSourceTest` covers; and
 *  2. ask the resource table for exactly that name, once, and reach the right
 *     state for the answer — which is what this file covers.
 *
 * Step 2 needs `Resources` and a `Bitmap`, so it used to be emulator-only.
 * [NitroUiIconArtwork] takes both out of the room: a model decides *what to ask
 * for* and *what to do with the answer*, and a map answers here. That seam also
 * covers the one failure in this design a device cannot show you — the name JS
 * builds (`androidDrawableNameForAsset`, `src/iconSource.ts`, asserted there
 * against React Native's own `getAndroidResourceIdentifier`) and the name native
 * looks up are one string written in two languages, and they only have to drift
 * once for a release build to draw no icon at all.
 *
 * The development half is in here too, because it shares the model: a `url:`
 * string must never reach the resource table, and a load must not be answered
 * into a control that has moved on.
 */
class NitroUiIconReleasePathTest {
  /** What the wrapper sends for `example/src/assets/icons/share_24px.xml` in a release build. */
  private val bundledShare = "src_assets_icons_share_24px"

  /** A second asset's name, so "looked something up" cannot mean "looked up the same thing twice". */
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

  /**
   * Two assets are two lookups; one asset re-sent is one.
   *
   * React re-sends every prop on every commit, so the guard behind
   * [ButtonModel.resolveAndroidIcon] is the only thing between a re-render and a
   * `synchronized` resource-table hit per Button per frame. Dropping it is a
   * regression no screenshot shows, which is why the count is asserted and not
   * just the final state.
   */
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

    // A different asset is a different question, asked once as well.
    model.androidIcon = bundledStar
    model.resolveAndroidIcon(artwork)
    model.resolveAndroidIcon(artwork)
    assertEquals(listOf(bundledShare, bundledStar), artwork.asked)
  }

  /**
   * Round 1's rule, which D43 leaves alone: artwork that cannot be resolved draws
   * nothing *and reserves nothing*, so the control is exactly its no-icon self.
   * [NitroUiIconContent.Pending] is the only state that reserves an empty slot,
   * and only a file in flight ever reaches it.
   */
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

  /**
   * The development form never touches the resource table.
   *
   * A `url:` string read as a name asks the table for `url:http://…`, answers 0,
   * and logs about a resource name nobody wrote — the failure mode
   * `NitroUiIconSourceTest` describes, and this is its other half.
   */
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

  /** The slot arrives empty and keeps its size; only its contents change. */
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

    // The next control to ask is answered from the failure the artwork remembers
    // (`NitroUiIconFiles.knownBad`), which the fake models.
    artwork.knownBad = setOf(url)
    val second = ButtonModel().apply { androidIcon = "url:$url" }
    second.resolveAndroidIcon(artwork)
    assertEquals(NitroUiIconContent.Absent, second.androidIconContent)
    assertEquals("and it is not read a second time", 1, artwork.read.size)
  }

  /**
   * A recycled control cannot be painted by the previous owner's in-flight load.
   *
   * Recycling is a [reset] plus a fresh set of props, and the old read is still
   * running on the icon thread by the time the new props land. The generation
   * counter is what retires it; without it, a scrolled list shows the row that
   * used to occupy the cell.
   */
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

  /** An icon this process has already read draws in the frame the control mounts. */
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

  /** The string with no icon in it is the absence of an icon, not a lookup of `""`. */
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

  /**
   * A resource table and a file reader a JVM test can see into.
   *
   * [forName] answers a hit with [NitroUiIconContent.Vector] rather than
   * [NitroUiIconContent.Bitmap]: `Bitmap.createBitmap` is a stub on the JVM, and
   * the two variants differ in *how the artwork is painted*, which is not what is
   * under test — the name asked for and the state reached are. The Bitmap arm is
   * the two lines around it and is covered on the emulator, in
   * `example/__tests__/Button.harness.tsx`.
   */
  /**
   * The same rules on the Menu's trigger (G19 fix round 2, item 4).
   *
   * A Menu that gained the prop but resolved it differently from `Button` would draw
   * a glyph with a different lifecycle than the control it is documented to be the
   * same as: resolved in the wrong place, reserved too late, or — the one a device
   * cannot show you — answered into a recycled control by its previous owner's load.
   * Both models read [NitroUiIconSlot], so these three lines are the proof that Menu
   * really goes through it rather than past it.
   */
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

    // The trigger is Button's box, so it has Button's no-icon answer when the name is
    // not in the table: nothing drawn, nothing reserved.
    val missing = MenuModel().apply { androidIcon = bundledStar }
    missing.resolveAndroidIcon(artwork)
    assertEquals(NitroUiIconContent.Absent, missing.androidIconContent)
  }

  /** A Menu with no glyph asks for nothing at all, prop or file. */
  @Test
  fun aMenuWithNoIconAsksForNothing() {
    val artwork = FakeArtwork(drawables = setOf(bundledShare))
    val menu = MenuModel()

    menu.resolveAndroidIcon(artwork)

    assertEquals(NitroUiIconContent.Absent, menu.androidIconContent)
    assertEquals(emptyList<String>(), artwork.asked)
    assertEquals(emptyList<String>(), artwork.read)
  }

  /**
   * The recycle rule, on the control that did not have an icon until now.
   *
   * A Menu is recycled by the same sizing engine as everything else, and its file
   * load answers frames later — by which time the trigger may belong to a row with a
   * different glyph. [NitroUiIconSlot.reset] is what retires the old answer, and the
   * generation counter means the row shows its own icon or none, never the last
   * owner's.
   */
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

    /** The URLs handed to a read, in order. */
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
