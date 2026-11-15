package com.margelo.nitro.nitroui.core

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlin.math.absoluteValue

// Test-harness pixel probe: draws a view into a bitmap and counts pixels matching a colour.

// Largest summed per-channel difference that still counts as the colour.
private const val NITRO_UI_PIXEL_TOLERANCE = 30

/**
 * A stored probe answer. A probe has to draw on the UI thread and a Nitro method may not
 * block for it, so the answer is stored and polled. `n=` counts probes, so a test can tell
 * a new answer from the previous one.
 */
internal class NitroUiPixelProbes {
  private val lock = Any()

  private var probes = 0

  private var report = ""

  fun publish(
    line: String,
  ) {
    synchronized(lock) {
      probes += 1
      report = "n=$probes $line"
    }
  }

  fun refuse(
    reason: String,
  ) = publish(reason)

  fun read(): String = synchronized(lock) { report }

  fun clear() {
    synchronized(lock) {
      probes = 0
      report = ""
    }
  }
}

/** A Compose colour as `RRGGBB`, alpha dropped. */
internal fun Color.toRgbHex(): String = String.format("%06X", toArgb() and 0xFFFFFF)

/**
 * Describes how much of this view is drawn in [color], as one line shaped like the iOS
 * sampler's. Uses `draw(Canvas)` because a hybrid view has no surface of its own to copy,
 * over mid-grey so translucent fills stay comparable.
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
