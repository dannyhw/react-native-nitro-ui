package com.margelo.nitro.nitroui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import java.io.File
import java.io.FileInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

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

    // The same rows re-sent, as every unrelated props batch does.
    icons.apply(rowsOf("share" to "share_24px", "star" to "star_24px"), artwork)
    assertSame(
      "an unchanged menu writes no state and resolves nothing",
      published,
      icons.slots,
    )
    assertEquals("and asks the resource table nothing new", 2, artwork.asked.size)

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
    // Keep the slot itself: the in-flight load still holds it after the row is gone.
    val orphan = icons.slots.getValue("copy")

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

    load.answerWith(artworkImage)
    assertEquals("the retired slot draws nothing", NitroUiIconContent.Absent, icons.contentOf("copy"))
    assertEquals("and holds no artwork", NitroUiIconContent.Absent, orphan.content)

    // The same list again must resolve again: `reset` has to clear the "already applied" guard.
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

    icons.noteTint("copy", androidx.compose.ui.graphics.Color(0xFF00_00_00))
    assertEquals(
      "the tint a row last drew is the one reported",
      "000000",
      icons.tintsReport().split(",").first { it.startsWith("copy#") }.substringAfter("#"),
    )
  }
}

/** Artwork that answers names from a set and counts every lookup. */
private class FakeRowArtwork(
  private val drawables: Set<String>,
) : NitroUiIconArtwork {
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

// Never run: it only has to compile. It calls [MenuRow] without either icon parameter,
// so removing a default from the signature breaks the build.
@Composable
internal fun overflowRowCompilesWithoutTheIconParameters(
  item: MenuActionItem,
  onPick: () -> Unit,
) {
  MenuRow(
    item = item,
    index = 0,
    count = 1,
    groupEnabled = true,
    onPick = onPick,
  )
}
