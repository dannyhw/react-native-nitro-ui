package com.margelo.nitro.nitroui.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the post-drop gate and the per-object lifetime counters
 * (`bun run test:native:android`).
 *
 * Why this lives here rather than only in a device run: the rule "a dropped host must
 * not compose again until it is attached again" is a decision, and the shape that reaches it
 * on a device — RN's `stopSurface` dropping views before it removes the root — is one
 * the harness has never produced (B1 measured the analogous listener case at 0 of 3200
 * attempts). A branch nobody can reach from JS is exactly the branch that gets deleted
 * by accident, so the decision is tested where deleting a line goes red.
 *
 * The counters are here for the other half: the claim F6 had to settle is "did the pool
 * hand this exact instance back", and that depends on counters surviving a recycle. A
 * fixture that reset them cannot tell a reused view from a new one, so the test below
 * pins the reset behaviour itself.
 */
class NitroUiLifetimeGateTest {
  @Test
  fun aFreshHostMeasuresAndLaysOutNormally() {
    val gate = NitroUiLifetimeGate()
    assertFalse("a mounted host does not decline a measure", gate.declineMeasure())
    assertFalse("a mounted host does not decline a layout", gate.declineLayout())
    assertEquals("and nothing was counted", "drops=0 recycles=0", gate.report())
  }

  /**
   * The dropped window is the window between a drop and the next attach.
   *
   * [NitroUiLifetimeGate.onAttach] is the only line that closes it, so deleting that call
   * leaves every host declining its measure forever — the new mount composes nothing and
   * both assertions below go red on a device too.
   */
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

  /**
   * Entering the pool does not end the dropped window, and that is the whole fix.
   *
   * F6's first round cleared `isDropped` in `onRecycle`, and with recycling on RN calls
   * `onDropView` and `prepareToRecycleView` back to back: a pooled host left the dropped
   * window with no window and no [androidx.compose.ui.platform.ViewCompositionStrategy]
   * armed, which is the exact state B1's N5 says must not compose. So a recycle must
   * change the *model* and the counters, never the guard. Before this test existed, that
   * inversion was invisible from a device: the guard had nothing to guard against because
   * no pooled view was ever flagged.
   */
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

  /**
   * The dropped window also survives a recycle *and a re-drop*, which is the pair a real
   * churn produces: drop, pool, pop, attach, drop.
   *
   * This is what pins the ordering rather than the flags: a gate that cleared on recycle
   * would read "not dropped" between the pool and the attach, and the assertion below
   * would be the only thing standing between that and a silent leak.
   */
  @Test
  fun aRecycledHostLeftInThePoolIsStillDropped() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    gate.onRecycle()
    // Never popped: RN empties the pool on `trimMemory` without telling the views in it.
    assertTrue("still dropped, and still guarded", gate.declineMeasure())
    assertEquals("drops=1 recycles=1", gate.report())
  }

  /**
   * The counters survive a recycle, which is the entire mechanism.
   *
   * Deleting [NitroUiLifetimeGate.onRecycle]'s `recycles += 1`, or adding a reset of
   * `drops` there, makes the second mount of a pooled instance indistinguishable from a
   * fresh one — the exact blind spot that let "Android never reaches `prepareForRecycle`"
   * stand as a finding.
   */
  @Test
  fun countersSurviveARecycleAndNameTheObject() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    gate.onRecycle()
    gate.onDrop()
    gate.onRecycle()
    assertEquals("drops=2 recycles=2", gate.report())
  }

  /**
   * A real unmount is a `drop` with no `recycle` after it.
   *
   * Both platforms reach `drop()` from the unmount path *and* from the front door of
   * recycling, so a test that counted only drops could not tell the two apart; the pair
   * is the only witness that recycling is switched on.
   */
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

  /**
   * An attach is not a mount and not a pool entry, so it moves neither counter.
   *
   * The device test reads `recycles >= 1` off a handle that is *currently mounted* to
   * prove the pool handed that view back. If an attach counted as a recycle, that read
   * would say "reused" about a freshly allocated view, which is the false pass this
   * round's review found.
   */
  @Test
  fun anAttachCountsNeitherAMountNorAPoolEntry() {
    val gate = NitroUiLifetimeGate()
    gate.onAttach()
    gate.onAttach()
    assertEquals("drops=0 recycles=0", gate.report())
  }
}
