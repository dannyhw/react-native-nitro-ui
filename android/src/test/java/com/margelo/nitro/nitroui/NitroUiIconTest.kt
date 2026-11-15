package com.margelo.nitro.nitroui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NitroUiIconTest {
  @Before
  fun forgetPreviousWarnings() {
    NitroUiIconNames.resetForTests()
  }

  @Test
  fun aNameIsNormalisedTheWayAFileHasToBeRenamedToBuild() {
    assertEquals("share", NitroUiIconNames.normalize("Share"))
    assertEquals("share_24px", NitroUiIconNames.normalize("share-24px"))
    assertEquals("share_24px", NitroUiIconNames.normalize("share.24px"))
    assertEquals("share_24px", NitroUiIconNames.normalize("Share-24px"))
  }

  /** `share-24px` counts as valid: [NitroUiIconNames.normalize] makes it a legal name first. */
  @Test
  fun aNameThatCannotBeAResourceNameIsSaidSo() {
    assertTrue(NitroUiIconNames.isValid("share"))
    assertTrue(NitroUiIconNames.isValid("ic_share_2"))
    assertTrue(NitroUiIconNames.isValid("share-24px"))
    assertTrue(NitroUiIconNames.isValid("Share"))
    assertFalse("empty", NitroUiIconNames.isValid(""))
    assertFalse("leading digit", NitroUiIconNames.isValid("24px_share"))
    assertFalse("space", NitroUiIconNames.isValid("share icon"))
    assertFalse("slash", NitroUiIconNames.isValid("drawable/share"))
    assertFalse("non-ascii", NitroUiIconNames.isValid("über"))
  }

  @Test
  fun aBadNameIsReportedOnceHoweverManyTimesItIsSent() {
    val name = "Not A Drawable"
    assertTrue("the first time must speak", NitroUiIconNames.shouldWarn(name))
    assertFalse("the second must not", NitroUiIconNames.shouldWarn(name))
    assertFalse("and the third", NitroUiIconNames.shouldWarn(name))
    assertTrue("a different bad name still speaks", NitroUiIconNames.shouldWarn("also_bad!"))
  }

  /** `String` artwork, because `android.graphics.Bitmap` cannot be built in a JVM test. */
  @Test
  fun theStoreHandsBackWhatWasLoadedForThatId() {
    val store = NitroUiIconStore<Int, String>(4) { resId -> resId == 0 }
    assertNull(store.get(101))
    store.put(101, "share")
    assertEquals("share", store.get(101))
    assertNull("an id nobody loaded stays empty", store.get(999))
    assertNull("and id 0 - RN's own 'not found' - never has artwork", store.get(0))
    store.put(0, "must not be kept")
    assertNull(store.get(0))
  }

  @Test
  fun theStoreStopsGrowingAtItsBoundAndDropsTheLeastRecentlyUsedFirst() {
    val store = NitroUiIconStore<Int, String>(3)
    store.put(1, "a")
    store.put(2, "b")
    store.put(3, "c")
    assertEquals(3, store.size())

    // Reading `a` makes `b` the least recently used.
    store.get(1)
    store.put(4, "d")

    assertEquals("a was read, so it stayed", "a", store.get(1))
    assertNull("b is the least recently used, so it went", store.get(2))
    assertEquals("c", store.get(3))
    assertEquals("d", store.get(4))
    assertEquals(3, store.size())
  }

  @Test
  fun clearingTheStoreLeavesNothingBehind() {
    val store = NitroUiIconStore<Int, String>(3)
    store.put(7, "x")
    store.clear()
    assertEquals(0, store.size())
    assertNull(store.get(7))
  }

  /** Material's own numbers, written out rather than derived from the expression under test. */
  @Test
  fun theTwoNewRungsAreMaterialsLargeAndExtraLargeContainerHeights() {
    assertEquals(96f, ButtonScale.XLarge.height.value)
    assertEquals(136f, ButtonScale.XXLarge.height.value)
    assertEquals(96f, ButtonScale.XLarge.layoutHeight.value)
    assertEquals(136f, ButtonScale.XXLarge.layoutHeight.value)
  }

  @Test
  fun theNewRungNamesResolveAndAnUnknownOneIsStillMedium() {
    assertEquals(ButtonScale.XLarge, ButtonScale.from("xlarge"))
    assertEquals(ButtonScale.XXLarge, ButtonScale.from("xxlarge"))
    assertEquals(ButtonScale.Medium, ButtonScale.from("huge"))
    assertEquals(ButtonScale.Medium, ButtonScale.from(""))
  }

  @Test
  fun everyRungIsTallerThanTheOneBelowIt() {
    val rungs = ButtonScale.entries.sortedBy { it.ordinal }
    for (index in 1 until rungs.size) {
      assertTrue(
        "${rungs[index].wireName} must be taller than ${rungs[index - 1].wireName}",
        rungs[index].height > rungs[index - 1].height,
      )
    }
    assertTrue(MinTouchTargetHeight > 0.dp)
  }
}
