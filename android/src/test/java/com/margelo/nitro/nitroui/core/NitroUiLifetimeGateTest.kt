package com.margelo.nitro.nitroui.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NitroUiLifetimeGateTest {
  @Test
  fun aFreshHostMeasuresAndLaysOutNormally() {
    val gate = NitroUiLifetimeGate()
    assertFalse("a mounted host does not decline a measure", gate.declineMeasure())
    assertFalse("a mounted host does not decline a layout", gate.declineLayout())
    assertEquals("and nothing was counted", "drops=0 recycles=0", gate.report())
  }

  @Test
  fun aDroppedHostDeclinesUntilItIsAttachedAgain() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    assertTrue("a dropped host declines its measure", gate.declineMeasure())
    assertTrue("and its layout", gate.declineLayout())
    gate.onAttach()
    assertFalse("the next mount measures again", gate.declineMeasure())
    assertFalse("and lays out", gate.declineLayout())
  }

  @Test
  fun poolEntryKeepsTheDroppedWindowShutUntilTheNextAttach() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    gate.onRecycle()
    assertTrue(
      "a host sitting in the pool still declines: it has no window and no strategy",
      gate.declineMeasure()
    )
    assertTrue("and declines its layout", gate.declineLayout())
    gate.onAttach()
    assertFalse(
      "and only the attach, which arms the strategy, lets it compose",
      gate.declineMeasure()
    )
  }

  @Test
  fun aRecycledHostLeftInThePoolIsStillDropped() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    gate.onRecycle()
    // Never popped: RN empties the pool on `trimMemory` without telling the views in it.
    assertTrue("still dropped, and still guarded", gate.declineMeasure())
    assertEquals("drops=1 recycles=1", gate.report())
  }

  @Test
  fun countersSurviveARecycleAndNameTheObject() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    gate.onRecycle()
    gate.onDrop()
    gate.onRecycle()
    assertEquals("drops=2 recycles=2", gate.report())
  }

  @Test
  fun anUnmountAndARecycleAreToldApartByThePair() {
    val unmounted = NitroUiLifetimeGate()
    unmounted.onDrop()
    assertEquals(1, unmounted.drops)
    assertEquals("a real unmount recycles nothing", 0, unmounted.recycles)

    val pooled = NitroUiLifetimeGate()
    pooled.onDrop()
    pooled.onRecycle()
    assertEquals("a recycle also drops first", 1, pooled.drops)
    assertEquals(1, pooled.recycles)
  }

  @Test
  fun anAttachCountsNeitherAMountNorAPoolEntry() {
    val gate = NitroUiLifetimeGate()
    gate.onAttach()
    gate.onAttach()
    assertEquals("drops=0 recycles=0", gate.report())
  }
}
