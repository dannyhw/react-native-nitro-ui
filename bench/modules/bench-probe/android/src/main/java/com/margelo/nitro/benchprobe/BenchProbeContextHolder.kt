package com.margelo.nitro.benchprobe

import com.facebook.react.bridge.ReactApplicationContext

/**
 * Bridgeless RN 0.88 does not hand out a `ReactContext` to global code, and a
 * Nitro HybridObject is not a native module, so the probe needs somewhere a
 * context can be parked.
 *
 * [BenchProbePackage] fills this from `createViewManagers(reactContext)`, which
 * React Native calls while building the view-manager registry - that happens
 * before the first surface renders, so it is populated by the time any
 * benchmark code runs. If it somehow is not, the probe reports -1 instead of
 * guessing.
 */
internal object BenchProbeContextHolder {
  @Volatile
  var context: ReactApplicationContext? = null
}
