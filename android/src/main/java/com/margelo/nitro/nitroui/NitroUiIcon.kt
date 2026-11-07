package com.margelo.nitro.nitroui

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import com.facebook.react.views.imagehelper.ResourceDrawableIdHelper
import java.net.HttpURLConnection
import java.net.URI
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

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
 *
 * `NitroUiVectorDrawable.kt`, next to this file, is the third half: reading a
 * vector drawable's *source*, which is what the development form of the prop
 * needs. [NitroUiIconSource] decides which of the two halves a string belongs to.
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
 * A bounded, least-recently-used store of loaded artwork.
 *
 * Generic over both halves — the key (a resource id, or the URL a development
 * load came from) and the artwork (`Bitmap` for a resource, an `ImageVector` for
 * a file) — so the *policy*, the part with a bug in it, is testable on the JVM,
 * where neither `Bitmap` nor a real icon can be built at all. [NitroUiIconCache]
 * and [NitroUiIconFiles] are this with the key and artwork each one uses.
 *
 * Process-wide rather than `remember`ed because a hosted control is its own
 * composition (`docs/architecture/core.md`, "Shared objects"): a row of twenty
 * buttons would otherwise rasterise the same vector twenty times, and the
 * rasterising is the expensive part — it walks the path on the thread that asks.
 *
 * A miss costs only the work of loading, never correctness, so a small bound is
 * the safe choice against an app that renders a long list of distinct icons.
 */
internal class NitroUiIconStore<Key : Any, Value : Any>(
  private val maxEntries: Int,
  /**
   * Keys that name nothing, so nothing is ever kept under them. Android's
   * `getIdentifier` answers 0 for "no such resource" and 0 is a perfectly good
   * map key, which is how a failure would otherwise come to be drawn.
   */
  private val isUnresolvable: (Key) -> Boolean = { false },
) {
  /** Access-ordered, so the first key is the one nothing has asked for lately. */
  private val entries = LinkedHashMap<Key, Value>(16, 0.75f, true)

  /** The artwork loaded for [key], or `null`. */
  @Synchronized
  fun get(
    key: Key,
  ): Value? = if (isUnresolvable(key)) null else entries[key]

  /** Remember [value] for [key], evicting the least recently used entry first. */
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

  /** How much is held. For tests. */
  @Synchronized
  fun size(): Int = entries.size

  /** Drop everything. */
  @Synchronized
  fun clear() {
    entries.clear()
  }
}

/**
 * The bitmaps behind every `androidIcon` in this process, keyed by resource id.
 *
 * The id, not the name: two names can reach one id (the normalising above, and
 * `drawable-hdpi`/`drawable` variants), and the id is what the pixels belong to.
 */
internal object NitroUiIconCache {
  /** Loaded names to remember before starting over. A handful per app, in practice. */
  private const val MAX_CACHED = 64

  private val store =
    NitroUiIconStore<Int, android.graphics.Bitmap>(MAX_CACHED) { resId -> resId == 0 }

  /** The cached bitmap for [resId], or `null` when nothing has loaded it yet. */
  fun get(resId: Int): android.graphics.Bitmap? = store.get(resId)

  /** Remember the bitmap loaded for [resId]. */
  fun put(
    resId: Int,
    bitmap: android.graphics.Bitmap,
  ) = store.put(resId, bitmap)

  /** Drop everything. */
  fun clear() = store.clear()
}

/**
 * What an `androidIcon` string asks for, once the wrapper's marker has been read.
 *
 * The prop crosses into native as one plain string (D43: never an AnyMap), and
 * one prefix tells native which of the two sources it names:
 *
 *  - **no prefix — [Name]**: a drawable in the app's resources, which is what
 *    round 1 sent and what a release build turns a `require()`'d `.xml` into. The
 *    resource table answers for it, so it can be resolved on the spot.
 *  - **`url:` — [Url]**: a file to read, which is what a development build turns
 *    the same `require()` into, because React Native will not serve `.xml` assets
 *    itself. Reading a file cannot be answered on the spot, so this half is where
 *    the async machinery lives.
 *
 * A colon cannot appear in a resource name, so the prefix cannot be mistaken for
 * one and round 1's strings keep their meaning — which is why there is no
 * `drawable:` prefix to go with the other one.
 *
 * The Kotlin twin of `src/iconSource.ts`, which writes these strings; the two are
 * pinned to each other by `src/__tests__/iconSource.test.ts` and
 * `android/src/test/.../NitroUiIconTest.kt`.
 */
internal sealed interface NitroUiIconSource {
  /** A drawable in the app's resources, already normalised by [NitroUiIconNames]. */
  data class Name(
    val name: String,
  ) : NitroUiIconSource

  /** A file to read: Metro's dev server in development, any absolute URL otherwise. */
  data class Url(
    val url: String,
  ) : NitroUiIconSource

  companion object {
    /** The marker [Url] carries. See the class doc for why only it needs one. */
    const val URL_PREFIX = "url:"

    /** A scheme, and therefore a URL rather than a resource name. */
    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.\\-]*://")

    /**
     * The string React sent, as a source — or `null` for "no icon".
     *
     * An unparseable `url:` (a wrapper bug, or a hand-written prop) is `null`
     * rather than a name: drawing nothing is what a missing icon does, and
     * pretending the whole string is a resource name would ask the resource table
     * for `url:http://…`, log a warning about a name nobody wrote, and still draw
     * nothing.
     */
    fun parse(raw: String?): NitroUiIconSource? {
      if (raw.isNullOrEmpty()) {
        return null
      }
      if (raw.startsWith(URL_PREFIX)) {
        val url = raw.substring(URL_PREFIX.length)
        // `containsMatchIn`, not `matches`: the pattern is anchored at the start and
        // left open at the end, because it names the *beginning* of a URL. Written
        // with `matches` it asks the whole URL to be a scheme, answers no to every
        // real one, and development builds draw no icon at all.
        return if (SCHEME.containsMatchIn(url)) Url(url) else null
      }
      val name = NitroUiIconNames.normalize(raw)
      // A name the resource table could never hold is not a lookup waiting to fail,
      // it is the absence of an icon — the same answer JS gives it, since
      // `src/iconName.ts` reports it as a problem and sends it anyway.
      return if (NitroUiIconNames.isValid(name)) Name(name) else null
    }
  }
}

/**
 * What an `androidIcon` resolved to, as the composition sees it.
 *
 * One value rather than a bitmap plus a flag, because the three states are not
 * independent and a composition must not be able to read a half-updated one: an
 * icon either has artwork, is still arriving, or has nothing to draw.
 *
 * [Pending] is the state a development build starts in and a release build never
 * reaches. It reserves the icon slot and draws nothing in it, which is how the
 * slot's size comes from the size ladder instead of from a file that has not
 * arrived (`docs/components/button.md`, "Android icons").
 */
internal sealed interface NitroUiIconContent {
  /** Draw nothing, and reserve nothing: the Button is its no-icon self. */
  data object Absent : NitroUiIconContent

  /** Reserve the slot; the file is being read. */
  data object Pending : NitroUiIconContent

  /** A rasterised app drawable — the resource form, resolved by [loadIconBitmap]. */
  class Bitmap(
    val bitmap: android.graphics.Bitmap,
  ) : NitroUiIconContent

  /** A vector read from a file — the development form, parsed by [NitroUiVectorDrawableReader]. */
  class Vector(
    val image: ImageVector,
  ) : NitroUiIconContent
}

/**
 * The two ways a [NitroUiIconSource] becomes artwork, behind one seam.
 *
 * A [ButtonModel] does not read resources or open sockets itself — it decides
 * *what to ask for* and *what to do with the answer*. Both halves of that answer
 * need something the JVM has no equivalent for (`Resources`, a socket, the main
 * `Looper`), so the seam is what lets the deciding be tested where it can be
 * tested, and what keeps the decision in one place instead of spread across the
 * branches of `when` at the call site.
 *
 * The production implementation is [NitroUiAppIconArtwork], which holds the
 * control's `Context` for the length of the control; a test implements this
 * against a map.
 */
internal interface NitroUiIconArtwork {
  /** The artwork for a resource [name], or [NitroUiIconContent.Absent] if there is none. */
  fun forName(
    name: String,
  ): NitroUiIconContent

  /** Artwork this process has already read for [url], or `null` if it has not. */
  fun cached(
    url: String,
  ): ImageVector?

  /** Whether reading [url] has already been tried and failed. */
  fun knownBad(
    url: String,
  ): Boolean

  /** Read [url], calling [onLoaded] on the main thread with the image or `null`. */
  fun read(
    url: String,
    onLoaded: (ImageVector?) -> Unit,
  )
}

/**
 * [NitroUiIconArtwork] as an app runs it: the app's resources, and [NitroUiIconFiles].
 *
 * One per control, holding that control's `Context` — the same lifetime as the
 * view that creates it, and the same `Context` [loadIconBitmap] has always needed
 * to read a drawable through the activity's theme.
 */
internal class NitroUiAppIconArtwork(
  private val context: Context,
) : NitroUiIconArtwork {
  override fun forName(
    name: String,
  ): NitroUiIconContent =
    loadIconBitmap(context, name)?.let { NitroUiIconContent.Bitmap(it) } ?: NitroUiIconContent.Absent

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
): android.graphics.Bitmap? {
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

/**
 * The painter for whatever an `androidIcon` resolved to, or `null` when there is
 * nothing to draw yet.
 *
 * Two artwork types, one painter each: a rasterised app drawable becomes a
 * [BitmapPainter] and a parsed vector becomes a [VectorPainter], which is how the
 * development form of the prop is drawn by the same Compose vector path as every
 * Material icon beside it. [remember]ed per artwork identity: building a painter
 * is cheap, and unlike the colours and shapes in [HybridNitroUiButton] it is
 * derived from nothing in the theme, so a per-composition `remember` is enough —
 * the *shared* thing is the artwork, and that is [NitroUiIconCache]'s and
 * [NitroUiIconFiles]' job.
 */
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
      // Compose's own: `VectorPainter`'s constructor is internal, and this is the
      // public door to it — the same one `painterResource` walks for a vector
      // drawable. It remembers per `image`, which is the identity that matters.
      rememberVectorPainter(content.image)
    else -> null
  }

/**
 * The vector drawables read from a file, shared across the process by URL.
 *
 * This is the development half of `androidIcon`: Metro serves the `.xml` the app
 * `require`d, and nitro-ui reads it because React Native will not
 * (`assetSupportsNetworkLoads` in `AssetSourceResolver.js` refuses `xml` on
 * Android — see `src/iconSource.ts`, which builds the URL).
 *
 * Three things are true of every load here and none of them are true of a
 * resource lookup, which is why it is a separate object rather than another arm
 * of [loadIconBitmap]:
 *
 *  - **It cannot finish on the caller's thread.** `afterUpdate()` runs on the main
 *    thread and must not wait on a socket, so the bytes are read on one worker
 *    thread and the answer is posted back. [NitroUiVectorDrawableReader] does the
 *    parsing off-main too: it is Compose data structures, not `Bitmap`s, and
 *    touches no `Context`, so there is nothing to gain by doing it on the UI
 *    thread and a frame to lose.
 *  - **It can fail for reasons the resource table has no equivalent for.** A 404
 *    (the file was deleted, or Metro restarted and the hash moved), a refused
 *    connection (the dev server is not running), a malformed file. All three are
 *    one line in the log per URL and then silence, and all three answer
 *    [Absent] — the size round 1 gives a name that does not resolve. A failed
 *    load is *remembered*: retrying it per frame is how a deleted icon turns a
 *    screen into a request loop.
 *  - **Many controls can ask for one URL at once.** A toolbar with three buttons
 *    and a list row with an icon each all mount in the same frame. The waiters are
 *    kept per URL and woken together, so twenty rows read the file once, which is
 *    the same promise [NitroUiIconCache] makes about resource ids.
 */
internal object NitroUiIconFiles {
  /** URLs to remember before starting over. Same bound as the resource cache. */
  private const val MAX_CACHED = 64

  /** A dev server is on the same LAN, or on the machine; five seconds is generous. */
  private const val CONNECT_TIMEOUT_MS = 5_000

  /** The body is a few kilobytes of path data. Ten seconds is generous too. */
  private const val READ_TIMEOUT_MS = 10_000

  /**
   * A ceiling on what counts as an icon.
   *
   * An app that points `androidIcon` at a 40 MB file would otherwise have the UI
   * waiting on a parse of it — in development, where the same file is a
   * round-trip away from being a `Bitmap` anyway. A vector drawable that large is
   * not an icon, and saying so is better than drawing it badly.
   */
  private const val MAX_BYTES = 4 * 1024 * 1024

  private val loaded = NitroUiIconStore<String, ImageVector>(MAX_CACHED)

  /** URLs already reported as unreadable, so a broken icon costs one attempt, not one per frame. */
  private val failed = NitroUiIconStore<String, Unit>(MAX_CACHED)

  /** Callbacks waiting on an in-flight URL, under [lock]. */
  private val waiters = HashMap<String, MutableList<(ImageVector?) -> Unit>>()

  private val lock = Any()

  private val mainHandler = Handler(Looper.getMainLooper())

  /**
   * One worker thread, gone when idle for half a minute.
   *
   * One, because the work is a few kilobytes over a local socket and an icon that
   * arrives 20 ms later than the frame beside it is not visible; more would let a
   * screen full of new icons contend for the dev server, which is also compiling
   * the bundle. The keep-alive is so a screen that changes icons keeps its thread
   * rather than paying for a new one, and the daemon flag is so a process that
   * stops asking never holds a thread open.
   */
  private val executor: ExecutorService =
    ThreadPoolExecutor(1, 1, 30L, TimeUnit.SECONDS, LinkedBlockingQueue()) { runnable ->
      Thread(runnable, "nitro-ui-icon").apply {
        isDaemon = true
        priority = Thread.MIN_PRIORITY
      }
    }

  /** Artwork already read for [url], or `null` if nothing has arrived yet. */
  fun cached(
    url: String,
  ): ImageVector? = synchronized(lock) { loaded.get(url) }

  /** Whether [url] has already been reported unreadable. */
  fun knownBad(
    url: String,
  ): Boolean = synchronized(lock) { failed.get(url) != null }

  /**
   * Read [url] and call [onLoaded] on the main thread with the image, or `null`.
   *
   * Called from the UI thread. A URL already being read gets another waiter
   * rather than another request; the callback list is what makes "cached per URL
   * for the process" true for icons that are asked for simultaneously, which a
   * cache alone is not.
   */
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
      // Only reachable if the executor were ever shut down, which nothing does.
      // Answering `null` keeps the caller's slot from being reserved forever.
      finish(url, null)
    }
  }

  /** Read and parse [url] on the worker thread. */
  private fun read(url: String) {
    val image =
      try {
        parse(url)
      } catch (error: Throwable) {
        // Socket timeouts, `UnknownHostException`, `FileNotFoundException` from a
        // `file:` URL, an OutOfMemoryError from a monster file. The answer to all
        // of them is the same as to a name that is not in the resource table.
        if (NitroUiIconNames.shouldWarn(url)) {
          Log.w(
            "NitroUi",
            "androidIcon \"$url\" could not be read " +
              "(${error.javaClass.simpleName}: ${error.message?.lineSequence()?.firstOrNull()}); " +
              "nothing is drawn for it. In development this is the file Metro serves — " +
              "see docs/components/button.md, \"Android icons\".",
          )
        }
        null
      }
    finish(url, image)
  }

  private fun parse(
    url: String,
  ): ImageVector? {
    val connection = URI(url).toURL().openConnection()
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
          return null
        }
      }
      val declared = connection.contentLength
      if (declared > MAX_BYTES) {
        return tooLarge(url, declared.toLong())
      }
      stream = connection.getInputStream()
      // `readAllBytes()` is API 33 and this library supports 24; Kotlin's own
      // read is the one that exists on every version the icon has to work on.
      val bytes = stream.readBytes()
      if (bytes.size > MAX_BYTES) {
        return tooLarge(url, bytes.size.toLong())
      }
      return NitroUiVectorDrawableReader
        .read(java.io.ByteArrayInputStream(bytes))
        .toImageVector(url)
    } catch (unsupported: NitroUiVectorUnsupported) {
      if (NitroUiIconNames.shouldWarn(url)) {
        Log.w("NitroUi", "androidIcon \"$url\" $unsupported; nothing is drawn for it.")
      }
      return null
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
  ): Nothing? {
    if (NitroUiIconNames.shouldWarn(url)) {
      Log.w(
        "NitroUi",
        "androidIcon \"$url\" is $bytes bytes, too large to be an icon; nothing is drawn for it.",
      )
    }
    return null
  }

  /** Cache the answer and wake every control that asked for this URL, on the main thread. */
  private fun finish(
    url: String,
    image: ImageVector?,
  ) {
    val waiting =
      synchronized(lock) {
        if (image != null) {
          loaded.put(url, image)
        } else {
          failed.put(url, Unit)
        }
        waiters.remove(url)?.toList()
      }
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

  /** Forget everything. For tests. */
  fun clearForTests() {
    synchronized(lock) {
      loaded.clear()
      failed.clear()
      waiters.clear()
    }
  }
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
