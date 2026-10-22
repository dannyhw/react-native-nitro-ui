//
//  NitroUiMainThread.swift
//  react-native-nitro-ui
//

import UIKit

/// Threading guard for the core.
///
/// Props arrive on the main thread (Fabric mount/commit), and every host method
/// asserts this. A `hybridRef` setter can arrive on the JS thread; callers there
/// must hop with `DispatchQueue.main.async` themselves - we never hop
/// implicitly, and never `main.sync` (it can deadlock against JS).
@inline(__always)
internal func nitroUiAssertMainThread(
  file: StaticString = #filePath,
  line: UInt = #line
) {
  assert(Thread.isMainThread, "nitro-ui: expected the main thread (not an error in release)", file: file, line: line)
}
