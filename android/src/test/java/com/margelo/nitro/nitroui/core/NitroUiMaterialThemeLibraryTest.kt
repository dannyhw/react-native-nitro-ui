package com.margelo.nitro.nitroui.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.PrintStream
import java.util.zip.ZipFile

/**
 * JVM unit test for the claim [NitroUiTheme] rests on, run by
 * `bun run test:native:android`.
 *
 * The opt-out to the baseline theme is one `MaterialExpressiveTheme` call with
 * `MotionScheme.standard()`, `Shapes()` and `Typography()` (X18 fix round 1: a second call
 * site would rebuild every control's composition on a switch). That is the baseline theme
 * while the internal `LocalUsingExpressiveTheme` - the one thing `MaterialExpressiveTheme`
 * provides that a root `MaterialTheme` does not - is consulted by nothing but
 * `MaterialExpressiveTheme` itself (to tell a nested call from a root one).
 *
 * What this checks, against the material3 library on the test classpath:
 * 1. exactly one class refers to the flag, `MaterialThemeKt` (`MaterialTheme.kt`'s file
 *    class) - a component that read it would have to name it in its own class;
 * 2. inside that class, only [ALLOWED_METHODS] touch it: `MaterialExpressiveTheme`, the
 *    flag's own accessor, and the static initializer that creates it. A `MaterialTheme`
 *    overload or anything else in that file that started reading it fails here.
 *
 * What it does not catch: a component that changes behaviour under a theme without
 * reading this flag - by reading the motion scheme, say, which is the difference the
 * opt-out is meant to make. Material's own release notes are the check for anything else.
 *
 * Either failure names what reads the flag, and then the opt-out is no longer "the same
 * theme with standard motion": `NitroUiTheme` needs another look before the version moves.
 */
class NitroUiMaterialThemeLibraryTest {
  @Test
  fun onlyMaterialExpressiveThemeReadsTheExpressiveFlag() {
    val library = libraryLocation()
    val classes = classesReferring(library, NEEDLE)
    println("$NEEDLE is referred to by: $classes")
    assertEquals(
      "material3 classes other than MaterialThemeKt refer to $NEEDLE, so the baseline opt-out " +
        "(MaterialExpressiveTheme + MotionScheme.standard()) is no longer the baseline theme - see NitroUiTheme",
      listOf(THEME_FILE_CLASS),
      classes,
    )

    val methods = methodsTouching(library, THEME_FILE_CLASS, NEEDLE)
    println("$NEEDLE is touched in MaterialThemeKt by: $methods")
    assertTrue(
      "the javap scan found no method touching $NEEDLE, so it is not reading the class it should",
      methods.contains("MaterialExpressiveTheme"),
    )
    assertEquals(
      "methods of MaterialThemeKt other than ${ALLOWED_METHODS.sorted()} touch $NEEDLE - see NitroUiTheme",
      emptyList<String>(),
      (methods - ALLOWED_METHODS).sorted(),
    )
  }

  /** The jar (or class directory) the material3 library was loaded from. */
  private fun libraryLocation(): File {
    val location =
      checkNotNull(Class.forName("androidx.compose.material3.MaterialThemeKt").protectionDomain?.codeSource?.location) {
        "no code source for material3's MaterialThemeKt"
      }
    return File(location.toURI())
  }

  /** Every class file in [library] whose bytes contain [needle], as `a/b/C.class`. */
  private fun classesReferring(
    library: File,
    needle: String,
  ): List<String> {
    val bytes = needle.toByteArray(Charsets.UTF_8)
    val found = mutableListOf<String>()
    forEachClass(library) { name, content -> if (contains(content, bytes)) found += name }
    return found.sorted()
  }

  /**
   * The methods of [className] whose bytecode mentions [needle], by `javap -c -p`: a
   * field access or a call is printed with the member's name in its comment, under the
   * method that makes it. The static initializer is `<clinit>`.
   */
  private fun methodsTouching(
    library: File,
    className: String,
    needle: String,
  ): Set<String> {
    var classBytes: ByteArray? = null
    forEachClass(library) { name, content -> if (name == className) classBytes = content }
    val file = File.createTempFile("MaterialThemeKt", ".class")
    try {
      file.writeBytes(checkNotNull(classBytes) { "$className is not in $library" })
      val out = ByteArrayOutputStream()
      val err = ByteArrayOutputStream()
      val status = runJavap(PrintStream(out), PrintStream(err), arrayOf("-c", "-p", file.absolutePath))
      assertEquals("javap failed: $err", 0, status)
      val touching = mutableSetOf<String>()
      var method: String? = null
      for (line in out.toString(Charsets.UTF_8).lines()) {
        val indent = line.length - line.trimStart().length
        if (indent == 2) {
          val trimmed = line.trim()
          method =
            when {
              trimmed == "static {};" -> "<clinit>"
              trimmed.contains('(') -> trimmed.substringBefore('(').substringAfterLast(' ')
              else -> null
            }
        } else if (indent > 2 && method != null && line.contains(needle)) {
          touching += method
        }
      }
      return touching
    } finally {
      file.delete()
    }
  }

  /**
   * The JDK's in-process `javap` (`java.util.spi.ToolProvider`). Reached by reflection:
   * these tests compile against `android.jar`, which has no `ToolProvider`, but they run
   * on the JDK that builds the app, which has.
   */
  private fun runJavap(
    out: PrintStream,
    err: PrintStream,
    args: Array<String>,
  ): Int {
    val toolProvider = Class.forName("java.util.spi.ToolProvider")
    val found = toolProvider.getMethod("findFirst", String::class.java).invoke(null, "javap") as java.util.Optional<*>
    val javap = found.orElse(null) ?: throw AssertionError("no javap in this JDK - the scan cannot run")
    val run = toolProvider.getMethod("run", PrintStream::class.java, PrintStream::class.java, Array<String>::class.java)
    return run.invoke(javap, out, err, args) as Int
  }

  private fun forEachClass(
    library: File,
    visit: (String, ByteArray) -> Unit,
  ) {
    if (library.isDirectory) {
      library.walkTopDown().filter { it.isFile && it.name.endsWith(".class") }.forEach { file ->
        visit(file.relativeTo(library).invariantSeparatorsPath, file.readBytes())
      }
    } else {
      ZipFile(library).use { zip ->
        for (entry in zip.entries()) {
          if (!entry.name.endsWith(".class")) continue
          visit(entry.name, zip.getInputStream(entry).use { it.readBytes() })
        }
      }
    }
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
    const val NEEDLE = "LocalUsingExpressiveTheme"

    /** `MaterialTheme.kt`'s file class: the theme functions and the flag. */
    const val THEME_FILE_CLASS = "androidx/compose/material3/MaterialThemeKt.class"

    /** The reader, the flag's accessor, and the static initializer that creates it. */
    val ALLOWED_METHODS = setOf("MaterialExpressiveTheme", "getLocalUsingExpressiveTheme", "<clinit>")
  }
}
