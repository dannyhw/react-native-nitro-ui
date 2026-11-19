package nitroui.example

import android.graphics.Bitmap
import android.os.Debug
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.semantics.getOrNull
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.nitroui.SearchFieldStrings

/**
 * Test-only probe for the harness suite: answers questions about the process and its view
 * tree that JS cannot ask. Every method is a Promise, because bridgeless does not expose
 * a legacy module's synchronous methods to JS.
 */
@ReactModule(name = NitroUiProbeModule.MODULE_NAME)
class NitroUiProbeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = MODULE_NAME

  /** Java heap in use, optionally after asking the garbage collectors to run. */
  @ReactMethod
  fun heapStats(forceGc: Boolean, promise: Promise) {
    try {
      if (forceGc) {
        // Two passes with a settle wait: ART treats `System.gc()` as advisory, and one
        // call can be coalesced into a concurrent collection that has not finished by
        // the time the heap is read.
        repeat(2) {
          System.gc()
          System.runFinalization()
          Thread.sleep(GC_SETTLE_MS)
        }
      }
      val runtime = Runtime.getRuntime()
      val info = Debug.MemoryInfo().also(Debug::getMemoryInfo)
      val stats =
        Arguments.createMap().apply {
          putDouble("usedBytes", (runtime.totalMemory() - runtime.freeMemory()).toDouble())
          putDouble("totalBytes", runtime.totalMemory().toDouble())
          putDouble("maxBytes", runtime.maxMemory().toDouble())
          putDouble("dalvikPrivateDirtyKb", info.dalvikPrivateDirty.toDouble())
          putDouble("dalvikPssKb", info.dalvikPss.toDouble())
        }
      promise.resolve(stats)
    } catch (error: Throwable) {
      promise.reject("heap-stats", error)
    }
  }

  /** Whether RN's `enableViewRecycling` flag is on, read through RN's own accessor. */
  @ReactMethod
  fun viewRecyclingEnabled(promise: Promise) {
    try {
      promise.resolve(ReactNativeFeatureFlags.enableViewRecycling())
    } catch (error: Throwable) {
      promise.reject("view-recycling-flag", error)
    }
  }

  /**
   * The SearchField's framework strings. `app*` is what the app's own configuration
   * resolves, `locale*` what [localeTag] resolves, `device*` what the device's
   * configuration resolves, and `host*` what the mounted hosted control's own context
   * resolves. The three locales are reported too, so a test can tell whether they differ.
   */
  @ReactMethod
  fun searchFieldStrings(localeTag: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "the example app has no activity")
      return
    }
    activity.runOnUiThread {
      try {
        val (appHint, appClear) = SearchFieldStrings.forLocale(activity, "")
        val (localeHint, localeClear) = SearchFieldStrings.forLocale(activity, localeTag)
        // The device's own configuration, which a field must not read: the framework
        // strings looked up in `Resources.getSystem()` are the device's words whatever
        // the app is showing.
        val system = android.content.res.Resources.getSystem()
        val host = findHost(activity.window.decorView)
        val hostStrings = host?.let { SearchFieldStrings.forLocale(it.context, "") }
        val answer =
          Arguments.createMap().apply {
            putString("appHint", appHint)
            putString("appClear", appClear)
            putString("localeHint", localeHint)
            putString("localeClear", localeClear)
            putString("deviceHint", deviceString(system, "search_hint"))
            putString("deviceClear", deviceString(system, "searchview_description_clear"))
            putString("appLocale", activity.resources.configuration.locales.toLanguageTags())
            putString("deviceLocale", system.configuration.locales.toLanguageTags())
            putString(
              "requestedLocale",
              if (localeTag.isEmpty()) {
                ""
              } else {
                val configuration = android.content.res.Configuration(activity.resources.configuration)
                configuration.setLocale(java.util.Locale.forLanguageTag(localeTag))
                activity
                  .createConfigurationContext(configuration)
                  .resources
                  .configuration
                  .locales
                  .toLanguageTags()
              },
            )
            putString("hostHint", hostStrings?.first ?: "")
            putString("hostClear", hostStrings?.second ?: "")
          }
        promise.resolve(answer)
      } catch (error: Throwable) {
        promise.reject("search-field-strings", error)
      }
    }
  }

  /** [name] as the device's configuration resolves it: the framework's private strings. */
  private fun deviceString(
    resources: android.content.res.Resources,
    name: String,
  ): String {
    val id = resources.getIdentifier(name, "string", "android")
    return if (id != 0) resources.getString(id) else ""
  }

  private var connection: android.view.inputmethod.InputConnection? = null
  private var connectionView: android.view.View? = null

  /**
   * Types into the focused field through its `InputConnection`, the way an IME does (a
   * Compose field has no `EditText` to type into). `commit` commits [text], `compose` sets
   * it as composing text, `finish` commits the composition, `cancel` deletes it, `action`
   * presses Return, and `connect` starts a fresh connection. Answers the focused view's
   * class name.
   */
  @ReactMethod
  fun imeInput(kind: String, text: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "the example app has no activity")
      return
    }
    activity.runOnUiThread {
      try {
        val focused = activity.currentFocus
        if (focused == null) {
          promise.reject("NO_FOCUS", "no view has focus")
          return@runOnUiThread
        }
        // A composition is held on one connection; every other kind gets a fresh one,
        // because a recycled view keeps no session a cached connection could reach.
        val composing = kind == "compose" || kind == "finish" || kind == "cancel"
        if (!composing || kind == "connect" || connectionView !== focused || connection == null) {
          connection = focused.onCreateInputConnection(android.view.inputmethod.EditorInfo())
          connectionView = focused
        }
        val ic = connection
        if (ic == null) {
          promise.reject("NO_INPUT", "${focused.javaClass.simpleName} has no input connection")
          return@runOnUiThread
        }
        when (kind) {
          "connect" -> Unit
          // Close any composing region the keyboard opened over the word at the caret
          // first, or `commitText` replaces that word instead of adding to it.
          "commit" -> {
            ic.finishComposingText()
            ic.commitText(text, 1)
          }
          "compose" -> ic.setComposingText(text, 1)
          "finish" -> ic.finishComposingText()
          "cancel" -> {
            ic.setComposingText("", 1)
            ic.finishComposingText()
          }
          "action" -> ic.performEditorAction(android.view.inputmethod.EditorInfo.IME_ACTION_DONE)
          else -> {
            promise.reject("BAD_KIND", "unknown input kind $kind")
            return@runOnUiThread
          }
        }
        promise.resolve(focused.javaClass.simpleName)
      } catch (error: Throwable) {
        promise.reject("IME_INPUT", error)
      }
    }
  }

  /**
   * What the view tagged [testTag] paints: copies its rectangle out of the window with
   * `PixelCopy` and answers how many pixels are within [tolerance] per channel of
   * [colorArgb] (the number `processColor` produced), and the box those pixels span.
   */
  @ReactMethod
  fun paintedInk(testTag: String, colorArgb: Double, tolerance: Double, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    val window = activity?.window
    if (activity == null || window == null) {
      promise.reject("NO_ACTIVITY", "the example app has no activity to copy from")
      return
    }
    val target: View? = activity.window.decorView.findViewWithTag(testTag)
    if (target == null) {
      promise.reject("NO_VIEW", "no view in the tree is tagged \"$testTag\"")
      return
    }
    val width = target.width
    val height = target.height
    if (width <= 0 || height <= 0) {
      promise.reject("NO_SIZE", "\"$testTag\" is $width x $height - it has not laid out")
      return
    }
    val location = IntArray(2)
    target.getLocationInWindow(location)
    val source =
      android.graphics.Rect(
        location[0],
        location[1],
        location[0] + width,
        location[1] + height
      )
    if (source.left < 0 || source.top < 0) {
      // PixelCopy reads the window, so a control scrolled out of it has no pixels.
      promise.reject("OFF_WINDOW", "\"$testTag\" is at ${source.left},${source.top} in the window")
      return
    }
    val rgb = colorArgb.toLong().toInt()
    val red = android.graphics.Color.red(rgb)
    val green = android.graphics.Color.green(rgb)
    val blue = android.graphics.Color.blue(rgb)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    val done = java.util.concurrent.CountDownLatch(1)
    var copyResult = PixelCopy.ERROR_UNKNOWN
    var attempts = 0
    lateinit var listener: PixelCopy.OnPixelCopyFinishedListener
    listener =
      PixelCopy.OnPixelCopyFinishedListener { result ->
        copyResult = result
        if (result != PixelCopy.SUCCESS && attempts < PIXEL_COPY_ATTEMPTS - 1) {
          attempts += 1
          // A window that has not composited this frame yet answers without data, and
          // the next frame normally has it.
          handler.postDelayed({ PixelCopy.request(window, source, bitmap, listener, handler) }, 120)
        } else {
          done.countDown()
        }
      }
    activity.runOnUiThread { PixelCopy.request(window, source, bitmap, listener, handler) }
    if (!done.await(6, java.util.concurrent.TimeUnit.SECONDS)) {
      bitmap.recycle()
      promise.reject("PIXEL_COPY_TIMEOUT", "PixelCopy did not answer for \"$testTag\"")
      return
    }
    if (copyResult != PixelCopy.SUCCESS) {
      bitmap.recycle()
      promise.reject("PIXEL_COPY_FAILED", "PixelCopy result $copyResult after $attempts retries")
      return
    }

    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    bitmap.recycle()
    var count = 0
    var minX = width
    var maxX = -1
    var minY = height
    var maxY = -1
    // Diagnostics for a zero ink count: how much of the box drew anything, and which
    // colour it drew most.
    var opaqueCount = 0
    val histogram = HashMap<Int, Int>()
    for (y in 0 until height) {
      for (x in 0 until width) {
        val pixel = pixels[y * width + x]
        if (android.graphics.Color.alpha(pixel) > 8) {
          opaqueCount += 1
          histogram[pixel] = (histogram[pixel] ?: 0) + 1
        }
        if (
          kotlin.math.abs(android.graphics.Color.red(pixel) - red) <= tolerance &&
            kotlin.math.abs(android.graphics.Color.green(pixel) - green) <= tolerance &&
            kotlin.math.abs(android.graphics.Color.blue(pixel) - blue) <= tolerance
        ) {
          count += 1
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    val topColor = histogram.maxByOrNull { it.value }
    promise.resolve(
      Arguments.createMap().apply {
        putDouble("width", width.toDouble())
        putDouble("height", height.toDouble())
        putDouble("inkCount", count.toDouble())
        // -1 when nothing matched.
        putDouble("inkWidth", if (maxX >= 0) (maxX - minX + 1).toDouble() else -1.0)
        putDouble("inkHeight", if (maxY >= 0) (maxY - minY + 1).toDouble() else -1.0)
        putDouble("attempts", attempts.toDouble())
        putDouble("opaqueCount", opaqueCount.toDouble())
        // Unsigned, to match the number `processColor` gives JS.
        putDouble(
          "topColor",
          ((topColor?.key ?: 0).toLong() and 0xFFFFFFFFL).toDouble()
        )
        putDouble("topColorCount", (topColor?.value ?: 0).toDouble())
      }
    )
  }

  private companion object {
    const val MODULE_NAME = "NitroUiProbe"

    private const val PIXEL_COPY_ATTEMPTS = 4

    const val GC_SETTLE_MS = 250L

    /** Must match `SEARCH_FIELD_GLYPH_TAG` in the library's `HybridNitroUiSearchField.kt`. */
    const val SEARCH_FIELD_GLYPH_TAG = "nitroui.searchfield.glyph"
  }

  /**
   * Drops a live hosted control while it is still attached, then measures it once, as
   * `stopSurface` followed by a layout pass would. Answers
   * `"<host class>|attached=<bool>|dropped|measuredWidth=<n>"`, where a width of 0 means
   * the dropped host declined to compose, or `"no-host|..."` when nothing hosted is on
   * screen.
   */
  @ReactMethod
  fun simulatePostDropMeasure(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "the example app has no activity to walk")
      return
    }
    val decor = activity.window?.decorView
    if (decor == null) {
      promise.reject("NO_DECOR", "the activity has no decor view to walk")
      return
    }
    val done = java.util.concurrent.CountDownLatch(1)
    var answer = "no-host"
    activity.runOnUiThread {
      val host = findHost(decor)
      if (host != null) {
        val attached = host.isAttachedToWindow
        host.drop()
        // A spec the host has never been given: Android returns a cached result for a
        // spec it has seen without calling `onMeasure`. Not `requestLayout()`, which
        // would measure the dropped host again on a later frame, during another test.
        val spec =
          android.view.View.MeasureSpec.makeMeasureSpec(2000, android.view.View.MeasureSpec.EXACTLY)
        host.measure(spec, spec)
        answer =
          "${host.javaClass.simpleName}|attached=$attached|dropped|" +
            "measuredWidth=${host.measuredWidth}"
      } else {
        answer =
          "no-host|activity=${activity.javaClass.simpleName}|" +
            "root=${decor.javaClass.simpleName}|views=${countViews(decor)}|" +
            "reactViews=${countNamed(decor, "React")}"
      }
      done.countDown()
    }
    done.await(5, java.util.concurrent.TimeUnit.SECONDS)
    promise.resolve(answer)
  }

  /**
   * The colour SearchField's search glyph paints at four points of its icon box, given in
   * the 960-unit viewport Material Symbols draws in: `bg` (40, 40), a corner no search
   * glyph paints; `centre` (380, 380), the lens centre a magnifier leaves bare; `ring`
   * (160, 380) and `ringTop` (380, 160), the middle of the ring's stroke. The host is
   * drawn into a bitmap because a hybrid view has no surface of its own to copy.
   */
  @ReactMethod
  fun searchGlyphPixels(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    val decor = activity?.window?.decorView
    if (activity == null || decor == null) {
      promise.reject("NO_ACTIVITY", "the example app has no activity to walk")
      return
    }
    val done = java.util.concurrent.CountDownLatch(1)
    var answer = "no-host"
    activity.runOnUiThread {
      try {
        answer = sampleSearchGlyph(decor)
      } finally {
        done.countDown()
      }
    }
    done.await(5, java.util.concurrent.TimeUnit.SECONDS)
    promise.resolve(answer)
  }

  private fun sampleSearchGlyph(decor: android.view.View): String {
    val host = findHost(decor) ?: return "no-host"
    val root = findComposeRoot(host) ?: return "no-compose-root|host=${host.javaClass.simpleName}"
    val glyph =
      findTagged(root.semanticsOwner.unmergedRootSemanticsNode, SEARCH_FIELD_GLYPH_TAG)
        ?: return "no-glyph|host=${host.javaClass.simpleName}"
    val bounds = glyph.boundsInWindow
    val hostOrigin = IntArray(2)
    host.getLocationInWindow(hostOrigin)
    val left = bounds.left - hostOrigin[0]
    val top = bounds.top - hostOrigin[1]
    val size = bounds.width
    if (size < 8f || host.width < 2 || host.height < 2) {
      return "too-small|box=${bounds.width}x${bounds.height}|host=${host.width}x${host.height}"
    }
    val bitmap =
      android.graphics.Bitmap.createBitmap(host.width, host.height, android.graphics.Bitmap.Config.ARGB_8888)
    try {
      val canvas = android.graphics.Canvas(bitmap)
      canvas.drawColor(0xFF808080.toInt())
      host.draw(canvas)
      fun at(x: Float, y: Float): String {
        val column = (left + size * x / 960f).toInt().coerceIn(0, host.width - 1)
        val row = (top + bounds.height * y / 960f).toInt().coerceIn(0, host.height - 1)
        return "#%06X".format(bitmap.getPixel(column, row) and 0xFFFFFF)
      }
      return "box=${bounds.width.toInt()}x${bounds.height.toInt()}" +
        "|bg=${at(40f, 40f)}|centre=${at(380f, 380f)}" +
        "|ring=${at(160f, 380f)}|ringTop=${at(380f, 160f)}"
    } finally {
      bitmap.recycle()
    }
  }

  private fun findComposeRoot(view: android.view.View): androidx.compose.ui.node.RootForTest? {
    if (view is androidx.compose.ui.node.RootForTest) {
      return view
    }
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        findComposeRoot(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  private fun findTagged(
    node: androidx.compose.ui.semantics.SemanticsNode,
    tag: String,
  ): androidx.compose.ui.semantics.SemanticsNode? {
    if (node.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag) == tag) {
      return node
    }
    for (child in node.children) {
      findTagged(child, tag)?.let { return it }
    }
    return null
  }

  /**
   * Takes the view tagged [testTag] out of its parent without unmounting it, so a test can
   * observe a detach on its own (an RN unmount also drops the view). [attachTaggedView]
   * puts it back. Answers `"<view class>|<parent class>|index=<n>|attached=<bool>"`.
   */
  @ReactMethod
  fun detachTaggedView(testTag: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    val decor = activity?.window?.decorView
    if (decor == null) {
      promise.reject("NO_ACTIVITY", "the example app has no window to detach from")
      return
    }
    val done = java.util.concurrent.CountDownLatch(1)
    var failure = ""
    var answer = ""
    activity.runOnUiThread {
      val target = decor.findViewWithTag<View>(testTag)
      val parent = target?.parent as? ViewGroup
      if (target == null || parent == null) {
        failure = "no-view"
      } else if (detachedSlot?.tag == testTag) {
        failure = "already-detached"
      } else {
        val index = parent.indexOfChild(target)
        parent.removeViewAt(index)
        detachedSlot = Slot(testTag, target, parent, index)
        answer =
          "${target.javaClass.simpleName}|${parent.javaClass.simpleName}|" +
            "index=$index|attached=${target.isAttachedToWindow}"
      }
      done.countDown()
    }
    done.await(5, java.util.concurrent.TimeUnit.SECONDS)
    if (failure.isNotEmpty()) {
      promise.reject("NO_VIEW", "$failure: cannot detach a view tagged \"$testTag\"")
    } else {
      promise.resolve(answer)
    }
  }

  /** Puts back what [detachTaggedView] took out, at the same index in the same parent. */
  @ReactMethod
  fun attachTaggedView(testTag: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "the example app has no window to attach to")
      return
    }
    val done = java.util.concurrent.CountDownLatch(1)
    var failure = ""
    var answer = ""
    activity.runOnUiThread {
      val slot = detachedSlot?.takeIf { it.tag == testTag }
      if (slot == null) {
        failure = "nothing-detached"
      } else {
        slot.parent.addView(slot.view, slot.index)
        detachedSlot = null
        answer =
          "${slot.view.javaClass.simpleName}|index=${slot.index}|" +
            "attached=${slot.view.isAttachedToWindow}"
      }
      done.countDown()
    }
    done.await(5, java.util.concurrent.TimeUnit.SECONDS)
    if (failure.isNotEmpty()) {
      promise.reject("NO_SLOT", "$failure: no detached view tagged \"$testTag\"")
    } else {
      promise.resolve(answer)
    }
  }

  private class Slot(
    val tag: String,
    val view: View,
    val parent: ViewGroup,
    val index: Int
  )

  private var detachedSlot: Slot? = null

  private fun countViews(view: android.view.View): Int {
    var total = 1
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        total += countViews(view.getChildAt(index))
      }
    }
    return total
  }

  private fun countNamed(view: android.view.View, needle: String): Int {
    var total = if (view.javaClass.name.contains(needle)) 1 else 0
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        total += countNamed(view.getChildAt(index), needle)
      }
    }
    return total
  }

  /** The first hosted control in the view tree: the test must keep one mounted. */
  private fun findHost(
    view: android.view.View
  ): com.margelo.nitro.nitroui.core.NitroComposeHost<*>? {
    if (view is com.margelo.nitro.nitroui.core.NitroComposeHost<*>) {
      return view
    }
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        findHost(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }
}

class NitroUiProbePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(NitroUiProbeModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
