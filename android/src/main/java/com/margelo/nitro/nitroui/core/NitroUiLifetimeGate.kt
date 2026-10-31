package com.margelo.nitro.nitroui.core

/**
 * What one host object has been through, and the rule that follows from it.
 *
 * Pure logic with no Android types, which is why it is a class rather than four
 * fields on [NitroComposeHost]: the interesting part - "a dropped host must not
 * compose again, until it is recycled" - is a decision, and a decision made in a
 * `ViewGroup` can only be tested by a device run that happens to reach it. Here it
 * goes red on the JVM when the branch is deleted (`NitroUiLifetimeGateTest`), which is
 * what AGENTS.md asks for before a gate is trusted. The host calls [onDrop] and
 * [onRecycle] from its own teardown and reset, and asks [declineMeasure] and
 * [declineLayout] at the top of its measure and layout passes.
 *
 * ## Why the counters are per object and never reset
 *
 * [drops] and [recycles] answer a question about one object's lifetime: *did the pool
 * hand this exact instance back?* A per-mount flag cannot tell a reused instance from a
 * fresh one - both read the same - and that distinction is precisely what F6 had to
 * measure rather than infer. X4's report recorded "Android never reaches
 * `prepareForRecycle`" on the strength of reading RN's call graph; the bytecode says
 * otherwise for RN 0.88 (`ViewManager.onDropViewInstance` prepares and pushes a pooled
 * view whenever `enableViewRecycling` allocated the pool), and the only answer that
 * settles it is a counter that survives a recycle, read by a mount that could not have
 * written it.
 */
internal class NitroUiLifetimeGate {

  /** How many times [onDrop] has run: the number of mounts this object has finished. */
  var drops: Int = 0
    private set

  /** How many times [onRecycle] has run, so how often this object entered a pool. */
  var recycles: Int = 0
    private set

  /** How often [declineMeasure] declined. */
  var measuresAfterDrop: Int = 0
    private set

  /** How often [declineLayout] declined. */
  var layoutsAfterDrop: Int = 0
    private set

  /**
   * Whether this object is between [onDrop] and the next [onRecycle].
   *
   * The composition is disposed by then, and the strategy that would dispose a new one
   * has been un-armed, so a composition built from here on has nothing to release it.
   * That is B1's review N5: RN's `stopSurface` drops views *before* taking the root out,
   * so anything that measures a dropped host while it is still attached composes again
   * with no guard - the leak the drop path exists to prevent, arriving through the other
   * door.
   */
  var isDropped: Boolean = false
    private set

  /** A mount has ended. */
  fun onDrop() {
    drops += 1
    isDropped = true
  }

  /**
   * The object has been reset for reuse, so the next mount may compose again.
   *
   * This is the only thing that clears [isDropped]: a host that stayed flagged would
   * decline its first measure and never build a composition for its new owner.
   */
  fun onRecycle() {
    recycles += 1
    isDropped = false
  }

  /**
   * Whether the host's `onMeasure` should decline. Counts the ask either way, so the
   * number answers "did the path happen" and not merely "did the guard fire" - the
   * difference between a measured negative for N5 and an untested one.
   */
  fun declineMeasure(): Boolean {
    if (!isDropped) {
      return false
    }
    measuresAfterDrop += 1
    return true
  }

  /// [declineMeasure] for the layout pass, which `ViewGroup` can run on a view it never
  /// measured. A counter on the measure path alone would call the case unreachable when
  /// it had only gone unmeasured.
  fun declineLayout(): Boolean {
    if (!isDropped) {
      return false
    }
    layoutsAfterDrop += 1
    return true
  }

  /** The counters, as one line for `nuiTestLifetimeReport`. */
  fun report(): String =
    "drops=${drops} recycles=${recycles}" +
      " measuresAfterDrop=${measuresAfterDrop}" +
      " layoutsAfterDrop=${layoutsAfterDrop}"
}
