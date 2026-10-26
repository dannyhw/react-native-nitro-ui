//
//  NitroUiDeclaredFallbacks.swift
//  react-native-nitro-ui
//
//  The startup half of `NitroUiSizing.setFallback` (T14).
//
//  A component's declared fallback is the size the engine lays a control out
//  with before that control has measured itself (docs/architecture/sizing.md
//  §5). Declaring it from the component's own `init` was too late: Fabric
//  measures a shadow node *before* it creates the view, so the first instance of
//  every configuration was measured with no fallback at all - a cold first
//  `fillWidth` control laid out 0 tall and a cold first `intrinsic` control with
//  no box, for one frame (D17). The numbers stay in the component, which is the
//  only thing that knows what it hosts and which OS's control size applies
//  (D14); this file only says *when* they get registered.
//
//  One line per self-sizing component, kept in step with
//  `nitro-ui.sizing.json` (core.md §9). A component missing here still declares
//  its fallback when its first view is created - the old, one-frame-late
//  behaviour - so forgetting costs a stale first frame rather than a broken
//  layout.
//

/// Every declared sizing fallback, registered once, before any shadow node is
/// measured.
enum NitroUiDeclaredFallbacks {
  /// A Swift static is lazy and thread-safe, so this runs exactly once however
  /// many callers it has.
  private static let hasRegistered: Bool = {
    HybridNitroUiSwitch.declareFallback()
    HybridNitroUiSlider.declareFallback()
    HybridNitroUiButton.declareFallback()
    HybridNitroUiProgress.declareFallback()
    HybridNitroUiSegmentedControl.declareFallback()
    HybridNitroUiDatePicker.declareFallback()
    HybridNitroUiPicker.declareFallback()
    return true
  }()

  static func registerAll() {
    _ = Self.hasRegistered
  }
}

/// C entry point for `NitroUiDeclaredFallbacksLoader`'s `+load` (see the `.m`
/// beside this file). Swift has no `+load`, and the registration has to happen
/// before React starts: by the first render it is already later than the first
/// measure of a component whose view has not been created yet.
@_cdecl("NitroUiDeclareDeclaredFallbacks")
func NitroUiDeclareDeclaredFallbacks() {
  NitroUiDeclaredFallbacks.registerAll()
}
