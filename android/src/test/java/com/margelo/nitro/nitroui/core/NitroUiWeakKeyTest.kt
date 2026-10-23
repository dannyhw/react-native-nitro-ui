package com.margelo.nitro.nitroui.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.ref.WeakReference
import java.lang.reflect.Modifier

/**
 * JVM unit test for the key of the process-wide colour-scheme cache
 * (`docs/architecture/core.md` §3, "Shared objects"), run by
 * `bun run test:native:android`.
 *
 * `NitroUiColorSchemes` is a process-wide `object`, and its key is the `Context`
 * the colours were read from - RN's `ThemedReactContext`, whose base context is
 * the `Activity`. Keyed strongly, that static is a path to a destroyed Activity
 * and its whole view hierarchy, held until some later control happens to compose
 * against a different context. [WeakKey] is the seam that makes the retention
 * rule testable off-device: it stands in for the context with an ordinary object,
 * so the JVM can check what the cache keeps alive without an Android framework.
 * The `ColorScheme` itself needs no such care - it holds colour longs only - which
 * is why the value side of the entry stays strong.
 */
class NitroUiWeakKeyTest {
  /**
   * The structural half: the entry may not hold the key at all except through a
   * `WeakReference`. Reflection rather than a GC loop, because it cannot be flaky
   * and it fails for the right reason - a field of the referent's type is the
   * leak, whatever the collector happens to do on this JVM today.
   */
  @Test
  fun keyHoldsNothingButAWeakReference() {
    val fields =
      WeakKey::class.java.declaredFields.filter {
        // The Compose compiler instruments the class with a static `$stable`
        // int; neither is a reference the cache holds. Only instance state
        // counts as retention.
        !Modifier.isStatic(it.modifiers) && !it.name.startsWith("$")
      }
    assertTrue("the key holds a reference", fields.isNotEmpty())
    for (field in fields) {
      assertFalse(
        "the cached key must be reached only through a WeakReference, but ${WeakKey::class.java.simpleName}.${field.name} is a ${field.type.name}",
        field.type == Any::class.java || field.type.name.startsWith("com.margelo."),
      )
      assertTrue(
        "the only field of the key should be the reference itself, found ${field.type.name}",
        WeakReference::class.java.isAssignableFrom(field.type),
      )
    }
  }

  /** Identity, not equality: two equal contexts can be themed differently. */
  @Test
  fun keyMatchesTheAliveInstanceOnly() {
    val held = Any()
    val other = Any()
    val key = WeakKey(held)
    assertTrue("the live context hits", key.matches(held))
    assertFalse("a different context of the same shape misses", key.matches(other))
    assertNotNull("and the entry can still read it", key.held)
    assertTrue(
      "a second key built from another instance does not match the first",
      WeakKey(other).matches(other),
    )
    assertFalse(
      "and it is not interchangeable with the key already cached",
      WeakKey(other).matches(held),
    )
  }

  /**
   * The behavioural half: once nothing else points at the key, the entry does
   * not, so a destroyed activity becomes collectable. Bounded retry because
   * `System.gc()` is only a hint; a strong field in [WeakKey] makes every
   * iteration keep finding a referent and the test goes red.
   */
  @Test
  fun droppedContextBecomesCollectable() {
    var context: Any? = Any()
    val observer = WeakReference(context)
    val key = WeakKey(context!!)
    assertTrue("the live key matches first", key.matches(context!!))
    context = null

    var collected = false
    repeat(20) {
      if (!collected) {
        System.gc()
        try {
          Thread.sleep(20)
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
        }
        collected = observer.get() == null
      }
    }
    assertTrue(
      "the cached key must not keep its context alive once the app has let it go",
      collected,
    )
    assertNull("and a collected entry has nothing left to hand out", key.held)
    assertFalse("which reads as a cache miss, not a wrong answer", key.matches(Any()))
  }
}
