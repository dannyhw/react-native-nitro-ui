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
 * not compose again until it is recycled" is a decision, and the shape that reaches it
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
    assertEquals("and nothing was counted", "drops=0 recycles=0 measuresAfterDrop=0 layoutsAfterDrop=0", gate.report())
  }

  @Test
  fun aDroppedHostDeclinesUntilItIsRecycled() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    assertTrue("a dropped host declines its measure", gate.declineMeasure())
    assertTrue("and its layout", gate.declineLayout())
    gate.onRecycle()
    assertFalse("the next mount measures again", gate.declineMeasure())
    assertFalse("and lays out", gate.declineLayout())
  }

  /**
   * The counters ask "did the path happen", not "did the guard fire".
   *
   * This is what lets a harness run report a *measured* negative for B1's N5 rather than
   * an assumption: the number moves when a dropped host is asked, and stays at zero when
   * nothing ever asks.
   */
  @Test
  fun everyDeclinedAskIsCounted() {
    val gate = NitroUiLifetimeGate()
    gate.onDrop()
    gate.declineMeasure()
    gate.declineMeasure()
    gate.declineLayout()
    assertEquals(2, gate.measuresAfterDrop)
    assertEquals(1, gate.layoutsAfterDrop)
    gate.onRecycle()
    gate.declineMeasure()
    assertEquals(
      "a live mount's measures are not counted",
      2,
      gate.measuresAfterDrop
    )
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
    assertEquals("drops=2 recycles=2 measuresAfterDrop=0 layoutsAfterDrop=0", gate.report())
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
}
