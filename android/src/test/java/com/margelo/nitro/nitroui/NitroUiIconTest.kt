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

/**
 * JVM unit tests for the two halves of `androidIcon` that a device cannot show
 * honestly, plus the two rungs G19 added to the ladder.
 *
 * The name rules are here because their failure mode is invisible. A name that
 * cannot be a resource name and a name whose file was not shipped both reach
 * `ResourceDrawableIdHelper` as "no id", and both then draw nothing — which is the
 * right behaviour for the missing file and a silent typo for the other. The only
 * thing that separates them is the string itself, so the string is what gets
 * tested, and the console warning that JS raises from the same rule is covered by
 * `src/__tests__/iconName.test.ts`.
 *
 * The once-per-name warning is here because a warning that fires per recomposition
 * is a logcat flood in a list, and one that never fires is not evidence of
 * anything. Both are invisible to a screenshot.
 *
 * The cache is here for the claim the prop is sold on: an app that puts the same
 * icon on forty rows pays for it once. On a device that is a memory number nobody
 * reads; on the JVM it is an identity assertion.
 */
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

  /**
   * The names `aapt` would have rejected, caught before the lookup pretends it
   * looked. `share-24px` is in here too, not because the resource table would
   * accept it but because [NitroUiIconNames.normalize] turns it into a valid name
   * before anyone asks - which is the whole point of normalising.
   */
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

  /**
   * The store's contract, on `String` artwork: `android.graphics.Bitmap` cannot be
   * built in a plain JVM test, so the type is whatever the policy needs and the
   * policy is the thing with a bug in it. [NitroUiIconBitmaps] is this class with the
   * one artwork type the library draws, so covering it here covers the loading
   * claim the prop is sold on: an app that puts the same icon on forty rows pays
   * for it once.
   */
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

  /**
   * The bound, because an icon name is app data and a list can hold more of them
   * than the process should remember. Eviction is least-recently-used rather than
   * insertion order, so reading an icon keeps it and one that scrolled away goes.
   */
  @Test
  fun theStoreStopsGrowingAtItsBoundAndDropsTheLeastRecentlyUsedFirst() {
    val store = NitroUiIconStore<Int, String>(3)
    store.put(1, "a")
    store.put(2, "b")
    store.put(3, "c")
    assertEquals(3, store.size())

    // Touching `a` makes `b` the stalest, which is the whole difference between an
    // LRU bound and a queue - and the difference that keeps the icons on screen.
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

  /**
   * The two rungs G19 added, written out as Material's numbers rather than derived
   * from the same expression the code uses - the reason E1 wrote the first three
   * this way. `ButtonDefaults.LargeContainerHeight` and `ExtraLargeContainerHeight`
   * are 96 and 136 dp; a rung that silently followed the previous doubling would
   * still render a plausible button, and only this line says it is wrong.
   */
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

  /**
   * The ladder is monotonic in both directions. Not a rule anyone would write
   * down twice, and the one a token rename can break: if Material renumbers a
   * token, `medium` and `xlarge` can end up on the same height and every control
   * between them silently changes size.
   */
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
