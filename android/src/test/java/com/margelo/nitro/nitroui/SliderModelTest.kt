package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

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

    fun tick() {
      frames++
      onFrame?.invoke()
    }
  }

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

    // A pump that outlives its drag emits nothing, so only this flag can show it.
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
    // Continuous, so `dragTo(4.0)` is not snapped to a step.
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
    world.model.endDrag()
    assertEquals("a cancelled drag has no complete", emptyList<Double>(), world.events.completes)
    assertFalse(world.model.isFramePumpArmed)
  }

  @Test
  fun anAccessibilityStepMovesToTheNextLegalValueInItsDirection() {
    // `0..10 step 3` does not end on a step.
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
  fun anAccessibilityStepTakesItsDirectionFromTheProgressTheReaderWasShown() {
    // The semantics node is republished a frame after the model moves, so a press can be
    // aimed at the progress the reader was shown while the model is already ahead.
    val oneBehind = fixture(0.0, 12.0, 3.0, 3.0)
    assertTrue(
      "the reader said up from 0, so the value moves up from where it is",
      oneBehind.model.accessibilityStepToward(3.0, publishedProgress = 0.0)
    )
    assertEquals(6.0, oneBehind.model.displayed, 0.0)
    assertEquals("the gesture starts from the value it really began at", listOf(3.0), oneBehind.events.starts)
    assertEquals(listOf(6.0), oneBehind.events.completes)

    val twoBehind = fixture(0.0, 12.0, 3.0, 6.0)
    assertTrue(twoBehind.model.accessibilityStepToward(3.0, publishedProgress = 0.0))
    assertEquals(
      "up from the progress that was shown, so up from 6 - never back to 3",
      9.0,
      twoBehind.model.displayed,
      0.0,
    )
    assertEquals(listOf(9.0), twoBehind.events.completes)

    val still = fixture(0.0, 12.0, 3.0, 6.0)
    assertFalse(still.model.accessibilityStepToward(3.0, publishedProgress = 3.0))
    assertEquals(6.0, still.model.displayed, 0.0)
    assertEquals(emptyList<Double>(), still.events.starts)
    assertEquals(emptyList<Double>(), still.events.completes)
  }

  // MARK: - The progress a reader is given is a Float

  // The progress the semantics node publishes for [displayed]: through a `Float`.
  private fun published(
    displayed: Double,
  ): Double = displayed.toFloat().toDouble()

  @Test
  fun aReaderAskingForThePublishedProgressMovesNothing() {
    // 0.3 through a `Float` is 0.30000001192092896, above the model's 0.3.
    val world = fixture(0.0, 1.0, 0.1, 0.3)
    assertFalse(
      "0.3 through a Float is the value on screen, not a step above it",
      world.model.accessibilityStepToward(0.3f.toDouble()),
    )
    assertEquals(0.3, world.model.displayed, 0.0)
    assertEquals(emptyList<Double>(), world.events.starts)
    assertEquals(emptyList<Double>(), world.events.completes)
    assertFalse(world.model.isFramePumpArmed)
  }

  @Test
  fun aReaderAskingForThePublishedProgressDoesNotStepDownEither() {
    // 0.7 through a `Float` is 0.699999988079071, below the model's 0.7.
    val world = fixture(0.0, 1.0, 0.1, 0.7)
    assertFalse(
      "0.7 through a Float is the value on screen, not a step below it",
      world.model.accessibilityStepToward(0.7f.toDouble()),
    )
    assertEquals(0.7, world.model.displayed, 0.0)
    assertEquals(emptyList<Double>(), world.events.starts)
    assertEquals(emptyList<Double>(), world.events.completes)
  }

  @Test
  fun theFloatRoundTripIsWhatMakesThoseFixturesMeanAnything() {
    // The two tests above need these numbers to differ, on opposite sides.
    assertTrue("0.3 through a Float is above 0.3", 0.3f.toDouble() > 0.3)
    assertTrue("0.7 through a Float is below 0.7", 0.7f.toDouble() < 0.7)
    assertEquals(0.3f.toDouble(), published(0.3), 0.0)
    assertEquals(0.7f.toDouble(), published(0.7), 0.0)
  }

  @Test
  fun theSameTargetIsAStepWhenItIsNotTheValueOnScreen() {
    val shown = 0.3f.toDouble()

    val atThatValue = fixture(0.0, 1.0, 0.1, 0.3)
    assertFalse("at 0.3 it is the progress the reader was shown", atThatValue.model.accessibilityStepToward(shown))

    val oneStopAbove = fixture(0.0, 1.0, 0.1, 0.4)
    assertTrue("one stop above 0.3 it is a step down", oneStopAbove.model.accessibilityStepToward(shown))
    assertEquals(0.3, oneStopAbove.model.displayed, 0.0)
    assertEquals(listOf(0.3), oneStopAbove.events.completes)

    val above = fixture(0.0, 1.0, 0.1, 0.3)
    assertTrue(above.model.accessibilityStepToward(0.35f.toDouble()))
    assertEquals(0.4, above.model.displayed, 0.0)
    assertEquals(listOf(0.4), above.events.completes)
  }

  @Test
  fun aReaderAskingForWhatAStaleTreeStillShowsMovesNothing() {
    // The semantics tree still shows 0.3 while the model has moved to 0.4.
    val world = fixture(0.0, 1.0, 0.1, 0.4)
    assertFalse(
      "the stale progress the reader was shown is not a direction either",
      world.model.accessibilityStepToward(0.3f.toDouble(), publishedProgress = 0.3),
    )
    assertEquals(0.4, world.model.displayed, 0.0)
    assertEquals(emptyList<Double>(), world.events.completes)

    assertTrue(
      "up from the progress that was shown",
      world.model.accessibilityStepToward(0.4f.toDouble(), publishedProgress = 0.3),
    )
    assertEquals(0.5, world.model.displayed, 0.0)
    assertEquals(listOf(0.5), world.events.completes)
  }

  @Test
  fun aStrideTooSmallForTheFloatIsNotADirection() {
    // At 1e9 adjacent `Float`s are 64 apart, so the node shows 1000000000 for 1000000010.
    val world = fixture(1_000_000_000.0, 1_000_000_200.0, 10.0, 1_000_000_010.0)
    val target = published(world.model.displayed)
    assertTrue(
      "the progress the node carries sits below the value it was made from",
      target < world.model.displayed,
    )
    assertFalse("a target that is the shown progress is not a direction", world.model.accessibilityStepToward(target))
    assertEquals(1_000_000_010.0, world.model.displayed, 0.0)
    assertEquals(emptyList<Double>(), world.events.starts)
    assertEquals(emptyList<Double>(), world.events.completes)

    val wide = fixture(1_000_000_000.0, 1_000_100_000.0, 10.0, 1_000_000_010.0)
    val publishedStride = (1_000_100_000.0f - 1_000_000_000.0f) / 20f
    val wideTarget = (1_000_000_010.0f + publishedStride).toDouble()
    assertTrue("the float does carry a stride here", wideTarget > published(wide.model.displayed))
    assertTrue(wide.model.accessibilityStepToward(wideTarget))
    assertEquals(1_000_000_020.0, wide.model.displayed, 0.0)
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
    // The platform's stride is a twentieth of the range (0.5), which quantises back to 0 here.
    val world = fixture(0.0, 10.0, 3.0, 0.0)
    assertTrue(world.model.accessibilityStepToward(0.5))
    assertEquals(3.0, world.model.displayed, 0.0)

    val down = fixture(0.0, 10.0, 3.0, 3.0)
    assertTrue(down.model.accessibilityStepToward(2.5))
    assertEquals(0.0, down.model.displayed, 0.0)
  }

  @Test
  fun aContinuousRangeStridesByATwentiethOfItself() {
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
    val world = fixture(0.0, 10.0, 0.0, 0.0)
    world.model.dragTo(4.0)
    world.model.state.js = 8.0
    assertFalse("the write is refused while the sample is unreported", world.model.state.reconcile())
    world.pump.tick()
    // JS confirms the event, as the echoed `mostRecentEventCount` does.
    world.model.state.jsEvents = world.model.state.nativeEvents
    assertTrue(world.model.state.reconcile())
    assertEquals(8.0, world.model.state.displayed, 0.0)
  }

  @Test
  fun anAccessibilityStepInsideAFingerDragIsASampleNotAGesture() {
    // A screen reader's step while a finger holds the thumb must not end the finger's drag.
    val world = fixture(0.0, 10.0, 3.0, 0.0)
    world.model.dragTo(1.0)
    assertEquals("the finger opened a drag", listOf(0.0), world.events.starts)

    assertTrue("the step still reports that it moved something", world.model.accessibilityStepToward(0.5))
    assertEquals("it moved the value", 3.0, world.model.displayed, 0.0)
    assertEquals("…without a second start", listOf(0.0), world.events.starts)
    assertEquals("…and without closing the finger's drag", emptyList<Double>(), world.events.completes)
    assertTrue("…and without disarming the pump that drag armed", world.model.isFramePumpArmed)

    world.model.dragTo(7.0)
    world.pump.tick()
    assertEquals(
      "one frame, one event, whatever touched the track in between",
      listOf(6.0),
      world.events.changes,
    )

    world.model.endDrag()
    assertEquals(
      "and the gesture ends exactly once, when the finger lifts",
      listOf(6.0),
      world.events.completes,
    )
    assertFalse(world.model.isFramePumpArmed)

    assertTrue(world.model.accessibilityStepToward(6.5))
    assertEquals(listOf(0.0, 6.0), world.events.starts)
    assertEquals(listOf(6.0, 9.0), world.events.changes)
    assertEquals(listOf(6.0, 9.0), world.events.completes)
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
