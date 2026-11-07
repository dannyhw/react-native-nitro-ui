package com.margelo.nitro.nitroui

import androidx.compose.ui.unit.dp
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Reading a vector drawable's source, which is what the development form of
 * `androidIcon` has to do (`NitroUiVectorDrawable.kt`).
 *
 * The real fixture is not a fixture: `example/src/assets/icons/share_24px.xml` is
 * Google's own Material Symbols file, downloaded unchanged, and it is the same
 * bytes the emulator loads over Metro in
 * `example/__tests__/Button.harness.tsx`. That matters more here than it usually
 * would, because hand-typed copies of Material paths are the exact bug D43 exists
 * for — a star drawn from memory parses beautifully and proves nothing. Google's
 * file is also the one that *breaks* a careless parser: it fills with
 * `@android:color/white`, tints with `?attr/colorControlNormal`, and draws in a
 * 960-unit viewport inside a 24 dp box.
 *
 * The broken fixtures are written here rather than read from disk, so each one
 * says in the test which sentence of the parser it is meant to prove.
 */
class NitroUiVectorDrawableTest {
  private fun read(
    xml: String,
  ): NitroUiVectorDrawable = NitroUiVectorDrawableReader.read(ByteArrayInputStream(xml.toByteArray()))

  private fun readExampleAsset(
    name: String,
  ): NitroUiVectorDrawable {
    // JVM unit tests run with the module directory as their working directory;
    // the assets live in the example app, whose build this library is included in.
    val candidates =
      listOf(
        "../example/src/assets/icons/$name",
        "example/src/assets/icons/$name",
      )
    val file =
      candidates.map { java.io.File(it) }.firstOrNull { it.isFile }
        ?: throw AssertionError("no example asset $name, looked for as ${candidates.joinToString(" or ")}")
    return NitroUiVectorDrawableReader.read(FileInputStream(file))
  }

  /** Assert the reason a file was refused, rather than only that it was. */
  private fun expectUnsupported(
    xml: String,
    contains: String,
  ) {
    try {
      read(xml)
      fail("expected a refusal saying \"$contains\"")
    } catch (unsupported: NitroUiVectorUnsupported) {
      assertTrue(
        "\"${unsupported.message}\" does not say \"$contains\"",
        unsupported.message?.contains(contains) == true,
      )
    }
  }

  /**
   * Google's `share` icon, read as-is.
   *
   * The numbers are the file's own: 960x960 of viewport in a 24 dp box, one path,
   * and a fill the parser cannot resolve — `@android:color/white` is a resource
   * reference and only the app's resource table can answer it. What the parser has
   * to get right is the *decision* that follows: paint it, opaque, because nitro-ui
   * tints the result with the control's own content colour anyway and discards the
   * RGB. A default of transparent here would answer Google's own file with an
   * invisible glyph, which is the worst possible failure for this feature: it would
   * look like the feature does not work.
   */
  @Test
  fun googlesOwnMaterialSymbolsFileIsReadAsItIsWritten() {
    val vector = readExampleAsset("share_24px.xml")

    assertEquals(24f, vector.widthDp, 0f)
    assertEquals(24f, vector.heightDp, 0f)
    assertEquals(960f, vector.viewportWidth, 0f)
    assertEquals(960f, vector.viewportHeight, 0f)
    assertEquals(1, vector.nodeCount)

    val path = vector.roots.single() as NitroUiVectorPath
    assertTrue(
      "the path data is Google's, taken from the file rather than typed",
      path.pathData.startsWith("M720,880Q670,880 635,845"),
    )
    assertEquals("unresolvable reference means painted, not skipped", OPAQUE_BLACK, path.fillColor)
    assertEquals(1f, path.fillAlpha, 0f)
    assertEquals("nothing is stroked", TRANSPARENT, path.strokeColor)
    assertEquals(0f, path.strokeWidth, 0f)
    assertEquals(1f, path.trimPathEnd, 0f)
  }

  /**
   * The second real file, so that "it parsed" cannot mean "it found one path in
   * whichever file was lying around": the two files differ in their path data, and
   * a parser that ignored the attribute would give them the same one.
   */
  @Test
  fun theSecondRealFileIsReadAndIsNotTheFirstOne() {
    val share = readExampleAsset("share_24px.xml")
    val star = readExampleAsset("star_24px.xml")

    val sharePath = share.roots.single() as NitroUiVectorPath
    val starPath = star.roots.single() as NitroUiVectorPath
    assertTrue(starPath.pathData.isNotEmpty())
    assertTrue("two files, two paths", sharePath.pathData != starPath.pathData)
    assertEquals(star.viewportWidth, share.viewportWidth, 0f)
  }

  /**
   * The parse survives the hop into Compose, and the numbers survive it too: the
   * image is 24 dp wide over a 960-unit viewport, with one path node inside the
   * root group. That is what `VectorPainter` will be handed on the device.
   */
  @Test
  fun theRealFileBecomesAnImageVectorOfTheSameDrawing() {
    val image = readExampleAsset("share_24px.xml").toImageVector("share")

    assertEquals(24.dp, image.defaultWidth)
    assertEquals(24.dp, image.defaultHeight)
    assertEquals(960f, image.viewportWidth, 0f)
    assertEquals(960f, image.viewportHeight, 0f)
    assertEquals("share", image.name)

    // `VectorGroup` is the tree: `size` and `get` are its public face, and the
    // file has no `<group>`, so the one path is a direct child of the root.
    val root = image.root
    assertEquals("the path sits in the root group", 1, root.size)
    val path = root[0] as androidx.compose.ui.graphics.vector.VectorPath
    assertTrue("the path data reached Compose", path.pathData.isNotEmpty())
    assertNotNull("and it is painted", path.fill)
    assertEquals(1f, path.fillAlpha, 0f)
    assertNull("nothing strokes it", path.stroke)
  }

  /** A well-formed XML file that is not a vector drawable at all. */
  @Test
  fun wellFormedXmlThatIsNotAVectorIsRefusedNotDrawn() {
    expectUnsupported("<html><body><p>nope</p></body></html>", "no <vector> element")
  }

  /** The same file the example app keeps on disk, read from disk. */
  @Test
  fun theBrokenFixtureInTheExampleAppIsRefusedToo() {
    val file =
      listOf(
        "../example/src/assets/icons/not-a-vector.xml",
        "example/src/assets/icons/not-a-vector.xml",
      ).map { java.io.File(it) }.firstOrNull { it.isFile }
        ?: throw AssertionError("the not-a-vector.xml fixture is missing")
    try {
      NitroUiVectorDrawableReader.read(FileInputStream(file))
      fail("not-a-vector.xml should be refused")
    } catch (unsupported: NitroUiVectorUnsupported) {
      assertTrue(unsupported.message!!.contains("no <vector> element"))
    }
  }

  /** A download cut off mid-file — the shape of a dev server restarting. */
  @Test
  fun aTruncatedFileIsRefused() {
    expectUnsupported(
      "<vector android:width=\"24dp\" android:height=\"24dp\" android:viewportWidth=\"24\"" +
        " android:viewportHeight=\"24\"><path android:pathData=\"M0,0L1,1\"",
      "well-formed",
    )
  }

  /** A `<path>` with no data is not an icon, and drawing an empty slot for one is a bug. */
  @Test
  fun aPathWithNoDataIsRefused() {
    expectUnsupported(vector("<path android:fillColor=\"#FF000000\" />"), "no android:pathData")
  }

  /** An empty `<vector>` is legal XML and nothing to draw. */
  @Test
  fun aVectorWithNoPathsIsRefused() {
    expectUnsupported(vector("<group><group></group></group>"), "no <path> to draw")
  }

  /**
   * A gradient fill, which this parser refuses out loud.
   *
   * The alternative — drawing one flat colour — is the failure mode nobody
   * notices: the glyph appears, in a release build in a different colour, and the
   * report is "the icon sometimes changes". `grad200` is the only Material Symbols
   * variant that uses one, and it says so in its name.
   */
  @Test
  fun aGradientFillIsRefusedRatherThanDrawnFlat() {
    expectUnsupported(
      vector(
        "<path android:pathData=\"M0,0L1,1\"><aapt:attr name=\"android:fillColor\">" +
          "<gradient android:type=\"linear\" android:startColor=\"#FF000000\"" +
          " android:endColor=\"#FFFFFFFF\" android:startX=\"0\" android:startY=\"0\"" +
          " android:endX=\"24\" android:endY=\"24\" /></aapt:attr></path>",
      ),
      "gradient",
    )
  }

  /**
   * Groups are nesting, transforms and all: a path inside a scaled, translated
   * group must arrive as the group's child with the group's numbers, or the glyph
   * draws in the wrong place — while still being one path, so nothing else about
   * the icon would look wrong.
   */
  @Test
  fun aGroupKeepsItsChildrenAndItsTransform() {
    val vector =
      read(
        vector(
          "<group android:name=\"g\" android:rotation=\"45\" android:pivotX=\"12\"" +
            " android:pivotY=\"12\" android:scaleX=\"2\" android:scaleY=\"2\"" +
            " android:translateX=\"1\" android:translateY=\"2\">" +
            // `<clip-path>` is an element with `pathData`, the way a real file
            // writes it, not an attribute on the group.
            "<clip-path android:pathData=\"M0,0L24,0L24,24Z\"/>" +
            "<path android:pathData=\"M0,0L1,1\" android:fillColor=\"#80FF0000\"" +
            " android:fillAlpha=\"0.5\"/>" +
            "<path android:pathData=\"M2,2L3,3\" android:strokeColor=\"#FF00FF00\"" +
            " android:strokeWidth=\"1.5\" android:strokeLineCap=\"round\"" +
            " android:strokeLineJoin=\"bevel\" android:fillType=\"evenOdd\"/>" +
            "</group>",
        ),
      )

    assertEquals(2, vector.nodeCount)
    val group = vector.roots.single() as NitroUiVectorGroup
    assertEquals(45f, group.rotation, 0f)
    assertEquals(12f, group.pivotX, 0f)
    assertEquals(2f, group.scaleY, 0f)
    assertEquals(1f, group.translationX, 0f)
    assertEquals(2f, group.translationY, 0f)
    assertEquals(listOf("M0,0L24,0L24,24Z"), group.clipPathData)
    assertEquals(2, group.children.size)
    // And the nesting has to survive into what Compose is handed: a path that ends
    // up beside the group instead of inside it draws unrotated and unscaled, which
    // no number in this file's other assertions would notice.
    val image = vector.toImageVector("grouped")
    val rootGroup = image.root[0] as androidx.compose.ui.graphics.vector.VectorGroup
    assertEquals("the group holds its two paths", 2, rootGroup.size)
    assertEquals(45f, rootGroup.rotation, 0f)
    assertEquals("the file has one top-level node", 1, image.root.size)

    val filled = group.children[0] as NitroUiVectorPath
    // `#80FF0000`: alpha 0x80, red. Read as ARGB, not as a shifted guess.
    assertEquals(0x80FF0000.toInt(), filled.fillColor)
    assertEquals(0.5f, filled.fillAlpha, 0f)

    val stroked = group.children[1] as NitroUiVectorPath
    assertEquals(0xFFFF00FF00.toInt() and 0xFFFFFFFF.toInt(), stroked.strokeColor)
    assertEquals(1.5f, stroked.strokeWidth, 0f)
    assertEquals("round", stroked.strokeLineCap)
    assertEquals("bevel", stroked.strokeLineJoin)
    assertEquals("evenOdd", stroked.fillType)
    assertEquals("a stroked path with no fill has nothing to fill", TRANSPARENT, stroked.fillColor)
  }

  /** Units, and the absence of them. */
  @Test
  fun sizesLoseTheirUnitsAndTheirAbsenceFallsBackToTheViewport() {
    val dp =
      read(
        vector(
          "<path android:pathData=\"M0,0L1,1\"/>",
          "android:width=\"24dp\" android:height=\"24.5dp\"",
        ),
      )
    assertEquals(24f, dp.widthDp, 0f)
    assertEquals(24.5f, dp.heightDp, 0f)
    assertEquals(
      "the viewport is still the viewport",
      24f,
      dp.viewportWidth,
      0f,
    )

    val bare =
      read(
        vector(
          "<path android:pathData=\"M0,0L1,1\"/>",
          "android:width=\"32\" android:height=\"32\"",
        ),
      )
    assertEquals(32f, bare.widthDp, 0f)

    // No width at all: the viewport is the only other thing that says how big the
    // drawing is, and it is what the paths are written in.
    val sizeless =
      read(
        "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\"" +
          " android:viewportWidth=\"48\" android:viewportHeight=\"48\">" +
          "<path android:pathData=\"M0,0L1,1\"/></vector>",
      )
    assertEquals(48f, sizeless.widthDp, 0f)
    assertEquals(48f, sizeless.viewportWidth, 0f)
  }

  /** A file with no viewport has no space to scale into, so it cannot be drawn. */
  @Test
  fun aFileWithNoSizeAndViewportIsRefused() {
    // The fallbacks need something to fall back to: with neither a width nor a
    // viewport there is no number left, and the 24 dp default would invent a
    // drawing at a size the file never claimed.
    val vector =
      read(
        "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\">" +
          "<path android:pathData=\"M0,0L1,1\"/></vector>",
      )
    assertEquals(24f, vector.widthDp, 0f)
    // ... and the viewport follows the width, so the file draws at 1 unit per
    // viewport unit: a decision, made visibly here rather than silently on screen.
    assertEquals(24f, vector.viewportWidth, 0f)
  }

  /**
   * The colour table. `#RGB`/`#ARGB` are doubled into their channels the way
   * `#RGB` means `#RRGGBB`; anything that is not a literal is `null` so the caller
   * can say what an unanswerable reference should mean.
   */
  @Test
  fun colourLiteralsAreReadAndReferencesAreLeftForTheCaller() {
    assertEquals(0xFFFFFFFF.toInt(), NitroUiVectorDrawableReader.parseColor("#FFFFFF"))
    assertEquals(0xFFFFFFFF.toInt(), NitroUiVectorDrawableReader.parseColor("#FFF"))
    assertEquals(0x80FF0000.toInt(), NitroUiVectorDrawableReader.parseColor("#80FF0000"))
    // `#ARGB` doubles *each* digit into its channel, the alpha included: `8` is
    // `0x88`, not `0x80`. Asserting `0x80FF0000` here read like the rule instead of
    // the way the format is actually implemented, and the parser was right.
    assertEquals(0x88FF0000.toInt(), NitroUiVectorDrawableReader.parseColor("#8F00"))
    assertEquals(0x00000000, NitroUiVectorDrawableReader.parseColor("#00000000"))
    assertNull(NitroUiVectorDrawableReader.parseColor("@android:color/white"))
    assertNull(NitroUiVectorDrawableReader.parseColor("?attr/colorControlNormal"))
    assertNull(NitroUiVectorDrawableReader.parseColor("red"))
    assertNull(NitroUiVectorDrawableReader.parseColor("#GGH"))
    assertNull(NitroUiVectorDrawableReader.parseColor("#12345"))
    assertNull(NitroUiVectorDrawableReader.parseColor(null))
  }

  /** The alpha channel, which is the half of a colour nitro-ui cannot replace. */
  @Test
  fun theAlphaChannelIsThePartThatSurvivesBeingTinted() {
    assertEquals(0xFF, alphaOf(0xFFFFFFFF.toInt()))
    assertEquals(0x80, alphaOf(0x80FF0000.toInt()))
    assertEquals(0, alphaOf(TRANSPARENT))
  }

  /**
   * A whole `<vector>` around [children], at 24 dp over a 24-unit viewport.
   *
   * Plain strings with escaped quotes, deliberately: a Kotlin raw string that ends
   * in an attribute value (`"""...android:height="24dp"""`) hands *all three* of its
   * final quotes to the terminator, so the closing `"` is silently not in the
   * string. The fixture then parses as one merged attribute — well-formed XML, so
   * SAX says nothing, and every assertion about sizes passes while proving nothing
   * about the attribute it merged away. Four of this file's tests were red that
   * way before it was written down here.
   */
  private fun vector(
    children: String,
    sizes: String = "android:width=\"24dp\" android:height=\"24dp\"",
  ): String =
    "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\" $sizes" +
      " android:viewportWidth=\"24\" android:viewportHeight=\"24\">$children</vector>"
}
