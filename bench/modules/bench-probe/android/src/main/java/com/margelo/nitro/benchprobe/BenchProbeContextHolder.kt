package com.margelo.nitro.benchprobe

import com.facebook.react.bridge.ReactApplicationContext

/**
 * A Nitro HybridObject is not a native module and is handed no `ReactContext`,
 * so [BenchProbePackage] parks one here from `createViewManagers`, which React
 * Native calls before the first surface renders.
 */
internal object BenchProbeContextHolder {
  @Volatile
  var context: ReactApplicationContext? = null
}
