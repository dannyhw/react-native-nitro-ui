package com.margelo.nitro.nitroui

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import java.io.InputStream
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.InputSource
import org.xml.sax.helpers.DefaultHandler

/*
 * The development half of `androidIcon`: an Android vector drawable read from a
 * file rather than from the app's compiled resources
 * (`docs/components/button.md`, "Android icons").
 *
 * A release build never comes here. By then the same `.xml` is an entry in the
 * resource table and `aapt` has turned it into the binary form the platform draws
 * with. In development the file is only ever the source the developer wrote,
 * served over HTTP by Metro — React Native refuses to serve `.xml` assets itself
 * (`assetSupportsNetworkLoads` in `AssetSourceResolver.js`) — so something has to
 * read that source, and it is this file.
 *
 * The output is an `ImageVector`, because that is what Compose draws natively:
 * every Material icon in the app reaches the screen as one, so the development
 * glyph goes through the same `VectorPainter` as the release glyph's neighbours,
 * stays sharp at whatever size the size ladder asks for, and costs no bitmap.
 *
 * Two rules shape the parser:
 *
 *  - **The tree it builds is data.** The SAX handler fills plain classes, and
 *    [toImageVector] is the only place `ImageVector.Builder` is called. That is
 *    what lets `android/src/test` run this against Google's own Material Symbols
 *    files and against broken ones, on a JVM, with no emulator and no device —
 *    and a parser that only runs on a device can only ever be shown to pass
 *    (AGENTS, "Every new test or gate must be shown to fail").
 *  - **Colours are resolved the way the caller can still use them.** A real file
 *    references `@android:color/white` or `?attr/colorControlNormal`, and only the
 *    resource table can answer those. nitro-ui tints every icon it draws to the
 *    control's own content colour (`NitroUiIconGlyph`), which replaces the RGB of
 *    every pixel and keeps the alpha — so the only thing a colour has to get right
 *    here is whether it is painted at all. See [parseColor].
 */

/** A file that is not an Android vector drawable, or is one we cannot draw. */
internal class NitroUiVectorUnsupported(
  reason: String,
) : RuntimeException(reason)

/** Something a `<vector>` contains: a path to paint, or a group of them. */
internal sealed interface NitroUiVectorNode

/** What one `<path>` element asks to be drawn. */
internal class NitroUiVectorPath(
  val pathData: String,
  /** ARGB to fill with; a fully transparent value means "no fill". */
  val fillColor: Int,
  val fillAlpha: Float,
  /** ARGB to stroke with; a fully transparent value means "no stroke". */
  val strokeColor: Int,
  val strokeAlpha: Float,
  val strokeWidth: Float,
  val strokeLineCap: String,
  val strokeLineJoin: String,
  val strokeMiterLimit: Float,
  val fillType: String,
  val trimPathStart: Float,
  val trimPathEnd: Float,
  val trimPathOffset: Float,
) : NitroUiVectorNode

/** What one `<group>` element wraps: paths and nested groups, moved as one. */
internal class NitroUiVectorGroup(
  val rotation: Float,
  val pivotX: Float,
  val pivotY: Float,
  val scaleX: Float,
  val scaleY: Float,
  val translationX: Float,
  val translationY: Float,
  val clipPathData: MutableList<String> = mutableListOf(),
  val children: MutableList<NitroUiVectorNode> = mutableListOf(),
) : NitroUiVectorNode

/**
 * A parsed vector drawable: the box it claims to be, the viewport its paths are
 * written in, and the tree inside it.
 */
internal class NitroUiVectorDrawable(
  val widthDp: Float,
  val heightDp: Float,
  val viewportWidth: Float,
  val viewportHeight: Float,
  val roots: List<NitroUiVectorNode>,
  /** How many `<path>`s the file asked to draw. For the log line and the tests. */
  val nodeCount: Int,
) {
  /**
   * The same drawing as a Compose image.
   *
   * `name` is what a layout-inspection dump and a11y tree show for the icon, so it
   * is the URL the file arrived from rather than a generated number: when two
   * glyphs are mixed up on screen, the answer is in the dump.
   */
  fun toImageVector(
    name: String,
  ): ImageVector {
    val builder =
      ImageVector.Builder(
        name = name,
        defaultWidth = widthDp.dp,
        defaultHeight = heightDp.dp,
        viewportWidth = viewportWidth,
        viewportHeight = viewportHeight,
      )
    roots.forEach { root -> root.addTo(builder) }
    return builder.build()
  }

  private fun NitroUiVectorNode.addTo(
    builder: ImageVector.Builder,
  ) {
    when (this) {
      is NitroUiVectorPath ->
        builder.addPath(
          pathData = PathParser().parsePathString(pathData).toNodes(),
          pathFillType =
            if (fillType.equals("evenOdd", ignoreCase = true)) {
              PathFillType.EvenOdd
            } else {
              PathFillType.NonZero
            },
          fill = fillBrush(),
          fillAlpha = fillAlpha,
          stroke = strokeBrush(),
          strokeAlpha = strokeAlpha,
          strokeLineWidth = strokeWidth,
          strokeLineCap =
            when (strokeLineCap) {
              "round" -> StrokeCap.Round
              "square" -> StrokeCap.Square
              else -> StrokeCap.Butt
            },
          strokeLineJoin =
            when (strokeLineJoin) {
              "round" -> StrokeJoin.Round
              "bevel" -> StrokeJoin.Bevel
              else -> StrokeJoin.Miter
            },
          strokeLineMiter = strokeMiterLimit,
          trimPathStart = trimPathStart,
          trimPathEnd = trimPathEnd,
          trimPathOffset = trimPathOffset,
        )
      is NitroUiVectorGroup -> {
        builder.addGroup(
          rotate = rotation,
          pivotX = pivotX,
          pivotY = pivotY,
          scaleX = scaleX,
          scaleY = scaleY,
          translationX = translationX,
          translationY = translationY,
          clipPathData = clipPathData.flatMap { PathParser().parsePathString(it).toNodes() },
        )
        children.forEach { child -> child.addTo(builder) }
        builder.clearGroup()
      }
    }
  }

  private fun NitroUiVectorPath.fillBrush(): Brush? = solid(fillColor, fillColor)

  private fun NitroUiVectorPath.strokeBrush(): Brush? =
    if (strokeWidth <= 0f) null else solid(strokeColor, strokeColor)

  private fun solid(
    argb: Int,
    unused: Int,
  ): Brush? = if (alphaOf(argb) == 0) null else SolidColor(Color(argb))
}

/** Opaque black — the fill `aapt` gives a path whose colour it cannot read. */
internal const val OPAQUE_BLACK: Int = -0x1000000 // 0xFF000000

/** Nothing to paint with. */
internal const val TRANSPARENT: Int = 0

/** The alpha channel of an ARGB int, without an `android.graphics` call. */
internal fun alphaOf(
  argb: Int,
): Int = (argb ushr 24) and 0xFF

/**
 * Vector drawables read from a stream — the files an `androidIcon` names in
 * development.
 *
 * [read] is the whole API. It throws [NitroUiVectorUnsupported] for a file that
 * is not a vector drawable, is truncated, or uses a feature this parser does not
 * implement; the caller treats all three the way an unresolvable icon name is
 * treated — nothing drawn, one line in the log.
 */
internal object NitroUiVectorDrawableReader {
  private const val TAG_VECTOR = "vector"
  private const val TAG_GROUP = "group"
  private const val TAG_PATH = "path"
  private const val TAG_CLIP_PATH = "clip-path"

  /**
   * Gradient fills, which arrive as an `<aapt:attr name="android:fillColor">`
   * wrapping a `<gradient>`.
   *
   * These are the one thing in the format this parser refuses, and the refusal is
   * louder than silence would be: a gradient drawn as one flat colour is a glyph
   * that looks right until it is compared with a release build, and nitro-ui
   * tints every icon anyway, which would flatten the gradient it had just gone to
   * trouble to reproduce. An icon that uses one therefore draws in a release build
   * and not in development, and the log says which of the two it is doing.
   */
  private const val TAG_GRADIENT = "gradient"
  private const val TAG_AAPT_ATTR = "attr"

  fun read(source: InputStream): NitroUiVectorDrawable {
    val factory =
      SAXParserFactory.newInstance().apply {
        // Namespace-aware parsing would report attributes as `pathData` with the
        // prefix moved elsewhere, and the prefix is exactly how the file says
        // "Android's attribute, not mine". Off keeps qualified names as written,
        // and [attributesOf] strips the prefix on its own terms.
        isNamespaceAware = false
        // The bytes arrive over HTTP from a dev server. A vector drawable has no
        // doctype and includes nothing, so a document that tries either is
        // refused rather than having the parser go and read something else.
        refuse("http://apache.org/xml/features/disallow-doctype-decl", true)
        refuse("http://xml.org/sax/features/external-general-entities", false)
        refuse("http://xml.org/sax/features/external-parameter-entities", false)
      }
    val handler = VectorHandler()
    try {
      factory.newSAXParser().parse(InputSource(source), handler)
    } catch (unsupported: NitroUiVectorUnsupported) {
      throw unsupported
    } catch (malformed: Exception) {
      // A truncated download, a `package.json`, an `.svg`. SAX has the detail; the
      // caller adds which icon it was.
      //
      // SAX is also what the handler's own refusals travel through: a throw from
      // inside `startElement` comes back wrapped, and the refusal is the reason the
      // developer needs ("uses a gradient fill", not "is not well-formed"). So a
      // wrapped refusal is unwrapped rather than reported as the wrapper.
      val wrapped = generateSequence<Throwable>(malformed) { it.cause }
        .firstOrNull { it is NitroUiVectorUnsupported }
      if (wrapped != null) {
        throw wrapped
      }
      throw NitroUiVectorUnsupported(
        "is not a well-formed Android vector drawable " +
          "(${malformed.message?.lineSequence()?.firstOrNull() ?: malformed.javaClass.simpleName})",
      )
    }
    return handler.result()
  }

  private fun SAXParserFactory.refuse(
    feature: String,
    enabled: Boolean,
  ) {
    try {
      setFeature(feature, enabled)
    } catch (_: Exception) {
      // Not every SAX implementation knows every feature, and Android's is not the
      // JDK's. Neither the doctype nor the entities can reach a file the dev server
      // did not send, so an implementation that cannot be told is not a hole; it is
      // not worth failing to draw an icon over.
    }
  }

  /** The elements seen so far, and the numbers the root element carried. */
  private class VectorHandler : DefaultHandler() {
    private var widthDp = Float.NaN
    private var heightDp = Float.NaN
    private var viewportWidth = Float.NaN
    private var viewportHeight = Float.NaN
    private var seenRoot = false
    private var nodeCount = 0

    /** The group being filled. The outermost one is not an element: it is the file. */
    private val stack = ArrayDeque<NitroUiVectorGroup>()

    init {
      stack.addLast(NitroUiVectorGroup(0f, 0f, 0f, 1f, 1f, 0f, 0f))
    }

    override fun startElement(
      uri: String?,
      localName: String?,
      qName: String?,
      attributes: Attributes?,
    ) {
      // A prefix is a namespace declaration, not part of an element's meaning.
      when (qName?.substringAfter(':')) {
        TAG_VECTOR -> {
          if (seenRoot) {
            throw NitroUiVectorUnsupported("has more than one <vector> element")
          }
          seenRoot = true
          val attrs = attributesOf(attributes)
          widthDp = attrs.float("width")
          heightDp = attrs.float("height")
          viewportWidth = attrs.float("viewportWidth")
          viewportHeight = attrs.float("viewportHeight")
        }

        TAG_GRADIENT,
        TAG_AAPT_ATTR,
        ->
          throw NitroUiVectorUnsupported(
            "uses a gradient fill, which nitro-ui does not draw in development (it draws in a release build)",
          )

        TAG_GROUP -> {
          val attrs = attributesOf(attributes)
          stack.addLast(
            NitroUiVectorGroup(
              rotation = attrs.float("rotation", 0f),
              pivotX = attrs.float("pivotX", 0f),
              pivotY = attrs.float("pivotY", 0f),
              scaleX = attrs.float("scaleX", 1f),
              scaleY = attrs.float("scaleY", 1f),
              translationX = attrs.float("translateX", 0f),
              translationY = attrs.float("translateY", 0f),
            ),
          )
        }

        TAG_PATH -> {
          val attrs = attributesOf(attributes)
          val pathData = attrs.string("pathData")
          if (pathData.isNullOrEmpty()) {
            throw NitroUiVectorUnsupported("has a <path> with no android:pathData")
          }
          nodeCount += 1
          stack.last().children.add(
            NitroUiVectorPath(
              pathData = pathData,
              fillColor = parseFillColor(attrs.string("fillColor")),
              fillAlpha = attrs.float("fillAlpha", attrs.float("fillColorAlpha", 1f)),
              strokeColor = parseColor(attrs.string("strokeColor")) ?: TRANSPARENT,
              strokeAlpha = attrs.float("strokeAlpha", attrs.float("strokeColorAlpha", 1f)),
              strokeWidth = attrs.float("strokeWidth", 0f),
              strokeLineCap = attrs.string("strokeLineCap") ?: "butt",
              strokeLineJoin = attrs.string("strokeLineJoin") ?: "miter",
              strokeMiterLimit = attrs.float("strokeMiterLimit", 4f),
              fillType = attrs.string("fillType") ?: "nonZero",
              trimPathStart = attrs.float("trimPathStart", 0f),
              trimPathEnd = attrs.float("trimPathEnd", 1f),
              trimPathOffset = attrs.float("trimPathOffset", 0f),
            ),
          )
        }

        TAG_CLIP_PATH ->
          attributesOf(attributes).string("pathData")?.let { clip ->
            stack.last().clipPathData.add(clip)
          }

        else -> {
          // Ignored: an attribute set nitro-ui cannot read, or an element that says
          // nothing about what to draw. The platform ignores what it does not know
          // rather than refusing to draw, and so this does too.
        }
      }
    }

    override fun endElement(
      uri: String?,
      localName: String?,
      qName: String?,
    ) {
      if (qName?.substringAfter(':') == TAG_GROUP && stack.size > 1) {
        // Pop first, then attach: `stack.last().children.add(stack.removeLast())`
        // reads the stack twice and would hand the group to *itself* - Kotlin
        // evaluates the receiver before the argument, so the group being closed is
        // still on top when the receiver is read. The glyph would then lose every
        // path inside the group and still report the right path count.
        val closing = stack.removeLast()
        stack.last().children.add(closing)
      }
    }

    fun result(): NitroUiVectorDrawable {
      if (!seenRoot) {
        throw NitroUiVectorUnsupported("has no <vector> element")
      }
      // A `<vector>` with nothing in it is well-formed XML and not an icon. Without
      // this, the caller would reserve a slot for a glyph that is never painted —
      // the one thing the sizing rule says not to do.
      if (nodeCount == 0) {
        throw NitroUiVectorUnsupported("has no <path> to draw")
      }
      // `aapt` requires a width and a height, but a hand-edited file can leave one
      // out, and the viewport is the only other thing that says how big the drawing
      // is. 24 is what the format's own examples use, and what a control draws an
      // icon at anyway.
      val width = firstOf(widthDp, viewportWidth, 24f)
      val height = firstOf(heightDp, viewportHeight, 24f)
      // The viewport is the coordinate space the path data is written in: Google's
      // Material Symbols draw in 960x960 inside a 24 dp box. A file with neither a
      // viewport nor a size has no space to scale into, and scaling a path by
      // nothing draws nothing — which would be silent.
      val viewportW = firstOf(viewportWidth, width, 0f)
      val viewportH = firstOf(viewportHeight, height, 0f)
      if (viewportW <= 0f || viewportH <= 0f) {
        throw NitroUiVectorUnsupported("has no viewport to scale its paths from")
      }
      return NitroUiVectorDrawable(
        widthDp = width,
        heightDp = height,
        viewportWidth = viewportW,
        viewportHeight = viewportH,
        roots = stack.first().children.toList(),
        nodeCount = nodeCount,
      )
    }
  }

  /** An element's attributes, with the namespace prefix taken off the names. */
  private class AttributesMap(
    private val values: Map<String, String>,
  ) {
    fun string(name: String): String? = values[name]?.takeIf { it.isNotEmpty() }

    /**
     * A number, with its unit taken off.
     *
     * Sizes in this format carry a unit (`24dp`) and everything else is in viewport
     * units. `px` is read as `dp`: the icon's box comes from the size ladder and
     * never from this file, so the only thing a size decides is the ratio between
     * the two axes — and a file that mixes units has already lost that argument.
     */
    fun float(
      name: String,
      default: Float = Float.NaN,
    ): Float =
      values[name]
        ?.trim()
        ?.removeSuffix("dp")
        ?.removeSuffix("dip")
        ?.removeSuffix("px")
        ?.removeSuffix("sp")
        ?.trim()
        ?.toFloatOrNull()
        ?: default
  }

  private fun attributesOf(attributes: Attributes?): AttributesMap {
    val values = HashMap<String, String>(attributes?.length ?: 0)
    if (attributes != null) {
      for (index in 0 until attributes.length) {
        val name = attributes.getQName(index).substringAfter(':')
        // First wins, so a stray `foo:fillColor` cannot override `android:fillColor`.
        if (!values.containsKey(name)) {
          attributes.getValue(index)?.let { values[name] = it }
        }
      }
    }
    return AttributesMap(values)
  }

  /**
   * The fill of a `<path>`, defaulting the way the format does: no colour at all
   * means nothing is filled, which is how a stroke-only icon is drawn.
   */
  private fun parseFillColor(
    value: String?,
  ): Int =
    parseColor(value)
      ?: if (isResourceReference(value)) OPAQUE_BLACK else TRANSPARENT

  /** `@android:color/white`, `@color/brand`, `?attr/colorControlNormal`. */
  private fun isResourceReference(value: String?): Boolean =
    value != null && (value.startsWith('@') || value.startsWith('?'))

  /**
   * A colour literal as ARGB, or `null` for anything else.
   *
   * `#RGB`, `#ARGB`, `#RRGGBB` and `#AARRGGBB`. Google's own files write
   * `@android:color/white`, which is not one of those and has no answer here —
   * only the app's resource table does, and it is not on this thread. Callers
   * choose a default, and the default that matters is the *alpha*: the drawable is
   * tinted with the control's content colour afterwards, which replaces the RGB of
   * every pixel and leaves the coverage alone. A reference answered as opaque
   * therefore paints the same glyph a release build paints.
   */
  internal fun parseColor(value: String?): Int? {
    if (value == null || value.length < 4 || value[0] != '#') {
      return null
    }
    val digits = value.substring(1)
    val parsed = digits.toLongOrNull(radix = 16) ?: return null
    if (parsed < 0) {
      return null
    }
    // Parenthesised per channel. `or` and `shl` are both infix calls in Kotlin and
    // so share one precedence, evaluated left to right: written without these
    // brackets, `OPAQUE_BLACK or red shl 16 or green shl 8 or blue` shifts the
    // accumulator each time and `#FFF` comes out green. Found by the colour test.
    val red = expandNibble(parsed, 2) shl 16
    val green = expandNibble(parsed, 1) shl 8
    val blue = expandNibble(parsed, 0)
    return when (digits.length) {
      // #RGB and #ARGB, each digit doubled into its channel.
      3 -> OPAQUE_BLACK or red or green or blue
      4 -> (expandNibble(parsed, 3) shl 24) or red or green or blue
      6 -> OPAQUE_BLACK or parsed.toInt()
      8 -> parsed.toInt()
      else -> null
    }
  }

  /** One hex digit as `0xDD`, the way `#RGB` stands for `#RRGGBB`. */
  private fun expandNibble(
    value: Long,
    position: Int,
  ): Int =
    (((value shr (position * 4)) and 0xFL) * 0x11).toInt()

  private fun firstOf(
    first: Float,
    second: Float,
    third: Float,
  ): Float =
    when {
      !first.isNaN() -> first
      !second.isNaN() -> second
      else -> third
    }
}
