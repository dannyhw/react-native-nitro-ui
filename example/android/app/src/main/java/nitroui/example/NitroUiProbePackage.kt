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

/**
 * Test-only memory probe for the harness suite (task B1).
 *
 * Lives in the example app, not in the library: it is instrumentation for
 * `example/__tests__/MountChurn.harness.tsx`, and nothing a consumer can reach.
 * The question it answers - "is the Java heap still held after a full collect the
 * same size it was before mounting and unmounting N controls K times?" - needs a
 * number from inside the process, which JS has no way to ask for (Hermes reports
 * only its own heap).
 *
 * A legacy module on purpose: the example app has no codegen spec of its own, and
 * bridgeless reaches such modules through the interop layer. Every method is a
 * Promise, because bridgeless does not expose legacy synchronous methods to JS.
 */
@ReactModule(name = NitroUiProbeModule.MODULE_NAME)
class NitroUiProbeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = MODULE_NAME

  /**
   * Java heap in use, with the garbage collectors asked to run first.
   *
   * `Runtime.totalMemory() - freeMemory()` is what the process is *holding*: ART
   * keeps committed pages after a collect, so a leak shows as a floor that climbs
   * cycle over cycle while a churning app returns to the same floor. The dalvik
   * numbers are reported next to it because the runtime measures them rather than
   * deriving them, and a disagreement between the two is worth seeing in a failure
   * message.
   */
  @ReactMethod
  fun heapStats(forceGc: Boolean, promise: Promise) {
    try {
      if (forceGc) {
        // Two passes, each with finalisation run and a settle wait after it: ART
        // treats `System.gc()` as advisory, and one call can be coalesced into a
        // concurrent collection that has not finished by the time the heap is
        // read. Finalisers matter here too - `View` decrements its live-instance
        // counter from one.
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

  /**
   * Whether RN's `enableViewRecycling` flag is on **as the process now sees it**.
   *
   * The one number that lets `example/__tests__/Recycling.harness.tsx` tell "recycling
   * works" from "recycling is switched off, so nothing ever reached
   * `prepareForRecycle`". The app installs its override at launch
   * (`NitroUiFeatureFlags`), and the flag accessor caches its first answer, so this is
   * the value every `ViewManager` was constructed under — read from the same door RN
   * itself reads, not from a copy of the intent.
   */
  @ReactMethod
  fun viewRecyclingEnabled(promise: Promise) {
    try {
      promise.resolve(ReactNativeFeatureFlags.enableViewRecycling())
    } catch (error: Throwable) {
      promise.reject("view-recycling-flag", error)
    }
  }

  /**
   * Type into the focused field the way an IME does, for the TextField harness (G13):
   * `commit` commits [text] through the focused view's `InputConnection`, `compose`
   * sets it as composing text (an open IME composition, the way Gboard holds every
   * Latin word while autocorrect is on), `finish` commits the composition, `cancel`
   * deletes it, `action` presses the keyboard's Return, and `connect` starts over with a
   * fresh connection for the focused field. Answers the focused view's class name.
   *
   * The Android twin of `HarnessUI.typeChar`, which only reaches an `EditText`: a
   * Compose field has no `EditText` (Q2 §4), and its keystrokes arrive the way every
   * IME's do, through the `InputConnection` its `AndroidComposeView` creates. Nothing
   * is a shortcut into the field's state - the connection is Compose's own, and the
   * edit runs its `InputTransformation` (`maxLength`) as a keyboard's would. The
   * OS-level oracle is still the real-input runner's `adb shell input text`.
   */
  /**
   * The connection [imeInput] reuses for a composition, and the view it belongs to.
   * `connect` makes a new one. On the lease's emulator a composition opened this way
   * is still committed before the app sees it (G13 round 1), so the composing kinds
   * are kept for a device whose keyboard leaves it open.
   */
  private var connection: android.view.inputmethod.InputConnection? = null
  private var connectionView: android.view.View? = null

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
        // A composition is held on one connection, the way an IME holds one; every
        // other kind gets a fresh connection, because a pooled view that comes back
        // for another field keeps no session a cached connection could still reach.
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
          // A typed key, not the end of a composition: close any composing region the
          // keyboard opened over the word at the caret first, or `commitText` replaces
          // that word instead of adding to it (Compose never sets NO_SUGGESTIONS).
          "commit" -> {
            ic.finishComposingText()
            ic.commitText(text, 1)
          }
          "compose" -> ic.setComposingText(text, 1)
          "finish" -> ic.finishComposingText()
          // The user deleting the whole composition: empty composing text, then done.
          "cancel" -> {
            ic.setComposingText("", 1)
            ic.finishComposingText()
          }
          // Return on the soft keyboard: the editor action a single-line field submits on.
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
   * What one hosted control's box actually **paints**, for `Progress.harness.tsx` (E4).
   *
   * The question no other witness answers: `variant="loading"` and a wavy ring both
   * measure 48 dp, and both publish one semantics node with the same
   * `ProgressBarRangeInfo`, so a size, a node tree and a prop read all agree while the
   * canvas may be drawing either of them. So this copies the control's own rectangle out
   * of the window with `PixelCopy` - the platform's readback of what was composited, not
   * a re-render of the view - and counts the pixels that are the colour the app asked
   * for. G19 owns the general pixel probe for the library; until it merges, this is the
   * example app's version of one question, for the one row that needs it.
   *
   * The answer is deliberately coarse - a count and a bounding box, not a frame: a
   * fingerprint of one animated frame is not an assertion, while a shape's *fill
   * density* is. A 4 dp ring is roughly a third of its own box; a filled loading shape
   * is most of it. A flat 4 dp bar is 11 whole pixels tall and a wavy one is the 10 dp
   * wave, which is the other half of what E4 claims to draw.
   *
   * [colorArgb] is what `processColor` produced, as a double (D10: the bits, not a
   * saturated int); a pixel counts when every channel is within [tolerance] of it, which
   * is what antialiased edges need and what a scheme colour must not be allowed to fake.
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
      // PixelCopy reads the window, so a control scrolled out of it has no pixels to
      // read. Saying so is better than an ERROR_TIMEOUT three seconds later.
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
          // the next frame normally has it. Few retries: a control that is off window
          // never will have one, and the harness has its own timeout.
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
    // Two numbers about the copy itself, so a zero ink count is diagnosable from the
    // failure message instead of from a rebuild: how much of the box drew *anything*,
    // and which colour it drew most. A probe that only answers "not your colour"
    // cannot tell a wrong composable from a black bitmap.
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
        // -1 when nothing matched: "drew nothing" has to be a number a test can assert
        // on, not a zero-sized box that reads as a one-pixel control.
        putDouble("inkWidth", if (maxX >= 0) (maxX - minX + 1).toDouble() else -1.0)
        putDouble("inkHeight", if (maxY >= 0) (maxY - minY + 1).toDouble() else -1.0)
        putDouble("attempts", attempts.toDouble())
        putDouble("opaqueCount", opaqueCount.toDouble())
        // Unsigned, and widened: JS sees an ARGB as the number `processColor` gave
        // it, and a negative one here would have to be fixed up with a bit op.
        putDouble(
          "topColor",
          ((topColor?.key ?: 0).toLong() and 0xFFFFFFFFL).toDouble()
        )
        putDouble("topColorCount", (topColor?.value ?: 0).toDouble())
      }
    )
  }

  private companion object {
    /** The name JS asks the module registry for. */
    const val MODULE_NAME = "NitroUiProbe"

    /** How often [paintedInk] asks the window again before giving up. */
    private const val PIXEL_COPY_ATTEMPTS = 4

    /** How long to let the collectors settle before reading the heap. */
    const val GC_SETTLE_MS = 250L

    /** `SEARCH_FIELD_GLYPH_TAG` in the library's `HybridNitroUiSearchField.kt`. */
    const val SEARCH_FIELD_GLYPH_TAG = "nitroui.searchfield.glyph"
  }

  /**
   * Simulate B1 review N5's shape on a live hosted control, and report what the guard did:
   * `"<host class>|dropped|measuredWidth=<n>"`, or `"no-host"` when nothing hosted is on
   * screen.
   *
   * The shape is: a hosted control is dropped **while it is still attached**, and is then
   * measured. RN reaches it from `stopSurface`, which drops views before taking the root
   * out; the probe reaches it by calling the library's own teardown and then asking the
   * view to measure, which is what a layout pass would do. Nothing else is faked: the
   * composition really is disposed, the strategy really is un-armed, and the measure
   * really is the framework's `View.measure`.
   *
   * Why a probe rather than the app itself: the harness cannot unmount one control while
   * leaving its parent's layout pass running - the only dropped-and-still-attached view a
   * test can reach is one the app hands over deliberately. And the answer is read two
   * ways on purpose: `measuredWidth` here (`0` = the guard declined, anything else = it
   * composed for a dead mount), and the library's own process-wide ask count from JS. A
   * probe cannot see the count and the count cannot see the width, so both have to be
   * read or neither says anything.
   *
   * Runs on the UI thread and waits for it: `drop()` disposes a composition and
   * `measure()` would lay one out, both of which Compose requires be done there. That
   * blocks this bridge thread, never the JS thread - every method here is a Promise for
   * exactly that reason.
   */
  @ReactMethod
  fun simulatePostDropMeasure(promise: Promise) {
    // `reactApplicationContext.currentActivity`, not `getCurrentActivity()`: the module
    // base class deprecates its own accessor in favour of this one in RN 0.88.
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
        // Whether it is still attached is the precondition of N5, so it is reported
        // rather than assumed: a host that had already been removed from its parent is
        // not the shape under test, and `measuredWidth=0` would then be an answer about
        // a detached view rather than about the guard.
        val attached = host.isAttachedToWindow
        host.drop()
        // Exactly one measure, and with a spec the host has never been given. Android
        // caches a view's measured result against the spec it last saw and returns the
        // cached number without calling `onMeasure`, so a spec the view has never had is
        // what guarantees the call reaches the guard. `requestLayout()` would also force
        // it, and deliberately is not used: it schedules a pass on a later frame, which
        // would have a dropped host measured again during some other test's window.
        //
        // One measure, not two, so the JS side can assert the counter moved by exactly
        // one: an ask-count that cannot be pinned to a known number of asks is a number,
        // not a measurement.
        val spec =
          android.view.View.MeasureSpec.makeMeasureSpec(2000, android.view.View.MeasureSpec.EXACTLY)
        host.measure(spec, spec)
        answer =
          "${host.javaClass.simpleName}|attached=$attached|dropped|" +
            "measuredWidth=${host.measuredWidth}"
      } else {
        // Not a bare "no-host": the shape is the diagnosis, and this is the harness's
        // only look at the app's real view tree. `views` proves the walk ran at all, and
        // `reactViews` says whose window the test content is in - if the activity here is
        // not the one hosting React, no amount of walking finds a host.
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
   * What SearchField's search glyph paints at four points of its icon box, for
   * `SearchField.harness.tsx`'s "draws a magnifier" test (FIX4).
   *
   * 0.7.0 shipped a hand-typed copy of Material's search path that filled the lens - a
   * key, not a magnifier - and every prop, size and event test passed, because none of
   * them looks at pixels. This one does: it finds the glyph's box by its test tag
   * (`SEARCH_FIELD_GLYPH_TAG` in `HybridNitroUiSearchField.kt`) in the hosted
   * composition's unmerged semantics tree, draws the host into a bitmap, and answers the
   * colour at four points given as fractions of the 960-unit viewport Material Symbols
   * draws in:
   *
   * - `bg` (40, 40): a corner of the box no search glyph paints - the backdrop;
   * - `centre` (380, 380): the lens centre, which a magnifier leaves unpainted;
   * - `ring` (160, 380) and `ringTop` (380, 160): the middle of the ring's stroke, left
   *   of and above the centre, which a magnifier paints.
   *
   * The old path paints the centre (its lens is a filled disc around (9.5, 9.5) of 24)
   * and leaves both ring points bare, so either half of the assertion catches it.
   * `draw(Canvas)` on the host, as `nitroUiSamplePixels` does in the library: a hybrid
   * view has no surface of its own to copy.
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

  /** The Compose view under [view], as the public [androidx.compose.ui.node.RootForTest]. */
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

  /** The first node at or under [node] whose test tag is [tag], unmerged. */
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
   * Take one control out of the view tree, and put it back exactly where it was.
   *
   * The rule this exists for is the off-window one in `HybridNitroUiProgress.kt`: a
   * control that leaves the window may not animate, and it is the *detach* that says
   * so - not the unmount. `unmount()` in a test removes the whole subtree through RN,
   * which runs `onDropView` as well, so the detach path is invisible from JS. Here the
   * view really is taken out of its parent and really is put back, which is what a
   * ScrollView recycling a row does, and nothing else about the mount changes: the
   * composition stays alive, the props stay applied, and the same `nuiTest*` handle
   * keeps answering.
   *
   * Two calls rather than one `detachFor(ms)`: the assertion belongs to JS, which is
   * where the handle is, so the detached window has to stay open until the test has
   * read it. What is held between the calls is one view plus the slot it came from,
   * which the second call puts back and forgets.
   *
   * Answers the shape it found (`"<view class>|<parent class>|index=<n>"`) so a failure
   * says whether the tag found the control at all - a probe that silently detached the
   * wrong view would report a satisfying `false` for a view that was never animating.
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

  /**
   * Put back what [detachTaggedView] took out, at the same index in the same parent.
   *
   * The re-attach is the second half of the assertion - a control that answers `false`
   * because it was destroyed rather than because it left the window would pass the
   * first half - and it is also what leaves the app's tree intact for the next test.
   */
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

  /** One [detachTaggedView] waiting for its [attachTaggedView]. */
  private class Slot(
    val tag: String,
    val view: View,
    val parent: ViewGroup,
    val index: Int
  )

  /** Only one control is off-window at a time; a second detach is a test bug. */
  private var detachedSlot: Slot? = null

  /** Depth-first count of every view under [view], including it. */
  private fun countViews(view: android.view.View): Int {
    var total = 1
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        total += countViews(view.getChildAt(index))
      }
    }
    return total
  }

  /** Depth-first count of views whose class name contains [needle]. */
  private fun countNamed(view: android.view.View, needle: String): Int {
    var total = if (view.javaClass.name.contains(needle)) 1 else 0
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        total += countNamed(view.getChildAt(index), needle)
      }
    }
    return total
  }

  /**
   * Depth-first search for the first hosted control in the app's view tree.
   *
   * The one control on screen is the harness's own: in harness mode the example's component
   * screen is never rendered, so the tree is the test's root and this finds the control the
   * running test mounted. That is what makes the probe's precondition a test concern - the
   * test has to keep a control mounted (see `Recycling.harness.tsx`), because walking after
   * the last `unmount()` finds an empty app and answers `no-host`.
   *
   * Any control will do for the answer: the rule under test is `NitroComposeHost`'s, shared
   * by all of them.
   */
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
