package com.margelo.nitro.nitroui

import java.net.URI
import java.net.URISyntaxException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The URL a development `androidIcon` is requested at. Metro writes it out of the file's path on
 * disk, so whatever a file system allows sits in it unescaped, and the request has to name the
 * same file Metro is serving.
 */
class NitroUiIconUrlTest {
  private val origin = "http://10.0.2.2:8081"

  private fun requestFor(
    path: String,
  ): String = NitroUiIconUrl.requestUri(origin + path).toString()

  @Test
  fun anOrdinaryUrlIsRequestedExactlyAsMetroWroteIt() {
    val url = "$origin/src/assets/icons/share_24px.xml?platform=android&hash=AbC123"
    assertEquals(url, NitroUiIconUrl.requestUri(url).toString())
  }

  @Test
  fun aSpaceInThePathIsQuotedAndTheFileIsStillReached() {
    // `URI(raw)` throws on this string, which is how such an icon ends up blank.
    val raw = "$origin/assets/src/assets/icons with a space/star_24px.xml?platform=android&hash=ab12"
    assertThrows(URISyntaxException::class.java) { URI(raw) }
    assertEquals(
      "$origin/assets/src/assets/icons%20with%20a%20space/star_24px.xml" +
        "?platform=android&hash=ab12",
      NitroUiIconUrl.requestUri(raw).toString(),
    )
  }

  @Test
  fun aHashInAFileNameIsPartOfTheNameAndNotAFragment() {
    val requested = NitroUiIconUrl.requestUri("$origin/assets/icons/c#sharp/star.xml?platform=android")
    assertEquals("$origin/assets/icons/c%23sharp/star.xml?platform=android", requested.toString())
    assertEquals(
      "the query is still the query",
      "platform=android",
      requested.query,
    )
  }

  @Test
  fun anEscapeMetroAlreadySentIsNotSentTwice() {
    assertEquals(
      "$origin/assets/icons/my%20icons/star_24px.xml",
      requestFor("/assets/icons/my%20icons/star_24px.xml"),
    )
    assertEquals(
      "$origin/assets/icons/%E2%9C%93/star_24px.xml",
      requestFor("/assets/icons/%E2%9C%93/star_24px.xml"),
    )
  }

  @Test
  fun anEscapeInTheQueryIsNotSentTwiceEither() {
    assertEquals(
      "$origin/assets/icons/star.xml?platform=android&hash=a%2Bb",
      requestFor("/assets/icons/star.xml?platform=android&hash=a%2Bb"),
    )
  }

  @Test
  fun aPlusInTheQueryIsSentAsItWasWritten() {
    // `+` is legal in a query and means something there, so it is not a space to be quoted.
    assertEquals(
      "$origin/assets/icons/star.xml?platform=android&hash=a+b",
      requestFor("/assets/icons/star.xml?platform=android&hash=a+b"),
    )
  }

  @Test
  fun aNameOutsideAsciiTravelsAsItsUtf8Bytes() {
    assertEquals(
      "$origin/assets/icons/%C3%BCn%C3%AFc%C3%B8d%C3%A9/star_24px.xml",
      requestFor("/assets/icons/ünïcødé/star_24px.xml"),
    )
    assertEquals(
      "$origin/assets/icons/%F0%9F%91%8D/star_24px.xml",
      requestFor("/assets/icons/\uD83D\uDC4D/star_24px.xml"),
    )
  }

  @Test
  fun aPercentThatIsNoEscapeIsQuotedSoTheRequestLineSurvives() {
    assertEquals(
      "$origin/assets/icons/100%25/star.xml",
      requestFor("/assets/icons/100%/star.xml"),
    )
    // Two hex digits would be an escape; `zz` is not, so the `%` in front of it is a literal.
    assertEquals(
      "$origin/assets/icons/100%25zz/star.xml",
      requestFor("/assets/icons/100%zz/star.xml"),
    )
  }

  @Test
  fun aSpaceInTheQueryIsQuotedToo() {
    assertEquals(
      "$origin/assets/icons/star.xml?platform=android&name=share%2024",
      requestFor("/assets/icons/star.xml?platform=android&name=share 24"),
    )
  }

  @Test
  fun aFileUrlIsQuotedTheSameWayAsOneServedOverHttp() {
    assertEquals(
      "file:///data/local/tmp/my%20icon.svg",
      NitroUiIconUrl.requestUri("file:///data/local/tmp/my icon.svg").toString(),
    )
  }

  @Test
  fun theAuthorityIsNotQuotedBecauseBracketsThereHoldAHost() {
    assertEquals(
      "http://[::1]:8081/assets/my%20icon.xml",
      NitroUiIconUrl.requestUri("http://[::1]:8081/assets/my icon.xml").toString(),
    )
  }

  @Test
  fun aLocalHostNameIsRequestedLikeAnAddressIs() {
    assertEquals(
      "http://localhost:8081/assets/my%20icon.xml",
      NitroUiIconUrl.requestUri("http://localhost:8081/assets/my icon.xml").toString(),
    )
  }

  @Test
  fun anUrlWithNoPathIsRequestedAsItStands() {
    assertEquals(
      "http://localhost:8081",
      NitroUiIconUrl.requestUri("http://localhost:8081").toString(),
    )
  }

  @Test
  fun separatorsSurviveBetweenSegmentsAndASpaceStaysInsideItsOwn() {
    assertEquals("$origin//assets//icons/my%20icon.xml", requestFor("//assets//icons/my icon.xml"))
    assertEquals("$origin/assets/icons/my%20icon/", requestFor("/assets/icons/my icon/"))
  }
}
