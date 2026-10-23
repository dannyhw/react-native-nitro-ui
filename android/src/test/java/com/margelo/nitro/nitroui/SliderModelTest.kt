package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for one Slider's drag, on the Android twin of the harness's drag
 * tests - and the only place the frame pump can be observed at all.
 *
 * [NitroUiFramePump] is an interface so this file can hold a drag still: on a
 * device the tick arrives on a `Choreographer` between frames, which makes "one
 * sample, one event" a race to time, and `Choreographer` does not exist on the
 * JVM. Here a frame is a call to [FakePump.tick], so the questions the round-1
 * review asked - does a pump stop when its drag ends, can a complete arrive
 * without a start, where does a screen reader's increment land - have answers
 * that do not depend on when the emulator felt like drawing.
 *
 * The value *rule* itself is [NitroUiSliderValueTest]'s job; what matters here is
 * which values the model reports and when.
 */
class SliderModelTest {
  /** A pump the test drives, with the arming the real one has. */
  private class FakePump : NitroUiFramePump {
    private var onFrame: (() -> Unit)? = null

    private var armed = false

    var frames = 0
      private set

    override val isArmed: Boolean
      get() = armed

    override fun start(
      onFrame: () -> Unit,
    ) {
      this.onFrame = onFrame
      armed = true
    }

    override fun stop() {
      onFrame = null
      armed = false
    }

    /** One display frame. */
    fun tick() {
      frames++
      onFrame?.invoke()
    }
  }

  /** The three callbacks, as the app sees them. */
  private class Recorder {
    val starts = mutableListOf<Double>()
    val changes = mutableListOf<Double>()
    val completes = mutableListOf<Double>()

    fun wire(model: SliderModel) {
      model.onSlidingStart = { value, _ -> starts.add(value) }
      model.onChange = { value, _ -> changes.add(value) }
      model.onSlidingComplete = { value, _ -> completes.add(value) }
    }
  }

  private class Fixture {
    val pump = FakePump()
    val model = SliderModel(pump)
    val events = Recorder()

    init {
      model.minimumValue = 0.0
      model.maximumValue = 10.0
      model.step = 3.0
      events.wire(model)
    }
  }

  private fun fixture(
    minimum: Double,
    maximum: Double,
    step: Double,
    displayed: Double,
  ): Fixture {
    val fixture = Fixture()
    fixture.model.minimumValue = minimum
    fixture.model.maximumValue = maximum
    fixture.model.step = step
    fixture.model.displayed = displayed
    fixture.model.state.displayed = displayed
    return fixture
  }

  @Test
  fun aDragEmitsOneChangePerFrameHoweverFastTheFingerMoves() {
    val world = fixture(0.0, 10.0, 0.0, 0.0)
    world.model.dragTo(1.0)
    world.model.dragTo(2.0)
    world.model.dragTo(3.0)
    assertEquals("one start", listOf(0.0), world.events.starts)
    assertEquals("no change before a frame", emptyList<Double>(), world.events.changes)
    world.pump.tick()
    assertEquals("one change for three moves", listOf(3.0), world.events.changes)
    world.pump.tick()
    assertEquals("an empty frame emits nothing", listOf(3.0), world.events.changes)
  }

  @Test
  fun theFramePumpIsArmedByADragAndStoppedByItsEnd() {
    val world = Fixture()
    assertFalse("an idle Slider has no ticker at all", world.model.isFramePumpArmed)

    world.model.dragTo(4.0)
    assertTrue("a drag in flight is served by the pump", world.model.isFramePumpArmed)

    // The review's actual question: a pump that outlives its drag emits nothing,
    // so nothing in the event stream shows it. Only this can.
    world.model.endDrag()
    assertFalse("a drag that ended must not leave a tick running", world.model.isFramePumpArmed)

    world.model.dragTo(5.0)
    assertTrue(world.model.isFramePumpArmed)
    world.model.cancelDrag()
    assertFalse("a recycled drag must not leave a tick running either", world.model.isFramePumpArmed)
  }

  @Test
  fun aCompleteCannotArriveWithoutAStart() {
    val world = Fixture()
    world.model.endDrag()
    assertEquals("an end with no start is not a gesture", emptyList<Double>(), world.events.completes)
    assertEquals(emptyList<Double>(), world.events.starts)
    assertEquals(emptyList<Double>(), world.events.changes)
    assertFalse(world.model.isFramePumpArmed)
  }

  @Test
  fun aSecondEndIsSilent() {
    // Continuous so the numbers say what they mean: `dragTo(4.0)` on a stepped
    // range would end at 3, and this test is about the guard, not the grid.
    val world = fixture(0.0, 10.0, 0.0, 0.0)
    world.model.beginDrag()
    world.model.dragTo(4.0)
    world.model.endDrag()
    world.model.endDrag()
    assertEquals("one start", listOf(0.0), world.events.starts)
    assertEquals("one complete, not two", listOf(4.0), world.events.completes)
  }

  @Test
  fun aLateEndCannotReachTheNextOwnerOfARecycledControl() {
    val world = Fixture()
    world.model.beginDrag()
    world.model.dragTo(4.0)
    world.model.cancelDrag()
    // The recycle happened; whatever arrives from the abandoned gesture next must
    // not be a completion delivered to whoever owns this instance now.
    world.model.endDrag()
    assertEquals("a cancelled drag has no complete", emptyList<Double>(), world.events.completes)
    assertFalse(world.model.isFramePumpArmed)
  }

  @Test
  fun anAccessibilityStepMovesToTheNextLegalValueInItsDirection() {
    // `0..10 step 3` is the docs' own example of a range that does not end on a
    // step, which is why the platform's own fraction-of-the-range increment cannot
    // be the rule: the next two tests are that fact.
    val world = fixture(0.0, 10.0, 3.0, 0.0)
    assertTrue(world.model.accessibilityStepToward(0.5))
    assertEquals(3.0, world.model.displayed, 0.0)
    assertEquals("one gesture", listOf(0.0), world.events.starts)
    assertEquals("one change, emitted without waiting for a frame", listOf(3.0), world.events.changes)
    assertEquals("one gesture", listOf(3.0), world.events.completes)
    assertFalse("and the pump it armed is put away", world.model.isFramePumpArmed)

    assertTrue(world.model.accessibilityStepToward(3.5))
    assertEquals(6.0, world.model.displayed, 0.0)
    assertTrue(world.model.accessibilityStepToward(6.5))
    assertEquals(9.0, world.model.displayed, 0.0)
    // The end of the track is a legal value even though it is off the grid.
    assertTrue(world.model.accessibilityStepToward(9.5))
    assertEquals(10.0, world.model.displayed, 0.0)
  }

  @Test
  fun anAccessibilityStepAtABoundMovesNothingAndSaysSo() {
    val world = fixture(0.0, 10.0, 3.0, 10.0)
    assertFalse("nothing above the top of the track", world.model.accessibilityStepToward(10.5))
    assertEquals("no gesture for a value that did not change", emptyList<Double>(), world.events.starts)
    assertEquals(emptyList<Double>(), world.events.completes)

    world.model.displayed = 0.0
    assertFalse("nothing below the bottom either", world.model.accessibilityStepToward(-0.5))
    assertEquals(0.0, world.model.displayed, 0.0)
    assertEquals(emptyList<Double>(), world.events.starts)

    assertFalse("the same value is not a direction", world.model.accessibilityStepToward(0.0))
    assertEquals(emptyList<Double>(), world.events.starts)
  }

  @Test
  fun aPlatformFractionStillLandsOnTheGrid() {
    // The bug this exists for: the platform's increment is a twentieth of the
    // range - 0.5 here - and quantising 0.5 on `0..10 step 3` gives back 0. The
    // direction is the platform's, the destination is native's.
    val world = fixture(0.0, 10.0, 3.0, 0.0)
    assertTrue(world.model.accessibilityStepToward(0.5))
    assertEquals(3.0, world.model.displayed, 0.0)

    val down = fixture(0.0, 10.0, 3.0, 3.0)
    assertTrue(down.model.accessibilityStepToward(2.5))
    assertEquals(0.0, down.model.displayed, 0.0)
  }

  @Test
  fun aContinuousRangeStridesByATwentiethOfItself() {
    // No step: there is no grid to follow, so the platform's own stride is the
    // rule - and it is already a legal value, so it does not snap back.
    val world = fixture(0.0, 1.0, 0.0, 0.0)
    assertTrue(world.model.accessibilityStepToward(0.05))
    assertEquals(0.05, world.model.displayed, 1e-12)
    assertTrue(world.model.accessibilityStepToward(0.0))
    assertEquals(0.0, world.model.displayed, 1e-12)
  }

  @Test
  fun aDisabledControlIgnoresAnAccessibilityStep() {
    val world = Fixture()
    world.model.enabled = false
    assertFalse(world.model.accessibilityStepToward(5.0))
    assertEquals(0.0, world.model.displayed, 0.0)
    assertEquals(emptyList<Double>(), world.events.starts)
    assertEquals(emptyList<Double>(), world.events.changes)
    assertFalse(world.model.isFramePumpArmed)
  }

  @Test
  fun anAccessibilityStepDoesNotOvertakeAnUnreportedSample() {
    // The a11y path writes through the same handshake as a finger, so a sample JS
    // has not seen yet still refuses React's write (core.md §4, §11).
    val world = fixture(0.0, 10.0, 0.0, 0.0)
    world.model.dragTo(4.0)
    world.model.state.js = 8.0
    assertFalse("the write is refused while the sample is unreported", world.model.state.reconcile())
    world.pump.tick()
    // JS confirms the event it was just given, which is the other half of what
    // makes a write fresh enough to apply (the Hybrid View echoes it as
    // `mostRecentEventCount`).
    world.model.state.jsEvents = world.model.state.nativeEvents
    assertTrue(world.model.state.reconcile())
    assertEquals(8.0, world.model.state.displayed, 0.0)
  }

  @Test
  fun recyclingCancelsTheDragAndThePump() {
    val world = Fixture()
    world.model.dragTo(4.0)
    world.model.reset()
    assertFalse(world.model.isFramePumpArmed)
    assertEquals(0.0, world.model.displayed, 0.0)
    assertEquals("a recycle reports nothing", emptyList<Double>(), world.events.completes)
    assertTrue("the next owner starts clean", !world.model.dragging)
  }
}
