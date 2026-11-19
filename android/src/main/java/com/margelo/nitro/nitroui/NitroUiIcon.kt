package com.margelo.nitro.nitroui

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.material3.LocalContentColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import com.facebook.react.views.imagehelper.ResourceDrawableIdHelper
import com.margelo.nitro.nitroui.core.NitroUiIcons
import java.net.HttpURLConnection
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.xmlpull.v1.XmlPullParser

// The `androidIcon` prop: turns an app drawable name, or a development file URL, into
// artwork that is shared across the process.

/**
 * Name rules for `androidIcon`, free of Android imports so they run in JVM tests. A resource
 * name matches `[a-z][a-z0-9_]*`, and a name that does not resolve is reported once.
 */
internal object NitroUiIconNames {
  private val RESOURCE_NAME = Regex("^[a-z][a-z0-9_]*$")

  /** Lower case, with `-` and `.` as `_`: the renames a file needs before `aapt` accepts it. */
  fun normalize(name: String): String = name.lowercase().replace('-', '_').replace('.', '_')

  fun isValid(name: String): Boolean = RESOURCE_NAME.matches(normalize(name))

  // Names already warned about, so a control that redraws does not fill logcat.
  private val warned: MutableSet<String> =
    Collections.synchronizedSet(HashSet<String>())

  /** True the first time [name] is seen. The caller does the logging. */
  fun shouldWarn(name: String): Boolean = warned.add(name)

  fun resetForTests() {
    warned.clear()
  }
}

/**
 * A bounded least-recently-used store of loaded artwork. Process-wide, not `remember`ed:
 * each hosted control is its own composition and would otherwise load the same icon again.
 */
internal class NitroUiIconStore<Key : Any, Value : Any>(
  private val maxEntries: Int,
  // Keys that name nothing and are never stored: `getIdentifier` answers 0 for a missing
  // resource, and 0 is a valid map key.
  private val isUnresolvable: (Key) -> Boolean = { false },
) {
  // Access-ordered: the first key is the least recently used.
  private val entries = LinkedHashMap<Key, Value>(16, 0.75f, true)

  @Synchronized
  fun get(
    key: Key,
  ): Value? = if (isUnresolvable(key)) null else entries[key]

  @Synchronized
  fun put(
    key: Key,
    value: Value,
  ) {
    if (isUnresolvable(key)) {
      return
    }
    while (entries.size >= maxEntries) {
      val oldest = entries.keys.iterator()
      if (!oldest.hasNext()) {
        break
      }
      oldest.next()
      oldest.remove()
    }
    entries[key] = value
  }

  @Synchronized
  fun size(): Int = entries.size

  @Synchronized
  fun clear() {
    entries.clear()
  }
}

/**
 * Rasterised icons by resource id, for drawables that are not vectors. Keyed by id because
 * several names can resolve to one id.
 */
internal object NitroUiIconBitmaps {
  private const val MAX_CACHED = 64

  private val store =
    NitroUiIconStore<Int, android.graphics.Bitmap>(MAX_CACHED) { resId -> resId == 0 }

  fun get(resId: Int): android.graphics.Bitmap? = store.get(resId)

  fun put(
    resId: Int,
    bitmap: android.graphics.Bitmap,
  ) = store.put(resId, bitmap)

  fun clear() = store.clear()
}

/**
 * What an `androidIcon` string names. No prefix: a drawable name, normalised and checked.
 * `res:`: a drawable name derived by the bundler, looked up verbatim. `url:`: a file to
 * read. Must match the strings `src/iconSource.ts` writes.
 */
internal sealed interface NitroUiIconSource {
  data class Name(
    val name: String,
  ) : NitroUiIconSource

  /** A file to read: Metro's dev server in development, any absolute URL otherwise. */
  data class Url(
    val url: String,
  ) : NitroUiIconSource

  companion object {
    const val URL_PREFIX = "url:"

    // Marks a name React Native derived from an asset's path. Such a name can break the
    // rules for typed names (a hoisted `node_modules` icon starts with `__`) yet resolves.
    const val RESOURCE_PREFIX = "res:"

    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.\\-]*://")

    /** Null means no icon, including for a `url:` that is not a URL. */
    fun parse(raw: String?): NitroUiIconSource? {
      if (raw.isNullOrEmpty()) {
        return null
      }
      if (raw.startsWith(URL_PREFIX)) {
        val url = raw.substring(URL_PREFIX.length)
        // `containsMatchIn`: the pattern matches only the start of a URL, so `matches` never would.
        return if (SCHEME.containsMatchIn(url)) Url(url) else null
      }
      if (raw.startsWith(RESOURCE_PREFIX)) {
        val derived = raw.substring(RESOURCE_PREFIX.length)
        return if (derived.isEmpty()) null else Name(derived)
      }
      val name = NitroUiIconNames.normalize(raw)
      return if (NitroUiIconNames.isValid(name)) Name(name) else null
    }
  }
}

/** What an `androidIcon` resolved to, as one value the composition reads. */
internal sealed interface NitroUiIconContent {
  /** Draw nothing and reserve no space. */
  data object Absent : NitroUiIconContent

  /** Reserve the slot; the file is being read. */
  data object Pending : NitroUiIconContent

  /** A drawable that is not a vector, rasterised at its intrinsic size. */
  class Bitmap(
    val bitmap: android.graphics.Bitmap,
  ) : NitroUiIconContent

  /** A vector, drawn at the slot's size. */
  class Vector(
    val image: ImageVector,
  ) : NitroUiIconContent
}

/**
 * How a [NitroUiIconSource] becomes artwork. An interface so that JVM tests can replace
 * the resource table and the network.
 */
internal interface NitroUiIconArtwork {
  fun forName(
    name: String,
  ): NitroUiIconContent

  fun cached(
    url: String,
  ): ImageVector?

  fun knownBad(
    url: String,
  ): Boolean

  /** Read [url], calling [onLoaded] on the main thread with the image or `null`. */
  fun read(
    url: String,
    onLoaded: (ImageVector?) -> Unit,
  )
}

internal class NitroUiAppIconArtwork(
  private val context: Context,
) : NitroUiIconArtwork {
  override fun forName(
    name: String,
  ): NitroUiIconContent = loadIconArtwork(context, name)

  override fun cached(
    url: String,
  ): ImageVector? = NitroUiIconFiles.cached(url)

  override fun knownBad(
    url: String,
  ): Boolean = NitroUiIconFiles.knownBad(url)

  override fun read(
    url: String,
    onLoaded: (ImageVector?) -> Unit,
  ) {
    NitroUiIconFiles.load(url, onLoaded)
  }
}

/**
 * One control's `androidIcon` state. Resolve once per change from `afterUpdate()`, never in
 * a setter or in composition: a lookup reads a synchronized table and a file load opens a
 * socket. A file reserves its slot before it arrives; the slot's size never depends on it.
 */
internal class NitroUiIconSlot {
  var content by mutableStateOf<NitroUiIconContent>(NitroUiIconContent.Absent)
    private set

  var resolved: NitroUiIconSource? = null
    private set

  /** Bumped when the requested icon changes, so a stale file load is ignored. */
  var generation: Int = 0
    private set

  fun resolve(
    raw: String?,
    artwork: NitroUiIconArtwork,
  ) {
    val source = NitroUiIconSource.parse(raw)
    if (source == resolved) {
      return
    }
    resolved = source
    val started = ++generation
    when (source) {
      null -> content = NitroUiIconContent.Absent

      is NitroUiIconSource.Name -> content = artwork.forName(source.name)

      is NitroUiIconSource.Url -> {
        val cached = artwork.cached(source.url)
        if (cached != null) {
          content = NitroUiIconContent.Vector(cached)
          return
        }
        if (artwork.knownBad(source.url)) {
          content = NitroUiIconContent.Absent
          return
        }
        content = NitroUiIconContent.Pending
        artwork.read(source.url) { image ->
          // On the main thread, which is the only thread allowed to write this.
          if (started == generation) {
            content =
              image?.let { NitroUiIconContent.Vector(it) } ?: NitroUiIconContent.Absent
          }
        }
      }
    }
  }

  fun reset() {
    content = NitroUiIconContent.Absent
    resolved = null
    // Bump rather than reset: a load started by the previous owner is still in
    // flight, and this is what retires it.
    generation += 1
  }
}

/**
 * Loads the app drawable [name]. A `<vector>` is parsed and drawn at the slot's size; a
 * rasterised copy stretched to the larger slots would be soft. Anything else is rasterised.
 * Runs on the calling thread: the resource table and theme belong to the activity.
 */
internal fun loadIconArtwork(
  context: Context,
  name: String,
): NitroUiIconContent {
  val normalizedName = NitroUiIconNames.normalize(name)
  if (normalizedName.isEmpty()) {
    return NitroUiIconContent.Absent
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
    return NitroUiIconContent.Absent
  }
  if (isVectorDrawable(context, resId)) {
    try {
      return NitroUiIconContent.Vector(NitroUiIcons.vector(context, resId))
    } catch (error: Throwable) {
      // Fall through to the rasterised copy. The `#vector` key keeps this warning from
      // suppressing the rasteriser's own, which is remembered under the plain name.
      if (NitroUiIconNames.shouldWarn("$normalizedName#vector")) {
        Log.w(
          "NitroUi",
          "androidIcon \"$name\" is a vector drawable nitro-ui could not parse " +
            "(${error.javaClass.simpleName}: ${error.message}); drawing a rasterised copy instead.",
        )
      }
    }
  }
  return loadIconBitmap(context, normalizedName, resId)
    ?.let { NitroUiIconContent.Bitmap(it) }
    ?: NitroUiIconContent.Absent
}

private const val MAX_TAGS_TO_REACH_THE_ROOT = 8

internal const val NITRO_UI_VECTOR_DRAWABLE_TAG = "vector"

// Decided by the root tag of the drawable's XML. Walked with `next()`: `nextTag()` throws
// on an AAPT2-compiled drawable, whose first event is not a tag.
private fun isVectorDrawable(
  context: Context,
  resId: Int,
): Boolean {
  var xml: android.content.res.XmlResourceParser? = null
  try {
    xml = context.resources.getXml(resId)
    var event = xml.eventType
    var tagsToRead = MAX_TAGS_TO_REACH_THE_ROOT
    while (event != XmlPullParser.START_TAG &&
      event != XmlPullParser.END_DOCUMENT &&
      tagsToRead > 0
    ) {
      val next = xml.next()
      if (next == event && tagsToRead < MAX_TAGS_TO_REACH_THE_ROOT) {
        // A parser that reports the same event twice is not making progress; stop asking.
        break
      }
      event = next
      tagsToRead -= 1
    }
    return event == XmlPullParser.START_TAG && xml.name == NITRO_UI_VECTOR_DRAWABLE_TAG
  } catch (error: Throwable) {
    // A PNG has no XML and throws `NotFoundException`: not a vector.
    return false
  } finally {
    val parser = xml
    if (parser != null) {
      try {
        parser.close()
      } catch (error: Throwable) {
        // Nothing is left to release, and the answer has already been made.
      }
    }
  }
}

// [name] must already be normalised; warnings are remembered under it.
private fun loadIconBitmap(
  context: Context,
  name: String,
  resId: Int,
): android.graphics.Bitmap? {
  NitroUiIconBitmaps.get(resId)?.let { return it }
  val drawable =
    try {
      ResourceDrawableIdHelper.getResourceDrawable(context, name)
    } catch (error: Throwable) {
      // A layer-list, an adaptive icon or a malformed vector throws here instead of
      // returning null.
      if (NitroUiIconNames.shouldWarn(name)) {
        Log.w(
          "NitroUi",
          "androidIcon \"$name\" resolved but cannot be drawn as an icon " +
            "(${error.javaClass.simpleName}: ${error.message}); nothing is drawn for it.",
        )
      }
      return null
    }
  if (drawable == null) {
    if (NitroUiIconNames.shouldWarn(name)) {
      Log.w("NitroUi", "androidIcon \"$name\" resolved but has no artwork; nothing is drawn for it.")
    }
    return null
  }
  val intrinsicWidth = drawable.intrinsicWidth
  val intrinsicHeight = drawable.intrinsicHeight
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
    // Without an intrinsic size the bitmap would differ per caller and could not be shared.
    if (NitroUiIconNames.shouldWarn(name)) {
      Log.w(
        "NitroUi",
        "androidIcon \"$name\" has no intrinsic size, so it cannot be drawn as an icon; " +
          "ship a 24 dp vector drawable instead.",
      )
    }
    return null
  }
  val bitmap = drawableToBitmap(drawable)
  NitroUiIconBitmaps.put(resId, bitmap)
  return bitmap
}

private fun drawableToBitmap(drawable: android.graphics.drawable.Drawable): android.graphics.Bitmap {
  val bitmap =
    android.graphics.Bitmap.createBitmap(
      drawable.intrinsicWidth,
      drawable.intrinsicHeight,
      android.graphics.Bitmap.Config.ARGB_8888,
    )
  val canvas = android.graphics.Canvas(bitmap)
  drawable.setBounds(0, 0, canvas.width, canvas.height)
  drawable.draw(canvas)
  return bitmap
}

@Composable
internal fun rememberIconPainter(
  content: NitroUiIconContent,
): Painter? =
  when (content) {
    is NitroUiIconContent.Bitmap -> {
      val image: ImageBitmap = content.bitmap.asImageBitmap()
      remember(image) { BitmapPainter(image) }
    }
    is NitroUiIconContent.Vector ->
      // `VectorPainter`'s constructor is internal; this is the public way to get one.
      rememberVectorPainter(content.image)
    else -> null
  }

/**
 * Vector drawables read from a URL, shared across the process. Used in development, where
 * Metro serves the `.xml` because React Native does not load `xml` assets on Android. Reads
 * run on one worker thread and answer on the main thread; waiters for one URL share a read.
 */
internal object NitroUiIconFiles {
  private const val MAX_CACHED = 64

  private const val CONNECT_TIMEOUT_MS = 5_000

  private const val READ_TIMEOUT_MS = 10_000

  private const val MAX_BYTES = 4 * 1024 * 1024

  private val loaded = NitroUiIconStore<String, ImageVector>(MAX_CACHED)

  // Only URLs whose file was judged not to be an icon. An unreachable server is not remembered.
  private val badList = NitroUiIconBadList(MAX_CACHED)

  // Guarded by [lock].
  private val waiters = HashMap<String, MutableList<(ImageVector?) -> Unit>>()

  private val lock = Any()

  private val mainHandler = Handler(Looper.getMainLooper())

  // One low-priority daemon thread. `allowCoreThreadTimeOut` is what lets it end when
  // idle: a `ThreadPoolExecutor` does not time out core threads otherwise.
  private val executor: ExecutorService =
    ThreadPoolExecutor(1, 1, 30L, TimeUnit.SECONDS, LinkedBlockingQueue()) { runnable ->
      Thread(runnable, "nitro-ui-icon").apply {
        isDaemon = true
        priority = Thread.MIN_PRIORITY
      }
    }.apply { allowCoreThreadTimeOut(true) }

  fun cached(
    url: String,
  ): ImageVector? = synchronized(lock) { loaded.get(url) }

  fun knownBad(
    url: String,
  ): Boolean = badList.isKnownBad(url)

  /** Reads [url] and calls [onLoaded] on the main thread. Call from the UI thread. */
  fun load(
    url: String,
    onLoaded: (ImageVector?) -> Unit,
  ) {
    val first =
      synchronized(lock) {
        val waiting = waiters.getOrPut(url) { mutableListOf() }
        waiting += onLoaded
        waiting.size == 1
      }
    if (!first) {
      return
    }
    try {
      executor.execute { read(url) }
    } catch (rejected: RejectedExecutionException) {
      // Only if the executor were shut down. `Temporary` releases the caller's reserved slot.
      finish(url, NitroUiIconRead.Temporary)
    }
  }

  private fun read(url: String) {
    val attempt =
      try {
        parse(url)
      } catch (error: Throwable) {
        if (NitroUiIconNames.shouldWarn(url)) {
          Log.w(
            "NitroUi",
            "androidIcon \"$url\" could not be read " +
              "(${error.javaClass.simpleName}: ${error.message?.lineSequence()?.firstOrNull()}); " +
              "nothing is drawn for it. In development this is the file Metro serves — " +
              "see docs/components/button.md, \"Android icons\".",
          )
        }
        classifyIconReadFailure(error)
      }
    finish(url, attempt)
  }

  private fun parse(
    url: String,
  ): NitroUiIconRead {
    val connection = NitroUiIconUrl.requestUri(url).toURL().openConnection()
    var stream: java.io.InputStream? = null
    try {
      if (connection is HttpURLConnection) {
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.instanceFollowRedirects = true
        val status = connection.responseCode
        if (status !in 200..299) {
          if (NitroUiIconNames.shouldWarn(url)) {
            Log.w(
              "NitroUi",
              "androidIcon \"$url\" answered $status; nothing is drawn for it. " +
                "A deleted or renamed asset answers like this in development.",
            )
          }
          return classifyIconHttpStatus(status)
        }
      }
      val declared = connection.contentLength
      if (declared > MAX_BYTES) {
        return tooLarge(url, declared.toLong())
      }
      stream = connection.getInputStream()
      // Not `readAllBytes()`, which needs API 33.
      val bytes = stream.readBytes()
      if (bytes.size > MAX_BYTES) {
        return tooLarge(url, bytes.size.toLong())
      }
      return NitroUiIconRead.Loaded(
        NitroUiVectorDrawableReader
          .read(java.io.ByteArrayInputStream(bytes))
          .toImageVector(url)
      )
    } catch (unsupported: NitroUiVectorUnsupported) {
      if (NitroUiIconNames.shouldWarn(url)) {
        Log.w("NitroUi", "androidIcon \"$url\" $unsupported; nothing is drawn for it.")
      }
      return NitroUiIconRead.Rejected
    } finally {
      stream?.close()
      if (connection is HttpURLConnection) {
        connection.disconnect()
      }
    }
  }

  private fun tooLarge(
    url: String,
    bytes: Long,
  ): NitroUiIconRead {
    if (NitroUiIconNames.shouldWarn(url)) {
      Log.w(
        "NitroUi",
        "androidIcon \"$url\" is $bytes bytes, too large to be an icon; nothing is drawn for it.",
      )
    }
    return NitroUiIconRead.Rejected
  }

  private fun finish(
    url: String,
    read: NitroUiIconRead,
  ) {
    val image = (read as? NitroUiIconRead.Loaded)?.image
    if (image != null) {
      synchronized(lock) { loaded.put(url, image) }
    }
    badList.note(url, read)
    val waiting = synchronized(lock) { waiters.remove(url)?.toList() }
    val callbacks = waiting ?: emptyList()
    if (callbacks.isEmpty()) {
      return
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      callbacks.forEach { it(image) }
    } else {
      mainHandler.post { callbacks.forEach { it(image) } }
    }
  }

  fun clearForTests() {
    synchronized(lock) {
      loaded.clear()
      waiters.clear()
    }
    badList.clear()
  }
}

/**
 * How one read of a URL ended. [Temporary] means the file was never reached (a dev server
 * restarting), so it must not be remembered as bad.
 */
internal sealed interface NitroUiIconRead {
  data class Loaded(
    val image: ImageVector,
  ) : NitroUiIconRead

  data object Rejected : NitroUiIconRead

  data object Temporary : NitroUiIconRead
}

/** Only unparseable bytes are a verdict on the file; any other failure is about the route. */
internal fun classifyIconReadFailure(error: Throwable): NitroUiIconRead =
  if (error is NitroUiVectorUnsupported) NitroUiIconRead.Rejected else NitroUiIconRead.Temporary

/** A 4xx means the file is not there. Metro answers 5xx while it compiles, so that may pass. */
internal fun classifyIconHttpStatus(status: Int): NitroUiIconRead =
  if (status in 400..499) NitroUiIconRead.Rejected else NitroUiIconRead.Temporary

/** URLs judged not to be icons. Only [NitroUiIconRead.Rejected] is remembered. */
internal class NitroUiIconBadList(
  maxEntries: Int,
) {
  private val store = NitroUiIconStore<String, Unit>(maxEntries)

  fun isKnownBad(
    url: String,
  ): Boolean = store.get(url) != null

  fun note(
    url: String,
    read: NitroUiIconRead,
  ) {
    if (read == NitroUiIconRead.Rejected) {
      store.put(url, Unit)
    }
  }

  fun clear() {
    store.clear()
  }
}

/**
 * Draws an icon at [size], tinted with [tint]. Not `material3.Icon`, which is deprecated in
 * material3 1.5. A colour filter, because the artwork is shared between controls.
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

/**
 * The glyph for a slot Material already sizes, colours and spaces (a menu row, a chip).
 * `LocalContentColor` is the colour the slot chose, including disabled and selected states.
 */
@Composable
internal fun NitroUiIconSlotGlyph(
  icon: NitroUiIconContent,
  size: Dp,
) {
  val painter = rememberIconPainter(icon)
  if (painter != null) {
    NitroUiIconGlyph(
      painter = painter,
      size = size,
      tint = LocalContentColor.current,
      contentDescription = null,
    )
  } else if (icon != NitroUiIconContent.Absent) {
    // A file still loading holds the slot at its final size.
    Spacer(modifier = Modifier.size(size))
  }
}

/**
 * The icon slot in front of a label: the artwork, an empty box of the same size while a file
 * loads, or nothing. No content description: the control's own node is what TalkBack reads.
 */
@Composable
internal fun NitroUiIconSlotContent(
  icon: NitroUiIconContent,
  size: Dp,
  spacing: Dp,
) {
  val painter = rememberIconPainter(icon)
  if (painter != null) {
    NitroUiIconGlyph(
      painter = painter,
      size = size,
      tint = LocalContentColor.current,
      contentDescription = null,
      modifier = Modifier.padding(end = spacing),
    )
  } else if (icon != NitroUiIconContent.Absent) {
    Spacer(modifier = Modifier.padding(end = spacing).size(size))
  }
}
