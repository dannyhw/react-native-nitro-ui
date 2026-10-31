package com.margelo.nitro.nitroui.core

/**
 * What one host object has been through, and the rule that follows from it.
 *
 * Pure logic with no Android types, which is why it is a class rather than four
 * fields on [NitroComposeHost]: the interesting part - "a dropped host must not
 * compose again, until it is attached again" - is a decision, and a decision made in a
 * `ViewGroup` can only be tested by a device run that happens to reach it. Here it
 * goes red on the JVM when the branch is deleted (`NitroUiLifetimeGateTest`), which is
 * what AGENTS.md asks for before a gate is trusted. The host calls [onDrop] and
 * [onAttach] from its own teardown and attach, and asks [declineMeasure] and
 * [declineLayout] at the top of its measure and layout passes.
 *
 * ## Why the dropped window ends at attach and not at recycle
 *
 * [isDropped] is cleared by [onAttach], not by [onRecycle], because the rule is about
 * what is safe to *compose*, and what makes composing safe again is a window plus an
 * armed [androidx.compose.ui.platform.ViewCompositionStrategy] - both of which exist
 * only from [NitroComposeHost.onAttachedToWindow]. Recycling hands a host into RN's
 * pool with neither, and the pool is where a host may never be reused, so clearing at
 * pool entry opened the window exactly when composing was least safe. Under recycling
 * the two calls arrive back to back, so a pooled view used to leave the dropped window
 * immediately and the guard could never be seen to do anything.
 *
 * ## Why the two counters here are per object
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
 *
 * The asks that [declineMeasure] and [declineLayout] answer go the other way - into
 * process-wide totals on the host - because the question there is whether the path ever
 * happens *anywhere in the process*, and a per-object count of it could only be read
 * through a handle to the very object whose guard fired.
 */
internal class NitroUiLifetimeGate {

  /** How many times [onDrop] has run: the number of mounts this object has finished. */
  var drops: Int = 0
    private set

  /** How many times [onRecycle] has run, so how often this object entered a pool. */
  var recycles: Int = 0
    private set

  /**
   * Whether this object is between [onDrop] and the next [onAttach].
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
   * The object has entered RN's pool, so its next mount starts from a clean model.
   *
   * This does *not* end the dropped window: only [onAttach] does. See the class docs for
   * why pool entry is the wrong place to trust a host with a composition again.
   */
  fun onRecycle() {
    recycles += 1
  }

  /**
   * A mount is beginning, so composing is safe again: there is a window, and the caller
   * has just armed a strategy for the composition it is about to build.
   *
   * This is the only thing that clears [isDropped]. A host that stayed flagged would
   * decline its first measure and never build a composition for its new owner.
   */
  fun onAttach() {
    isDropped = false
  }

  /**
   * Whether the host's `onMeasure` should decline. The host counts the ask either way, so
   * the number answers "did the path happen" and not merely "did the guard fire" - the
   * difference between a measured negative for N5 and an untested one.
   */
  fun declineMeasure(): Boolean = isDropped

  /// [declineMeasure] for the layout pass, which `ViewGroup` can run on a view it never
  /// measured. A counter on the measure path alone would call the case unreachable when
  /// it had only gone unmeasured.
  fun declineLayout(): Boolean = isDropped

  /** The per-object counters, as one line for `nuiTestLifetimeReport`. */
  fun report(): String = "drops=${drops} recycles=${recycles}"
}
