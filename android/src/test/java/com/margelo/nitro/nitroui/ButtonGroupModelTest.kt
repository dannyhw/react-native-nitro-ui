package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the two ButtonGroup rules a device cannot see (G20).
 *
 * The first is the *set* handshake (`docs/architecture/core.md` §4, spelled for many
 * toggles at once by [ButtonGroupCheckedSet]). Switch's and IconButton's twin is a
 * single value, so their test can only prove one flip; here three things are load
 * bearing and none of them is visible on screen:
 *
 * - a write is refused while `jsEvents < nativeEvents`, which is what makes a change
 *   React refused snap back instead of stranding the item;
 * - one counter serves the whole group, because per-item counts would let one item's
 *   stale write be accepted on the strength of another item's event;
 * - a write moves only the `controlledIds`, so a group can hold a controlled toggle
 *   and an uncontrolled one without the controlled one's owner wiping the other's
 *   state on every render.
 *
 * The second is the recycle reset, for Button's reason: the wrapper sends every prop
 * on every mount (DECISIONS D7 / nitro#1184), so a recycled control re-receives the
 * items anyway — but *not* a fresh event count or a fresh `seeded` set, and those two
 * surviving is how the second owner's toggles stop answering.
 */
class ButtonGroupModelTest {
  private fun item(
    id: String,
    toggle: Boolean = true,
  ) = ButtonGroupItemState(id, id.uppercase(), null, null, disabled = false, toggle = toggle)

  private fun modelWith(vararg items: ButtonGroupItemState): ButtonGroupModel =
    ButtonGroupModel().apply {
      this.items = items.toList()
    }

  // MARK: - The set handshake

  @Test
  fun aFlipPaintsAtOnceAndCarriesTheGroupsEventCount() {
    val model = modelWith(item("bold"), item("italic"))

    val (first, count1) = model.state.user("bold")
    assertEquals(setOf("bold"), first)
    assertEquals(1, count1)

    val (second, count2) = model.state.user("italic")
    assertEquals(setOf("bold", "italic"), second)
    // One counter for the group: the second item's flip is event 2, not event 1.
    assertEquals(2, count2)

    // A third tap on a checked toggle un-checks it; the count keeps climbing.
    val (third, count3) = model.state.user("bold")
    assertEquals(setOf("italic"), third)
    assertEquals(3, count3)
  }

  @Test
  fun aWriteReactHasNotCaughtUpWithIsRefusedAndTheItemSnapsBack() {
    val model = modelWith(item("bold"))
    model.state.controlled = setOf("bold")
    model.state.js = emptySet()
    model.state.jsEvents = 0

    // The user switches it on: native paints it and emits event 1.
    val (displayed, count) = model.state.user("bold")
    assertEquals(true, displayed.contains("bold"))
    assertEquals(1, count)

    // React refused the change - its next render sends the same `checkedIds` it had.
    // The write is stale (`jsEvents` 0 < `nativeEvents` 1), so it reverts the flip.
    assertFalse(model.state.reconcile())
    assertEquals(setOf("bold"), model.state.displayed)
  }

  @Test
  fun theSameWriteIsAcceptedOnceReactHasConfirmedTheEvent() {
    val model = modelWith(item("bold"))
    model.state.controlled = setOf("bold")
    model.state.js = emptySet()
    model.state.user("bold")

    // React processed event 1 and still says "not checked": now the write is the
    // newer word and the toggle snaps back on the *next* frame, not on the tap.
    model.state.jsEvents = 1
    assertTrue(model.state.reconcile())
    assertEquals(emptySet<String>(), model.state.displayed)
  }

  @Test
  fun aWriteMovesOnlyTheControlledItems() {
    val model = modelWith(item("bold"), item("italic"))
    // Only `bold` has a controlled `checked`; `italic` is uncontrolled (B1).
    model.state.controlled = setOf("bold")
    model.state.js = setOf("bold")
    model.state.jsEvents = 0
    model.state.nativeEvents = 0

    // The user switches the *uncontrolled* item on, then the controlled owner
    // re-renders. Its write must not touch `italic` — that is the whole reason
    // `controlledIds` is sent at all.
    model.state.user("italic")
    model.state.jsEvents = 1
    assertTrue("the controlled item moved", model.state.reconcile())
    assertEquals(setOf("bold", "italic"), model.state.displayed)

    // And the controlled owner cannot reach outside its own items either: a
    // `checkedIds` that names an uncontrolled id does not light it.
    model.state.js = setOf("bold", "italic")
    model.state.jsEvents = 2
    assertFalse(model.state.reconcile())
  }

  @Test
  fun defaultCheckedSeedsOnceAndALaterBatchCannotUndoATap() {
    val model = modelWith(item("bold"), item("italic"))

    model.applyDefaults(listOf("bold"))
    assertEquals(setOf("bold"), model.state.displayed)

    // The user switches `bold` off. A re-render re-sends `defaultCheckedIds` —
    // the wrapper always sends every prop — and re-applying the seed here would
    // paint it back on with no tap from anyone.
    model.state.user("bold")
    model.applyDefaults(listOf("bold"))
    assertEquals(emptySet<String>(), model.state.displayed)

    // An id that was never seeded still seeds, so the one-shot is per id.
    model.applyDefaults(listOf("italic"))
    assertEquals(setOf("italic"), model.state.displayed)
  }

  @Test
  fun anItemThatStoppedBeingAToggleIsForgottenByTheCheckedSet() {
    val model = modelWith(item("bold"), item("italic"))
    model.displayed = model.state.user("bold").first
    model.items = listOf(item("bold", toggle = false), item("italic"))

    model.pruneChecked()

    // `bold` is an action now: no set the row draws can contain it.
    assertEquals(emptySet<String>(), model.displayed)
    assertEquals(emptySet<String>(), model.state.displayed)
  }

  // MARK: - The recycle reset

  @Test
  fun aRecycledModelForgetsTheRowTheSetTheCountsAndTheLedgerWithIt() {
    val model = modelWith(item("bold"), item("copy", toggle = false))
    model.appearance = ButtonGroupAppearance.Connected
    model.variant = ButtonVariant.Outlined
    model.scale = ButtonScale.Large
    model.labelStyle = ButtonGroupLabelStyle.IconOnly
    model.enabled = false
    model.tintColor = 0x11223344
    model.accessibilityLabel = "Toolbar"
    model.overflowAccessibilityLabel = "More tools"
    model.sizingKey = "connected|outlined|large|iconOnly|2"
    model.onPress = {}
    model.onCheckedChange = { _, _, _ -> }
    model.state.user("bold")
    model.state.js = setOf("bold")
    model.state.controlled = setOf("bold")
    model.state.jsEvents = 4
    model.applyDefaults(listOf("bold"))
    model.publishRowReport("visible=2;overflow=1;shown=bold,copy")
    model.publishAccessibilityReport("nodes=2")
    model.recordMenuOpen(true)
    model.ledger.recordPlaced("bold")
    model.ledger.recordIndicatorPlaced()

    model.reset()

    assertEquals(emptyList<ButtonGroupItemState>(), model.items)
    assertEquals(ButtonGroupAppearance.Standard, model.appearance)
    assertEquals(ButtonVariant.Filled, model.variant)
    assertEquals(ButtonScale.Medium, model.scale)
    assertEquals(ButtonGroupLabelStyle.Automatic, model.labelStyle)
    assertEquals(true, model.enabled)
    assertEquals(null, model.tintColor)
    assertEquals(null, model.accessibilityLabel)
    assertEquals(null, model.overflowAccessibilityLabel)
    assertEquals("", model.sizingKey)
    assertEquals(null, model.onPress)
    assertEquals(null, model.onCheckedChange)
    // The three the *props* cannot re-send into a fresh value, and so the three a
    // missing line in `reset()` strands: a second owner whose first write is read as
    // stale (D7's note in `IconButtonModelTest` is the same trap on one value).
    assertEquals(emptySet<String>(), model.displayed)
    assertEquals(emptySet<String>(), model.state.displayed)
    assertEquals(null, model.state.js)
    assertEquals(emptySet<String>(), model.state.controlled)
    assertEquals(0, model.state.nativeEvents)
    assertEquals(0, model.state.jsEvents)
    // The witnesses are claims about *this* mount. Read before the seed below, which
    // is itself a new mount's first state.
    assertEquals(0, model.ledger.visibleIds(listOf("bold")).size)
    assertEquals(false, model.ledger.indicatorPlaced())
    assertEquals(false, model.menuOpen)
    assertEquals(
      "checked=none;visible=none;overflow=none;menu=closed;probes=0;a11y=none",
      model.stateReport(),
    )
    // `seeded` is not a field a test can read, and that is the point of writing it
    // this way: the second owner's `defaultCheckedIds` has to seed again, so if the
    // set survived, this line goes red rather than the screen quietly mislabelling
    // a toggle.
    model.applyDefaults(listOf("bold"))
    assertEquals(setOf("bold"), model.state.displayed)
  }

  // MARK: - The label styles

  @Test
  fun everyLabelStyleDrawsWhatTheDocsSayAndNothingIsRecognisedAsAutomatic() {
    assertEquals(ButtonGroupLabelStyle.Automatic, ButtonGroupLabelStyle.from("nonsense"))
    assertEquals(ButtonGroupAppearance.Standard, ButtonGroupAppearance.from("nonsense"))
    assertEquals(ButtonVariant.Filled, ButtonVariant.from("nonsense"))
    assertEquals(ButtonScale.Medium, ButtonScale.from("nonsense"))

    // `automatic` is Android's own default — icon *and* title (B1), which is not
    // iOS's connected default. A style that drew neither would render an item with
    // no name at all, which is what these four lines are for.
    assertTrue(ButtonGroupLabelStyle.Automatic.showsTitle)
    assertTrue(ButtonGroupLabelStyle.Automatic.showsGlyph)
    assertEquals(ButtonGlyph.TitleOnly, ButtonGroupLabelStyle.TitleOnly.glyph)
    assertEquals(ButtonGlyph.IconOnly, ButtonGroupLabelStyle.IconOnly.glyph)
    assertEquals(ButtonGlyph.Both, ButtonGroupLabelStyle.TitleAndIcon.glyph)
    assertEquals(ButtonGlyph.Both, ButtonGroupLabelStyle.Automatic.glyph)
    assertFalse(ButtonGroupLabelStyle.IconOnly.showsTitle)
    assertFalse(ButtonGroupLabelStyle.TitleOnly.showsGlyph)
  }
}
