package com.margelo.nitro.nitroui

import android.text.InputType
import org.junit.Assert.assertEquals
import org.junit.Test

class KeyboardNamesTest {

  @Test
  fun everyEditorInfoPatternDecodesToTheSpellingThatProducedIt() {
    val cases =
      listOf(
        "default" to (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT),
        "number-pad" to InputType.TYPE_CLASS_NUMBER,
        "decimal-pad" to
          (InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL),
        "phone-pad" to InputType.TYPE_CLASS_PHONE,
        "email-address" to
          (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS),
        "url" to (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI),
        // A secure number pad is still a number pad.
        "number-pad" to
          (InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD),
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
   * The class must be decoded first: `TYPE_NUMBER_VARIATION_PASSWORD` has the same bits as
   * `TYPE_TEXT_VARIATION_URI`, and `TYPE_NUMBER_FLAG_DECIMAL` as `TYPE_TEXT_FLAG_CAP_WORDS`.
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
    // `"numeric"` and `"decimal-pad"` are one Compose keyboard, so both read back as
    // `decimal-pad`.
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
   * Compose sets `TYPE_TEXT_FLAG_AUTO_CORRECT` when the field asked for autocorrect and writes
   * nothing when it did not; it never writes `NO_SUGGESTIONS`.
   */
  @Test
  fun autocorrectIsTheFlagTheFieldAskedFor() {
    val text = InputType.TYPE_CLASS_TEXT
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

  /** `"numeric"` has no Compose keyboard of its own, so it is not in this table. */
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
