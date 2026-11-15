package com.margelo.nitro.nitroui

import org.junit.Assert.assertEquals
import org.junit.Test

// An IME composition cannot be held open from a test, on the JVM or on a device, so
// `observe` takes the composing flag as an argument. Gboard composes every Latin word.
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
    // Writing into an open composition would close it and drop the IME's undo state.
    assertEquals("hello", h.text)
    assertEquals(listOf("h#1", "he#2", "hel#3", "hell#4", "hello#5"), h.events)
    h.type("hello", composing = false)
    assertEquals("hel", h.text)
    assertEquals(listOf("h#1", "he#2", "hel#3", "hell#4", "hello#5", "hel#6"), h.events)
  }

  @Test
  fun theBackstopWaitsForAnOpenComposition() {
    val h = Harness()
    h.model.maxLength = 5
    h.type("hell", composing = true)
    h.type("hello", composing = true)
    h.type("hello\u306A", composing = true)
    assertEquals("hello\u306A", h.text)
    assertEquals(listOf("hell#1", "hello#2", "hello\u306A#3"), h.events)
    h.type("hello\u306A", composing = false)
    assertEquals("hello", h.text)
    assertEquals(listOf("hell#1", "hello#2", "hello\u306A#3", "hello#4"), h.events)
    h.type("hello", composing = false)
    assertEquals(4, h.model.state.nativeEvents)
  }

  @Test
  fun aCompositionThatEndsUnderTheCapIsLeftAlone() {
    val h = Harness()
    h.model.maxLength = 5
    h.type("hello\u306A", composing = true)
    h.type("hello", composing = false)
    assertEquals("hello", h.text)
    assertEquals(listOf("hello\u306A#1", "hello#2"), h.events)
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
