package com.margelo.nitro.nitroui

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NitroUiIconFailureMemoryTest {
  private val url = "http://10.0.2.2:8081/src/assets/icons/share_24px.xml?platform=android&hash=abc"

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

    repeat(3) { bad.note(url, classifyIconReadFailure(routeFailures.first())) }

    assertFalse(
      "Metro was restarting, not missing the file — the next mount must still ask",
      bad.isKnownBad(url)
    )
  }

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
    // Metro answers 5xx while it is compiling; the same URL answers 200 a moment later.
    assertEquals(NitroUiIconRead.Temporary, classifyIconHttpStatus(500))
    assertEquals(NitroUiIconRead.Temporary, classifyIconHttpStatus(502))
    assertEquals(NitroUiIconRead.Temporary, classifyIconHttpStatus(503))

    val bad = NitroUiIconBadList(8)
    bad.note(url, classifyIconHttpStatus(503))
    assertFalse(bad.isKnownBad(url))
  }

  @Test
  fun successIsNotAFailure() {
    val bad = NitroUiIconBadList(8)
    bad.note(
      url,
      NitroUiIconRead.Loaded(NitroUiVectorDrawableReader.read(fixture()).toImageVector(url))
    )
    assertFalse(bad.isKnownBad(url))
  }

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
