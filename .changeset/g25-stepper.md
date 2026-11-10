---
'react-native-nitro-ui': minor
---

Add `Stepper`: two halves that move a number by one `step` each.

```tsx
<Stepper
  accessibilityLabel="Quantity"
  value={quantity}
  onValueChange={setQuantity}
  minimumValue={1}
  maximumValue={99}
/>
```

- **It draws no number.** The value goes to your own `Text`, the way iOS apps do it — which is also why `accessibilityLabel` is the one prop the control cannot infer: it announces the _value_ itself, and the name is yours.
- **The value rules are `Slider`'s, in the same code**, not a second copy of them: clamping and step snapping call `NitroUiSliderValue.quantize` on both platforms, so `0.1` cannot start meaning two things in one library. The grid is measured from `minimumValue` (a `0.5` step on a range starting at `0.25` lands on `0.25, 0.75, 1.25`), `maximumValue` is always reachable (`0…10` by `3` steps 0, 3, 6, 9, 10), and a value the app sends from outside the range is clamped before the control draws. A `step` that is not greater than `0` throws in development: that is not a small step, it is no step.
- **iOS is SwiftUI's own `Stepper`**, label hidden, so hold-to-repeat comes with it and **every repeat is one step and one `onValueChange`**. **Android has no stepper control**, so its half is composed from two Material 3 tonal icon buttons with the 8 dp the design puts between them, each disabled at its own bound — `docs/components/stepper.md` says so plainly, along with the one behaviour that therefore differs: **Android has no hold-to-repeat**. A tap steps once. The minus and plus are the Material Symbols `remove` and `add`, fetched and locked rather than hand-drawn.
- **At a bound the half is disabled and produces no event at all** — not an event carrying the value it already had. Neither a finger nor a test seam may invent an event the control could not have produced, and both platforms answer from the same `canStep` check the buttons themselves are given.
- **A screen reader meets one adjustable value, not two buttons.** iOS vends one `.adjustable` element with the value as its own; Android merges the row into a single node publishing `ProgressBarRangeInfo` and a `SetProgress` action and clears the two buttons' own semantics away, so one swipe of the reader's is one step of the control's and TalkBack is never offered a second focus stop.
- **`intrinsic`, with one configuration for the whole app.** The two halves are fixed-width on both platforms — 94×32 pt on iOS, 104×48 dp on Android — so no range, step or disabled state moves the box, and the sizing key is empty: one cached size answers every Stepper in the tree.
