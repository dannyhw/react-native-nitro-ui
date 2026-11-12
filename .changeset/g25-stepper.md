---
'react-native-nitro-ui': minor
---

New: `Stepper`, a pair of minus and plus buttons that move a number by `step`.

```tsx
<Stepper
  accessibilityLabel="Quantity"
  value={quantity}
  onValueChange={setQuantity}
  minimumValue={1}
  maximumValue={99}
/>
```

- It does not display the number; render the value in your own `Text`.
- Values are clamped and snapped to `step` the same way as `Slider`. Each half is disabled at its bound.
- iOS uses SwiftUI's `Stepper`, with hold-to-repeat. Android has no stepper control, so it uses two Material 3 icon buttons, and **has no hold-to-repeat**: a tap steps once.
- Screen readers see one adjustable value rather than two buttons.
