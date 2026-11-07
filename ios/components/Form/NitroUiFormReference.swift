//
//  NitroUiFormReference.swift
//  react-native-nitro-ui
//
//  The thing the S6 spike measures *against*: the same three sections in a SwiftUI `Form`,
//  hosted in the Form Hybrid View's own box (Q10 Appendix E question 2).
//
//  It is a spike seam, not a component. It exists so the prototype and the platform
//  reference are on screen at the same width, in the same window, under the same trait
//  collection - light, dark or an accessibility content size - and so `HybridNitroUiForm`
//  can read the geometry out of whichever `UICollectionView` is currently in its box. Both
//  lists are inset-grouped UIKit lists; what differs is who configures them, and that is
//  exactly the question.
//
//  The rows are plain `Text`s with the prototype's strings. A disclosure accessory has no
//  SwiftUI `Form` equivalent that is not a navigation row, and the comparison is about the
//  container's geometry - row height, section inset, corner radius, header position - not
//  about what a row contains.
//

import SwiftUI

/// The reference form: `Form` with the harness's three sections.
struct NitroUiFormReferenceForm: View {
  var body: some View {
    Form {
      Section {
        Text("Wi-Fi")
        Text("Bluetooth")
        Text("Cellular data")
        Text("Ring on receipt")
      } header: {
        Text("Connectivity")
      } footer: {
        Text("These settings apply to this device only.")
      }
      Section {
        Text("ringer")
        Text("alert")
        Text("notification")
      } header: {
        Text("Sound")
      }
      Section {
        Text("nitro-ui 0.4.0")
      } header: {
        Text("About")
      }
    }
  }
}

/// The first `UICollectionView` inside `root`, however deep SwiftUI nests it.
func nitroUiFindListView(_ root: UIView) -> UICollectionView? {
  if let list = root as? UICollectionView { return list }
  for subview in root.subviews {
    if let found = nitroUiFindListView(subview) { return found }
  }
  return nil
}

/// The largest corner radius anywhere in a cell's layers, which is the radius a grouped
/// list actually draws with: the cell layer itself is square and the rounding lives on the
/// background view UIKit puts behind its content.
func nitroUiMaxCornerRadius(_ layer: CALayer, depth: Int = 0) -> CGFloat {
  guard depth < 4 else { return layer.cornerRadius }
  var best = layer.cornerRadius
  for sublayer in layer.sublayers ?? [] {
    best = max(best, nitroUiMaxCornerRadius(sublayer, depth: depth + 1))
  }
  return best
}
