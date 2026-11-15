// Registers every component's declared sizing fallback at process start. Fabric measures a shadow
// node before it creates the view, so declaring from a component's `init` is one frame too late.

/// One line per self-sizing component, in step with `nitro-ui.sizing.json`. A component missing
/// here declares its fallback when its first view is created, one frame late.
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
    HybridNitroUiMenu.declareFallback()
    HybridNitroUiTextField.declareFallback()
    HybridNitroUiChip.declareFallback()
    HybridNitroUiCheckbox.declareFallback()
    HybridNitroUiSearchField.declareFallback()
    HybridNitroUiIconButton.declareFallback()
    HybridNitroUiStepper.declareFallback()
    HybridNitroUiButtonGroup.declareFallback()
    HybridNitroUiListItem.declareFallback()
    return true
  }()

  static func registerAll() {
    _ = Self.hasRegistered
  }
}

/// Called from `NitroUiDeclaredFallbacksLoader`'s `+load`, because Swift has no `+load` and
/// registration must happen before React's first measure.
@_cdecl("NitroUiDeclareDeclaredFallbacks")
func NitroUiDeclareDeclaredFallbacks() {
  NitroUiDeclaredFallbacks.registerAll()
}
