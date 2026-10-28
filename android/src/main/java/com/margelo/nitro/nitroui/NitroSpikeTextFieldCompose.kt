package com.margelo.nitro.nitroui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldBuffer
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.sp

/*
 * T18 spike — the Android arm: `BasicTextField(TextFieldState)`, the API Q2 §5.2 names as the migration
 * (`TextFieldValue` is deprecated there). Spike-only; `src/spike/TextField/TextField.nitro.ts` explains why
 * this lives in the library tree at all. Delete these spike files with the spike.
 *
 * Every symbol here is pinned against the artifact this repo resolves (`compose-bom:2026.06.01` ->
 * foundation 1.11.4) by reading the `.aar` with `javap`, not from memory. That is worth more than it sounds,
 * because three things people remember from `TextFieldValue` are not true of this overload, and one thing
 * the migration docs describe is not what the code does:
 *
 *  1. No `onCommit`, no `singleLine`, no `maxLines`, no `maxLength`. The return key is `onKeyboardAction`,
 *     the line cap is `TextFieldLineLimits`, the length cap is an `InputTransformation` you write, and
 *     `onTextLayout` is `Density.(Function0<TextLayoutResult?>) -> Unit` — the result is *lazy* and
 *     *nullable*, so a configuration that never reads a layout never pays for one.
 *  2. `TextRange.None` does not exist in 1.11.4: the companion gained `TextRange.Zero`. The composition test
 *     here uses `composition.length > 0`, which is true on both spellings and does not encode a rename.
 *  3. **`InputTransformation.maxLength(n)` does not truncate — it reverts.** `MaxLengthFilter.transformInput`
 *     is `if (buffer.length > maxLength) buffer.revertAllChanges()`, so the built-in cap *refuses an edit
 *     that would overflow* rather than trimming it, which is a different user-visible behaviour from RN's
 *     `maxLength` (type-to-the-cap then stop adding) and from what the KDoc reads like. The spike therefore
 *     writes its own truncating filter and reports the difference; a shipped TextField has to choose.
 *  4. `TextFieldState.text`, `.selection` and `.composition` are readable snapshot state, which is what
 *     makes Q2 §2.2's "never paint over composing text" decidable here at all. The SwiftUI arm has no
 *     equivalent access — that asymmetry is a P1 finding, not an omission in this file.
 */

/**
 * Bit layout of `keyboardHints` — the same bits as `src/spike/TextField/keyboard.ts` and
 * `ios/spike/HybridNitroUiSpikeTextField.swift`. Three files, one layout, nothing generated keeping them in
 * sync, which is itself part of what the spike prices (a shipped API takes strings and maps them once per
 * platform instead).
 */
internal object NitroSpikeHints {
  const val TYPE_NUMBER = 2
  const val TYPE_PHONE = 4
  const val TYPE_EMAIL = 8
  const val TYPE_URL = 16
  const val RETURN_DONE = 256
  const val RETURN_NEXT = 512
  const val SUBMITS = 1024
  const val CAP_WORDS = 4096
  const val CAP_SENTENCES = 8192
  const val CAP_CHARACTERS = 16384
  const val NO_CORRECT = 65536
  const val SECURE = 131072
}

private fun spikeKeyboardOptions(hints: Double, multiline: Boolean): KeyboardOptions {
  val h = hints.toInt()
  val type = when {
    h and NitroSpikeHints.TYPE_NUMBER != 0 -> KeyboardType.Number
    h and NitroSpikeHints.TYPE_PHONE != 0 -> KeyboardType.Phone
    h and NitroSpikeHints.TYPE_EMAIL != 0 -> KeyboardType.Email
    h and NitroSpikeHints.TYPE_URL != 0 -> KeyboardType.Uri
    h and NitroSpikeHints.SECURE != 0 -> KeyboardType.Password
    else -> KeyboardType.Text
  }
  return KeyboardOptions(
    capitalization = when {
      h and NitroSpikeHints.NO_CORRECT != 0 -> KeyboardCapitalization.None
      h and NitroSpikeHints.CAP_WORDS != 0 -> KeyboardCapitalization.Words
      h and NitroSpikeHints.CAP_CHARACTERS != 0 -> KeyboardCapitalization.Characters
      else -> KeyboardCapitalization.Sentences
    },
    autoCorrect = h and NitroSpikeHints.NO_CORRECT == 0,
    keyboardType = type,
    // Multiline wins over the return-key bits: a non-`Default` action on a multiline field stops Return
    // inserting a newline, which is the classic wrong combination. RN core resolves it the same way.
    imeAction = when {
      multiline -> ImeAction.Default
      h and NitroSpikeHints.RETURN_DONE != 0 -> ImeAction.Done
      h and NitroSpikeHints.RETURN_NEXT != 0 -> ImeAction.Next
      h and NitroSpikeHints.SUBMITS != 0 -> ImeAction.Go
      else -> ImeAction.Default
    }
  )
}

/**
 * The field's text style, built once.
 *
 * A field's height is its font's line height, so this is the number P4's auto-grow curve is divided by. It
 * has to be a constant the report can name, not `LocalTextStyle`'s, which is whatever the app's theme says.
 */
private val SpikeTextStyle = TextStyle(
  fontSize = 16.sp,
  fontWeight = FontWeight.Normal,
)

/**
 * Composes the spike's Android field.
 *
 * [onMirror] publishes the cached mirror line — the *only* thing the test side reads, because reading a
 * Compose value from the JS thread would be a sync hop to main (`docs/architecture/core.md` §5).
 */
@Composable
internal fun NitroSpikeAndroidField(
  model: SpikeTextFieldModel,
  onMirror: (String) -> Unit
) {
  val multiline = model.multiline
  val maxLines = (model.maxLines ?: 5).coerceAtLeast(1)
  val textColor = MaterialTheme.colorScheme.onSurface
  val style = remember(textColor) { SpikeTextStyle.copy(color = textColor) }
  val cursorBrush = remember(textColor) { SolidColor(textColor) }
  val limit = model.maxLength
  val inputTransformation = remember(limit) { SpikeCodePointLimit(limit) }
  val focusRequester = remember { FocusRequester() }

  val initial = when {
    model.state.js != null -> model.state.js!!
    model.defaultValue != null -> model.defaultValue!!
    else -> ""
  }
  // `lastEmitted` is seeded with the text the control is *built* with: `snapshotFlow` emits once when
  // collection starts, and counting that emission as a user edit would put `nativeEvents` ahead of
  // `jsEvents` before anyone has typed — which makes the first controlled write React sends look stale and
  // get dropped. A field that did that fails exactly one assertion and passes everything else.
  val state = remember { TextFieldState(initial).also { model.lastEmitted = initial } }

  // ---- the mirror and the emit --------------------------------------------------------------------
  // Renders the mirror from the live state. Both callers are on the UI thread, which is the only place the
  // state may be read.
  val publishMirror = {
    onMirror(
      model.mirrorLine(
        text = state.text.toString(),
        // `composition` is nullable in 1.11.4 (`TextRange?`), and 1.11.4 renamed `TextRange.None` to
        // `TextRange.Zero` — so length is the robust test and it survives the rename either way.
        composing = (state.composition?.length ?: 0) > 0,
        selectionStart = state.selection.min,
        selectionLength = state.selection.max - state.selection.min
      )
    )
  }

  // `snapshotFlow`, not the `onTextLayout` lambda: that lambda runs *inside* the layout pass, and emitting a
  // JS event from a layout pass is a re-entrant render. `text`, `selection` and `composition` are all
  // snapshot state, so this sees every edit — including one the IME made without coming through here.
  // The mirror renderer, installed for the lifetime of the composable so the model can publish *before* it
  // fires a callback (`SpikeTextFieldModel.renderMirror`). Cleared on dispose, because a recycled host keeps
  // its model and a stale closure would capture a `TextFieldState` that no longer exists.
  DisposableEffect(model) {
    model.renderMirror = publishMirror
    onDispose { model.renderMirror = null }
  }

  LaunchedEffect(state, model) {
    snapshotFlow {
      SpikeTextSnapshot(
        text = state.text.toString(),
        composing = (state.composition?.length ?: 0) > 0,
        selectionStart = state.selection.min,
        selectionLength = state.selection.max - state.selection.min,
        // Focus is part of what this observes — see `SpikeTextFieldModel.focused`. Without it a bare tap
        // changes no text and republishes nothing, and the mirror keeps asserting `focused=0` after the
        // field has focus.
        focused = model.focused
      )
    }.collect { snapshot ->
      publishMirror()
      model.userEdited(snapshot.text)
    }
  }

  // ---- programmatic writes: the handshake decided, `edit {}` applies ------------------------------
  // `afterUpdate()` reconciled a React write into `writeTick` / `writeText`; here it becomes an edit. Not
  // during composition — `TextFieldState` is not written from a compose pass — which costs a frame that
  // iOS's synchronous `textField.text = …` does not: a real difference between the arms, and the kind of
  // thing P1's table is for.
  LaunchedEffect(model.writeTick) {
    if (model.writeTick == 0) {
      return@LaunchedEffect
    }
    val wanted = model.writeText
    val current = state.text.toString()
    val outcome = when {
      current == wanted -> "same"
      // Q2 §2.4: mid-composition a write is *dropped*, not applied. Composing text belongs to the user.
      (state.composition?.length ?: 0) > 0 -> "composing"
      else -> {
        state.edit {
          replace(0, length, wanted)
          if (length > 0) {
            placeCursorAfterCharAt(length - 1)
          }
        }
        "applied"
      }
    }
    model.lastWrite = outcome
    // Published here rather than left to the `snapshotFlow` collect so the mirror and the outcome move
    // together: an assertion that reads `lastWrite=applied` should never see the pre-write text in the same
    // line.
    publishMirror()
  }

  // `focus()` / `blur()` arrive as ticks, so a call that lands before this composable is attached cannot
  // crash the host (`FocusRequester.requestFocus()` throws when there is no focus owner yet).
  var seenFocusTick by remember { mutableIntStateOf(0) }
  var seenBlurTick by remember { mutableIntStateOf(0) }
  LaunchedEffect(model.focusTick) {
    if (model.focusTick != seenFocusTick) {
      seenFocusTick = model.focusTick
      try {
        focusRequester.requestFocus()
      } catch (_: Throwable) {
        // Not attached yet. The mirror records the miss; the host does not crash.
      }
    }
  }
  LaunchedEffect(model.blurTick) {
    if (model.blurTick != seenBlurTick) {
      seenBlurTick = model.blurTick
      model.clearFocus()
    }
  }

  BasicTextField(
    state = state,
    modifier = Modifier
      // A field is a `fillWidth` control: the box owns the width, the content owns the height
      // (`docs/architecture/sizing.md` §5). Without this it measures its preferred width.
      .fillMaxWidth()
      // `accessibilityLabel` goes on the control's own semantics node, the way `HybridNitroUiButton.kt:381`
      // does it — and the real-input runner needs it there for a reason beyond TalkBack: `adb shell input
      // text` has no target argument, so the only way to aim the keystrokes at this field is to tap the node
      // that carries the label. A field that published no label would leave the typing oracle with nothing
      // to tap, which is the opposite of a green test.
      .then(
        model.accessibilityLabel?.let { label ->
          Modifier.semantics { contentDescription = label }
        } ?: Modifier
      )
      .focusRequester(focusRequester)
      .onFocusChanged { s -> model.focusMoved(s.isFocused) },
    enabled = !model.disabled,
    readOnly = false,
    inputTransformation = inputTransformation,
    textStyle = style,
    cursorBrush = cursorBrush,
    keyboardOptions = spikeKeyboardOptions(model.keyboardHints, multiline),
    onKeyboardAction = { model.emitSubmit() },
    lineLimits = when {
      multiline -> TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = maxLines)
      else -> TextFieldLineLimits.SingleLine
    },
    onTextLayout = { textLayout ->
      // The only place a line count exists on this platform, and P4's auto-grow curve reads it. The result
      // is lazy and nullable; forcing it is the whole point of the callback. Guarded on a change so a
      // re-layout at the same count does not schedule a recomposition of the field.
      val lines = textLayout()?.lineCount ?: model.lines
      if (lines != model.lines) {
        model.lines = lines
      }
    }
  )
}

/** What one `snapshotFlow` emission saw. A value type: `snapshotFlow` distinct-compares what it produced. */
private data class SpikeTextSnapshot(
  val text: String,
  val composing: Boolean,
  val selectionStart: Int,
  val selectionLength: Int,
  val focused: Boolean
)

/**
 * The `maxLength` rule, truncated rather than refused, and capped on **code points**.
 *
 * Two decisions in six lines, both of them the reason this type exists instead of the built-in:
 *
 * * `InputTransformation.maxLength(n)` is `if (length > n) revertAllChanges()` — it *drops the edit*. RN's
 *   `maxLength` and both iOS arms here *trim*, so adopting the built-in would make Android answer a
 *   paste-that's-too-long differently from iOS. The spike keeps the platforms comparable and reports the
 *   option; a shipped TextField has to choose one and write it down.
 * * Trimming on a UTF-16 unit boundary splits an emoji into a lone surrogate, which then reaches
 *   `onValueChange` as text JS cannot re-encode — RN core hits exactly that (`RCTTextInputComponentView
 *   .mm:469-485`). So the cut walks to a code-point boundary. [spikeTruncateUnits] is what a unit-based cut
 *   *would* have kept, and Q2 §2.4 is a claim about the difference between the two.
 */
internal class SpikeCodePointLimit(private val maxLength: Int?) : InputTransformation {
  // The interface member is an *extension* on the buffer being edited, not a method that takes it — which
  // is why the built-in reads like `with(buffer) { if (length > maxLength) revertAllChanges() }`.
  override fun TextFieldBuffer.transformInput() {
    val limit = maxLength ?: return
    if (limit <= 0 || length <= limit) {
      return
    }
    val keep = spikeCodePointEnd(this, limit)
    if (keep < length) {
      replace(keep, length, "")
    }
    if (selection.max > keep) {
      placeCursorBeforeCharAt(keep.coerceAtMost(length))
    }
  }

  override fun equals(other: Any?): Boolean =
    other is SpikeCodePointLimit && other.maxLength == maxLength

  override fun hashCode(): Int = maxLength?.hashCode() ?: 0
}

/** The UTF-16 offset at which the first [limit] code points of [buffer] end. */
private fun spikeCodePointEnd(buffer: TextFieldBuffer, limit: Int): Int {
  var count = 0
  var i = 0
  while (i < buffer.length) {
    if (count >= limit) {
      return i
    }
    i += if (buffer.charAt(i).isHighSurrogate() && i + 1 < buffer.length) 2 else 1
    count += 1
  }
  return buffer.length
}

/**
 * "Is it already this text?" — deliberately plain Kotlin `==`, called out because it is a cross-platform
 * difference rather than a detail.
 *
 * Kotlin compares `String` as a UTF-16 sequence, which is what JavaScript's `===` does; Swift's `==` is
 * *canonical* equivalence instead. So `"é"` spelled as `e` + U+0301 equals the precomposed form on iOS's
 * comparison and does not here, which means the two arms can answer "did my write apply?" differently for
 * the same user action. P3 measures both answers; a shipped component has to pick one rule and name it.
 */
internal fun spikeSame(a: String, b: String): Boolean = a == b

/** Code points, counted the way JS counts them (`[...str].length`). */
internal fun spikeCodePoints(text: String): Int = text.codePointCount(0, text.length)

/** What a UTF-16-unit truncation would have kept — the comparison, not the rule. */
internal fun spikeTruncateUnits(text: String, maxLength: Int?): String {
  val limit = maxLength ?: return text
  if (limit <= 0 || text.length <= limit) {
    return text
  }
  return text.substring(0, limit)
}
