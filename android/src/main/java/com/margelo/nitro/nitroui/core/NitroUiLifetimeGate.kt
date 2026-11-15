package com.margelo.nitro.nitroui.core

/**
 * Tracks one host object's drops, recycles and attaches, free of Android types so the rule
 * can be unit-tested: a dropped host must not compose again until it is attached again.
 */
internal class NitroUiLifetimeGate {

  var drops: Int = 0
    private set

  var recycles: Int = 0
    private set

  /**
   * True between [onDrop] and the next [onAttach]. The composition is disposed and nothing is
   * armed to dispose a new one, yet React Native can still measure a dropped host while it is
   * attached.
   */
  var isDropped: Boolean = false
    private set

  fun onDrop() {
    drops += 1
    isDropped = true
  }

  /** Entering React Native's view pool does not end the dropped window: only [onAttach] does. */
  fun onRecycle() {
    recycles += 1
  }

  /** The only thing that clears [isDropped]: there is a window and a disposal strategy again. */
  fun onAttach() {
    isDropped = false
  }

  fun declineMeasure(): Boolean = isDropped

  /** `ViewGroup` can lay out a view it never measured, so layout asks separately. */
  fun declineLayout(): Boolean = isDropped

  fun report(): String = "drops=${drops} recycles=${recycles}"
}
