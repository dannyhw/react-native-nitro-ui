package com.margelo.nitro.nitroui.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.ref.WeakReference
import java.lang.reflect.Modifier

class NitroUiWeakKeyTest {
  /** Reflection rather than a GC loop, because it cannot be flaky. */
  @Test
  fun keyHoldsNothingButAWeakReference() {
    val fields =
      WeakKey::class.java.declaredFields.filter {
        // The Compose compiler adds a static `$stable` field; only instance state counts.
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

  /** Retries a bounded number of times because `System.gc()` is only a hint. */
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
