package com.margelo.nitro.nitroui.core

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlin.math.absoluteValue

/*
 * The pixel probe the harness asks a control for: "is this colour actually on the
 * screen inside this view?", answered by drawing the view into a bitmap and
 * counting the pixels that match.
 *
 * It lives here rather than in the first control that needed it (G4's
 * SegmentedControl) because a colour a platform *dropped* is a bug every
 * colour-taking control can have: G4 F1 was a `tintColor` that iOS silently
 * ignored, and G19's `androidIcon` asks the same question of an icon slot -
 * whether the glyph is painted in the control's content colour or in something
 * hard-coded. A prop echo cannot answer either one; only the drawn pixels can.
 *
 * The line this returns is shaped for iOS's own sampler (its
 * `nitroUiSamplePixels`, in `ios/components/SegmentedControl/`), so one harness
 * test can assert on both platforms without translating anything.
 */

// Per-channel-sum budget for "this pixel is the colour"; see the iOS constant.
private const val NITRO_UI_PIXEL_TOLERANCE = 30

/**
 * One control's stored pixel-probe answer.
 *
 * A probe runs on the UI thread (it has to draw the view) and a Nitro method may not
 * block for it, so the answer is stored and polled - the reason every probe is a pair.
 * The store exists because that pair is now more than one per view: `Menu` answers one
 * for its trigger and one for its open popup, which are two windows and can therefore
 * be in two different states while a harness reads both.
 *
 * The count is the harness's sentinel: `n=` is the only way a test can tell *its*
 * answer from the previous control's, so it is bumped on every probe, including a probe
 * that had nothing to sample and published a refusal.
 */
internal class NitroUiPixelProbes {
  private val lock = Any()

  private var probes = 0

  private var report = ""

  /** Store what a probe found. Safe from any thread. */
  fun publish(
    line: String,
  ) {
    synchronized(lock) {
      probes += 1
      report = "n=$probes $line"
    }
  }

  /** Store a refusal - `no popup`, `no pixels` - for a probe with nothing to sample. */
  fun refuse(
    reason: String,
  ) = publish(reason)

  /** The last answer, or empty before the first probe. */
  fun read(): String = synchronized(lock) { report }

  /** Forget everything, as a recycle does: the next owner starts unread. */
  fun clear() {
    synchronized(lock) {
      probes = 0
      report = ""
    }
  }
}

/**
 * A Compose colour as `RRGGBB`, the shape [nitroUiSamplePixels] asks a harness for.
 *
 * Both probe reports that name a colour the test then samples for use it - a row's
 * leading-icon tint and a chip's icon tint - so the two spell the colour identically and
 * one helper owns the alpha-mask and the casing.
 */
internal fun Color.toRgbHex(): String = String.format("%06X", toArgb() and 0xFFFFFF)

/**
 * What the pixels this view is drawing say about [color], as one line for a test's
 * failure message. The shape is shared with iOS (`nitroUiSamplePixels`), so one harness
 * test can read both.
 *
 * `draw(Canvas)` on the host view: Compose renders into this view tree, so the drawing
 * pass is what the screen shows - the only reading that can tell a tint the platform
 * applied from one it dropped. `draw` rather than a pixel copy from the window because a
 * hybrid view has no surface of its own to copy.
 *
 * The same neutral mid-grey backdrop iOS uses, for the same reason: a fill that comes
 * back translucent must still be comparable, and a middle backdrop treats a light tint
 * and a dark one alike.
 */
internal fun View.nitroUiSamplePixels(color: Double): String {
  val width = width
  val height = height
  val argb = color.toLong()
  val red = (argb shr 16 and 0xff).toInt()
  val green = (argb shr 8 and 0xff).toInt()
  val blue = (argb and 0xff).toInt()
  if (width < 2 || height < 2) {
    return "size=${width}x$height no pixels"
  }
  val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
  try {
    val canvas = Canvas(bitmap)
    canvas.drawColor(0xFF808080.toInt())
    draw(canvas)
    var hits = 0
    var redSum = 0L
    var greenSum = 0L
    var blueSum = 0L
    var closestDistance = Int.MAX_VALUE
    var closestRed = 0
    var closestGreen = 0
    var closestBlue = 0
    for (row in 0 until height) {
      for (column in 0 until width) {
        val pixel = bitmap.getPixel(column, row)
        val pixelRed = pixel shr 16 and 0xff
        val pixelGreen = pixel shr 8 and 0xff
        val pixelBlue = pixel and 0xff
        redSum += pixelRed
        greenSum += pixelGreen
        blueSum += pixelBlue
        val distance =
          (pixelRed - red).absoluteValue + (pixelGreen - green).absoluteValue +
          (pixelBlue - blue).absoluteValue
        if (distance <= NITRO_UI_PIXEL_TOLERANCE) {
          hits += 1
        }
        if (distance < closestDistance) {
          closestDistance = distance
          closestRed = pixelRed
          closestGreen = pixelGreen
          closestBlue = pixelBlue
        }
      }
    }
    val area = (width * height).toLong()
    val mean = (redSum / area shl 16) or (greenSum / area shl 8) or (blueSum / area)
    return "size=${width}x$height want=#%02X%02X%02X hits=$hits mean=#%06X closest=#%02X%02X%02X"
      .format(red, green, blue, mean, closestRed, closestGreen, closestBlue)
  } finally {
    bitmap.recycle()
  }
}
