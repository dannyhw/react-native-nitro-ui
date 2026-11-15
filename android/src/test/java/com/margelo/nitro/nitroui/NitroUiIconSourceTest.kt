package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NitroUiIconSourceTest {
  // The name a release build derives for `src/assets/icons/share_24px.xml`.
  private val bundledName = "src_assets_icons_share_24px"

  @Test
  fun anUnmarkedStringIsADrawableNameAsItWasInRoundOne() {
    val name = NitroUiIconSource.parse(bundledName)
    assertEquals(NitroUiIconSource.Name(bundledName), name)
  }

  @Test
  fun aNameIsNormalisedTheSameWayHereAsTheWrapperDoesIt() {
    // `aapt` rejects `-` and `.` in a file name, so the prop accepts either spelling.
    assertEquals(
      NitroUiIconSource.Name("share_24px"),
      NitroUiIconSource.parse("Share-24px"),
    )
  }

  // The URL is kept exactly as sent: Metro matches on the case-sensitive hash.
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
    assertNull(NitroUiIconSource.parse("..."))
  }

  @Test
  fun aSchemeWithoutThePrefixIsNeverFetched() {
    val parsed = NitroUiIconSource.parse("https://example.com/share.xml")
    assertTrue(
      "a URL nobody marked is not a fetch",
      parsed !is NitroUiIconSource.Url,
    )
    assertNull("and it is not a lookup either", parsed)
  }

  // React Native names a hoisted `node_modules` asset `__node_modules_…`, which the rule
  // for typed names rejects but the resource table holds. `res:` means: look it up as sent.
  @Test
  fun aBundlerDerivedNameIsLookedUpAsSent() {
    val hoisted = "__node_modules_expo_materialsymbols_star"
    assertEquals(NitroUiIconSource.Name(hoisted), NitroUiIconSource.parse("res:$hoisted"))
    assertNull(
      "the same string unmarked is still judged by the typed-name rule",
      NitroUiIconSource.parse(hoisted),
    )
    val odd = "src_assets_icons_Share-24px"
    assertEquals(NitroUiIconSource.Name(odd), NitroUiIconSource.parse("res:$odd"))
    assertNull(NitroUiIconSource.parse("res:"))
  }

  @Test
  fun twoDifferentSourcesAreNeverEqual() {
    assertTrue(
      NitroUiIconSource.parse("url:http://h/a.xml") != NitroUiIconSource.parse("url:http://h/b.xml"),
    )
    assertTrue(
      "two assets, two names, two drawables",
      NitroUiIconSource.parse("res:src_assets_a_share") != NitroUiIconSource.parse("res:src_assets_b_share"),
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
