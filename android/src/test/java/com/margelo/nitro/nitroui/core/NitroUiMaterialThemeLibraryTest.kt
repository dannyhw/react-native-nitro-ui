package com.margelo.nitro.nitroui.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipFile

/**
 * JVM unit test for the claim [NitroUiTheme] rests on, run by
 * `bun run test:native:android`.
 *
 * The opt-out to the baseline theme is one `MaterialExpressiveTheme` call with
 * `MotionScheme.standard()` (X18 fix round 1). A second call site would rebuild every
 * control's composition on a switch. That is the baseline theme only while the internal
 * `LocalUsingExpressiveTheme` - the one thing `MaterialExpressiveTheme` sets that a root
 * `MaterialTheme` does not - is read by nothing but `MaterialExpressiveTheme` itself.
 *
 * In 1.5.0-beta02 that holds. Material says more of the Expressive look will hang off the
 * theme, and it would hang off that flag. So this reads the material3 library on the test
 * classpath and fails, naming the classes, the day any other class refers to it. Then
 * the opt-out is no longer "the same theme with standard motion", and `NitroUiTheme`
 * needs another look before the version moves.
 */
class NitroUiMaterialThemeLibraryTest {
  @Test
  fun onlyTheThemeFunctionsReadTheExpressiveFlag() {
    val readers = classesReferring("LocalUsingExpressiveTheme")
    println("LocalUsingExpressiveTheme is referred to by: $readers")
    assertTrue("the material3 library on the classpath has no LocalUsingExpressiveTheme at all", readers.isNotEmpty())
    val elsewhere = readers.filterNot { it.startsWith(THEME_FUNCTIONS) }
    assertEquals(
      "material3 classes other than the theme functions refer to LocalUsingExpressiveTheme, so the " +
        "baseline opt-out (MaterialExpressiveTheme + MotionScheme.standard()) is no longer the " +
        "baseline theme - see NitroUiTheme",
      emptyList<String>(),
      elsewhere,
    )
  }

  /** Every class file in the material3 library whose bytes contain [needle]. */
  private fun classesReferring(needle: String): List<String> {
    val location =
      checkNotNull(Class.forName("androidx.compose.material3.MaterialThemeKt").protectionDomain?.codeSource?.location) {
        "no code source for material3's MaterialThemeKt"
      }
    val source = File(location.toURI())
    val bytes = needle.toByteArray(Charsets.UTF_8)
    val found = mutableListOf<String>()
    if (source.isDirectory) {
      source.walkTopDown().filter { it.isFile && it.name.endsWith(".class") }.forEach { file ->
        if (contains(file.readBytes(), bytes)) found += file.relativeTo(source).invariantSeparatorsPath
      }
    } else {
      ZipFile(source).use { zip ->
        for (entry in zip.entries()) {
          if (!entry.name.endsWith(".class")) continue
          val content = zip.getInputStream(entry).use { it.readBytes() }
          if (contains(content, bytes)) found += entry.name
        }
      }
    }
    return found.sorted()
  }

  private fun contains(
    haystack: ByteArray,
    needle: ByteArray,
  ): Boolean {
    outer@ for (start in 0..haystack.size - needle.size) {
      for (offset in needle.indices) {
        if (haystack[start + offset] != needle[offset]) continue@outer
      }
      return true
    }
    return false
  }

  private companion object {
    /** `MaterialTheme.kt`'s file class: `MaterialTheme`, `MaterialExpressiveTheme` and the flag. */
    const val THEME_FUNCTIONS = "androidx/compose/material3/MaterialThemeKt"
  }
}
