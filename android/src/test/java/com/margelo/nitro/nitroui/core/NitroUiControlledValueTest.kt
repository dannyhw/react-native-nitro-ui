package com.margelo.nitro.nitroui.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the Compose twin of the event-count handshake
 * (`docs/architecture/core.md` §4), run by `bun run test:native:android`.
 *
 * The vectors are the same ones as `src/__tests__/useControlled.test.tsx` (JS)
 * and `scripts/native-tests/handshake.test.swift` (iOS): three copies of this
 * logic have to agree, and stale drops / rejected reverts / rapid interactions
 * are exactly the cases an on-device test only catches by accident.
 */
class NitroUiControlledValueTest {
  @Test
  fun startsUncontrolledAndChangesNothingOnReconcile() {
    val value = NitroUiControlledValue(false)
    assertNull("uncontrolled has no pending React write", value.js)
    assertFalse("uncontrolled reconcile changes nothing", value.reconcile())
    assertEquals(0, value.nativeEvents)
    assertEquals(0, value.jsEvents)
  }

  @Test
  fun userChangesDisplayImmediatelyAndCountEvents() {
    val value = NitroUiControlledValue(false)
    assertEquals("user() returns the event count to emit", 1, value.user(true))
    assertTrue("native owns the displayed value", value.displayed)
    assertEquals(2, value.user(false))
    assertEquals(3, value.user(true))
    assertTrue("the last interaction wins", value.displayed)
    assertFalse("uncontrolled native keeps what the user did", value.reconcile())
  }

  @Test
  fun rejectedChangeRevertsOnceJsEchoes() {
    val value = NitroUiControlledValue(false)
    value.js = false
    assertEquals(1, value.user(true))
    assertTrue("optimistic while JS has not seen the event", value.displayed)
    assertFalse("a write is stale until JS echoes this many events", value.reconcile())
    value.jsEvents = 1
    assertTrue("the echo lets the rejected write revert", value.reconcile())
    assertFalse("the rejected change reverted", value.displayed)
    assertFalse("reconciling twice changes nothing", value.reconcile())
  }

  @Test
  fun staleWriteIsDroppedNotQueued() {
    val value = NitroUiControlledValue(false)
    value.user(true)
    value.js = true
    value.jsEvents = 0
    assertFalse("a stale write is dropped", value.reconcile())
    assertTrue("and does not clobber the user", value.displayed)
    value.js = false
    value.jsEvents = 1
    assertTrue("the next write after catching up applies", value.reconcile())
    assertFalse(value.displayed)
  }

  @Test
  fun rapidInteractionAppliesTheNewestWrite() {
    // Two taps in one JS round trip, then JS writes a value that only matches the
    // first: native has seen both events, so it must accept the write.
    val value = NitroUiControlledValue(false)
    value.js = true
    assertEquals(1, value.user(true))
    assertEquals(2, value.user(false))
    assertFalse("the newest interaction is what native shows", value.displayed)
    assertFalse("a write is still stale before the echo", value.reconcile())
    value.jsEvents = 2
    assertTrue("the newest write applies once JS has seen every event", value.reconcile())
    assertTrue(value.displayed)
  }

  @Test
  fun firstControlledWriteAfterAModeSwitchApplies() {
    val value = NitroUiControlledValue(false)
    value.user(true)
    value.user(false)
    assertEquals(2, value.nativeEvents)
    assertEquals("uncontrolled interactions leave JS behind", 0, value.jsEvents)
    assertFalse(value.reconcile())
    // What the seeded `mostRecentEventCount` now sends (see useControlled.ts).
    value.js = true
    value.jsEvents = 2
    assertTrue("the first controlled write after a mode switch applies", value.reconcile())
    assertTrue(value.displayed)
  }

  @Test
  fun worksForDoublesWithEquatableEquality() {
    val value = NitroUiControlledValue(0.0)
    assertEquals(1, value.user(0.25))
    value.js = 0.25
    value.jsEvents = 1
    assertFalse("an unchanged value is not a change", value.reconcile())
    value.js = 0.5
    assertTrue(value.reconcile())
    assertEquals(0.5, value.displayed, 0.0)
  }

  /**
   * A continuous control holds the newest input sample until the frame tick emits
   * it (Slider, `core.md` §11). The counts cannot see that: [nativeEvents] only
   * advances when we emit, so a parent commit in that window looks fully echoed
   * while native is actually ahead by an unreported value. Accepting it paints the
   * app's number for a frame and then emits the interaction's own value under it -
   * the thumb jumping back mid-drag, found on iOS and closed on both platforms.
   */
  @Test
  fun writeIsRefusedWhileNativeHasAnUnreportedSample() {
    val value = NitroUiControlledValue(0.0)
    value.js = 0.0
    assertEquals("a drag emits its first change", 1, value.user(0.4))
    value.unreported = 0.45
    value.js = 0.2
    value.jsEvents = 1
    assertTrue("the counts look caught up", value.jsEvents >= value.nativeEvents)
    assertFalse("a write is refused while native holds an un-emitted sample", value.reconcile())
    assertEquals("what was last emitted is still what is shown", 0.4, value.displayed, 0.0)
    value.unreported = null
    assertTrue("once the sample is emitted, the write is judged by the count alone", value.reconcile())
    assertEquals(0.2, value.displayed, 0.0)
  }

  /**
   * The guard is narrow, not a drag-mode switch: an un-emitted sample does not
   * stop an interaction from taking effect, it only defers React's write.
   */
  @Test
  fun unreportedSampleRefusesWritesAndNothingElse() {
    val value = NitroUiControlledValue(0.0)
    value.unreported = 5.0
    assertEquals(1, value.user(7.0))
    assertEquals("an interaction is not blocked by an un-emitted sample", 7.0, value.displayed, 0.0)
    assertFalse("with nothing from React there is still nothing to apply", value.reconcile())
    value.js = 9.0
    value.jsEvents = 1
    assertFalse("an un-emitted sample still refuses the write", value.reconcile())
    value.unreported = null
    assertTrue("and clearing it lets the write through", value.reconcile())
    assertEquals(9.0, value.displayed, 0.0)
  }
}
