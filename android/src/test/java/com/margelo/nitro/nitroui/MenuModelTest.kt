package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit test for the one Menu pick rule an on-device run cannot pin on its own.
 *
 * [MenuModel.applyPick] has to do two things in a decided order (DECISIONS D32): report
 * the choice through [MenuModel.onSelect], then close the popup, which is what fires
 * [MenuModel.onClose]. The device harness can see the same order through three JS
 * callbacks (`example/__tests__/Menu.harness.tsx`'s `orderLog`), but that assertion
 * needs an emulator, an app build, and a popup whose row the injector can press - so
 * it is the last thing anyone re-runs. This is the same rule with none of that around
 * it: the callbacks are two lambdas appending to a list.
 *
 * The other half is what D32 does *not* change: the popup comes down on every pick
 * path, including the four that report nothing - a disabled control, a disabled row, a
 * submenu header and an unknown id. `PickerModelTest` checks that rule for Picker's
 * equivalent, and a Menu that closed only on the paths it reported would look fine to
 * every assertion that only counts events.
 */
class MenuModelTest {
  /**
   * A model with a live menu: two actions, one disabled, plus a submenu whose own row
   * is a header and a section with a child. `expanded` is what an open menu looks like
   * to the model, and the harness reaches it the same way - through the popup's press.
   */
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
    // D32's order, spelled as arrival order. The old code closed first, which leaves
    // this list as ["close", "select:copy"] - red on the first line, not the last,
    // because an assertion on the whole sequence is the only one that can see order.
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
    // A second pick is a second open: the popup is already down, and `setOpen` only
    // reports a transition. Nothing about the order depends on which kind of row it is.
    model.setOpen(true)
    model.applyPick("delete")
    assertEquals(
      listOf("select:share.mail", "close", "open", "select:delete", "close"),
      events
    )
    assertFalse(model.expanded)
  }

  @Test
  fun everyPathThatReportsNothingStillClosesThePopup() {
    // Four refusals, one expectation each: no `select:`, exactly one `close`, and an
    // open menu that is closed afterwards. Each gets a fresh model, so a close that
    // only the first refusal earned could not hide behind the others' transition.
    for (id in listOf("paste", "share", "no-such-row")) {
      val events = mutableListOf<String>()
      val model = openModel(events)
      model.applyPick(id)
      assertEquals("row \"$id\" reports nothing but closes the menu", listOf("close"), events)
      assertFalse("row \"$id\" still took the menu down", model.expanded)
    }

    val disabled = mutableListOf<String>()
    val model = openModel(disabled).apply { enabled = false }
    model.applyPick("copy")
    assertEquals("a disabled control is inert, but the menu still comes down", listOf("close"), disabled)
    assertFalse(model.expanded)
  }

  /**
   * The reset half of the same state, which F6 made worth gating from here.
   *
   * Whether a Menu's popup is open is the one piece of state on this control no prop
   * rewrites, so it is what a recycle has to clear. `Conformance.harness.tsx`'s residue
   * probe cannot reach it on either platform - on iOS no harness gesture can reach a
   * SwiftUI `Menu` (DECISIONS D29) and the read-out answers `-1` there
   * (`HybridNitroUiMenu.swift:762`) - so before F6 the line had no observation anywhere
   * that could show it missing. Android *can* read the flag (`readMenuReport`) and now
   * recycles (`example/__tests__/Recycling.harness.tsx`), and this is that guard at the
   * cheapest possible distance: an open model, one `reset()`, and the control's own
   * answer. Delete `expanded = false` from [MenuModel.reset] and this goes red on the
   * report line, which is the assertion a device run cannot make for either platform.
   *
   * The empty event list is the other half of the line: `reset` writes `expanded`
   * directly rather than through [setOpen], on purpose - a recycled model has no mount
   * left to report a transition to, so the previous owner's `onClose` must not fire for
   * a popup the *pool* closed.
   */
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
  fun aCloseOnlyReportsTheTransition() {
    // The pairing D32 keeps: one open, one close, so a pick cannot leave an open a
    // listener never sees closed - and cannot fire the close twice either, which is
    // what would happen if `applyPick` closed directly as well as through `setOpen`.
    val events = mutableListOf<String>()
    val model = openModel(events)
    model.applyPick("copy")
    model.applyPick("copy")
    assertEquals(listOf("select:copy", "close", "select:copy"), events)
  }
}
