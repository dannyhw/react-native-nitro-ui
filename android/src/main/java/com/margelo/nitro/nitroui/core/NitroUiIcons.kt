package com.margelo.nitro.nitroui.core

import android.content.Context
import androidx.annotation.DrawableRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.vectorResource
import java.util.concurrent.ConcurrentHashMap

/**
 * Parsed drawables, cached once per process because each hosted control is its own
 * composition and `remember` cannot share between them. A cached vector's intrinsic tint
 * comes from the first theme that parsed it, so always tint it (`Icon`, or a colour filter).
 */
internal object NitroUiIcons {
  private val vectors = ConcurrentHashMap<Int, ImageVector>()

  fun vector(
    context: Context,
    @DrawableRes id: Int,
  ): ImageVector =
    vectors.getOrPut(id) { ImageVector.vectorResource(context.theme, context.resources, id) }
}

@Composable
internal fun nitroUiIcon(
  @DrawableRes id: Int
): ImageVector = NitroUiIcons.vector(LocalContext.current, id)
