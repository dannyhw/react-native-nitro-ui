package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one line of the `androidIcon` wire format: a plain string names a drawable,
 * and a `url:` prefix names a file to read (G19 fix round 1, DECISIONS D43).
 *
 * The prefix exists because the prop crosses into native as a plain string rather
 * than an AnyMap, so *something* has to say which of the two build types' answer
 * this is — and in a development build the same `require('./icons/share.xml')`
 * that becomes `src_assets_icons_share_24px` in a release build becomes a Metro
 * URL here. [NitroUiIconSource] is that decision made once, and these are the
 * cases where getting it wrong is invisible on screen:
 *
 *  - a URL read as a name asks the resource table for `url:https://…`, which is
 *    not a resource, and the answer is "no icon" with a log line about a name
 *    nobody wrote;
 *  - a name read as a URL tries to fetch `share` over the network and settles as
 *    nothing, in an app whose icon was there all along.
 *
 * `src/__tests__/iconSource.test.ts` pins the same format from the side that
 * writes it, for the same reason `NitroUiIconNames` and `src/iconName.ts` do: two
 * languages, one string, and a shared list of cases is what keeps them from
 * drifting into different answers.
 */
class NitroUiIconSourceTest {
  /** The release build's answer for `example/src/assets/icons/share_24px.xml`. */
  private val bundledName = "src_assets_icons_share_24px"

  @Test
  fun anUnmarkedStringIsADrawableNameAsItWasInRoundOne() {
    val name = NitroUiIconSource.parse(bundledName)
    assertEquals(NitroUiIconSource.Name(bundledName), name)
  }

  @Test
  fun aNameIsNormalisedTheSameWayHereAsTheWrapperDoesIt() {
    // `aapt` will not accept a `-` or a `.` in a file name, so the file has to be
    // renamed and the prop is allowed to be spelled either way. Round 1's rule,
    // unchanged by the marker.
    assertEquals(
      NitroUiIconSource.Name("share_24px"),
      NitroUiIconSource.parse("Share-24px"),
    )
  }

  /**
   * The development form. The URL is kept exactly as sent — not lower-cased, not
   * trimmed — because a URL's case and query belong to Metro, which matches on the
   * hash. Normalising it the way a resource name is normalised would ask for a file
   * that does not exist.
   */
  @Test
  fun aMarkedStringIsAFileAndItsUrlIsUntouched() {
    val url =
      "http://10.0.2.2:8081/src/assets/icons/share_24px.xml?platform=android&hash=AbC123"
    val parsed = NitroUiIconSource.parse("url:$url")
    assertEquals(NitroUiIconSource.Url(url), parsed)
    val urlForm = parsed as NitroUiIconSource.Url
    assertTrue("the hash keeps its case", urlForm.url.contains("hash=AbC123"))
    assertTrue("and the path keeps its underscores", urlForm.url.contains("share_24px"))
  }

  /**
   * `url:` with nothing loadable after it is not a name either. Falling back to
   * "treat the whole thing as a resource name" would log about a name nobody wrote
   * and draw nothing, which is two wrong answers where one is enough.
   */
  @Test
  fun aMarkedStringThatIsNotAUrlIsNoIconAtAll() {
    assertNull(NitroUiIconSource.parse("url:share"))
    assertNull(NitroUiIconSource.parse("url:/src/assets/share.xml"))
    assertNull(NitroUiIconSource.parse("url:"))
    assertNull(NitroUiIconSource.parse("url:"))
  }

  @Test
  fun nothingAndEmptyStringAreBothTheAbsenceOfAnIcon() {
    assertNull(NitroUiIconSource.parse(null))
    assertNull(NitroUiIconSource.parse(""))
    // A name that normalises away is the same as no name: there is nothing to look
    // up, and the difference between those two is invisible on screen.
    assertNull(NitroUiIconSource.parse("..."))
  }

  /**
   * A scheme without the prefix is never fetched.
   *
   * Deliberate: the wrapper marks every URL it builds, so a bare `http://…` reaching
   * native came from someone writing the native prop by hand, and the two forms must
   * not mean different things depending on who typed them. It is not a resource name
   * either — `https://…` is not a name a resource table could hold — so the answer is
   * no icon, which is what `docs/components/button.md` tells a caller who wants a
   * remote file to get by passing `{ uri }` instead.
   */
  @Test
  fun aSchemeWithoutThePrefixIsNeverFetched() {
    val parsed = NitroUiIconSource.parse("https://example.com/share.xml")
    assertTrue(
      "a URL nobody marked is not a fetch",
      parsed !is NitroUiIconSource.Url,
    )
    assertNull("and it is not a lookup either", parsed)
  }

  /** Two different files must not compare equal, or the second one draws the first. */
  @Test
  fun twoDifferentSourcesAreNeverEqual() {
    assertTrue(
      NitroUiIconSource.parse("url:http://h/a.xml") != NitroUiIconSource.parse("url:http://h/b.xml"),
    )
    assertTrue(
      NitroUiIconSource.parse("share") != NitroUiIconSource.parse("url:http://h/share.xml"),
    )
    assertEquals(
      NitroUiIconSource.parse("url:http://h/a.xml"),
      NitroUiIconSource.parse("url:http://h/a.xml"),
    )
  }
}
