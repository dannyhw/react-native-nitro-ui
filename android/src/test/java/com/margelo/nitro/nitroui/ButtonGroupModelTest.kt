package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

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
    assertEquals(2, count2)

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

    val (displayed, count) = model.state.user("bold")
    assertEquals(true, displayed.contains("bold"))
    assertEquals(1, count)

    // React refused the change: its next render re-sends the old `checkedIds`, which is stale.
    assertFalse(model.state.reconcile())
    assertEquals(setOf("bold"), model.state.displayed)
  }

  @Test
  fun theSameWriteIsAcceptedOnceReactHasConfirmedTheEvent() {
    val model = modelWith(item("bold"))
    model.state.controlled = setOf("bold")
    model.state.js = emptySet()
    model.state.user("bold")

    // React has processed event 1 and still says "not checked", so the write applies.
    model.state.jsEvents = 1
    assertTrue(model.state.reconcile())
    assertEquals(emptySet<String>(), model.state.displayed)
  }

  @Test
  fun aWriteMovesOnlyTheControlledItems() {
    val model = modelWith(item("bold"), item("italic"))
    // Only `bold` is controlled; `italic` is not.
    model.state.controlled = setOf("bold")
    model.state.js = setOf("bold")
    model.state.jsEvents = 0
    model.state.nativeEvents = 0

    model.state.user("italic")
    model.state.jsEvents = 1
    assertTrue("the controlled item moved", model.state.reconcile())
    assertEquals(setOf("bold", "italic"), model.state.displayed)

    model.state.js = setOf("bold", "italic")
    model.state.jsEvents = 2
    assertFalse(model.state.reconcile())
  }

  @Test
  fun defaultCheckedSeedsOnceAndALaterBatchCannotUndoATap() {
    val model = modelWith(item("bold"), item("italic"))

    model.applyDefaults(listOf("bold"))
    assertEquals(setOf("bold"), model.state.displayed)

    // A re-render re-sends `defaultCheckedIds`; re-applying the seed would undo the tap.
    model.state.user("bold")
    model.applyDefaults(listOf("bold"))
    assertEquals(emptySet<String>(), model.state.displayed)

    model.applyDefaults(listOf("italic"))
    assertEquals(setOf("italic"), model.state.displayed)
  }

  @Test
  fun anItemThatStoppedBeingAToggleIsForgottenByTheCheckedSet() {
    val model = modelWith(item("bold"), item("italic"))
    model.displayed = model.state.user("bold").first
    model.items = listOf(item("bold", toggle = false), item("italic"))

    model.pruneChecked()

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
    assertEquals(emptySet<String>(), model.displayed)
    assertEquals(emptySet<String>(), model.state.displayed)
    assertEquals(null, model.state.js)
    assertEquals(emptySet<String>(), model.state.controlled)
    assertEquals(0, model.state.nativeEvents)
    assertEquals(0, model.state.jsEvents)
    assertEquals(0, model.ledger.visibleIds(listOf("bold")).size)
    assertEquals(false, model.ledger.indicatorPlaced())
    assertEquals(false, model.menuOpen)
    assertEquals(
      "checked=none;visible=none;overflow=none;row=none;shown=none;menu=closed;" +
        "overflowIcons=-;probes=0;a11y=none",
      model.stateReport(),
    )
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
