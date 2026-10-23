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
}
