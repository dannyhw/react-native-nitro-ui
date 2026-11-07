package com.margelo.nitro.nitroui

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which failed development loads [NitroUiIconFiles] is allowed to stop retrying
 * (G19 fix round 2, item 5).
 *
 * Round 1 answered every failure with the same `null` and wrote the URL into a
 * `failed` set, and nothing in a running app ever clears that set. A connection
 * refused while Metro restarted — the single most common thing that happens to a
 * development build, and exactly the moment the review names — therefore stuck: a JS
 * reload, a new screen, a recycled control all re-read the memory instead of the
 * dev server, and the icon stayed invisible until the app was killed. The fix is not
 * a clear button; it is that a route problem is never written down at all.
 *
 * The rule is a pure function and a class with no `Handler` in it, which is what
 * makes it provable here rather than on an emulator with a killed dev server.
 */
class NitroUiIconFailureMemoryTest {
  private val url = "http://10.0.2.2:8081/src/assets/icons/share_24px.xml?platform=android&hash=abc"

  /** The route failures a restarting dev server produces, one after another. */
  private val routeFailures =
    listOf(
      ConnectException("Failed to connect to /10.0.2.2:8081"),
      SocketTimeoutException("failed to connect to /10.0.2.2 (port 8081) from /10.0.2.15 after 5000ms"),
      UnknownHostException("Unable to resolve host \"10.0.2.2\": No address associated with hostname"),
      IOException("Connection reset"),
    )

  @Test
  fun aRouteFailureIsNotAnAnswerAboutTheFile() {
    for (failure in routeFailures) {
      assertEquals(
        "${failure.javaClass.simpleName} says nothing about the file",
        NitroUiIconRead.Temporary,
        classifyIconReadFailure(failure),
      )
    }
  }

  @Test
  fun aRefusedConnectionLeavesTheUrlReadable() {
    val bad = NitroUiIconBadList(8)

    // The whole loop the control runs: read, fail, remember what the failure said.
    // Repeated for the icon's three owners on that screen, which is what the
    // remembered failure was for in the first place.
    repeat(3) { bad.note(url, classifyIconReadFailure(routeFailures.first())) }

    assertFalse(
      "Metro was restarting, not missing the file — the next mount must still ask",
      bad.isKnownBad(url)
    )
  }

  /**
   * The other half of the rule, and the reason this is not just "never remember".
   *
   * A file that is not a vector drawable, or a path the server has nothing for, is a
   * verdict the retry cannot change, and a screen of rows asking for it twenty times
   * a second is the loop round 1 was right to prevent.
   */
  @Test
  fun aVerdictOnTheFileIsRemembered() {
    val bad = NitroUiIconBadList(8)

    bad.note(url, classifyIconReadFailure(NitroUiVectorUnsupported("no <vector> element")))
    assertTrue("bytes arrived and are not an icon", bad.isKnownBad(url))

    bad.clear()
    bad.note(url, classifyIconHttpStatus(404))
    assertTrue("the server looked for that path and has nothing", bad.isKnownBad(url))

    bad.clear()
    bad.note(url, NitroUiIconRead.Rejected)
    assertTrue("a file over the size ceiling reaches the same answer", bad.isKnownBad(url))
  }

  @Test
  fun aDevServerStillCompilingIsNotAVerdict() {
    assertEquals(NitroUiIconRead.Rejected, classifyIconHttpStatus(404))
    assertEquals(NitroUiIconRead.Rejected, classifyIconHttpStatus(410))
    // Metro's own "bundle not built yet" family. The same URL answers 200 a second
    // later, so keeping this would stick the icon for the life of the process.
    assertEquals(NitroUiIconRead.Temporary, classifyIconHttpStatus(500))
    assertEquals(NitroUiIconRead.Temporary, classifyIconHttpStatus(502))
    assertEquals(NitroUiIconRead.Temporary, classifyIconHttpStatus(503))

    val bad = NitroUiIconBadList(8)
    bad.note(url, classifyIconHttpStatus(503))
    assertFalse(bad.isKnownBad(url))
  }

  /** Nothing is remembered about a load that succeeded, either. */
  @Test
  fun successIsNotAFailure() {
    val bad = NitroUiIconBadList(8)
    bad.note(
      url,
      NitroUiIconRead.Loaded(NitroUiVectorDrawableReader.read(fixture()).toImageVector(url))
    )
    assertFalse(bad.isKnownBad(url))
  }

  /** A minimal vector drawable, so [successIsNotAFailure] can reach [NitroUiIconRead.Loaded]. */
  private fun fixture(): java.io.InputStream =
    java.io.ByteArrayInputStream(
      """
      <?xml version="1.0" encoding="utf-8"?>
      <vector xmlns:android="http://schemas.android.com/apk/res/android"
        android:width="24dp" android:height="24dp"
        android:viewportWidth="24" android:viewportHeight="24">
        <path android:fillColor="#FF000000" android:pathData="M12,2L2,22h20z"/>
      </vector>
      """.trimIndent().toByteArray()
    )
}
