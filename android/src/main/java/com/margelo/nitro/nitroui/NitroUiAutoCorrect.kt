package com.margelo.nitro.nitroui

import androidx.compose.ui.platform.PlatformTextInputInterceptor
import androidx.compose.ui.platform.PlatformTextInputMethodRequest
import androidx.compose.ui.platform.PlatformTextInputSession

/**
 * Compose reads `autoCorrectEnabled = false` as "send no `TYPE_TEXT_FLAG_AUTO_CORRECT`" and stops
 * there, which leaves the keyboard offering suggestions. This decorates the request the field hands
 * the IME, so the `EditorInfo` carries what [nuiApplyAutoCorrect] asks for as well. `TextField` and
 * `SearchField` wrap their field in it.
 *
 * The flag is read from the model as the connection is built, so a change to `autoCorrect` needs no
 * new interceptor - Compose restarts the input session on the changed options, and the same
 * interceptor answers the new request.
 *
 * A secure field is the exception: it is sent `autoCorrectEnabled = false` whether the prop is on
 * or off, so its options never change, no session restarts, and the flag reaches that keyboard
 * when the field is next focused.
 */
internal class NitroUiAutoCorrectInterceptor(private val model: TextFieldModel) :
  PlatformTextInputInterceptor {
  override suspend fun interceptStartInputMethod(
    request: PlatformTextInputMethodRequest,
    nextHandler: PlatformTextInputSession,
  ): Nothing =
    nextHandler.startInputMethod { outAttributes ->
      val connection = request.createInputConnection(outAttributes)
      outAttributes.inputType = nuiApplyAutoCorrect(outAttributes.inputType, model.autoCorrect)
      connection
    }
}
