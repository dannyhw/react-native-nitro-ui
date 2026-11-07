package com.margelo.nitro.nitroui.core

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
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
