package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JVM unit test for the shared menu rows' data half (E2): the wrapper's flat array as
 * the rows the popup draws ([parseMenuRows]), and those rows as Material groups
 * ([menuGroupsOf]).
 *
 * The device harness reads the same two things back out of the open popup's semantics
 * tree (`Menu.harness.tsx`, "draws groups, subtitles and checks"), which is where a
 * mistake shows to a person; this is the same rule without an emulator, so a parse that
 * drops `subtitle`/`checked` or a grouping that merges two sections is red in seconds.
 */
class MenuRowsTest {
  private fun row(
    id: String,
    kind: String = "action",
    title: String = id,
    parentId: String? = null,
    subtitle: String? = null,
    checked: Boolean? = null,
  ) = NitroUiMenuRow(
    id = id,
    kind = kind,
    title = title,
    parentId = parentId?.let { Variant_NullType_String.Second(it) },
    disabled = false,
    destructive = false,
    systemImage = null,
    subtitle = subtitle?.let { Variant_NullType_String.Second(it) },
    checked = checked?.let { Variant_Boolean_NullType.First(it) },
  )

  @Test
  fun `a row keeps its subtitle and its check`() {
    val entries =
      parseMenuRows(
        arrayOf(
          row("wifi", subtitle = "Home", checked = true),
          row("bluetooth", checked = false),
          row("plain"),
          // The wrapper sends `null` for `''`; a stray empty string still draws no line.
          row("empty", subtitle = ""),
        )
      )
    val items = entries.map { (it as MenuEntry.Action).item }
    assertEquals("Home", items[0].subtitle)
    assertEquals(true, items[0].checked)
    assertNull(items[1].subtitle)
    assertEquals(false, items[1].checked)
    assertNull(items[2].subtitle)
    assertNull(items[2].checked)
    assertNull(items[3].subtitle)
  }

  @Test
  fun `a child row keeps its subtitle and its check`() {
    val entries =
      parseMenuRows(
        arrayOf(
          row("view", kind = "section", title = "View"),
          row("grid", parentId = "view", subtitle = "Tiles", checked = true),
        )
      )
    val item = (entries.single() as MenuEntry.Section).item.items.single()
    assertEquals("Tiles", item.subtitle)
    assertEquals(true, item.checked)
  }

  @Test
  fun `loose actions share a group and every section and submenu is its own`() {
    val entries =
      parseMenuRows(
        arrayOf(
          row("copy"),
          row("cut"),
          row("share", kind = "submenu", title = "Share"),
          row("mail", parentId = "share"),
          row("paste"),
          row("danger", kind = "section", title = ""),
          row("delete", parentId = "danger"),
          row("view", kind = "section", title = "View"),
          row("grid", parentId = "view"),
          row("list", parentId = "view"),
          // Neither a title nor a row: nothing to draw, not an empty surface.
          row("nothing", kind = "section", title = ""),
        )
      )
    val groups = menuGroupsOf(entries)
    assertEquals(
      listOf(
        "null:copy,cut",
        "Share:mail",
        "null:paste",
        "null:delete",
        "View:grid,list",
      ),
      groups.map { group -> "${group.title}:${group.items.joinToString(",") { it.id }}" },
    )
    // Keys are stable and distinct, so Compose keeps each group's state with it.
    assertEquals(groups.size, groups.map { it.key }.toSet().size)
  }
}
