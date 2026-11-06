package com.margelo.nitro.nitroui

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import com.facebook.react.views.imagehelper.ResourceDrawableIdHelper
import java.util.Collections

/*
 * `androidIcon`: how a nitro-ui control draws one of the app's own drawable
 * resources (`docs/components/button.md`, "Android icons").
 *
 * iOS has SF Symbols, so `systemImage` names a symbol and the OS supplies the
 * artwork. Android has no system icon set, so the app ships the vectors and this
 * file is the one place that turns a shipped *name* into pixels: name -> resource
 * id -> bitmap -> painter, with the bitmap shared per name for the life of the
 * process.
 *
 * The two halves are deliberately split. [NitroUiIconNames] is pure Kotlin — the
 * name rules and the once-per-name warning — so `android/src/test` can cover the
 * parts that decide what an app developer sees when a name is wrong. The bitmap
 * work below needs a `Context` and is covered on the emulator by the harness.
 */

/**
 * The name rules of the `androidIcon` prop, with no Android dependency.
 *
 * A resource name is what a developer writes in `res/drawable/`, and React
 * Native's [ResourceDrawableIdHelper] looks it up by string. Two of its rules
 * are easy to get wrong and silent when you do, so they are stated here and
 * checked by JS in development (`src/iconName.ts` carries the same rules for the
 * warning the developer actually sees):
 *
 * - a name is lower case and matches `[a-z][a-z0-9_]*` — a dash, a dot, an upper
 *   case letter or a leading digit is not a resource name at all;
 * - `Drawable.getIdentifier` returning 0 is *not* an error the caller can see,
 *   so a name that cannot resolve is reported once rather than drawn as nothing.
 */
internal object NitroUiIconNames {
  /** A valid, normalised resource name. Deliberately strict: see the class doc. */
  private val RESOURCE_NAME = Regex("^[a-z][a-z0-9_]*$")

  /**
   * The name as the resource table wants it: lower case, `-` and `.` become `_`.
   *
   * Both substitutions exist for the same reason — a developer copying a file
   * named `share-24px` or `share.24px` into `res/drawable/` has to rename it for
   * `aapt` to accept the file at all, and the rename is exactly the two
   * characters JS is unlikely to have. Normalising here means the prop and the
   * file name agree on both spellings.
   */
  fun normalize(name: String): String = name.lowercase().replace('-', '_').replace('.', '_')

  /** Whether [normalize] leaves a name a resource table could hold. */
  fun isValid(name: String): Boolean = RESOURCE_NAME.matches(normalize(name))

  /**
   * Names already warned about, so a control that redraws on every frame does not
   * fill logcat. Weak-ref-free on purpose: the set is names, not objects, and a
   * process that has used a thousand icon names has a real problem worth the
   * kilobyte.
   *
   * Synchronised-set rather than a lock around [Log.w]: two views can resolve the
   * same bad name on two threads, and the point of the set is that exactly one of
   * them speaks.
   */
  private val warned: MutableSet<String> =
    Collections.synchronizedSet(HashSet<String>())

  /**
   * Record that [name] was reported, answering `true` the first time only.
   *
   * The caller logs, because the caller knows which control asked; this decides
   * only whether it may.
   */
  fun shouldWarn(name: String): Boolean = warned.add(name)

  /** Forget the warning history. For tests, which must each see a fresh log. */
  fun resetForTests() {
    warned.clear()
  }
}

/**
 * The bitmaps behind every `androidIcon` in this process, keyed by resource id.
 *
 * The id, not the name: two names can reach one id (the normalising above, and
 * `drawable-hdpi`/`drawable` variants), and the id is what the pixels belong to.
 *
 * Process-wide rather than `remember`ed because a hosted control is its own
 * composition (`docs/architecture/core.md`, "Shared objects"): a row of twenty
 * buttons would otherwise rasterise the same vector twenty times, and the
 * rasterising is the expensive part — it walks the path on the thread that asks.
 *
 * Bounded: [MAX_CACHED] entries, oldest evicted first. A cache miss only costs
 * the work of loading, never correctness, so a small bound is the safe choice
 * against an app that renders a long list of distinct icons.
 */
internal object NitroUiIconCache {
  private const val MAX_CACHED = 64

  private val bitmaps = LinkedHashMap<Int, Bitmap>(16, 0.75f, true)

  /** The cached bitmap for [resId], or `null` when nothing has loaded it yet. */
  @Synchronized
  fun get(resId: Int): Bitmap? = if (resId == 0) null else bitmaps[resId]

  /** Remember the bitmap loaded for [resId], evicting the least recently used entry. */
  @Synchronized
  fun put(
    resId: Int,
    bitmap: Bitmap,
  ) {
    if (bitmaps.size >= MAX_CACHED) {
      val oldest = bitmaps.keys.iterator()
      if (oldest.hasNext()) {
        oldest.next()
        oldest.remove()
      }
    }
    bitmaps[resId] = bitmap
  }

  /** Drop everything. Called when the app's resources change identity (a configuration change). */
  @Synchronized
  fun clear() {
    bitmaps.clear()
  }
}

/**
 * The rasterised artwork for [name], or `null` when it cannot be drawn.
 *
 * `null` means "draw nothing", and callers must treat it that way: no slot is
 * reserved and no padding changes, so a control with an unresolved name is
 * exactly its no-icon self. That is the same contract iOS already keeps for an
 * SF Symbol name that does not exist, and the alternative — reserving space for
 * an icon that never arrives — shifts the label for a bug the developer cannot
 * see in a debug build.
 *
 * Loading happens on the calling thread, which for every caller today is the
 * main thread inside `afterUpdate()`. It is not cheap for a vector, and it is
 * not free to move off-main either: `Resources.getDrawable` reads the app's
 * resource table, whose theme is the activity's. Sharing the result makes the
 * cost once-per-name instead of once-per-view, which is the point.
 */
internal fun loadIconBitmap(
  context: Context,
  name: String,
): Bitmap? {
  val normalizedName = NitroUiIconNames.normalize(name)
  if (normalizedName.isEmpty()) {
    return null
  }
  val resId = ResourceDrawableIdHelper.getResourceDrawableId(context, normalizedName)
  if (resId == 0) {
    if (NitroUiIconNames.shouldWarn(normalizedName)) {
      Log.w(
        "NitroUi",
        "androidIcon \"$name\" is not a drawable in this app's resources " +
          "(looked up as \"$normalizedName\"); nothing is drawn for it. " +
          "See docs/components/button.md, \"Android icons\".",
      )
    }
    return null
  }
  NitroUiIconCache.get(resId)?.let { return it }
  val drawable =
    try {
      ResourceDrawableIdHelper.getResourceDrawable(context, normalizedName)
    } catch (error: Throwable) {
      // A layer-list, an adaptive icon or a malformed vector throws here rather
      // than returning null. Q9 C1 calls anything that `painterResource` would
      // throw on "missing", and a control that crashes the app over an icon name
      // is a worse answer than one that draws no icon.
      if (NitroUiIconNames.shouldWarn(normalizedName)) {
        Log.w(
          "NitroUi",
          "androidIcon \"$name\" resolved but cannot be drawn as an icon " +
            "(${error.javaClass.simpleName}: ${error.message}); nothing is drawn for it.",
        )
      }
      return null
    }
  if (drawable == null) {
    if (NitroUiIconNames.shouldWarn(normalizedName)) {
      Log.w("NitroUi", "androidIcon \"$name\" resolved but has no artwork; nothing is drawn for it.")
    }
    return null
  }
  val intrinsicWidth = drawable.intrinsicWidth
  val intrinsicHeight = drawable.intrinsicHeight
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
    // A shape drawable with no intrinsic size would be rasterised at whatever
    // box the caller gives it, which is a different picture per control and not
    // shareable. Treat it as undrawable and say so once.
    if (NitroUiIconNames.shouldWarn(normalizedName)) {
      Log.w(
        "NitroUi",
        "androidIcon \"$name\" has no intrinsic size, so it cannot be drawn as an icon; " +
          "ship a 24 dp vector drawable instead.",
      )
    }
    return null
  }
  val bitmap = drawableToBitmap(drawable)
  NitroUiIconCache.put(resId, bitmap)
  return bitmap
}

/** Rasterise [drawable] at its intrinsic size, premultiplied ARGB. */
private fun drawableToBitmap(drawable: android.graphics.drawable.Drawable): Bitmap {
  val bitmap =
    Bitmap.createBitmap(
      drawable.intrinsicWidth,
      drawable.intrinsicHeight,
      Bitmap.Config.ARGB_8888,
    )
  val canvas = android.graphics.Canvas(bitmap)
  drawable.setBounds(0, 0, canvas.width, canvas.height)
  drawable.draw(canvas)
  return bitmap
}

/**
 * The painter for an already-loaded icon, as a Compose [Painter].
 *
 * [remember]ed per bitmap identity: building the painter is cheap, and unlike the
 * colours and shapes in [HybridNitroUiButton] it is derived from nothing in the
 * theme, so a per-composition `remember` is enough — the *shared* thing is the
 * bitmap, and that is [NitroUiIconCache]'s job.
 */
@Composable
internal fun rememberIconPainter(bitmap: Bitmap?): Painter? {
  val image: ImageBitmap? = bitmap?.asImageBitmap()
  return remember(image) { image?.let { BitmapPainter(it) } }
}

/**
 * Draw an icon inside a control.
 *
 * `androidx.compose.material3.Icon` is not used: in material3 1.5.0-beta02 its
 * own declaration says it "is deprecated and replaced by developer-owned icon
 * slots", and building on a deprecated API would hand the next Material upgrade
 * back to us as a compile error. What `Icon` did that mattered is here — the
 * glyph fills [size], and the caller's [tint] (its `LocalContentColor`) is what
 * colours it, so a multicolour drawable draws in one colour, which is the
 * documented behaviour.
 *
 * `colorFilter` rather than a recoloured bitmap: the bitmap is shared across
 * every control that names this drawable, and a control's content colour is not
 * part of its identity.
 */
@Composable
internal fun NitroUiIconGlyph(
  painter: Painter?,
  size: Dp,
  tint: androidx.compose.ui.graphics.Color,
  contentDescription: String?,
  modifier: Modifier = Modifier,
) {
  if (painter == null) {
    return
  }
  androidx.compose.foundation.Image(
    painter = painter,
    contentDescription = contentDescription,
    colorFilter = ColorFilter.tint(tint),
    contentScale = ContentScale.Fit,
    modifier = modifier.size(size),
  )
}
