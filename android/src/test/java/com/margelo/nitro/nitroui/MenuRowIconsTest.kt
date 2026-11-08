package com.margelo.nitro.nitroui

import androidx.compose.ui.graphics.vector.ImageVector
import java.io.File
import java.io.FileInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for [MenuRowIcons] (G21): the rows' `androidIcon`s as one slot per row.
 *
 * The device harness proves a glyph reaches the screen (`Menu.harness.tsx`); this proves
 * the half an emulator cannot see clearly - *how often* a name is looked up and *when* a
 * file load is retired. Both are perf-contract items rather than drawing ones: a lookup
 * per row per unrelated prop (AGENTS) and a recycled menu painted by its previous
 * owner's in-flight read are the two ways this class is wrong without any pixel
 * disagreeing on the day it is introduced.
 */
class MenuRowIconsTest {
  private fun rowsOf(
    vararg pairs: Pair<String, String?>,
  ): List<Pair<String, String?>> = pairs.toList()

  @Test
  fun `a row's name reaches its own slot and an absent row draws nothing`() {
    val artwork = FakeRowArtwork(setOf("share_24px", "star_24px"))
    val icons = MenuRowIcons()
    icons.apply(rowsOf("share" to "share_24px", "star" to "star_24px", "plain" to null), artwork)

    assertTrue("share", icons.contentOf("share") is NitroUiIconContent.Vector)
    assertTrue("star", icons.contentOf("star") is NitroUiIconContent.Vector)
    assertEquals(
      "a row with no androidIcon is the row's no-icon self, not an empty slot",
      NitroUiIconContent.Absent,
      icons.contentOf("plain"),
    )
    assertEquals(
      "a row nobody named has no slot either",
      NitroUiIconContent.Absent,
      icons.contentOf("nobody"),
    )
    // The row that asks is the row that draws: one shared slot would put one glyph in
    // both rows, and one row's late file would overwrite the other's.
    assertTrue(
      "two rows, two slots",
      icons.slots.getValue("share") !== icons.slots.getValue("star"),
    )
  }

  @Test
  fun `an unchanged menu changes nothing and a changed row resolves once`() {
    val artwork = FakeRowArtwork(setOf("share_24px", "star_24px"))
    val icons = MenuRowIcons()

    icons.apply(rowsOf("share" to "share_24px", "star" to "star_24px"), artwork)
    assertEquals("one lookup per row that asked", listOf("share_24px", "star_24px"), artwork.asked)
    val published = icons.slots

    // A re-sent menu - the same rows, the same order, which is what every unrelated prop
    // batch hands `afterUpdate()`. Two rules make that cheap, and this is both: each row
    // kept its slot, so `resolve` sees a source it already holds and asks the resource
    // table nothing, and the map it publishes is equal to the one it replaces, which
    // `mutableStateOf` refuses to write. A menu that handed every row a new slot per
    // commit would reload every glyph for a change that did not happen.
    icons.apply(rowsOf("share" to "share_24px", "star" to "star_24px"), artwork)
    assertSame(
      "an unchanged menu writes no state and resolves nothing",
      published,
      icons.slots,
    )
    assertEquals("and asks the resource table nothing new", 2, artwork.asked.size)

    // One row changes icon: exactly one new lookup, and the row that did not change is
    // not asked twice.
    icons.apply(rowsOf("share" to "star_24px", "star" to "star_24px"), artwork)
    assertEquals(
      "only the row that changed is looked up",
      listOf("share_24px", "star_24px", "star_24px"),
      artwork.asked,
    )
  }

  @Test
  fun `a row that keeps its icon keeps its slot and its loaded artwork`() {
    val artwork = FakeRowArtwork(setOf("share_24px"))
    val icons = MenuRowIcons()
    icons.apply(rowsOf("share" to "share_24px", "cut" to null), artwork)
    val before = icons.slots["share"]
    val load = WaitingRowArtwork()
    icons.apply(rowsOf("share" to "share_24px", "copy" to "url:http://localhost:8081/star"), load)

    assertSame(
      "the row that kept its name kept its slot, so its glyph is drawn in the first frame",
      before,
      icons.slots["share"],
    )
    assertEquals(
      "and keeping it means no second lookup",
      listOf("share_24px"),
      artwork.asked,
    )
    assertEquals(
      "the new row's file is on its way, and reserves its slot while it is",
      NitroUiIconContent.Pending,
      icons.contentOf("copy"),
    )
  }

  @Test
  fun `a row that stops existing retires its file load`() {
    val load = WaitingRowArtwork()
    val icons = MenuRowIcons()
    icons.apply(rowsOf("copy" to "url:http://localhost:8081/star"), load)
    assertEquals(NitroUiIconContent.Pending, icons.contentOf("copy"))
    // The slot itself, held past the menu that owned it: dropping it from the map hides
    // the bug rather than proving it gone, because the load still holds this object and
    // answers to it. A dropped-but-not-retired slot is artwork alive after its view.
    val orphan = icons.slots.getValue("copy")

    // The row is gone from the menu - a re-sent group with one row less.
    icons.apply(rowsOf("paste" to null), load)
    assertEquals(NitroUiIconContent.Absent, icons.contentOf("copy"))

    // The read lands, one frame late, for a row that no longer exists.
    load.answerWith(artworkImage)
    assertEquals(
      "a retired read cannot paint a row the menu no longer has",
      NitroUiIconContent.Absent,
      orphan.content,
    )
  }

  @Test
  fun `a name the resource table does not know draws nothing but reserves nothing`() {
    val artwork = FakeRowArtwork(setOf("share_24px"))
    val icons = MenuRowIcons()
    icons.apply(rowsOf("typo" to "shar_24px"), artwork)
    assertEquals(
      "a typo is the absence of an icon, not a gap in the row",
      NitroUiIconContent.Absent,
      icons.contentOf("typo"),
    )
    assertEquals("and it was asked for exactly once", listOf("shar_24px"), artwork.asked)
  }

  @Test
  fun `reset hands the next owner an empty menu`() {
    val artwork = FakeRowArtwork(setOf("share_24px"))
    val load = WaitingRowArtwork()
    val icons = MenuRowIcons()
    icons.apply(rowsOf("share" to "share_24px"), artwork)
    icons.apply(rowsOf("copy" to "url:http://localhost:8081/star"), load)
    icons.noteTint("share", androidx.compose.ui.graphics.Color(0xFF12_34_56))
    val orphan = icons.slots.getValue("copy")

    icons.reset()
    assertEquals("no row has a slot", emptyMap<String, NitroUiIconSlot>(), icons.slots)
    assertEquals(NitroUiIconContent.Absent, icons.contentOf("share"))
    assertEquals("no tint is left to read", "-", icons.tintsReport())

    // A recycled menu answers for its next owner, so the previous owner's read that was
    // still in flight must not paint this one.
    load.answerWith(artworkImage)
    assertEquals("the retired slot draws nothing", NitroUiIconContent.Absent, icons.contentOf("copy"))
    assertEquals("and holds no artwork", NitroUiIconContent.Absent, orphan.content)

    // And the same menu, given the list it had just before the recycle, resolves it again:
    // [apply]'s "already asked for exactly this" guard has to be forgotten by `reset`, or
    // the next owner of this view is handed a menu with no icons in it forever. The same
    // list, in the same order, deliberately - that is exactly what the guard is keyed on.
    icons.apply(rowsOf("copy" to "url:http://localhost:8081/star"), load)
    assertEquals(
      "the recycled menu resolves what it is handed, again",
      NitroUiIconContent.Pending,
      icons.contentOf("copy"),
    )
    assertEquals("and the previous owner's artwork stayed behind", listOf("share_24px"), artwork.asked)
  }

  @Test
  fun `a tint is reported per row and only for the rows that drew`() {
    val icons = MenuRowIcons()
    assertEquals("no row has drawn yet", "-", icons.tintsReport())

    icons.noteTint("copy", androidx.compose.ui.graphics.Color(0xFF12_34_56))
    icons.noteTint("paste", androidx.compose.ui.graphics.Color(0xFFAB_CD_EF))
    val report = icons.tintsReport()
    assertTrue("both rows are named, with their colour: $report", report.contains("copy#123456"))
    assertTrue("both rows are named, with their colour: $report", report.contains("paste#ABCDEF"))
    assertEquals("one entry per row", 2, report.split(",").size)

    // The last colour a row drew with is the one reported - a row that redrew disabled
    // must not report the enabled tint it drew first.
    icons.noteTint("copy", androidx.compose.ui.graphics.Color(0xFF00_00_00))
    assertEquals(
      "the tint a row last drew is the one reported",
      "000000",
      icons.tintsReport().split(",").first { it.startsWith("copy#") }.substringAfter("#"),
    )
  }
}

/** Artwork that answers names from a set, and counts every lookup - the number a test asserts on. */
private class FakeRowArtwork(
  private val drawables: Set<String>,
) : NitroUiIconArtwork {
  /** The names handed to the resource table, in order, duplicates included. */
  val asked = mutableListOf<String>()

  override fun forName(
    name: String,
  ): NitroUiIconContent {
    asked += name
    return if (name in drawables) {
      NitroUiIconContent.Vector(artworkImage)
    } else {
      NitroUiIconContent.Absent
    }
  }

  override fun cached(
    url: String,
  ): ImageVector? = null

  override fun knownBad(
    url: String,
  ): Boolean = false

  override fun read(
    url: String,
    onLoaded: (ImageVector?) -> Unit,
  ) {
    onLoaded(null)
  }
}

/** Artwork whose reads wait for the test to answer them, like a dev-server file does. */
private class WaitingRowArtwork : NitroUiIconArtwork {
  private var waiting: ((ImageVector?) -> Unit)? = null

  override fun forName(
    name: String,
  ): NitroUiIconContent = NitroUiIconContent.Absent

  override fun cached(
    url: String,
  ): ImageVector? = null

  override fun knownBad(
    url: String,
  ): Boolean = false

  override fun read(
    url: String,
    onLoaded: (ImageVector?) -> Unit,
  ) {
    waiting = onLoaded
  }

  fun answerWith(
    image: ImageVector,
  ) {
    waiting?.invoke(image)
    waiting = null
  }
}

/** Real artwork, from the same Material Symbols file the release-path test reads. */
private val artworkImage: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
  val path =
    listOf(
      "../example/src/assets/icons/share_24px.xml",
      "example/src/assets/icons/share_24px.xml",
    ).map { File(it) }.firstOrNull { it.isFile }
      ?: throw AssertionError("no example asset to build artwork from")
  NitroUiVectorDrawableReader.read(FileInputStream(path)).toImageVector("share")
}
