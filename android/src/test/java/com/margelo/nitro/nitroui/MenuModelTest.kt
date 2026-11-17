package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MenuModelTest {
  // An open menu: two actions (one disabled), a submenu whose own row is a header, and a
  // section with a child.
  private fun openModel(events: MutableList<String>): MenuModel =
    MenuModel().apply {
      title = "Actions"
      entries =
        listOf(
          MenuEntry.Action(action("copy", "Copy")),
          MenuEntry.Action(action("paste", "Paste", disabled = true)),
          MenuEntry.Submenu(
            MenuSubmenuItem(
              id = "share",
              title = "Share",
              items = listOf(action("share.mail", "Mail")),
            )
          ),
          MenuEntry.Section(
            MenuSectionItem(
              id = "dangerous",
              title = "Dangerous",
              items = listOf(action("delete", "Delete", destructive = true)),
            )
          ),
        )
      onSelect = { id -> events.add("select:$id") }
      onOpen = { events.add("open") }
      onClose = { events.add("close") }
      expanded = true
    }

  private fun action(
    id: String,
    title: String,
    disabled: Boolean = false,
    destructive: Boolean = false,
  ) = MenuActionItem(id = id, title = title, disabled = disabled, destructive = destructive)

  @Test
  fun aPickReportsTheChoiceThenClosesThePopup() {
    val events = mutableListOf<String>()
    val model = openModel(events)
    model.applyPick("copy")
    assertEquals(listOf("select:copy", "close"), events)
    assertFalse("and the pick really did take the menu down", model.expanded)
  }

  @Test
  fun aPickFromASubmenuOrASectionReportsUnderItsOwnIdAndStillCloses() {
    val events = mutableListOf<String>()
    val model = openModel(events)
    model.applyPick("share.mail")
    // The popup is already down, and `setOpen` reports only a transition.
    model.setOpen(true)
    model.applyPick("delete")
    assertEquals(
      listOf("select:share.mail", "close", "open", "select:delete", "close"),
      events
    )
    assertFalse(model.expanded)
  }

  @Test
  fun aPressOnARowThatCannotBePickedAnswersNothingAndHoldsThePopupOpen() {
    // "paste" is a disabled row, "share" a submenu's header and "no-such-row" absent:
    // none of them is a pick, and an open menu stays open through none of them.
    for (id in listOf("paste", "share", "no-such-row")) {
      val events = mutableListOf<String>()
      val model = openModel(events)
      model.applyPick(id)
      assertEquals("row \"$id\" reported something", emptyList<String>(), events)
      assertTrue("row \"$id\" took the menu down", model.expanded)
    }

    val disabled = mutableListOf<String>()
    val model = openModel(disabled).apply { enabled = false }
    model.applyPick("copy")
    assertEquals("a disabled control is inert", emptyList<String>(), disabled)
    assertTrue("a disabled control took its own menu down", model.expanded)

    // The refusals above mean nothing unless this model does answer: an id it can pick
    // reports once and takes the menu down.
    val twin = mutableListOf<String>()
    val enabled = openModel(twin)
    enabled.applyPick("copy")
    assertEquals(listOf("select:copy", "close"), twin)
    assertFalse(enabled.expanded)
  }

  // `reset` writes `expanded` directly, not through `setOpen`: a recycled model must not
  // fire the previous owner's `onClose`.
  @Test
  fun aRecycleClosesThePopupWithoutReportingToItsPreviousOwner() {
    val events = mutableListOf<String>()
    val model = openModel(events)
    assertTrue("the fixture is a menu that is open", model.expanded)
    assertEquals(
      "and the report says so, on the side that can read it",
      "expanded=1",
      model.readMenuReport().substringBefore(';')
    )

    model.reset()

    assertFalse(model.expanded)
    assertEquals("expanded=0", model.readMenuReport().substringBefore(';'))
    assertEquals("and no callback of the previous owner fires", emptyList<String>(), events)
  }

  @Test
  fun aPrimaryActionPressRunsTheActionAndOpensNothing() {
    val events = mutableListOf<String>()
    val model = openModel(events).apply {
      expanded = false
      hasPrimaryAction = true
      primaryAction = { events.add("action") }
    }

    model.applyPrimaryAction()

    assertEquals("one press, one call, and no open", listOf("action"), events)
    assertFalse("the action half never raises the list", model.expanded)
  }

  @Test
  fun aDisabledControlRefusesThePrimaryAction() {
    val events = mutableListOf<String>()
    val model = openModel(events).apply {
      expanded = false
      hasPrimaryAction = true
      primaryAction = { events.add("action") }
      enabled = false
    }

    model.applyPrimaryAction()

    assertEquals("a disabled control has no primary action either", emptyList<String>(), events)
    assertFalse(model.expanded)
  }

  // TalkBack's click action bypasses Material's checked button, so the model's list action
  // has to toggle by itself.
  @Test
  fun theListActionTogglesLikeAPressDoes() {
    val events = mutableListOf<String>()
    val up = openModel(events)

    up.applyListAction()

    assertFalse("an open list goes down", up.expanded)
    assertEquals("one action, one close", listOf("close"), events)

    val down = openModel(events).apply { expanded = false }
    events.clear()

    down.applyListAction()

    assertTrue("a closed list comes up", down.expanded)
    assertEquals("one action, one open", listOf("open"), events)
  }

  @Test
  fun aDisabledControlRefusesTheListAction() {
    val events = mutableListOf<String>()
    val model = openModel(events).apply {
      expanded = false
      enabled = false
    }

    model.applyListAction()

    assertEquals("a disabled control raises nothing of its own", emptyList<String>(), events)
    assertFalse(model.expanded)
  }

  @Test
  fun aMenuWithNoPrimaryActionHasOneTriggerAndNoHalves() {
    val model = MenuModel().apply { title = "Actions" }
    val report = model.readMenuReport()
    assertTrue(report.contains(";split=0;"))
    assertTrue(report.contains(";leading=-1,-1,-1,-1;"))
    assertTrue("the report's tail: $report", report.endsWith(";trailing=-1,-1,-1,-1;iconTints=-"))
  }

  @Test
  fun aDrawnSplitTriggerReportsItsTwoHalvesOnScreen() {
    val model =
      MenuModel().apply {
        title = "Actions"
        hasPrimaryAction = true
        noteCompositionOrigin(20, 40)
        noteSplitDrawn(true)
        noteLeadingBox(0f, 4f, 60f, 44f)
        noteTrailingBox(62f, 4f, 100f, 44f)
      }

    val report = model.readMenuReport()
    assertTrue(report.contains(";split=1;"))
    assertTrue("leading box plus the composition's origin: " + report, report.contains(";leading=20,44,80,84;"))
    assertTrue("trailing box plus the composition's origin: " + report, report.contains(";trailing=82,44,120,84"))
  }

  @Test
  fun aRecycleClearsTheSplitTriggerAndItsHalves() {
    val model =
      MenuModel().apply {
        title = "Actions"
        hasPrimaryAction = true
        noteCompositionOrigin(20, 40)
        noteSplitDrawn(true)
        noteLeadingBox(0f, 4f, 60f, 44f)
        noteTrailingBox(62f, 4f, 100f, 44f)
      }
    assertTrue(model.readMenuReport().contains(";split=1;"))

    model.reset()

    // An unread half reports -1 either way; a layout pass shows whether the old boxes were kept.
    model.noteCompositionOrigin(20, 40)

    val report = model.readMenuReport()
    assertFalse("the recycled control is not a split button", report.contains(";split=1;"))
    assertTrue("the previous owner's halves are gone: " + report, report.contains(";leading=-1,-1,-1,-1;"))
    assertTrue("the previous owner's halves are gone: " + report, report.endsWith(";trailing=-1,-1,-1,-1;iconTints=-"))
  }

  @Test
  fun aCloseOnlyReportsTheTransition() {
    val events = mutableListOf<String>()
    val model = openModel(events)
    model.applyPick("copy")
    model.applyPick("copy")
    assertEquals(listOf("select:copy", "close", "select:copy"), events)
  }
}
