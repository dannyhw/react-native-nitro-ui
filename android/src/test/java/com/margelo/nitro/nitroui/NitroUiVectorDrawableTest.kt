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
   * The file's fill is a resource reference the parser cannot resolve. It must be painted
   * opaque: the control tints the glyph anyway, and a transparent default would hide it.
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

  @Test
  fun theRealFileBecomesAnImageVectorOfTheSameDrawing() {
    val image = readExampleAsset("share_24px.xml").toImageVector("share")

    assertEquals(24.dp, image.defaultWidth)
    assertEquals(24.dp, image.defaultHeight)
    assertEquals(960f, image.viewportWidth, 0f)
    assertEquals(960f, image.viewportHeight, 0f)
    assertEquals("share", image.name)

    // The file has no `<group>`, so the one path is a direct child of the root.
    val root = image.root
    assertEquals("the path sits in the root group", 1, root.size)
    val path = root[0] as androidx.compose.ui.graphics.vector.VectorPath
    assertTrue("the path data reached Compose", path.pathData.isNotEmpty())
    assertNotNull("and it is painted", path.fill)
    assertEquals(1f, path.fillAlpha, 0f)
    assertNull("nothing strokes it", path.stroke)
  }

  @Test
  fun wellFormedXmlThatIsNotAVectorIsRefusedNotDrawn() {
    expectUnsupported("<html><body><p>nope</p></body></html>", "no <vector> element")
  }

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

  @Test
  fun aTruncatedFileIsRefused() {
    expectUnsupported(
      "<vector android:width=\"24dp\" android:height=\"24dp\" android:viewportWidth=\"24\"" +
        " android:viewportHeight=\"24\"><path android:pathData=\"M0,0L1,1\"",
      "well-formed",
    )
  }

  @Test
  fun aPathWithNoDataIsRefused() {
    expectUnsupported(vector("<path android:fillColor=\"#FF000000\" />"), "no android:pathData")
  }

  @Test
  fun aVectorWithNoPathsIsRefused() {
    expectUnsupported(vector("<group><group></group></group>"), "no <path> to draw")
  }

  /** Refused rather than drawn in one flat colour, which nobody would notice was wrong. */
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
    // The nesting must reach Compose too: a path beside its group would draw untransformed.
    val image = vector.toImageVector("grouped")
    val rootGroup = image.root[0] as androidx.compose.ui.graphics.vector.VectorGroup
    assertEquals("the group holds its two paths", 2, rootGroup.size)
    assertEquals(45f, rootGroup.rotation, 0f)
    assertEquals("the file has one top-level node", 1, image.root.size)

    val filled = group.children[0] as NitroUiVectorPath
    // `#80FF0000` is ARGB: alpha 0x80, red.
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

    // With no width, the viewport is the size.
    val sizeless =
      read(
        "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\"" +
          " android:viewportWidth=\"48\" android:viewportHeight=\"48\">" +
          "<path android:pathData=\"M0,0L1,1\"/></vector>",
      )
    assertEquals(48f, sizeless.widthDp, 0f)
    assertEquals(48f, sizeless.viewportWidth, 0f)
  }

  @Test
  fun aFileWithNoSizeAndViewportIsRefused() {
    // With neither a size nor a viewport, both fall back to 24.
    val vector =
      read(
        "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\">" +
          "<path android:pathData=\"M0,0L1,1\"/></vector>",
      )
    assertEquals(24f, vector.widthDp, 0f)
    assertEquals(24f, vector.viewportWidth, 0f)
  }

  /** Anything that is not a colour literal reads as `null`, so the caller decides its meaning. */
  @Test
  fun colourLiteralsAreReadAndReferencesAreLeftForTheCaller() {
    assertEquals(0xFFFFFFFF.toInt(), NitroUiVectorDrawableReader.parseColor("#FFFFFF"))
    assertEquals(0xFFFFFFFF.toInt(), NitroUiVectorDrawableReader.parseColor("#FFF"))
    assertEquals(0x80FF0000.toInt(), NitroUiVectorDrawableReader.parseColor("#80FF0000"))
    // `#ARGB` doubles each digit into its channel, the alpha included: `8` is `0x88`.
    assertEquals(0x88FF0000.toInt(), NitroUiVectorDrawableReader.parseColor("#8F00"))
    assertEquals(0x00000000, NitroUiVectorDrawableReader.parseColor("#00000000"))
    assertNull(NitroUiVectorDrawableReader.parseColor("@android:color/white"))
    assertNull(NitroUiVectorDrawableReader.parseColor("?attr/colorControlNormal"))
    assertNull(NitroUiVectorDrawableReader.parseColor("red"))
    assertNull(NitroUiVectorDrawableReader.parseColor("#GGH"))
    assertNull(NitroUiVectorDrawableReader.parseColor("#12345"))
    assertNull(NitroUiVectorDrawableReader.parseColor(null))
  }

  @Test
  fun theAlphaChannelIsThePartThatSurvivesBeingTinted() {
    assertEquals(0xFF, alphaOf(0xFFFFFFFF.toInt()))
    assertEquals(0x80, alphaOf(0x80FF0000.toInt()))
    assertEquals(0, alphaOf(TRANSPARENT))
  }

  /**
   * A whole `<vector>` around [children], at 24 dp over a 24-unit viewport. Plain strings on
   * purpose: a raw string that ends in an attribute value gives its closing quote to the
   * terminator, and the attribute silently merges with the next one.
   */
  private fun vector(
    children: String,
    sizes: String = "android:width=\"24dp\" android:height=\"24dp\"",
  ): String =
    "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\" $sizes" +
      " android:viewportWidth=\"24\" android:viewportHeight=\"24\">$children</vector>"
}
