import UIKit

/// Props arrive on the main thread, and every host method asserts it. A `hybridRef` setter can
/// arrive on the JS thread: callers there hop with `DispatchQueue.main.async` themselves, never
/// `main.sync`, which can deadlock against JS.
@inline(__always)
internal func nitroUiAssertMainThread(
  file: StaticString = #filePath,
  line: UInt = #line
) {
  assert(Thread.isMainThread, "nitro-ui: expected the main thread (not an error in release)", file: file, line: line)
}
