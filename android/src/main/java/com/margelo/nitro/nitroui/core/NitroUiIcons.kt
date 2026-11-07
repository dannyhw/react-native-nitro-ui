package com.margelo.nitro.nitroui.core

import android.content.Context
import androidx.annotation.DrawableRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.vectorResource
import java.util.concurrent.ConcurrentHashMap

/*
 * The library's own icons (D43 item 1).
 *
 * Every glyph the library draws itself is one of Google's Material Symbols Android
 * vector drawables, shipped unchanged as a `nitroui_*` resource in
 * `android/src/main/res/drawable/` by `scripts/icons/fetch-material-symbols.mjs`, and
 * hash-checked at `check` time (`scripts/__tests__/android-icons.test.js`). None is
 * typed out here as a path: SearchField 0.7.0 shipped a mistyped copy of Material's
 * search path that drew a key, and the same test now fails on any hand-built
 * `ImageVector` in `android/src/main`.
 */

/**
 * The parsed drawables, once per process.
 *
 * A hosted control is its own composition, and `remember` (or Compose's own
 * per-view vector cache behind `ImageVector.vectorResource` in a composable) cannot
 * share anything between two of them (`docs/architecture/core.md`, "Shared
 * objects"), so a screen of fifty chips would otherwise parse the same check fifty
 * times. The parsed [ImageVector] keeps no reference to the context that parsed it:
 * the theme is only needed to read the file's `?attr/colorControlNormal` tint, which
 * [androidx.compose.material3.Icon] replaces with the content colour when it draws.
 */
internal object NitroUiIcons {
  private val vectors = ConcurrentHashMap<Int, ImageVector>()

  /** The vector for [id], parsed on its first use in this process. */
  fun vector(
    context: Context,
    @DrawableRes id: Int,
  ): ImageVector =
    vectors.getOrPut(id) { ImageVector.vectorResource(context.theme, context.resources, id) }
}

/** [NitroUiIcons.vector] from a composable. */
@Composable
internal fun nitroUiIcon(
  @DrawableRes id: Int
): ImageVector = NitroUiIcons.vector(LocalContext.current, id)
