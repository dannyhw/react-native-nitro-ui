package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * JVM unit test for what the Android TextField does with an edit, composing or not
 * (`TextFieldModel.observe`).
 *
 * The on-device suite cannot hold an IME composition open on the lease's emulator: a
 * composition opened through an `InputConnection` from outside the IME is committed
 * again before the app sees it (G13 report). Gboard, though, keeps every Latin word in
 * a composing region while autocorrect is on, so what the field does *during* a
 * composition is what most Android typing is. `observe` takes the composition flag as
 * an argument for exactly this test; the field passes `TextFieldState.composition`.
 */
class TextFieldModelTest {
  private class Harness {
    val model = TextFieldModel()
    val events = mutableListOf<String>()
    var settled = 0

    init {
      model.onChange = { text, count -> events.add("$text#${count.toInt()}") }
      model.settle = { settled += 1 }
    }

    /** The IME replaces the field's text with [text], and the field observes it. */
    fun type(text: String, composing: Boolean) {
      model.textState.edit { replace(0, length, text) }
      model.observe(model.textState.text.toString(), composing)
    }

    val text: String
      get() = model.textState.text.toString()
  }

  @Test
  fun everyStepOfACompositionIsReported() {
    val h = Harness()
    // Gboard with autocorrect on: one composing region that grows a key at a time.
    h.type("h", composing = true)
    h.type("he", composing = true)
    h.type("hel", composing = true)
    h.type("hello", composing = true)
    // Space commits the word: the text does not change, so nothing more is sent.
    h.type("hello", composing = false)
    assertEquals(listOf("h#1", "he#2", "hel#3", "hello#4"), h.events)
    assertEquals(4, h.model.state.nativeEvents)
  }

  @Test
  fun maxLengthHoldsInsideAComposition() {
    val h = Harness()
    h.model.maxLength = 3
    h.type("h", composing = true)
    h.type("he", composing = true)
    h.type("hel", composing = true)
    h.type("hell", composing = true)
    h.type("hello", composing = true)
    assertEquals("hel", h.text)
    assertEquals(listOf("h#1", "he#2", "hel#3"), h.events)
  }

  @Test
  fun theBackstopCutsAtAGraphemeBoundary() {
    val h = Harness()
    h.model.maxLength = 5
    h.type("abcd😀", composing = false)
    // Six units, and the cut at five would split the emoji's surrogate pair.
    assertEquals("abcd", h.text)
    assertEquals(listOf("abcd#1"), h.events)
  }

  @Test
  fun textAJsWritePutPastTheLimitIsNotCut() {
    val h = Harness()
    h.model.maxLength = 5
    // What `syncText` does for a JS write: the field holds it, and it is accounted for.
    h.model.textState.edit { replace(0, length, "abcdefgh") }
    h.model.accounted = "abcdefgh"
    h.model.observe(h.text, isComposing = false)
    assertEquals("abcdefgh", h.text)
    // A deletion from it is an edit like any other, and is not cut either.
    h.type("abcdefg", composing = false)
    assertEquals("abcdefg", h.text)
    assertEquals(listOf("abcdefg#1"), h.events)
  }

  @Test
  fun aWriteHeldBackByACompositionIsSettledWhenItEnds() {
    val h = Harness()
    h.type("abc", composing = false)
    h.type("abcか", composing = true)
    // `afterUpdate()` dropped a write while the composition was open.
    h.model.lastWrite = "composing"
    assertEquals(0, h.settled)
    // The user deletes the composition: the text is what native already counted, so
    // no edit is reported - and the held-back write still has to be decided.
    h.type("abc", composing = false)
    assertEquals(1, h.settled)
  }

  @Test
  fun nothingIsSettledWithoutAHeldBackWrite() {
    val h = Harness()
    h.type("abcか", composing = true)
    h.type("abcか", composing = false)
    assertEquals(0, h.settled)
  }

  @Test
  fun aResetForgetsAnOpenComposition() {
    val h = Harness()
    h.type("か", composing = true)
    h.model.reset()
    h.model.onChange = { text, count -> h.events.add("$text#${count.toInt()}") }
    h.model.settle = { h.settled += 1 }
    h.model.lastWrite = "composing"
    // A composition that was open on the previous owner is not this owner's to end.
    h.type("", composing = false)
    assertEquals(0, h.settled)
  }
}
