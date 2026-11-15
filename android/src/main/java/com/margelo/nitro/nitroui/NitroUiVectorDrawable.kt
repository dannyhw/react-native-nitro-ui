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

// Reads an Android vector drawable from its XML source into an `ImageVector`. Only a
// development build needs it: Metro serves the icon as a file there, not as a resource.

/** A file that is not an Android vector drawable, or is one we cannot draw. */
internal class NitroUiVectorUnsupported(
  reason: String,
) : RuntimeException(reason)

internal sealed interface NitroUiVectorNode

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

internal class NitroUiVectorDrawable(
  val widthDp: Float,
  val heightDp: Float,
  val viewportWidth: Float,
  val viewportHeight: Float,
  val roots: List<NitroUiVectorNode>,
  /** How many `<path>` elements the file has. */
  val nodeCount: Int,
) {
  /** [name] shows in layout-inspection dumps, so pass something that identifies the file. */
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

internal const val TRANSPARENT: Int = 0

internal fun alphaOf(
  argb: Int,
): Int = (argb ushr 24) and 0xFF

/**
 * [read] throws [NitroUiVectorUnsupported] for a file that is not a vector drawable, is
 * truncated, or uses a feature this parser does not implement.
 */
internal object NitroUiVectorDrawableReader {
  private const val TAG_VECTOR = "vector"
  private const val TAG_GROUP = "group"
  private const val TAG_PATH = "path"
  private const val TAG_CLIP_PATH = "clip-path"

  /**
   * A gradient fill arrives as an `<aapt:attr>` wrapping a `<gradient>`. It is refused rather
   * than drawn as one flat colour.
   */
  private const val TAG_GRADIENT = "gradient"
  private const val TAG_AAPT_ATTR = "attr"

  fun read(source: InputStream): NitroUiVectorDrawable {
    val factory =
      SAXParserFactory.newInstance().apply {
        // Not namespace-aware, so attribute names keep the prefix as written; [attributesOf]
        // strips it.
        isNamespaceAware = false
        // The bytes come over HTTP: refuse doctypes and external entities.
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
      // A refusal thrown inside the handler comes back wrapped by SAX; unwrap it so the
      // developer sees the real reason.
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
      // Not every SAX implementation knows every feature; that is not worth failing over.
    }
  }

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
          // Unknown elements are ignored, as the platform does.
        }
      }
    }

    override fun endElement(
      uri: String?,
      localName: String?,
      qName: String?,
    ) {
      if (qName?.substringAfter(':') == TAG_GROUP && stack.size > 1) {
        // Pop first, then attach. `stack.last().children.add(stack.removeLast())` evaluates
        // the receiver first, while the closing group is still on top, and adds it to itself.
        val closing = stack.removeLast()
        stack.last().children.add(closing)
      }
    }

    fun result(): NitroUiVectorDrawable {
      if (!seenRoot) {
        throw NitroUiVectorUnsupported("has no <vector> element")
      }
      // An empty `<vector>` is not an icon; the caller must not reserve a slot for it.
      if (nodeCount == 0) {
        throw NitroUiVectorUnsupported("has no <path> to draw")
      }
      // A hand-edited file can omit a size; fall back to the viewport, then to 24.
      val width = firstOf(widthDp, viewportWidth, 24f)
      val height = firstOf(heightDp, viewportHeight, 24f)
      // The viewport is the coordinate space of the path data; without one nothing scales.
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
     * A number with its unit removed. `px` reads as `dp`: the control sets the icon's size, so
     * a size here only decides the aspect ratio.
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

  /** No colour means no fill. A resource reference cannot be resolved here and reads as opaque. */
  private fun parseFillColor(
    value: String?,
  ): Int =
    parseColor(value)
      ?: if (isResourceReference(value)) OPAQUE_BLACK else TRANSPARENT

  /** `@android:color/white`, `@color/brand`, `?attr/colorControlNormal`. */
  private fun isResourceReference(value: String?): Boolean =
    value != null && (value.startsWith('@') || value.startsWith('?'))

  /**
   * A `#RGB`, `#ARGB`, `#RRGGBB` or `#AARRGGBB` literal as ARGB, or `null` for anything else.
   * Only the alpha matters to callers: the glyph is tinted afterwards, which replaces the RGB.
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
    // Shift each channel separately: `or` and `shl` are infix calls with one precedence,
    // evaluated left to right, so an unparenthesised chain shifts the accumulator.
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
