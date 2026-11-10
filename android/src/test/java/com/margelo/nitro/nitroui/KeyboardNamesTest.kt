package com.margelo.nitro.nitroui

import android.text.InputType
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * JVM unit test for the keyboard read-back (`NitroUiKeyboardNames`) and for the rule
 * that the prop mapping and the read-back are two halves of one table.
 *
 * `SearchField`'s test state reports the keyboard the field was *configured with*, and
 * while the field is focused it reads it out of the `EditorInfo` the IME is handed
 * (`HybridNitroUiSearchField.currentEditorInfo`). An `EditorInfo` cannot be built on the
 * JVM, but its `inputType` is a plain `Int` made of `android.text.InputType` constants,
 * which are compile-time values — so the decoding half runs here against the bit
 * patterns the platform documents, and only the "does the field really hold these bits"
 * half needs a device (`SearchField.harness.tsx`).
 *
 * The second half of the file is the drift guard: for every `keyboardType` spelling the
 * wrapper can send, the Compose keyboard the mapping picks and the decoded name must
 * agree, so a mapping that starts to send `"url"` as a text keyboard is caught without
 * anybody having to read a keyboard off a screen.
 */
class KeyboardNamesTest {

  @Test
  fun everyEditorInfoPatternDecodesToTheSpellingThatProducedIt() {
    val cases =
      listOf(
        // The default: a text keyboard that asks for autocorrection.
        "default" to (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT),
        "number-pad" to InputType.TYPE_CLASS_NUMBER,
        "decimal-pad" to
          (InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL),
        "phone-pad" to InputType.TYPE_CLASS_PHONE,
        "email-address" to
          (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS),
        "url" to (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI),
        // A secure number pad is still a number pad, as text-field.md says.
        "number-pad" to
          (InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD),
        // A keyboard UIKit has a name for and Compose spells as text.
        "default" to InputType.TYPE_CLASS_TEXT,
      )
    for ((expected, inputType) in cases) {
      assertEquals(
        "inputType 0x${Integer.toHexString(inputType)}",
        expected,
        NitroUiKeyboardNames.nameOfInputType(inputType),
      )
    }
  }

  /**
   * The two cases that only a class-first decoder gets right, spelled out because the
   * bit patterns are identical to a text keyboard's that means something else:
   * `TYPE_NUMBER_VARIATION_PASSWORD` is `TYPE_TEXT_VARIATION_URI`, and
   * `TYPE_NUMBER_FLAG_DECIMAL` is `TYPE_TEXT_FLAG_CAP_WORDS`.
   */
  @Test
  fun aNumberKeyboardDoesNotReadAsTheTextKeyboardWithTheSameBits() {
    val secureNumber =
      InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
    assertEquals("number-pad", NitroUiKeyboardNames.nameOfInputType(secureNumber))
    assertEquals("none", NitroUiKeyboardNames.nameOfCapitalization(secureNumber))
    val decimal =
      InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
    assertEquals("decimal-pad", NitroUiKeyboardNames.nameOfInputType(decimal))
    assertEquals("none", NitroUiKeyboardNames.nameOfCapitalization(decimal))
    // And the text keyboard with that same bit really is capitalised words.
    val words = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
    assertEquals("default", NitroUiKeyboardNames.nameOfInputType(words))
    assertEquals("words", NitroUiKeyboardNames.nameOfCapitalization(words))
  }

  @Test
  fun aDecimalKeyboardIsADecimalPadWhicheverSpellingAskedForIt() {
    // `"numeric"` and `"decimal-pad"` are one Compose keyboard (text-field.md's table),
    // so the read-back says `decimal-pad` for both. It is the same answer for two
    // spellings, not a lost prop: the pattern below is all either one can produce.
    val decimal = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
    assertEquals("decimal-pad", NitroUiKeyboardNames.nameOfInputType(decimal))
    assertEquals(
      NitroUiKeyboardNames.nameOfInputType(decimal),
      NitroUiKeyboardNames.nameOfKeyboardType(keyboardTypeOf("numeric", secure = false)),
    )
  }

  @Test
  fun capitalisationFlagsDecodeToTheSpellingThatSetThem() {
    val text = InputType.TYPE_CLASS_TEXT
    assertEquals("none", NitroUiKeyboardNames.nameOfCapitalization(text))
    assertEquals(
      "characters",
      NitroUiKeyboardNames.nameOfCapitalization(
        text or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS,
      ),
    )
    assertEquals(
      "words",
      NitroUiKeyboardNames.nameOfCapitalization(text or InputType.TYPE_TEXT_FLAG_CAP_WORDS),
    )
    assertEquals(
      "sentences",
      NitroUiKeyboardNames.nameOfCapitalization(
        text or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES,
      ),
    )
  }

  /**
   * Autocorrect, decoded from the flag Compose actually writes.
   *
   * The rule was first written the other way round — "only `NO_SUGGESTIONS` refuses it" —
   * because that is what an older Compose did. Reading 1.12.1's own `EditorInfo.update()`
   * out of the artifact says otherwise: it ORs `TYPE_TEXT_FLAG_AUTO_CORRECT` when the
   * field asked and writes *nothing* when it did not, and it never writes
   * `NO_SUGGESTIONS` at all. Under the old rule, `autoCorrect={false}` therefore read
   * back as `true`, which is the one thing a read-back must never do, and the
   * `text alone` case below is where that used to go the wrong way.
   */
  @Test
  fun autocorrectIsTheFlagTheFieldAskedFor() {
    val text = InputType.TYPE_CLASS_TEXT
    // The search field's default, and v1's: a text keyboard that asked for it.
    assertEquals(
      true,
      NitroUiKeyboardNames.autoCorrectOf(
        text or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT,
        asked = true,
      ),
    )
    // `autoCorrect={false}`: Compose writes no flag, and "no flag" is a refusal.
    assertEquals(false, NitroUiKeyboardNames.autoCorrectOf(text, asked = false))
    // Capitalisation does not answer for it: a sentences field that refused still has
    // no autocorrection flag.
    assertEquals(
      false,
      NitroUiKeyboardNames.autoCorrectOf(
        text or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES,
        asked = false,
      ),
    )
    // An outright refusal is a refusal whoever wrote it.
    assertEquals(
      false,
      NitroUiKeyboardNames.autoCorrectOf(
        text or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
          InputType.TYPE_TEXT_FLAG_AUTO_CORRECT,
        asked = true,
      ),
    )
    // A keyboard with no text class carries no flag either way, so the ask is the answer
    // — Compose writes these flags only inside `TYPE_CLASS_TEXT`.
    val number = InputType.TYPE_CLASS_NUMBER
    assertEquals(true, NitroUiKeyboardNames.autoCorrectOf(number, asked = true))
    assertEquals(false, NitroUiKeyboardNames.autoCorrectOf(number, asked = false))
  }

  /**
   * The drift guard: the name a prop sends, the Compose keyboard [keyboardTypeOf] picks
   * for it, and the name the read-back reports must be one answer. `"numeric"` is the
   * one spelling with no Compose keyboard of its own, so it is asserted with the case
   * above instead of here.
   */
  @Test
  fun theMappingAndTheReadBackAgreeOnEveryKeyboardSpelling() {
    val expected =
      mapOf(
        "default" to "default",
        "number-pad" to "number-pad",
        "decimal-pad" to "decimal-pad",
        "email-address" to "email-address",
        "phone-pad" to "phone-pad",
        "url" to "url",
        // A spelling the wrapper does not know arrives as the default, and reads back so.
        "visible-password" to "default",
      )
    for ((sent, readBack) in expected) {
      assertEquals(
        sent,
        readBack,
        NitroUiKeyboardNames.nameOfKeyboardType(keyboardTypeOf(sent, secure = false)),
      )
    }
  }

  @Test
  fun theMappingAndTheReadBackAgreeOnEveryCapitalisationSpelling() {
    val expected =
      mapOf(
        "none" to "none",
        "sentences" to "sentences",
        "words" to "words",
        "characters" to "characters",
        "nonsense" to "sentences",
      )
    for ((sent, readBack) in expected) {
      assertEquals(
        sent,
        readBack,
        NitroUiKeyboardNames.nameOfCapitalization(capitalizationOf(sent)),
      )
    }
  }
}
